## 2026-11-14T12:12:36Z

You are a teamwork_worker implementing Milestone 5: Gate 4 (Database Schema & Security: G4-01 to G4-04) in D:\manager.

Working directory: D:\manager
State folder: C:\Users\kietp\.gemini\antigravity\scratch\teamwork\6242db72-e099-40d9-9962-cb0de56ae2b0\.agents\teamwork\teamwork_worker_m5\
Original request path: C:\Users\kietp\.gemini\antigravity\scratch\teamwork\6242db72-e099-40d9-9962-cb0de56ae2b0\.agents\teamwork\ORIGINAL_REQUEST.md
Scope document: C:\Users\kietp\.gemini\antigravity\scratch\teamwork\6242db72-e099-40d9-9962-cb0de56ae2b0\.agents\teamwork\PROJECT.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Baseline Survey Findings & Implementation Tasks:

1. G4-01: In `manager_reset_worker_data`, verify `GET DIAGNOSTICS v_row_count = ROW_COUNT;` and return `v_row_count > 0;`. Apply this update across ALL 4 canonical SQL sources:
   - `D:\manager\supabase\reset_and_setup.sql:2417`
   - `D:\manager\supabase\setup.sql:2417`
   - `D:\manager\src\storage\schema-sql.js`
   - `D:\manager\supabase\migrations\20261112000000_reconcile_full_manager_schema.sql:2840`

   SQL implementation pattern:
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

2. G4-02: In `D:\manager\supabase\reset_and_setup.sql`, add a disaster recovery guard at the very beginning (right before table drops):
   ```sql
   -- DISASTER RECOVERY GUARD: Prevent accidental execution on production/staging
   DO $$
   BEGIN
     IF current_setting('kingmc.allow_reset', true) IS DISTINCT FROM 'true' THEN
       RAISE EXCEPTION 'DISASTER RECOVERY GUARD: reset_and_setup.sql will drop all manager and bot tables. To proceed, execute "SET kingmc.allow_reset = ''true'';" before running this script.';
     END IF;
   END $$;
   ```

3. G4-03: In `manager_complete_link4m_reward`, enforce the user ownership invariant `AND (user_id IS NULL OR user_id = '' OR user_id = p_user_id)` in the `UPDATE manager_link4m_attempts` WHERE clause. Apply across:
   - `D:\manager\supabase\reset_and_setup.sql:3556`
   - `D:\manager\supabase\setup.sql:3556`
   - `D:\manager\src\storage\schema-sql.js`
   - `D:\manager\supabase\migrations\20261112000000_reconcile_full_manager_schema.sql:3956`

4. G4-04: Database 4-way schema parity validation across migrations and setup scripts:
   Ensure `node tests/storage-sql.test.js` passes with 100% exact parity across all 27 tables, 52 RPCs, indexes, security definer attributes, and search_path definitions.

5. Dedicated Testing & Regression:
   - Create `D:\manager\tests\gate4-database-schema.test.js` to systematically verify:
     - `manager_reset_worker_data` returns false when worker_id does not exist or matches 0 rows, and true when 1 row updated.
     - `reset_and_setup.sql` contains the disaster recovery guard aborting execution unless `kingmc.allow_reset = 'true'`.
     - `manager_complete_link4m_reward` enforces `(user_id IS NULL OR user_id = '' OR user_id = p_user_id)`.
     - Schema parity across all 4 SQL files passes.
   - Run:
     `cmd /c "cd /d D:\manager && node tests/gate4-database-schema.test.js"`
     `cmd /c "cd /d D:\manager && node tests/storage-sql.test.js"`
     `cmd /c "cd /d D:\manager && npm test"`

Report results in `handoff.md` in your state folder and send a message back.


## 2026-11-14T12:27:47Z

**Context**: Milestone 5 Implementation
**Content**: URGENT USER DIRECTIVE: "dẩy nhanh tốc độ công việc, mà vẫn đảm bảo chất lượng, không lo vấn đề hết quota". Complete the edits to schema-sql.js and run tests immediately at full speed!
**Action**: Finish G4-01..04 edits, run gate4 and storage-sql tests, deliver handoff.md promptly.
