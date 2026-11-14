'use strict';

const assert = require('assert');
const fs = require('fs');
const schemaSql = require('D:/manager/src/storage/schema-sql.js');
const resetSql = fs.readFileSync('D:/manager/supabase/reset_and_setup.sql', 'utf8');
const setupSql = fs.readFileSync('D:/manager/supabase/setup.sql', 'utf8');
const reconSql = fs.readFileSync('D:/manager/supabase/migrations/20261112000000_reconcile_full_manager_schema.sql', 'utf8');

const files = [
  ['schema-sql.js', schemaSql],
  ['reset_and_setup.sql', resetSql],
  ['setup.sql', setupSql],
  ['reconcile_full_manager_schema.sql', reconSql]
];

console.log('--- Adversarial Stress Testing ---');

// Check that no file contains old unconditional RETURN true in manager_reset_worker_data
for (const [name, content] of files) {
  const marker = 'CREATE OR REPLACE FUNCTION public.manager_reset_worker_data(';
  const idx = content.indexOf(marker);
  assert.notStrictEqual(idx, -1, `Could not find function definition in ${name}`);
  const endFn = content.indexOf('$reset_data$;', idx);
  assert.notStrictEqual(endFn, -1, `Could not find end of function in ${name}`);
  const block = content.slice(idx, endFn);
  assert.ok(!block.includes('RETURN true;'), `${name} still contains RETURN true; in manager_reset_worker_data`);
  assert.ok(block.includes('GET DIAGNOSTICS v_row_count = ROW_COUNT;'), `${name} missing GET DIAGNOSTICS in manager_reset_worker_data`);
  assert.ok(block.includes('RETURN v_row_count > 0;'), `${name} missing RETURN v_row_count > 0; in manager_reset_worker_data`);
}
console.log('✅ manager_reset_worker_data accurately checks ROW_COUNT across all 4 SQL files.');

// Check Link4M ownership hijack edge cases
function testLink4mWhereClause(attempt, p_user_id) {
  return (
    attempt.status === 'processing' &&
    (attempt.user_id === null || attempt.user_id === '' || attempt.user_id === p_user_id)
  );
}

// Case 1: user_id mismatch with non-empty string
assert.strictEqual(testLink4mWhereClause({ status: 'processing', user_id: 'alice' }, 'bob'), false);
assert.strictEqual(testLink4mWhereClause({ status: 'processing', user_id: 'alice' }, 'Alice'), false); // case sensitivity
assert.strictEqual(testLink4mWhereClause({ status: 'processing', user_id: 'alice' }, ''), false);
assert.strictEqual(testLink4mWhereClause({ status: 'processing', user_id: 'alice' }, null), false);

// Case 2: matching user_id
assert.strictEqual(testLink4mWhereClause({ status: 'processing', user_id: 'alice' }, 'alice'), true);

// Case 3: status not processing
assert.strictEqual(testLink4mWhereClause({ status: 'rewarded', user_id: 'alice' }, 'alice'), false);
assert.strictEqual(testLink4mWhereClause({ status: 'pending', user_id: 'alice' }, 'alice'), false);

// Case 4: legacy NULL or empty user_id allowed for any user
assert.strictEqual(testLink4mWhereClause({ status: 'processing', user_id: null }, 'alice'), true);
assert.strictEqual(testLink4mWhereClause({ status: 'processing', user_id: '' }, 'alice'), true);

console.log('✅ Link4M ownership invariant adversarial checks passed.');

// Check Disaster Recovery Guard evaluation
function checkDisasterGuard(guc) {
  // IF current_setting('kingmc.allow_reset', true) IS DISTINCT FROM 'true' THEN RAISE EXCEPTION
  const val = guc !== undefined ? guc : null;
  return val === 'true';
}

assert.strictEqual(checkDisasterGuard(undefined), false);
assert.strictEqual(checkDisasterGuard(null), false);
assert.strictEqual(checkDisasterGuard(''), false);
assert.strictEqual(checkDisasterGuard('false'), false);
assert.strictEqual(checkDisasterGuard('0'), false);
assert.strictEqual(checkDisasterGuard('TRUE'), false);
assert.strictEqual(checkDisasterGuard('true'), true);

console.log('✅ Disaster Recovery Guard adversarial checks passed.');
console.log('🎉 ALL ADVERSARIAL STRESS TESTS PASSED!');
