'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const http = require('node:http');
const express = require('express');

// Group 1: Encryption & SQL Core
const { parseEncryptionKey, parsePreviousEncryptionKey } = require('../src/config/env');
const {
  toKeyBuffer,
  getLegacyCredentialKeys,
  encryptUserPassword,
  decryptUserPassword,
  encryptSecret,
  decryptSecret,
  isStoredCredentialCiphertext
} = require('../src/utils/secrets');
const SupabaseDashboardStore = require('../src/storage/supabase-dashboard-store');
const schemaSql = require('../src/storage/schema-sql');

// Group 2: Service Integrity & Concurrency
const { EntitlementService } = require('../src/services/entitlement-service');
const { ManagerRuntimeSettings } = require('../src/services/manager-runtime-settings');
const { Link4mService } = require('../src/services/link4m-service');

// Group 3: Security & Validation
const { resolveClientIp, createCaptchaToken, verifyCaptchaToken, generateCaptcha } = require('../src/services/captcha');
const { redactSensitiveText, redactSensitiveObject } = require('../src/services/admin-notifier');
const WispbyteKeepAliveManager = require('../src/services/wispbyte-keepalive');
const { validatePanelUrl, maskCookie } = WispbyteKeepAliveManager;
const { createAdminApi } = require('../src/http/routes/admin-api');
const { createUserApi } = require('../src/http/routes/user-api');

// ----------------------------------------------------------------------------
// 1. BUG-06: 64-hex SHA-256 vs Buffer Parity & SUPABASE_SECRET_KEY fallback
// ----------------------------------------------------------------------------
test('M3-01: BUG-06 - 64-hex key derivation parity between env.js and secrets.js', () => {
  const hexKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const envKey = parseEncryptionKey({ MANAGER_MASTER_KEY: hexKey });
  const secretKey = toKeyBuffer(hexKey);

  assert.strictEqual(envKey.length, 32, 'envKey length must be 32 bytes');
  assert.strictEqual(secretKey.length, 32, 'secretKey length must be 32 bytes');
  assert.strictEqual(envKey.toString('hex'), hexKey, 'envKey must be raw 32-byte buffer decoded from hex');
  assert.strictEqual(secretKey.toString('hex'), hexKey, 'secretKey must match raw hex buffer');
  assert.deepStrictEqual(envKey, secretKey, 'envKey and secretKey must be identical 32-byte Buffers');

  // Also check parsePreviousEncryptionKey
  const prevEnvKey = parsePreviousEncryptionKey({ MANAGER_MASTER_KEY_PREVIOUS: hexKey });
  assert.deepStrictEqual(prevEnvKey, secretKey, 'prevEnvKey must also match raw hex buffer');

  // Check SUPABASE_SECRET_KEY fallback in getLegacyCredentialKeys
  const origSecret = process.env.SUPABASE_SECRET_KEY;
  try {
    process.env.SUPABASE_SECRET_KEY = 'test_supabase_secret_key_123';
    const legacyKeys = getLegacyCredentialKeys(secretKey);
    const expectedDerived = crypto.createHash('sha256').update('kbot-cred-v1:test_supabase_secret_key_123').digest('hex');
    const matched = legacyKeys.some((k) => k.toString('hex') === expectedDerived);
    assert.ok(matched, 'getLegacyCredentialKeys must include derived key from SUPABASE_SECRET_KEY');
  } finally {
    if (origSecret === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = origSecret;
  }
});

// ----------------------------------------------------------------------------
// 2. BUG-12: No static encryption key for new passwords & fail-closed in prod
// ----------------------------------------------------------------------------
test('M3-02: BUG-12 - Fail-closed in strict production and no static encryption key for new passwords', () => {
  const origNodeEnv = process.env.NODE_ENV;
  const origStrict = process.env.KBOT_STRICT_PRODUCTION;
  const origMaster = process.env.MANAGER_MASTER_KEY;
  const origEnc = process.env.MANAGER_ENCRYPTION_KEY;
  const origSbSecret = process.env.SUPABASE_SECRET_KEY;
  const origSbService = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const origSbKey = process.env.SUPABASE_KEY;

  try {
    delete process.env.MANAGER_MASTER_KEY;
    delete process.env.MANAGER_ENCRYPTION_KEY;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_KEY;

    // In production without keys, encryptUserPassword MUST FAIL CLOSED
    process.env.NODE_ENV = 'production';
    assert.throws(() => {
      encryptUserPassword('SecretPassword123');
    }, /Khóa mã hóa chưa được cấu hình, từ chối mã hóa bằng khóa mặc định/);

    // With explicit key, encrypt and decrypt work seamlessly
    const explicitKey = crypto.randomBytes(32);
    const ciphertext = encryptUserPassword('SecretPassword123', explicitKey);
    assert.ok(isStoredCredentialCiphertext(ciphertext), 'Ciphertext must match stored format');
    const decrypted = decryptUserPassword(ciphertext, explicitKey);
    assert.strictEqual(decrypted, 'SecretPassword123', 'Decrypted password must match original');
  } finally {
    process.env.NODE_ENV = origNodeEnv;
    if (origStrict === undefined) delete process.env.KBOT_STRICT_PRODUCTION;
    else process.env.KBOT_STRICT_PRODUCTION = origStrict;
    if (origMaster !== undefined) process.env.MANAGER_MASTER_KEY = origMaster;
    if (origEnc !== undefined) process.env.MANAGER_ENCRYPTION_KEY = origEnc;
    if (origSbSecret !== undefined) process.env.SUPABASE_SECRET_KEY = origSbSecret;
    if (origSbService !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = origSbService;
    if (origSbKey !== undefined) process.env.SUPABASE_KEY = origSbKey;
  }
});

// ----------------------------------------------------------------------------
// 3. ENT-01: Sweep re-entrancy guard & atomic renewal race protection
// ----------------------------------------------------------------------------
test('M3-03: ENT-01 - EntitlementService sweep re-entrancy guard and renewal race safety', async () => {
  let setAccessCalls = [];
  let userInDb = {
    userId: 'usr_race_test',
    username: 'race_user',
    status: 'active',
    isPermanent: false,
    expiresAt: new Date(Date.now() - 36000000).toISOString(), // Expired
    workerIds: ['bot-01']
  };

  const mockStore = {
    listAccess: async () => [{ ...userInDb }],
    getAccess: async () => ({ ...userInDb }),
    setAccess: async (userId, data, reason) => {
      setAccessCalls.push({ userId, data, reason });
      userInDb = { ...data };
      return userInDb;
    }
  };

  const mockRegistry = {
    find: async () => ({ status: { online: true, state: 'online' } })
  };

  const service = new EntitlementService({
    store: mockStore,
    registry: mockRegistry,
    gracePeriodMs: 1000
  });

  // Test 1: Re-entrancy guard
  service.isSweepRunning = true;
  const skippedResult = await service.checkExpiredUsersAndGracefulStop();
  assert.strictEqual(skippedResult.skipped, true, 'Concurrent sweep must be skipped when isSweepRunning is true');
  service.isSweepRunning = false;

  // Test 2: User renewed mid-sweep is NOT overwritten to expired
  let stopCalled = false;
  const mockFleetOps = {
    stopWorker: async () => {
      stopCalled = true;
      // Simulate user renewal during bot stop
      userInDb.status = 'active';
      userInDb.expiresAt = new Date(Date.now() + 86400000).toISOString();
      return { ok: true, stopped: true };
    }
  };

  // Reset user to expired before test
  userInDb = {
    userId: 'usr_race_test',
    username: 'race_user',
    status: 'active',
    isPermanent: false,
    expiresAt: new Date(Date.now() - 36000000).toISOString(),
    workerIds: ['bot-01']
  };
  setAccessCalls = [];

  await service.checkExpiredUsersAndGracefulStop({ fleetOperations: mockFleetOps, gracePeriodMs: 0 });

  assert.ok(stopCalled, 'Fleet stopWorker was called');
  // Confirm that userInDb remains active and not expired
  assert.strictEqual(userInDb.status, 'active', 'User renewed during sweep must remain active and NOT be overwritten with expired');
});

// ----------------------------------------------------------------------------
// 4. CAP-01: Header spoofing prevention & IP resolution
// ----------------------------------------------------------------------------
test('M3-04: CAP-01 - IP resolution uses req.ip and rejects untrusted proxy headers', () => {
  // Case 1: req.ip from Express trust proxy
  const req1 = { ip: '203.0.113.195' };
  assert.strictEqual(resolveClientIp(req1), '203.0.113.195', 'Direct req.ip must be prioritized');

  // Case 2: Untrusted direct client spoofing X-Forwarded-For
  const req2 = {
    socket: { remoteAddress: '198.51.100.55' },
    headers: { 'x-forwarded-for': '127.0.0.1, 10.0.0.1', 'cf-connecting-ip': '1.1.1.1' }
  };
  assert.strictEqual(resolveClientIp(req2), '198.51.100.55', 'Untrusted socket peer headers must be ignored');

  // Case 3: Trusted reverse proxy (loopback 127.0.0.1) forwarding client IP
  const req3 = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'cf-connecting-ip': '198.51.100.99' }
  };
  assert.strictEqual(resolveClientIp(req3), '198.51.100.99', 'Trusted proxy headers must be accepted');

  // Case 4: IPv6 mapped IPv4 cleaning
  const req4 = {
    socket: { remoteAddress: '::ffff:198.51.100.77' }
  };
  assert.strictEqual(resolveClientIp(req4), '198.51.100.77', '::ffff: prefix must be stripped');
});

// ----------------------------------------------------------------------------
// 5. CAP-02: Enforce dynamic captcha secret >= 16 chars & throw on missing
// ----------------------------------------------------------------------------
test('M3-05: CAP-02 - Enforce dynamic captcha secret >= 16 chars and throw on missing', () => {
  const origSecret = process.env.CAPTCHA_SECRET;
  const origSessionSecret = process.env.MANAGER_SESSION_SECRET;

  try {
    delete process.env.CAPTCHA_SECRET;
    delete process.env.MANAGER_SESSION_SECRET;

    // Missing secret throws error
    assert.throws(() => {
      createCaptchaToken('42', '');
    }, /CAPTCHA secret must be configured with at least 16 characters/);

    assert.throws(() => {
      generateCaptcha('');
    }, /CAPTCHA secret must be configured with at least 16 characters/);

    // Valid secret works
    const secret = 'valid_test_secret_32_characters!';
    const captcha = generateCaptcha(secret);
    assert.ok(captcha.ok, 'generateCaptcha must succeed with valid secret');
    assert.ok(captcha.token, 'Token must be generated');

    const verifyRes = verifyCaptchaToken(captcha.token, 'wrong', secret);
    assert.strictEqual(verifyRes.valid, false, 'Wrong answer must fail');
  } finally {
    if (origSecret !== undefined) process.env.CAPTCHA_SECRET = origSecret;
    if (origSessionSecret !== undefined) process.env.MANAGER_SESSION_SECRET = origSessionSecret;
  }
});

// ----------------------------------------------------------------------------
// 6. L4M-01: RPC rejection fail-closed, addedHours contract & SQL state recovery
// ----------------------------------------------------------------------------
test('M3-06: L4M-01 - Link4mService rejects fallback on RPC ok: false', async () => {
  let fallbackCompleteCalled = false;
  const mockStore = {
    adapter: {
      claimLink4mReward: async () => ({
        ok: false,
        error: 'USER_LOCKED',
        message: 'Tài khoản không ở trạng thái hợp lệ để nhận thưởng.'
      })
    },
    claimLinkAttempt: async () => ({ rewardHours: 12 }),
    completeLink4mReward: async () => {
      fallbackCompleteCalled = true;
      return true;
    }
  };

  const mockAccessControl = {
    memberFor: async () => ({ userId: 'usr_01', username: 'testuser', status: 'active' })
  };

  const link4mService = new Link4mService({
    store: mockStore,
    accessControl: mockAccessControl,
    config: { link4mSecretKey: 'test_sec_12345' }
  });

  const attempt = { attemptId: 'att_01', userId: 'usr_01', rewardHours: 12 };

  await assert.rejects(async () => {
    await link4mService.completeVerifiedAttempt(attempt, 'token_xyz');
  }, /USER_LOCKED|Tài khoản không ở trạng thái hợp lệ/);

  assert.strictEqual(fallbackCompleteCalled, false, 'Fallback completeLink4mReward MUST NOT be executed when RPC explicitly returns ok: false');
});

// ----------------------------------------------------------------------------
// 7. MRS-01: Preserve raw secrets ciphertext on decryption failure
// ----------------------------------------------------------------------------
test('M3-07: MRS-01 - Preserve raw ciphertext on decryption failure to prevent wipe', async () => {
  const corruptedCiphertext = 'aes256.corrupted.data.not.decryptable';
  let savedSetting = null;

  const mockStore = {
    getSetting: async () => ({
      publicBaseUrl: 'https://old-domain.com',
      secretsCiphertext: corruptedCiphertext
    }),
    setSetting: async (key, val) => {
      savedSetting = val;
    }
  };

  const settings = new ManagerRuntimeSettings({
    store: mockStore,
    encryptionKey: crypto.randomBytes(32)
  });

  await settings.initialize();
  assert.strictEqual(settings.secretsDecryptionFailed, true, 'secretsDecryptionFailed must be set to true');
  assert.strictEqual(settings.rawSecretsCiphertext, corruptedCiphertext, 'rawSecretsCiphertext must be preserved');

  // Updating only publicBaseUrl must preserve corruptedCiphertext without wiping secrets
  await settings.update({ publicBaseUrl: 'https://new-domain.com' });
  assert.strictEqual(savedSetting.publicBaseUrl, 'https://new-domain.com');
  assert.strictEqual(savedSetting.secretsCiphertext, corruptedCiphertext, 'Original ciphertext must NOT be overwritten with empty secrets');

  // Updating secret fields when decryption failed must throw
  await assert.rejects(async () => {
    await settings.update({ renderApiKey: 'rnd_12345' });
  }, /Không thể cập nhật cấu hình bí mật khi chưa giải mã được dữ liệu hiện tại/);
});

// ----------------------------------------------------------------------------
// 8. ADM-01: Redaction of sensitive keys in notifications & alert messages
// ----------------------------------------------------------------------------
test('M3-08: ADM-01 - Redact sensitive keys in stack text, messages, and details', () => {
  const stackWithSecret = 'Error: at login.js:15: password=MySuperSecretPassword123 & token=tok_abc123456';
  const redactedStack = redactSensitiveText(stackWithSecret);

  assert.ok(!redactedStack.includes('MySuperSecretPassword123'), 'Plain password must not be in redacted stack');
  assert.ok(!redactedStack.includes('tok_abc123456'), 'Plain token must not be in redacted stack');
  assert.ok(redactedStack.includes('password=[REDACTED]'), 'password=[REDACTED] must be present');
  assert.ok(redactedStack.includes('token=[REDACTED]'), 'token=[REDACTED] must be present');

  const sensitiveObj = {
    username: 'alice',
    password: 'AliceSecretPassword!',
    botApiKey: 'bot_key_secret_999',
    details: {
      nestedToken: 'tok_nested_xyz'
    }
  };
  const redactedObj = redactSensitiveObject(sensitiveObj);
  assert.strictEqual(redactedObj.username, 'alice');
  assert.strictEqual(redactedObj.password, '[REDACTED]');
  assert.strictEqual(redactedObj.botApiKey, '[REDACTED]');
  assert.strictEqual(redactedObj.details.nestedToken, '[REDACTED]');
});

// ----------------------------------------------------------------------------
// 9. WSP-01: Encrypted cookies, CRLF rejection, SSRF protection, cookie masking
// ----------------------------------------------------------------------------
test('M3-09: WSP-01 - Wispbyte keepalive SSRF protection, CRLF rejection, and cookie masking', async () => {
  // 1. SSRF validation
  assert.throws(() => validatePanelUrl('http://127.0.0.1:3000/api'), /máy chủ nội bộ/);
  assert.throws(() => validatePanelUrl('http://localhost:8080'), /máy chủ nội bộ/);
  assert.throws(() => validatePanelUrl('http://169.254.169.254/latest/meta-data'), /máy chủ nội bộ/);
  assert.throws(() => validatePanelUrl('https://192.168.1.1/client'), /dải IP mạng nội bộ/);
  assert.throws(() => validatePanelUrl('https://10.0.0.5/client'), /dải IP mạng nội bộ/);
  assert.strictEqual(validatePanelUrl('https://wispbyte.com/client'), 'https://wispbyte.com/client');

  // 2. Cookie masking
  assert.strictEqual(maskCookie('wisp_session_1234567890_abcdef'), 'wisp****cdef');

  // 3. CRLF rejection
  let savedSettings = null;
  const mockStore = {
    getSetting: async () => [],
    setSetting: async (key, val) => { savedSettings = val; }
  };

  const manager = new WispbyteKeepAliveManager({
    store: mockStore,
    config: { encryptionKey: crypto.randomBytes(32) }
  });

  await assert.rejects(async () => {
    await manager.addOrUpdateAccount({
      id: 'acc1',
      name: 'Account 1',
      cookie: 'wisp_sess=123\r\nInjected-Header: evil',
      panelUrl: 'https://wispbyte.com/client'
    });
  }, /CRLF control characters/);

  // 4. Encrypted storage in manager_settings
  const addRes = await manager.addOrUpdateAccount({
    id: 'acc1',
    name: 'Account 1',
    cookie: 'wisp_sess=valid_cookie_123456789',
    panelUrl: 'https://wispbyte.com/client'
  });
  assert.strictEqual(addRes.cookieMasked, true, 'Returned cookie must be masked');
  assert.ok(isStoredCredentialCiphertext(savedSettings[0].cookie), 'Cookie stored in DB must be encrypted');
});

// ----------------------------------------------------------------------------
// 10. BUG-ADMIN-01: Redact password in audit logs & whitelist fields in admin API
// ----------------------------------------------------------------------------
test('M3-10: BUG-ADMIN-01 - Redact passwords in audit logs and protect reserved usernames', async () => {
  let auditLogged = null;
  const mockStore = {
    setAccess: async () => ({}),
    addAudit: async (entry) => { auditLogged = entry; },
    removeAccess: async () => ({})
  };

  const app = express();
  app.use(express.json());
  // Attach mock session
  app.use((req, _res, next) => {
    req.managerAuthSession = { username: 'admin', role: 'admin' };
    next();
  });
  app.use('/admin', createAdminApi({ store: mockStore, config: { adminUsername: 'admin' } }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    // 1. Password redacted in audit
    const res1 = await fetch(`http://127.0.0.1:${port}/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'alice_new',
        password: 'PlainSecretPassword123'
      })
    });
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(auditLogged.details.password, '[REDACTED]', 'Audit log must redact password');

    // 2. Reject reserved username 'admin'
    const res2 = await fetch(`http://127.0.0.1:${port}/admin/users/usr_alice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        values: { username: 'admin' }
      })
    });
    assert.strictEqual(res2.status, 400);
    const body2 = await res2.json();
    assert.ok(body2.error.includes('bảo lưu cho Quản trị viên'));
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});

// ----------------------------------------------------------------------------
// 11. BUG-UAPI-01: Prevent Reflected XSS in /rewards/link4m/return
// ----------------------------------------------------------------------------
test('M3-11: BUG-UAPI-01 - Prevent reflected XSS in Link4M return route', async () => {
  const app = express();
  app.use(createUserApi({
    store: {},
    accessControl: {},
    link4mService: {},
    captchaService: {}
  }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const maliciousPayload = "';alert(document.domain);//<script>evil()</script>";
    const res = await fetch(`http://127.0.0.1:${port}/rewards/link4m/return?token=${encodeURIComponent(maliciousPayload)}&attempt=att_123`);
    const html = await res.text();

    assert.strictEqual(res.status, 200);
    // Verify script tags and quotes do not breakout
    assert.ok(!html.includes("<script>evil()</script>"), 'Raw malicious script tags must be sanitized');
    assert.ok(html.includes('\\u003cscript\\u003eevil()\\u003c/script\\u003e'), 'Script tags must be unicode escaped in JSON');
    assert.ok(html.includes('<script id="link4m-init" type="application/json">'), 'Payload must be enclosed in application/json block');
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});

// ----------------------------------------------------------------------------
// 12. SQL-01: Table grants present for service_role in schema-sql.js
// ----------------------------------------------------------------------------
test('M3-12: SQL-01 - Table grants present for service_role in schema-sql.js', () => {
  assert.ok(
    schemaSql.includes('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.manager_users TO service_role;'),
    'schema-sql.js must grant SELECT, INSERT, UPDATE, DELETE to service_role'
  );
  assert.ok(
    !schemaSql.includes('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.manager_users FROM service_role;'),
    'schema-sql.js must NOT revoke table permissions from service_role'
  );
});

// ----------------------------------------------------------------------------
// 13. DASH-02: SupabaseDashboardStore setAccess skips redundant upsert & error handling
// ----------------------------------------------------------------------------
test('M3-13: DASH-02 - SupabaseDashboardStore setAccess skips redundant direct upsert when RPC covers fields', async () => {
  let rpcCalled = false;
  let directUpsertCalled = false;

  const mockClient = {
    rpc: async (name, params) => {
      if (name === 'manager_set_user_access') {
        rpcCalled = true;
        return {
          data: {
            id: params.p_user_id,
            username: 'test_user',
            role: 'user',
            status: 'active',
            assigned_bot_ids: ['bot-01']
          },
          error: null
        };
      }
      return { data: null, error: null };
    },
    from: () => ({
      upsert: () => {
        directUpsertCalled = true;
        return { select: () => ({ maybeSingle: async () => ({ data: {}, error: null }) }) };
      },
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) })
    })
  };

  const store = new SupabaseDashboardStore(mockClient);

  const res = await store.setAccess('usr_test', {
    workerIds: ['bot-01'],
    planName: 'VIP',
    role: 'user'
  }, 'admin');

  assert.ok(rpcCalled, 'manager_set_user_access RPC was called');
  assert.strictEqual(directUpsertCalled, false, 'Redundant direct upsert must NOT be called when RPC covers fields');
  assert.strictEqual(res.userId, 'usr_test');
  assert.strictEqual(res.role, 'user');
});
