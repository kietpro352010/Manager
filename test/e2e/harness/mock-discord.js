'use strict';

const EventEmitter = require('node:events');
const { attachInteractionHandler } = require('../../../src/discord/handlers/interaction-handler');

/**
 * MockDiscordClient: In-memory Discord.js Client Emulator.
 */
class MockDiscordClient extends EventEmitter {
  constructor() {
    super();
    this.ws = { ping: 42, status: 0 };
    this.user = {
      id: '111111111111111111',
      username: 'KBOT-Manager',
      tag: 'KBOT-Manager#0001'
    };
    this.guilds = {
      cache: new Map()
    };
  }

  isReady() {
    return true;
  }

  destroy() {
    this.emit('destroyed');
  }
}

/**
 * SyntheticInteraction: Universal interaction simulator.
 */
class SyntheticInteraction {
  constructor(options = {}) {
    this.type = options.type || 'chat_input'; // 'chat_input' | 'button' | 'select' | 'modal'
    this.id = options.id || `inter_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.applicationId = options.applicationId || '111111111111111111';
    this.guildId = options.guildId !== undefined ? options.guildId : '999999999999999999';
    this.guild = options.guild || {
      id: this.guildId,
      ownerId: options.guildOwnerId || 'owner_111'
    };
    this.channelId = options.channelId || 'channel_123';

    const userId = options.userId || options.user?.id || 'user_123';
    const username = options.username || options.user?.username || 'testuser';
    this.user = options.user || {
      id: userId,
      username,
      tag: `${username}#0001`
    };

    const isAdmin = Boolean(options.isAdmin);
    this.memberPermissions = options.memberPermissions || {
      has: (perm) => isAdmin
    };
    this.member = options.member || {
      permissions: {
        has: (perm) => isAdmin
      },
      roles: {
        cache: new Map()
      }
    };

    // Slash command options
    this.commandName = options.commandName || '';
    this.options = {
      getSubcommand: () => options.subcommand || null,
      getString: (key) => options.strings?.[key] || null,
      getRole: (key) => options.roles?.[key] || null,
      getUser: (key) => options.users?.[key] || null,
      getInteger: (key) => options.integers?.[key] || null,
      getBoolean: (key) => options.booleans?.[key] || null
    };

    // Component / Modal options
    this.customId = options.customId || '';
    this.values = options.values || [];
    this.fields = {
      getTextInputValue: (key) => options.fields?.[key] || ''
    };

    // Lifecycle state
    this.deferred = false;
    this.replied = false;
    this.ephemeral = false;
    this.responses = [];
    this.modal = null;

    this._resolveResponse = null;
    this.responsePromise = new Promise((resolve) => {
      this._resolveResponse = resolve;
    });
  }

  isChatInputCommand() {
    return this.type === 'chat_input';
  }

  isButton() {
    return this.type === 'button';
  }

  isStringSelectMenu() {
    return this.type === 'select';
  }

  isModalSubmit() {
    return this.type === 'modal';
  }

  inGuild() {
    return Boolean(this.guildId);
  }

  _notifyTerminal(type, payload) {
    if (this._resolveResponse) {
      this._resolveResponse(payload);
    }
  }

  async deferReply(opts = {}) {
    if (this.deferred || this.replied) {
      const err = new Error('Interaction already acknowledged');
      err.code = 40060;
      throw err;
    }
    this.deferred = true;
    if (opts.ephemeral) this.ephemeral = true;
    this.responses.push({ type: 'deferReply', opts });
    return Promise.resolve();
  }

  async reply(payload) {
    if (this.deferred || this.replied) {
      const err = new Error('Interaction already acknowledged');
      err.code = 40060;
      throw err;
    }
    this.replied = true;
    this.responses.push({ type: 'reply', payload });
    this._notifyTerminal('reply', payload);
    return Promise.resolve(payload);
  }

  async editReply(payload) {
    this.responses.push({ type: 'editReply', payload });
    this._notifyTerminal('editReply', payload);
    return Promise.resolve(payload);
  }

  async deferUpdate() {
    this.deferred = true;
    this.responses.push({ type: 'deferUpdate' });
    this._notifyTerminal('deferUpdate', {});
    return Promise.resolve();
  }

  async update(payload) {
    this.replied = true;
    this.responses.push({ type: 'update', payload });
    this._notifyTerminal('update', payload);
    return Promise.resolve(payload);
  }

  async followUp(payload) {
    this.responses.push({ type: 'followUp', payload });
    return Promise.resolve(payload);
  }

  async showModal(modal) {
    if (this.deferred || this.replied) {
      const err = new Error('Interaction already acknowledged; cannot show modal');
      err.code = 40060;
      throw err;
    }
    this.modal = modal;
    this.responses.push({ type: 'showModal', modal });
    this._notifyTerminal('showModal', modal);
    return Promise.resolve(modal);
  }

  async waitForResponse(timeoutMs = 2500) {
    return Promise.race([
      this.responsePromise,
      new Promise((resolve) => setTimeout(resolve, timeoutMs))
    ]);
  }

  getLastReply() {
    for (let i = this.responses.length - 1; i >= 0; i--) {
      const r = this.responses[i];
      if (['editReply', 'reply', 'update', 'followUp'].includes(r.type)) {
        return r.payload;
      }
    }
    return null;
  }

  getEmbeds() {
    const last = this.getLastReply();
    if (!last) return [];
    if (Array.isArray(last.embeds)) return last.embeds;
    if (last.embed) return [last.embed];
    return [];
  }

  getComponents() {
    const last = this.getLastReply();
    if (!last || !Array.isArray(last.components)) return [];
    const flattened = [];
    for (const row of last.components) {
      const children = row.components || row.data?.components;
      if (Array.isArray(children)) {
        for (const child of children) {
          flattened.push(child);
        }
      } else {
        flattened.push(row);
      }
    }
    return flattened;
  }

  findButton(customIdPrefix) {
    const components = this.getComponents();
    return (
      components.find((comp) => {
        const id = comp.customId || comp.data?.custom_id || comp.data?.customId;
        return id === customIdPrefix || (id && id.startsWith(customIdPrefix));
      }) || null
    );
  }

  getModal() {
    return this.modal;
  }
}

/**
 * MockDiscordEngine: Local interaction dispatcher attaching to Manager Discord handler.
 */
class MockDiscordEngine {
  constructor({ config = {}, services = {}, logger = console } = {}) {
    this.client = new MockDiscordClient();
    this.config = {
      discordGuildId: '999999999999999999',
      ...config
    };
    this.services = services;
    this.logger = logger;

    // Attach handler
    attachInteractionHandler(this.client, {
      config: this.config,
      services: this.services,
      logger: this.logger
    });
  }

  /**
   * Dispatch a simulated slash command.
   */
  async dispatchSlash(commandName, options = {}) {
    const interaction = new SyntheticInteraction({
      type: 'chat_input',
      commandName,
      guildId: options.guildId !== undefined ? options.guildId : this.config.discordGuildId,
      ...options
    });

    this.client.emit('interactionCreate', interaction);
    await interaction.waitForResponse();
    return interaction;
  }

  /**
   * Dispatch a simulated panel button interaction.
   */
  async dispatchButton(customId, options = {}) {
    const interaction = new SyntheticInteraction({
      type: 'button',
      customId,
      guildId: options.guildId !== undefined ? options.guildId : this.config.discordGuildId,
      ...options
    });

    this.client.emit('interactionCreate', interaction);
    await interaction.waitForResponse();
    return interaction;
  }

  /**
   * Dispatch a simulated string select menu interaction.
   */
  async dispatchSelect(customId, values = [], options = {}) {
    const interaction = new SyntheticInteraction({
      type: 'select',
      customId,
      values,
      guildId: options.guildId !== undefined ? options.guildId : this.config.discordGuildId,
      ...options
    });

    this.client.emit('interactionCreate', interaction);
    await interaction.waitForResponse();
    return interaction;
  }

  /**
   * Dispatch a simulated modal submission (e.g. login_modal).
   */
  async dispatchLoginModal(username, password, options = {}) {
    const interaction = new SyntheticInteraction({
      type: 'modal',
      customId: 'login_modal',
      fields: {
        login_username: username,
        login_password: password
      },
      guildId: options.guildId !== undefined ? options.guildId : this.config.discordGuildId,
      ...options
    });

    this.client.emit('interactionCreate', interaction);
    await interaction.waitForResponse();
    return interaction;
  }
}

module.exports = {
  MockDiscordClient,
  SyntheticInteraction,
  MockDiscordEngine
};
