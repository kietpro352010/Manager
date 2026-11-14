# Handoff Report — Milestone 5: Gate 4 (Database Schema & Security)

## 1. Observation
- **G4-01 Baseline State**:
  In `D:\manager\supabase\reset_and_setup.sql:2425`, `D:\manager\supabase\setup.sql:2332`, `D:\manager\supabase\migrations\20261112000000_reconcile_full_manager_schema.sql:2848`, and `D:\manager\src\storage\schema-sql.js`, the PL/pgSQL function `public.manager_reset_worker_data(p_worker_id text)` ended with:
  ```sql
  WHERE worker_id = p_worker_id;
  RETURN true;
  ```
  This unconditionally returned `true` even when `worker_id` did not match any row (`ROW_COUNT = 0`). In `D:\manager\src\storage\supabase-worker-store.js:162-163`, the caller logic checks `if (data === true) return; throw new Error(...)`, meaning a non-existent worker silently bypassed the error check and appeared to succeed.
- **G4-02 Baseline State**:
  In `D:\manager\supabase\reset_and_setup.sql:9-11`, the table drop loop started directly after `BEGIN; DO $$ DECLARE v_rel record; ...` without any disaster recovery guard, exposing production/staging databases to accidental complete data wipes if run without caution.
- **G4-03 Baseline State**:
  In `D:\manager\supabase\reset_and_setup.sql:3562`, `D:\manager\supabase\setup.sql:3469`, `D:\manager\supabase\migrations\20261112000000_reconcile_full_manager_schema.sql:3960`, and `D:\manager\src\storage\schema-sql.js`, the `UPDATE public.manager_link4m_attempts` inside `public.manager_complete_link4m_reward` only had:
  ```sql
  WHERE attempt_id = p_attempt_id
    AND status = 'processing'
  ```
  It did not verify ownership of the attempt against `p_user_id`, allowing any caller who knew an `attempt_id` to complete an attempt started by another user.
- **G4-04 Baseline State**:
  `tests/storage-sql.test.js` verified 27 tables and 52 RPCs across setup scripts and migrations, but did not assert the `v_row_count` diagnostic in `manager_reset_worker_data`, the disaster recovery guard in `reset_and_setup.sql`, or the `user_id` ownership invariant in `manager_complete_link4m_reward`.

## 2. Logic Chain
- **G4-01 Implementation & Verification**:
  1. Updated `public.manager_reset_worker_data` in all 4 canonical SQL sources (`reset_and_setup.sql`, `setup.sql`, `20261112000000_reconcile_full_manager_schema.sql`, `schema-sql.js`):
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
  2. With `GET DIAGNOSTICS v_row_count = ROW_COUNT; RETURN v_row_count > 0;`, updating an existing worker returns `true`. If 0 rows match, it returns `false`, causing `SupabaseWorkerStore.resetData` to throw `Worker ${workerId} could not be reset or does not exist.` as intended.

- **G4-02 Disaster Recovery Guard**:
  1. Inserted the required guard at the beginning of `reset_and_setup.sql` right after `BEGIN;` and prior to any drop statements:
     ```sql
     -- DISASTER RECOVERY GUARD: Prevent accidental execution on production/staging
     DO $$
     BEGIN
       IF current_setting('kingmc.allow_reset', true) IS DISTINCT FROM 'true' THEN
         RAISE EXCEPTION 'DISASTER RECOVERY GUARD: reset_and_setup.sql will drop all manager and bot tables. To proceed, execute "SET kingmc.allow_reset = ''true'';" before running this script.';
       END IF;
     END $$;
     ```
  2. If `kingmc.allow_reset` is not explicitly set to `'true'`, the script aborts immediately before executing any table or function drop loops.

- **G4-03 User Ownership Invariant**:
  1. Added `AND (user_id IS NULL OR user_id = '' OR user_id = p_user_id)` to the WHERE clause of `UPDATE public.manager_link4m_attempts` in `manager_complete_link4m_reward` across all 4 SQL sources:
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
     ```
  2. If user A attempts to claim user B's attempt, 0 rows match, triggering `IF NOT FOUND THEN RAISE EXCEPTION 'Phiên vượt link không ở trạng thái đang xử lý hoặc đã kết thúc.';`, preventing cross-user attempt hijacking while still supporting legacy rows with empty or null `user_id`.

- **G4-04 4-Way Parity & Regression Tests**:
  1. Created `D:\manager\tests\gate4-database-schema.test.js` validating:
     - G4-01: Ast and runtime simulation of `manager_reset_worker_data` return values.
     - G4-02: Ast and execution simulation of disaster recovery guard.
     - G4-03: Ast and simulation of cross-tenant Link4M reward hijack rejection.
     - G4-04: Full 4-way parity check across all 27 tables, 52 RPCs, views with `security_invoker = true`, and pinned `search_path = public, pg_temp`.
  2. Enhanced `tests/storage-sql.test.js` with direct assertions for G4-01, G4-02, and G4-03.
  3. Integrated `gate4-database-schema.test.js` into `package.json` test script.

## 3. Caveats
- `discord.js` dependency tree on Windows drive D: requires ~30s on cold initial import due to multiple submodules; subsequent executions in warm filesystem cache complete rapidly.
- No caveats regarding schema parity or security invariants; all 27 tables and 52 RPCs are verified in strict 4-way parity.

## 4. Conclusion
Milestone 5 (Gate 4: G4-01 to G4-04) is 100% complete:
- G4-01: `manager_reset_worker_data` captures `ROW_COUNT` and returns `v_row_count > 0` across all 4 canonical SQL sources.
- G4-02: Disaster recovery guard active in `reset_and_setup.sql`.
- G4-03: Link4M user ownership invariant enforced across all 4 SQL sources.
- G4-04: 100% 4-way schema parity verified.
- All test suites pass: `tests/gate4-database-schema.test.js` (100%), `tests/storage-sql.test.js` (100%), `npm test` (7/7 suites, 100%).

## 5. Verification Method
Run the following verification commands in `D:\manager`:
```powershell
cmd /c "cd /d D:\manager && node tests/gate4-database-schema.test.js"
cmd /c "cd /d D:\manager && node tests/storage-sql.test.js"
cmd /c "cd /d D:\manager && npm test"
```
Inspection files:
- `D:\manager\supabase\reset_and_setup.sql`
- `D:\manager\supabase\setup.sql`
- `D:\manager\supabase\migrations\20261112000000_reconcile_full_manager_schema.sql`
- `D:\manager\src\storage\schema-sql.js`
- `D:\manager\tests\gate4-database-schema.test.js`
- `D:\manager\tests\storage-sql.test.js`
