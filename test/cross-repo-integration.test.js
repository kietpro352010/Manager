'use strict';

/**
 * Cross-Repository Integration Test Suite
 * Manager (D:\manager) ↔ Worker (D:\worker)
 *
 * Verifies the 6 core architectural contracts:
 * 1. Manager ↔ Worker API Contract (endpoints, dual auth headers, >= 32 chars secret validation)
 * 2. Dual-Slot Fleet Integration (Slot 1 & 2 independent bootstrap, telemetry, command isolation, /health slot retention)
 * 3. Two-Phase Reset Synchronization & Leases (lifecycle, fencing token, /reset-customer sequence)
 * 4. Unified 15-Action Parity (strict set equality, route validation, broker dispatch)
 * 5. Dual Transport Parity (Render inbound HTTP vs Wispbyte outbound polling)
 * 6. Concurrency, Network Resilience & Error Recovery
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');

// Manager Modules
const { WorkerRegistry } = require('../src/services/worker-registry');
const CommandBroker = require('../src/services/command-broker');
const { createWorkerApi } = require('../src/http/routes/worker-api');
const { createAdminApi } = require('../src/http/routes/admin-api');
const { createWorkerAuth, extractWorkerSecret } = require('../src/http/middleware/worker-auth');
const SupabaseCommandStore = require('../src/storage/supabase-command-store');
const { encryptSecret, decryptSecret, safeDecryptText, safeDecryptJson, timingSafeStringEquals } = require('../src/utils/secrets');

// Worker Modules
const WORKER_DIR = process.env.WORKER_DIR || path.resolve(__dirname, '../../worker');
if (!fs.existsSync(path.join(WORKER_DIR, 'src/services/worker-runtime.js'))) {
  test('CROSS-REPO INTEGRATION: skipped when sibling BotWorker checkout is absent', { skip: `Missing sibling worker repo at ${WORKER_DIR}` }, () => {});
  return;
}
const WorkerRuntime = require(path.join(WORKER_DIR, 'src/services/worker-runtime'));
const { createRouter: createWorkerRouter } = require(path.join(WORKER_DIR, 'src/http/routes'));
const { requireWorkerSecret, safeEqual, extractWorkerToken } = require(path.join(WORKER_DIR, 'src/http/auth'));
const ManagerReporter = require(path.join(WORKER_DIR, 'src/transports/manager-reporter'));
const WispbytePoller = require(path.join(WORKER_DIR, 'src/transports/wispbyte-poller'));
const { loadConfig } = require(path.join(WORKER_DIR, 'src/config/env'));

// Constants
const ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const VALID_SECRET_1 = 'valid_worker_secret_slot_1_at_least_32_characters_long_123';
const VALID_SECRET_2 = 'valid_worker_secret_slot_2_at_least_32_characters_long_456';
const SHORT_SECRET = 'short_secret_under_32_chars';

const UNIFIED_15_ACTIONS = Object.freeze([
  'start', 'stop', 'restart', 'reconnect', 'status', 'chat', 'reset', 'set-afk-mode', 'set-proxy',
  'respawn', 'inventory', 'look', 'toss', 'window_click', 'window_close'
]);

function createSilentLogger() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {}
  };
}

function startServer(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port, url: `http://127.0.0.1:${port}` });
    });
  });
}

function stopServer(server) {
  return new Promise((resolve) => {
    if (!server || !server.listening) return resolve();
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

function createMockWorkerStore() {
  const workers = new Map();
  const audits = [];
  let nextNum = 1;

  return {
    workers,
    audits,
    async get(id) {
      return workers.get(String(id).toLowerCase()) || null;
    },
    async getByNumber(num) {
      for (const w of workers.values()) {
        if (Number(w.botNumber) === Number(num)) return w;
      }
      return null;
    },
    async list() {
      return Array.from(workers.values());
    },
    async nextBotNumber() {
      return nextNum++;
    },
    async create(worker) {
      workers.set(String(worker.workerId).toLowerCase(), { ...worker });
      return worker;
    },
    async update(id, patch) {
      const existing = workers.get(String(id).toLowerCase());
      if (!existing) throw new Error(`Worker ${id} not found`);
      const updated = { ...existing, ...patch, updatedAt: new Date() };
      workers.set(String(id).toLowerCase(), updated);
      return updated;
    },
    async patchSettings(id, settingsPatch) {
      const existing = workers.get(String(id).toLowerCase());
      if (!existing) throw new Error(`Worker ${id} not found`);
      existing.settings = { ...(existing.settings || {}), ...settingsPatch };
      return existing.settings;
    },
    async resetData(id) {
      const existing = workers.get(String(id).toLowerCase());
      if (!existing) throw new Error(`Worker ${id} not found`);
      existing.settings = {};
      existing.status = { state: 'offline', online: false };
      existing.events = [];
      existing.lastEvent = null;
      return existing;
    },
    async addEvent(id, event) {
      const existing = workers.get(String(id).toLowerCase());
      if (existing) {
        existing.events = existing.events || [];
        existing.events.push(event);
        existing.lastEvent = event;
        return true;
      }
      return false;
    },
    async addAudit(entry) {
      audits.push(entry);
      return true;
    }
  };
}

function createMockSession(initialState = 'online') {
  const calls = [];
  let currentState = initialState;
  let totemCount = 3;

  return {
    calls,
    getState: () => currentState,
    setState: (s) => { currentState = s; },
    setTotemCount: (c) => { totemCount = c; },
    getStatus: () => ({
      ok: true,
      state: currentState,
      online: ['online', 'afk', 'running'].includes(currentState),
      health: 20,
      food: 20,
      totemCount,
      ping: 30,
      tps: 20.0
    }),
    start: async () => { calls.push({ action: 'start' }); currentState = 'online'; return { ok: true, state: currentState }; },
    stop: async (reason) => { calls.push({ action: 'stop', reason }); currentState = 'stopped'; return { ok: true, state: currentState }; },
    restart: async () => { calls.push({ action: 'restart' }); currentState = 'online'; return { ok: true, state: currentState }; },
    reconnect: async () => { calls.push({ action: 'reconnect' }); currentState = 'online'; return { ok: true, state: currentState }; },
    sendChat: async (msg) => { calls.push({ action: 'chat', msg }); return { ok: true, sent: msg }; },
    resetData: async () => { calls.push({ action: 'reset' }); currentState = 'stopped'; return { ok: true, state: currentState }; },
    setAfkMode: (mode) => { calls.push({ action: 'set-afk-mode', mode }); return { ok: true, mode }; },
    setProxy: async (url) => { calls.push({ action: 'set-proxy', url }); return { ok: true, proxy: url }; },
    respawn: async () => { calls.push({ action: 'respawn' }); return { ok: true, respawned: true }; },
    handleInventory: async (p) => { calls.push({ action: 'inventory', p }); return { ok: true, inventory: [] }; },
    look: async (y, p) => { calls.push({ action: 'look', yaw: y, pitch: p }); return { ok: true, yaw: y, pitch: p }; },
    toss: async (p) => { calls.push({ action: 'toss', p }); return { ok: true, tossed: true }; },
    clickWindow: async (p) => { calls.push({ action: 'window_click', p }); return { ok: true, clicked: true }; },
    closeWindow: async () => { calls.push({ action: 'window_close' }); return { ok: true, closed: true }; },
    applyManagerSettings: (settings) => { calls.push({ action: 'applySettings', settings }); },
    applyManagerCredentials: (creds) => { calls.push({ action: 'applyCredentials', creds }); },
    restoreManagerState: (state) => { calls.push({ action: 'restoreState', state }); }
  };
}

// =========================================================================
// SUITE 1: Manager ↔ Worker API Contract & Authentication
// =========================================================================

test('API-CONTRACT-01: Zero-secret & optional MANAGER_URL worker config and registration', async () => {
  const store = createMockWorkerStore();
  const registry = new WorkerRegistry({
    store,
    encryptionKey: ENCRYPTION_KEY,
    adminNotifier: createSilentLogger()
  });

  // 1. Manager registration succeeds without secret (or with empty/short secret) and still validates workerId format
  const addedNoSecret = await registry.add({ workerId: 'bot-no-secret' });
  assert.ok(addedNoSecret.worker);
  assert.strictEqual(addedNoSecret.worker.workerId, 'bot-no-secret');
  assert.strictEqual(addedNoSecret.secret, '');

  const addedEmptySecret = await registry.add({ workerId: 'bot-empty-sec', secret: '' });
  assert.ok(addedEmptySecret.worker);

  await assert.rejects(
    async () => registry.add({ workerId: 'INVALID ID!' }),
    /Worker ID must be 2–40 lowercase letters/
  );

  // 2. Manager setSecret allows empty reset without requiring 32-char secrets
  const valid = await registry.add({ workerId: 'bot-valid', secret: VALID_SECRET_1 });
  assert.ok(valid.worker);
  const updatedSec = await registry.setSecret('bot-valid', '');
  assert.strictEqual(updatedSec, '');

  // 3. Worker loadConfig defaults MANAGER_URL -> https://kbotmanager.onrender.com and works without WORKER_SECRET
  const defaultCfg = loadConfig({
    WORKER_BOT_COUNT: '1',
    WORKER_ID_1: 'bot-worker-1'
  });
  assert.strictEqual(defaultCfg.managerUrl, 'https://kbotmanager.onrender.com');
  assert.strictEqual(defaultCfg.bots[0].workerId, 'bot-worker-1');
  assert.strictEqual(defaultCfg.bots[0].secret, '');
});

test('API-CONTRACT-02: ID-only worker authentication and unregistered/disabled worker rejection', async () => {
  const store = createMockWorkerStore();
  const registry = new WorkerRegistry({
    store,
    encryptionKey: ENCRYPTION_KEY,
    adminNotifier: createSilentLogger()
  });
  const broker = new CommandBroker({
    registry,
    config: { workerPollWaitMs: 100, commandResultTimeoutMs: 1000 },
    logger: createSilentLogger()
  });

  await registry.add({ workerId: 'bot-auth-test' });
  await registry.updateCredentials('bot-auth-test', { username: 'TestPlayer', password: 'SecretPassword123' });

  const managerApp = express();
  managerApp.use(express.json());
  const workerApiRouter = createWorkerApi({
    registry,
    broker,
    workerStore: store,
    config: { workerPollWaitMs: 100 },
    logger: createSilentLogger()
  });
  managerApp.use('/api/v1/workers/:workerId', workerApiRouter);

  const { server, url } = await startServer(managerApp);

  try {
    // 1. Success via ID-only x-manager-bot-id header (no secret needed)
    const res1 = await fetch(`${url}/api/v1/workers/bot-auth-test/bootstrap`, {
      headers: { 'x-manager-bot-id': 'bot-auth-test' }
    });
    assert.strictEqual(res1.status, 200);
    const body1 = await res1.json();
    assert.strictEqual(body1.ok, true);
    assert.ok(Array.isArray(body1.managerUrls) && body1.managerUrls.length >= 1);
    assert.strictEqual(body1.credentials.username, 'TestPlayer');

    // 2. Success via URL :workerId even without secret headers
    const res2 = await fetch(`${url}/api/v1/workers/bot-auth-test/bootstrap`);
    assert.strictEqual(res2.status, 200);

    // 3. Rejection (401) for unregistered worker ID
    const resUnreg = await fetch(`${url}/api/v1/workers/unknown-bot-999/bootstrap`);
    assert.strictEqual(resUnreg.status, 401);
    const bodyUnreg = await resUnreg.json();
    assert.strictEqual(bodyUnreg.ok, false);
    assert.strictEqual(bodyUnreg.error, 'unauthorized');

    // 4. Rejection (401) when worker is disabled
    await registry.setEnabled('bot-auth-test', false);
    const resDisabled = await fetch(`${url}/api/v1/workers/bot-auth-test/bootstrap`);
    assert.strictEqual(resDisabled.status, 401);

    // 5. Legacy requireWorkerSecret helper still works when explicit secret configured
    const workerApp = express();
    workerApp.use(express.json());
    workerApp.get('/test-worker-auth', requireWorkerSecret(VALID_SECRET_1), (_req, res) => res.json({ ok: true }));
    const workerSrv = await startServer(workerApp);

    try {
      const wRes1 = await fetch(`${workerSrv.url}/test-worker-auth`, {
        headers: { 'x-worker-secret': VALID_SECRET_1 }
      });
      assert.strictEqual(wRes1.status, 200);

      // Worker accepts Bearer
      const wRes2 = await fetch(`${workerSrv.url}/test-worker-auth`, {
        headers: { 'authorization': `Bearer ${VALID_SECRET_1}` }
      });
      assert.strictEqual(wRes2.status, 200);

      // Worker rejects invalid secret
      const wResBad = await fetch(`${workerSrv.url}/test-worker-auth`, {
        headers: { 'x-worker-secret': 'invalid_secret_32_characters_long_abcdefg' }
      });
      assert.strictEqual(wResBad.status, 401);
    } finally {
      await stopServer(workerSrv.server);
    }
  } finally {
    await stopServer(server);
  }
});

test('API-CONTRACT-03: Full endpoint coverage (/bootstrap, /heartbeat, /events, /poll, /result, /command)', async () => {
  const store = createMockWorkerStore();
  let deathNotification = null;
  let totemNotification = null;
  const adminNotifier = {
    notifyBotDeath: (wid, _label, reason) => { deathNotification = { wid, reason }; },
    notifyLowTotem: (wid, _label, count) => { totemNotification = { wid, count }; }
  };
  const registry = new WorkerRegistry({
    store,
    encryptionKey: ENCRYPTION_KEY,
    adminNotifier
  });
  const commandStore = {
    async take() { return null; },
    async complete() { return true; },
    async enqueue(c) { return c; },
    async expire() {}
  };
  const broker = new CommandBroker({
    registry,
    commandStore,
    config: { workerPollWaitMs: 50, commandResultTimeoutMs: 1000 },
    logger: createSilentLogger()
  });

  await registry.add({ workerId: 'bot-endpoints', secret: VALID_SECRET_1 });
  await registry.updateCredentials('bot-endpoints', { username: 'BotPlayer', password: 'BotPassword123' });

  const managerApp = express();
  managerApp.use(express.json());
  managerApp.use('/api/v1/workers/:workerId', createWorkerApi({
    registry,
    broker,
    workerStore: store,
    adminNotifier,
    config: { workerPollWaitMs: 50 },
    logger: createSilentLogger()
  }));

  const { server, url } = await startServer(managerApp);

  try {
    // 1. /bootstrap -> returns credentials and settings
    const bootRes = await fetch(`${url}/api/v1/workers/bot-endpoints/bootstrap`, {
      headers: { 'x-worker-secret': VALID_SECRET_1 }
    });
    assert.strictEqual(bootRes.status, 200);
    const bootData = await bootRes.json();
    assert.strictEqual(bootData.ok, true);
    assert.strictEqual(bootData.credentials.username, 'BotPlayer');
    assert.strictEqual(bootData.credentials.password, 'BotPassword123');

    // 2. /heartbeat -> updates telemetry and lastHeartbeat
    const hbRes = await fetch(`${url}/api/v1/workers/bot-endpoints/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-worker-secret': VALID_SECRET_1 },
      body: JSON.stringify({
        status: { state: 'online', ping: 45, tps: 19.8, totemCount: 4 }
      })
    });
    assert.strictEqual(hbRes.status, 200);
    const hbData = await hbRes.json();
    assert.strictEqual(hbData.ok, true);

    const updatedWorker = await registry.find('bot-endpoints');
    assert.strictEqual(updatedWorker.status.state, 'online');
    assert.strictEqual(updatedWorker.status.totemCount, 4);
    assert.ok(updatedWorker.lastHeartbeat);

    // 3. /events -> records events and dispatches admin notifications
    const eventRes1 = await fetch(`${url}/api/v1/workers/bot-endpoints/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-worker-secret': VALID_SECRET_1 },
      body: JSON.stringify({ type: 'bot_death', reason: 'fell from high place' })
    });
    assert.strictEqual(eventRes1.status, 200);
    assert.deepStrictEqual(deathNotification, { wid: 'bot-endpoints', reason: 'fell from high place' });

    const eventRes2 = await fetch(`${url}/api/v1/workers/bot-endpoints/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-worker-secret': VALID_SECRET_1 },
      body: JSON.stringify({ type: 'low_totem', count: 1 })
    });
    assert.strictEqual(eventRes2.status, 200);
    assert.deepStrictEqual(totemNotification, { wid: 'bot-endpoints', count: 1 });

    // 4. /poll -> returns null command when queue is empty
    const pollRes1 = await fetch(`${url}/api/v1/workers/bot-endpoints/poll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-worker-secret': VALID_SECRET_1 },
      body: JSON.stringify({ waitMs: 10, status: { state: 'online' } })
    });
    assert.strictEqual(pollRes1.status, 200);
    const pollData1 = await pollRes1.json();
    assert.strictEqual(pollData1.ok, true);
    assert.strictEqual(pollData1.command, null);

    // 5. /result -> validates UUID commandId format
    const badResultRes = await fetch(`${url}/api/v1/workers/bot-endpoints/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-worker-secret': VALID_SECRET_1 },
      body: JSON.stringify({ commandId: 'invalid-non-uuid-id', result: { ok: true } })
    });
    assert.strictEqual(badResultRes.status, 400);
    const badResultData = await badResultRes.json();
    assert.strictEqual(badResultData.error, 'invalid_command_id');

    // 6. /command on Worker
    const mockSession = createMockSession();
    const runtime = new WorkerRuntime(mockSession, { workerId: 'bot-endpoints' }, createSilentLogger());
    const fleet = {
      get: (wid) => (wid === 'bot-endpoints' ? { config: { secret: VALID_SECRET_1 }, runtime } : null),
      health: () => ({ botCount: 1 })
    };
    const workerApp = express();
    workerApp.use(express.json());
    workerApp.use('/', createWorkerRouter({ fleet, config: { botCount: 1, bots: [{ workerId: 'bot-endpoints', slot: 1 }] } }));
    const workerSrv = await startServer(workerApp);

    try {
      const cmdRes = await fetch(`${workerSrv.url}/api/v1/bots/bot-endpoints/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-worker-secret': VALID_SECRET_1 },
        body: JSON.stringify({ action: 'status' })
      });
      assert.strictEqual(cmdRes.status, 200);
      const cmdData = await cmdRes.json();
      assert.strictEqual(cmdData.ok, true);
      assert.strictEqual(cmdData.result.state, 'online');
    } finally {
      await stopServer(workerSrv.server);
    }
  } finally {
    await stopServer(server);
  }
});

// =========================================================================
// SUITE 2: Dual-Slot Fleet Integration
// =========================================================================

test('FLEET-01: Slot 1 & Slot 2 independent bootstrap, telemetry, command dispatch, and /health slot retention', async () => {
  const store = createMockWorkerStore();
  const registry = new WorkerRegistry({
    store,
    encryptionKey: ENCRYPTION_KEY,
    adminNotifier: createSilentLogger()
  });
  const broker = new CommandBroker({
    registry,
    config: { workerPollWaitMs: 100, commandResultTimeoutMs: 1000 },
    logger: createSilentLogger()
  });

  // Register Slot 1 and Slot 2 in Manager
  await registry.add({ workerId: 'bot-slot-1', secret: VALID_SECRET_1 });
  await registry.updateCredentials('bot-slot-1', { username: 'Slot1Player', password: 'PasswordSlot1' });
  await store.patchSettings('bot-slot-1', { proxyManaged: true, proxyCiphertext: encryptSecret('socks5://user1:pass1@10.0.0.1:1080', ENCRYPTION_KEY) });

  await registry.add({ workerId: 'bot-slot-2', secret: VALID_SECRET_2 });
  await registry.updateCredentials('bot-slot-2', { username: 'Slot2Player', password: 'PasswordSlot2' });
  await store.patchSettings('bot-slot-2', { proxyManaged: true, proxyCiphertext: encryptSecret('socks5://user2:pass2@10.0.0.2:1080', ENCRYPTION_KEY) });

  const managerApp = express();
  managerApp.use(express.json());
  managerApp.use('/api/v1/workers/:workerId', createWorkerApi({
    registry,
    broker,
    workerStore: store,
    config: { workerPollWaitMs: 100 },
    logger: createSilentLogger()
  }));
  const mgrSrv = await startServer(managerApp);

  // Set up Worker Fleet with Slot 1 & Slot 2
  const session1 = createMockSession('online');
  session1.setTotemCount(3);
  const runtime1 = new WorkerRuntime(session1, { workerId: 'bot-slot-1' }, createSilentLogger());

  const session2 = createMockSession('afk');
  session2.setTotemCount(7);
  const runtime2 = new WorkerRuntime(session2, { workerId: 'bot-slot-2' }, createSilentLogger());

  const workerConfig = {
    botCount: 2,
    bots: [
      { workerId: 'bot-slot-1', slot: 1, secret: VALID_SECRET_1 },
      { workerId: 'bot-slot-2', slot: 2, secret: VALID_SECRET_2 }
    ]
  };

  const fleet = {
    get: (wid) => {
      if (wid === 'bot-slot-1') return { config: workerConfig.bots[0], runtime: runtime1, session: session1 };
      if (wid === 'bot-slot-2') return { config: workerConfig.bots[1], runtime: runtime2, session: session2 };
      return null;
    },
    list: () => [
      { config: workerConfig.bots[0], runtime: runtime1, session: session1 },
      { config: workerConfig.bots[1], runtime: runtime2, session: session2 }
    ],
    health: () => ({ botCount: 2, rssMb: 128, heapUsedMb: 64 })
  };

  const workerApp = express();
  workerApp.use(express.json());
  workerApp.use('/', createWorkerRouter({ fleet, config: workerConfig }));
  const wkrSrv = await startServer(workerApp);

  try {
    // 1. Independent Bootstrap: Slot 1 receives Slot 1 config, Slot 2 receives Slot 2 config
    const boot1 = await fetch(`${mgrSrv.url}/api/v1/workers/bot-slot-1/bootstrap`, {
      headers: { 'x-worker-secret': VALID_SECRET_1 }
    }).then((r) => r.json());
    assert.strictEqual(boot1.ok, true);
    assert.strictEqual(boot1.credentials.username, 'Slot1Player');
    assert.strictEqual(boot1.settings.proxyUrl, 'socks5://user1:pass1@10.0.0.1:1080');

    const boot2 = await fetch(`${mgrSrv.url}/api/v1/workers/bot-slot-2/bootstrap`, {
      headers: { 'x-worker-secret': VALID_SECRET_2 }
    }).then((r) => r.json());
    assert.strictEqual(boot2.ok, true);
    assert.strictEqual(boot2.credentials.username, 'Slot2Player');
    assert.strictEqual(boot2.settings.proxyUrl, 'socks5://user2:pass2@10.0.0.2:1080');

    // Unregistered worker slot ID returns 401 (whereas registered bot-slot-2 returns only its own isolated config)
    const unknownBoot = await fetch(`${mgrSrv.url}/api/v1/workers/bot-slot-unknown/bootstrap`, {
      headers: { 'x-manager-bot-id': 'bot-slot-unknown' }
    });
    assert.strictEqual(unknownBoot.status, 401);

    // 2. Independent Telemetry Reporting
    await fetch(`${mgrSrv.url}/api/v1/workers/bot-slot-1/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-worker-secret': VALID_SECRET_1 },
      body: JSON.stringify({ status: { state: 'online', totemCount: 3, ping: 25 } })
    });
    await fetch(`${mgrSrv.url}/api/v1/workers/bot-slot-2/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-worker-secret': VALID_SECRET_2 },
      body: JSON.stringify({ status: { state: 'afk', totemCount: 7, ping: 45 } })
    });

    const w1 = await registry.find('bot-slot-1');
    const w2 = await registry.find('bot-slot-2');
    assert.strictEqual(w1.status.state, 'online');
    assert.strictEqual(w1.status.totemCount, 3);
    assert.strictEqual(w2.status.state, 'afk');
    assert.strictEqual(w2.status.totemCount, 7);

    // 3. Command Routing Isolation: Command sent to Slot 1 affects only Slot 1
    const cmd1 = await fetch(`${wkrSrv.url}/api/v1/bots/bot-slot-1/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-worker-secret': VALID_SECRET_1 },
      body: JSON.stringify({ action: 'chat', payload: { message: 'Slot 1 says hi' } })
    }).then((r) => r.json());
    assert.strictEqual(cmd1.ok, true);
    assert.ok(session1.calls.some((c) => c.action === 'chat' && c.msg === 'Slot 1 says hi'));
    assert.strictEqual(session2.calls.length, 0, 'Slot 2 must not receive commands dispatched to Slot 1');

    // 4. Verify /health retains slot property without leaking workerId, and /api/v1/diagnostics exposes bots when authed
    const healthRes = await fetch(`${wkrSrv.url}/health`).then((r) => r.json());
    assert.strictEqual(healthRes.ok, true);
    assert.strictEqual(healthRes.service, 'kingmc-afk-worker');
    assert.strictEqual(healthRes.botCount, 2);
    assert.strictEqual(healthRes.bots, undefined, 'Public /health must omit sensitive bots/workerId list');
    assert.deepStrictEqual(healthRes.slots, [1, 2]);
    const diagRes = await fetch(`${wkrSrv.url}/api/v1/diagnostics`, {
      headers: { 'x-worker-secret': VALID_SECRET_1 }
    });
    assert.strictEqual(diagRes.status, 200);
    const diagJson = await diagRes.json();
    assert.deepStrictEqual(diagJson.bots, [
      { workerId: 'bot-slot-1', slot: 1 },
      { workerId: 'bot-slot-2', slot: 2 }
    ]);
  } finally {
    await stopServer(wkrSrv.server);
    await stopServer(mgrSrv.server);
  }
});

// =========================================================================
// SUITE 3: Two-Phase Reset Synchronization & Leases
// =========================================================================

test('TWO-PHASE-01: Two-phase reset lifecycle, lease renewal, and fencing token validation', async () => {
  const rows = new Map();
  const nowMs = Date.now();

  // In-memory Supabase RPC emulator modeling PostgreSQL functions exactly
  const mockSupabaseClient = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        in() { return this; },
        order() { return this; },
        limit() { return this; },
        update() { return this; },
        maybeSingle: async () => ({ data: null, error: null })
      };
    },
    async rpc(fnName, params = {}) {
      const now = Date.now();
      const nowIso = new Date(now).toISOString();

      if (fnName === 'manager_mark_command_sync_pending') {
        const row = rows.get(params.p_command_id);
        if (!row || row.worker_id !== params.p_worker_id) return { data: false, error: null };
        const sync = row.result?._stateSync || {};
        const owner = sync.leaseOwner || null;
        const token = Number(sync.fencingToken || 0);

        if (params.p_lease_owner && owner && owner !== params.p_lease_owner) return { data: false, error: null };
        if (params.p_fencing_token !== null && params.p_fencing_token !== undefined && token > 0 && token !== Number(params.p_fencing_token)) {
          return { data: false, error: null };
        }

        row.status = params.p_terminal_failed ? 'state_sync_failed' : 'state_sync_pending';
        row.completed_at = null;
        row.result = {
          ...(row.result || {}),
          _stateSync: {
            ...(params.p_sync_state || {}),
            leaseOwner: params.p_lease_owner || owner,
            fencingToken: Math.max(token, Number(params.p_fencing_token || 0))
          }
        };
        return { data: true, error: null };
      }

      if (fnName === 'manager_renew_command_sync_lease') {
        const row = rows.get(params.p_command_id);
        if (!row || row.worker_id !== params.p_worker_id) return { data: { ok: false, lost: true, reason: 'not_found' }, error: null };
        const sync = row.result?._stateSync || {};
        const token = Number(sync.fencingToken || 0);

        if ((sync.leaseOwner || null) !== params.p_lease_owner) {
          return { data: { ok: false, lost: true, reason: 'lease_owner_mismatch', currentOwner: sync.leaseOwner }, error: null };
        }
        if (params.p_fencing_token !== null && params.p_fencing_token !== undefined && token !== Number(params.p_fencing_token)) {
          return { data: { ok: false, lost: true, reason: 'fencing_token_mismatch', currentFencingToken: token }, error: null };
        }

        const leaseSecs = Number(params.p_lease_seconds) || 60;
        const nextLeaseUntil = new Date(now + leaseSecs * 1000).toISOString();
        row.result._stateSync.leaseUntil = nextLeaseUntil;
        return {
          data: { ok: true, lost: false, leaseOwner: sync.leaseOwner, leaseUntil: nextLeaseUntil, fencingToken: token },
          error: null
        };
      }

      if (fnName === 'manager_claim_pending_command_syncs') {
        if (!params.p_lease_owner) return { data: [], error: null };
        const claimed = [];
        for (const row of rows.values()) {
          if (!['state_sync_pending', 'execution_completed'].includes(row.status)) continue;
          const sync = row.result?._stateSync || {};
          const nextToken = Number(sync.fencingToken || 0) + 1;
          const leaseSecs = Number(params.p_lease_seconds) || 60;
          const leaseUntil = new Date(now + leaseSecs * 1000).toISOString();
          row.status = 'state_sync_pending';
          row.result = {
            ...(row.result || {}),
            _stateSync: {
              ...sync,
              leaseOwner: params.p_lease_owner,
              leaseUntil,
              fencingToken: nextToken
            }
          };
          claimed.push({ ...row });
        }
        return { data: claimed, error: null };
      }

      if (fnName === 'manager_finalize_command_sync') {
        const row = rows.get(params.p_command_id);
        if (!row || row.worker_id !== params.p_worker_id) return { data: false, error: null };
        if (row.status === 'completed') return { data: true, error: null };
        const sync = row.result?._stateSync || {};
        const owner = sync.leaseOwner || null;
        const token = Number(sync.fencingToken || 0);

        if (params.p_lease_owner && owner && owner !== params.p_lease_owner) return { data: false, error: null };
        if (params.p_fencing_token !== null && params.p_fencing_token !== undefined && token > 0 && token !== Number(params.p_fencing_token)) {
          return { data: false, error: null };
        }

        row.status = 'completed';
        row.completed_at = nowIso;
        delete row.result?._stateSync;
        return { data: true, error: null };
      }

      return { data: null, error: null };
    }
  };

  const commandStore = new SupabaseCommandStore(mockSupabaseClient, { logger: createSilentLogger() });

  // Initialize a test command in commandStore
  const cid = 'cmd_11111111-1111-4111-8111-111111111111';
  rows.set(cid, {
    command_id: cid,
    worker_id: 'bot-sync-1',
    status: 'delivered',
    result: { ok: true },
    created_at: new Date().toISOString()
  });

  // 1. Mark command sync pending with initial fencing token 1
  const marked = await commandStore.markStateSyncPending('bot-sync-1', cid, {
    syncState: { pendingSteps: ['registry.resetData'] },
    leaseOwner: 'manager_instance_A',
    fencingToken: 1
  });
  assert.strictEqual(marked, true);
  assert.strictEqual(rows.get(cid).status, 'state_sync_pending');

  // 2. Renew lease with matching owner and matching fencing token
  const renewed = await commandStore.renewStateSyncLease('bot-sync-1', cid, 'manager_instance_A', 30, { fencingToken: 1 });
  assert.strictEqual(renewed.ok, true);
  assert.strictEqual(renewed.lost, false);
  assert.strictEqual(renewed.fencingToken, 1);

  // 3. Fencing token mismatch rejection: stale token (0) rejected
  const staleRenewal = await commandStore.renewStateSyncLease('bot-sync-1', cid, 'manager_instance_A', 30, { fencingToken: 0 });
  assert.strictEqual(staleRenewal.ok, false);
  assert.strictEqual(staleRenewal.lost, true);
  assert.strictEqual(staleRenewal.reason, 'fencing_token_mismatch');

  // 4. Lease owner mismatch rejection: different owner rejected
  const impostorRenewal = await commandStore.renewStateSyncLease('bot-sync-1', cid, 'manager_instance_B', 30, { fencingToken: 1 });
  assert.strictEqual(impostorRenewal.ok, false);
  assert.strictEqual(impostorRenewal.lost, true);
  assert.strictEqual(impostorRenewal.reason, 'lease_owner_mismatch');

  // 5. Manager instance B claims pending sync: fencing token increments to 2
  const claimedBatch = await commandStore.claimPendingStateSyncBatch('manager_instance_B', 10, 60);
  assert.strictEqual(claimedBatch.length, 1);
  assert.strictEqual(rows.get(cid).result._stateSync.fencingToken, 2);
  assert.strictEqual(rows.get(cid).result._stateSync.leaseOwner, 'manager_instance_B');

  // 6. Old manager instance A now attempts finalization with stale token 1 -> rejected
  const staleFinalize = await commandStore.finalizeCompleted('bot-sync-1', cid, { ok: true }, {
    leaseOwner: 'manager_instance_A',
    fencingToken: 1
  });
  assert.strictEqual(staleFinalize, false, 'Stale holder with old fencing token must be rejected from finalization');
  assert.notStrictEqual(rows.get(cid).status, 'completed');

  // 7. Legitimate new holder manager_instance_B finalizes with fencing token 2 -> succeeds
  const legitFinalize = await commandStore.finalizeCompleted('bot-sync-1', cid, { ok: true }, {
    leaseOwner: 'manager_instance_B',
    fencingToken: 2
  });
  assert.strictEqual(legitFinalize, true);
  assert.strictEqual(rows.get(cid).status, 'completed');
  assert.strictEqual(rows.get(cid).result._stateSync, undefined, 'Internal _stateSync must be stripped upon completion');
});

test('TWO-PHASE-02: Customer handover reset (/reset-customer) dispatches stop command to Worker BEFORE wiping credentials', async () => {
  const store = createMockWorkerStore();
  const callSequence = [];

  const registry = new WorkerRegistry({
    store,
    encryptionKey: ENCRYPTION_KEY,
    adminNotifier: createSilentLogger()
  });

  // Track resetData call in registry
  const originalResetData = registry.resetData.bind(registry);
  registry.resetData = async (wid) => {
    callSequence.push({ step: 'registry.resetData', wid });
    return originalResetData(wid);
  };

  const broker = {
    dispatch: async (wid, action, payload) => {
      callSequence.push({ step: 'broker.dispatch', wid, action, payload });
      return { ok: true, delivered: true };
    }
  };

  await registry.add({ workerId: 'bot-customer-reset', secret: VALID_SECRET_1 });
  await registry.updateCredentials('bot-customer-reset', { username: 'CustomerBot', password: 'PassBeforeReset' });
  await store.patchSettings('bot-customer-reset', { proxyManaged: true, proxyCiphertext: encryptSecret('socks5://cust:pass@1.1.1.1:1080', ENCRYPTION_KEY) });

  // Create Admin API router
  const adminApp = express();
  adminApp.use(express.json());
  // Mock admin auth middleware
  adminApp.use((req, _res, next) => {
    req.managerAuthSession = { username: 'admin', role: 'admin' };
    next();
  });
  adminApp.use('/api/admin', createAdminApi({
    registry,
    broker,
    store,
    entitlements: {},
    link4m: {},
    accessControl: {},
    botSecretKey: 'global_secret_key_32_chars_12345',
    logger: createSilentLogger()
  }));

  const { server, url } = await startServer(adminApp);

  try {
    const res = await fetch(`${url}/api/admin/bot/bot-customer-reset/reset-customer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);

    // Assert strictly that broker.dispatch('stop') was called BEFORE registry.resetData()
    assert.strictEqual(callSequence.length, 2);
    assert.deepStrictEqual(callSequence[0], {
      step: 'broker.dispatch',
      wid: 'bot-customer-reset',
      action: 'stop',
      payload: { reason: 'reset-customer' }
    });
    assert.deepStrictEqual(callSequence[1], {
      step: 'registry.resetData',
      wid: 'bot-customer-reset'
    });

    // Verify credentials and proxy are wiped in store
    const wiped = await registry.find('bot-customer-reset');
    assert.deepStrictEqual(wiped.settings, {});
    assert.strictEqual(wiped.status.online, false);
  } finally {
    await stopServer(server);
  }
});

// =========================================================================
// SUITE 4: Unified 15-Action Parity
// =========================================================================

test('ACTIONS-01: Strict 15-action parity between Manager and Worker', () => {
  const managerActions = WorkerRegistry.ACTIONS;
  const workerActions = WorkerRuntime.ACTIONS;

  // 1. Both sets must contain exactly 15 actions
  assert.strictEqual(managerActions.size, 15, `Manager actions size must be 15, got ${managerActions.size}`);
  assert.strictEqual(workerActions.size, 15, `Worker actions size must be 15, got ${workerActions.size}`);

  // 2. Symmetric difference between Manager and Worker action sets must be empty
  const managerOnly = [...managerActions].filter((a) => !workerActions.has(a));
  const workerOnly = [...workerActions].filter((a) => !managerActions.has(a));
  assert.deepStrictEqual(managerOnly, [], 'Manager must not have actions missing from Worker');
  assert.deepStrictEqual(workerOnly, [], 'Worker must not have actions missing from Manager');

  // 3. Exact members must strictly match UNIFIED_15_ACTIONS
  for (const act of UNIFIED_15_ACTIONS) {
    assert.strictEqual(managerActions.has(act), true, `Action "${act}" must be present in Manager`);
    assert.strictEqual(workerActions.has(act), true, `Action "${act}" must be present in Worker`);
  }
});

test('ACTIONS-02: Worker command route executes all 15 actions and rejects unsupported actions', async () => {
  const mockSession = createMockSession();
  const runtime = new WorkerRuntime(mockSession, { workerId: 'bot-action-parity' }, createSilentLogger());
  const fleet = {
    get: (wid) => (wid === 'bot-action-parity' ? { config: { secret: VALID_SECRET_1 }, runtime } : null),
    health: () => ({ botCount: 1 })
  };

  const app = express();
  app.use(express.json());
  app.use('/', createWorkerRouter({ fleet, config: { botCount: 1, bots: [{ workerId: 'bot-action-parity', slot: 1 }] } }));
  const { server, url } = await startServer(app);

  try {
    // 1. Execute each of the 15 unified actions
    const actionPayloads = {
      start: {},
      stop: {},
      restart: {},
      reconnect: {},
      status: {},
      chat: { message: 'hello world' },
      reset: {},
      'set-afk-mode': { mode: 'still' },
      'set-proxy': { url: 'socks5://test:1080' },
      respawn: {},
      inventory: { action: 'list' },
      look: { yaw: 90, pitch: 0 },
      toss: { slot: 36 },
      window_click: { slot: 1 },
      window_close: {}
    };

    for (const action of UNIFIED_15_ACTIONS) {
      const res = await fetch(`${url}/api/v1/bots/bot-action-parity/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-worker-secret': VALID_SECRET_1 },
        body: JSON.stringify({ action, payload: actionPayloads[action] || {} })
      });
      assert.strictEqual(res.status, 200, `Action "${action}" should succeed with HTTP 200`);
      const body = await res.json();
      assert.strictEqual(body.ok, true, `Action "${action}" response should have ok: true`);
    }

    // 2. Reject unsupported action with 400 unsupported_action
    const badRes = await fetch(`${url}/api/v1/bots/bot-action-parity/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-worker-secret': VALID_SECRET_1 },
      body: JSON.stringify({ action: 'unsupported_test_action', payload: {} })
    });
    assert.strictEqual(badRes.status, 400);
    const badBody = await badRes.json();
    assert.strictEqual(badBody.ok, false);
    assert.strictEqual(badBody.error, 'unsupported_action');
  } finally {
    await stopServer(server);
  }
});

// =========================================================================
// SUITE 5: Dual Transport Parity
// =========================================================================

test('TRANSPORT-01: Render HTTP Inbound Command Transport end-to-end execution', async () => {
  const mockSession = createMockSession();
  const runtime = new WorkerRuntime(mockSession, { workerId: 'bot-render-worker' }, createSilentLogger());
  const fleet = {
    get: (wid) => (wid === 'bot-render-worker' ? { config: { secret: VALID_SECRET_1 }, runtime } : null),
    health: () => ({ botCount: 1 })
  };

  // 1. Start Worker Express App
  const workerApp = express();
  workerApp.use(express.json());
  workerApp.use('/', createWorkerRouter({ fleet, config: { botCount: 1, bots: [{ workerId: 'bot-render-worker', slot: 1 }] } }));
  const wkrSrv = await startServer(workerApp);

  // 2. Set up Manager with Render Worker pointing to Worker server URL
  const store = createMockWorkerStore();
  const registry = new WorkerRegistry({
    store,
    encryptionKey: ENCRYPTION_KEY,
    adminNotifier: createSilentLogger()
  });

  await registry.add({
    workerId: 'bot-render-worker',
    provider: 'render',
    serviceUrl: wkrSrv.url,
    secret: VALID_SECRET_1
  });

  const broker = new CommandBroker({
    registry,
    config: { commandResultTimeoutMs: 5000 },
    logger: createSilentLogger()
  });

  try {
    // 3. Manager dispatches 'chat' command to Render worker
    const chatOutcome = await broker.dispatch('bot-render-worker', 'chat', { message: 'Greetings from Manager!' });
    assert.strictEqual(chatOutcome.ok, true);
    assert.strictEqual(chatOutcome.delivered, true);
    assert.strictEqual(chatOutcome.timedOut, false);
    assert.strictEqual(chatOutcome.result.sent, 'Greetings from Manager!');
    assert.ok(mockSession.calls.some((c) => c.action === 'chat' && c.msg === 'Greetings from Manager!'));

    // 4. Manager dispatches 'status' command to Render worker
    const statusOutcome = await broker.dispatch('bot-render-worker', 'status');
    assert.strictEqual(statusOutcome.ok, true);
    assert.strictEqual(statusOutcome.result.state, 'online');
  } finally {
    await stopServer(wkrSrv.server);
  }
});

test('TRANSPORT-02: Wispbyte Long-Poll Transport end-to-end execution', async () => {
  const store = createMockWorkerStore();
  const registry = new WorkerRegistry({
    store,
    encryptionKey: ENCRYPTION_KEY,
    adminNotifier: createSilentLogger()
  });

  // Simple in-memory command queue store for Wispbyte polling
  const queuedCommands = [];
  const commandStore = {
    async enqueue(cmd) {
      queuedCommands.push({ ...cmd });
      return cmd;
    },
    async take(wid) {
      const idx = queuedCommands.findIndex((c) => c.workerId === wid);
      if (idx !== -1) return queuedCommands.splice(idx, 1)[0];
      return null;
    },
    async complete(wid, cid, res) {
      return true;
    },
    async expire() {}
  };

  const broker = new CommandBroker({
    registry,
    commandStore,
    config: { workerPollWaitMs: 50, commandResultTimeoutMs: 3000 },
    logger: createSilentLogger()
  });

  // Register worker as 'wispbyte'
  await registry.add({
    workerId: 'bot-wispbyte-worker',
    provider: 'wispbyte',
    secret: VALID_SECRET_1
  });
  // Simulate active check-in so broker allows polling dispatch
  await registry.updateStatus('bot-wispbyte-worker', { state: 'online' }, 'worker-heartbeat');

  // Manager HTTP endpoints for poll and result
  const managerApp = express();
  managerApp.use(express.json());
  managerApp.use('/api/v1/workers/:workerId', createWorkerApi({
    registry,
    broker,
    workerStore: store,
    config: { workerPollWaitMs: 50 },
    logger: createSilentLogger()
  }));
  const mgrSrv = await startServer(managerApp);

  try {
    // 1. Manager dispatches command (queues it in commandStore)
    const dispatchPromise = broker.dispatch('bot-wispbyte-worker', 'chat', { message: 'Poll message' });

    // 2. Worker polls Manager
    const pollRes = await fetch(`${mgrSrv.url}/api/v1/workers/bot-wispbyte-worker/poll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-worker-secret': VALID_SECRET_1 },
      body: JSON.stringify({ status: { state: 'online' } })
    });
    assert.strictEqual(pollRes.status, 200);
    const pollBody = await pollRes.json();
    assert.strictEqual(pollBody.ok, true);
    assert.ok(pollBody.command);
    assert.strictEqual(pollBody.command.action, 'chat');
    assert.strictEqual(pollBody.command.payload.message, 'Poll message');

    const receivedCmd = pollBody.command;

    // 3. Worker executes command and returns result via POST /result
    const resultRes = await fetch(`${mgrSrv.url}/api/v1/workers/bot-wispbyte-worker/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-worker-secret': VALID_SECRET_1 },
      body: JSON.stringify({
        commandId: receivedCmd.commandId,
        action: receivedCmd.action,
        result: { ok: true, sent: 'Poll message' }
      })
    });
    assert.strictEqual(resultRes.status, 200);
    const resultBody = await resultRes.json();
    assert.strictEqual(resultBody.ok, true);

    // 4. Manager's original dispatchPromise resolves with result
    const dispatchResult = await dispatchPromise;
    assert.strictEqual(dispatchResult.ok, true);
    assert.strictEqual(dispatchResult.delivered, true);
    assert.strictEqual(dispatchResult.result.sent, 'Poll message');
  } finally {
    await stopServer(mgrSrv.server);
  }
});

// =========================================================================
// SUITE 6: Concurrency, Network Resilience & Error Recovery
// =========================================================================

test('RESILIENCE-01: Render command timeout and connection errors map to safe errors without crashing', async () => {
  const store = createMockWorkerStore();
  const registry = new WorkerRegistry({
    store,
    encryptionKey: ENCRYPTION_KEY,
    adminNotifier: createSilentLogger()
  });

  // Point to an unavailable port (connection refused)
  await registry.add({
    workerId: 'bot-offline-render',
    provider: 'render',
    serviceUrl: 'http://127.0.0.1:59999',
    secret: VALID_SECRET_1
  });

  const broker = new CommandBroker({
    registry,
    config: { commandResultTimeoutMs: 1000 },
    logger: createSilentLogger()
  });

  await assert.rejects(
    async () => broker.dispatch('bot-offline-render', 'status'),
    (err) => {
      // Must reject with network error without crashing the process
      assert.ok(err);
      return true;
    }
  );
});
