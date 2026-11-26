'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { collectSystemStatus, StatusMonitorService } = require('../src/discord/status-monitor');
const { renderStatusMonitorPanel, getWorkerState } = require('../src/discord/panels/renderer');
const { Link4mService } = require('../src/services/link4m-service');
const { AccessControl } = require('../src/services/access-control');

test('DISCORD /check: collects active vs expired users, reports Online/Offline only, and evaluates core-service health', async () => {
  const now = Date.now();
  const mockUsers = [
    { username: 'admin', role: 'admin', status: 'active', isPermanent: true },
    { username: 'u_active', role: 'user', status: 'active', expiresAt: new Date(now + 86400000).toISOString(), isPermanent: false },
    { username: 'u_perm', role: 'user', status: 'active', expiresAt: null, isPermanent: true },
    { username: 'u_expired', role: 'user', status: 'expired', expiresAt: new Date(now - 3600000).toISOString(), isPermanent: false },
    { username: 'u_past', role: 'user', status: 'active', expiresAt: new Date(now - 1000).toISOString(), isPermanent: false },
    { username: 'u_disabled', role: 'user', status: 'disabled', expiresAt: new Date(now + 86400000).toISOString(), isPermanent: false }
  ];

  const mockServices = {
    registry: {
      list: async () => [
        { workerId: 'b1', status: { state: 'afk', online: true } },
        { workerId: 'b2', status: { state: 'offline', online: false } },
        { workerId: 'b3', status: { state: 'error', online: false } }
      ]
    },
    accessStore: {
      listAccess: async () => mockUsers,
      adapter: { testConnection: async () => ({ ok: true }) }
    },
    discordClient: {
      isReady: () => true,
      ws: { ping: 22 }
    }
  };

  assert.strictEqual(getWorkerState({ status: { state: 'afk', online: true } }).label, 'ONLINE');
  assert.strictEqual(getWorkerState({ status: { state: 'offline', online: false } }).label, 'OFFLINE');

  const status = await collectSystemStatus(mockServices, { intervalMs: 15 * 60 * 1000 });
  assert.strictEqual(status.totalWorkers, 3);
  assert.strictEqual(status.onlineWorkers, 1);
  assert.strictEqual(status.offlineWorkers, 2);
  assert.strictEqual(status.totalUsers, 5);
  assert.strictEqual(status.activeUsers, 2);
  assert.strictEqual(status.expiredUsers, 2);
  assert.strictEqual(status.permanentUsers, 1);
  assert.strictEqual(status.disabledUsers, 1);
  assert.strictEqual(status.intervalMinutes, 15);
  assert.ok(status.nextCheckAtUnix - status.checkedAtUnix === 900);

  const panel = renderStatusMonitorPanel(status);
  const embed = panel.embeds[0].data;
  assert.strictEqual(embed.color, 0x22c55e, 'Must stay green even with offline bots when Manager/Supabase/Discord are healthy');
  assert.ok(embed.description.includes('TỐT'));
  const combined = `${embed.description}\n${(embed.fields || []).map((f) => `${f.name}\n${f.value}`).join('\n')}`;
  assert.ok(!combined.includes('AFK'));
  assert.ok(!combined.toUpperCase().includes('FLEET'));
  assert.ok(combined.includes('Còn hạn: 🟢 **2**'));
  assert.ok(combined.includes('Hết hạn: 🔴 **2**'));
});

test('DISCORD StatusMonitorService: setTrackedMessage restarts 15m auto-check cycle even after prior stop()', async () => {
  let editCalls = 0;
  let savedSetting = null;
  const mockChannel = {
    messages: {
      edit: async () => { editCalls++; }
    }
  };
  const mockServices = {
    accessStore: {
      getSetting: async () => null,
      setSetting: async (_k, v) => { savedSetting = v; },
      listAccess: async () => [],
      adapter: { testConnection: async () => ({ ok: true }) }
    },
    registry: { list: async () => [] },
    discordClient: {
      isReady: () => true,
      ws: { ping: 12 },
      channels: { fetch: async () => mockChannel }
    }
  };

  const monitor = new StatusMonitorService({ services: mockServices, intervalMs: 30 });
  monitor.stop();
  assert.strictEqual(monitor.stopped, true);

  monitor.setTrackedMessage({ guildId: 'g1', channelId: 'c1', messageId: 'm1' });
  assert.strictEqual(monitor.stopped, false, 'setTrackedMessage must un-stop monitor');
  assert.ok(monitor.timer, 'setTrackedMessage must start interval timer');

  await new Promise((r) => setTimeout(r, 95));
  monitor.stop();
  assert.ok(editCalls >= 1, `Expected periodic updateMessage to run (>=1), ran ${editCalls} times`);
  assert.ok(savedSetting?.updatedAt, 'Periodic check must update timestamp in stored tracked setting');
});

test('LINK4M PERMANENT: VIP permanent users can complete link4m to support admin without changing isPermanent/expiresAt', async () => {
  const attempts = new Map();
  let completedAccessPayload = null;
  const permMember = {
    id: 'usr_perm',
    username: 'vipperm',
    role: 'user',
    status: 'active',
    isPermanent: true,
    expiresAt: null,
    workerIds: ['bot-1'],
    planName: 'VIP Vĩnh Viễn'
  };

  const store = {
    async getSetting(k) {
      if (k === 'link4m_runtime') return { enabled: true, rewardHours: 12, dailyLimit: 2 };
      return null;
    },
    async setSetting() {},
    async getAccess() { return permMember; },
    async countLinkRewards() { return 0; },
    async lastLinkReward() { return null; },
    async getLatestLinkAttempt() { return null; },
    async findActiveLinkAttempt() { return null; },
    async expireLinkAttempts() {},
    async createLinkAttempt(rec) { attempts.set(rec.attemptId, rec); },
    async setLinkAttemptProviderUrl(attemptId, url) {
      const a = attempts.get(attemptId);
      if (!a) return false;
      a.providerUrl = url;
      return true;
    },
    async getLinkAttempt(attemptId) { return attempts.get(attemptId) || null; },
    async claimLinkAttempt(attemptId) {
      const a = attempts.get(attemptId);
      if (!a) return null;
      a.status = 'processing';
      return a;
    },
    async completeLink4mReward(attemptId, _uid, accessValues) {
      completedAccessPayload = accessValues;
      const a = attempts.get(attemptId);
      if (a) a.status = 'rewarded';
      return true;
    },
    async addAudit() {},
    invalidateUserCache() {}
  };

  let capturedNonce = '';
  const svc = new Link4mService({
    store,
    accessControl: new AccessControl({ store }),
    config: {
      enabled: true,
      link4mApiToken: 'mock-l4m-token',
      publicBaseUrl: 'https://manager.example.com'
    },
    fetchImpl: async (reqUrl) => {
      try {
        const returnUrlStr = new URL(String(reqUrl)).searchParams.get('url') || '';
        capturedNonce = new URL(returnUrlStr).searchParams.get('token') || '';
      } catch {}
      return {
        ok: true,
        text: async () => JSON.stringify({ shortenedUrl: 'https://link4m.co/short123' })
      };
    }
  });
  await svc.initialize();

  const status = await svc.status('usr_perm');
  assert.strictEqual(status.eligible, true);
  assert.strictEqual(status.isPermanent, true);
  assert.strictEqual(status.supportMode, true);

  const started = await svc.startAttempt('usr_perm', '203.0.113.10');
  assert.strictEqual(started.isPermanent, true);
  assert.strictEqual(started.supportMode, true);
  assert.strictEqual(started.rewardHours, 0);
  assert.ok(capturedNonce.length > 0, 'Return URL token nonce should be generated');

  const savedAttempt = attempts.get(started.attemptId);
  savedAttempt.createdAt = new Date(Date.now() - 20000);

  const returnRes = await svc.completeVerifiedAttempt(savedAttempt, savedAttempt.tokenHash);
  assert.strictEqual(returnRes.permanent, true);
  assert.strictEqual(returnRes.supportAdmin, true);
  assert.strictEqual(returnRes.rewardHours, 0);
  assert.strictEqual(returnRes.expiresAt, null);
  assert.strictEqual(completedAccessPayload.isPermanent, true);
  assert.strictEqual(completedAccessPayload.expiresAt, null);

  const replayRes = await svc.completeReturn(started.attemptId, capturedNonce);
  assert.deepStrictEqual(replayRes, {
    replayed: true,
    isRewarded: true,
    permanent: true,
    supportAdmin: true,
    rewardHours: 0,
    addedHours: 0
  });
});

test('DASHBOARD & LOGIN UI: No Broadcast, zero "Hạm đội"/"100% FLEET SYNC", toolbar lock guards, unique IDs, all scripts compile', () => {
  const { HTML } = require('../src/http/views/dashboard-html');
  const { PUBLIC_LOGIN_HTML } = require('../src/http/views/login-html');
  assert.equal(/hạm đội/i.test(HTML), false, 'Rendered dashboard HTML must not contain "hạm đội"');
  assert.equal(HTML.includes('100% FLEET SYNC'), false, 'Changelog badge must use "100% REALTIME SYNC" instead of "100% FLEET SYNC"');
  assert.equal(HTML.includes('broadcastModal'), false, 'Broadcast modal must be removed');
  assert.equal(HTML.includes('openBroadcastModal'), false, 'Broadcast modal trigger must be removed');
  assert.ok(HTML.includes('id="allReconnectButton"'), 'Toolbar Reconnect button must have id="allReconnectButton" for lock state sync');
  assert.ok(HTML.includes('detailChatCount') && HTML.includes('detailEventCount'), 'Chat/Event count pills must exist');
  assert.ok(HTML.includes('log-row') && HTML.includes('chat-row-item'), 'Structured Event/Chat log rows must exist');

  const partialsDir = path.join(__dirname, '../src/http/views/dashboard/partials');
  const seenIds = new Set();
  for (const file of fs.readdirSync(partialsDir).sort()) {
    const content = fs.readFileSync(path.join(partialsDir, file), 'utf8');
    const re = /\bid="([^"]+)"/g;
    let m;
    while ((m = re.exec(content)) !== null) {
      assert.equal(seenIds.has(m[1]), false, `Duplicate DOM id "${m[1]}" in ${file}`);
      seenIds.add(m[1]);
    }
  }

  const scriptsDir = path.join(__dirname, '../src/http/views/dashboard/scripts');
  const fullScript = fs.readdirSync(scriptsDir)
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((f) => fs.readFileSync(path.join(scriptsDir, f), 'utf8'))
    .join('\n;\n');
  assert.ok(fullScript.includes("'allReconnectButton'") && fullScript.includes('runAllAction') && fullScript.includes('reconnectOfflineBots'), 'Bulk action toolbar scripts must exist');
  assert.ok(/async function reconnectOfflineBots[\s\S]{0,300}getWorkerLockInfo/.test(fullScript), 'reconnectOfflineBots must check getWorkerLockInfo');
  assert.ok(/async function runAllAction[\s\S]{0,300}getWorkerLockInfo/.test(fullScript), 'runAllAction must check getWorkerLockInfo');
  new vm.Script(fullScript, { filename: 'dashboard-combined.js' });

  const loginScripts = [...PUBLIC_LOGIN_HTML.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  assert.ok(loginScripts.length > 0, 'PUBLIC_LOGIN_HTML must contain inline script blocks');
  loginScripts.forEach((src, idx) => {
    new vm.Script(src, { filename: `login-html-script-${idx}.js` });
  });
});

test('LINK4M PERSISTENCE: API token, secret, mode, customUrl & toggle survive partial saves, restarts and DB read errors', async () => {
  const express = require('express');
  const crypto = require('node:crypto');
  const { createAdminApi } = require('../src/http/routes/admin-api');
  const { ManagerRuntimeSettings } = require('../src/services/manager-runtime-settings');
  const AsyncKeyLock = require('../src/services/async-key-lock');

  const encKey = crypto.randomBytes(32);
  const dbSettings = new Map();
  let simulateReadFailure = false;

  const store = {
    async getSetting(key, opts = {}) {
      if (simulateReadFailure && key === 'system_settings') {
        throw new Error('transient_supabase_timeout');
      }
      if (!opts?.bypassCache && key === 'system_settings') {
        throw new Error('must_bypass_cache_on_system_settings');
      }
      const val = dbSettings.get(key);
      if (!val) return null;
      return typeof val === 'object' ? { ...structuredClone(val), updatedAt: new Date().toISOString() } : val;
    },
    async setSetting(key, value) {
      dbSettings.set(key, structuredClone(value));
      return this.getSetting(key, { bypassCache: true });
    },
    async getAccess() {
      return {
        userId: 'usr_l4m_1',
        username: 'user1',
        role: 'user',
        status: 'active',
        isPermanent: false,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        workerIds: ['01']
      };
    },
    async countLinkRewards() { return 0; },
    async lastLinkReward() { return null; },
    async getLatestLinkAttempt() { return null; },
    async findActiveLinkAttempt() { return null; },
    async expireLinkAttempts() {},
    async createLinkAttempt() {},
    async setLinkAttemptProviderUrl() { return true; }
  };

  const baseConfig = Object.freeze({
    encryptionKey: encKey,
    previousEncryptionKey: null,
    publicBaseUrl: '',
    renderApiKey: '',
    link4mApiToken: '',
    link4mSecretKey: '',
    link4mRewardEnabled: false,
    link4mRewardHours: 12,
    link4mDailyLimit: 2
  });

  const mgrRt1 = new ManagerRuntimeSettings({ store, encryptionKey: encKey, initial: {} });
  const initRt1 = await mgrRt1.initialize();
  const l4m1 = new Link4mService({
    store,
    accessControl: new AccessControl({ store }),
    userLock: new AsyncKeyLock(),
    config: { ...baseConfig, ...initRt1 }
  });
  await l4m1.initialize();

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.managerAuthSession = { userId: 'admin', username: 'admin', role: 'admin' };
    next();
  });
  app.use('/api/manager', createAdminApi({
    store,
    link4mService: l4m1,
    managerRuntimeSettings: mgrRt1,
    registry: { encryptionKey: encKey, list: async () => [] },
    config: baseConfig,
    logger: { info() {}, warn() {}, error() {} }
  }));

  const server = app.listen(0);
  const port = server.address().port;
  try {
    // 1. Save full Link4M API configuration via Admin endpoint
    const saveRes = await fetch(`http://127.0.0.1:${port}/api/manager/settings/system`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicBaseUrl: 'https://mgr.example.com',
        link4mRewardEnabled: true,
        link4mMode: 'api',
        link4mApiToken: 'real_l4m_tok_abc',
        link4mSecretKey: 'real_l4m_sec_xyz',
        link4mRewardHours: 8,
        link4mDailyLimit: 3
      })
    });
    assert.strictEqual(saveRes.status, 200);
    const saveJson = await saveRes.json();
    assert.strictEqual(saveJson.settings.link4mApiToken, '********');
    assert.strictEqual(saveJson.settings.link4mSecretKey, '********');
    assert.ok(dbSettings.get('system_settings').link4mApiTokenCiphertext, 'Token must be persisted encrypted');
    assert.ok(dbSettings.get('manager_runtime').secretsCiphertext, 'manager_runtime must stay synced');

    // 2. Partial updates (trial toggle & link4m toggle) must NOT lose token/secret
    const partialTrial = await fetch(`http://127.0.0.1:${port}/api/manager/settings/system`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trialGiftEnabled: true, trialDays: 5 })
    });
    assert.strictEqual(partialTrial.status, 200);

    const toggleOff = await fetch(`http://127.0.0.1:${port}/api/manager/settings/system`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link4mRewardEnabled: false })
    });
    assert.strictEqual(toggleOff.status, 200);

    const toggleOn = await fetch(`http://127.0.0.1:${port}/api/manager/settings/system`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link4mRewardEnabled: true })
    });
    assert.strictEqual(toggleOn.status, 200);

    // 3. Transient DB read failure must abort 500 WITHOUT wiping previously saved system_settings
    const snapshotBeforeErr = structuredClone(dbSettings.get('system_settings'));
    simulateReadFailure = true;
    const errRes = await fetch(`http://127.0.0.1:${port}/api/manager/settings/system`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trialDays: 7 })
    });
    simulateReadFailure = false;
    assert.strictEqual(errRes.status, 500);
    assert.deepStrictEqual(dbSettings.get('system_settings'), snapshotBeforeErr);

    // 4. Simulate full process restart (empty RAM, fresh instances reading from DB only)
    const mgrRtAfterRestart = new ManagerRuntimeSettings({ store, encryptionKey: encKey, initial: {} });
    const initRt2 = await mgrRtAfterRestart.initialize();
    assert.strictEqual(initRt2.link4mApiToken, 'real_l4m_tok_abc');
    assert.strictEqual(initRt2.link4mSecretKey, 'real_l4m_sec_xyz');
    assert.strictEqual(initRt2.publicBaseUrl, 'https://mgr.example.com');

    let fetchedApiParam = '';
    const l4mAfterRestart = new Link4mService({
      store,
      accessControl: new AccessControl({ store }),
      userLock: new AsyncKeyLock(),
      config: { ...baseConfig, ...initRt2 },
      fetchImpl: async (reqUrl) => {
        fetchedApiParam = new URL(String(reqUrl)).searchParams.get('api') || '';
        return { ok: true, text: async () => JSON.stringify({ shortenedUrl: 'https://link4m.co/ok1' }) };
      }
    });
    await l4mAfterRestart.initialize();
    const pub2 = l4mAfterRestart.publicConfig();
    assert.strictEqual(pub2.enabled, true);
    assert.strictEqual(pub2.providerConfigured, true);
    assert.strictEqual(pub2.webhookConfigured, true);
    assert.strictEqual(pub2.rewardHours, 8);
    assert.strictEqual(pub2.dailyLimit, 3);

    const attemptRes = await l4mAfterRestart.startAttempt('usr_l4m_1', '198.51.100.5');
    assert.strictEqual(fetchedApiParam, 'real_l4m_tok_abc');
    assert.strictEqual(attemptRes.providerUrl, 'https://link4m.co/ok1');

    // 5. Custom URL mode persists & starts attempt with configured fixed URL
    const saveCustom = await fetch(`http://127.0.0.1:${port}/api/manager/settings/system`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        link4mRewardEnabled: true,
        link4mMode: 'custom_url',
        link4mUrl: 'https://link4m.co/fixed123',
        link4mApiToken: '********',
        link4mSecretKey: '********'
      })
    });
    assert.strictEqual(saveCustom.status, 200);
    const l4mCustomRestart = new Link4mService({
      store,
      accessControl: new AccessControl({ store }),
      userLock: new AsyncKeyLock(),
      config: { encryptionKey: encKey }
    });
    await l4mCustomRestart.initialize();
    assert.strictEqual(l4mCustomRestart.publicConfig().mode, 'custom_url');
    const customAttempt = await l4mCustomRestart.startAttempt('usr_l4m_1', '198.51.100.5');
    assert.strictEqual(customAttempt.providerUrl, 'https://link4m.co/fixed123');
  } finally {
    server.close();
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  }
});

test('BOT SEARCH BY ID: Supports searching bots by 01, 22, #01, 01,22, IP, host, and username', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/http/views/dashboard/scripts/04-fleet-and-admin-modals.js'), 'utf8');
  const startIdx = src.indexOf('function matchesSingleBotTerm');
  const endIdx = src.indexOf('function computeBotCardSig');
  assert.ok(startIdx >= 0 && endIdx > startIdx, 'Search helper functions must exist in 04-fleet-and-admin-modals.js');

  const bot1 = { id: '1', workerId: '1', botNumber: 1, label: 'Farm Vàng', username: 'Steve01', ipAddress: '10.20.30.40', status: 'afk', available: true };
  const bot10 = { id: '10', workerId: '10', botNumber: 10, label: 'Khai Thác', username: 'AlexMiner', ipAddress: '10.20.99.99', status: 'offline', available: true };
  const bot22 = { id: '22', workerId: '22', botNumber: 22, label: 'Creeper AFK', username: 'Grinder', host: 'node22.wisp.test', status: 'online', available: true };
  const allBots = [bot1, bot10, bot22];

  let renderedIds = [];
  const searchBox = { value: '' };
  const ctx = vm.createContext({
    window: {},
    document: {
      getElementById: (id) => {
        if (id === 'searchInput') return searchBox;
        if (id === 'botGrid') return { innerHTML: '' };
        return null;
      }
    },
    currentUser: { role: 'admin' },
    bots: allBots,
    activeStatusFilter: 'all',
    activeTagFilter: '',
    currentSortMode: 'default',
    draggedBotId: null,
    isMinecraftOffline: (b) => b.status === 'offline',
    isBotUnreachable: (b) => b.available !== true,
    reconcileBotCards: (list) => { renderedIds = list.map((b) => b.id); }
  });
  vm.runInContext(src.slice(startIdx, endIdx), ctx);

  const runSearch = (q, role = 'admin') => {
    ctx.currentUser = { role };
    searchBox.value = q;
    renderedIds = [];
    ctx.filterBots();
    return renderedIds;
  };

  assert.deepStrictEqual(runSearch('01'), ['1']);
  assert.deepStrictEqual(runSearch('1'), ['1']);
  assert.deepStrictEqual(runSearch('#01'), ['1']);
  assert.deepStrictEqual(runSearch('bot #22'), ['22']);
  assert.deepStrictEqual(runSearch('22'), ['22']);
  assert.deepStrictEqual(runSearch('01, 22'), ['1', '22']);
  assert.deepStrictEqual(runSearch('10.20.30', 'admin'), ['1']);
  assert.deepStrictEqual(runSearch('node22.wisp', 'admin'), ['22']);
  assert.deepStrictEqual(runSearch('10.20.30', 'user'), [], 'Non-admin must not match internal IP');
  assert.deepStrictEqual(runSearch('node22.wisp', 'user'), [], 'Non-admin must not match host');
});

test('DISCORD STRICT ADMIN RBAC: Only configured Admin Role & assigned Discord ID qualify; guild owner or foreign server Admin never count', async () => {
  const { isSuperAdmin, isUserAdmin } = require('../src/discord/handlers/interaction-handler');
  const { hasAuthorizedRole, resolveLinkedUser } = require('../src/discord/handlers/panel-handler');

  const accessControl = new AccessControl({
    store: { getAccess: async () => null },
    adminRoleId: '111111111111111111',
    userRoleId: '222222222222222222',
    adminUserId: '999999999999999999'
  });

  const services = {
    config: {
      discordGuildId: '777777777777777777',
      adminRoleId: '111111111111111111',
      userRoleId: '222222222222222222',
      adminUserId: '999999999999999999'
    },
    accessControl,
    accessStore: {
      getUserByDiscordId: async (id) => (
        id === '888888888888888888'
          ? { userId: 'usr_owner', username: 'owner_web', role: 'user', status: 'active' }
          : null
      )
    }
  };

  // Guild owner + Administrator perm (8n) WITHOUT adminRoleId or adminUserId -> MUST BE FALSE everywhere
  const guildOwnerOnly = {
    guildId: '777777777777777777',
    user: { id: '888888888888888888' },
    guild: { id: '777777777777777777', ownerId: '888888888888888888' },
    memberPermissions: { has: () => true },
    member: {
      id: '888888888888888888',
      permissions: { has: () => true },
      roles: { cache: new Map([['222222222222222222', {}]]) }
    }
  };
  assert.strictEqual(accessControl.roleFor(guildOwnerOnly.member, guildOwnerOnly), 'user');
  assert.strictEqual(isSuperAdmin(guildOwnerOnly, services), false);
  assert.strictEqual(isUserAdmin(guildOwnerOnly, services, { role: 'admin' }), false);
  assert.strictEqual((await resolveLinkedUser(guildOwnerOnly, services))?.role, 'user');

  // Foreign server owner -> MUST BE FALSE everywhere
  const otherServerOwner = {
    guildId: '666666666666666666',
    user: { id: '555555555555555555' },
    guild: { id: '666666666666666666', ownerId: '555555555555555555' },
    memberPermissions: { has: () => true },
    member: { roles: ['111111111111111111'] }
  };
  assert.strictEqual(isSuperAdmin(otherServerOwner, services), false);
  assert.strictEqual(isUserAdmin(otherServerOwner, services, { role: 'admin' }), false);
  assert.strictEqual(await hasAuthorizedRole(otherServerOwner, services), false);

  // Member with setup adminRoleId inside allowed guild -> TRUE
  const roleAdmin = {
    guildId: '777777777777777777',
    user: { id: '444444444444444444' },
    guild: { id: '777777777777777777', ownerId: '888888888888888888' },
    member: { id: '444444444444444444', roles: { cache: new Map([['111111111111111111', {}]]) } }
  };
  assert.strictEqual(accessControl.roleFor(roleAdmin.member, roleAdmin), 'admin');
  assert.strictEqual(isSuperAdmin(roleAdmin, services), true);
  assert.strictEqual(isUserAdmin(roleAdmin, services, null), true);
  assert.strictEqual(await hasAuthorizedRole(roleAdmin, services), true);
  assert.strictEqual((await resolveLinkedUser(roleAdmin, services))?.role, 'admin');

  // Configured Discord ID (adminUserId) -> TRUE
  const envAdmin = {
    guildId: '777777777777777777',
    user: { id: '999999999999999999' },
    guild: { id: '777777777777777777', ownerId: '888888888888888888' },
    member: { id: '999999999999999999', roles: { cache: new Map() } }
  };
  assert.strictEqual(accessControl.roleFor(envAdmin.member, envAdmin), 'admin');
  assert.strictEqual(isSuperAdmin(envAdmin, services), true);
  assert.strictEqual(isUserAdmin(envAdmin, services, null), true);
  assert.strictEqual(await hasAuthorizedRole(envAdmin, services), true);
});

test('DISCORD /bots PAGINATION: Renders First/Prev/Counter/Next/Last + Refresh with unique IDs and navigates accurately', async () => {
  const { renderBotsList } = require('../src/discord/panels/renderer');
  const { handlePanelInteraction } = require('../src/discord/handlers/panel-handler');

  const workers = Array.from({ length: 12 }, (_, idx) => ({
    workerId: String(idx + 1).padStart(2, '0'),
    botNumber: idx + 1,
    name: `BOT ${String(idx + 1).padStart(2, '0')}`,
    status: { online: idx % 2 === 0, state: idx % 2 === 0 ? 'online' : 'offline' }
  }));

  for (const p of [0, 1, 2]) {
    const view = renderBotsList({ user: { username: 'admin' }, workers, page: p });
    assert.ok(view.components.length === 3, 'Paginated view must have 3 rows: bots, nav, refresh');
    for (const row of view.components) {
      assert.ok(row.components.length <= 5, 'Discord ActionRow max 5 buttons');
    }
    const allIds = view.components.flatMap((row) => row.components.map((c) => c.data.custom_id));
    assert.strictEqual(new Set(allIds).size, allIds.length, `All custom_ids must be unique on page ${p}`);

    const navIds = view.components[1].components.map((c) => ({ id: c.data.custom_id, disabled: Boolean(c.data.disabled), label: c.data.label }));
    assert.deepStrictEqual(navIds.map((b) => b.id), ['bots:first', `bots:page:${p - 1}`, 'bots:noop', `bots:page:${p + 1}`, 'bots:last']);
    assert.strictEqual(navIds[0].disabled, p === 0);
    assert.strictEqual(navIds[1].disabled, p === 0);
    assert.strictEqual(navIds[2].label, `${p + 1}/3`);
    assert.strictEqual(navIds[3].disabled, p === 2);
    assert.strictEqual(navIds[4].disabled, p === 2);
    assert.deepStrictEqual(view.components[2].components.map((c) => c.data.custom_id), ['bots:refresh']);
  }

  // Test handlePanelInteraction navigation for bots:last, bots:first, bots:refresh
  const mockServices = {
    config: { discordGuildId: 'g1', adminUserId: 'admin_1', adminRoleId: 'r_adm', userRoleId: 'r_usr' },
    accessControl: { adminUserId: 'admin_1', adminRoleId: 'r_adm', userRoleId: 'r_usr', roleFor: () => 'admin' },
    accessStore: { getUserByDiscordId: async () => null },
    registry: { list: async () => workers }
  };

  let btnUserSeq = 0;
  const dispatchBtn = async (customId, footerText = '') => {
    let payload = null;
    const uid = `admin_pag_${++btnUserSeq}`;
    await handlePanelInteraction({
      guildId: 'g1',
      user: { id: uid },
      guild: { id: 'g1', ownerId: 'other' },
      customId,
      message: footerText ? { embeds: [{ data: { footer: { text: footerText } } }] } : undefined,
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      deferred: false,
      replied: false,
      deferUpdate: async function () { this.deferred = true; },
      editReply: async (p) => { payload = p; },
      update: async (p) => { payload = p; }
    }, {
      ...mockServices,
      config: { ...mockServices.config, adminUserId: uid },
      accessControl: { ...mockServices.accessControl, adminUserId: uid }
    });
    return payload;
  };

  const lastView = await dispatchBtn('bots:last');
  assert.ok(lastView.embeds[0].data.footer.text.includes('Trang 3/3'));
  assert.ok(lastView.embeds[0].data.description.includes('BOT 11'));

  const refreshLastView = await dispatchBtn('bots:refresh', 'Trang 3/3 • Chọn nút');
  assert.ok(refreshLastView.embeds[0].data.footer.text.includes('Trang 3/3'), 'bots:refresh must stay on current page');

  const firstView = await dispatchBtn('bots:first');
  assert.ok(firstView.embeds[0].data.footer.text.includes('Trang 1/3'));
  assert.ok(firstView.embeds[0].data.description.includes('BOT 01'));
});

test('WEB UI UNSLOP + ANIMATE UI: Enforces motion tokens, fine-pointer hover gates, reduced-motion, and zero AI-slop CSS', () => {
  const dash = require('../src/http/views/dashboard');
  const { PUBLIC_LOGIN_HTML } = require('../src/http/views/login-html');
  const rawTokensCss = fs.readFileSync(
    path.join(__dirname, '../src/http/views/dashboard/styles/01-tokens-and-base.css'),
    'utf8'
  );

  for (const [label, css] of [['DASHBOARD_STYLES', dash.STYLES], ['PUBLIC_LOGIN_HTML', PUBLIC_LOGIN_HTML]]) {
    assert.match(css, /--ease-out:\s*cubic-bezier\(0\.23,\s*1,\s*0\.32,\s*1\)/, `${label} must define Animate UI --ease-out`);
    assert.match(css, /--ease-away:\s*cubic-bezier\(0\.33,\s*0\.17,\s*0\.67,\s*0\.5\)/, `${label} must define Animate UI --ease-away`);
    assert.match(css, /--scale-press:\s*0\.97\b/, `${label} must define --scale-press: 0.97`);
    assert.match(css, /--scale-choice:\s*0\.985\b/, `${label} must define --scale-choice: 0.985`);
    assert.match(css, /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)/, `${label} must gate hover to fine pointers`);
    assert.doesNotMatch(css, /@media\s*\(\s*hover\s*:\s*hover\s*\)\s*\{/, `${label} must not use bare @media (hover: hover)`);
    assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/, `${label} must handle prefers-reduced-motion: reduce`);
    assert.doesNotMatch(css, /-webkit-background-clip\s*:\s*text/i, `${label} must not contain gradient-text slop`);
    assert.doesNotMatch(css, /\b(barShimmer|textShine|bellFloat)\b/, `${label} must not contain infinite decorative shimmer/float loops`);
  }

  for (const [label, bundle] of [
    ['DASHBOARD_STYLES', dash.STYLES],
    ['DASHBOARD_BODY', dash.BODY],
    ['DASHBOARD_SCRIPTS', dash.SCRIPTS],
    ['PUBLIC_LOGIN_HTML', PUBLIC_LOGIN_HTML]
  ]) {
    assert.doesNotMatch(bundle, /transition\s*:\s*all\b/i, `${label} must never use transition: all`);
  }

  assert.doesNotMatch(dash.SCRIPTS, /onmouseenter=/i, 'Dashboard JS must not inject inline hover scale handlers');
  assert.match(rawTokensCss, /unslop/i, '01-tokens-and-base.css must retain unslop attribution');
  assert.match(PUBLIC_LOGIN_HTML, /unslop/i, 'login-html.js must retain unslop attribution');
});
