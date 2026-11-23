'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { createApp } = require('../src/http/app');
const { handlePanelInteraction } = require('../src/discord/handlers/panel-handler');
const {
  encryptUserPassword,
  hashAdminPasswordAsync
} = require('../src/utils/secrets');
const { createMockSupabaseServer } = require('./e2e/harness/mock-supabase');
const { createSupabaseClient } = require('../src/storage/supabase-client');
const SupabaseWorkerStore = require('../src/storage/supabase-worker-store');
const SupabaseDashboardStore = require('../src/storage/supabase-dashboard-store');
const { WorkerRegistry } = require('../src/services/worker-registry');
const { AccessControl } = require('../src/services/access-control');

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

async function startTestApp({ adminPassword = 'AdminPass!99' } = {}) {
  const supabaseServer = await createMockSupabaseServer();
  const supabaseClient = createSupabaseClient({ url: supabaseServer.url, secretKey: supabaseServer.secretKey });
  const workerStore = new SupabaseWorkerStore(supabaseClient);
  const store = new SupabaseDashboardStore(supabaseClient);
  await workerStore.initialize();
  await store.initialize();

  const encKeyHex = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  const encKey = Buffer.from(encKeyHex, 'hex');
  const workerSecret = 'w'.repeat(32);
  supabaseServer.seed('manager_workers', [{
    worker_id: 'bot-1',
    bot_number: 1,
    name: 'Farm Bot 1',
    enabled: true,
    provider: 'wispbyte',
    service_url: '',
    secret_ciphertext: require('../src/utils/secrets').encryptSecret(workerSecret, encKey),
    settings: { ecoMode: true, rentable: true, proxyCiphertext: null, mcCredentialsCiphertext: null },
    status: { state: 'offline', online: false },
    events: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }]);

  const registry = new WorkerRegistry({
    store: workerStore,
    accessStore: store,
    encryptionKey: encKey,
    adminNotifier: null
  });
  await registry.load();

  const adminHash = await hashAdminPasswordAsync(adminPassword);
  registry.setAdminPassword(adminHash);

  const userEncPass = encryptUserPassword('UserPass!99');
  const futureExpiry = new Date(Date.now() + 7 * 86400000).toISOString();
  await store.setAccess('user_1', {
    id: 'user_1',
    username: 'farmuser',
    password: userEncPass,
    role: 'user',
    workerIds: ['bot-1'],
    status: 'active',
    isPermanent: false,
    expiresAt: futureExpiry,
    planName: 'VIP'
  }, 'test-seed');

  const dispatchedCommands = [];
  const broker = {
    async dispatch(workerId, action, payload) {
      dispatchedCommands.push({ workerId, action, payload });
      return { delivered: true, timedOut: false, result: { ok: true, action } };
    }
  };

  const app = createApp({
    store,
    workerStore,
    registry,
    broker,
    entitlementService: { redeem: async () => ({ ok: true }) },
    accessControl: new AccessControl({ store }),
    config: {
      adminUsername: 'admin',
      adminPassword,
      sessionSecret: 'test-session-secret-0123456789abcdef',
      encryptionKey: encKey,
      encryptionKeyHex: encKeyHex,
      publicBaseUrl: 'http://127.0.0.1'
    },
    logger: silentLogger
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  return {
    baseUrl,
    store,
    registry,
    dispatchedCommands,
    authRouter: app._authRouter,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await supabaseServer.close();
    }
  };
}

function expireAllRateLimitLocks(authRouter) {
  const past = Date.now() - 1000;
  for (const [, v] of authRouter._loginAttempts.entries()) {
    if (v && v.lockedUntil) v.lockedUntil = past;
  }
  for (const [, v] of authRouter._globalUserFailures.entries()) {
    if (v && v.lockedUntil) v.lockedUntil = past;
  }
}

test('AUTH progressive lockout: 5 attempts per batch -> 15s, 30s, 45s, 1m, 2m, 5m, 1h max + reset on success', async () => {
  const env = await startTestApp();
  try {
    const expectedTiers = [15, 30, 45, 60, 120, 300, 3600, 3600];

    for (let t = 0; t < expectedTiers.length; t++) {
      const expectedSec = expectedTiers[t];
      for (let attempt = 1; attempt <= 4; attempt++) {
        const res = await fetch(`${env.baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'farmuser', password: `wrong_${t}_${attempt}` })
        });
        assert.equal(res.status, 401, `Batch ${t + 1} attempt ${attempt} must be 401`);
        const json = await res.json();
        assert.equal(json.remainingAttempts, 5 - attempt);
      }

      const lockRes = await fetch(`${env.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'farmuser', password: `wrong_${t}_5` })
      });
      assert.equal(lockRes.status, 429, `Batch ${t + 1} 5th attempt must trigger 429`);
      assert.equal(lockRes.headers.get('retry-after'), String(expectedSec));
      const lockJson = await lockRes.json();
      assert.equal(lockJson.retryAfterSeconds, expectedSec, `Batch ${t + 1} lockout duration mismatch`);

      // Even correct password is blocked while active pause is in effect
      const blockedRes = await fetch(`${env.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'farmuser', password: 'UserPass!99' })
      });
      assert.equal(blockedRes.status, 429, `Attempt during batch ${t + 1} pause must stay 429`);

      expireAllRateLimitLocks(env.authRouter);
    }

    // Successful login after lockout expires must reset failure counter and tier back to 15s
    const okRes = await fetch(`${env.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'farmuser', password: 'UserPass!99' })
    });
    assert.equal(okRes.status, 200);
    const okJson = await okRes.json();
    assert.equal(okJson.ok, true);

    for (let i = 1; i <= 4; i++) {
      const res = await fetch(`${env.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'farmuser', password: `wrong_after_reset_${i}` })
      });
      assert.equal(res.status, 401);
    }
    const resetFifth = await fetch(`${env.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'farmuser', password: 'wrong_after_reset_5' })
    });
    assert.equal(resetFifth.status, 429);
    const resetFifthJson = await resetFifth.json();
    assert.equal(resetFifthJson.retryAfterSeconds, 15, 'Lockout tier must reset back to 15s after valid login');

    // Admin login also respects 5-attempt lockout
    for (let i = 1; i <= 4; i++) {
      const res = await fetch(`${env.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: `bad_admin_${i}` })
      });
      assert.equal(res.status, 401);
    }
    const adminLock = await fetch(`${env.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'bad_admin_5' })
    });
    assert.equal(adminLock.status, 429);
    const adminLockJson = await adminLock.json();
    assert.equal(adminLockJson.retryAfterSeconds, 15);
  } finally {
    await env.close();
  }
});

test('SYSTEM MAINTENANCE MODE: locks user worker ops across Web API & Discord while keeping login, read-only & admin open; reopens cleanly', async () => {
  const env = await startTestApp();
  try {
    // Login Admin & Regular User before maintenance
    const adminLogin = await fetch(`${env.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'AdminPass!99' })
    }).then((r) => r.json());
    assert.equal(adminLogin.ok, true);
    const adminHeaders = { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' };

    const userLoginBefore = await fetch(`${env.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'farmuser', password: 'UserPass!99' })
    }).then((r) => r.json());
    assert.equal(userLoginBefore.ok, true);
    assert.equal(userLoginBefore.maintenance.enabled, false);

    // 1. Admin enables maintenance mode with custom message
    const customMsg = 'Bảo trì nâng cấp hệ thống máy chủ đến 22:00.';
    const enableRes = await fetch(`${env.baseUrl}/api/manager/maintenance`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ enabled: true, message: customMsg })
    });
    assert.equal(enableRes.status, 200);
    const enableJson = await enableRes.json();
    assert.equal(enableJson.ok, true);
    assert.equal(enableJson.maintenance.enabled, true);
    assert.equal(enableJson.maintenance.message, customMsg);

    // Non-admin cannot access Admin maintenance endpoints
    const userSetRes = await fetch(`${env.baseUrl}/api/manager/maintenance`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${userLoginBefore.token}` }
    });
    assert.equal(userSetRes.status, 200, 'Read-only GET /api/manager/maintenance returns state for logged-in user');
    const userSetJson = await userSetRes.json();
    assert.equal(userSetJson.maintenance.enabled, true);
    assert.equal(userSetJson.maintenance.message, customMsg);

    // 2. Regular user can STILL log in during maintenance
    const userLoginDuring = await fetch(`${env.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'farmuser', password: 'UserPass!99' })
    });
    assert.equal(userLoginDuring.status, 200, 'Users must still be able to log in during maintenance');
    const userLoginDuringJson = await userLoginDuring.json();
    assert.equal(userLoginDuringJson.ok, true);
    assert.equal(userLoginDuringJson.maintenance.enabled, true);
    assert.equal(userLoginDuringJson.maintenance.message, customMsg);
    const userHeaders = { Authorization: `Bearer ${userLoginDuringJson.token}`, 'Content-Type': 'application/json' };

    // 3. Read-only user routes still work and include maintenance info
    const meJson = await fetch(`${env.baseUrl}/api/auth/me`, { headers: userHeaders }).then((r) => r.json());
    assert.equal(meJson.ok, true);
    assert.equal(meJson.maintenance.enabled, true);

    const botsRes = await fetch(`${env.baseUrl}/api/manager/bots`, { headers: userHeaders });
    assert.equal(botsRes.status, 200);
    const botsJson = await botsRes.json();
    assert.equal(botsJson.maintenance.enabled, true);
    assert.equal(botsJson.bots.length, 1);

    // Sig change invalidates unchanged polling when maintenance toggles
    const sigRes = await fetch(`${env.baseUrl}/api/manager/bots?sig=${encodeURIComponent(botsJson.sig)}`, { headers: userHeaders }).then((r) => r.json());
    assert.equal(sigRes.unchanged, true);
    assert.equal(sigRes.maintenance.enabled, true);

    // 4. All user worker control endpoints are blocked with 503 SYSTEM_MAINTENANCE
    const blockedCalls = [
      ['/api/manager/bot/bot-1/start', {}],
      ['/api/manager/bot/bot-1/stop', {}],
      ['/api/manager/bot/bot-1/restart', {}],
      ['/api/manager/bot/bot-1/send', { message: 'hello' }],
      ['/api/manager/bot/bot-1/settings', { autoReconnect: false }],
      ['/api/manager/bot/bot-1/alias', { label: 'New Name' }],
      ['/api/manager/bots/reorder', { botIds: ['bot-1'] }]
    ];
    for (const [endpoint, body] of blockedCalls) {
      const res = await fetch(`${env.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: userHeaders,
        body: JSON.stringify(body)
      });
      assert.equal(res.status, 503, `${endpoint} must return 503 during maintenance`);
      const json = await res.json();
      assert.equal(json.code, 'SYSTEM_MAINTENANCE', `${endpoint} must return SYSTEM_MAINTENANCE code`);
      assert.ok(json.error.includes(customMsg), `${endpoint} error must include custom maintenance message`);
    }
    assert.equal(env.dispatchedCommands.length, 0, 'Zero worker commands may be dispatched for regular user during maintenance');

    // 5. Admin can STILL operate workers normally while maintenance is ON
    const adminStartRes = await fetch(`${env.baseUrl}/api/manager/bot/bot-1/start`, {
      method: 'POST',
      headers: adminHeaders,
      body: '{}'
    });
    assert.equal(adminStartRes.status, 200, 'Admin must still operate workers during maintenance');
    assert.equal(env.dispatchedCommands.length, 1);

    // 6. Discord panel-handler blocks non-admin bot:start during maintenance
    let updatedPayload = null;
    await env.store.linkDiscord('discord-uid-1', 'farmuser', 'user_1');
    const mockInteraction = {
      customId: 'bot:start:bot-1',
      guildId: '999999999999999999',
      user: { id: 'discord-uid-1' },
      member: { roles: { cache: new Map([['222222222222222222', {}]]) } },
      deferred: false,
      replied: false,
      isModalSubmit: () => false,
      isButton: () => true,
      isStringSelectMenu: () => false,
      async deferUpdate() { this.deferred = true; },
      async editReply(p) { updatedPayload = p; return p; },
      async update(p) { updatedPayload = p; return p; }
    };
    const discordAc = new AccessControl({ store: env.store });
    discordAc.setRoleIds('111111111111111111', '222222222222222222');
    await handlePanelInteraction(mockInteraction, {
      config: { discordGuildId: '999999999999999999', userRoleId: '222222222222222222', discordUserRoleId: '222222222222222222' },
      accessStore: env.store,
      registry: env.registry,
      accessControl: discordAc,
      broker: {
        dispatch: async () => {
          throw new Error('Must not dispatch Discord command during maintenance');
        }
      }
    });
    assert.ok(updatedPayload?.embeds?.[0], 'Discord interaction must reply with maintenance embed');
    const embedTitle = updatedPayload.embeds[0].data?.title || updatedPayload.embeds[0].title || '';
    const embedDesc = updatedPayload.embeds[0].data?.description || updatedPayload.embeds[0].description || '';
    assert.ok(embedTitle.includes('BẢO TRÌ'), `Expected maintenance embed title, got: ${embedTitle}`);
    assert.ok(embedDesc.includes(customMsg), `Expected maintenance embed desc to include custom message`);

    // 7. Admin disables maintenance -> reopens user access cleanly
    const disableRes = await fetch(`${env.baseUrl}/api/manager/maintenance`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ enabled: false })
    });
    assert.equal(disableRes.status, 200);
    const disableJson = await disableRes.json();
    assert.equal(disableJson.maintenance.enabled, false);

    // Previous polling sig is now invalidated because maintenance changed
    const afterToggleBots = await fetch(`${env.baseUrl}/api/manager/bots?sig=${encodeURIComponent(botsJson.sig)}`, {
      headers: userHeaders
    }).then((r) => r.json());
    assert.equal(Boolean(afterToggleBots.unchanged), false, 'Bots sig must invalidate immediately when maintenance disables');
    assert.equal(afterToggleBots.maintenance.enabled, false);

    // Regular user can operate worker again!
    const userStartAfter = await fetch(`${env.baseUrl}/api/manager/bot/bot-1/start`, {
      method: 'POST',
      headers: userHeaders,
      body: '{}'
    });
    assert.equal(userStartAfter.status, 200, 'User worker operations must succeed once maintenance ends');
    assert.equal(env.dispatchedCommands.length, 2);
  } finally {
    await env.close();
  }
});

test('DASHBOARD UI: Manage Users maintenance toggle, modal, blur overlay & scripts assemble cleanly', () => {
  const { HTML } = require('../src/http/views/dashboard-html');
  assert.ok(HTML.includes('id="maintenanceToggleBtn"'), 'Manage Users header must include maintenanceToggleBtn');
  assert.ok(HTML.includes('id="maintenanceConfigBtn"'), 'Manage Users header must include maintenanceConfigBtn');
  assert.ok(HTML.includes('id="maintenanceSettingsModal"'), 'Dashboard must include maintenanceSettingsModal');
  assert.ok(HTML.includes('id="systemMaintenanceBanner"'), 'Dashboard must include systemMaintenanceBanner');
  assert.ok(HTML.includes('bot-card-expire-overlay maintenance'), 'Dashboard must include maintenance card overlay logic/CSS');

  // Ensure every id="..." attribute in HTML partials is globally unique
  const partialsDir = path.join(__dirname, '../src/http/views/dashboard/partials');
  const seenIds = new Set();
  for (const file of fs.readdirSync(partialsDir).sort()) {
    const content = fs.readFileSync(path.join(partialsDir, file), 'utf8');
    const re = /\bid="([^"]+)"/g;
    let m;
    while ((m = re.exec(content)) !== null) {
      assert.equal(seenIds.has(m[1]), false, `Duplicate DOM id "${m[1]}" found in ${file}`);
      seenIds.add(m[1]);
    }
  }

  // Validate modular scripts compile cleanly with vm.Script
  const scriptsDir = path.join(__dirname, '../src/http/views/dashboard/scripts');
  const fullScript = fs.readdirSync(scriptsDir)
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((f) => fs.readFileSync(path.join(scriptsDir, f), 'utf8'))
    .join('\n;\n');
  new vm.Script(fullScript, { filename: 'dashboard-combined.js' });
});
