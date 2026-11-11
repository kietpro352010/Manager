'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const schemaSql = require('../src/storage/schema-sql');
const SupabaseDashboardStore = require('../src/storage/supabase-dashboard-store');
const SupabaseCommandStore = require('../src/storage/supabase-command-store');

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

  // 1k. Verify two-phase command execution & state sync RPCs
  assert.ok(schemaSql.includes('idx_manager_commands_status_created'), 'Expected idx_manager_commands_status_created index');
  const recExecFn = extractFunctionBlock(schemaSql, 'manager_record_command_execution');
  assert.match(recExecFn, /status = 'execution_completed'/);
  assert.match(recExecFn, /completed_at = NULL/);
  assert.match(recExecFn, /FOR UPDATE/);
  const markSyncFn = extractFunctionBlock(schemaSql, 'manager_mark_command_sync_pending');
  assert.match(markSyncFn, /'state_sync_failed'/);
  assert.match(markSyncFn, /'state_sync_pending'/);
  assert.match(markSyncFn, /completed_at = NULL/);
  const finSyncFn = extractFunctionBlock(schemaSql, 'manager_finalize_command_sync');
  assert.match(finSyncFn, /status = 'completed'/);
  assert.match(finSyncFn, /- '_stateSync'/);
  assert.match(finSyncFn, /completed_at = v_now/);
  const claimSyncFn = extractFunctionBlock(schemaSql, 'manager_claim_pending_command_syncs');
  assert.match(claimSyncFn, /FOR UPDATE OF c SKIP LOCKED/);
  assert.match(claimSyncFn, /'state_sync_pending', 'execution_completed'/);

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
  const client = {
    async rpc() {
      return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    },
    from: (table) => {
      if (table !== 'manager_commands') return createTableBuilder(() => []);
      return createTableBuilder(() => rows, {
        onInsert: async (row) => {
          rows.push({ ...row });
          return { data: [{ ...row }], error: null };
        }
      });
    }
  };

  const cmdStore = new SupabaseCommandStore(client);
  await cmdStore.enqueue({ commandId: 'cmd_reset_s1', workerId: 'bot-s1', action: 'reset', payload: {} });
  const taken = await cmdStore.take('bot-s1');
  assert.strictEqual(taken?.commandId, 'cmd_reset_s1');
  await cmdStore.enqueue({ commandId: 'cmd_queued_s2', workerId: 'bot-s1', action: 'status', payload: {} });

  // 5a. recordExecutionCompleted marks 'execution_completed' without setting completed_at
  const recA = await cmdStore.recordExecutionCompleted('bot-s1', 'cmd_reset_s1', { ok: true, state: 'stopped' }, {
    leaseOwner: 'mgr_A',
    leaseSeconds: 30,
    candidateStatus: { state: 'stopped' },
    pendingSteps: ['registry.resetData']
  });
  assert.strictEqual(recA.ok, true);
  assert.strictEqual(recA.status, 'execution_completed');

  const rowAfterRec = rows.find((r) => r.command_id === 'cmd_reset_s1');
  assert.strictEqual(rowAfterRec.status, 'execution_completed');
  assert.strictEqual(rowAfterRec.completed_at, null);

  // 5b. Concurrent recordExecutionCompleted from another lease owner is rejected while leased
  const recB = await cmdStore.recordExecutionCompleted('bot-s1', 'cmd_reset_s1', { ok: true, state: 'stopped' }, {
    leaseOwner: 'mgr_B',
    leaseSeconds: 30
  });
  assert.strictEqual(recB.ok, false);
  assert.strictEqual(recB.error, 'STATE_SYNC_IN_PROGRESS');

  // 5c. markStateSyncPending releases lease & transitions to 'state_sync_pending'
  const marked = await cmdStore.markStateSyncPending('bot-s1', 'cmd_reset_s1', {
    result: { ok: true, state: 'stopped' },
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

  // 5e. claimPendingStateSyncBatch grants lease to mgr_B and prevents duplicate claim by mgr_C
  const claimedB = await cmdStore.claimPendingStateSyncBatch('mgr_B', 10, 60);
  assert.strictEqual(claimedB.length, 1);
  assert.strictEqual(claimedB[0].commandId, 'cmd_reset_s1');
  const claimedC = await cmdStore.claimPendingStateSyncBatch('mgr_C', 10, 60);
  assert.strictEqual(claimedC.length, 0, 'Active lease must prevent duplicate claim');

  // 5f. Compare-on-owner rejects finalizeCompleted from wrong owner, accepts from lease owner & strips _stateSync
  const wrongOwnerFinalize = await cmdStore.finalizeCompleted('bot-s1', 'cmd_reset_s1', null, { leaseOwner: 'mgr_C' });
  assert.strictEqual(wrongOwnerFinalize, false);
  const okFinalize = await cmdStore.finalizeCompleted('bot-s1', 'cmd_reset_s1', { ok: true, state: 'stopped' }, { leaseOwner: 'mgr_B' });
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

  console.log('✅ 5. SupabaseCommandStore two-phase RESET states & safety verified.');
}

(async () => {
  try {
    console.log('--- [STORAGE & SQL STRUCTURAL TESTS] ---');
    await testSqlSchemaStructure();
    await testTrialFallbackConcurrencyAndErrors();
    await testDiscordLinkingFailClosedAndConflicts();
    await testLink4mAndSettingsParity();
    await testCommandStoreTwoPhaseSyncPersistence();
    console.log('🎉 ALL STORAGE & SQL TESTS PASSED 100%!');
  } catch (err) {
    console.error('❌ TEST FAILED:', err);
    process.exit(1);
  }
})();
