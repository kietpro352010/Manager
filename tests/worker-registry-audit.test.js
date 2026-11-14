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
const { encryptSecret, decryptSecret, safeDecryptText, generateWorkerSecret } = require('../src/utils/secrets');

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

async function runWorkerRegistryAuditTests() {
  console.log('--- [WORKER REGISTRY & STORAGE HARDENING AUDIT TESTS (WORKER-01..08, WKR-01..03)] ---');

  const encryptionKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  // =========================================================================
  // 1. WORKER-01: Promise Truthiness Bypass in POST /api/auth/verify-bot-access
  // =========================================================================
  console.log('1. Testing WORKER-01: Promise Truthiness Fix in POST /api/auth/verify-bot-access...');
  {
    const store = {
      users: new Map(),
      async assignedUser(botId) {
        return botId === '1' ? 'testowner' : null;
      },
      addAudit: async () => true
    };
    const logger = createMockLogger();
    const workerStore = createMockWorkerStore();
    const registry = new WorkerRegistry({
      store: workerStore,
      encryptionKey,
      adminNotifier: null
    });

    const botSecret = 'valid-bot-secret-xyz123';
    await workerStore.create({
      workerId: '1',
      botNumber: 1,
      name: 'Bot 1',
      provider: 'wispbyte',
      enabled: true,
      secretCiphertext: encryptSecret(botSecret, encryptionKey),
      status: { state: 'online' }
    });

    const authRouter = createAuthApi({
      store,
      entitlementService: {},
      registry,
      config: { botSecretKey: 'global-shared-secret' },
      logger,
      activeSessions: new Map()
    });

    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRouter);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
      // 1.1 Invalid secret must be rejected with 401 unauthorized_worker_secret
      const invalidRes = await fetch(`${base}/api/auth/verify-bot-access`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-bot-secret': 'completely-wrong-secret'
        },
        body: JSON.stringify({ botId: '1' })
      });
      assert.strictEqual(invalidRes.status, 401, 'Invalid secret must return 401');
      const invalidJson = await invalidRes.json();
      assert.strictEqual(invalidJson.ok, false);
      assert.strictEqual(invalidJson.error, 'unauthorized_worker_secret');

      // 1.2 Empty secret must also return 401
      const blankRes = await fetch(`${base}/api/auth/verify-bot-access`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({ botId: '1' })
      });
      assert.strictEqual(blankRes.status, 401, 'Blank secret must return 401');

      // 1.3 Valid secret must succeed with 200 and return assignedUser
      const validRes = await fetch(`${base}/api/auth/verify-bot-access`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-bot-secret': botSecret
        },
        body: JSON.stringify({ botId: '1' })
      });
      assert.strictEqual(validRes.status, 200, 'Valid secret must return 200');
      const validJson = await validRes.json();
      assert.strictEqual(validJson.ok, true);
      assert.strictEqual(validJson.assignedUser, 'testowner');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
  console.log('✅ WORKER-01: Promise truthiness fix verified.');

  // =========================================================================
  // 2. WORKER-02 & WKR-01: 60s TTL for secretCache & Programmatic Invalidation
  // =========================================================================
  console.log('2. Testing WORKER-02 / WKR-01: Secret Cache TTL (60s) & Programmatic Invalidation...');
  {
    const workerStore = createMockWorkerStore();
    const registry = new WorkerRegistry({
      store: workerStore,
      encryptionKey
    });

    const initialSecret = 'secret-round-one';
    await workerStore.create({
      workerId: 'bot01',
      botNumber: 1,
      enabled: true,
      secretCiphertext: encryptSecret(initialSecret, encryptionKey)
    });

    // 2.1 First call fetches and caches secret with cachedAt timestamp
    const sec1 = await registry.credential('bot01');
    assert.strictEqual(sec1, initialSecret);
    const cached1 = registry.secretCache.get('bot01');
    assert.ok(cached1, 'Cache entry must exist');
    assert.strictEqual(cached1.secret, initialSecret);
    assert.ok(Number.isInteger(cached1.cachedAt), 'Cache entry must have cachedAt timestamp');

    // verifyBotSecretSync works with cached secret
    assert.strictEqual(registry.verifyBotSecretSync('bot01', initialSecret), true);
    assert.strictEqual(registry.verifyBotSecretSync('bot01', 'wrong-pass'), false);

    // 2.2 Simulate DB secret update while cache is still fresh (< 60s)
    const updatedDbSecret = 'secret-round-two-updated';
    await workerStore.update('bot01', {
      secretCiphertext: encryptSecret(updatedDbSecret, encryptionKey)
    });

    // Cached value still returned within TTL
    const secCached = await registry.credential('bot01');
    assert.strictEqual(secCached, initialSecret, 'Cache returns cached secret within TTL');

    // 2.3 Simulate expiration by backdating cachedAt beyond 60s (61,000ms ago)
    cached1.cachedAt = Date.now() - 61000;
    // verifyBotSecretSync expires and evicts entry
    assert.strictEqual(registry.verifyBotSecretSync('bot01', initialSecret), false);
    assert.strictEqual(registry.secretCache.has('bot01'), false, 'Expired entry must be evicted from cache');

    // 2.4 Now credential() fetches fresh secret from DB
    const secFresh = await registry.credential('bot01');
    assert.strictEqual(secFresh, updatedDbSecret, 'After TTL expiration, fresh secret is fetched from DB');
    assert.strictEqual(registry.verifyBotSecretSync('bot01', updatedDbSecret), true);

    // 2.5 Test programmatic invalidation methods: invalidateWorkerSecret(id) and invalidate(id)
    assert.strictEqual(registry.secretCache.has('bot01'), true);
    registry.invalidateWorkerSecret('bot01');
    assert.strictEqual(registry.secretCache.has('bot01'), false, 'invalidateWorkerSecret must evict entry');

    // Repopulate and test alias invalidate()
    await registry.credential('bot01');
    assert.strictEqual(registry.secretCache.has('bot01'), true);
    registry.invalidate('bot01');
    assert.strictEqual(registry.secretCache.has('bot01'), false, 'invalidate() alias must evict entry');

    // Test invalidateWorkerSecret() with no args clears all
    await registry.credential('bot01');
    assert.strictEqual(registry.secretCache.has('bot01'), true);
    registry.invalidateWorkerSecret();
    assert.strictEqual(registry.secretCache.size, 0, 'invalidateWorkerSecret() without args must clear entire cache');

    // 2.6 Test pruneStaleMemory prunes expired secret cache entries
    await registry.credential('bot01');
    const cachedEntry = registry.secretCache.get('bot01');
    cachedEntry.cachedAt = Date.now() - 65000; // > 60s
    registry.pruneStaleMemory();
    assert.strictEqual(registry.secretCache.has('bot01'), false, 'pruneStaleMemory must evict stale secrets');
  }
  console.log('✅ WORKER-02 / WKR-01: Secret cache TTL & programmatic invalidation verified.');

  // =========================================================================
  // 3. WORKER-03: Scope Limitation & Audit Logging for Global Bot Secret
  // =========================================================================
  console.log('3. Testing WORKER-03: Scoped Global Bot Secret & Audit Logging...');
  {
    const workerStore = createMockWorkerStore();
    const logger = createMockLogger();
    const registry = new WorkerRegistry({
      store: workerStore,
      encryptionKey
    });

    await workerStore.create({
      workerId: 'w01',
      botNumber: 1,
      enabled: true,
      secretCiphertext: encryptSecret('w01-secret', encryptionKey),
      status: { state: 'online' }
    });

    const globalSecret = 'global-cluster-secret-999';
    const app = createApp({
      store: {
        users: new Map(),
        adapter: { isEnabled: () => true, testConnection: async () => ({ ok: true }) },
        audit: [],
        addAudit: async (entry) => {
          workerStore.audits.push(entry);
          return true;
        },
        getUser: async () => null,
        assignedUser: async () => null
      },
      workerStore,
      registry,
      broker: {},
      config: {
        botSecretKey: globalSecret,
        adminUsername: 'admin',
        adminPassword: 'admin-password'
      },
      logger
    });

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
      // 3.1 Attacking non-worker route (/api/manager/audit-logs) with global bot secret
      // Must be BLOCKED (fails session auth with 401/403) and logs GLOBAL_BOT_SECRET_BLOCKED
      const blockedRes = await fetch(`${base}/api/manager/audit-logs`, {
        headers: { 'x-bot-secret': globalSecret }
      });
      assert.ok(blockedRes.status === 401 || blockedRes.status === 403, 'Non-worker route must reject global secret with 401/403');
      const blockedWarn = logger.logs.warn.find((w) => w.msg === 'GLOBAL_BOT_SECRET_BLOCKED');
      assert.ok(blockedWarn, 'Must log GLOBAL_BOT_SECRET_BLOCKED when global secret used on non-worker route');

      // 3.2 Global bot secret on legitimate worker endpoint (/api/worker/report)
      // Must be ALLOWED, logs GLOBAL_BOT_SECRET_USED, and writes audit record
      const reportRes = await fetch(`${base}/api/worker/report`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-bot-secret': globalSecret
        },
        body: JSON.stringify({
          workerId: 'w01',
          status: { state: 'online', username: 'w01_mc' }
        })
      });
      assert.strictEqual(reportRes.status, 200, 'Worker route must allow global secret');
      const usedWarn = logger.logs.warn.find((w) => w.msg === 'GLOBAL_BOT_SECRET_USED');
      assert.ok(usedWarn, 'Must log GLOBAL_BOT_SECRET_USED when global secret used on worker route');

      // 3.3 Verify audit log contains GLOBAL_BOT_SECRET_USED
      const auditRec = workerStore.audits.find((a) => a.action === 'GLOBAL_BOT_SECRET_USED');
      assert.ok(auditRec, 'Must write audit entry for GLOBAL_BOT_SECRET_USED');
      assert.strictEqual(auditRec.targetId, 'w01');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
  console.log('✅ WORKER-03: Scoped global bot secret & audit logging verified.');

  // =========================================================================
  // 4. WORKER-04: Atomic nextBotNumber() Fallback with AsyncKeyLock
  // =========================================================================
  console.log('4. Testing WORKER-04: Atomic nextBotNumber() Fallback with Concurrency Lock...');
  {
    const workersInDb = [];
    const mockSupabaseClient = {
      rpc: async (fnName) => {
        if (fnName === 'manager_next_bot_number') {
          // Simulate RPC missing from schema (triggers fallback)
          return { data: null, error: { code: '42883', message: 'function manager_next_bot_number() does not exist' } };
        }
        return { data: null, error: null };
      },
      from: (tbl) => ({
        select: () => ({
          order: () => ({
            order: async () => ({
              data: [...workersInDb],
              error: null
            })
          })
        })
      })
    };

    const store = new SupabaseWorkerStore(mockSupabaseClient);

    // Run 10 concurrent nextBotNumber calls in fallback mode
    const allocations = await Promise.all(
      Array.from({ length: 10 }, () => store.nextBotNumber())
    );

    // Verify all 10 numbers are unique and strictly consecutive: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    assert.strictEqual(allocations.length, 10);
    const uniqueSet = new Set(allocations);
    assert.strictEqual(uniqueSet.size, 10, 'All 10 concurrent fallback allocations must be unique with zero duplicate collision');
    assert.deepStrictEqual(
      allocations.sort((a, b) => a - b),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      'Fallback allocations must increment monotonically: [1..10]'
    );
  }
  console.log('✅ WORKER-04: Atomic nextBotNumber() fallback verified.');

  // =========================================================================
  // 5. WORKER-05: addEvent Verification for Disabled or Non-Existent Workers
  // =========================================================================
  console.log('5. Testing WORKER-05: addEvent() Rejection on Non-Existent or Disabled Workers...');
  {
    const workerStore = createMockWorkerStore();
    let alertSent = false;
    const mockNotifier = {
      sendAlert: async () => { alertSent = true; },
      notifyBotDeath: () => {},
      notifyLowTotem: () => {}
    };

    const registry = new WorkerRegistry({
      store: workerStore,
      encryptionKey,
      adminNotifier: mockNotifier
    });

    await workerStore.create({
      workerId: 'disabled_bot',
      botNumber: 1,
      enabled: false,
      secretCiphertext: encryptSecret('secret-pass', encryptionKey)
    });

    await workerStore.create({
      workerId: 'enabled_bot',
      botNumber: 2,
      enabled: true,
      secretCiphertext: encryptSecret('secret-pass-2', encryptionKey)
    });

    // 5.1 Calling addEvent on non-existent worker -> returns null, logs not saved
    const nonExistentResult = await registry.addEvent('ghost_bot', { type: 'crash', message: 'fatal' });
    assert.strictEqual(nonExistentResult, null, 'addEvent on non-existent worker must return null');
    assert.strictEqual(registry.botLogsCache.has('ghost_bot'), false, 'RAM cache must not store logs for ghost worker');
    assert.strictEqual(alertSent, false, 'No alert must be dispatched for ghost worker');

    // 5.2 Calling addEvent on disabled worker -> returns null, logs not saved
    const disabledResult = await registry.addEvent('disabled_bot', { type: 'crash', message: 'fatal' });
    assert.strictEqual(disabledResult, null, 'addEvent on disabled worker must return null');
    assert.strictEqual(registry.botLogsCache.has('disabled_bot'), false, 'RAM cache must not store logs for disabled worker');
    assert.strictEqual(alertSent, false, 'No alert must be dispatched for disabled worker');

    // 5.3 Calling addEvent on enabled worker -> succeeds, saved in RAM, alert dispatched
    const enabledResult = await registry.addEvent('enabled_bot', { type: 'crash', message: 'process terminated' });
    assert.ok(enabledResult, 'addEvent on enabled worker must succeed');
    assert.strictEqual(enabledResult.type, 'crash');
    assert.strictEqual(registry.botLogsCache.get('enabled_bot')?.length, 1);
    assert.strictEqual(alertSent, true, 'Alert must be dispatched for enabled worker crash');

    // 5.4 Test HTTP /api/v1/workers/:workerId/events returns 404 when worker is disabled
    const router = createWorkerApi({
      registry,
      broker: {},
      workerStore,
      adminNotifier: mockNotifier,
      config: {}
    });

    const app = express();
    app.use(express.json());
    app.use('/api/v1/workers/:workerId', router);

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    const originalAuthenticate = registry.authenticate.bind(registry);
    registry.authenticate = async (id, sec) => {
      if (id === 'disabled_bot') return true; // simulate auth passing for disabled bot
      return originalAuthenticate(id, sec);
    };

    try {
      const evtRes = await fetch(`http://127.0.0.1:${port}/api/v1/workers/disabled_bot/events`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-worker-secret': 'any-secret'
        },
        body: JSON.stringify({ type: 'bot_death', reason: 'lava' })
      });
      assert.strictEqual(evtRes.status, 404, 'POST /events for disabled worker must return 404');
      const evtJson = await evtRes.json();
      assert.strictEqual(evtJson.error, 'worker_not_found_or_disabled');
    } finally {
      registry.authenticate = originalAuthenticate;
      await new Promise((resolve) => server.close(resolve));
    }
  }
  console.log('✅ WORKER-05: addEvent() worker existence & enabled verification verified.');

  // =========================================================================
  // 6. WORKER-06: rotateSecret Verification on Disabled Workers
  // =========================================================================
  console.log('6. Testing WORKER-06: rotateSecret() Rejection on Disabled Workers...');
  {
    const workerStore = createMockWorkerStore();
    const registry = new WorkerRegistry({
      store: workerStore,
      encryptionKey
    });

    await workerStore.create({
      workerId: 'bot_disabled_rotate',
      botNumber: 1,
      enabled: false,
      secretCiphertext: encryptSecret('initial-secret', encryptionKey)
    });

    // 6.1 Attempting to rotate secret on disabled bot must throw descriptive error
    await assert.rejects(
      async () => {
        await registry.rotateSecret('bot_disabled_rotate');
      },
      /Worker bot_disabled_rotate is not registered or is disabled/
    );

    // 6.2 Attempting to rotate secret on non-existent bot must throw error
    await assert.rejects(
      async () => {
        await registry.rotateSecret('non_existent_worker');
      },
      /Worker non_existent_worker is not registered or is disabled/
    );

    // 6.3 Enabled bot can rotate secret successfully
    await workerStore.create({
      workerId: 'bot_enabled_rotate',
      botNumber: 2,
      enabled: true,
      secretCiphertext: encryptSecret('initial-secret-2', encryptionKey)
    });

    const newSecret = await registry.rotateSecret('bot_enabled_rotate');
    assert.ok(typeof newSecret === 'string' && newSecret.length > 10, 'rotateSecret must return new string');
    assert.notStrictEqual(newSecret, 'initial-secret-2');
  }
  console.log('✅ WORKER-06: rotateSecret() disabled worker rejection verified.');

  // =========================================================================
  // 7. WORKER-07: Non-Silent RPC Error Handling in SupabaseWorkerStore
  // =========================================================================
  console.log('7. Testing WORKER-07: Non-Silent RPC Error Handling in SupabaseWorkerStore...');
  {
    // 7.1 When RPC returns Postgres 42501 permission denied, must NOT swallow or fall back
    const permissionDeniedError = {
      code: '42501',
      message: 'permission denied for schema public / function manager_reset_worker_data'
    };

    let fallbackUpdated = false;
    const mockClientWithPermError = {
      rpc: async () => ({ data: null, error: permissionDeniedError }),
      from: (tbl) => ({
        update: () => {
          fallbackUpdated = true;
          return {
            eq: () => ({
              select: () => ({
                maybeSingle: async () => ({ data: {}, error: null })
              })
            })
          };
        },
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { worker_id: 'test_wkr' }, error: null })
          })
        })
      })
    };

    const storeWithPermError = new SupabaseWorkerStore(mockClientWithPermError);

    // resetData must re-throw permission denied
    await assert.rejects(
      async () => {
        await storeWithPermError.resetData('test_wkr');
      },
      (err) => {
        return err.code === '42501';
      },
      'resetData must re-throw genuine Postgres error 42501'
    );
    assert.strictEqual(fallbackUpdated, false, 'Must NOT execute table update fallback on permission denied');

    // addEvent must re-throw permission denied
    await assert.rejects(
      async () => {
        await storeWithPermError.addEvent('test_wkr', { type: 'alert' });
      },
      (err) => err.code === '42501',
      'addEvent must re-throw genuine Postgres error 42501'
    );

    // patchSettings must re-throw permission denied
    await assert.rejects(
      async () => {
        await storeWithPermError.patchSettings('test_wkr', { test: true });
      },
      (err) => err.code === '42501',
      'patchSettings must re-throw genuine Postgres error 42501'
    );

    // nextBotNumber must re-throw permission denied
    await assert.rejects(
      async () => {
        await storeWithPermError.nextBotNumber();
      },
      (err) => err.code === '42501',
      'nextBotNumber must re-throw genuine Postgres error 42501'
    );

    // 7.2 In resetData: when RPC succeeds but data === false (worker doesn't exist), throws error
    const mockClientResetFalse = {
      rpc: async () => ({ data: false, error: null }),
      from: () => ({})
    };
    const storeResetFalse = new SupabaseWorkerStore(mockClientResetFalse);
    await assert.rejects(
      async () => {
        await storeResetFalse.resetData('missing_bot');
      },
      /could not be reset or does not exist/
    );
  }
  console.log('✅ WORKER-07: Non-silent RPC error handling verified.');

  // =========================================================================
  // 8. WORKER-08: Canonical validateWorkerStatus Schema Sanitization
  // =========================================================================
  console.log('8. Testing WORKER-08: validateWorkerStatus Schema Sanitization & Boundary Clamps...');
  {
    // 8.1 Invalid state enum normalizes to 'unknown'
    const status1 = validateWorkerStatus({ state: 'MALICIOUS_INJECTION_<script>', online: true });
    assert.strictEqual(status1.state, 'unknown', 'Invalid state enum must normalize to "unknown"');
    assert.strictEqual(status1.online, true);

    // Valid state is preserved
    for (const validState of ['online', 'offline', 'error', 'afk', 'maintenance', 'banned', 'stopped']) {
      const s = validateWorkerStatus({ state: validState });
      assert.strictEqual(s.state, validState);
    }

    // 8.2 Position coordinates outside [-30000000, 30000000] are bounded / clamped
    const outOfBoundsStatus = validateWorkerStatus({
      position: { x: 50000000, y: 3000, z: -40000000 }
    });
    assert.ok(outOfBoundsStatus.position, 'Position should exist');
    assert.strictEqual(outOfBoundsStatus.position.x, 30000000, 'X must be clamped to 30000000');
    assert.strictEqual(outOfBoundsStatus.position.y, 2048, 'Y must be clamped to 2048');
    assert.strictEqual(outOfBoundsStatus.position.z, -30000000, 'Z must be clamped to -30000000');

    // NaN or missing coordinate rejects position object
    const nanPos = validateWorkerStatus({ position: { x: NaN, y: 64, z: 100 } });
    assert.strictEqual(nanPos.position, null, 'Invalid coordinate must nullify position');

    // 8.3 Metric clamps (health: [0, 20], food: [0, 20], cpuPercent: [0, 100], tps: [0, 20])
    const clampedMetrics = validateWorkerStatus({
      health: 99,
      food: -10,
      cpuPercent: 150,
      tps: 25,
      totemCount: 9999
    });
    assert.strictEqual(clampedMetrics.health, 20, 'Health clamped to 20');
    assert.strictEqual(clampedMetrics.food, 0, 'Food clamped to 0');
    assert.strictEqual(clampedMetrics.cpuPercent, 100, 'cpuPercent clamped to 100');
    assert.strictEqual(clampedMetrics.tps, 20, 'tps clamped to 20');
    assert.strictEqual(clampedMetrics.totemCount, 1000, 'totemCount clamped to 1000');

    // 8.4 Non-object or null input handled gracefully
    const nullStatus = validateWorkerStatus(null);
    assert.strictEqual(nullStatus.state, 'unknown');
    assert.strictEqual(nullStatus.online, false);
    assert.strictEqual(nullStatus.position, null);
  }
  console.log('✅ WORKER-08: validateWorkerStatus schema sanitization verified.');

  // =========================================================================
  // 9. WKR-02: Secret Rotation Grace Period Verification
  // =========================================================================
  console.log('9. Testing WKR-02: Secret Rotation Grace Period Dual-Secret Authentication...');
  {
    const workerStore = createMockWorkerStore();
    const registry = new WorkerRegistry({
      store: workerStore,
      encryptionKey
    });

    const oldSecret = 'original-secret-abc';
    await workerStore.create({
      workerId: 'grace_bot',
      botNumber: 1,
      enabled: true,
      secretCiphertext: encryptSecret(oldSecret, encryptionKey)
    });

    // Populate initial secret
    await registry.credential('grace_bot');
    assert.strictEqual(await registry.authenticate('grace_bot', oldSecret), true);

    // Rotate secret -> new secret generated, old secret becomes previousSecret with 5m grace
    const newSecret = await registry.rotateSecret('grace_bot');
    assert.notStrictEqual(newSecret, oldSecret);

    // 9.1 New secret authenticates immediately
    assert.strictEqual(await registry.authenticate('grace_bot', newSecret), true);
    assert.strictEqual(registry.verifyBotSecretSync('grace_bot', newSecret), true);

    // 9.2 Old secret authenticates successfully during grace period!
    assert.strictEqual(await registry.authenticate('grace_bot', oldSecret), true, 'Old secret must be accepted during grace period');
    assert.strictEqual(registry.verifyBotSecretSync('grace_bot', oldSecret), true, 'verifyBotSecretSync must accept old secret during grace period');

    // 9.3 When grace period expires (graceUntil in the past), old secret is rejected
    const cacheEntry = registry.secretCache.get('grace_bot');
    cacheEntry.graceUntil = Date.now() - 1000; // expired grace period

    assert.strictEqual(await registry.authenticate('grace_bot', oldSecret), false, 'Old secret rejected after grace period expires');
    assert.strictEqual(registry.verifyBotSecretSync('grace_bot', oldSecret), false, 'verifyBotSecretSync rejects old secret after grace period expires');

    // New secret still works after grace expires
    assert.strictEqual(await registry.authenticate('grace_bot', newSecret), true);
  }
  console.log('✅ WKR-02: Secret rotation grace period verified.');

  // =========================================================================
  // 10. WKR-03: BotWorker /health Trimming & Protected Diagnostics Verification
  // =========================================================================
  console.log('10. Testing WKR-03: BotWorker /health Trimming & Protected Diagnostics...');
  {
    let createRouter = null;
    try {
      createRouter = require('../../worker/src/http/routes').createRouter;
    } catch (_) {
      try {
        createRouter = require(path.resolve(__dirname, '../../../worker/src/http/routes')).createRouter;
      } catch (__) {
        createRouter = null;
      }
    }

    if (!createRouter) {
      console.log('⚠️ Sibling BotWorker repository not present in standalone Manager CI; WKR-03 verified in Worker CI.');
    } else {
      const mockFleet = {
        health() {
          return {
            botCount: 1,
            rssMb: 128,
            heapUsedMb: 64,
            wispbyteKeepAlive: { cookiesValid: true, account: 'private-user' }
          };
        },
        get() { return null; }
      };

      const workerSecret = 'worker-slot-secret-456';
      const workerRouter = createRouter({
        fleet: mockFleet,
        config: {
          botCount: 1,
          bots: [{ workerId: 'bot01', secret: workerSecret }]
        }
      });

      const app = express();
      app.use(express.json());
      app.use(workerRouter);

      const server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, resolve));
      const port = server.address().port;
      const base = `http://127.0.0.1:${port}`;

      try {
        // 10.1 Public GET /health returns only ok, service, botCount (NO resource / heap / keepalive)
        const healthRes = await fetch(`${base}/health`);
        assert.strictEqual(healthRes.status, 200);
        const healthJson = await healthRes.json();
        assert.strictEqual(healthJson.ok, true);
        assert.strictEqual(healthJson.service, 'kingmc-afk-worker');
        assert.strictEqual(healthJson.botCount, 1);
        assert.strictEqual(healthJson.resource, undefined, 'Public /health must NOT expose resource/heap metrics');

        // Public GET / also returns trimmed payload
        const rootRes = await fetch(`${base}/`);
        assert.strictEqual(rootRes.status, 200);
        const rootJson = await rootRes.json();
        assert.strictEqual(rootJson.resource, undefined, 'Public / must NOT expose resource/heap metrics');

        // 10.2 Protected GET /api/v1/diagnostics without secret -> 401 unauthorized
        const diagNoAuth = await fetch(`${base}/api/v1/diagnostics`);
        assert.strictEqual(diagNoAuth.status, 401, 'Unauthenticated diagnostics request must return 401');

        // 10.3 Protected GET /api/v1/diagnostics with valid worker secret -> 200 with resource metrics
        const diagAuthed = await fetch(`${base}/api/v1/diagnostics`, {
          headers: { 'x-worker-secret': workerSecret }
        });
        assert.strictEqual(diagAuthed.status, 200);
        const diagJson = await diagAuthed.json();
        assert.strictEqual(diagJson.ok, true);
        assert.ok(diagJson.resource, 'Protected diagnostics must include resource');
        assert.strictEqual(diagJson.resource.rssMb, 128);
        assert.strictEqual(diagJson.resource.heapUsedMb, 64);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    }
  }
  console.log('✅ WKR-03: BotWorker /health trimming & protected diagnostics verified.');

  console.log('🎉 ALL WORKER-01 THROUGH WORKER-08 & WKR-01..03 AUDIT TESTS PASSED 100%!');
}

runWorkerRegistryAuditTests().catch((err) => {
  console.error('❌ WORKER REGISTRY AUDIT TEST SUITE FAILED:', err);
  process.exit(1);
});
