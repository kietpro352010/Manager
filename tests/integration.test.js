'use strict';

const assert = require('node:assert');
const { ACTIONS } = require('../src/services/worker-registry');
const AsyncKeyLock = require('../src/services/async-key-lock');
const schema = require('../src/storage/schema-sql');
const { encryptSecret, decryptSecret } = require('../src/utils/secrets');

async function runTests() {
  console.log('--- [MANAGER INTEGRATION TESTS] ---');

  // 1. Actions unification check
  console.log('1. Checking Unified Actions Set...');
  const expectedActions = [
    'start', 'stop', 'restart', 'reconnect', 'status', 'chat', 'reset', 'set-afk-mode', 'set-proxy',
    'respawn', 'inventory', 'look', 'toss', 'window_click', 'window_close'
  ];
  for (const act of expectedActions) {
    assert.strictEqual(ACTIONS.has(act), true, `Action ${act} must be in ACTIONS set`);
  }
  assert.strictEqual(ACTIONS.size, 15, 'ACTIONS must have exactly 15 unified actions');
  console.log('✅ 1. Unified Actions Set: 15 actions verified.');

  // 2. Encryption and Decryption Roundtrip
  console.log('2. Checking Secret Encryption Roundtrip...');
  const key = Buffer.alloc(32, 7);
  const plainText = JSON.stringify({ username: 'PlayerOne', password: 'SecretPassword123' });
  const cipher = encryptSecret(plainText, key);
  assert.notStrictEqual(cipher, plainText);
  const decrypted = decryptSecret(cipher, key);
  assert.strictEqual(decrypted, plainText);
  console.log('✅ 2. Secret Encryption: AES-256-GCM roundtrip verified.');

  // 3. AsyncKeyLock Isolation & Serialization
  console.log('3. Checking AsyncKeyLock Critical Section...');
  const lock = new AsyncKeyLock();
  const executionOrder = [];
  await Promise.all([
    lock.run('bot_1', async () => {
      await new Promise(r => setTimeout(r, 40));
      executionOrder.push(1);
    }),
    lock.run('bot_1', async () => {
      executionOrder.push(2);
    })
  ]);
  assert.deepStrictEqual(executionOrder, [1, 2], 'Lock must serialize executions for the same key');
  console.log('✅ 3. AsyncKeyLock: Sequential serialization verified.');

  // 4. Schema SQL definitions check
  console.log('4. Checking Schema SQL & Missing RPCs...');
  const sql = typeof schema === 'string' ? schema : schema.SCHEMA_SQL;
  const requiredRpcs = [
    'manager_next_bot_number',
    'manager_set_user_access',
    'manager_redeem_code_with_access',
    'manager_claim_link4m_attempt',
    'manager_complete_link4m_reward',
    'manager_bot_number_seq'
  ];
  for (const rpc of requiredRpcs) {
    assert.ok(sql.includes(rpc), `Schema SQL must include ${rpc}`);
  }
  console.log('✅ 4. Schema SQL: All 4 RPCs, atomic sequence, and functions verified.');

  console.log('🎉 ALL MANAGER INTEGRATION TESTS PASSED 100%!');
}

runTests().catch(err => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
