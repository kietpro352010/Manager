'use strict';

const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

// Units under test
const { sanitizeBackupPayload, SupabaseAdapter } = require('../src/storage/supabase-client');
const { createAdminApi } = require('../src/http/routes/admin-api');
const { AdminNotifier, escapeTelegramHtml } = require('../src/services/admin-notifier');

function createSilentLogger() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {}
  };
}

// Helper to run express server during tests
async function withTestServer(app, testFn) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await testFn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// ============================================================================
// 1. P7-01: SupabaseClient saveBackup & sanitizeBackupPayload Tests
// ============================================================================
async function testP701SanitizeBackupPayloadAndSaveBackup() {
  console.log('1. Testing P7-01: SupabaseClient saveBackup & sanitizeBackupPayload...');

  // Test 1.1: sanitizeBackupPayload with null, undefined, non-object
  assert.deepStrictEqual(sanitizeBackupPayload(null), {});
  assert.deepStrictEqual(sanitizeBackupPayload(undefined), {});
  assert.deepStrictEqual(sanitizeBackupPayload('string-payload'), {});
  assert.deepStrictEqual(sanitizeBackupPayload(12345), {});

  // Test 1.2: sanitizeBackupPayload defaults missing arrays
  const emptyObjResult = sanitizeBackupPayload({});
  assert.strictEqual(Array.isArray(emptyObjResult.registry), true);
  assert.strictEqual(emptyObjResult.registry.length, 0);
  assert.strictEqual(Array.isArray(emptyObjResult.users), true);
  assert.strictEqual(emptyObjResult.users.length, 0);
  assert.strictEqual(Array.isArray(emptyObjResult.keys), true);
  assert.strictEqual(emptyObjResult.keys.length, 0);
  assert.strictEqual(typeof emptyObjResult.createdAt, 'string');
  assert.strictEqual(Number.isNaN(Date.parse(emptyObjResult.createdAt)), false);

  // Test 1.3: sanitizeBackupPayload sanitizes non-array fields to empty arrays
  const invalidTypesPayload = {
    registry: 'not-an-array',
    users: 42,
    keys: { code: 'ABC' },
    customMeta: 'preserved-value'
  };
  const sanitizedInvalid = sanitizeBackupPayload(invalidTypesPayload);
  assert.deepStrictEqual(sanitizedInvalid.registry, []);
  assert.deepStrictEqual(sanitizedInvalid.users, []);
  assert.deepStrictEqual(sanitizedInvalid.keys, []);
  assert.strictEqual(sanitizedInvalid.customMeta, 'preserved-value');
  assert.strictEqual(typeof sanitizedInvalid.createdAt, 'string');

  // Test 1.4: sanitizeBackupPayload preserves existing arrays and timestamp
  const fixedTime = '2026-11-14T08:00:00.000Z';
  const fullPayload = {
    registry: [{ workerId: 'bot-1', name: 'Bot 1' }],
    users: [{ userId: 'user-1', username: 'miner' }],
    keys: [{ keyId: 'key-1', code: 'KING-123' }],
    timestamp: fixedTime,
    customField: 'kbot-v3'
  };
  const sanitizedFull = sanitizeBackupPayload(fullPayload);
  assert.strictEqual(sanitizedFull.registry.length, 1);
  assert.strictEqual(sanitizedFull.registry[0].workerId, 'bot-1');
  assert.strictEqual(sanitizedFull.users.length, 1);
  assert.strictEqual(sanitizedFull.users[0].userId, 'user-1');
  assert.strictEqual(sanitizedFull.keys.length, 1);
  assert.strictEqual(sanitizedFull.keys[0].code, 'KING-123');
  assert.strictEqual(sanitizedFull.createdAt, fixedTime);
  assert.strictEqual(sanitizedFull.customField, 'kbot-v3');

  // Test 1.5: saveBackup does not throw ReferenceError
  const originalFetch = global.fetch;
  let fetchCalledWith = null;
  try {
    global.fetch = async (url, opts) => {
      fetchCalledWith = { url, opts, body: JSON.parse(opts.body) };
      return {
        ok: true,
        status: 201,
        json: async () => ({})
      };
    };

    const adapter = new SupabaseAdapter({
      url: 'https://test-supabase-project.supabase.co',
      key: 'test-service-key'
    });

    const backupName = 'backup-2026-11-14T12-00-00.json';
    const backupData = {
      registry: [{ workerId: 'bot-alpha' }],
      users: [{ username: 'admin' }],
      keys: []
    };

    const result = await adapter.saveBackup(backupName, backupData);
    assert.strictEqual(result, true, 'saveBackup must return true on successful fetch');
    assert.ok(fetchCalledWith, 'fetch must have been called');
    assert.ok(fetchCalledWith.url.includes('/rest/v1/manager_backups'));
    assert.strictEqual(fetchCalledWith.body[0].name, backupName);
    assert.strictEqual(fetchCalledWith.body[0].payload.registry[0].workerId, 'bot-alpha');
  } finally {
    global.fetch = originalFetch;
  }

  // Test 1.6: saveBackup returns false on empty/disabled parameters without throwing
  const unconfiguredAdapter = new SupabaseAdapter({});
  const unconfResult = await unconfiguredAdapter.saveBackup('test.json', {});
  assert.strictEqual(unconfResult, false);

  const configuredAdapter = new SupabaseAdapter({ url: 'https://test.supabase.co', key: 'key' });
  assert.strictEqual(await configuredAdapter.saveBackup('', {}), false);
  assert.strictEqual(await configuredAdapter.saveBackup('name.json', null), false);

  console.log('✅ P7-01: SupabaseClient saveBackup & sanitizeBackupPayload verified.');
}

// ============================================================================
// 2. P7-02: Backup Filename Formatting & Full Restore (Users + Keys) Tests
// ============================================================================
async function testP702BackupFilenameFormattingAndRestore() {
  console.log('2. Testing P7-02: Backup Filename Formatting & Full Restore...');

  const savedBackups = new Map();
  const restoredConfigs = [];
  const restoredUsers = [];
  const restoredKeys = [];

  const mockStore = {
    saveBackup: async (name, payload) => {
      savedBackups.set(name, payload);
      return true;
    },
    fetchBackupPayload: async (filename) => {
      return savedBackups.get(filename) || null;
    },
    fetchBackups: async () => {
      return Array.from(savedBackups.keys()).map((name) => ({ filename: name }));
    },
    listAccess: async () => [
      { userId: 'u1', username: 'player1', role: 'user', planName: 'VIP' },
      { userId: 'u2', username: 'player2', role: 'user', planName: 'Pro' }
    ],
    setAccess: async (userId, data, actor) => {
      restoredUsers.push({ userId, data, actor });
    },
    createKey: async (keyData) => {
      restoredKeys.push(keyData);
    }
  };

  const mockEntitlementService = {
    listCodes: async () => [
      { keyId: 'k1', code: 'KING-AAA', planName: 'VIP' },
      { keyId: 'k2', code: 'KING-BBB', planName: 'Pro' }
    ]
  };

  const mockRegistry = {
    list: async () => [
      { workerId: 'bot-1', name: 'Bot 1', serviceUrl: 'http://localhost:3001' },
      { workerId: 'bot-2', name: 'Bot 2', serviceUrl: 'http://localhost:3002' }
    ],
    saveConfig: async (workerId, config) => {
      restoredConfigs.push({ workerId, config });
    }
  };

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.managerAuthSession = { username: 'superadmin', role: 'admin' };
    next();
  });
  app.use('/api/manager', createAdminApi({
    store: mockStore,
    entitlementService: mockEntitlementService,
    registry: mockRegistry,
    broker: {},
    fleetOperations: {},
    adminNotifier: {},
    config: {},
    logger: createSilentLogger()
  }));

  await withTestServer(app, async (baseUrl) => {
    // Test 2.1: POST /backups/create generates backup-YYYY-MM-DDTHH-mm-ss.json
    const createRes = await fetch(`${baseUrl}/api/manager/backups/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    assert.strictEqual(createRes.status, 200);
    const createBody = await createRes.json();
    assert.strictEqual(createBody.ok, true);
    assert.ok(createBody.filename, 'filename must be returned');

    // Verify format: backup-YYYY-MM-DDTHH-mm-ss.json
    const filenameRegex = /^backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/;
    assert.ok(
      filenameRegex.test(createBody.filename),
      `Generated filename "${createBody.filename}" must match pattern backup-YYYY-MM-DDTHH-mm-ss.json`
    );

    // Verify payload was passed with registry, users, keys
    const storedPayload = savedBackups.get(createBody.filename);
    assert.ok(storedPayload);
    assert.strictEqual(storedPayload.registry.length, 2);
    assert.strictEqual(storedPayload.users.length, 2);
    assert.strictEqual(storedPayload.keys.length, 2);

    // Test 2.2: POST /backups/:filename/restore restores registry, users, and keys
    const restoreRes = await fetch(`${baseUrl}/api/manager/backups/${createBody.filename}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    assert.strictEqual(restoreRes.status, 200);
    const restoreBody = await restoreRes.json();
    assert.strictEqual(restoreBody.ok, true);

    // Verify registry restored
    assert.strictEqual(restoredConfigs.length, 2);
    assert.strictEqual(restoredConfigs[0].workerId, 'bot-1');
    assert.strictEqual(restoredConfigs[1].workerId, 'bot-2');

    // Verify users restored
    assert.strictEqual(restoredUsers.length, 2);
    assert.strictEqual(restoredUsers[0].userId, 'u1');
    assert.strictEqual(restoredUsers[0].actor, 'backup-restore');
    assert.strictEqual(restoredUsers[1].userId, 'u2');

    // Verify keys restored
    assert.strictEqual(restoredKeys.length, 2);
    assert.strictEqual(restoredKeys[0].code, 'KING-AAA');
    assert.strictEqual(restoredKeys[1].code, 'KING-BBB');

    // Test 2.3: POST /backups/:filename/restore on non-existent file returns 404
    const notFoundRes = await fetch(`${baseUrl}/api/manager/backups/backup-nonexistent.json/restore`, {
      method: 'POST'
    });
    assert.strictEqual(notFoundRes.status, 404);
    const notFoundBody = await notFoundRes.json();
    assert.strictEqual(notFoundBody.ok, false);
    assert.strictEqual(notFoundBody.error, 'Không tìm thấy bản sao lưu.');
  });

  console.log('✅ P7-02: Backup Filename Formatting & Full Restore verified.');
}

// ============================================================================
// 3. P7-03: Real Backup Deletion Endpoint Tests
// ============================================================================
async function testP703RealBackupDeletionEndpoint() {
  console.log('3. Testing P7-03: Real Backup Deletion Endpoint...');

  const existingBackups = new Set(['backup-2026-11-14T01-00-00.json', 'backup-2026-11-14T02-00-00.json']);
  const deletedFiles = [];

  const mockStore = {
    deleteBackup: async (filename) => {
      if (filename === 'backup-error.json') {
        throw new Error('Supabase Storage Disk Full');
      }
      if (!existingBackups.has(filename)) {
        return false;
      }
      existingBackups.delete(filename);
      deletedFiles.push(filename);
      return true;
    }
  };

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.managerAuthSession = { username: 'admin', role: 'admin' };
    next();
  });
  app.use('/api/manager', createAdminApi({
    store: mockStore,
    entitlementService: {},
    registry: {},
    broker: {},
    fleetOperations: {},
    adminNotifier: {},
    config: {},
    logger: createSilentLogger()
  }));

  await withTestServer(app, async (baseUrl) => {
    // Test 3.1: Successful deletion returns 200 with confirmation message
    const targetFile = 'backup-2026-11-14T01-00-00.json';
    const deleteRes = await fetch(`${baseUrl}/api/manager/backups/${targetFile}`, {
      method: 'DELETE'
    });
    assert.strictEqual(deleteRes.status, 200);
    const deleteBody = await deleteRes.json();
    assert.strictEqual(deleteBody.ok, true);
    assert.strictEqual(deleteBody.message, 'Đã xóa bản sao lưu.');
    assert.ok(deletedFiles.includes(targetFile));
    assert.strictEqual(existingBackups.has(targetFile), false);

    // Test 3.2: Non-existent backup returns 404
    const notFoundRes = await fetch(`${baseUrl}/api/manager/backups/backup-nonexistent.json`, {
      method: 'DELETE'
    });
    assert.strictEqual(notFoundRes.status, 404);
    const notFoundBody = await notFoundRes.json();
    assert.strictEqual(notFoundBody.ok, false);

    // Test 3.3: Storage error returns 500
    const errorRes = await fetch(`${baseUrl}/api/manager/backups/backup-error.json`, {
      method: 'DELETE'
    });
    assert.strictEqual(errorRes.status, 500);
    const errorBody = await errorRes.json();
    assert.strictEqual(errorBody.ok, false);
    assert.ok(errorBody.error.includes('Supabase Storage Disk Full'));
  });

  console.log('✅ P7-03: Real Backup Deletion Endpoint verified.');
}

// ============================================================================
// 4. ADM-20-01: Audit Logs Pagination & Filtering Contract Tests
// ============================================================================
async function testADM2001AuditLogsPaginationAndFiltering() {
  console.log('4. Testing ADM-20-01: Audit Logs Pagination & Filtering Contract...');

  // Create 25 realistic sample audit log records
  const sampleLogs = [];
  for (let i = 1; i <= 25; i++) {
    const isEven = i % 2 === 0;
    const category = i <= 10 ? 'security' : (i <= 20 ? 'bot_management' : 'finance');
    const status = isEven ? 'success' : 'error';
    const logType = i % 3 === 0 ? 'auth' : 'command';
    sampleLogs.push({
      id: `audit-${i}`,
      action: isEven ? 'USER_LOGIN_SUCCESS' : 'BOT_COMMAND_FAILED',
      actorId: `user_${i % 5}`,
      targetId: `target_bot_${i}`,
      category,
      status,
      logType,
      details: {
        code: `ERR_${i}`,
        ip: `192.168.1.${i}`,
        message: `Event log number ${i}`
      },
      createdAt: new Date(Date.now() - i * 60000).toISOString()
    });
  }

  const mockStore = {
    listAudit: async (limit) => sampleLogs.slice(0, limit)
  };

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.managerAuthSession = { username: 'admin', role: 'admin' };
    next();
  });
  app.use('/api/manager', createAdminApi({
    store: mockStore,
    entitlementService: {},
    registry: {},
    broker: {},
    fleetOperations: {},
    adminNotifier: {},
    config: {},
    logger: createSilentLogger()
  }));

  await withTestServer(app, async (baseUrl) => {
    // Test 4.1: Default pagination parameters (page=1, limit=50)
    const resDefault = await fetch(`${baseUrl}/api/manager/audit-logs`);
    assert.strictEqual(resDefault.status, 200);
    const dataDefault = await resDefault.json();
    assert.strictEqual(dataDefault.ok, true);
    assert.strictEqual(dataDefault.page, 1);
    assert.strictEqual(dataDefault.limit, 50);
    assert.strictEqual(dataDefault.total, 25);
    assert.strictEqual(dataDefault.totalPages, 1);
    assert.strictEqual(dataDefault.logs.length, 25);

    // Test 4.2: Explicit pagination (page=2, limit=10)
    const resPage2 = await fetch(`${baseUrl}/api/manager/audit-logs?page=2&limit=10`);
    assert.strictEqual(resPage2.status, 200);
    const dataPage2 = await resPage2.json();
    assert.strictEqual(dataPage2.page, 2);
    assert.strictEqual(dataPage2.limit, 10);
    assert.strictEqual(dataPage2.total, 25);
    assert.strictEqual(dataPage2.totalPages, 3);
    assert.strictEqual(dataPage2.logs.length, 10);
    assert.strictEqual(dataPage2.logs[0].id, 'audit-11');
    assert.strictEqual(dataPage2.logs[9].id, 'audit-20');

    // Test 4.3: Page 3 has remaining 5 items
    const resPage3 = await fetch(`${baseUrl}/api/manager/audit-logs?page=3&limit=10`);
    const dataPage3 = await resPage3.json();
    assert.strictEqual(dataPage3.page, 3);
    assert.strictEqual(dataPage3.logs.length, 5);
    assert.strictEqual(dataPage3.logs[0].id, 'audit-21');

    // Test 4.4: Query substring search 'q' across action, actor, target, details
    const resQ = await fetch(`${baseUrl}/api/manager/audit-logs?q=ERR_15`);
    const dataQ = await resQ.json();
    assert.strictEqual(dataQ.total, 1);
    assert.strictEqual(dataQ.logs[0].id, 'audit-15');

    const resActor = await fetch(`${baseUrl}/api/manager/audit-logs?q=user_3`);
    const dataActor = await resActor.json();
    assert.ok(dataActor.total > 0);
    assert.ok(dataActor.logs.every((l) => l.actorId.includes('user_3')));

    // Test 4.5: Filtering by category
    const resCat = await fetch(`${baseUrl}/api/manager/audit-logs?category=security`);
    const dataCat = await resCat.json();
    assert.strictEqual(dataCat.total, 10);
    assert.ok(dataCat.logs.every((l) => l.category === 'security'));

    // Test 4.6: Filtering by status
    const resStatus = await fetch(`${baseUrl}/api/manager/audit-logs?status=error`);
    const dataStatus = await resStatus.json();
    assert.ok(dataStatus.total > 0);
    assert.ok(dataStatus.logs.every((l) => l.status === 'error'));

    // Test 4.7: Filtering by logType
    const resLogType = await fetch(`${baseUrl}/api/manager/audit-logs?logType=auth`);
    const dataLogType = await resLogType.json();
    assert.ok(dataLogType.total > 0);
    assert.ok(dataLogType.logs.every((l) => l.logType === 'auth'));

    // Test 4.8: Multi-criteria filter (category + status + page)
    const resMulti = await fetch(`${baseUrl}/api/manager/audit-logs?category=security&status=success&page=1&limit=2`);
    const dataMulti = await resMulti.json();
    assert.strictEqual(dataMulti.total, 5); // 10 security logs, 5 are success (even)
    assert.strictEqual(dataMulti.totalPages, 3); // ceil(5 / 2) = 3
    assert.strictEqual(dataMulti.logs.length, 2);
    assert.ok(dataMulti.logs.every((l) => l.category === 'security' && l.status === 'success'));

    // Test 4.9: Clamping out-of-bounds parameters
    const resClamp = await fetch(`${baseUrl}/api/manager/audit-logs?page=-5&limit=9999`);
    const dataClamp = await resClamp.json();
    assert.strictEqual(dataClamp.page, 1);
    assert.strictEqual(dataClamp.limit, 500);
  });

  console.log('✅ ADM-20-01: Audit Logs Pagination & Filtering Contract verified.');
}

// ============================================================================
// 5. ADM-20-02: System Settings Persistence in Supabase Tests
// ============================================================================
async function testADM2002SystemSettingsPersistence() {
  console.log('5. Testing ADM-20-02: System Settings Persistence in Supabase...');

  const dbSettings = new Map();
  dbSettings.set('system_settings', {
    trialGiftEnabled: true,
    trialDays: 5,
    publicBaseUrl: 'https://manager.kingmc.local',
    customField: 'initial_val'
  });

  const mockStore = {
    getSetting: async (key) => dbSettings.get(key) || null,
    setSetting: async (key, val) => {
      dbSettings.set(key, val);
      return val;
    }
  };

  const appConfig = {
    publicBaseUrl: 'https://default.kingmc.local',
    renderApiKey: 'render-secret-key',
    link4mApiToken: 'link4m-secret-token',
    trialGiftEnabled: false,
    trialDays: 3
  };

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.managerAuthSession = { username: 'admin', role: 'admin' };
    next();
  });
  app.use('/api/manager', createAdminApi({
    store: mockStore,
    entitlementService: {},
    registry: {},
    broker: {},
    fleetOperations: {},
    adminNotifier: {},
    config: appConfig,
    logger: createSilentLogger()
  }));

  await withTestServer(app, async (baseUrl) => {
    // Test 5.1: GET /settings/system returns merged settings including trialGiftEnabled & trialDays
    const getRes = await fetch(`${baseUrl}/api/manager/settings/system`);
    assert.strictEqual(getRes.status, 200);
    const getBody = await getRes.json();
    assert.strictEqual(getBody.ok, true);

    const settings = getBody.settings;
    assert.ok(settings, 'Response must contain settings object');
    assert.strictEqual(settings.trialGiftEnabled, true);
    assert.strictEqual(settings.trialDays, 5);
    assert.strictEqual(settings.publicBaseUrl, 'https://manager.kingmc.local');
    assert.strictEqual(typeof settings.trialGiftEnabled, 'boolean');
    assert.strictEqual(typeof settings.trialDays, 'number');

    // Test 5.2: POST /settings/system updates trialGiftEnabled & trialDays and persists to Supabase
    const postRes = await fetch(`${baseUrl}/api/manager/settings/system`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trialGiftEnabled: false,
        trialDays: 14,
        publicBaseUrl: 'https://updated.kingmc.local'
      })
    });
    assert.strictEqual(postRes.status, 200);
    const postBody = await postRes.json();
    assert.strictEqual(postBody.ok, true);
    assert.strictEqual(postBody.settings.trialGiftEnabled, false);
    assert.strictEqual(postBody.settings.trialDays, 14);
    assert.strictEqual(postBody.settings.publicBaseUrl, 'https://updated.kingmc.local');

    // Verify in-memory config updated
    assert.strictEqual(appConfig.trialGiftEnabled, false);
    assert.strictEqual(appConfig.trialDays, 14);
    assert.strictEqual(appConfig.publicBaseUrl, 'https://updated.kingmc.local');

    // Verify persisted directly into mock database
    const persistedDb = dbSettings.get('system_settings');
    assert.ok(persistedDb);
    assert.strictEqual(persistedDb.trialGiftEnabled, false);
    assert.strictEqual(persistedDb.trialDays, 14);
    assert.strictEqual(persistedDb.publicBaseUrl, 'https://updated.kingmc.local');

    // Test 5.3: Subsequent GET /settings/system returns the persisted changes
    const verifyRes = await fetch(`${baseUrl}/api/manager/settings/system`);
    const verifyBody = await verifyRes.json();
    assert.strictEqual(verifyBody.settings.trialGiftEnabled, false);
    assert.strictEqual(verifyBody.settings.trialDays, 14);
    assert.strictEqual(verifyBody.settings.publicBaseUrl, 'https://updated.kingmc.local');
  });

  console.log('✅ ADM-20-02: System Settings Persistence in Supabase verified.');
}

// ============================================================================
// 6. Bonus Fix: DIS-12-03 Telegram HTML Escaping Uppercase Entity Immunity
// ============================================================================
async function testDIS1203UppercaseEntityImmunity() {
  console.log('6. Testing DIS-12-03 Bonus Fix: Telegram HTML Escaping Entity Casing...');

  const originalFetch = global.fetch;
  let dispatchedPayload = null;

  try {
    global.fetch = async (url, opts) => {
      dispatchedPayload = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({}) };
    };

    const notifier = new AdminNotifier({
      telegramBotToken: 'mock-bot-token',
      telegramChatId: '123456789',
      logger: createSilentLogger()
    });

    // Send alert with HTML characters in the source
    await notifier.dispatchTelegram({
      source: 'worker<probe>&test',
      event: 'worker_crashed',
      message: 'Worker crashed with <memory_leak>',
      level: 'error'
    });

    assert.ok(dispatchedPayload, 'Telegram dispatch must occur');
    const text = dispatchedPayload.text;

    // Check header: Must contain WORKER&lt;PROBE&gt;&amp;TEST
    // It must NEVER contain &LT; or &GT; or &AMP;
    assert.ok(
      text.includes('WORKER&lt;PROBE&gt;&amp;TEST'),
      `Dispatched text must contain lowercase entities 'WORKER&lt;PROBE&gt;&amp;TEST', got: ${text}`
    );
    assert.strictEqual(text.includes('&LT;'), false, 'Text must not contain uppercase &LT;');
    assert.strictEqual(text.includes('&GT;'), false, 'Text must not contain uppercase &GT;');
    assert.strictEqual(text.includes('&AMP;'), false, 'Text must not contain uppercase &AMP;');
  } finally {
    global.fetch = originalFetch;
  }

  console.log('✅ DIS-12-03: Telegram HTML Escaping Entity Casing verified.');
}

// ============================================================================
// MAIN RUNNER
// ============================================================================
async function runAllTests() {
  console.log('===============================================================');
  console.log('--- GATE 3 MILESTONE 4: CLOUD BACKUP & ADMIN API TESTS ---');
  console.log('===============================================================');

  try {
    await testP701SanitizeBackupPayloadAndSaveBackup();
    await testP702BackupFilenameFormattingAndRestore();
    await testP703RealBackupDeletionEndpoint();
    await testADM2001AuditLogsPaginationAndFiltering();
    await testADM2002SystemSettingsPersistence();
    await testDIS1203UppercaseEntityImmunity();

    console.log('===============================================================');
    console.log('🎉 ALL GATE 3 MILESTONE 4 (P7-01..03, ADM-20-01..02) TESTS PASSED 100%!');
    console.log('===============================================================');
    process.exit(0);
  } catch (err) {
    console.error('❌ GATE 3 MILESTONE 4 TEST FAILED:');
    console.error(err);
    process.exit(1);
  }
}

void runAllTests();
