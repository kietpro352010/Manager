'use strict';

const assert = require('node:assert');
const http = require('node:http');
const zlib = require('node:zlib');
const vm = require('node:vm');
const crypto = require('node:crypto');

const fs = require('node:fs');
const path = require('node:path');

const { createApp } = require('../src/http/app');
const { HTML: DASHBOARD_HTML } = require('../src/http/views/dashboard-html');
const dashboardParts = require('../src/http/views/dashboard');
const { WorkerRegistry } = require('../src/services/worker-registry');
const { EntitlementService } = require('../src/services/entitlement-service');
const SupabaseWorkerStore = require('../src/storage/supabase-worker-store');
const SupabaseDashboardStore = require('../src/storage/supabase-dashboard-store');
const { createLogger } = require('../src/utils/logger');
const { encryptSecret, encryptUserPassword } = require('../src/utils/secrets');

function createSilentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
}

function createInMemoryWorkerStore() {
  const workers = new Map();
  let updateCalls = 0;
  let addEventCalls = 0;
  return {
    workers,
    getUpdateCalls: () => updateCalls,
    getAddEventCalls: () => addEventCalls,
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
      return workers.size + 1;
    },
    async create(record) {
      workers.set(record.workerId, { ...record });
      return record;
    },
    async update(id, patch) {
      updateCalls += 1;
      const existing = workers.get(String(id).toLowerCase());
      if (!existing) throw new Error('Not found');
      const next = { ...existing, ...patch, updatedAt: new Date() };
      workers.set(String(id).toLowerCase(), next);
      return next;
    },
    async patchSettings(id, patch) {
      const existing = workers.get(String(id).toLowerCase());
      existing.settings = { ...(existing.settings || {}), ...patch };
      existing.updatedAt = new Date();
      return existing.settings;
    },
    async addEvent(id, event) {
      addEventCalls += 1;
      const existing = workers.get(String(id).toLowerCase());
      if (existing) {
        existing.events = existing.events || [];
        existing.events.push(event);
      }
    }
  };
}

async function runTests() {
  console.log('--- [POST-AUDIT FEATURES & OPTIMIZATION REGRESSION TESTS] ---');

  // 1. Modular Dashboard HTML structure, JS syntax, and Account Dropdown scroll
  console.log('1. Checking modular dashboard HTML/CSS/JS assembly & scrollable dropdown...');
  assert.ok(DASHBOARD_HTML.startsWith('<!doctype html>'));
  assert.ok(DASHBOARD_HTML.trim().endsWith('</html>'));
  assert.strictEqual((DASHBOARD_HTML.match(/<\/body>/g) || []).length, 1);
  assert.strictEqual((DASHBOARD_HTML.match(/<\/html>/g) || []).length, 1);
  assert.strictEqual((DASHBOARD_HTML.match(/<style>/g) || []).length, 1);
  assert.ok(dashboardParts.STYLE_FILES.length >= 4 && dashboardParts.PARTIAL_FILES.length >= 4 && dashboardParts.SCRIPT_FILES.length >= 4);
  new vm.Script(dashboardParts.SCRIPTS, { filename: 'dashboard-client.js' });
  assert.ok(dashboardParts.STYLES.includes('overflow-y: auto;'), 'Profile dropdown CSS must enable vertical scroll');
  assert.ok(dashboardParts.SCRIPTS.includes('fitGlobalProfileDropdownHeight'), 'Profile dropdown must dynamically fit viewport height');
  assert.ok(dashboardParts.SCRIPTS.includes('mcPassword'), 'Detail panel must populate mcPassword');
  console.log('✅ 1. Modular dashboard assembly, JS AST syntax & scrollable menu verified.');

  // 2. Unrestricted Bot Passwords + Two-way Bot & User Password Reveal
  console.log('2. Checking unrestricted bot password & admin/user password reveal endpoints...');
  const encryptionKey = crypto.randomBytes(32);
  const workerStore = createInMemoryWorkerStore();
  const registry = new WorkerRegistry({ store: workerStore, encryptionKey, adminNotifier: null });
  await registry.add({ workerId: 'bot-01', name: 'Alpha', provider: 'wispbyte', secret: 'w'.repeat(32) });
  await registry.add({ workerId: 'bot-02', name: 'Beta', provider: 'wispbyte', secret: 'x'.repeat(32) });

  // Fresh bot with empty password (server without /login) must be allowed
  await registry.updateCredentials('bot-02', { username: 'BotBeta', password: '' });
  const privBeta = await registry.privateSettings('bot-02');
  assert.strictEqual(privBeta.username, 'BotBeta');
  assert.strictEqual(privBeta.password, '');

  // Short (1 char), ultra-long (>300 chars), special chars must all succeed
  for (const pass of ['a', '123', 'X'.repeat(350), 'p@$$w0rd!\t#1']) {
    await registry.updateCredentials('bot-01', { username: 'BotAlpha', password: pass });
    const priv = await registry.privateSettings('bot-01');
    assert.strictEqual(priv.username, 'BotAlpha');
    assert.strictEqual(priv.password, pass, `Bot password of length ${pass.length} must roundtrip cleanly`);
  }

  // Omitting password when renaming username preserves existing password
  await registry.updateCredentials('bot-01', { username: 'BotAlphaRenamed', password: '' });
  const privPreserved = await registry.privateSettings('bot-01');
  assert.strictEqual(privPreserved.username, 'BotAlphaRenamed');
  assert.strictEqual(privPreserved.password, 'p@$$w0rd!\t#1', 'Empty password on update preserves prior secret');

  // Save final recognizable bot password
  await registry.updateCredentials('bot-01', { username: 'BotAlpha', password: 'SuperLongBotPassword_' + 'Z'.repeat(300) });

  const users = new Map([
    ['alice', {
      id: 'usr_alice',
      username: 'alice',
      password: encryptUserPassword('AlicePlain99!'),
      role: 'user',
      status: 'active',
      isPermanent: true,
      allowAccountChange: true,
      assignedBotIds: ['bot-01'],
      workerIds: ['bot-01']
    }]
  ]);
  let listAccessCalls = 0;
  const store = {
    adapter: { isEnabled: () => false },
    async getUser(id) {
      const k = String(id).toLowerCase().replace(/^usr_/, '');
      return users.get(k) || null;
    },
    async getAccess(id) {
      const k = String(id).toLowerCase().replace(/^usr_/, '');
      return users.get(k) || null;
    },
    async listAccess() {
      listAccessCalls += 1;
      return Array.from(users.values());
    },
    async assignedUser() { return { userId: 'usr_alice', username: 'alice' }; },
    async getSetting() { return null; },
    async addAudit() { return true; },
    invalidateCache() {}
  };

  const app = createApp({
    store,
    entitlementService: {},
    registry,
    broker: {},
    workerStore,
    config: { adminUsername: 'admin', adminPassword: 'admin-password-123', discordToken: '' },
    logger: createSilentLogger()
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // Login as admin
    const adminLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin-password-123' })
    });
    const adminToken = (await adminLogin.json()).token;

    // Admin reveals Alice's plaintext password
    const revealRes = await fetch(`${base}/api/manager/users/usr_alice/reveal-password`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    const revealJson = await revealRes.json();
    assert.strictEqual(revealRes.status, 200);
    assert.strictEqual(revealJson.password, 'AlicePlain99!');

    // Admin opens Bot Credentials modal -> POST /api/manager/admin/credentials with {}
    const credsPostRes = await fetch(`${base}/api/manager/admin/credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      body: '{}'
    });
    const credsPostJson = await credsPostRes.json();
    assert.strictEqual(credsPostRes.status, 200, 'POST /admin/credentials with {} must return bots list (not 400)');
    assert.strictEqual(credsPostJson.ok, true);
    assert.strictEqual(credsPostJson.bots[0].username, 'BotAlpha');
    assert.strictEqual(credsPostJson.bots[0].password, 'SuperLongBotPassword_' + 'Z'.repeat(300));

    // Invalid password field in POST /admin/credentials must return 400 (API-06)
    const badCredsRes = await fetch(`${base}/api/manager/admin/credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ password: '' })
    });
    assert.strictEqual(badCredsRes.status, 400, 'POST /admin/credentials with empty password must return 400');

    const unknownKeysCredsRes = await fetch(`${base}/api/manager/admin/credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ unrecognized: true })
    });
    assert.strictEqual(unknownKeysCredsRes.status, 400, 'POST /admin/credentials with unrecognized keys must return 400');

    // User /bot/:id/account and /snapshot?rev= optimization
    const aliceLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'AlicePlain99!' })
    });
    const aliceToken = (await aliceLogin.json()).token;

    const accRes = await fetch(`${base}/api/user/bot/bot-01/account`, {
      headers: { authorization: `Bearer ${aliceToken}` }
    });
    const accJson = await accRes.json();
    assert.strictEqual(accRes.status, 200);
    assert.strictEqual(accJson.username, 'BotAlpha');
    assert.strictEqual(accJson.password, 'SuperLongBotPassword_' + 'Z'.repeat(300));

    // 3. Snapshot delta rev & GET / precompressed gzip + ETag 304
    console.log('3. Checking /snapshot?rev= short-circuit, gzip & ETag 304...');
    const snap1Res = await fetch(`${base}/api/user/bot/bot-01/snapshot`, {
      headers: { authorization: `Bearer ${aliceToken}` }
    });
    const snap1 = await snap1Res.json();
    assert.strictEqual(snap1Res.status, 200);
    assert.strictEqual(snap1.settings.mcPassword, 'SuperLongBotPassword_' + 'Z'.repeat(300));
    assert.ok(snap1.rev);

    const snap2Res = await fetch(`${base}/api/user/bot/bot-01/snapshot?rev=${encodeURIComponent(snap1.rev)}`, {
      headers: { authorization: `Bearer ${aliceToken}` }
    });
    const snap2 = await snap2Res.json();
    assert.strictEqual(snap2.ok, true);
    assert.strictEqual(snap2.unchanged, true);
    assert.strictEqual(snap2.rev, snap1.rev);

    // Check raw gzip + ETag + 304 on GET / via node http (avoid auto-decompression hiding headers)
    const rootRes = await new Promise((resolve, reject) => {
      const req = http.request(`${base}/`, { headers: { 'Accept-Encoding': 'gzip' } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      req.end();
    });
    assert.strictEqual(rootRes.status, 200);
    assert.strictEqual(rootRes.headers['content-encoding'], 'gzip');
    assert.ok(rootRes.headers['etag'], 'ETag must be set on /');
    assert.ok(zlib.gunzipSync(rootRes.body).toString('utf8').includes('<title>KBOT'));

    const notModifiedRes = await fetch(`${base}/`, {
      headers: { 'If-None-Match': rootRes.headers['etag'] }
    });
    assert.strictEqual(notModifiedRes.status, 304);

    // 3b. Compact /bots payload & skip listAccess() for non-admin + 30d texture caching
    await registry.updateStatus('bot-01', {
      state: 'online',
      online: true,
      username: 'BotAlpha',
      inventory: { items: [{ id: 1, name: 'diamond_sword', count: 1 }], slots: { 0: { id: 1 } }, revision: 9 },
      currentWindow: { title: 'Chest', slots: [{ slot: 0, name: 'apple' }] }
    }, 'worker-heartbeat');
    const listBefore = listAccessCalls;
    const botsListRes = await fetch(`${base}/api/user/bots`, {
      headers: { authorization: `Bearer ${aliceToken}` }
    });
    const botsListJson = await botsListRes.json();
    assert.strictEqual(botsListRes.status, 200);
    assert.strictEqual(listAccessCalls, listBefore, 'Non-admin /bots must not call store.listAccess()');
    assert.deepStrictEqual(botsListJson.bots[0].inventory, [], 'Compact /bots omits heavy inventory');
    assert.strictEqual(botsListJson.bots[0].currentWindow, null, 'Compact /bots omits currentWindow');
    assert.ok(botsListJson.sig, 'GET /bots must return delta sig');

    const botsDeltaRes = await fetch(`${base}/api/user/bots?sig=${encodeURIComponent(botsListJson.sig)}`, {
      headers: { authorization: `Bearer ${aliceToken}` }
    });
    const botsDeltaJson = await botsDeltaRes.json();
    assert.strictEqual(botsDeltaRes.status, 200);
    assert.strictEqual(botsDeltaJson.ok, true);
    assert.strictEqual(botsDeltaJson.unchanged, true);
    assert.strictEqual(botsDeltaJson.sig, botsListJson.sig);

    const texRes = await fetch(`${base}/textures/3d/DIAMOND_SWORD.png`);
    assert.strictEqual(texRes.status, 200);
    assert.ok((texRes.headers.get('cache-control') || '').includes('max-age=2592000'), 'Textures must use 30-day cache-control');
    assert.strictEqual(
      fs.readFileSync(path.join(__dirname, '../src/http/app.js'), 'utf8').includes('CheckStatsKingMC-main'),
      false,
      'app.js must not reference external CheckStatsKingMC-main path'
    );
    console.log('✅ 2 & 3. Password reveal, bot creds, snapshot delta rev, compact /bots & ETag/gzip/textures verified.');
  } finally {
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }

  // 4. WorkerRegistry lightweight heartbeat DB coalescing + RAM-only ephemeral chat
  console.log('4. Checking WorkerRegistry heartbeat DB write coalescing & chat RAM buffering...');
  const updatesBefore = workerStore.getUpdateCalls();
  const statePayload = { state: 'online', online: true, username: 'BotAlpha', totemCount: 2, stateDigest: 'd1', isLightweight: true };
  await registry.updateStatus('bot-01', statePayload, 'worker-heartbeat');
  assert.strictEqual(workerStore.getUpdateCalls(), updatesBefore + 1, 'First heartbeat persists to DB');
  await registry.updateStatus('bot-01', statePayload, 'worker-heartbeat');
  assert.strictEqual(workerStore.getUpdateCalls(), updatesBefore + 1, 'Repeated unchanged lightweight heartbeat coalesces DB write');

  const eventsBefore = workerStore.getAddEventCalls();
  await registry.addEvent('bot-01', { type: 'chat', message: '<Player> hi' });
  assert.strictEqual(workerStore.getAddEventCalls(), eventsBefore, 'Ephemeral chat event must not write to Supabase');
  assert.ok(registry.getLogs('bot-01').some((e) => e.message.includes('hi')), 'Chat event kept in RAM logs');
  await registry.addEvent('bot-01', { type: 'bot_death', message: 'Died' });
  assert.strictEqual(workerStore.getAddEventCalls(), eventsBefore + 1, 'Important event persists to Supabase');

  // 5. EntitlementService N+1 pre-filter
  console.log('5. Checking EntitlementService N+1 pre-filter...');
  let bypassReads = 0;
  const ent = new EntitlementService({
    store: {
      listAccess: async () => [
        { userId: 'u_perm', username: 'perm', isPermanent: true, status: 'active' },
        { userId: 'u_future', username: 'future', isPermanent: false, status: 'active', expiresAt: new Date(Date.now() + 86400000).toISOString() },
        { userId: 'u_done', username: 'done', isPermanent: false, status: 'expired', expiresAt: new Date(Date.now() - 86400000).toISOString(), stopPendingWorkers: [] },
        { userId: 'u_due', username: 'due', isPermanent: false, status: 'active', expiresAt: new Date(Date.now() - 1000).toISOString(), workerIds: [] }
      ],
      getAccess: async (uid) => {
        bypassReads += 1;
        return { userId: uid, username: uid, isPermanent: false, status: 'active', expiresAt: new Date(Date.now() - 1000).toISOString(), workerIds: [] };
      },
      setAccess: async () => ({})
    }
  });
  await ent.checkExpiredUsersAndGracefulStop({});
  assert.strictEqual(bypassReads, 1, 'Must bypass getAccess for permanent/future/already-expired users and only check due user');

  // 6. SupabaseWorkerStore compact list columns & returning:false update
  console.log('6. Checking SupabaseWorkerStore compact select & minimal update...');
  let lastSelectClause = null;
  let selectedOnUpdate = false;
  const mockSbStore = new SupabaseWorkerStore({
    from: () => ({
      select: (cols) => {
        lastSelectClause = cols;
        return { order: () => ({ order: async () => ({ data: [{ worker_id: 'w1', bot_number: 1 }], error: null }) }) };
      },
      update: () => ({
        eq: () => {
          const p = Promise.resolve({ error: null });
          p.select = () => {
            selectedOnUpdate = true;
            return { maybeSingle: async () => ({ data: { worker_id: 'w1' }, error: null }) };
          };
          return p;
        }
      })
    })
  });
  await mockSbStore.list();
  assert.ok(lastSelectClause && !lastSelectClause.includes('events') && lastSelectClause !== '*', 'list() must exclude events column');
  await mockSbStore.update('w1', { status: { state: 'online' } }, { returning: false });
  assert.strictEqual(selectedOnUpdate, false, 'update(..., { returning: false }) must skip .select(*)');

  // 7. Compact worker store get(), DashboardStore cleanup when adapter connected, & hardened logger
  console.log('7. Checking compact worker get(), DashboardStore cleanup & hardened logger...');
  const selectClauses = [];
  const workerGetStore = new SupabaseWorkerStore({
    rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'not found' } }),
    from: () => ({
      select: (cols) => {
        selectClauses.push(cols);
        return {
          eq: () => ({
            maybeSingle: async () => ({ data: { worker_id: 'w1', bot_number: 1, events: [] }, error: null })
          })
        };
      },
      update: () => ({
        eq: () => ({
          select: () => ({ maybeSingle: async () => ({ data: { worker_id: 'w1' }, error: null }) })
        })
      })
    })
  });
  await workerGetStore.get('w1');
  assert.ok(selectClauses[0] && selectClauses[0] !== '*' && !selectClauses[0].includes('events'), 'get() without includeEvents omits events');
  await workerGetStore.addEvent('w1', { type: 'status', message: 'ok' });
  assert.strictEqual(selectClauses[1], '*', 'addEvent fallback loads includeEvents: true');

  const cleanedTables = [];
  const dashCleanupStore = new SupabaseDashboardStore({
    adapter: { testConnection: async () => ({ ok: true }) },
    from: (table) => ({
      delete: () => ({
        lt: async () => {
          cleanedTables.push(table);
          return { error: null };
        }
      })
    })
  });
  await dashCleanupStore.initialize();
  for (const t of ['audit_logs', 'bot_position_logs', 'manager_link4m_attempts', 'manager_sessions']) {
    assert.ok(cleanedTables.includes(t), `DashboardStore.initialize() must purge ${t} even when adapter testConnection succeeds`);
  }

  const capturedLogs = [];
  const origLog = console.log;
  console.log = (line) => capturedLogs.push(line);
  try {
    const logger = createLogger('info');
    const circular = { proxyUrl: 'socks5://alice:superpass@1.2.3.4:1080' };
    circular.self = circular;
    logger.info('circular_test', { nested: circular, err: new Error('boom') });
  } finally {
    console.log = origLog;
  }
  assert.strictEqual(capturedLogs.length, 1);
  const parsedLog = JSON.parse(capturedLogs[0]);
  assert.strictEqual(parsedLog.nested.proxyUrl, '[REDACTED]');
  assert.strictEqual(parsedLog.nested.self, '[CIRCULAR]');
  assert.strictEqual(parsedLog.err.message, 'boom');
  console.log('✅ 7. Compact worker get(), DashboardStore cleanup & hardened logger verified.');

  console.log('🎉 ALL POST-AUDIT FEATURES & OPTIMIZATION TESTS PASSED 100%!');
}

runTests().catch((err) => {
  console.error('❌ POST-AUDIT TEST FAILED:', err);
  process.exit(1);
});
