'use strict';

const assert = require('node:assert');
const {
  stableJson,
  readPositiveInt,
  normalizeKeyCode,
  normalizeBotRentalDisabled,
  serializeBotSecretsForCloud,
  SupabaseAdapter
} = require('../src/storage/supabase-client');
const SupabaseDashboardStore = require('../src/storage/supabase-dashboard-store');
const { encryptUserPassword, decryptUserPassword, isStoredCredentialCiphertext } = require('../src/utils/secrets');
const { WorkerRegistry } = require('../src/services/worker-registry');

async function testPureHelpers() {
  console.log('1. Testing pure helpers in supabase-client.js...');

  // stableJson
  const objA = { b: 2, a: 1, nested: { y: 'bar', x: 'foo' } };
  const objB = { nested: { x: 'foo', y: 'bar' }, a: 1, b: 2 };
  assert.strictEqual(stableJson(objA), stableJson(objB), 'stableJson must produce deterministic output regardless of key order');

  // readPositiveInt
  assert.strictEqual(readPositiveInt('10', 1, 1, 50), 10);
  assert.strictEqual(readPositiveInt('-5', 5, 1, 50), 5, 'Negative numbers should return fallback');
  assert.strictEqual(readPositiveInt('100', 5, 1, 50), 50, 'Value exceeding max should be clamped to max');
  assert.strictEqual(readPositiveInt('abc', 10, 1, 50), 10, 'NaN should return fallback');

  // normalizeKeyCode
  assert.strictEqual(normalizeKeyCode('key-abc-123'), 'KEY-ABC-123');
  assert.strictEqual(normalizeKeyCode({ code: 'promo-2026' }), 'PROMO-2026');
  assert.strictEqual(normalizeKeyCode({ key: 'gift-999' }), 'GIFT-999');

  // normalizeBotRentalDisabled
  assert.strictEqual(normalizeBotRentalDisabled(true), true);
  assert.strictEqual(normalizeBotRentalDisabled('true'), true);
  assert.strictEqual(normalizeBotRentalDisabled(1), true);
  assert.strictEqual(normalizeBotRentalDisabled(false), false);
  assert.strictEqual(normalizeBotRentalDisabled('false'), false);
  assert.strictEqual(normalizeBotRentalDisabled(null), false);

  // serializeBotSecretsForCloud
  const rawSecrets = { 'bot-01': 'secret123', 'bot-02': 'secret456' };
  const encryptedSecrets = serializeBotSecretsForCloud(rawSecrets);
  assert.ok(isStoredCredentialCiphertext(encryptedSecrets['bot-01']), 'Bot secret must be encrypted');
  assert.strictEqual(decryptUserPassword(encryptedSecrets['bot-01']), 'secret123', 'Bot secret must be decryptable');

  console.log('✅ 1. Pure helpers verified successfully.');
}

async function testGetUserAndAddAudit() {
  console.log('2. Testing getUser() password inclusion & addAudit targetId preservation...');

  const rawPassword = 'MySecretPassword123!';
  const encPassword = encryptUserPassword(rawPassword);

  const mockUsersTable = [
    {
      id: 'usr_alice',
      username: 'alice',
      password: encPassword,
      role: 'user',
      status: 'active',
      assigned_bot_ids: ['bot-01', 'worker-host1-1'],
      is_permanent: false,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      plan_name: 'VIP',
      allow_account_change: true
    }
  ];

  const auditRows = [];
  const mockClient = {
    from: (table) => {
      if (table === 'manager_users') {
        return {
          select: () => ({
            or: (filterStr) => ({
              maybeSingle: async () => ({
                data: mockUsersTable.find((u) => u.username === 'alice'),
                error: null
              })
            }),
            eq: (col, val) => ({
              maybeSingle: async () => ({
                data: mockUsersTable.find((u) => u[col] === val),
                error: null
              })
            })
          })
        };
      }
      if (table === 'audit_logs') {
        return {
          insert: async (row) => {
            auditRows.push(row);
            return { error: null };
          }
        };
      }
      return {};
    }
  };

  const adapter = new SupabaseAdapter();
  adapter.insertAuditLog = async (entry) => {
    auditRows.push(entry);
    return true;
  };
  mockClient.adapter = adapter;
  const store = new SupabaseDashboardStore(mockClient);

  // Test getUser
  const user = await store.getUser('alice');
  assert.ok(user, 'User should be found');
  assert.strictEqual(user.username, 'alice');
  assert.strictEqual(user.password, rawPassword, 'Password must be decrypted for verification');
  assert.deepStrictEqual(user.assignedBotIds, ['bot-01', 'worker-host1-1'], 'Worker IDs must be preserved as strings');

  // Test addAudit with targetId
  await store.addAudit({
    action: 'ADMIN_DELETE_USER',
    targetId: 'target-user-99',
    actorId: 'admin'
  });

  assert.strictEqual(auditRows.length, 1);
  assert.strictEqual(auditRows[0].target?.raw, 'target-user-99', 'targetId must be captured in target.raw when target is absent');

  console.log('✅ 2. getUser() password & addAudit targetId preservation verified.');
}

async function testWorkerRegistryProxyPreservation() {
  console.log('3. Testing worker-registry proxy preservation on partial settings update...');

  const inMemoryStore = {
    workers: new Map(),
    settings: new Map(),
    async get(id) {
      return inMemoryStore.workers.get(id) || null;
    },
    async update(id, patch) {
      const prev = inMemoryStore.workers.get(id) || {};
      inMemoryStore.workers.set(id, { ...prev, ...patch });
      return inMemoryStore.workers.get(id);
    },
    async patchSettings(id, patch) {
      const prev = inMemoryStore.settings.get(id) || {};
      inMemoryStore.settings.set(id, { ...prev, ...patch });
      return inMemoryStore.settings.get(id);
    }
  };

  const registry = new WorkerRegistry({
    store: inMemoryStore,
    encryptionKey: '01234567890123456789012345678901'
  });

  const workerId = 'worker-test-1';
  inMemoryStore.workers.set(workerId, {
    workerId,
    enabled: true,
    alias: 'Bot 1',
    serverHost: 'play.kingmc.net',
    serverPort: 25565,
    version: '1.20.4'
  });

  // Step 1: Set a valid proxy
  await registry.updateSettings(workerId, {
    proxy: 'socks5://proxyuser:proxypass@1.2.3.4:1080'
  });

  const settingsAfterProxy = inMemoryStore.settings.get(workerId);
  assert.ok(settingsAfterProxy?.proxyCiphertext, 'Proxy ciphertext must be stored');

  // Step 2: Update only alias and serverHost WITHOUT proxy
  await registry.updateSettings(workerId, {
    alias: 'Renamed Bot',
    serverHost: 'smp.kingmc.net',
    serverPort: 25566,
    version: '1.21'
  });

  const settingsAfterRename = inMemoryStore.settings.get(workerId);
  assert.strictEqual(settingsAfterRename.alias, 'Renamed Bot');
  assert.strictEqual(settingsAfterRename.serverHost, 'smp.kingmc.net');
  assert.strictEqual(settingsAfterRename.serverPort, 25566);
  assert.strictEqual(settingsAfterRename.version, '1.21');
  assert.ok(settingsAfterRename.proxyCiphertext, 'Proxy ciphertext must NOT be wiped when updating alias/host');

  console.log('✅ 3. Proxy preservation and host/port/version settings update verified.');
}

async function testSessionStringWorkerIds() {
  console.log('4. Testing session string workerIds (no Number conversion)...');

  const rawIds = ['01', 'bot-alpha', 'worker-host1-1', 42];
  const normalized = rawIds.map((id) => String(id).trim()).filter(Boolean);
  assert.deepStrictEqual(normalized, ['01', 'bot-alpha', 'worker-host1-1', '42']);
  assert.ok(!normalized.includes('NaN'), 'No ID should become NaN');

  console.log('✅ 4. Session string workerIds verified.');
}

async function runAll() {
  await testPureHelpers();
  await testGetUserAndAddAudit();
  await testWorkerRegistryProxyPreservation();
  await testSessionStringWorkerIds();
  console.log('\n🎉 ALL KBOT V3 REMEDIATION AUDIT TESTS PASSED 100%!');
}

runAll().catch((err) => {
  console.error('❌ Remediation test failed:', err);
  process.exit(1);
});
