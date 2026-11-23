'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

const { resolveClientIp } = require('../src/services/captcha');
const { AccessControl } = require('../src/services/access-control');
const {
  encryptSecret,
  encryptUserPassword,
  decryptUserPassword,
  hashAdminPasswordAsync,
  verifyAdminPasswordAsync
} = require('../src/utils/secrets');
const { createAdminApi } = require('../src/http/routes/admin-api');
const { isSuperAdmin } = require('../src/discord/handlers/interaction-handler');
const { plainCode, maskCookieDisplay } = require('../src/discord/panels/renderer');
const { resolveAndValidateHost } = require('../src/services/proxy-validation');
const { validateDiscordWebhookUrl } = require('../src/services/admin-notifier');
const { validatePanelUrl } = require('../src/services/wispbyte-keepalive');
const { redactStringSecrets } = require('../src/utils/logger');
const WorkerRegistry = require('../src/services/worker-registry');
const SupabaseCommandStore = require('../src/storage/supabase-command-store');
const SupabaseDashboardStore = require('../src/storage/supabase-dashboard-store');
const SCHEMA_SQL = require('../src/storage/schema-sql');

const ROOT = path.resolve(__dirname, '..');

function extractDollarQuotedFunction(sql, fnName, tag) {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${fnName}\\([\\s\\S]*?AS ${escapedTag}([\\s\\S]*?)${escapedTag}`,
    'm'
  );
  const match = sql.match(pattern);
  assert.ok(match, `Missing SQL function ${fnName} with tag ${tag}`);
  return match[1];
}

test('AUTH-01: resolveClientIp trusts only Cloudflare/private forwarders and rejects spoofed headers', () => {
  const spoofReq = {
    socket: { remoteAddress: '198.51.100.7' },
    headers: {
      'cf-connecting-ip': '203.0.113.200',
      'x-forwarded-for': '203.0.113.201, 203.0.113.202'
    }
  };
  assert.equal(resolveClientIp(spoofReq), '198.51.100.7');

  const cfReq = {
    socket: { remoteAddress: '173.245.48.10' },
    headers: {
      'cf-connecting-ip': '203.0.113.42',
      'x-forwarded-for': '198.51.100.88, 203.0.113.42'
    }
  };
  assert.equal(resolveClientIp(cfReq), '203.0.113.42');

  const chainReq = {
    socket: { remoteAddress: '10.0.0.5' },
    headers: {
      'x-forwarded-for': '1.1.1.1, 203.0.113.9, 10.0.0.2'
    }
  };
  assert.equal(resolveClientIp(chainReq), '203.0.113.9');

  const missingSocketReq = { headers: { 'x-forwarded-for': '203.0.113.5' } };
  assert.equal(resolveClientIp(missingSocketReq), '0.0.0.0');
});

test('ENT-01 & STORE-SQL-03/04/08/12/14/15 & M3-12: SQL SSoT parity, partial discord link index, grants and sequence revoke', () => {
  const setupSql = fs.readFileSync(path.join(ROOT, 'supabase/setup.sql'), 'utf8');
  const resetSql = fs.readFileSync(path.join(ROOT, 'supabase/reset_and_setup.sql'), 'utf8');
  const safeMigSql = fs.readFileSync(
    path.join(ROOT, 'supabase/migrations/20261122000000_deep_audit_remediation_safe.sql'),
    'utf8'
  );

  assert.equal(SCHEMA_SQL, setupSql.replace(/\r\n/g, '\n'), 'schema-sql.js must match LF-normalized setup.sql 1:1');

  for (const [label, sql] of [['setup.sql', setupSql], ['reset_and_setup.sql', resetSql], ['safe_migration', safeMigSql]]) {
    const setAccessBody = extractDollarQuotedFunction(sql, 'manager_set_user_access', '$set_access$');
    assert.equal(/USER_DISABLED|bị khóa/i.test(setAccessBody), false, `${label}: manager_set_user_access must NOT reject disabled users`);
    for (const col of ['last_login_ip', 'last_login_at', 'discord_user_id', 'is_trial', 'trial_bot_id']) {
      assert.ok(setAccessBody.includes(col), `${label}: manager_set_user_access must persist ${col}`);
    }
    assert.ok(setAccessBody.includes('NULLIF(btrim('), `${label}: manager_set_user_access must guard timestamptz strings with NULLIF(btrim(`);

    const redeemBody = extractDollarQuotedFunction(sql, 'manager_redeem_code_with_access', '$redeem_code$');
    assert.ok(/v_user\.status[\s\S]{0,60}'disabled'[\s\S]{0,120}RAISE EXCEPTION/i.test(redeemBody), `${label}: manager_redeem_code_with_access must block disabled users`);
    assert.ok(redeemBody.includes('BOT_OWNERSHIP_CONFLICT'), `${label}: manager_redeem_code_with_access must check BOT_OWNERSHIP_CONFLICT`);

    assert.ok(
      sql.includes('REVOKE ALL ON SEQUENCE public.manager_bot_number_seq FROM PUBLIC, anon, authenticated'),
      `${label}: missing sequence REVOKE`
    );
    assert.ok(
      sql.includes('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.manager_users TO service_role;'),
      `${label}: missing manager_users service_role GRANT`
    );
    assert.ok(
      /CREATE UNIQUE INDEX IF NOT EXISTS\s+idx_manager_discord_links_active_user[\s\S]*WHERE status = ''?active''?/i.test(sql),
      `${label}: missing partial unique index on manager_discord_links WHERE status = 'active'`
    );
  }

  const setupCreateTable = setupSql.match(/CREATE TABLE IF NOT EXISTS public\.manager_discord_links\s*\([\s\S]*?\);/m)?.[0] || '';
  assert.equal(/UNIQUE\s*\(\s*manager_user_id\s*\)/i.test(setupCreateTable), false, 'setup.sql manager_discord_links must not have unconditional UNIQUE(manager_user_id)');
});

test('ENT-02 & API-03 & API-06: No accidental isPermanent promotion, strict boolean validation and masked webhook GET', async () => {
  const ac = new AccessControl();
  assert.equal(ac.isEntitled({ status: 'active', expiresAt: null }), false);
  assert.equal(ac.isEntitled({ status: 'active', expiresAt: null, isPermanent: false }), false);
  assert.equal(ac.isEntitled({ status: 'active', expiresAt: null, isPermanent: true }), true);
  assert.equal(ac.isEntitled({ status: 'disabled', expiresAt: null, isPermanent: true }), false);

  const encKey = 'k'.repeat(32);
  let capturedSetAccess = null;
  const fakeStore = {
    async getUser() {
      return { userId: 'u1', username: 'user_one', role: 'user', status: 'active', workerIds: [] };
    },
    async getAccess() {
      return { userId: 'u1', username: 'user_one', role: 'user', status: 'active', workerIds: [] };
    },
    async setAccess(targetId, data) {
      capturedSetAccess = { targetId, data: { ...data } };
    },
    async addAudit() {},
    async getSetting(key) {
      if (key === 'webhook_settings') {
        return {
          enabled: true,
          discordUrlCiphertext: encryptSecret('https://discord.com/api/webhooks/123456789012345678/dummyWebhookSecretValue123456', encKey)
        };
      }
      return null;
    }
  };
  const fakeRegistry = {
    encryptionKey: encKey,
    async list() { return []; }
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.managerAuthSession = { role: 'admin', username: 'admin' };
    next();
  });
  app.use('/api/manager', createAdminApi({
    store: fakeStore,
    entitlementService: {},
    link4mService: {},
    registry: fakeRegistry,
    broker: {},
    fleetOperations: {},
    adminNotifier: {},
    config: { encryptionKey: encKey, adminUsername: 'admin' },
    logger: { info() {}, warn() {}, error() {} }
  }));

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const port = server.address().port;
    const badPerm = await fetch(`http://127.0.0.1:${port}/api/manager/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'u1', isPermanent: 'yes' })
    });
    assert.equal(badPerm.status, 400);

    const emptyExp = await fetch(`http://127.0.0.1:${port}/api/manager/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'u1', expiresAt: '' })
    });
    assert.equal(emptyExp.status, 200);
    assert.ok(capturedSetAccess);
    assert.equal(capturedSetAccess.data.expiresAt, null);
    assert.notEqual(capturedSetAccess.data.isPermanent, true);

    const whRes = await fetch(`http://127.0.0.1:${port}/api/manager/webhook`);
    assert.equal(whRes.status, 200);
    const whBody = await whRes.json();
    assert.equal(whBody.webhook.discordUrl, '********');
    assert.equal(whBody.webhookUrl, '********');
  } finally {
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});

test('Reversible AES Web User Passwords preserved while Admin uses async scrypt$', async () => {
  const key = 's'.repeat(32);
  const cipher = encryptUserPassword('MyPlainPass!123', key);
  assert.equal(cipher.startsWith('scrypt$'), false, 'Web user password must remain reversible AES ciphertext');
  assert.equal(decryptUserPassword(cipher, key), 'MyPlainPass!123');

  const adminHash = await hashAdminPasswordAsync('AdminSecret!987');
  assert.ok(adminHash.startsWith('scrypt$'));
  assert.equal(await verifyAdminPasswordAsync('AdminSecret!987', adminHash), true);
  assert.equal(await verifyAdminPasswordAsync('WrongSecret!987', adminHash), false);
});

test('DISCORD-01, DISCORD-02, DISCORD-12, DISCORD-13: Strict SuperAdmin guild scoping, fail-closed panel-handler & renderer sanitization', () => {
  const svcWithOwner = {
    config: { adminUserId: '111111111111111111', discordGuildId: '999999999999999999' },
    accessControl: { adminUserId: '111111111111111111' }
  };

  assert.equal(isSuperAdmin({ guildId: '888888888888888888', user: { id: '111111111111111111' } }, svcWithOwner), true);
  assert.equal(isSuperAdmin({ guildId: '999999999999999999', user: { id: '222222222222222222' }, guild: { ownerId: '222222222222222222' } }, svcWithOwner), true);
  assert.equal(isSuperAdmin({ guildId: '777777777777777777', user: { id: '222222222222222222' }, guild: { ownerId: '222222222222222222' } }, svcWithOwner), false);
  assert.equal(isSuperAdmin({ guildId: '777777777777777777', user: { id: '222222222222222222' }, guild: { ownerId: '222222222222222222' } }, { config: {}, accessControl: {} }, ''), false);
  assert.equal(isSuperAdmin({ guildId: null, user: { id: '111111111111111111' } }, svcWithOwner), false);

  const panelHandlerSrc = fs.readFileSync(path.join(ROOT, 'src/discord/handlers/panel-handler.js'), 'utf8');
  assert.equal(panelHandlerSrc.includes('!normalizedUser.expiresAt'), false, 'panel-handler.js must not auto-entitle users with null expiresAt');

  const sanitized = plainCode('a`b\nc\r\nd\t@everyone');
  assert.equal(sanitized.includes('`'), false);
  assert.equal(/[\r\n\t]/.test(sanitized), false);
  assert.equal(sanitized.includes('@everyone'), false);
  assert.equal(sanitized.includes('@\u200beveryone'), true);

  assert.equal(maskCookieDisplay('a_very_secret_cookie_value_1234567890'), 'a_ve****7890');
  assert.equal(maskCookieDisplay('shortcookie'), '********');
});

test('INTEG-01, INTEG-04, INTEG-06, DISCORD-08/09: SSRF blocking, webhook/panel URL validation and log secret redaction', async () => {
  for (const host of ['127.0.0.1', '169.254.169.254', '0177.0.0.1', '2130706433']) {
    await assert.rejects(
      () => resolveAndValidateHost(host, { allowLocal: false }),
      /nội bộ|bị chặn|blocked|không hợp lệ|invalid/i,
      `Expected resolveAndValidateHost to reject ${host}`
    );
  }

  assert.equal(
    validateDiscordWebhookUrl('https://discord.com/api/webhooks/123456789012345678/validToken_123'),
    'https://discord.com/api/webhooks/123456789012345678/validToken_123'
  );
  for (const badHook of [
    'http://discord.com/api/webhooks/123456789012345678/validToken_123',
    'https://evil.example/api/webhooks/123456789012345678/validToken_123',
    'https://127.0.0.1/api/webhooks/123456789012345678/validToken_123'
  ]) {
    assert.throws(() => validateDiscordWebhookUrl(badHook));
  }

  for (const badPanel of ['http://wispbyte.com/client', 'https://127.0.0.1/client', 'https://169.254.169.254/latest/meta-data/', 'https://user:pass@wispbyte.com/client']) {
    assert.throws(() => validatePanelUrl(badPanel));
  }

  const dummyJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSJ9.signaturePartHere';
  const dummyHook = 'https://discord.com/api/webhooks/123456789012345678/superSecretTokenString_000111222';
  const dummyTg = 'https://api.telegram.org/bot123456789:AAE_fakeTelegramBotTokenExample_999/sendMessage';
  const redacted = redactStringSecrets(`Bearer ${dummyJwt} ${dummyHook} ${dummyTg}`);
  assert.equal(redacted.includes('signaturePartHere'), false);
  assert.equal(redacted.includes('superSecretTokenString'), false);
  assert.equal(redacted.includes('AAE_fakeTelegramBotTokenExample'), false);
});

test('WORKER-CHAN & STORE-SQL-07/11: WorkerRegistry settingsRev monotonic across reset, markRpcVerified & dead_letter outbox', async () => {
  const registry = new WorkerRegistry({
    store: {
      async get() { return { workerId: 'w-rev', enabled: true }; },
      async resetData() {}
    },
    accessStore: {},
    encryptionKey: 'e'.repeat(32)
  });

  registry.bumpSettingsRevision('w-rev');
  const revBeforeReset = registry.bumpSettingsRevision('w-rev');
  assert.equal(revBeforeReset, 3);
  await registry.resetData('w-rev');
  const revAfterReset = registry.workerSettingsRev.get('w-rev');
  assert.ok(revAfterReset > revBeforeReset, `Expected monotonic workerSettingsRev > ${revBeforeReset}, got ${revAfterReset}`);

  const cmdStore = new SupabaseCommandStore({});
  cmdStore.stateSyncRpcState.probeError = 'transient';
  cmdStore.markRpcVerified('manager_enqueue_worker_command');
  assert.equal(cmdStore.stateSyncRpcState.rpcVerified, true);
  assert.equal(cmdStore.stateSyncRpcState.probeError, null);

  let updatedTable = null;
  let updatedPayload = null;
  let eqArgs = null;
  const mockClient = {
    from(table) {
      updatedTable = table;
      return {
        update(payload) {
          updatedPayload = payload;
          return {
            async eq(col, val) {
              eqArgs = [col, val];
              return { error: null };
            }
          };
        }
      };
    }
  };
  const dashStore = new SupabaseDashboardStore(mockClient);
  await dashStore.failOutbox(42, 'w1', 'ERR_TEST');
  assert.ok(updatedTable);
  assert.equal(updatedPayload.status, 'dead_letter');
  assert.equal(updatedPayload.error_code, 'ERR_TEST');
  assert.deepEqual(eqArgs, ['id', 42]);
});
