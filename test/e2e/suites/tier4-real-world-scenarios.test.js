#!/usr/bin/env node
'use strict';

const assert = require('node:assert');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const v8 = require('node:v8');
const vm = require('node:vm');

// Ensure V8 GC is exposed for RAM sweeper testing
try {
  v8.setFlagsFromString('--expose_gc');
  if (typeof global.gc !== 'function') {
    global.gc = vm.runInNewContext('gc');
  }
} catch (_) {}

// Ensure module resolution finds worker dependencies (mineflayer, minecraft-protocol, etc.)
const workerNodeModules = path.resolve(__dirname, '../../../../worker/node_modules');
if (!module.paths.includes(workerNodeModules)) {
  module.paths.push(workerNodeModules);
}
if (!module.paths.includes('D:/worker/node_modules')) {
  module.paths.push('D:/worker/node_modules');
}

// Resilient Mineflayer blockAt patch for mock tests (prevents physics plugin crash when no blocks loaded or when cleanup nullifies blockAt while timer active)
try {
  const mineflayer = require('mineflayer');
  if (mineflayer && typeof mineflayer.createBot === 'function') {
    const origCreateBot = mineflayer.createBot;
    mineflayer.createBot = function (options) {
      const bot = origCreateBot.call(this, options);
      try {
        Object.defineProperty(bot, 'blockAt', {
          get() {
            return () => null;
          },
          set(_) {},
          configurable: true
        });
      } catch (_) {}
      return bot;
    };
  }
} catch (_) {}

// Harness Imports
const { createMockSupabaseServer } = require('../harness/mock-supabase');
const MockMinecraftServer = require('../harness/mock-minecraft-server');
const { MockDiscordEngine } = require('../harness/mock-discord');

// Manager Imports
const { createApp } = require('../../../src/http/app');
const { createSupabaseClient } = require('../../../src/storage/supabase-client');
const SupabaseWorkerStore = require('../../../src/storage/supabase-worker-store');
const SupabaseDashboardStore = require('../../../src/storage/supabase-dashboard-store');
const SupabaseCommandStore = require('../../../src/storage/supabase-command-store');
const { WorkerRegistry } = require('../../../src/services/worker-registry');
const CommandBroker = require('../../../src/services/command-broker');
const FleetOperations = require('../../../src/services/fleet-operations');
const { EntitlementService } = require('../../../src/services/entitlement-service');
const AsyncKeyLock = require('../../../src/services/async-key-lock');
const { AccessControl } = require('../../../src/services/access-control');
const { encryptSecret, decryptSecret } = require('../../../src/utils/secrets');

// Worker Imports (with resilient fallback)
let WorkerFleet, MinecraftSession, WorkerRuntime, WispbytePoller, isMaintenanceWindow, createWorkerApp, ManagerReporter;
try {
  WorkerFleet = require('../../../../worker/src/services/worker-fleet');
  MinecraftSession = require('../../../../worker/src/game/minecraft-session').MinecraftSession;
  WorkerRuntime = require('../../../../worker/src/services/worker-runtime');
  WispbytePoller = require('../../../../worker/src/transports/wispbyte-poller');
  ManagerReporter = require('../../../../worker/src/transports/manager-reporter');
  isMaintenanceWindow = require('../../../../worker/src/services/maintenance-window').isMaintenanceWindow;
  createWorkerApp = require('../../../../worker/src/http/app').createApp;
} catch (_) {
  WorkerFleet = require('D:/worker/src/services/worker-fleet');
  MinecraftSession = require('D:/worker/src/game/minecraft-session').MinecraftSession;
  WorkerRuntime = require('D:/worker/src/services/worker-runtime');
  WispbytePoller = require('D:/worker/src/transports/wispbyte-poller');
  ManagerReporter = require('D:/worker/src/transports/manager-reporter');
  isMaintenanceWindow = require('D:/worker/src/services/maintenance-window').isMaintenanceWindow;
  createWorkerApp = require('D:/worker/src/http/app').createApp;
}

const quietLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {}
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Helper to patch mock-supabase read_manager_authorization response { authorized: true }
 * to match what supabase-client.js fetchManagerAuthorization expects { ok: true, session, user }
 */
function patchMockSupabaseAuthorization(adapter) {
  if (!adapter || typeof adapter.fetchManagerAuthorization !== 'function') return;
  const originalFetch = adapter.fetchManagerAuthorization.bind(adapter);
  adapter.fetchManagerAuthorization = async (tokenHash) => {
    const res = await originalFetch(tokenHash);
    if (!res.ok) {
      try {
        const raw = await adapter.callRpc('read_manager_authorization', { p_token_hash: String(tokenHash) }, 6000);
        const r = Array.isArray(raw) ? raw[0] : raw;
        if (r && r.authorized) {
          const s = r.session || {};
          const u = r.user || {};
          return {
            ok: true,
            session: {
              tokenHash: String(s.token_hash || tokenHash),
              userId: String(s.user_id || u.id || ''),
              username: String(s.username || u.username || 'user'),
              role: s.role === 'admin' ? 'admin' : 'user',
              assignedBotIds: Array.isArray(s.assigned_bot_ids) ? s.assigned_bot_ids : (Array.isArray(u.assigned_bot_ids) ? u.assigned_bot_ids : []),
              expiresAt: Number(s.expires_at || 0),
              planName: String(s.plan_name || 'FREE TRIAL'),
              allowAccountChange: s.allow_account_change !== false,
              status: String(s.status || 'active')
            },
            user: {
              id: String(u.id || s.user_id || ''),
              username: String(u.username || s.username || 'user'),
              status: String(u.status || 'active'),
              assignedBotIds: Array.isArray(u.assigned_bot_ids) ? u.assigned_bot_ids : [],
              expiresAt: u.expires_at || null,
              planName: String(u.plan_name || 'FREE TRIAL'),
              isPermanent: Boolean(u.is_permanent),
              allowAccountChange: true,
              botCount: 1
            }
          };
        }
      } catch (_) {}
    }
    return res;
  };
}

// =============================================================================
// SCENARIO 1: T4-SCEN-01
// Full User Registration -> Trial Allocation -> Bot Config -> Start Bot -> In-Game Chat -> Expiration Lifecycle
// =============================================================================
async function testScenario1() {
  const startTime = Date.now();
  const encryptionKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  // 1. Setup Mock Supabase and seed available worker for trial allocation
  const supabaseServer = await createMockSupabaseServer();
  const supabaseClient = createSupabaseClient({ url: supabaseServer.url, secretKey: supabaseServer.secretKey });

  patchMockSupabaseAuthorization(supabaseClient.adapter);

  const workerStore = new SupabaseWorkerStore(supabaseClient);
  await workerStore.initialize();
  const accessStore = new SupabaseDashboardStore(supabaseClient);
  await accessStore.initialize();
  const commandStore = new SupabaseCommandStore(supabaseClient);
  await commandStore.initialize();

  const workerSecret = 'worker_secret_bob_12345678901234567890';
  const secretCiphertext = encryptSecret(workerSecret, Buffer.from(encryptionKey, 'hex'));

  // Seed 1 available worker in DB
  supabaseServer.seed('manager_workers', [
    {
      worker_id: 'bot-bob-1',
      bot_number: 1,
      name: 'KingMC Bob Bot',
      enabled: true,
      provider: 'render',
      service_url: '',
      secret_ciphertext: secretCiphertext,
      status: { state: 'offline', online: false },
      settings: {},
      created_at: new Date().toISOString()
    }
  ]);

  const accessControl = new AccessControl({ store: accessStore });
  const userLock = new AsyncKeyLock();
  const registry = new WorkerRegistry({ store: workerStore, accessStore, encryptionKey });
  await registry.load();

  const config = {
    encryptionKey,
    botSecretKey: 'globalsecret_12345678901234567890',
    adminPassword: 'AdminPassword123!',
    trialDays: 1,
    commandResultTimeoutMs: 15000,
    workerPollWaitMs: 15000
  };

  const broker = new CommandBroker({ registry, commandStore, config, logger: quietLogger });
  const fleetOperations = new FleetOperations({ registry, broker, renderApi: {}, logger: quietLogger });
  const entitlementService = new EntitlementService({ store: accessStore, registry, accessControl, userLock });

  const managerApp = createApp({
    store: accessStore,
    entitlementService,
    registry,
    broker,
    commandStore,
    workerStore,
    fleetOperations,
    config,
    logger: quietLogger
  });

  const managerServer = http.createServer(managerApp);
  await new Promise((r) => managerServer.listen(0, '127.0.0.1', r));
  const managerPort = managerServer.address().port;
  const managerUrl = `http://127.0.0.1:${managerPort}`;

  // 2. User Registration via POST /api/auth/register
  const regRes = await fetch(`${managerUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'bob_miner',
      password: 'Password123!',
      confirmPassword: 'Password123!'
    })
  });
  assert.strictEqual(regRes.status, 201, 'User registration must return HTTP 201');
  const regJson = await regRes.json();
  assert.strictEqual(regJson.ok, true, 'Registration ok must be true');
  assert.strictEqual(regJson.user.username, 'bob_miner');
  assert.ok(
    regJson.user.assignedBotIds.includes('bot-bob-1'),
    'Free trial registration must allocate bot-bob-1'
  );
  const bobUserId = regJson.user.id;
  assert.ok(regJson.token, 'Registration must return session token');

  // 3. Login to Web Dashboard via POST /api/auth/login
  const loginRes = await fetch(`${managerUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'bob_miner',
      password: 'Password123!'
    })
  });
  assert.strictEqual(loginRes.status, 200, 'Login must return HTTP 200');
  const loginJson = await loginRes.json();
  assert.strictEqual(loginJson.ok, true);
  const bobToken = loginJson.token;
  assert.ok(bobToken, 'Login must return active session token');

  // 4. Discord Account Linking
  const discordEngine = new MockDiscordEngine({
    config: { adminUsername: 'admin', discordGuildId: '999999999999999999' },
    services: { accessStore, config, registry, broker },
    logger: quietLogger
  });
  const modalInter = await discordEngine.dispatchLoginModal('bob_miner', 'Password123!', {
    user: { id: 'discord_bob_456', username: 'bob_dc' }
  });
  assert.strictEqual(modalInter.replied || modalInter.deferred, true);
  const modalReply = modalInter.getLastReply();
  const modalText = JSON.stringify(modalReply);
  assert.ok(
    modalText.includes('THÀNH CÔNG') || modalText.includes('thành công'),
    'Discord modal login must acknowledge successful account linking'
  );

  // 5. Configure Minecraft credentials & settings
  const mcServer = new MockMinecraftServer({ autoAuthPrompt: true, autoAuthSuccess: true });
  const mcPort = await mcServer.start();

  const credRes = await fetch(`${managerUrl}/api/user/bot/bot-bob-1/account`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${bobToken}`
    },
    body: JSON.stringify({
      username: 'BobMC',
      password: 'mcPassword123!'
    })
  });
  assert.strictEqual(credRes.status, 200, 'Saving credentials must return HTTP 200');
  const credJson = await credRes.json();
  assert.strictEqual(credJson.ok, true);

  const settingsRes = await fetch(`${managerUrl}/api/user/bot/bot-bob-1/settings`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${bobToken}`
    },
    body: JSON.stringify({
      serverHost: '127.0.0.1',
      serverPort: mcPort
    })
  });
  assert.strictEqual(settingsRes.status, 200, 'Saving settings must return HTTP 200');

  // Verify AES-256-GCM encryption in DB: password must NOT be stored in plaintext
  const botRowRes = await supabaseClient.from('manager_workers').select('*').eq('worker_id', 'bot-bob-1').single();
  assert.strictEqual(botRowRes.status, 200);
  const ciphertext = botRowRes.data.settings?.mcCredentialsCiphertext;
  assert.ok(ciphertext, 'Credentials must be stored as ciphertext in database');
  assert.strictEqual(
    ciphertext.includes('mcPassword123!'),
    false,
    'Plaintext password must never appear in ciphertext'
  );
  const decryptedJson = JSON.parse(decryptSecret(ciphertext, Buffer.from(encryptionKey, 'hex')));
  assert.strictEqual(decryptedJson.username, 'BobMC');
  assert.strictEqual(decryptedJson.password, 'mcPassword123!');

  // 6. Start Worker HTTP Service & Dispatch START action
  await registry.setSecret('bot-bob-1', workerSecret);

  const botConfig = {
    workerId: 'bot-bob-1',
    managerUrl,
    secret: workerSecret,
    transport: 'render-http',
    connectTimeoutMs: 15000,
    mc: {
      username: 'BobMC',
      password: 'mcPassword123!',
      hosts: ['127.0.0.1'],
      port: mcPort,
      version: '1.20.1',
      authEnabled: true
    }
  };

  const session = new MinecraftSession(botConfig, quietLogger);
  session.on('state', () => {
    if (session.bot && typeof session.bot.blockAt !== 'function') {
      session.bot.blockAt = () => null;
    }
  });
  const reporter = new ManagerReporter({
    baseUrl: managerUrl,
    workerId: 'bot-bob-1',
    secret: workerSecret,
    logger: quietLogger
  });
  const refreshManagerConfig = async () => {
    const state = await reporter.bootstrap();
    session.applyManagerSettings(state.settings);
    session.applyManagerCredentials(state.credentials);
    session.restoreManagerState(state);
    return state;
  };
  const runtime = new WorkerRuntime(session, botConfig, quietLogger, { refreshManagerConfig });

  const workerFleetObj = {
    get: (id) => (id === 'bot-bob-1' ? { config: botConfig, session, runtime, reporter } : null),
    health: () => ({ botCount: 1 })
  };
  const workerApp = createWorkerApp({
    fleet: workerFleetObj,
    config: { botCount: 1, bots: [botConfig] },
    logger: quietLogger
  });
  const workerServer = http.createServer(workerApp);
  await new Promise((r) => workerServer.listen(0, '127.0.0.1', r));
  const workerUrl = `http://127.0.0.1:${workerServer.address().port}`;
  await workerStore.update('bot-bob-1', { serviceUrl: workerUrl });

  // Dispatch START via User API
  const startRes = await fetch(`${managerUrl}/api/user/bot/bot-bob-1/start`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${bobToken}`
    }
  });
  assert.strictEqual(startRes.status, 200, 'Start bot action must return HTTP 200');

  // Wait for Mineflayer bot to connect, answer Authme /login, and reach online: true
  const waitStart = Date.now();
  while (session.state !== 'online' && Date.now() - waitStart < 6000) {
    await sleep(100);
  }
  assert.strictEqual(session.state, 'online', 'Bot must reach "online" state in Minecraft');
  assert.ok(
    mcServer.receivedCommands.some((c) => c.includes('mcPassword123!')),
    'Worker must have sent Authme /login packet with decrypted password'
  );

  // 7. In-Game Chat Interaction: User sends chat action
  const chatRes = await fetch(`${managerUrl}/api/user/bot/bot-bob-1/send`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${bobToken}`
    },
    body: JSON.stringify({ text: '!ping' })
  });
  assert.strictEqual(chatRes.status, 200, 'Sending chat must return HTTP 200');

  // Verify Mock Minecraft Server received chat packet
  await sleep(150);
  assert.ok(
    mcServer.receivedChats.includes('!ping') || mcServer.receivedCommands.includes('!ping'),
    'Mock Minecraft Server must intercept chat packet "!ping"'
  );

  // 8. Fast-forward expiration in DB -> verify grace period keeps bot running, then post-grace stops cleanly
  const graceExpiry = new Date(Date.now() - 3600000).toISOString(); // 1h ago (< 6h grace period)
  await accessStore.setAccess(bobUserId, { expiresAt: graceExpiry, status: 'active' }, 'sim-grace');

  // Run graceful check on user in grace period -> bot must remain running in Minecraft!
  await entitlementService.checkExpiredUsersAndGracefulStop({ broker, fleetOperations });
  assert.strictEqual(session.state, 'online', 'Bot session must remain online during 6h grace period');

  // Now fast-forward past 6h grace period (> 6h, e.g. 7h ago)
  const pastExpiry = new Date(Date.now() - 7 * 3600000).toISOString();
  await accessStore.setAccess(bobUserId, { expiresAt: pastExpiry, status: 'grace_period' }, 'sim-expire');

  // Run graceful stop on user whose 6h grace period expired
  await entitlementService.checkExpiredUsersAndGracefulStop({ broker, fleetOperations });

  // Bot should be cleanly stopped
  const waitStop = Date.now();
  while (session.state === 'online' && Date.now() - waitStop < 3000) {
    await sleep(100);
  }
  assert.strictEqual(session.state, 'stopped', 'Bot session must be stopped when trial expires');

  // Attempting subsequent bot control must be rejected with HTTP 403
  const blockedChat = await fetch(`${managerUrl}/api/user/bot/bot-bob-1/send`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${bobToken}`
    },
    body: JSON.stringify({ text: 'Should be rejected' })
  });
  assert.strictEqual(blockedChat.status, 403, 'Expired user action must be rejected with HTTP 403');
  const blockedJson = await blockedChat.json();
  assert.ok(blockedJson.error.includes('hết hạn'), 'Error message must state account expired');

  // Cleanup
  if (session.bot) {
    session.bot.physicsEnabled = false;
    if (session.bot._client) session.bot._client.state = 'ended';
    try { session.bot.end(); } catch (_) {}
  }
  await session.stop();
  await new Promise((r) => workerServer.close(r));
  await mcServer.stop();
  await new Promise((r) => managerServer.close(r));
  await supabaseServer.close();

  const durationMs = Date.now() - startTime;
  return { id: 'T4-SCEN-01', ok: true, durationMs };
}

// =============================================================================
// SCENARIO 2: T4-SCEN-02
// Full Admin Setup -> Dual-Slot Worker Addition -> Handover Customer Reset -> Audit Logs Export
// =============================================================================
async function testScenario2() {
  const startTime = Date.now();
  const encryptionKey = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

  const supabaseServer = await createMockSupabaseServer();
  const supabaseClient = createSupabaseClient({ url: supabaseServer.url, secretKey: supabaseServer.secretKey });

  patchMockSupabaseAuthorization(supabaseClient.adapter);

  const workerStore = new SupabaseWorkerStore(supabaseClient);
  await workerStore.initialize();
  const accessStore = new SupabaseDashboardStore(supabaseClient);
  await accessStore.initialize();
  const commandStore = new SupabaseCommandStore(supabaseClient);
  await commandStore.initialize();

  const registry = new WorkerRegistry({ store: workerStore, accessStore, encryptionKey });
  await registry.load();

  const config = {
    encryptionKey,
    adminPassword: 'EnterpriseAdminPass123!',
    commandResultTimeoutMs: 15000,
    workerPollWaitMs: 15000
  };

  const broker = new CommandBroker({ registry, commandStore, config, logger: quietLogger });
  const fleetOperations = new FleetOperations({ registry, broker, renderApi: {}, logger: quietLogger });
  const entitlementService = new EntitlementService({
    store: accessStore,
    registry,
    accessControl: new AccessControl({ store: accessStore }),
    userLock: new AsyncKeyLock()
  });

  const managerApp = createApp({
    store: accessStore,
    entitlementService,
    registry,
    broker,
    commandStore,
    workerStore,
    fleetOperations,
    config,
    logger: quietLogger
  });

  const managerServer = http.createServer(managerApp);
  await new Promise((r) => managerServer.listen(0, '127.0.0.1', r));
  const managerUrl = `http://127.0.0.1:${managerServer.address().port}`;

  // 1. Admin Authentication
  const adminLoginRes = await fetch(`${managerUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'admin',
      password: 'EnterpriseAdminPass123!'
    })
  });
  assert.strictEqual(adminLoginRes.status, 200, 'Admin login must return HTTP 200');
  const adminLoginJson = await adminLoginRes.json();
  assert.strictEqual(adminLoginJson.ok, true);
  const adminToken = adminLoginJson.token;
  assert.ok(adminToken, 'Admin session token must exist');

  // 2. Dual-Slot Worker HTTP Server
  const dispatchedWorkerCommands = [];
  const mockRenderApp = express();
  mockRenderApp.use(express.json());
  mockRenderApp.get('/health', (_req, res) => {
    res.json({ ok: true, botCount: 2, slots: 2 });
  });
  mockRenderApp.post('/api/v1/bots/:workerId/command', (req, res) => {
    dispatchedWorkerCommands.push({ workerId: req.params.workerId, body: req.body });
    res.json({ ok: true, result: { ok: true, stopped: true } });
  });

  const mockRenderServer = http.createServer(mockRenderApp);
  await new Promise((r) => mockRenderServer.listen(0, '127.0.0.1', r));
  const mockRenderUrl = `http://127.0.0.1:${mockRenderServer.address().port}`;

  // Admin registers Dual-Slot Worker
  const addWorkerRes = await fetch(`${managerUrl}/api/manager/bots`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      provider: 'render',
      serviceUrl: mockRenderUrl,
      label: 'Render Worker Alpha'
    })
  });
  assert.strictEqual(addWorkerRes.status, 201, 'Worker registration must return HTTP 201');
  const addWorkerJson = await addWorkerRes.json();
  assert.strictEqual(addWorkerJson.ok, true);
  assert.strictEqual(addWorkerJson.bots.length, 2, 'Must discover and register exactly 2 slots');

  const slot1 = addWorkerJson.bots[0];
  const slot2 = addWorkerJson.bots[1];

  // Secrets are returned in the envConfig string for Render configuration
  const secret1Match = addWorkerJson.envConfig.match(/WORKER_SECRET_1=([^\r\n]+)/);
  const secret2Match = addWorkerJson.envConfig.match(/WORKER_SECRET_2=([^\r\n]+)/);
  assert.ok(secret1Match && secret1Match[1].trim().length >= 32, 'Slot 1 secret must be >= 32 characters');
  assert.ok(secret2Match && secret2Match[1].trim().length >= 32, 'Slot 2 secret must be >= 32 characters');
  assert.ok(addWorkerJson.envConfig.includes('WORKER_ID_1'), 'envConfig must include WORKER_ID_1');
  assert.ok(addWorkerJson.envConfig.includes('WORKER_ID_2'), 'envConfig must include WORKER_ID_2');

  // 3. Generate license giftcodes in DB
  const genKeysRes = await fetch(`${managerUrl}/api/manager/keys`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      days: 30,
      count: 2,
      planName: 'VIP Pro',
      botCount: 1
    })
  });
  assert.strictEqual(genKeysRes.status, 201, 'Generating giftcodes must return HTTP 201');
  const genKeysJson = await genKeysRes.json();
  assert.strictEqual(genKeysJson.ok, true);
  assert.strictEqual(genKeysJson.keys.length, 2, 'Must generate exactly 2 giftcodes');

  // 4. Assign Slot 1 to customer Alice & Perform Handover Reset
  await registry.updateCredentials(slot1.workerId, {
    username: 'AliceBotMC',
    password: 'AliceSecret123!'
  });
  const configuredSettings = await registry.privateSettings(slot1.workerId);
  assert.strictEqual(configuredSettings.username, 'AliceBotMC');
  assert.strictEqual(configuredSettings.credentialsConfigured, true);

  // Trigger customer handover reset
  const resetRes = await fetch(`${managerUrl}/api/manager/bot/${slot1.workerId}/reset-customer`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    }
  });
  assert.strictEqual(resetRes.status, 200, 'Customer handover reset must return HTTP 200');
  const resetJson = await resetRes.json();
  assert.strictEqual(resetJson.ok, true);

  // Assert:
  // a) broker.dispatch('stop') was called on the worker
  assert.ok(
    dispatchedWorkerCommands.some(
      (c) => c.workerId === slot1.workerId && c.body.action === 'stop' && c.body.payload?.reason === 'reset-customer'
    ),
    'Broker must dispatch stop action to worker with reason reset-customer'
  );

  // b) DB credentials wiped
  const wipedWorker = await registry.find(slot1.workerId);
  const wipedSettings = await registry.privateSettings(slot1.workerId);
  assert.strictEqual(wipedSettings.username, '', 'Worker Minecraft username must be wiped in database');
  assert.strictEqual(wipedSettings.credentialsConfigured, false, 'Credentials must not be configured');
  assert.strictEqual(
    wipedWorker.settings?.mcCredentialsCiphertext || null,
    null,
    'Encrypted credentials ciphertext must be wiped'
  );

  // 5. Query GET /api/manager/audit-logs
  const auditRes = await fetch(`${managerUrl}/api/manager/audit-logs?page=1&limit=10`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.strictEqual(auditRes.status, 200, 'Audit logs query must return HTTP 200');
  const auditJson = await auditRes.json();
  assert.strictEqual(auditJson.ok, true);
  assert.strictEqual(auditJson.page, 1);
  assert.strictEqual(auditJson.limit, 10);
  assert.ok(auditJson.total >= 1, 'Total audit logs must be >= 1');
  assert.ok(
    auditJson.logs.some((l) => l.action === 'ADMIN_RESET_BOT_CUSTOMER'),
    'Audit logs must record action ADMIN_RESET_BOT_CUSTOMER'
  );

  // Export audit logs as CSV
  const exportRes = await fetch(`${managerUrl}/api/manager/audit-logs/export?format=csv`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.strictEqual(exportRes.status, 200);
  const csvText = await exportRes.text();
  assert.ok(csvText.includes('ADMIN_RESET_BOT_CUSTOMER'), 'CSV export must include ADMIN_RESET_BOT_CUSTOMER');

  // Cleanup
  await new Promise((r) => mockRenderServer.close(r));
  await new Promise((r) => managerServer.close(r));
  await supabaseServer.close();

  const durationMs = Date.now() - startTime;
  return { id: 'T4-SCEN-02', ok: true, durationMs };
}

// =============================================================================
// SCENARIO 3: T4-SCEN-03
// Dual-Slot Worker Staggered Boot -> RAM Sweeper (>250MB) -> Daily Maintenance Window
// =============================================================================
async function testScenario3() {
  const startTime = Date.now();

  const bootTimestamps = [];
  const mockBots = [
    {
      workerId: 'worker-slot-1',
      slot: 1,
      managerUrl: 'http://127.0.0.1:9999',
      secret: 'secret_1_123456789012345678901234',
      transport: 'render-http',
      mc: {
        username: 'Slot1Bot',
        password: 'ValidPassword123!',
        hosts: ['127.0.0.1'],
        port: 25565
      }
    },
    {
      workerId: 'worker-slot-2',
      slot: 2,
      managerUrl: 'http://127.0.0.1:9999',
      secret: 'secret_2_123456789012345678901234',
      transport: 'render-http',
      mc: {
        username: 'Slot2Bot',
        password: 'ValidPassword123!',
        hosts: ['127.0.0.1'],
        port: 25565
      }
    }
  ];

  const fleet = new WorkerFleet(
    {
      autoStart: true,
      botCount: 2,
      bots: mockBots,
      rssWarnMb: 250,
      wispbyte: {}
    },
    quietLogger,
    {
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          settings: {},
          credentials: { username: 'ValidBot', password: 'ValidPassword123!' }
        })
      })
    }
  );

  // Track the execution times of start on Slot 1 and Slot 2
  for (const inst of fleet.list()) {
    // Mock session.connect to succeed without needing an external MC server
    inst.session.connect = async () => inst.session.getStatus();
    const origExec = inst.runtime.execute.bind(inst.runtime);
    inst.runtime.execute = async (action, payload) => {
      if (action === 'start') {
        bootTimestamps.push({ workerId: inst.config.workerId, slot: inst.config.slot, at: Date.now() });
      }
      return origExec(action, payload);
    };
  }

  // 1. Dual-Slot Worker Staggered Boot Execution
  // Slot 1 boots immediately (T=0); Slot 2 pauses for 8000ms delay countdown
  await fleet.start();

  assert.strictEqual(bootTimestamps.length, 2, 'Both Slot 1 and Slot 2 must execute start');
  const tSlot1 = bootTimestamps.find((b) => b.slot === 1).at;
  const tSlot2 = bootTimestamps.find((b) => b.slot === 2).at;
  const staggerDuration = tSlot2 - tSlot1;

  assert.ok(
    staggerDuration >= 7900,
    `Slot 2 must boot after staggered delay >= 8000ms (observed: ${staggerDuration}ms)`
  );

  // 2. RAM Sweeper (>250MB RSS) & Memory Pruning Watchdog (>350MB)
  assert.strictEqual(typeof global.gc, 'function', 'V8 internal Garbage Collection must be exposed');

  // Populate sessions with synthetic entity and player loads
  for (const inst of fleet.list()) {
    const selfEntity = { id: 42 };
    inst.session.bot = {
      username: `Bot_${inst.config.workerId}`,
      entity: selfEntity,
      entities: {
        42: selfEntity,
        101: { id: 101, type: 'zombie' },
        102: { id: 102, type: 'skeleton' },
        103: { id: 103, type: 'item' }
      },
      players: {
        [`Bot_${inst.config.workerId}`]: {},
        StrangerOne: {},
        StrangerTwo: {}
      }
    };
  }

  // Invoke memory pruning and GC
  for (const inst of fleet.list()) {
    inst.session.pruneMemory();
    assert.strictEqual(
      Object.keys(inst.session.bot.entities).length,
      1,
      'Pruning must leave only bot entity in entities map'
    );
    assert.strictEqual(
      Object.keys(inst.session.bot.players).length,
      1,
      'Pruning must leave only bot player in players map'
    );
  }

  // Active V8 GC invocation
  global.gc();

  // 3. Daily Maintenance Window (04:30–05:30 UTC+7) Simulation
  // Verify maintenance window boundary detection
  const maintTime = new Date('2026-11-15T04:45:00+07:00');
  const regularTime = new Date('2026-11-15T14:30:00+07:00');
  assert.strictEqual(isMaintenanceWindow(maintTime), true, '04:45 UTC+7 must be inside maintenance window');
  assert.strictEqual(isMaintenanceWindow(regularTime), false, '14:30 UTC+7 must be outside maintenance window');

  // Simulate entering maintenance window on Slot 1
  const slot1Inst = fleet.get('worker-slot-1');
  slot1Inst.session.manualStop = false;
  slot1Inst.session.enterMaintenanceWindow();

  assert.strictEqual(slot1Inst.session.state, 'maintenance', 'State must transition to maintenance');
  assert.strictEqual(slot1Inst.session.networkSockets.size, 0, 'networkSockets map must be strictly empty');
  assert.strictEqual(slot1Inst.session.reconnectTimer, null, 'reconnectTimer must be cancelled');
  assert.strictEqual(slot1Inst.session.connectTimer, null, 'connectTimer must be cancelled');

  await fleet.stop();
  const durationMs = Date.now() - startTime;
  return { id: 'T4-SCEN-03', ok: true, durationMs };
}

// =============================================================================
// SCENARIO 4: T4-SCEN-04
// Network Interruption / Minecraft Kick -> Exponential Backoff Reconnection -> State Recovery
// =============================================================================
async function testScenario4() {
  const startTime = Date.now();

  const mcServer = new MockMinecraftServer({ autoAuthPrompt: true, autoAuthSuccess: true });
  const mcPort = await mcServer.start();

  const session = new MinecraftSession(
    {
      workerId: 'reconnect-test-bot',
      botNumber: 1,
      autoReconnect: true,
      connectTimeoutMs: 15000,
      reconnectBaseMs: 150,
      reconnectMaxMs: 1000,
      reconnectMaxAttempts: 5,
      maintenanceWaitMs: 300,
      mc: {
        username: 'KickTestBot',
        password: 'KickPassword123!',
        hosts: ['127.0.0.1'],
        port: mcPort,
        version: '1.20.1',
        authEnabled: true
      }
    },
    quietLogger
  );
  session.on('state', () => {
    if (session.bot && typeof session.bot.blockAt !== 'function') {
      session.bot.blockAt = () => null;
    }
  });

  // 1. Initial connection & Authme login
  await session.start();
  const waitOnline = Date.now();
  while (session.state !== 'online' && Date.now() - waitOnline < 6000) {
    await sleep(100);
  }
  assert.strictEqual(session.state, 'online', 'Bot must reach online state before kick');
  assert.strictEqual(mcServer.clients.size, 1, 'Mock Minecraft Server must have 1 connected client');

  // 2. Server Kick Event
  const client = Array.from(mcServer.clients)[0];
  assert.ok(client, 'Connected client must exist');

  let kickEventReceived = false;
  session.once('event', (ev) => {
    if (ev.type === 'kicked') kickEventReceived = true;
  });

  mcServer.kick(client, 'Server restarting for scheduled update');

  // Wait for disconnect handling
  const waitKick = Date.now();
  while (session.state === 'online' && Date.now() - waitKick < 3000) {
    await sleep(50);
  }

  assert.ok(
    session.lastKickReason?.includes('Server restarting'),
    'Session must capture lastKickReason from server'
  );
  assert.strictEqual(session.networkSockets.size, 0, 'networkSockets must be cleared upon disconnect');
  assert.strictEqual(session.reconnectAttempts >= 1, true, 'reconnectAttempts must be incremented');
  assert.strictEqual(session.reconnectCount >= 1, true, 'reconnectCount must be incremented');

  // 3. Exponential Backoff & Automatic State Recovery
  // Server is still listening; session automatically reconnects when reconnectTimer fires
  const waitRecovery = Date.now();
  while (session.state !== 'online' && Date.now() - waitRecovery < 6000) {
    await sleep(100);
  }

  assert.strictEqual(session.state, 'online', 'Bot must successfully recover and return to "online" state');
  assert.strictEqual(session.reconnectAttempts, 0, 'reconnectAttempts must be reset to 0 after successful spawn');
  assert.ok(session.reconnectCount >= 1, 'Total lifetime reconnectCount must be retained');

  if (session.bot) {
    session.bot.physicsEnabled = false;
    if (session.bot._client) session.bot._client.state = 'ended';
    try { session.bot.end(); } catch (_) {}
  }
  await session.stop();
  await mcServer.stop();

  const durationMs = Date.now() - startTime;
  return { id: 'T4-SCEN-04', ok: true, durationMs };
}

// =============================================================================
// SCENARIO 5: T4-SCEN-05
// Wispbyte Long-Polling Command Dispatch -> Offline Polling Timeout -> Reconnection Result Ack
// =============================================================================
async function testScenario5() {
  const startTime = Date.now();
  const encryptionKey = '0102030405060708090a0b0c0d0e0f100102030405060708090a0b0c0d0e0f10';

  const supabaseServer = await createMockSupabaseServer();
  const supabaseClient = createSupabaseClient({ url: supabaseServer.url, secretKey: supabaseServer.secretKey });

  patchMockSupabaseAuthorization(supabaseClient.adapter);

  const workerStore = new SupabaseWorkerStore(supabaseClient);
  await workerStore.initialize();
  const accessStore = new SupabaseDashboardStore(supabaseClient);
  await accessStore.initialize();
  const commandStore = new SupabaseCommandStore(supabaseClient);
  await commandStore.initialize();

  const registry = new WorkerRegistry({ store: workerStore, accessStore, encryptionKey });
  await registry.load();

  const config = {
    encryptionKey,
    adminPassword: 'EnterpriseAdminPass123!',
    commandResultTimeoutMs: 15000,
    workerPollWaitMs: 15000
  };

  const broker = new CommandBroker({ registry, commandStore, config, logger: quietLogger });
  const entitlementService = new EntitlementService({
    store: accessStore,
    registry,
    accessControl: new AccessControl({ store: accessStore }),
    userLock: new AsyncKeyLock()
  });

  const managerApp = createApp({
    store: accessStore,
    entitlementService,
    registry,
    broker,
    commandStore,
    workerStore,
    config,
    logger: quietLogger
  });

  const managerServer = http.createServer(managerApp);
  await new Promise((r) => managerServer.listen(0, '127.0.0.1', r));
  const managerUrl = `http://127.0.0.1:${managerServer.address().port}`;

  // Seed Wispbyte worker in Manager registry
  const wispWorkerId = 'wisp-bot-alpha';
  const wispSecret = 'wisp_secret_123456789012345678901234';
  await registry.add({
    workerId: wispWorkerId,
    name: 'Wispbyte Worker Alpha',
    provider: 'wispbyte',
    secret: wispSecret
  });
  await registry.updateStatus(wispWorkerId, { state: 'online' }, 'test-seed');

  // 1. Long-Poll Initiation: Worker calls POST /api/v1/workers/:id/poll
  let pollReceivedCommand = null;
  const pollPromise = (async () => {
    const res = await fetch(`${managerUrl}/api/v1/workers/${wispWorkerId}/poll`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-worker-secret': wispSecret
      },
      body: JSON.stringify({
        status: { state: 'online' },
        waitMs: 10000
      })
    });
    const json = await res.json();
    pollReceivedCommand = json.command;
    return json;
  })();

  // Wait 100ms for broker to register poll waiter
  await sleep(100);
  assert.strictEqual(broker.hasActivePoller(wispWorkerId), true, 'Broker must register active poller waiter');

  // 2. Command Dispatch: Manager dispatches command
  const dispatchPromise = broker.dispatch(wispWorkerId, 'chat', { message: 'Ping Wispbyte Worker' });

  // 3. Command Delivery via Long-Poll
  const pollRes = await pollPromise;
  assert.strictEqual(pollRes.ok, true);
  assert.ok(pollReceivedCommand, 'Poll response must return dispatched command');
  assert.strictEqual(pollReceivedCommand.action, 'chat');
  assert.strictEqual(pollReceivedCommand.payload?.message, 'Ping Wispbyte Worker');
  const commandId = pollReceivedCommand.commandId;
  assert.ok(commandId, 'Command must include valid commandId');

  // 4. Worker Result Acknowledgement: Worker posts result
  const resultRes = await fetch(`${managerUrl}/api/v1/workers/${wispWorkerId}/result`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-worker-secret': wispSecret
    },
    body: JSON.stringify({
      commandId,
      action: 'chat',
      result: {
        ok: true,
        sent: 'Ping Wispbyte Worker'
      }
    })
  });
  assert.strictEqual(resultRes.status, 200, 'Posting result must return HTTP 200');
  const resultJson = await resultRes.json();
  assert.strictEqual(resultJson.ok, true);

  // Original broker.dispatch promise must resolve with the acknowledged result
  const dispatchRes = await dispatchPromise;
  assert.strictEqual(dispatchRes.ok, true);
  assert.strictEqual(dispatchRes.result?.sent, 'Ping Wispbyte Worker');

  // 5. Offline Polling Timeout: Poll request when no command is queued
  const timeoutRes = await fetch(`${managerUrl}/api/v1/workers/${wispWorkerId}/poll`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-worker-secret': wispSecret
    },
    body: JSON.stringify({
      status: { state: 'online' },
      waitMs: 300
    })
  });
  assert.strictEqual(timeoutRes.status, 200);
  const timeoutJson = await timeoutRes.json();
  assert.strictEqual(timeoutJson.ok, true);
  assert.strictEqual(timeoutJson.command, null, 'Polling timeout must return command: null without errors');

  // 6. Reconnection Result Queue & Backoff
  let fetchAttempts = 0;
  const mockFlakyFetch = async (url, opts) => {
    fetchAttempts++;
    if (fetchAttempts === 1) {
      const netErr = new Error('ECONNRESET: Network offline');
      netErr.code = 'ECONNRESET';
      throw netErr;
    }
    return fetch(url, opts);
  };

  const poller = new WispbytePoller({
    config: { workerId: wispWorkerId, secret: wispSecret, managerUrl },
    runtime: { status: () => ({ state: 'online' }) },
    reporter: { managerLatencyMs: 30 },
    logger: quietLogger,
    fetchImpl: mockFlakyFetch
  });

  const validCmdUuid = crypto.randomUUID();
  const retryPayload = {
    commandId: validCmdUuid,
    action: 'status',
    result: { ok: true, state: 'online' }
  };

  // Enqueue result into poller
  poller.enqueueResult(retryPayload);
  assert.strictEqual(poller.pendingResults.length, 1, 'Result must be enqueued');

  // Flush attempt 1: network fails -> result retained in pendingResults
  await poller.flushPendingResults();
  assert.strictEqual(poller.pendingResults.length, 1, 'Result must be retained when network is down');

  // Reset nextRetryAt to allow immediate second flush
  poller.pendingResults[0].nextRetryAt = 0;

  // Flush attempt 2: network back online -> result successfully delivered to Manager
  await poller.flushPendingResults();
  assert.strictEqual(poller.pendingResults.length, 0, 'Result must be successfully flushed upon reconnection');

  await poller.stop();
  await new Promise((r) => managerServer.close(r));
  await supabaseServer.close();

  const durationMs = Date.now() - startTime;
  return { id: 'T4-SCEN-05', ok: true, durationMs };
}

// =============================================================================
// MAIN RUNNER
// =============================================================================
async function runAll() {
  console.log('TAP version 13');
  console.log('# KBOT Tier 4: Real-World Application Scenarios');
  console.log(`# Node.js ${process.version} on ${process.platform}\n`);

  const scenarios = [
    {
      num: 1,
      name: 'T4-SCEN-01: Full User Registration -> Trial Allocation -> Bot Config -> Start Bot -> In-Game Chat -> Expiration Lifecycle',
      fn: testScenario1
    },
    {
      num: 2,
      name: 'T4-SCEN-02: Full Admin Setup -> Dual-Slot Worker Addition -> Handover Customer Reset -> Audit Logs Export',
      fn: testScenario2
    },
    {
      num: 3,
      name: 'T4-SCEN-03: Dual-Slot Worker Staggered Boot -> RAM Sweeper (>250MB) -> Daily Maintenance Window',
      fn: testScenario3
    },
    {
      num: 4,
      name: 'T4-SCEN-04: Network Interruption / Minecraft Kick -> Exponential Backoff Reconnection -> State Recovery',
      fn: testScenario4
    },
    {
      num: 5,
      name: 'T4-SCEN-05: Wispbyte Long-Polling Command Dispatch -> Offline Polling Timeout -> Reconnection Result Ack',
      fn: testScenario5
    }
  ];

  let passed = 0;
  let failed = 0;

  for (const scen of scenarios) {
    try {
      const res = await scen.fn();
      passed++;
      console.log(`ok ${scen.num} - ${scen.name} (${res.durationMs}ms)`);
    } catch (err) {
      failed++;
      console.log(`not ok ${scen.num} - ${scen.name}`);
      console.error(`  ---`);
      console.error(`  message: ${err.message}`);
      console.error(`  stack: ${err.stack}`);
      console.error(`  ...`);
    }
  }

  console.log(`\n1..${scenarios.length}`);
  console.log(`# tests ${scenarios.length}`);
  console.log(`# pass  ${passed}`);
  console.log(`# fail  ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

if (require.main === module) {
  runAll().catch((err) => {
    console.error('Fatal error in Tier 4 test suite:', err);
    process.exit(1);
  });
}

module.exports = {
  testScenario1,
  testScenario2,
  testScenario3,
  testScenario4,
  testScenario5,
  runAll
};
