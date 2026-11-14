# Independent Review & Adversarial Critic Report — Milestone 5: Gate 4

**Reviewer & Adversarial Critic**: `reviewer_m5_1`
**Target Milestone**: Milestone 5: Gate 4 (Database Schema & Security: G4-01..04)
**Target Directory**: `D:\manager`
**Verdict**: **APPROVE**

---

## 1. Observation

### 1.1 Direct Source Inspections

1. **G4-01: `manager_reset_worker_data` ROW_COUNT check & boolean return**
   Inspected all 4 canonical SQL sources:
   - `D:\manager\supabase\reset_and_setup.sql:2425-2446`:
     ```sql
     CREATE OR REPLACE FUNCTION public.manager_reset_worker_data(
       p_worker_id text
     )
     RETURNS boolean
     LANGUAGE plpgsql
     SECURITY DEFINER
     SET search_path = public, pg_temp
     AS $reset_data$
     DECLARE
       v_row_count integer := 0;
     BEGIN
       UPDATE public.manager_workers
       SET settings = '{}'::jsonb,
           status = '{"state":"offline","online":false}'::jsonb,
           events = '[]'::jsonb,
           last_event = NULL,
           updated_at = now()
       WHERE worker_id = p_worker_id;
       GET DIAGNOSTICS v_row_count = ROW_COUNT;
       RETURN v_row_count > 0;
     END;
     $reset_data$;
     ```
   - `D:\manager\supabase\setup.sql:2325-2345`: Identical implementation with `DECLARE v_row_count integer := 0;`, `GET DIAGNOSTICS v_row_count = ROW_COUNT;`, and `RETURN v_row_count > 0;`.
   - `D:\manager\supabase\migrations\20261112000000_reconcile_full_manager_schema.sql:2840-2861`: Identical implementation.
   - `D:\manager\src\storage\schema-sql.js` (exported SQL text): Identical implementation.
   - `D:\manager\src\storage\supabase-worker-store.js:157-175`:
     ```javascript
     async resetData(workerId) {
       let rpcError = null;
       try {
         const { data, error } = await this.client.rpc('manager_reset_worker_data', { p_worker_id: workerId });
         if (!error) {
           if (data === true) return;
           throw new Error(`Worker ${workerId} could not be reset or does not exist.`);
         }
         rpcError = error;
       } catch (err) {
         if (err.message && err.message.includes('could not be reset')) {
           throw err;
         }
         rpcError = err;
       }
     ```
     When `manager_reset_worker_data` returns `false` (`v_row_count = 0`), `SupabaseWorkerStore.resetData` detects `data !== true` and throws `Worker ${workerId} could not be reset or does not exist.`, which is rethrown and not swallowed by the fallback.

2. **G4-02: Disaster Recovery Guard in `reset_and_setup.sql`**
   - `D:\manager\supabase\reset_and_setup.sql:11-17`:
     ```sql
     -- DISASTER RECOVERY GUARD: Prevent accidental execution on production/staging
     DO $$
     BEGIN
       IF current_setting('kingmc.allow_reset', true) IS DISTINCT FROM 'true' THEN
         RAISE EXCEPTION 'DISASTER RECOVERY GUARD: reset_and_setup.sql will drop all manager and bot tables. To proceed, execute "SET kingmc.allow_reset = ''true'';" before running this script.';
       END IF;
     END $$;
     ```
     Located directly after `BEGIN;` at line 9 and strictly before the table drop loop at line 25 (`FOR v_rel IN SELECT c.relname...`).

3. **G4-03: `manager_complete_link4m_reward` user ownership invariant**
   - In all 4 canonical SQL sources (`reset_and_setup.sql:3572-3575`, `setup.sql:3471-3474`, `20261112000000_reconcile_full_manager_schema.sql:3960-3963`, `schema-sql.js`):
     ```sql
     UPDATE public.manager_link4m_attempts
     SET status = 'rewarded',
         rewarded_at = v_now,
         completed_at = v_now,
         verified_at = COALESCE(verified_at, v_now),
         updated_at = v_now
     WHERE attempt_id = p_attempt_id
       AND status = 'processing'
       AND (user_id IS NULL OR user_id = '' OR user_id = p_user_id)
     RETURNING * INTO v_attempt;

     IF NOT FOUND THEN
       RAISE EXCEPTION 'Phiên vượt link không ở trạng thái đang xử lý hoặc đã kết thúc.';
     END IF;
     ```
     Enforces that if `user_id` is set on the attempt, only `p_user_id` matching `user_id` can update and complete the reward. Attempts belonging to other users fail with `NOT FOUND` exception.

4. **G4-04: 100% 4-Way Schema Parity**
   - Table count across all 4 sources: exactly 27 tables.
   - RPC count across all 4 sources: exactly 52 RPCs.
   - Parameter signatures across all 52 RPCs: 0 divergences.
   - All 52 RPCs declare `SECURITY DEFINER` and `SET search_path = public, pg_temp`.
   - All 52 RPCs declare `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated;` and `GRANT EXECUTE ON FUNCTION ... TO service_role;`.
   - All 4 views (`manager_audit`, `backups`, `system_settings`, `bot_schedules`) declare `WITH (security_invoker = true)`.

### 1.2 Command Execution & Tool Outputs

1. **Gate 4 Suite**:
   Command: `cmd /c "cd /d D:\manager && node tests/gate4-database-schema.test.js"`
   Exit Code: 0
   Output:
   ```
   === [GATE 4 DATABASE SCHEMA & SECURITY VERIFICATION (G4-01 to G4-04)] ===
   1. [G4-01] Testing manager_reset_worker_data ROW_COUNT check & boolean return...
   ✅ 1. [G4-01] manager_reset_worker_data ROW_COUNT check & boolean return verified.
   2. [G4-02] Testing reset_and_setup.sql Disaster Recovery Guard...
   ✅ 2. [G4-02] reset_and_setup.sql Disaster Recovery Guard verified.
   3. [G4-03] Testing manager_complete_link4m_reward user ownership invariant...
   ✅ 3. [G4-03] manager_complete_link4m_reward user ownership invariant verified.
   4. [G4-04] Testing Database 4-way schema parity validation across migrations and setup scripts...
   ✅ 4. [G4-04] Database 4-way schema parity validation passed (27 tables, 52 RPCs, all SECURITY DEFINER & pinned search_path).
   🎉 ALL GATE 4 DATABASE SCHEMA & SECURITY TESTS PASSED 100%!
   ```

2. **Storage SQL Suite**:
   Command: `cmd /c "cd /d D:\manager && node tests/storage-sql.test.js"`
   Exit Code: 0
   Output:
   ```
   --- [STORAGE & SQL STRUCTURAL TESTS] ---
   1. Checking SQL DDL ordering, tables, columns & RPC definitions...
   ✅ 1. SQL DDL & RPC structural validation passed.
   2. Checking Trial Fallback concurrency serialization, RPC errors & 23505 rollback...
   ✅ 2. Trial fallback concurrency, RPC fail-closed & 23505 rollback passed.
   3. Checking Discord link/unlink conflict & permission failure handling...
   ✅ 3. Discord link/unlink fail-closed & conflict checks passed.
   4. Checking Link4M dual-column persistence & getSetting array preservation...
   ✅ 4. Link4M dual-column parity & settings array preservation passed.
   5. Checking SupabaseCommandStore two-phase RESET states, lease exclusion & clearWorker safety...
   ✅ 5. SupabaseCommandStore two-phase RESET states, fencing & fail-closed RPC enforcement verified.
   6. Checking cmd_<UUID> end-to-end RPC parameter contract against SQL definitions...
   ✅ 6. cmd_<UUID> end-to-end RPC contract across SQL signatures verified.
   7. Checking reconciled SQL parity, security hardening & Phase 6 runtime fixes...
   ✅ 7. Reconciled SQL parity, hardening & Phase 6 runtime contracts verified.
   🎉 ALL STORAGE & SQL TESTS PASSED 100%!
   ```

3. **Full Manager Test Suite**:
   Command: `cmd /c "cd /d D:\manager && npm test"`
   Exit Code: 0
   Output:
   - `tests/integration.test.js`: 15/15 tests passed
   - `tests/services-wiring.test.js`: 14/14 tests passed
   - `tests/storage-sql.test.js`: 7/7 suites passed
   - `tests/auth-regression.test.js`: 8/8 tests passed
   - `tests/worker-registry-audit.test.js`: 10/10 tests passed
   - `tests/command-execution-audit.test.js`: 15/15 tests passed
   - `tests/gate4-database-schema.test.js`: 4/4 suites passed
   Total: 7/7 test suites passed 100%.

4. **Regression Tests for Prior Milestones (Gate 3 M1-M4)**:
   Command: `cmd /c "cd /d D:\manager && node tests/gate3-m1-concurrency.test.js && node tests/gate3-m2-access-control.test.js && node tests/gate3-m3-discord-router.test.js && node tests/gate3-m4-backup-admin.test.js"`
   Exit Code: 0
   Output:
   - Gate 3 M1 (P6-01 to P6-08): 7/7 tests passed 100%
   - Gate 3 M2 (ACC-11-01 to ACC-11-04): 4/4 tests passed 100%
   - Gate 3 M3 (DIS-12-01 to DIS-12-05, API-01 to API-04): 9/9 tests passed 100%
   - Gate 3 M4 (P7-01 to P7-03, ADM-20-01 to ADM-20-02): 6/6 tests passed 100%

---

## 2. Logic Chain

1. **G4-01 Verification**:
   - Upstream claim: `manager_reset_worker_data` captures `ROW_COUNT` and returns `v_row_count > 0`, causing caller `SupabaseWorkerStore.resetData` to throw on non-existent worker.
   - Observation 1.1 shows lines 2443-2444 of `reset_and_setup.sql`, lines 2342-2343 of `setup.sql`, lines 2858-2859 of migration, and `schema-sql.js` all contain:
     `GET DIAGNOSTICS v_row_count = ROW_COUNT; RETURN v_row_count > 0;`.
   - Observation 1.1 shows lines 162-163 of `supabase-worker-store.js` checks `if (data === true) return; throw new Error(...)`.
   - Observation 1.2 shows `gate4-database-schema.test.js` and `storage-sql.test.js` successfully verify that resetting an existing worker returns `true`, and resetting a non-existent worker throws `Worker ${workerId} could not be reset or does not exist.`.
   - Conclusion: G4-01 is verified and functioning as specified.

2. **G4-02 Verification**:
   - Upstream claim: Disaster recovery guard is active in `reset_and_setup.sql`.
   - Observation 1.1 shows lines 11-17 of `reset_and_setup.sql` checks `current_setting('kingmc.allow_reset', true) IS DISTINCT FROM 'true'`.
   - Because `missing_ok = true` is passed to `current_setting`, unset sessions evaluate to `NULL`, and `NULL IS DISTINCT FROM 'true'` evaluates to `true`, triggering `RAISE EXCEPTION`.
   - The guard is placed at line 11, strictly before line 25 where the table drop loop executes.
   - Observation 1.2 shows test 2 of `gate4-database-schema.test.js` and section 1 of `storage-sql.test.js` verify this logic.
   - Conclusion: G4-02 is verified and functioning as specified.

3. **G4-03 Verification**:
   - Upstream claim: `manager_complete_link4m_reward` enforces Link4M user ownership invariant.
   - Observation 1.1 shows the WHERE clause of `UPDATE public.manager_link4m_attempts` in all 4 canonical SQL sources contains `AND (user_id IS NULL OR user_id = '' OR user_id = p_user_id)`.
   - If user Alice attempts to complete an attempt with `user_id = 'usr_bob'`, the row fails the predicate, triggering `IF NOT FOUND THEN RAISE EXCEPTION 'Phiên vượt link không ở trạng thái đang xử lý hoặc đã kết thúc.';`.
   - Legacy and anonymous attempts where `user_id IS NULL OR user_id = ''` remain supported.
   - Observation 1.2 shows test 3 of `gate4-database-schema.test.js` and section 1 of `storage-sql.test.js` verify both valid completions and cross-user hijack rejections.
   - Conclusion: G4-03 is verified and functioning as specified.

4. **G4-04 Verification**:
   - Upstream claim: 100% 4-way schema parity across all 4 SQL sources.
   - Observation 1.1 & 1.2 confirm that `schema-sql.js`, `reset_and_setup.sql`, `setup.sql`, and `migrations` contain identical table sets (27 tables), identical function sets (52 RPCs), identical function parameter signatures, `SECURITY DEFINER` with `SET search_path = public, pg_temp` on all functions, minimal public permissions (`REVOKE ALL FROM PUBLIC`), and `security_invoker = true` on all 4 views.
   - Conclusion: G4-04 is verified.

5. **Integrity Violations Check**:
   - No hardcoded test results embedded in source code.
   - No dummy/facade implementations.
   - No task shortcuts taken.
   - No fabricated logs or outputs; all tests independently reproduced and executed with exit code 0.
   - Conclusion: Integrity check is CLEAN.

---

## 3. Adversarial Analysis & Stress Testing

### 3.1 Challenge Dimensions

1. **Disaster Recovery Guard Bypass Attempt**:
   - *Attack Scenario*: Can an accidental run pass the guard if `kingmc.allow_reset` is set to an arbitrary truthy value (e.g. `'1'`, `'yes'`, `'TRUE'`, `'on'`)?
   - *Result*: In PostgreSQL, `current_setting('kingmc.allow_reset', true)` returns the exact text setting. `'1' IS DISTINCT FROM 'true'` evaluates to `true`. Only the exact case-sensitive string `'true'` satisfies `NOT (val IS DISTINCT FROM 'true')`.
   - *Attack Scenario*: What if a user executes `reset_and_setup.sql` in a transaction where another tool set a configuration variable? The setting namespace `kingmc.allow_reset` is application-specific and will not collide with Postgres built-in GUCs.

2. **Link4M User Invariant Exploitation**:
   - *Attack Scenario*: Attacker attempts to forge `p_user_id` as empty string `''` or `NULL` to claim another user's attempt.
   - *Result*: If attempt has `user_id = 'usr_victim'`, and `p_user_id` is passed as `''`, `user_id = p_user_id` evaluates to `'usr_victim' = ''` which is `false`. `user_id IS NULL` is `false`, and `user_id = ''` is `false`. Update does not match, raising `NOT FOUND`.
   - *Attack Scenario*: Attacker passes SQL injection inside `p_user_id`.
   - *Result*: All RPC arguments are strongly typed PL/pgSQL parameters (`p_user_id text`), handled via parameterized SQL and AST binding, preventing SQL injection.

3. **Concurrency & Race Conditions in `manager_reset_worker_data`**:
   - *Attack Scenario*: Two concurrent callers attempt to reset the same worker simultaneously.
   - *Result*: Postgres row-level locking on `UPDATE public.manager_workers` serializes both transactions. Both find the row and both capture `ROW_COUNT = 1`, safely returning `true` without deadlocks.

---

## 4. Caveats

- Tests were executed via Node.js AST parsing, regex validation, and simulated PostgreSQL driver/RPC harnesses matching the manager test framework. Live execution against a production Supabase instance was not performed, in strict compliance with the KBOT Engineering Contract ("Never run destructive SQL, production migrations, production deploys... without explicit user authorization").
- `D:\manager` working tree was strictly preserved (no files modified, no working tree drift).

---

## 5. Conclusion & Verdict

**Verdict**: **APPROVE**

All acceptance criteria for Milestone 5: Gate 4 (G4-01 through G4-04) are satisfied with high engineering quality, strict 4-way schema parity, resilient security controls, zero regressions across prior milestones (Gate 3 M1-M4), and zero integrity violations.

---

## 6. Verification Method

To independently verify this report in `D:\manager`:
```powershell
cmd /c "cd /d D:\manager && node tests/gate4-database-schema.test.js"
cmd /c "cd /d D:\manager && node tests/storage-sql.test.js"
cmd /c "cd /d D:\manager && npm test"
cmd /c "cd /d D:\manager && node tests/gate3-m1-concurrency.test.js && node tests/gate3-m2-access-control.test.js && node tests/gate3-m3-discord-router.test.js && node tests/gate3-m4-backup-admin.test.js"
```

Inspection files:
- `D:\manager\supabase\reset_and_setup.sql` (lines 11-17, 2425-2446, 3572-3575)
- `D:\manager\supabase\setup.sql` (lines 2325-2345, 3471-3474)
- `D:\manager\supabase\migrations\20261112000000_reconcile_full_manager_schema.sql` (lines 2840-2861, 3960-3963)
- `D:\manager\src\storage\schema-sql.js`
- `D:\manager\src\storage\supabase-worker-store.js` (lines 157-175)
- `D:\manager\tests\gate4-database-schema.test.js`
- `D:\manager\tests\storage-sql.test.js`
