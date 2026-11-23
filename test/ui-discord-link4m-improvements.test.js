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
