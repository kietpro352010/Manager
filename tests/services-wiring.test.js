'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const express = require('express');

const AsyncKeyLock = require('../src/services/async-key-lock');
const { AccessControl } = require('../src/services/access-control');
const { Link4mService } = require('../src/services/link4m-service');
const CommandBroker = require('../src/services/command-broker');
const FleetOperations = require('../src/services/fleet-operations');
const { EntitlementService, isWorkerStopConfirmed } = require('../src/services/entitlement-service');
const { createApp } = require('../src/http/app');
const { createWorkerApi } = require('../src/http/routes/worker-api');
const { createUserApi } = require('../src/http/routes/user-api');

function createSilentLogger() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {}
  };
}

function createInMemoryTableStore() {
  const tables = {
    users: new Map(),
    settings: new Map(),
    linkAttempts: new Map(),
    audit: []
  };

  const store = {
    tables,
    async getAccess(userId) {
      const rec = tables.users.get(String(userId));
      return rec ? { ...rec, workerIds: [...(rec.workerIds || [])] } : null;
    },
    async listAccess() {
      return [...tables.users.values()].map((rec) => ({
        ...rec,
        workerIds: [...(rec.workerIds || [])],
        stopPendingWorkers: Array.isArray(rec.stopPendingWorkers) ? [...rec.stopPendingWorkers] : []
      }));
    },
    async setAccess(userId, values) {
      const key = String(userId);
      const current = tables.users.get(key) || { userId: key, id: key };
      const next = {
        ...current,
        ...values,
        userId: key,
        workerIds: Array.isArray(values.workerIds) ? [...values.workerIds] : [...(current.workerIds || [])],
        stopPendingWorkers: Array.isArray(values.stopPendingWorkers) ? [...values.stopPendingWorkers] : []
      };
      tables.users.set(key, next);
      return { ...next };
    },
    async getSetting(key) {
      const val = tables.settings.get(String(key));
      return val ? { ...val } : null;
    },
    async setSetting(key, value) {
      const saved = { ...value, updatedAt: new Date().toISOString() };
      tables.settings.set(String(key), saved);
      return { ...saved };
    },
    async findActiveLinkAttempt(userId, now = new Date()) {
      const nowMs = new Date(now).getTime();
      const matches = [...tables.linkAttempts.values()]
        .filter((a) => a.userId === String(userId) && a.status === 'pending' && new Date(a.expiresAt).getTime() > nowMs)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return matches[0] ? { ...matches[0] } : null;
    },
    async getLinkAttempt(attemptId) {
      const found = tables.linkAttempts.get(String(attemptId));
      return found ? { ...found } : null;
    },
    async getLinkAttemptByTokenHash(tokenHash) {
      const found = [...tables.linkAttempts.values()].find((a) => a.tokenHash === tokenHash);
      return found ? { ...found } : null;
    },
    async getLatestLinkAttempt(userId) {
      const matches = [...tables.linkAttempts.values()]
        .filter((a) => a.userId === String(userId))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return matches[0] ? { ...matches[0] } : null;
    },
    async countLinkRewards(userId, since) {
      const sinceMs = new Date(since).getTime();
      return [...tables.linkAttempts.values()].filter(
        (a) => a.userId === String(userId) && a.status === 'rewarded' && a.rewardedAt && new Date(a.rewardedAt).getTime() >= sinceMs
      ).length;
    },
    async lastLinkReward(userId) {
      const matches = [...tables.linkAttempts.values()]
        .filter((a) => a.userId === String(userId) && a.status === 'rewarded' && a.rewardedAt)
        .sort((a, b) => new Date(b.rewardedAt).getTime() - new Date(a.rewardedAt).getTime());
      return matches[0] ? { ...matches[0] } : null;
    },
    async createLinkAttempt(record) {
      const copy = { ...record };
      tables.linkAttempts.set(String(record.attemptId), copy);
      return { ...copy };
    },
    async setLinkAttemptProviderUrl(attemptId, providerUrl) {
      const row = tables.linkAttempts.get(String(attemptId));
      if (!row || row.status !== 'pending') return false;
      row.providerUrl = providerUrl;
      return true;
    },
    async expireLinkAttempt(attemptId) {
      const row = tables.linkAttempts.get(String(attemptId));
      if (row && row.status === 'pending') row.status = 'expired';
    },
    async expireLinkAttempts(userId, now = new Date()) {
      const nowMs = new Date(now).getTime();
      for (const row of tables.linkAttempts.values()) {
        if (row.userId === String(userId) && row.status === 'pending' && new Date(row.expiresAt).getTime() <= nowMs) {
          row.status = 'expired';
        }
      }
    },
    async claimLinkAttempt(attemptId, tokenHash) {
      const row = tables.linkAttempts.get(String(attemptId));
      if (!row || row.status !== 'pending' || row.tokenHash !== tokenHash) return null;
      row.status = 'processing';
      row.processingAt = new Date().toISOString();
      return { ...row };
    },
    async completeLink4mReward(attemptId, userId, values) {
      const row = tables.linkAttempts.get(String(attemptId));
      if (!row || row.status !== 'processing') return null;
      row.status = 'rewarded';
      row.rewardedAt = new Date().toISOString();
      await store.setAccess(userId, values);
      return { ...row };
    },
    async resetLinkAttempt(attemptId) {
      const row = tables.linkAttempts.get(String(attemptId));
      if (row && row.status === 'processing') {
        row.status = 'pending';
        row.processingAt = null;
      }
    },
    async addAudit(entry) {
      tables.audit.push({ ...entry, createdAt: new Date().toISOString() });
      return true;
    }
  };

  return store;
}

async function testIndexJsLink4mWiring() {
  console.log('1. Verifying src/index.js Link4M & Service DI Wiring...');
  const indexPath = path.resolve(__dirname, '../src/index.js');
  const source = fs.readFileSync(indexPath, 'utf8');

  const runtimeSettingsMatch = source.match(/new ManagerRuntimeSettings\(\s*\{[\s\S]*?\}\s*\)/);
  assert.ok(runtimeSettingsMatch, 'index.js must instantiate ManagerRuntimeSettings');
  assert.match(runtimeSettingsMatch[0], /link4mApiToken\s*:\s*config\.link4mApiToken/, 'ManagerRuntimeSettings must receive initial link4mApiToken');
  assert.match(runtimeSettingsMatch[0], /link4mSecretKey\s*:\s*config\.link4mSecretKey/, 'ManagerRuntimeSettings must receive initial link4mSecretKey');

  const runtimeConfigMatch = source.match(/const runtimeConfig\s*=\s*\{[\s\S]*?\n\s*\};/);
  assert.ok(runtimeConfigMatch, 'index.js must define runtimeConfig');
  assert.match(
    runtimeConfigMatch[0],
    /link4mApiToken\s*:\s*integrationSettings\.link4mApiToken\s*\|\|\s*config\.link4mApiToken/,
    'runtimeConfig must forward link4mApiToken'
  );
  assert.match(
    runtimeConfigMatch[0],
    /link4mSecretKey\s*:\s*integrationSettings\.link4mSecretKey\s*\|\|\s*config\.link4mSecretKey/,
    'runtimeConfig must forward link4mSecretKey'
  );

  const link4mCtorMatch = source.match(/new Link4mService\(\s*\{[\s\S]*?\}\s*\)/);
  assert.ok(link4mCtorMatch, 'index.js must instantiate Link4mService');
  assert.match(link4mCtorMatch[0], /\bstore\s*:\s*accessStore\b/, 'Link4mService must receive store: accessStore');
  assert.match(link4mCtorMatch[0], /\baccessControl\b/, 'Link4mService must receive accessControl');
  assert.match(link4mCtorMatch[0], /\buserLock\b/, 'Link4mService must receive userLock');
  assert.match(link4mCtorMatch[0], /\bconfig\s*:\s*runtimeConfig\b/, 'Link4mService must receive config: runtimeConfig');
  assert.match(link4mCtorMatch[0], /\blogger\b/, 'Link4mService must receive logger');
  assert.match(source, /await\s+link4mService\.initialize\(\)/, 'index.js must invoke await link4mService.initialize()');

  const entitlementCtorMatch = source.match(/new EntitlementService\(\s*\{[\s\S]*?\}\s*\)/);
  assert.ok(entitlementCtorMatch, 'index.js must instantiate EntitlementService');
  assert.match(entitlementCtorMatch[0], /\baccessControl\b/, 'EntitlementService must receive accessControl');
  assert.match(entitlementCtorMatch[0], /\buserLock\b/, 'EntitlementService must receive userLock');

  const createAppMatch = source.match(/createApp\(\s*\{[\s\S]*?\}\s*\)/);
  assert.ok(createAppMatch, 'index.js must pass services to createApp');
  assert.match(createAppMatch[0], /\blink4mService\b/, 'createApp must receive link4mService');
  assert.match(createAppMatch[0], /\bentitlementService\b/, 'createApp must receive entitlementService');

  console.log('✅ 1. src/index.js Link4M & Service DI Wiring verified.');
}

async function testRealLink4mAccessControlAndLockWiring() {
  console.log('2. Testing Real AccessControl + AsyncKeyLock + Link4mService Wiring & Concurrency...');
  const store = createInMemoryTableStore();
  const logger = createSilentLogger();
  const userLock = new AsyncKeyLock();
  const accessControl = new AccessControl({ store });

  const nowMs = Date.now();
  const initialActiveExpiryMs = nowMs + 2 * 3600 * 1000;

  await store.setAccess('user_active_1', {
    userId: 'user_active_1',
    username: 'alice',
    role: 'user',
    status: 'active',
    isPermanent: false,
    expiresAt: new Date(initialActiveExpiryMs).toISOString(),
    workerIds: ['bot-01'],
    planName: 'Standard'
  });

  await store.setAccess('user_expired_1', {
    userId: 'user_expired_1',
    username: 'bob',
    role: 'user',
    status: 'expired',
    isPermanent: false,
    expiresAt: new Date(nowMs - 3 * 3600 * 1000).toISOString(),
    workerIds: ['bot-02'],
    planName: 'Standard'
  });

  await store.setAccess('user_webhook_1', {
    userId: 'user_webhook_1',
    username: 'carol',
    role: 'user',
    status: 'active',
    isPermanent: false,
    expiresAt: new Date(nowMs + 1 * 3600 * 1000).toISOString(),
    workerIds: ['bot-03'],
    planName: 'Standard'
  });

  let fetchCalls = 0;
  const capturedReturnUrls = [];
  const fakeFetch = async (requestUrl) => {
    fetchCalls += 1;
    await new Promise((r) => setTimeout(r, 15));
    const parsed = new URL(String(requestUrl));
    const targetReturnUrl = parsed.searchParams.get('url');
    capturedReturnUrls.push(targetReturnUrl);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ shortenedUrl: `https://link4m.co/short/s${fetchCalls}` })
    };
  };

  const runtimeConfig = {
    publicBaseUrl: 'https://mgr.kingmc.test',
    link4mApiToken: 'token_test_123',
    link4mSecretKey: 'secret_webhook_456',
    link4mRewardEnabled: true,
    link4mRewardHours: 6,
    link4mDailyLimit: 2
  };

  const link4mService = new Link4mService({
    store,
    accessControl,
    userLock,
    config: runtimeConfig,
    logger,
    fetchImpl: fakeFetch
  });

  await link4mService.initialize();
  const storedRuntime = await store.getSetting('link4m_runtime');
  assert.strictEqual(storedRuntime.enabled, true, 'initialize() must persist enabled setting');
  assert.strictEqual(storedRuntime.rewardHours, 6, 'initialize() must persist rewardHours setting');
  assert.strictEqual(storedRuntime.dailyLimit, 2, 'initialize() must persist dailyLimit setting');

  // Re-initializing (e.g. manager restart with existing manager_settings row) hydrates runtime config from DB
  await link4mService.initialize();

  const pub = link4mService.publicConfig();
  assert.strictEqual(pub.providerConfigured, true);
  assert.strictEqual(pub.webhookConfigured, true);
  assert.strictEqual(pub.callbackConfigured, true);

  const initialQuota = await link4mService.getDailyQuotaStatus('user_active_1');
  const initialStatus = await link4mService.status('user_active_1');
  assert.deepStrictEqual(initialStatus, initialQuota, 'status() and getDailyQuotaStatus() must match');
  assert.strictEqual(initialQuota.ok, true);
  assert.strictEqual(initialQuota.eligible, true);
  assert.strictEqual(initialQuota.usedToday, 0);
  assert.strictEqual(initialQuota.remainingToday, 2);
  assert.strictEqual(initialQuota.accessActive, true);

  // Concurrent startAttempt & status/getDailyQuotaStatus calls serialize cleanly via userLock
  const [start1, start2, concurrentStatus, concurrentQuota] = await Promise.all([
    link4mService.startAttempt('user_active_1', '127.0.0.1'),
    link4mService.startAttempt('user_active_1', '127.0.0.1'),
    link4mService.status('user_active_1'),
    link4mService.getDailyQuotaStatus('user_active_1')
  ]);
  assert.strictEqual(concurrentStatus.ok, true);
  assert.strictEqual(concurrentQuota.ok, true);
  assert.strictEqual(fetchCalls, 1, 'userLock must prevent duplicate shortlink creation under concurrency');
  assert.strictEqual(start1.attemptId, start2.attemptId);
  assert.strictEqual(start1.providerUrl, 'https://link4m.co/short/s1');
  assert.strictEqual(start1.reused, false);
  assert.strictEqual(start2.reused, true);

  const returnParams = new URL(capturedReturnUrls[0]).searchParams;
  const attemptId1 = returnParams.get('attempt');
  const nonce1 = returnParams.get('token');
  assert.strictEqual(attemptId1, start1.attemptId);
  assert.ok(nonce1 && nonce1.length > 10);

  // Fast solve guard (<12s) must reject
  await assert.rejects(
    () => link4mService.verifyAndClaimReward(nonce1, attemptId1),
    /quá nhanh/,
    'Fast claim under MIN_SOLVE_MS must be rejected'
  );

  // Advance attempt creation time in table by 15s to simulate valid solve
  store.tables.linkAttempts.get(attemptId1).createdAt = new Date(Date.now() - 15000);

  // Run concurrent verifyAndClaimReward + getDailyQuotaStatus under userLock
  const [claimA, claimB, quotaConcurrent] = await Promise.all([
    link4mService.verifyAndClaimReward(nonce1, attemptId1),
    link4mService.verifyAndClaimReward(nonce1, attemptId1),
    link4mService.getDailyQuotaStatus('user_active_1')
  ]);
  assert.strictEqual(claimA.ok, true);
  assert.strictEqual(claimB.ok, true);
  assert.strictEqual(quotaConcurrent.ok, true);
  assert.strictEqual([claimA.replayed, claimB.replayed].filter((v) => v === false).length, 1, 'Exactly one concurrent claim must grant the reward');
  assert.strictEqual([claimA.replayed, claimB.replayed].filter((v) => v === true).length, 1, 'Concurrent duplicate claim must replay idempotently');

  const updatedActive = await store.getAccess('user_active_1');
  const actualExpiryMs = Date.parse(updatedActive.expiresAt);
  const expectedExpiryMs = initialActiveExpiryMs + 6 * 3600 * 1000;
  assert.strictEqual(actualExpiryMs, expectedExpiryMs, 'Active user expiry must extend exactly +6h from existing expiresAt');
  assert.deepStrictEqual(updatedActive.workerIds, ['bot-01'], 'Assigned workers must remain intact');

  const quotaAfter = await link4mService.getDailyQuotaStatus('user_active_1');
  assert.strictEqual(quotaAfter.usedToday, 1);
  assert.strictEqual(quotaAfter.remainingToday, 1);
  assert.strictEqual(quotaAfter.eligible, false, 'Cooldown after claim must prevent immediate second claim');
  assert.ok(quotaAfter.cooldownRemainingMs > 0);

  // Expired user flow: startAttempt -> verifyAndClaimReward revives to 'active' and extends from NOW
  const expStart = await link4mService.startAttempt('user_expired_1', '127.0.0.1');
  const expNonce = new URL(capturedReturnUrls[1]).searchParams.get('token');
  store.tables.linkAttempts.get(expStart.attemptId).createdAt = new Date(Date.now() - 15000);

  const beforeClaimMs = Date.now();
  const expClaim = await link4mService.verifyAndClaimReward(expNonce, expStart.attemptId);
  assert.strictEqual(expClaim.ok, true);
  assert.strictEqual(expClaim.replayed, false);
  const revivedUser = await store.getAccess('user_expired_1');
  assert.strictEqual(revivedUser.status, 'active', 'Expired user must reactivate on reward claim');
  assert.ok(Date.parse(revivedUser.expiresAt) >= beforeClaimMs + 6 * 3600 * 1000 - 1000, 'Expired user expiry must extend from now');
  assert.deepStrictEqual(revivedUser.workerIds, ['bot-02']);

  // Webhook flow using forwarded link4mSecretKey & createLinkAttempt alias
  const whStart = await link4mService.createLinkAttempt('user_webhook_1', '127.0.0.1');
  assert.strictEqual(whStart.ok, true);
  store.tables.linkAttempts.get(whStart.attemptId).createdAt = new Date(Date.now() - 15000);
  const badSig = crypto.createHmac('sha256', 'wrong_secret').update(whStart.attemptId).digest('hex');
  await assert.rejects(
    () => link4mService.completeWebhook({
      query: { attempt: whStart.attemptId },
      body: {},
      get: (h) => (h === 'x-link4m-secret' ? 'wrong_secret' : badSig)
    }),
    /Xác thực Webhook Link4M thất bại/
  );
  const validSig = crypto.createHmac('sha256', runtimeConfig.link4mSecretKey).update(whStart.attemptId).digest('hex');
  const whRes = await link4mService.completeWebhook({
    query: { attempt: whStart.attemptId },
    body: {},
    get: (h) => {
      if (h === 'x-link4m-secret') return runtimeConfig.link4mSecretKey;
      if (h === 'x-link4m-signature') return validSig;
      return '';
    }
  });
  assert.strictEqual(whRes.replayed, false);
  assert.strictEqual(whRes.rewardHours, 6);

  console.log('✅ 2. Real AccessControl + AsyncKeyLock + Link4mService Wiring & Concurrency verified.');
}

function testIsWorkerStopConfirmedContract() {
  console.log('3. Testing isWorkerStopConfirmed Edge Cases...');

  const rejectedPayloads = [
    undefined,
    null,
    false,
    'stopped',
    {},
    { ok: true },
    { delivered: true },
    { ok: true, delivered: true },
    { delivered: true, result: { ok: true } },
    { delivered: false },
    { delivered: false, timedOut: true },
    { ok: false },
    { pending: true },
    { pending: true, state: 'stopped' },
    { timedOut: true },
    { timedOut: true, state: 'stopped' },
    { ok: true, queued: true },
    { delivered: true, queued: true },
    { delivered: true, pending: true },
    { delivered: true, timedOut: true },
    { delivered: true, result: { queued: true } },
    { delivered: true, result: { pending: true } },
    { delivered: true, result: { timedOut: true } },
    { delivered: true, result: { ok: false } },
    { delivered: true, result: { ok: false, state: 'online' } },
    { delivered: true, result: { ok: false, state: 'stopped' } },
    { state: 'connecting' },
    { state: 'online' },
    { delivered: true, result: { state: 'online', connected: true } },
    { delivered: true, result: { ok: true, state: 'online', connected: true } },
    { delivered: true, result: { ok: true, state: 'connecting' } },
    { delivered: true, result: { ok: true, state: 'authenticating' } },
    { delivered: true, result: { ok: true, state: 'entering' } },
    { delivered: true, result: { ok: true, state: 'starting' } },
    { delivered: true, result: { ok: true, state: 'maintenance' } },
    { delivered: true, result: { ok: true, state: 'error' } },
    { delivered: true, result: { ok: true, worker: { state: 'online', online: true } } },
    { delivered: true, result: { ok: true, status: { state: 'starting', connected: false } } },
    { delivered: true, result: { ok: true, state: 'stopped', connected: true } },
    { delivered: true, result: { ok: true, state: 'stopped', online: true } },
    { delivered: true, state: 'stopped', result: { state: 'connecting' } }
  ];

  for (const payload of rejectedPayloads) {
    assert.strictEqual(
      isWorkerStopConfirmed(payload),
      false,
      `Expected isWorkerStopConfirmed(${JSON.stringify(payload)}) to be false`
    );
  }

  const confirmedPayloads = [
    { ok: true, stopped: true },
    { state: 'stopped' },
    { state: 'offline' },
    { delivered: true, result: { state: 'stopped', connected: false } },
    { delivered: true, result: { ok: true, state: 'offline', connected: false, online: false } },
    { delivered: true, result: { ok: true, worker: { state: 'stopped', online: false, connected: false } } },
    { delivered: true, result: { ok: true, status: { state: 'offline', online: false } } },
    { ok: true, state: 'stopped', connected: false }
  ];

  for (const payload of confirmedPayloads) {
    assert.strictEqual(
      isWorkerStopConfirmed(payload),
      true,
      `Expected isWorkerStopConfirmed(${JSON.stringify(payload)}) to be true`
    );
  }

  console.log('✅ 3. isWorkerStopConfirmed Contract verified.');
}

async function testGracefulStopConfirmationStateMachine() {
  console.log('4. Testing EntitlementService STOP Confirmation Edge Cases...');
  const logger = createSilentLogger();

  const cases = [
    { name: 'delivered:true without state', response: { delivered: true } },
    { name: 'ok:true delivered:true without state', response: { ok: true, delivered: true } },
    { name: 'pending response', response: { pending: true } },
    { name: 'timedOut response', response: { delivered: false, timedOut: true } },
    { name: 'queued with ok:true', response: { ok: true, queued: true } },
    { name: 'queued with delivered:true', response: { delivered: true, queued: true } },
    { name: 'state connecting bare', response: { state: 'connecting' } },
    { name: 'state online bare', response: { state: 'online' } },
    { name: 'delivered with result.state online & connected (no ok field)', response: { delivered: true, result: { state: 'online', connected: true } } },
    { name: 'delivered but state online & connected', response: { delivered: true, result: { ok: true, state: 'online', connected: true } } },
    { name: 'delivered but result.ok false & state online', response: { delivered: true, result: { ok: false, state: 'online' } } },
    { name: 'delivered but state connecting', response: { delivered: true, result: { ok: true, state: 'connecting' } } }
  ];

  for (const testCase of cases) {
    // Test via fleetOperations.stopWorker
    {
      const store = createInMemoryTableStore();
      await store.setAccess('usr_edge', {
        userId: 'usr_edge',
        username: 'edge',
        status: 'active',
        isPermanent: false,
        expiresAt: new Date(Date.now() - 60000).toISOString(),
        workerIds: ['bot-edge-1']
      });

      const svc = new EntitlementService({
        store,
        registry: { find: async () => ({ workerId: 'bot-edge-1', status: { state: 'online', online: true } }) },
        logger
      });

      const summary = await svc.checkExpiredUsersAndGracefulStop({
        fleetOperations: { stopWorker: async () => testCase.response }
      });

      const saved = await store.getAccess('usr_edge');
      assert.strictEqual(summary.expired, 0, `${testCase.name} (fleetOperations): must not count as expired`);
      assert.strictEqual(saved.status, 'expiring', `${testCase.name} (fleetOperations): status must remain expiring`);
      assert.deepStrictEqual(saved.stopPendingWorkers, ['bot-edge-1'], `${testCase.name} (fleetOperations): worker must stay in stopPendingWorkers`);
    }

    // Test via broker.dispatch fallback
    {
      const store = createInMemoryTableStore();
      await store.setAccess('usr_edge_broker', {
        userId: 'usr_edge_broker',
        username: 'edge_broker',
        status: 'active',
        isPermanent: false,
        expiresAt: new Date(Date.now() - 60000).toISOString(),
        workerIds: ['bot-edge-2']
      });

      const svc = new EntitlementService({
        store,
        registry: { find: async () => ({ workerId: 'bot-edge-2', status: { state: 'online', online: true } }) },
        logger
      });

      const summary = await svc.checkExpiredUsersAndGracefulStop({
        broker: { dispatch: async () => testCase.response }
      });

      const saved = await store.getAccess('usr_edge_broker');
      assert.strictEqual(summary.expired, 0, `${testCase.name} (broker): must not count as expired`);
      assert.strictEqual(saved.status, 'expiring', `${testCase.name} (broker): status must remain expiring`);
      assert.deepStrictEqual(saved.stopPendingWorkers, ['bot-edge-2'], `${testCase.name} (broker): worker must stay in stopPendingWorkers`);
    }
  }

  // Confirmed stopped result transitions to 'expired' and clears stopPendingWorkers
  {
    const store = createInMemoryTableStore();
    await store.setAccess('usr_confirm', {
      userId: 'usr_confirm',
      username: 'confirm_user',
      status: 'expiring',
      isPermanent: false,
      expiresAt: new Date(Date.now() - 60000).toISOString(),
      workerIds: ['bot-confirm-1'],
      stopPendingWorkers: ['bot-confirm-1']
    });

    const svc = new EntitlementService({
      store,
      registry: { find: async () => ({ workerId: 'bot-confirm-1', status: { state: 'online', online: true } }) },
      logger
    });

    const summary = await svc.checkExpiredUsersAndGracefulStop({
      fleetOperations: { stopWorker: async () => ({ delivered: true, result: { state: 'stopped', connected: false } }) }
    });

    const saved = await store.getAccess('usr_confirm');
    assert.strictEqual(summary.expired, 1);
    assert.strictEqual(saved.status, 'expired');
    assert.deepStrictEqual(saved.stopPendingWorkers, []);
  }

  // Cached worker pre-state guard: stale state:'stopped' with online:true OR connected:true MUST NOT skip RPC
  {
    const store = createInMemoryTableStore();
    await store.setAccess('usr_stale_online', {
      userId: 'usr_stale_online',
      username: 'stale_online',
      status: 'active',
      isPermanent: false,
      expiresAt: new Date(Date.now() - 60000).toISOString(),
      workerIds: ['bot-stale-1', 'bot-stale-2']
    });

    const stopCalls = [];
    const svc = new EntitlementService({
      store,
      registry: {
        find: async (id) => (
          id === 'bot-stale-1'
            ? { workerId: 'bot-stale-1', status: { state: 'stopped', online: true } }
            : { workerId: 'bot-stale-2', status: { state: 'offline', connected: true } }
        )
      },
      logger
    });

    await svc.checkExpiredUsersAndGracefulStop({
      fleetOperations: {
        stopWorker: async (id) => {
          stopCalls.push(id);
          return { delivered: true, result: { ok: true, state: 'online', connected: true } };
        }
      }
    });

    assert.deepStrictEqual(stopCalls, ['bot-stale-1', 'bot-stale-2'], 'Stale online/connected workers must not skip STOP RPC');
    const saved = await store.getAccess('usr_stale_online');
    assert.strictEqual(saved.status, 'expiring');
    assert.deepStrictEqual(saved.stopPendingWorkers, ['bot-stale-1', 'bot-stale-2']);
  }

  // Multi-worker partial stop retains only the unconfirmed worker and clears once retried
  {
    const store = createInMemoryTableStore();
    await store.setAccess('usr_partial', {
      userId: 'usr_partial',
      username: 'partial',
      status: 'active',
      isPermanent: false,
      expiresAt: new Date(Date.now() - 60000).toISOString(),
      workerIds: ['bot-p1', 'bot-p2']
    });

    let allowBot2Stop = false;
    const calledIds = [];
    const svc = new EntitlementService({
      store,
      registry: { find: async () => ({ status: { state: 'online', online: true } }) },
      logger
    });

    await svc.checkExpiredUsersAndGracefulStop({
      fleetOperations: {
        stopWorker: async (id) => {
          calledIds.push(id);
          if (id === 'bot-p1') return { delivered: true, result: { state: 'stopped', connected: false } };
          return allowBot2Stop
            ? { delivered: true, result: { state: 'offline', connected: false } }
            : { delivered: false, timedOut: true };
        }
      }
    });

    let saved = await store.getAccess('usr_partial');
    assert.strictEqual(saved.status, 'expiring');
    assert.deepStrictEqual(saved.stopPendingWorkers, ['bot-p2']);

    allowBot2Stop = true;
    calledIds.length = 0;
    await svc.checkExpiredUsersAndGracefulStop({
      fleetOperations: {
        stopWorker: async (id) => {
          calledIds.push(id);
          return { delivered: true, result: { state: 'offline', connected: false } };
        }
      }
    });

    assert.deepStrictEqual(calledIds, ['bot-p2'], 'Retry cycle must only stop remaining unconfirmed workers');
    saved = await store.getAccess('usr_partial');
    assert.strictEqual(saved.status, 'expired');
    assert.deepStrictEqual(saved.stopPendingWorkers, []);
  }

  console.log('✅ 4. EntitlementService STOP Confirmation Edge Cases verified.');
}

async function testRealBrokerFleetEntitlementWiring() {
  console.log('5. Testing Real CommandBroker + FleetOperations + EntitlementService Wiring...');
  const store = createInMemoryTableStore();
  const logger = createSilentLogger();
  const userLock = new AsyncKeyLock();
  const accessControl = new AccessControl({ store });

  await store.setAccess('usr_wisp', {
    userId: 'usr_wisp',
    username: 'wisp_user',
    status: 'active',
    isPermanent: false,
    expiresAt: new Date(Date.now() - 60000).toISOString(),
    workerIds: ['bot-wisp-1']
  });

  const workerState = {
    workerId: 'bot-wisp-1',
    enabled: true,
    provider: 'wispbyte',
    lastHeartbeat: new Date().toISOString(),
    status: { state: 'online', online: true }
  };

  const registry = {
    find: async (id) => (id === 'bot-wisp-1' ? { ...workerState, status: { ...workerState.status } } : null),
    list: async () => [{ ...workerState }],
    updateStatus: async (_id, status) => {
      workerState.status = { ...workerState.status, ...status };
      return workerState;
    },
    resetData: async () => ({ ok: true })
  };

  const commandQueue = [];
  const commandStore = {
    enqueue: async (cmd) => {
      const entry = { ...cmd, status: 'queued' };
      commandQueue.push(entry);
      return entry;
    },
    take: async (workerId) => {
      const next = commandQueue.find((c) => c.workerId === workerId && c.status === 'queued');
      if (!next) return null;
      next.status = 'delivered';
      return { ...next };
    },
    complete: async (_workerId, commandId, result) => {
      const item = commandQueue.find((c) => c.commandId === commandId);
      if (item) {
        item.status = 'completed';
        item.result = result;
      }
      return Boolean(item);
    },
    expire: async (commandId) => {
      const item = commandQueue.find((c) => c.commandId === commandId);
      if (item && item.status !== 'completed') item.status = 'expired';
      return Boolean(item);
    },
    clearWorker: async () => true
  };

  const broker = new CommandBroker({
    registry,
    commandStore,
    config: { commandResultTimeoutMs: 40, workerPollWaitMs: 100 },
    logger
  });
  const fleetOperations = new FleetOperations({ registry, broker, logger });
  const entitlementService = new EntitlementService({
    store,
    registry,
    accessControl,
    userLock,
    logger
  });

  const keepAlive = setInterval(() => {}, 25);
  try {
    // Tick 1: Worker does not report result -> broker times out -> stays 'expiring'
    const tick1 = await entitlementService.checkExpiredUsersAndGracefulStop({ broker, fleetOperations });
    assert.strictEqual(tick1.expired, 0);
    let userAfterTick1 = await store.getAccess('usr_wisp');
    assert.strictEqual(userAfterTick1.status, 'expiring');
    assert.deepStrictEqual(userAfterTick1.stopPendingWorkers, ['bot-wisp-1']);

    // Tick 2: Worker polls command and reports stopped state -> transitions to 'expired'
    const tick2Promise = entitlementService.checkExpiredUsersAndGracefulStop({ broker, fleetOperations });
    await new Promise((r) => setTimeout(r, 10));
    const polledCmd = await broker.poll('bot-wisp-1', { waitMs: 100 });
    assert.ok(polledCmd && polledCmd.action === 'stop', 'Worker must receive queued stop command via broker.poll');
    await broker.reportResult('bot-wisp-1', polledCmd.commandId, {
      ok: true,
      state: 'stopped',
      connected: false,
      online: false
    });

    const tick2 = await tick2Promise;
    assert.strictEqual(tick2.expired, 1);
    const userAfterTick2 = await store.getAccess('usr_wisp');
    assert.strictEqual(userAfterTick2.status, 'expired');
    assert.deepStrictEqual(userAfterTick2.stopPendingWorkers, []);
  } finally {
    clearInterval(keepAlive);
  }

  console.log('✅ 5. Real CommandBroker + FleetOperations + EntitlementService Wiring verified.');
}

async function testCoordinatorCrossCuttingContracts() {
  console.log('6. Testing Cross-Cutting Parity Contracts (Link4M init, Broker poll status, Worker API, Admin/Panel/Renderer)...');
  const http = require('node:http');
  const express = require('express');
  const { createWorkerApi } = require('../src/http/routes/worker-api');
  const adminCommand = require('../src/discord/commands/admin');
  const { resolveLinkedUser, checkBotOwnership, handlePanelInteraction } = require('../src/discord/handlers/panel-handler');
  const { renderBotDetail } = require('../src/discord/panels/renderer');
  const SupabaseDashboardStore = require('../src/storage/supabase-dashboard-store');
  const logger = createSilentLogger();

  // 6a. Link4mService.initialize() populates memory config even on first boot when disabled/custom
  const memStore = createInMemoryTableStore();
  const l4mDisabledFirstBoot = new Link4mService({
    store: memStore,
    accessControl: new AccessControl({ store: memStore, adminRoleId: '11111111111111111', userRoleId: '22222222222222222' }),
    userLock: new AsyncKeyLock(),
    config: {
      publicBaseUrl: 'https://mgr.kingmc.test',
      link4mApiToken: 'tok_x',
      link4mSecretKey: 'sec_x',
      link4mRewardEnabled: false,
      link4mRewardHours: 8,
      link4mDailyLimit: 3
    },
    logger
  });
  await l4mDisabledFirstBoot.initialize();
  const disabledPub = l4mDisabledFirstBoot.publicConfig();
  assert.strictEqual(disabledPub.enabled, false, 'First boot with link4mRewardEnabled=false must stay disabled in memory');
  assert.strictEqual(disabledPub.rewardHours, 8);
  assert.strictEqual(disabledPub.dailyLimit, 3);
  await assert.rejects(() => l4mDisabledFirstBoot.startAttempt('u1', '127.0.0.1'));

  // 6b. CommandBroker.acceptResult forwards action & updates registry for flat worker status without clobbering on errors
  const statusUpdates = [];
  const clearedWorkers = [];
  const resetWorkers = [];
  const brokerRegistry = {
    async updateStatus(id, status, source) {
      statusUpdates.push({ id, status, source });
      return { workerId: id, status };
    },
    async resetData(id) { resetWorkers.push(id); },
    async authenticate() { return true; },
    async find(id) { return { workerId: id, botNumber: 1, enabled: true, provider: 'wispbyte' }; }
  };
  const pollCommandStore = {
    async enqueue(c) { return c; },
    async take() { return null; },
    async complete() { return true; },
    async expire() {},
    async get() { return null; },
    async clearWorker(id) { clearedWorkers.push(id); }
  };
  const pollBroker = new CommandBroker({
    registry: brokerRegistry,
    commandStore: pollCommandStore,
    config: { commandResultTimeoutMs: 5000, workerPollWaitMs: 500 },
    logger
  });
  await pollBroker.acceptResult('bot-01', {
    commandId: '11111111-1111-4111-8111-111111111111',
    action: 'reset',
    result: { ok: true, state: 'offline', online: false, connected: false }
  });
  assert.deepStrictEqual(resetWorkers, ['bot-01'], 'acceptResult must forward payload.action for reset parity');
  assert.deepStrictEqual(clearedWorkers, ['bot-01']);
  assert.strictEqual(statusUpdates.length, 1);
  assert.strictEqual(statusUpdates[0].status.state, 'offline');
  await pollBroker.acceptResult('bot-01', {
    commandId: 'cmd_22222222-2222-4222-8222-222222222222',
    action: 'chat',
    result: { ok: false, error: 'chat_timeout' }
  });
  assert.strictEqual(statusUpdates.length, 1, 'Error-only result must NOT overwrite worker status with unknown');

  // 6c. worker-api routes: /poll passes { waitMs }, /result accepts cmd_ UUID, /report passes telemetry object with botNumber
  const pollWaitArgs = [];
  const recordedPositions = [];
  const routeBroker = {
    async poll(workerId, opts) {
      pollWaitArgs.push({ workerId, opts });
      return null;
    },
    async acceptResult(workerId, body) {
      return Boolean(workerId && body.commandId);
    }
  };
  const workerApiApp = express();
  workerApiApp.use(express.json());
  const workerRouter = createWorkerApi({
    registry: {
      async authenticate() { return true; },
      async find(id) { return { workerId: id, botNumber: 1, enabled: true }; },
      async updateStatus() { return { workerId: 'bot-01', status: {} }; }
    },
    broker: routeBroker,
    workerStore: {
      async recordPositionChange(telemetry) {
        recordedPositions.push(telemetry);
        return { ok: true };
      }
    },
    config: { workerPollWaitMs: 15000, botSecretKey: 'global_sec' },
    logger
  });
  workerApiApp.use('/api/v1/workers/:workerId', workerRouter);
  workerApiApp.use('/api/worker', workerRouter);
  const srv = await new Promise((resolve, reject) => {
    const server = workerApiApp.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
  try {
    const port = srv.address().port;
    const base = `http://127.0.0.1:${port}/api/v1/workers`;
    const pollRes = await fetch(`${base}/bot-01/poll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-worker-secret': 'global_sec' },
      body: JSON.stringify({ waitMs: 321, status: { state: 'online' } })
    });
    assert.strictEqual(pollRes.status, 200);
    assert.deepStrictEqual(pollWaitArgs[0].opts, { waitMs: 321 }, '/poll must pass { waitMs } object to broker.poll');

    const cmdResultRes = await fetch(`${base}/bot-01/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-worker-secret': 'global_sec' },
      body: JSON.stringify({ commandId: 'cmd_33333333-3333-4333-8333-333333333333', result: { ok: true } })
    });
    assert.strictEqual(cmdResultRes.status, 200);
    const cmdResultJson = await cmdResultRes.json();
    assert.strictEqual(cmdResultJson.accepted, true, '/result must accept cmd_<uuid> command IDs');

    const reportRes = await fetch(`http://127.0.0.1:${port}/api/worker/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-worker-secret': 'global_sec' },
      body: JSON.stringify({
        workerId: 'bot-01',
        status: { state: 'online', position: { x: 120.5, y: 64, z: -30.2 }, dimension: 'overworld' }
      })
    });
    assert.strictEqual(reportRes.status, 200);
    assert.strictEqual(recordedPositions.length, 1);
    assert.strictEqual(recordedPositions[0].botId, '1', '/report must pass numeric botNumber to recordPositionChange');
    assert.deepStrictEqual(recordedPositions[0].position, { x: 120.5, y: 64, z: -30.2 });
  } finally {
    srv.closeAllConnections?.();
    await new Promise((resolve) => srv.close(resolve));
  }

  // 6d. /admin setup persists discord_access (matching index.js startup load)
  const savedSettings = new Map();
  const fakeAdminInteraction = {
    user: { id: '99999999999999999' },
    guildId: '88888888888888888',
    guild: { ownerId: '99999999999999999' },
    options: {
      getSubcommand: () => 'setup',
      getRole: (name) => ({ id: name === 'admin_role' ? '33333333333333333' : '44444444444444444' }),
      getUser: () => null
    }
  };
  await adminCommand.execute(fakeAdminInteraction, {
    config: { adminUserId: '99999999999999999', discordGuildId: '88888888888888888' },
    accessStore: {
      async getUserByDiscordId() { return null; },
      async setSetting(k, v) { savedSettings.set(k, v); }
    },
    accessControl: new AccessControl({ store: memStore })
  });
  assert.ok(savedSettings.has('discord_access'), '/admin setup must persist discord_access setting');
  assert.strictEqual(savedSettings.has('discord_roles'), false);

  // 6e. Panel handler ownership casing, adminRole resolution, expired user denial, and timeout notice
  assert.strictEqual(checkBotOwnership({ role: 'user', assignedBotIds: ['BOT-01'] }, 'bot-01'), true);
  const roleCtrl = new AccessControl({ store: memStore, adminRoleId: '55555555555555555', userRoleId: '66666666666666666' });
  const linkedAdmin = await resolveLinkedUser({
    user: { id: '77777777777777777' },
    member: { roles: ['55555555555555555'] },
    guild: { ownerId: '00000000000000000' }
  }, {
    config: {},
    accessStore: { async getUserByDiscordId() { return null; } },
    accessControl: roleCtrl
  });
  assert.strictEqual(linkedAdmin?.role, 'admin', 'resolveLinkedUser must recognize adminRoleId');

  const panelReplies = [];
  const makeButtonInteraction = (userId, customId) => ({
    user: { id: userId },
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    customId,
    deferred: false,
    replied: false,
    async deferUpdate() { this.deferred = true; },
    async editReply(msg) { panelReplies.push(msg); return msg; },
    async update(msg) { panelReplies.push(msg); return msg; },
    async reply(msg) { panelReplies.push(msg); return msg; }
  });
  await handlePanelInteraction(makeButtonInteraction('11122233344455566', 'bot:start:bot-01'), {
    accessStore: {
      async getUserByDiscordId() {
        return { userId: 'u_exp', username: 'expuser', role: 'user', status: 'expired', assignedBotIds: ['bot-01'] };
      }
    },
    accessControl: roleCtrl,
    registry: {
      async find(id) { return { workerId: id, status: { online: false, state: 'offline' } }; },
      getLogs: () => []
    },
    broker: { async dispatch() { throw new Error('must_not_dispatch_for_expired'); } }
  });
  assert.ok(panelReplies[0]?.embeds?.[0]?.data?.title?.includes('HẾT HẠN'), 'Expired Discord user must be blocked before dispatching bot command');

  panelReplies.length = 0;
  await handlePanelInteraction(makeButtonInteraction('11122233344455577', 'bot:stop:bot-01'), {
    accessStore: {
      async getUserByDiscordId() {
        return { userId: 'u_ok', username: 'okuser', role: 'user', status: 'active', isPermanent: true, assignedBotIds: ['bot-01'] };
      }
    },
    accessControl: roleCtrl,
    registry: {
      async find(id) { return { workerId: id, status: { online: true, state: 'online' } }; },
      getLogs: () => []
    },
    broker: { async dispatch() { return { delivered: false, timedOut: true, commandId: 'c1' }; } }
  });
  assert.ok(
    panelReplies[0]?.embeds?.[0]?.data?.description?.includes('⚠️') &&
    !panelReplies[0]?.embeds?.[0]?.data?.description?.includes('✅ Đã thực thi lệnh'),
    'Timed-out poll dispatch must render warning notice, never false success'
  );

  // 6f. Renderer allows STOP during 'error' reconnect state
  const errDetail = renderBotDetail({
    user: { username: 'okuser', role: 'user' },
    worker: { workerId: 'bot-01', botNumber: 1, status: { online: false, state: 'error' } },
    logs: []
  });
  const errStopBtn = errDetail.components[0].components.find((b) => b.data.custom_id === 'bot:stop:bot-01');
  assert.strictEqual(errStopBtn.data.disabled, false, 'STOP button must remain enabled in error state');

  // 6g. SupabaseDashboardStore resolves linked 'admin' without a row in manager_users
  const adminDashStore = new SupabaseDashboardStore({
    from: (tbl) => {
      const chain = {
        _expr: '',
        select() { return chain; },
        or(expr) { chain._expr = String(expr || ''); return chain; },
        eq(col, val) { if (!chain._expr) chain._expr = `${col}=${val}`; return chain; },
        async maybeSingle() {
          if (tbl === 'manager_discord_links' && chain._expr.includes('admin_discord_1')) {
            return { data: { discord_user_id: 'admin_discord_1', manager_user_id: 'usr_admin', username: 'admin', status: 'active' }, error: null };
          }
          if (tbl === 'manager_settings' && chain._expr.includes('discord_link:admin_discord_2')) {
            return { data: { value: { username: 'admin' }, updated_at: new Date().toISOString() }, error: null };
          }
          return { data: null, error: null };
        }
      };
      return chain;
    }
  });
  const resolvedAdmin = await adminDashStore.getUserByDiscordId('admin_discord_1');
  assert.strictEqual(resolvedAdmin?.role, 'admin');
  assert.strictEqual(resolvedAdmin?.username, 'admin');
  const resolvedAdminSetting = await adminDashStore.getUserByDiscordId('admin_discord_2');
  assert.strictEqual(resolvedAdminSetting?.role, 'admin');
  assert.strictEqual(resolvedAdminSetting?.username, 'admin');

  console.log('✅ 6. Cross-Cutting Parity Contracts verified.');
}

async function testLink4mInitFailureDegradedVisibility() {
  console.log('7. Testing Link4mService Init Failure Degraded State & Health/Ready Surfacing...');
  const errors = [];
  const store = createInMemoryTableStore();
  await store.setAccess('usr_l4m_deg', {
    userId: 'usr_l4m_deg',
    username: 'l4muser',
    role: 'user',
    status: 'active',
    isPermanent: false
  });
  store.getSetting = async () => {
    throw new Error('supabase_settings_read_failed');
  };

  const accessControl = new AccessControl({ store });
  const link4mService = new Link4mService({
    store,
    accessControl,
    config: {
      enabled: true,
      apiToken: 'tok_test',
      publicBaseUrl: 'https://manager.example.com'
    },
    logger: {
      info: () => {},
      warn: () => {},
      error: (msg, meta) => errors.push({ msg, meta }),
      debug: () => {}
    }
  });

  await assert.rejects(() => link4mService.initialize(), /supabase_settings_read_failed/);
  assert.strictEqual(errors[0]?.msg, 'link4m_initialize_error');

  const degradedHealth = link4mService.health();
  assert.strictEqual(degradedHealth.ok, false);
  assert.strictEqual(degradedHealth.status, 'degraded');
  assert.strictEqual(degradedHealth.degraded, true);
  assert.strictEqual(degradedHealth.initialized, false);
  assert.ok(degradedHealth.error.includes('supabase_settings_read_failed'));

  const cfg = link4mService.publicConfig();
  assert.strictEqual(cfg.degraded, true);
  assert.strictEqual(cfg.initialized, false);
  assert.strictEqual(cfg.enabled, false);

  const st = await link4mService.status('usr_l4m_deg');
  assert.strictEqual(st.eligible, false);
  assert.strictEqual(st.degraded, true);

  await assert.rejects(() => link4mService.startAttempt('usr_l4m_deg', '127.0.0.1'), /lỗi khởi tạo|khởi tạo/i);

  const indexSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
  assert.ok(indexSource.includes('link4m_initialization_failed'), 'src/index.js must log explicit error on Link4M init failure');

  const app = createApp({
    store,
    link4mService,
    registry: { store: {} },
    config: { discordToken: '' }
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const port = server.address().port;
    const healthRes = await fetch(`http://127.0.0.1:${port}/health`);
    const healthJson = await healthRes.json();
    assert.strictEqual(healthRes.status, 200);
    assert.strictEqual(healthJson.status, 'degraded');
    assert.strictEqual(healthJson.degraded, true);
    assert.strictEqual(healthJson.checks.link4m.ok, false);
    assert.ok(healthJson.warnings.some((w) => w.includes('supabase_settings_read_failed')));

    const readyRes = await fetch(`http://127.0.0.1:${port}/ready`);
    const readyJson = await readyRes.json();
    assert.strictEqual(readyRes.status, 200);
    assert.strictEqual(readyJson.status, 'degraded');
    assert.strictEqual(readyJson.degraded, true);
    assert.strictEqual(readyJson.checks.link4m.ok, false);
    assert.ok(readyJson.warnings.some((w) => w.includes('supabase_settings_read_failed')));

    await link4mService.configure({ enabled: true, rewardHours: 12, dailyLimit: 2 });
    const recoveredHealth = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    const recoveredReady = await (await fetch(`http://127.0.0.1:${port}/ready`)).json();
    assert.strictEqual(recoveredHealth.status, 'healthy');
    assert.strictEqual(recoveredHealth.degraded, false);
    assert.strictEqual(recoveredReady.status, 'ready');
    assert.deepStrictEqual(recoveredReady.warnings, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('✅ 7. Link4M Degraded Initialization Visibility verified.');
}

async function testCommandResetErrorVisibility() {
  console.log('8. Testing CommandBroker Reset Partial State-Sync Error Propagation...');

  // 8a. Polling transport + worker-api /result + pending.finish + user-api /bot/:id/reset
  const pollErrors = [];
  let completeCalledOnSyncFail = false;
  const brokerPoll = new CommandBroker({
    registry: {
      resetData: async () => { throw new Error('db_reset_write_failed'); },
      updateStatus: async () => {}
    },
    commandStore: {
      complete: async () => {
        completeCalledOnSyncFail = true;
        return { commandId: 'cmd_reset_fail', action: 'reset' };
      },
      clearWorker: async () => { throw new Error('queue_clear_failed'); }
    },
    config: { commandResultTimeoutMs: 5000 },
    logger: {
      info: () => {},
      warn: () => {},
      error: (msg, meta) => pollErrors.push({ msg, meta })
    }
  });

  let pendingOutcome = null;
  brokerPoll.pendingResults.set('cmd_11111111-1111-4111-8111-111111111111', {
    workerId: 'bot-reset-1',
    action: 'reset',
    command: { action: 'reset' },
    finish: (payload) => { pendingOutcome = payload; }
  });

  const workerApp = express();
  workerApp.use(express.json());
  workerApp.use('/api/v1/workers/:workerId', createWorkerApi({
    registry: {
      authenticate: async (workerId) => ({ workerId, secret: 'sec' }),
      touchHeartbeat: async () => ({})
    },
    broker: brokerPoll,
    config: { botSecret: 'sec' }
  }));

  const workerServer = http.createServer(workerApp);
  await new Promise((resolve) => workerServer.listen(0, resolve));
  try {
    const port = workerServer.address().port;
    const resultRes = await fetch(`http://127.0.0.1:${port}/api/v1/workers/bot-reset-1/result`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-worker-id': 'bot-reset-1',
        'x-worker-secret': 'sec'
      },
      body: JSON.stringify({
        commandId: 'cmd_11111111-1111-4111-8111-111111111111',
        action: 'reset',
        result: { ok: true, state: 'stopped' }
      })
    });
    const resultBody = await resultRes.json();
    assert.strictEqual(resultRes.status, 500, '/result must return HTTP 500 when reset state sync fails');
    assert.strictEqual(resultBody.ok, false);
    assert.strictEqual(resultBody.error, 'RESET_STATE_SYNC_FAILED');
    assert.strictEqual(resultBody.stateSyncPending, true);
    assert.strictEqual(resultBody.executionCompleted, true);
    assert.strictEqual(resultBody.partialResetFailures.length, 2);
    assert.strictEqual(completeCalledOnSyncFail, false, 'complete() must NOT run when reset state sync fails');
    assert.strictEqual(pendingOutcome?.ok, false, 'pending waiter must receive ok:false when reset sync fails');
    assert.strictEqual(pendingOutcome?.error, 'RESET_STATE_SYNC_FAILED');
    assert.ok(pollErrors.some((e) => e.msg === 'command_reset_partial_sync_failed'));
  } finally {
    await new Promise((resolve) => workerServer.close(resolve));
  }

  // 8b. user-api POST /bot/:id/reset surfaces failed dispatch result as HTTP 500
  const userApp = express();
  userApp.use(express.json());
  userApp.use((req, _res, next) => {
    req.managerAuthSession = { username: 'tester', userId: 'usr_t', role: 'admin', status: 'active' };
    next();
  });
  userApp.use('/api', createUserApi({
    store: { addAudit: async () => true },
    registry: {
      find: async () => ({ workerId: 'bot-reset-1', botNumber: 1, status: { state: 'online' } })
    },
    broker: {
      dispatch: async () => ({
        delivered: true,
        result: { ok: false, error: 'RESET_STATE_SYNC_FAILED', detail: 'db_reset_write_failed' }
      })
    },
    logger: createSilentLogger()
  }));

  const userServer = http.createServer(userApp);
  await new Promise((resolve) => userServer.listen(0, resolve));
  try {
    const port = userServer.address().port;
    const actionRes = await fetch(`http://127.0.0.1:${port}/api/bot/bot-reset-1/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    const actionBody = await actionRes.json();
    assert.strictEqual(actionRes.status, 500, '/api/bot/:id/reset must return HTTP 500 when reset state sync fails');
    assert.strictEqual(actionBody.ok, false);
    assert.strictEqual(actionBody.code, 'RESET_STATE_SYNC_FAILED');
  } finally {
    await new Promise((resolve) => userServer.close(resolve));
  }

  // 8c. dispatchRender HTTP transport throws RESET_STATE_SYNC_FAILED if registry sync fails
  const renderErrors = [];
  const brokerRender = new CommandBroker({
    registry: {
      credential: () => 'sec',
      resetData: async () => { throw new Error('render_reset_sync_boom'); },
      updateStatus: async () => {}
    },
    commandStore: {
      clearWorker: async () => true
    },
    config: { botSecret: 'sec', commandResultTimeoutMs: 5000 },
    logger: {
      info: () => {},
      warn: () => {},
      error: (msg, meta) => renderErrors.push({ msg, meta })
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, result: { ok: true, state: 'stopped' } })
    })
  });

  await assert.rejects(
    () => brokerRender.dispatchRender(
      { workerId: 'bot-render-1', provider: 'render', serviceUrl: 'https://worker.example.com', secret: 'sec' },
      { commandId: 'cmd_r1', action: 'reset', payload: {} }
    ),
    (err) => err && err.code === 'RESET_STATE_SYNC_FAILED' && Array.isArray(err.partialResetFailures) && err.partialResetFailures.length === 1
  );
  assert.ok(renderErrors.some((e) => e.msg === 'command_reset_partial_sync_failed'));

  console.log('✅ 8. CommandBroker Reset Error Visibility verified.');
}

async function testResetTwoPhaseExecutionAndIndependentRetry() {
  console.log('9. Testing Two-Phase Polling RESET (execution_completed -> state_sync_pending -> independent retry)...');

  const commands = new Map([
    ['cmd_22222222-2222-4222-8222-222222222222', {
      commandId: 'cmd_22222222-2222-4222-8222-222222222222',
      workerId: 'bot-two-phase',
      action: 'reset',
      status: 'delivered',
      result: null,
      completedAt: null
    }],
    ['cmd_queued_other', {
      commandId: 'cmd_queued_other',
      workerId: 'bot-two-phase',
      action: 'status',
      status: 'queued',
      result: null,
      completedAt: null
    }]
  ]);

  const callOrder = [];
  let shouldFailResetData = true;
  let resetDataCalls = 0;
  let clearWorkerCalls = 0;
  let updateStatusCalls = 0;
  const infoLogs = [];
  const errorLogs = [];

  const twoPhaseStore = {
    async get(cid) {
      const row = commands.get(cid);
      return row ? { ...row, result: row.result ? { ...row.result } : null } : null;
    },
    async complete() {
      throw new Error('complete() must not be called directly for reset command');
    },
    async clearWorker(wid, { excludeCommandIds = [] } = {}) {
      callOrder.push('clearWorker');
      clearWorkerCalls += 1;
      for (const [id, row] of commands.entries()) {
        if (row.workerId !== wid) continue;
        if (excludeCommandIds.includes(id)) continue;
        if (['execution_completed', 'state_sync_pending', 'state_sync_failed'].includes(row.status)) continue;
        commands.delete(id);
      }
    },
    async recordExecutionCompleted(wid, cid, result, opts = {}) {
      callOrder.push('recordExecutionCompleted');
      const row = commands.get(cid);
      if (!row || row.workerId !== wid) return { ok: false, reason: 'not_found' };
      if (row.status === 'completed') return { ok: true, alreadyCompleted: true, status: 'completed', command: row };
      row.status = 'execution_completed';
      row.completedAt = null;
      row.result = {
        ...(result || {}),
        _stateSync: {
          ...(row.result?._stateSync || {}),
          pending: true,
          executionCompleted: true,
          candidateStatus: opts.candidateStatus || null,
          statusSource: opts.statusSource || 'manager-command-poll',
          pendingSteps: opts.pendingSteps || null,
          leaseOwner: opts.leaseOwner || null,
          leaseUntil: opts.leaseOwner ? new Date(Date.now() + 15000).toISOString() : null
        }
      };
      return { ok: true, alreadyCompleted: false, status: 'execution_completed', command: { ...row } };
    },
    async markStateSyncPending(wid, cid, { result, syncState, terminalFailed = false } = {}) {
      callOrder.push(terminalFailed ? 'markStateSyncFailed' : 'markStateSyncPending');
      const row = commands.get(cid);
      if (!row || row.workerId !== wid) return false;
      row.status = terminalFailed ? 'state_sync_failed' : 'state_sync_pending';
      row.completedAt = null;
      const base = (result && typeof result === 'object') ? { ...result } : { ...(row.result || {}) };
      delete base._stateSync;
      row.result = { ...base, _stateSync: { ...syncState } };
      return true;
    },
    async finalizeCompleted(wid, cid, result, { leaseOwner = null } = {}) {
      callOrder.push('finalizeCompleted');
      const row = commands.get(cid);
      if (!row || row.workerId !== wid) return false;
      if (row.status === 'completed') return true;
      const currentOwner = row.result?._stateSync?.leaseOwner;
      if (leaseOwner && currentOwner && currentOwner !== leaseOwner) return false;
      row.status = 'completed';
      row.completedAt = new Date().toISOString();
      const base = (result && typeof result === 'object') ? { ...result } : { ...(row.result || {}) };
      delete base._stateSync;
      row.result = base;
      return true;
    },
    async claimPendingStateSyncBatch(leaseOwner, limit = 10, leaseSeconds = 60) {
      const now = Date.now();
      const claimed = [];
      for (const row of commands.values()) {
        if (claimed.length >= limit) break;
        if (!['state_sync_pending', 'execution_completed'].includes(row.status)) continue;
        const sync = row.result?._stateSync || {};
        if (sync.nextRetryAt && Date.parse(sync.nextRetryAt) > now) continue;
        if (sync.leaseUntil && Date.parse(sync.leaseUntil) > now) continue;
        row.status = 'state_sync_pending';
        row.result = {
          ...(row.result || {}),
          _stateSync: {
            ...sync,
            leaseOwner,
            leaseUntil: new Date(now + leaseSeconds * 1000).toISOString()
          }
        };
        claimed.push({ ...row, result: { ...row.result, _stateSync: { ...row.result._stateSync } } });
      }
      return claimed;
    }
  };

  const broker = new CommandBroker({
    registry: {
      async resetData() {
        callOrder.push('resetData');
        resetDataCalls += 1;
        if (shouldFailResetData) throw new Error('transient_supabase_timeout');
        return { ok: true };
      },
      async updateStatus() {
        callOrder.push('updateStatus');
        updateStatusCalls += 1;
        return { ok: true };
      }
    },
    commandStore: twoPhaseStore,
    config: { commandResultTimeoutMs: 5000, maxStateSyncAttempts: 3 },
    logger: {
      info: (msg, meta) => infoLogs.push({ msg, meta }),
      warn: () => {},
      error: (msg, meta) => errorLogs.push({ msg, meta })
    }
  });

  // Step 1: Worker posts /result (note: omitting action forces storedCommand.get() lookup BEFORE transition)
  const firstOutcome = await broker.reportResult('bot-two-phase', 'cmd_22222222-2222-4222-8222-222222222222', {
    ok: true,
    state: 'stopped',
    connected: false
  });
  assert.strictEqual(firstOutcome.ok, false);
  assert.strictEqual(firstOutcome.error, 'RESET_STATE_SYNC_FAILED');
  assert.strictEqual(firstOutcome.executionCompleted, true);
  assert.strictEqual(firstOutcome.stateSyncPending, true);

  // Verify execution_completed ran BEFORE sync, and row transitioned to state_sync_pending (NOT completed)
  assert.deepStrictEqual(callOrder, [
    'recordExecutionCompleted',
    'resetData',
    'clearWorker',
    'updateStatus',
    'markStateSyncPending'
  ]);
  const pendingRow = commands.get('cmd_22222222-2222-4222-8222-222222222222');
  assert.strictEqual(pendingRow.status, 'state_sync_pending');
  assert.strictEqual(pendingRow.completedAt, null);
  assert.deepStrictEqual(pendingRow.result._stateSync.pendingSteps, ['registry.resetData']);
  assert.strictEqual(commands.has('cmd_queued_other'), false, 'Other queued command was still cleared by clearWorker');
  assert.strictEqual(clearWorkerCalls, 1);
  assert.strictEqual(updateStatusCalls, 1);

  // Before nextRetryAt arrives, poller skips without duplicating work
  const earlyTick = await broker.processPendingStateSyncs();
  assert.strictEqual(earlyTick.processed, 0);

  // Step 2: DB recovers; make retry due and invoke processOutboxBatch (Worker NEVER sends /result again)
  shouldFailResetData = false;
  pendingRow.result._stateSync.nextRetryAt = new Date(Date.now() - 1000).toISOString();
  await broker.processOutboxBatch();

  const recoveredRow = commands.get('cmd_22222222-2222-4222-8222-222222222222');
  assert.strictEqual(recoveredRow.status, 'completed', 'Independent background retry must finalize command as completed');
  assert.ok(recoveredRow.completedAt, 'completedAt must be set once state sync finishes');
  assert.strictEqual(recoveredRow.result._stateSync, undefined, 'Internal _stateSync metadata must be stripped on completion');
  assert.strictEqual(resetDataCalls, 2, 'Only failed step resetData was retried once');
  assert.strictEqual(clearWorkerCalls, 1, 'Already-succeeded clearWorker was NOT redundantly re-run');
  assert.strictEqual(updateStatusCalls, 1, 'Already-succeeded updateStatus was NOT redundantly re-run');
  assert.ok(infoLogs.some((l) => l.msg === 'command_reset_state_sync_recovered'));

  // Step 3: Duplicate /result replay after terminal completion is idempotent without re-running resetData
  const replay = await broker.reportResult('bot-two-phase', 'cmd_22222222-2222-4222-8222-222222222222', {
    ok: true,
    state: 'stopped'
  });
  assert.strictEqual(replay.ok, true);
  assert.strictEqual(replay.alreadyCompleted, true);
  assert.strictEqual(resetDataCalls, 2);

  // Step 4: Exhaustion transitions state_sync_pending -> state_sync_failed after maxStateSyncAttempts
  const cidExhaust = 'cmd_33333333-3333-4333-8333-333333333333';
  commands.set(cidExhaust, {
    commandId: cidExhaust,
    workerId: 'bot-two-phase',
    action: 'reset',
    status: 'delivered',
    result: null,
    completedAt: null
  });
  shouldFailResetData = true;
  await broker.reportResult('bot-two-phase', cidExhaust, { ok: true, state: 'stopped' });
  commands.get(cidExhaust).result._stateSync.nextRetryAt = new Date(Date.now() - 1000).toISOString();
  await broker.processPendingStateSyncs();
  commands.get(cidExhaust).result._stateSync.nextRetryAt = new Date(Date.now() - 1000).toISOString();
  const thirdAttempt = await broker.processPendingStateSyncs();
  assert.strictEqual(thirdAttempt.failed, 1);
  assert.strictEqual(commands.get(cidExhaust).status, 'state_sync_failed');
  assert.ok(errorLogs.some((l) => l.msg === 'command_reset_state_sync_exhausted'));

  const noopAfterExhaust = await broker.processPendingStateSyncs();
  assert.strictEqual(noopAfterExhaust.processed, 0);

  console.log('✅ 9. Two-Phase Polling RESET & Independent Retry verified.');
}

let completedAll = false;
process.on('beforeExit', (code) => {
  if (code === 0 && !completedAll) {
    console.error('❌ SERVICES WIRING TEST EXITED EARLY BEFORE COMPLETION');
    process.exit(1);
  }
});

async function runTests() {
  console.log('--- [MANAGER SERVICES WIRING & RELIABILITY TESTS] ---');
  await testIndexJsLink4mWiring();
  await testRealLink4mAccessControlAndLockWiring();
  testIsWorkerStopConfirmedContract();
  await testGracefulStopConfirmationStateMachine();
  await testRealBrokerFleetEntitlementWiring();
  await testCoordinatorCrossCuttingContracts();
  await testLink4mInitFailureDegradedVisibility();
  await testCommandResetErrorVisibility();
  await testResetTwoPhaseExecutionAndIndependentRetry();
  completedAll = true;
  console.log('🎉 ALL MANAGER SERVICES WIRING TESTS PASSED 100%!');
}

runTests().catch((err) => {
  console.error('❌ SERVICES WIRING TEST FAILED:', err);
  process.exit(1);
});
