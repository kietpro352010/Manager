'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const vm = require('node:vm');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const express = require('express');

const { createApp } = require('../src/http/app');
const { createAdminApi } = require('../src/http/routes/admin-api');
const { createUserApi } = require('../src/http/routes/user-api');
const { createAuthApi, hashSessionToken } = require('../src/http/routes/auth-api');
const { createWorkerApi } = require('../src/http/routes/worker-api');
const { isLocalOrPrivateHost, isPrivateOrBlockedIp, validateSafeBotUrl, validateProxyUrl } = require('../src/services/proxy-validation');
const { WorkerRegistry } = require('../src/services/worker-registry');
const CommandBroker = require('../src/services/command-broker');
const { EntitlementService } = require('../src/services/entitlement-service');
const { AdminNotifier } = require('../src/services/admin-notifier');
const SupabaseWorkerStore = require('../src/storage/supabase-worker-store');
const SupabaseDashboardStore = require('../src/storage/supabase-dashboard-store');
const SupabaseCommandStore = require('../src/storage/supabase-command-store');
const { SupabaseAdapter } = require('../src/storage/supabase-client');
const { createCaptchaToken, verifyCaptchaToken } = require('../src/services/captcha');
const WispbyteKeepAliveManager = require('../src/services/wispbyte-keepalive');
const { validatePanelUrl } = WispbyteKeepAliveManager;
const {
  encryptSecret,
  encryptUserPassword,
  decryptUserPassword,
  hashPassword,
  timingSafeStringEquals
} = require('../src/utils/secrets');
const { createLogger } = require('../src/utils/logger');
const { fetchWithRetry } = require('../src/utils/http');
const {
  renderBotDetail,
  renderBotLogs,
  buildAdminPasswordModal
} = require('../src/discord/panels/renderer');
const { handlePanelInteraction } = require('../src/discord/handlers/panel-handler');
const adminCommand = require('../src/discord/commands/admin');
const {
  HTML: DASHBOARD_HTML,
  SHELL_HTML: DASHBOARD_SHELL_HTML,
  STYLES: DASHBOARD_STYLES,
  SCRIPTS: DASHBOARD_SCRIPTS,
  CSS_PATH,
  JS_PATH
} = require('../src/http/views/dashboard-html');
const { PUBLIC_LOGIN_HTML } = require('../src/http/views/login-html');

const ENC_KEY = crypto.randomBytes(32);
const SECRET_32 = 'a'.repeat(40);

function silentLogger() {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

async function startServer(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => {
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      return new Promise((resolve) => server.close(resolve));
    }
  };
}

function createInMemoryWorkerStore() {
  const map = new Map();
  let nextNum = 1;
  return {
    async list() { return [...map.values()].map((w) => structuredClone(w)); },
    async get(id) { const w = map.get(String(id)); return w ? structuredClone(w) : null; },
    async getByNumber(num) {
      for (const w of map.values()) if (Number(w.botNumber) === Number(num)) return structuredClone(w);
      return null;
    },
    async upsert(w) { map.set(String(w.workerId), structuredClone(w)); return structuredClone(w); },
    async create(w) { map.set(String(w.workerId), structuredClone(w)); return structuredClone(w); },
    async update(id, patch) {
      const cur = map.get(String(id));
      if (!cur) return null;
      const merged = { ...cur, ...patch };
      map.set(String(id), structuredClone(merged));
      return structuredClone(merged);
    },
    async patchSettings(id, patch) {
      const cur = map.get(String(id));
      if (!cur) return null;
      const merged = { ...cur, settings: { ...(cur.settings || {}), ...(patch || {}) } };
      map.set(String(id), structuredClone(merged));
      return structuredClone(merged);
    },
    async updateStatus(id, status, lastHeartbeat) {
      const cur = map.get(String(id));
      if (!cur) return null;
      const merged = { ...cur, status: structuredClone(status), lastHeartbeat: lastHeartbeat || cur.lastHeartbeat };
      map.set(String(id), structuredClone(merged));
      return structuredClone(merged);
    },
    async remove(id) { return map.delete(String(id)); },
    async nextBotNumber() { return nextNum++; },
    async addEvent() { return true; },
    invalidateCache() {}
  };
}

// ----------------------------------------------------------------------------
// DA-P0-01: Static immutable Brotli/Gzip assets + 15s poll auth cache + 10s /ready cache
// ----------------------------------------------------------------------------
test('DA-P0-01: Static hashed CSS/JS Brotli+immutable bypass auth DB, poll cache vs fail-closed /me, /ready cache', async () => {
  let authDbCalls = 0;
  let dbPingCalls = 0;
  const sessionToken = 'tok_test_da_p0_01_1234567890';
  const tokenHash = hashSessionToken(sessionToken);

  const userRec = {
    id: 'usr_alice',
    userId: 'usr_alice',
    username: 'alice',
    role: 'user',
    status: 'active',
    isPermanent: false,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    assignedBotIds: ['bot-1']
  };

  const store = {
    adapter: {
      async testConnection() {
        dbPingCalls += 1;
        return { ok: true };
      },
      async fetchManagerAuthorization(hash) {
        authDbCalls += 1;
        if (hash !== tokenHash) return { ok: false, session: null, user: null };
        return {
          ok: true,
          session: {
            tokenHash: hash,
            userId: 'usr_alice',
            username: 'alice',
            role: 'user',
            expiresAt: Date.now() + 3600000
          },
          user: userRec
        };
      }
    },
    async getAccess() { return userRec; },
    async getUser() { return userRec; },
    async listAccess() { return [userRec]; },
    async getSetting() { return null; },
    async addAudit() {},
    invalidateCache() {}
  };

  const registry = new WorkerRegistry({ store: createInMemoryWorkerStore(), encryptionKey: ENC_KEY, logger: silentLogger() });
  await registry.add({ workerId: 'bot-1', secret: SECRET_32, provider: 'wispbyte', name: 'Bot Alpha' });

  const app = createApp({
    store,
    registry,
    broker: { async dispatch() { return { delivered: true, result: { ok: true } }; } },
    fleetOperations: {},
    config: { adminUsername: 'admin', encryptionKey: ENC_KEY },
    logger: silentLogger()
  });

  const srv = await startServer(app);
  try {
    // 1. Static CSS & JS served with Brotli + immutable + 0 auth DB calls
    const cssRes = await new Promise((resolve, reject) => {
      const req = http.get(`${srv.baseUrl}${CSS_PATH}`, { headers: { 'Accept-Encoding': 'br, gzip', Cookie: `kingmc_mgr_session=${sessionToken}` } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
    });
    assert.strictEqual(cssRes.status, 200);
    assert.strictEqual(cssRes.headers['content-encoding'], 'br');
    assert.ok(String(cssRes.headers['cache-control']).includes('immutable'));
    assert.strictEqual(zlib.brotliDecompressSync(cssRes.body).toString('utf8'), DASHBOARD_STYLES);
    assert.strictEqual(authDbCalls, 0, 'Static hashed CSS must never hit auth DB');

    // ETag 304 check on JS
    const jsRes1 = await fetch(`${srv.baseUrl}${JS_PATH}`);
    assert.strictEqual(jsRes1.status, 200);
    const jsEtag = jsRes1.headers.get('etag');
    const jsRes304 = await fetch(`${srv.baseUrl}${JS_PATH}`, { headers: { 'If-None-Match': jsEtag } });
    assert.strictEqual(jsRes304.status, 304);
    assert.strictEqual(authDbCalls, 0, 'Static hashed JS must never hit auth DB');

    // 2. Authenticated GET / returns lightweight SHELL_HTML referencing hashed CSS/JS
    const rootRes = await fetch(`${srv.baseUrl}/`, { headers: { Cookie: `kingmc_mgr_session=${sessionToken}` } });
    assert.strictEqual(rootRes.status, 200);
    const rootHtml = await rootRes.text();
    assert.ok(rootHtml.includes(CSS_PATH), 'Dashboard shell must link external hashed CSS');
    assert.ok(rootHtml.includes(JS_PATH), 'Dashboard shell must load external hashed JS');
    assert.strictEqual(rootHtml, DASHBOARD_SHELL_HTML);
    const callsAfterRoot = authDbCalls;

    // 3. Repeated read-only poll GET /api/manager/bots hits 15s RAM auth cache (0 extra DB auth calls)
    const poll1 = await fetch(`${srv.baseUrl}/api/manager/bots`, { headers: { Cookie: `kingmc_mgr_session=${sessionToken}` } });
    assert.strictEqual(poll1.status, 200);
    const callsAfterPoll1 = authDbCalls;
    const poll2 = await fetch(`${srv.baseUrl}/api/manager/bots`, { headers: { Cookie: `kingmc_mgr_session=${sessionToken}` } });
    assert.strictEqual(poll2.status, 200);
    assert.strictEqual(authDbCalls, callsAfterPoll1, 'Subsequent read-only poll within 15s must reuse verified RAM auth cache');
    assert.ok(callsAfterPoll1 <= callsAfterRoot + 1);

    // 4. /api/auth/me MUST remain fail-closed against DB
    const meRes = await fetch(`${srv.baseUrl}/api/auth/me`, { headers: { Cookie: `kingmc_mgr_session=${sessionToken}` } });
    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(authDbCalls, callsAfterPoll1 + 1, '/api/auth/me must always re-verify against DB');

    // 5. /ready caches DB probe for 10s
    const ready1 = await fetch(`${srv.baseUrl}/ready`);
    const ready2 = await fetch(`${srv.baseUrl}/ready`);
    assert.strictEqual(ready1.status, 200);
    assert.strictEqual(ready2.status, 200);
    assert.strictEqual(dbPingCalls, 1, '/ready DB ping must be cached for 10s');
  } finally {
    await srv.close();
  }
});

// ----------------------------------------------------------------------------
// DA-P0-02: Zero fetchUsersSnapshot on login/register, rental expiresAt, expired key anti-multi-account fix
// ----------------------------------------------------------------------------
test('DA-P0-02: Login/register skip fetchUsersSnapshot, return rental expiresAt, block expired/used key exemption', async () => {
  let snapshotCalls = 0;
  let createdSessionCountArg = null;
  const users = new Map();
  const keys = new Map([
    ['KEY-EXPIRED', { id: 'k1', code: 'KEY-EXPIRED', status: 'unused', days: 7, maxUses: 1, usedCount: 0, expiresAt: new Date(Date.now() - 60000).toISOString() }],
    ['KEY-USED', { id: 'k2', code: 'KEY-USED', status: 'used', days: 7, maxUses: 1, usedCount: 1, expiresAt: new Date(Date.now() + 86400000).toISOString() }]
  ]);

  const store = {
    adapter: {
      async fetchUsersSnapshot() { snapshotCalls += 1; return []; },
      async createManagerUserSession(_s, countArg) { createdSessionCountArg = countArg; return true; },
      async deleteManagerUserSession() { return true; }
    },
    async getUser(username) { return users.get(String(username).toLowerCase()) || null; },
    async getAccess(id) {
      for (const u of users.values()) if (u.id === id || u.username === String(id).toLowerCase()) return u;
      return null;
    },
    async setAccess(id, data) {
      const rec = { id, userId: id, ...data };
      users.set(String(rec.username).toLowerCase(), rec);
      return rec;
    },
    async getKey(code) { return keys.get(String(code).toUpperCase()) || null; },
    async getSetting(k) { return k === 'system_settings' ? { trialGiftEnabled: false, trialDays: 1 } : null; },
    async listIpWhitelist() { return []; },
    async isIpWhitelisted() { return false; },
    async countUsersByIp() { return 2; }, // Already 2 accounts from this IP!
    async countUsersByFingerprint() { return 0; },
    async addAudit() {},
    invalidateUserCache() {}
  };

  const authApp = express();
  authApp.use(express.json());
  const activeSessions = new Map();
  authApp.use('/api/auth', createAuthApi({
    store,
    entitlementService: { async redeemKey() { return { ok: false, error: 'Key không hợp lệ' }; } },
    registry: { encryptionKey: ENC_KEY, getAdminPassword: () => null },
    config: { adminUsername: 'admin', encryptionKey: ENC_KEY, trialGiftEnabled: false },
    logger: silentLogger(),
    activeSessions
  }));

  const srv = await startServer(authApp);
  try {
    // Expired key must NOT bypass IP multi-account block!
    const expReg = await fetch(`${srv.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'bob1', password: 'Password123', confirmPassword: 'Password123', key: 'KEY-EXPIRED' })
    });
    assert.strictEqual(expReg.status, 403, 'Expired key must not exempt user from IP multi-account limit');

    // Used/exhausted key must NOT bypass IP multi-account block!
    const usedReg = await fetch(`${srv.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'bob2', password: 'Password123', confirmPassword: 'Password123', key: 'KEY-USED' })
    });
    assert.strictEqual(usedReg.status, 403, 'Exhausted key must not exempt user from IP multi-account limit');

    // Clean IP registration succeeds, calls 0 fetchUsersSnapshot, returns rental expiresAt === null (NOT 24h session!)
    store.countUsersByIp = async () => 0;
    const regRes = await fetch(`${srv.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'cleanuser', password: 'Password123', confirmPassword: 'Password123' })
    });
    assert.ok([200, 201].includes(regRes.status), `Expected 200/201 from /register, got ${regRes.status}`);
    const regData = await regRes.json();
    assert.strictEqual(regData.ok, true);
    assert.strictEqual(regData.user.expiresAt, null, 'Unactivated user must have rental expiresAt === null, not 24h session expiry');
    assert.strictEqual(regData.user.isPermanent, false);
    assert.strictEqual(snapshotCalls, 0, 'Register must never call fetchUsersSnapshot()');
    assert.strictEqual(createdSessionCountArg, 1);

    // Login also calls 0 fetchUsersSnapshot
    const loginRes = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'cleanuser', password: 'Password123' })
    });
    assert.strictEqual(loginRes.status, 200);
    assert.strictEqual(snapshotCalls, 0, 'Login must never call fetchUsersSnapshot()');
  } finally {
    await srv.close();
  }
});

// ----------------------------------------------------------------------------
// DA-P0-03: SupabaseWorkerStore RAM cache + CommandBroker RAM resultWaiters & live inventory sync
// ----------------------------------------------------------------------------
test('DA-P0-03: SupabaseWorkerStore write-through cache & CommandBroker 0ms resultWaiters + live inventory sync', async () => {
  let dbSelectCount = 0;
  const rows = [
    {
      worker_id: 'bot-cache-1',
      bot_number: 1,
      name: 'CacheBot',
      provider: 'wispbyte',
      enabled: true,
      settings: {},
      status: { state: 'online' }
    }
  ];
  const mockClient = {
    from() {
      const chain = {
        select() { return chain; },
        order() { return chain; },
        eq() { return chain; },
        then(resolve, reject) {
          dbSelectCount += 1;
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
        maybeSingle() {
          dbSelectCount += 1;
          return Promise.resolve({ data: rows[0], error: null });
        },
        insert(payload) {
          rows[0] = { ...rows[0], ...payload };
          return {
            select() { return { single: async () => ({ data: rows[0], error: null }), maybeSingle: async () => ({ data: rows[0], error: null }) }; }
          };
        },
        upsert(payload) {
          rows[0] = { ...rows[0], ...payload };
          return {
            select() { return { single: async () => ({ data: rows[0], error: null }), maybeSingle: async () => ({ data: rows[0], error: null }) }; }
          };
        }
      };
      return chain;
    }
  };

  const wStore = new SupabaseWorkerStore(mockClient);
  const l1 = await wStore.list();
  const l2 = await wStore.list();
  const g1 = await wStore.get('bot-cache-1');
  assert.strictEqual(l1.length, 1);
  assert.strictEqual(l2.length, 1);
  assert.strictEqual(g1.workerId, 'bot-cache-1');
  assert.strictEqual(dbSelectCount, 1, 'Second list() and get() within 30s TTL must hit RAM cache');

  // Write invalidates cache cleanly
  await wStore.create({ workerId: 'bot-cache-1', botNumber: 1, name: 'CacheBotRenamed', provider: 'wispbyte' });
  const l3 = await wStore.list();
  assert.strictEqual(l3[0].name, 'CacheBotRenamed');
  assert.strictEqual(dbSelectCount, 2, 'Write must invalidate cache');

  // CommandBroker RAM resultWaiters 0ms wakeup + live inventory merge
  const registry = new WorkerRegistry({ store: createInMemoryWorkerStore(), encryptionKey: ENC_KEY, logger: silentLogger() });
  await registry.add({ workerId: 'bot-fast', secret: SECRET_32, provider: 'wispbyte' });
  await registry.updateStatus('bot-fast', { state: 'online', online: true }, 'worker-heartbeat');
  const cmdDb = new Map();
  const commandStore = {
    async enqueue(c) {
      const id = c.commandId || c.id;
      cmdDb.set(id, { ...c, commandId: id, status: 'queued' });
      return { ...c, commandId: id };
    },
    async take(workerId) {
      for (const c of cmdDb.values()) {
        if (c.workerId === workerId && c.status === 'queued') {
          c.status = 'delivered';
          return c;
        }
      }
      return null;
    },
    async get(id) { return cmdDb.get(id) || null; },
    async getById(id) { return cmdDb.get(id) || null; },
    async complete(workerId, id, result) {
      const c = cmdDb.get(id);
      if (!c || c.workerId !== workerId) return false;
      c.status = 'completed';
      c.result = result;
      return true;
    },
    async expire() { return 0; }
  };

  const broker = new CommandBroker({
    registry,
    commandStore,
    config: { commandResultTimeoutMs: 5000, workerPollWaitMs: 2000 },
    logger: silentLogger()
  });

  const t0 = Date.now();
  const dispatchPromise = broker.dispatch('bot-fast', 'inventory', {});
  await new Promise((r) => setTimeout(r, 25));
  const polled = await broker.poll('bot-fast', { waitMs: 500 });
  const cmdId = polled?.commandId || polled?.id;
  assert.ok(cmdId, 'Polled command must have a commandId');
  const liveInv = { revision: 9, heldSlot: 2, slots: { '36': { name: 'totem_of_undying', count: 1 } } };
  await broker.acceptResult('bot-fast', { commandId: cmdId, result: { ok: true, inventory: liveInv } });
  const res = await dispatchPromise;
  const elapsed = Date.now() - t0;

  assert.strictEqual(res.delivered, true);
  assert.ok(elapsed < 400, `resultWaiters must wake up immediately (<400ms), got ${elapsed}ms`);
  const syncedWorker = await registry.find('bot-fast');
  assert.strictEqual(syncedWorker.status.inventory.revision, 9, 'acceptResult must merge live inventory into worker status');
});

// ----------------------------------------------------------------------------
// DA-P0-04: DashboardStore 6-field preservation, PostgREST quoting, mapDatabaseUser resilience, audit schema
// ----------------------------------------------------------------------------
test('DA-P0-04: DashboardStore preserves 6 fields, quotes .or(), isolates corrupt row decryption, writes full audit schema', async () => {
  let lastOrFilter = '';
  let lastAuditRow = null;
  let lastUpsertRow = null;
  const mockClient = {
    from(table) {
      return {
        select() { return this; },
        or(expr) {
          lastOrFilter = expr;
          return {
            maybeSingle: async () => ({ data: null, error: null })
          };
        },
        upsert(row) {
          lastUpsertRow = row;
          return {
            select: () => ({
              single: async () => ({ data: row, error: null }),
              maybeSingle: async () => ({ data: row, error: null })
            })
          };
        },
        insert(row) {
          if (table === 'audit_logs' || table === 'manager_audit') lastAuditRow = row;
          return Promise.resolve({ data: [row], error: null });
        }
      };
    }
  };

  const dStore = new SupabaseDashboardStore(mockClient);
  await dStore.setAccess('usr_keep6', {
    username: 'keep6',
    allowAccountChange: false,
    lockReason: 'manual_review',
    botAliases: { 'bot-1': 'Farm' },
    botCount: 2,
    registrationIp: '203.0.113.5',
    deviceFingerprint: 'fp_abc123'
  });
  assert.strictEqual(lastUpsertRow.allow_account_change, false);
  assert.strictEqual(lastUpsertRow.lock_reason, 'manual_review');
  assert.deepStrictEqual(lastUpsertRow.bot_aliases, { 'bot-1': 'Farm' });
  assert.strictEqual(lastUpsertRow.bot_count, 2);
  assert.strictEqual(lastUpsertRow.registration_ip, '203.0.113.5');
  assert.strictEqual(lastUpsertRow.device_fingerprint, 'fp_abc123');

  // PostgREST filter injection quoting
  await dStore.getAccess('evil,id.eq.admin');
  assert.ok(lastOrFilter.includes('"evil,id.eq.admin"'), `Special chars must be PostgREST-quoted, got: ${lastOrFilter}`);

  // Full audit schema write
  await dStore.addAudit({
    action: 'TEST_ACTION',
    actorId: 'admin',
    actorRole: 'admin',
    actorIp: '198.51.100.7',
    targetType: 'user',
    targetId: 'usr_keep6',
    details: { note: 'ok' }
  });
  assert.strictEqual(lastAuditRow.actor_username, 'admin');
  assert.strictEqual(lastAuditRow.actor_role, 'admin');
  assert.strictEqual(lastAuditRow.actor_ip, '198.51.100.7');
  assert.strictEqual(lastAuditRow.log_type, 'SYSTEM');
  assert.deepStrictEqual(lastAuditRow.target, { raw: 'usr_keep6' });

  // Corrupt encrypted password does NOT throw in SupabaseAdapter.mapDatabaseUser
  const adapter = new SupabaseAdapter({ url: '', key: '', logger: silentLogger() });
  const corruptMapped = adapter.mapDatabaseUser({
    id: 'usr_corrupt',
    username: 'corrupt',
    password: 'aes256$gcm$000000000000000000000000$00000000000000000000000000000000$deadbeef',
    role: 'user',
    status: 'active'
  });
  assert.strictEqual(corruptMapped.username, 'corrupt');
  assert.strictEqual(corruptMapped.passwordUnreadable, true);
});

// ----------------------------------------------------------------------------
// DA-P0-05: EntitlementService grace-period zero-rewrite + SupabaseCommandStore.expire() filter
// ----------------------------------------------------------------------------
test('DA-P0-05: EntitlementService avoids grace-period DB rewrite storm & expire() scopes queued/delivered', async () => {
  let setAccessWrites = 0;
  let userRec = {
    id: 'usr_grace',
    userId: 'usr_grace',
    username: 'graceuser',
    role: 'user',
    status: 'active',
    isPermanent: false,
    expiresAt: new Date(Date.now() - 60000).toISOString(), // expired 1 min ago (inside 6h grace)
    assignedBotIds: ['bot-g1']
  };
  const store = {
    async listAccess() { return [{ ...userRec }]; },
    async getAccess() { return { ...userRec }; },
    async setAccess(_id, next) {
      setAccessWrites += 1;
      userRec = { ...userRec, ...next };
      return { ...userRec };
    },
    async addAudit() {}
  };
  const registry = new WorkerRegistry({ store: createInMemoryWorkerStore(), encryptionKey: ENC_KEY, logger: silentLogger() });
  await registry.add({ workerId: 'bot-g1', secret: SECRET_32, provider: 'wispbyte' });

  const ent = new EntitlementService({
    store,
    registry,
    broker: { async dispatch() { return { delivered: true, result: { ok: true } }; } },
    config: { botExpirationGraceHours: 6 },
    logger: silentLogger()
  });

  await ent.checkExpiredUsersAndGracefulStop({ broker: { async dispatch() { return { delivered: true, result: { ok: true } }; } } });
  assert.strictEqual(userRec.status, 'grace_period');
  assert.strictEqual(setAccessWrites, 1, 'First tick transitions user into grace_period with 1 DB write');

  await ent.checkExpiredUsersAndGracefulStop({ broker: { async dispatch() { return { delivered: true, result: { ok: true } }; } } });
  await ent.checkExpiredUsersAndGracefulStop({ broker: { async dispatch() { return { delivered: true, result: { ok: true } }; } } });
  assert.strictEqual(setAccessWrites, 1, 'Subsequent ticks while in grace_period must execute 0 DB rewrites');

  // SupabaseCommandStore.expire() fallback must scope status to ['queued', 'delivered']
  let inFilter = null;
  const cmdStore = new SupabaseCommandStore(
    {
      async rpc() { return { data: null, error: { code: 'PGRST202', message: 'not found' } }; },
      from() {
        return {
          update() { return this; },
          eq() { return this; },
          in(col, vals) { inFilter = { col, vals }; return Promise.resolve({ data: [], error: null }); }
        };
      }
    }
  );
  await cmdStore.expire('cmd_test_1');
  assert.deepStrictEqual(inFilter, { col: 'status', vals: ['queued', 'delivered'] });
});

// ----------------------------------------------------------------------------
// DA-P1-01 & DA-P1-02: Frozen config safety, F-01..F-05, F-10, F-12, M-07a, SEC-04, SEC-07
// ----------------------------------------------------------------------------
test('DA-P1-01/02: Frozen config, webhook/announcement/system persistence, F-01/02/05/10/12, SSRF & audit logs', async () => {
  const settingsMap = new Map();
  const usersMap = new Map();
  const auditLogs = [];

  const store = {
    async getSetting(k) { return settingsMap.get(k) ?? null; },
    async setSetting(k, v) { settingsMap.set(k, structuredClone(v)); return true; },
    async listAccess() { return [...usersMap.values()]; },
    async getAccess(id) { return usersMap.get(id) || [...usersMap.values()].find((u) => u.username === id) || null; },
    async getUser(u) {
      return usersMap.get(u) || [...usersMap.values()].find((x) => x.username === String(u).toLowerCase() || x.id === u) || null;
    },
    async setAccess(id, v) {
      const prev = usersMap.get(id) || {};
      const next = { ...prev, ...v, id, userId: id };
      usersMap.set(id, next);
      return next;
    },
    async addAudit(entry) { auditLogs.push({ ...entry, createdAt: new Date().toISOString() }); },
    async listAudit() { return auditLogs; },
    async deleteBackup() { return false; },
    invalidateCache() {},
    invalidateUserCache() {}
  };

  const registry = new WorkerRegistry({ store: createInMemoryWorkerStore(), encryptionKey: ENC_KEY, logger: silentLogger() });
  await registry.add({ workerId: 'bot-vip', secret: SECRET_32, provider: 'wispbyte', name: 'VIP Bot' });
  await registry.add({ workerId: 'bot-free', secret: SECRET_32, provider: 'wispbyte', name: 'Free Bot' });
  await registry.updateTags('bot-vip', ['vip']);
  await registry.updateTags('bot-free', ['free']);
  await registry.updateStatus('bot-vip', { state: 'online', online: true });
  await registry.updateStatus('bot-free', { state: 'online', online: true });
  await registry.updateCredentials('bot-vip', { username: 'VipPlayer', password: '' });

  const dispatchedChats = [];
  const broker = {
    async dispatch(workerId, action, payload) {
      dispatchedChats.push({ workerId, action, payload });
      return { delivered: true, result: { ok: true } };
    }
  };

  const adminNotifier = new AdminNotifier({ logger: silentLogger() });
  const frozenConfig = Object.freeze({
    adminUsername: 'admin',
    encryptionKey: ENC_KEY,
    trialGiftEnabled: false,
    trialDays: 3,
    publicBaseUrl: 'https://mgr.example.com'
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.managerAuthSession = { username: 'admin', role: 'admin', userId: 'admin' };
    next();
  });
  app.use('/api/admin', createAdminApi({
    store,
    registry,
    broker,
    fleetOperations: {},
    adminNotifier,
    config: frozenConfig,
    logger: silentLogger()
  }));

  const srv = await startServer(app);
  try {
    // 1. Frozen config does NOT throw on /settings/system
    const sysRes = await fetch(`${srv.baseUrl}/api/admin/settings/system`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trialGiftEnabled: true, trialDays: 5 })
    });
    assert.strictEqual(sysRes.status, 200);
    assert.strictEqual((await sysRes.json()).settings.trialDays, 5);

    // 2. Webhook round-trip encrypted & configures adminNotifier
    const whPost = await fetch(`${srv.baseUrl}/api/admin/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        discordUrl: 'https://discord.com/api/webhooks/1234567890/secretTokenXYZ',
        notifyOnDeath: true
      })
    });
    assert.strictEqual(whPost.status, 200);
    assert.strictEqual(adminNotifier.discordWebhookUrl, 'https://discord.com/api/webhooks/1234567890/secretTokenXYZ');
    assert.ok(settingsMap.get('webhook_settings').discordUrlCiphertext, 'Discord webhook URL must be stored encrypted');
    const whGet = await fetch(`${srv.baseUrl}/api/admin/webhook`);
    const whGetJson = await whGet.json();
    assert.strictEqual(whGetJson.webhook.discordUrl, '********', 'GET /api/admin/webhook must mask configured webhook URL');
    assert.strictEqual(whGetJson.webhookUrl, '********', 'GET /api/admin/webhook webhookUrl must also be masked');

    // 3. Announcement structured object
    const annPost = await fetch(`${srv.baseUrl}/api/admin/announcement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, title: 'Bảo trì', content: '22h tối nay', mode: 'modal' })
    });
    assert.strictEqual(annPost.status, 200);
    const annData = await annPost.json();
    assert.strictEqual(annData.announcement.title, 'Bảo trì');
    assert.strictEqual(annData.announcement.mode, 'modal');

    // 4. Create user with assignedBotIds + mass-assignment role stripped
    const createRes = await fetch(`${srv.baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'customer1',
        password: 'UserPass123',
        role: 'admin',
        assignedBotIds: ['bot-vip']
      })
    });
    assert.strictEqual(createRes.status, 200);
    const createdUser = [...usersMap.values()].find((u) => u.username === 'customer1');
    assert.ok(createdUser, 'Created user must be persisted');
    assert.strictEqual(createdUser.role, 'user', 'Mass-assigned admin role must be ignored');
    assert.deepStrictEqual(createdUser.workerIds, ['bot-vip']);

    // 5. Renew days with fixedDate & planName & reject unbounded days
    const badRenew = await fetch(`${srv.baseUrl}/api/admin/users/${encodeURIComponent(createdUser.id)}/renew-days`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: 999999 })
    });
    assert.strictEqual(badRenew.status, 400);

    const targetIso = new Date(Date.now() + 10 * 86400000).toISOString();
    const okRenew = await fetch(`${srv.baseUrl}/api/admin/users/${encodeURIComponent(createdUser.id)}/renew-days`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fixedDate: targetIso, planName: 'VIP Pro' })
    });
    assert.strictEqual(okRenew.status, 200);
    assert.strictEqual(usersMap.get(createdUser.id).planName, 'VIP Pro');

    // 6. Legacy broadcast /all/send removed -> returns 400
    const sendRes = await fetch(`${srv.baseUrl}/api/admin/all/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '/spawn', tag: 'vip' })
    });
    assert.strictEqual(sendRes.status, 400);
    assert.strictEqual(dispatchedChats.length, 0);

    // 7. /supabase/schema returns JSON { ok, sql }
    const schemaRes = await fetch(`${srv.baseUrl}/api/admin/supabase/schema`);
    assert.strictEqual(schemaRes.status, 200);
    const schemaJson = await schemaRes.json();
    assert.strictEqual(schemaJson.ok, true);
    assert.ok(schemaJson.sql.includes('CREATE TABLE'));

    // 8. SSRF URL blocked on POST /bots
    const ssrfRes = await fetch(`${srv.baseUrl}/api/admin/bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data', label: 'Evil' })
    });
    assert.strictEqual(ssrfRes.status, 400);

    // 9. DELETE nonexistent backup returns 404
    const delBackupRes = await fetch(`${srv.baseUrl}/api/admin/backups/nonexistent.json`, { method: 'DELETE' });
    assert.strictEqual(delBackupRes.status, 404);

    // 10. reveal-password & /admin/credentials emit audit logs + CSV formula escaping
    await store.addAudit({ action: '=HYPERLINK("http://evil")', actorId: '+admin', details: { x: '@SUM(1,2)' } });
    const revRes = await fetch(`${srv.baseUrl}/api/admin/users/${encodeURIComponent(createdUser.id)}/reveal-password`, { method: 'POST' });
    assert.strictEqual(revRes.status, 200);
    assert.strictEqual((await revRes.json()).password, 'UserPass123');
    const credRes = await fetch(`${srv.baseUrl}/api/admin/admin/credentials`);
    assert.strictEqual(credRes.status, 200);
    assert.ok(auditLogs.some((a) => a.action === 'ADMIN_REVEAL_USER_PASSWORD'));
    assert.ok(auditLogs.some((a) => a.action === 'ADMIN_VIEW_BOT_CREDENTIALS'));

    const csvRes = await fetch(`${srv.baseUrl}/api/admin/audit-logs/export?format=csv`);
    assert.strictEqual(csvRes.status, 200);
    const csvText = await csvRes.text();
    assert.ok(csvText.includes("'=HYPERLINK"), 'CSV export must escape leading formula characters');
    assert.ok(csvText.includes("'+admin"), 'CSV export must escape leading + in actor column');
  } finally {
    await srv.close();
  }
});

// ----------------------------------------------------------------------------
// DA-P1-03: User API settings/proxy/inventory hoisting/reorder/sig stability/bootstrap
// ----------------------------------------------------------------------------
test('DA-P1-03: User API settings unpack, proxy admin-only, inventory 409 hoist, reorder, stable sig & /public/bootstrap', async () => {
  const registry = new WorkerRegistry({ store: createInMemoryWorkerStore(), encryptionKey: ENC_KEY, logger: silentLogger() });
  await registry.add({ workerId: 'bot-a', secret: SECRET_32, provider: 'wispbyte', name: 'Bot A' });
  await registry.add({ workerId: 'bot-b', secret: SECRET_32, provider: 'wispbyte', name: 'Bot B' });
  await registry.updateStatus('bot-a', { state: 'online', online: true, uptimeSeconds: 100 });

  let currentUserRole = 'user';
  let userRec = {
    id: 'usr_u1',
    userId: 'usr_u1',
    username: 'u1',
    role: 'user',
    status: 'active',
    isPermanent: true,
    assignedBotIds: ['bot-a', 'bot-b']
  };
  const store = {
    async getAccess() { return userRec; },
    async setAccess(_id, patch) { userRec = { ...userRec, ...patch }; return userRec; },
    async getSetting() { return null; },
    async addAudit() {},
    invalidateUserCache() {}
  };

  const broker = {
    async dispatch(_wid, action, payload) {
      if (action === 'inventory' && payload?.action === 'drop') {
        return {
          delivered: true,
          result: {
            ok: false,
            code: 'INVENTORY_STALE',
            error: 'INVENTORY_STALE',
            inventory: { revision: 42, slots: {} }
          }
        };
      }
      return {
        delivered: true,
        result: {
          ok: true,
          inventory: { revision: 12, slots: {} },
          currentWindow: { id: 3, title: 'Menu', slots: [] }
        }
      };
    }
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.headers['x-test-auth'] !== 'none') {
      req.managerAuthSession = currentUserRole === 'admin'
        ? { username: 'admin', role: 'admin', userId: 'admin' }
        : { ...userRec };
    }
    next();
  });
  app.use('/api/manager', createUserApi({
    store,
    registry,
    broker,
    config: { encryptionKey: ENC_KEY },
    logger: silentLogger()
  }));

  const srv = await startServer(app);
  try {
    // 1. Nested settings unpack persists, bumps settingsRevision & exposes all 8 settings in registry.bootstrap()
    const bootBefore = await registry.bootstrap('bot-a');
    const revBefore = bootBefore.settingsRevision;
    const sRes = await fetch(`${srv.baseUrl}/api/manager/bot/bot-a/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          autoTotem: false,
          antiHungry: true,
          autoReconnect: false,
          antiAfkKick: true,
          ecoMode: false,
          spawnCommands: '/home\n/afk'
        },
        autoChatSchedules: [
          { id: 'ac1', enabled: true, mode: 'interval', intervalSeconds: 120, messages: ['Hi 1', 'Hi 2'], messageDelaySeconds: 2 }
        ],
        botSchedules: [
          { id: 'bs1', enabled: true, mode: 'fixed', items: [{ id: 'i1', action: 'command', time: '12:00', command: '/tps' }] }
        ]
      })
    });
    assert.strictEqual(sRes.status, 200);
    const sJson = await sRes.json();
    assert.strictEqual(typeof sJson.bot.status, 'string', 'POST /settings must return normalized bot DTO');
    const bootAfter = await registry.bootstrap('bot-a');
    assert.ok(bootAfter.settingsRevision > revBefore, 'Updating settings must bump settingsRevision');
    assert.strictEqual(bootAfter.settings.autoTotem, false);
    assert.strictEqual(bootAfter.settings.ecoMode, false);
    assert.strictEqual(bootAfter.settings.spawnCommands, '/home\n/afk');
    assert.deepStrictEqual(bootAfter.settings.autoChatSchedules[0].messages, ['Hi 1', 'Hi 2']);
    assert.strictEqual(bootAfter.settings.botSchedules[0].items[0].command, '/tps');

    // Masked spawnCommands ('********') must not overwrite real saved commands
    await fetch(`${srv.baseUrl}/api/manager/bot/bot-a/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { spawnCommands: '********' } })
    });
    assert.strictEqual((await registry.bootstrap('bot-a')).settings.spawnCommands, '/home\n/afk');

    // 2. Proxy route blocked for regular user (403), allowed with object payload for admin (200), preserves saved password when left blank
    const userProxyRes = await fetch(`${srv.baseUrl}/api/manager/bot/bot-a/proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proxy: { enabled: true, protocol: 'socks5', host: '1.2.3.4', port: 1080 } })
    });
    assert.strictEqual(userProxyRes.status, 403);

    currentUserRole = 'admin';
    const adminProxyRes = await fetch(`${srv.baseUrl}/api/manager/bot/bot-a/proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proxy: { enabled: true, protocol: 'socks5', host: '8.8.8.8', port: 1080, username: 'u', password: 'secret' } })
    });
    assert.strictEqual(adminProxyRes.status, 200);
    // Re-saving same host/username with empty password preserves the saved password!
    const adminProxyRes2 = await fetch(`${srv.baseUrl}/api/manager/bot/bot-a/proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proxy: { enabled: true, protocol: 'socks5', host: '8.8.8.8', port: 1081, username: 'u', password: '' } })
    });
    assert.strictEqual(adminProxyRes2.status, 200);
    assert.strictEqual((await registry.bootstrap('bot-a')).settings.proxyUrl, 'socks5://u:secret@8.8.8.8:1081');
    const snapRes = await fetch(`${srv.baseUrl}/api/manager/bot/bot-a/snapshot`);
    const snapData = await snapRes.json();
    assert.strictEqual(snapData.settings?.proxy?.password, undefined, 'Snapshot must never leak proxy password');
    assert.strictEqual(snapData.bot?.settings?.proxy?.password, undefined, 'Snapshot bot payload must never leak proxy password');

    // 3. Window click hoists inventory/currentWindow & 409 inventory/drop hoists latest inventory
    const winRes = await fetch(`${srv.baseUrl}/api/manager/bot/bot-a/window/click`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot: 0 })
    });
    assert.strictEqual(winRes.status, 200);
    const winJson = await winRes.json();
    assert.strictEqual(winJson.inventory.revision, 12);
    assert.strictEqual(winJson.currentWindow.id, 3);

    const drop409 = await fetch(`${srv.baseUrl}/api/manager/bot/bot-a/inventory/drop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceSlot: 36, revision: 1 })
    });
    assert.strictEqual(drop409.status, 409);
    const dropJson = await drop409.json();
    assert.strictEqual(dropJson.inventory.revision, 42, '409 INVENTORY_STALE must hoist latest inventory to top-level');

    // 4. Non-admin reorder exact permutation allowed, forged bot ID rejected
    currentUserRole = 'user';
    const badReorder = await fetch(`${srv.baseUrl}/api/manager/bots/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: ['bot-a', 'bot-forged'] })
    });
    assert.strictEqual(badReorder.status, 403);

    const okReorder = await fetch(`${srv.baseUrl}/api/manager/bots/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: ['bot-b', 'bot-a'] })
    });
    assert.strictEqual(okReorder.status, 200);
    assert.deepStrictEqual(userRec.workerIds || userRec.assignedBotIds, ['bot-b', 'bot-a']);

    // 5. GET /bots?sig= remains unchanged when only uptimeSeconds ticks slightly
    const bots1 = await (await fetch(`${srv.baseUrl}/api/manager/bots`)).json();
    await registry.updateStatus('bot-a', { state: 'online', online: true, uptimeSeconds: 105 });
    const bots2 = await (await fetch(`${srv.baseUrl}/api/manager/bots?sig=${encodeURIComponent(bots1.sig)}`)).json();
    assert.strictEqual(bots2.unchanged, true, 'GET /bots?sig= must return unchanged:true across minor uptime ticks');

    // 6. /public/bootstrap returns combined info with no memory leak
    const bootRes = await fetch(`${srv.baseUrl}/api/manager/public/bootstrap`, { headers: { 'x-test-auth': 'none' } });
    assert.strictEqual(bootRes.status, 200);
    const bootJson = await bootRes.json();
    assert.strictEqual(bootJson.ok, true);
    assert.ok(bootJson.systemInfo && bootJson.loginConfig && bootJson.health);
    assert.strictEqual(bootJson.systemInfo.memory, undefined);
  } finally {
    await srv.close();
  }
});

// ----------------------------------------------------------------------------
// DA-P1-04: Discord customId unescaped, DM guard, manuallyStopped sync, admin password modal & AdminNotifier
// ----------------------------------------------------------------------------
test('DA-P1-04: Discord renderer customIds/dedup, DM blocking, manuallyStopped sync, password modal & AdminNotifier', async () => {
  const workerWithUnderscore = {
    workerId: 'bot_1_alpha',
    botNumber: 1,
    name: 'Alpha_One',
    provider: 'wispbyte',
    status: { online: true, state: 'online', username: 'Player_1', pingMs: 30, uptimeSeconds: 120 }
  };

  const detail = renderBotDetail({ user: { role: 'user' }, worker: workerWithUnderscore });
  const startBtn = detail.components[0].components[0];
  assert.strictEqual(startBtn.data.custom_id, 'bot:start:bot_1_alpha', 'Button customId must use raw unescaped workerId');
  assert.strictEqual((detail.embeds[0].data.fields || []).length, 0, 'Non-admin detail embed must not repeat 9 description fields');

  const logsView = renderBotLogs({ user: { role: 'user' }, worker: workerWithUnderscore, logs: ['hi'] });
  const ids = logsView.components[0].components.map((c) => c.data.custom_id);
  assert.ok(ids.includes('bot:view:bot_1_alpha'), 'renderBotLogs must use valid bot:view:<rawId> customId');
  assert.ok(ids.includes('logs:refresh:bot_1_alpha'));

  // DM blocked when effectiveGuildId configured
  let dmReply = null;
  await handlePanelInteraction(
    {
      guildId: null,
      user: { id: 'u1' },
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      reply: async (p) => { dmReply = p; }
    },
    { config: { discordGuildId: '999999999999999999' } }
  );
  assert.ok(dmReply?.content?.includes('configured Discord server'), 'DM interaction must be blocked when guildId is configured');

  // bot:stop syncs manuallyStopped = true
  let updatedStatusArg = null;
  await handlePanelInteraction(
    {
      guildId: '999999999999999999',
      user: { id: 'admin1' },
      customId: 'bot:stop:bot_1_alpha',
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      deferUpdate: async () => {},
      editReply: async () => {},
      update: async () => {}
    },
    {
      config: { discordGuildId: '999999999999999999', adminUserId: 'admin1' },
      accessStore: { async getUserByDiscordId() { return null; } },
      registry: {
        async find() { return workerWithUnderscore; },
        async updateStatus(_id, st) { updatedStatusArg = st; return workerWithUnderscore; }
      },
      broker: { async dispatch() { return { delivered: true, result: { ok: true } }; } }
    }
  );
  assert.strictEqual(updatedStatusArg?.manuallyStopped, true, 'Discord bot:stop must sync status.manuallyStopped = true');

  // /admin password opens modal when new_password omitted
  let shownModal = null;
  const skipInteraction = {
    guildId: '999',
    guild: { ownerId: 'owner1' },
    user: { id: 'owner1' },
    options: {
      getSubcommand: () => 'password',
      getString: () => null
    },
    showModal: async (m) => { shownModal = m; }
  };
  assert.strictEqual(adminCommand.shouldSkipDefer(skipInteraction), true);
  await adminCommand.execute(skipInteraction, { config: { adminUserId: 'owner1' } });
  assert.strictEqual(shownModal.data.custom_id, buildAdminPasswordModal().data.custom_id);

  // AdminNotifier death/totem formatting, buffer cap & self-loop guard
  const notifier = new AdminNotifier({ logger: silentLogger() });
  notifier.batchWaitMs = 5;
  await notifier.notifyBotDeath('b1', 'Bot One', { x: 10.6, y: 64, z: -20.2 });
  await notifier.notifyLowTotem('b1', 'Bot One', 1);
  assert.ok(notifier.pendingBatch[0].message.includes('X:11, Y:64, Z:-20'));
  assert.ok(notifier.pendingBatch[1].message.includes('**1**'));

  // Self-loop guard in hookLogger
  let sendAlertCalls = 0;
  notifier.sendAlert = async () => { sendAlertCalls += 1; };
  const fakeLogger = { error() {} };
  notifier.hookLogger(fakeLogger);
  fakeLogger.error('admin_alert_max_retries_exceeded', { error: 'boom' });
  fakeLogger.error('discord_webhook_dispatch_failed', { error: 'boom' });
  assert.strictEqual(sendAlertCalls, 0, 'hookLogger must ignore notifier self-error events');
});

// ----------------------------------------------------------------------------
// DA-P2-01: HTTPS-only panel URL, Captcha TTL & selective nonce map, secrets/logger/http hardening
// ----------------------------------------------------------------------------
test('DA-P2-01: Wispbyte HTTPS-only, Captcha TTL/nonces, scrypt decrypt null, logger multi-URL redaction, fetchWithRetry abort', async () => {
  assert.throws(() => validatePanelUrl('http://wispbyte.com/client'), /HTTPS/);
  assert.strictEqual(validatePanelUrl('https://wispbyte.com/client'), 'https://wispbyte.com/client');

  // Captcha honors custom ttlSec and rejects replay without wiping active nonces
  const capSecret = 'super_secret_captcha_key_123456';
  const tokShort = createCaptchaToken('15', capSecret, 1);
  const nonces = new Map();
  assert.strictEqual(verifyCaptchaToken(tokShort, '15', capSecret, nonces).valid, true);
  assert.strictEqual(verifyCaptchaToken(tokShort, '15', capSecret, nonces).valid, false);

  // decryptUserPassword returns null for scrypt$ hash
  const scryptHash = hashPassword('MyPass123');
  assert.strictEqual(decryptUserPassword(scryptHash, ENC_KEY), null);
  assert.strictEqual(timingSafeStringEquals('short', 'much_longer_string'), false);
  assert.strictEqual(timingSafeStringEquals('same', 'same'), true);

  // Logger redacts multiple URLs in strings and Error.stack
  const loggedLines = [];
  const origErr = console.error;
  console.error = (line) => loggedLines.push(line);
  try {
    const log = createLogger('info');
    const err = new Error('Failed socks5://u1:PASS1@1.2.3.4:1080 and postgres://u2:PASS2@db.local:5432');
    log.error('multi_cred_err', { err, text: 'a=http://a:SEC1@h1 b=http://b:SEC2@h2' });
  } finally {
    console.error = origErr;
  }
  const combined = loggedLines.join('\n');
  assert.ok(!combined.includes('PASS1') && !combined.includes('PASS2'));
  assert.ok(!combined.includes('SEC1') && !combined.includes('SEC2'));

  // fetchWithRetry never retries when caller AbortController is already aborted
  const ac = new AbortController();
  ac.abort(new Error('caller_cancelled'));
  await assert.rejects(
    () => fetchWithRetry('https://example.invalid', { signal: ac.signal }, { maxRetries: 3, initialDelayMs: 5 }),
    /caller_cancelled/
  );
});

// ----------------------------------------------------------------------------
// DA-P3-01: Frontend JS AST syntax validation + UX-01/02/03 & BW-01/02 contract assertions
// ----------------------------------------------------------------------------
test('DA-P3-01: Dashboard & Login JS AST parse cleanly and satisfy UX-01..03, BW-01..02, F-09/F-13 contracts', () => {
  // 1. Parse complete concatenated Dashboard JS bundle with vm.Script (catches any syntax error!)
  assert.doesNotThrow(() => new vm.Script(DASHBOARD_SCRIPTS, { filename: 'dashboard.bundle.js' }));

  // 2. Parse PUBLIC_LOGIN_HTML inline <script> blocks
  const loginScripts = [...PUBLIC_LOGIN_HTML.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  assert.ok(loginScripts.length >= 1);
  loginScripts.forEach((src, i) => {
    assert.doesNotThrow(() => new vm.Script(src, { filename: `login-script-${i}.js` }));
  });

  // 3. BW-01 & UX-03 HTML/CSS contracts
  assert.ok(DASHBOARD_SHELL_HTML.includes(`<link rel="stylesheet" href="${CSS_PATH}">`));
  assert.ok(DASHBOARD_SHELL_HTML.includes(`<script src="${JS_PATH}"></script>`));
  assert.ok(!DASHBOARD_HTML.includes('id="appGalaxyVideo"'), 'Dead empty <video id="appGalaxyVideo"> must be removed');
  assert.ok(DASHBOARD_HTML.includes('id="userFormPassword" type="password"'), 'Admin user form password must be masked');
  assert.ok(DASHBOARD_HTML.includes('id="bgEffectsToggleBtn"'), 'Background effects toggle button must exist');
  assert.ok(!DASHBOARD_HTML.includes('<option value="http">HTTP / HTTPS CONNECT Proxy</option>'), 'Unsupported HTTP proxy option must be removed');
  assert.ok(!DASHBOARD_STYLES.includes('body.theme-sunset'), 'Dead theme-sunset CSS must be removed');
  assert.ok(!DASHBOARD_STYLES.includes('body.theme-morning'), 'Dead theme-morning CSS must be removed');
  assert.ok(DASHBOARD_STYLES.includes('--z-lock: 1500'), 'Standardized z-index scale tokens must exist');

  // 4. UX-01..03, BW-02, F-13 JS contracts
  assert.ok(DASHBOARD_SCRIPTS.includes('currentUser.isPermanent === true'), 'UX-01: must check isPermanent === true');
  assert.ok(DASHBOARD_SCRIPTS.includes('Chưa kích hoạt gói'), 'UX-01: must display unactivated state clearly');
  assert.ok(DASHBOARD_SCRIPTS.includes('detailChatSendInFlight'), 'UX-02: sendDetailMessage must use its own lock');
  assert.ok(DASHBOARD_SCRIPTS.includes("['online', 'afk'].includes(st)"), 'UX-02: uptime ticker must run for online & afk');
  assert.ok(DASHBOARD_SCRIPTS.includes('if (!currentUser || document.hidden) return;'), 'BW-02: polling must pause when tab hidden');
  assert.ok(!DASHBOARD_SCRIPTS.includes(".account-restriction-overlay:not(.hidden)"), 'UX-03: Escape must never close accountLockedOverlay');
  assert.ok(DASHBOARD_SCRIPTS.includes('data-delete-ip'), 'UX-03: IP whitelist delete must use data-attribute delegation');
  assert.ok(DASHBOARD_SCRIPTS.includes('computeBotCardSig'), 'UX-03: reconcileBotCards must skip unchanged cards');
  assert.ok(DASHBOARD_SCRIPTS.includes('_cachedDashboardTheme'), 'UX-03: canvas loop must read cached theme from RAM');
  assert.ok(PUBLIC_LOGIN_HTML.includes('/api/public/bootstrap'), 'BW-01: Login page must use combined /api/public/bootstrap');
  assert.ok(PUBLIC_LOGIN_HTML.includes('cachedPublicTheme'), 'UX-03: Login canvas must cache theme in RAM');
  assert.ok(DASHBOARD_HTML.includes('id="detailSettingUserNotifyEnabled"'), 'User Discord DM notification toggle must exist in Settings panel');
  assert.ok(DASHBOARD_HTML.includes('id="detailSettingNotifyOnAfkKick"'), 'AFK kick notification toggle must exist in Settings panel');
  assert.ok(DASHBOARD_HTML.includes('id="detailSettingNotifyOnAfkRecover"'), 'AFK recover notification toggle must exist in Settings panel');
  assert.ok(DASHBOARD_HTML.includes('id="detailSettingNotifyOnReconnectExhausted"'), 'Reconnect exhausted notification toggle must exist in Settings panel');

  // 5. V12.1.1 Release (23/11/2026), Changelog & Mobile Responsive UI contracts
  assert.ok(PUBLIC_LOGIN_HTML.includes('viewport-fit=cover'), 'Login page viewport meta must include viewport-fit=cover for safe-area-inset support');
  assert.ok(DASHBOARD_HTML.includes('viewport-fit=cover'), 'Dashboard viewport meta must include viewport-fit=cover for safe-area-inset support');
  assert.ok(PUBLIC_LOGIN_HTML.includes('<span class="brand-version">V12.1.1</span>'), 'Login page must display version V12.1.1');
  assert.ok(PUBLIC_LOGIN_HTML.includes('background:var(--surface-input);border:1px solid var(--border-subtle)'), 'Login captcha box must use valid surface tokens');
  assert.ok(DASHBOARD_HTML.includes('V12.1.1 ENTERPRISE'), 'Sidebar must display V12.1.1 ENTERPRISE');
  assert.ok(DASHBOARD_HTML.includes('V12.1.1 PRO'), 'Header and Hero must display V12.1.1 PRO');
  assert.ok(DASHBOARD_HTML.includes('KBOT V12.1.1 • GIẢI PHÁP AFK KINGMC SỐ 1'), 'In-app login gate must display KBOT V12.1.1 badge');
  assert.ok(DASHBOARD_HTML.includes('🚀 KBOT V12.1.1 COMMERCIAL ENTERPRISE'), 'Footer must display V12.1.1 COMMERCIAL ENTERPRISE');
  assert.ok(DASHBOARD_HTML.includes('RELEASE 23/11/2026'), 'Changelog must include V12.1.1 release dated 23/11/2026');
  assert.ok(DASHBOARD_HTML.includes('RELEASE 19/11/2026'), 'Changelog must include V12.1 release dated 19/11/2026');
  assert.ok(DASHBOARD_HTML.includes('settingsRevision'), 'V12.1 changelog must document live settingsRevision sync');
  assert.ok(DASHBOARD_HTML.includes('afk_kicked') && DASHBOARD_HTML.includes('reconnect_exhausted'), 'V12.1 changelog must document AFK Discord DM notifications');
  assert.strictEqual((DASHBOARD_HTML.match(/class="timeline-badge current"/g) || []).length, 1, 'Only V12.1.1 in changelog may carry timeline-badge current');
  assert.ok(DASHBOARD_STYLES.includes('grid-template-columns: repeat(9, minmax(28px, 1fr))'), 'Mobile 9-column inventory & GUI slot grid must fit narrow viewports without overflow');
  assert.ok(DASHBOARD_STYLES.includes('grid-template-columns: 28px minmax(0, 1fr) auto auto'), 'Mobile schedule-row-top must keep handle, title, toggle, and delete button aligned without squishing');
  assert.ok(DASHBOARD_STYLES.includes('#detailChatPanel .chat-row'), 'Mobile chat form must target .chat-row rather than non-existent .inline');
  assert.ok(DASHBOARD_STYLES.includes('#detailAccountPanel > div[style*="display:flex"]'), 'Mobile account panel action buttons must target direct flex container');
  assert.ok(DASHBOARD_STYLES.includes('#batchFixedSettings > div[style*="display:flex"]'), 'Mobile batch schedule inputs must stack cleanly on narrow screens');
  assert.ok(!DASHBOARD_STYLES.includes('background: rgba(9, 15, 28, 0.96)'), 'Mobile <=480px surfaces must use theme-aware CSS tokens instead of hardcoded dark navy');
  assert.ok(DASHBOARD_STYLES.includes(':root[data-theme="moonlight"] .app-sidebar'), 'Moonlight theme must style mobile/desktop .app-sidebar');
  assert.ok(DASHBOARD_STYLES.includes(':root[data-theme="moonlight"] .bot-card'), 'Moonlight theme must keep .bot-card readable with light background on mobile');
  assert.ok(DASHBOARD_HTML.includes('id="discordDmNotifyBtn"'), 'Toolbar must include 1-click Discord DM notification toggle button');
  assert.ok(DASHBOARD_HTML.includes('id="discordNotifyToggleBtn"'), 'Discord Link modal must include 1-click Discord DM notification toggle button');
  assert.ok(DASHBOARD_SCRIPTS.includes('toggleDiscordNotifications'), 'Dashboard scripts must wire toggleDiscordNotifications');
});

// ----------------------------------------------------------------------------
// DA-P3-02: Admin system error Web+Discord logging & Assigned User AFK Lifecycle Discord DM alerts
// ----------------------------------------------------------------------------
test('DA-P3-02: AdminNotifier logs all system/DB/Discord errors to Web Audit & sends AFK lifecycle DMs to assigned user + Admin', async () => {
  const dmsByUserId = new Map();
  const auditEntries = [];
  const fakeDiscordClient = {
    users: {
      fetch: async (discordId) => ({
        id: discordId,
        send: async (payload) => {
          const list = dmsByUserId.get(discordId) || [];
          list.push(payload);
          dmsByUserId.set(discordId, list);
          return payload;
        }
      })
    }
  };

  const botSettingsMap = new Map([
    ['bot-1', {
      userNotifyEnabled: true,
      notifyOnAfkKick: true,
      notifyOnAfkRecover: true,
      notifyOnReconnectExhausted: true
    }]
  ]);

  const fakeStore = {
    addAudit: async (entry) => {
      auditEntries.push(entry);
      return entry;
    },
    assignedUser: async (workerId) => (workerId === 'bot-1' ? { workerId: 'bot-1', userId: 'usr_vip1' } : null),
    getAccess: async (userId) => (userId === 'usr_vip1' ? { userId: 'usr_vip1', username: 'vip_customer', discordUserId: '111111111111111111' } : null),
    getDiscordLink: async (userId) => (userId === 'usr_vip1' ? { discord_user_id: '111111111111111111', username: 'vip_customer' } : null)
  };

  const fakeRegistry = {
    find: async (workerId) => ({
      workerId,
      botNumber: 1,
      alias: 'Bot VIP #1',
      status: { username: 'KingVIP_MC' },
      settings: botSettingsMap.get(workerId) || {}
    })
  };

  const notifier = new AdminNotifier({
    client: fakeDiscordClient,
    store: fakeStore,
    adminUserId: '999999999999999999',
    logger: silentLogger()
  });
  notifier.batchWaitMs = 5;

  // 1. System / Supabase / Discord errors via hookLogger -> both Web Audit Log & Admin Discord DM
  const hookedLogger = { error() {}, warn() {} };
  notifier.hookLogger(hookedLogger);
  hookedLogger.error('supabase_rpc_failure', { message: 'Database connection reset by peer' });
  hookedLogger.warn('discord_gateway_rate_limit', { message: 'Discord gateway high latency' });
  hookedLogger.warn('minecraft_chunk_packet_incompatible_ignored', { message: 'Chunk packet ignored' }); // must be ignored!

  await new Promise((r) => setTimeout(r, 35));

  assert.ok(auditEntries.some((a) => a.action === 'SYSTEM_ALERT_SUPABASE_DATABASE'), 'Supabase error must be logged to Web Audit Trail');
  assert.ok(auditEntries.some((a) => a.action === 'SYSTEM_ALERT_DISCORD'), 'Discord infra warning must be logged to Web Audit Trail');
  assert.ok(!auditEntries.some((a) => JSON.stringify(a).includes('Chunk packet ignored')), 'Minecraft in-game noise must NOT be logged to system alerts');
  assert.ok((dmsByUserId.get('999999999999999999') || []).length >= 1, 'Admin must receive Discord DM for system/DB/Discord errors');

  // 2. AFK Kick -> notifies ONLY assigned user (111111111111111111) AND Admin (999999999999999999)
  const kickRes = await notifier.notifyBotLifecycleEvent({
    workerId: 'bot-1',
    event: { type: 'afk_kicked', reason: 'Server restart while AFK' },
    registry: fakeRegistry
  });
  assert.strictEqual(kickRes.ok, true);
  assert.strictEqual(kickRes.userNotified, true);
  const userDmsAfterKick = dmsByUserId.get('111111111111111111') || [];
  assert.strictEqual(userDmsAfterKick.length, 1, 'Assigned user must receive DM when bot is kicked while AFK');
  assert.ok(userDmsAfterKick[0].embeds[0].data.title.includes('bị kick / văng khi đang treo AFK'));

  // 3. AFK Recovered -> notifies assigned user AND Admin
  const recRes = await notifier.notifyBotLifecycleEvent({
    workerId: 'bot-1',
    event: { type: 'afk_recovered', attempts: 2 },
    registry: fakeRegistry
  });
  assert.strictEqual(recRes.userNotified, true);
  assert.strictEqual((dmsByUserId.get('111111111111111111') || []).length, 2, 'Assigned user must receive DM when bot recovers back to AFK');

  // 4. Reconnect Exhausted -> notifies assigned user AND Admin
  const exhRes = await notifier.notifyBotLifecycleEvent({
    workerId: 'bot-1',
    event: { type: 'reconnect_exhausted', attempts: 8, reason: 'Connection refused' },
    registry: fakeRegistry
  });
  assert.strictEqual(exhRes.userNotified, true);
  assert.strictEqual((dmsByUserId.get('111111111111111111') || []).length, 3, 'Assigned user must receive DM when reconnect limit is exhausted');

  // 5. User disables notifyOnAfkKick -> user DM is skipped, Admin still notified
  botSettingsMap.set('bot-1', {
    userNotifyEnabled: true,
    notifyOnAfkKick: false,
    notifyOnAfkRecover: true,
    notifyOnReconnectExhausted: true
  });
  notifier.userAlertCache.clear();
  const mutedRes = await notifier.notifyBotLifecycleEvent({
    workerId: 'bot-1',
    event: { type: 'bot_death', coords: 'X:100, Y:64, Z:100' },
    registry: fakeRegistry
  });
  assert.strictEqual(mutedRes.userNotified, false, 'Disabling notifyOnAfkKick must suppress user DM');
  assert.strictEqual((dmsByUserId.get('111111111111111111') || []).length, 3, 'User DM count must remain unchanged when toggle is off');

  // 6. Strict active Web <-> Discord link check: unlinked/revoked user NEVER receives DM
  botSettingsMap.set('bot-1', {
    userNotifyEnabled: true,
    notifyOnAfkKick: true,
    notifyOnAfkRecover: true,
    notifyOnReconnectExhausted: true
  });
  const settingsMap = new Map();
  fakeStore.getSetting = async (k) => (settingsMap.has(k) ? settingsMap.get(k) : null);
  fakeStore.getDiscordLink = async () => null;
  notifier.userAlertCache.clear();
  const unlinkedRes = await notifier.notifyBotLifecycleEvent({
    workerId: 'bot-1',
    event: { type: 'afk_kicked', reason: 'Unlinked user test' },
    registry: fakeRegistry
  });
  assert.strictEqual(unlinkedRes.userNotified, false, 'Unlinked Web user must NEVER receive Discord DM');
  assert.strictEqual((dmsByUserId.get('111111111111111111') || []).length, 3);

  // 7. User master Discord notification toggle off -> suppresses DM even when linked & bot settings enabled
  fakeStore.getDiscordLink = async (uid) => (uid === 'usr_vip1' ? { discord_user_id: '111111111111111111', username: 'vip_customer', status: 'active' } : null);
  settingsMap.set('user_discord_notify:usr_vip1', { enabled: false });
  notifier.userAlertCache.clear();
  const masterMutedRes = await notifier.notifyBotLifecycleEvent({
    workerId: 'bot-1',
    event: { type: 'afk_kicked', reason: 'Master muted test' },
    registry: fakeRegistry
  });
  assert.strictEqual(masterMutedRes.userNotified, false, 'Master user_discord_notify=false must suppress Discord DM');
  assert.strictEqual((dmsByUserId.get('111111111111111111') || []).length, 3);

  // 8. User re-enables master toggle & Admin mutes Admin DM -> User gets DM, Admin DM skipped (audit still written)
  settingsMap.set('user_discord_notify:usr_vip1', { enabled: true });
  settingsMap.set('user_discord_notify:admin', { enabled: false });
  notifier.userAlertCache.clear();
  const adminDmsBefore = (dmsByUserId.get('999999999999999999') || []).length;
  const reEnabledRes = await notifier.notifyBotLifecycleEvent({
    workerId: 'bot-1',
    event: { type: 'afk_recovered', attempts: 1 },
    registry: fakeRegistry
  });
  await new Promise((r) => setTimeout(r, 35));
  assert.strictEqual(reEnabledRes.userNotified, true, 'Re-enabling master user_discord_notify must resume User DM');
  assert.strictEqual((dmsByUserId.get('111111111111111111') || []).length, 4);
  assert.strictEqual((dmsByUserId.get('999999999999999999') || []).length, adminDmsBefore, 'Muting Admin Discord DM must skip Admin DM while keeping Web Audit');
});

// ============================================================================
// ULTRA-DEEP AUDIT ROUND 2 REGRESSION TESTS
// ============================================================================
test('AUDIT-R2-01: CSRF blocks cross-site Referer when Origin is absent', async () => {
  const store = {
    getUser: async () => null,
    getSetting: async () => null,
    addAudit: async () => {},
    adapter: { isEnabled: () => false }
  };
  const registry = { list: async () => [], find: async () => null };
  const app = createApp({
    store,
    registry,
    broker: {},
    commandStore: {},
    workerStore: {},
    fleetOperations: {},
    config: { adminUsername: 'admin', adminPassword: 'Password123!' },
    logger: createLogger({ level: 'silent' })
  });
  const srv = await startServer(app);
  try {
    const res = await fetch(`${srv.baseUrl}/api/manager/announcement`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': 'kingmc_mgr_session=fake_session_token',
        'Referer': 'https://evil-attacker.example/csrf'
      },
      body: JSON.stringify({ enabled: true, content: 'pwned' })
    });
    assert.strictEqual(res.status, 403, 'Cross-site Referer without Origin must be rejected with 403');
  } finally {
    await srv.close();
  }
});

test('AUDIT-R2-02: WorkerRegistry settingsRevision does NOT spam on status/events & cleans up on remove', async () => {
  const encKey = crypto.randomBytes(32).toString('hex');
  const workers = new Map();
  const mockStore = {
    list: async () => [...workers.values()],
    get: async (id) => workers.get(id) || null,
    nextBotNumber: async () => workers.size + 1,
    create: async (rec) => { workers.set(rec.workerId, rec); return rec; },
    update: async (id, patch) => {
      const cur = workers.get(id);
      if (!cur) return null;
      const updated = { ...cur, ...patch };
      workers.set(id, updated);
      return updated;
    },
    patchSettings: async (id, patch) => {
      const cur = workers.get(id);
      if (!cur) return null;
      cur.settings = { ...(cur.settings || {}), ...patch };
      return cur.settings;
    },
    resetData: async (id) => {
      const cur = workers.get(id);
      if (cur) cur.settings = {};
    },
    remove: async (id) => workers.delete(id)
  };
  const reg = new WorkerRegistry({ store: mockStore, encryptionKey: encKey });
  await reg.add({ workerId: 'bot-rev', secret: 'secret_12345678901234567890123456789012' });

  const initialSettingsRev = reg.getSettingsRevision('bot-rev');
  await reg.updateStatus('bot-rev', { state: 'online', health: 19, food: 20 }, 'worker-heartbeat');
  await reg.addEvent('bot-rev', { type: 'chat', message: 'hello world' });
  assert.strictEqual(
    reg.getSettingsRevision('bot-rev'),
    initialSettingsRev,
    'Status/chat updates must NOT bump settingsRevision'
  );

  // Notification-only or alias setting does NOT need worker bootstrap re-fetch
  const notifyRes = await reg.updateSettings('bot-rev', { userNotifyEnabled: false, notifyOnAfkKick: false });
  assert.strictEqual(notifyRes.userNotifyEnabled, false);
  assert.strictEqual(notifyRes.notifyOnAfkKick, false);
  assert.strictEqual(reg.getSettingsRevision('bot-rev'), initialSettingsRev, 'Manager-only notify settings must not bump worker settingsRevision');

  // Worker-facing setting MUST bump settingsRevision
  await reg.updateSettings('bot-rev', { ecoMode: false });
  assert.strictEqual(reg.getSettingsRevision('bot-rev'), initialSettingsRev + 1, 'Worker-facing setting must bump settingsRevision');

  // Credentials & resetData MUST bump settingsRevision
  await reg.updateCredentials('bot-rev', { username: 'Player1', password: 'pw' });
  assert.strictEqual(reg.getSettingsRevision('bot-rev'), initialSettingsRev + 2);
  await reg.resetData('bot-rev');
  assert.strictEqual(reg.getSettingsRevision('bot-rev'), initialSettingsRev + 3);

  await reg.remove('bot-rev');
  assert.strictEqual(reg.workerSettingsRev.has('bot-rev'), false, 'remove() must delete workerSettingsRev entry');
});

test('AUDIT-R2-03: unlinkDiscord deletes discord_link:<discordId> setting & getSetting caches null hits', async () => {
  const deletedSettingKeys = [];
  let settingQueries = 0;
  const mockClient = {
    rpc: async (fnName) => {
      if (fnName === 'manager_unlink_discord_account') return { data: { ok: true }, error: null };
      return { data: null, error: { code: 'PGRST202', message: 'missing rpc' } };
    },
    from: (table) => {
      if (table === 'manager_discord_links') {
        return {
          select: () => ({
            or: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { discord_user_id: '555555555555555555', manager_user_id: 'usr_alice', username: 'alice', status: 'active' },
                  error: null
                })
              })
            })
          })
        };
      }
      if (table === 'manager_settings') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                settingQueries += 1;
                return { data: null, error: null };
              }
            })
          }),
          delete: () => ({
            eq: async (_col, val) => {
              deletedSettingKeys.push(val);
              return { error: null };
            }
          })
        };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        delete: () => ({ eq: async () => ({ error: null }) }),
        update: () => ({ eq: async () => ({ error: null }) })
      };
    }
  };
  const dashStore = new SupabaseDashboardStore(mockClient);
  await dashStore.unlinkDiscord('usr_alice');
  assert.ok(
    deletedSettingKeys.includes('discord_link:555555555555555555'),
    `unlinkDiscord(usr_alice) must purge discord_link:<discordId> from manager_settings (got ${JSON.stringify(deletedSettingKeys)})`
  );

  // getSetting caches null hits
  const v1 = await dashStore.getSetting('bot_display_order');
  const v2 = await dashStore.getSetting('bot_display_order');
  assert.strictEqual(v1, null);
  assert.strictEqual(v2, null);
  assert.strictEqual(settingQueries, 1, 'getSetting must cache null values to avoid repeated Supabase queries');
});

test('AUDIT-R2-04: Discord /login works for legacy scrypt$ user, passes real userId & /admin password revokes sessions', async () => {
  const encKey = crypto.randomBytes(32).toString('hex');
  const scryptHash = hashPassword('LegacyPass99!');
  const linkedArgs = [];
  let adminSessionsRevoked = 0;
  let adminDbRevoked = false;

  const mockServices = {
    config: { discordGuildId: 'guild_r2_04', adminUsername: 'admin', adminPassword: 'AdminPass123!', encryptionKey: encKey, adminUserId: '888888888888888888' },
    registry: {
      getAdminPassword: () => null,
      setAdminPassword: () => {}
    },
    accessStore: {
      getUser: async (_name, opts) => {
        assert.strictEqual(opts?.bypassCache, true, 'Discord /login must bypass user cache');
        return {
          id: 'usr_legacy1',
          userId: 'usr_legacy1',
          username: 'legacy_user',
          password: null,
          _rawEncryptedPassword: scryptHash,
          status: 'active',
          planName: 'VIP'
        };
      },
      setAccess: async () => {},
      setSetting: async () => {},
      linkDiscord: async (...args) => { linkedArgs.push(args); return { ok: true }; },
      getUserByDiscordId: async () => null,
      adapter: {
        revokeUserSessions: async (uid) => { if (uid === 'admin') adminDbRevoked = true; }
      }
    },
    invalidateAdminSessions: () => { adminSessionsRevoked += 1; }
  };

  let lastReply = null;
  const loginInteraction = {
    isModalSubmit: () => true,
    isButton: () => false,
    isStringSelectMenu: () => false,
    customId: 'login_modal',
    guildId: 'guild_r2_04',
    guild: { id: 'guild_r2_04', ownerId: '888888888888888888' },
    user: { id: '777777777777777777' },
    deferred: false,
    replied: false,
    deferReply: async function() { this.deferred = true; },
    editReply: async (p) => { lastReply = p; },
    reply: async (p) => { lastReply = p; },
    fields: {
      getTextInputValue: (id) => (id === 'login_username' ? 'legacy_user' : 'LegacyPass99!')
    }
  };

  await handlePanelInteraction(loginInteraction, mockServices);
  assert.strictEqual(linkedArgs.length, 1, 'Legacy scrypt$ user must authenticate via Discord /login');
  assert.deepStrictEqual(linkedArgs[0], ['777777777777777777', 'legacy_user', 'usr_legacy1'], 'linkDiscord must receive real manager userId as 3rd arg');
  assert.ok(lastReply?.embeds?.[0]?.data?.title?.includes('THÀNH CÔNG'));

  // /admin password modal revokes admin Web sessions
  const adminPwInteraction = {
    isModalSubmit: () => true,
    isButton: () => false,
    isStringSelectMenu: () => false,
    customId: 'admin_password_modal',
    guildId: 'guild_r2_04',
    user: { id: '888888888888888888' },
    guild: { id: 'guild_r2_04', ownerId: '888888888888888888' },
    deferred: false,
    replied: false,
    deferReply: async function() { this.deferred = true; },
    editReply: async () => {},
    reply: async () => {},
    fields: { getTextInputValue: () => 'NewStrongAdminPass99!' }
  };
  await handlePanelInteraction(adminPwInteraction, mockServices);
  assert.strictEqual(adminDbRevoked, true, '/admin password must revoke DB admin sessions');
  assert.strictEqual(adminSessionsRevoked, 1, '/admin password must invalidate in-memory admin sessions');
});

test('AUDIT-R2-05: AdminNotifier.configureWebhook decrypts saved ciphertexts & worker-api /events tolerates notifier failure', async () => {
  const encKey = crypto.randomBytes(32).toString('hex');
  const discordUrl = 'https://discord.com/api/webhooks/123456789/secret_token_abc';
  const telegramToken = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
  const notifier = new AdminNotifier({ encryptionKey: encKey, logger: createLogger({ level: 'silent' }) });
  notifier.configureWebhook({
    enabled: true,
    discordUrl: '',
    discordUrlCiphertext: encryptSecret(discordUrl, encKey),
    telegramToken: '',
    telegramTokenCiphertext: encryptSecret(telegramToken, encKey),
    telegramChatId: '-100999'
  });
  assert.strictEqual(notifier.discordWebhookUrl, discordUrl, 'Encrypted Discord webhook URL must be restored on startup');
  assert.strictEqual(notifier.telegramBotToken, telegramToken, 'Encrypted Telegram token must be restored on startup');
  assert.strictEqual(notifier.telegramChatId, '-100999');

  // worker-api POST /events must return 200 even when notifier throws
  const app = express();
  app.use(express.json());
  const mockReg = {
    authenticate: async () => true,
    addEvent: async () => ({ ok: true }),
    find: async () => ({ workerId: 'bot-evt', alias: 'EvtBot' })
  };
  const throwingNotifier = {
    notifyBotLifecycleEvent: async () => { throw new Error('discord_api_down'); }
  };
  app.use('/api/v1/workers/:workerId', createWorkerApi({
    registry: mockReg,
    broker: {},
    workerStore: {},
    adminNotifier: throwingNotifier,
    config: {},
    logger: createLogger({ level: 'silent' })
  }));
  const srv = await startServer(app);
  try {
    const res = await fetch(`${srv.baseUrl}/api/v1/workers/bot-evt/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-worker-secret': 'secret_12345678901234567890123456789012' },
      body: JSON.stringify({ type: 'afk_kicked', reason: 'Kicked' })
    });
    assert.strictEqual(res.status, 200, 'Notification failure must NOT cause HTTP 500 retry storm on /events');
  } finally {
    await srv.close();
  }
});

test('AUDIT-R2-06: user-api POST /bot/:id/settings enforces allowAccountChange=false & preserves announcement modes', async () => {
  let savedSettings = null;
  let storedAnnouncement = null;
  const mockWorker = { workerId: 'bot-1', botNumber: 1, settings: {} };
  const mockRegistry = {
    find: async () => mockWorker,
    list: async () => [mockWorker],
    updateSettings: async (_id, patch) => { savedSettings = patch; return patch; }
  };
  const mockStore = {
    addAudit: async () => {},
    getSetting: async (key) => (key === 'system_announcement' ? storedAnnouncement : null),
    setSetting: async (key, val) => { if (key === 'system_announcement') storedAnnouncement = val; return val; }
  };

  const userApp = express();
  userApp.use(express.json());
  userApp.use('/api/manager', (req, _res, next) => {
    req.managerAuthSession = {
      role: 'user',
      userId: 'usr_restricted',
      username: 'restricted',
      assignedBotIds: ['bot-1'],
      allowAccountChange: false
    };
    next();
  }, createUserApi({
    store: mockStore,
    registry: mockRegistry,
    broker: {},
    config: {},
    logger: createLogger({ level: 'silent' })
  }));
  const adminApp = express();
  adminApp.use(express.json());
  adminApp.use('/api/admin', (req, _res, next) => {
    req.managerAuthSession = { role: 'admin', userId: 'admin', username: 'admin' };
    next();
  }, createAdminApi({
    store: mockStore,
    registry: mockRegistry,
    broker: {},
    config: {},
    logger: createLogger({ level: 'silent' })
  }));

  const userSrv = await startServer(userApp);
  const adminSrv = await startServer(adminApp);
  try {
    // Mixed payload with restricted field must be rejected with 403
    const badRes = await fetch(`${userSrv.baseUrl}/api/manager/bot/bot-1/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userNotifyEnabled: true,
        autoChatSchedules: [{ mode: 'interval', intervalSeconds: 30, messages: ['spam'] }],
        serverHost: 'evil.example'
      })
    });
    assert.strictEqual(badRes.status, 403, 'allowAccountChange=false must block restricted fields even when paired with notifyKeys');

    // Pure notifyKeys payload must be allowed
    const goodRes = await fetch(`${userSrv.baseUrl}/api/manager/bot/bot-1/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userNotifyEnabled: false, notifyOnAfkKick: false })
    });
    assert.strictEqual(goodRes.status, 200);
    assert.deepStrictEqual(savedSettings, { userNotifyEnabled: false, notifyOnAfkKick: false });

    // Announcement modes daily / every_login / time_range preserved end-to-end
    for (const mode of ['daily', 'every_login', 'time_range']) {
      const saveAnn = await fetch(`${adminSrv.baseUrl}/api/admin/announcement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, title: 'Test', content: 'Body', mode })
      });
      const saveBody = await saveAnn.json();
      assert.strictEqual(saveBody.announcement.mode, mode, `Admin POST /announcement must preserve mode=${mode}`);

      const getAnn = await fetch(`${userSrv.baseUrl}/api/manager/announcement`);
      const getBody = await getAnn.json();
      assert.strictEqual(getBody.announcement.mode, mode, `User GET /announcement must preserve mode=${mode}`);
    }
  } finally {
    await userSrv.close();
    await adminSrv.close();
  }
});

test('AUDIT-R2-07: SSRF trailing-dot / bracketed IPv6 blocked & CommandBroker.waitForResult settles on timeout', async () => {
  assert.strictEqual(isLocalOrPrivateHost('localhost.'), true);
  assert.strictEqual(isLocalOrPrivateHost('metadata.google.internal.'), true);
  assert.strictEqual(isPrivateOrBlockedIp('[::1]'), true);
  assert.strictEqual(isPrivateOrBlockedIp('[::ffff:169.254.169.254]'), true);
  await assert.rejects(() => validateSafeBotUrl('https://metadata.google.internal./latest'), /bị chặn/);
  await assert.rejects(() => validateProxyUrl('socks5://localhost.:1080'), /nội bộ/);
  assert.throws(() => validatePanelUrl('https://localhost./client'), /nội bộ/);

  // CommandBroker.waitForResult settles cleanly when pending command times out
  const broker = new CommandBroker({
    registry: { find: async () => ({ workerId: 'bot-t', enabled: true, transport: 'wispbyte-poll' }) },
    commandStore: {
      enqueue: async (cmd) => cmd,
      expire: async () => {}
    },
    config: { commandResultTimeoutMs: 120 },
    logger: createLogger({ level: 'silent' })
  });
  const worker = { workerId: 'bot-t', enabled: true, transport: 'wispbyte-poll' };
  const cid = crypto.randomUUID();
  const keepAlive = setTimeout(() => {}, 1500);
  let dispatchRes;
  let waitRes;
  try {
    const dispatchPromise = broker.dispatchPoll(worker, { commandId: cid, action: 'status', payload: {} });
    const waitPromise = broker.waitForResult(cid, { timeoutMs: 500 });
    [dispatchRes, waitRes] = await Promise.all([dispatchPromise, waitPromise]);
  } finally {
    clearTimeout(keepAlive);
  }
  assert.strictEqual(dispatchRes.timedOut, true);
  assert.strictEqual(waitRes.timedOut, true, 'waitForResult must settle with timedOut=true instead of hanging forever');
});

test('AUDIT-R2-08: Dashboard frontend scripts include notify dirty tracking, full statusMeta & hostHardware card diff', () => {
  assert.ok(DASHBOARD_SCRIPTS.includes('detailSettingUserNotifyEnabled'), 'Notify toggle must be wired in dashboard scripts');
  assert.ok(DASHBOARD_SCRIPTS.includes('detailSettingNotifyOnReconnectExhausted'), 'Reconnect exhausted toggle must be wired');
  assert.ok(DASHBOARD_SCRIPTS.includes("maintenance:['yellow','MAINTENANCE','maintenance']"), 'statusMeta must map maintenance');
  assert.ok(DASHBOARD_SCRIPTS.includes('b.hostHardware?.botRssMb'), 'computeBotCardSig must track hostHardware.botRssMb');
  assert.ok(DASHBOARD_SCRIPTS.includes('URL.revokeObjectURL'), 'exportBotList must revoke Blob object URL');
});

// ============================================================================
// ROUND 3 INDEPENDENT ADVERSARIAL AUDIT REGRESSION SUITE (AUDIT-R3-01 .. 12)
// ============================================================================

test('AUDIT-R3-01/02/03: Express 4 object-coercion DoS blocked, ?x=/renew expired bypass blocked, non-admin /reset blocked, settings response sanitized, cross-tenant botNumber IDOR blocked', async () => {
  // 1a. Unauthenticated ?botId[toString]=x on createApp must NEVER throw unhandled rejection
  const appStore = {
    adapter: { isEnabled: () => false },
    getSetting: async () => null,
    listAccess: async () => [],
    addAudit: async () => true
  };
  const app = createApp({
    store: appStore,
    registry: {
      list: async () => [],
      find: async () => null,
      verifyBotSecretSync: () => false
    },
    broker: { dispatch: async () => ({ delivered: true, result: { ok: true } }) },
    entitlementService: { gracePeriodMs: 6 * 3600 * 1000 },
    link4mService: { health: () => ({ ok: true, degraded: false }) },
    config: { sessionSecret: 'test-session-secret-0123456789abcdef', botSecretKey: 'global-secret-test-value-1234567890' },
    logger: silentLogger()
  });
  const srvApp = await startServer(app);
  try {
    const crashProbe = await fetch(`${srvApp.baseUrl}/health?botId[toString]=x`, {
      headers: { 'x-bot-secret': 'invalid-secret' }
    });
    assert.strictEqual(crashProbe.status, 200, 'Crafted ?botId[toString]=x must not crash auth middleware');
  } finally {
    await srvApp.close();
  }

  // 1b. Expired user ?x=/renew bypass blocked; non-admin /reset blocked; settings response sanitized; cross-tenant botNumber blocked
  let currentSession = {
    userId: 'usr_alice',
    username: 'alice',
    role: 'user',
    status: 'expired',
    isPermanent: false,
    expiresAtRental: new Date(Date.now() - 86400000).toISOString(),
    assignedBotIds: ['10'],
    allowAccountChange: false
  };
  const workers = [
    { workerId: '10', botNumber: 9, name: 'Alice Bot', enabled: true, status: { state: 'online' }, settings: { spawnCommands: '/login SuperSecret123', serviceUrl: 'https://internal.worker' } },
    { workerId: '11', botNumber: 10, name: 'Bob Bot', enabled: true, status: { state: 'online' }, settings: {} }
  ];
  const userApp = express();
  userApp.use(express.json());
  userApp.use((req, _res, next) => { req.managerAuthSession = currentSession; next(); });
  userApp.use('/api', createUserApi({
    store: { addAudit: async () => true, getSetting: async () => null },
    registry: {
      list: async () => workers,
      find: async (id) => workers.find((w) => w.workerId === String(id)) || null,
      findByNumber: async (n) => workers.find((w) => w.botNumber === Number(n)) || null,
      summary: () => ({}),
      updateSettings: async (_id, patch) => ({
        ...patch,
        serviceUrl: 'https://internal.secret.worker',
        proxyUrl: 'socks5://user:pass@1.2.3.4:1080',
        spawnCommands: '/login SuperSecret123'
      })
    },
    broker: { dispatch: async () => ({ delivered: true, result: { ok: true } }) },
    logger: silentLogger()
  }));
  const srvUser = await startServer(userApp);
  try {
    // Expired user with ?x=/renew MUST be blocked with 403
    const renewBypass = await fetch(`${srvUser.baseUrl}/api/bot/10/start?x=/renew`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    assert.strictEqual(renewBypass.status, 403, 'Expired user MUST NOT bypass checkBotPermissionAsync via ?x=/renew');

    // Active user still MUST NOT access Bob's bot (workerId '11', botNumber 10) even though Alice has '10'
    currentSession.status = 'active';
    currentSession.expiresAtRental = new Date(Date.now() + 86400000).toISOString();
    const idorBots = await (await fetch(`${srvUser.baseUrl}/api/bots`)).json();
    assert.deepStrictEqual(idorBots.bots.map((b) => b.workerId), ['10'], 'Alice must ONLY see workerId 10, NOT Bob workerId 11 whose botNumber shifted to 10');

    const idorAction = await fetch(`${srvUser.baseUrl}/api/bot/11/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    assert.strictEqual(idorAction.status, 403, 'Alice must get 403 accessing Bob bot workerId 11');

    // Non-admin user MUST NOT invoke /bot/:id/reset
    const resetRes = await fetch(`${srvUser.baseUrl}/api/bot/10/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    assert.strictEqual(resetRes.status, 403, 'Non-admin rental user must receive 403 on POST /bot/:id/reset');

    // Restricted user updating notify toggles gets 200 and response strips serviceUrl/proxyUrl & masks spawnCommands
    const settingsRes = await fetch(`${srvUser.baseUrl}/api/bot/10/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ settings: { userNotifyEnabled: false } })
    });
    assert.strictEqual(settingsRes.status, 200);
    const settingsJson = await settingsRes.json();
    assert.strictEqual(settingsJson.settings.serviceUrl, undefined, 'Non-admin /settings response must strip serviceUrl');
    assert.strictEqual(settingsJson.settings.proxyUrl, undefined, 'Non-admin /settings response must strip proxyUrl');
    assert.strictEqual(settingsJson.settings.spawnCommands, '********', 'Restricted user /settings response must mask spawnCommands');
  } finally {
    await srvUser.close();
  }
});

test('AUDIT-R3-04: insertKeys persists code_hash, createKey fails closed on false, admin session fails closed, saveOutboxItem avoids NaN bot_id, pre-restore backup accepted', async () => {
  const captured = [];
  const origFetch = global.fetch;
  global.fetch = async (url, opts = {}) => {
    captured.push({ url: String(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    if (String(url).includes('/rest/v1/manager_keys')) {
      return { ok: true, status: 201, json: async () => captured[captured.length - 1].body, text: async () => '' };
    }
    if (String(url).includes('/rest/v1/manager_sessions')) {
      return { ok: false, status: 500, text: async () => 'db_down' };
    }
    if (String(url).includes('/rest/v1/manager_outbox_queue')) {
      return { ok: true, status: 201, json: async () => [], text: async () => '' };
    }
    if (String(url).includes('/rest/v1/manager_backups')) {
      return { ok: true, status: 200, json: async () => [{ payload: { version: 2 } }], text: async () => '' };
    }
    return { ok: true, status: 200, json: async () => [], text: async () => '' };
  };
  try {
    const adapter = new SupabaseAdapter({ url: 'https://example.supabase.co', key: 'service-role-key' });
    const inserted = await adapter.insertKeys([{
      id: 'key_abc',
      keyId: 'key_abc',
      code: 'KM-AAAA-BBBB-CCCC',
      days: 7,
      workerIds: ['01'],
      allowAccountChange: false,
      createdBy: 'admin'
    }]);
    assert.strictEqual(inserted, true);
    const keyRow = captured[0].body[0];
    assert.ok(keyRow.code_hash && keyRow.code_hash.length === 64, 'insertKeys must persist 64-char sha256 code_hash');
    assert.strictEqual(keyRow.key_id, 'key_abc');
    assert.deepStrictEqual(keyRow.worker_ids, ['01']);
    assert.strictEqual(keyRow.allow_account_change, false);
    assert.strictEqual(keyRow.created_by, 'admin');

    // Admin session creation MUST fail closed (NOT fall through to non-admin RPC) when POST returns 500
    let rpcCalled = false;
    adapter.callRpc = async () => { rpcCalled = true; return { ok: true }; };
    const sessRes = await adapter.createManagerUserSession({ tokenHash: 'th', userId: 'admin', username: 'admin', role: 'admin', expiresAt: Date.now() + 60000 }, 1);
    assert.strictEqual(sessRes.ok, false, 'Admin session non-2xx must return ok:false');
    assert.strictEqual(rpcCalled, false, 'Admin session non-2xx must NOT fall through to create_manager_user_session RPC');

    // saveOutboxItem with undefined botId must write integer 0, never NaN/null
    const outboxOk = await adapter.saveOutboxItem({ id: 'outbox_comp', type: 'pending_allocation_compensation', payload: {} });
    assert.strictEqual(outboxOk, true);
    const outboxRow = captured.find((c) => c.url.includes('manager_outbox_queue')).body;
    assert.strictEqual(outboxRow.bot_id, 0, 'saveOutboxItem must coerce missing botId to integer 0');

    // fetchBackupPayload must accept pre-restore-*.json
    const preRestore = await adapter.fetchBackupPayload('pre-restore-2026-11-19T12-00-00.json');
    assert.deepStrictEqual(preRestore, { version: 2 });

    // SupabaseDashboardStore.createKey must throw when adapter.insertKeys returns false
    const store = new SupabaseDashboardStore({
      from: () => ({}),
      adapter: { insertKeys: async () => false }
    });
    await assert.rejects(() => store.createKey({ id: 'key_fail', code: 'KM-1111-2222' }), /Không thể lưu mã kích hoạt/);
  } finally {
    global.fetch = origFetch;
  }
});

test('AUDIT-R3-05: EntitlementService blocks unlimited fixed-worker keys & never overwrites disabled -> expired; Link4mService enforces attempt expiry & exposes redirectUrl/todayCount', async () => {
  const { Link4mService } = require('../src/services/link4m-service');

  // 5a. EntitlementService: uses === 0 with workerIds rejected; disabled user NOT overwritten to expired
  let savedAccessStatus = null;
  const mockStore = {
    listAccess: async () => [{
      userId: 'usr_ban',
      username: 'banneduser',
      role: 'user',
      status: 'grace_period',
      isPermanent: false,
      expiresAt: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
      workerIds: ['bot-1']
    }],
    getAccess: async () => ({
      userId: 'usr_ban',
      username: 'banneduser',
      role: 'user',
      status: 'disabled', // Admin banned while bot stop was in flight!
      isPermanent: false,
      expiresAt: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
      workerIds: ['bot-1']
    }),
    setAccess: async (_id, values) => { savedAccessStatus = values.status; }
  };
  const svc = new EntitlementService({
    store: mockStore,
    registry: { list: async () => [{ workerId: '01', enabled: true, rentable: true }] },
    logger: silentLogger(),
    gracePeriodMs: 6 * 3600 * 1000
  });
  await assert.rejects(
    () => svc.createCode({ days: 7, botCount: 1, workerIds: ['01'], maxUses: 0, actorId: 'admin' }),
    /redeemed once/
  );
  await svc.checkExpiredUsersAndGracefulStop({
    broker: { dispatch: async () => ({ delivered: true, result: { ok: true, state: 'stopped' } }) }
  });
  assert.strictEqual(savedAccessStatus, null, 'checkExpiredUsersAndGracefulStop must NEVER overwrite disabled status to expired');

  // 5b. Link4mService: expired attempt rejected + status/start backward-compatible fields
  const nonce = 'test-nonce-xyz';
  const tokenHash = crypto.createHash('sha256').update(nonce).digest('hex');
  const expiredAttempt = {
    attemptId: 'att_exp',
    userId: 'usr_1',
    tokenHash,
    status: 'pending',
    rewardHours: 12,
    createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() - 5 * 60 * 1000).toISOString()
  };
  const l4m = new Link4mService({
    store: {
      getLinkAttempt: async () => expiredAttempt,
      countLinkRewards: async () => 1,
      lastLinkReward: async () => null,
      getLatestLinkAttempt: async () => null,
      findActiveLinkAttempt: async () => ({ attemptId: 'att_live', providerUrl: 'https://link4m.co/abc', expiresAt: new Date(Date.now() + 60000).toISOString(), rewardHours: 12 })
    },
    accessControl: {
      memberFor: async () => ({ userId: 'usr_1', username: 'u1', role: 'user', status: 'active', isPermanent: false }),
      isEntitled: () => true
    },
    config: { enabled: true, link4mApiToken: 'tok', publicBaseUrl: 'https://mgr.example.com', dailyLimit: 2, rewardHours: 12 },
    logger: silentLogger()
  });
  await assert.rejects(() => l4m.completeReturn('att_exp', nonce), /hết hạn/);
  const st = await l4m.status('usr_1');
  assert.strictEqual(st.todayCount, 1);
  assert.strictEqual(st.remainingAttempts, 1);
  const started = await l4m.createLinkAttempt('usr_1', '1.2.3.4');
  assert.strictEqual(started.redirectUrl, 'https://link4m.co/abc');
  assert.strictEqual(started.providerUrl, 'https://link4m.co/abc');
});

test('AUDIT-R3-06/07/08/09: AdminNotifier circular safety, WispbyteKeepAlive decrypt preservation, CommandBroker empty pendingSteps/WispByte outbox/redirect, IPv6 SSRF & Registry grace cache', async () => {
  const { redactSensitiveObject } = require('../src/services/admin-notifier');
  const { ManagerRuntimeSettings } = require('../src/services/manager-runtime-settings');

  // 6. AdminNotifier circular object redaction must not stack overflow
  const circ = { a: 1, apiKey: 'secret123', err: new Error('boom token=abc') };
  circ.self = circ;
  const safe = redactSensitiveObject(circ);
  assert.strictEqual(safe.apiKey, '[REDACTED]');
  assert.strictEqual(safe.self, '[Circular]');
  assert.ok(String(safe.err).includes('[REDACTED]'));
  const notifier = new AdminNotifier({ logger: silentLogger() });
  const fakeLogger = { error: () => {}, warn: () => {} };
  notifier.hookLogger(fakeLogger);
  const hookedErrFn = fakeLogger.error;
  notifier.hookLogger(fakeLogger);
  assert.strictEqual(fakeLogger.error, hookedErrFn, 'hookLogger must be idempotent');

  // 7. WispbyteKeepAliveManager preserves undecryptable ciphertext & catches invalid panelUrl inside checkAll
  let savedWispAccounts = null;
  const wispMgr = new WispbyteKeepAliveManager({
    store: {
      getSetting: async () => [{ id: 'acc1', name: 'A1', cookie: 'enc:v1:corruptedciphertext', panelUrl: 'http://127.0.0.1/bad' }],
      setSetting: async (_k, val) => { savedWispAccounts = val; }
    },
    config: { encryptionKey: 'a'.repeat(32) },
    logger: silentLogger()
  });
  const checkRes = await wispMgr.checkAll({ notifyDiscord: false });
  assert.strictEqual(checkRes.success, true);
  assert.strictEqual(savedWispAccounts[0].cookie, 'enc:v1:corruptedciphertext', 'Undecryptable cookie ciphertext must NOT be wiped to null');

  // ManagerRuntimeSettings preserves rawSecretsCiphertext even when initial env renderApiKey exists
  let savedRuntime = null;
  const rt = new ManagerRuntimeSettings({
    store: { setSetting: async (_k, v) => { savedRuntime = v; } },
    encryptionKey: 'b'.repeat(32),
    initial: { renderApiKey: 'env-render-key' }
  });
  rt.secretsDecryptionFailed = true;
  rt.rawSecretsCiphertext = 'enc:v1:original-vault';
  rt.values = { publicBaseUrl: '', renderApiKey: 'env-render-key', link4mApiToken: '', link4mSecretKey: '' };
  await rt.persist();
  assert.strictEqual(savedRuntime.secretsCiphertext, 'enc:v1:original-vault', 'persist() must preserve rawSecretsCiphertext when secretsDecryptionFailed is true');

  // 8a. CommandBroker: pendingSteps: [] does NOT re-run registry.resetData; WispByte outbox item is completed (no infinite loop); dispatchRender blocks 3xx redirect
  let resetCalls = 0;
  let completedOutboxIds = [];
  const broker = new CommandBroker({
    registry: {
      find: async () => ({ workerId: 'w1', provider: 'wispbyte', enabled: true }),
      resetData: async () => { resetCalls += 1; },
      credential: async () => 'sec'.repeat(12),
      store: {
        adapter: {
          claimOutboxBatch: async () => [{ id: 'ob1', type: 'status', payload: { workerId: 'w1' } }],
          completeOutboxItem: async (id) => { completedOutboxIds.push(id); },
          failOutboxItem: async () => {},
          rescheduleOutboxItem: async () => {}
        }
      }
    },
    commandStore: {
      clearWorker: async () => { resetCalls += 1; }
    },
    fetchImpl: async (_url, opts) => {
      assert.strictEqual(opts.redirect, 'manual', 'dispatchRender must set redirect: manual');
      return { ok: false, status: 307, json: async () => ({}) };
    },
    logger: silentLogger()
  });
  await broker.syncResetState('w1', null, 'test', 'cmd1', { steps: [] });
  assert.strictEqual(resetCalls, 0, 'syncResetState with empty steps [] must NOT re-run resetData/clearWorker');
  await broker.processOutboxBatch();
  assert.deepStrictEqual(completedOutboxIds, ['ob1'], 'WispByte outbox item must be completed instead of looping forever');
  await assert.rejects(
    () => broker.dispatchRender({ workerId: 'w1', serviceUrl: 'https://evil.example.com' }, { commandId: 'c1', action: 'status', payload: {} }),
    /unexpected redirect/
  );

  // 8b. SupabaseCommandStore.take returns null immediately on empty RPC without fallback query
  let fallbackFromCalled = false;
  const cmdStore = new SupabaseCommandStore({
    rpc: async () => ({ data: [], error: null }),
    from: () => { fallbackFromCalled = true; throw new Error('fallback must not run'); }
  });
  const taken = await cmdStore.take('w1');
  assert.strictEqual(taken, null);
  assert.strictEqual(fallbackFromCalled, false, 'Empty RPC take() must NOT run fallback SELECT query');

  // 9. Canonical IPv6 SSRF & WorkerRegistry grace cache preservation & no botNumber reindex on remove
  for (const badIp of ['0:0:0:0:0:0:0:1', '0:0:0:0:0:ffff:127.0.0.1', '::127.0.0.1', '64:ff9b::127.0.0.1', '2002:7f00:0001::', 'fec0::1', '2001:db8::1']) {
    assert.strictEqual(isPrivateOrBlockedIp(badIp), true, `Manager proxy-validation must block ${badIp}`);
  }
  assert.strictEqual(isPrivateOrBlockedIp('2606:4700:4700::1111'), false);

  let updatedDuringRemove = false;
  const reg = new WorkerRegistry({
    store: {
      get: async () => ({ workerId: '01', botNumber: 1 }),
      remove: async () => true,
      list: async () => [{ workerId: '02', botNumber: 2 }],
      update: async () => { updatedDuringRemove = true; }
    },
    encryptionKey: 'c'.repeat(32)
  });
  reg.secretCache.set('02', { secret: 'new', previousSecret: 'old', graceUntil: Date.now() + 200000, cachedAt: Date.now() - 90000 });
  reg.pruneStaleMemory();
  assert.ok(reg.secretCache.has('02'), 'pruneStaleMemory must preserve secretCache entry during active rotation grace period');
  await reg.remove('01');
  assert.strictEqual(updatedDuringRemove, false, 'WorkerRegistry.remove must NOT shift remaining workers botNumber');
});

test('AUDIT-R3-10/11/12: Auth reserved usernames & IP limit, Admin /settings/system Link4M sync & admin session revoke, Discord afk/admin, Frontend XSS & UI fixes', async () => {
  const { resolveLinkedUser, checkBotOwnership } = require('../src/discord/handlers/panel-handler');
  const { getWorkerState } = require('../src/discord/panels/renderer');

  // 10a. auth-api blocks usr_admin & Discord snowflake usernames
  const authApp = express();
  authApp.use(express.json());
  authApp.use('/api/auth', createAuthApi({
    store: { getUser: async () => null },
    registry: {},
    config: { adminUsername: 'admin', sessionSecret: 's'.repeat(32) },
    logger: silentLogger(),
    activeSessions: new Map()
  }));
  const srvAuth = await startServer(authApp);
  try {
    for (const badName of ['usr_admin', '123456789012345678']) {
      const r = await fetch(`${srvAuth.baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: badName, password: 'password123', confirmPassword: 'password123' })
      });
      assert.strictEqual(r.status, 400, `Username ${badName} must be rejected with 400`);
    }
  } finally {
    await srvAuth.close();
  }

  // 10b. admin-api /settings/system persists Link4M fields & syncs link4mService; /admin/credentials revokes admin sessions
  const sysSettingsMap = new Map();
  let l4mConfigured = null;
  let adminSessionsRevoked = false;
  let dbAdminRevoked = false;
  const adminApp = express();
  adminApp.use(express.json());
  adminApp.use((req, _res, next) => {
    req.managerAuthSession = { userId: 'admin', username: 'admin', role: 'admin', tokenHash: 'curr_hash' };
    next();
  });
  adminApp.use('/api/admin', createAdminApi({
    store: {
      getSetting: async (k) => sysSettingsMap.get(k) ?? null,
      setSetting: async (k, v) => { sysSettingsMap.set(k, v); },
      listAudit: async () => [{ id: '1', action: 'TEST', details: '  =CMD()' }],
      adapter: { revokeAdminSessions: async () => { dbAdminRevoked = true; return { ok: true }; } }
    },
    link4mService: {
      config: {},
      publicConfig: () => ({ configuredEnabled: false, rewardHours: 12, dailyLimit: 2 }),
      configure: async (cfg) => { l4mConfigured = cfg; }
    },
    registry: { setAdminPassword: () => {}, encryptionKey: 'e'.repeat(32) },
    config: {},
    logger: silentLogger(),
    invalidateAdminSessions: () => { adminSessionsRevoked = true; }
  }));
  const srvAdmin = await startServer(adminApp);
  try {
    const postSys = await fetch(`${srvAdmin.baseUrl}/api/admin/settings/system`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ link4mRewardEnabled: true, link4mRewardHours: 24, link4mDailyLimit: 3, link4mMode: 'api', link4mApiToken: 'real-tok-123' })
    });
    assert.strictEqual(postSys.status, 200);
    const sysJson = await postSys.json();
    assert.strictEqual(sysJson.settings.link4mRewardEnabled, true);
    assert.strictEqual(sysJson.settings.link4mRewardHours, 24);
    assert.strictEqual(sysJson.settings.link4mDailyLimit, 3);
    assert.strictEqual(sysJson.settings.link4mApiToken, '********', 'API token must be masked in response');
    assert.deepStrictEqual(l4mConfigured, { enabled: true, rewardHours: 24, dailyLimit: 3 });

    const credRes = await fetch(`${srvAdmin.baseUrl}/api/admin/admin/credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'NewAdminPassword999!' })
    });
    assert.strictEqual(credRes.status, 200);
    assert.strictEqual(adminSessionsRevoked, true, 'Changing admin password must revoke cached admin sessions');
    assert.strictEqual(dbAdminRevoked, true, 'Changing admin password must revoke DB admin sessions');

    const csvText = await (await fetch(`${srvAdmin.baseUrl}/api/admin/audit-logs/export?format=csv`)).text();
    assert.ok(csvText.includes(`"'  =CMD()"`), 'CSV export must neutralize leading-whitespace formula injection');
  } finally {
    await srvAdmin.close();
  }

  // 11. Discord resolveLinkedUser elevates ONLY configured adminRoleId/adminUserId (never guild owner), checkBotOwnership blocks numeric mismatch & getWorkerState handles afk
  const ownerNotElevated = await resolveLinkedUser(
    { guildId: 'guild_r3_11', user: { id: '999999999999999999' }, guild: { id: 'guild_r3_11', ownerId: '999999999999999999' } },
    { accessStore: { getUserByDiscordId: async () => ({ userId: 'usr_owner', username: 'owner', role: 'user' }) }, config: { discordGuildId: 'guild_r3_11', adminRoleId: '111111111111111111' } }
  );
  assert.strictEqual(ownerNotElevated.role, 'user', 'Guild owner without configured adminRoleId or adminUserId must NOT be elevated to admin');

  const roleElevated = await resolveLinkedUser(
    { guildId: 'guild_r3_11', user: { id: '555555555555555555' }, member: { roles: ['111111111111111111'] }, guild: { id: 'guild_r3_11', ownerId: '999999999999999999' } },
    { accessStore: { getUserByDiscordId: async () => ({ userId: 'usr_mod', username: 'moduser', role: 'user' }) }, config: { discordGuildId: 'guild_r3_11', adminRoleId: '111111111111111111' } }
  );
  assert.strictEqual(roleElevated.role, 'admin', 'Configured adminRoleId inside allowed guild must elevate user in Discord');
  assert.strictEqual(checkBotOwnership({ role: 'user', assignedBotIds: ['10'] }, '11', { workerId: '11', botNumber: 10 }), false);
  assert.strictEqual(getWorkerState({ status: { state: 'afk' } }).isOnline, true, 'AFK state must be treated as online in Discord');

  // 12. Frontend XSS neutralization & UI fixes
  assert.ok(DASHBOARD_SCRIPTS.includes("replace(/[^a-zA-Z0-9_]/g, '')"), 'resolveItemTexture must restrict texture filename to [a-zA-Z0-9_]');
  assert.ok(DASHBOARD_SCRIPTS.includes('escapeHtml(tex.secondary)'), 'renderDetailRemoteGui must HTML-escape data-secondary-src');
  assert.ok(DASHBOARD_SCRIPTS.includes('isDetailSettingsRestrictedUser'), 'saveDetailSettings must support restricted users saving notify toggles');
  assert.ok(DASHBOARD_SCRIPTS.includes('res.data?.redirectUrl || res.data?.providerUrl'), 'startLink4mReward must read providerUrl fallback');
  assert.ok(DASHBOARD_STYLES.includes('--surface-soft:'), '--surface-soft token must be defined');
  assert.ok(DASHBOARD_STYLES.includes('transform: none;'), 'collapsed sidebar tooltip must reset transform');
});

// ============================================================================
// ROUND 4 INDEPENDENT ADVERSARIAL AUDIT REGRESSION SUITE (AUDIT-R4-01 .. 08)
// ============================================================================

test('AUDIT-R4-01/02: GCM authTag length check, verifyPassword explicit key, logger DAG, AsyncKeyLock timeout race, Captcha length/future ts, http gzip & fetchWithRetry body cancel', async () => {
  const { createGzipMiddleware } = require('../src/utils/http');
  const AsyncKeyLock = require('../src/services/async-key-lock');
  const { AccessControl } = require('../src/services/access-control');
  const { verifyPassword, decryptSecret } = require('../src/utils/secrets');

  // 1a. decryptSecret rejects truncated GCM auth tag (CWE-327)
  const validCt = encryptSecret('super-secret', ENC_KEY);
  const [ivB64, tagB64, ctB64] = validCt.split('.');
  const truncatedTag = Buffer.from(tagB64, 'base64').subarray(0, 8).toString('base64');
  assert.throws(
    () => decryptSecret([ivB64, truncatedTag, ctB64].join('.'), ENC_KEY),
    /invalid GCM IV or authentication tag length/i
  );

  // 1b. verifyPassword honors explicit encryption key
  const customKey = crypto.randomBytes(32);
  const encPw = encryptUserPassword('UserPass#2026', customKey);
  assert.strictEqual(verifyPassword('UserPass#2026', encPw, customKey), true);
  assert.strictEqual(verifyPassword('WrongPass', encPw, customKey), false);

  // 1c. Logger does NOT mark shared non-circular DAG objects as [CIRCULAR]
  const lines = [];
  const origLog = console.log;
  console.log = (l) => lines.push(l);
  try {
    const log = createLogger('info');
    const shared = { id: 'ok' };
    log.info('dag_test', { first: shared, second: shared });
  } finally {
    console.log = origLog;
  }
  const parsedLog = JSON.parse(lines[0]);
  assert.deepStrictEqual(parsedLog.second, { id: 'ok' }, 'Shared non-circular object must not be replaced by [CIRCULAR]');

  // 1d. AsyncKeyLock releases cleanly under tight timeout without deadlocking subsequent callers
  const lock = new AsyncKeyLock();
  await assert.rejects(
    () => lock.run('k-race', () => new Promise((r) => setTimeout(r, 80)), { executionTimeoutMs: 15 }),
    /Execution timeout/
  );
  const nextVal = await lock.run('k-race', async () => 'recovered', { waitTimeoutMs: 500 });
  assert.strictEqual(nextVal, 'recovered');
  assert.strictEqual(lock.size(), 0);

  // 1e. Captcha rejects oversized token & future timestamp
  assert.strictEqual(verifyCaptchaToken('a'.repeat(3000), '10', 'secret_captcha_key_0123456789').valid, false);
  const futureTok = Buffer.from(JSON.stringify({ ts: Date.now() + 300000, ttl: 180, nonce: 'n1', sig: '0'.repeat(64) })).toString('base64url');
  assert.strictEqual(verifyCaptchaToken(futureTok, '10', 'secret_captcha_key_0123456789').valid, false);

  // 1f. AccessControl.updateMember preserves allowAccountChange & botCount
  let storedAccess = null;
  const ac = new AccessControl({
    store: {
      getAccess: async () => ({
        userId: '123456789012345678',
        role: 'user',
        workerIds: ['bot-1'],
        allowAccountChange: false,
        botCount: 2,
        botAliases: { 'bot-1': 'VIP' },
        lockReason: 'none'
      }),
      setAccess: async (_uid, vals) => { storedAccess = vals; return vals; }
    }
  });
  await ac.updateMember('admin', '123456789012345678', { note: 'updated' }, 'admin');
  assert.strictEqual(storedAccess.allowAccountChange, false, 'updateMember must preserve allowAccountChange');
  assert.strictEqual(storedAccess.botCount, 2, 'updateMember must preserve botCount');

  // 1g. createGzipMiddleware skips pre-encoded/image responses and sets Vary: Accept-Encoding
  const gzApp = express();
  gzApp.use(createGzipMiddleware({ minLength: 10 }));
  gzApp.get('/json', (_req, res) => res.json({ msg: 'a'.repeat(100) }));
  gzApp.get('/pre', (_req, res) => {
    res.setHeader('Content-Encoding', 'br');
    res.send(Buffer.from('b'.repeat(100)));
  });
  gzApp.get('/img', (_req, res) => {
    res.setHeader('Content-Type', 'image/png');
    res.send(Buffer.from('p'.repeat(100)));
  });
  const gzSrv = await startServer(gzApp);
  try {
    const rJson = await fetch(`${gzSrv.baseUrl}/json`, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.ok(String(rJson.headers.get('vary') || '').toLowerCase().includes('accept-encoding'));
    const rPre = await fetch(`${gzSrv.baseUrl}/pre`, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.strictEqual(rPre.headers.get('content-encoding'), 'br', 'Must not double-compress pre-encoded responses');
    const rImg = await fetch(`${gzSrv.baseUrl}/img`, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.strictEqual(rImg.headers.get('content-encoding'), null, 'Must not gzip image/png responses');
  } finally {
    await gzSrv.close();
  }
});

test('AUDIT-R4-03/04: WorkerRegistry preserves grace secret across 60s TTL & normalizes summary/getLogs; WorkerStore deep clone & cacheTtlMs=0; fetchAuditLogs in.(SYSTEM,MANAGER)', async () => {
  // 3a. WorkerRegistry preserves previousSecret across 60s TTL refresh in credential() & verifyBotSecretSync()
  const secret1 = '1'.repeat(40);
  const secret2 = '2'.repeat(40);
  const reg = new WorkerRegistry({
    store: {
      get: async () => ({
        workerId: 'bot-rot',
        enabled: true,
        secretCiphertext: encryptSecret(secret2, ENC_KEY),
        settings: {}
      }),
      update: async () => ({}),
      patchSettings: async (_id, patch) => patch
    },
    encryptionKey: ENC_KEY
  });
  reg.secretCache.set('bot-rot', {
    secret: secret2,
    previousSecret: secret1,
    graceUntil: Date.now() + 240000,
    enabled: true,
    cachedAt: Date.now() - 90000 // > 60s TTL, still within 5m grace period!
  });
  assert.strictEqual(reg.verifyBotSecretSync('bot-rot', secret1), true, 'verifyBotSecretSync must honor previousSecret during grace period even past 60s TTL');
  const loadedSecret = await reg.credential('bot-rot');
  assert.strictEqual(loadedSecret, secret2);
  assert.strictEqual(reg.secretCache.get('bot-rot')?.previousSecret, secret1, 'credential() TTL refresh must preserve active previousSecret grace period');
  assert.strictEqual(await reg.authenticate('bot-rot', secret1), true, 'authenticate() must still accept previousSecret after credential() TTL refresh');

  reg.botLogsCache.set('bot-rot', [{ type: 'info', message: 'hi' }]);
  assert.strictEqual(reg.getLogs('BOT-ROT').length, 1, 'getLogs must normalize uppercase workerId');
  reg.getLogs('BOT-ROT').push({ type: 'mutated' });
  assert.strictEqual(reg.getLogs('bot-rot').length, 1, 'getLogs must return a copy to prevent external mutation');

  // 3b. SupabaseWorkerStore cacheTtlMs=0 disables cache & _cloneWorker deep-clones
  let dbReads = 0;
  const wsNoCache = new SupabaseWorkerStore({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            dbReads += 1;
            return { data: { worker_id: 'w1', bot_number: 1, settings: { a: 1 }, status: { online: true } }, error: null };
          }
        })
      })
    })
  }, { cacheTtlMs: 0 });
  assert.strictEqual(wsNoCache.cacheTtlMs, 0, 'cacheTtlMs: 0 must not fall back to 30000');
  await wsNoCache.get('w1');
  await wsNoCache.get('w1');
  assert.strictEqual(dbReads, 2, 'cacheTtlMs: 0 must bypass cache on every read');

  const wsCached = new SupabaseWorkerStore({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { worker_id: 'w1', bot_number: 1, settings: { nested: 'orig' }, status: { online: true } }, error: null })
        })
      })
    })
  }, { cacheTtlMs: 30000 });
  const r1 = await wsCached.get('w1');
  r1.settings.nested = 'POISONED';
  const r2 = await wsCached.get('w1');
  assert.strictEqual(r2.settings.nested, 'orig', 'Mutating returned worker settings must NOT poison SupabaseWorkerStore cache');

  // 3c. SupabaseAdapter.fetchAuditLogs uses log_type=in.(SYSTEM,MANAGER) so searching q never creates duplicate &or=
  let fetchedUrl = '';
  const origFetch = global.fetch;
  global.fetch = async (url) => {
    fetchedUrl = String(url);
    return { ok: true, status: 200, headers: new Headers({ 'content-range': '0-0/0' }), json: async () => [] };
  };
  try {
    const adapter = new SupabaseAdapter({ url: 'https://example.supabase.co', key: 'service-role-key' });
    await adapter.fetchAuditLogs({ logType: 'SYSTEM', q: 'supabase' });
    assert.ok(fetchedUrl.includes('log_type=in.(SYSTEM,MANAGER)'), 'SYSTEM logType must use log_type=in.(SYSTEM,MANAGER)');
    assert.strictEqual((fetchedUrl.match(/&or=\(/g) || []).length, 1, 'Combining logType=SYSTEM and q must produce at most ONE &or=( clause');
  } finally {
    global.fetch = origFetch;
  }
});

test('AUDIT-R4-05/06/07/08: Restricted user blocked on /auto-chat, /bot-schedules, /tags & /send auth cmds; audit redacts /login; invAction beats body.action; backup restore computes code_hash; Discord logs/renderer/login-html fixes', async () => {
  const logsCommand = require('../src/discord/commands/logs');
  const { renderBotsList } = require('../src/discord/panels/renderer');

  // 5a. user-api security & integrity checks
  const audits = [];
  const dispatched = [];
  const worker = { workerId: 'bot-r4', botNumber: 1, name: 'R4', enabled: true, status: { state: 'online', online: true }, settings: {} };
  let sess = {
    userId: 'usr_r4',
    username: 'r4user',
    role: 'user',
    status: 'active',
    isPermanent: true,
    assignedBotIds: ['bot-r4'],
    allowAccountChange: false
  };
  const userApp = express();
  userApp.use(express.json());
  let isUserR4DiscordLinked = false;
  userApp.use((req, _res, next) => { req.managerAuthSession = sess; next(); });
  userApp.use('/api', createUserApi({
    store: {
      addAudit: async (e) => { audits.push(e); },
      getSetting: async () => null,
      getDiscordLink: async () => (isUserR4DiscordLinked
        ? { manager_user_id: 'usr_r4', username: 'r4user', discord_user_id: '123456789012345678', status: 'active' }
        : null)
    },
    registry: {
      list: async () => [worker],
      find: async () => worker,
      updateSettings: async () => ({}),
      updateTags: async () => ({}),
      botLogsCache: new Map([['bot-r4', [{ type: 'info', message: 'old' }]]]),
      botLogRev: new Map(),
      botChatLogRev: new Map(),
      bumpRevision: () => {}
    },
    broker: {
      dispatch: async (_id, act, payload) => {
        dispatched.push({ act, payload });
        return { delivered: true, result: { ok: true } };
      }
    },
    entitlementService: {
      redeem: async () => ({ workerIds: ['bot-r4'], isPermanent: false, expiresAt: new Date(Date.now() + 86400000).toISOString(), allowAccountChange: false })
    },
    logger: silentLogger()
  }));
  const srvUser = await startServer(userApp);
  try {
    // Restricted user blocked on /auto-chat, /bot-schedules, /tags, and /send with /changepassword
    const acRes = await fetch(`${srvUser.baseUrl}/api/bot/bot-r4/auto-chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ autoChatSchedules: [{ messages: ['hi'] }] })
    });
    assert.strictEqual(acRes.status, 403, 'allowAccountChange=false must block /auto-chat');

    const bsRes = await fetch(`${srvUser.baseUrl}/api/bot/bot-r4/bot-schedules`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ botSchedules: [{ action: 'command', command: '/changepassword a b' }] })
    });
    assert.strictEqual(bsRes.status, 403, 'allowAccountChange=false must block /bot-schedules');

    const tagRes = await fetch(`${srvUser.baseUrl}/api/bot/bot-r4/tags`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tags: ['hacked'] })
    });
    assert.strictEqual(tagRes.status, 403, 'Non-admin must be blocked from POST /bot/:id/tags');

    const sendRestricted = await fetch(`${srvUser.baseUrl}/api/bot/bot-r4/send`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '/changepassword oldpass newpass' })
    });
    assert.strictEqual(sendRestricted.status, 403, 'allowAccountChange=false must block /changepassword in /send');

    // Admin sending /login must have password redacted in audit log and JSON echo
    sess = { ...sess, role: 'admin', allowAccountChange: true };
    const sendAdmin = await fetch(`${srvUser.baseUrl}/api/bot/bot-r4/send`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '/login SuperSecretMcPass99' })
    });
    assert.strictEqual(sendAdmin.status, 200);
    const sendJson = await sendAdmin.json();
    assert.ok(!sendJson.message.includes('SuperSecretMcPass99'), '/send response must redact /login password');
    assert.ok(!JSON.stringify(audits).includes('SuperSecretMcPass99'), 'Audit log must redact /login password');

    // Inventory URL invAction overrides forged req.body.action
    await fetch(`${srvUser.baseUrl}/api/bot/bot-r4/inventory/list`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'drop', slot: 36 })
    });
    const lastInv = dispatched[dispatched.length - 1];
    assert.strictEqual(lastInv.payload.action, 'list', 'URL invAction must override req.body.action');

    // /renew requires Discord link first, then syncs session.allowAccountChange
    sess.role = 'user';
    sess.allowAccountChange = true;
    isUserR4DiscordLinked = false;
    const unlinkedRenewRes = await fetch(`${srvUser.baseUrl}/api/renew`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'KM-TEST-1234' })
    });
    assert.strictEqual(unlinkedRenewRes.status, 403, 'Unlinked user must receive 403 DISCORD_LINK_REQUIRED on /renew');
    const unlinkedJson = await unlinkedRenewRes.json();
    assert.strictEqual(unlinkedJson.code, 'DISCORD_LINK_REQUIRED');

    isUserR4DiscordLinked = true;
    const renewRes = await fetch(`${srvUser.baseUrl}/api/renew`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'KM-TEST-1234' })
    });
    assert.strictEqual(renewRes.status, 200);
    assert.strictEqual(sess.allowAccountChange, false, '/renew must update session.allowAccountChange in memory');
  } finally {
    await srvUser.close();
  }

  // 6. admin-api batch-import > 50 rejected & backup restore computes code_hash + preserves allow_account_change/note
  let restoredKeyRow = null;
  const adminApp = express();
  adminApp.use(express.json());
  adminApp.use((req, _res, next) => { req.managerAuthSession = { userId: 'admin', username: 'admin', role: 'admin' }; next(); });
  adminApp.use('/api/admin', createAdminApi({
    store: {
      fetchBackupPayload: async () => ({
        version: 2,
        registry: [],
        users: [],
        keys: [{ keyId: 'k_old', code: 'KM-ABCD-EFGH', days: 7, allowAccountChange: false, note: 'vip-locked' }]
      }),
      addAudit: async () => {},
      client: {
        from: (tbl) => ({
          upsert: async (row) => { if (tbl === 'manager_keys') restoredKeyRow = row; return { error: null }; }
        })
      }
    },
    registry: { list: async () => [], saveConfig: async () => {} },
    broker: {},
    config: {},
    logger: silentLogger()
  }));
  const srvAdmin = await startServer(adminApp);
  try {
    const bigBatch = await fetch(`${srvAdmin.baseUrl}/api/admin/bots/batch-import`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bots: Array.from({ length: 51 }, (_, i) => ({ name: `b${i}` })) })
    });
    assert.strictEqual(bigBatch.status, 400, 'batch-import > 50 must be rejected with 400');

    const restoreRes = await fetch(`${srvAdmin.baseUrl}/api/admin/backups/backup-test.json/restore`, { method: 'POST' });
    assert.strictEqual(restoreRes.status, 200);
    assert.strictEqual(restoredKeyRow.code_hash.length, 64, 'Restore must compute SHA-256 code_hash for legacy keys');
    assert.strictEqual(restoredKeyRow.allow_account_change, false, 'Restore must preserve allow_account_change');
    assert.strictEqual(restoredKeyRow.note, 'vip-locked', 'Restore must preserve key note');
  } finally {
    await srvAdmin.close();
  }

  // 7. Discord /logs DB fallback + renderer code-block/login redaction + AFK online color
  const logsView = renderBotLogs({
    user: { role: 'user' },
    worker: { workerId: 'bot-1', botNumber: 1, name: 'B1' },
    logs: ['[chat] ```@everyone hacked```', '[cmd] /login MySecretPw99']
  });
  const logDesc = logsView.embeds[0].data.description;
  assert.ok(!logDesc.includes('MySecretPw99'), 'renderBotLogs must redact /login password');
  assert.ok(!logDesc.slice(logDesc.indexOf('```text\n') + 8, logDesc.lastIndexOf('\n```')).includes('```'), 'renderBotLogs must neutralize triple backticks inside log output');

  const afkListView = renderBotsList({ user: { username: 'u' }, workers: [{ workerId: 'b1', botNumber: 1, status: { state: 'afk', online: false } }] });
  assert.strictEqual(afkListView.embeds[0].data.color, 0x22c55e, 'renderBotsList must treat AFK state as online green');

  const cmdOut = await logsCommand.execute(
    { guildId: 'guild_logs_1', user: { id: '111111111111111111' }, guild: { id: 'guild_logs_1', ownerId: '111111111111111111' }, options: { getString: () => 'b1', getInteger: () => 10 } },
    {
      accessStore: { getUserByDiscordId: async () => null },
      registry: { list: async () => [{ workerId: 'b1', botNumber: 1, name: 'B1' }], getLogs: () => [] },
      store: { get: async () => ({ workerId: 'b1', events: [{ type: 'info', message: 'db-fallback-event' }] }) },
      config: { discordGuildId: 'guild_logs_1', adminUserId: '111111111111111111' }
    }
  );
  assert.ok(cmdOut.embeds[0].data.description.includes('db-fallback-event'), '/logs must fall back to persisted store.get(includeEvents:true) when RAM cache is empty');

  // 8. Frontend fixes (login-html --text-muted & 03-navigation-and-users escapeHtml(botId))
  assert.ok(!PUBLIC_LOGIN_HTML.includes("var(--muted)"), 'login-html must not reference undefined var(--muted)');
  assert.ok(DASHBOARD_SCRIPTS.includes("escapeHtml(botId) + ' (' + escapeHtml(botLabel)"), 'reassignBotConfirmMsg must escape botId');
});

// ----------------------------------------------------------------------------
// AUDIT-R4-09: Discord /wispbyte Admin Slash Command, Subcommands & Panel Handlers
// ----------------------------------------------------------------------------
test('AUDIT-R4-09: Discord /wispbyte admin slash command (list/check/add/remove), RBAC & panel buttons', async () => {
  const wispbyteCommand = require('../src/discord/commands/wispbyte');
  const { handlePanelInteraction } = require('../src/discord/handlers/panel-handler');

  // 1. Definition verification
  assert.strictEqual(wispbyteCommand.data.name, 'wispbyte');
  const subcmdNames = wispbyteCommand.data.options.map((o) => o.name).sort();
  assert.deepStrictEqual(subcmdNames, ['add', 'check', 'list', 'remove']);

  // 2. RBAC: non-admin rejected
  const nonAdminInteraction = {
    guildId: 'guild_wisp_1',
    user: { id: 'user_123' },
    guild: { id: 'guild_wisp_1', ownerId: 'owner_999' },
    options: { getSubcommand: () => 'list' }
  };
  const nonAdminServices = {
    accessStore: { getUserByDiscordId: async () => ({ role: 'user' }) },
    accessControl: { roleFor: () => 'user' },
    config: { discordGuildId: 'guild_wisp_1' }
  };
  const nonAdminRes = await wispbyteCommand.execute(nonAdminInteraction, nonAdminServices);
  assert.ok(nonAdminRes.embeds[0].data.title.includes('TỪ CHỐI TRUY CẬP'), 'Non-admin must be rejected from /wispbyte');

  // 3. Mock WispbyteKeepAliveManager
  let accountsDb = [
    { id: 'wisp1', name: 'Wisp Node 1', cookie: 'pterodactyl_session=valid_test_sess_1', panelUrl: 'https://wispbyte.com/client', lastStatus: 'ok', renewCount: 5 }
  ];
  let checkAllCalled = false;
  let addOrUpdateCalled = null;
  let deleteCalled = null;

  const mockWispManager = {
    getAccounts: async () => accountsDb,
    saveAccounts: async (accs) => { accountsDb = accs; },
    checkAll: async () => {
      checkAllCalled = true;
      return { success: true, total: 1, okCount: 1, expiredCount: 0, results: [{ id: 'wisp1', name: 'Wisp Node 1', success: true, status: 'ok', message: 'HTTP 200', renewCount: 6 }] };
    },
    addOrUpdateAccount: async (acc) => {
      addOrUpdateCalled = acc;
      accountsDb.push({ ...acc, lastStatus: 'idle', renewCount: 0 });
      return acc;
    },
    pingAccount: async () => ({ id: 'wisp_new', name: 'Wisp New', success: true, status: 'ok', message: 'HTTP 200' }),
    deleteAccount: async (id) => {
      deleteCalled = id;
      const idx = accountsDb.findIndex((a) => a.id === id);
      if (idx >= 0) { accountsDb.splice(idx, 1); return true; }
      return false;
    }
  };

  const adminInteraction = (subcommand, options = {}) => ({
    guildId: 'guild_wisp_1',
    user: { id: 'admin_123' },
    guild: { id: 'guild_wisp_1', ownerId: 'admin_123' },
    options: {
      getSubcommand: () => subcommand,
      getString: (key) => options[key] || null
    }
  });

  const adminServices = {
    accessStore: { getUserByDiscordId: async () => ({ role: 'admin' }) },
    accessControl: { roleFor: () => 'admin' },
    wispbyteKeepAlive: mockWispManager,
    config: { discordGuildId: 'guild_wisp_1' }
  };

  // 3a. /wispbyte list
  const listRes = await wispbyteCommand.execute(adminInteraction('list'), adminServices);
  assert.ok(listRes.embeds[0].data.description.includes('Wisp Node 1'), 'list must render configured accounts');
  assert.ok(listRes.components[0].components.some((c) => c.data.custom_id === 'wispbyte:check'), 'list must provide check button');

  // 3b. /wispbyte check
  const checkRes = await wispbyteCommand.execute(adminInteraction('check'), adminServices);
  assert.strictEqual(checkAllCalled, true, 'check must invoke checkAll');
  assert.ok(checkRes.embeds[0].data.description.includes('**Thành công:** **1**'), 'check must report okCount');

  // 3c. /wispbyte add validation & success
  const badIdRes = await wispbyteCommand.execute(adminInteraction('add', { id: 'BAD ID WITH SPACES', cookie: 'sess=1234567890' }), adminServices);
  assert.ok(badIdRes.embeds[0].data.title.includes('ID KHÔNG HỢP LỆ'), 'add must reject invalid ID format');

  const crlfRes = await wispbyteCommand.execute(adminInteraction('add', { id: 'wisp2', cookie: 'sess=1234567890\r\n' }), adminServices);
  assert.ok(crlfRes.embeds[0].data.title.includes('COOKIE KHÔNG HỢP LỆ'), 'add must reject CRLF cookie');

  const goodAddRes = await wispbyteCommand.execute(adminInteraction('add', { id: 'wisp_new', name: 'New Node', cookie: 'pterodactyl_session=valid_test_cookie_123' }), adminServices);
  assert.ok(goodAddRes.embeds[0].data.title.includes('ĐÃ LƯU TÀI KHOẢN'), 'add must save and verify account');
  assert.strictEqual(addOrUpdateCalled.id, 'wisp_new');

  // 3d. /wispbyte remove
  const delRes = await wispbyteCommand.execute(adminInteraction('remove', { id: 'wisp1' }), adminServices);
  assert.ok(delRes.embeds[0].data.title.includes('ĐÃ XÓA TÀI KHOẢN'), 'remove must delete existing account');
  assert.strictEqual(deleteCalled, 'wisp1');

  const notFoundDelRes = await wispbyteCommand.execute(adminInteraction('remove', { id: 'non_existent_id' }), adminServices);
  assert.ok(notFoundDelRes.embeds[0].data.title.includes('KHÔNG TÌM THẤY'), 'remove must return not found for missing ID');

  // 4. Panel button interactions in panel-handler.js
  let updatedPayload = null;
  const mockButtonInteraction = (customId, userId = 'admin_123') => ({
    guildId: 'guild_wisp_1',
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    customId,
    user: { id: userId },
    guild: { id: 'guild_wisp_1', ownerId: userId },
    deferUpdate: async () => {},
    update: async (payload) => { updatedPayload = payload; return payload; },
    editReply: async (payload) => { updatedPayload = payload; return payload; }
  });

  await handlePanelInteraction(mockButtonInteraction('wispbyte:list', 'admin_123'), adminServices);
  assert.ok(updatedPayload.embeds[0].data.title.includes('WISPBYTE'), 'wispbyte:list button must render list');

  await handlePanelInteraction(mockButtonInteraction('wispbyte:check', 'admin_456'), adminServices);
  assert.ok(updatedPayload.embeds[0].data.title.includes('KẾT QUẢ GIA HẠN WISPBYTE'), 'wispbyte:check button must execute check');
});
