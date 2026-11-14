'use strict';

const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

// Target units under test
const { isUserAdmin } = require('../src/discord/handlers/interaction-handler');
const adminCommand = require('../src/discord/commands/admin');
const { AdminNotifier, escapeTelegramHtml } = require('../src/services/admin-notifier');
const { createApp } = require('../src/http/app');
const { createUserApi } = require('../src/http/routes/user-api');

function createSilentLogger() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {}
  };
}

// ============================================================================
// 1. DIS-12-01: Unified Discord Admin Authorization Tests
// ============================================================================
async function testDIS1201UnifiedAdminAuthorization() {
  console.log('1. Testing DIS-12-01: Unified Discord Admin Authorization...');

  const baseInteraction = {
    user: { id: 'user_regular_123' },
    guild: { ownerId: 'guild_owner_999' },
    memberPermissions: {
      has: (perm) => false
    },
    member: {
      permissions: {
        has: (perm) => false
      }
    }
  };

  const baseServices = {
    config: { adminUserId: 'config_admin_111' },
    accessControl: {
      adminUserId: 'access_admin_222',
      roleFor: (member, interaction) => 'user'
    }
  };

  // Test 1: Config adminUserId match
  const interConfigAdmin = { ...baseInteraction, user: { id: 'config_admin_111' } };
  assert.strictEqual(isUserAdmin(interConfigAdmin, baseServices), true, 'services.config.adminUserId must authorize admin');

  // Test 2: AccessControl adminUserId match
  const interAccessAdmin = { ...baseInteraction, user: { id: 'access_admin_222' } };
  assert.strictEqual(isUserAdmin(interAccessAdmin, baseServices), true, 'services.accessControl.adminUserId must authorize admin');

  // Test 3: Server Guild Owner
  const interOwner = { ...baseInteraction, user: { id: 'guild_owner_999' } };
  assert.strictEqual(isUserAdmin(interOwner, baseServices), true, 'interaction.guild.ownerId must authorize admin');

  // Test 4a: Discord Administrator permission string ('Administrator')
  const interAdminPermStr = {
    ...baseInteraction,
    memberPermissions: {
      has: (perm) => perm === 'Administrator'
    }
  };
  assert.strictEqual(isUserAdmin(interAdminPermStr, baseServices), true, 'interaction.memberPermissions Administrator string must authorize');

  // Test 4b: Discord Administrator permission bitflag (8n)
  const interAdminPermBit = {
    ...baseInteraction,
    memberPermissions: {
      has: (perm) => perm === 8n
    }
  };
  assert.strictEqual(isUserAdmin(interAdminPermBit, baseServices), true, 'interaction.memberPermissions 8n bitflag must authorize');

  // Test 4c: Member permission fallback
  const interMemberPerm = {
    ...baseInteraction,
    member: {
      permissions: {
        has: (perm) => perm === 'Administrator' || perm === 8n
      }
    }
  };
  assert.strictEqual(isUserAdmin(interMemberPerm, baseServices), true, 'interaction.member.permissions fallback must authorize');

  // Test 5: Configured Manager Admin Role
  const servicesRoleAdmin = {
    ...baseServices,
    accessControl: {
      ...baseServices.accessControl,
      roleFor: () => 'admin'
    }
  };
  assert.strictEqual(isUserAdmin(baseInteraction, servicesRoleAdmin), true, 'services.accessControl.roleFor === admin must authorize');

  // Test 6: Linked database user role
  const linkedAdminUser = { id: 'db_usr_1', role: 'admin' };
  assert.strictEqual(isUserAdmin(baseInteraction, baseServices, linkedAdminUser), true, 'Linked user role admin must authorize');

  // Test 7: Non-admin rejection
  const regularUser = { id: 'db_usr_2', role: 'user' };
  assert.strictEqual(isUserAdmin(baseInteraction, baseServices, regularUser), false, 'Regular user without any admin credentials must be rejected');

  // Test 8: admin.js command execution parity
  const interactionDenied = {
    user: { id: 'user_regular_123' },
    guild: { ownerId: 'other_owner' },
    options: { getSubcommand: () => 'status' }
  };
  const deniedRes = await adminCommand.execute(interactionDenied, baseServices);
  assert.ok(deniedRes?.embeds?.[0]?.data?.title?.includes('TỪ CHỐI TRUY CẬP'), 'admin.js must reject unauthorized user');

  const interactionAllowed = {
    user: { id: 'config_admin_111' },
    guild: { ownerId: 'other_owner' },
    options: { getSubcommand: () => 'status' }
  };
  const allowedRes = await adminCommand.execute(interactionAllowed, {
    ...baseServices,
    registry: { list: async () => [] },
    client: { isReady: () => true }
  });
  assert.ok(allowedRes?.embeds?.[0]?.data?.title?.includes('ADMIN'), 'admin.js must accept authorized admin');

  console.log('✅ DIS-12-01: Unified Discord Admin Authorization verified with 100% parity.');
}

// ============================================================================
// 2. DIS-12-02: Safe Discord Client Check & Deep /admin health Probe Tests
// ============================================================================
async function testDIS1202DeepAdminHealthProbe() {
  console.log('2. Testing DIS-12-02: Safe Discord Client Check & Deep /admin health Probe...');

  const baseInteraction = {
    user: { id: 'admin_test_id' },
    guild: { ownerId: 'admin_test_id' },
    options: { getSubcommand: () => 'health' }
  };

  // Test 1: Safe client check when client is null/undefined
  const servicesNoClient = {
    config: { adminUserId: 'admin_test_id' },
    registry: { list: async () => [] },
    commandBroker: { pendingResults: new Map() }
  };
  const healthRes1 = await adminCommand.execute(baseInteraction, servicesNoClient);
  assert.strictEqual(healthRes1.probe.discordReady, false, 'Missing client must safely evaluate to discordReady: false without throwing');
  assert.strictEqual(healthRes1.probe.discordPing, -1);

  // Test 2: Deep health probe metrics
  const mockWorkers = [
    { workerId: 'bot-1', reachable: true, status: { online: true } },
    { workerId: 'bot-2', reachable: false, status: { online: false }, lastHeartbeat: new Date().toISOString() }, // fresh heartbeat -> reachable
    { workerId: 'bot-3', reachable: false, status: { online: false }, lastHeartbeat: new Date(Date.now() - 300000).toISOString() } // stale -> unreachable
  ];

  const pendingMap = new Map();
  pendingMap.set('cmd_1', { action: 'chat' });
  pendingMap.set('cmd_2', { action: 'inventory' });

  const mockStore = {
    adapter: {
      testConnection: async () => {
        await new Promise((r) => setTimeout(r, 10));
        return { ok: true };
      }
    }
  };

  const servicesFull = {
    config: { adminUserId: 'admin_test_id' },
    store: mockStore,
    registry: { list: async () => mockWorkers },
    commandBroker: { pendingResults: pendingMap },
    discordClient: {
      isReady: () => true,
      ws: { ping: 25 }
    }
  };

  const healthRes = await adminCommand.execute(baseInteraction, servicesFull);
  assert.ok(healthRes?.embeds?.[0]?.data?.title?.includes('HEALTH PROBE'), 'Health probe must return dedicated HEALTH PROBE embed');
  assert.strictEqual(healthRes.probe.dbOk, true, 'Database test connection must report ok');
  assert.ok(healthRes.probe.dbLatencyMs >= 0, 'Database latency must be measured');
  assert.strictEqual(healthRes.probe.pendingQueueCount, 2, 'Pending queue count must equal pendingResults.size');
  assert.strictEqual(healthRes.probe.discordReady, true, 'Discord client must report ready');
  assert.strictEqual(healthRes.probe.discordPing, 25, 'Discord ping must match client.ws.ping');
  assert.strictEqual(healthRes.probe.totalWorkers, 3, 'Total workers must equal 3');
  assert.strictEqual(healthRes.probe.reachableWorkers, 2, 'Reachable workers must equal 2 (bot-1 online + bot-2 fresh heartbeat)');

  // Test 3: Status vs Health distinction
  const statusInteraction = {
    ...baseInteraction,
    options: { getSubcommand: () => 'status' }
  };
  const statusRes = await adminCommand.execute(statusInteraction, servicesFull);
  assert.strictEqual(Boolean(statusRes.probe), false, 'subcommand === status must return standard status view, not deep probe');
  assert.ok(statusRes?.embeds?.[0]?.data?.title?.includes('BẢNG ĐIỀU KHIỂN HỆ THỐNG — ADMIN'), 'Status must return admin dashboard embed');

  console.log('✅ DIS-12-02: Safe Discord Client Check & Deep /admin health Probe verified.');
}

// ============================================================================
// 3. DIS-12-03: Telegram HTML Escaping in AdminNotifier Tests
// ============================================================================
async function testDIS1203TelegramHtmlEscaping() {
  console.log('3. Testing DIS-12-03: Telegram HTML Escaping in AdminNotifier...');

  // Unit tests for escapeTelegramHtml
  assert.strictEqual(escapeTelegramHtml('hello & world'), 'hello &amp; world');
  assert.strictEqual(escapeTelegramHtml('<script>alert("xss")</script>'), '&lt;script&gt;alert("xss")&lt;/script&gt;');
  assert.strictEqual(escapeTelegramHtml('A < B && B > C'), 'A &lt; B &amp;&amp; B &gt; C');
  assert.strictEqual(escapeTelegramHtml(null), '');
  assert.strictEqual(escapeTelegramHtml(undefined), '');

  // Integration test in dispatchTelegram
  let capturedTelegramBody = null;
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).includes('api.telegram.org')) {
      capturedTelegramBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    return originalFetch(url, opts);
  };

  try {
    const notifier = new AdminNotifier({
      telegramBotToken: 'mock_token',
      telegramChatId: '12345678'
    });

    await notifier.dispatchTelegram({
      source: 'Worker<Node & Host>',
      event: 'bot_crash<segfault>',
      message: 'Failed on <anonymous>: syntax error & broken state',
      details: {
        rawError: 'TypeError: <undefined> & <null>',
        code: 500
      },
      level: 'error'
    });

    assert.ok(capturedTelegramBody, 'Telegram request must be sent');
    const sentText = capturedTelegramBody.text;

    // Verify raw special characters are not present in unescaped form
    assert.ok(!sentText.includes('<anonymous>'), 'Unescaped <anonymous> must not be in sent HTML');
    assert.ok(sentText.includes('&lt;anonymous&gt;'), 'Escaped &lt;anonymous&gt; must be present');
    assert.ok(sentText.includes('&lt;segfault&gt;'), 'Escaped &lt;segfault&gt; must be present');
    assert.ok(sentText.includes('&amp;'), '& must be escaped to &amp;');
    assert.strictEqual(capturedTelegramBody.parse_mode, 'HTML');
  } finally {
    global.fetch = originalFetch;
  }

  console.log('✅ DIS-12-03: Telegram HTML Escaping verified.');
}

// ============================================================================
// 4. DIS-12-04: AdminNotifier response.ok & Exponential Backoff Retry Queue Tests
// ============================================================================
async function testDIS1204RetryQueueExponentialBackoff() {
  console.log('4. Testing DIS-12-04: AdminNotifier response.ok & Exponential Backoff Retry Queue...');

  let fetchCalls = 0;
  let forceFail = true;
  const originalFetch = global.fetch;

  global.fetch = async (url, opts) => {
    if (String(url).includes('api.telegram.org')) {
      fetchCalls++;
      if (forceFail) {
        return { ok: false, status: 502, statusText: 'Bad Gateway' };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    return originalFetch(url, opts);
  };

  try {
    const notifier = new AdminNotifier({
      telegramBotToken: 'mock_token',
      telegramChatId: '12345678',
      logger: createSilentLogger()
    });

    // Test 1: dispatchTelegram throws on !response.ok
    await assert.rejects(
      async () => {
        await notifier.dispatchTelegram({
          source: 'Test',
          event: 'fail_test',
          message: 'Should throw',
          level: 'error'
        });
      },
      /Telegram API responded with HTTP 502/,
      'dispatchTelegram must reject when response.ok is false'
    );

    // Test 2: Failed dispatch is placed into retryQueue with exponential backoff
    const item = { source: 'Outbox', event: 'worker_timeout', message: 'Worker unreachable', level: 'error' };
    notifier.queue.push({ item, channels: ['telegram'], retries: 0 });

    await notifier.processQueue();

    assert.strictEqual(notifier.retryQueue.length, 1, 'Failed dispatch must be enqueued into retryQueue');
    const retry1 = notifier.retryQueue[0];
    assert.strictEqual(retry1.retries, 1, 'First retry count must be 1');
    assert.strictEqual(retry1.delayMs, 1000, 'First retry delay must be 1000ms');

    // Test 3: Second failure scales backoff
    forceFail = true;
    retry1.scheduledAt = Date.now() - 10; // make immediately ready
    await notifier.processRetryQueue();

    assert.strictEqual(notifier.retryQueue.length, 1);
    const retry2 = notifier.retryQueue[0];
    assert.strictEqual(retry2.retries, 2, 'Second retry count must be 2');
    assert.strictEqual(retry2.delayMs, 2000, 'Second retry delay must be 2000ms (1000 * 2^1)');

    // Test 4: Success on retry empties retryQueue
    forceFail = false;
    retry2.scheduledAt = Date.now() - 10; // ready
    await notifier.processRetryQueue();

    assert.strictEqual(notifier.retryQueue.length, 0, 'Successful retry must clear item from retryQueue');
  } finally {
    global.fetch = originalFetch;
  }

  console.log('✅ DIS-12-04: response.ok Verification & Exponential Backoff Retry Queue verified.');
}

// ============================================================================
// 5. DIS-12-05: Alert Rate Limiting during System Outages Tests
// ============================================================================
async function testDIS1205OutageRateLimiting() {
  console.log('5. Testing DIS-12-05: Alert Rate Limiting during System Outages...');

  const notifier = new AdminNotifier({
    logger: createSilentLogger()
  });
  notifier.batchWaitMs = 10; // fast batching for test

  // Generate 25 distinct alerts rapidly (exceeding maxAlertsPerWindow = 15)
  for (let i = 1; i <= 25; i++) {
    await notifier.sendAlert({
      source: `Worker-${i}`,
      event: `connection_lost_${i}`,
      message: `Worker ${i} connection dropped`,
      level: 'error'
    });
  }

  // 15 alerts should be accepted into window; 10 should be buffered
  assert.strictEqual(notifier.alertTimestamps.length, 15, 'Sliding window must record exactly 15 alerts within 60s window');
  assert.strictEqual(notifier.throttledBuffer.length, 10, 'Remaining 10 alerts must be buffered in throttledBuffer');
  assert.strictEqual(notifier.rateLimitNoticeEmitted, true, 'Rate limit notice flag must be active');

  // Verify rate limit notice was added to pendingBatch
  const notice = notifier.pendingBatch.find((item) => item.event === 'alert_rate_limiting_active');
  assert.ok(notice, 'A rate-limit warning item must be emitted when throttling engages');

  // Fast forward timestamps outside the window
  notifier.alertTimestamps = [];
  notifier.checkThrottledBuffer();

  assert.strictEqual(notifier.throttledBuffer.length, 0, 'checkThrottledBuffer must drain buffered alerts when window clears');
  const findSummary = (list) => {
    for (const entry of list) {
      const it = entry.item || entry;
      if (it.event === 'rate_limit_cleared_summary') return it;
      if (Array.isArray(it.items)) {
        const found = it.items.find((sub) => sub.event === 'rate_limit_cleared_summary');
        if (found) return found;
      }
    }
    return null;
  };

  const summaryItem = findSummary(notifier.sentAlerts) ||
                      findSummary(notifier.queue) ||
                      findSummary(notifier.pendingBatch);
  assert.ok(summaryItem, 'Summary batch item must be emitted when rate limiting clears');
  assert.strictEqual(summaryItem.batchCount, 10, 'Summary must aggregate all 10 previously throttled alerts');

  console.log('✅ DIS-12-05: Outage Alert Rate Limiting & Aggregation verified.');
}

// ============================================================================
// 6. API-01: Mount userRouter Strictly at /api/user Tests
// ============================================================================
async function testAPI01MountUserRouterStrictly() {
  console.log('6. Testing API-01: Mount userRouter Strictly at /api/user...');

  const app = createApp({
    store: {
      cachedAnnouncement: 'Test Announcement',
      listAccess: async () => [],
      getAccess: async () => null,
      setAccess: async () => ({})
    },
    registry: {
      list: async () => [],
      verifyBotSecretSync: () => false
    },
    config: {
      adminUsername: 'admin',
      adminPassword: 'admin_password'
    },
    logger: createSilentLogger()
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. Strict mount at /api/user/announcement (accessible via requireSession mock or endpoint check)
    // /api/user/bots without session cookie -> must return 401 (proves userRouter is mounted at /api/user)
    const userRes = await fetch(`${base}/api/user/bots`);
    assert.strictEqual(userRes.status, 401, 'GET /api/user/bots must reach userRouter (401 without session)');
    const userJson = await userRes.json();
    assert.strictEqual(userJson.ok, false);

    // 2. Erroneous alias /api/manager must NOT hit userRouter! It must reach adminRouter (403 admin auth required)
    const adminRes = await fetch(`${base}/api/manager/bots`);
    assert.strictEqual(adminRes.status, 403, 'GET /api/manager/bots must reach adminRouter (403 admin auth required), not userRouter');
    const adminJson = await adminRes.json();
    assert.strictEqual(adminJson.ok, false);

    // 3. Removed alias /api/bots must return 404 (not shadowed by userRouter)
    const bareApiRes = await fetch(`${base}/api/bots`);
    assert.strictEqual(bareApiRes.status, 404, 'GET /api/bots must return 404 since userRouter is not mounted at /api');

  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('✅ API-01: userRouter Strictly Mounted at /api/user verified.');
}

// ============================================================================
// 7. API-02: Gated CSRF Exemption for Worker Routes Tests
// ============================================================================
async function testAPI02GatedCsrfExemptionForWorkerRoutes() {
  console.log('7. Testing API-02: Gated CSRF Exemption for Worker Routes...');

  const validSecret = 'test_worker_secret_123';
  const app = createApp({
    store: {},
    registry: {
      verifyBotSecretSync: (botId, secret) => botId === 'bot-1' && secret === validSecret
    },
    config: {
      botSecretKey: 'global_bot_secret_xyz'
    },
    logger: createSilentLogger()
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // Attack scenario: Browser cross-origin mutation without worker secret or bearer token
    const attackerRes = await fetch(`${base}/api/worker/report`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'host': `127.0.0.1:${port}`,
        'origin': 'https://evil-attacker-website.com'
      },
      body: JSON.stringify({ workerId: 'bot-1', status: 'online' })
    });

    assert.strictEqual(attackerRes.status, 403, 'Cross-origin worker POST without credentials must be blocked by CSRF (HTTP 403)');
    const attackerJson = await attackerRes.json();
    assert.ok(attackerJson.error.includes('CSRF'), 'Error message must cite CSRF protection');

    // Legitimate scenario A: Worker request with valid x-worker-secret
    const secretRes = await fetch(`${base}/api/worker/report`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'host': `127.0.0.1:${port}`,
        'origin': 'https://evil-attacker-website.com', // even if origin header exists, secret exempts it
        'x-worker-secret': validSecret,
        'x-manager-bot-id': 'bot-1'
      },
      body: JSON.stringify({ workerId: 'bot-1', status: 'online' })
    });
    assert.notStrictEqual(secretRes.status, 403, 'Request with valid x-worker-secret must NOT be blocked by CSRF');

    // Legitimate scenario B: Worker request with valid Bearer token
    const bearerRes = await fetch(`${base}/api/worker/report`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'host': `127.0.0.1:${port}`,
        'origin': 'https://external-service.net',
        'authorization': 'Bearer worker_token_abc123'
      },
      body: JSON.stringify({ workerId: 'bot-1', status: 'online' })
    });
    assert.notStrictEqual(bearerRes.status, 403, 'Request with valid Bearer token must NOT be blocked by CSRF');

  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('✅ API-02: Gated CSRF Exemption for Worker Routes verified.');
}

// ============================================================================
// 8. API-03: Bot Schedules Array Validation Tests
// ============================================================================
async function testAPI03BotSchedulesArrayValidation() {
  console.log('8. Testing API-03: Bot Schedules Array Validation...');

  let savedSettings = null;
  const mockRegistry = {
    find: async (id) => ({ workerId: id, botNumber: 1 }),
    updateSettings: async (id, settings) => {
      savedSettings = { id, settings };
      return true;
    }
  };

  const userApp = express();
  userApp.use(express.json());
  userApp.use((req, res, next) => {
    req.managerAuthSession = {
      userId: 'usr_test',
      username: 'testuser',
      role: 'user',
      assignedBotIds: ['bot-test-1']
    };
    next();
  });
  userApp.use('/api/user', createUserApi({
    store: {},
    registry: mockRegistry,
    logger: createSilentLogger()
  }));

  const server = http.createServer(userApp);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/api/user`;

  try {
    // 1. auto-chat invalid: string
    const resString = await fetch(`${base}/bot/bot-test-1/auto-chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ autoChatSchedules: 'invalid_string' })
    });
    assert.strictEqual(resString.status, 400, 'Non-array autoChatSchedules string must return HTTP 400');
    const jsonString = await resString.json();
    assert.strictEqual(jsonString.error, 'Schedules must be an array.');

    // 2. auto-chat invalid: null
    const resNull = await fetch(`${base}/bot/bot-test-1/auto-chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ autoChatSchedules: null })
    });
    assert.strictEqual(resNull.status, 400, 'null autoChatSchedules must return HTTP 400');

    // 3. auto-chat valid: array
    const validAutoChat = [{ time: '12:00', message: 'Hello' }];
    const resValid = await fetch(`${base}/bot/bot-test-1/auto-chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ autoChatSchedules: validAutoChat })
    });
    assert.strictEqual(resValid.status, 200);
    assert.deepStrictEqual(savedSettings.settings.autoChatSchedules, validAutoChat);

    // 4. bot-schedules invalid: object
    const resObj = await fetch(`${base}/bot/bot-test-1/bot-schedules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ botSchedules: { foo: 'bar' } })
    });
    assert.strictEqual(resObj.status, 400, 'Object botSchedules must return HTTP 400');
    const jsonObj = await resObj.json();
    assert.strictEqual(jsonObj.error, 'Schedules must be an array.');

    // 5. bot-schedules valid: array
    const validBotSched = [{ hour: 8, action: 'reconnect' }];
    const resValidSched = await fetch(`${base}/bot/bot-test-1/bot-schedules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ botSchedules: validBotSched })
    });
    assert.strictEqual(resValidSched.status, 200);
    assert.deepStrictEqual(savedSettings.settings.botSchedules, validBotSched);

  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('✅ API-03: Bot Schedules Array Validation verified.');
}

// ============================================================================
// 9. API-04: Real Database Persistence for /bots/reorder Tests
// ============================================================================
async function testAPI04BotsReorderDatabasePersistence() {
  console.log('9. Testing API-04: Real Database Persistence for /bots/reorder...');

  let setAccessCalledWith = null;
  const mockStore = {
    setAccess: async (userId, data, actor) => {
      setAccessCalledWith = { userId, data, actor };
      return { ok: true };
    }
  };

  const testSession = {
    userId: 'usr_reorder_1',
    username: 'reorderuser',
    role: 'user',
    assignedBotIds: ['bot-1', 'bot-2', 'bot-3']
  };

  const userApp = express();
  userApp.use(express.json());
  userApp.use((req, res, next) => {
    req.managerAuthSession = testSession;
    next();
  });
  userApp.use('/api/user', createUserApi({
    store: mockStore,
    registry: { list: async () => [] },
    logger: createSilentLogger()
  }));

  const server = http.createServer(userApp);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/api/user`;

  try {
    // 1. Validation rejection on non-array
    const resInvalid = await fetch(`${base}/bots/reorder`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ botIds: 'not-an-array' })
    });
    assert.strictEqual(resInvalid.status, 400, 'Non-array botIds must return HTTP 400');

    // 2. Validation rejection on empty array
    const resEmpty = await fetch(`${base}/bots/reorder`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ botIds: [] })
    });
    assert.strictEqual(resEmpty.status, 400, 'Empty array botIds must return HTTP 400');

    // 3. Validation rejection on non-string items
    const resNonString = await fetch(`${base}/bots/reorder`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ botIds: [123, 456] })
    });
    assert.strictEqual(resNonString.status, 400, 'Array with non-string elements must return HTTP 400');

    // 4. Unauthorized bot ID not in session.assignedBotIds
    const resUnauthorized = await fetch(`${base}/bots/reorder`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ botIds: ['bot-1', 'bot-unauthorized-99'] })
    });
    assert.strictEqual(resUnauthorized.status, 403, 'Submitting unassigned bot IDs must return HTTP 403');

    // 5. Valid reorder
    const newOrder = ['bot-3', 'bot-1', 'bot-2'];
    const resSuccess = await fetch(`${base}/bots/reorder`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ botIds: newOrder })
    });
    assert.strictEqual(resSuccess.status, 200, 'Valid reorder must return HTTP 200');
    const successJson = await resSuccess.json();
    assert.strictEqual(successJson.ok, true);
    assert.deepStrictEqual(successJson.order, newOrder, 'Response must return updated order');

    // Verify DB persistence via store.setAccess
    assert.ok(setAccessCalledWith, 'store.setAccess must be invoked with updated order');
    assert.strictEqual(setAccessCalledWith.userId, 'usr_reorder_1');
    assert.deepStrictEqual(setAccessCalledWith.data.workerIds, newOrder);

    // Verify in-memory session was updated
    assert.deepStrictEqual(testSession.assignedBotIds, newOrder, 'session.assignedBotIds must be updated in-memory');

  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('✅ API-04: Real Database Persistence for /bots/reorder verified.');
}

// ============================================================================
// MAIN RUNNER
// ============================================================================
async function runAllGate3M3Tests() {
  console.log('===============================================================');
  console.log('--- GATE 3 MILESTONE 3: DISCORD ADMIN & ROUTER SECURITY TESTS ---');
  console.log('===============================================================');

  await testDIS1201UnifiedAdminAuthorization();
  await testDIS1202DeepAdminHealthProbe();
  await testDIS1203TelegramHtmlEscaping();
  await testDIS1204RetryQueueExponentialBackoff();
  await testDIS1205OutageRateLimiting();
  await testAPI01MountUserRouterStrictly();
  await testAPI02GatedCsrfExemptionForWorkerRoutes();
  await testAPI03BotSchedulesArrayValidation();
  await testAPI04BotsReorderDatabasePersistence();

  console.log('===============================================================');
  console.log('🎉 ALL GATE 3 MILESTONE 3 (DIS-12-01..05, API-01..04) TESTS PASSED 100%!');
  console.log('===============================================================');
}

runAllGate3M3Tests().catch((err) => {
  console.error('❌ Gate 3 Milestone 3 Test Suite Failed:', err);
  process.exit(1);
});
