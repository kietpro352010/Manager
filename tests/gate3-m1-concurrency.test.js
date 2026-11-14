'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const http = require('node:http');
const express = require('express');

const AsyncKeyLock = require('../src/services/async-key-lock');
const { EntitlementService } = require('../src/services/entitlement-service');
const { validateProxyUrl, isPrivateOrBlockedIp, isLocalOrPrivateHost } = require('../src/services/proxy-validation');
const { Link4mService, vietnamDayStart } = require('../src/services/link4m-service');
const { createUserApi } = require('../src/http/routes/user-api');

function sha256(val) {
  return crypto.createHash('sha256').update(String(val)).digest('hex');
}

function createSilentLogger() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {}
  };
}

async function testP601AsyncKeyLockTimeoutHold() {
  console.log('1. Testing P6-01: AsyncKeyLock Timeout Lock Hold Until Task Settles...');

  const lock = new AsyncKeyLock();
  let task1Started = false;
  let task1Finished = false;
  let task2Started = false;
  let task2Finished = false;
  let task1SettledAt = 0;
  let task2StartedAt = 0;

  // Task 1: Execution timeout is 40ms, but task takes 120ms to settle.
  const task1Promise = lock.run('resource_x', async () => {
    task1Started = true;
    await new Promise((r) => setTimeout(r, 120));
    task1Finished = true;
    task1SettledAt = Date.now();
    return 'task1_done';
  }, { executionTimeoutMs: 40 });

  // Task 2: Queued immediately on the same key 'resource_x'.
  // Under the old buggy lock, task 2 would start at ~40ms while task 1 is still running.
  // With the fix, task 2 MUST NOT start until task 1 settles at ~120ms.
  let task2Promise;
  await new Promise((r) => setTimeout(r, 10)); // Ensure task 1 acquires lock first

  task2Promise = lock.run('resource_x', async () => {
    task2Started = true;
    task2StartedAt = Date.now();
    await new Promise((r) => setTimeout(r, 20));
    task2Finished = true;
    return 'task2_done';
  }, { executionTimeoutMs: 500 });

  // Caller of task 1 must be rejected with execution timeout
  let task1Error = null;
  try {
    await task1Promise;
  } catch (err) {
    task1Error = err;
  }
  assert.ok(task1Error, 'Task 1 must reject on execution timeout');
  assert.ok(/Execution timeout for local key lock/.test(task1Error.message), 'Error must be execution timeout');

  // Task 2 must complete successfully
  const task2Result = await task2Promise;
  assert.strictEqual(task2Result, 'task2_done');
  assert.strictEqual(task1Finished, true, 'Task 1 must have finished background execution');
  assert.strictEqual(task2Finished, true, 'Task 2 must have finished execution');
  assert.ok(task2StartedAt >= task1SettledAt - 5, `Task 2 started (${task2StartedAt}) must be after Task 1 settled (${task1SettledAt})`);
  assert.strictEqual(lock.size(), 0, 'AsyncKeyLock counts and tails must be fully cleaned up (size 0)');

  // Normal fast execution test
  const fastRes = await lock.run('resource_y', async () => 42, { executionTimeoutMs: 100 });
  assert.strictEqual(fastRes, 42);
  assert.strictEqual(lock.size(), 0);

  // Regression test: waitTimeoutMs tail task timeout must not sever queue or permit concurrent execution
  const queueTimeoutLock = new AsyncKeyLock();
  let concurrent = 0;
  let maxConcurrent = 0;

  // Task 1: running for 100ms
  const t1 = queueTimeoutLock.run('regression_wait_key', async () => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise((r) => setTimeout(r, 100));
    concurrent--;
  });

  // Task 2: queued
  const t2 = queueTimeoutLock.run('regression_wait_key', async () => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise((r) => setTimeout(r, 20));
    concurrent--;
  });

  // Task 3: queued with 20ms wait timeout
  const t3 = queueTimeoutLock.run('regression_wait_key', async () => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise((r) => setTimeout(r, 20));
    concurrent--;
  }, { waitTimeoutMs: 20 }).catch(() => {});

  // Wait 40ms so Task 3 times out
  await new Promise((r) => setTimeout(r, 40));

  // Task 4: dispatched at 40ms while Task 1 is still running
  const t4 = queueTimeoutLock.run('regression_wait_key', async () => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise((r) => setTimeout(r, 20));
    concurrent--;
  });

  await Promise.allSettled([t1, t2, t3, t4]);
  assert.strictEqual(maxConcurrent, 1, `Max concurrent executions must be 1, but got ${maxConcurrent}`);
  assert.strictEqual(queueTimeoutLock.size(), 0, 'AsyncKeyLock counts and tails must be fully cleaned up (size 0)');

  console.log('✅ P6-01: AsyncKeyLock timeout hold until settled verified.');
}

async function testP602EntitlementPendingAllocationCompensation() {
  console.log('2. Testing P6-02: EntitlementService savePendingAllocation Error Handling & Compensation State...');

  const outboxEntries = [];
  const mockStore = {
    getKey: async (code) => ({
      keyId: 'key_comp_test',
      code: 'KM-TEST-COMP-KEY1',
      days: 30,
      botCount: 3,
      maxUses: 1,
      usedCount: 0,
      workerIds: []
    }),
    assignedUser: async () => null,
    redeemKeyWithAccess: async () => true,
    enqueueOutbox: async (item) => {
      outboxEntries.push(item);
      return item;
    },
    adapter: {
      // Simulate failure in adapter savePendingAllocation
      savePendingAllocation: async () => {
        return false; // Returns false on failure
      }
    }
  };

  const service = new EntitlementService({
    store: mockStore,
    registry: { list: async () => [{ workerId: 'bot-01' }] }, // Only 1 bot available, quota is 3 -> 2 missing
    accessControl: { memberFor: async () => ({ userId: 'user_comp', username: 'user_comp', workerIds: [] }) },
    logger: createSilentLogger(),
    userLock: new AsyncKeyLock()
  });

  const res = await service.redeem('user_comp', 'KM-TEST-COMP-KEY1');
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.assignedCount, 1);
  assert.strictEqual(res.targetCount, 3);
  assert.strictEqual(res.missingWorkers, 2);

  // Compensation state must be preserved
  assert.ok(res.compensationState, 'Compensation state must be returned when savePendingAllocation fails');
  assert.strictEqual(res.compensationState.missingBotCount, 2);
  assert.strictEqual(res.compensationState.username, 'user_comp');

  // Verify in-memory compensation map
  const pending = service.getPendingCompensations();
  assert.strictEqual(pending.length, 1);
  assert.strictEqual(pending[0].missingBotCount, 2);

  // Verify outbox queue persistence
  assert.strictEqual(outboxEntries.length, 1);
  assert.strictEqual(outboxEntries[0].taskType, 'pending_allocation_compensation');
  assert.strictEqual(outboxEntries[0].payload.missingBotCount, 2);

  // Test case when adapter throws
  mockStore.adapter.savePendingAllocation = async () => {
    throw new Error('Supabase network unreachable');
  };
  service.clearPendingCompensations();
  outboxEntries.length = 0;

  const res2 = await service.redeem('user_comp', 'KM-TEST-COMP-KEY1');
  assert.strictEqual(res2.success, true);
  assert.ok(res2.compensationState);
  assert.strictEqual(res2.compensationState.missingBotCount, 2);
  assert.strictEqual(service.getPendingCompensations().length, 1);
  assert.strictEqual(outboxEntries.length, 1);

  console.log('✅ P6-02: EntitlementService durable compensation state on savePendingAllocation failure verified.');
}

async function testP603ProxyValidationSSRF() {
  console.log('3. Testing P6-03: Proxy Validation DNS Resolution & SSRF IP Range Blocking...');

  // 1. Direct forbidden IP formats
  const blockedIps = [
    'socks5://127.0.0.1:1080',
    'socks5://127.0.1.1:1080',
    'http://10.0.0.1:8080',
    'https://10.255.255.254:8443',
    'socks5://172.16.0.1:1080',
    'socks5://172.31.255.255:1080',
    'http://192.168.0.1:3128',
    'http://192.168.100.50:3128',
    'socks5://169.254.169.254:1080',
    'socks5://169.254.1.1:1080',
    'socks5://[::1]:1080',
    'socks5://localhost:1080',
    'http://instance-data:8080'
  ];

  for (const proxy of blockedIps) {
    await assert.rejects(
      async () => await validateProxyUrl(proxy),
      /Proxy không được trỏ về địa chỉ nội bộ hoặc loopback/,
      `Proxy ${proxy} must be rejected as local/private/SSRF`
    );
  }

  // 2. Valid public IP proxy
  const validProxy = 'socks5://1.1.1.1:1080';
  const validated = await validateProxyUrl(validProxy);
  assert.strictEqual(validated, validProxy);

  // 3. Valid authenticated proxy format
  const validAuthProxy = 'http://user123:pass456@1.1.1.1:8080';
  const validatedAuth = await validateProxyUrl(validAuthProxy);
  assert.strictEqual(validatedAuth, validAuthProxy);

  // 4. Invalid port numbers
  await assert.rejects(async () => await validateProxyUrl('socks5://1.1.1.1:0'), /cổng hợp lệ/);
  await assert.rejects(async () => await validateProxyUrl('socks5://1.1.1.1:70000'), /cổng hợp lệ|Proxy URL không hợp lệ/);
  await assert.rejects(async () => await validateProxyUrl('socks5://1.1.1.1'), /cổng hợp lệ/);

  // 5. Test Express route /bot/:id/proxy/test rejects SSRF
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.managerAuthSession = {
      username: 'testuser',
      userId: 'usr_1',
      role: 'user',
      status: 'active',
      allowAccountChange: true,
      assignedBotIds: ['bot-1']
    };
    next();
  });
  app.use('/api', createUserApi({
    store: { addAudit: async () => true },
    registry: {
      find: async () => ({ workerId: 'bot-1', botNumber: 1, status: { state: 'online' } }),
      saveConfig: async () => true,
      updateProxy: async () => true
    },
    broker: { dispatch: async () => ({ delivered: true, result: { ok: true } }) },
    logger: createSilentLogger()
  }));

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  try {
    const resTest = await fetch(`http://127.0.0.1:${port}/api/bot/bot-1/proxy/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proxy: 'socks5://127.0.0.1:1080' })
    });
    const bodyTest = await resTest.json();
    assert.strictEqual(resTest.status, 400);
    assert.strictEqual(bodyTest.ok, false);
    assert.ok(/Proxy không được trỏ về địa chỉ nội bộ/.test(bodyTest.error));

    const resSave = await fetch(`http://127.0.0.1:${port}/api/bot/bot-1/proxy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proxy: 'socks5://10.0.0.1:1080' })
    });
    const bodySave = await resSave.json();
    assert.strictEqual(resSave.status, 400);
    assert.strictEqual(bodySave.ok, false);
    assert.ok(/Proxy không được trỏ về địa chỉ nội bộ/.test(bodySave.error));
  } finally {
    await new Promise((r) => server.close(r));
  }

  console.log('✅ P6-03: Proxy validation DNS resolution & SSRF range blocking verified.');
}

async function testP604AndP606Link4mDailyLimitsAndTokenVerification() {
  console.log('4. Testing P6-04 & P6-06: Link4M Daily Limits Check Ordering & Token Verification...');

  let countClaimsCalled = false;
  let activeAttemptQueried = false;

  const mockStore = {
    countLinkRewards: async () => 2, // User has already claimed 2 rewards today
    lastLinkReward: async () => null,
    findActiveLinkAttempt: async () => {
      activeAttemptQueried = true;
      return {
        attemptId: 'att_active_reused',
        providerUrl: 'https://link4m.co/short/reused',
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        rewardHours: 6
      };
    },
    getLinkAttempt: async (id) => {
      if (id === 'att_valid') {
        return {
          attemptId: 'att_valid',
          userId: 'user_l4m',
          tokenHash: sha256('token_secret_123'),
          createdAt: new Date(Date.now() - 20000).toISOString(), // > 12s solve time
          rewardHours: 6,
          status: 'pending'
        };
      }
      return null;
    },
    claimLinkAttempt: async () => ({ rewardHours: 6 }),
    completeLink4mReward: async () => true,
    addAudit: async () => true
  };

  const link4m = new Link4mService({
    store: mockStore,
    accessControl: {
      memberFor: async () => ({ userId: 'user_l4m', username: 'user_l4m', role: 'user', isPermanent: false, status: 'active', workerIds: ['bot-1'] }),
      isEntitled: () => true
    },
    config: {
      enabled: true,
      apiToken: 'test_token',
      publicBaseUrl: 'http://localhost:3000',
      dailyLimit: 2,
      rewardHours: 6
    },
    logger: createSilentLogger()
  });

  // 1. When daily limit is reached, startAttempt must throw daily limit error BEFORE checking/returning active attempt
  await assert.rejects(
    async () => await link4m.startAttempt('user_l4m', '127.0.0.1'),
    /Bạn đã đạt giới hạn 2 lượt vượt link nhận thưởng hôm nay/,
    'startAttempt must throw daily limit error and not reuse active attempt'
  );
  assert.strictEqual(activeAttemptQueried, false, 'findActiveLinkAttempt must NOT be called when daily limit is reached');

  // 2. Token verification: empty token throws
  await assert.rejects(
    async () => await link4m.verifyAndClaimReward('', 'att_valid'),
    /Thiếu token xác minh vượt link/
  );

  // 3. Token verification: wrong token throws
  await assert.rejects(
    async () => await link4m.verifyAndClaimReward('wrong_token', 'att_valid'),
    /Mã token xác minh vượt link không hợp lệ/
  );

  // 4. Token verification: valid token succeeds
  const claimRes = await link4m.verifyAndClaimReward('token_secret_123', 'att_valid');
  assert.strictEqual(claimRes.ok, true);
  assert.strictEqual(claimRes.rewardHours, 6);

  console.log('✅ P6-04 & P6-06: Link4M daily limits check ordering and token verification verified.');
}

async function testP605EntitlementFixedBotQuotaCap() {
  console.log('5. Testing P6-05: EntitlementService Fixed Bot IDs Allocation Capped Strictly at targetCount...');

  const mockStore = {
    getKey: async () => ({
      keyId: 'key_fixed_cap',
      code: 'KM-FIXED-CAP-5BOTS',
      days: 30,
      botCount: 2, // Target quota is strictly 2 bots
      maxUses: 1,
      usedCount: 0,
      // Key contains 5 fixed worker IDs
      workerIds: ['bot-01', 'bot-02', 'bot-03', 'bot-04', 'bot-05']
    }),
    assignedUser: async () => null,
    redeemKeyWithAccess: async () => true
  };

  const registeredCandidates = [
    { workerId: 'bot-01' },
    { workerId: 'bot-02' },
    { workerId: 'bot-03' },
    { workerId: 'bot-04' },
    { workerId: 'bot-05' }
  ];

  const service = new EntitlementService({
    store: mockStore,
    registry: { list: async () => registeredCandidates },
    accessControl: { memberFor: async () => ({ userId: 'user_quota', username: 'user_quota', workerIds: [] }) },
    logger: createSilentLogger(),
    userLock: new AsyncKeyLock()
  });

  const res = await service.redeem('user_quota', 'KM-FIXED-CAP-5BOTS');
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.targetCount, 2, 'targetCount must be 2');
  assert.strictEqual(res.assignedCount, 2, 'Assigned count must strictly cap at 2');
  assert.strictEqual(res.workerIds.length, 2, 'Assigned workerIds length must strictly cap at 2');
  assert.deepStrictEqual(res.workerIds, ['bot-01', 'bot-02'], 'Only first 2 fixed bots should be allocated');

  console.log('✅ P6-05: Fixed bot IDs allocation strictly capped at targetCount verified.');
}

async function testP607BotSettingsSanitization() {
  console.log('6. Testing P6-07: POST /bot/:id/settings Response Sanitization...');

  const rawBotWorker = {
    workerId: 'bot-secret-1',
    botNumber: 1,
    alias: 'FarmBot',
    serverHost: 'mc.hypixel.net',
    serverPort: 25565,
    username: 'FarmerBob',
    secretKey: 'RAW_SECRET_KEY_NEVER_LEAK',
    secretCiphertext: 'CIPHERTEXT_XYZ',
    url: 'http://10.0.0.5:3000',
    serviceUrl: 'http://10.0.0.5:3000',
    sourceUrl: 'http://10.0.0.5:3000',
    registryFile: '/etc/kbot/secret.json',
    ipAddress: '10.0.0.5',
    host: 'worker-internal.lan',
    proxy: 'socks5://private-proxy:1080',
    proxyCiphertext: 'PROXY_CIPHER',
    status: { state: 'online' },
    settings: {
      spawnCommands: '/login SuperSecretPassword123'
    }
  };

  const app = express();
  app.use(express.json());

  // Rental user session (allowAccountChange: false or true)
  app.use((req, res, next) => {
    req.managerAuthSession = {
      username: 'client_bob',
      userId: 'usr_bob',
      role: 'user', // non-admin
      status: 'active',
      allowAccountChange: true,
      assignedBotIds: ['bot-secret-1']
    };
    next();
  });

  app.use('/api', createUserApi({
    store: { addAudit: async () => true },
    registry: {
      find: async () => rawBotWorker,
      saveConfig: async (_id, config) => config
    },
    broker: { dispatch: async () => ({ delivered: true, result: { ok: true } }) },
    logger: createSilentLogger()
  }));

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/bot/bot-secret-1/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ alias: 'UpdatedFarmBot' })
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.ok, true);

    const bot = body.bot;
    assert.ok(bot, 'Response must include bot');
    assert.strictEqual(bot.alias, 'UpdatedFarmBot');

    // Sensitive internal fields MUST be stripped
    assert.strictEqual(bot.secretKey, undefined, 'secretKey must be stripped');
    assert.strictEqual(bot.secretCiphertext, undefined, 'secretCiphertext must be stripped');
    assert.strictEqual(bot.sourceUrl, undefined, 'sourceUrl must be stripped');
    assert.strictEqual(bot.registryFile, undefined, 'registryFile must be stripped');
    assert.strictEqual(bot.proxyCiphertext, null, 'proxyCiphertext must be null');
    assert.strictEqual(bot.url, '', 'url must be empty string');
    assert.strictEqual(bot.serviceUrl, '', 'serviceUrl must be empty string');
    assert.strictEqual(bot.ipAddress, '', 'ipAddress must be empty string');
    assert.strictEqual(bot.host, '', 'host must be empty string');
    assert.strictEqual(bot.proxy, null, 'proxy must be null');
  } finally {
    await new Promise((r) => server.close(r));
  }

  console.log('✅ P6-07: POST /bot/:id/settings response sanitization verified.');
}

async function testP608KeyRedemptionConcurrency() {
  console.log('7. Testing P6-08: License Key Activation Concurrency Serialization on key:${codeHash}...');

  const lock = new AsyncKeyLock();
  let keyUses = 0;
  const mockKey = {
    keyId: 'key_race_1',
    code: 'KM-RACE-CONCURRENCY-1',
    days: 7,
    botCount: 1,
    maxUses: 1,
    usedCount: 0,
    usedUsers: []
  };

  const mockStore = {
    getKey: async () => {
      // Return fresh copy with current usedCount
      return { ...mockKey, usedCount: keyUses };
    },
    assignedUser: async () => null,
    redeemKeyWithAccess: async (_hash, userId) => {
      await new Promise((r) => setTimeout(r, 20)); // Simulate async DB transaction
      if (keyUses >= 1) return false;
      keyUses++;
      mockKey.usedCount = keyUses;
      mockKey.usedUsers.push(userId);
      return true;
    }
  };

  const service = new EntitlementService({
    store: mockStore,
    registry: { list: async () => [{ workerId: 'bot-1' }] },
    accessControl: { memberFor: async (id) => ({ userId: id, username: id, workerIds: [] }) },
    logger: createSilentLogger(),
    userLock: lock
  });

  // Launch two parallel redemptions of the same key code concurrently
  const [res1, res2] = await Promise.allSettled([
    service.redeem('user_alpha', 'KM-RACE-CONCURRENCY-1'),
    service.redeem('user_beta', 'KM-RACE-CONCURRENCY-1')
  ]);

  const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
  const rejected = [res1, res2].filter((r) => r.status === 'rejected');

  assert.strictEqual(fulfilled.length, 1, 'Exactly one concurrent redemption must succeed');
  assert.strictEqual(rejected.length, 1, 'The other concurrent redemption must fail');
  assert.strictEqual(keyUses, 1, 'Key must be consumed exactly once');
  assert.ok(
    /đã hết lượt sử dụng|Giao dịch nguyên tử không thành công/.test(rejected[0].reason?.message),
    `Rejected request must report key exhausted or transaction failed: ${rejected[0].reason?.message}`
  );

  console.log('✅ P6-08: License key activation concurrency serialization verified.');
}

async function runAllGate3M1Tests() {
  console.log('===============================================================');
  console.log('--- GATE 3 MILESTONE 1: CONCURRENCY & NETWORK SECURITY TESTS ---');
  console.log('===============================================================');

  await testP601AsyncKeyLockTimeoutHold();
  await testP602EntitlementPendingAllocationCompensation();
  await testP603ProxyValidationSSRF();
  await testP604AndP606Link4mDailyLimitsAndTokenVerification();
  await testP605EntitlementFixedBotQuotaCap();
  await testP607BotSettingsSanitization();
  await testP608KeyRedemptionConcurrency();

  console.log('===============================================================');
  console.log('🎉 ALL GATE 3 MILESTONE 1 (P6-01 to P6-08) TESTS PASSED 100%!');
  console.log('===============================================================');
}

runAllGate3M1Tests().catch((err) => {
  console.error('❌ Gate 3 M1 test failure:', err);
  process.exit(1);
});
