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
const { EntitlementService } = require('../src/services/entitlement-service');
const AsyncKeyLock = require('../src/services/async-key-lock');
const {
  computeEffectiveExpiresAt,
  flushMaintenanceCompensation,
  getMaintenanceState,
  setMaintenanceState
} = require('../src/utils/maintenance');
const {
  formatAccountPlanBadge,
  renderBotsList,
  renderBotDetail
} = require('../src/discord/panels/renderer');

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

  const accessControl = new AccessControl({ store });
  const entitlementService = new EntitlementService({
    store,
    registry,
    accessControl,
    logger: silentLogger,
    userLock: new AsyncKeyLock(),
    gracePeriodMs: 6 * 3600 * 1000
  });

  const app = createApp({
    store,
    workerStore,
    registry,
    broker,
    entitlementService,
    accessControl,
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
    entitlementService,
    accessControl,
    dispatchedCommands,
    authRouter: app._authRouter,
    async close() {
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeIdleConnections?.();
        server.closeAllConnections?.();
      });
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
      await blockedRes.text();

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
      await res.text();
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
      await res.text();
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
    await adminStartRes.text();
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
    await userStartAfter.text();
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

test('MAINTENANCE TIME FREEZE (1 & 2): state transitions (false->false, false->true, true->true) & computeEffectiveExpiresAt non-resurrection', async () => {
  const env = await startTestApp();
  try {
    const t0 = Date.parse('2026-11-27T10:00:00.000Z');
    const t0Iso = new Date(t0).toISOString();

    const userBefore = await env.store.getAccess('user_1', { bypassCache: true });
    const origUserExpiry = userBefore.expiresAt;

    // 1a. false -> false is a pure no-op for compensation (deltaMs = 0, compensatedUsers = 0)
    const noopOff = await setMaintenanceState(
      env.store,
      { enabled: false, message: 'Bình thường' },
      'admin',
      { toMs: t0 }
    );
    assert.equal(noopOff.enabled, false);
    assert.equal(noopOff.startedAt, null);
    assert.equal(noopOff.lastCompensatedAt, null);
    assert.equal(noopOff.lastCompensationMs, 0);
    assert.equal(noopOff.compensatedUsers, 0);
    const userAfterNoop = await env.store.getAccess('user_1', { bypassCache: true });
    assert.equal(userAfterNoop.expiresAt, origUserExpiry);

    // 1b. false -> true records startedAt & lastCompensatedAt = t0Iso
    const turnedOn = await setMaintenanceState(
      env.store,
      { enabled: true, message: 'Bảo trì đợt 1' },
      'admin',
      { toMs: t0 }
    );
    assert.equal(turnedOn.enabled, true);
    assert.equal(turnedOn.startedAt, t0Iso);
    assert.equal(turnedOn.lastCompensatedAt, t0Iso);
    assert.equal(turnedOn.lastCompensationMs, 0);
    assert.equal(turnedOn.compensatedUsers, 0);

    // 1c. true -> true message update preserves startedAt & lastCompensatedAt without shifting anchor
    const msgUpdated = await setMaintenanceState(
      env.store,
      { enabled: true, message: 'Bảo trì đợt 1 (cập nhật 11:30)' },
      'admin',
      { toMs: t0 + 90 * 60 * 1000 }
    );
    assert.equal(msgUpdated.enabled, true);
    assert.equal(msgUpdated.message, 'Bảo trì đợt 1 (cập nhật 11:30)');
    assert.equal(msgUpdated.startedAt, t0Iso, 'Updating message during maintenance must preserve startedAt');
    assert.equal(msgUpdated.lastCompensatedAt, t0Iso, 'Updating message during maintenance must preserve lastCompensatedAt');
    assert.equal(msgUpdated.compensatedUsers, 0);

    // 2. computeEffectiveExpiresAt freezes remaining rental time and never resurrects pre-maintenance expired accounts
    const activeExpIso = new Date(t0 + 5 * 86400000).toISOString();
    const threeHoursLater = t0 + 3 * 3600 * 1000;
    const effIso = computeEffectiveExpiresAt(activeExpIso, msgUpdated, threeHoursLater);
    assert.equal(
      Date.parse(effIso) - threeHoursLater,
      5 * 86400000,
      'Remaining rental duration must stay frozen at exact 5 days'
    );

    const alreadyExpiredBeforeMaint = new Date(t0 - 60 * 1000).toISOString();
    assert.equal(
      computeEffectiveExpiresAt(alreadyExpiredBeforeMaint, msgUpdated, threeHoursLater),
      alreadyExpiredBeforeMaint,
      'Accounts expired prior to maintenance anchor must NOT be shifted/resurrected'
    );
    const exactBoundaryExp = t0Iso;
    assert.equal(
      computeEffectiveExpiresAt(exactBoundaryExp, msgUpdated, threeHoursLater),
      exactBoundaryExp,
      'Accounts with expMs === anchorMs must NOT be resurrected'
    );
  } finally {
    await env.close();
  }
});

test('MAINTENANCE TIME FREEZE (3 & 4): pauses expiration sweep while enabled and compensates only eligible active/grace users on turn-off', async () => {
  const env = await startTestApp();
  try {
    const now = Date.now();
    const maintStartMs = now - 2 * 3600 * 1000; // Maintenance started 2h ago
    const maintStartIso = new Date(maintStartMs).toISOString();

    const activeRawExpMs = maintStartMs + 3 * 86400000; // Eligible active (+2h expected)
    const graceRawExpMs = maintStartMs - 2 * 3600 * 1000; // In 6h grace at maintStart (exp + 6h = maintStart + 4h > maintStart -> +2h expected)
    const oldExpiredRawExpMs = maintStartMs - 10 * 3600 * 1000; // Expired 10h before maintStart (NOT eligible)
    const disabledRawExpMs = maintStartMs + 5 * 86400000; // Disabled account (NOT eligible)

    await env.store.setAccess('user_1', {
      id: 'user_1',
      username: 'farmuser',
      password: encryptUserPassword('UserPass!99'),
      role: 'user',
      workerIds: ['bot-1'],
      status: 'active',
      isPermanent: false,
      expiresAt: new Date(activeRawExpMs).toISOString(),
      planName: 'VIP'
    }, 'seed');

    await env.store.setAccess('user_grace', {
      id: 'user_grace',
      username: 'graceuser',
      password: encryptUserPassword('UserPass!99'),
      role: 'user',
      workerIds: [],
      status: 'grace_period',
      isPermanent: false,
      expiresAt: new Date(graceRawExpMs).toISOString(),
      planName: 'Standard'
    }, 'seed');

    await env.store.setAccess('user_old_expired', {
      id: 'user_old_expired',
      username: 'oldexpuser',
      password: encryptUserPassword('UserPass!99'),
      role: 'user',
      workerIds: [],
      status: 'expired',
      isPermanent: false,
      expiresAt: new Date(oldExpiredRawExpMs).toISOString(),
      planName: 'Standard'
    }, 'seed');

    await env.store.setAccess('user_disabled', {
      id: 'user_disabled',
      username: 'disableduser',
      password: encryptUserPassword('UserPass!99'),
      role: 'user',
      workerIds: [],
      status: 'disabled',
      isPermanent: false,
      expiresAt: new Date(disabledRawExpMs).toISOString(),
      planName: 'Standard'
    }, 'seed');

    await env.store.setAccess('user_vip_perm', {
      id: 'user_vip_perm',
      username: 'vipperm',
      password: encryptUserPassword('UserPass!99'),
      role: 'user',
      workerIds: [],
      status: 'active',
      isPermanent: true,
      expiresAt: null,
      planName: 'Lifetime'
    }, 'seed');

    // Also add an active-status user whose raw timestamp already passed now, to verify sweep pauses
    const passedDuringMaintMs = maintStartMs + 30 * 60 * 1000; // Was valid (+30m) when maintenance started, now passed wall-clock
    await env.store.setAccess('user_frozen_short', {
      id: 'user_frozen_short',
      username: 'frozenshort',
      password: encryptUserPassword('UserPass!99'),
      role: 'user',
      workerIds: [],
      status: 'active',
      isPermanent: false,
      expiresAt: new Date(passedDuringMaintMs).toISOString(),
      planName: 'ShortPlan'
    }, 'seed');

    await setMaintenanceState(
      env.store,
      { enabled: true, message: 'Bảo trì định kỳ 2 giờ' },
      'admin',
      { toMs: maintStartMs }
    );

    // 3. Sweep is paused while maintenance is enabled -> does not transition user_frozen_short to grace_period/expired or stop bots
    let stopCalled = 0;
    const sweepDuring = await env.entitlementService.checkExpiredUsersAndGracefulStop({
      broker: {
        dispatch: async () => {
          stopCalled += 1;
          return { delivered: true, result: { ok: true, state: 'stopped' } };
        }
      }
    });
    assert.equal(sweepDuring.pausedByMaintenance, true);
    assert.equal(sweepDuring.checked, 0);
    assert.equal(sweepDuring.expired, 0);
    assert.equal(stopCalled, 0);
    const shortDuring = await env.store.getAccess('user_frozen_short', { bypassCache: true });
    assert.equal(shortDuring.status, 'active', 'Frozen user must remain active during maintenance');

    // Verify HTTP /api/auth/login + /api/auth/me + /api/manager/bots expose frozen expiresAt & rawExpiresAt without double-compensation
    const userLogin = await fetch(`${env.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'frozenshort', password: 'UserPass!99' })
    }).then((r) => r.json());
    assert.equal(userLogin.ok, true);
    assert.equal(userLogin.user.rawExpiresAt, new Date(passedDuringMaintMs).toISOString());
    assert.ok(Date.parse(userLogin.user.expiresAt) > Date.now(), 'Effective expiresAt must still be in the future (~30m left)');
    assert.equal(userLogin.maintenance.startedAt, maintStartIso);

    const shortHeaders = { Authorization: `Bearer ${userLogin.token}` };
    const me1 = await fetch(`${env.baseUrl}/api/auth/me`, { headers: shortHeaders }).then((r) => r.json());
    const me2 = await fetch(`${env.baseUrl}/api/auth/me`, { headers: shortHeaders }).then((r) => r.json());
    assert.equal(me1.user.rawExpiresAt, new Date(passedDuringMaintMs).toISOString());
    assert.equal(me2.user.rawExpiresAt, new Date(passedDuringMaintMs).toISOString());
    assert.ok(
      Math.abs((Date.parse(me2.user.expiresAt) - Date.now()) - 30 * 60 * 1000) < 10000,
      'Repeated /api/auth/me polls must NOT double-compensate cached session'
    );

    const botsPayload = await fetch(`${env.baseUrl}/api/manager/bots`, { headers: shortHeaders }).then((r) => r.json());
    assert.equal(botsPayload.maintenance.startedAt, maintStartIso);
    assert.equal(botsPayload.maintenance.lastCompensatedAt, maintStartIso);

    // Disabled user remains blocked from login during maintenance
    const disabledLogin = await fetch(`${env.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'disableduser', password: 'UserPass!99' })
    });
    assert.ok(disabledLogin.status === 403 || disabledLogin.status === 401);
    await disabledLogin.text();

    // 4. Turn OFF maintenance via Admin HTTP route -> compensates exact 3 eligible users (user_1, user_grace, user_frozen_short)
    const adminLogin = await fetch(`${env.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'AdminPass!99' })
    }).then((r) => r.json());
    const adminHeaders = { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' };

    const disableRes = await fetch(`${env.baseUrl}/api/manager/maintenance`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ enabled: false })
    }).then((r) => r.json());
    assert.equal(disableRes.ok, true);
    assert.equal(disableRes.maintenance.enabled, false);
    assert.equal(disableRes.maintenance.startedAt, null);
    assert.equal(disableRes.maintenance.lastCompensatedAt, null);
    assert.equal(disableRes.maintenance.compensatedUsers, 3, 'Must compensate active + grace_period + frozen_short only');
    assert.ok(disableRes.maintenance.lastCompensationMs >= 2 * 3600 * 1000);
    assert.ok(disableRes.message.includes('cộng bù thời gian bảo trì cho 3 tài khoản'));

    const deltaMs = disableRes.maintenance.lastCompensationMs;
    const u1After = await env.store.getAccess('user_1', { bypassCache: true });
    const uGraceAfter = await env.store.getAccess('user_grace', { bypassCache: true });
    const uShortAfter = await env.store.getAccess('user_frozen_short', { bypassCache: true });
    const uOldExpAfter = await env.store.getAccess('user_old_expired', { bypassCache: true });
    const uDisabledAfter = await env.store.getAccess('user_disabled', { bypassCache: true });
    const uPermAfter = await env.store.getAccess('user_vip_perm', { bypassCache: true });

    assert.equal(Date.parse(u1After.expiresAt), activeRawExpMs + deltaMs, 'Active user compensated by exact deltaMs');
    assert.equal(Date.parse(uGraceAfter.expiresAt), graceRawExpMs + deltaMs, 'Eligible grace_period user compensated by exact deltaMs');
    assert.equal(Date.parse(uShortAfter.expiresAt), passedDuringMaintMs + deltaMs, 'Short active user compensated by exact deltaMs');
    assert.equal(Date.parse(uOldExpAfter.expiresAt), oldExpiredRawExpMs, 'Old expired user must NOT be compensated');
    assert.equal(Date.parse(uDisabledAfter.expiresAt), disabledRawExpMs, 'Disabled user must NOT be compensated');
    assert.equal(uPermAfter.expiresAt, null, 'Permanent VIP user must keep null expiresAt');

    // Session cache was immediately reset on POST /maintenance -> /api/auth/me returns persisted compensated expiry
    const meAfterOff = await fetch(`${env.baseUrl}/api/auth/me`, { headers: shortHeaders }).then((r) => r.json());
    assert.equal(meAfterOff.maintenance.enabled, false);
    assert.equal(meAfterOff.user.expiresAt, uShortAfter.expiresAt);
  } finally {
    await env.close();
  }
});

test('MAINTENANCE TIME FREEZE (5): Giftcode redeem mid-maintenance for expired user flushes checkpoint to prevent retroactive/double compensation', async () => {
  const env = await startTestApp();
  try {
    const nowBeforeSetup = Date.now();
    const maintStartMs = nowBeforeSetup - 2 * 3600 * 1000; // Maintenance started 2h BEFORE redeem
    const activeInitialExpMs = nowBeforeSetup + 24 * 3600 * 1000;

    await env.store.setAccess('user_1', {
      id: 'user_1',
      username: 'farmuser',
      password: encryptUserPassword('UserPass!99'),
      role: 'user',
      workerIds: ['bot-1'],
      status: 'active',
      isPermanent: false,
      expiresAt: new Date(activeInitialExpMs).toISOString(),
      planName: 'VIP'
    }, 'seed');

    await env.store.setAccess('user_expired_redeemer', {
      id: 'user_expired_redeemer',
      username: 'redeemer',
      password: encryptUserPassword('UserPass!99'),
      role: 'user',
      workerIds: [],
      status: 'expired',
      isPermanent: false,
      expiresAt: new Date(maintStartMs - 5 * 86400000).toISOString(),
      planName: 'Standard'
    }, 'seed');

    await setMaintenanceState(
      env.store,
      { enabled: true, message: 'Bảo trì nâng cấp' },
      'admin',
      { toMs: maintStartMs }
    );

    const createdKey = await env.entitlementService.createCode({
      days: 1,
      permanent: false,
      botCount: 1,
      maxUses: 1,
      planName: 'Renew1D',
      actorId: 'admin'
    });

    const redeemAtMs = Date.now();
    const redeemResult = await env.entitlementService.redeem('user_expired_redeemer', createdKey.code, 'user');
    const afterRedeemMs = Date.now();

    // Verify checkpoint flushed up to ~redeemAtMs BEFORE granting 1 day from now:
    // 1) user_expired_redeemer gets ONLY ~24h from redeemAtMs (NOT +2h retroactive pre-redeem maintenance!)
    const redeemerAfterCode = await env.store.getAccess('user_expired_redeemer', { bypassCache: true });
    const redeemerExpMs = Date.parse(redeemerAfterCode.expiresAt);
    assert.ok(
      redeemerExpMs >= redeemAtMs + 86400000 - 2000 && redeemerExpMs <= afterRedeemMs + 86400000 + 2000,
      `Expired redeemer must get ~24h (no retroactive +2h), got diff=${redeemerExpMs - redeemAtMs}ms`
    );
    assert.equal(redeemResult.expiresAt, redeemerAfterCode.expiresAt);

    // 2) Maintenance startedAt is preserved, while lastCompensatedAt advanced to checkpoint (~redeemAtMs)
    const maintMid = await getMaintenanceState(env.store);
    assert.equal(maintMid.enabled, true);
    assert.equal(maintMid.startedAt, new Date(maintStartMs).toISOString());
    const checkpointMs = Date.parse(maintMid.lastCompensatedAt);
    assert.ok(checkpointMs >= redeemAtMs - 2000 && checkpointMs <= afterRedeemMs + 2000);

    // 3) Active user_1 already received the first ~2h during checkpoint flush
    const u1Mid = await env.store.getAccess('user_1', { bypassCache: true });
    const firstLegDelta = checkpointMs - maintStartMs;
    assert.equal(Date.parse(u1Mid.expiresAt), activeInitialExpMs + firstLegDelta);

    // 4) Maintenance ends 1h AFTER redeem -> both users receive ONLY the remaining +1h leg (no double compensation)
    const turnOffAtMs = checkpointMs + 3600 * 1000;
    const finalMaint = await flushMaintenanceCompensation(env.store, {
      toMs: turnOffAtMs,
      turnOff: true,
      actor: 'admin'
    });
    assert.equal(finalMaint.enabled, false);
    assert.equal(finalMaint.lastCompensationMs, 3600 * 1000);
    assert.equal(finalMaint.compensatedUsers, 2);

    const redeemerFinal = await env.store.getAccess('user_expired_redeemer', { bypassCache: true });
    const u1Final = await env.store.getAccess('user_1', { bypassCache: true });
    assert.equal(
      Date.parse(redeemerFinal.expiresAt),
      redeemerExpMs + 3600 * 1000,
      'Redeemer must receive ONLY the 1h post-redeem maintenance duration'
    );
    assert.equal(
      Date.parse(u1Final.expiresAt),
      activeInitialExpMs + firstLegDelta + 3600 * 1000,
      'Active user must receive exact total 3h (2h checkpoint + 1h final) without double-counting'
    );
  } finally {
    await env.close();
  }
});

test('MAINTENANCE TIME FREEZE (6): Web UI VM (01 & 05 anti-double-compensation) and Discord badges/panels freeze cleanly', () => {
  // --- Part A: Web UI VM execution of 01-core-and-cards.js + 05-detail-gui-and-logs.js ---
  const scriptsDir = path.join(__dirname, '../src/http/views/dashboard/scripts');
  const script01 = fs.readFileSync(path.join(scriptsDir, '01-core-and-cards.js'), 'utf8');
  const script05 = fs.readFileSync(path.join(scriptsDir, '05-detail-gui-and-logs.js'), 'utf8');

  let fakeNow = Date.parse('2026-11-27T14:00:00.000Z');
  const anchorIso = '2026-11-27T12:00:00.000Z'; // Maintenance started 2h ago
  const anchorMs = Date.parse(anchorIso);

  function makeClassList(initial = []) {
    const set = new Set(initial);
    return {
      add: (...cls) => cls.forEach((c) => set.add(c)),
      remove: (...cls) => cls.forEach((c) => set.delete(c)),
      contains: (c) => set.has(c),
      toggle: (c, force) => {
        if (force === undefined) {
          if (set.has(c)) { set.delete(c); return false; }
          set.add(c); return true;
        }
        if (force) set.add(c); else set.delete(c);
        return Boolean(force);
      }
    };
  }

  const elements = new Map();
  function getOrCreateEl(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        style: {},
        dataset: {},
        disabled: false,
        title: '',
        textContent: '',
        innerHTML: '',
        className: '',
        classList: makeClassList(['hidden']),
        children: [],
        appendChild(child) { this.children.push(child); return child; },
        insertBefore(child) { this.children.unshift(child); return child; },
        querySelector() { return null; },
        setAttribute(k, v) { this[k] = v; },
        getAttribute(k) { return this[k] || null; },
        addEventListener() {}
      });
    }
    return elements.get(id);
  }

  const headerRight = getOrCreateEl('globalHeaderRight');
  const FakeDate = class extends Date {
    constructor(...args) {
      if (args.length === 0) super(fakeNow);
      else super(...args);
    }
    static now() {
      return fakeNow;
    }
  };

  const sandbox = {
    console,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    RegExp,
    JSON,
    Promise,
    Error,
    Date: FakeDate,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    requestAnimationFrame: () => 1,
    navigator: { onLine: true, clipboard: { writeText: async () => {} } },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location: { origin: 'http://127.0.0.1', pathname: '/' },
    document: {
      activeElement: { tagName: 'BODY' },
      getElementById: (id) => getOrCreateEl(id),
      querySelector: (sel) => (sel === '.global-header-right' ? headerRight : null),
      querySelectorAll: () => [],
      createElement: (tag) => ({
        tagName: String(tag).toUpperCase(),
        id: '',
        style: {},
        dataset: {},
        disabled: false,
        title: '',
        textContent: '',
        innerHTML: '',
        classList: makeClassList(),
        appendChild() {},
        setAttribute() {},
        addEventListener() {}
      }),
      addEventListener: () => {}
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${script01}\n;\n${script05}`, sandbox, { filename: 'ui-maint-vm.js' });

  // Case 6a: Server /api/auth/me payload already has shifted `expiresAt` (+2h) WITHOUT `rawExpiresAt`
  // -> normalizeCurrentUserMaintenanceExpiry must back-compute rawExpiresAt so UI does NOT double-add +2h!
  const rawExpMs = anchorMs + (2 * 86400000 + 5 * 3600 * 1000 + 30 * 60 * 1000); // Exact 2d 5h 30m from anchor
  const serverShiftedIso = new Date(rawExpMs + (fakeNow - anchorMs)).toISOString();
  vm.runInContext(
    `currentUser = { id: 'u1', username: 'farmuser', role: 'user', status: 'active', isPermanent: false, planName: 'VIP', expiresAt: ${JSON.stringify(serverShiftedIso)} };`,
    sandbox
  );

  // Sync maintenance ON while logged in as non-admin user
  const maintPayload = {
    enabled: true,
    message: 'Đang bảo trì hệ thống cụm 1',
    startedAt: anchorIso,
    lastCompensatedAt: anchorIso,
    updatedAt: anchorIso
  };
  sandbox.syncSystemMaintenanceState(maintPayload, { rerender: false });
  sandbox.normalizeCurrentUserMaintenanceExpiry(vm.runInContext('currentUser', sandbox), maintPayload);
  sandbox.updateRentalCountdownUI();

  assert.ok(
    getOrCreateEl('systemMaintenanceBannerMessage').textContent.includes('không bị trừ trong lúc bảo trì'),
    'Fleet maintenance banner must state rental time is frozen'
  );
  assert.ok(
    getOrCreateEl('detailMaintenanceBannerMessage').textContent.includes('không bị trừ trong lúc bảo trì'),
    'Detail maintenance banner must state rental time is frozen'
  );

  const expectedFrozenText = '⏸️ Bảo trì · Tạm dừng trừ giờ (Còn 2 ngày 5 giờ 30 phút)';
  assert.equal(getOrCreateEl('userRentalBannerCountdown').textContent, expectedFrozenText);
  assert.ok(getOrCreateEl('userRentalCountdownBadge').innerHTML.includes(expectedFrozenText));
  assert.equal(sandbox.getUserExpirationInfo().isExpired, false);
  assert.equal(sandbox.getUserExpirationInfo().frozenByMaintenance, true);

  // Advance wall-clock by +4 hours during maintenance -> countdown MUST remain 100% stationary!
  fakeNow += 4 * 3600 * 1000;
  sandbox.updateRentalCountdownUI();
  assert.equal(
    getOrCreateEl('userRentalBannerCountdown').textContent,
    expectedFrozenText,
    'Countdown must stay completely stationary across hours while maintenance is ON'
  );

  // Case 6b: Pre-maintenance expired user stays expired in UI during maintenance
  const preMaintExpiredIso = new Date(anchorMs - 8 * 3600 * 1000).toISOString();
  vm.runInContext(
    `currentUser = { id: 'u2', username: 'oldexp', role: 'user', status: 'expired', isPermanent: false, planName: 'Standard', expiresAt: ${JSON.stringify(preMaintExpiredIso)}, rawExpiresAt: ${JSON.stringify(preMaintExpiredIso)} };`,
    sandbox
  );
  sandbox.updateRentalCountdownUI();
  assert.equal(sandbox.getUserExpirationInfo().isExpired, true);
  assert.ok(getOrCreateEl('userRentalBannerCountdown').textContent.includes('ĐÃ HẾT HẠN'));

  // --- Part B: Discord formatAccountPlanBadge, renderBotsList, renderBotDetail ---
  const nowReal = Date.now();
  const discordMaint = {
    enabled: true,
    message: 'Nâng cấp máy chủ Discord & Node',
    startedAt: new Date(nowReal - 2 * 3600 * 1000).toISOString(),
    lastCompensatedAt: new Date(nowReal - 2 * 3600 * 1000).toISOString()
  };
  const discordActiveUser = {
    id: 'u1',
    username: 'farmuser',
    role: 'user',
    status: 'active',
    isPermanent: false,
    expiresAt: new Date(nowReal - 2 * 3600 * 1000 + (3 * 86400000 + 4 * 3600 * 1000 + 10 * 60 * 1000)).toISOString()
  };
  const badgeActive = formatAccountPlanBadge(discordActiveUser, discordMaint);
  assert.equal(badgeActive, '⏸️ `Bảo trì · Giữ nguyên 3d 4h`');

  // Backward compatibility when maintenance is omitted/null
  const badgeNoMaint = formatAccountPlanBadge(discordActiveUser, null);
  assert.ok(badgeNoMaint.startsWith('⏳ `Còn '), `Expected normal countdown badge when maintenance=null, got ${badgeNoMaint}`);

  // Pre-maintenance expired / disabled / permanent users on Discord
  const discordExpiredUser = {
    id: 'u2',
    username: 'oldexp',
    role: 'user',
    status: 'expired',
    isPermanent: false,
    expiresAt: new Date(nowReal - 5 * 3600 * 1000).toISOString()
  };
  assert.equal(formatAccountPlanBadge(discordExpiredUser, discordMaint), '⚠️ `Hết hạn`');
  assert.equal(formatAccountPlanBadge({ username: 'dis', role: 'user', status: 'disabled' }, discordMaint), '⛔ `Đã khóa`');
  assert.equal(formatAccountPlanBadge({ username: 'vip', role: 'user', status: 'active', isPermanent: true }, discordMaint), '♾️ `Vĩnh viễn`');

  const listView = renderBotsList({
    user: discordActiveUser,
    workers: [{ workerId: 'bot-1', botNumber: 1, name: 'Farm Bot 1', status: { state: 'offline', online: false } }],
    page: 0,
    maintenance: discordMaint
  });
  const listDesc = listView.embeds[0].data?.description || '';
  assert.ok(listDesc.includes('⏸️ `Bảo trì · Giữ nguyên 3d 4h`'));
  assert.ok(listDesc.includes('Thời gian sử dụng bot được giữ nguyên, không bị trừ trong lúc bảo trì.'));

  const detailView = renderBotDetail({
    user: discordActiveUser,
    worker: { workerId: 'bot-1', botNumber: 1, name: 'Farm Bot 1', status: { state: 'offline', online: false } },
    maintenance: discordMaint
  });
  const detailDesc = detailView.embeds[0].data?.description || '';
  assert.ok(detailDesc.includes('⏸️ `Bảo trì · Giữ nguyên 3d 4h`'));
  assert.ok(detailDesc.includes('Thời gian sử dụng bot được giữ nguyên, không bị trừ trong lúc bảo trì.'));
});
