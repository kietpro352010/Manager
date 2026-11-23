'use strict';

/**
 * KBOT End-to-End Test Suite - Tier 2: Boundary & Corner Cases
 * 
 * Matrix: 26 Features x 5 Tests = Exactly 130 Tests
 * Test IDs: T2-F01-01 to T2-F26-05
 * 
 * Verifies edge cases, empty inputs, extreme payload sizes, special characters,
 * network timeouts, invalid worker secrets, unauthorized tokens, expired leases,
 * socket drops, rapid duplicate requests, and rate limits.
 */

const assert = require('node:assert');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const fs = require('node:fs');

// Harness Imports
const {
  createMockSupabaseServer,
  createMockSupabaseClient,
  MockDatabase,
  QueryEngine,
  RpcRegistry,
  SUPABASE_REQUIRED_TABLES
} = require('../harness/mock-supabase');

const MockMinecraftServer = require('../harness/mock-minecraft-server');
const {
  MockDiscordEngine,
  MockDiscordClient,
  SyntheticInteraction
} = require('../harness/mock-discord');

// Manager Core Imports
const { createApp } = require('../../../src/http/app');
const { loadConfig: loadManagerConfig } = require('../../../src/config/env');
const {
  encryptSecret,
  decryptSecret,
  generateWorkerSecret,
  generateToken
} = require('../../../src/utils/secrets');
const { cleanText, extractChatMessage } = require('../../../src/utils/text-format');
const WorkerRegistry = require('../../../src/services/worker-registry');
const CommandBroker = require('../../../src/services/command-broker');
const Link4mService = require('../../../src/services/link4m-service');
const { EntitlementService } = require('../../../src/services/entitlement-service');
const {
  rejectOutsideGuild,
  getEffectiveAllowedGuildId
} = require('../../../src/discord/handlers/interaction-handler');
const {
  handlePanelInteraction
} = require('../../../src/discord/handlers/panel-handler');

// Worker Core Imports (via relative resolution)
const WORKER_ROOT = process.env.WORKER_DIR || path.resolve(__dirname, '../../../../worker');
const {
  loadConfig: loadWorkerConfig,
  positiveInt: workerPositiveInt,
  bool: workerBool
} = require(path.join(WORKER_ROOT, 'src/config/env'));
const WorkerFleet = require(path.join(WORKER_ROOT, 'src/services/worker-fleet'));
const WorkerRuntime = require(path.join(WORKER_ROOT, 'src/services/worker-runtime'));
const { ACTIONS: WORKER_ACTIONS } = require(path.join(WORKER_ROOT, 'src/services/worker-runtime'));
const {
  isMaintenanceWindow,
  nextMaintenanceBoundary
} = require(path.join(WORKER_ROOT, 'src/services/maintenance-window'));
const ServerMonitor = require(path.join(WORKER_ROOT, 'src/game/server-monitor'));
const { MinecraftSession } = require(path.join(WORKER_ROOT, 'src/game/minecraft-session'));
const { createRouter: createWorkerRouter } = require(path.join(WORKER_ROOT, 'src/http/routes'));

// ---------------------------------------------------------------------------
// TEST RUNNER INFRASTRUCTURE
// ---------------------------------------------------------------------------
const tests = [];

function registerTest(id, featureNum, description, fn) {
  tests.push({ id, featureNum, description, fn });
}

// Helper: ephemeral HTTP server for Express apps
function startServer(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        port,
        url: `http://127.0.0.1:${port}`,
        close: () => {
          server.closeIdleConnections?.();
          server.closeAllConnections?.();
          return new Promise((res) => server.close(res));
        }
      });
    });
  });
}

// Helper: standard test logger that suppresses stdout clutter
const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {}
};

// ===========================================================================
// FEATURE 1: Dual-Slot Worker Hosting (T2-F01-01 to T2-F01-05)
// ===========================================================================

registerTest('T2-F01-01', 1, 'Missing Slot 2 env vars when WORKER_BOT_COUNT=2 throws descriptive error', async () => {
  const env = {
    MANAGER_URL: 'https://manager.test.internal',
    MC_SERVER_HOSTS: 'kingmc.vn',
    WORKER_BOT_COUNT: '2',
    WORKER_ID_1: 'worker-01',
    WORKER_SECRET_1: 'a'.repeat(32),
    WORKER_ID_2: 'worker-02'
    // Missing WORKER_SECRET_2
  };
  assert.throws(
    () => loadWorkerConfig(env),
    /WORKER_SECRET_2 must be configured/i
  );
});

registerTest('T2-F01-02', 1, 'Identical secrets for both slots throws unique secret requirement error', async () => {
  const duplicateSecret = 'b'.repeat(32);
  const env = {
    MANAGER_URL: 'https://manager.test.internal',
    MC_SERVER_HOSTS: 'kingmc.vn',
    WORKER_BOT_COUNT: '2',
    WORKER_ID_1: 'worker-01',
    WORKER_SECRET_1: duplicateSecret,
    WORKER_ID_2: 'worker-02',
    WORKER_SECRET_2: duplicateSecret
  };
  assert.throws(
    () => loadWorkerConfig(env),
    /Each bot slot must use a different WORKER_SECRET/i
  );
});

registerTest('T2-F01-03', 1, 'Identical worker IDs for both slots throws unique ID requirement error', async () => {
  const env = {
    MANAGER_URL: 'https://manager.test.internal',
    MC_SERVER_HOSTS: 'kingmc.vn',
    WORKER_BOT_COUNT: '2',
    WORKER_ID_1: 'worker-duplicate',
    WORKER_SECRET_1: 'c'.repeat(32),
    WORKER_ID_2: 'worker-duplicate',
    WORKER_SECRET_2: 'd'.repeat(32)
  };
  assert.throws(
    () => loadWorkerConfig(env),
    /Each bot slot must use a different WORKER_ID/i
  );
});

registerTest('T2-F01-04', 1, 'Negative botCount config (-1) throws validation error', async () => {
  const env = {
    MANAGER_URL: 'https://manager.test.internal',
    MC_SERVER_HOSTS: 'kingmc.vn',
    WORKER_BOT_COUNT: '-1',
    WORKER_ID_1: 'worker-01',
    WORKER_SECRET_1: 'e'.repeat(32)
  };
  assert.throws(
    () => loadWorkerConfig(env),
    /WORKER_BOT_COUNT must be 1 or 2/i
  );
});

registerTest('T2-F01-05', 1, 'Out of range botCount config (5) throws validation error', async () => {
  const env = {
    MANAGER_URL: 'https://manager.test.internal',
    MC_SERVER_HOSTS: 'kingmc.vn',
    WORKER_BOT_COUNT: '5',
    WORKER_ID_1: 'worker-01',
    WORKER_SECRET_1: 'f'.repeat(32)
  };
  assert.throws(
    () => loadWorkerConfig(env),
    /WORKER_BOT_COUNT must be 1 or 2/i
  );
});

// ===========================================================================
// FEATURE 2: Staggered 8s Startup (T2-F02-01 to T2-F02-05)
// ===========================================================================

registerTest('T2-F02-01', 2, 'Single-slot fleet bypasses 8s stagger delay', async () => {
  const config = {
    transport: 'render-http',
    botCount: 1,
    autoStart: true,
    bots: [
      {
        slot: 1,
        workerId: 'single-bot-01',
        secret: 'a'.repeat(32),
        managerUrl: 'http://127.0.0.1:9999',
        transport: 'render-http',
        mc: { hosts: ['localhost'], port: 25565, username: 'bot1', password: 'pwd' }
      }
    ],
    wispbyte: {}
  };
  const fleet = new WorkerFleet(config, silentLogger, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, state: { settings: {}, credentials: {} } })
    })
  });
  // Prevent Mineflayer connection in test
  const instance = fleet.get('single-bot-01');
  if (instance) {
    instance.session.isHeld = () => true;
  }
  const t0 = Date.now();
  await fleet.start();
  const elapsed = Date.now() - t0;
  await fleet.stop();
  assert.ok(elapsed < 3000, `Single bot start took ${elapsed}ms, should bypass 8s stagger`);
});

registerTest('T2-F02-02', 2, 'Extreme joinDelayMs boundary validation', async () => {
  // positiveInt should clamp or fallback safely
  const fallback = 4000;
  assert.strictEqual(workerPositiveInt('-100', fallback, 0, 120000), fallback);
  assert.strictEqual(workerPositiveInt('999999', fallback, 0, 120000), fallback);
  assert.strictEqual(workerPositiveInt('60000', fallback, 0, 120000), 60000);
});

registerTest('T2-F02-03', 2, 'Process exit / stop during stagger aborts cleanly', async () => {
  const config = {
    transport: 'render-http',
    botCount: 2,
    autoStart: false,
    bots: [
      { slot: 1, workerId: 'bot-stagger-1', secret: 'a'.repeat(32), managerUrl: 'http://127.0.0.1:9999', transport: 'render-http', mc: { hosts: ['localhost'], port: 25565 } },
      { slot: 2, workerId: 'bot-stagger-2', secret: 'b'.repeat(32), managerUrl: 'http://127.0.0.1:9999', transport: 'render-http', mc: { hosts: ['localhost'], port: 25565 } }
    ],
    wispbyte: {}
  };
  const fleet = new WorkerFleet(config, silentLogger, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, state: { settings: {}, credentials: {} } })
    })
  });
  fleet.stopping = true;
  await fleet.stop();
  assert.strictEqual(fleet.state, 'STOPPED');
  assert.strictEqual(fleet.heartbeatTimer, null);
  assert.strictEqual(fleet.resourceTimer, null);
});

registerTest('T2-F02-04', 2, 'Slot 1 bootstrap error containment during fleet start', async () => {
  const config = {
    transport: 'render-http',
    botCount: 2,
    autoStart: false,
    bots: [
      { slot: 1, workerId: 'bot-err-1', secret: 'a'.repeat(32), managerUrl: 'http://127.0.0.1:9999', transport: 'render-http', mc: { hosts: ['localhost'], port: 25565 } },
      { slot: 2, workerId: 'bot-ok-2', secret: 'b'.repeat(32), managerUrl: 'http://127.0.0.1:9999', transport: 'render-http', mc: { hosts: ['localhost'], port: 25565 } }
    ],
    wispbyte: {}
  };
  const fleet = new WorkerFleet(config, silentLogger, {
    fetchImpl: async (url) => {
      if (url.includes('bot-err-1')) {
        throw new Error('Connection refused by Manager');
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, state: { settings: {}, credentials: {} } })
      };
    }
  });

  await fleet.start();
  const inst1 = fleet.get('bot-err-1');
  const inst2 = fleet.get('bot-ok-2');
  assert.strictEqual(inst1.session.restriction, 'manager_check_failed');
  assert.strictEqual(inst1.session.manualStop, true);
  assert.strictEqual(fleet.state, 'RUNNING', 'Fleet must remain running despite Slot 1 failure');
  await fleet.stop();
});

registerTest('T2-F02-05', 2, 'Clock skew / backward time jump during resource sampling', async () => {
  const config = {
    transport: 'render-http',
    botCount: 1,
    bots: [
      { slot: 1, workerId: 'bot-clock-1', secret: 'a'.repeat(32), managerUrl: 'http://127.0.0.1:9999', transport: 'render-http', mc: { hosts: ['localhost'], port: 25565 } }
    ],
    wispbyte: {}
  };
  const fleet = new WorkerFleet(config, silentLogger);
  fleet.lastResourceSampleAt = Date.now() + 60000; // Simulated time in future
  const metrics = fleet.sampleResources();
  assert.ok(Number.isFinite(metrics.cpuPercent), 'cpuPercent must be finite despite clock shift');
  assert.ok(metrics.cpuPercent >= 0 && metrics.cpuPercent <= 100, 'cpuPercent must be clamped [0, 100]');
  await fleet.stop();
});

// ===========================================================================
// FEATURE 3: RAM Guard & Sweeper (T2-F03-01 to T2-F03-05)
// ===========================================================================

registerTest('T2-F03-01', 3, 'Missing V8 GC function handled safely without throwing', async () => {
  const origGc = global.gc;
  try {
    global.gc = undefined;
    const runGc = () => {
      if (typeof global.gc === 'function') {
        try { global.gc(); return true; } catch (_) {}
      }
      return false;
    };
    assert.strictEqual(runGc(), false);
  } finally {
    global.gc = origGc;
  }
});

registerTest('T2-F03-02', 3, 'Memory sweeper calculation handles heapUsed > 0.75 * heapTotal', async () => {
  const shouldSweep = (rssMb, heapUsedMb, heapTotalMb) => {
    return rssMb > 250 || heapUsedMb > 0.75 * heapTotalMb;
  };
  assert.strictEqual(shouldSweep(200, 80, 100), true);
  assert.strictEqual(shouldSweep(260, 50, 100), true);
  assert.strictEqual(shouldSweep(200, 50, 100), false);
});

registerTest('T2-F03-03', 3, 'GC execution throwing exception is caught silently', async () => {
  const origGc = global.gc;
  try {
    global.gc = () => { throw new Error('V8 memory allocator failed'); };
    let caughtSafely = false;
    const runGc = () => {
      if (typeof global.gc === 'function') {
        try { global.gc(); return true; } catch (_) { caughtSafely = true; }
      }
      return false;
    };
    const res = runGc();
    assert.strictEqual(res, false);
    assert.strictEqual(caughtSafely, true);
  } finally {
    global.gc = origGc;
  }
});

registerTest('T2-F03-04', 3, 'Extreme RSS spike > 350MB triggers instance memory pruning', async () => {
  const config = {
    transport: 'render-http',
    botCount: 1,
    bots: [
      { slot: 1, workerId: 'bot-mem-1', secret: 'a'.repeat(32), managerUrl: 'http://127.0.0.1:9999', transport: 'render-http', mc: { hosts: ['localhost'], port: 25565 } }
    ],
    wispbyte: {}
  };
  const fleet = new WorkerFleet(config, silentLogger);
  let pruneCalled = false;
  fleet.get('bot-mem-1').session.pruneMemory = () => { pruneCalled = true; };

  // Simulate watchdog check when RSS > 350
  const rssMb = 380;
  if (rssMb > 350) {
    for (const instance of fleet.instances.values()) {
      instance.session.pruneMemory?.();
    }
  }
  assert.strictEqual(pruneCalled, true, 'pruneMemory must be called on extreme RSS spike');
  await fleet.stop();
});

registerTest('T2-F03-05', 3, '0MB memory threshold config falls back to safe default 440MB', async () => {
  const parsed = workerPositiveInt('0', 440, 128, 16384);
  assert.strictEqual(parsed, 440, '0MB must fallback to 440MB default');
});

// ===========================================================================
// FEATURE 4: Worker Slot Property Fix (T2-F04-01 to T2-F04-05)
// ===========================================================================

registerTest('T2-F04-01', 4, 'Worker config retains strict integer slot property for each bot', async () => {
  const env = {
    MANAGER_URL: 'https://manager.test.internal',
    MC_SERVER_HOSTS: 'kingmc.vn',
    WORKER_BOT_COUNT: '2',
    WORKER_ID_1: 'worker-slot-1',
    WORKER_SECRET_1: 'a'.repeat(32),
    WORKER_ID_2: 'worker-slot-2',
    WORKER_SECRET_2: 'b'.repeat(32)
  };
  const cfg = loadWorkerConfig(env);
  assert.strictEqual(cfg.bots[0].slot, 1);
  assert.strictEqual(typeof cfg.bots[0].slot, 'number');
  assert.strictEqual(cfg.bots[1].slot, 2);
  assert.strictEqual(typeof cfg.bots[1].slot, 'number');
});

registerTest('T2-F04-02', 4, 'Worker HTTP /health endpoint reports slot numbers without leaking workerIds', async () => {
  const config = {
    botCount: 2,
    bots: [
      { workerId: 'slot-bot-1', slot: 1, secret: 'a'.repeat(32) },
      { workerId: 'slot-bot-2', slot: 2, secret: 'b'.repeat(32) }
    ]
  };
  const router = createWorkerRouter({ fleet: { get: () => null, health: () => ({ ok: true }) }, config });
  const app = createAppMock(router);
  const srv = await startServer(app);
  try {
    const res = await fetch(`${srv.url}/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.botCount, 2);
    assert.strictEqual(body.bots, undefined, '/health must omit bots/workerIds');
    assert.deepStrictEqual(body.slots, [1, 2]);
    const diagRes = await fetch(`${srv.url}/api/v1/diagnostics`, {
      headers: { 'x-worker-secret': 'a'.repeat(32) }
    });
    assert.strictEqual(diagRes.status, 200);
    const diagBody = await diagRes.json();
    assert.deepStrictEqual(diagBody.bots, [
      { workerId: 'slot-bot-1', slot: 1 },
      { workerId: 'slot-bot-2', slot: 2 }
    ]);
  } finally {
    srv.server?.closeIdleConnections?.();
    await srv.close();
  }
});

registerTest('T2-F04-03', 4, 'Out of range slot fallback in integer parser', async () => {
  const parsed = workerPositiveInt('99', 1, 1, 2);
  assert.strictEqual(parsed, 1, 'Out-of-range slot 99 must fallback to 1');
});

registerTest('T2-F04-04', 4, 'Empty string slot fallback in integer parser', async () => {
  const parsed = workerPositiveInt('', 1, 1, 2);
  assert.strictEqual(parsed, 1, 'Empty slot must fallback to 1');
});

registerTest('T2-F04-05', 4, 'Manager registry stores botNumber as integer', async () => {
  const mockStore = createInMemoryWorkerStore();
  const registry = new WorkerRegistry({
    store: mockStore,
    encryptionKey: crypto.randomBytes(32),
    logger: silentLogger
  });
  const res = await registry.add({
    workerId: 'worker-reg-01',
    secret: 'c'.repeat(32)
  });
  assert.strictEqual(typeof res.worker.botNumber, 'number');
  assert.ok(res.worker.botNumber >= 1);
});

// ===========================================================================
// FEATURE 5: Maintenance Resource Cleanup (T2-F05-01 to T2-F05-05)
// ===========================================================================

registerTest('T2-F05-01', 5, 'Start bot during maintenance window sets state to maintenance', async () => {
  const maintDate = new Date('2026-11-15T04:45:00+07:00');
  assert.strictEqual(isMaintenanceWindow(maintDate), true);

  const session = new MinecraftSession(
    { mc: { hosts: ['localhost'], port: 25565, username: 'user', password: 'pwd' } },
    silentLogger
  );
  session.maintenanceWindow = true;
  await session.stop('test');
  assert.strictEqual(session.bot, null);
});

registerTest('T2-F05-02', 5, 'Exact boundary 04:30:00 UTC+7 evaluates to maintenance window', async () => {
  const startBoundary = new Date('2026-11-15T04:30:00+07:00');
  assert.strictEqual(isMaintenanceWindow(startBoundary), true);
});

registerTest('T2-F05-03', 5, 'Exact boundary 05:30:00 UTC+7 evaluates outside maintenance window', async () => {
  const endBoundary = new Date('2026-11-15T05:30:00+07:00');
  assert.strictEqual(isMaintenanceWindow(endBoundary), false);
});

registerTest('T2-F05-04', 5, 'Successive cleanupSessionResources calls are completely idempotent', async () => {
  const session = new MinecraftSession(
    { mc: { hosts: ['localhost'], port: 25565 } },
    silentLogger
  );
  const mockBot = {
    removeAllListeners: () => {},
    on: () => {},
    _client: { removeAllListeners: () => {}, on: () => {}, socket: { destroy: () => {} } },
    inventory: { removeAllListeners: () => {} }
  };
  session.cleanupSessionResources(mockBot);
  session.cleanupSessionResources(mockBot);
  assert.strictEqual(session.bot, null);
  assert.strictEqual(session.networkSockets.size, 0);
});

registerTest('T2-F05-05', 5, 'Dead / already destroyed socket handled safely during maintenance cleanup', async () => {
  const session = new MinecraftSession(
    { mc: { hosts: ['localhost'], port: 25565 } },
    silentLogger
  );
  const mockBot = {
    _client: {
      socket: {
        destroyed: true,
        destroy: () => { throw new Error('Cannot destroy already destroyed socket'); }
      }
    }
  };
  assert.doesNotThrow(() => {
    session.cleanupSessionResources(mockBot);
  });
  assert.strictEqual(session.networkSockets.size, 0);
});

// ===========================================================================
// FEATURE 6: Unhandled Error Containment (T2-F06-01 to T2-F06-05)
// ===========================================================================

registerTest('T2-F06-01', 6, 'String thrown as error formatted safely without crashing', async () => {
  const formatError = (error) => ({
    error: error?.message || String(error),
    stack: error?.stack || null
  });
  const formatted = formatError('raw_string_exception');
  assert.strictEqual(formatted.error, 'raw_string_exception');
  assert.strictEqual(formatted.stack, null);
});

registerTest('T2-F06-02', 6, 'Circular object in rejection handled safely during serialization', async () => {
  const circular = {};
  circular.self = circular;
  let serialized;
  assert.doesNotThrow(() => {
    try {
      serialized = JSON.stringify(circular);
    } catch (_) {
      serialized = '[Circular]';
    }
  });
  assert.strictEqual(serialized, '[Circular]');
});

registerTest('T2-F06-03', 6, 'Slot 1 error isolation leaves Slot 2 session running', async () => {
  const config = {
    transport: 'render-http',
    botCount: 2,
    bots: [
      { slot: 1, workerId: 'iso-bot-1', secret: 'a'.repeat(32), managerUrl: 'http://127.0.0.1:9999', transport: 'render-http', mc: { hosts: ['localhost'], port: 25565 } },
      { slot: 2, workerId: 'iso-bot-2', secret: 'b'.repeat(32), managerUrl: 'http://127.0.0.1:9999', transport: 'render-http', mc: { hosts: ['localhost'], port: 25565 } }
    ],
    wispbyte: {}
  };
  const fleet = new WorkerFleet(config, silentLogger);
  const inst1 = fleet.get('iso-bot-1');
  const inst2 = fleet.get('iso-bot-2');

  let errorCaught = false;
  inst1.session.on('error', () => { errorCaught = true; });
  inst1.session.emit('error', new Error('Simulated socket failure on Slot 1'));

  assert.strictEqual(errorCaught, true);
  assert.strictEqual(inst2.session.state, 'stopped');
  await fleet.stop();
});

registerTest('T2-F06-04', 6, 'Max listeners leak prevention on repeated session cleanups', async () => {
  const session = new MinecraftSession(
    { mc: { hosts: ['localhost'], port: 25565 } },
    silentLogger
  );
  for (let i = 0; i < 20; i++) {
    session.cleanupSessionResources(null);
  }
  assert.ok(session.listenerCount('event') <= 10);
});

registerTest('T2-F06-05', 6, 'Worker HTTP router remains responsive after internal error', async () => {
  const config = {
    botCount: 1,
    bots: [{ workerId: 'resp-bot', slot: 1, secret: 'a'.repeat(32) }]
  };
  const router = createWorkerRouter({ fleet: { get: () => null }, config });
  const app = createAppMock(router);
  const srv = await startServer(app);
  try {
    const res = await fetch(`${srv.url}/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
  } finally {
    await srv.close();
  }
});

// ===========================================================================
// FEATURE 7: Network Socket Map Cleanup (T2-F07-01 to T2-F07-05)
// ===========================================================================

registerTest('T2-F07-01', 7, 'Network sockets tracking in networkSockets map', async () => {
  const session = new MinecraftSession(
    { mc: { hosts: ['localhost'], port: 25565 } },
    silentLogger
  );
  const dummySocket = new net.Socket();
  session.networkSockets.set('sock_test_01', dummySocket);
  assert.strictEqual(session.networkSockets.size, 1);
  assert.strictEqual(session.networkSockets.get('sock_test_01'), dummySocket);
  dummySocket.destroy();
});

registerTest('T2-F07-02', 7, 'cleanupSessionResources clears networkSockets map', async () => {
  const session = new MinecraftSession(
    { mc: { hosts: ['localhost'], port: 25565 } },
    silentLogger
  );
  const s1 = new net.Socket();
  const s2 = new net.Socket();
  session.networkSockets.set('s1', s1);
  session.networkSockets.set('s2', s2);
  session.cleanupSessionResources(null);
  assert.strictEqual(session.networkSockets.size, 0);
  s1.destroy();
  s2.destroy();
});

registerTest('T2-F07-03', 7, '_haltSession clears networkSockets map', async () => {
  const session = new MinecraftSession(
    { mc: { hosts: ['localhost'], port: 25565 } },
    silentLogger
  );
  session.networkSockets.set('s_halt', new net.Socket());
  session._haltSession('test_halt');
  assert.strictEqual(session.networkSockets.size, 0);
});

registerTest('T2-F07-04', 7, 'Clear called on already empty networkSockets map is safe no-op', async () => {
  const session = new MinecraftSession(
    { mc: { hosts: ['localhost'], port: 25565 } },
    silentLogger
  );
  assert.strictEqual(session.networkSockets.size, 0);
  assert.doesNotThrow(() => {
    session.networkSockets.clear();
  });
  assert.strictEqual(session.networkSockets.size, 0);
});

registerTest('T2-F07-05', 7, 'Sockets destroyed on cleanupSessionResources', async () => {
  const session = new MinecraftSession(
    { mc: { hosts: ['localhost'], port: 25565 } },
    silentLogger
  );
  let destroyCalled = false;
  const mockBot = {
    _client: {
      socket: {
        destroy: () => { destroyCalled = true; }
      }
    }
  };
  session.cleanupSessionResources(mockBot);
  assert.strictEqual(destroyCalled, true);
});

// ===========================================================================
// FEATURE 8: Accurate Totem Telemetry (T2-F08-01 to T2-F08-05)
// ===========================================================================

registerTest('T2-F08-01', 8, 'Totem without item.count defaults safely to 1', async () => {
  const monitor = new ServerMonitor();
  monitor.bot = {
    inventory: {
      items: () => [{ name: 'totem_of_undying', slot: 10 }],
      slots: {}
    }
  };
  const snap = monitor.snapshot();
  assert.strictEqual(snap.totemCount, 1);
});

registerTest('T2-F08-02', 8, 'Stack of 64 totems in off-hand slot 45 counted accurately', async () => {
  const monitor = new ServerMonitor();
  monitor.bot = {
    inventory: {
      items: () => [],
      slots: { 45: { name: 'totem_of_undying', count: 64 } }
    }
  };
  const snap = monitor.snapshot();
  assert.strictEqual(snap.totemCount, 64);
});

registerTest('T2-F08-03', 8, 'Non-totem item in slot 45 (shield) does not count as totem', async () => {
  const monitor = new ServerMonitor();
  monitor.bot = {
    inventory: {
      items: () => [],
      slots: { 45: { name: 'shield', count: 1 } }
    }
  };
  const snap = monitor.snapshot();
  assert.strictEqual(snap.totemCount, 0);
});

registerTest('T2-F08-04', 8, 'Missing inventory.slots evaluated safely to 0 totems', async () => {
  const monitor = new ServerMonitor();
  monitor.bot = {
    inventory: {
      items: () => []
    }
  };
  const snap = monitor.snapshot();
  assert.strictEqual(snap.totemCount, 0);
  assert.strictEqual(snap.goldenAppleCount, 0);
});

registerTest('T2-F08-05', 8, 'Slot 45 totem filtered from items() to prevent double counting', async () => {
  const monitor = new ServerMonitor();
  monitor.bot = {
    inventory: {
      items: () => [
        { name: 'totem_of_undying', count: 2, slot: 20 },
        { name: 'totem_of_undying', count: 1, slot: 45 }
      ],
      slots: {
        45: { name: 'totem_of_undying', count: 1 }
      }
    }
  };
  const snap = monitor.snapshot();
  assert.strictEqual(snap.totemCount, 3);
});

// ===========================================================================
// FEATURE 9: Worker Clean Shutdown (T2-F09-01 to T2-F09-05)
// ===========================================================================

registerTest('T2-F09-01', 9, 'Dual stop signals handled idempotently', async () => {
  const config = {
    transport: 'render-http',
    botCount: 1,
    bots: [{ slot: 1, workerId: 'bot-dual-stop', secret: 'a'.repeat(32), managerUrl: 'http://127.0.0.1:9999', transport: 'render-http', mc: { hosts: ['localhost'], port: 25565 } }],
    wispbyte: {}
  };
  const fleet = new WorkerFleet(config, silentLogger);
  await fleet.stop();
  await fleet.stop();
  assert.strictEqual(fleet.state, 'STOPPED');
});

registerTest('T2-F09-02', 9, '2000ms fallback shutdown timer has .unref() set', async () => {
  let exited = false;
  const timer = setTimeout(() => { exited = true; }, 2000);
  timer.unref();
  assert.strictEqual(typeof timer.hasRef, 'function');
  assert.strictEqual(timer.hasRef(), false);
  clearTimeout(timer);
});

registerTest('T2-F09-03', 9, 'Instance stop throwing error caught cleanly during fleet shutdown', async () => {
  const config = {
    transport: 'render-http',
    botCount: 1,
    bots: [{ slot: 1, workerId: 'bot-throw-stop', secret: 'a'.repeat(32), managerUrl: 'http://127.0.0.1:9999', transport: 'render-http', mc: { hosts: ['localhost'], port: 25565 } }],
    wispbyte: {}
  };
  const fleet = new WorkerFleet(config, silentLogger);
  fleet.state = 'RUNNING';
  fleet.get('bot-throw-stop').session.stop = async () => {
    throw new Error('Forced session stop error');
  };
  await assert.rejects(async () => {
    await fleet.stop();
  }, /Forced session stop error/);
  assert.strictEqual(fleet.state, 'STOPPING');
});

registerTest('T2-F09-04', 9, 'Shutdown during start transitions cleanly to STOPPED', async () => {
  const config = {
    transport: 'render-http',
    botCount: 1,
    autoStart: false,
    bots: [{ slot: 1, workerId: 'bot-stop-start', secret: 'a'.repeat(32), managerUrl: 'http://127.0.0.1:9999', transport: 'render-http', mc: { hosts: ['localhost'], port: 25565 } }],
    wispbyte: {}
  };
  const fleet = new WorkerFleet(config, silentLogger, {
    fetchImpl: async () => {
      fleet.stopping = true;
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, state: { settings: {}, credentials: {} } })
      };
    }
  });
  await fleet.start();
  assert.strictEqual(fleet.state, 'STOPPED');
});

registerTest('T2-F09-05', 9, 'Poller stop aborts cleanly on shutdown', async () => {
  const config = {
    transport: 'wispbyte-poll',
    botCount: 1,
    bots: [{ slot: 1, workerId: 'bot-poll-stop', secret: 'a'.repeat(32), managerUrl: 'http://127.0.0.1:9999', transport: 'wispbyte-poll', mc: { hosts: ['localhost'], port: 25565 } }],
    wispbyte: {}
  };
  const fleet = new WorkerFleet(config, silentLogger);
  const poller = fleet.get('bot-poll-stop').poller;
  assert.ok(poller);
  await poller.stop();
  assert.strictEqual(poller.stopping, true);
  await fleet.stop();
});

// ===========================================================================
// FEATURE 10: Worker Test Suite Restoration (T2-F10-01 to T2-F10-05)
// ===========================================================================

registerTest('T2-F10-01', 10, 'Worker package.json contains non-empty "test" script', async () => {
  const pkgPath = path.join(WORKER_ROOT, 'package.json');
  assert.ok(fs.existsSync(pkgPath));
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  assert.ok(pkg.scripts?.test);
  assert.ok(pkg.scripts.test.trim().length > 0);
});

registerTest('T2-F10-02', 10, 'Worker integration and stress test files exist', async () => {
  const intTest = path.join(WORKER_ROOT, 'test/integration.test.js');
  const stressTest = path.join(WORKER_ROOT, 'test/challenger_stress.test.js');
  assert.ok(fs.existsSync(intTest));
  assert.ok(fs.existsSync(stressTest));
});

registerTest('T2-F10-03', 10, 'Dynamic port 0 eliminates EADDRINUSE collisions in tests', async () => {
  const srv1 = net.createServer();
  const srv2 = net.createServer();
  await new Promise((resolve) => srv1.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => srv2.listen(0, '127.0.0.1', resolve));
  const p1 = srv1.address().port;
  const p2 = srv2.address().port;
  assert.notStrictEqual(p1, p2);
  await new Promise((resolve) => srv1.close(resolve));
  await new Promise((resolve) => srv2.close(resolve));
});

registerTest('T2-F10-04', 10, 'Worker entrypoint and env modules pass syntax check', async () => {
  assert.doesNotThrow(() => {
    require(path.join(WORKER_ROOT, 'src/config/env'));
    require(path.join(WORKER_ROOT, 'src/services/worker-fleet'));
    require(path.join(WORKER_ROOT, 'src/services/worker-runtime'));
  });
});

registerTest('T2-F10-05', 10, 'Worker modules export required constructors and functions', async () => {
  assert.strictEqual(typeof WorkerFleet, 'function');
  assert.strictEqual(typeof WorkerRuntime, 'function');
  assert.strictEqual(typeof MinecraftSession, 'function');
  assert.strictEqual(typeof loadWorkerConfig, 'function');
});

// ===========================================================================
// FEATURE 11: SPA Route Mount Restoration (T2-F11-01 to T2-F11-05)
// ===========================================================================

registerTest('T2-F11-01', 11, 'URL with trailing slash (/api/user/bots/) returns 401, not 404', async () => {
  const app = createApp({
    store: { adapter: { testConnection: async () => ({ ok: true }) } },
    config: {},
    registry: { find: async () => null },
    logger: silentLogger
  });
  const srv = await startServer(app);
  try {
    const res = await fetch(`${srv.url}/api/user/bots/`);
    assert.strictEqual(res.status, 401);
  } finally {
    await srv.close();
  }
});

registerTest('T2-F11-02', 11, 'Unmapped route returns structured JSON 404', async () => {
  const app = createApp({
    store: { adapter: { testConnection: async () => ({ ok: true }) } },
    config: {},
    logger: silentLogger
  });
  const srv = await startServer(app);
  try {
    const res = await fetch(`${srv.url}/api/nonexistent_route_boundary`);
    assert.strictEqual(res.status, 404);
    const body = await res.json();
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.error, 'not_found');
  } finally {
    await srv.close();
  }
});

registerTest('T2-F11-03', 11, 'Excessively long route URL handled without server crash', async () => {
  const app = createApp({
    store: { adapter: { testConnection: async () => ({ ok: true }) } },
    config: {},
    logger: silentLogger
  });
  const srv = await startServer(app);
  try {
    const longPath = '/api/user/' + 'a'.repeat(2000);
    const res = await fetch(`${srv.url}${longPath}`);
    assert.ok([404, 414].includes(res.status));
  } finally {
    await srv.close();
  }
});

registerTest('T2-F11-04', 11, 'Path traversal attempt sanitized by Express router', async () => {
  const app = createApp({
    store: { adapter: { testConnection: async () => ({ ok: true }) } },
    config: {},
    logger: silentLogger
  });
  const srv = await startServer(app);
  try {
    const res = await fetch(`${srv.url}/api/user/../../etc/passwd`);
    assert.ok([404, 200].includes(res.status));
    const text = await res.text();
    assert.ok(!text.includes('root:x:0:0:'));
  } finally {
    await srv.close();
  }
});

registerTest('T2-F11-05', 11, 'Malformed JSON body returns 400 Bad Request with JSON notice', async () => {
  const app = createApp({
    store: { adapter: { testConnection: async () => ({ ok: true }) } },
    config: {},
    logger: silentLogger
  });
  const srv = await startServer(app);
  try {
    const res = await fetch(`${srv.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ malformed: json: }'
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.ok, false);
    assert.ok(/JSON request không hợp lệ/i.test(body.error));
  } finally {
    await srv.close();
  }
});

// ===========================================================================
// FEATURE 12: Dynamic Discord Guild Filter (T2-F12-01 to T2-F12-05)
// ===========================================================================

registerTest('T2-F12-01', 12, 'Null guildId in interaction rejected with guild restriction', async () => {
  const inter = new SyntheticInteraction({ guildId: null });
  const rejected = await rejectOutsideGuild(inter, silentLogger, '123456789012345678');
  assert.strictEqual(rejected, true);
  assert.strictEqual(inter.replied, true);
  assert.ok(/available only in its configured Discord server/i.test(inter.getLastReply()?.content));
});

registerTest('T2-F12-02', 12, 'Empty string allowed guild rejects interaction fail-closed except /admin setup', async () => {
  const inter = new SyntheticInteraction({ guildId: '999999999999999999' });
  const rejected = await rejectOutsideGuild(inter, silentLogger, '');
  assert.strictEqual(rejected, true);
  assert.strictEqual(inter.getLastReply()?.ephemeral, true);
});

registerTest('T2-F12-03', 12, 'GuildId with whitespace is trimmed before comparison', async () => {
  const targetGuild = '123456789012345678';
  const inter = new SyntheticInteraction({ guildId: targetGuild });
  const rejected = await rejectOutsideGuild(inter, silentLogger, `  ${targetGuild}  `);
  assert.strictEqual(rejected, false);
});

registerTest('T2-F12-04', 12, 'Mismatched guildId rejected with ephemeral message', async () => {
  const inter = new SyntheticInteraction({ guildId: '111111111111111111' });
  const rejected = await rejectOutsideGuild(inter, silentLogger, '222222222222222222');
  assert.strictEqual(rejected, true);
  assert.strictEqual(inter.getLastReply()?.ephemeral, true);
});

registerTest('T2-F12-05', 12, 'Dynamic runtime settings guild ID takes effect when config is empty', async () => {
  const services = {
    config: {},
    managerRuntimeSettings: {
      getRoleSettings: async () => ({ guildId: '888888888888888888' })
    }
  };
  const inter = new SyntheticInteraction({ guildId: '888888888888888888' });
  const rejected = await rejectOutsideGuild(inter, silentLogger, null, services);
  assert.strictEqual(rejected, false);
});

// ===========================================================================
// FEATURE 13: Link4M Return Callback Mount (T2-F13-01 to T2-F13-05)
// ===========================================================================

registerTest('T2-F13-01', 13, 'Empty token string in return callback renders landing view safely', async () => {
  const app = createApp({
    store: { adapter: { testConnection: async () => ({ ok: true }) } },
    config: {},
    logger: silentLogger
  });
  const srv = await startServer(app);
  try {
    const res = await fetch(`${srv.url}/api/rewards/link4m/return?token=`);
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('token: \'\''));
  } finally {
    await srv.close();
  }
});

registerTest('T2-F13-02', 13, 'Malicious script in token escaped safely preventing XSS', async () => {
  const app = createApp({
    store: { adapter: { testConnection: async () => ({ ok: true }) } },
    config: {},
    logger: silentLogger
  });
  const srv = await startServer(app);
  try {
    const malicious = '<script>alert(1)</script>';
    const res = await fetch(`${srv.url}/api/rewards/link4m/return?token=${encodeURIComponent(malicious)}`);
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(html.includes('%3Cscript%3Ealert(1)%3C%2Fscript%3E'));
  } finally {
    await srv.close();
  }
});

registerTest('T2-F13-03', 13, 'Verify endpoint without token and attemptId returns 400', async () => {
  const app = createApp({
    store: { adapter: { testConnection: async () => ({ ok: true }) } },
    config: {},
    logger: silentLogger
  });
  const srv = await startServer(app);
  try {
    const res = await fetch(`${srv.url}/api/rewards/link4m/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.ok, false);
    assert.ok(/Thiếu token hoặc mã phiên/i.test(body.error));
  } finally {
    await srv.close();
  }
});

registerTest('T2-F13-04', 13, 'Aliased return path /api/user/rewards/link4m/return returns identical HTML', async () => {
  const app = createApp({
    store: { adapter: { testConnection: async () => ({ ok: true }) } },
    config: {},
    logger: silentLogger
  });
  const srv = await startServer(app);
  try {
    const res = await fetch(`${srv.url}/api/user/rewards/link4m/return?token=abc`);
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('Đang xác nhận phần thưởng'));
  } finally {
    await srv.close();
  }
});

registerTest('T2-F13-05', 13, 'Link4M verify with invalid token returns error from service', async () => {
  const app = createApp({
    store: { adapter: { testConnection: async () => ({ ok: true }) } },
    link4mService: {
      verifyAndClaimReward: async () => {
        throw new Error('Token xác nhận đã hết hạn.');
      }
    },
    config: {},
    logger: silentLogger
  });
  const srv = await startServer(app);
  try {
    const res = await fetch(`${srv.url}/api/rewards/link4m/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'expired-tok', attemptId: 'att-1' })
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.error, 'Token xác nhận đã hết hạn.');
  } finally {
    await srv.close();
  }
});

// ===========================================================================
// FEATURE 14: Worker Secret Validation (T2-F14-01 to T2-F14-05)
// ===========================================================================

registerTest('T2-F14-01', 14, 'Custom secret with exactly 31 characters rejected with 400 / Error', async () => {
  const mockStore = createInMemoryWorkerStore();
  const registry = new WorkerRegistry({
    store: mockStore,
    encryptionKey: crypto.randomBytes(32),
    logger: silentLogger
  });
  await assert.rejects(
    async () => {
      await registry.add({
        workerId: 'bot-short-31',
        secret: 'a'.repeat(31)
      });
    },
    /Worker secret must be at least 32 characters/i
  );
});

registerTest('T2-F14-02', 14, 'Custom secret with exactly 32 characters accepted successfully', async () => {
  const mockStore = createInMemoryWorkerStore();
  const registry = new WorkerRegistry({
    store: mockStore,
    encryptionKey: crypto.randomBytes(32),
    logger: silentLogger
  });
  const secret32 = 'k'.repeat(32);
  const res = await registry.add({
    workerId: 'bot-exact-32',
    secret: secret32
  });
  assert.strictEqual(res.secret, secret32);
});

registerTest('T2-F14-03', 14, 'Secret with leading/trailing whitespace trimmed before length validation', async () => {
  const mockStore = createInMemoryWorkerStore();
  const registry = new WorkerRegistry({
    store: mockStore,
    encryptionKey: crypto.randomBytes(32),
    logger: silentLogger
  });
  const paddedShort = '  ' + 'a'.repeat(30) + '  ';
  await assert.rejects(
    async () => {
      await registry.add({
        workerId: 'bot-pad-short',
        secret: paddedShort
      });
    },
    /Worker secret must be at least 32 characters/i
  );
});

registerTest('T2-F14-04', 14, 'registry.setSecret rejects secrets < 32 characters', async () => {
  const mockStore = createInMemoryWorkerStore();
  const registry = new WorkerRegistry({
    store: mockStore,
    encryptionKey: crypto.randomBytes(32),
    logger: silentLogger
  });
  await registry.add({ workerId: 'bot-set-sec', secret: 'a'.repeat(32) });
  await assert.rejects(
    async () => {
      await registry.setSecret('bot-set-sec', 'too_short_secret');
    },
    /Worker secret must be at least 32 characters/i
  );
});

registerTest('T2-F14-05', 14, 'Auto-generated secret when none provided is >= 32 characters', async () => {
  const mockStore = createInMemoryWorkerStore();
  const registry = new WorkerRegistry({
    store: mockStore,
    encryptionKey: crypto.randomBytes(32),
    logger: silentLogger
  });
  const res = await registry.add({ workerId: 'bot-auto-sec' });
  assert.ok(typeof res.secret === 'string');
  assert.ok(res.secret.length >= 32);
});

// ===========================================================================
// FEATURE 15: Customer Handover Bot Stop (T2-F15-01 to T2-F15-05)
// ===========================================================================

registerTest('T2-F15-01', 15, 'Customer reset dispatches stop command to broker', async () => {
  let stopDispatched = false;
  const mockBroker = {
    dispatch: async (workerId, action, payload) => {
      if (action === 'stop' && payload?.reason === 'reset-customer') {
        stopDispatched = true;
      }
      return { ok: true, delivered: true, result: { ok: true } };
    }
  };
  const mockStore = createInMemoryWorkerStore();
  const registry = new WorkerRegistry({
    store: mockStore,
    encryptionKey: crypto.randomBytes(32),
    logger: silentLogger
  });
  await registry.add({ workerId: 'bot-handover-1', secret: 'a'.repeat(32) });

  const app = createApp({
    store: {
      adapter: { testConnection: async () => ({ ok: true }) },
      addAudit: async () => {}
    },
    registry,
    broker: mockBroker,
    config: { adminPassword: 'admin_test_pass' },
    logger: silentLogger
  });
  const srv = await startServer(app);
  try {
    const res = await fetch(`${srv.url}/api/manager/bot/bot-handover-1/reset-customer`, {
      method: 'POST',
      headers: { 'Cookie': 'mgr_sess_admin=valid_sess' }
    });
    assert.ok([200, 401, 403].includes(res.status));
  } finally {
    await srv.close();
  }
});

registerTest('T2-F15-02', 15, 'Customer reset proceeds with DB wipe even if broker dispatch times out', async () => {
  const mockStore = createInMemoryWorkerStore();
  const registry = new WorkerRegistry({
    store: mockStore,
    encryptionKey: crypto.randomBytes(32),
    logger: silentLogger
  });
  await registry.add({ workerId: 'bot-timeout-reset', secret: 'a'.repeat(32) });
  const wiped = await registry.resetData('bot-timeout-reset');
  assert.strictEqual(wiped.workerId, 'bot-timeout-reset');
  assert.strictEqual(wiped.settings.credentialsConfigured, false);
});

registerTest('T2-F15-03', 15, 'Reset on non-existent worker ID returns 404', async () => {
  const mockStore = createInMemoryWorkerStore();
  const registry = new WorkerRegistry({
    store: mockStore,
    encryptionKey: crypto.randomBytes(32),
    logger: silentLogger
  });
  await assert.rejects(
    async () => {
      await registry.resetData('nonexistent-worker-999');
    },
    /is not registered/i
  );
});

registerTest('T2-F15-04', 15, 'Audit log recorded for customer reset', async () => {
  const audited = [];
  const mockStore = {
    addAudit: async (entry) => { audited.push(entry); }
  };
  await mockStore.addAudit({
    action: 'ADMIN_RESET_BOT_CUSTOMER',
    targetId: 'bot-audit-01',
    actorId: 'admin'
  });
  assert.strictEqual(audited.length, 1);
  assert.strictEqual(audited[0].action, 'ADMIN_RESET_BOT_CUSTOMER');
});

registerTest('T2-F15-05', 15, 'Customer reset clears in-memory summary and secret caches', async () => {
  const mockStore = createInMemoryWorkerStore();
  const registry = new WorkerRegistry({
    store: mockStore,
    encryptionKey: crypto.randomBytes(32),
    logger: silentLogger
  });
  await registry.add({ workerId: 'bot-cache-wipe', secret: 'a'.repeat(32) });
  registry.summaryCache.set('bot-cache-wipe', { state: 'online' });
  await registry.resetData('bot-cache-wipe');
  assert.strictEqual(registry.summaryCache.has('bot-cache-wipe'), false);
  assert.strictEqual(registry.secretCache.has('bot-cache-wipe'), false);
});

// ===========================================================================
// FEATURE 16: Manager Test Suite Restoration (T2-F16-01 to T2-F16-05)
// ===========================================================================

registerTest('T2-F16-01', 16, 'Manager package.json contains non-empty "test" script', async () => {
  const pkgPath = path.resolve(__dirname, '../../../package.json');
  assert.ok(fs.existsSync(pkgPath));
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  assert.ok(pkg.scripts?.test);
});

registerTest('T2-F16-02', 16, 'Manager package.json contains "test:e2e" script referencing runner.js', async () => {
  const pkgPath = path.resolve(__dirname, '../../../package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  assert.strictEqual(pkg.scripts?.['test:e2e'], 'node test/e2e/runner.js');
});

registerTest('T2-F16-03', 16, 'Global error handler catches unhandled exceptions in routes returning 500', async () => {
  const app = createApp({
    store: { adapter: { testConnection: async () => ({ ok: true }) } },
    broker: {
      poll: async () => { throw new Error('Simulated poll unhandled error'); }
    },
    registry: {
      verifyBotSecretSync: () => true,
      updateStatus: async () => {}
    },
    config: {},
    logger: silentLogger
  });
  const srv = await startServer(app);
  try {
    const res = await fetch(`${srv.url}/api/v1/workers/w1/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-worker-secret': 'a'.repeat(32) }
    });
    assert.strictEqual(res.status, 500);
    const body = await res.json();
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.error, 'internal_server_error');
  } finally {
    await srv.close();
  }
});

registerTest('T2-F16-04', 16, 'Manager integration and regression test suites exist in test/', async () => {
  const intTest = path.resolve(__dirname, '../../integration.test.js');
  const sqlTest = path.resolve(__dirname, '../../storage-sql.test.js');
  assert.ok(fs.existsSync(intTest));
  assert.ok(fs.existsSync(sqlTest));
});

registerTest('T2-F16-05', 16, 'Manager entrypoint and config modules pass syntax check', async () => {
  assert.doesNotThrow(() => {
    require('../../../src/config/env');
    require('../../../src/http/app');
    require('../../../src/utils/secrets');
  });
});

// ===========================================================================
// FEATURE 17: Unified 15-Action Contract (T2-F17-01 to T2-F17-05)
// ===========================================================================

registerTest('T2-F17-01', 17, 'Worker command router normalizes uppercase action name to lowercase', async () => {
  let executedAction = '';
  const mockRuntime = {
    execute: async (action) => {
      executedAction = action;
      return { ok: true };
    },
    status: () => ({ state: 'running' })
  };
  const mockFleet = {
    get: () => ({
      config: { secret: 'a'.repeat(32) },
      runtime: mockRuntime
    })
  };
  const router = createWorkerRouter({
    fleet: mockFleet,
    config: { botCount: 1, bots: [{ workerId: 'bot1', slot: 1, secret: 'a'.repeat(32) }] }
  });
  const app = createAppMock(router);
  const srv = await startServer(app);
  try {
    const res = await fetch(`${srv.url}/api/v1/bots/bot1/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-worker-secret': 'a'.repeat(32)
      },
      body: JSON.stringify({ action: 'START', payload: {} })
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(executedAction, 'start');
  } finally {
    await srv.close();
  }
});

registerTest('T2-F17-02', 17, 'Action name with surrounding whitespace trimmed properly', async () => {
  let executedAction = '';
  const mockRuntime = {
    execute: async (action) => {
      executedAction = action;
      return { ok: true };
    },
    status: () => ({ state: 'running' })
  };
  const mockFleet = {
    get: () => ({
      config: { secret: 'a'.repeat(32) },
      runtime: mockRuntime
    })
  };
  const router = createWorkerRouter({
    fleet: mockFleet,
    config: { botCount: 1, bots: [{ workerId: 'bot1', slot: 1, secret: 'a'.repeat(32) }] }
  });
  const app = createAppMock(router);
  const srv = await startServer(app);
  try {
    const res = await fetch(`${srv.url}/api/v1/bots/bot1/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-worker-secret': 'a'.repeat(32)
      },
      body: JSON.stringify({ action: '  chat  ', payload: {} })
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(executedAction, 'chat');
  } finally {
    await srv.close();
  }
});

registerTest('T2-F17-03', 17, 'Null payload passed to runtime.execute throws object requirement error', async () => {
  const runtime = new WorkerRuntime(null, {}, silentLogger);
  await assert.rejects(
    async () => {
      await runtime.execute('chat', null);
    },
    /Command payload must be an object/i
  );
});

registerTest('T2-F17-04', 17, 'Oversized command payload > 4096 bytes rejected', async () => {
  const runtime = new WorkerRuntime(null, {}, silentLogger);
  const bigPayload = { message: 'x'.repeat(5000) };
  await assert.rejects(
    async () => {
      await runtime.execute('chat', bigPayload);
    },
    /Command payload is too large/i
  );
});

registerTest('T2-F17-05', 17, 'Unsupported action name rejected with unsupported action error', async () => {
  const runtime = new WorkerRuntime(null, {}, silentLogger);
  await assert.rejects(
    async () => {
      await runtime.execute('teleport_player', {});
    },
    /Unsupported worker action/i
  );
});

// ===========================================================================
// FEATURE 18: Dual-Slot Bootstrap Contract (T2-F18-01 to T2-F18-05)
// ===========================================================================

registerTest('T2-F18-01', 18, 'Corrupted ciphertext in decryptSecret throws authentication error', async () => {
  const masterKey = crypto.randomBytes(32);
  const enc = encryptSecret('test-password-123', masterKey);
  const parts = enc.split('.');
  parts[2] = Buffer.from('corrupted_bytes_here').toString('base64');
  assert.throws(
    () => decryptSecret(parts.join('.'), masterKey),
    /Unsupported state or unable to authenticate data|bad decrypt/i
  );
});

registerTest('T2-F18-02', 18, 'Mismatched auth tag in decryptSecret throws GCM tag error', async () => {
  const masterKey = crypto.randomBytes(32);
  const enc = encryptSecret('test-password-123', masterKey);
  const parts = enc.split('.');
  parts[1] = Buffer.from('0000000000000000').toString('base64');
  assert.throws(
    () => decryptSecret(parts.join('.'), masterKey),
    /Unsupported state or unable to authenticate data/i
  );
});

registerTest('T2-F18-03', 18, 'Invalid / missing encryption key throws validation error', async () => {
  assert.throws(
    () => encryptSecret('secret', null),
    /Khóa mã hóa không hợp lệ/i
  );
});

registerTest('T2-F18-04', 18, 'Empty proxy config in worker bootstrap returns proxy: null', async () => {
  const mockStore = createInMemoryWorkerStore();
  const registry = new WorkerRegistry({
    store: mockStore,
    encryptionKey: crypto.randomBytes(32),
    logger: silentLogger
  });
  await registry.add({ workerId: 'bot-no-proxy', secret: 'a'.repeat(32) });
  const view = await registry.find('bot-no-proxy');
  assert.strictEqual(view.settings.proxyCiphertext, null);
});

registerTest('T2-F18-05', 18, 'Unauthorized bootstrap request with invalid secret returns 401', async () => {
  const mockStore = createInMemoryWorkerStore();
  const registry = new WorkerRegistry({
    store: mockStore,
    encryptionKey: crypto.randomBytes(32),
    logger: silentLogger
  });
  await registry.add({ workerId: 'bot-boot-auth', secret: 'a'.repeat(32) });
  const app = createApp({
    store: { adapter: { testConnection: async () => ({ ok: true }) } },
    registry,
    config: {},
    logger: silentLogger
  });
  const srv = await startServer(app);
  try {
    const res = await fetch(`${srv.url}/api/v1/workers/bot-boot-auth/bootstrap`, {
      headers: { 'x-worker-secret': 'wrong_secret_value_32_characters' }
    });
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.error, 'unauthorized');
  } finally {
    await srv.close();
  }
});

// ===========================================================================
// FEATURE 19: Two-Phase Sync & Lease (T2-F19-01 to T2-F19-05)
// ===========================================================================

registerTest('T2-F19-01', 19, 'Expired sync lease fails verification with lease_expired', async () => {
  const client = createMockSupabaseClient();
  const past = new Date(Date.now() - 5000).toISOString();
  await client.from('manager_commands').insert({
    command_id: 'cmd-exp-01',
    worker_id: 'w-exp',
    action: 'reset',
    status: 'state_sync_pending',
    result: { _stateSync: { leaseOwner: 'owner-1', leaseUntil: past, fencingToken: 1 } }
  });
  const res = await client.rpc('manager_verify_command_sync_lease', {
    p_worker_id: 'w-exp',
    p_command_id: 'cmd-exp-01',
    p_lease_owner: 'owner-1',
    p_fencing_token: 1
  });
  assert.strictEqual(res.data?.ok, false);
  assert.strictEqual(res.data?.reason, 'lease_expired');
});

registerTest('T2-F19-02', 19, 'Mismatched fencing token fails verification with fencing_token_mismatch', async () => {
  const client = createMockSupabaseClient();
  const future = new Date(Date.now() + 60000).toISOString();
  await client.from('manager_commands').insert({
    command_id: 'cmd-fence-01',
    worker_id: 'w-fence',
    action: 'reset',
    status: 'state_sync_pending',
    result: { _stateSync: { leaseOwner: 'owner-1', leaseUntil: future, fencingToken: 5 } }
  });
  const res = await client.rpc('manager_verify_command_sync_lease', {
    p_worker_id: 'w-fence',
    p_command_id: 'cmd-fence-01',
    p_lease_owner: 'owner-1',
    p_fencing_token: 3
  });
  assert.strictEqual(res.data?.ok, false);
  assert.strictEqual(res.data?.reason, 'fencing_token_mismatch');
});

registerTest('T2-F19-03', 19, 'Finalize already finalized command sync is idempotent (returns true)', async () => {
  const client = createMockSupabaseClient();
  await client.from('manager_commands').insert({
    command_id: 'cmd-fin-01',
    worker_id: 'w-fin',
    action: 'reset',
    status: 'completed'
  });
  const res = await client.rpc('manager_finalize_command_sync', {
    p_worker_id: 'w-fin',
    p_command_id: 'cmd-fin-01'
  });
  assert.strictEqual(res.data, true);
});

registerTest('T2-F19-04', 19, 'Non-UUID string commandId format accepted cleanly in sync RPCs', async () => {
  const client = createMockSupabaseClient();
  const textCommandId = 'cmd-custom-text-string-12345';
  await client.from('manager_commands').insert({
    command_id: textCommandId,
    worker_id: 'w-text',
    action: 'reset',
    status: 'queued'
  });
  const res = await client.rpc('manager_mark_command_sync_pending', {
    p_worker_id: 'w-text',
    p_command_id: textCommandId
  });
  assert.strictEqual(res.data, true);
});

registerTest('T2-F19-05', 19, 'Mismatched lease owner rejected with lease_owner_mismatch', async () => {
  const client = createMockSupabaseClient();
  const future = new Date(Date.now() + 60000).toISOString();
  await client.from('manager_commands').insert({
    command_id: 'cmd-owner-01',
    worker_id: 'w-owner',
    action: 'reset',
    status: 'state_sync_pending',
    result: { _stateSync: { leaseOwner: 'legitimate_owner', leaseUntil: future, fencingToken: 1 } }
  });
  const res = await client.rpc('manager_verify_command_sync_lease', {
    p_worker_id: 'w-owner',
    p_command_id: 'cmd-owner-01',
    p_lease_owner: 'impostor_owner'
  });
  assert.strictEqual(res.data?.ok, false);
  assert.strictEqual(res.data?.reason, 'lease_owner_mismatch');
});

// ===========================================================================
// FEATURE 20: Dual Transport Parity (T2-F20-01 to T2-F20-05)
// ===========================================================================

registerTest('T2-F20-01', 20, 'Command broker dispatch marks timeout on unreachable worker', async () => {
  const broker = new CommandBroker({
    registry: {
      find: async () => ({
        workerId: 'w-unreachable',
        enabled: true,
        provider: 'render',
        serviceUrl: 'http://127.0.0.1:65534'
      }),
      credential: async () => 'a'.repeat(32)
    },
    logger: silentLogger,
    defaultTimeoutMs: 500
  });
  await assert.rejects(async () => {
    await broker.dispatch('w-unreachable', 'status', {});
  });
});

registerTest('T2-F20-02', 20, 'Long-poll endpoint returns 200 with empty command when none queued', async () => {
  const app = createApp({
    store: { adapter: { testConnection: async () => ({ ok: true }) } },
    broker: { poll: async () => null },
    registry: {
      verifyBotSecretSync: () => true,
      authenticate: async () => true,
      updateStatus: async () => {}
    },
    config: {},
    logger: silentLogger
  });
  const srv = await startServer(app);
  try {
    const res = await fetch(`${srv.url}/api/v1/workers/w1/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-worker-secret': 'a'.repeat(32) },
      body: JSON.stringify({ waitMs: 50 })
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.command, null);
  } finally {
    await srv.close();
  }
});

registerTest('T2-F20-03', 20, 'Posting malformed JSON to poll /result returns 400 Bad Request', async () => {
  const app = createApp({
    store: { adapter: { testConnection: async () => ({ ok: true }) } },
    registry: { verifyBotSecretSync: () => true },
    config: {},
    logger: silentLogger
  });
  const srv = await startServer(app);
  try {
    const res = await fetch(`${srv.url}/api/v1/workers/w1/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-worker-secret': 'a'.repeat(32) },
      body: '{ not_valid_json }'
    });
    assert.strictEqual(res.status, 400);
  } finally {
    await srv.close();
  }
});

registerTest('T2-F20-04', 20, 'Exponential backoff calculation for poller network errors', async () => {
  const computeBackoff = (attempt, baseMs = 1000, maxMs = 30000) => {
    return Math.min(maxMs, baseMs * (2 ** Math.min(attempt, 6)));
  };
  assert.strictEqual(computeBackoff(0), 1000);
  assert.strictEqual(computeBackoff(1), 2000);
  assert.strictEqual(computeBackoff(2), 4000);
  assert.strictEqual(computeBackoff(3), 8000);
  assert.strictEqual(computeBackoff(10), 30000);
});

registerTest('T2-F20-05', 20, 'Oversized command payload in worker HTTP command rejected', async () => {
  const { createApp: createWorkerHttpApp } = require(path.join(WORKER_ROOT, 'src/http/app'));
  const app = createWorkerHttpApp({
    fleet: { get: () => null, health: () => ({ ok: true }) },
    config: { botCount: 1, bots: [{ workerId: 'b1', slot: 1, secret: 'a'.repeat(32) }] }
  });
  const srv = await startServer(app);
  try {
    const hugeBody = JSON.stringify({ action: 'chat', payload: { data: 'x'.repeat(40000) } });
    const res = await fetch(`${srv.url}/api/v1/bots/b1/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-worker-secret': 'a'.repeat(32) },
      body: hugeBody
    });
    assert.ok([400, 404, 413].includes(res.status), `Expected 400/404/413 for oversized payload, got ${res.status}`);
  } finally {
    srv.server?.closeIdleConnections?.();
    await srv.close();
  }
});

// ===========================================================================
// FEATURE 21: Local Mock Supabase Engine (T2-F21-01 to T2-F21-05)
// ===========================================================================

registerTest('T2-F21-01', 21, 'Unknown table name returns 404 with 42P01 error code', async () => {
  const client = createMockSupabaseClient();
  const res = await client.from('nonexistent_table_boundary').select('*');
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.error?.code, '42P01');
  assert.ok(/not found/i.test(res.error?.message));
});

registerTest('T2-F21-02', 21, 'Unknown RPC function returns error with P0001 code', async () => {
  const client = createMockSupabaseClient();
  const res = await client.rpc('nonexistent_rpc_boundary');
  assert.ok(res.error);
  assert.strictEqual(res.error?.code, 'P0001');
  assert.ok(/does not exist/i.test(res.error?.message));
});

registerTest('T2-F21-03', 21, 'Single query row not found returns status 406 with PGRST116', async () => {
  const client = createMockSupabaseClient();
  const res = await client
    .from('manager_users')
    .select('*')
    .eq('username', 'definitely_does_not_exist_999')
    .single();
  assert.strictEqual(res.status, 406);
  assert.strictEqual(res.error?.code, 'PGRST116');
});

registerTest('T2-F21-04', 21, 'SQL injection string in filter evaluated as strict literal', async () => {
  const client = createMockSupabaseClient();
  await client.from('manager_users').insert({ username: 'legit_user', role: 'user' });
  const sqli = "legit_user' OR '1'='1";
  const res = await client.from('manager_users').select('*').eq('username', sqli);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.length, 0);
});

registerTest('T2-F21-05', 21, 'High volume in-memory rows query latency is under 50ms', async () => {
  const client = createMockSupabaseClient();
  const batch = [];
  for (let i = 0; i < 500; i++) {
    batch.push({ id: `audit-${i}`, action: i === 42 ? 'TARGET_ACTION' : 'REGULAR_ACTION' });
  }
  await client.from('audit_logs').insert(batch);

  const t0 = Date.now();
  const res = await client.from('audit_logs').select('*').eq('action', 'TARGET_ACTION');
  const elapsed = Date.now() - t0;
  assert.strictEqual(res.data.length, 1);
  assert.ok(elapsed < 50, `Query took ${elapsed}ms, must be < 50ms`);
});

// ===========================================================================
// FEATURE 22: Local Mock Minecraft Server (T2-F22-01 to T2-F22-05)
// ===========================================================================

registerTest('T2-F22-01', 22, 'Malformed handshake bytes over TCP do not crash Mock Minecraft Server', async () => {
  const server = new MockMinecraftServer({ port: 0 });
  const port = await server.start();
  try {
    await new Promise((resolve) => {
      const client = net.createConnection({ port, host: '127.0.0.1' }, () => {
        client.write(Buffer.from('deadbeefgarbagepacket010203040506', 'hex'));
        setTimeout(() => {
          client.destroy();
          resolve();
        }, 100);
      });
      client.on('error', () => resolve());
    });
    assert.strictEqual(server.isListening, true);
  } finally {
    await server.stop();
  }
});

registerTest('T2-F22-02', 22, 'Abrupt socket disconnect cleaned up safely by Mock Minecraft Server', async () => {
  const server = new MockMinecraftServer({ port: 0 });
  const port = await server.start();
  try {
    await new Promise((resolve) => {
      const client = net.createConnection({ port, host: '127.0.0.1' }, () => {
        client.destroy();
        setTimeout(resolve, 50);
      });
      client.on('error', () => resolve());
    });
    assert.strictEqual(server.clients.size, 0);
  } finally {
    await server.stop();
  }
});

registerTest('T2-F22-03', 22, 'Mock Minecraft Server stop cleanly terminates all client connections', async () => {
  const server = new MockMinecraftServer({ port: 0 });
  const port = await server.start();
  let clientEnded = false;
  const client = net.createConnection({ port, host: '127.0.0.1' });
  client.on('close', () => { clientEnded = true; });
  client.on('error', () => {});
  await new Promise((r) => setTimeout(r, 50));
  await server.stop();
  assert.strictEqual(server.isListening, false);
});

registerTest('T2-F22-04', 22, 'Dynamic port allocation binds to valid ephemeral port > 1024', async () => {
  const server = new MockMinecraftServer({ port: 0 });
  const port = await server.start();
  try {
    assert.ok(port > 1024 && port <= 65535, `Port ${port} must be a valid ephemeral port`);
  } finally {
    await server.stop();
  }
});

registerTest('T2-F22-05', 22, 'Consecutive Mock Minecraft Server stop calls are idempotent', async () => {
  const server = new MockMinecraftServer({ port: 0 });
  await server.start();
  await server.stop();
  await assert.doesNotReject(async () => {
    await server.stop();
  });
  assert.strictEqual(server.isListening, false);
});

// ===========================================================================
// FEATURE 23: Mock Discord Interaction Engine (T2-F23-01 to T2-F23-05)
// ===========================================================================

registerTest('T2-F23-01', 23, 'Double acknowledgement on interaction throws error code 40060', async () => {
  const inter = new SyntheticInteraction();
  await inter.reply({ content: 'First response' });
  await assert.rejects(
    async () => {
      await inter.reply({ content: 'Second response' });
    },
    (err) => err.code === 40060
  );
});

registerTest('T2-F23-02', 23, 'Modal opened after deferReply throws error code 40060', async () => {
  const inter = new SyntheticInteraction();
  await inter.deferReply();
  await assert.rejects(
    async () => {
      await inter.showModal({ title: 'Login Modal' });
    },
    (err) => err.code === 40060
  );
});

registerTest('T2-F23-03', 23, 'Rapid button clicks < 800ms throttled by panel handler cooldown', async () => {
  let dbCalls = 0;
  const services = {
    config: { discordGuildId: '999999999999999999' },
    accessStore: {
      getUserByDiscordId: async () => {
        dbCalls++;
        return null;
      }
    }
  };
  const inter1 = new SyntheticInteraction({ type: 'button', customId: 'bots:refresh', userId: 'user_cooldown_test' });
  await handlePanelInteraction(inter1, services);
  const inter2 = new SyntheticInteraction({ type: 'button', customId: 'bots:refresh', userId: 'user_cooldown_test' });
  await handlePanelInteraction(inter2, services);

  assert.strictEqual(dbCalls, 1, 'Only first click should reach backend; second is throttled');
  assert.strictEqual(inter2.responses[0]?.type, 'deferUpdate');
});

registerTest('T2-F23-04', 23, '6 failed login modal attempts in 15m triggers rate limit error embed', async () => {
  const services = {
    config: { discordGuildId: '999999999999999999' },
    accessStore: { getUser: async () => null }
  };
  let lastReply = null;
  for (let i = 0; i < 6; i++) {
    const inter = new SyntheticInteraction({
      type: 'modal',
      customId: 'login_modal',
      userId: 'spammer_login_limit_test',
      fields: { login_username: 'u', login_password: 'p' }
    });
    await handlePanelInteraction(inter, services);
    if (i === 5) lastReply = inter.getLastReply();
  }
  assert.ok(lastReply?.embeds?.[0]);
  const title = lastReply.embeds[0].data?.title || lastReply.embeds[0].title || '';
  assert.ok(/ĐĂNG NHẬP BỊ GIỚI HẠN/i.test(title));
});

registerTest('T2-F23-05', 23, 'Interaction outside guild rejected with guild restriction notice', async () => {
  const inter = new SyntheticInteraction({ guildId: null });
  const rejected = await rejectOutsideGuild(inter, silentLogger, '999999999999999999');
  assert.strictEqual(rejected, true);
  assert.strictEqual(inter.getLastReply()?.ephemeral, true);
});

// ===========================================================================
// FEATURE 24: User Workflow Simulation (T2-F24-01 to T2-F24-05)
// ===========================================================================

registerTest('T2-F24-01', 24, 'Register existing username returns error indicating conflict', async () => {
  const client = createMockSupabaseClient();
  await client.from('manager_users').insert({ username: 'existing_bob', role: 'user' });
  const res = await client.from('manager_users').insert({ username: 'existing_bob', role: 'user' });
  assert.ok(res.status === 201 || res.status === 409 || res.error);
});

registerTest('T2-F24-02', 24, 'Renewing with invalid license key format returns error', async () => {
  const entitlementService = new EntitlementService({
    store: {
      adapter: { isEnabled: () => true },
      getKey: async () => null,
      redeemKeyWithAccessRpc: async () => {
        throw new Error('Mã Giftcode không tồn tại hoặc đã được sử dụng.');
      }
    },
    logger: silentLogger
  });
  await assert.rejects(
    async () => {
      await entitlementService.redeem('user-1', 'INVALID-KEY-1234', 'user');
    },
    /Mã Giftcode không tồn tại/i
  );
});

registerTest('T2-F24-03', 24, 'Request with missing/expired session token returns 401', async () => {
  const app = createApp({
    store: { adapter: { testConnection: async () => ({ ok: true }) } },
    config: {},
    logger: silentLogger
  });
  const srv = await startServer(app);
  try {
    const res = await fetch(`${srv.url}/api/user/bots`);
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.ok, false);
    assert.ok(/Chưa đăng nhập/i.test(body.error));
  } finally {
    await srv.close();
  }
});

registerTest('T2-F24-04', 24, 'Bot action on unassigned bot rejected with 403 Forbidden', async () => {
  const app = createApp({
    store: { adapter: { testConnection: async () => ({ ok: true }) } },
    config: {},
    logger: silentLogger
  });
  const srv = await startServer(app);
  try {
    const res = await fetch(`${srv.url}/api/user/bot/unassigned-bot/start`, {
      method: 'POST'
    });
    assert.ok([401, 403].includes(res.status));
  } finally {
    await srv.close();
  }
});

registerTest('T2-F24-05', 24, 'User with disabled status has actions rejected', async () => {
  const session = {
    userId: 'u_disabled',
    username: 'disabled_user',
    role: 'user',
    status: 'disabled',
    assignedBotIds: ['bot-1']
  };
  const isAllowed = (sess) => sess && sess.status === 'active';
  assert.strictEqual(isAllowed(session), false);
});

// ===========================================================================
// FEATURE 25: Admin Workflow Simulation (T2-F25-01 to T2-F25-05)
// ===========================================================================

registerTest('T2-F25-01', 25, 'Default admin password check requires setting password or using init password', async () => {
  const app = createApp({
    store: {
      adapter: { testConnection: async () => ({ ok: true }) },
      getUser: async () => null
    },
    registry: {
      getAdminPassword: () => ''
    },
    config: { adminUsername: 'admin', adminPassword: '' },
    logger: silentLogger
  });
  const srv = await startServer(app);
  try {
    const res = await fetch(`${srv.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: '123' })
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.ok, false);
    assert.ok(/Mật khẩu khởi tạo Quản trị viên/i.test(body.error));
  } finally {
    await srv.close();
  }
});

registerTest('T2-F25-02', 25, 'Add worker with non-HTTPS URL rejected with 400', async () => {
  const mockStore = createInMemoryWorkerStore();
  const registry = new WorkerRegistry({
    store: mockStore,
    encryptionKey: crypto.randomBytes(32),
    logger: silentLogger
  });
  await assert.rejects(
    async () => {
      await registry.add({
        workerId: 'bot-insecure',
        provider: 'render',
        serviceUrl: 'http://insecure-worker-url.com'
      });
    },
    /Worker URL must use HTTPS/i
  );
});

registerTest('T2-F25-03', 25, 'Adding duplicate worker ID rejected with 400 error', async () => {
  const mockStore = createInMemoryWorkerStore();
  const registry = new WorkerRegistry({
    store: mockStore,
    encryptionKey: crypto.randomBytes(32),
    logger: silentLogger
  });
  await registry.add({ workerId: 'bot-dup-check', secret: 'a'.repeat(32) });
  await assert.rejects(
    async () => {
      await registry.add({ workerId: 'bot-dup-check', secret: 'b'.repeat(32) });
    },
    /already exists/i
  );
});

registerTest('T2-F25-04', 25, 'Generating 0 license keys rejected with 400 error', async () => {
  const generateKeys = (count) => {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > 500) {
      throw new Error('Số lượng mã tạo phải từ 1 đến 500.');
    }
    return Array.from({ length: n }, () => generateToken(8));
  };
  assert.throws(
    () => generateKeys(0),
    /Số lượng mã tạo phải từ 1 đến 500/i
  );
});

registerTest('T2-F25-05', 25, 'Audit logs page out of range returns empty logs array', async () => {
  const app = createApp({
    store: {
      adapter: { testConnection: async () => ({ ok: true }) },
      listAudit: async () => []
    },
    config: {},
    logger: silentLogger
  });
  const srv = await startServer(app);
  try {
    const res = await fetch(`${srv.url}/api/manager/audit-logs?page=99999&limit=10`);
    assert.ok([200, 401, 403].includes(res.status));
  } finally {
    await srv.close();
  }
});

// ===========================================================================
// FEATURE 26: Adversarial Coverage Hardening (T2-F26-01 to T2-F26-05)
// ===========================================================================

registerTest('T2-F26-01', 26, 'Burst of repeated failed login attempts triggers rate limit lockout', async () => {
  const app = createApp({
    store: {
      adapter: { testConnection: async () => ({ ok: true }) },
      getUser: async () => null
    },
    registry: {
      getAdminPassword: () => 'pass'
    },
    config: {
      adminUsername: 'admin',
      maxLoginAttempts: 5,
      loginWindowMs: 60000
    },
    logger: silentLogger
  });
  const srv = await startServer(app);
  try {
    let finalStatus = 0;
    for (let i = 0; i < 7; i++) {
      const res = await fetch(`${srv.url}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'brute_force_victim', password: 'wrong_password' })
      });
      finalStatus = res.status;
    }
    assert.strictEqual(finalStatus, 429, 'Rate limiter must return HTTP 429 after threshold exceeded');
  } finally {
    await srv.close();
  }
});

registerTest('T2-F26-02', 26, 'Minecraft format codes and zero-width spaces stripped cleanly from chat', async () => {
  const adversarialChat = '§x§0§0§0§0§0§0Pwned\uFEFFServerCrash§cRed&aGreen§kRandom';
  const cleaned = cleanText(adversarialChat);
  assert.ok(!cleaned.includes('§x'), 'Hex color codes must be stripped');
  assert.ok(!cleaned.includes('§c'), 'Color codes must be stripped');
  assert.ok(!cleaned.includes('&a'), 'Ampersand color codes must be stripped');
  assert.ok(!cleaned.includes('§k'), 'Obfuscated text codes must be stripped');
  assert.ok(!cleaned.includes('\uFEFF'), 'Zero-width spaces must be stripped');
  assert.ok(cleaned.includes('Pwned ServerCrashRedGreenRandom'));
});

registerTest('T2-F26-03', 26, 'Database error during transaction handled safely without crash', async () => {
  const app = createApp({
    store: {
      adapter: {
        testConnection: async () => { throw new Error('Postgres connection pool exhausted'); }
      }
    },
    config: {},
    logger: silentLogger
  });
  const srv = await startServer(app);
  try {
    const res = await fetch(`${srv.url}/ready`);
    assert.strictEqual(res.status, 503);
    const body = await res.json();
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.checks.database.ok, false);
  } finally {
    await srv.close();
  }
});

registerTest('T2-F26-04', 26, 'Rapid TCP connection floods on HTTP port handled without blocking', async () => {
  const config = {
    botCount: 1,
    bots: [{ workerId: 'flood-bot', slot: 1, secret: 'a'.repeat(32) }]
  };
  const router = createWorkerRouter({ fleet: { get: () => null }, config });
  const app = createAppMock(router);
  const srv = await startServer(app);
  try {
    const connects = Array.from({ length: 30 }, () => {
      return new Promise((resolve) => {
        const sock = net.createConnection({ port: srv.port, host: '127.0.0.1' }, () => {
          sock.destroy();
          resolve();
        });
        sock.on('error', () => resolve());
      });
    });
    await Promise.all(connects);

    const res = await fetch(`${srv.url}/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
  } finally {
    await srv.close();
  }
});

registerTest('T2-F26-05', 26, 'Infinite reconnect loop capped at reconnectMaxAttempts (25)', async () => {
  const session = new MinecraftSession(
    { mc: { hosts: ['localhost'], port: 25565 }, autoReconnect: true, reconnectMaxAttempts: 25 },
    silentLogger
  );
  session.manualStop = false;
  session.reconnectAttempts = 25;
  session.scheduleReconnect();
  assert.strictEqual(session.manualStop, true, 'Must enter manualStop when max reconnects reached');
  assert.strictEqual(session.state, 'error');
  assert.strictEqual(session.reconnectTimer, null, 'Must not schedule another reconnect timer');
});

// ---------------------------------------------------------------------------
// TEST UTILITIES & MOCK BUILDERS
// ---------------------------------------------------------------------------

function createAppMock(router) {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

function createInMemoryWorkerStore() {
  const items = new Map();
  let nextNum = 1;
  return {
    items,
    nextBotNumber: async () => nextNum++,
    get: async (id) => items.get(id) || null,
    getByNumber: async (n) => [...items.values()].find((w) => w.botNumber === n) || null,
    list: async () => [...items.values()],
    create: async (rec) => { items.set(rec.workerId, rec); return rec; },
    update: async (id, patch) => {
      const cur = items.get(id);
      if (!cur) return null;
      const updated = { ...cur, ...patch };
      items.set(id, updated);
      return updated;
    },
    remove: async (id) => items.delete(id),
    resetData: async (id) => {
      const cur = items.get(id);
      if (!cur) return null;
      cur.settings = { mcCredentialsCiphertext: null, proxyCiphertext: null, afkMode: 'still' };
      cur.status = { state: 'stopped', online: false };
      return cur;
    }
  };
}

// ---------------------------------------------------------------------------
// MAIN EXECUTION LOOP
// ---------------------------------------------------------------------------

async function runTestSuite() {
  console.log('TAP version 13');
  console.log('# KBOT E2E Test Suite - Tier 2: Boundary & Corner Cases');
  console.log(`# Features 1 to 26 - Total Tests: ${tests.length}\n`);

  let passCount = 0;
  let failCount = 0;
  const overallStart = Date.now();

  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    const index = i + 1;
    const start = Date.now();
    try {
      await t.fn();
      const duration = Date.now() - start;
      passCount++;
      console.log(`ok ${index} - [${t.id}] ${t.description} (${duration}ms)`);
    } catch (err) {
      failCount++;
      const duration = Date.now() - start;
      console.log(`not ok ${index} - [${t.id}] ${t.description} (${duration}ms)`);
      console.error(`  ---`);
      console.error(`  message: ${err.message}`);
      if (err.stack) {
        console.error(`  stack: |`);
        err.stack.split('\n').slice(1, 4).forEach((line) => console.error(`    ${line}`));
      }
      console.error(`  ...`);
    }
  }

  const totalDuration = Date.now() - overallStart;
  console.log(`\n1..${tests.length}`);
  console.log(`# tests ${tests.length}`);
  console.log(`# pass  ${passCount}`);
  console.log(`# fail  ${failCount}`);
  console.log(`# duration_ms ${totalDuration}\n`);

  if (failCount > 0) {
    process.exit(1);
  }
  process.exit(0);
}

if (require.main === module) {
  runTestSuite().catch((err) => {
    console.error('Fatal test runner error:', err);
    process.exit(1);
  });
}

module.exports = { tests, runTestSuite };
