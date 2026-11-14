'use strict';

const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const { createApp } = require('../src/http/app');
const { createAuthApi, hashSessionToken } = require('../src/http/routes/auth-api');
const { createUserApi } = require('../src/http/routes/user-api');
const SupabaseDashboardStore = require('../src/storage/supabase-dashboard-store');
const { SupabaseAdapter } = require('../src/storage/supabase-client');
const {
  hashPassword,
  verifyPassword,
  verifyUserPassword,
  encryptUserPassword,
  decryptUserPassword,
  isStoredCredentialCiphertext
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
  const getUserCalls = [];
  let getUserCallCount = 0;
  let lastGetUserOptions = null;

  const adapter = {
    isEnabled: () => true,
    testConnection: async () => ({ ok: true }),
    createManagerUserSession: async (session, rev) => ({ ok: true, revision: rev }),
    deleteSession: async (tokenHash) => true,
    revokeUserSessions: async (userId) => true,
    fetchUserAuthorization: async (id, username) => {
      const u = users.get(String(username).toLowerCase());
      return u ? { ok: true, user: u } : { ok: false };
    }
  };

  const store = {
    users,
    cache,
    adapter,
    getUserCalls: () => getUserCalls,
    getUserCallCount: () => getUserCallCount,
    getLastGetUserOptions: () => lastGetUserOptions,
    getCached(key) {
      return cache.get(key) || null;
    },
    setCached(key, value) {
      cache.set(key, value);
    },
    invalidateCache() {
      cache.clear();
    },
    async getUser(username, options = {}) {
      getUserCallCount++;
      lastGetUserOptions = options;
      const clean = String(username || '').toLowerCase();
      getUserCalls.push({ username: clean, options });
      if (!options.bypassCache) {
        const cached = cache.get(`user:${clean}`);
        if (cached) return cached;
      }
      const u = users.get(clean) || null;
      if (u) {
        cache.set(`user:${clean}`, u);
      }
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
    async registerTrialUser({ userId, username, password, trialDays, planName }) {
      const clean = String(username).toLowerCase();
      if (users.has(clean)) {
        throw new Error('Tên đăng nhập đã có người sử dụng.');
      }
      const user = {
        id: userId,
        userId,
        username: clean,
        password,
        role: 'user',
        status: 'active',
        isPermanent: false,
        isTrial: true,
        expiresAt: new Date(Date.now() + trialDays * 86400000).toISOString(),
        planName,
        assignedBotIds: [1],
        workerIds: [1]
      };
      users.set(clean, user);
      store.invalidateCache();
      return { ok: true, userId, username: clean, workerId: 1, planName };
    },
    audit: [],
    async addAudit(entry) {
      store.audit.push(entry);
      return true;
    },
    async assignedUser() {
      return null;
    }
  };

  return store;
}

async function runTests() {
  console.log('--- [AUTH & SESSION HARDENING REGRESSION TESTS (AUTH-01..08)] ---');

  // =========================================================================
  // AUTH-01: Scrypt Password Hashing, Auto-Migration, and Storage Preservation
  // =========================================================================
  console.log('1. Testing AUTH-01: Scrypt Hashing, Auto-Migration, and Store Preservation...');
  {
    const store = createInMemoryStore();
    const logger = createMockLogger();
    const app = createApp({
      store,
      registry: { store: {}, getAdminPassword: () => null, verifyBotSecretSync: () => false },
      broker: {},
      entitlementService: { redeem: async () => true },
      config: { adminUsername: 'admin', adminPassword: 'admin-password', discordToken: '' },
      logger
    });
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
      // 1.1 Register user -> verify password stored is Scrypt hash, NOT AES-256-GCM
      const regRes = await fetch(`${base}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'scryptuser',
          password: 'Password123!',
          confirmPassword: 'Password123!'
        })
      });
      const regJson = await regRes.json();
      assert.strictEqual(regRes.status, 201, 'Register should succeed with 201');
      assert.strictEqual(regJson.ok, true);

      const storedUser = store.users.get('scryptuser');
      assert.ok(storedUser, 'User must exist in store');
      assert.ok(
        String(storedUser.password).startsWith('scrypt$N=16384,r=8,p=1$'),
        `Registered password must be Scrypt hash, got: ${storedUser.password}`
      );
      assert.strictEqual(
        isStoredCredentialCiphertext(storedUser.password),
        false,
        'Registered password must not be AES ciphertext'
      );
      assert.ok(
        verifyPassword('Password123!', storedUser.password),
        'verifyPassword must verify Scrypt hash'
      );

      // 1.2 Legacy AES password user -> login -> auto-migrated to Scrypt
      const legacyAesPass = encryptUserPassword('LegacyPass456!');
      assert.ok(isStoredCredentialCiphertext(legacyAesPass), 'Pre-condition: legacy password is AES ciphertext');
      store.users.set('legacyuser', {
        id: 'usr_legacyuser',
        username: 'legacyuser',
        password: legacyAesPass,
        role: 'user',
        status: 'active',
        isPermanent: true,
        assignedBotIds: [2]
      });

      const logRes = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'legacyuser',
          password: 'LegacyPass456!'
        })
      });
      const logJson = await logRes.json();
      assert.strictEqual(logRes.status, 200, 'Legacy user login should succeed');
      assert.strictEqual(logJson.ok, true);

      const migratedUser = store.users.get('legacyuser');
      assert.ok(
        String(migratedUser.password).startsWith('scrypt$N=16384,r=8,p=1$'),
        `Legacy password must be auto-migrated to Scrypt, got: ${migratedUser.password}`
      );
      assert.strictEqual(
        isStoredCredentialCiphertext(migratedUser.password),
        false,
        'Migrated password must not be AES ciphertext'
      );
      assert.ok(
        verifyPassword('LegacyPass456!', migratedUser.password),
        'Migrated password must verify against plain text'
      );

      // 1.3 /change-password with regular user -> stores Scrypt hash
      const changeRes = await fetch(`${base}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${logJson.token}`
        },
        body: JSON.stringify({
          currentPassword: 'LegacyPass456!',
          newPassword: 'BrandNewPass789!'
        })
      });
      const changeJson = await changeRes.json();
      assert.strictEqual(changeRes.status, 200);
      assert.strictEqual(changeJson.ok, true);

      const changedUser = store.users.get('legacyuser');
      assert.ok(
        String(changedUser.password).startsWith('scrypt$N=16384,r=8,p=1$'),
        'Changed password must be Scrypt hash'
      );
      assert.ok(
        verifyPassword('BrandNewPass789!', changedUser.password),
        'Changed password must verify new plain text'
      );

      // 1.4 SupabaseClient.userToDatabaseRows preserves scrypt$ without re-encrypting
      const client = new SupabaseAdapter({ url: 'http://localhost', key: 'sb_secret_test' });
      const testScryptHash = hashPassword('MySecretPassword');
      const rows = client.userToDatabaseRows([
        {
          id: 'usr_scrypt_test',
          username: 'scrypt_test',
          password: testScryptHash,
          role: 'user'
        }
      ]);
      assert.strictEqual(rows[0].password, testScryptHash, 'userToDatabaseRows must preserve scrypt$ hash as-is');

      // 1.5 SupabaseDashboardStore setAccess preserves scrypt$
      let upsertedRow = null;
      const fakeDashboardStore = new SupabaseDashboardStore({
        from: (table) => ({
          upsert: (row) => {
            upsertedRow = row;
            return {
              select: () => ({
                maybeSingle: async () => ({ data: row, error: null })
              })
            };
          }
        })
      });
      await fakeDashboardStore.setAccess('usr_test', { password: testScryptHash, username: 'testuser' });
      assert.strictEqual(
        upsertedRow.password,
        testScryptHash,
        'setAccess must preserve scrypt$ without re-encrypting with AES'
      );

      // 1.6 Verify bot passwords remain AES-256-GCM reversible
      const botPlainPass = 'MinecraftSecret123';
      const botEncPass = encryptUserPassword(botPlainPass);
      assert.ok(isStoredCredentialCiphertext(botEncPass));
      assert.strictEqual(decryptUserPassword(botEncPass), botPlainPass);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
  console.log('✅ AUTH-01: Scrypt hashing, auto-migration & store preservation verified.');

  // =========================================================================
  // AUTH-02: Fail-Closed DB Session Persistence in /register and /login
  // =========================================================================
  console.log('2. Testing AUTH-02: Fail-Closed DB Session Persistence...');
  {
    const store = createInMemoryStore();
    const logger = createMockLogger();
    let shouldFailDbSession = false;
    let shouldThrowDbSession = false;

    store.adapter.createManagerUserSession = async (session, rev) => {
      if (shouldThrowDbSession) {
        throw new Error('Supabase database network timeout');
      }
      if (shouldFailDbSession) {
        return { ok: false, error: 'Database session constraint violation' };
      }
      return { ok: true, revision: rev };
    };

    const activeSessions = new Map();
    const authRouter = createAuthApi({
      store,
      entitlementService: { redeem: async () => true },
      registry: { store: {}, getAdminPassword: () => null, verifyBotSecretSync: () => false },
      config: { adminUsername: 'admin', adminPassword: 'admin-password', sessionTtlDays: 7 },
      logger,
      activeSessions
    });

    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRouter);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
      // 2.1 Register fail-closed when DB returns { ok: false }
      shouldFailDbSession = true;
      const regRes1 = await fetch(`${base}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'user_fail_1',
          password: 'Password123!',
          confirmPassword: 'Password123!'
        })
      });
      assert.strictEqual(regRes1.status, 503, 'Expected 503 when DB session persistence returns ok: false');
      const regJson1 = await regRes1.json();
      assert.strictEqual(regJson1.ok, false);
      assert.strictEqual(activeSessions.size, 0, 'Session must be evicted from activeSessions on failure');

      // 2.2 Register fail-closed when DB throws error
      shouldFailDbSession = false;
      shouldThrowDbSession = true;
      const regRes2 = await fetch(`${base}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'user_fail_2',
          password: 'Password123!',
          confirmPassword: 'Password123!'
        })
      });
      assert.strictEqual(regRes2.status, 503, 'Expected 503 when DB session persistence throws error');
      const regJson2 = await regRes2.json();
      assert.strictEqual(regJson2.ok, false);
      assert.strictEqual(activeSessions.size, 0, 'Session must not remain in activeSessions on throw');

      // 2.3 User Login fail-closed when DB returns { ok: false }
      store.users.set('logintestuser', {
        id: 'usr_logintest',
        username: 'logintestuser',
        password: hashPassword('ValidPass123!'),
        role: 'user',
        status: 'active'
      });

      shouldThrowDbSession = false;
      shouldFailDbSession = true;
      const loginRes1 = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'logintestuser',
          password: 'ValidPass123!'
        })
      });
      assert.strictEqual(loginRes1.status, 503, 'Login must fail with 503 when DB session fails');
      const loginJson1 = await loginRes1.json();
      assert.strictEqual(loginJson1.ok, false);
      assert.strictEqual(activeSessions.size, 0, 'activeSessions must be empty after failed login');

      // 2.4 User Login fail-closed when DB throws error
      shouldFailDbSession = false;
      shouldThrowDbSession = true;
      const loginRes2 = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'logintestuser',
          password: 'ValidPass123!'
        })
      });
      assert.strictEqual(loginRes2.status, 503, 'Login must fail with 503 when DB session throws');
      assert.strictEqual(activeSessions.size, 0);

      // 2.5 Success case: DB session persistence succeeds -> returns 200/201 and session kept in RAM
      shouldThrowDbSession = false;
      shouldFailDbSession = false;
      const loginRes3 = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'logintestuser',
          password: 'ValidPass123!'
        })
      });
      assert.strictEqual(loginRes3.status, 200);
      assert.strictEqual(activeSessions.size, 1, 'activeSessions must contain 1 session on success');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
  console.log('✅ AUTH-02: Fail-closed DB session persistence verified.');

  // =========================================================================
  // AUTH-03: /change-password Session Revocation & Cookie Clearing
  // =========================================================================
  console.log('3. Testing AUTH-03: /change-password Session Revocation...');
  {
    const store = createInMemoryStore();
    const logger = createMockLogger();
    let revokedUserId = null;

    store.adapter.revokeUserSessions = async (userId) => {
      revokedUserId = userId;
      return true;
    };

    const activeSessions = new Map();
    let adminPassHash = null;
    const registry = {
      store: {},
      getAdminPassword: () => adminPassHash,
      setAdminPassword: (p) => { adminPassHash = p; },
      save: async () => true,
      verifyBotSecretSync: () => false
    };

    const app = createApp({
      store,
      registry,
      broker: {},
      config: { adminUsername: 'admin', adminPassword: 'admin-password-initial' },
      logger
    });
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
      // 3.1 Regular user session revocation
      store.users.set('alice', {
        id: 'usr_alice',
        username: 'alice',
        password: hashPassword('AliceInitialPass123'),
        role: 'user',
        status: 'active'
      });

      const loginRes = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'AliceInitialPass123' })
      });
      const loginJson = await loginRes.json();
      assert.strictEqual(loginJson.ok, true);
      const aliceToken = loginJson.token;

      // Verify session is active
      const meBefore = await fetch(`${base}/api/auth/me`, {
        headers: { authorization: `Bearer ${aliceToken}` }
      });
      assert.strictEqual(meBefore.status, 200);

      // Call /change-password
      const chgRes = await fetch(`${base}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${aliceToken}`
        },
        body: JSON.stringify({
          currentPassword: 'AliceInitialPass123',
          newPassword: 'AliceNewPassword456'
        })
      });
      const chgJson = await chgRes.json();
      assert.strictEqual(chgRes.status, 200);
      assert.strictEqual(chgJson.ok, true);
      assert.ok(chgJson.message.includes('đăng nhập lại'), 'Response must prompt re-login');
      assert.strictEqual(revokedUserId, 'usr_alice', 'store.adapter.revokeUserSessions must be called with userId');

      // Cookie must be cleared (Max-Age=0)
      const setCookie = chgRes.headers.get('set-cookie');
      assert.ok(setCookie && setCookie.includes('Max-Age=0'), 'Set-Cookie must clear session with Max-Age=0');

      // Old session token must now be rejected with 401
      const meAfter = await fetch(`${base}/api/auth/me`, {
        headers: { authorization: `Bearer ${aliceToken}` }
      });
      assert.strictEqual(meAfter.status, 401, 'Old session token must be revoked and rejected with 401');

      // 3.2 Admin session revocation
      const adminLoginRes = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin-password-initial' })
      });
      const adminLoginJson = await adminLoginRes.json();
      assert.strictEqual(adminLoginJson.ok, true);
      const adminToken = adminLoginJson.token;

      const adminMeBefore = await fetch(`${base}/api/auth/me`, {
        headers: { authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(adminMeBefore.status, 200);

      revokedUserId = null;
      const adminChgRes = await fetch(`${base}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          currentPassword: 'admin-password-initial',
          newPassword: 'AdminNewSecurePass999'
        })
      });
      const adminChgJson = await adminChgRes.json();
      assert.strictEqual(adminChgRes.status, 200);
      assert.strictEqual(adminChgJson.ok, true);
      assert.strictEqual(revokedUserId, 'admin', 'store.adapter.revokeUserSessions must be called for admin');

      const adminMeAfter = await fetch(`${base}/api/auth/me`, {
        headers: { authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(adminMeAfter.status, 401, 'Old admin session token must be revoked and rejected with 401');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
  console.log('✅ AUTH-03: /change-password session revocation verified.');

  // =========================================================================
  // AUTH-04: /logout Warning Log on DB Revoke Failure
  // =========================================================================
  console.log('4. Testing AUTH-04: /logout Warning Log on DB Revoke Failure...');
  {
    const store = createInMemoryStore();
    const logger = createMockLogger();
    let deleteSessionMode = 'success';

    store.adapter.deleteSession = async (tokenHash) => {
      if (deleteSessionMode === 'fail_false') return false;
      if (deleteSessionMode === 'fail_throw') throw new Error('Database connection reset during logout');
      return true;
    };

    const activeSessions = new Map();
    const authRouter = createAuthApi({
      store,
      entitlementService: {},
      registry: { store: {}, getAdminPassword: () => null, verifyBotSecretSync: () => false },
      config: {},
      logger,
      activeSessions
    });

    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRouter);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
      // 4.1 Logout when deleteSession returns false -> logs warning
      deleteSessionMode = 'fail_false';
      const fakeToken1 = 'testtoken11111111111111111111111111111111';
      const hash1 = hashSessionToken(fakeToken1);
      activeSessions.set(hash1, { userId: 'u1', username: 'u1' });

      const logoutRes1 = await fetch(`${base}/api/auth/logout`, {
        method: 'POST',
        headers: { authorization: `Bearer ${fakeToken1}` }
      });
      const logoutJson1 = await logoutRes1.json();
      assert.strictEqual(logoutRes1.status, 200);
      assert.strictEqual(logoutJson1.ok, true);
      assert.strictEqual(activeSessions.has(hash1), false, 'RAM session must still be removed');

      const warn1 = logger.logs.warn.find((w) => w.msg.includes('Failed to revoke session from database on logout'));
      assert.ok(warn1, 'Must log warning when DB revoke returns falsy');
      assert.strictEqual(warn1.meta.tokenHash, hash1);

      // 4.2 Logout when deleteSession throws -> logs warning with error
      deleteSessionMode = 'fail_throw';
      const fakeToken2 = 'testtoken22222222222222222222222222222222';
      const hash2 = hashSessionToken(fakeToken2);
      activeSessions.set(hash2, { userId: 'u2', username: 'u2' });

      const logoutRes2 = await fetch(`${base}/api/auth/logout`, {
        method: 'POST',
        headers: { authorization: `Bearer ${fakeToken2}` }
      });
      const logoutJson2 = await logoutRes2.json();
      assert.strictEqual(logoutRes2.status, 200);
      assert.strictEqual(logoutJson2.ok, true);
      assert.strictEqual(activeSessions.has(hash2), false);

      const warn2 = logger.logs.warn.find((w) => w.meta && w.meta.tokenHash === hash2);
      assert.ok(warn2, 'Must log warning when DB revoke throws');
      assert.ok(warn2.meta.error.includes('Database connection reset'));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
  console.log('✅ AUTH-04: /logout DB revoke failure warning log verified.');

  // =========================================================================
  // AUTH-05: Rate Limiter IP Resolution via Express Trust Proxy
  // =========================================================================
  console.log('5. Testing AUTH-05: Rate Limiter IP Resolution via Express Trust Proxy...');
  {
    const store = createInMemoryStore();
    const logger = createMockLogger();
    const app = createApp({
      store,
      registry: { store: {}, getAdminPassword: () => null, verifyBotSecretSync: () => false },
      broker: {},
      config: { adminUsername: 'admin', adminPassword: 'admin-password' },
      logger
    });

    // 5.1 Verify Express app has 'trust proxy' configured
    assert.strictEqual(app.get('trust proxy'), 1, 'app trust proxy must be configured to 1');

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
      // 5.2 With trust proxy = 1, X-Forwarded-For: <client>, <proxy>
      // When client sends X-Forwarded-For: 203.0.113.195, req.ip will resolve to 203.0.113.195
      const regRes = await fetch(`${base}/api/auth/register`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Forwarded-For': '203.0.113.195'
        },
        body: JSON.stringify({
          username: 'trustproxyuser',
          password: 'Password123!',
          confirmPassword: 'Password123!'
        })
      });
      assert.strictEqual(regRes.status, 201);
      const auditEntry = store.audit.find((a) => a.action === 'AUTH_REGISTER' && a.actorId === 'trustproxyuser');
      assert.ok(auditEntry, 'Audit log entry must be recorded');
      assert.strictEqual(
        auditEntry.details.ip,
        '203.0.113.195',
        'Trust proxy must resolve clientIp to 203.0.113.195 via req.ip'
      );

      // 5.3 Test user-api Link4M start endpoint IP resolution
      let capturedAttemptIp = null;
      const link4mService = {
        getDailyQuotaStatus: async () => ({ remainingAttempts: 3 }),
        createLinkAttempt: async (userId, clientIp) => {
          capturedAttemptIp = clientIp;
          return { ok: true, attemptId: 'att_1', url: 'https://link4m.co/test' };
        }
      };

      const userApp = express();
      userApp.set('trust proxy', 1);
      userApp.use(express.json());
      userApp.use((req, res, next) => {
        req.managerAuthSession = { userId: 'usr_test_link', username: 'testuser', role: 'user' };
        next();
      });
      userApp.use('/api', createUserApi({
        store,
        link4mService,
        registry: { list: async () => [] },
        logger
      }));

      const userServer = http.createServer(userApp);
      await new Promise((resolve) => userServer.listen(0, resolve));
      const userPort = userServer.address().port;

      try {
        const linkRes = await fetch(`http://127.0.0.1:${userPort}/api/rewards/link4m/start`, {
          method: 'POST',
          headers: { 'X-Forwarded-For': '198.51.100.42' }
        });
        const linkJson = await linkRes.json();
        assert.strictEqual(linkJson.ok, true);
        assert.strictEqual(capturedAttemptIp, '198.51.100.42', 'user-api must resolve IP safely via req.ip');
      } finally {
        await new Promise((resolve) => userServer.close(resolve));
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
  console.log('✅ AUTH-05: Express trust proxy & clientIp resolution verified.');

  // =========================================================================
  // AUTH-06: Bounded Map Rate Limiter (OOM DoS Prevention)
  // =========================================================================
  console.log('6. Testing AUTH-06: Bounded Map Rate Limiter...');
  {
    const store = createInMemoryStore();
    const logger = createMockLogger();
    const activeSessions = new Map();

    const authRouter = createAuthApi({
      store,
      entitlementService: {},
      registry: { store: {}, getAdminPassword: () => null, verifyBotSecretSync: () => false },
      config: {},
      logger,
      activeSessions
    });

    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRouter);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
      // 6.1 Trigger rate limit on same IP & username -> 10 attempts allowed, 11th gets 429
      for (let i = 1; i <= 10; i++) {
        const res = await fetch(`${base}/api/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'X-Forwarded-For': '10.0.0.1' },
          body: JSON.stringify({ username: 'brutetarget', password: 'wrongpassword' })
        });
        assert.strictEqual(res.status, 401, `Attempt ${i} should return 401`);
      }

      const blockedRes = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Forwarded-For': '10.0.0.1' },
        body: JSON.stringify({ username: 'brutetarget', password: 'wrongpassword' })
      });
      assert.strictEqual(blockedRes.status, 429, '11th attempt must be blocked with HTTP 429');
      const blockedJson = await blockedRes.json();
      assert.ok(blockedJson.error.includes('Quá nhiều lần đăng nhập sai'));

      // 6.2 Test Map Bounding & FIFO Eviction
      const checkRateLimit = authRouter._checkRateLimit;
      const map = authRouter._loginAttempts;
      assert.ok(typeof checkRateLimit === 'function', 'checkRateLimit must be accessible');
      assert.ok(map instanceof Map, 'loginAttempts must be a Map instance');

      // Clear map and populate with 5000 entries
      map.clear();
      for (let i = 0; i < 5000; i++) {
        checkRateLimit(`10.100.${Math.floor(i / 255)}.${i % 255}`, `user_${i}`);
      }
      assert.strictEqual(map.size, 5000, 'Map should be at capacity 5000');

      const oldestKeyBefore = map.keys().next().value;
      assert.ok(oldestKeyBefore, 'Oldest key must exist');

      // Add 1 more entry when at capacity
      checkRateLimit('10.200.0.1', 'overflow_user');
      assert.strictEqual(map.size, 5000, 'Map size must strictly not exceed 5000');
      assert.strictEqual(map.has(oldestKeyBefore), false, 'Oldest entry must have been FIFO evicted');
      assert.ok(map.has('10.200.0.1:overflow_user'), 'New entry must be present');

      // Test purge of expired entries
      // Manually backdate 100 entries to 20 minutes ago (> 15 min window)
      let countBackdated = 0;
      for (const [, v] of map.entries()) {
        v.windowStart = Date.now() - (20 * 60 * 1000);
        countBackdated++;
        if (countBackdated >= 100) break;
      }
      // Add another new entry, triggering expired purge
      checkRateLimit('10.200.0.2', 'after_purge_user');
      assert.ok(map.size <= 5000 - 99, 'Expired entries must be purged, reducing map size below 5000');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
  console.log('✅ AUTH-06: Bounded Map rate limiter verified.');

  // =========================================================================
  // AUTH-07: Explicit keyRedeemed and keyError in /register
  // =========================================================================
  console.log('7. Testing AUTH-07: Explicit keyRedeemed and keyError in /register...');
  {
    const store = createInMemoryStore();
    const logger = createMockLogger();
    let shouldRedeemSucceed = true;
    let redeemErrorMessage = 'Key đã hết lượt kích hoạt';

    const entitlementService = {
      redeem: async (userId, key, role) => {
        if (!shouldRedeemSucceed) {
          throw new Error(redeemErrorMessage);
        }
        return { ok: true, planName: 'VIP PLAN' };
      }
    };

    const app = createApp({
      store,
      entitlementService,
      registry: { store: {}, getAdminPassword: () => null, verifyBotSecretSync: () => false },
      broker: {},
      config: { adminUsername: 'admin', adminPassword: 'admin-password' },
      logger
    });
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
      // 7.1 Register with VALID key -> keyRedeemed: true, keyError not present
      shouldRedeemSucceed = true;
      const validKeyRes = await fetch(`${base}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'validkeyuser',
          password: 'Password123!',
          confirmPassword: 'Password123!',
          key: 'KINGMC-VALID-KEY-100'
        })
      });
      const validKeyJson = await validKeyRes.json();
      assert.strictEqual(validKeyRes.status, 201);
      assert.strictEqual(validKeyJson.ok, true);
      assert.strictEqual(validKeyJson.keyRedeemed, true, 'keyRedeemed must be true on success');
      assert.strictEqual(validKeyJson.keyError, undefined, 'keyError must not be set on success');

      // 7.2 Register with INVALID key -> 201, keyRedeemed: false, keyError has error details
      shouldRedeemSucceed = false;
      redeemErrorMessage = 'Mã quà tặng đã hết hạn sử dụng.';
      const invalidKeyRes = await fetch(`${base}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'invalidkeyuser',
          password: 'Password123!',
          confirmPassword: 'Password123!',
          key: 'KINGMC-EXPIRED-KEY-999'
        })
      });
      const invalidKeyJson = await invalidKeyRes.json();
      assert.strictEqual(invalidKeyRes.status, 201, 'Account registration still succeeds with 201');
      assert.strictEqual(invalidKeyJson.ok, true);
      assert.strictEqual(invalidKeyJson.keyRedeemed, false, 'keyRedeemed must be false on failure');
      assert.strictEqual(invalidKeyJson.keyError, 'Mã quà tặng đã hết hạn sử dụng.');
      assert.ok(
        invalidKeyJson.message.includes('Mã quà tặng đã hết hạn sử dụng'),
        'Message must alert user about key failure'
      );

      // 7.3 Register WITHOUT key -> 201, keyRedeemed and keyError omitted
      const noKeyRes = await fetch(`${base}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'nokeyuser',
          password: 'Password123!',
          confirmPassword: 'Password123!'
        })
      });
      const noKeyJson = await noKeyRes.json();
      assert.strictEqual(noKeyRes.status, 201);
      assert.strictEqual(noKeyJson.ok, true);
      assert.strictEqual(noKeyJson.keyRedeemed, undefined);
      assert.strictEqual(noKeyJson.keyError, undefined);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
  console.log('✅ AUTH-07: Explicit keyRedeemed and keyError response verified.');

  // =========================================================================
  // AUTH-08: DB Auth and RAM Cache Consistency (bypassCache)
  // =========================================================================
  console.log('8. Testing AUTH-08: DB Auth and RAM Cache Consistency (bypassCache)...');
  {
    const store = createInMemoryStore();
    const logger = createMockLogger();

    // 8.1 Test SupabaseDashboardStore.getUser with bypassCache: true
    let dbFetchCount = 0;
    const mockStore = new SupabaseDashboardStore({
      from: (table) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              dbFetchCount++;
              return {
                data: {
                  id: 'usr_charlie',
                  username: 'charlie',
                  role: 'user',
                  status: 'active',
                  bot_count: 1,
                  assigned_bot_ids: ['1']
                },
                error: null
              };
            }
          })
        })
      })
    });

    // First call: populates cache
    const user1 = await mockStore.getUser('charlie');
    assert.strictEqual(user1.username, 'charlie');
    assert.strictEqual(dbFetchCount, 1);

    // Second call without bypassCache: served from RAM cache
    const user2 = await mockStore.getUser('charlie');
    assert.strictEqual(user2.username, 'charlie');
    assert.strictEqual(dbFetchCount, 1, 'Second call must hit RAM cache without DB fetch');

    // Third call with bypassCache: true -> fetches fresh from DB
    const user3 = await mockStore.getUser('charlie', { bypassCache: true });
    assert.strictEqual(user3.username, 'charlie');
    assert.strictEqual(dbFetchCount, 2, 'Call with bypassCache: true must query DB');

    // 8.2 In /login: verify store.getUser is called with { bypassCache: true }
    store.users.set('dave', {
      id: 'usr_dave',
      username: 'dave',
      password: hashPassword('DavePass123!'),
      role: 'user',
      status: 'active'
    });

    const app = createApp({
      store,
      registry: { store: {}, getAdminPassword: () => null, verifyBotSecretSync: () => false },
      broker: {},
      config: { adminUsername: 'admin', adminPassword: 'admin-password' },
      logger
    });
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
      const loginRes = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'dave', password: 'DavePass123!' })
      });
      const loginJson = await loginRes.json();
      assert.strictEqual(loginRes.status, 200);
      assert.strictEqual(loginJson.ok, true);

      const daveCall = store.getUserCalls().find((c) => c.username === 'dave');
      assert.ok(daveCall, 'Must call store.getUser for dave');
      assert.deepStrictEqual(
        daveCall.options,
        { bypassCache: true },
        '/login must call store.getUser with { bypassCache: true }'
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
  console.log('✅ AUTH-08: DB auth & RAM cache consistency verified.');

  console.log('🎉 ALL AUTH-01 THROUGH AUTH-08 REGRESSION TESTS PASSED 100%!');
}

runTests().catch((err) => {
  console.error('❌ AUTH REGRESSION TEST SUITE FAILED:', err);
  process.exit(1);
});
