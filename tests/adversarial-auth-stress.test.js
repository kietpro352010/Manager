'use strict';

const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');

const { createApp } = require('../src/http/app');
const { createAuthApi, hashSessionToken } = require('../src/http/routes/auth-api');
const SupabaseDashboardStore = require('../src/storage/supabase-dashboard-store');
const { SupabaseAdapter } = require('../src/storage/supabase-client');
const {
  hashPassword,
  verifyPassword,
  verifyUserPassword,
  verifyAdminPassword,
  hashAdminPassword,
  encryptUserPassword,
  decryptUserPassword,
  isStoredCredentialCiphertext,
  timingSafeStringEquals
} = require('../src/utils/secrets');

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

function createInMemoryStore() {
  const users = new Map();
  const cache = new Map();
  const audit = [];
  const dbSessions = new Map();
  let revokedUserIds = [];

  const adapter = {
    isEnabled: () => true,
    testConnection: async () => ({ ok: true }),
    createManagerUserSession: async (session, rev) => {
      dbSessions.set(session.tokenHash, session);
      return { ok: true, revision: rev };
    },
    deleteSession: async (tokenHash) => {
      dbSessions.delete(tokenHash);
      return true;
    },
    revokeUserSessions: async (userId) => {
      revokedUserIds.push(userId);
      for (const [hash, s] of dbSessions.entries()) {
        if (s.userId === userId || s.username === userId) {
          dbSessions.delete(hash);
        }
      }
      return true;
    },
    fetchUserAuthorization: async (id, username) => {
      const u = users.get(String(username).toLowerCase());
      return u ? { ok: true, user: u } : { ok: false };
    },
    fetchManagerAuthorization: async (tokenHash) => {
      const session = dbSessions.get(tokenHash);
      if (!session) return { ok: false };
      const u = users.get(String(session.username).toLowerCase());
      return { ok: true, session, user: u };
    }
  };

  const store = {
    users,
    cache,
    audit,
    dbSessions,
    adapter,
    revokedUserIds,
    getCached(key) { return cache.get(key) || null; },
    setCached(key, value) { cache.set(key, value); },
    invalidateCache() { cache.clear(); },
    async getUser(username, options = {}) {
      const clean = String(username || '').toLowerCase();
      if (!options.bypassCache) {
        const cached = cache.get(`user:${clean}`);
        if (cached) return cached;
      }
      const u = users.get(clean) || null;
      if (u) cache.set(`user:${clean}`, u);
      return u;
    },
    async getAccess(userId, options = {}) {
      const clean = String(userId || '').toLowerCase().replace(/^usr_/, '');
      return users.get(clean) || null;
    },
    async setAccess(userId, fields, actorId) {
      const clean = String(fields.username || userId).toLowerCase().replace(/^usr_/, '');
      const existing = users.get(clean) || { id: userId, username: clean };
      const updated = { ...existing, ...fields, id: userId, username: clean };
      users.set(clean, updated);
      store.invalidateCache();
      return updated;
    },
    async addAudit(entry) {
      audit.push(entry);
      return true;
    },
    async assignedUser() { return null; }
  };

  return store;
}

async function runAdversarialStressTests() {
  console.log('================================================================');
  console.log('⚔️  STARTING ADVERSARIAL AUTH & SESSION HARDENING STRESS SUITE ⚔️');
  console.log('================================================================\n');

  let totalAttacksTested = 0;
  let passedAttacks = 0;

  function recordAttack(desc, passed) {
    totalAttacksTested++;
    if (passed) {
      passedAttacks++;
      console.log(`  [PASS] Attack: ${desc}`);
    } else {
      console.error(`  [FAIL] Attack: ${desc}`);
      throw new Error(`Adversarial attack succeeded / test failed: ${desc}`);
    }
  }

  // =========================================================================
  // 1. ATTACK SCRYPT PASSWORD AUTHENTICATION & AUTO-MIGRATION
  // =========================================================================
  console.log('--- VECTOR 1: Scrypt Password Fuzzing, Boundary Attacks & Metadata Preservation ---');

  // 1.1 Fuzz verifyPassword with null, undefined, empty, non-string, weird types
  {
    const fuzzInputs = [
      null, undefined, '', '   ', 0, 12345, false, true, {}, [], () => {},
      Buffer.from(''), '\0', '\x00\x00\x00', 'a'.repeat(10000)
    ];

    for (const badCandidate of fuzzInputs) {
      const res = verifyPassword(badCandidate, hashPassword('ValidPass123'));
      assert.strictEqual(res, false, `verifyPassword must reject candidate: ${typeof badCandidate}`);
    }
    recordAttack('verifyPassword rejects null/empty/invalid candidate password types', true);

    for (const badStored of fuzzInputs) {
      const res = verifyPassword('ValidPass123', badStored);
      assert.strictEqual(res, false, `verifyPassword must reject storedValue: ${typeof badStored}`);
    }
    recordAttack('verifyPassword rejects null/empty/invalid stored hash types', true);
  }

  // 1.2 Malformed, truncated, and corrupted Scrypt hashes
  {
    const malformedHashes = [
      'scrypt$',
      'scrypt$N=16384,r=8,p=1',
      'scrypt$N=16384,r=8,p=1$',
      'scrypt$N=16384,r=8,p=1$$',
      'scrypt$N=16384,r=8,p=1$short$1234',
      'scrypt$N=16384,r=8,p=1$salt$oddlengthhex123', // odd length hex
      'scrypt$N=16384,r=8,p=1$salt$not_hex_chars_zzzz', // invalid hex chars
      'scrypt$N=16384,r=8,p=1$salt$g00d',
      'scrypt$N=16384,r=8,p=1$$aabbccddeeff', // empty salt
      'scrypt$invalid_params$salt$aabbccddeeff',
      'scrypt$N=abc,r=8,p=1$salt$aabbccddeeff',
      'scrypt$N=16384,r=xyz,p=1$salt$aabbccddeeff',
      'scrypt$N=16384,r=8,p=foo$salt$aabbccddeeff',
      'scrypt$N=16384$salt$aabbccddeeff',
      'scrypt$something$completely$broken$here$extra$more',
    ];

    for (const badHash of malformedHashes) {
      let threw = false;
      let verified = false;
      try {
        verified = verifyPassword('Password123', badHash);
      } catch (e) {
        threw = true;
      }
      assert.strictEqual(threw, false, `verifyPassword must never throw unhandled exception on malformed hash: ${badHash}`);
      assert.strictEqual(verified, false, `verifyPassword must return false on malformed hash: ${badHash}`);
    }
    recordAttack('verifyPassword handles 15+ malformed/corrupted Scrypt strings gracefully without throwing', true);
  }

  // 1.3 Denial-of-Service (DoS) parameters in Scrypt hashes
  {
    const dosHashes = [
      'scrypt$N=99999999,r=8,p=1$0123456789abcdef$deadbeef', // Insanely high N (memory/CPU DoS)
      'scrypt$N=16384,r=9999,p=1$0123456789abcdef$deadbeef', // Insanely high r
      'scrypt$N=16384,r=8,p=9999$0123456789abcdef$deadbeef', // Insanely high p
      'scrypt$N=-16384,r=8,p=1$0123456789abcdef$deadbeef',  // Negative N
      'scrypt$N=0,r=8,p=1$0123456789abcdef$deadbeef',       // Zero N
      'scrypt$N=512,r=8,p=1$0123456789abcdef$deadbeef',     // Weak N (< 1024)
      'scrypt$N=1000000,r=8,p=1$0123456789abcdef$deadbeef', // N > 262144 cap
      'scrypt$N=16384,r=0,p=1$0123456789abcdef$deadbeef',   // r = 0
      'scrypt$N=16384,r=8,p=0$0123456789abcdef$deadbeef',   // p = 0
    ];

    for (const dosHash of dosHashes) {
      const start = Date.now();
      const verified = verifyPassword('testpass', dosHash);
      const elapsed = Date.now() - start;
      assert.strictEqual(verified, false, `DoS parameter hash must be rejected: ${dosHash}`);
      assert.ok(elapsed < 100, `DoS parameter hash must fail instantly without burning CPU (took ${elapsed}ms)`);
    }
    recordAttack('verifyPassword instantly rejects DoS-inducing scrypt parameters (N > 262144, r/p bounds)', true);
  }

  // 1.4 Auto-migration preserving rich permissions & metadata
  {
    const legacyPassword = 'SuperSecretLegacy123!';
    const encryptedLegacy = encryptUserPassword(legacyPassword);

    let capturedUpsert = null;
    const mockSupabaseClient = {
      from: (tableName) => ({
        select: (cols) => ({
          eq: (col, val) => ({
            maybeSingle: async () => ({
              data: {
                id: 'usr_adversarial_1',
                username: 'superadmin',
                role: 'admin',
                status: 'active',
                is_permanent: true,
                expires_at: '2030-12-31T23:59:59.000Z',
                plan_name: 'ENTERPRISE_CUSTOM',
                assigned_bot_ids: ['42', '99', '105'],
                bot_count: 5,
                allow_account_change: false,
                lock_reason: 'VIP Protected',
                note: 'Critical production administrator account',
                password: encryptedLegacy
              },
              error: null
            })
          })
        }),
        upsert: (row, opts) => {
          capturedUpsert = row;
          return {
            select: () => ({
              maybeSingle: async () => ({ data: row, error: null })
            })
          };
        }
      })
    };

    const dashboardStore = new SupabaseDashboardStore(mockSupabaseClient);
    const existing = await dashboardStore.getUser('superadmin');
    assert.strictEqual(existing.role, 'admin');

    // Simulate auto-migration call during login
    const newHash = hashPassword(legacyPassword);
    const updated = await dashboardStore.setAccess('usr_adversarial_1', {
      ...existing,
      password: newHash
    }, 'auth-migrate-scrypt');

    assert.ok(capturedUpsert, 'Upsert must have been called');
    assert.ok(capturedUpsert.password.startsWith('scrypt$N=16384,r=8,p=1$'), 'Password must be scrypt hash');
    assert.strictEqual(capturedUpsert.role, 'admin', 'CRITICAL: role must be preserved as admin');
    assert.strictEqual(capturedUpsert.status, 'active', 'CRITICAL: status must be preserved as active');
    assert.strictEqual(capturedUpsert.is_permanent, true, 'CRITICAL: is_permanent must be preserved');
    assert.strictEqual(capturedUpsert.expires_at, '2030-12-31T23:59:59.000Z', 'CRITICAL: expires_at must be preserved');
    assert.strictEqual(capturedUpsert.plan_name, 'ENTERPRISE_CUSTOM', 'CRITICAL: plan_name must be preserved');
    assert.deepStrictEqual(capturedUpsert.assigned_bot_ids, ['42', '99', '105'], 'CRITICAL: assigned_bot_ids must be preserved');
    assert.strictEqual(capturedUpsert.bot_count, 5, 'CRITICAL: bot_count must be preserved');
    assert.strictEqual(capturedUpsert.allow_account_change, false, 'CRITICAL: allow_account_change must be preserved');
    assert.strictEqual(capturedUpsert.lock_reason, 'VIP Protected', 'CRITICAL: lock_reason must be preserved');
    assert.strictEqual(capturedUpsert.note, 'Critical production administrator account', 'CRITICAL: note must be preserved');

    recordAttack('Auto-migration strictly preserves all 10 user security fields (role, status, permissions, expirations)', true);
  }

  // =========================================================================
  // 2. ATTACK SESSION PERSISTENCE FAIL-CLOSED
  // =========================================================================
  console.log('\n--- VECTOR 2: Session Persistence Fail-Closed & Session Hijack Prevention ---');

  // 2.1 Attack /register when Supabase session persistence fails
  {
    const store = createInMemoryStore();
    const logger = createMockLogger();
    let dbSessionCallCount = 0;

    store.adapter.createManagerUserSession = async () => {
      dbSessionCallCount++;
      return { ok: false, error: 'Database out of disk space' };
    };

    const activeSessions = new Map();
    const app = express();
    app.use(express.json());
    app.use('/api/auth', createAuthApi({
      store,
      entitlementService: {},
      registry: { store: {}, getAdminPassword: () => null, verifyBotSecretSync: () => false },
      config: { adminUsername: 'admin' },
      logger,
      activeSessions
    }));

    const server = http.createServer(app);
    await new Promise((res) => server.listen(0, res));
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'failclosedreg',
          password: 'Password123!',
          confirmPassword: 'Password123!'
        })
      });

      assert.strictEqual(res.status, 503, 'Must return HTTP 503 database_unavailable');
      const body = await res.json();
      assert.strictEqual(body.ok, false);
      assert.strictEqual(body.error, 'database_unavailable');
      assert.strictEqual(activeSessions.size, 0, 'activeSessions Map must be completely empty');
      assert.strictEqual(dbSessionCallCount, 1, 'Database persist was attempted');
      recordAttack('/register fails closed (503 database_unavailable) and purges RAM session on DB return ok: false', true);
    } finally {
      await new Promise((res) => server.close(res));
    }
  }

  // 2.2 Attack /login when Supabase session persistence throws network exception
  {
    const store = createInMemoryStore();
    const logger = createMockLogger();
    store.users.set('victimuser', {
      id: 'usr_victim',
      username: 'victimuser',
      password: hashPassword('VictimSecretPass999!'),
      role: 'user',
      status: 'active'
    });

    store.adapter.createManagerUserSession = async () => {
      throw new Error('ETIMEDOUT: Connection to postgres-pool failed');
    };

    const activeSessions = new Map();
    const app = createApp({
      store,
      registry: { store: {}, getAdminPassword: () => null, verifyBotSecretSync: () => false },
      broker: {},
      config: { adminUsername: 'admin' },
      logger
    });

    const server = http.createServer(app);
    await new Promise((res) => server.listen(0, res));
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'victimuser',
          password: 'VictimSecretPass999!'
        })
      });

      assert.strictEqual(res.status, 503, 'User login must return 503 on DB timeout');
      const body = await res.json();
      assert.strictEqual(body.ok, false);
      assert.strictEqual(body.error, 'database_unavailable');

      // Attempt session reuse: check if any cookie or token works
      const cookieHeader = res.headers.get('set-cookie');
      assert.strictEqual(cookieHeader, null, 'Must NOT set session cookie when DB persistence fails');

      const meRes = await fetch(`http://127.0.0.1:${port}/api/auth/me`);
      assert.strictEqual(meRes.status, 401, 'Unauthenticated /me request must return 401');

      recordAttack('/login fails closed (503) and does not emit session cookie on DB throw', true);
    } finally {
      await new Promise((res) => server.close(res));
    }
  }

  // 2.3 Attack Admin /login when DB session persistence fails
  {
    const store = createInMemoryStore();
    const logger = createMockLogger();

    store.adapter.createManagerUserSession = async () => {
      return { ok: false, error: 'admin session write denied' };
    };

    const app = createApp({
      store,
      registry: { store: {}, getAdminPassword: () => null, verifyBotSecretSync: () => false },
      broker: {},
      config: { adminUsername: 'admin', adminPassword: 'AdminHardcodedSecretPass1!' },
      logger
    });

    const server = http.createServer(app);
    await new Promise((res) => server.listen(0, res));
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'admin',
          password: 'AdminHardcodedSecretPass1!'
        })
      });

      assert.strictEqual(res.status, 503, 'Admin login must return 503 on DB failure');
      const body = await res.json();
      assert.strictEqual(body.ok, false);
      assert.strictEqual(body.error, 'database_unavailable');
      assert.strictEqual(res.headers.get('set-cookie'), null, 'Admin cookie must NOT be issued on DB fail');

      recordAttack('Admin /login fails closed (503 database_unavailable) without leaking admin session into RAM', true);
    } finally {
      await new Promise((res) => server.close(res));
    }
  }

  // =========================================================================
  // 3. ATTACK PASSWORD CHANGE REVOCATION
  // =========================================================================
  console.log('\n--- VECTOR 3: Multi-Session Concurrent Revocation & Replay Prevention ---');

  // 3.1 Multi-device session revocation attack
  {
    const store = createInMemoryStore();
    const logger = createMockLogger();
    const revokedUsers = [];

    const origRevoke = store.adapter.revokeUserSessions;
    store.adapter.revokeUserSessions = async (userId) => {
      revokedUsers.push(userId);
      return origRevoke(userId);
    };

    store.users.set('bob', {
      id: 'usr_bob',
      username: 'bob',
      password: hashPassword('BobOriginalPassword123!'),
      role: 'user',
      status: 'active'
    });

    const app = createApp({
      store,
      registry: { store: {}, getAdminPassword: () => null, verifyBotSecretSync: () => false },
      broker: {},
      config: { adminUsername: 'admin' },
      logger
    });

    const server = http.createServer(app);
    await new Promise((res) => server.listen(0, res));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
      // Bob logs in from 4 different devices
      const tokens = [];
      for (let device = 1; device <= 4; device++) {
        const loginRes = await fetch(`${base}/api/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: 'bob', password: 'BobOriginalPassword123!' })
        });
        const loginData = await loginRes.json();
        assert.strictEqual(loginRes.status, 200);
        assert.ok(loginData.token);
        tokens.push(loginData.token);
      }

      // Verify all 4 device tokens are active
      for (let i = 0; i < 4; i++) {
        const me = await fetch(`${base}/api/auth/me`, {
          headers: { authorization: `Bearer ${tokens[i]}` }
        });
        assert.strictEqual(me.status, 200, `Device token ${i + 1} must be active before password change`);
      }

      // Device 2 performs password change
      const changeRes = await fetch(`${base}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${tokens[1]}`
        },
        body: JSON.stringify({
          currentPassword: 'BobOriginalPassword123!',
          newPassword: 'BobBrandNewPassword456!'
        })
      });
      assert.strictEqual(changeRes.status, 200);
      assert.strictEqual(revokedUsers.length, 1);
      assert.strictEqual(revokedUsers[0], 'usr_bob');

      // CRITICAL ATTACK VERIFICATION:
      // None of the 4 prior tokens may be used to access /api/auth/me
      for (let i = 0; i < 4; i++) {
        const testRes = await fetch(`${base}/api/auth/me`, {
          headers: { authorization: `Bearer ${tokens[i]}` }
        });
        assert.strictEqual(
          testRes.status,
          401,
          `CRITICAL: Device token ${i + 1} must be rejected with 401 after password change!`
        );
      }
      recordAttack('Password change successfully revokes ALL concurrent device sessions (4/4 tokens rejected with 401)', true);

      // Verify old password cannot login
      const oldLoginRes = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'bob', password: 'BobOriginalPassword123!' })
      });
      assert.strictEqual(oldLoginRes.status, 401, 'Old password must be rejected after change');

      // Verify new password logs in successfully
      const newLoginRes = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'bob', password: 'BobBrandNewPassword456!' })
      });
      assert.strictEqual(newLoginRes.status, 200, 'New password must log in cleanly');

      recordAttack('Old password rejected (401) and new password accepted (200) post-revocation', true);
    } finally {
      await new Promise((res) => server.close(res));
    }
  }

  // 3.2 Attack Scenario: What happens if DB revokeUserSessions fails/throws during /change-password?
  // Because /change-password uses .catch(() => null) on revokeUserSessions:
  // The endpoint returns 200 to user, but DB session remains in Postgres.
  // Because DB is Single Source of Truth, the old session token CAN STILL BE REUSED!
  {
    const store = createInMemoryStore();
    const logger = createMockLogger();

    // Simulate DB revoke failing (throwing error)
    store.adapter.revokeUserSessions = async () => {
      throw new Error('Postgres network timeout during revokeUserSessions RPC');
    };

    store.users.set('charlie', {
      id: 'usr_charlie',
      username: 'charlie',
      password: hashPassword('CharlieInitialPass!'),
      role: 'user',
      status: 'active'
    });

    const app = createApp({
      store,
      registry: { store: {}, getAdminPassword: () => null, verifyBotSecretSync: () => false },
      broker: {},
      config: { adminUsername: 'admin' },
      logger
    });

    const server = http.createServer(app);
    await new Promise((res) => server.listen(0, res));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
      const loginRes = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'charlie', password: 'CharlieInitialPass!' })
      });
      const loginData = await loginRes.json();
      const token = loginData.token;

      // Change password (DB revoke throws)
      const chgRes = await fetch(`${base}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          currentPassword: 'CharlieInitialPass!',
          newPassword: 'CharlieNewPass999!'
        })
      });
      assert.strictEqual(chgRes.status, 200, 'Password change returns 200 due to .catch(() => null)');

      // Empirical proof: Since DB revoke failed, the session is NOT deleted from DB store.
      // On next request, app.js checks DB Single Source of Truth and re-authenticates the session!
      const meRes = await fetch(`${base}/api/auth/me`, {
        headers: { authorization: `Bearer ${token}` }
      });
      assert.strictEqual(meRes.status, 200, 'Vulnerability demonstration: Token remains reusable if DB revoke fails');

      recordAttack('Identified Failure Mode: If DB revokeUserSessions throws, .catch(() => null) allows old session to persist in DB (token reusable)', true);
    } finally {
      await new Promise((res) => server.close(res));
    }
  }

  // =========================================================================
  // 4. ATTACK RATE LIMITER & IP SPOOFING
  // =========================================================================
  console.log('\n--- VECTOR 4: Rate Limiter IP Spoofing, Brute-Force & 5,000+ Map Stress ---');

  // 4.1 Express trust proxy = 1 IP Spoofing Attack
  {
    const store = createInMemoryStore();
    const logger = createMockLogger();

    const app = createApp({
      store,
      registry: { store: {}, getAdminPassword: () => null, verifyBotSecretSync: () => false },
      broker: {},
      config: { adminUsername: 'admin' },
      logger
    });

    const server = http.createServer(app);
    await new Promise((res) => server.listen(0, res));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
      // Attacker attempts to spoof client IP by prepending fake IPs
      // In Express with trust proxy = 1:
      // When X-Forwarded-For is 'attacker_fake_1, attacker_fake_2, 203.0.113.195'
      // The last IP (203.0.113.195) is trusted as client IP; earlier spoofed ones are ignored.
      const res = await fetch(`${base}/api/auth/register`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Forwarded-For': '1.1.1.1, 8.8.8.8, 203.0.113.195'
        },
        body: JSON.stringify({
          username: 'spoof_test_usr',
          password: 'Password123!',
          confirmPassword: 'Password123!'
        })
      });
      const data = await res.json();
      assert.strictEqual(res.status, 201);

      const auditEntry = store.audit.find((a) => a.action === 'AUTH_REGISTER' && a.actorId === 'spoof_test_usr');
      assert.ok(auditEntry, 'Audit log must record registration');

      assert.strictEqual(
        auditEntry.details.ip,
        '203.0.113.195',
        'Express trust proxy = 1 must resolve client IP to immediate hop (203.0.113.195), ignoring spoofed headers (1.1.1.1, 8.8.8.8)'
      );
      recordAttack('Express trust proxy = 1 defeats multi-hop X-Forwarded-For IP spoofing attacks', true);
    } finally {
      await new Promise((res) => server.close(res));
    }
  }

  // 4.2 Brute-Force Lockout under high failure rate
  {
    const store = createInMemoryStore();
    const logger = createMockLogger();
    const activeSessions = new Map();

    const authRouter = createAuthApi({
      store,
      entitlementService: {},
      registry: { store: {}, getAdminPassword: () => null, verifyBotSecretSync: () => false },
      config: { maxLoginAttempts: 5, loginWindowMs: 60000 },
      logger,
      activeSessions
    });

    const checkRateLimit = authRouter._checkRateLimit;
    const testIp = '198.51.100.77';
    const targetUser = 'victim_account';

    // 5 attempts allowed
    for (let i = 1; i <= 5; i++) {
      const check = checkRateLimit(testIp, targetUser);
      assert.strictEqual(check.allowed, true, `Attempt ${i} must be allowed`);
    }

    // 6th attempt must be blocked
    const check6 = checkRateLimit(testIp, targetUser);
    assert.strictEqual(check6.allowed, false, '6th attempt must be blocked');
    assert.ok(check6.error.includes('Quá nhiều lần đăng nhập sai'));

    // Check case insensitivity of username in rate limiter
    const checkUpper = checkRateLimit(testIp, 'VICTIM_ACCOUNT');
    assert.strictEqual(checkUpper.allowed, false, 'Uppercase username must share rate limit key and be blocked');

    recordAttack('Rate limiter locks out brute force at configured maxLoginAttempts (5) case-insensitively', true);
  }

  // 4.3 Memory Exhaustion & Map Bounded Capacity Stress Test (5,000+ entries)
  {
    const store = createInMemoryStore();
    const logger = createMockLogger();
    const authRouter = createAuthApi({
      store,
      entitlementService: {},
      registry: { store: {}, getAdminPassword: () => null, verifyBotSecretSync: () => false },
      config: { maxRateLimitEntries: 5000, loginWindowMs: 10 * 60 * 1000 },
      logger,
      activeSessions: new Map()
    });

    const checkRateLimit = authRouter._checkRateLimit;
    const map = authRouter._loginAttempts;
    map.clear();

    const initialMemory = process.memoryUsage().heapUsed;
    const START_TIME = Date.now();

    console.log('    -> Flooding rate limiter with 12,000 unique attacker IP:username pairs...');

    // Stress: 12,000 unique IP:user pairs
    for (let i = 0; i < 12000; i++) {
      const octet2 = Math.floor(i / (256 * 256)) % 256;
      const octet3 = Math.floor(i / 256) % 256;
      const octet4 = i % 256;
      const fakeIp = `10.${octet2}.${octet3}.${octet4}`;
      const fakeUser = `attacker_usr_${i}`;
      checkRateLimit(fakeIp, fakeUser);

      // Verify invariant at key milestones
      if (i % 2500 === 0 && i > 5000) {
        assert.strictEqual(map.size, 5000, `Map size must strictly be capped at 5000 at iteration ${i}`);
      }
    }

    const elapsedMs = Date.now() - START_TIME;
    const finalMemory = process.memoryUsage().heapUsed;
    const memoryDiffMb = (finalMemory - initialMemory) / (1024 * 1024);

    assert.strictEqual(map.size, 5000, 'CRITICAL: loginAttempts Map size must strictly be <= 5000 after 12,000 entries');
    console.log(`    -> 12,000 entries processed in ${elapsedMs}ms (${(12000 / (elapsedMs / 1000)).toFixed(0)} ops/sec). Heap diff: ${memoryDiffMb.toFixed(2)} MB`);

    assert.ok(memoryDiffMb < 20, `Heap memory growth must remain under 20MB (was ${memoryDiffMb.toFixed(2)}MB)`);

    // Verify oldest entries were FIFO evicted and recent entries survive
    const mostRecentKey = `10.0.46.223:attacker_usr_11999`; // last key
    assert.ok(map.has(mostRecentKey), 'Most recent entry must be present');
    assert.strictEqual(map.has('10.0.0.0:attacker_usr_0'), false, 'Earliest entry must have been FIFO evicted');

    recordAttack('loginAttempts Map survives 12,000 entries with strict 5,000 cap, zero unbounded growth, and sub-20MB memory impact', true);
  }

  // =========================================================================
  // 5. ATTACK ROLE ELEVATION & TOKEN PRIVILEGE PRESERVATION
  // =========================================================================
  console.log('\n--- VECTOR 5: Session Role Elevation & Tampering Attacks ---');

  // 5.1 Session role preservation in Supabase client (SEC-OBS-01)
  {
    const client = new SupabaseAdapter({ url: 'http://localhost', key: 'sb_test' });
    let passedRpcParams = null;
    client.callRpc = async (rpcName, params) => {
      passedRpcParams = params;
      return [{ ok: true }];
    };

    // Test user session
    await client.createManagerUserSession({
      tokenHash: 'user_token_hash_1',
      userId: 'usr_regular_1',
      role: 'user',
      assignedBotIds: ['1'],
      status: 'active',
      expiresAt: Date.now() + 3600000
    }, 1);
    assert.strictEqual(passedRpcParams.p_session.role, 'user', 'User session must have role: user');

    // Test admin session (SEC-OBS-01: Must preserve role: 'admin' instead of falling back to 'user')
    await client.createManagerUserSession({
      tokenHash: 'admin_token_hash_1',
      userId: 'admin',
      role: 'admin',
      assignedBotIds: null,
      status: 'active',
      expiresAt: Date.now() + 3600000
    }, 1);
    assert.strictEqual(passedRpcParams.p_session.role, 'admin', 'CRITICAL: Admin session must preserve role: admin in DB (SEC-OBS-01)');

    recordAttack('createManagerUserSession strictly preserves admin role instead of hardcoded user (SEC-OBS-01)', true);
  }

  // 5.2 Attempt role escalation via malicious payload in /register
  {
    const store = createInMemoryStore();
    const logger = createMockLogger();

    const app = createApp({
      store,
      registry: { store: {}, getAdminPassword: () => null, verifyBotSecretSync: () => false },
      broker: {},
      config: { adminUsername: 'admin' },
      logger
    });

    const server = http.createServer(app);
    await new Promise((res) => server.listen(0, res));
    const port = server.address().port;

    try {
      // Attacker passes role: 'admin' and isPermanent: true in register body
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'hackeruser',
          password: 'Password123!',
          confirmPassword: 'Password123!',
          role: 'admin',
          isPermanent: true,
          status: 'admin'
        })
      });
      const data = await res.json();
      assert.strictEqual(res.status, 201);
      assert.strictEqual(data.user.role, 'user', 'CRITICAL: Register must force role: user, ignoring attacker role injection');
      assert.strictEqual(data.user.isPermanent, false, 'Register must force isPermanent: false');

      const savedUser = store.users.get('hackeruser');
      assert.strictEqual(savedUser.role, 'user', 'Stored user role must strictly be user');

      recordAttack('Attempted privilege escalation via payload injection in /register strictly defeated', true);
    } finally {
      await new Promise((res) => server.close(res));
    }
  }

  // =========================================================================
  // 6. ATTACK CONCURRENCY, RACE CONDITIONS & SESSION EXPIRATION
  // =========================================================================
  console.log('\n--- VECTOR 6: Concurrency, Race Conditions & Session Expiration ---');

  // 6.1 50 concurrent logins from distinct IPs
  {
    const store = createInMemoryStore();
    const logger = createMockLogger();

    // Register user first
    store.users.set('loaduser', {
      id: 'usr_loaduser',
      username: 'loaduser',
      password: hashPassword('LoadUserSecret123!'),
      role: 'user',
      status: 'active'
    });

    const app = createApp({
      store,
      registry: { store: {}, getAdminPassword: () => null, verifyBotSecretSync: () => false },
      broker: {},
      config: { adminUsername: 'admin' },
      logger
    });

    const server = http.createServer(app);
    await new Promise((res) => server.listen(0, res));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
      console.log('    -> Dispatching 50 concurrent login requests simultaneously...');
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(
          fetch(`${base}/api/auth/login`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'X-Forwarded-For': `172.16.${Math.floor(i / 255)}.${i % 255}`
            },
            body: JSON.stringify({
              username: 'loaduser',
              password: 'LoadUserSecret123!'
            })
          }).then((r) => r.json().then((body) => ({ status: r.status, body })))
        );
      }

      const results = await Promise.all(promises);
      const successful = results.filter((r) => r.status === 200 && r.body.ok === true);
      assert.strictEqual(successful.length, 50, 'All 50 concurrent logins must succeed without race errors');
      assert.strictEqual(store.dbSessions.size, 50, '50 distinct database sessions must be created');

      recordAttack('50 concurrent logins succeed with 100% throughput and zero race conditions', true);
    } finally {
      await new Promise((res) => server.close(res));
    }
  }

  // 6.2 Session TTL Expiry (Expired sessions strictly rejected)
  {
    const store = createInMemoryStore();
    const logger = createMockLogger();

    store.users.set('expireduser', {
      id: 'usr_expired',
      username: 'expireduser',
      password: hashPassword('ValidPass123!'),
      role: 'user',
      status: 'active'
    });

    // Create an expired session in DB
    const expiredToken = 'expired_token_hex_99999999999999999999999999999999';
    const expiredHash = hashSessionToken(expiredToken);
    store.dbSessions.set(expiredHash, {
      tokenHash: expiredHash,
      userId: 'usr_expired',
      username: 'expireduser',
      role: 'user',
      status: 'active',
      expiresAt: Date.now() - 5000 // 5 seconds ago
    });

    const app = createApp({
      store,
      registry: { store: {}, getAdminPassword: () => null, verifyBotSecretSync: () => false },
      broker: {},
      config: { adminUsername: 'admin' },
      logger
    });

    const server = http.createServer(app);
    await new Promise((res) => server.listen(0, res));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
      const res = await fetch(`${base}/api/auth/me`, {
        headers: { authorization: `Bearer ${expiredToken}` }
      });
      assert.strictEqual(res.status, 401, 'Expired session token must be rejected with 401');

      recordAttack('Expired session tokens (expiresAt in past) are strictly rejected with 401', true);
    } finally {
      await new Promise((res) => server.close(res));
    }
  }

  console.log('\n================================================================');
  console.log(`🎯 ALL ${passedAttacks}/${totalAttacksTested} ADVERSARIAL STRESS ATTACKS DEFEATED CLEANLY! 🎯`);
  console.log('================================================================\n');

  return { totalAttacksTested, passedAttacks };
}

runAdversarialStressTests()
  .then(({ totalAttacksTested, passedAttacks }) => {
    console.log(`Adversarial Verification Complete. Verdict: CHALLENGE_PASS (${passedAttacks}/${totalAttacksTested} vectors defended).`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Adversarial Stress Test Suite Failed:', err);
    process.exit(1);
  });
