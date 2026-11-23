'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const { createApp } = require('../src/http/app');
const { getEffectiveAllowedGuildId, rejectOutsideGuild } = require('../src/discord/handlers/interaction-handler');
const { handlePanelInteraction } = require('../src/discord/handlers/panel-handler');
const { ManagerRuntimeSettings } = require('../src/services/manager-runtime-settings');
const { WorkerRegistry } = require('../src/services/worker-registry');

function createMockLogger() {
  const logs = { info: [], warn: [], error: [], debug: [] };
  return {
    logs,
    info: (msg, meta) => logs.info.push({ msg, meta }),
    warn: (msg, meta) => logs.warn.push({ msg, meta }),
    error: (msg, meta) => logs.error.push({ msg, meta }),
    debug: (msg, meta) => logs.debug.push({ msg, meta })
  };
}

test('M2-01: SPA route mount restoration (/api/manager, /api/rewards/link4m, /api/public, /api)', async () => {
  const activeSessions = new Map();
  const testWorker = {
    workerId: 'bot-01',
    botNumber: 1,
    name: 'KingMC Bot 1',
    provider: 'wispbyte',
    enabled: true,
    status: { state: 'online', health: 20, food: 20 },
    settings: {}
  };

  const mockRegistry = {
    list: async () => [testWorker],
    find: async (id) => (id === 'bot-01' ? testWorker : null),
    findByNumber: async (n) => (n === 1 ? testWorker : null),
    encryptionKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    verifyBotSecret: () => false,
    verifyBotSecretSync: () => false
  };

  const mockBroker = {
    dispatch: async () => ({ ok: true, delivered: true, result: { ok: true } })
  };

  const mockStore = {
    listAccess: async () => [{ username: 'admin', role: 'admin', assignedBotIds: ['bot-01'] }],
    getSetting: async () => null,
    setSetting: async () => {},
    addAudit: async () => {}
  };

  const mockEntitlement = {
    isEntitled: () => true
  };

  const mockLink4m = {
    status: async () => ({ ok: true, enabled: false }),
    startAttempt: async () => ({ ok: false }),
    verifyReward: async () => ({ ok: false })
  };

  const app = createApp({
    store: mockStore,
    entitlementService: mockEntitlement,
    link4mService: mockLink4m,
    registry: mockRegistry,
    broker: mockBroker,
    workerStore: null,
    fleetOperations: {},
    adminNotifier: null,
    config: {
      botSecretKey: 'global-test-secret',
      adminPassword: 'test-admin-password'
    },
    logger: createMockLogger()
  });

  const server = http.createServer(app);
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. /api/public/system-info returns 200 without authentication
    const sysRes = await fetch(`${baseUrl}/api/public/system-info`);
    assert.strictEqual(sysRes.status, 200, '/api/public/system-info must return 200');
    const sysJson = await sysRes.json();
    assert.strictEqual(sysJson.ok, true);
    assert.strictEqual(typeof sysJson.uptime, 'number');
    assert.strictEqual(sysJson.memory, undefined, '/api/public/system-info must not leak internal server memory');

    // 2. /api/rewards/link4m/return returns HTML without 404
    const retRes = await fetch(`${baseUrl}/api/rewards/link4m/return?attempt=att1&token=tok1`);
    assert.strictEqual(retRes.status, 200, '/api/rewards/link4m/return must return 200');
    const retHtml = await retRes.text();
    assert.ok(retHtml.includes('/api/rewards/link4m/verify'));

    // 3. /api/manager/bots returns 401 when unauthenticated (NOT 404!)
    const unauthRes = await fetch(`${baseUrl}/api/manager/bots`);
    assert.strictEqual(unauthRes.status, 401, '/api/manager/bots must reach userRouter and return 401 (not 404)');

    // 4. /api/admin/users returns 401 when unauthenticated (NOT 404!)
    const unauthAdminRes = await fetch(`${baseUrl}/api/admin/users`);
    assert.strictEqual(unauthAdminRes.status, 401, '/api/admin/users must reach adminRouter and return 401 (not 404)');
  } finally {
    server.close();
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  }
});

test('M2-02: Dynamic Discord guild resolution and zero-config setup', async () => {
  const logger = createMockLogger();

  // Case A: Zero-config initial setup (both config and dynamic settings empty)
  const emptyServices = {
    config: { discordGuildId: '' },
    managerRuntimeSettings: {
      getRoleSettings: async () => null
    }
  };

  const effectiveA = await getEffectiveAllowedGuildId(emptyServices.config, emptyServices);
  assert.strictEqual(effectiveA, '', 'Effective guild should be empty when unconfigured');

  let replyPayload = null;
  const mockInteractionA = {
    guildId: '111222333444555666',
    commandName: 'bots',
    user: { id: 'stranger_user' },
    isChatInputCommand: () => true,
    reply: async (p) => { replyPayload = p; }
  };

  const rejectedA = await rejectOutsideGuild(mockInteractionA, logger, emptyServices.config, emptyServices);
  assert.strictEqual(rejectedA, true, 'Empty guild config must reject general commands fail-closed (DISCORD-01)');
  assert.ok(replyPayload, 'Rejected unconfigured guild command must reply ephemerally');

  const setupInteractionA = {
    guildId: '111222333444555666',
    commandName: 'admin',
    user: { id: 'admin_cfg_1' },
    options: { getSubcommand: () => 'setup' },
    isChatInputCommand: () => true,
    reply: async () => {}
  };
  const rejectedSetupA = await rejectOutsideGuild(
    setupInteractionA,
    logger,
    { discordGuildId: '', adminUserId: 'admin_cfg_1' },
    { config: { discordGuildId: '', adminUserId: 'admin_cfg_1' }, managerRuntimeSettings: emptyServices.managerRuntimeSettings }
  );
  assert.strictEqual(rejectedSetupA, false, 'Configured adminUserId running /admin setup must be allowed even before guild setup');

  // Case B: Dynamic guild configured in DB via /admin setup
  const dynamicServices = {
    config: { discordGuildId: '' },
    managerRuntimeSettings: {
      getRoleSettings: async () => ({
        guildId: '999888777666555444',
        adminRoleId: '111',
        userRoleId: '222'
      })
    }
  };

  const effectiveB = await getEffectiveAllowedGuildId(dynamicServices.config, dynamicServices);
  assert.strictEqual(effectiveB, '999888777666555444', 'Must resolve guild from managerRuntimeSettings');

  // Correct guild
  const mockInteractionBAllowed = {
    guildId: '999888777666555444',
    isChatInputCommand: () => true,
    reply: async () => {}
  };
  const rejectedB1 = await rejectOutsideGuild(mockInteractionBAllowed, logger, dynamicServices.config, dynamicServices);
  assert.strictEqual(rejectedB1, false, 'Interaction from configured dynamic guild must be allowed');

  // Unauthorized guild
  let blockedReply = null;
  const mockInteractionBBlocked = {
    guildId: '123456789012345678',
    isChatInputCommand: () => true,
    reply: async (p) => { blockedReply = p; }
  };
  const rejectedB2 = await rejectOutsideGuild(mockInteractionBBlocked, logger, dynamicServices.config, dynamicServices);
  assert.strictEqual(rejectedB2, true, 'Interaction from different guild must be rejected');
  assert.ok(blockedReply.content.includes('available only in its configured Discord server'));

  // Panel interaction dynamic rejection
  let panelReply = null;
  const mockPanelInteraction = {
    guildId: '123456789012345678',
    user: { id: 'user1' },
    reply: async (p) => { panelReply = p; },
    editReply: async (p) => { panelReply = p; }
  };
  await handlePanelInteraction(mockPanelInteraction, dynamicServices);
  assert.ok(panelReply?.content?.includes('available only in its configured Discord server'));
});

test('M2-03: ManagerRuntimeSettings getRoleSettings method returns stored settings', async () => {
  const store = {
    settings: {
      discord_access: {
        guildId: '123456789012345678',
        adminRoleId: 'admin_role_1',
        userRoleId: 'user_role_1',
        adminUserId: 'admin_user_1'
      }
    },
    async getSetting(k) { return this.settings[k] || null; },
    async setSetting(k, v) { this.settings[k] = v; }
  };

  const runtimeSettings = new ManagerRuntimeSettings({
    store,
    encryptionKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  });

  const roles = await runtimeSettings.getRoleSettings();
  assert.ok(roles);
  assert.strictEqual(roles.guildId, '123456789012345678');
  assert.strictEqual(roles.adminRoleId, 'admin_role_1');
  assert.strictEqual(roles.userRoleId, 'user_role_1');
});

test('M2-04: Worker secret length validation (>= 32 chars) in registry and API', async () => {
  const mockStore = {
    workers: new Map(),
    async nextBotNumber() { return 1; },
    async get(id) { return this.workers.get(id) || null; },
    async create(rec) { this.workers.set(rec.workerId, rec); },
    async set(id, rec) { this.workers.set(id, rec); },
    async update(id, patch) {
      const cur = this.workers.get(id);
      if (cur) Object.assign(cur, patch);
    }
  };

  const registry = new WorkerRegistry({
    store: mockStore,
    encryptionKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    logger: createMockLogger()
  });

  // Short secret (< 32 characters) must be rejected
  await assert.rejects(
    async () => {
      await registry.add({
        workerId: 'test-short',
        secret: 'too-short-secret'
      });
    },
    /Worker secret must be at least 32 characters/
  );

  // Empty string secret ("") must be rejected (not auto-generated)
  await assert.rejects(
    async () => {
      await registry.add({
        workerId: 'test-empty',
        secret: ''
      });
    },
    /Worker secret must be at least 32 characters/
  );

  // Whitespace-only secret must be rejected
  await assert.rejects(
    async () => {
      await registry.add({
        workerId: 'test-whitespace',
        secret: '   '
      });
    },
    /Worker secret must be at least 32 characters/
  );

  // Non-string secret (boolean/number) must be rejected
  await assert.rejects(
    async () => {
      await registry.add({
        workerId: 'test-bool',
        secret: false
      });
    },
    /Worker secret must be at least 32 characters/
  );

  // Valid secret (>= 32 characters) must be accepted
  const validSecret = 'valid-custom-secret-key-that-is-at-least-32-chars-long';
  const added = await registry.add({
    workerId: 'test-valid',
    secret: validSecret
  });
  assert.strictEqual(added.secret, validSecret);

  // setSecret with short secret must be rejected
  await assert.rejects(
    async () => {
      await registry.setSecret('test-valid', 'short');
    },
    /Worker secret must be at least 32 characters/
  );

  // setSecret with empty string secret must be rejected
  await assert.rejects(
    async () => {
      await registry.setSecret('test-valid', '');
    },
    /Worker secret must be at least 32 characters/
  );

  // setSecret with whitespace secret must be rejected
  await assert.rejects(
    async () => {
      await registry.setSecret('test-valid', '   ');
    },
    /Worker secret must be at least 32 characters/
  );
});

test('M2-05: Customer reset dispatches stop to worker broker before wiping data', async () => {
  const stoppedWorkers = [];
  const resetWorkers = [];

  const testWorker = {
    workerId: 'bot-reset-01',
    botNumber: 1,
    name: 'Reset Bot 1',
    provider: 'wispbyte',
    enabled: true,
    status: { state: 'online' }
  };

  const mockRegistry = {
    find: async (id) => (id === 'bot-reset-01' ? testWorker : null),
    findByNumber: async (n) => (n === 1 ? testWorker : null),
    resetData: async (id) => { resetWorkers.push(id); }
  };

  const mockBroker = {
    dispatch: async (id, action) => {
      if (action === 'stop') stoppedWorkers.push(id);
      return { ok: true, delivered: true, result: { ok: true } };
    }
  };

  const mockStore = {
    addAudit: async () => {}
  };

  const { createAdminApi } = require('../src/http/routes/admin-api');
  const adminRouter = createAdminApi({
    store: mockStore,
    entitlementService: {},
    registry: mockRegistry,
    broker: mockBroker,
    fleetOperations: {},
    adminNotifier: null,
    config: {},
    logger: createMockLogger()
  });

  const app = express();
  app.use(express.json());
  // Inject mock admin session
  app.use((req, _res, next) => {
    req.managerAuthSession = { username: 'admin', role: 'admin' };
    next();
  });
  app.use('/api/admin', adminRouter);

  const server = http.createServer(app);
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/bot/bot-reset-01/reset-customer`, {
      method: 'POST'
    });
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.ok, true);

    // Verify stop was dispatched
    assert.deepStrictEqual(stoppedWorkers, ['bot-reset-01'], 'broker.dispatch("stop") must be called on reset-customer');
    assert.deepStrictEqual(resetWorkers, ['bot-reset-01'], 'registry.resetData must be called on reset-customer');
  } finally {
    server.close();
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  }
});

test('M2-06: Custom worker secret < 32 chars rejected with 400 Bad Request via admin API', async () => {
  const { createAdminApi } = require('../src/http/routes/admin-api');
  const mockRegistry = {
    add: async () => { throw new Error('Should not be called'); }
  };

  const adminRouter = createAdminApi({
    store: {},
    entitlementService: {},
    registry: mockRegistry,
    broker: {},
    fleetOperations: {},
    adminNotifier: null,
    config: {},
    logger: createMockLogger()
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.managerAuthSession = { username: 'admin', role: 'admin' };
    next();
  });
  app.use('/api/admin', adminRouter);

  const server = http.createServer(app);
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const port = server.address().port;

  try {
    // 1. Short secret (< 32 chars) rejected with 400
    const resShort = await fetch(`http://127.0.0.1:${port}/api/admin/bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Bot Short',
        secret: 'short_secret'
      })
    });
    assert.strictEqual(resShort.status, 400, 'Secret < 32 chars must return 400 Bad Request');
    const jsonShort = await resShort.json();
    assert.strictEqual(jsonShort.ok, false);
    assert.strictEqual(jsonShort.error, 'Worker secret must be at least 32 characters');

    // 2. Empty string secret ("") rejected with 400
    const resEmpty = await fetch(`http://127.0.0.1:${port}/api/admin/bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Bot Empty',
        secret: ''
      })
    });
    assert.strictEqual(resEmpty.status, 400, 'Secret "" must return 400 Bad Request');
    const jsonEmpty = await resEmpty.json();
    assert.strictEqual(jsonEmpty.ok, false);
    assert.strictEqual(jsonEmpty.error, 'Worker secret must be at least 32 characters');

    // 3. Whitespace-only secret rejected with 400
    const resWhitespace = await fetch(`http://127.0.0.1:${port}/api/admin/bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Bot Whitespace',
        secret: '   '
      })
    });
    assert.strictEqual(resWhitespace.status, 400, 'Whitespace secret must return 400 Bad Request');
    const jsonWhitespace = await resWhitespace.json();
    assert.strictEqual(jsonWhitespace.ok, false);
    assert.strictEqual(jsonWhitespace.error, 'Worker secret must be at least 32 characters');

    // 4. secretKey empty string rejected with 400
    const resSecretKeyEmpty = await fetch(`http://127.0.0.1:${port}/api/admin/bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Bot SecretKey Empty',
        secretKey: ''
      })
    });
    assert.strictEqual(resSecretKeyEmpty.status, 400, 'secretKey "" must return 400 Bad Request');
    const jsonSecretKeyEmpty = await resSecretKeyEmpty.json();
    assert.strictEqual(jsonSecretKeyEmpty.ok, false);
    assert.strictEqual(jsonSecretKeyEmpty.error, 'Worker secret must be at least 32 characters');
  } finally {
    server.close();
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  }
});
