'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const schemaSql = require('../src/storage/schema-sql');
const { SUPABASE_REQUIRED_TABLES } = require('../src/storage/supabase-client');
const SupabaseDashboardStore = require('../src/storage/supabase-dashboard-store');
const SupabaseCommandStore = require('../src/storage/supabase-command-store');
const SupabaseWorkerStore = require('../src/storage/supabase-worker-store');
const { EntitlementService } = require('../src/services/entitlement-service');

function extractFunctionBlock(sql, fnName) {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}(`;
  const start = sql.indexOf(marker);
  assert.notStrictEqual(start, -1, `Expected function ${fnName} in schema-sql.js`);
  const endGrant = sql.indexOf(`GRANT EXECUTE ON FUNCTION public.${fnName}`, start);
  assert.notStrictEqual(endGrant, -1, `Expected GRANT EXECUTE for ${fnName}`);
  const endSemi = sql.indexOf(';', endGrant);
  return sql.slice(start, endSemi + 1);
}

function extractTableDdlBlock(sql, tableName) {
  const marker = `CREATE TABLE IF NOT EXISTS public.${tableName}`;
  const start = sql.indexOf(marker);
  assert.notStrictEqual(start, -1, `Expected table ${tableName} in schema-sql.js`);
  const nextTable = sql.indexOf('CREATE TABLE IF NOT EXISTS public.', start + marker.length);
  const nextFunc = sql.indexOf('CREATE OR REPLACE FUNCTION public.', start + marker.length);
  let end = sql.length;
  if (nextTable !== -1) end = Math.min(end, nextTable);
  if (nextFunc !== -1) end = Math.min(end, nextFunc);
  return sql.slice(start, end);
}

function assertColumnsDeclared(sql, tableName, columns) {
  const createStart = sql.indexOf(`CREATE TABLE IF NOT EXISTS public.${tableName}`);
  assert.notStrictEqual(createStart, -1, `Table ${tableName} not created`);
  // Search entire DDL up to first RPC/COMMIT or matching ALTER/CREATE TABLE blocks
  const block = extractTableDdlBlock(sql, tableName);
  const fullSqlAfterCreate = sql.slice(createStart);
  for (const col of columns) {
    const colRegex = new RegExp(`(?:^|\\n)\\s*${col}\\s+(?:text|jsonb|boolean|integer|bigint|timestamptz|uuid)|ADD COLUMN IF NOT EXISTS\\s+${col}\\s+`, 'im');
    assert.ok(
      colRegex.test(block) || colRegex.test(fullSqlAfterCreate),
      `Missing column "${col}" on public.${tableName}`
    );
  }
}

async function testSqlSchemaStructure() {
  console.log('1. Checking SQL DDL ordering, tables, columns & RPC definitions...');
  assert.strictEqual(typeof schemaSql, 'string', 'schema-sql.js must export SQL string');

  // 1a. Verify DDL statement ordering: no ALTER TABLE or CREATE INDEX before CREATE TABLE
  const lines = schemaSql.split('\n');
  const createdTables = new Set();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const ctMatch = line.match(/^CREATE TABLE IF NOT EXISTS\s+public\.([a-z0-9_]+)/i);
    if (ctMatch) createdTables.add(ctMatch[1].toLowerCase());

    const altMatch = line.match(/^ALTER TABLE(?:\s+IF EXISTS)?\s+public\.([a-z0-9_]+)/i);
    if (altMatch) {
      assert.ok(
        createdTables.has(altMatch[1].toLowerCase()),
        `Line ${i + 1}: ALTER TABLE public.${altMatch[1]} appears BEFORE CREATE TABLE`
      );
    }

    const idxMatch = line.match(/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF NOT EXISTS\s+)?[a-z0-9_]+\s+ON\s+public\.([a-z0-9_]+)/i);
    if (idxMatch) {
      assert.ok(
        createdTables.has(idxMatch[1].toLowerCase()),
        `Line ${i + 1}: CREATE INDEX ON public.${idxMatch[1]} appears BEFORE CREATE TABLE`
      );
    }
  }

  // 1b. manager_keys code_hash and index strictly follow CREATE TABLE public.manager_keys
  const createKeysIdx = schemaSql.indexOf('CREATE TABLE IF NOT EXISTS public.manager_keys');
  const alterCodeHashIdx = schemaSql.indexOf('ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS code_hash');
  const indexCodeHashIdx = schemaSql.indexOf('idx_manager_keys_code_hash ON public.manager_keys');
  assert.ok(createKeysIdx !== -1 && alterCodeHashIdx > createKeysIdx && indexCodeHashIdx > createKeysIdx,
    'manager_keys.code_hash ALTER and idx_manager_keys_code_hash must come after CREATE TABLE public.manager_keys'
  );

  // 1c. manager_settings exists with RLS and service_role grant
  const settingsBlock = extractTableDdlBlock(schemaSql, 'manager_settings');
  assert.match(settingsBlock, /key text PRIMARY KEY/i);
  assert.match(settingsBlock, /value jsonb/i);
  assert.match(settingsBlock, /updated_at timestamptz/i);
  assert.match(settingsBlock, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(settingsBlock, /GRANT ALL ON (?:TABLE )?public\.manager_settings TO service_role/i);

  // 1d. manager_assignments exists with expected columns + RLS + service_role grant
  assertColumnsDeclared(schemaSql, 'manager_assignments', [
    'worker_id', 'user_id', 'assigned_by', 'assigned_at'
  ]);

  // 1e. manager_keys declares every column needed by KEY_FIELDS & RPCs
  assertColumnsDeclared(schemaSql, 'manager_keys', [
    'id', 'key_id', 'key', 'code', 'key_code', 'code_hash', 'code_suffix',
    'status', 'days', 'duration_days', 'duration_ms', 'is_permanent',
    'bot_count', 'bot_ids', 'assigned_bot_ids', 'worker_ids', 'plan_name',
    'max_uses', 'used', 'used_count', 'used_users', 'used_by', 'used_at',
    'expires_at', 'created_by', 'created_at', 'last_used_at', 'last_used_by', 'updated_at'
  ]);

  // 1f. manager_link4m_attempts declares every column used by BOTH supabase-client.js AND SupabaseDashboardStore
  assertColumnsDeclared(schemaSql, 'manager_link4m_attempts', [
    'attempt_id', 'username', 'user_id', 'token_hash', 'status',
    'vietnam_date', 'daily_date', 'created_at', 'expires_at',
    'verified_at', 'rewarded_at', 'completed_at', 'processing_at',
    'purge_at', 'updated_at', 'reward_hours', 'ip_address',
    'provider_reference', 'provider_short_url', 'provider_url',
    'failure_reason', 'sync_status'
  ]);

  // 1g. Verify manager_redeem_code_with_access fixes
  const redeemFn = extractFunctionBlock(schemaSql, 'manager_redeem_code_with_access');
  assert.ok(!redeemFn.includes('jsonb_typeof(used_by)'), 'manager_redeem_code_with_access must NOT call jsonb_typeof(used_by)');
  assert.ok(redeemFn.includes("COALESCE(v_key.used_users, '[]'::jsonb) ? v_clean_user"), 'Must check per-user duplicate using used_users jsonb');
  assert.match(redeemFn, /used_users\s*=/);
  assert.match(redeemFn, /used_by\s*=\s*CASE/i);
  assert.match(redeemFn, /used_at\s*=\s*v_now/);
  assert.match(redeemFn, /last_used_at\s*=\s*v_now/);
  assert.match(redeemFn, /last_used_by\s*=\s*v_clean_user/);
  assert.match(redeemFn, /updated_at\s*=\s*v_now/);
  assert.ok(!/(?<!COALESCE\()array_length\(p_worker_ids,\s*1\)/i.test(redeemFn), 'All array_length(p_worker_ids, 1) calls must be COALESCE-guarded');
  assert.match(redeemFn, /WHERE id = p_user_id[\s\S]*lower\(username\) = v_clean_user/i, 'Must look up manager_users by id OR username');

  // 1h. Verify manager_set_user_access id/username lookup & COALESCE array_length
  const setAccessFn = extractFunctionBlock(schemaSql, 'manager_set_user_access');
  assert.match(setAccessFn, /WHERE id = p_user_id[\s\S]*lower\(username\) = v_clean_user/i, 'manager_set_user_access must look up by id OR username');
  assert.ok(!/(?<!COALESCE\()array_length\(p_worker_ids,\s*1\)/i.test(setAccessFn), 'manager_set_user_access must guard array_length with COALESCE');

  // 1i. Verify manager_claim_link4m_attempt
  const claimFn = extractFunctionBlock(schemaSql, 'manager_claim_link4m_attempt');
  assert.match(claimFn, /status = 'pending'/);
  assert.match(claimFn, /expires_at > v_now/);
  assert.match(claimFn, /\(p_token_hash IS NULL OR token_hash = p_token_hash\)/);
  assert.match(claimFn, /processing_at = v_now/);
  assert.match(claimFn, /updated_at = v_now/);
  const claimSetClause = (claimFn.match(/\bSET\b([\s\S]*?)\bWHERE\b/i) || [])[1] || '';
  assert.ok(claimSetClause.length > 0 && !/\btoken_hash\s*=/i.test(claimSetClause), 'manager_claim_link4m_attempt must NOT overwrite token_hash in SET clause');

  // 1j. Verify manager_complete_link4m_reward
  const completeFn = extractFunctionBlock(schemaSql, 'manager_complete_link4m_reward');
  assert.ok(completeFn.includes("status = 'rewarded'"), "manager_complete_link4m_reward MUST set status = 'rewarded'");
  assert.ok(!completeFn.includes("status = 'completed'"), "manager_complete_link4m_reward must NOT set status = 'completed'");
  assert.match(completeFn, /rewarded_at = v_now/);
  assert.match(completeFn, /completed_at = v_now/);
  assert.match(completeFn, /verified_at = COALESCE\(verified_at,\s*v_now\)/);
  assert.match(completeFn, /updated_at = v_now/);
  assert.match(completeFn, /WHERE id = p_user_id[\s\S]*lower\(username\) = v_clean_user/i, 'Must resolve manager_users by id OR username');
  assert.match(completeFn, /assigned_bot_ids\s*=/);
  assert.match(completeFn, /INSERT INTO public\.manager_assignments/);
  const fs = require('node:fs');
  const path = require('node:path');
  const storeSrc = fs.readFileSync(path.join(__dirname, '../src/storage/supabase-dashboard-store.js'), 'utf8');
  assert.ok(!storeSrc.includes('manager_worker_assignments'), 'SupabaseDashboardStore must NOT reference nonexistent manager_worker_assignments');

  const completeAssignMatch = completeFn.match(/INSERT INTO public\.manager_assignments[\s\S]*?;/i);
  assert.ok(completeAssignMatch && !/ON CONFLICT/i.test(completeAssignMatch[0]), 'manager_assignments insert in complete_link4m_reward must propagate 23505 on conflict');

  const redeemAssignMatch = redeemFn.match(/INSERT INTO public\.manager_assignments[\s\S]*?;/i);
  assert.ok(redeemAssignMatch && !/ON CONFLICT/i.test(redeemAssignMatch[0]), 'manager_assignments insert in redeem_code_with_access must propagate 23505 on conflict');

  const trialFn = extractFunctionBlock(schemaSql, 'manager_register_trial_user');
  const trialAssignMatch = trialFn.match(/INSERT INTO public\.manager_assignments[\s\S]*?;/i);
  assert.ok(trialAssignMatch && !/ON CONFLICT/i.test(trialAssignMatch[0]), 'manager_assignments insert in manager_register_trial_user must not silently overwrite');

  // 1k. Verify two-phase command execution & state sync RPCs (schema-sql.js + supabase/migrations)
  assert.ok(schemaSql.includes('idx_manager_commands_status_created'), 'Expected idx_manager_commands_status_created index');
  assert.ok(schemaSql.includes('idx_manager_commands_state_sync'), 'Expected idx_manager_commands_state_sync partial index');
  const recExecFn = extractFunctionBlock(schemaSql, 'manager_record_command_execution');
  assert.match(recExecFn, /status = 'execution_completed'/);
  assert.match(recExecFn, /completed_at = NULL/);
  assert.match(recExecFn, /fencingToken/);
  assert.match(recExecFn, /FOR UPDATE/);
  const renewLeaseFn = extractFunctionBlock(schemaSql, 'manager_renew_command_sync_lease');
  assert.match(renewLeaseFn, /FOR UPDATE/);
  assert.match(renewLeaseFn, /lease_owner_mismatch/);
  assert.match(renewLeaseFn, /fencing_token_mismatch/);
  assert.match(renewLeaseFn, /lease_expired/);
  const verifyLeaseFn = extractFunctionBlock(schemaSql, 'manager_verify_command_sync_lease');
  assert.match(verifyLeaseFn, /'held', true/);
  assert.match(verifyLeaseFn, /lease_owner_mismatch/);
  assert.match(verifyLeaseFn, /fencing_token_mismatch/);
  assert.match(verifyLeaseFn, /lease_expired/);
  const markSyncFn = extractFunctionBlock(schemaSql, 'manager_mark_command_sync_pending');
  assert.match(markSyncFn, /'state_sync_failed'/);
  assert.match(markSyncFn, /'state_sync_pending'/);
  assert.match(markSyncFn, /p_fencing_token/);
  assert.match(markSyncFn, /completed_at = NULL/);
  const finSyncFn = extractFunctionBlock(schemaSql, 'manager_finalize_command_sync');
  assert.match(finSyncFn, /status = 'completed'/);
  assert.match(finSyncFn, /- '_stateSync'/);
  assert.match(finSyncFn, /p_fencing_token/);
  assert.match(finSyncFn, /completed_at = v_now/);
  const claimSyncFn = extractFunctionBlock(schemaSql, 'manager_claim_pending_command_syncs');
  assert.match(claimSyncFn, /FOR UPDATE OF c SKIP LOCKED/);
  assert.match(claimSyncFn, /'state_sync_pending', 'execution_completed'/);
  assert.match(claimSyncFn, /fencingToken/);

  // 1l. Verify supabase/migrations/20261111120000_command_two_phase_sync.sql aligns with live manager_commands schema
  const migrationPath = path.join(__dirname, '../supabase/migrations/20261111120000_command_two_phase_sync.sql');
  assert.ok(fs.existsSync(migrationPath), 'Expected supabase/migrations/20261111120000_command_two_phase_sync.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(migrationSql, /alter\s+column\s+command_id\s+type\s+text\s+using\s+command_id::text/i);
  assert.match(migrationSql, /manager_commands_action_check/i);
  assert.match(migrationSql, /manager_commands_status_check/i);
  assert.match(migrationSql, /'execution_completed'/);
  assert.match(migrationSql, /'state_sync_pending'/);
  assert.match(migrationSql, /'state_sync_failed'/);
  assert.match(migrationSql, /notify\s+pgrst,\s*'reload schema'/i);
  const { ACTIONS } = require('../src/services/worker-registry');
  for (const act of ACTIONS) {
    assert.ok(migrationSql.includes(`'${act}'`), `Migration 20261111120000 action check must allow '${act}'`);
  }
  for (const rpcName of [
    'manager_enqueue_worker_command',
    'manager_complete_worker_command',
    'manager_expire_worker_command',
    'manager_record_command_execution',
    'manager_renew_command_sync_lease',
    'manager_verify_command_sync_lease',
    'manager_mark_command_sync_pending',
    'manager_finalize_command_sync',
    'manager_claim_pending_command_syncs'
  ]) {
    assert.ok(migrationSql.includes(`function public.${rpcName}(`), `Expected ${rpcName} in migration SQL`);
    assert.match(migrationSql, new RegExp(`grant execute on function public\\.${rpcName}\\([^)]*\\) to service_role`, 'i'));
    assert.match(migrationSql, new RegExp(`revoke all on function public\\.${rpcName}\\([^)]*\\) from public, anon, authenticated`, 'i'));
  }
  assert.ok(migrationSql.includes("'20261111120000_command_two_phase_sync'"), 'Migration must record version in manager_schema_migrations');

  // 1m. Verify supabase/reset_and_setup.sql covers clean drop + full canonical schema
  const resetSetupPath = path.join(__dirname, '../supabase/reset_and_setup.sql');
  assert.ok(fs.existsSync(resetSetupPath), 'Expected supabase/reset_and_setup.sql');
  const resetSetupSql = fs.readFileSync(resetSetupPath, 'utf8');
  assert.match(resetSetupSql, /n\.nspname = 'public'/);
  assert.match(resetSetupSql, /p\.prokind = 'f'/);
  assert.match(resetSetupSql, /NOT EXISTS\s*\(\s*SELECT 1 FROM pg_depend/i);
  assert.match(resetSetupSql, /'manager_access'/);
  assert.match(resetSetupSql, /'manager_worker_assignments'/);
  assert.match(resetSetupSql, /'manager_audit'/);
  assert.match(resetSetupSql, /CREATE TABLE IF NOT EXISTS public\.manager_users/);
  assert.match(resetSetupSql, /CREATE OR REPLACE VIEW public\.manager_audit/);
  assert.match(resetSetupSql, /CREATE OR REPLACE FUNCTION public\.manager_claim_pending_command_syncs/);
  assert.match(resetSetupSql, /NOTIFY pgrst,\s*'reload schema'/i);

  // 1n. Enforce text (cmd_<UUID>) command_id contract across ALL SQL sources (migrations, setup.sql, reset_and_setup.sql, schema-sql.js)
  const mig20261108Sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261108000000_durable_worker_commands.sql'), 'utf8');
  const mig2026111100Sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261111000000_worker_reset_data.sql'), 'utf8');
  const setupSql = fs.readFileSync(path.join(__dirname, '../supabase/setup.sql'), 'utf8');
  const allCommandSqlFiles = [
    ['src/storage/schema-sql.js', schemaSql],
    ['supabase/migrations/20261108000000_durable_worker_commands.sql', mig20261108Sql],
    ['supabase/migrations/20261111000000_worker_reset_data.sql', mig2026111100Sql],
    ['supabase/migrations/20261111120000_command_two_phase_sync.sql', migrationSql],
    ['supabase/setup.sql', setupSql],
    ['supabase/reset_and_setup.sql', resetSetupSql]
  ];
  const commandIdRpcs = [
    'manager_enqueue_worker_command',
    'manager_complete_worker_command',
    'manager_expire_worker_command',
    'manager_record_command_execution',
    'manager_renew_command_sync_lease',
    'manager_verify_command_sync_lease',
    'manager_mark_command_sync_pending',
    'manager_finalize_command_sync'
  ];
  for (const [label, sqlText] of allCommandSqlFiles) {
    assert.ok(!/\bcommand_id\s+uuid\b/i.test(sqlText), `${label} must NOT declare command_id as uuid`);
    assert.ok(!/\bp_command_id\s+uuid\b/i.test(sqlText), `${label} must NOT declare p_command_id as uuid`);
    for (const line of sqlText.split(/\r?\n/)) {
      if (/^(?:REVOKE|GRANT)\b.*\bFUNCTION\b/i.test(line.trim()) && /manager_(?:enqueue|complete|expire|record|renew|verify|mark|finalize).*command/i.test(line)) {
        assert.ok(!/\buuid\b/i.test(line), `${label} REVOKE/GRANT signature must use text instead of uuid: ${line.trim()}`);
      }
    }
    if (!label.includes('20261111')) {
      assert.match(sqlText, /\bcommand_id\s+text\s+primary\s+key\b/i, `${label} must declare manager_commands.command_id as text primary key`);
    } else if (label.includes('20261111120000')) {
      assert.match(sqlText, /\balter\s+column\s+command_id\s+type\s+text\b/i, `${label} must convert command_id column to text`);
    }
    const expectedRpcsForFile = label === 'supabase/migrations/20261111000000_worker_reset_data.sql'
      ? ['manager_complete_worker_command']
      : (label === 'supabase/migrations/20261108000000_durable_worker_commands.sql'
        ? ['manager_enqueue_worker_command', 'manager_complete_worker_command', 'manager_expire_worker_command']
        : commandIdRpcs);
    for (const fnName of expectedRpcsForFile) {
      const fnMatches = [...sqlText.matchAll(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fnName}\\s*\\(([\\s\\S]*?)\\)\\s*RETURNS\\b`, 'gi'))];
      assert.ok(fnMatches.length >= 1, `${label} missing CREATE FUNCTION for ${fnName}`);
      for (const m of fnMatches) {
        assert.match(m[1], /\bp_command_id\s+text\b/i, `${label} ${fnName} parameter p_command_id must be text`);
      }
    }
  }
  assert.match(migrationSql, /drop function if exists public\.manager_record_command_execution\(text,\s*uuid,/i);
  assert.match(migrationSql, /drop function if exists public\.manager_renew_command_sync_lease\(text,\s*uuid,/i);
  assert.match(migrationSql, /drop function if exists public\.manager_verify_command_sync_lease\(text,\s*uuid,/i);
  assert.match(migrationSql, /drop function if exists public\.manager_mark_command_sync_pending\(text,\s*uuid,/i);
  assert.match(migrationSql, /drop function if exists public\.manager_finalize_command_sync\(text,\s*uuid,/i);
  assert.match(migrationSql, /drop function if exists public\.manager_enqueue_worker_command\(uuid,/i);
  assert.match(migrationSql, /drop function if exists public\.manager_complete_worker_command\(text,\s*uuid,/i);
  assert.match(migrationSql, /drop function if exists public\.manager_expire_worker_command\(uuid\)/i);

  console.log('✅ 1. SQL DDL & RPC structural validation passed.');
}

function createTableBuilder(rowsFn, handlers = {}) {
  const filters = {};
  let orFilter = null;
  let inFilter = null;
  let orderCol = null;
  let action = 'select';
  let payload = null;

  const matches = (row) => {
    for (const [k, v] of Object.entries(filters)) {
      if (row[k] !== v) return false;
    }
    if (inFilter) {
      if (!inFilter.values.includes(row[inFilter.col])) return false;
    }
    if (orFilter) {
      const parts = orFilter.split(',');
      const any = parts.some((p) => {
        const m = p.match(/^([^.]+)\.eq\.(.+)$/);
        return m ? String(row[m[1]]) === String(m[2]) : false;
      });
      if (!any) return false;
    }
    if (builder._extraFilter && !builder._extraFilter(row)) return false;
    return true;
  };

  const execute = async () => {
    if (action === 'select') {
      if (handlers.onSelect) return handlers.onSelect({ filters, orFilter, inFilter });
      let list = rowsFn().filter(matches);
      if (orderCol) list = [...list].sort((a, b) => (a[orderCol] > b[orderCol] ? 1 : -1));
      return { data: list.map((r) => ({ ...r })), error: null, count: list.length };
    }
    if (action === 'insert') {
      if (handlers.onInsert) return handlers.onInsert(payload);
      return { data: [payload], error: null };
    }
    if (action === 'upsert') {
      if (handlers.onUpsert) return handlers.onUpsert(payload);
      return { data: [payload], error: null };
    }
    if (action === 'update') {
      if (handlers.onUpdate) return handlers.onUpdate(payload, { filters, orFilter });
      const list = rowsFn().filter(matches);
      list.forEach((r) => Object.assign(r, payload));
      return { data: list.map((r) => ({ ...r })), error: null };
    }
    if (action === 'delete') {
      if (handlers.onDelete) return handlers.onDelete({ filters, orFilter, inFilter });
      const rows = rowsFn();
      const removed = [];
      for (let i = rows.length - 1; i >= 0; i--) {
        if (matches(rows[i])) {
          removed.push(rows[i]);
          rows.splice(i, 1);
        }
      }
      return { data: removed, error: null };
    }
    return { data: null, error: null };
  };

  const builder = {
    select: () => builder,
    insert: (p) => { action = 'insert'; payload = p; return builder; },
    upsert: (p) => { action = 'upsert'; payload = p; return builder; },
    update: (p) => { action = 'update'; payload = p; return builder; },
    delete: () => { action = 'delete'; return builder; },
    eq: (col, val) => { filters[col] = val; return builder; },
    in: (col, vals) => { inFilter = { col, values: vals }; return builder; },
    or: (expr) => { orFilter = expr; return builder; },
    contains: (col, arr) => {
      const prevMatches = builder._extraFilter;
      builder._extraFilter = (r) => (prevMatches ? prevMatches(r) : true) && Array.isArray(r[col]) && arr.every((x) => r[col].includes(x));
      return builder;
    },
    order: (col) => { orderCol = col; return builder; },
    limit: () => builder,
    not: (col, op, val) => {
      if (String(op).toLowerCase() === 'in') {
        const inner = String(val || '').replace(/^\(|\)$/g, '');
        const excluded = inner.split(',').map((s) => s.trim().replace(/^"(.*)"$/, '$1'));
        const prevMatches = builder._extraFilter;
        builder._extraFilter = (r) => (prevMatches ? prevMatches(r) : true) && !excluded.includes(String(r[col]));
      }
      return builder;
    },
    gt: (col, val) => {
      const prevMatches = builder._extraFilter;
      builder._extraFilter = (r) => (prevMatches ? prevMatches(r) : true) && r[col] > val;
      return builder;
    },
    gte: (col, val) => {
      const prevMatches = builder._extraFilter;
      builder._extraFilter = (r) => (prevMatches ? prevMatches(r) : true) && r[col] >= val;
      return builder;
    },
    lt: (col, val) => {
      const prevMatches = builder._extraFilter;
      builder._extraFilter = (r) => (prevMatches ? prevMatches(r) : true) && r[col] < val;
      return builder;
    },
    lte: (col, val) => {
      const prevMatches = builder._extraFilter;
      builder._extraFilter = (r) => (prevMatches ? prevMatches(r) : true) && r[col] <= val;
      return builder;
    },
    neq: (col, val) => {
      const prevMatches = builder._extraFilter;
      builder._extraFilter = (r) => (prevMatches ? prevMatches(r) : true) && r[col] !== val;
      return builder;
    },
    maybeSingle: async () => {
      const res = await execute();
      if (res.error) return { data: null, error: res.error };
      const first = Array.isArray(res.data) ? (res.data[0] || null) : (res.data || null);
      return { data: first, error: null };
    },
    then: (resolve, reject) => execute().then(resolve, reject)
  };
  return builder;
}

async function testTrialFallbackConcurrencyAndErrors() {
  console.log('2. Checking Trial Fallback concurrency serialization, RPC errors & 23505 rollback...');

  // 2a. Concurrent fallback without .rpc allocates distinct workers in manager_assignments, 3rd gets NO_WORKERS_AVAILABLE
  const workers = [
    { worker_id: 'bot-01', bot_number: 1, enabled: true },
    { worker_id: 'bot-02', bot_number: 2, enabled: true }
  ];
  const users = [];
  const assignments = [];
  let sawLegacyTable = false;

  const clientNoRpc = {
    from: (table) => {
      if (table === 'manager_worker_assignments') sawLegacyTable = true;
      if (table === 'manager_workers') return createTableBuilder(() => workers);
      if (table === 'manager_users') {
        return createTableBuilder(() => users, {
          onUpsert: async (row) => {
            await new Promise((r) => setTimeout(r, 15));
            const idx = users.findIndex((u) => u.username === row.username);
            if (idx >= 0) users[idx] = { ...users[idx], ...row };
            else users.push({ ...row });
            return { data: [row], error: null };
          }
        });
      }
      if (table === 'manager_assignments') {
        return createTableBuilder(() => assignments, {
          onInsert: async (row) => {
            await new Promise((r) => setTimeout(r, 15));
            if (assignments.some((a) => a.worker_id === row.worker_id)) {
              return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
            }
            assignments.push({ ...row });
            return { data: [row], error: null };
          }
        });
      }
      return createTableBuilder(() => []);
    }
  };

  const storeNoRpc = new SupabaseDashboardStore(clientNoRpc);
  const [r1, r2] = await Promise.all([
    storeNoRpc.registerTrialUser({ userId: 'usr_a1', username: 'alice', password: 'secret123', trialDays: 1 }),
    storeNoRpc.registerTrialUser({ userId: 'usr_b2', username: 'bob', password: 'secret123', trialDays: 1 })
  ]);

  assert.strictEqual(sawLegacyTable, false, 'Must NEVER query nonexistent manager_worker_assignments');
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(new Set([r1.workerId, r2.workerId]).size, 2, 'Concurrent fallback must assign distinct workers');
  assert.strictEqual(assignments.length, 2, 'manager_assignments must hold both allocations');

  await assert.rejects(
    () => storeNoRpc.registerTrialUser({ userId: 'usr_c3', username: 'charlie', password: 'secret123' }),
    /NO_WORKERS_AVAILABLE/
  );

  // Verify usr_<hex> session ID & username cross-lookup via getAccess + assignedWorkerIds
  const aliceById = await storeNoRpc.getAccess('usr_a1');
  const aliceByName = await storeNoRpc.getAccess('alice');
  assert.ok(aliceById && aliceByName);
  assert.strictEqual(aliceById.username, 'alice');
  assert.deepStrictEqual(aliceById.workerIds, [r1.workerId]);
  assert.deepStrictEqual(await storeNoRpc.assignedWorkerIds('usr_a1'), [r1.workerId]);
  assert.deepStrictEqual(await storeNoRpc.assignedWorkerIds('alice'), [r1.workerId]);

  // 2b. Real RPC error (non-missing-RPC) propagates instead of dropping into fallback
  let touchedFallbackTables = false;
  const rpcErrorClient = {
    rpc: async () => ({ data: null, error: { code: '42501', status: 500, message: 'Database connection failure' } }),
    from: () => {
      touchedFallbackTables = true;
      return createTableBuilder(() => []);
    }
  };
  const rpcErrorStore = new SupabaseDashboardStore(rpcErrorClient);
  await assert.rejects(
    () => rpcErrorStore.registerTrialUser({ userId: 'usr_err', username: 'erruser', password: 'secret123' }),
    /Database connection failure/
  );
  assert.strictEqual(touchedFallbackTables, false, 'Must NOT enter fallback when RPC fails with real DB error');

  // 2c. Missing RPC falls back, and 23505 assignment conflict rolls back user creation cleanly
  const usersRollback = [];
  const conflictClient = {
    rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.manager_register_trial_user' } }),
    from: (table) => {
      if (table === 'manager_workers') {
        return createTableBuilder(() => [{ worker_id: 'bot-01', bot_number: 1, enabled: true }]);
      }
      if (table === 'manager_users') {
        return createTableBuilder(() => usersRollback, {
          onUpsert: async (row) => {
            usersRollback.push({ ...row });
            return { data: [row], error: null };
          }
        });
      }
      if (table === 'manager_assignments') {
        return createTableBuilder(() => [], {
          onInsert: async () => ({ data: null, error: { code: '23505', message: 'duplicate key value' } })
        });
      }
      return createTableBuilder(() => []);
    }
  };
  const conflictStore = new SupabaseDashboardStore(conflictClient);
  await assert.rejects(
    () => conflictStore.registerTrialUser({ userId: 'usr_race', username: 'racer', password: 'secret123' }),
    /NO_WORKERS_AVAILABLE/
  );
  assert.strictEqual(usersRollback.length, 0, 'Created user MUST be rolled back when manager_assignments.insert hits 23505');

  // 2d. Non-23505 assignment insert error also rolls back user and propagates exact error
  const usersPermRollback = [];
  const assignPermErrClient = {
    from: (table) => {
      if (table === 'manager_workers') {
        return createTableBuilder(() => [{ worker_id: 'bot-01', bot_number: 1, enabled: true }]);
      }
      if (table === 'manager_users') {
        return createTableBuilder(() => usersPermRollback, {
          onUpsert: async (row) => {
            usersPermRollback.push({ ...row });
            return { data: [row], error: null };
          }
        });
      }
      if (table === 'manager_assignments') {
        return createTableBuilder(() => [], {
          onInsert: async () => ({ data: null, error: { code: '42501', message: 'permission denied for manager_assignments' } })
        });
      }
      return createTableBuilder(() => []);
    }
  };
  const assignPermStore = new SupabaseDashboardStore(assignPermErrClient);
  await assert.rejects(
    () => assignPermStore.registerTrialUser({ userId: 'usr_perm', username: 'permuser', password: 'secret123' }),
    /permission denied for manager_assignments/
  );
  assert.strictEqual(usersPermRollback.length, 0, 'Created user MUST be rolled back when manager_assignments.insert fails');

  // 2e. When worker 1 hits 23505 conflict and worker 2 is free, fallback rolls back worker 1 attempt and allocates worker 2
  const retryUsers = [];
  const retryAssignments = [{ worker_id: 'bot-01', user_id: 'other_user', _raceOnly: true }];
  let removedIds = [];
  const retryClient = {
    from: (table) => {
      if (table === 'manager_workers') {
        return createTableBuilder(() => [
          { worker_id: 'bot-01', bot_number: 1, enabled: true },
          { worker_id: 'bot-02', bot_number: 2, enabled: true }
        ]);
      }
      if (table === 'manager_users') {
        return createTableBuilder(() => retryUsers, {
          onUpsert: async (row) => {
            retryUsers.push({ ...row });
            return { data: [row], error: null };
          },
          onDelete: async ({ orFilter, filters }) => {
            const target = filters.id || orFilter;
            removedIds.push(target);
            retryUsers.length = 0;
            return { data: [], error: null };
          }
        });
      }
      if (table === 'manager_assignments') {
        return createTableBuilder(() => retryAssignments.filter((a) => !a._raceOnly), {
          onInsert: async (row) => {
            if (row.worker_id === 'bot-01') {
              return { data: null, error: { code: '23505', message: 'duplicate key value' } };
            }
            retryAssignments.push({ ...row });
            return { data: [row], error: null };
          }
        });
      }
      return createTableBuilder(() => []);
    }
  };
  const retryStore = new SupabaseDashboardStore(retryClient);
  const { encryptUserPassword } = require('../src/utils/secrets');
  const preCipher = encryptUserPassword('my-raw-pass');
  const retryRes = await retryStore.registerTrialUser({
    userId: 'usr_retry',
    username: 'retryuser',
    password: preCipher,
    trialDays: 1
  });
  assert.strictEqual(retryRes.workerId, 'bot-02', 'Must retry and allocate bot-02 after bot-01 hit 23505');
  assert.ok(removedIds.length >= 1, 'Must roll back user before retrying next worker');
  assert.strictEqual(retryUsers[0].password, preCipher, 'Must preserve already-encrypted password ciphertext without double-encryption');

  console.log('✅ 2. Trial fallback concurrency, RPC fail-closed & 23505 rollback passed.');
}

async function testDiscordLinkingFailClosedAndConflicts() {
  console.log('3. Checking Discord link/unlink conflict & permission failure handling...');

  // 3a. RPC returns 1:1 conflict -> throws immediately without touching fallback tables
  let touchedFallback = false;
  const conflictRpcStore = new SupabaseDashboardStore({
    rpc: async () => ({
      data: null,
      error: { code: 'P0001', message: 'Tài khoản Discord này đã được liên kết với một tài khoản Web khác.' }
    }),
    from: () => {
      touchedFallback = true;
      return createTableBuilder(() => []);
    }
  });
  await assert.rejects(
    () => conflictRpcStore.linkDiscord('999999999999999999', 'alice'),
    /đã được liên kết/
  );
  assert.strictEqual(touchedFallback, false, 'RPC conflict error must NOT silently fall back');

  // 3b. All fallback writes fail with 42501 permission denied -> BOTH linkDiscord & unlinkDiscord must throw
  const permErrorClient = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: { code: '42501', message: 'permission denied' } })
        })
      }),
      upsert: async () => ({ error: { code: '42501', message: 'permission denied' } }),
      update: () => ({
        eq: async () => ({ error: { code: '42501', message: 'permission denied' } })
      }),
      delete: () => ({
        eq: async () => ({ error: { code: '42501', message: 'permission denied' } })
      })
    })
  };
  const permStore = new SupabaseDashboardStore(permErrorClient);
  await assert.rejects(
    () => permStore.linkDiscord('111111111111111111', 'alice'),
    /permission denied/
  );
  await assert.rejects(
    () => permStore.unlinkDiscord('111111111111111111'),
    /permission denied/
  );

  // 3c. All fallback writes hit missing-table (42P01) -> 0 writes persisted -> must throw instead of faking success
  const missingTablesClient = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: { code: '42P01', message: 'relation does not exist' } })
        })
      }),
      upsert: async () => ({ error: { code: '42P01', message: 'relation does not exist' } }),
      update: () => ({
        eq: async () => ({ error: { code: '42P01', message: 'relation does not exist' } })
      }),
      delete: () => ({
        eq: async () => ({ error: { code: '42P01', message: 'relation does not exist' } })
      })
    })
  };
  const zeroWritesStore = new SupabaseDashboardStore(missingTablesClient);
  await assert.rejects(
    () => zeroWritesStore.linkDiscord('111111111111111111', 'alice'),
    /Không thể lưu liên kết Discord/
  );
  await assert.rejects(
    () => zeroWritesStore.unlinkDiscord('111111111111111111'),
    /Không thể hủy liên kết Discord/
  );

  // 3d. Fallback 1:1 conflict detection blocks stealing an already-linked Discord ID
  const existingLinks = [
    { discord_user_id: '222222222222222222', manager_user_id: 'usr_bob', username: 'bob', status: 'active' }
  ];
  let linkUpsertCalled = false;
  const fallbackConflictStore = new SupabaseDashboardStore({
    from: (table) => createTableBuilder(() => (table === 'manager_discord_links' ? existingLinks : []), {
      onUpsert: async (row) => {
        linkUpsertCalled = true;
        return { data: [row], error: null };
      }
    })
  });
  await assert.rejects(
    () => fallbackConflictStore.linkDiscord('222222222222222222', 'alice'),
    /đã được liên kết với một tài khoản Web khác/
  );
  assert.strictEqual(linkUpsertCalled, false, 'Conflict guard must reject before mutating links');

  // 3e. Real RPC error on unlinkDiscord propagates instead of faking true
  const unlinkErrStore = new SupabaseDashboardStore({
    rpc: async () => ({ data: null, error: { code: '53300', message: 'too many clients' } }),
    from: () => createTableBuilder(() => [])
  });
  await assert.rejects(
    () => unlinkErrStore.unlinkDiscord('222222222222222222'),
    /too many clients/
  );

  console.log('✅ 3. Discord link/unlink fail-closed & conflict checks passed.');
}

async function testLink4mAndSettingsParity() {
  console.log('4. Checking Link4M dual-column persistence & getSetting array preservation...');
  const insertedAttempts = [];
  const settingsRows = [];
  const store = new SupabaseDashboardStore({
    from: (table) => {
      if (table === 'manager_link4m_attempts') {
        return createTableBuilder(() => insertedAttempts, {
          onInsert: async (row) => {
            insertedAttempts.push(row);
            return { data: [row], error: null };
          }
        });
      }
      if (table === 'manager_settings') {
        return createTableBuilder(() => settingsRows, {
          onUpsert: async (row) => {
            const idx = settingsRows.findIndex((s) => s.key === row.key);
            if (idx >= 0) settingsRows[idx] = { ...row };
            else settingsRows.push({ ...row });
            return { data: [row], error: null };
          }
        });
      }
      return createTableBuilder(() => []);
    }
  });

  const createdAt = new Date('2026-11-11T05:00:00.000Z');
  const expiresAt = new Date('2026-11-11T05:15:00.000Z');
  const purgeAt = new Date('2027-05-10T05:00:00.000Z');
  const tokenHash = crypto.createHash('sha256').update('tok').digest('hex');

  await store.createLinkAttempt({
    attemptId: 'l4m_test_1',
    userId: 'usr_abc123',
    tokenHash,
    rewardHours: 12,
    status: 'pending',
    createdAt,
    expiresAt,
    providerUrl: 'https://link4m.com/short',
    purgeAt,
    dailyDate: '2026-11-11'
  });

  assert.strictEqual(insertedAttempts.length, 1);
  assert.strictEqual(insertedAttempts[0].user_id, 'usr_abc123');
  assert.strictEqual(insertedAttempts[0].username, 'usr_abc123');
  assert.strictEqual(insertedAttempts[0].daily_date, '2026-11-11');
  assert.strictEqual(insertedAttempts[0].vietnam_date, '2026-11-11');
  assert.strictEqual(insertedAttempts[0].provider_url, 'https://link4m.com/short');
  assert.strictEqual(insertedAttempts[0].provider_short_url, 'https://link4m.com/short');
  assert.strictEqual(insertedAttempts[0].created_at, '2026-11-11T05:00:00.000Z');

  // Legacy RPC-shaped row (username/vietnam_date/provider_short_url) maps seamlessly
  insertedAttempts.push({
    attempt_id: 'l4m_legacy_1',
    username: 'alice',
    token_hash: tokenHash,
    status: 'pending',
    vietnam_date: '2026-11-11',
    provider_short_url: 'https://link4m.com/legacy',
    created_at: createdAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    reward_hours: 12
  });
  const loadedLegacy = await store.getLinkAttempt('l4m_legacy_1');
  assert.strictEqual(loadedLegacy.userId, 'alice');
  assert.strictEqual(loadedLegacy.dailyDate, '2026-11-11');
  assert.strictEqual(loadedLegacy.providerUrl, 'https://link4m.com/legacy');

  // Array settings preserve Array type (wispbyte_accounts compatibility)
  const savedAccounts = await store.setSetting('wispbyte_accounts', [{ id: 'primary', cookie: 'abc' }]);
  assert.ok(Array.isArray(savedAccounts), 'getSetting must preserve array values');
  assert.strictEqual(savedAccounts[0].id, 'primary');

  console.log('✅ 4. Link4M dual-column parity & settings array preservation passed.');
}

async function testCommandStoreTwoPhaseSyncPersistence() {
  console.log('5. Checking SupabaseCommandStore two-phase RESET states, lease exclusion & clearWorker safety...');

  const rows = [];
  let nonRpcTableSelects = 0;
  const client = {
    async rpc() {
      return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    },
    from: (table) => {
      if (table !== 'manager_commands') return createTableBuilder(() => []);
      return createTableBuilder(() => rows, {
        onSelect: async () => {
          nonRpcTableSelects += 1;
          return { data: rows.map((r) => ({ ...r })), error: null };
        },
        onInsert: async (row) => {
          rows.push({ ...row });
          return { data: [{ ...row }], error: null };
        }
      });
    }
  };

  // 5-pre. Default production mode MUST FAIL CLOSED when atomic SQL RPCs are missing (no non-atomic polling fallback)
  const failClosedStore = new SupabaseCommandStore(client);
  await assert.rejects(
    () => failClosedStore.claimPendingStateSyncBatch('mgr_default', 10, 60),
    (err) => err && err.code === 'ATOMIC_STATE_SYNC_RPC_REQUIRED'
  );
  assert.strictEqual(nonRpcTableSelects, 0, 'claimPendingStateSyncBatch must NEVER read/update table non-atomically when RPC is missing');
  assert.strictEqual(failClosedStore.health().ok, false);
  assert.strictEqual(failClosedStore.health().degraded, true);
  assert.strictEqual(failClosedStore.health().retryEnabled, false);
  assert.ok(failClosedStore.health().missingRpcs.includes('manager_claim_pending_command_syncs'));

  await assert.rejects(
    () => failClosedStore.recordExecutionCompleted('bot-s1', 'cmd_reset_s1', { ok: true }, { leaseOwner: 'mgr_default' }),
    (err) => err && err.code === 'ATOMIC_STATE_SYNC_RPC_REQUIRED'
  );
  await assert.rejects(
    () => failClosedStore.renewStateSyncLease('bot-s1', 'cmd_reset_s1', 'mgr_default', 60),
    (err) => err && err.code === 'ATOMIC_STATE_SYNC_RPC_REQUIRED'
  );
  await assert.rejects(
    () => failClosedStore.verifyStateSyncLease('bot-s1', 'cmd_reset_s1', 'mgr_default'),
    (err) => err && err.code === 'ATOMIC_STATE_SYNC_RPC_REQUIRED'
  );

  // 5-probe. OpenAPI probe in initialize() detects missing atomic RPCs via adapter without crashing startup
  const probeClient = {
    adapter: {
      url: 'https://supabase.test',
      isEnabled: () => true,
      getHeaders: () => ({}),
      fetchWithRetry: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          paths: {
            '/rpc/manager_record_command_execution': {}
          }
        })
      })
    },
    from: () => createTableBuilder(() => [])
  };
  const origErr = console.error;
  const probeErrLogs = [];
  console.error = (...args) => probeErrLogs.push(args.join(' '));
  const probedStore = new SupabaseCommandStore(probeClient);
  try {
    await probedStore.initialize();
  } finally {
    console.error = origErr;
  }
  const probedHealth = probedStore.health();
  assert.strictEqual(probedHealth.ok, false);
  assert.strictEqual(probedHealth.degraded, true);
  assert.strictEqual(probedHealth.rpcVerified, true);
  assert.strictEqual(probedHealth.retryEnabled, false);
  assert.strictEqual(probedHealth.missingRpcs.includes('manager_claim_pending_command_syncs'), true);
  assert.strictEqual(probedHealth.missingRpcs.includes('manager_record_command_execution'), false);
  assert.ok(probeErrLogs.some((m) => m.includes('Degraded')));

  // 5a-g. Explicit single-instance opt-in exercises fallback + monotonic fencing tokens + renew/verify
  const cmdStore = new SupabaseCommandStore({
    rpc: client.rpc,
    from: (table) => {
      if (table !== 'manager_commands') return createTableBuilder(() => []);
      return createTableBuilder(() => rows, {
        onInsert: async (row) => {
          rows.push({ ...row });
          return { data: [{ ...row }], error: null };
        }
      });
    }
  }, { allowUnsafeSingleInstanceFallback: true });
  await cmdStore.enqueue({ commandId: 'cmd_reset_s1', workerId: 'bot-s1', action: 'reset', payload: {} });
  const taken = await cmdStore.take('bot-s1');
  assert.strictEqual(taken?.commandId, 'cmd_reset_s1');
  await cmdStore.enqueue({ commandId: 'cmd_queued_s2', workerId: 'bot-s1', action: 'status', payload: {} });

  // 5a. recordExecutionCompleted marks 'execution_completed' without setting completed_at & issues fencingToken 1
  const recA = await cmdStore.recordExecutionCompleted('bot-s1', 'cmd_reset_s1', { ok: true, state: 'stopped' }, {
    leaseOwner: 'mgr_A',
    leaseSeconds: 30,
    candidateStatus: { state: 'stopped' },
    pendingSteps: ['registry.resetData']
  });
  assert.strictEqual(recA.ok, true);
  assert.strictEqual(recA.status, 'execution_completed');
  assert.strictEqual(recA.fencingToken, 1);

  const rowAfterRec = rows.find((r) => r.command_id === 'cmd_reset_s1');
  assert.strictEqual(rowAfterRec.status, 'execution_completed');
  assert.strictEqual(rowAfterRec.completed_at, null);

  // 5b. Concurrent recordExecutionCompleted from another lease owner is rejected while leased;
  // verifyStateSyncLease and renewStateSyncLease validate owner + fencing token
  const recB = await cmdStore.recordExecutionCompleted('bot-s1', 'cmd_reset_s1', { ok: true, state: 'stopped' }, {
    leaseOwner: 'mgr_B',
    leaseSeconds: 30
  });
  assert.strictEqual(recB.ok, false);
  assert.strictEqual(recB.error, 'STATE_SYNC_IN_PROGRESS');

  const verifyOk = await cmdStore.verifyStateSyncLease('bot-s1', 'cmd_reset_s1', 'mgr_A', { fencingToken: 1 });
  assert.strictEqual(verifyOk.held, true);
  const verifyWrongOwner = await cmdStore.verifyStateSyncLease('bot-s1', 'cmd_reset_s1', 'mgr_B', { fencingToken: 1 });
  assert.strictEqual(verifyWrongOwner.held, false);
  assert.strictEqual(verifyWrongOwner.reason, 'lease_owner_mismatch');
  const renewOk = await cmdStore.renewStateSyncLease('bot-s1', 'cmd_reset_s1', 'mgr_A', 45, { fencingToken: 1 });
  assert.strictEqual(renewOk.ok, true);
  const renewWrongToken = await cmdStore.renewStateSyncLease('bot-s1', 'cmd_reset_s1', 'mgr_A', 45, { fencingToken: 99 });
  assert.strictEqual(renewWrongToken.ok, false);
  assert.strictEqual(renewWrongToken.reason, 'fencing_token_mismatch');

  // 5c. markStateSyncPending releases lease & preserves fencingToken while transitioning to 'state_sync_pending'
  const marked = await cmdStore.markStateSyncPending('bot-s1', 'cmd_reset_s1', {
    result: { ok: true, state: 'stopped' },
    leaseOwner: 'mgr_A',
    fencingToken: 1,
    syncState: {
      pending: true,
      attempts: 1,
      nextRetryAt: new Date(Date.now() - 1000).toISOString(),
      leaseOwner: null,
      leaseUntil: null,
      pendingSteps: ['registry.resetData']
    }
  });
  assert.strictEqual(marked, true);
  assert.strictEqual(rowAfterRec.status, 'state_sync_pending');
  assert.strictEqual(rowAfterRec.result._stateSync.fencingToken, 1);

  // 5d. initialize() cleanup and clearWorker() delete unrelated rows while PRESERVING state_sync_pending row
  rows.push({
    command_id: 'cmd_old_completed',
    worker_id: 'bot-s1',
    action: 'status',
    status: 'completed',
    created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString()
  });
  await cmdStore.initialize();
  assert.strictEqual(rows.some((r) => r.command_id === 'cmd_reset_s1'), true, 'initialize() cleanup must preserve state_sync_pending row');

  await cmdStore.clearWorker('bot-s1', { excludeCommandIds: ['cmd_reset_s1'] });
  assert.strictEqual(rows.some((r) => r.command_id === 'cmd_queued_s2'), false, 'clearWorker must remove queued rows');
  assert.strictEqual(rows.some((r) => r.command_id === 'cmd_reset_s1'), true, 'clearWorker must preserve state_sync_pending row');

  // 5e. claimPendingStateSyncBatch grants lease + increments fencingToken to 2 for mgr_B and prevents duplicate claim by mgr_C
  const claimedB = await cmdStore.claimPendingStateSyncBatch('mgr_B', 10, 60);
  assert.strictEqual(claimedB.length, 1);
  assert.strictEqual(claimedB[0].commandId, 'cmd_reset_s1');
  assert.strictEqual(claimedB[0].result._stateSync.fencingToken, 2);
  const claimedC = await cmdStore.claimPendingStateSyncBatch('mgr_C', 10, 60);
  assert.strictEqual(claimedC.length, 0, 'Active lease must prevent duplicate claim');

  // 5f. Compare-on-owner & fencingToken rejects finalizeCompleted/markStateSyncPending from wrong owner/stale token, accepts owner + token 2
  const wrongOwnerFinalize = await cmdStore.finalizeCompleted('bot-s1', 'cmd_reset_s1', null, { leaseOwner: 'mgr_C', fencingToken: 2 });
  assert.strictEqual(wrongOwnerFinalize, false);
  const staleTokenFinalize = await cmdStore.finalizeCompleted('bot-s1', 'cmd_reset_s1', null, { leaseOwner: 'mgr_B', fencingToken: 1 });
  assert.strictEqual(staleTokenFinalize, false);
  const staleOwnerMark = await cmdStore.markStateSyncPending('bot-s1', 'cmd_reset_s1', {
    leaseOwner: 'mgr_A',
    fencingToken: 1,
    syncState: { pending: true }
  });
  assert.strictEqual(staleOwnerMark, false);
  const okFinalize = await cmdStore.finalizeCompleted('bot-s1', 'cmd_reset_s1', { ok: true, state: 'stopped' }, { leaseOwner: 'mgr_B', fencingToken: 2 });
  assert.strictEqual(okFinalize, true);
  assert.strictEqual(rowAfterRec.status, 'completed');
  assert.ok(rowAfterRec.completed_at);
  assert.strictEqual(rowAfterRec.result._stateSync, undefined);

  // 5g. clearWorker throws on PostgREST error instead of silently swallowing
  const failingStore = new SupabaseCommandStore({
    from: () => createTableBuilder(() => [], {
      onDelete: async () => ({ data: null, error: { code: '57014', message: 'statement timeout' } })
    })
  });
  await assert.rejects(() => failingStore.clearWorker('bot-s1'), /statement timeout/);

  // 5h. Default production mode SUCCEEDS cleanly via RPCs without fallback
  const calledRpcs = [];
  const rpcStore = new SupabaseCommandStore({
    rpc: async (fnName, params) => {
      calledRpcs.push(fnName);
      if (fnName === 'manager_record_command_execution') {
        return { data: { ok: true, status: 'execution_completed', fencingToken: 1, command: { command_id: params.p_command_id, worker_id: params.p_worker_id, status: 'execution_completed', result: params.p_result } }, error: null };
      }
      if (fnName === 'manager_renew_command_sync_lease') {
        return { data: { ok: true, lost: false, leaseOwner: params.p_lease_owner, leaseUntil: new Date(Date.now() + 60000).toISOString(), fencingToken: 1 }, error: null };
      }
      if (fnName === 'manager_verify_command_sync_lease') {
        return { data: { ok: true, held: true, leaseOwner: params.p_lease_owner, fencingToken: 1 }, error: null };
      }
      if (fnName === 'manager_claim_pending_command_syncs') {
        return { data: [{ command_id: 'cmd_rpc_1', worker_id: 'bot-rpc', action: 'reset', status: 'state_sync_pending', result: { ok: true, _stateSync: { fencingToken: 2, leaseOwner: params.p_lease_owner } } }], error: null };
      }
      if (fnName === 'manager_mark_command_sync_pending' || fnName === 'manager_finalize_command_sync') {
        return { data: true, error: null };
      }
      return { data: null, error: { code: 'PGRST202', message: 'unknown' } };
    },
    from: () => {
      throw new Error('Production RPC path must not touch raw table fallback');
    }
  });
  await rpcStore.recordExecutionCompleted('bot-rpc', 'cmd_rpc_1', { ok: true }, { leaseOwner: 'mgr_P', leaseSeconds: 60 });
  const rpcRenew = await rpcStore.renewStateSyncLease('bot-rpc', 'cmd_rpc_1', 'mgr_P', 60, { fencingToken: 1 });
  assert.strictEqual(rpcRenew.ok, true);
  const rpcVerify = await rpcStore.verifyStateSyncLease('bot-rpc', 'cmd_rpc_1', 'mgr_P', { fencingToken: 1 });
  assert.strictEqual(rpcVerify.held, true);
  const rpcClaim = await rpcStore.claimPendingStateSyncBatch('mgr_P', 5, 60);
  assert.strictEqual(rpcClaim.length, 1);
  assert.strictEqual(await rpcStore.markStateSyncPending('bot-rpc', 'cmd_rpc_1', { syncState: {}, leaseOwner: 'mgr_P', fencingToken: 2 }), true);
  assert.strictEqual(await rpcStore.finalizeCompleted('bot-rpc', 'cmd_rpc_1', { ok: true }, { leaseOwner: 'mgr_P', fencingToken: 2 }), true);
  assert.strictEqual(rpcStore.health().ok, true);
  assert.deepStrictEqual(calledRpcs, [
    'manager_record_command_execution',
    'manager_renew_command_sync_lease',
    'manager_verify_command_sync_lease',
    'manager_claim_pending_command_syncs',
    'manager_mark_command_sync_pending',
    'manager_finalize_command_sync'
  ]);

  console.log('✅ 5. SupabaseCommandStore two-phase RESET states, fencing & fail-closed RPC enforcement verified.');
}

async function testCommandStoreCmdUuidEndToEndContract() {
  console.log('6. Checking cmd_<UUID> end-to-end RPC parameter contract against SQL definitions...');
  const fs = require('node:fs');
  const path = require('node:path');
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const CMD_UUID_RE = /^cmd_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function parseSqlSignatures(sqlText) {
    const map = new Map();
    const fnRe = /create\s+(?:or\s+replace\s+)?function\s+public\.([a-z0-9_]+)\s*\(([\s\S]*?)\)\s*returns\b/gi;
    let m;
    while ((m = fnRe.exec(sqlText)) !== null) {
      const fnName = m[1];
      const rawParams = m[2].trim();
      const params = rawParams
        ? rawParams.split(',').map((part) => {
            const cleaned = part.trim().replace(/\s+default\s+[\s\S]+$/i, '');
            const hasDefault = /\s+default\s+/i.test(part);
            const parts = cleaned.split(/\s+/);
            const name = parts[0];
            const type = parts.slice(1).join(' ').toLowerCase();
            return { name, type, hasDefault };
          })
        : [];
      map.set(fnName, params);
    }
    return map;
  }

  const mig08Sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261108000000_durable_worker_commands.sql'), 'utf8');
  const mig1100Sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261111000000_worker_reset_data.sql'), 'utf8');
  const mig1112Sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261111120000_command_two_phase_sync.sql'), 'utf8');
  const setupSql = fs.readFileSync(path.join(__dirname, '../supabase/setup.sql'), 'utf8');
  const orderedMigSigs = new Map([
    ...parseSqlSignatures(mig08Sql),
    ...parseSqlSignatures(mig1100Sql),
    ...parseSqlSignatures(mig1112Sql)
  ]);
  const setupSigs = parseSqlSignatures(setupSql);

  const cmdRows = new Map();
  const seenCmdUuidRpcs = new Map();
  const contractErrors = [];
  let fallbackTriggered = false;

  function validateParamsAgainstSql(sigs, label, fnName, params) {
    const def = sigs.get(fnName);
    if (!def) {
      const msg = `[${label}] Missing RPC ${fnName} in parsed SQL contract`;
      contractErrors.push(msg);
      return { code: 'PGRST202', message: msg };
    }
    const defByName = new Map(def.map((d) => [d.name, d]));
    for (const [k, v] of Object.entries(params || {})) {
      const paramDef = defByName.get(k);
      if (!paramDef) {
        const msg = `[${label}] Unexpected parameter ${k} for ${fnName}`;
        contractErrors.push(msg);
        return { code: 'PGRST202', message: msg };
      }
      if (paramDef.type === 'uuid' && v !== null && v !== undefined && !UUID_RE.test(String(v))) {
        const msg = `[${label}] invalid input syntax for type uuid for ${fnName}.${k}: "${v}"`;
        contractErrors.push(msg);
        return { code: '22P02', message: msg };
      }
      if (k === 'p_command_id' && paramDef.type !== 'text') {
        const msg = `[${label}] ${fnName}.p_command_id must be text, got ${paramDef.type}`;
        contractErrors.push(msg);
        return { code: '42883', message: msg };
      }
    }
    for (const paramDef of def) {
      if (!paramDef.hasDefault && !(paramDef.name in (params || {}))) {
        const msg = `[${label}] Missing required parameter ${paramDef.name} for ${fnName}`;
        contractErrors.push(msg);
        return { code: 'PGRST202', message: msg };
      }
    }
    return null;
  }

  const client = {
    async rpc(fnName, params = {}) {
      for (const [label, sigs] of [['migrations', orderedMigSigs], ['setup.sql', setupSigs]]) {
        const validationErr = validateParamsAgainstSql(sigs, label, fnName, params);
        if (validationErr) {
          return { data: null, error: validationErr };
        }
      }
      if ('p_command_id' in params) {
        assert.match(String(params.p_command_id), CMD_UUID_RE, `${fnName} must receive cmd_<UUID>`);
        seenCmdUuidRpcs.set(fnName, String(params.p_command_id));
      }

      const nowIso = new Date().toISOString();
      if (fnName === 'manager_enqueue_worker_command') {
        const row = {
          command_id: params.p_command_id,
          worker_id: params.p_worker_id,
          action: params.p_action,
          payload: params.p_payload || {},
          status: 'queued',
          result: null,
          created_at: params.p_created_at,
          expires_at: params.p_expires_at,
          delivered_at: null,
          completed_at: null
        };
        cmdRows.set(row.command_id, row);
        return { data: [{ ...row }], error: null };
      }
      if (fnName === 'manager_take_worker_command') {
        for (const row of cmdRows.values()) {
          if (row.worker_id === params.p_worker_id && row.status === 'queued') {
            row.status = 'delivered';
            row.delivered_at = nowIso;
            return { data: { ...row }, error: null };
          }
        }
        return { data: null, error: null };
      }
      if (fnName === 'manager_record_command_execution') {
        const row = cmdRows.get(params.p_command_id);
        assert.ok(row && row.worker_id === params.p_worker_id);
        const token = Number(row.result?._stateSync?.fencingToken || 0) + 1;
        row.status = 'execution_completed';
        row.completed_at = null;
        row.result = {
          ...(params.p_result || {}),
          _stateSync: {
            pending: true,
            executionCompleted: true,
            leaseOwner: params.p_lease_owner,
            leaseUntil: new Date(Date.now() + (params.p_lease_seconds || 60) * 1000).toISOString(),
            fencingToken: token
          }
        };
        return { data: { ok: true, alreadyCompleted: false, status: 'execution_completed', fencingToken: token, command: { ...row } }, error: null };
      }
      if (fnName === 'manager_verify_command_sync_lease') {
        const row = cmdRows.get(params.p_command_id);
        const held = Boolean(row && row.result?._stateSync?.leaseOwner === params.p_lease_owner);
        return { data: { ok: held, held, leaseOwner: row?.result?._stateSync?.leaseOwner || null, fencingToken: row?.result?._stateSync?.fencingToken || 0 }, error: null };
      }
      if (fnName === 'manager_renew_command_sync_lease') {
        const row = cmdRows.get(params.p_command_id);
        const nextLease = new Date(Date.now() + (params.p_lease_seconds || 60) * 1000).toISOString();
        row.result._stateSync.leaseUntil = nextLease;
        return { data: { ok: true, lost: false, leaseOwner: params.p_lease_owner, leaseUntil: nextLease, fencingToken: row.result._stateSync.fencingToken }, error: null };
      }
      if (fnName === 'manager_mark_command_sync_pending') {
        const row = cmdRows.get(params.p_command_id);
        row.status = params.p_terminal_failed ? 'state_sync_failed' : 'state_sync_pending';
        row.completed_at = null;
        row.result = {
          ...(row.result || {}),
          _stateSync: { ...(params.p_sync_state || {}), fencingToken: row.result?._stateSync?.fencingToken || 1 }
        };
        return { data: true, error: null };
      }
      if (fnName === 'manager_claim_pending_command_syncs') {
        const claimed = [];
        for (const row of cmdRows.values()) {
          if (row.status === 'state_sync_pending' || row.status === 'execution_completed') {
            row.status = 'state_sync_pending';
            row.result._stateSync = {
              ...(row.result._stateSync || {}),
              pending: true,
              leaseOwner: params.p_lease_owner,
              leaseUntil: new Date(Date.now() + (params.p_lease_seconds || 60) * 1000).toISOString(),
              fencingToken: Number(row.result?._stateSync?.fencingToken || 0) + 1
            };
            claimed.push({ ...row, result: { ...row.result, _stateSync: { ...row.result._stateSync } } });
          }
        }
        return { data: claimed, error: null };
      }
      if (fnName === 'manager_finalize_command_sync') {
        const row = cmdRows.get(params.p_command_id);
        row.status = 'completed';
        row.completed_at = nowIso;
        const cleanResult = { ...(params.p_result || row.result || {}) };
        delete cleanResult._stateSync;
        row.result = cleanResult;
        return { data: true, error: null };
      }
      if (fnName === 'manager_complete_worker_command') {
        const row = cmdRows.get(params.p_command_id);
        row.status = params.p_result?.ok === false ? 'failed' : 'completed';
        row.completed_at = nowIso;
        row.result = params.p_result;
        return { data: true, error: null };
      }
      if (fnName === 'manager_expire_worker_command') {
        const row = cmdRows.get(params.p_command_id);
        row.status = 'expired';
        return { data: true, error: null };
      }
      return { data: null, error: { code: 'PGRST202', message: `Unknown RPC ${fnName}` } };
    },
    from: () => {
      fallbackTriggered = true;
      throw new Error('Test 6 must execute purely through RPC signatures without falling back to raw table operations');
    }
  };

  const store = new SupabaseCommandStore(client);

  // Two-phase RESET lifecycle using generated cmd_<UUID>
  const enqReset = await store.enqueue({ workerId: '01', action: 'reset', payload: {} });
  assert.match(enqReset.commandId, CMD_UUID_RE);
  const takenReset = await store.take('01');
  assert.strictEqual(takenReset.commandId, enqReset.commandId);
  const rec = await store.recordExecutionCompleted('01', enqReset.commandId, { ok: true, state: 'stopped' }, { leaseOwner: 'mgr_1', leaseSeconds: 60 });
  assert.strictEqual(rec.ok, true);
  assert.strictEqual(rec.fencingToken, 1);
  const ver = await store.verifyStateSyncLease('01', enqReset.commandId, 'mgr_1', { fencingToken: 1 });
  assert.strictEqual(ver.held, true);
  const ren = await store.renewStateSyncLease('01', enqReset.commandId, 'mgr_1', 60, { fencingToken: 1 });
  assert.strictEqual(ren.ok, true);
  const pendingOk = await store.markStateSyncPending('01', enqReset.commandId, {
    result: { ok: true, state: 'stopped' },
    leaseOwner: 'mgr_1',
    fencingToken: 1,
    syncState: { pending: true, attempts: 1, nextRetryAt: new Date(Date.now() - 1000).toISOString(), leaseOwner: null, leaseUntil: null }
  });
  assert.strictEqual(pendingOk, true);
  const claimed = await store.claimPendingStateSyncBatch('mgr_2', 10, 60);
  assert.strictEqual(claimed.length, 1);
  assert.strictEqual(claimed[0].commandId, enqReset.commandId);
  assert.strictEqual(claimed[0].result._stateSync.fencingToken, 2);
  const finOk = await store.finalizeCompleted('01', enqReset.commandId, { ok: true, state: 'stopped' }, { leaseOwner: 'mgr_2', fencingToken: 2 });
  assert.strictEqual(finOk, true);

  // Standard completion lifecycle using generated cmd_<UUID>
  const enqStatus = await store.enqueue({ workerId: '01', action: 'status', payload: {} });
  assert.match(enqStatus.commandId, CMD_UUID_RE);
  const takenStatus = await store.take('01');
  assert.strictEqual(takenStatus.commandId, enqStatus.commandId);
  assert.strictEqual(await store.complete('01', enqStatus.commandId, { ok: true }), true);

  // Expiration lifecycle using generated cmd_<UUID>
  const enqChat = await store.enqueue({ workerId: '01', action: 'chat', payload: { message: 'hi' } });
  assert.match(enqChat.commandId, CMD_UUID_RE);
  await store.expire(enqChat.commandId);

  assert.deepStrictEqual(contractErrors, [], `SQL contract validation errors: ${contractErrors.join('; ')}`);
  assert.strictEqual(fallbackTriggered, false, 'Raw table fallback must NOT be reached when SQL RPC signatures match');

  for (const rpcName of [
    'manager_enqueue_worker_command',
    'manager_complete_worker_command',
    'manager_expire_worker_command',
    'manager_record_command_execution',
    'manager_renew_command_sync_lease',
    'manager_verify_command_sync_lease',
    'manager_mark_command_sync_pending',
    'manager_finalize_command_sync'
  ]) {
    assert.ok(seenCmdUuidRpcs.has(rpcName), `Expected ${rpcName} to receive a cmd_<UUID> command_id`);
  }

  console.log('✅ 6. cmd_<UUID> end-to-end RPC contract across SQL signatures verified.');
}

async function testReconciledSchemaAndRuntimeContracts() {
  console.log('7. Checking reconciled SQL parity, security hardening & Phase 6 runtime fixes...');
  const fs = require('node:fs');
  const path = require('node:path');

  // 7a. SUPABASE_REQUIRED_TABLES completeness
  assert.strictEqual(SUPABASE_REQUIRED_TABLES.length, 26, 'Expected 26 runtime required tables');
  for (const requiredTbl of [
    'manager_assignments',
    'manager_discord_links',
    'manager_settings',
    'manager_workers',
    'manager_commands',
    'audit_logs'
  ]) {
    assert.ok(SUPABASE_REQUIRED_TABLES.includes(requiredTbl), `Missing ${requiredTbl} in SUPABASE_REQUIRED_TABLES`);
  }

  // 7b. Cross-file object & hardening parity across all 4 reconciled SQL sources
  const setupSql = fs.readFileSync(path.join(__dirname, '../supabase/setup.sql'), 'utf8');
  const resetSetupSql = fs.readFileSync(path.join(__dirname, '../supabase/reset_and_setup.sql'), 'utf8');
  const reconcileSql = fs.readFileSync(
    path.join(__dirname, '../supabase/migrations/20261112000000_reconcile_full_manager_schema.sql'),
    'utf8'
  );

  const canonicalFiles = [
    ['src/storage/schema-sql.js', schemaSql],
    ['supabase/setup.sql', setupSql],
    ['supabase/reset_and_setup.sql', resetSetupSql],
    ['supabase/migrations/20261112000000_reconcile_full_manager_schema.sql', reconcileSql]
  ];

  const extractSet = (text, regex) => new Set([...text.matchAll(regex)].map((m) => m[1].toLowerCase()));
  const expectedViews = ['manager_audit', 'backups', 'system_settings', 'bot_schedules'];
  const expectedMigrations = [
    '20261107_manager_schema',
    '20261108000000_durable_worker_commands',
    '20261109000000_atomic_entitlement_rewards',
    '20261110000000_atomic_worker_settings',
    '20261111000000_worker_reset_data',
    '20261111120000_command_two_phase_sync',
    '20261112000000_reconcile_full_manager_schema'
  ];

  let refTables = null;
  let refFuncs = null;

  for (const [label, sqlText] of canonicalFiles) {
    assert.ok(!/^\s*DO\s+(?!\$\$|\$[a-z0-9_]*\$)(?:DECLARE|BEGIN)\b/im.test(sqlText), `${label} contains malformed DO block without $$`);

    // Duplicate index check on CREATE INDEX
    const idxMatches = [...sqlText.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z0-9_]+)/gi)];
    const seenIdx = new Set();
    for (const m of idxMatches) {
      const idxName = m[1].toLowerCase();
      assert.ok(!seenIdx.has(idxName), `${label} declares duplicate index ${idxName}`);
      seenIdx.add(idxName);
    }

    for (const viewName of expectedViews) {
      const viewRe = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?VIEW\\s+public\\.${viewName}\\s+WITH\\s*\\(\\s*security_invoker\\s*=\\s*true\\s*\\)`, 'i');
      assert.match(sqlText, viewRe, `${label} must declare view ${viewName} with security_invoker = true`);
    }

    // Check every public function definition uses SECURITY DEFINER SET search_path = public, pg_temp
    const fnHeaders = [...sqlText.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-z0-9_]+)\s*\(([\s\S]*?)AS\s+\$/gi)];
    assert.strictEqual(fnHeaders.length, 51, `${label} expected 51 public functions, got ${fnHeaders.length}`);
    for (const match of fnHeaders) {
      assert.match(match[2], /\bSECURITY\s+DEFINER\b/i, `${label} ${match[1]} must be SECURITY DEFINER`);
      assert.match(match[2], /\bSET\s+search_path\s*=\s*public,\s*pg_temp\b/i, `${label} ${match[1]} must set search_path = public, pg_temp`);
    }

    const tables = extractSet(sqlText, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.([a-z0-9_]+)/gi);
    const funcs = extractSet(sqlText, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-z0-9_]+)\s*\(/gi);
    assert.strictEqual(tables.size, 27, `${label} expected 27 base tables, got ${tables.size}`);
    assert.strictEqual(funcs.size, 51, `${label} expected 51 unique function names, got ${funcs.size}`);

    if (!refTables) {
      refTables = tables;
      refFuncs = funcs;
    } else {
      assert.deepStrictEqual([...tables].sort(), [...refTables].sort(), `${label} table set diverges from schema-sql.js`);
      assert.deepStrictEqual([...funcs].sort(), [...refFuncs].sort(), `${label} function set diverges from schema-sql.js`);
    }
  }

  for (const ver of expectedMigrations) {
    assert.ok(reconcileSql.includes(`'${ver}'`), `Convergence migration must record ${ver} in manager_schema_migrations`);
  }

  // 7c. removeAccess RPC-first & fail-closed behavior
  let rpcCalledWith = null;
  const rpcStore = new SupabaseDashboardStore({
    rpc: async (fn, params) => {
      rpcCalledWith = { fn, params };
      return { data: { deleted: true }, error: null };
    },
    from: () => { throw new Error('Should not hit direct tables when manager_delete_user_access succeeds'); }
  });
  assert.strictEqual(await rpcStore.removeAccess('usr_test1'), true);
  assert.deepStrictEqual(rpcCalledWith, { fn: 'manager_delete_user_access', params: { p_user_id: 'usr_test1' } });

  const nonMissingErrStore = new SupabaseDashboardStore({
    rpc: async () => ({ data: null, error: { code: '42501', message: 'permission denied' } }),
    from: () => { throw new Error('Must not swallow 42501 error into fallback'); }
  });
  await assert.rejects(() => nonMissingErrStore.removeAccess('usr_test1'), { code: '42501', message: 'permission denied' });

  const deletedTables = [];
  const missingRpcFallbackStore = new SupabaseDashboardStore({
    rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find function' } }),
    from: (tbl) => createTableBuilder(() => [{ id: 'usr_test1', user_id: 'usr_test1', username: 'test1' }], {
      onDelete: () => {
        deletedTables.push(tbl);
        return { data: [{ id: 'usr_test1', user_id: 'usr_test1', username: 'test1' }], error: null };
      }
    })
  });
  assert.strictEqual(await missingRpcFallbackStore.removeAccess('usr_test1'), true);
  assert.ok(deletedTables.includes('manager_assignments'));
  assert.ok(deletedTables.includes('manager_users'));

  // 7d. Audit log adapter + direct table contract (audit_logs instead of manager_audit view)
  let insertedAudit = null;
  let clearedAudit = false;
  const auditAdapterStore = new SupabaseDashboardStore({
    from: () => { throw new Error('Adapter should handle audit calls when present'); },
    adapter: {
      insertAuditLog: async (entry) => { insertedAudit = entry; return true; },
      fetchAuditLogs: async () => ({
        logs: [{
          id: 'aud_1',
          actor: { username: 'admin1' },
          action: 'RESET',
          target: { workerId: '01' },
          details: 'ok',
          timestamp: '2026-11-12T00:00:00Z'
        }]
      }),
      clearAuditLogs: async () => { clearedAudit = true; return true; }
    }
  });
  await auditAdapterStore.addAudit({ actorId: 'admin1', action: 'RESET', target: { workerId: '01' } });
  assert.match(insertedAudit.id, /^audit_/);
  const logs = await auditAdapterStore.listAudit(10);
  assert.strictEqual(logs.length, 1);
  assert.strictEqual(logs[0].actorId, 'admin1');
  assert.strictEqual(await auditAdapterStore.clearAuditLogs(), true);
  assert.strictEqual(clearedAudit, true);

  const touchedAuditTables = [];
  const auditDirectStore = new SupabaseDashboardStore({
    from: (tbl) => {
      touchedAuditTables.push(tbl);
      return createTableBuilder(() => [{
        id: 'audit_direct_1',
        actor_username: 'sysadmin',
        action: 'LOGIN',
        target: { ip: '127.0.0.1' },
        details: 'ok',
        timestamp: '2026-11-12T00:00:00Z'
      }]);
    }
  });
  await auditDirectStore.addAudit({ actorId: 'sysadmin', action: 'LOGIN', target: 'dashboard' });
  const directLogs = await auditDirectStore.listAudit(10);
  assert.strictEqual(directLogs.length, 1);
  assert.strictEqual(await auditDirectStore.clearAuditLogs(), true);
  assert.ok(touchedAuditTables.every((t) => t === 'audit_logs'), `Expected audit_logs only, saw ${touchedAuditTables.join(',')}`);

  // 7e. EntitlementService pending allocation columns match manager_pending_allocations schema
  let savedPendingJob = null;
  const entStore = {
    client: null,
    adapter: { savePendingAllocation: async (job) => { savedPendingJob = job; return true; } },
    getAccess: async () => ({ userId: 'usr_alice', username: 'alice', workerIds: [] }),
    assignedUser: async () => null,
    redeemKeyWithAccess: async () => true,
    getKey: async () => ({ keyId: 'k_1', days: 30, botCount: 2, status: 'unused', maxUses: 1, usedCount: 0, workerIds: [] })
  };
  const entService = new EntitlementService({
    store: entStore,
    registry: { list: async () => [{ workerId: '01' }] },
    accessControl: { memberFor: async () => ({ userId: 'usr_alice', username: 'alice', workerIds: [] }) },
    logger: { warn: () => {}, info: () => {} },
    userLock: { run: async (_k, fn) => await fn() }
  });
  await entService.redeem('usr_alice', 'KM-AAAA-BBBB-CCCC');
  assert.ok(savedPendingJob, 'Expected pending allocation when bots < targetCount');
  assert.strictEqual(savedPendingJob.username, 'alice');
  assert.strictEqual(savedPendingJob.targetBotCount, 2);
  assert.strictEqual(savedPendingJob.currentAssigned, 1);
  assert.strictEqual(savedPendingJob.missingBotCount, 1);
  assert.strictEqual(savedPendingJob.status, 'pending_retry');
  assert.strictEqual(savedPendingJob.user_id, undefined);
  assert.strictEqual(savedPendingJob.required_bot_count, undefined);

  let directPendingRow = null;
  const directEntService = new EntitlementService({
    store: {
      client: {
        from: (tbl) => {
          assert.strictEqual(tbl, 'manager_pending_allocations');
          return {
            insert: async (row) => {
              directPendingRow = row;
              return { data: [row], error: null };
            }
          };
        }
      },
      adapter: null,
      assignedUser: async () => null,
      redeemKeyWithAccess: async () => true,
      getKey: async () => ({ keyId: 'k_2', days: 30, botCount: 2, status: 'unused', maxUses: 1, usedCount: 0, workerIds: [] })
    },
    registry: { list: async () => [{ workerId: '01' }] },
    accessControl: { memberFor: async () => ({ userId: 'usr_bob', username: 'bob', workerIds: [] }) },
    logger: { warn: () => {}, info: () => {} },
    userLock: { run: async (_k, fn) => await fn() }
  });
  await directEntService.redeem('usr_bob', 'KM-DDDD-EEEE-FFFF');
  assert.ok(directPendingRow, 'Expected direct manager_pending_allocations insert when adapter is absent');
  assert.strictEqual(directPendingRow.username, 'bob');
  assert.strictEqual(directPendingRow.target_bot_count, 2);
  assert.strictEqual(directPendingRow.current_assigned, 1);
  assert.strictEqual(directPendingRow.missing_bot_count, 1);
  assert.strictEqual(directPendingRow.status, 'pending_retry');
  assert.strictEqual(directPendingRow.user_id, undefined);
  assert.strictEqual(directPendingRow.required_bot_count, undefined);

  // 7f. SupabaseWorkerStore.resetData fallback clears runtime columns cleanly
  let workerResetPayload = null;
  const workerStore = new SupabaseWorkerStore({
    rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'missing rpc' } }),
    from: (tbl) => ({
      update: (payload) => {
        if (tbl === 'manager_workers') workerResetPayload = payload;
        return {
          eq: () => ({
            select: () => ({
              maybeSingle: async () => ({
                data: {
                  worker_id: '01',
                  name: 'Bot 01',
                  settings: {},
                  status: { state: 'offline', online: false },
                  events: [],
                  last_event: null
                },
                error: null
              })
            })
          })
        };
      }
    })
  });
  await workerStore.resetData('01');
  assert.deepStrictEqual(workerResetPayload.settings, {});
  assert.deepStrictEqual(workerResetPayload.status, { state: 'offline', online: false });
  assert.deepStrictEqual(workerResetPayload.events, []);
  assert.strictEqual(workerResetPayload.last_event, null);

  console.log('✅ 7. Reconciled SQL parity, hardening & Phase 6 runtime contracts verified.');
}

(async () => {
  try {
    console.log('--- [STORAGE & SQL STRUCTURAL TESTS] ---');
    await testSqlSchemaStructure();
    await testTrialFallbackConcurrencyAndErrors();
    await testDiscordLinkingFailClosedAndConflicts();
    await testLink4mAndSettingsParity();
    await testCommandStoreTwoPhaseSyncPersistence();
    await testCommandStoreCmdUuidEndToEndContract();
    await testReconciledSchemaAndRuntimeContracts();
    console.log('🎉 ALL STORAGE & SQL TESTS PASSED 100%!');
  } catch (err) {
    console.error('❌ TEST FAILED:', err);
    process.exit(1);
  }
})();
