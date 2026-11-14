'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const schemaSql = require('../src/storage/schema-sql');
const SupabaseWorkerStore = require('../src/storage/supabase-worker-store');

const resetSetupPath = path.join(__dirname, '../supabase/reset_and_setup.sql');
const setupPath = path.join(__dirname, '../supabase/setup.sql');
const reconcileMigrationPath = path.join(
  __dirname,
  '../supabase/migrations/20261112000000_reconcile_full_manager_schema.sql'
);

const sessionRevocationPath = path.join(
  __dirname,
  '../supabase/migrations/20261112120000_session_revocation_and_migration_guards.sql'
);

const resetSetupSql = fs.readFileSync(resetSetupPath, 'utf8');
const setupSql = fs.readFileSync(setupPath, 'utf8');
const reconcileMigrationSql = fs.readFileSync(reconcileMigrationPath, 'utf8');
const sessionRevocationSql = fs.readFileSync(sessionRevocationPath, 'utf8');
const combinedMigrationsSql = `${reconcileMigrationSql}\n${sessionRevocationSql}`;

const CANONICAL_SQL_SOURCES = [
  ['src/storage/schema-sql.js', schemaSql],
  ['supabase/reset_and_setup.sql', resetSetupSql],
  ['supabase/setup.sql', setupSql],
  ['supabase/migrations (reconciled chain)', combinedMigrationsSql]
];

function extractFunctionBlock(sql, fnName) {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}(`;
  const start = sql.indexOf(marker);
  assert.notStrictEqual(start, -1, `Expected function ${fnName} in SQL source`);
  const endGrant = sql.indexOf(`GRANT EXECUTE ON FUNCTION public.${fnName}`, start);
  assert.notStrictEqual(endGrant, -1, `Expected GRANT EXECUTE for ${fnName}`);
  const endSemi = sql.indexOf(';', endGrant);
  return sql.slice(start, endSemi + 1);
}

// ---------------------------------------------------------------------------
// G4-01: manager_reset_worker_data ROW_COUNT check & boolean return
// ---------------------------------------------------------------------------
async function testG401ResetWorkerData() {
  console.log('1. [G4-01] Testing manager_reset_worker_data ROW_COUNT check & boolean return...');

  // 1a. Verify across ALL 4 canonical SQL sources
  for (const [label, sqlText] of CANONICAL_SQL_SOURCES) {
    const fnBlock = extractFunctionBlock(sqlText, 'manager_reset_worker_data');

    assert.match(
      fnBlock,
      /RETURNS\s+boolean/i,
      `${label} manager_reset_worker_data must return boolean`
    );
    assert.match(
      fnBlock,
      /DECLARE\s+[\s\S]*?\bv_row_count\s+integer\s*:=\s*0;/i,
      `${label} manager_reset_worker_data must declare v_row_count integer := 0`
    );
    assert.match(
      fnBlock,
      /GET\s+DIAGNOSTICS\s+v_row_count\s*=\s*ROW_COUNT;/i,
      `${label} manager_reset_worker_data must capture ROW_COUNT into v_row_count`
    );
    assert.match(
      fnBlock,
      /RETURN\s+v_row_count\s*>\s*0;/i,
      `${label} manager_reset_worker_data must return v_row_count > 0`
    );
    assert.ok(
      !/RETURN\s+true\s*;/i.test(fnBlock),
      `${label} manager_reset_worker_data must NOT unconditionally return true`
    );
  }

  // 1b. Runtime behavior via SupabaseWorkerStore with simulated database RPC
  const dbWorkers = new Map([
    ['bot-01', { worker_id: 'bot-01', settings: { key: 'val' }, status: { state: 'running', online: true }, events: [{ e: 1 }], last_event: 'init' }]
  ]);

  // Simulate Postgres execution of manager_reset_worker_data
  function simulateResetWorkerDataRpc(p_worker_id) {
    let v_row_count = 0;
    if (dbWorkers.has(p_worker_id)) {
      const row = dbWorkers.get(p_worker_id);
      row.settings = {};
      row.status = { state: 'offline', online: false };
      row.events = [];
      row.last_event = null;
      row.updated_at = new Date().toISOString();
      v_row_count = 1;
    }
    return { data: v_row_count > 0, error: null };
  }

  const clientWithRpc = {
    rpc: async (fn, params) => {
      if (fn === 'manager_reset_worker_data') {
        return simulateResetWorkerDataRpc(params.p_worker_id);
      }
      return { data: null, error: { code: 'PGRST202', message: 'Function not found' } };
    },
    from: () => {
      throw new Error('Direct table operations must not be used when RPC succeeds');
    }
  };

  const store = new SupabaseWorkerStore(clientWithRpc);

  // Existing worker reset -> returns true, resetData succeeds
  await store.resetData('bot-01');
  const resetWorker = dbWorkers.get('bot-01');
  assert.deepStrictEqual(resetWorker.settings, {});
  assert.deepStrictEqual(resetWorker.status, { state: 'offline', online: false });
  assert.deepStrictEqual(resetWorker.events, []);
  assert.strictEqual(resetWorker.last_event, null);

  // Non-existent worker -> returns false, resetData throws error
  await assert.rejects(
    () => store.resetData('bot-nonexistent'),
    /Worker bot-nonexistent could not be reset or does not exist/
  );

  console.log('✅ 1. [G4-01] manager_reset_worker_data ROW_COUNT check & boolean return verified.');
}

// ---------------------------------------------------------------------------
// G4-02: reset_and_setup.sql Disaster Recovery Guard
// ---------------------------------------------------------------------------
async function testG402DisasterRecoveryGuard() {
  console.log('2. [G4-02] Testing reset_and_setup.sql Disaster Recovery Guard...');

  // 2a. Guard presence and location
  const dropBlockIndex = resetSetupSql.indexOf('FOR v_rel IN');
  assert.notStrictEqual(dropBlockIndex, -1, 'Expected table drop loop in reset_and_setup.sql');

  const guardIndex = resetSetupSql.indexOf('DISASTER RECOVERY GUARD');
  assert.notStrictEqual(guardIndex, -1, 'Expected DISASTER RECOVERY GUARD comment in reset_and_setup.sql');
  assert.ok(
    guardIndex < dropBlockIndex,
    'Disaster recovery guard must appear BEFORE the table drop loop in reset_and_setup.sql'
  );

  // 2b. Guard logic assertions
  assert.match(
    resetSetupSql,
    /current_setting\('kingmc\.allow_reset',\s*true\)\s+IS\s+DISTINCT\s+FROM\s+'true'/i,
    'Guard must check current_setting("kingmc.allow_reset", true) IS DISTINCT FROM "true"'
  );
  assert.match(
    resetSetupSql,
    /RAISE\s+EXCEPTION\s+'DISASTER RECOVERY GUARD: reset_and_setup\.sql will drop all manager and bot tables\./i,
    'Guard must raise standard DISASTER RECOVERY GUARD exception'
  );
  assert.match(
    resetSetupSql,
    /SET\s+kingmc\.allow_reset\s*=\s*''true'';/i,
    'Guard message must instruct user to SET kingmc.allow_reset = \'true\''
  );

  // 2c. Guard execution simulation
  function evaluateDisasterGuard(settingValue) {
    // Mimic PostgreSQL: current_setting('kingmc.allow_reset', true)
    const currentSetting = settingValue !== undefined ? String(settingValue) : null;
    if (currentSetting !== 'true') {
      throw new Error(
        'DISASTER RECOVERY GUARD: reset_and_setup.sql will drop all manager and bot tables. To proceed, execute "SET kingmc.allow_reset = \'true\';" before running this script.'
      );
    }
    return true;
  }

  // Without kingmc.allow_reset -> throws
  assert.throws(() => evaluateDisasterGuard(undefined), /DISASTER RECOVERY GUARD/);
  assert.throws(() => evaluateDisasterGuard(null), /DISASTER RECOVERY GUARD/);
  assert.throws(() => evaluateDisasterGuard('false'), /DISASTER RECOVERY GUARD/);
  assert.throws(() => evaluateDisasterGuard('yes'), /DISASTER RECOVERY GUARD/);

  // With kingmc.allow_reset = 'true' -> allows
  assert.strictEqual(evaluateDisasterGuard('true'), true);

  console.log('✅ 2. [G4-02] reset_and_setup.sql Disaster Recovery Guard verified.');
}

// ---------------------------------------------------------------------------
// G4-03: manager_complete_link4m_reward User Ownership Invariant
// ---------------------------------------------------------------------------
async function testG403Link4mOwnershipInvariant() {
  console.log('3. [G4-03] Testing manager_complete_link4m_reward user ownership invariant...');

  // 3a. Verify across ALL 4 canonical SQL sources
  for (const [label, sqlText] of CANONICAL_SQL_SOURCES) {
    const fnBlock = extractFunctionBlock(sqlText, 'manager_complete_link4m_reward');

    const updateBlockMatch = fnBlock.match(
      /UPDATE\s+public\.manager_link4m_attempts[\s\S]*?WHERE[\s\S]*?RETURNING/i
    );
    assert.ok(updateBlockMatch, `${label} must contain UPDATE public.manager_link4m_attempts`);

    const updateClause = updateBlockMatch[0];
    assert.match(
      updateClause,
      /\battempt_id\s*=\s*p_attempt_id\b/i,
      `${label} UPDATE manager_link4m_attempts must check attempt_id`
    );
    assert.match(
      updateClause,
      /\bstatus\s*=\s*'processing'/i,
      `${label} UPDATE manager_link4m_attempts must check status = 'processing'`
    );
    assert.match(
      updateClause,
      /\(\s*user_id\s+IS\s+NULL\s+OR\s+user_id\s*=\s*''\s+OR\s+user_id\s*=\s*p_user_id\s*\)/i,
      `${label} UPDATE manager_link4m_attempts must enforce (user_id IS NULL OR user_id = '' OR user_id = p_user_id)`
    );
  }

  // 3b. Simulate PostgreSQL execution of manager_complete_link4m_reward ownership guard
  const attempts = new Map([
    ['att_alice', { attempt_id: 'att_alice', user_id: 'usr_alice', status: 'processing' }],
    ['att_null_user', { attempt_id: 'att_null_user', user_id: null, status: 'processing' }],
    ['att_empty_user', { attempt_id: 'att_empty_user', user_id: '', status: 'processing' }],
    ['att_bob', { attempt_id: 'att_bob', user_id: 'usr_bob', status: 'processing' }]
  ]);

  function simulateCompleteReward(p_attempt_id, p_user_id) {
    const attempt = attempts.get(p_attempt_id);
    if (!attempt) {
      throw new Error('Phiên vượt link không ở trạng thái đang xử lý hoặc đã kết thúc.');
    }
    // WHERE attempt_id = p_attempt_id AND status = 'processing' AND (user_id IS NULL OR user_id = '' OR user_id = p_user_id)
    const matchesWhere =
      attempt.attempt_id === p_attempt_id &&
      attempt.status === 'processing' &&
      (attempt.user_id === null || attempt.user_id === '' || attempt.user_id === p_user_id);

    if (!matchesWhere) {
      throw new Error('Phiên vượt link không ở trạng thái đang xử lý hoặc đã kết thúc.');
    }

    attempt.status = 'rewarded';
    attempt.completed_at = new Date().toISOString();
    return attempt;
  }

  // 1. Legitimate owner alice completes att_alice -> OK
  const resAlice = simulateCompleteReward('att_alice', 'usr_alice');
  assert.strictEqual(resAlice.status, 'rewarded');

  // 2. Legacy / anonymous attempt with user_id = null -> alice can complete -> OK
  const resNull = simulateCompleteReward('att_null_user', 'usr_alice');
  assert.strictEqual(resNull.status, 'rewarded');

  // 3. Legacy / anonymous attempt with user_id = '' -> alice can complete -> OK
  const resEmpty = simulateCompleteReward('att_empty_user', 'usr_alice');
  assert.strictEqual(resEmpty.status, 'rewarded');

  // 4. Cross-tenant attempt hijack: alice attempts to complete bob's attempt -> REJECTED
  assert.throws(
    () => simulateCompleteReward('att_bob', 'usr_alice'),
    /Phiên vượt link không ở trạng thái đang xử lý hoặc đã kết thúc\./
  );
  // Ensure bob's attempt remains untouched
  assert.strictEqual(attempts.get('att_bob').status, 'processing');

  console.log('✅ 3. [G4-03] manager_complete_link4m_reward user ownership invariant verified.');
}

// ---------------------------------------------------------------------------
// G4-04: Database 4-Way Schema Parity Validation across Migrations & Setup
// ---------------------------------------------------------------------------
async function testG404SchemaParity() {
  console.log('4. [G4-04] Testing Database 4-way schema parity validation across migrations and setup scripts...');

  const extractSet = (text, regex) => new Set([...text.matchAll(regex)].map((m) => m[1].toLowerCase()));

  const expectedTableCount = 27;
  const expectedRpcCount = 52;
  const expectedViews = ['manager_audit', 'backups', 'system_settings', 'bot_schedules'];

  let refTables = null;
  let refFuncs = null;

  for (const [label, sqlText] of CANONICAL_SQL_SOURCES) {
    // Malformed DO block check
    assert.ok(
      !/^\s*DO\s+(?!\$\$|\$[a-z0-9_]*\$)(?:DECLARE|BEGIN)\b/im.test(sqlText),
      `${label} contains malformed DO block without $$`
    );

    // View declarations with security_invoker = true
    for (const viewName of expectedViews) {
      const viewRe = new RegExp(
        `CREATE\\s+(?:OR\\s+REPLACE\\s+)?VIEW\\s+public\\.${viewName}\\s+WITH\\s*\\(\\s*security_invoker\\s*=\\s*true\\s*\\)`,
        'i'
      );
      assert.match(
        sqlText,
        viewRe,
        `${label} must declare view ${viewName} with security_invoker = true`
      );
    }

    // Every function has SECURITY DEFINER and search_path = public, pg_temp
    const fnHeaders = [...sqlText.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-z0-9_]+)\s*\(([\s\S]*?)AS\s+\$/gi)];
    for (const match of fnHeaders) {
      assert.match(match[2], /\bSECURITY\s+DEFINER\b/i, `${label} ${match[1]} must be SECURITY DEFINER`);
      assert.match(match[2], /\bSET\s+search_path\s*=\s*public,\s*pg_temp\b/i, `${label} ${match[1]} must set search_path = public, pg_temp`);
    }

    const tables = extractSet(sqlText, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.([a-z0-9_]+)/gi);
    const funcs = extractSet(sqlText, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-z0-9_]+)\s*\(/gi);

    assert.strictEqual(tables.size, expectedTableCount, `${label} expected ${expectedTableCount} base tables, got ${tables.size}`);
    assert.strictEqual(funcs.size, expectedRpcCount, `${label} expected ${expectedRpcCount} unique function names, got ${funcs.size}`);

    if (!refTables) {
      refTables = tables;
      refFuncs = funcs;
    } else {
      assert.deepStrictEqual([...tables].sort(), [...refTables].sort(), `${label} table set diverges from canonical schema`);
      assert.deepStrictEqual([...funcs].sort(), [...refFuncs].sort(), `${label} function set diverges from canonical schema`);
    }
  }

  console.log('✅ 4. [G4-04] Database 4-way schema parity validation passed (27 tables, 52 RPCs, all SECURITY DEFINER & pinned search_path).');
}

(async () => {
  try {
    console.log('=== [GATE 4 DATABASE SCHEMA & SECURITY VERIFICATION (G4-01 to G4-04)] ===');
    await testG401ResetWorkerData();
    await testG402DisasterRecoveryGuard();
    await testG403Link4mOwnershipInvariant();
    await testG404SchemaParity();
    console.log('🎉 ALL GATE 4 DATABASE SCHEMA & SECURITY TESTS PASSED 100%!');
  } catch (err) {
    console.error('❌ GATE 4 TEST FAILED:', err);
    process.exit(1);
  }
})();
