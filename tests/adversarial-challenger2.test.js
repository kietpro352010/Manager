'use strict';

const assert = require('node:assert');
const http = require('node:http');
const express = require('express');
const crypto = require('node:crypto');

const { createApp } = require('../src/http/app');
const { createAuthApi } = require('../src/http/routes/auth-api');
const { createWorkerApi } = require('../src/http/routes/worker-api');
const { WorkerRegistry, validateWorkerStatus, VALID_WORKER_STATES } = require('../src/services/worker-registry');
const SupabaseWorkerStore = require('../src/storage/supabase-worker-store');
const { encryptSecret, decryptSecret, generateWorkerSecret } = require('../src/utils/secrets');
let createWorkerHttpRouter = null;
let requireWorkerSecret = null;
try {
  createWorkerHttpRouter = require('../../worker/src/http/routes').createRouter;
  requireWorkerSecret = require('../../worker/src/http/auth').requireWorkerSecret;
} catch (_) {}

function createMockLogger() {
  const logs = { info: [], warn: [], error: [], debug: [] };
  return {
    logs,
    info: (msg, meta) => logs.info.push({ msg, meta }),
    warn: (msg, meta) => logs.warn.push({ msg, meta }),
    error: (msg, meta) => logs.error.push({ msg, meta }),
    debug: (msg, meta) => logs.debug.push({ msg, meta })
  };
}

function createMockWorkerStore(initialWorkers = []) {
  const workers = new Map();
  for (const w of initialWorkers) {
    workers.set(String(w.workerId).toLowerCase(), { ...w });
  }
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
      }
    },
    async addAudit(entry) {
      audits.push(entry);
      return true;
    }
  };
}

async function runAdversarialChallenges() {
  console.log('================================================================================');
  console.log('⚡ CHALLENGER 2: EMPIRICAL ADVERSARIAL STRESS SUITE (WORKER REGISTRY & STORAGE) ⚡');
  console.log('================================================================================\n');

  const encryptionKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  // ---------------------------------------------------------------------------
  // ATTACK 1: Worker Secret Verification & Promise Truthiness (WORKER-01)
  // ---------------------------------------------------------------------------
  console.log('>>> [ATTACK 1] Stress-Testing Worker Secret Verification & Promise Truthiness (WORKER-01)...');
  {
    const workerStore = createMockWorkerStore();
    const logger = createMockLogger();
    const botSecretA = 'worker-alpha-secret-999';
    const botSecretB = 'worker-beta-secret-888';

    await workerStore.create({
      workerId: 'bot-alpha',
      botNumber: 1,
      enabled: true,
      secretCiphertext: encryptSecret(botSecretA, encryptionKey),
      status: { state: 'online' }
    });

    await workerStore.create({
      workerId: 'bot-disabled',
      botNumber: 2,
      enabled: false,
      secretCiphertext: encryptSecret(botSecretB, encryptionKey),
      status: { state: 'offline' }
    });

    const registry = new WorkerRegistry({
      store: workerStore,
      encryptionKey,
      adminNotifier: null
    });

    const authStore = {
      async assignedUser(botId) {
        if (botId === 'bot-alpha') return 'alpha_owner';
        return null;
      },
      addAudit: async () => true
    };

    const authRouter = createAuthApi({
      store: authStore,
      entitlementService: {},
      registry,
      config: { botSecretKey: 'global-shared-key-555' },
      logger,
      activeSessions: new Map()
    });

    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRouter);
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
      // Vector 1.1: Missing secret header
      let res = await fetch(`${base}/api/auth/verify-bot-access`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ botId: 'bot-alpha' })
      });
      assert.strictEqual(res.status, 401, 'Missing x-bot-secret must return 401');

      // Vector 1.2: Empty secret header
      res = await fetch(`${base}/api/auth/verify-bot-access`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-bot-secret': '' },
        body: JSON.stringify({ botId: 'bot-alpha' })
      });
      assert.strictEqual(res.status, 401, 'Empty x-bot-secret must return 401');

      // Vector 1.3: Completely bogus secret
      res = await fetch(`${base}/api/auth/verify-bot-access`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-bot-secret': 'bogus_guess_attack' },
        body: JSON.stringify({ botId: 'bot-alpha' })
      });
      assert.strictEqual(res.status, 401, 'Bogus secret must return 401');

      // Vector 1.4: Cross-bot impersonation (Bot B secret presented for Bot A)
      res = await fetch(`${base}/api/auth/verify-bot-access`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-bot-secret': botSecretB },
        body: JSON.stringify({ botId: 'bot-alpha' })
      });
      assert.strictEqual(res.status, 401, 'Cross-bot impersonation secret must return 401');

      // Vector 1.5: Secret for disabled bot
      res = await fetch(`${base}/api/auth/verify-bot-access`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-bot-secret': botSecretB },
        body: JSON.stringify({ botId: 'bot-disabled' })
      });
      assert.strictEqual(res.status, 401, 'Disabled bot secret must return 401');

      // Vector 1.6: Non-existent botId
      res = await fetch(`${base}/api/auth/verify-bot-access`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-bot-secret': botSecretA },
        body: JSON.stringify({ botId: 'phantom-ghost-bot' })
      });
      assert.strictEqual(res.status, 401, 'Non-existent botId must return 401');

      // Vector 1.7: Missing body / empty botId
      res = await fetch(`${base}/api/auth/verify-bot-access`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-bot-secret': botSecretA },
        body: JSON.stringify({})
      });
      assert.strictEqual(res.status, 401, 'Empty botId must return 401');

      // Vector 1.8: Fuzzed botId types with wrong secret
      res = await fetch(`${base}/api/auth/verify-bot-access`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-bot-secret': 'wrong-secret' },
        body: JSON.stringify({ botId: ['bot-alpha'] })
      });
      assert.strictEqual(res.status, 401, 'Array botId with wrong secret must return 401');

      // Vector 1.8b: Object botId with valid secret (object stringifies to [object Object], which cannot authenticate)
      res = await fetch(`${base}/api/auth/verify-bot-access`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-bot-secret': botSecretA },
        body: JSON.stringify({ botId: { id: 'bot-alpha' } })
      });
      assert.strictEqual(res.status, 401, 'Object botId must return 401');

      // Vector 1.9: Promise Truthiness Attack (Verify that resolving false inside Promise cannot bypass)
      // Even if registry.verifyBotSecret takes 50ms and resolves to false, it MUST be awaited and evaluate to false
      const slowFalseRegistry = {
        verifyBotSecret: async () => {
          await new Promise((r) => setTimeout(r, 20));
          return false;
        }
      };
      const truthinessRouter = createAuthApi({
        store: authStore,
        entitlementService: {},
        registry: slowFalseRegistry,
        config: { botSecretKey: 'global-shared-key-555' },
        logger,
        activeSessions: new Map()
      });
      const truthinessApp = express();
      truthinessApp.use(express.json());
      truthinessApp.use('/api/auth', truthinessRouter);
      const truthinessServer = http.createServer(truthinessApp);
      await new Promise((r) => truthinessServer.listen(0, r));
      const tPort = truthinessServer.address().port;

      try {
        const tRes = await fetch(`http://127.0.0.1:${tPort}/api/auth/verify-bot-access`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-bot-secret': 'any-secret' },
          body: JSON.stringify({ botId: 'bot-alpha' })
        });
        assert.strictEqual(tRes.status, 401, 'Awaited Promise resolving false MUST return 401');
      } finally {
        await new Promise((r) => truthinessServer.close(r));
      }

      // Vector 1.10: Valid secret on valid enabled bot MUST succeed with 200
      res = await fetch(`${base}/api/auth/verify-bot-access`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-bot-secret': botSecretA },
        body: JSON.stringify({ botId: 'bot-alpha' })
      });
      assert.strictEqual(res.status, 200, 'Valid credentials must return 200');
      const body = await res.json();
      assert.strictEqual(body.ok, true);
      assert.strictEqual(body.botId, 'bot-alpha');
      assert.strictEqual(body.assignedUser, 'alpha_owner');

    } finally {
      await new Promise((r) => server.close(r));
    }
  }
  console.log('🛡️  ATTACK 1 PASSED: 10/10 vectors verified. Promise truthiness is 100% plugged, negative cases strictly return 401.\n');

  // ---------------------------------------------------------------------------
  // ATTACK 2: Secret Cache TTL & Rotation Grace (WORKER-02, WKR-02)
  // ---------------------------------------------------------------------------
  console.log('>>> [ATTACK 2] Stress-Testing Secret Cache TTL (60s) & Rotation Grace (5m)...');
  {
    const workerStore = createMockWorkerStore();
    const registry = new WorkerRegistry({
      store: workerStore,
      encryptionKey
    });

    const secretOriginal = 'secret-v1-original';
    await workerStore.create({
      workerId: 'bot-cache',
      botNumber: 1,
      enabled: true,
      secretCiphertext: encryptSecret(secretOriginal, encryptionKey)
    });

    // Sub-attack 2.1: Cache population & TTL expiration check
    await registry.credential('bot-cache');
    assert.strictEqual(await registry.authenticate('bot-cache', secretOriginal), true);
    assert.strictEqual(registry.verifyBotSecretSync('bot-cache', secretOriginal), true);

    // Verify cache entry structure
    let cached = registry.secretCache.get('bot-cache');
    assert.ok(cached.cachedAt, 'Cache must record cachedAt timestamp');

    // Simulate 61 seconds passing (past 60s TTL)
    cached.cachedAt = Date.now() - 61000;

    // Simulate database record changing to a new secret (or deleted) behind the cache
    const secretV2 = 'secret-v2-updated-in-db';
    await workerStore.update('bot-cache', {
      secretCiphertext: encryptSecret(secretV2, encryptionKey)
    });

    // Now, verifyBotSecretSync with expired cache:
    // It MUST evict expired entry and return false for the old secret!
    const syncResOld = registry.verifyBotSecretSync('bot-cache', secretOriginal);
    assert.strictEqual(syncResOld, false, 'Expired cache must evict and return false for old secret in verifyBotSecretSync');
    assert.strictEqual(registry.secretCache.has('bot-cache'), false, 'Expired entry must be evicted from cache');

    // Async authenticate() with expired cache:
    // Old secret fails, because cache was evicted and DB has secretV2!
    const authResOld = await registry.authenticate('bot-cache', secretOriginal);
    assert.strictEqual(authResOld, false, 'Old secret MUST fail after cache expiration and DB change');

    // But new secret in DB succeeds and refreshes cache!
    const authResNew = await registry.authenticate('bot-cache', secretV2);
    assert.strictEqual(authResNew, true, 'New DB secret succeeds and repopulates cache');

    // Sub-attack 2.2: Programmatic Invalidation
    assert.strictEqual(registry.secretCache.has('bot-cache'), true);
    registry.invalidateWorkerSecret('bot-cache');
    assert.strictEqual(registry.secretCache.has('bot-cache'), false, 'invalidateWorkerSecret must evict targeted worker');

    // Sub-attack 2.3: Rotation Grace Period Dual-Secret Authentication (WKR-02)
    // Current secret is secretV2. Let's call rotateSecret!
    const secretV3 = await registry.rotateSecret('bot-cache');
    assert.notStrictEqual(secretV3, secretV2);

    cached = registry.secretCache.get('bot-cache');
    assert.strictEqual(cached.secret, secretV3);
    assert.strictEqual(cached.previousSecret, secretV2);
    assert.ok(cached.graceUntil > Date.now() + 290000, 'graceUntil must be ~5 minutes in future');

    // At t = 0: Both V3 and V2 MUST authenticate
    assert.strictEqual(await registry.authenticate('bot-cache', secretV3), true, 'New secret V3 authenticates');
    assert.strictEqual(await registry.authenticate('bot-cache', secretV2), true, 'Previous secret V2 authenticates during grace');
    assert.strictEqual(registry.verifyBotSecretSync('bot-cache', secretV3), true);
    assert.strictEqual(registry.verifyBotSecretSync('bot-cache', secretV2), true);

    // Oldest secret V1 MUST FAIL
    assert.strictEqual(await registry.authenticate('bot-cache', secretOriginal), false, 'Oldest secret V1 is rejected');

    // Fast-forward grace period past 5 minutes (graceUntil expired)
    cached.graceUntil = Date.now() - 500;

    // Previous secret V2 MUST NOW FAIL!
    assert.strictEqual(await registry.authenticate('bot-cache', secretV2), false, 'Previous secret V2 must be rejected after grace expired');
    assert.strictEqual(registry.verifyBotSecretSync('bot-cache', secretV2), false, 'verifyBotSecretSync rejects V2 after grace expired');

    // Current secret V3 STILL WORKS!
    assert.strictEqual(await registry.authenticate('bot-cache', secretV3), true, 'Current secret V3 continues working');

    // Sub-attack 2.4: BotWorker auth middleware grace check (`requireWorkerSecret`)
    const mockReq = (sec) => ({ get: (h) => (h.toLowerCase() === 'x-worker-secret' ? sec : null), headers: { 'x-worker-secret': sec } });
    const mockRes = () => {
      const res = { statusCode: 200, body: null };
      res.status = (code) => { res.statusCode = code; return res; };
      res.json = (b) => { res.body = b; return res; };
      return res;
    };

    let nextCalled = false;
    const next = () => { nextCalled = true; };

    // During grace:
    const activeMw = requireWorkerSecret('new-token', { previousSecret: 'old-token', graceUntil: Date.now() + 300000 });
    nextCalled = false;
    activeMw(mockReq('new-token'), mockRes(), next);
    assert.strictEqual(nextCalled, true, 'Worker middleware accepts new token');

    nextCalled = false;
    activeMw(mockReq('old-token'), mockRes(), next);
    assert.strictEqual(nextCalled, true, 'Worker middleware accepts old token during grace');

    nextCalled = false;
    const r1 = mockRes();
    activeMw(mockReq('fake-token'), r1, next);
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(r1.statusCode, 401, 'Worker middleware rejects fake token');

    // After grace expired:
    const expiredMw = requireWorkerSecret('new-token', { previousSecret: 'old-token', graceUntil: Date.now() - 1000 });
    nextCalled = false;
    const r2 = mockRes();
    expiredMw(mockReq('old-token'), r2, next);
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(r2.statusCode, 401, 'Worker middleware rejects old token after grace expired');
  }
  console.log('🛡️  ATTACK 2 PASSED: Secret Cache TTL (60s) and Rotation Grace (5m) verified.\n');

  // ---------------------------------------------------------------------------
  // ATTACK 3: Global Bot Secret Scoping (WORKER-03)
  // ---------------------------------------------------------------------------
  console.log('>>> [ATTACK 3] Stress-Testing Global Bot Secret Scoping (WORKER-03)...');
  {
    const globalSecret = 'secret-global-master-xyz789';
    const workerStore = createMockWorkerStore();
    const logger = createMockLogger();

    const app = createApp({
      store: {
        getUser: async () => null,
        getAccess: async () => null,
        listUsers: async () => [],
        adapter: {
          fetchManagerAuthorization: async () => null,
          testConnection: async () => ({ ok: true }),
          isEnabled: () => true
        }
      },
      entitlementService: {},
      registry: {
        find: async () => null,
        list: async () => [],
        verifyBotSecretSync: () => false,
        verifyBotSecret: async () => false
      },
      broker: {},
      workerStore,
      fleetOperations: {},
      adminNotifier: null,
      discordClient: null,
      config: {
        botSecretKey: globalSecret,
        webSessionTtlHours: 24
      },
      logger
    });

    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
      // Vector 3.1: Attack non-worker endpoints with x-bot-secret: <globalSecret>
      const nonWorkerTargets = [
        '/api/manager/bots',
        '/api/manager/audit-logs',
        '/api/manager/users',
        '/api/user/settings',
        '/api/change-password'
      ];

      for (const target of nonWorkerTargets) {
        logger.logs.warn = [];
        const res = await fetch(`${base}${target}`, {
          method: 'GET',
          headers: {
            'x-bot-secret': globalSecret
          }
        });

        // Must NOT authenticate as user/admin; must return 401 or 404
        assert.ok([401, 403, 404].includes(res.status), `Non-worker route ${target} must reject global bot secret, got ${res.status}`);

        // Must emit GLOBAL_BOT_SECRET_BLOCKED log
        const blockedLog = logger.logs.warn.find((l) => l.msg === 'GLOBAL_BOT_SECRET_BLOCKED');
        assert.ok(blockedLog, `Expected GLOBAL_BOT_SECRET_BLOCKED warning log on ${target}`);
        assert.ok(blockedLog.meta.path.startsWith(target.split('?')[0]), 'Logged path must match requested target');
      }

      // Vector 3.2: Verify authorized worker endpoint receives GLOBAL_BOT_SECRET_USED
      logger.logs.warn = [];
      const workerRes = await fetch(`${base}/api/worker/report`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-bot-secret': globalSecret
        },
        body: JSON.stringify({ workerId: 'bot-1', status: { state: 'online' } })
      });

      // Handled by worker route (workerId bot-1 doesn't exist so 404 is normal, but NOT blocked as global secret)
      const usedLog = logger.logs.warn.find((l) => l.msg === 'GLOBAL_BOT_SECRET_USED');
      assert.ok(usedLog, 'Worker route MUST log GLOBAL_BOT_SECRET_USED when global secret is presented');
    } finally {
      await new Promise((r) => server.close(r));
    }
  }
  console.log('🛡️  ATTACK 3 PASSED: Global bot secret scoping strictly enforced; non-worker routes blocked and audited.\n');

  // ---------------------------------------------------------------------------
  // ATTACK 4: Concurrency in Bot Sequence Generation (WORKER-04)
  // ---------------------------------------------------------------------------
  console.log('>>> [ATTACK 4] Stress-Testing Concurrency in Bot Sequence Generation (WORKER-04)...');
  {
    // Build real SupabaseWorkerStore with mock client simulating missing RPC (fallback path)
    const existingWorkers = [
      { worker_id: 'bot_01', bot_number: 1 },
      { worker_id: 'bot_02', bot_number: 2 },
      { worker_id: 'bot_03', bot_number: 3 }
    ];

    const mockClient = {
      from(table) {
        return {
          select() {
            return {
              order() {
                return {
                  async order() {
                    // Inject artificial jitter delay (5-15ms) to maximize collision window
                    await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 10) + 5));
                    return { data: existingWorkers.map((w) => ({ ...w })), error: null };
                  }
                };
              }
            };
          }
        };
      },
      async rpc(func) {
        // RPC is not available in DB -> triggers fallback
        return { data: null, error: { message: 'function manager_next_bot_number does not exist', code: 'PGRST202' } };
      }
    };

    const store = new SupabaseWorkerStore(mockClient);

    // Launch 60 concurrent nextBotNumber() calls
    const CONCURRENCY = 60;
    console.log(`   Executing ${CONCURRENCY} concurrent nextBotNumber() invocations under random latency jitter...`);
    const promises = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      promises.push(store.nextBotNumber());
    }

    const results = await Promise.all(promises);

    // Verify properties of results
    assert.strictEqual(results.length, CONCURRENCY, `Must produce exactly ${CONCURRENCY} results`);
    const uniqueNumbers = new Set(results);
    assert.strictEqual(uniqueNumbers.size, CONCURRENCY, `ZERO DUPLICATES ALLOWED! Unique count ${uniqueNumbers.size} !== ${CONCURRENCY}`);

    const sorted = [...results].sort((a, b) => a - b);
    assert.strictEqual(sorted[0], 4, 'Starting number after 1, 2, 3 must be 4');
    assert.strictEqual(sorted[sorted.length - 1], 3 + CONCURRENCY, `Final number must be exactly ${3 + CONCURRENCY}`);

    // Verify strictly monotonic consecutive sequence
    for (let i = 0; i < sorted.length; i++) {
      assert.strictEqual(sorted[i], 4 + i, `Number at index ${i} must be ${4 + i}`);
    }
  }
  console.log('🛡️  ATTACK 4 PASSED: 60/60 concurrent nextBotNumber() calls yielded 100% unique, consecutive numbers with 0 collisions.\n');

  // ---------------------------------------------------------------------------
  // ATTACK 5: Disabled Worker Actions (WORKER-05, WORKER-06)
  // ---------------------------------------------------------------------------
  console.log('>>> [ATTACK 5] Stress-Testing Disabled Worker Actions (WORKER-05, WORKER-06)...');
  {
    const workerStore = createMockWorkerStore();
    const logger = createMockLogger();
    const registry = new WorkerRegistry({
      store: workerStore,
      encryptionKey
    });

    await workerStore.create({
      workerId: 'bot-enabled',
      botNumber: 1,
      enabled: true,
      secretCiphertext: encryptSecret('secret-enabled', encryptionKey)
    });

    await workerStore.create({
      workerId: 'bot-disabled',
      botNumber: 2,
      enabled: false,
      secretCiphertext: encryptSecret('secret-disabled', encryptionKey)
    });

    // Sub-attack 5.1: addEvent on non-existent bot
    const ghostEventRes = await registry.addEvent('non-existent-bot', { type: 'test', message: 'hello' });
    assert.strictEqual(ghostEventRes, null, 'addEvent on non-existent bot must return null');

    // Sub-attack 5.2: addEvent on disabled bot
    const disabledEventRes = await registry.addEvent('bot-disabled', { type: 'test', message: 'hello' });
    assert.strictEqual(disabledEventRes, null, 'addEvent on disabled bot must return null');

    // Sub-attack 5.3: addEvent on enabled bot MUST succeed
    const enabledEventRes = await registry.addEvent('bot-enabled', { type: 'test', message: 'hello' });
    assert.ok(enabledEventRes, 'addEvent on enabled bot must return event object');
    assert.strictEqual(enabledEventRes.type, 'test');

    // Sub-attack 5.4: HTTP endpoint POST /api/v1/workers/:workerId/events with disabled worker
    const workerRouter = createWorkerApi({
      registry,
      broker: {},
      workerStore,
      adminNotifier: null,
      config: { botSecretKey: 'global-key' },
      logger
    });
    const app = express();
    app.use(express.json());
    app.use('/api/v1/workers/:workerId', workerRouter);
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
      // 5.4a: Normal flow: disabled worker fails auth middleware with 401
      const disRes = await fetch(`${base}/api/v1/workers/bot-disabled/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-worker-secret': 'secret-disabled' },
        body: JSON.stringify({ type: 'crash', message: 'fail' })
      });
      assert.strictEqual(disRes.status, 401, 'POST /events on disabled worker must fail auth with 401');

      // 5.4b: Defense-in-depth: if auth middleware passes, addEvent returns null -> 404 worker_not_found_or_disabled
      const origAuth = registry.authenticate.bind(registry);
      registry.authenticate = async (id) => (id === 'bot-disabled' ? true : origAuth(id));
      try {
        const disResDeep = await fetch(`${base}/api/v1/workers/bot-disabled/events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-worker-secret': 'secret-disabled' },
          body: JSON.stringify({ type: 'crash', message: 'fail' })
        });
        assert.strictEqual(disResDeep.status, 404, 'POST /events on disabled worker when auth passes must return 404');
        const disJson = await disResDeep.json();
        assert.strictEqual(disJson.error, 'worker_not_found_or_disabled');
      } finally {
        registry.authenticate = origAuth;
      }

      // 5.4c: POST /events on non-existent bot
      const ghostRes = await fetch(`${base}/api/v1/workers/ghost-bot/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-worker-secret': 'any' },
        body: JSON.stringify({ type: 'crash', message: 'fail' })
      });
      assert.strictEqual(ghostRes.status, 401, 'POST /events on ghost worker must fail auth with 401');
    } finally {
      await new Promise((r) => server.close(r));
    }

    // Sub-attack 5.5: rotateSecret on non-existent bot
    await assert.rejects(
      async () => registry.rotateSecret('ghost-bot'),
      /is not registered or is disabled/,
      'rotateSecret on non-existent bot must throw'
    );

    // Sub-attack 5.6: rotateSecret on disabled bot
    await assert.rejects(
      async () => registry.rotateSecret('bot-disabled'),
      /is not registered or is disabled/,
      'rotateSecret on disabled bot must throw'
    );

    // Sub-attack 5.7: rotateSecret on enabled bot succeeds
    const newSec = await registry.rotateSecret('bot-enabled');
    assert.ok(newSec && typeof newSec === 'string' && newSec.length > 10);
  }
  console.log('🛡️  ATTACK 5 PASSED: Disabled and non-existent workers immediately rejected for addEvent and rotateSecret.\n');

  // ---------------------------------------------------------------------------
  // ATTACK 6: BotWorker Diagnostics Exposure (WKR-03)
  // ---------------------------------------------------------------------------
  console.log('>>> [ATTACK 6] Stress-Testing BotWorker Diagnostics Exposure (WKR-03)...');
  {
    const sensitiveDiagnosticPayload = {
      botCount: 3,
      rssMb: 512,
      heapUsedMb: 256,
      wispbyteKeepAlive: {
        cookiesValid: true,
        account: 'admin_private_account_credentials',
        sessionToken: 'SECRET_TOKEN_DO_NOT_LEAK'
      }
    };

    const mockFleet = {
      health() {
        return sensitiveDiagnosticPayload;
      },
      get() { return null; }
    };

    const botSecret = 'botworker-auth-secret-12345';
    const workerRouter = createWorkerHttpRouter({
      fleet: mockFleet,
      config: {
        botCount: 3,
        bots: [{ workerId: 'bot01', secret: botSecret }]
      }
    });

    const app = express();
    app.use(express.json());
    app.use(workerRouter);
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
      // Sub-attack 6.1: Probe public GET /
      const rootRes = await fetch(`${base}/`);
      assert.strictEqual(rootRes.status, 200);
      const rootData = await rootRes.json();
      assert.strictEqual(rootData.ok, true);
      assert.strictEqual(rootData.service, 'kingmc-afk-worker');
      assert.strictEqual(rootData.botCount, 3);
      // Verify NO leakage
      assert.strictEqual(rootData.resource, undefined, 'GET / must NOT leak resource');
      assert.strictEqual(rootData.rssMb, undefined, 'GET / must NOT leak rssMb');
      assert.strictEqual(rootData.heapUsedMb, undefined, 'GET / must NOT leak heapUsedMb');
      assert.strictEqual(rootData.wispbyteKeepAlive, undefined, 'GET / must NOT leak wispbyteKeepAlive');

      // Sub-attack 6.2: Probe public GET /health
      const healthRes = await fetch(`${base}/health`);
      assert.strictEqual(healthRes.status, 200);
      const healthData = await healthRes.json();
      assert.strictEqual(healthData.ok, true);
      assert.strictEqual(healthData.service, 'kingmc-afk-worker');
      assert.strictEqual(healthData.botCount, 3);
      // Verify NO leakage
      assert.strictEqual(healthData.resource, undefined, 'GET /health must NOT leak resource');
      assert.strictEqual(healthData.rssMb, undefined, 'GET /health must NOT leak rssMb');
      assert.strictEqual(healthData.wispbyteKeepAlive, undefined, 'GET /health must NOT leak wispbyteKeepAlive');

      // Sub-attack 6.3: Unauthenticated GET /api/v1/diagnostics
      const noAuthDiag = await fetch(`${base}/api/v1/diagnostics`);
      assert.strictEqual(noAuthDiag.status, 401, 'Unauthenticated diagnostics must return 401');
      const noAuthJson = await noAuthDiag.json();
      assert.strictEqual(noAuthJson.ok, false);
      assert.strictEqual(noAuthJson.error, 'unauthorized');

      // Sub-attack 6.4: Bogus secret on GET /api/v1/diagnostics
      const badAuthDiag = await fetch(`${base}/api/v1/diagnostics`, {
        headers: { 'x-worker-secret': 'attacker_fake_secret' }
      });
      assert.strictEqual(badAuthDiag.status, 401, 'Bogus secret on diagnostics must return 401');

      // Sub-attack 6.5: Authenticated GET /api/v1/diagnostics with valid worker secret
      const authedDiag = await fetch(`${base}/api/v1/diagnostics`, {
        headers: { 'x-worker-secret': botSecret }
      });
      assert.strictEqual(authedDiag.status, 200, 'Valid worker secret must return 200');
      const authedData = await authedDiag.json();
      assert.strictEqual(authedData.ok, true);
      assert.ok(authedData.resource, 'Authenticated diagnostics must include resource');
      assert.strictEqual(authedData.resource.rssMb, 512);
      assert.strictEqual(authedData.resource.heapUsedMb, 256);
      assert.strictEqual(authedData.resource.wispbyteKeepAlive.account, 'admin_private_account_credentials');
    } finally {
      await new Promise((r) => server.close(r));
    }
  }
  console.log('🛡️  ATTACK 6 PASSED: BotWorker diagnostics leakage eliminated; public routes trimmed, diagnostics strictly authenticated.\n');

  console.log('================================================================================');
  console.log('🏆 ALL 6 ADVERSARIAL CHALLENGES EMPIRICALLY PASSED WITH ZERO FAILURES! 🏆');
  console.log('================================================================================');
}

runAdversarialChallenges().catch((err) => {
  console.error('\n💥 ADVERSARIAL CHALLENGE FAILED:', err);
  process.exit(1);
});
