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

test('WEB UI OBSERVABILITY, ACTION FEEDBACK & TOUCH INVENTORY: Contracts, ARIA & VM behavior', async () => {
  const vm = require('node:vm');
  const dash = require('../src/http/views/dashboard');

  const requiredBodySnippets = [
    'id="globalActionLiveRegion"',
    'id="homeSyncStatusPill"',
    'id="btnHomeRefreshNow"',
    'id="fleetActionBanner"',
    'id="fleetAttentionBar"',
    'role="toolbar"',
    'id="detailSyncStatusPill"',
    'id="btnDetailRefreshNow"',
    'id="detailActionBanner"',
    'id="detailLifecycleStepper"',
    'id="detailStatusExplain"',
    'id="detailChatFilterBar"',
    'id="detailEventFilterBar"',
    'id="detailChatScrollBtn"',
    'id="detailEventScrollBtn"',
    'id="detailInventoryInteractHint"',
    'id="detailSettingsSyncBadge"',
    'id="detailAccountSyncBadge"',
    'id="detailAutoChatSyncBadge"',
    'id="detailBotScheduleSyncBadge"'
  ];
  for (const snippet of requiredBodySnippets) {
    assert.ok(dash.BODY.includes(snippet), `DASHBOARD BODY must include ${snippet}`);
  }

  // Modern Web Guidance checks: spinner reduced-motion slowdown, toolbar [aria-pressed="true"], non-disabling copy feedback
  assert.match(dash.STYLES, /progress\.loading-spinner/, 'Dashboard CSS must style progress.loading-spinner');
  assert.match(dash.STYLES, /\.fleet-toolbar\[role="toolbar"\]\s+button\[aria-pressed="true"\]/, 'Toolbar toggled style must bind to [aria-pressed="true"]');
  assert.match(dash.STYLES, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*progress\.loading-spinner[\s\S]*animation-duration:/, 'Spinner must slow down under prefers-reduced-motion: reduce');
  assert.ok(dash.SCRIPTS.includes("setAttribute('data-copied', 'true')"), 'copyToClipboard must expose data-copied visual state without disabling button');

  function makeMockEl(id = '') {
    const classSet = new Set();
    const attrs = {};
    return {
      id,
      tagName: 'DIV',
      value: '',
      textContent: '',
      _innerHTML: '',
      get innerHTML() { return this._innerHTML; },
      set innerHTML(v) { this._innerHTML = String(v ?? ''); },
      get className() { return [...classSet].join(' '); },
      set className(v) {
        classSet.clear();
        String(v || '').split(/\s+/).filter(Boolean).forEach((n) => classSet.add(n));
      },
      checked: false,
      disabled: false,
      style: {},
      dataset: {},
      children: [],
      scrollHeight: 200,
      scrollTop: 200,
      clientHeight: 200,
      setAttribute(k, v) { attrs[k] = String(v); },
      getAttribute(k) { return attrs[k] ?? null; },
      removeAttribute(k) { delete attrs[k]; },
      hasAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k); },
      addEventListener() {},
      focus() {},
      scrollIntoView() {},
      remove() {},
      appendChild(child) { this.children.push(child); return child; },
      prepend(child) { this.children.unshift(child); return child; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      getBoundingClientRect() { return { top: 0, bottom: 100 }; },
      classList: {
        add(...names) { names.forEach((n) => n && classSet.add(n)); },
        remove(...names) { names.forEach((n) => classSet.delete(n)); },
        toggle(n, force) {
          const next = force === undefined ? !classSet.has(n) : Boolean(force);
          if (next) classSet.add(n); else classSet.delete(n);
          return next;
        },
        contains(n) { return classSet.has(n); }
      }
    };
  }

  const elements = new Map();
  const getEl = (id) => {
    if (!elements.has(id)) elements.set(id, makeMockEl(id));
    return elements.get(id);
  };
  const postedRequests = [];

  const sandbox = {
    URL,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    JSON,
    Promise,
    Error,
    RegExp,
    parseInt,
    setTimeout,
    clearTimeout,
    setInterval: () => ({ unref() {} }),
    clearInterval: () => {},
    console,
    navigator: { onLine: true, clipboard: { writeText: async () => {} } },
    window: { addEventListener() {}, location: { href: 'http://localhost:3000/' }, matchMedia: () => ({ matches: false }) },
    document: {
      hidden: false,
      activeElement: null,
      getElementById: (id) => getEl(id),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      createElement: () => makeMockEl('')
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  };
  sandbox.window.document = sandbox.document;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  for (const scriptName of ['01-core-and-cards.js', '04-fleet-and-admin-modals.js', '05-detail-gui-and-logs.js', '06-detail-inventory-sched.js']) {
    const code = fs.readFileSync(path.join(__dirname, '../src/http/views/dashboard/scripts', scriptName), 'utf8');
    vm.runInContext(code, sandbox);
  }

  // 1. Operational stage & Bot Card enhancements
  vm.runInContext(`currentUser = { role: 'user', username: 'khach01' };`, sandbox);
  const setupStage = sandbox.describeBotOperationalStage({
    id: 'w1', workerId: 'w1', available: true, manuallyStopped: true, status: 'stopped', username: 'Chưa đặt'
  });
  assert.strictEqual(setupStage.needsAccountSetup, true);
  assert.strictEqual(setupStage.tone, 'idle');
  assert.ok(setupStage.headlineVi.includes('Chưa cài tài khoản'));

  const onlineStage = sandbox.describeBotOperationalStage({
    id: 'w1', workerId: 'w1', available: true, manuallyStopped: false, status: 'afk', online: true, username: 'BotVN01', locationState: 'game'
  });
  assert.strictEqual(onlineStage.stageIndex, 4);
  assert.strictEqual(onlineStage.tone, 'ok');
  assert.ok(onlineStage.headlineVi.includes('Đang treo AFK ổn định'));

  const userErrorStage = sandbox.describeBotOperationalStage({
    id: 'w1', workerId: 'w1', available: true, manuallyStopped: false, status: 'error', username: 'BotVN01',
    lastError: 'Minecraft connection error (ECONNREFUSED)'
  });
  assert.ok(!userErrorStage.headlineVi.includes('ECONNREFUSED'), 'Regular user stage summary must not leak raw ECONNREFUSED');

  sandbox.setBotActionFeedback('w1', { busy: true, tone: 'info', title: 'Đang gửi lệnh chạy...' });
  const cardHtml = sandbox.botCardHtml({
    id: 'w1', workerId: 'w1', botNumber: 1, label: 'FarmBot', status: 'stopped', available: true, manuallyStopped: true,
    username: 'Chưa đặt', food: 18, health: 20, totemCount: 2, settings: { ecoMode: true, autoTotem: true }
  });
  assert.ok(cardHtml.includes('bot-card-stage-bar'));
  assert.ok(cardHtml.includes('bot-setup-cta-btn'));
  assert.ok(cardHtml.includes('bot-action-live-strip'));
  assert.ok(cardHtml.includes('<progress class="loading-spinner"'));
  assert.ok(cardHtml.includes('Độ no: 18 / 20'));
  assert.ok(cardHtml.includes('bot-protection-row'));

  // 2. Detail Lifecycle Stepper & Live Session Trail
  vm.runInContext(`
    detailBot = {
      id: 'w1', workerId: 'w1', botNumber: 1, label: 'FarmBot',
      status: 'afk', online: true, available: true, username: 'BotVN01',
      server: 'kingmc.vn', position: { x: 100.4, y: 64, z: -200.2 }, locationState: 'game',
      settings: { ecoMode: true, autoTotem: true, antiHungry: true, autoReconnect: true, antiAfkKick: true }
    };
    detailStatusHtml();
  `, sandbox);
  assert.ok(getEl('detailLifecycleStepper').innerHTML.includes('Treo AFK'));
  assert.ok(getEl('detailStatusExplain').innerHTML.includes('Đang treo AFK ổn định'));
  assert.ok(getEl('detailPositionHistory').innerHTML.includes('Auto-Totem'));
  assert.ok(getEl('detailPositionHistory').innerHTML.includes('100, 64, -200'));

  // 3. Click/Tap Inventory -> Move / Equip / Drop workflow
  sandbox.requestJson = async (url, opts) => {
    postedRequests.push({ url, body: JSON.parse(opts.body || '{}') });
    return { ok: true, status: 200, data: { ok: true, message: 'OK', inventory: sandbox.detailInventory } };
  };
  vm.runInContext(`
    detailBot = { id: 'w1', workerId: 'w1', status: 'online', available: true, manuallyStopped: false };
    detailInventory = {
      revision: 3,
      health: 20, food: 20, totemCount: 1, goldenAppleCount: 0, foodCount: 5, selectedHotbar: 0,
      armor: {},
      slots: { '9': { slot: 9, name: 'totem_of_undying', count: 1 }, '10': { slot: 10, name: 'apple', count: 5 } }
    };
    selectedBotId = 'w1';
  `, sandbox);
  sandbox.handleDetailSlotClick(9, { slot: 9, name: 'totem_of_undying', count: 1 });
  assert.ok(getEl('detailInventoryInteractHint').innerHTML.includes('totem of undying'));
  await sandbox.handleDetailEquipmentClick('off-hand');
  assert.strictEqual(postedRequests[0].url, '/api/manager/bot/w1/inventory/equip');
  assert.deepStrictEqual(postedRequests[0].body, { sourceSlot: 9, destination: 'off-hand', revision: 3 });

  sandbox.handleDetailSlotClick(10, { slot: 10, name: 'apple', count: 5 });
  await sandbox.handleDetailDropZoneClick();
  assert.strictEqual(postedRequests[1].url, '/api/manager/bot/w1/inventory/drop');
  assert.deepStrictEqual(postedRequests[1].body, { sourceSlot: 10, revision: 3 });

  // 4. Event Filter & Dirty Save Badge
  vm.runInContext(`
    _rawDetailEventEntries = [
      { timestamp: '2026-11-26T10:00:00Z', type: 'kicked', message: 'Mất kết nối server' },
      { timestamp: '2026-11-26T10:01:00Z', type: 'online', message: 'Đã vào AFK thành công' }
    ];
    setDetailEventFilter('error', '');
  `, sandbox);
  assert.strictEqual(getEl('detailEventCount').textContent, '1/2 sự kiện');
  assert.ok(getEl('detailEventLogs').innerHTML.includes('Mất kết nối'));
  assert.ok(!getEl('detailEventLogs').innerHTML.includes('vào AFK thành công'));

  sandbox.markDetailSettingsDirty();
  assert.ok(getEl('detailSettingsSyncBadge').classList.contains('is-dirty'));
  assert.ok(getEl('detailSettingsSyncBadge').textContent.toLowerCase().includes('chưa lưu'));

  // 5. Copy button sets data-copied without disabling control
  const copyBtn = makeMockEl('copyBtnTest');
  await sandbox.copyToClipboard('1.2.3.4', 'IP', copyBtn);
  assert.strictEqual(copyBtn.getAttribute('data-copied'), 'true');
  assert.strictEqual(copyBtn.disabled, false);

  // 6. Log deduplication/grouping, Chat classification (player vs outgoing vs server), & readable telemetry labels
  vm.runInContext(`
    detailBot = {
      id: 'w1', workerId: 'w1', botNumber: 1, label: 'FarmBot',
      provider: 'wispbyte', status: 'afk', online: true, available: true,
      username: 'BotVN01', locationState: 'other', dimension: 'overworld',
      lastSeen: new Date().toISOString(),
      hostHardware: { ramUsedMb: 180, ramTotalMb: 400, ramPercent: 45, cpuPercent: 12.5, cpuCores: 1, netDownKb: 4.2, netUpKb: 1.1 },
      settings: { ecoMode: true, autoTotem: true }
    };
    detailStatusHtml();
    detailInventory = { revision: 4, health: 20, food: 20, totemCount: 1, goldenAppleCount: 0, foodCount: 5, selectedHotbar: 0, armor: {}, slots: {} };
    renderDetailInventory();
  `, sandbox);
  assert.strictEqual(getEl('detailPlatformPill').textContent, 'WISPBYTE');
  assert.strictEqual(getEl('detailDimension').textContent, 'Khu sinh tồn / AFK');
  assert.strictEqual(getEl('detailHostNet').textContent, '↓ 4.2 KB/s • ↑ 1.1 KB/s');
  assert.ok(!getEl('detailHostNet').textContent.includes('0.0 MB'));
  assert.ok(getEl('detailInventoryRevision').textContent.includes('Đồng bộ túi đồ #4'));

  vm.runInContext(`
    _rawDetailEventEntries = [
      { occurredAt: '2026-11-26T10:00:00Z', type: 'connection_error', message: 'Minecraft connection error (ECONNRESET)' },
      { occurredAt: '2026-11-26T10:00:10Z', type: 'connection_error', message: 'Minecraft connection error (ECONNRESET)' },
      { occurredAt: '2026-11-26T10:01:00Z', type: 'window_open', message: '' }
    ];
    setDetailEventFilter('all', '');
  `, sandbox);
  assert.ok(getEl('detailEventLogs').innerHTML.includes('log-repeat-badge') && getEl('detailEventLogs').innerHTML.includes('×2'));
  assert.ok(getEl('detailEventLogs').innerHTML.includes('Mở cửa sổ menu trong game'));
  assert.strictEqual(getEl('detailEventCount').textContent, '2 dòng (3 lần)');

  vm.runInContext(`
    _rawDetailChatEntries = [
      { occurredAt: '2026-11-26T10:00:00Z', type: 'chat', source: 'spawn_command', message: '[BotVN01] /spawn' },
      { occurredAt: '2026-11-26T10:00:05Z', type: 'chat', message: '[SteveVN] xin chao moi nguoi' },
      { occurredAt: '2026-11-26T10:00:10Z', type: 'chat', message: '[KingMC] Chào mừng trở lại!' }
    ];
    setDetailChatFilter('outgoing', '');
  `, sandbox);
  assert.strictEqual(getEl('detailChatCount').textContent, '1/3 tin');
  assert.ok(getEl('detailChatLogs').innerHTML.includes('BOT →') && getEl('detailChatLogs').innerHTML.includes('/spawn'));

  vm.runInContext(`setDetailChatFilter('player', '');`, sandbox);
  assert.strictEqual(getEl('detailChatCount').textContent, '1/3 tin');
  assert.ok(getEl('detailChatLogs').innerHTML.includes('SteveVN:'));

  vm.runInContext(`setDetailChatFilter('server', '');`, sandbox);
  assert.strictEqual(getEl('detailChatCount').textContent, '1/3 tin');
  assert.ok(getEl('detailChatLogs').innerHTML.includes('KINGMC') && getEl('detailChatLogs').innerHTML.includes('Chào mừng'));
});

test('REGISTRY & DISCORD LOGS: Humanizes empty events, coalesces noisy repeats, and renders Vietnamese Discord tags', async () => {
  const crypto = require('node:crypto');
  const { WorkerRegistry } = require('../src/services/worker-registry');
  const { renderBotLogs } = require('../src/discord/panels/renderer');

  let dbAddEventCount = 0;
  const storedWorker = {
    workerId: '24',
    botNumber: 24,
    name: 'KingMC Bot 24',
    enabled: true,
    provider: 'wispbyte',
    settings: {},
    status: { state: 'online', online: true },
    events: []
  };
  const registry = new WorkerRegistry({
    store: {
      get: async () => storedWorker,
      update: async (_id, patch) => ({ ...storedWorker, ...patch }),
      addEvent: async (_id, ev) => {
        dbAddEventCount += 1;
        storedWorker.events.push(ev);
      }
    },
    accessStore: null,
    encryptionKey: crypto.randomBytes(32)
  });

  const openEv = await registry.addEvent('24', { type: 'window_open', title: 'KingSMP Menu' });
  assert.ok(openEv.message.includes('Mở cửa sổ menu trong game: KingSMP Menu'));

  const stopEv = await registry.addEvent('24', { type: 'stopped', reason: 'manager_stop' });
  assert.ok(stopEv.message.includes('Đã dừng bot theo lệnh điều khiển'));

  const dbWritesBefore = dbAddEventCount;
  const t1 = new Date('2026-11-26T10:05:00Z');
  const t2 = new Date('2026-11-26T10:05:12Z');
  const err1 = await registry.addEvent('24', { type: 'connection_error', message: 'Minecraft connection error (ECONNRESET)', occurredAt: t1 });
  const err2 = await registry.addEvent('24', { type: 'connection_error', message: 'Minecraft connection error (ECONNRESET)', occurredAt: t2 });
  assert.strictEqual(dbAddEventCount - dbWritesBefore, 1, 'Duplicate connection_error within 45s must coalesce DB writes');
  assert.ok(err1.message.includes('Tạm mất kết nối'));
  assert.strictEqual(err2.repeatCount, 2);

  const discordLogsView = renderBotLogs({
    user: { role: 'admin' },
    worker: { workerId: '24', botNumber: 24, name: 'Bot 24', status: { state: 'online', online: true } },
    logs: [
      { type: 'window_open', message: '', title: 'KingSMP Menu', occurredAt: t1 },
      ...registry.getLogs('24')
    ]
  });
  const desc = discordLogsView.embeds[0].data.description;
  assert.ok(desc.includes('[MỞ MENU]'));
  assert.ok(desc.includes('[MẤT KẾT NỐI]') && desc.includes('(×2)'));
  assert.ok(!desc.includes('{"type"'), 'Discord logs must never dump raw JSON strings');
});

test('IN-WEB KEY REDEMPTION: requires active Discord link for keys, exempts Link4M, rejects pre-auth register/login keys', async () => {
  const http = require('node:http');
  const crypto = require('node:crypto');
  const { createApp } = require('../src/http/app');
  const { HTML: DASHBOARD_HTML } = require('../src/http/views/dashboard-html');
  const { PUBLIC_LOGIN_HTML } = require('../src/http/views/login-html');
  const { EntitlementService } = require('../src/services/entitlement-service');

  // UI guards
  assert.strictEqual(PUBLIC_LOGIN_HTML.includes('regLicenseKey'), false, 'Public login/register must not contain regLicenseKey');
  assert.strictEqual(DASHBOARD_HTML.includes('regLicenseKey'), false, 'Dashboard register must not contain regLicenseKey');
  assert.strictEqual(DASHBOARD_HTML.includes('loginLicenseKey'), false, 'Dashboard login must not contain loginLicenseKey');
  assert.ok(DASHBOARD_HTML.includes('id="sidebarRedeemKeyBtn"'), 'Sidebar redeem key button must exist inside web');
  assert.ok(DASHBOARD_HTML.includes('id="renewDiscordGateBox"'), 'Renew modal must show Discord link gate');
  assert.ok(DASHBOARD_HTML.includes('id="expiredDiscordGateBox"'), 'Expired overlay must show Discord link gate');
  assert.ok(/id="discordLinkModal"[^>]*z-index:1600/.test(DASHBOARD_HTML), 'discordLinkModal must stack above accountExpiredOverlay');

  const users = new Map();
  const discordLinks = new Map();
  const keysByLookup = new Map();

  const store = {
    async getSetting(k) {
      if (k === 'system_settings') return { trialGiftEnabled: false, trialDays: 1 };
      return null;
    },
    async setSetting() {},
    async addAudit() {},
    invalidateUserCache() {},
    invalidateCache() {},
    async getUser(username) {
      const clean = String(username || '').trim().toLowerCase();
      for (const u of users.values()) {
        if (String(u.username || '').toLowerCase() === clean) return { ...u };
      }
      return null;
    },
    async listAccess() {
      return Array.from(users.values()).map((u) => ({ ...u }));
    },
    async getAccess(id) {
      const u = users.get(String(id));
      return u ? { ...u } : null;
    },
    async setAccess(id, patch) {
      const prev = users.get(String(id)) || { id: String(id), userId: String(id) };
      const next = { ...prev, ...patch, id: String(id), userId: String(id) };
      users.set(String(id), next);
      return { ...next };
    },
    async createKey(rec) {
      keysByLookup.set(rec.codeHash, rec);
      keysByLookup.set(rec.code, rec);
      return { ...rec };
    },
    async getKey(codeOrHash) {
      const raw = String(codeOrHash || '').trim();
      const rec = keysByLookup.get(raw) || keysByLookup.get(raw.replace(/[^A-Z0-9]/gi, '').toUpperCase()) || null;
      return rec ? { ...rec } : null;
    },
    async redeemKeyWithAccess(codeHash, cleanUserId, accessValues) {
      const rec = keysByLookup.get(String(codeHash || '').trim());
      if (!rec) return false;
      if (rec.maxUses > 0 && (rec.usedCount || 0) >= rec.maxUses) return false;
      rec.usedCount = (rec.usedCount || 0) + 1;
      rec.usedUsers = [...(rec.usedUsers || []), cleanUserId];
      rec.status = (rec.maxUses > 0 && rec.usedCount >= rec.maxUses) ? 'used' : 'active';
      await store.setAccess(cleanUserId, accessValues);
      return true;
    },
    async linkDiscord(managerId, discordUserId) {
      const u = users.get(String(managerId));
      const rec = {
        manager_user_id: String(managerId),
        discord_user_id: String(discordUserId),
        username: u?.username || '',
        linked_at: new Date().toISOString(),
        status: 'active'
      };
      discordLinks.set(String(managerId), rec);
      if (u) discordLinks.set(String(u.username || ''), rec);
      return rec;
    },
    async getDiscordLink(identifier) {
      return discordLinks.get(String(identifier || '').trim()) || null;
    },
    async unlinkDiscord(identifier) {
      const existing = discordLinks.get(String(identifier || '').trim());
      discordLinks.delete(String(identifier || '').trim());
      if (existing?.username) discordLinks.delete(existing.username);
      if (existing?.manager_user_id) discordLinks.delete(existing.manager_user_id);
      return true;
    }
  };

  const encryptionKey = crypto.randomBytes(32);
  const registry = {
    store,
    encryptionKey,
    list: async () => [{ workerId: 'bot-1', botNumber: 1, enabled: true, rentable: true }],
    find: async () => null,
    getAdminPassword: () => null,
    verifyBotSecretSync: () => false
  };
  const accessControl = new AccessControl({ store });
  const entitlementService = new EntitlementService({ store, registry, accessControl });
  const key1 = await entitlementService.createCode({ days: 7, botCount: 1, customCode: 'KMLINKREQ001', actorId: 'admin' });
  const key2 = await entitlementService.createCode({ days: 7, botCount: 1, customCode: 'KMLINKREQ002', actorId: 'admin' });

  const link4mService = new Link4mService({
    store: {
      ...store,
      getSetting: async (k) => (k === 'link4m_runtime' ? { enabled: true, rewardHours: 12, dailyLimit: 2 } : store.getSetting(k)),
      countLinkRewards: async () => 0,
      lastLinkReward: async () => null,
      getLatestLinkAttempt: async () => null,
      findActiveLinkAttempt: async () => null,
      expireLinkAttempts: async () => {},
      createLinkAttempt: async () => {},
      setLinkAttemptProviderUrl: async () => true
    },
    accessControl,
    config: { enabled: true, link4mApiToken: 'mock-token', publicBaseUrl: 'https://mgr.example.test' },
    fetchImpl: async () => ({ ok: true, text: async () => JSON.stringify({ shortenedUrl: 'https://link4m.co/ok' }) })
  });
  await link4mService.initialize();

  const app = createApp({
    store,
    entitlementService,
    link4mService,
    registry,
    broker: {},
    config: { adminUsername: 'admin', adminPassword: 'admin-password', trialGiftEnabled: false },
    logger: { info() {}, warn() {}, error() {}, debug() {} }
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    // 1. Registering with key is blocked (400 REDEEM_IN_WEB_ONLY)
    const regWithKey = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'weblink_u1', password: 'Password123!', confirmPassword: 'Password123!', key: key1.code })
    });
    assert.strictEqual(regWithKey.status, 400);
    assert.strictEqual((await regWithKey.json()).code, 'REDEEM_IN_WEB_ONLY');

    // 2. Register cleanly without key
    const regOk = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'weblink_u1', password: 'Password123!', confirmPassword: 'Password123!' })
    });
    assert.strictEqual(regOk.status, 201);
    const regJson = await regOk.json();
    const token = regJson.token;
    const userId = regJson.user.id;
    const headers = { 'content-type': 'application/json', Authorization: `Bearer ${token}` };

    // 3. Logging in with key is also blocked (400 REDEEM_IN_WEB_ONLY)
    const loginWithKey = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'weblink_u1', password: 'Password123!', key: key1.code })
    });
    assert.strictEqual(loginWithKey.status, 400);
    assert.strictEqual((await loginWithKey.json()).code, 'REDEEM_IN_WEB_ONLY');

    // 4. Unlinked user CANNOT redeem key inside web (/renew or /rental/redeem-key) -> 403 DISCORD_LINK_REQUIRED
    for (const ep of ['/api/manager/renew', '/api/rental/redeem-key']) {
      const r = await fetch(`${baseUrl}${ep}`, { method: 'POST', headers, body: JSON.stringify({ key: key1.code }) });
      assert.strictEqual(r.status, 403, `${ep} must reject unlinked user with 403`);
      const body = await r.json();
      assert.strictEqual(body.code, 'DISCORD_LINK_REQUIRED');
      assert.strictEqual(body.requiresDiscordLink, true);
    }
    assert.strictEqual(keysByLookup.get(key1.code).usedCount, 0, 'Key must remain unconsumed after DISCORD_LINK_REQUIRED rejection');

    // 5. Link4M DOES NOT require Discord link!
    const l4mStatus = await fetch(`${baseUrl}/api/rewards/link4m/status`, { headers: { Authorization: `Bearer ${token}` } });
    assert.strictEqual(l4mStatus.status, 200, 'Link4M status must succeed without Discord link');
    const l4mStart = await fetch(`${baseUrl}/api/rewards/link4m/start`, { method: 'POST', headers });
    assert.strictEqual(l4mStart.status, 200, 'Link4M start must succeed without Discord link');
    const l4mJson = await l4mStart.json();
    assert.strictEqual(l4mJson.providerUrl || l4mJson.redirectUrl, 'https://link4m.co/ok');

    // 6. After linking Discord, key redemption succeeds (200 OK)
    await store.linkDiscord(userId, '888777666555444333');
    const linkedRedeem = await fetch(`${baseUrl}/api/manager/renew`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ key: key1.code })
    });
    assert.strictEqual(linkedRedeem.status, 200, 'Linked user must redeem key successfully');
    assert.strictEqual(keysByLookup.get(key1.code).usedCount, 1);

    // 7. After unlinking Discord, redeeming another key immediately fails with 403 DISCORD_LINK_REQUIRED
    const unlinkRes = await fetch(`${baseUrl}/api/user/discord-unlink`, { method: 'POST', headers });
    assert.strictEqual(unlinkRes.status, 200);
    const afterUnlinkRedeem = await fetch(`${baseUrl}/api/manager/renew`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ key: key2.code })
    });
    assert.strictEqual(afterUnlinkRedeem.status, 403, 'Redeem after /discord-unlink must immediately require Discord link again');
    assert.strictEqual(keysByLookup.get(key2.code).usedCount, 0);
  } finally {
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});
