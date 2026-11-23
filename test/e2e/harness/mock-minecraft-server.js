'use strict';

const EventEmitter = require('node:events');
const path = require('node:path');

// Resilient module resolver across Manager and Worker environments
let mc;
try {
  mc = require('minecraft-protocol');
} catch (_) {
  try {
    mc = require(path.resolve(__dirname, '../../../../worker/node_modules/minecraft-protocol'));
  } catch (__) {
    try {
      mc = require('D:/worker/node_modules/minecraft-protocol');
    } catch (___) {
      mc = null;
    }
  }
}

let mcDataFactory;
try {
  mcDataFactory = require('minecraft-data');
} catch (_) {
  try {
    mcDataFactory = require(path.resolve(__dirname, '../../../../worker/node_modules/minecraft-data'));
  } catch (__) {
    try {
      mcDataFactory = require('D:/worker/node_modules/minecraft-data');
    } catch (___) {
      mcDataFactory = null;
    }
  }
}

const mcData = mcDataFactory ? mcDataFactory('1.20.1') : null;

/**
 * MockMinecraftServer: 100% Local Mock Minecraft TCP Server.
 * Emulates vanilla 1.20.1 Minecraft server and KingMC Authme lobby FSM.
 */
class MockMinecraftServer extends EventEmitter {
  /**
   * @param {Object} [options]
   * @param {string} [options.host='127.0.0.1'] - Listen address
   * @param {number} [options.port=0] - Dynamic ephemeral port
   * @param {string} [options.version='1.20.1'] - Minecraft version
   * @param {Object} [options.authCoords={ x: 5.0, y: 119.0, z: 4.0 }] - KingMC Auth Lobby
   * @param {Object} [options.lobbyCoords={ x: 1.0, y: 41.0, z: 1.0 }] - KingMC Server Selection Lobby
   * @param {Object} [options.survivalCoords={ x: 100.0, y: 64.0, z: 200.0 }] - Survival In-Game Coords
   * @param {boolean} [options.autoAuthPrompt=true] - Send auth prompt on connect
   * @param {boolean} [options.autoAuthSuccess=true] - Auto accept /login and /register
   * @param {number} [options.authPromptDelayMs=150] - Delay before auth prompt
   * @param {number} [options.keepAliveIntervalMs=10000] - Keep-alive ping interval
   */
  constructor(options = {}) {
    super();
    this.options = {
      host: '127.0.0.1',
      port: 0,
      version: '1.20.1',
      authCoords: { x: 5.0, y: 119.0, z: 4.0 },
      lobbyCoords: { x: 1.0, y: 41.0, z: 1.0 },
      survivalCoords: { x: 100.0, y: 64.0, z: 200.0 },
      autoAuthPrompt: true,
      autoAuthSuccess: true,
      authPromptDelayMs: 150,
      keepAliveIntervalMs: 10000,
      ...options
    };

    this.server = null;
    this.port = 0;
    this.clients = new Set();
    this.receivedCommands = [];
    this.receivedChats = [];
    this.receivedPackets = [];
    this.keepAliveTimer = null;
    this.isListening = false;
  }

  /**
   * Start the TCP server and bind to dynamic ephemeral port
   * @returns {Promise<number>} Resolved with listening port
   */
  async start() {
    if (this.isListening) return this.port;

    if (!mc || !mcData) {
      throw new Error(
        'minecraft-protocol or minecraft-data module not found. Ensure D:/worker/node_modules exists.'
      );
    }

    return new Promise((resolve, reject) => {
      try {
        this.server = mc.createServer({
          host: this.options.host,
          port: this.options.port,
          version: this.options.version,
          'online-mode': false,
          hideErrors: true
        });

        this.server.on('listening', () => {
          this.port = this.server.socketServer.address().port;
          this.isListening = true;
          this.startKeepAliveLoop();
          this.emit('listening', { port: this.port });
          resolve(this.port);
        });

        this.server.on('error', (err) => {
          this.emit('error', err);
          reject(err);
        });

        this.server.on('login', (client) => {
          this.clients.add(client);
          client.socket?.on('error', (err) => {
            if (!['ECONNRESET', 'EPIPE', 'ECONNABORTED'].includes(err?.code)) {
              this.emit('socket_error', { client, error: err });
            }
          });
          this.handleClientLogin(client);

          client.on('end', () => {
            this.clients.delete(client);
            this.emit('client_disconnect', client);
          });

          client.on('error', (err) => {
            if (!['ECONNRESET', 'EPIPE', 'ECONNABORTED'].includes(err?.code)) {
              this.emit('client_error', { client, error: err });
            }
          });
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Complete Minecraft join protocol sequence
   * @private
   */
  handleClientLogin(client) {
    this.emit('client_login', client);

    // 1. Join Game (login) packet
    const loginPacket = {
      ...mcData.loginPacket,
      entityId: client.id || 42,
      isHardcore: false,
      gameMode: 0, // survival
      previousGameMode: -1, // i8 signed: -1 (no previous game mode)
      worldNames: ['minecraft:overworld'],
      dimensionCodec: mcData.loginPacket.dimensionCodec,
      worldType: 'minecraft:overworld',
      worldName: 'minecraft:overworld',
      hashedSeed: [0, 0],
      maxPlayers: 20,
      viewDistance: 10,
      simulationDistance: 10,
      reducedDebugInfo: false,
      enableRespawnScreen: true,
      isDebug: false,
      isFlat: false,
      death: null,
      portalCooldown: 0
    };
    client.write('login', loginPacket);

    // 2. Set Initial Position (Auth Lobby)
    const { x, y, z } = this.options.authCoords;
    client.write('position', {
      x,
      y,
      z,
      yaw: 0,
      pitch: 0,
      flags: 0,
      teleportId: 1
    });

    // 3. Health Update (Crucial: Triggers Mineflayer spawn event)
    client.write('update_health', {
      health: 20.0,
      food: 20,
      foodSaturation: 5.0
    });

    // 4. Prompt for Authme Login/Register
    if (this.options.autoAuthPrompt) {
      const promptTimer = setTimeout(() => {
        if (!this.clients.has(client)) return;
        this.sendSystemChat(client, 'Vui lòng đăng nhập bằng lệnh /login <mật khẩu>');
      }, this.options.authPromptDelayMs);
      promptTimer.unref?.();
    }

    // 5. Intercept incoming client packets
    client.on('packet', (data, meta) => {
      this.receivedPackets.push({ client: client.username, name: meta.name, data });

      if (meta.name === 'chat_command') {
        const fullCmd = data.command;
        this.receivedCommands.push(fullCmd);
        this.emit('chat_command', { client, command: fullCmd });

        if (
          this.options.autoAuthSuccess &&
          (fullCmd.startsWith('login') || fullCmd.startsWith('dn') || fullCmd.startsWith('register'))
        ) {
          this.sendSystemChat(client, '§aĐăng nhập thành công! Chào mừng bạn vào KingMC.');
          // Teleport to survival area
          const s = this.options.survivalCoords;
          client.write('position', {
            x: s.x,
            y: s.y,
            z: s.z,
            yaw: 0,
            pitch: 0,
            flags: 0,
            teleportId: 2
          });
          this.emit('auth_success', client);
        }
      } else if (meta.name === 'chat_message') {
        this.receivedChats.push(data.message);
        this.emit('chat_message', { client, message: data.message });
      } else if (meta.name === 'teleport_confirm') {
        this.emit('teleport_confirm', { client, teleportId: data.teleportId });
      }
    });
  }

  /**
   * Send JSON chat message to client
   */
  sendSystemChat(client, text, isActionBar = false) {
    if (!client || typeof client.write !== 'function') return;
    try {
      client.write('system_chat', {
        content: JSON.stringify({ text }),
        isActionBar
      });
    } catch (_) {}
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcastChat(text, isActionBar = false) {
    for (const client of this.clients) {
      this.sendSystemChat(client, text, isActionBar);
    }
  }

  /**
   * Teleport client to coordinates
   */
  teleport(client, { x, y, z, yaw = 0, pitch = 0, teleportId = Date.now() % 10000 }) {
    if (!client || typeof client.write !== 'function') return;
    client.write('position', { x, y, z, yaw, pitch, flags: 0, teleportId });
  }

  /**
   * Simulate Totem of Undying Pop (status 35)
   */
  simulateTotemPop(client) {
    if (!client || typeof client.write !== 'function') return;
    client.write('entity_status', {
      entityId: client.id || 42,
      entityStatus: 35
    });
  }

  /**
   * Simulate Health Drop or Food change
   */
  simulateHealth(client, health = 10.0, food = 20, foodSaturation = 5.0) {
    if (!client || typeof client.write !== 'function') return;
    client.write('update_health', { health, food, foodSaturation });
  }

  /**
   * Gracefully kick a client with custom reason
   */
  kick(client, reason = 'Server restart') {
    if (!client) return;
    try {
      client.write('kick_disconnect', {
        reason: JSON.stringify({ text: reason })
      });
      client.end(reason);
    } catch (_) {}
  }

  /**
   * Kick all connected clients
   */
  kickAll(reason = 'Server restart') {
    for (const client of this.clients) {
      this.kick(client, reason);
    }
  }

  /**
   * Abruptly terminate TCP socket (simulate network crash/RST)
   */
  abruptDisconnect(client) {
    if (!client) return;
    try {
      client.socket?.destroy?.();
    } catch (_) {}
  }

  startKeepAliveLoop() {
    this.stopKeepAliveLoop();
    if (!this.options.keepAliveIntervalMs) return;

    this.keepAliveTimer = setInterval(() => {
      const id = BigInt(Date.now());
      for (const client of this.clients) {
        try {
          client.write('keep_alive', { keepAliveId: id });
        } catch (_) {}
      }
    }, this.options.keepAliveIntervalMs);
    this.keepAliveTimer.unref?.();
  }

  stopKeepAliveLoop() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  /**
   * Gracefully close server and all client connections
   */
  async stop() {
    this.stopKeepAliveLoop();
    if (!this.server) return;

    for (const client of this.clients) {
      try {
        client.end('Server shutdown');
        client.socket?.destroy?.();
      } catch (_) {}
    }
    this.clients.clear();

    return new Promise((resolve) => {
      const socketServer = this.server?.socketServer;
      let resolved = false;
      const done = () => {
        if (!resolved) {
          resolved = true;
          this.isListening = false;
          this.server = null;
          resolve();
        }
      };

      const fallbackTimer = setTimeout(done, 1000);
      fallbackTimer.unref?.();

      if (socketServer) {
        socketServer.close(done);
      }

      try {
        this.server.close();
      } catch (_) {
        done();
      }
    });
  }
}

module.exports = MockMinecraftServer;
