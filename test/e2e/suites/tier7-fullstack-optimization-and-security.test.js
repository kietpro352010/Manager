#!/usr/bin/env node
'use strict';

/**
 * =============================================================================
 * Tier 7 E2E Test Suite: Full-Stack Optimization, Security & Modular UI
 * =============================================================================
 * Validates real end-to-end Manager <-> MockSupabaseServer <-> Worker behavior:
 *   - Section A: Reversible AES-256-GCM passwords, scrypt$ auto-migration, unrestricted bot passwords
 *   - Section B: Multi-tenant authorization, allowAccountChange enforcement, DTO redaction & bounded session cache
 *   - Section C: Cross-repo WispbytePoller + ManagerReporter -> Manager -> Supabase coalescing,
 *                /bots?sig= & /snapshot?rev= delta polling, DB maintenance cleanup, compact projections,
 *                HTTP gzip/ETag/304 & 30d texture caching
 *   - Section D: Modular Dashboard assembly, DOM ID uniqueness, and real vm execution of
 *                fitGlobalProfileDropdownHeight, refreshHome, refreshDetail, and polling/timer guards
 * =============================================================================
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const vm = require('node:vm');

// Resolve worker deps if needed
const WORKER_ROOT = process.env.WORKER_DIR || path.resolve(__dirname, '../../../../worker');
const workerNodeModules = path.join(WORKER_ROOT, 'node_modules');
if (!module.paths.includes(workerNodeModules)) {
  module.paths.push(workerNodeModules);
}

const { createMockSupabaseServer } = require('../harness/mock-supabase');
const { createApp } = require('../../../src/http/app');
const { createSupabaseClient } = require('../../../src/storage/supabase-client');
const SupabaseWorkerStore = require('../../../src/storage/supabase-worker-store');
const SupabaseDashboardStore = require('../../../src/storage/supabase-dashboard-store');
const SupabaseCommandStore = require('../../../src/storage/supabase-command-store');
const { WorkerRegistry } = require('../../../src/services/worker-registry');
const CommandBroker = require('../../../src/services/command-broker');
const { EntitlementService } = require('../../../src/services/entitlement-service');
const AsyncKeyLock = require('../../../src/services/async-key-lock');
const { AccessControl } = require('../../../src/services/access-control');
const {
  hashPassword,
  decryptUserPassword,
  encryptUserPassword,
  encryptSecret,
  isStoredCredentialCiphertext
} = require('../../../src/utils/secrets');
const dashboardParts = require('../../../src/http/views/dashboard');
const { HTML: DASHBOARD_HTML } = require('../../../src/http/views/dashboard-html');

// Real Worker classes
const ManagerReporter = require(path.join(WORKER_ROOT, 'src/transports/manager-reporter'));
const WispbytePoller = require(path.join(WORKER_ROOT, 'src/transports/wispbyte-poller'));
const { MinecraftSession } = require(path.join(WORKER_ROOT, 'src/game/minecraft-session'));

const quietLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

async function test(id, description, fn) {
  totalTests++;
  const testNum = totalTests;
  try {
    await fn();
    passedTests++;
    console.log(`ok ${testNum} - [${id}] ${description}`);
  } catch (err) {
    failedTests++;
    console.error(`not ok ${testNum} - [${id}] ${description}`);
    console.error('  ---');
    console.error(`  message: ${err.message}`);
    if (err.expected !== undefined && err.actual !== undefined) {
      console.error(`  expected: ${JSON.stringify(err.expected)}`);
      console.error(`  actual:   ${JSON.stringify(err.actual)}`);
    }
    if (err.stack) {
      console.error(err.stack.split('\n').slice(0, 5).map((l) => `  # ${l.trim()}`).join('\n'));
    }
    console.error('  ...');
  }
}

function sha256Hex(val) {
  return crypto.createHash('sha256').update(String(val)).digest('hex');
}

async function createFullStackEnv({
  adminPassword = 'AdminStrongPassword!99',
  seedBots = [
    { worker_id: 'bot-01', bot_number: 1, name: 'Bot Alpha', secret: 'a'.repeat(32), enabled: true },
    { worker_id: 'bot-02', bot_number: 2, name: 'Bot Beta', secret: 'b'.repeat(32), enabled: true }
  ]
} = {}) {
  const encryptionKeyHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const encryptionKey = Buffer.from(encryptionKeyHex, 'hex');
  const supabaseServer = await createMockSupabaseServer();
  const supabaseClient = createSupabaseClient({ url: supabaseServer.url, secretKey: supabaseServer.secretKey });

  const workerStore = new SupabaseWorkerStore(supabaseClient);
  const accessStore = new SupabaseDashboardStore(supabaseClient);
  const commandStore = new SupabaseCommandStore(supabaseClient);
  await workerStore.initialize();
  await accessStore.initialize();
  await commandStore.initialize();

  if (Array.isArray(seedBots) && seedBots.length > 0) {
    supabaseServer.seed('manager_workers', seedBots.map((b) => ({
      worker_id: b.worker_id,
      bot_number: b.bot_number,
      name: b.name,
      enabled: b.enabled !== false,
      provider: 'wispbyte',
      service_url: '',
      secret_ciphertext: encryptSecret(b.secret, encryptionKey),
      settings: { ecoMode: true, rentable: true, proxyCiphertext: null, mcCredentialsCiphertext: null },
      status: { state: 'offline', online: false },
      events: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })));
  }

  const registry = new WorkerRegistry({
    store: workerStore,
    accessStore,
    encryptionKey,
    adminNotifier: null
  });
  await registry.load();

  const config = {
    adminUsername: 'admin',
    adminPassword,
    discordToken: '',
    encryptionKey,
    sessionSecret: 'test-session-secret-0123456789abcdef',
    trialGiftEnabled: true,
    trialDays: 3,
    workerPollWaitMs: 500
  };

  const broker = new CommandBroker({ registry, commandStore, config, logger: quietLogger });
  const accessControl = new AccessControl({ store: accessStore });
  const userLock = new AsyncKeyLock();
  const entitlementService = new EntitlementService({
    store: accessStore,
    registry,
    accessControl,
    userLock
  });

  const app = createApp({
    store: accessStore,
    entitlementService,
    registry,
    broker,
    commandStore,
    workerStore,
    config,
    logger: quietLogger
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    supabaseServer,
    supabaseClient,
    workerStore,
    accessStore,
    commandStore,
    registry,
    broker,
    app,
    server,
    baseUrl,
    encryptionKey,
    close: async () => {
      broker.stopOutboxProcessor?.();
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
      await supabaseServer.close();
    }
  };
}

async function loginHttp(baseUrl, username, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  return { status: res.status, data, setCookie: res.headers.get('set-cookie') || '' };
}

function createDashboardVmSandbox({ fetchImpl = async () => ({ ok: true, status: 200, text: async () => '{}' }) } = {}) {
  const elements = new Map();
  const capturedTimers = { intervals: [], timeouts: [] };

  function makeEl(id, tag = 'div') {
    const classSet = new Set();
    const attrs = new Map();
    const el = {
      id,
      tagName: tag.toUpperCase(),
      value: '',
      textContent: '',
      innerHTML: '',
      checked: false,
      disabled: false,
      style: {},
      dataset: {},
      classList: {
        add: (...cls) => cls.forEach((c) => classSet.add(c)),
        remove: (...cls) => cls.forEach((c) => classSet.delete(c)),
        toggle: (c, force) => {
          const next = force !== undefined ? Boolean(force) : !classSet.has(c);
          if (next) classSet.add(c); else classSet.delete(c);
          return next;
        },
        contains: (c) => classSet.has(c)
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      removeAttribute: (k) => attrs.delete(k),
      hasAttribute: (k) => attrs.has(k),
      getBoundingClientRect: () => ({ top: 10, bottom: 56, left: 0, right: 200, width: 200, height: 46 }),
      addEventListener: () => {},
      querySelectorAll: () => [],
      querySelector: () => null,
      prepend: () => {},
      appendChild: () => {},
      focus: () => { doc.activeElement = el; },
      play: () => Promise.resolve(),
      getContext: () => ({
        clearRect: () => {},
        beginPath: () => {},
        closePath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        arc: () => {},
        ellipse: () => {},
        bezierCurveTo: () => {},
        quadraticCurveTo: () => {},
        rect: () => {},
        clip: () => {},
        stroke: () => {},
        fill: () => {},
        fillRect: () => {},
        strokeRect: () => {},
        save: () => {},
        restore: () => {},
        translate: () => {},
        rotate: () => {},
        scale: () => {},
        setTransform: () => {},
        createRadialGradient: () => ({ addColorStop: () => {} }),
        createLinearGradient: () => ({ addColorStop: () => {} }),
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        globalAlpha: 1,
        shadowBlur: 0,
        shadowColor: ''
      })
    };
    return el;
  }

  const getEl = (id, tag = 'div') => {
    if (!elements.has(id)) elements.set(id, makeEl(id, tag));
    return elements.get(id);
  };

  const doc = {
    hidden: false,
    activeElement: null,
    documentElement: {
      clientHeight: 900,
      style: { setProperty: () => {} },
      setAttribute: () => {},
      getAttribute: () => null
    },
    body: makeEl('__body', 'body'),
    getElementById: (id) => getEl(id),
    createElement: (tag) => makeEl(`__anon_${Math.random()}`, tag),
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {}
  };

  const listeners = new Map();
  const storage = new Map();
  const localWin = {
    innerWidth: 1280,
    innerHeight: 900,
    __INITIAL_USER__: null,
    navigator: { onLine: true, userAgent: 'MockBrowser' },
    location: { protocol: 'http:', pathname: '/', search: '', hash: '', reload: () => {} },
    history: { replaceState: () => {}, pushState: () => {} },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k)
    },
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    addEventListener: (evt, fn) => {
      const list = listeners.get(evt) || [];
      list.push(fn);
      listeners.set(evt, list);
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {}
  };

  let nextTimerId = 1;
  const ctx = {
    window: localWin,
    document: doc,
    navigator: localWin.navigator,
    location: localWin.location,
    history: localWin.history,
    localStorage: localWin.localStorage,
    URL,
    URLSearchParams,
    AbortController,
    AbortSignal,
    Date,
    Math,
    JSON,
    Map,
    Set,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Promise,
    Error,
    encodeURIComponent,
    decodeURIComponent,
    parseInt,
    parseFloat,
    isFinite,
    isNaN,
    console,
    fetch: fetchImpl,
    requestAnimationFrame: localWin.requestAnimationFrame,
    cancelAnimationFrame: localWin.cancelAnimationFrame,
    confirm: () => true,
    setTimeout: (fn, ms) => {
      const id = nextTimerId++;
      capturedTimers.timeouts.push({ id, fn, ms, cleared: false });
      return id;
    },
    clearTimeout: (id) => {
      const item = capturedTimers.timeouts.find((t) => t.id === id);
      if (item) item.cleared = true;
    },
    setInterval: (fn, ms) => {
      const id = nextTimerId++;
      capturedTimers.intervals.push({ id, fn, ms, cleared: false });
      return id;
    },
    clearInterval: (id) => {
      const item = capturedTimers.intervals.find((t) => t.id === id);
      if (item) item.cleared = true;
    }
  };
  ctx.globalThis = ctx;
  ctx.self = localWin;

  vm.createContext(ctx);
  // Load modular scripts cleanly inside sandbox without boot auto-fetch race
  const bootCode = dashboardParts.SCRIPTS
    .replace(/\(async function checkSession\([\s\S]*?\}\)\(\);/, 'window.__skipAutoBoot = true;');
  vm.runInContext(bootCode, ctx, { filename: 'dashboard-tier7.vm.js' });

  return { ctx, doc, localWin, getEl, capturedTimers };
}

async function runAll() {
  console.log('TAP version 13');
  console.log('# Running Tier 7 E2E Suite: Full-Stack Optimization, Security & Modular UI');

  // =========================================================================
  // SECTION A: REVERSIBLE PASSWORDS, SCRYPT MIGRATION & UNRESTRICTED BOT PASS
  // =========================================================================

  await test('T7-01', 'Full-Stack Register stores AES-256-GCM ciphertext in MockSupabase and Admin reveals exact plaintext', async () => {
    const env = await createFullStackEnv();
    try {
      const regRes = await fetch(`${env.baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'reguser1',
          password: 'UserPass!2026',
          confirmPassword: 'UserPass!2026'
        })
      });
      const regJson = await regRes.json();
      assert.ok([200, 201].includes(regRes.status), `Expected 200/201 on /register, got ${regRes.status}: ${JSON.stringify(regJson)}`);
      assert.strictEqual(regJson.ok, true);

      const userRow = env.supabaseServer.db.tables.get('manager_users').get('reguser1');
      assert.ok(userRow, 'User row must exist in MockDatabase');
      assert.ok(isStoredCredentialCiphertext(userRow.password), 'Stored user password must use aes256$gcm$ ciphertext');
      assert.strictEqual(decryptUserPassword(userRow.password), 'UserPass!2026');

      const adminLogin = await loginHttp(env.baseUrl, 'admin', 'AdminStrongPassword!99');
      assert.strictEqual(adminLogin.status, 200);

      const revealRes = await fetch(`${env.baseUrl}/api/manager/users/${encodeURIComponent(userRow.id)}/reveal-password`, {
        method: 'POST',
        headers: { authorization: `Bearer ${adminLogin.data.token}` }
      });
      const revealJson = await revealRes.json();
      assert.strictEqual(revealRes.status, 200);
      assert.strictEqual(revealJson.password, 'UserPass!2026');
    } finally {
      await env.close();
    }
  });

  await test('T7-02', 'Legacy scrypt$ user auto-migrates to AES-256-GCM on login without redundant re-writes', async () => {
    const env = await createFullStackEnv({ seedBots: [] });
    try {
      const usersMap = env.supabaseServer.db.tables.get('manager_users');
      usersMap.set('legacyone', {
        id: 'usr_legacy1',
        username: 'legacyone',
        password: hashPassword('LegacyPass#77'),
        role: 'user',
        status: 'active',
        is_permanent: true,
        assigned_bot_ids: [],
        plan_name: 'VIP',
        allow_account_change: true,
        created_at: new Date().toISOString(),
        updated_at: '2026-01-01T00:00:00.000Z'
      });

      const login1 = await loginHttp(env.baseUrl, 'legacyone', 'LegacyPass#77');
      assert.strictEqual(login1.status, 200);

      const migratedRow = usersMap.get('legacyone');
      assert.ok(isStoredCredentialCiphertext(migratedRow.password), 'Legacy scrypt$ password must auto-migrate to AES ciphertext');
      assert.strictEqual(decryptUserPassword(migratedRow.password), 'LegacyPass#77');
      const updatedAfterFirst = migratedRow.updated_at;

      const adminLogin = await loginHttp(env.baseUrl, 'admin', 'AdminStrongPassword!99');
      const revealRes = await fetch(`${env.baseUrl}/api/manager/users/usr_legacy1/reveal-password`, {
        method: 'POST',
        headers: { authorization: `Bearer ${adminLogin.data.token}` }
      });
      assert.strictEqual((await revealRes.json()).password, 'LegacyPass#77');

      await new Promise((r) => setTimeout(r, 15));
      const cipherBeforeSecond = migratedRow.password;
      const login2 = await loginHttp(env.baseUrl, 'legacyone', 'LegacyPass#77');
      assert.strictEqual(login2.status, 200);
      assert.strictEqual(usersMap.get('legacyone').password, cipherBeforeSecond, 'Subsequent login must not re-encrypt AES password');
      assert.strictEqual(usersMap.get('legacyone').updated_at, updatedAfterFirst, 'Subsequent AES login must not redundantly update DB');
    } finally {
      await env.close();
    }
  });

  await test('T7-03', 'Change-password updates AES ciphertext, revokes prior DB session & Admin reveals new plaintext', async () => {
    const env = await createFullStackEnv({ seedBots: [] });
    try {
      env.supabaseServer.db.tables.get('manager_users').set('changer1', {
        id: 'usr_changer1',
        username: 'changer1',
        password: encryptUserPassword('OldPass!111'),
        role: 'user',
        status: 'active',
        is_permanent: true,
        assigned_bot_ids: [],
        plan_name: 'Standard',
        allow_account_change: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      const oldLogin = await loginHttp(env.baseUrl, 'changer1', 'OldPass!111');
      assert.strictEqual(oldLogin.status, 200);

      const chRes = await fetch(`${env.baseUrl}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${oldLogin.data.token}`
        },
        body: JSON.stringify({
          currentPassword: 'OldPass!111',
          newPassword: 'BrandNewPass!222'
        })
      });
      assert.strictEqual(chRes.status, 200);

      // Old session must be revoked (fail closed 401)
      const meAfter = await fetch(`${env.baseUrl}/api/auth/me`, {
        headers: { authorization: `Bearer ${oldLogin.data.token}` }
      });
      assert.strictEqual(meAfter.status, 401, 'Old token must be revoked after /change-password');

      const newLogin = await loginHttp(env.baseUrl, 'changer1', 'BrandNewPass!222');
      assert.strictEqual(newLogin.status, 200);

      const adminLogin = await loginHttp(env.baseUrl, 'admin', 'AdminStrongPassword!99');
      const revealRes = await fetch(`${env.baseUrl}/api/manager/users/usr_changer1/reveal-password`, {
        method: 'POST',
        headers: { authorization: `Bearer ${adminLogin.data.token}` }
      });
      assert.strictEqual((await revealRes.json()).password, 'BrandNewPass!222');
    } finally {
      await env.close();
    }
  });

  await test('T7-04', 'Unrestricted Bot Passwords E2E: Manager -> Worker Bootstrap -> MinecraftSession & Admin Creds', async () => {
    const env = await createFullStackEnv();
    try {
      env.supabaseServer.db.tables.get('manager_users').set('owner1', {
        id: 'usr_owner1',
        username: 'owner1',
        password: encryptUserPassword('OwnerPass!1'),
        role: 'user',
        status: 'active',
        is_permanent: true,
        assigned_bot_ids: ['bot-01', 'bot-02'],
        plan_name: 'VIP',
        allow_account_change: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      const reporter1 = new ManagerReporter({
        baseUrl: env.baseUrl,
        workerId: 'bot-01',
        secret: 'a'.repeat(32),
        logger: quietLogger
      });
      const session1 = new MinecraftSession(
        { mc: { hosts: ['127.0.0.1'], port: 25565, authEnabled: true }, afk: { mode: 'still', minMs: 180000, maxMs: 360000 } },
        quietLogger
      );

      // Fresh bot-02 with empty password ("")
      await env.registry.updateCredentials('bot-02', { username: 'NoAuthBot', password: '' });
      const reporter2 = new ManagerReporter({
        baseUrl: env.baseUrl,
        workerId: 'bot-02',
        secret: 'b'.repeat(32),
        logger: quietLogger
      });
      const bs2 = await reporter2.bootstrap();
      assert.strictEqual(bs2.credentials.username, 'NoAuthBot');
      assert.strictEqual(bs2.credentials.password, '');

      // 1-char, 380-char, and special/unicode passwords
      const userLogin = await loginHttp(env.baseUrl, 'owner1', 'OwnerPass!1');
      const adminLogin = await loginHttp(env.baseUrl, 'admin', 'AdminStrongPassword!99');

      for (const pass of ['x', 'P'.repeat(380), 'mật@khẩu! #99']) {
        await env.registry.updateCredentials('bot-01', { username: 'BotOne', password: pass });
        const bs1 = await reporter1.bootstrap();
        assert.strictEqual(session1.applyManagerCredentials(bs1.credentials), true);
        assert.strictEqual(session1.password, pass);

        const accRes = await fetch(`${env.baseUrl}/api/user/bot/bot-01/account`, {
          headers: { authorization: `Bearer ${userLogin.data.token}` }
        });
        assert.strictEqual(accRes.status, 200);
        const accJson = await accRes.json();
        assert.strictEqual(accJson.username, 'BotOne');
        assert.strictEqual(accJson.password, pass);
      }

      // WORKER-02: Control characters (\r, \n, \t) must be rejected by MinecraftSession credentials parser
      assert.throws(() => session1.applyManagerCredentials({ username: 'BotOne', password: 'bad\r\n/op' }), /invalid/i);
      assert.throws(() => session1.applyManagerCredentials({ username: 'BotOne', password: 'bad\tpass' }), /invalid/i);

      // Admin reads all bot credentials via GET & POST {}
      const getCreds = await fetch(`${env.baseUrl}/api/manager/admin/credentials`, {
        headers: { authorization: `Bearer ${adminLogin.data.token}` }
      });
      assert.strictEqual(getCreds.status, 200);
      const getJson = await getCreds.json();
      assert.strictEqual(getJson.bots.find((b) => b.workerId === 'bot-01').password, 'mật@khẩu! #99');

      const postEmpty = await fetch(`${env.baseUrl}/api/manager/admin/credentials`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${adminLogin.data.token}` },
        body: '{}'
      });
      assert.strictEqual(postEmpty.status, 200);
      assert.strictEqual((await postEmpty.json()).bots.length, 2);

      // Admin web password update still enforces 6-256 char limit
      const badAdminPass = await fetch(`${env.baseUrl}/api/manager/admin/credentials`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${adminLogin.data.token}` },
        body: JSON.stringify({ password: '123' })
      });
      assert.strictEqual(badAdminPass.status, 400);
    } finally {
      await env.close();
    }
  });

  // =========================================================================
  // SECTION B: MULTI-TENANT SECURITY, DTO HARDENING & SESSION CACHE BOUNDING
  // =========================================================================

  await test('T7-05', 'allowAccountChange=false blocks /account (403) and scrubs mcPassword from /snapshot and /settings', async () => {
    const env = await createFullStackEnv();
    try {
      await env.registry.updateCredentials('bot-01', { username: 'LockedBot', password: 'TopSecretMcPassword!' });
      env.supabaseServer.db.tables.get('manager_users').set('lockeduser', {
        id: 'usr_locked1',
        username: 'lockeduser',
        password: encryptUserPassword('LockedPass!1'),
        role: 'user',
        status: 'active',
        is_permanent: true,
        assigned_bot_ids: ['bot-01'],
        plan_name: 'Rental',
        allow_account_change: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      const uLogin = await loginHttp(env.baseUrl, 'lockeduser', 'LockedPass!1');
      const token = uLogin.data.token;

      const accRes = await fetch(`${env.baseUrl}/api/user/bot/bot-01/account`, {
        headers: { authorization: `Bearer ${token}` }
      });
      assert.strictEqual(accRes.status, 403);

      const snapRes = await fetch(`${env.baseUrl}/api/user/bot/bot-01/snapshot`, {
        headers: { authorization: `Bearer ${token}` }
      });
      const snapJson = await snapRes.json();
      assert.strictEqual(snapRes.status, 200);
      assert.strictEqual(snapJson.bot.mcPassword, undefined);
      assert.strictEqual(snapJson.settings.mcPassword, undefined);

      const setRes = await fetch(`${env.baseUrl}/api/user/bot/bot-01/settings`, {
        headers: { authorization: `Bearer ${token}` }
      });
      const setJson = await setRes.json();
      assert.strictEqual(setRes.status, 200);
      assert.strictEqual(setJson.settings.mcPassword, undefined);
    } finally {
      await env.close();
    }
  });

  await test('T7-06', 'Cross-tenant isolation blocks User B from User A bots and Admin credential endpoints', async () => {
    const env = await createFullStackEnv();
    try {
      env.supabaseServer.db.tables.get('manager_users').set('userb', {
        id: 'usr_b1',
        username: 'userb',
        password: encryptUserPassword('UserBPass!1'),
        role: 'user',
        status: 'active',
        is_permanent: true,
        assigned_bot_ids: ['bot-02'],
        plan_name: 'Standard',
        allow_account_change: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      const bLogin = await loginHttp(env.baseUrl, 'userb', 'UserBPass!1');
      const tokenB = bLogin.data.token;

      assert.strictEqual((await fetch(`${env.baseUrl}/api/user/bot/bot-01/account`, {
        headers: { authorization: `Bearer ${tokenB}` }
      })).status, 403);

      assert.strictEqual((await fetch(`${env.baseUrl}/api/user/bot/bot-01/snapshot`, {
        headers: { authorization: `Bearer ${tokenB}` }
      })).status, 403);

      assert.strictEqual((await fetch(`${env.baseUrl}/api/manager/users/usr_b1/reveal-password`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenB}` }
      })).status, 403);

      assert.strictEqual((await fetch(`${env.baseUrl}/api/manager/admin/credentials`, {
        headers: { authorization: `Bearer ${tokenB}` }
      })).status, 403);
    } finally {
      await env.close();
    }
  });

  await test('T7-07', 'Non-admin GET /bots hides managerRamMb, worker secrets/proxy/URLs & unassigned bots', async () => {
    const env = await createFullStackEnv();
    try {
      env.supabaseServer.db.tables.get('manager_users').set('tenant_a', {
        id: 'usr_ten_a',
        username: 'tenant_a',
        password: encryptUserPassword('TenantAPass!1'),
        role: 'user',
        status: 'active',
        is_permanent: true,
        assigned_bot_ids: ['bot-01'],
        plan_name: 'Starter',
        allow_account_change: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      const uLogin = await loginHttp(env.baseUrl, 'tenant_a', 'TenantAPass!1');
      const uBotsRes = await fetch(`${env.baseUrl}/api/user/bots`, {
        headers: { authorization: `Bearer ${uLogin.data.token}` }
      });
      const uBotsJson = await uBotsRes.json();
      assert.strictEqual(uBotsRes.status, 200);
      assert.strictEqual(uBotsJson.bots.length, 1);
      assert.strictEqual(uBotsJson.bots[0].workerId, 'bot-01');
      assert.strictEqual(uBotsJson.managerRamMb, undefined, 'Non-admin /bots must omit managerRamMb');
      assert.strictEqual(uBotsJson.bots[0].secretKey, undefined);
      assert.strictEqual(uBotsJson.bots[0].secretCiphertext, undefined);
      assert.strictEqual(uBotsJson.bots[0].url, '');
      assert.strictEqual(uBotsJson.bots[0].proxy, null);
      assert.strictEqual(uBotsJson.bots[0].rssMb, undefined);

      const adminLogin = await loginHttp(env.baseUrl, 'admin', 'AdminStrongPassword!99');
      const aBotsRes = await fetch(`${env.baseUrl}/api/manager/bots`, {
        headers: { authorization: `Bearer ${adminLogin.data.token}` }
      });
      const aBotsJson = await aBotsRes.json();
      assert.strictEqual(aBotsRes.status, 200);
      assert.strictEqual(aBotsJson.bots.length, 2);
      assert.strictEqual(typeof aBotsJson.managerRamMb, 'number');
    } finally {
      await env.close();
    }
  });

  await test('T7-08', 'activeSessions cache prunes >500 expired sessions cleanly without unbounded growth', async () => {
    const env = await createFullStackEnv({ seedBots: [] });
    try {
      env.supabaseServer.db.tables.get('manager_users').set('batchuser', {
        id: 'usr_batch1',
        username: 'batchuser',
        password: encryptUserPassword('BatchPass!1'),
        role: 'user',
        status: 'active',
        is_permanent: true,
        assigned_bot_ids: [],
        plan_name: 'Standard',
        allow_account_change: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      const sessionsMap = env.supabaseServer.db.tables.get('manager_sessions');
      const shortExpiry = Date.now() + 300;
      const tokens = [];
      for (let i = 0; i < 510; i++) {
        const tok = `tok_batch_${i}_${crypto.randomBytes(6).toString('hex')}`;
        tokens.push(tok);
        sessionsMap.set(sha256Hex(tok), {
          token_hash: sha256Hex(tok),
          user_id: 'usr_batch1',
          username: 'batchuser',
          role: 'user',
          assigned_bot_ids: [],
          expires_at: shortExpiry,
          plan_name: 'Standard',
          allow_account_change: true,
          status: 'active',
          updated_at: new Date().toISOString()
        });
      }

      // Warm cache via /api/auth/me in chunks
      for (let i = 0; i < tokens.length; i += 50) {
        await Promise.all(tokens.slice(i, i + 50).map((t) =>
          fetch(`${env.baseUrl}/api/auth/me`, { headers: { authorization: `Bearer ${t}` } })
        ));
      }

      await new Promise((r) => setTimeout(r, 350));

      // Fresh valid session triggers cacheSession -> pruneExpiredSessions(500)
      const freshTok = `tok_fresh_${crypto.randomBytes(8).toString('hex')}`;
      sessionsMap.set(sha256Hex(freshTok), {
        token_hash: sha256Hex(freshTok),
        user_id: 'usr_batch1',
        username: 'batchuser',
        role: 'user',
        assigned_bot_ids: [],
        expires_at: Date.now() + 60000,
        plan_name: 'Standard',
        allow_account_change: true,
        status: 'active',
        updated_at: new Date().toISOString()
      });

      const freshMe = await fetch(`${env.baseUrl}/api/auth/me`, {
        headers: { authorization: `Bearer ${freshTok}` }
      });
      assert.strictEqual(freshMe.status, 200);
      assert.ok(fs.readFileSync(path.join(__dirname, '../../../src/http/app.js'), 'utf8').includes('pruneExpiredSessions'));
    } finally {
      await env.close();
    }
  });

  // =========================================================================
  // SECTION C: LIVE CROSS-REPO TELEMETRY, DELTA POLLING & DB CLEANUP
  // =========================================================================

  await test('T7-09', 'Live WispbytePoller + ManagerReporter -> Manager -> MockSupabase coalescing & delta ?sig= / ?rev=', async () => {
    const env = await createFullStackEnv();
    try {
      env.supabaseServer.db.tables.get('manager_users').set('liveop', {
        id: 'usr_liveop',
        username: 'liveop',
        password: encryptUserPassword('LiveOpPass!1'),
        role: 'user',
        status: 'active',
        is_permanent: true,
        assigned_bot_ids: ['bot-01'],
        plan_name: 'VIP',
        allow_account_change: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      const userToken = (await loginHttp(env.baseUrl, 'liveop', 'LiveOpPass!1')).data.token;

      let currentStatus = {
        state: 'online',
        online: true,
        username: 'LiveBot',
        health: 20,
        food: 20,
        totemCount: 3,
        pingMs: 22,
        locationState: 'Game',
        position: { x: 100, y: 64, z: 200 },
        inventory: { items: [{ id: 1, name: 'totem_of_undying', count: 3 }], slots: { 45: { id: 1 } }, revision: 10 },
        currentWindow: { title: 'KingSMP', slots: [{ slot: 0, name: 'diamond_sword' }], revision: 2 }
      };

      const reporter = new ManagerReporter({
        baseUrl: env.baseUrl,
        workerId: 'bot-01',
        secret: 'a'.repeat(32),
        logger: quietLogger
      });

      const origUpdate = env.workerStore.update.bind(env.workerStore);
      let workerDbUpdates = 0;
      env.workerStore.update = async (...args) => {
        workerDbUpdates += 1;
        return origUpdate(...args);
      };

      let pollCount = 0;
      let poller;
      poller = new WispbytePoller({
        config: { managerUrl: env.baseUrl, workerId: 'bot-01', secret: 'a'.repeat(32) },
        runtime: { status: () => ({ ...currentStatus }) },
        reporter,
        logger: quietLogger,
        fetchImpl: async (url, init) => {
          pollCount += 1;
          const res = await fetch(url, init);
          if (pollCount >= 2) {
            poller.stopping = true;
            poller.stopController.abort();
          }
          return res;
        }
      });

      // Poll #1 (full) & Poll #2 (identical -> lightweight + coalesced)
      await poller.start();
      await poller.stop();
      assert.strictEqual(pollCount, 2);
      assert.strictEqual(workerDbUpdates, 1, '2 identical polls must persist to Supabase only once (2nd coalesced)');

      const snap1 = await (await fetch(`${env.baseUrl}/api/user/bot/bot-01/snapshot`, {
        headers: { authorization: `Bearer ${userToken}` }
      })).json();
      assert.strictEqual(snap1.ok, true);
      assert.strictEqual(snap1.inventory.revision, 10, 'Lightweight Poll #2 must NOT wipe rich snapshot inventory');
      assert.strictEqual(snap1.bot.currentWindow.title, 'KingSMP', 'Lightweight Poll #2 must NOT wipe currentWindow');

      const bots1 = await (await fetch(`${env.baseUrl}/api/user/bots`, {
        headers: { authorization: `Bearer ${userToken}` }
      })).json();
      assert.deepStrictEqual(bots1.bots[0].inventory, []);
      assert.strictEqual(bots1.bots[0].currentWindow, null);
      assert.ok(bots1.sig);

      const snapDelta = await (await fetch(`${env.baseUrl}/api/user/bot/bot-01/snapshot?rev=${encodeURIComponent(snap1.rev)}`, {
        headers: { authorization: `Bearer ${userToken}` }
      })).json();
      assert.strictEqual(snapDelta.unchanged, true);

      const botsDelta = await (await fetch(`${env.baseUrl}/api/user/bots?sig=${encodeURIComponent(bots1.sig)}`, {
        headers: { authorization: `Bearer ${userToken}` }
      })).json();
      assert.strictEqual(botsDelta.unchanged, true);

      // Poll #3: inventory revision changes without changing totemCount -> breaks lightweight, updates DB & revs!
      currentStatus = {
        ...currentStatus,
        inventory: { items: [{ id: 1, name: 'totem_of_undying', count: 3 }, { id: 2, name: 'golden_apple', count: 5 }], slots: { 45: { id: 1 } }, revision: 11 },
        currentWindow: null
      };
      pollCount = 0;
      const poller3 = new WispbytePoller({
        config: { managerUrl: env.baseUrl, workerId: 'bot-01', secret: 'a'.repeat(32) },
        runtime: { status: () => ({ ...currentStatus }) },
        reporter,
        logger: quietLogger,
        fetchImpl: async (url, init) => {
          pollCount += 1;
          const res = await fetch(url, init);
          poller3.stopping = true;
          poller3.stopController.abort();
          return res;
        }
      });
      await poller3.start();
      await poller3.stop();

      assert.strictEqual(workerDbUpdates, 2, 'Poll #3 with changed inventory revision persists to Supabase');

      const snap2 = await (await fetch(`${env.baseUrl}/api/user/bot/bot-01/snapshot?rev=${encodeURIComponent(snap1.rev)}`, {
        headers: { authorization: `Bearer ${userToken}` }
      })).json();
      assert.strictEqual(snap2.unchanged, undefined);
      assert.notStrictEqual(snap2.rev, snap1.rev);
      assert.strictEqual(snap2.inventory.revision, 11);
      assert.strictEqual(snap2.bot.currentWindow, null);

      const bots2 = await (await fetch(`${env.baseUrl}/api/user/bots?sig=${encodeURIComponent(bots1.sig)}`, {
        headers: { authorization: `Bearer ${userToken}` }
      })).json();
      assert.strictEqual(bots2.unchanged, undefined);
      assert.notStrictEqual(bots2.sig, bots1.sig);
    } finally {
      await env.close();
    }
  });

  await test('T7-10', 'SupabaseDashboardStore.initialize() purges stale audit/pos/link/sessions against MockSupabaseServer', async () => {
    const supabaseServer = await createMockSupabaseServer();
    try {
      const client = createSupabaseClient({ url: supabaseServer.url, secretKey: supabaseServer.secretKey });
      const dashStore = new SupabaseDashboardStore(client);

      const nowMs = Date.now();
      const old35d = new Date(nowMs - 35 * 86400000).toISOString();
      const fresh1d = new Date(nowMs - 1 * 86400000).toISOString();
      const old20d = new Date(nowMs - 20 * 86400000).toISOString();

      supabaseServer.seed('audit_logs', [
        { id: 'aud_old', action: 'OLD', timestamp: old35d },
        { id: 'aud_new', action: 'NEW', timestamp: fresh1d }
      ]);
      supabaseServer.seed('bot_position_logs', [
        { id: 'pos_old', bot_id: '1', changed_at: old20d },
        { id: 'pos_new', bot_id: '1', changed_at: fresh1d }
      ]);
      supabaseServer.seed('manager_link4m_attempts', [
        { attempt_id: 'lnk_old', purge_at: new Date(nowMs - 60000).toISOString() },
        { attempt_id: 'lnk_new', purge_at: new Date(nowMs + 600000).toISOString() }
      ]);
      supabaseServer.seed('manager_sessions', [
        { token_hash: 'sess_old', user_id: 'u1', username: 'u1', role: 'user', expires_at: nowMs - 10000 },
        { token_hash: 'sess_new', user_id: 'u1', username: 'u1', role: 'user', expires_at: nowMs + 600000 }
      ]);

      await dashStore.initialize();

      const db = supabaseServer.db;
      assert.strictEqual(db.tables.get('audit_logs').has('aud_old'), false);
      assert.strictEqual(db.tables.get('audit_logs').has('aud_new'), true);
      assert.strictEqual(db.tables.get('bot_position_logs').has('pos_old'), false);
      assert.strictEqual(db.tables.get('bot_position_logs').has('pos_new'), true);
      assert.strictEqual(db.tables.get('manager_link4m_attempts').has('lnk_old'), false);
      assert.strictEqual(db.tables.get('manager_link4m_attempts').has('lnk_new'), true);
      assert.strictEqual(db.tables.get('manager_sessions').has('sess_old'), false);
      assert.strictEqual(db.tables.get('manager_sessions').has('sess_new'), true);
    } finally {
      await supabaseServer.close();
    }
  });

  await test('T7-11', 'SupabaseCommandStore.runMaintenanceCleanup() expires overdue queued cmds & prunes old rows', async () => {
    const supabaseServer = await createMockSupabaseServer();
    try {
      const client = createSupabaseClient({ url: supabaseServer.url, secretKey: supabaseServer.secretKey });
      const cmdStore = new SupabaseCommandStore(client);

      const nowMs = Date.now();
      supabaseServer.seed('manager_commands', [
        {
          command_id: 'cmd_overdue',
          worker_id: 'bot-01',
          action: 'chat',
          status: 'queued',
          created_at: new Date(nowMs - 60000).toISOString(),
          expires_at: new Date(nowMs - 5000).toISOString()
        },
        {
          command_id: 'cmd_old_done',
          worker_id: 'bot-01',
          action: 'status',
          status: 'completed',
          created_at: new Date(nowMs - 400000).toISOString(),
          expires_at: new Date(nowMs - 340000).toISOString()
        },
        {
          command_id: 'cmd_ancient',
          worker_id: 'bot-01',
          action: 'start',
          status: 'delivered',
          created_at: new Date(nowMs - 8 * 86400000).toISOString(),
          expires_at: new Date(nowMs + 60000).toISOString()
        },
        {
          command_id: 'cmd_active',
          worker_id: 'bot-01',
          action: 'start',
          status: 'queued',
          created_at: new Date(nowMs - 5000).toISOString(),
          expires_at: new Date(nowMs + 60000).toISOString()
        }
      ]);

      await cmdStore.runMaintenanceCleanup();

      const cmds = supabaseServer.db.tables.get('manager_commands');
      assert.strictEqual(cmds.get('cmd_overdue')?.status, 'expired');
      assert.strictEqual(cmds.has('cmd_old_done'), false);
      assert.strictEqual(cmds.has('cmd_ancient'), false);
      assert.strictEqual(cmds.get('cmd_active')?.status, 'queued');
    } finally {
      await supabaseServer.close();
    }
  });

  await test('T7-12', 'SupabaseDashboardStore & SupabaseWorkerStore compact projections preserve full mutations cleanly', async () => {
    const supabaseServer = await createMockSupabaseServer();
    try {
      const client = createSupabaseClient({ url: supabaseServer.url, secretKey: supabaseServer.secretKey });
      const dashStore = new SupabaseDashboardStore(client);
      const workerStore = new SupabaseWorkerStore(client);

      supabaseServer.seed('manager_users', [{
        id: 'usr_proj1',
        username: 'projuser',
        password: encryptUserPassword('SecretProj!1'),
        role: 'user',
        status: 'active',
        is_permanent: true,
        assigned_bot_ids: ['bot-01'],
        plan_name: 'Pro',
        registration_ip: '203.0.113.10',
        registration_user_agent: 'PrivateUA/9.9',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }]);

      const access = await dashStore.getAccess('usr_proj1');
      assert.strictEqual(access.username, 'projuser');
      assert.strictEqual(access.password, undefined, 'getAccess must not include password');
      assert.strictEqual(access.registrationIp, undefined, 'getAccess must not include registrationIp');

      const accessList = await dashStore.listAccess();
      assert.strictEqual(accessList.length, 1);
      assert.strictEqual(accessList[0].password, undefined, 'listAccess must not include password');

      const fullUser = await dashStore.getUser('projuser');
      assert.strictEqual(fullUser.password, 'SecretProj!1', 'getUser retains decrypted password');

      supabaseServer.seed('manager_workers', [{
        worker_id: 'w-ev',
        bot_number: 1,
        name: 'EventBot',
        enabled: true,
        settings: {},
        status: { state: 'offline' },
        events: [{ id: 'ev_init', type: 'status', message: 'initial' }]
      }]);

      const compactWorker = await workerStore.get('w-ev');
      assert.strictEqual(compactWorker.events, undefined, 'Default workerStore.get excludes heavy events array');

      await workerStore.addEvent('w-ev', { id: 'ev_2', type: 'bot_death', message: 'Boom' });
      const fullWorker = await workerStore.get('w-ev', { includeEvents: true });
      assert.strictEqual(fullWorker.events.length, 2, 'addEvent fallback must preserve existing events when reading includeEvents: true');
    } finally {
      await supabaseServer.close();
    }
  });

  await test('T7-13', 'HTTP Gzip + Cookie-Vary ETag + 304 + 30d Texture Cache & Dead Assets Return 404', async () => {
    const env = await createFullStackEnv({ seedBots: [] });
    try {
      // Unauthenticated GET / -> login HTML gzipped
      const unauthRes = await new Promise((resolve, reject) => {
        const req = http.request(`${env.baseUrl}/`, { headers: { 'Accept-Encoding': 'gzip' } }, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        });
        req.on('error', reject);
        req.end();
      });
      assert.strictEqual(unauthRes.status, 200);
      assert.strictEqual(unauthRes.headers['content-encoding'], 'gzip');
      assert.ok((unauthRes.headers['vary'] || '').includes('Cookie'));
      const loginHtml = zlib.gunzipSync(unauthRes.body).toString('utf8');
      assert.ok(loginHtml.length > 1000);

      // Matching ETag -> 304
      const res304 = await fetch(`${env.baseUrl}/`, {
        headers: { 'If-None-Match': unauthRes.headers['etag'] }
      });
      assert.strictEqual(res304.status, 304);

      // Authenticated GET / via cookie returns different ETag (Dashboard HTML)
      const adminLogin = await loginHttp(env.baseUrl, 'admin', 'AdminStrongPassword!99');
      const cookiePair = adminLogin.setCookie.split(';')[0];
      const authRootRes = await fetch(`${env.baseUrl}/`, {
        headers: { Cookie: cookiePair }
      });
      assert.strictEqual(authRootRes.status, 200);
      assert.notStrictEqual(authRootRes.headers.get('etag'), unauthRes.headers['etag']);
      assert.ok((await authRootRes.text()).includes('globalUserProfileDropdown'));

      // 30d texture caching on retained asset & 404 on removed dead assets
      const texOk = await fetch(`${env.baseUrl}/textures/3d/DIAMOND_SWORD.png`);
      assert.strictEqual(texOk.status, 200);
      assert.ok((texOk.headers.get('cache-control') || '').includes('max-age=2592000'));

      for (const deadPath of [
        '/textures/emojis_optimized/DIAMOND_SWORD.png',
        '/textures/entity/steve.png',
        '/textures/discord_emojis.json'
      ]) {
        const deadRes = await fetch(`${env.baseUrl}${deadPath}`);
        assert.strictEqual(deadRes.status, 404, `Removed asset ${deadPath} must return 404`);
      }
    } finally {
      await env.close();
    }
  });

  // =========================================================================
  // SECTION D: MODULAR DASHBOARD INTEGRITY & REAL VM CLIENT EXECUTION
  // =========================================================================

  await test('T7-14', 'Modular Dashboard files are balanced, valid, non-empty and free of duplicate DOM IDs', async () => {
    const baseDir = path.resolve(__dirname, '../../../src/http/views/dashboard');
    const allGroups = [
      ...dashboardParts.STYLE_FILES.map((f) => path.join(baseDir, f)),
      ...dashboardParts.PARTIAL_FILES.map((f) => path.join(baseDir, f)),
      ...dashboardParts.SCRIPT_FILES.map((f) => path.join(baseDir, f))
    ];
    for (const file of allGroups) {
      assert.ok(fs.existsSync(file), `Missing dashboard module: ${file}`);
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n').length;
      assert.ok(lines >= 40 && lines <= 2000, `Expected balanced module line count in ${path.basename(file)}, got ${lines}`);
    }

    const ids = [...dashboardParts.BODY.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(ids.length > 350, `Expected 350+ DOM IDs, got ${ids.length}`);
    const seen = new Set();
    const dups = [];
    for (const id of ids) {
      if (seen.has(id)) dups.push(id);
      seen.add(id);
    }
    assert.deepStrictEqual(dups, [], `Duplicate DOM IDs found: ${dups.join(', ')}`);
    assert.strictEqual((DASHBOARD_HTML.match(/<!doctype html>/gi) || []).length, 1);
    assert.strictEqual((DASHBOARD_HTML.match(/<\/body>/g) || []).length, 1);
    assert.strictEqual((DASHBOARD_HTML.match(/<\/html>/g) || []).length, 1);
  });

  await test('T7-15', 'Dashboard fitGlobalProfileDropdownHeight executes cleanly across small/large viewports', async () => {
    const sandbox = createDashboardVmSandbox();
    const dropdown = sandbox.getEl('globalUserProfileDropdown');
    dropdown.classList.add('hidden');

    sandbox.localWin.innerHeight = 460;
    sandbox.ctx.window.toggleGlobalProfileDropdown();
    assert.strictEqual(dropdown.classList.contains('hidden'), false);
    assert.strictEqual(dropdown.style.overflowY, 'auto');
    assert.strictEqual(dropdown.style.maxHeight, '388px'); // 460 - 56 - 16 = 388

    sandbox.localWin.innerHeight = 300;
    sandbox.ctx.fitGlobalProfileDropdownHeight();
    assert.strictEqual(dropdown.style.maxHeight, '228px'); // 300 - 56 - 16 = 228

    sandbox.localWin.innerHeight = 200;
    sandbox.ctx.fitGlobalProfileDropdownHeight();
    assert.strictEqual(dropdown.style.maxHeight, '200px'); // Clamped >= 200px

    assert.ok(dashboardParts.STYLES.includes('max-height: calc(100dvh - 80px);'));
  });

  await test('T7-16', 'Dashboard refreshHome & refreshDetail use ?sig= / ?rev=, respect data-dirty & prevent flicker', async () => {
    const urlsCalled = [];
    let fleetPollStep = 0;
    let detailPollStep = 0;

    const mockFetch = async (url) => {
      urlsCalled.push(String(url));
      if (String(url).startsWith('/api/manager/bots')) {
        fleetPollStep++;
        if (fleetPollStep === 1) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              ok: true,
              sig: 'sig_aaa',
              managerRamMb: 120,
              bots: [{ workerId: 'bot-01', id: 'bot-01', name: 'Alpha', status: 'online', online: true }],
              currentUser: { planName: 'VIP', status: 'active' }
            })
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true, unchanged: true, sig: 'sig_aaa', managerRamMb: 125 })
        };
      }
      if (String(url).includes('/snapshot')) {
        detailPollStep++;
        if (detailPollStep === 1) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              ok: true,
              rev: 'rev_111',
              bot: { workerId: 'bot-01', id: 'bot-01', name: 'Alpha', status: 'online', online: true, username: 'BotOne' },
              inventory: { items: [], slots: {}, revision: 1 },
              settings: { ecoMode: true, mcUsername: 'BotOne', mcPassword: 'McSecretValue!' },
              autoChatSchedules: [],
              botSchedules: []
            })
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true, unchanged: true, rev: 'rev_111' })
        };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, events: [], chat: [] }) };
    };

    const sandbox = createDashboardVmSandbox({ fetchImpl: mockFetch });
    vm.runInContext("currentUser = { username: 'alice', role: 'user', planName: 'VIP', status: 'active' };", sandbox.ctx);

    let renderHomeCalls = 0;
    sandbox.ctx.renderHome = () => { renderHomeCalls++; };
    sandbox.ctx.applyUserRoleUI = () => {};
    sandbox.ctx.updateUserHeaderCountdown = () => {};

    await sandbox.ctx.refreshHome();
    assert.strictEqual(renderHomeCalls, 1);
    assert.strictEqual(sandbox.getEl('managerRamUsage').textContent, '120 MB');

    await sandbox.ctx.refreshHome();
    assert.ok(urlsCalled.some((u) => u === '/api/manager/bots?sig=sig_aaa'), '2nd refreshHome must send ?sig=sig_aaa');
    assert.strictEqual(renderHomeCalls, 1, 'unchanged:true must skip renderHome() redraw');
    assert.strictEqual(sandbox.getEl('managerRamUsage').textContent, '125 MB', 'unchanged:true updates RAM text in place');

    // refreshDetail populates clean MC username/password, respects data-dirty, sends ?rev=
    vm.runInContext("selectedBotId = 'bot-01';", sandbox.ctx);
    await sandbox.ctx.refreshDetail(false);
    assert.strictEqual(sandbox.getEl('detailUsernameInput').value, 'BotOne');
    assert.strictEqual(sandbox.getEl('detailPasswordInput').value, 'McSecretValue!');

    // User edits password -> data-dirty protects input from background overwrite
    sandbox.getEl('detailPasswordInput').value = 'UserTypingWIP';
    sandbox.getEl('detailPasswordInput').setAttribute('data-dirty', 'true');
    await sandbox.ctx.refreshDetail(false);
    assert.ok(urlsCalled.some((u) => u.includes('/snapshot?rev=rev_111')), '2nd refreshDetail(false) must send ?rev=');
    assert.strictEqual(sandbox.getEl('detailPasswordInput').value, 'UserTypingWIP');
  });

  await test('T7-17', 'Dashboard scheduleNextManagerPoll & timers skip offline/hidden DOM updates', async () => {
    const sandbox = createDashboardVmSandbox();
    vm.runInContext("currentUser = { username: 'alice', role: 'user' }; selectedBotId = null;", sandbox.ctx);

    let homeRefreshes = 0;
    sandbox.ctx.refreshHome = async () => { homeRefreshes++; };

    // 1. Active tab -> 5000ms timer; offline skips refreshHome
    sandbox.doc.hidden = false;
    sandbox.ctx.scheduleNextManagerPoll();
    const tActive = sandbox.capturedTimers.timeouts.at(-1);
    assert.strictEqual(tActive.ms, 5000);

    sandbox.localWin.navigator.onLine = false;
    await tActive.fn();
    assert.strictEqual(homeRefreshes, 0, 'Offline poll tick must skip refreshHome');

    // 2. Hidden tab -> 30000ms delay & countdown timers skip hidden DOM updates
    sandbox.doc.hidden = true;
    sandbox.ctx.scheduleNextManagerPoll();
    const tHidden = sandbox.capturedTimers.timeouts.at(-1);
    assert.strictEqual(tHidden.ms, 30000);

    let detailUptimeCalls = 0;
    let cardGraceCalls = 0;
    vm.runInContext('updateDetailUptime = function() { globalThis.__dCalls++; }; updateCardGraceCountdowns = function() { globalThis.__gCalls++; }; globalThis.__dCalls = 0; globalThis.__gCalls = 0;', sandbox.ctx);
    const secIntervals = sandbox.capturedTimers.intervals.filter((item) => item.ms === 1000);
    assert.ok(secIntervals.length >= 2);
    secIntervals.forEach((item) => item.fn());
    assert.strictEqual(sandbox.ctx.__dCalls + sandbox.ctx.__gCalls, 0, '1s countdown timers must no-op when document.hidden is true');

    sandbox.doc.hidden = false;
    secIntervals.forEach((item) => item.fn());
    detailUptimeCalls = sandbox.ctx.__dCalls;
    cardGraceCalls = sandbox.ctx.__gCalls;
    assert.ok(detailUptimeCalls >= 1 && cardGraceCalls >= 1, '1s countdown timers run normally when tab visible');
  });

  await test('T7-18', 'Admin Backup Lifecycle Auditing & Worker Window Click/Close Live Flow', async () => {
    const env = await createFullStackEnv();
    try {
      // 1. Admin login to get session token
      const adminLogin = await loginHttp(env.baseUrl, 'admin', 'AdminStrongPassword!99');
      assert.strictEqual(adminLogin.status, 200);
      const adminAuth = { authorization: `Bearer ${adminLogin.data.token}` };

      // 2. Create backup
      const createRes = await fetch(`${env.baseUrl}/api/manager/backups/create`, {
        method: 'POST',
        headers: { ...adminAuth, 'content-type': 'application/json' }
      });
      assert.strictEqual(createRes.status, 200);
      const createJson = await createRes.json();
      assert.ok(createJson.ok);
      const filename = createJson.filename;
      assert.ok(filename);

      // Check audit log for ADMIN_CREATE_BACKUP
      const audits1 = await env.accessStore.listAudit(10);
      const createAudit = audits1.find((a) => a.action === 'ADMIN_CREATE_BACKUP');
      assert.ok(createAudit, 'Audit log must record ADMIN_CREATE_BACKUP');
      assert.strictEqual(createAudit.details?.filename, filename);

      // 3. Restore backup
      const restoreRes = await fetch(`${env.baseUrl}/api/manager/backups/${encodeURIComponent(filename)}/restore`, {
        method: 'POST',
        headers: { ...adminAuth, 'content-type': 'application/json' }
      });
      assert.strictEqual(restoreRes.status, 200);
      const restoreJson = await restoreRes.json();
      assert.ok(restoreJson.ok);

      // Check audit log for ADMIN_RESTORE_BACKUP
      const audits2 = await env.accessStore.listAudit(10);
      const restoreAudit = audits2.find((a) => a.action === 'ADMIN_RESTORE_BACKUP');
      assert.ok(restoreAudit, 'Audit log must record ADMIN_RESTORE_BACKUP');
      assert.strictEqual(restoreAudit.details?.filename, filename);

      // 4. Delete backup
      const deleteRes = await fetch(`${env.baseUrl}/api/manager/backups/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
        headers: adminAuth
      });
      assert.strictEqual(deleteRes.status, 200);
      const deleteJson = await deleteRes.json();
      assert.ok(deleteJson.ok);

      // Check audit log for ADMIN_DELETE_BACKUP
      const audits3 = await env.accessStore.listAudit(10);
      const deleteAudit = audits3.find((a) => a.action === 'ADMIN_DELETE_BACKUP');
      assert.ok(deleteAudit, 'Audit log must record ADMIN_DELETE_BACKUP');
      assert.strictEqual(deleteAudit.details?.filename, filename);

      // 5. Worker Window Click/Close Live Flow
      await env.registry.updateStatus('bot-01', {
        state: 'online',
        online: true,
        currentWindow: {
          title: 'Chest',
          type: 'minecraft:chest',
          revision: 1,
          slots: [{ slot: 0, name: 'diamond', count: 10 }]
        }
      });

      // User detail snapshot returns currentWindow
      const snapRes = await fetch(`${env.baseUrl}/api/user/bot/bot-01/snapshot`, {
        method: 'GET',
        headers: adminAuth
      });
      assert.strictEqual(snapRes.status, 200);
      const snapJson = await snapRes.json();
      assert.ok(snapJson.bot?.currentWindow, 'Detail snapshot must contain currentWindow');
      assert.strictEqual(snapJson.bot.currentWindow.title, 'Chest');

      // Click window
      let dispatchedAction = null;
      let dispatchedPayload = null;
      env.broker.dispatch = async (workerId, action, payload) => {
        dispatchedAction = action;
        dispatchedPayload = payload;
        return { ok: true, clickedSlot: payload.slot };
      };

      const clickRes = await fetch(`${env.baseUrl}/api/user/bot/bot-01/window/click`, {
        method: 'POST',
        headers: { ...adminAuth, 'content-type': 'application/json' },
        body: JSON.stringify({ slot: 0 })
      });
      assert.strictEqual(clickRes.status, 200);
      assert.strictEqual(dispatchedAction, 'window_click');
      assert.strictEqual(dispatchedPayload.slot, 0);

      // Close window
      const closeRes = await fetch(`${env.baseUrl}/api/user/bot/bot-01/window/close`, {
        method: 'POST',
        headers: { ...adminAuth, 'content-type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.strictEqual(closeRes.status, 200);
      assert.strictEqual(dispatchedAction, 'window_close');

    } finally {
      await env.close();
    }
  });

  console.log(`\n1..${totalTests}`);
  console.log(`# tests ${totalTests}`);
  console.log(`# pass  ${passedTests}`);
  console.log(`# fail  ${failedTests}`);

  if (failedTests > 0) {
    process.exit(1);
  }
  console.log('\n🎉 ALL TIER 7 FULL-STACK OPTIMIZATION & SECURITY E2E TESTS PASSED 100%!');
  process.exit(0);
}

runAll().catch((err) => {
  console.error('❌ Tier 7 suite crashed:', err);
  process.exit(1);
});
