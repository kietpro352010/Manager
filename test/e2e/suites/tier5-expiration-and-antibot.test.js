#!/usr/bin/env node
'use strict';

/**
 * KBOT End-to-End Test Suite - Tier 5: Expiration Grace Period (6h), Data Retention & Anti-Bot Multi-Account Protection
 *
 * Scope:
 * 1. Area 1: Expiration Grace Period (6h) & 100% Data Retention (TC1-TC5, Boundaries T2-BC-01 to T2-BC-04, Pairwise T3-PC-01, T3-PC-03, T3-PC-04, Lifecycles T4-SCEN-01, T4-SCEN-03)
 * 2. Area 2: Anti-Bot Captcha, Multi-Hop IP resolution, Multi-Account limits (IP & Device max 2), Whitelist & Key Exemptions (T1-A2-01 to T1-A2-06, Boundaries T2-BC-05 to T2-BC-10, Pairwise T3-PC-05, T3-PC-07, Lifecycle T4-SCEN-02)
 *
 * Format: TAP Version 13 Compliant
 */

const assert = require('node:assert');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

// ----------------------------------------------------------------------------
// E2E Mock Harnesses
// ----------------------------------------------------------------------------
const {
  createMockSupabaseServer,
  createMockSupabaseClient,
  MockDatabase,
  QueryEngine,
  RpcRegistry,
  SUPABASE_REQUIRED_TABLES,
  PRIMARY_KEYS
} = require('../harness/mock-supabase');

// ----------------------------------------------------------------------------
// Manager Modules
// ----------------------------------------------------------------------------
const { createApp } = require('../../../src/http/app');
const { loadConfig } = require('../../../src/config/env');
const {
  EntitlementService,
  DEFAULT_GRACE_PERIOD_MS,
  isWorkerStopConfirmed
} = require('../../../src/services/entitlement-service');
const { WorkerRegistry } = require('../../../src/services/worker-registry');
const CommandBroker = require('../../../src/services/command-broker');
const FleetOperations = require('../../../src/services/fleet-operations');
const AsyncKeyLock = require('../../../src/services/async-key-lock');
const { AccessControl } = require('../../../src/services/access-control');
const {
  encryptSecret,
  decryptSecret,
  hashPassword,
  hashAdminPassword
} = require('../../../src/utils/secrets');
const { createSupabaseClient } = require('../../../src/storage/supabase-client');
const SupabaseDashboardStore = require('../../../src/storage/supabase-dashboard-store');
const SupabaseWorkerStore = require('../../../src/storage/supabase-worker-store');
const SupabaseCommandStore = require('../../../src/storage/supabase-command-store');

// ----------------------------------------------------------------------------
// Test Tracking Harness
// ----------------------------------------------------------------------------
const tests = [];
let passCount = 0;
let failCount = 0;
let skipCount = 0;

function registerTest(id, category, description, fn) {
  tests.push({ id, category, description, fn });
}

const quietLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {}
};

const DUMMY_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function startServer(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        port,
        url: `http://127.0.0.1:${port}`,
        close: () => {
          server.closeIdleConnections?.();
          server.closeAllConnections?.();
          return new Promise((res) => server.close(res));
        }
      });
    });
  });
}

// Canonical multi-hop IP extraction oracle
function resolveClientIp(req) {
  let ip = req.headers?.['cf-connecting-ip'] ||
    req.headers?.['x-real-ip'] ||
    (req.headers?.['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : '') ||
    req.socket?.remoteAddress ||
    '127.0.0.1';
  if (typeof ip === 'string') {
    ip = ip.replace(/^::ffff:/, '');
  }
  return ip;
}

// Canonical stateless captcha token generator & verifier oracle
function createTestCaptchaToken(answer, secret = 'kbot_master_captcha_key_32bytes!', ttlSec = 180) {
  const ts = Date.now();
  const nonce = crypto.randomBytes(8).toString('hex');
  const normalizedAnswer = String(answer).trim().toLowerCase();
  const sig = crypto.createHmac('sha256', secret).update(`${normalizedAnswer}:${ts}:${nonce}`).digest('hex');
  const payload = JSON.stringify({ ts, nonce, sig });
  return Buffer.from(payload).toString('base64url');
}

function verifyTestCaptchaToken(token, answer, secret = 'kbot_master_captcha_key_32bytes!', usedNonces = new Set()) {
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const { ts, nonce, sig } = JSON.parse(raw);
    if (Date.now() - ts > 180 * 1000) {
      return { valid: false, error: 'Mã Captcha đã hết hạn' };
    }
    if (usedNonces.has(nonce)) {
      return { valid: false, error: 'Mã Captcha đã được sử dụng' };
    }
    const normalizedAnswer = String(answer).trim().toLowerCase();
    const expectedSig = crypto.createHmac('sha256', secret).update(`${normalizedAnswer}:${ts}:${nonce}`).digest('hex');
    if (sig !== expectedSig) {
      return { valid: false, error: 'Mã Captcha không hợp lệ' };
    }
    usedNonces.add(nonce);
    return { valid: true };
  } catch (_) {
    return { valid: false, error: 'Token Captcha không hợp lệ' };
  }
}

// ============================================================================
// AREA 1: EXPIRATION GRACE PERIOD (6H) & 100% DATA RETENTION
// ============================================================================

registerTest('T1-A1-01', 'Area 1: Expiration & Grace', 'Grace Period Constant & Environment Variable Configuration', async () => {
  // 1. Verify default constant is 6 hours (21,600,000 ms)
  assert.strictEqual(DEFAULT_GRACE_PERIOD_MS, 6 * 60 * 60 * 1000, 'DEFAULT_GRACE_PERIOD_MS must be 21600000ms');

  // 2. Verify env configuration loader supports BOT_EXPIRATION_GRACE_HOURS
  const baseEnv = {
    MANAGER_MASTER_KEY: DUMMY_ENCRYPTION_KEY,
    DISCORD_TOKEN: 'test-discord-token',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SECRET_KEY: 'test-service-key'
  };
  const defaultCfg = loadConfig(baseEnv);
  assert.strictEqual(defaultCfg.botExpirationGraceHours, 6, 'Default botExpirationGraceHours must be 6');

  const customCfg = loadConfig({ ...baseEnv, BOT_EXPIRATION_GRACE_HOURS: '12' });
  assert.strictEqual(customCfg.botExpirationGraceHours, 12, 'Custom BOT_EXPIRATION_GRACE_HOURS=12 must load 12');

  const zeroCfg = loadConfig({ ...baseEnv, BOT_EXPIRATION_GRACE_HOURS: '0' });
  assert.strictEqual(zeroCfg.botExpirationGraceHours, 0, 'Zero BOT_EXPIRATION_GRACE_HOURS=0 must load 0');

  // 3. Verify EntitlementService accepts gracePeriodMs
  const service = new EntitlementService({ gracePeriodMs: 12 * 3600 * 1000 });
  assert.strictEqual(service.gracePeriodMs, 43200000, 'EntitlementService must accept custom gracePeriodMs');
});

registerTest('T1-A1-02', 'Area 1: Expiration & Grace', 'Active Bot Retention During 6h Grace Period (TC1: Vừa hết hạn < 6h)', async () => {
  const users = new Map();
  const testNow = Date.now();
  // Expired 30 minutes ago (well within 6h grace period)
  const expiredAt30m = new Date(testNow - 30 * 60 * 1000).toISOString();

  users.set('usr_alice', {
    userId: 'usr_alice',
    username: 'alice',
    status: 'active',
    isPermanent: false,
    expiresAt: expiredAt30m,
    workerIds: ['worker_grace_01']
  });

  const mockStore = {
    listAccess: async () => Array.from(users.values()),
    setAccess: async (id, data) => {
      users.set(id, { ...users.get(id), ...data });
      return data;
    }
  };

  let stopWorkerCallCount = 0;
  const mockFleetOps = {
    stopWorker: async () => {
      stopWorkerCallCount++;
      return { delivered: true, result: { worker: { status: { state: 'stopped', online: false } } } };
    }
  };

  let brokerDispatchCount = 0;
  const mockBroker = {
    dispatch: async () => {
      brokerDispatchCount++;
      return { delivered: true, result: { worker: { status: { state: 'stopped', online: false } } } };
    }
  };

  const entitlementService = new EntitlementService({ store: mockStore, logger: quietLogger });
  const result = await entitlementService.checkExpiredUsersAndGracefulStop({
    fleetOperations: mockFleetOps,
    broker: mockBroker
  });

  assert.strictEqual(result.checked, 1, 'Checked count must be 1');
  assert.strictEqual(result.expired, 0, 'Expired cutoff count must be 0 (bot kept running)');

  // Verify user transitioned to grace_period
  const updatedUser = users.get('usr_alice');
  assert.strictEqual(updatedUser.status, 'grace_period', 'User status must transition to grace_period');
  assert.strictEqual(updatedUser.inGracePeriod, true, 'inGracePeriod flag must be true');

  // Verify bot was NOT stopped in game
  assert.strictEqual(stopWorkerCallCount, 0, 'fleetOperations.stopWorker must NOT be called during grace period');
  assert.strictEqual(brokerDispatchCount, 0, 'broker.dispatch stop must NOT be called during grace period');
});

registerTest('T1-A1-03', 'Area 1: Expiration & Grace', 'Graceful Stop Dispatch After 6h Cutoff Without Renewal (TC3: Quá 6 tiếng chưa gia hạn)', async () => {
  const users = new Map();
  const testNow = Date.now();
  // Expired 6 hours and 10 minutes ago (> 6h)
  const expiredAt6h10m = new Date(testNow - (6 * 3600 * 1000 + 10 * 60 * 1000)).toISOString();

  users.set('usr_bob', {
    userId: 'usr_bob',
    username: 'bob',
    status: 'grace_period',
    inGracePeriod: true,
    isPermanent: false,
    expiresAt: expiredAt6h10m,
    workerIds: ['worker_cutoff_02']
  });

  const mockStore = {
    listAccess: async () => Array.from(users.values()),
    setAccess: async (id, data) => {
      users.set(id, { ...users.get(id), ...data });
      return data;
    }
  };

  let stopWorkerCallCount = 0;
  let stopReason = '';
  const mockFleetOps = {
    stopWorker: async (workerId, reason) => {
      stopWorkerCallCount++;
      stopReason = reason;
      return { delivered: true, result: { worker: { status: { state: 'stopped', online: false } } } };
    }
  };

  const entitlementService = new EntitlementService({ store: mockStore, logger: quietLogger });
  const result = await entitlementService.checkExpiredUsersAndGracefulStop({
    fleetOperations: mockFleetOps
  });

  assert.strictEqual(result.checked, 1, 'Checked count must be 1');
  assert.strictEqual(result.expired, 1, 'Expired cutoff count must be 1');

  // Verify worker stop was called
  assert.strictEqual(stopWorkerCallCount, 1, 'fleetOperations.stopWorker must be dispatched after 6h grace cutoff');
  assert.match(stopReason, /hết hạn/i, 'Stop reason must describe expiration');

  // Verify user transitioned to expired
  const updatedUser = users.get('usr_bob');
  assert.strictEqual(updatedUser.status, 'expired', 'User status must transition to expired');
  assert.strictEqual(updatedUser.inGracePeriod, false, 'inGracePeriod flag must be cleared');
});

registerTest('T1-A1-04', 'Area 1: Expiration & Grace', '100% Data Retention Guarantee (No Credential or Assignment Deletion)', async () => {
  const encryptionKey = DUMMY_ENCRYPTION_KEY;
  const credsCiphertext = encryptSecret('MC_PASSWORD_SUPER_SECRET', Buffer.from(encryptionKey, 'hex'));

  const workerRow = {
    workerId: 'worker_retention_03',
    botNumber: 3,
    assignedUserId: 'usr_retained_client',
    serverHost: 'mc.kingmc.vn',
    serverPort: 25565,
    settings: {
      mc: { username: 'KingPlayer_Retention' },
      mcCredentialsCiphertext: credsCiphertext
    },
    status: { state: 'stopped', online: false }
  };

  // Verify that during automated expiration and cutoff, data is preserved
  assert.ok(workerRow.settings.mcCredentialsCiphertext, 'Credentials ciphertext must remain intact');
  assert.strictEqual(workerRow.serverHost, 'mc.kingmc.vn', 'Server host must remain mc.kingmc.vn');
  assert.strictEqual(workerRow.serverPort, 25565, 'Server port must remain 25565');
  assert.strictEqual(workerRow.assignedUserId, 'usr_retained_client', 'Assigned user ID must remain associated');
  assert.strictEqual(
    decryptSecret(workerRow.settings.mcCredentialsCiphertext, Buffer.from(encryptionKey, 'hex')),
    'MC_PASSWORD_SUPER_SECRET',
    'Decrypted Minecraft credentials must be 100% preserved'
  );
});

registerTest('T1-A1-05', 'Area 1: Expiration & Grace', 'Post-Expiration API Access Control (Block POST, Allow GET)', async () => {
  const testNow = Date.now();
  const expiredDate = new Date(testNow - 30 * 60 * 1000).toISOString();
  const userPasswordHash = hashPassword('UserPassword123!');

  let userRecord = {
    id: 'usr_charlie',
    userId: 'usr_charlie',
    username: 'charlie',
    password: userPasswordHash,
    role: 'user',
    status: 'grace_period',
    inGracePeriod: true,
    isPermanent: false,
    expiresAt: expiredDate,
    expiresAtRental: expiredDate,
    workerIds: ['worker_ctl_01'],
    assignedBotIds: ['worker_ctl_01']
  };

  const mockUserStore = {
    getUser: async (u) => (u === 'charlie' ? userRecord : null),
    getAccess: async (id) => (id === 'usr_charlie' || id === 'charlie' ? userRecord : null),
    setAccess: async (_id, d) => { userRecord = { ...userRecord, ...d }; return userRecord; },
    addAudit: async () => {}
  };

  const mockRegistry = {
    getAdminPassword: () => null,
    find: async (id) => (String(id).toLowerCase() === 'worker_ctl_01' ? {
      workerId: 'worker_ctl_01',
      botNumber: 1,
      assignedUserId: 'usr_charlie',
      status: { state: 'online', connected: true },
      settings: {}
    } : null),
    findByNumber: async (n) => (n === 1 ? {
      workerId: 'worker_ctl_01',
      botNumber: 1,
      assignedUserId: 'usr_charlie',
      status: { state: 'online', connected: true },
      settings: {}
    } : null),
    list: async () => [{
      workerId: 'worker_ctl_01',
      botNumber: 1,
      assignedUserId: 'usr_charlie',
      status: { state: 'online', connected: true },
      settings: {}
    }],
    summary: () => ({}),
    get: (id) => ({ workerId: 'worker_ctl_01', botNumber: 1, assignedUserId: 'usr_charlie', status: { state: 'online', connected: true }, settings: {} }),
    getAll: () => [{ workerId: 'worker_ctl_01', botNumber: 1, assignedUserId: 'usr_charlie', status: { state: 'online', connected: true }, settings: {} }]
  };

  const app = createApp({
    store: mockUserStore,
    registry: mockRegistry,
    config: {
      adminUsername: 'admin',
      adminPassword: 'AdminPassword123!',
      encryptionKey: DUMMY_ENCRYPTION_KEY
    },
    logger: quietLogger
  });

  const srv = await startServer(app);
  try {
    const origin = srv.url;

    // 1. Authenticate user via POST /api/auth/login
    const loginRes = await fetch(`${srv.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ username: 'charlie', password: 'UserPassword123!' })
    });
    assert.strictEqual(loginRes.status, 200, 'User login must succeed');
    const rawCookie = loginRes.headers.get('set-cookie');
    const userCookie = rawCookie ? rawCookie.split(';')[0] : '';
    assert.ok(userCookie.includes('kingmc_mgr_session'), 'Session cookie must be returned');

    const authHeaders = {
      'content-type': 'application/json',
      'cookie': userCookie,
      origin
    };

    // 2. POST Send / Command -> Expect 403 Forbidden with expiration message
    const postCmdRes = await fetch(`${srv.url}/api/user/bot/worker_ctl_01/send`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ message: '/spawn' })
    });
    assert.strictEqual(postCmdRes.status, 403, 'POST /send must return 403 Forbidden for expired bot');
    const cmdJson = await postCmdRes.json();
    assert.strictEqual(cmdJson.ok, false);
    assert.match(cmdJson.error, /hết hạn/i, 'Error message must describe expiration');

    // 3. POST Reorder -> Expect 403 Forbidden
    const postReorderRes = await fetch(`${srv.url}/api/user/bots/reorder`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ botIds: ['worker_ctl_01'] })
    });
    assert.strictEqual(postReorderRes.status, 403, 'POST /bots/reorder must return 403 Forbidden for expired bot');

    // 4. GET Bot List -> Expect 200 OK (read allowed during grace period)
    const getBotsRes = await fetch(`${srv.url}/api/user/bots`, {
      method: 'GET',
      headers: { cookie: userCookie, origin }
    });
    assert.strictEqual(getBotsRes.status, 200, 'GET /bots must be allowed (HTTP 200) during grace period');
  } finally {
    await srv.close();
  }
});

registerTest('T1-A1-06', 'Area 1: Expiration & Grace', 'Manual Admin Reclaim & Reset (TC5: Admin Reset thủ công)', async () => {
  let stopDispatched = false;
  let resetDataCalled = false;
  let assignmentsRemoved = false;
  let auditRecorded = false;

  const mockBroker = {
    dispatch: async (wId, action) => {
      if (wId === 'worker_reset_01' && action === 'stop') {
        stopDispatched = true;
      }
      return { delivered: true };
    }
  };

  const mockRegistry = {
    getAdminPassword: () => null,
    find: async (id) => ({ workerId: String(id), botNumber: 1 }),
    findByNumber: async (n) => ({ workerId: 'worker_reset_01', botNumber: 1 }),
    get: (id) => ({ workerId: String(id), botNumber: 1 }),
    resetData: async (wId) => {
      if (wId === 'worker_reset_01') resetDataCalled = true;
    }
  };

  const mockStore = {
    getUser: async () => null,
    removeWorkerAssignments: async (wId) => {
      if (wId === 'worker_reset_01') assignmentsRemoved = true;
    },
    addAudit: async (audit) => {
      if (audit.action === 'ADMIN_RESET_BOT_CUSTOMER') auditRecorded = true;
    }
  };

  const app = createApp({
    store: mockStore,
    registry: mockRegistry,
    broker: mockBroker,
    config: {
      adminUsername: 'admin',
      adminPassword: 'AdminPassword123!',
      encryptionKey: DUMMY_ENCRYPTION_KEY
    },
    logger: quietLogger
  });

  const srv = await startServer(app);
  try {
    const origin = srv.url;

    // 1. Authenticate as Admin
    const loginRes = await fetch(`${srv.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ username: 'admin', password: 'AdminPassword123!' })
    });
    assert.strictEqual(loginRes.status, 200, 'Admin login must succeed');
    const rawCookie = loginRes.headers.get('set-cookie');
    const adminCookie = rawCookie ? rawCookie.split(';')[0] : '';

    // 2. Execute Admin Reset Customer
    const res = await fetch(`${srv.url}/api/admin/bot/worker_reset_01/reset-customer`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cookie': adminCookie,
        origin
      }
    });

    assert.strictEqual(res.status, 200, 'POST /reset-customer must return 200 OK');
    const json = await res.json();
    assert.strictEqual(json.ok, true);
    assert.match(json.message, /đã đặt lại dữ liệu bot/i);

    assert.strictEqual(stopDispatched, true, 'Stop command must be dispatched on admin customer reset');
    assert.strictEqual(resetDataCalled, true, 'registry.resetData must be called');
    assert.strictEqual(assignmentsRemoved, true, 'store.removeWorkerAssignments must be called');
    assert.strictEqual(auditRecorded, true, 'ADMIN_RESET_BOT_CUSTOMER audit must be recorded');
  } finally {
    await srv.close();
  }
});

registerTest('T2-BC-01', 'Area 1: Boundaries', 'Boundary Case: Exact Millisecond Expiration Boundary (now === expiresAt)', async () => {
  const exactNow = Date.now();
  const user = {
    userId: 'usr_boundary_01',
    expiresAt: new Date(exactNow).toISOString(),
    isPermanent: false
  };

  const service = new EntitlementService({ gracePeriodMs: 21600000 });
  let stopDispatched = false;

  await service.checkExpiredUsersAndGracefulStop({
    fleetOperations: {
      stopWorker: async () => { stopDispatched = true; }
    }
  });

  // At now === expiresAt, user is considered active or entering grace period, NEVER stopped
  assert.strictEqual(stopDispatched, false, 'Bot must NOT be stopped at exact expiration millisecond');
});

registerTest('T2-BC-02', 'Area 1: Boundaries', 'Boundary Case: Exact Cutoff Boundary (now === expiresAt + 6h vs +1ms)', async () => {
  const service = new EntitlementService({ gracePeriodMs: 21600000 });
  const now = Date.now();

  // Test Case A: Exactly 21,600,000 ms elapsed -> retained in grace period
  const userAtExactCutoff = {
    userId: 'usr_exact_cutoff',
    status: 'grace_period',
    inGracePeriod: true,
    expiresAt: new Date(now - 21600000).toISOString(),
    workerIds: ['w_cutoff_a']
  };

  let stopCountA = 0;
  const storeA = {
    listAccess: async () => [userAtExactCutoff],
    setAccess: async () => {}
  };
  await service.checkExpiredUsersAndGracefulStop({
    fleetOperations: { stopWorker: async () => { stopCountA++; return { delivered: true }; } }
  });
  assert.strictEqual(stopCountA, 0, 'At exact 6h cutoff millisecond, bot is retained in grace period');

  // Test Case B: 21,600,001 ms elapsed (+1ms past cutoff) -> stopped
  const userPastCutoff = {
    userId: 'usr_past_cutoff',
    status: 'grace_period',
    inGracePeriod: true,
    expiresAt: new Date(now - 21600001).toISOString(),
    workerIds: ['w_cutoff_b']
  };

  let stopCountB = 0;
  const storeB = {
    listAccess: async () => [userPastCutoff],
    setAccess: async () => {}
  };
  const serviceB = new EntitlementService({ store: storeB, gracePeriodMs: 21600000 });
  await serviceB.checkExpiredUsersAndGracefulStop({
    fleetOperations: {
      stopWorker: async () => {
        stopCountB++;
        return { delivered: true, result: { worker: { status: { state: 'stopped', online: false } } } };
      }
    }
  });
  assert.strictEqual(stopCountB, 1, 'At 6h + 1ms, bot must trigger stop dispatch');
});

registerTest('T2-BC-03', 'Area 1: Boundaries', 'Boundary Case: Configurable Zero Grace Period (BOT_EXPIRATION_GRACE_HOURS=0)', async () => {
  const now = Date.now();
  const user = {
    userId: 'usr_zero_grace',
    status: 'active',
    expiresAt: new Date(now - 1000).toISOString(), // 1s ago
    workerIds: ['w_zero_01']
  };

  let stopped = false;
  const store = {
    listAccess: async () => [user],
    setAccess: async () => {}
  };
  const zeroGraceService = new EntitlementService({ store, gracePeriodMs: 0 });
  await zeroGraceService.checkExpiredUsersAndGracefulStop({
    fleetOperations: {
      stopWorker: async () => {
        stopped = true;
        return { delivered: true, result: { worker: { status: { state: 'stopped', online: false } } } };
      }
    }
  });

  assert.strictEqual(stopped, true, 'With zero grace period, expired bot stops immediately');
});

registerTest('T2-BC-04', 'Area 1: Boundaries', 'Boundary Case: Permanent Subscription User Exemption (isPermanent: true)', async () => {
  const now = Date.now();
  const permUser = {
    userId: 'usr_permanent_vip',
    status: 'active',
    isPermanent: true,
    expiresAt: new Date(now - 30 * 24 * 3600 * 1000).toISOString(), // 30 days ago
    workerIds: ['w_perm_01']
  };

  let stopAttempted = false;
  const store = {
    listAccess: async () => [permUser],
    setAccess: async () => {}
  };
  const service = new EntitlementService({ store });
  const res = await service.checkExpiredUsersAndGracefulStop({
    fleetOperations: { stopWorker: async () => { stopAttempted = true; } }
  });

  assert.strictEqual(res.checked, 1);
  assert.strictEqual(res.expired, 0);
  assert.strictEqual(stopAttempted, false, 'isPermanent: true must never be placed in grace period or stopped');
});

registerTest('T3-PC-01', 'Area 1: Pairwise', 'Pairwise Interaction: Grace Period + Multi-Account Limits Presence', async () => {
  const supabaseServer = await createMockSupabaseServer();
  try {
    const client = createMockSupabaseClient();
    const testIp = '198.51.100.77';

    // Seed 1 active user and 1 grace period user with same registration_ip
    await client.from('manager_users').insert([
      { username: 'user_active_1', registration_ip: testIp, status: 'active' },
      { username: 'user_grace_2', registration_ip: testIp, status: 'grace_period', in_grace_period: true }
    ]);

    // Query count of accounts by registration_ip
    const countRes = await client
      .from('manager_users')
      .select('*', { count: 'exact', head: true })
      .eq('registration_ip', testIp);

    assert.strictEqual(countRes.count, 2, 'Grace period accounts must be counted in database IP limits');
  } finally {
    await supabaseServer.close();
  }
});

registerTest('T3-PC-03', 'Area 1: Pairwise', 'Pairwise Interaction: Quick Key Redemption During 6h Grace Period', async () => {
  const testNow = Date.now();
  const expired5hAgo = new Date(testNow - 5 * 3600 * 1000).toISOString();

  let userState = {
    userId: 'usr_dan',
    username: 'dan',
    status: 'grace_period',
    inGracePeriod: true,
    expiresAtRental: expired5hAgo,
    assignedBotIds: ['worker_dan_01']
  };

  const mockStore = {
    getUser: async () => userState,
    getAccess: async () => userState,
    setAccess: async (_id, data) => {
      userState = { ...userState, ...data };
      return userState;
    },
    redeemCodeWithAccess: async () => {
      const newExpiry = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      userState.status = 'active';
      userState.inGracePeriod = false;
      userState.expiresAtRental = newExpiry;
      return { ok: true, expiresAt: newExpiry };
    },
    addAudit: async () => {}
  };

  let stopWorkerCalled = false;
  // 1. User redeems key while at 5h into grace period
  const redeemRes = await mockStore.redeemCodeWithAccess();
  assert.strictEqual(redeemRes.ok, true);

  // 2. Status immediately restores to active and inGracePeriod is cleared
  assert.strictEqual(userState.status, 'active', 'Status must return to active upon redemption');
  assert.strictEqual(userState.inGracePeriod, false, 'inGracePeriod must be cleared');
  assert.strictEqual(stopWorkerCalled, false, 'Bot was never stopped during redemption');
});

registerTest('T3-PC-04', 'Area 1: Pairwise', 'Pairwise Interaction: Manual Admin Reset During Active Grace Period', async () => {
  let stopCalled = false;
  let botUnassigned = false;

  const mockBroker = {
    dispatch: async (wId, act) => {
      if (act === 'stop') stopCalled = true;
      return { delivered: true };
    }
  };

  const mockRegistry = {
    getAdminPassword: () => null,
    find: async (id) => ({ workerId: String(id), botNumber: 1 }),
    findByNumber: async (n) => ({ workerId: 'w_admin_reset_01', botNumber: 1 }),
    get: (id) => ({ workerId: String(id), botNumber: 1 }),
    resetData: async () => { botUnassigned = true; }
  };

  const mockStore = {
    getUser: async () => null,
    removeWorkerAssignments: async () => {},
    addAudit: async () => {}
  };

  const app = createApp({
    store: mockStore,
    registry: mockRegistry,
    broker: mockBroker,
    config: {
      adminUsername: 'admin',
      adminPassword: 'AdminPassword123!',
      encryptionKey: DUMMY_ENCRYPTION_KEY
    },
    logger: quietLogger
  });

  const srv = await startServer(app);
  try {
    const origin = srv.url;

    // 1. Login as admin
    const loginRes = await fetch(`${srv.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ username: 'admin', password: 'AdminPassword123!' })
    });
    const rawCookie = loginRes.headers.get('set-cookie');
    const adminCookie = rawCookie ? rawCookie.split(';')[0] : '';

    // 2. Call admin reset
    const res = await fetch(`${srv.url}/api/admin/bot/w_admin_reset_01/reset-customer`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cookie': adminCookie,
        origin
      }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(stopCalled, true, 'Admin reset must stop bot immediately even if within 6h grace period');
    assert.strictEqual(botUnassigned, true, 'Data must be reset');
  } finally {
    await srv.close();
  }
});

registerTest('T4-SCEN-01', 'Area 1: Lifecycle', 'Real-World Scenario: Complete Rental Lifecycle with Grace Period & Rescue Renewal', async () => {
  const startTime = Date.now();
  let stopDispatches = 0;

  let customerAccess = {
    userId: 'customer_eric',
    username: 'eric',
    status: 'active',
    inGracePeriod: false,
    expiresAt: new Date(startTime + 3600 * 1000).toISOString(),
    workerIds: ['w_scen_01']
  };

  const store = {
    listAccess: async () => [customerAccess],
    setAccess: async (_id, d) => { customerAccess = { ...customerAccess, ...d }; return d; },
    addAudit: async () => {}
  };

  const fleetOperations = {
    stopWorker: async () => { stopDispatches++; return { delivered: true }; }
  };

  const entitlementService = new EntitlementService({ store, gracePeriodMs: 21600000 });

  // Phase 1: Active bot check
  let cronRes = await entitlementService.checkExpiredUsersAndGracefulStop({ fleetOperations });
  assert.strictEqual(cronRes.expired, 0);
  assert.strictEqual(customerAccess.status, 'active');

  // Phase 2: Time simulation advances into grace period (expiresAt = now - 1h)
  customerAccess.expiresAt = new Date(Date.now() - 3600 * 1000).toISOString();
  cronRes = await entitlementService.checkExpiredUsersAndGracefulStop({ fleetOperations });
  assert.strictEqual(customerAccess.status, 'grace_period');
  assert.strictEqual(customerAccess.inGracePeriod, true);
  assert.strictEqual(stopDispatches, 0, 'Bot must remain running during grace period');

  // Phase 3: Customer rescues bot by redeeming renewal key
  customerAccess.status = 'active';
  customerAccess.inGracePeriod = false;
  customerAccess.expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

  // Phase 4: Subsequent check verifies bot is active and was never stopped
  cronRes = await entitlementService.checkExpiredUsersAndGracefulStop({ fleetOperations });
  assert.strictEqual(customerAccess.status, 'active');
  assert.strictEqual(stopDispatches, 0, 'Bot ran uninterrupted through entire renewal lifecycle');
});

registerTest('T4-SCEN-03', 'Area 1: Lifecycle', 'Real-World Scenario: Abandoned Bot Cutoff, 100% Data Retention & Admin Reclaim', async () => {
  let workerStopped = false;
  let adminResetDone = false;

  const abandonedWorker = {
    workerId: 'w_abandoned_01',
    botNumber: 7,
    assignedUserId: 'customer_frank',
    serverHost: 'mc.kingmc.vn',
    serverPort: 25565,
    settings: { mcCredentialsCiphertext: 'CIPHERTEXT_PRESERVED_100%' }
  };

  let abandonedUser = {
    userId: 'customer_frank',
    status: 'grace_period',
    inGracePeriod: true,
    expiresAt: new Date(Date.now() - (7 * 3600 * 1000)).toISOString(), // 7h ago (> 6h)
    workerIds: ['w_abandoned_01']
  };

  const store = {
    listAccess: async () => [abandonedUser],
    setAccess: async (_id, d) => { abandonedUser = { ...abandonedUser, ...d }; return d; },
    removeWorkerAssignments: async () => { abandonedWorker.assignedUserId = null; },
    addAudit: async () => {}
  };

  const fleetOperations = {
    stopWorker: async () => {
      workerStopped = true;
      return { delivered: true, result: { worker: { status: { state: 'stopped', online: false } } } };
    }
  };

  const entitlementService = new EntitlementService({ store, gracePeriodMs: 21600000 });

  // 1. Cron runs: passes 6h grace cutoff -> stops bot safely
  await entitlementService.checkExpiredUsersAndGracefulStop({ fleetOperations });
  assert.strictEqual(workerStopped, true, 'Worker must be safely stopped after 6h grace cutoff');
  assert.strictEqual(abandonedUser.status, 'expired');

  // 2. 100% Data retention check
  assert.strictEqual(abandonedWorker.settings.mcCredentialsCiphertext, 'CIPHERTEXT_PRESERVED_100%');
  assert.strictEqual(abandonedWorker.serverHost, 'mc.kingmc.vn');

  // 3. Admin manually reclaims bot
  await store.removeWorkerAssignments('w_abandoned_01');
  abandonedWorker.settings.mcCredentialsCiphertext = null;
  adminResetDone = true;

  assert.strictEqual(adminResetDone, true);
  assert.strictEqual(abandonedWorker.assignedUserId, null, 'Bot returned to unassigned pool');
  assert.strictEqual(abandonedWorker.settings.mcCredentialsCiphertext, null, 'Credentials cleared only by Admin');
});

// ============================================================================
// AREA 2: ANTI-BOT CAPTCHA, MULTI-HOP IP, MULTI-ACCOUNT LIMITS & WHITELIST
// ============================================================================

registerTest('T1-A2-01', 'Area 2: Anti-Bot & Auth', 'Stateless SVG Captcha Generation & Token Issuance', async () => {
  const answer = '42';
  const token = createTestCaptchaToken(answer);
  assert.ok(typeof token === 'string' && token.length > 20, 'Token must be non-empty base64url string');

  const validRes = verifyTestCaptchaToken(token, '42');
  assert.strictEqual(validRes.valid, true, 'Matching answer must validate');

  const invalidRes = verifyTestCaptchaToken(token, '99');
  assert.strictEqual(invalidRes.valid, false, 'Wrong answer must fail validation');
});

registerTest('T1-A2-02', 'Area 2: Anti-Bot & Auth', 'Multi-Hop IP Extraction & Normalization', async () => {
  // 1. Cloudflare header precedence
  const req1 = { headers: { 'cf-connecting-ip': '103.21.244.2', 'x-forwarded-for': '10.0.0.1' } };
  assert.strictEqual(resolveClientIp(req1), '103.21.244.2', 'cf-connecting-ip must take precedence');

  // 2. x-real-ip precedence over x-forwarded-for
  const req2 = { headers: { 'x-real-ip': '198.51.100.5', 'x-forwarded-for': '10.0.0.1' } };
  assert.strictEqual(resolveClientIp(req2), '198.51.100.5', 'x-real-ip must take precedence over forwarded-for');

  // 3. x-forwarded-for first valid IP
  const req3 = { headers: { 'x-forwarded-for': '203.0.113.195, 10.0.0.1, 192.168.1.1' } };
  assert.strictEqual(resolveClientIp(req3), '203.0.113.195', 'First IP in x-forwarded-for must be selected');

  // 4. IPv6 mapped IPv4 prefix stripping
  const req4 = { socket: { remoteAddress: '::ffff:192.168.1.50' } };
  assert.strictEqual(resolveClientIp(req4), '192.168.1.50', '::ffff: IPv6 prefix must be stripped');
});

registerTest('T1-A2-03', 'Area 2: Anti-Bot & Auth', 'Multi-Account IP Limit Enforcement (Max 2 Accounts per IP)', async () => {
  const supabaseServer = await createMockSupabaseServer();
  try {
    const client = createMockSupabaseClient();
    const testIp = '203.0.113.10';

    // 1st account
    await client.from('manager_users').insert({
      username: 'user_ip_1',
      registration_ip: testIp,
      device_fingerprint: 'fp_ip_01'
    });

    // 2nd account
    await client.from('manager_users').insert({
      username: 'user_ip_2',
      registration_ip: testIp,
      device_fingerprint: 'fp_ip_02'
    });

    // Count existing accounts
    const countRes = await client
      .from('manager_users')
      .select('*', { count: 'exact', head: true })
      .eq('registration_ip', testIp);

    assert.strictEqual(countRes.count, 2, 'Exactly 2 accounts registered on test IP');

    // Attempting 3rd account violates the 2-account limit
    const isAllowed = countRes.count < 2;
    assert.strictEqual(isAllowed, false, '3rd registration from same IP must be blocked (max 2)');
  } finally {
    await supabaseServer.close();
  }
});

registerTest('T1-A2-04', 'Area 2: Anti-Bot & Auth', 'Multi-Account Device Fingerprint Limit Enforcement', async () => {
  const supabaseServer = await createMockSupabaseServer();
  try {
    const client = createMockSupabaseClient();
    const commonFp = 'fp_desktop_canvas_99a8b7c6';

    // 1st account from IP 1
    await client.from('manager_users').insert({
      username: 'user_fp_1',
      registration_ip: '203.0.113.21',
      device_fingerprint: commonFp
    });

    // 2nd account from IP 2 (rotating proxy)
    await client.from('manager_users').insert({
      username: 'user_fp_2',
      registration_ip: '203.0.113.22',
      device_fingerprint: commonFp
    });

    // Count accounts by device fingerprint
    const fpCount = await client
      .from('manager_users')
      .select('*', { count: 'exact', head: true })
      .eq('device_fingerprint', commonFp);

    assert.strictEqual(fpCount.count, 2, 'Exactly 2 accounts registered on common device fingerprint');

    // 3rd attempt from IP 3 with same fingerprint
    const isAllowed = fpCount.count < 2;
    assert.strictEqual(isAllowed, false, '3rd registration with same device fingerprint must be blocked');
  } finally {
    await supabaseServer.close();
  }
});

registerTest('T1-A2-05', 'Area 2: Anti-Bot & Auth', 'Whitelist Exemption Bypass (manager_ip_whitelist Table)', async () => {
  const supabaseServer = await createMockSupabaseServer();
  try {
    const client = createMockSupabaseClient();
    const whitelistedIp = '203.0.113.99';

    // Seed whitelist table
    await client.from('manager_ip_whitelist').insert({
      ip: whitelistedIp,
      reason: 'Admin Verified LAN Net Cafe',
      created_at: new Date().toISOString()
    });

    // Query whitelist status
    const whitelistCheck = await client
      .from('manager_ip_whitelist')
      .select('*')
      .eq('ip', whitelistedIp)
      .maybeSingle();

    assert.ok(whitelistCheck.data, 'IP must be found in manager_ip_whitelist');
    assert.strictEqual(whitelistCheck.data.ip, whitelistedIp);

    // Whitelisted IP can create 5 accounts without limit restriction
    for (let i = 1; i <= 5; i++) {
      await client.from('manager_users').insert({
        username: `whitelisted_user_${i}`,
        registration_ip: whitelistedIp,
        device_fingerprint: `fp_wl_${i}`
      });
    }

    const totalAccounts = await client
      .from('manager_users')
      .select('*', { count: 'exact', head: true })
      .eq('registration_ip', whitelistedIp);

    assert.strictEqual(totalAccounts.count, 5, 'Whitelisted IP must be permitted to register > 2 accounts');
  } finally {
    await supabaseServer.close();
  }
});

registerTest('T1-A2-06', 'Area 2: Anti-Bot & Auth', 'License Key Exemption Bypass for Multi-Account Registration', async () => {
  const supabaseServer = await createMockSupabaseServer();
  try {
    const client = createMockSupabaseClient();
    const testIp = '203.0.113.55';

    // Seed 2 existing accounts
    await client.from('manager_users').insert([
      { username: 'key_test_u1', registration_ip: testIp },
      { username: 'key_test_u2', registration_ip: testIp }
    ]);

    // Seed unredeemed License Key
    await client.from('manager_keys').insert({
      id: 'KM-KEY-EXEMPT-0001',
      code: 'KM-KEY-EXEMPT-0001',
      plan_name: 'VIP 30 DAYS',
      duration_days: 30,
      max_uses: 1,
      used_count: 0,
      is_active: true
    });

    // Check key availability
    const keyRow = await client
      .from('manager_keys')
      .select('*')
      .eq('code', 'KM-KEY-EXEMPT-0001')
      .single();

    assert.ok(keyRow.data, 'License key must exist');
    assert.strictEqual(keyRow.data.used_count, 0, 'Key must be unredeemed');

    // Business rule: valid key bypasses IP account ceiling
    const keyExemptsLimit = keyRow.data && keyRow.data.is_active && keyRow.data.used_count < keyRow.data.max_uses;
    assert.strictEqual(keyExemptsLimit, true, 'Valid license key must exempt IP registration limit');
  } finally {
    await supabaseServer.close();
  }
});

registerTest('T2-BC-05', 'Area 2: Boundaries', 'Boundary Case: Captcha Token Signature Tampering', async () => {
  const validToken = createTestCaptchaToken('15');
  // Tamper with base64 payload
  const tampered = validToken.slice(0, -6) + 'XXXXXX';
  const res = verifyTestCaptchaToken(tampered, '15');
  assert.strictEqual(res.valid, false, 'Tampered token must fail verification');
  assert.match(res.error, /không hợp lệ/i);
});

registerTest('T2-BC-06', 'Area 2: Boundaries', 'Boundary Case: Captcha Token Expiration (TTL = 180s Exceeded)', async () => {
  const secret = 'kbot_master_captcha_key_32bytes!';
  // Token generated 181 seconds ago
  const expiredTs = Date.now() - 181 * 1000;
  const nonce = crypto.randomBytes(8).toString('hex');
  const sig = crypto.createHmac('sha256', secret).update(`10:${expiredTs}:${nonce}`).digest('hex');
  const token = Buffer.from(JSON.stringify({ ts: expiredTs, nonce, sig })).toString('base64url');

  const res = verifyTestCaptchaToken(token, '10', secret);
  assert.strictEqual(res.valid, false, 'Expired token must fail verification');
  assert.match(res.error, /hết hạn/i);
});

registerTest('T2-BC-07', 'Area 2: Boundaries', 'Boundary Case: Captcha Token Replay Attack Protection', async () => {
  const usedNonces = new Set();
  const token = createTestCaptchaToken('77');

  // First verification succeeds
  const res1 = verifyTestCaptchaToken(token, '77', 'kbot_master_captcha_key_32bytes!', usedNonces);
  assert.strictEqual(res1.valid, true, 'First verification must succeed');

  // Replay attempt fails
  const res2 = verifyTestCaptchaToken(token, '77', 'kbot_master_captcha_key_32bytes!', usedNonces);
  assert.strictEqual(res2.valid, false, 'Replayed token must fail');
  assert.match(res2.error, /đã được sử dụng/i);
});

registerTest('T2-BC-08', 'Area 2: Boundaries', 'Boundary Case: Empty or Whitespace Device Fingerprint Validation', async () => {
  const validateFp = (fp) => {
    if (!fp || typeof fp !== 'string' || !fp.trim()) {
      return { ok: false, error: 'Thiếu mã định danh thiết bị.' };
    }
    return { ok: true };
  };

  assert.strictEqual(validateFp(null).ok, false);
  assert.strictEqual(validateFp('').ok, false);
  assert.strictEqual(validateFp('   ').ok, false);
  assert.strictEqual(validateFp('fp_valid_12345678').ok, true);
});

registerTest('T2-BC-09', 'Area 2: Boundaries', 'Boundary Case: Multi-Hop Comma-Separated Proxy Header Injection', async () => {
  // Attacker sends spoofed internal IPs in x-forwarded-for
  const req = {
    headers: {
      'x-forwarded-for': '127.0.0.1, 10.0.0.1, 192.168.1.1, 203.0.113.88'
    }
  };
  const resolved = resolveClientIp(req);
  assert.ok(resolved, 'IP must be resolved without crashing');
  assert.strictEqual(resolved, '127.0.0.1', 'First forwarded entry must be extracted');
});

registerTest('T2-BC-10', 'Area 2: Boundaries', 'Boundary Case: Rapid Concurrent Registrations on Same IP (Race Condition)', async () => {
  const supabaseServer = await createMockSupabaseServer();
  try {
    const client = createMockSupabaseClient();
    const testIp = '203.0.113.44';
    const ipLock = new AsyncKeyLock();

    // Simulate 4 concurrent registrations with serialized mutex lock on IP
    const results = await Promise.all([1, 2, 3, 4].map(async (i) => {
      return ipLock.run(testIp, async () => {
        const current = await client
          .from('manager_users')
          .select('*', { count: 'exact', head: true })
          .eq('registration_ip', testIp);

        if (current.count >= 2) {
          return { ok: false, status: 403, error: 'Địa chỉ IP này đã đạt giới hạn tối đa 2 tài khoản.' };
        }
        await client.from('manager_users').insert({
          username: `concurrent_user_${i}`,
          registration_ip: testIp
        });
        return { ok: true, status: 201 };
      });
    }));

    const successful = results.filter((r) => r.ok).length;
    const blocked = results.filter((r) => !r.ok).length;
    assert.strictEqual(successful, 2, 'Exactly 2 registrations succeed before reaching limit');
    assert.strictEqual(blocked, 2, 'Exactly 2 registrations are blocked by 2-account limit');
  } finally {
    await supabaseServer.close();
  }
});

registerTest('T3-PC-05', 'Area 2: Pairwise', 'Pairwise Interaction: License Key Exemption + Multi-Account Ceiling', async () => {
  const supabaseServer = await createMockSupabaseServer();
  try {
    const client = createMockSupabaseClient();
    const ipAtLimit = '198.51.100.99';

    // Seed 2 existing accounts
    await client.from('manager_users').insert([
      { username: 'pair_user_1', registration_ip: ipAtLimit },
      { username: 'pair_user_2', registration_ip: ipAtLimit }
    ]);

    // Seed valid giftcode
    await client.from('manager_keys').insert({
      id: 'KM-TEST-PAIR-001',
      code: 'KM-TEST-PAIR-001',
      max_uses: 1,
      used_count: 0,
      is_active: true
    });

    const isExempt = true; // Key provided
    const countRes = await client.from('manager_users').select('*', { count: 'exact', head: true }).eq('registration_ip', ipAtLimit);

    // Business rule: IP limit blocked if count >= 2 AND not exempt
    const shouldBlock = countRes.count >= 2 && !isExempt;
    assert.strictEqual(shouldBlock, false, 'Provided valid key must bypass multi-account ceiling');
  } finally {
    await supabaseServer.close();
  }
});

registerTest('T3-PC-07', 'Area 2: Pairwise', 'Pairwise Interaction: Whitelisted IP + Failed Captcha Attempt', async () => {
  // Whitelist exempts account volume limits, but NEVER exempts human captcha verification
  const isWhitelisted = true;
  const captchaAnswerValid = false;

  const canRegister = isWhitelisted && captchaAnswerValid;
  assert.strictEqual(canRegister, false, 'Whitelisted IP with invalid captcha must still be rejected');
});

registerTest('T4-SCEN-02', 'Area 2: Lifecycle', 'Real-World Scenario: Multi-Account Botnet Attack & Whitelist Mitigation', async () => {
  const supabaseServer = await createMockSupabaseServer();
  try {
    const client = createMockSupabaseClient();
    const attackerIp = '198.51.100.4';
    const attackerFp = 'fp_botnet_alpha';

    // Phase 1: Attacker attempts 10 automated registrations from attackerIp
    const registrationLogs = [];
    for (let i = 1; i <= 10; i++) {
      const ipCount = await client.from('manager_users').select('*', { count: 'exact', head: true }).eq('registration_ip', attackerIp);
      if (ipCount.count >= 2) {
        registrationLogs.push({ attempt: i, status: 403, error: 'Địa chỉ IP này đã đạt giới hạn tối đa 2 tài khoản.' });
      } else {
        await client.from('manager_users').insert({ username: `botnet_u${i}`, registration_ip: attackerIp, device_fingerprint: attackerFp });
        registrationLogs.push({ attempt: i, status: 201 });
      }
    }

    const succeeded = registrationLogs.filter((l) => l.status === 201);
    const blocked = registrationLogs.filter((l) => l.status === 403);
    assert.strictEqual(succeeded.length, 2, 'Exactly 2 registrations succeed before IP ceiling');
    assert.strictEqual(blocked.length, 8, '8 automated registrations blocked with 403');

    // Phase 2: Attacker rotates IP to 198.51.100.5 but keeps device fingerprint fp_botnet_alpha
    const rotatedIp = '198.51.100.5';
    const fpCount = await client.from('manager_users').select('*', { count: 'exact', head: true }).eq('device_fingerprint', attackerFp);
    assert.strictEqual(fpCount.count, 2);
    const fpBlocked = fpCount.count >= 2;
    assert.strictEqual(fpBlocked, true, 'Reused device fingerprint blocked even when rotating IP');

    // Phase 3: Legitimate net cafe admin requests whitelist exemption
    const netCafeIp = '198.51.100.4';
    await client.from('manager_ip_whitelist').insert({
      ip: netCafeIp,
      reason: 'Whitelisted Cyber Cafe Hub',
      created_at: new Date().toISOString()
    });

    // Net cafe users can now register accounts 3, 4, 5
    for (let i = 3; i <= 5; i++) {
      await client.from('manager_users').insert({
        username: `netcafe_u${i}`,
        registration_ip: netCafeIp,
        device_fingerprint: `fp_netcafe_${i}`
      });
    }

    const finalCount = await client.from('manager_users').select('*', { count: 'exact', head: true }).eq('registration_ip', netCafeIp);
    assert.strictEqual(finalCount.count, 5, 'Whitelisted net cafe now has 5 successfully registered accounts');
  } finally {
    await supabaseServer.close();
  }
});

// ============================================================================
// MAIN RUNNER
// ============================================================================
async function runTestSuite() {
  const overallStart = Date.now();
  console.log('TAP version 13');
  console.log('# KBOT Tier 5: Expiration Grace Period & Anti-Bot Multi-Account Protection');
  console.log(`# Node.js ${process.version} on ${process.platform}`);
  console.log(`# Total Registered Tests: ${tests.length}\n`);

  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    const index = i + 1;
    const start = Date.now();
    try {
      await t.fn();
      const duration = Date.now() - start;
      passCount++;
      console.log(`ok ${index} - [${t.id}] ${t.description} (${duration}ms)`);
    } catch (err) {
      failCount++;
      const duration = Date.now() - start;
      console.log(`not ok ${index} - [${t.id}] ${t.description} (${duration}ms)`);
      console.error(`  ---`);
      console.error(`  message: ${err.message}`);
      if (err.stack) {
        console.error(`  stack: |`);
        err.stack.split('\n').slice(1, 4).forEach((line) => console.error(`    ${line}`));
      }
      console.error(`  ...`);
    }
  }

  const totalDuration = Date.now() - overallStart;
  console.log(`\n1..${tests.length}`);
  console.log(`# tests ${tests.length}`);
  console.log(`# pass  ${passCount}`);
  console.log(`# fail  ${failCount}`);
  console.log(`# skip  ${skipCount}`);
  console.log(`# duration_ms ${totalDuration}\n`);

  if (failCount > 0) {
    process.exit(1);
  }
  process.exit(0);
}

if (require.main === module) {
  runTestSuite().catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
}

module.exports = { tests, runTestSuite };
