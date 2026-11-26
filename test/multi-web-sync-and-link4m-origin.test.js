'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');

const { DEFAULT_PUBLIC_MANAGER_URL, resolveRequestOrigin } = require('../src/config/host-runtime');
const { ManagerRuntimeSettings } = require('../src/services/manager-runtime-settings');
const { Link4mService } = require('../src/services/link4m-service');
const { DiscordPointsService } = require('../src/services/discord-points-service');
const { safeDeferReply } = require('../src/discord/handlers/interaction-handler');
const SupabaseWorkerStore = require('../src/storage/supabase-worker-store');
const SupabaseCommandStore = require('../src/storage/supabase-command-store');
const { WorkerRegistry } = require('../src/services/worker-registry');
const CommandBroker = require('../src/services/command-broker');
const { AdminNotifier } = require('../src/services/admin-notifier');
const WispbyteKeepAliveManager = require('../src/services/wispbyte-keepalive');
const { createApp } = require('../src/http/app');
const { createAuthApi } = require('../src/http/routes/auth-api');
const { encryptSecret, hashAdminPasswordAsync } = require('../src/utils/secrets');

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {}
};

function createSharedMockBackend() {
  const settings = new Map();
  const attempts = new Map();
  const workers = new Map();
  const chatLogs = [];
  const users = new Map();

  const wrapQuery = (tableName) => {
    const state = {
      op: 'select',
      filters: [],
      payload: null,
      orderCols: [],
      limitVal: null
    };
    const matchRow = (row) => state.filters.every(([k, v]) => String(row?.[k] ?? '') === String(v ?? ''));
    const execute = async () => {
      if (tableName === 'manager_workers') {
        if (state.op === 'insert') {
          const r = { ...state.payload };
          workers.set(r.worker_id, r);
          return { data: [r], error: null };
        }
        if (state.op === 'update') {
          let updated = null;
          for (const [k, row] of workers.entries()) {
            if (matchRow(row)) {
              updated = { ...row, ...state.payload };
              workers.set(k, updated);
            }
          }
          return { data: updated ? [updated] : [], error: null };
        }
        if (state.op === 'delete') {
          const removed = [];
          for (const [k, row] of workers.entries()) {
            if (matchRow(row)) {
              removed.push(row);
              workers.delete(k);
            }
          }
          return { data: removed, error: null };
        }
        let rows = [...workers.values()].filter(matchRow);
        if (state.orderCols.length) {
          rows.sort((a, b) => Number(a.bot_number || 0) - Number(b.bot_number || 0));
        }
        if (state.limitVal) rows = rows.slice(0, state.limitVal);
        return { data: rows, error: null };
      }
      if (tableName === 'bot_chat_logs') {
        if (state.op === 'insert') {
          chatLogs.push({ ...state.payload });
          return { data: [{ ...state.payload }], error: null };
        }
        if (state.op === 'delete') {
          for (let i = chatLogs.length - 1; i >= 0; i -= 1) {
            if (matchRow(chatLogs[i])) chatLogs.splice(i, 1);
          }
          return { data: [], error: null };
        }
        let rows = chatLogs.filter(matchRow);
        if (state.orderCols.length) {
          const { col, ascending } = state.orderCols[0];
          rows = rows.slice().sort((a, b) => {
            const ta = Date.parse(a[col] || 0);
            const tb = Date.parse(b[col] || 0);
            return ascending ? ta - tb : tb - ta;
          });
        }
        if (state.limitVal) rows = rows.slice(0, state.limitVal);
        return { data: rows, error: null };
      }
      return { data: [], error: null };
    };
    const chain = {
      select: () => {
        if (state.op === 'select') state.op = 'select';
        return chain;
      },
      insert: (row) => {
        state.op = 'insert';
        state.payload = row;
        return chain;
      },
      update: (patch) => {
        state.op = 'update';
        state.payload = patch;
        return chain;
      },
      delete: () => {
        state.op = 'delete';
        return chain;
      },
      eq: (col, val) => {
        state.filters.push([col, val]);
        return chain;
      },
      order: (col, opts = {}) => {
        state.orderCols.push({ col, ascending: opts.ascending !== false });
        return chain;
      },
      limit: (n) => {
        state.limitVal = n;
        return chain;
      },
      maybeSingle: async () => {
        const res = await execute();
        return { data: res.data?.[0] || null, error: res.error };
      },
      then: (resolve, reject) => execute().then(resolve, reject)
    };
    return chain;
  };

  const supabaseClient = {
    adapter: null,
    from: (tableName) => wrapQuery(tableName),
    rpc: async (fnName) => {
      if (fnName === 'manager_next_bot_number') {
        const nums = [...workers.values()].map((w) => Number(w.bot_number || 0)).filter(Boolean);
        return { data: (nums.length ? Math.max(...nums) : 0) + 1, error: null };
      }
      return { data: null, error: { code: '42883', message: 'function does not exist' } };
    }
  };

  const dashboardStore = {
    adapter: { testConnection: async () => ({ ok: true }) },
    cachedAnnouncement: null,
    cachedAnnouncementAt: 0,
    async getSetting(key) {
      return settings.has(key) ? structuredClone(settings.get(key)) : null;
    },
    async setSetting(key, value) {
      settings.set(key, structuredClone(value));
      return value;
    },
    async getUser(idOrName) {
      return users.get(String(idOrName).toLowerCase()) || null;
    },
    async getUserById(id) {
      return users.get(String(id).toLowerCase()) || null;
    },
    async listUsers() {
      return [...users.values()];
    },
    async assignedUser() {
      return null;
    },
    async addAudit() {
      return true;
    },
    async countLinkRewards() {
      return 0;
    },
    async lastLinkReward() {
      return null;
    },
    async findActiveLinkAttempt(userId, now = new Date()) {
      for (const att of attempts.values()) {
        if (att.userId === userId && att.status === 'pending' && att.providerUrl && new Date(att.expiresAt) > now) {
          return { ...att };
        }
      }
      return null;
    },
    async getLatestLinkAttempt(userId) {
      const list = [...attempts.values()].filter((a) => a.userId === userId);
      return list[list.length - 1] || null;
    },
    async expireLinkAttempt(attemptId) {
      const att = attempts.get(attemptId);
      if (att) att.status = 'expired';
    },
    async expireLinkAttempts(userId) {
      for (const att of attempts.values()) {
        if (att.userId === userId && att.status === 'pending') att.status = 'expired';
      }
    },
    async createLinkAttempt(record) {
      attempts.set(record.attemptId, { ...record });
    },
    async setLinkAttemptProviderUrl(attemptId, providerUrl) {
      const att = attempts.get(attemptId);
      if (!att || att.status !== 'pending') return false;
      att.providerUrl = providerUrl;
      return true;
    },
    async getLinkAttempt(attemptId) {
      return attempts.get(attemptId) || null;
    },
    async getLinkAttemptByTokenHash(hash) {
      for (const att of attempts.values()) {
        if (att.tokenHash === hash) return att;
      }
      return null;
    },
    async claimLinkAttempt(attemptId, tokenHash) {
      const att = attempts.get(attemptId);
      if (!att || att.tokenHash !== tokenHash || att.status !== 'pending') return false;
      att.status = 'processing';
      return true;
    },
    async finalizeLinkAttempt(attemptId) {
      const att = attempts.get(attemptId);
      if (att) {
        att.status = 'rewarded';
        att.rewardedAt = new Date().toISOString();
      }
    },
    async addRentalHours(userId, hours) {
      const u = users.get(String(userId).toLowerCase());
      if (u) {
        const exp = new Date(Date.now() + Number(hours || 12) * 3600000).toISOString();
        u.expiresAt = exp;
        return { userId, addedHours: hours, expiresAt: exp };
      }
      return null;
    },
    async extendRentalHours(userId, hours) {
      return this.addRentalHours(userId, hours);
    }
  };

  return { settings, attempts, workers, chatLogs, users, supabaseClient, dashboardStore };
}

test('Link4M dynamic origin return across 2 Render webs + https://kbotmanager.onrender.com fallback', async () => {
  const { users, dashboardStore } = createSharedMockBackend();
  users.set('usr_alice', {
    id: 'usr_alice',
    userId: 'usr_alice',
    username: 'alice',
    role: 'user',
    status: 'active',
    isPermanent: false,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    assignedBotIds: ['01']
  });

  // 1. resolveRequestOrigin extracts proxy HTTPS host or defaults to DEFAULT_PUBLIC_MANAGER_URL
  assert.strictEqual(DEFAULT_PUBLIC_MANAGER_URL, 'https://kbotmanager.onrender.com');
  assert.strictEqual(
    resolveRequestOrigin({ headers: { 'x-forwarded-host': 'kbotmanager-2.onrender.com', 'x-forwarded-proto': 'https' } }),
    'https://kbotmanager-2.onrender.com'
  );
  assert.strictEqual(resolveRequestOrigin({}, ''), 'https://kbotmanager.onrender.com');

  const accessControl = {
    memberFor: async (id) => users.get(String(id).toLowerCase()) || null,
    isEntitled: () => true
  };
  const capturedReturnUrls = [];
  const l4mFetch = async (urlObj) => {
    const targetReturn = new URL(String(urlObj)).searchParams.get('url');
    capturedReturnUrls.push(targetReturn);
    const parsedTarget = new URL(targetReturn);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        status: 'success',
        shortenedUrl: `https://link4m.co/short/${parsedTarget.hostname.split('.')[0]}`
      })
    };
  };

  const l4mService = new Link4mService({
    store: dashboardStore,
    accessControl,
    config: {
      enabled: true,
      link4mApiToken: 'l4m_api_tok_123',
      publicBaseUrl: '', // intentionally unset!
      dailyLimit: 3,
      rewardHours: 12
    },
    logger: silentLogger,
    fetchImpl: l4mFetch
  });
  await l4mService.initialize();

  // Status falls back to https://kbotmanager.onrender.com when no env URL set
  const defaultPub = l4mService.publicConfig();
  assert.strictEqual(defaultPub.callbackConfigured, true);
  assert.strictEqual(defaultPub.callbackBaseUrl, 'https://kbotmanager.onrender.com');

  // Start on Web #1
  const attemptWeb1 = await l4mService.startAttempt('usr_alice', '1.2.3.4', {
    returnOrigin: 'https://kbotmanager.onrender.com'
  });
  assert.strictEqual(attemptWeb1.callbackBaseUrl, 'https://kbotmanager.onrender.com');
  assert.ok(capturedReturnUrls[0].startsWith('https://kbotmanager.onrender.com/api/rewards/link4m/return?'));

  // User switches to Web #2 before completing Web #1 -> MUST NOT reuse Web #1 short link!
  const attemptWeb2 = await l4mService.startAttempt('usr_alice', '1.2.3.4', {
    returnOrigin: 'https://kbotmanager-2.onrender.com'
  });
  assert.strictEqual(attemptWeb2.reused, false, 'Switching origins must expire old attempt instead of returning wrong origin link');
  assert.strictEqual(attemptWeb2.callbackBaseUrl, 'https://kbotmanager-2.onrender.com');
  assert.ok(capturedReturnUrls[1].startsWith('https://kbotmanager-2.onrender.com/api/rewards/link4m/return?'));

  // Clicking again on SAME Web #2 DOES reuse active Web #2 attempt
  const attemptWeb2Reuse = await l4mService.startAttempt('usr_alice', '1.2.3.4', {
    returnOrigin: 'https://kbotmanager-2.onrender.com'
  });
  assert.strictEqual(attemptWeb2Reuse.reused, true);
  assert.strictEqual(attemptWeb2Reuse.attemptId, attemptWeb2.attemptId);
});

test('Multi-web Supabase sync: active URLs, Discord points merge, worker logs/clears, admin creds, announcements, and Discord 40060 guard', async () => {
  const { settings, workers, supabaseClient, dashboardStore } = createSharedMockBackend();
  const encKey = crypto.randomBytes(32);

  // 1. Active Manager URL discovery shared via Supabase across two instances
  const rt1 = new ManagerRuntimeSettings({ store: dashboardStore, encryptionKey: encKey, initial: { publicBaseUrl: 'https://kbotmanager.onrender.com' } });
  await rt1.initialize();
  await rt1.recordActiveManagerUrl('https://kbotmanager-2.onrender.com');

  const rt2 = new ManagerRuntimeSettings({ store: dashboardStore, encryptionKey: encKey, initial: {} });
  await rt2.initialize();
  const sharedUrls = rt2.getActiveManagerUrls();
  assert.ok(sharedUrls.includes('https://kbotmanager.onrender.com'));
  assert.ok(sharedUrls.includes('https://kbotmanager-2.onrender.com'));

  // 2. DiscordPointsService cross-instance non-destructive merge
  const pts1 = new DiscordPointsService({ store: dashboardStore, logger: silentLogger });
  const pts2 = new DiscordPointsService({ store: dashboardStore, logger: silentLogger });
  await pts1.initialize();
  await pts2.initialize();

  await pts1.adminAdjustPoints({ guildId: 'g1', userId: 'u1', username: 'user1', mode: 'add', amount: 15 });
  await pts2.adminAdjustPoints({ guildId: 'g1', userId: 'u2', username: 'user2', mode: 'add', amount: 25 });

  await pts1._refreshIfStale({ force: true });
  const u1Prof = await pts1.getProfile({ guildId: 'g1', userId: 'u1' });
  const u2Prof = await pts1.getProfile({ guildId: 'g1', userId: 'u2' });
  assert.strictEqual(u1Prof.points, 15, 'User 1 points must remain preserved after Web #2 flush');
  assert.strictEqual(u2Prof.points, 25, 'User 2 points from Web #2 must appear on Web #1');

  // 3. WorkerRegistry + SupabaseWorkerStore cross-web sync for chat logs, events, clears & empty secret_ciphertext
  const store1 = new SupabaseWorkerStore(supabaseClient, { cacheTtlMs: 5000 });
  const store2 = new SupabaseWorkerStore(supabaseClient, { cacheTtlMs: 5000 });
  const reg1 = new WorkerRegistry({ store: store1, accessStore: dashboardStore, encryptionKey: encKey });
  const reg2 = new WorkerRegistry({ store: store2, accessStore: dashboardStore, encryptionKey: encKey });

  const added = await reg1.add({ workerId: 'bot_sync_1', name: 'Sync Bot 1' });
  assert.strictEqual(added.secret, '');
  assert.strictEqual(workers.get('bot_sync_1').secret_ciphertext, '', 'secret_ciphertext must stay empty string, never null');

  await reg1.addEvent('bot_sync_1', { type: 'chat', message: 'Hello across Render webs' });
  await reg1.addEvent('bot_sync_1', { type: 'start', message: 'Connected to kingmc.vn' });

  await reg2.refreshLogsFromStore('bot_sync_1', { kind: 'all', maxAgeMs: 0 });
  const web2Chat = reg2.getChatLogs('bot_sync_1');
  const web2Sys = reg2.getSystemLogs('bot_sync_1');
  assert.strictEqual(web2Chat.length, 1);
  assert.strictEqual(web2Chat[0].message, 'Hello across Render webs');
  assert.strictEqual(web2Sys.length, 1);
  assert.strictEqual(web2Sys[0].message, 'Connected to kingmc.vn');

  await reg1.clearLogs('bot_sync_1', 'chat');
  await reg1.clearLogs('bot_sync_1', 'event');
  await reg2.refreshLogsFromStore('bot_sync_1', { kind: 'all', maxAgeMs: 0 });
  assert.strictEqual(reg2.getChatLogs('bot_sync_1').length, 0);
  assert.strictEqual(reg2.getSystemLogs('bot_sync_1').length, 0);

  // 4. Admin password update synced via Supabase admin_credentials across Web instances
  const newHash = await hashAdminPasswordAsync('NewAdminPass!2026');
  await dashboardStore.setSetting('admin_credentials', { passwordHash: newHash, updatedAt: new Date().toISOString() });

  const app2 = express();
  app2.use(express.json());
  app2.use('/api/auth', createAuthApi({
    store: dashboardStore,
    entitlementService: {},
    registry: reg2, // reg2 does NOT have adminPassword in RAM!
    config: { adminUsername: 'admin', sessionSecret: 'test-session-secret-0123456789abcdef', webSessionTtlHours: 24 },
    logger: silentLogger,
    activeSessions: new Map()
  }));
  const srvAuth = await new Promise((resolve) => {
    const s = app2.listen(0, '127.0.0.1', () => resolve({ s, url: `http://127.0.0.1:${s.address().port}` }));
  });
  try {
    const loginRes = await fetch(`${srvAuth.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'NewAdminPass!2026' })
    });
    assert.strictEqual(loginRes.status, 200, 'Web #2 must authenticate admin password updated via Web #1 in Supabase');
  } finally {
    await new Promise((resolve) => srvAuth.s.close(resolve));
  }

  // 5. System announcement propagates cleanly even when another instance wrote it
  settings.set('system_announcement', { enabled: true, title: 'Sync', content: 'Updated from Web 1', mode: 'banner' });
  const appFull = createApp({
    store: dashboardStore,
    entitlementService: { gracePeriodMs: 6 * 3600000 },
    link4mService: { health: () => ({ ok: true, degraded: false }), getDailyQuotaStatus: async () => ({}), createLinkAttempt: async () => ({}) },
    managerRuntimeSettings: rt2,
    registry: reg2,
    broker: new CommandBroker({
      registry: reg2,
      commandStore: { take: async () => null, complete: async () => true, enqueue: async (c) => c, expire: async () => {} },
      managerRuntimeSettings: rt2,
      config: { workerPollWaitMs: 50, commandResultTimeoutMs: 1000 },
      logger: silentLogger
    }),
    workerStore: store2,
    config: { sessionSecret: 'test-session-secret-0123456789abcdef', discordToken: 'tok', discordEnabled: true },
    discordClient: { isReady: () => false, _standbyMode: true },
    logger: silentLogger
  });

  // Verify standby follower readiness returns HTTP 200 (not 503) so Render healthchecks stay green!
  const srvFull = await new Promise((resolve) => {
    const s = http.createServer(appFull);
    s.listen(0, '127.0.0.1', () => resolve({ s, url: `http://127.0.0.1:${s.address().port}` }));
  });
  try {
    const readyRes = await fetch(`${srvFull.url}/ready`);
    assert.strictEqual(readyRes.status, 200);
    const readyJson = await readyRes.json();
    assert.strictEqual(readyJson.checks.discord.status, 'standby');

    // Unauthenticated request with spoofed X-Forwarded-Host must NOT record attacker URL into active_manager_urls
    await fetch(`${srvFull.url}/health`, {
      headers: {
        'x-forwarded-host': 'evil-spoof.example.com',
        'x-forwarded-proto': 'https'
      }
    });
    assert.ok(
      !rt2.getActiveManagerUrls().includes('https://evil-spoof.example.com'),
      'Unauthenticated /health request must not poison active_manager_urls'
    );

    // Non-worker POST with session cookie + fake bot headers and missing Origin must fail CSRF 403
    const csrfRes = await fetch(`${srvFull.url}/api/user/discord-notify`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'kingmc_mgr_session=dummy_session_token',
        'x-worker-secret': 'spoofed-secret',
        'x-manager-bot-id': 'bot_sync_1'
      },
      body: JSON.stringify({ enabled: false })
    });
    assert.strictEqual(csrfRes.status, 403, 'isBotSecretRequest must never bypass CSRF on non-worker routes');

    // Verify ID-only worker endpoints return managerUrls & x-manager-urls without secret
    const bootRes = await fetch(`${srvFull.url}/api/v1/workers/bot_sync_1/bootstrap`, {
      headers: { 'x-manager-bot-id': 'bot_sync_1' }
    });
    assert.strictEqual(bootRes.status, 200);
    const bootJson = await bootRes.json();
    assert.ok(bootJson.managerUrls.includes('https://kbotmanager-2.onrender.com'));
    assert.ok(bootJson.managerUrls.includes('https://kbotmanager.onrender.com'));
    assert.ok(String(bootRes.headers.get('x-manager-urls') || '').includes('kbotmanager.onrender.com'));
  } finally {
    await new Promise((resolve) => srvFull.s.close(resolve));
  }

  // 5b. WorkerRegistry.authenticate preserves decrypted secret in secretCache when worker has an explicit secret
  await reg1.add({
    workerId: 'bot_with_sec',
    name: 'Bot With Secret',
    secret: 'custom-secret-value-preserved-across-auth-12345'
  });
  await reg1.authenticate('bot_with_sec', '');
  const preservedCred = await reg1.credential('bot_with_sec');
  assert.strictEqual(
    preservedCred,
    'custom-secret-value-preserved-across-auth-12345',
    'WorkerRegistry.authenticate must preserve existing secret in secretCache'
  );

  // 5c. DiscordPointsService cross-instance checkin -> adminAdjustPoints merges non-destructively (10 + 5 = 15)
  await pts1.checkin({ guildId: 'g2', userId: 'u_sync', username: 'syncer' });
  await pts2.adminAdjustPoints({ guildId: 'g2', userId: 'u_sync', username: 'syncer', mode: 'add', amount: 5 });
  const mergedSyncProf = await pts2.getProfile({ guildId: 'g2', userId: 'u_sync' });
  assert.strictEqual(mergedSyncProf.points, 15, 'Web #2 adminAdjustPoints must refresh Web #1 check-in before mutating');

  // 6. Discord code 40060 (already acknowledged during failover) returns false in safeDeferReply
  const dupResult = await safeDeferReply({
    deferred: false,
    replied: false,
    deferReply: async () => {
      const err = new Error('Interaction has already been acknowledged.');
      err.code = 40060;
      throw err;
    }
  });
  assert.strictEqual(dupResult, false, '40060 already acknowledged must return false to prevent duplicate execution');
});

test('Multi-web sync: cross-instance Wispbyte poll wakeup/result, settingsRevision, AdminNotifier & KeepAlive', async () => {
  const keepAlive = setInterval(() => {}, 500);
  try {
    const backend = createSharedMockBackend();
    const { dashboardStore, supabaseClient } = backend;
    const encKey = crypto.randomBytes(32).toString('hex');

    // 1. Cross-web Wispbyte command dispatch (Web #2) -> wakes Worker polling Web #1 -> result returns to Web #2
    const commandsMap = new Map();
    const makeCmdClient = () => ({
      adapter: null,
      rpc: async () => ({ data: null, error: { code: '42883', message: 'function does not exist' } }),
      from: (tableName) => {
        const st = { op: 'select', filters: [], gtFilters: [], inFilters: [], payload: null, limitVal: null };
        const matches = (row) => {
          if (tableName !== 'manager_commands') return false;
          if (!st.filters.every(([k, v]) => String(row?.[k] ?? '') === String(v ?? ''))) return false;
          if (!st.inFilters.every(([k, vals]) => Array.isArray(vals) && vals.map(String).includes(String(row?.[k] ?? '')))) return false;
          if (!st.gtFilters.every(([k, v]) => String(row?.[k] ?? '') > String(v ?? ''))) return false;
          return true;
        };
        const exec = async () => {
          if (tableName !== 'manager_commands') return { data: [], error: null };
          if (st.op === 'insert') {
            const row = { ...st.payload };
            commandsMap.set(row.command_id, row);
            return { data: [row], error: null };
          }
          if (st.op === 'update') {
            let updated = null;
            for (const [cid, row] of commandsMap.entries()) {
              if (matches(row)) {
                updated = { ...row, ...st.payload };
                commandsMap.set(cid, updated);
              }
            }
            return { data: updated ? [updated] : [], error: null };
          }
          let rows = [...commandsMap.values()].filter(matches);
          rows.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
          if (st.limitVal) rows = rows.slice(0, st.limitVal);
          return { data: rows, error: null };
        };
        const chain = {
          select: () => chain,
          insert: (row) => { st.op = 'insert'; st.payload = row; return chain; },
          update: (patch) => { st.op = 'update'; st.payload = patch; return chain; },
          delete: () => { st.op = 'delete'; return chain; },
          eq: (k, v) => { st.filters.push([k, v]); return chain; },
          in: (k, vals) => { st.inFilters.push([k, vals]); return chain; },
          gt: (k, v) => { st.gtFilters.push([k, v]); return chain; },
          lte: () => chain,
          lt: () => chain,
          order: () => chain,
          limit: (n) => { st.limitVal = n; return chain; },
          maybeSingle: async () => {
            const res = await exec();
            return { data: res.data?.[0] || null, error: res.error };
          },
          then: (resolve, reject) => exec().then(resolve, reject)
        };
        return chain;
      }
    });

    const sharedCmdClient = makeCmdClient();
    const cmdStore1 = new SupabaseCommandStore(sharedCmdClient, { allowUnsafeSingleInstanceFallback: true, idleEmptyCacheMs: 4000 });
    const cmdStore2 = new SupabaseCommandStore(sharedCmdClient, { allowUnsafeSingleInstanceFallback: true, idleEmptyCacheMs: 4000 });

    const storeA = new SupabaseWorkerStore(supabaseClient, { cacheTtlMs: 0 });
    const storeB = new SupabaseWorkerStore(supabaseClient, { cacheTtlMs: 0 });
    const regA = new WorkerRegistry({ store: storeA, accessStore: dashboardStore, encryptionKey: encKey });
    const regB = new WorkerRegistry({ store: storeB, accessStore: dashboardStore, encryptionKey: encKey });

    await regA.add({ workerId: '01', provider: 'wispbyte', name: 'Cross Web Bot' });
    regB.touchLiveHeartbeat('01');

    const brokerA = new CommandBroker({
      registry: regA,
      commandStore: cmdStore1,
      config: { workerPollWaitMs: 3000, commandResultTimeoutMs: 3000, crossInstancePollCheckMs: 80 },
      logger: silentLogger
    });
    const brokerB = new CommandBroker({
      registry: regB,
      commandStore: cmdStore2,
      config: { workerPollWaitMs: 3000, commandResultTimeoutMs: 3000, crossInstancePollCheckMs: 80 },
      logger: silentLogger
    });

    try {
      // Prime cmdStore1's idleEmptyCacheMs gate before starting long-poll on Web #1
      assert.strictEqual(await cmdStore1.take('01'), null);

      const pollPromise = brokerA.poll('01', { waitMs: 2500 });
      await new Promise((r) => setTimeout(r, 30));
      assert.strictEqual(brokerA.hasActivePoller('01'), true);

      const dispatchPromise = brokerB.dispatch('01', 'chat', { message: 'hello-cross-web' });
      const polledCmd = await pollPromise;
      assert.ok(polledCmd, 'Web #1 poller must wake when Web #2 enqueues command in Supabase');
      assert.strictEqual(polledCmd.action, 'chat');
      assert.strictEqual(polledCmd.payload.message, 'hello-cross-web');

      const acceptOutcome = await brokerA.acceptResult('01', {
        commandId: polledCmd.commandId,
        action: 'chat',
        ok: true,
        message: 'hello-cross-web'
      });
      assert.notStrictEqual(acceptOutcome, false);

      const dispatchOutcome = await dispatchPromise;
      assert.strictEqual(dispatchOutcome.ok, true);
      assert.strictEqual(dispatchOutcome.delivered, true);
      assert.strictEqual(dispatchOutcome.result.message, 'hello-cross-web');
    } finally {
      brokerA.stopOutboxProcessor();
      brokerB.stopOutboxProcessor();
    }

    // 2. Cross-web settingsRevision persistence & sync via Supabase without leaking _settingsRevision
    const revBeforeB = await regB.syncSettingsRevision('01');
    await regA.updateSettings('01', { ecoMode: false });
    const revAfterEcoB = await regB.syncSettingsRevision('01');
    assert.ok(revAfterEcoB > revBeforeB, 'Web #2 must see incremented settingsRevision persisted by Web #1');
    await regA.updateCredentials('01', { username: 'PlayerCrossWeb', password: 'pw' });
    const bootB = await regB.bootstrap('01');
    assert.strictEqual(bootB.settingsRevision, revAfterEcoB + 1);
    assert.strictEqual(bootB.credentials.username, 'PlayerCrossWeb');
    const pubB = regB.publicView(await regB.find('01'));
    assert.strictEqual(pubB.settings._settingsRevision, undefined, '_settingsRevision must stay internal');

    // 3. Cross-web AdminNotifier webhook sync
    const notifier = new AdminNotifier({ store: dashboardStore, encryptionKey: encKey, logger: silentLogger });
    await dashboardStore.setSetting('webhook_settings', {
      enabled: true,
      discordUrlCiphertext: encryptSecret('https://discord.com/api/webhooks/123456789012345678/abcDEF_123', encKey),
      notifyOnOffline: false
    });
    await notifier._refreshSettingsFromStoreIfStale(0);
    assert.strictEqual(notifier.discordWebhookUrl, 'https://discord.com/api/webhooks/123456789012345678/abcDEF_123');
    assert.strictEqual(notifier.webhookRules.notifyOnOffline, false);

    // 4. WispbyteKeepAlive skipFreshWithinMs avoids duplicate scraping across multiple Web instances
    const pingedUrls = [];
    await dashboardStore.setSetting('wispbyte_accounts', [
      {
        id: 'acc_fresh',
        name: 'Fresh Acc',
        cookie: 'session=fresh_cookie_123456',
        panelUrl: 'https://wispbyte.com/client',
        lastStatus: 'ok',
        lastPingAt: new Date().toISOString(),
        renewCount: 3
      },
      {
        id: 'acc_stale',
        name: 'Stale Acc',
        cookie: 'session=stale_cookie_123456',
        panelUrl: 'https://wispbyte.com/client',
        lastStatus: 'ok',
        lastPingAt: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
        renewCount: 1
      }
    ]);
    const ka = new WispbyteKeepAliveManager({
      store: dashboardStore,
      config: { encryptionKey: encKey },
      logger: silentLogger,
      fetchImpl: async (url) => {
        pingedUrls.push(url);
        return { status: 200, headers: { get: () => null }, text: async () => '<html>Wispbyte Dashboard logout</html>' };
      }
    });
    ka.pingAccount = async (acc) => {
      pingedUrls.push(acc.panelUrl);
      return { id: acc.id, name: acc.name, success: true, status: 'ok', message: 'HTTP 200' };
    };

    const skippedRun = await ka.checkAll({ notifyDiscord: false, skipFreshWithinMs: 18 * 3600 * 1000 });
    assert.strictEqual(skippedRun.okCount, 2);
    assert.strictEqual(pingedUrls.length, 1, 'Background keepalive must skip account recently pinged by peer web');
    assert.strictEqual(skippedRun.results.find((r) => r.id === 'acc_fresh')?.skippedFresh, true);

    pingedUrls.length = 0;
    const forcedRun = await ka.checkAll({ notifyDiscord: false });
    assert.strictEqual(forcedRun.okCount, 2);
    assert.strictEqual(pingedUrls.length, 2, 'Manual checkAll() without skipFreshWithinMs must ping all accounts');
  } finally {
    clearInterval(keepAlive);
  }
});
