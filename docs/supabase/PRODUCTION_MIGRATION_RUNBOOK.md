# Production Migration Runbook (Phase 7)

Step-by-step operator guide for safely applying [`supabase/migrations/20261112000000_reconcile_full_manager_schema.sql`](file:///D:/manager%20deploy/supabase/migrations/20261112000000_reconcile_full_manager_schema.sql) to an existing Supabase production database.

> [!CAUTION]
> **NEVER** run [`supabase/reset_and_setup.sql`](file:///D:/manager%20deploy/supabase/reset_and_setup.sql) against production — Part 1 permanently drops all Manager/Bot tables, views, sequences, and functions with `CASCADE`.
> **NEVER** store database passwords, `service_role` keys, or `.env` secrets inside git-tracked files, terminal logs, or pasted runbook examples.

---

## 1. Preconditions & Maintenance Window

1. Confirm all CI checks on the target commit pass on GitHub Actions (`.github/workflows/ci.yml`), including `tests/postgres-real.test.js`.
2. Ensure the Manager codebase deployed (or staged to deploy immediately alongside the migration) includes Phase 6 runtime updates (`SupabaseAdapter.testConnection()` 26 tables / 46 RPCs, `manager_delete_user_access`, `audit_logs` route/store alignment, `manager_pending_allocations` columns).
3. Pause or drain Manager instances briefly during the maintenance window to prevent concurrent table lock contention (`ACCESS EXCLUSIVE` during legacy column conversions).

---

## 2. Step 1 — Preflight Inspection (Read-Only)

Run the following **read-only** SQL queries in Supabase Dashboard -> **SQL Editor** (or read-only `psql`) to baseline current production object state and detect any data anomalies before migration:

```sql
-- 1) Current public tables & views
SELECT c.relname AS object_name, c.relkind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v')
ORDER BY c.relkind, c.relname;

-- 2) Current migration history (if table exists)
SELECT to_regclass('public.manager_schema_migrations') AS migration_table;

-- 3) Legacy row counts baseline (run only queries for tables that exist in #1)
SELECT 'manager_workers' AS tbl, count(*) FROM public.manager_workers
UNION ALL SELECT 'manager_commands', count(*) FROM public.manager_commands
UNION ALL SELECT 'manager_keys', count(*) FROM public.manager_keys
UNION ALL SELECT 'manager_link4m_attempts', count(*) FROM public.manager_link4m_attempts;

-- 4) Inspect manager_commands.command_id type and bad statuses/values before migration
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('manager_commands', 'manager_keys', 'manager_link4m_attempts', 'manager_workers')
ORDER BY table_name, ordinal_position;

-- 5) Check for NULL/blank usernames or duplicate Discord links that might affect unique constraints
SELECT count(*) AS null_or_empty_usernames
FROM public.manager_users
WHERE username IS NULL OR btrim(username) = '';

-- (Optional if manager_access exists instead of manager_users)
-- SELECT count(*) AS access_rows, count(DISTINCT user_id) AS distinct_users FROM public.manager_access;
```

**Preflight Stop Conditions**:
- If an existing `manager_commands` row contains a non-standard `status` outside `('queued', 'delivered', 'execution_completed', 'state_sync_pending', 'state_sync_failed', 'completed', 'failed', 'expired')`, inspect and normalize those rows before running the migration (otherwise `ADD CONSTRAINT manager_commands_status_check` will abort the transaction safely).
- If an existing `manager_workers.bot_number` exceeds 32-bit signed integer (`2,147,483,647`), investigate before promoting `bigint -> integer`.

---

## 3. Step 2 — Full Backup & Scratch Restore Drill

Take a verifiable logical + physical backup **before** executing any write SQL:

1. **Supabase Point-in-Time Recovery / Automated Snapshot**: Verify in Supabase Dashboard (`Database -> Backups`) that a clean pre-maintenance checkpoint exists (record its exact timestamp/label).
2. **Logical Backup (`pg_dump`)** using the project's direct Postgres connection URI from your local operator shell (`SUPABASE_DB_URL` exported privately in shell, never committed):

```bash
# Linux / macOS / WSL operator shell (do NOT log SUPABASE_DB_URL)
pg_dump "$SUPABASE_DB_URL" --format=custom --no-owner --no-acl -f "manager_prod_pre_20261112_$(date +%Y%m%d_%H%M%S).dump"
```

3. **Restore Verification Drill**: Test restoring that `.dump` into a local/staging Postgres 16 database (`pg_restore --clean --if-exists -d "$STAGING_DB_URL" manager_prod_pre_*.dump`) and verify staging row counts match Step 1.

---

## 4. Step 3 — Execute Convergence Migration in Production

Apply [`supabase/migrations/20261112000000_reconcile_full_manager_schema.sql`](file:///D:/manager%20deploy/supabase/migrations/20261112000000_reconcile_full_manager_schema.sql) as a **single atomic transaction**.

- **Option A (Recommended — `psql` CLI with explicit error halt)**:
```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261112000000_reconcile_full_manager_schema.sql
```
- **Option B (Supabase Dashboard SQL Editor)**:
  1. Open Supabase Dashboard -> **SQL Editor** -> New Query.
  2. Paste the **entire contents** of `supabase/migrations/20261112000000_reconcile_full_manager_schema.sql` (`BEGIN;` through `NOTIFY pgrst, 'reload schema';`).
  3. Click **Run** and confirm success with zero SQL errors.

---

## 5. Step 4 — Post-Migration Database Verification SQL

Run these read-only queries immediately after Step 3 commits:

```sql
-- 1) Canonical object inventory check (expect: base_tables >= 27, views = 4, sequence >= 1, triggers = 5, functions = 51)
SELECT
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND c.relname NOT IN ('manager_access', 'manager_worker_assignments', 'manager_counters')) AS canonical_base_tables,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'v'
     AND c.relname IN ('manager_audit', 'backups', 'system_settings', 'bot_schedules')) AS canonical_views,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'S'
     AND c.relname = 'manager_bot_number_seq') AS canonical_sequence,
  (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND NOT t.tgisinternal) AS canonical_triggers,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public') AS total_public_functions;

-- 2) Security & hardening verification (MUST return 0 rows for unhardened views/functions)
SELECT c.relname AS view_missing_security_invoker
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'v'
  AND NOT (COALESCE(c.reloptions, '{}'::text[]) @> ARRAY['security_invoker=true']);

SELECT p.proname AS unhardened_function
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (
    NOT p.prosecdef
    OR NOT COALESCE(p.proconfig, '{}'::text[]) @> ARRAY['search_path=public, pg_temp']
    OR has_function_privilege('public', p.oid, 'EXECUTE')
    OR has_function_privilege('anon', p.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
  );

-- 3) Verify manager_commands.command_id is text and recorded migrations are present
SELECT data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'manager_commands' AND column_name = 'command_id';

SELECT version, applied_at FROM public.manager_schema_migrations ORDER BY version;

-- 4) Verify row preservation matches preflight counts
SELECT
  (SELECT count(*) FROM public.audit_logs) AS audit_logs_count,
  (SELECT count(*) FROM public.manager_users) AS manager_users_count,
  (SELECT count(*) FROM public.manager_assignments) AS manager_assignments_count,
  (SELECT count(*) FROM public.manager_keys) AS manager_keys_count,
  (SELECT count(*) FROM public.manager_workers) AS manager_workers_count,
  (SELECT count(*) FROM public.manager_commands) AS manager_commands_count;
```

---

## 6. Step 5 — Manager Runtime Rollout & Smoke Checks

1. Deploy / start the reconciled Manager application build (with updated `supabase-client.js`, `supabase-dashboard-store.js`, `supabase-worker-store.js`, `entitlement-service.js`, `link4m-service.js`, `admin-api.js`).
2. Verify HTTP readiness and health probes:
   - `GET /health` -> HTTP `200`, JSON contains `"ok": true`, `"degraded": false`, `"status": "healthy"`, `"checks": { "link4m": ..., "commandSyncRpc": { "ok": true, ... } }`.
   - `GET /ready` (or `GET /api/ready`) -> HTTP `200` (proves `testConnection()` verified all **26** `SUPABASE_REQUIRED_TABLES` + all **46** runtime RPCs and Discord Gateway readiness if configured).
3. Perform 1 safe read/write smoke cycle in staging or controlled admin action (e.g., open audit logs in Admin UI, inspect `/ready`, confirm zero `PGRST202` / `PGRST204` / `42501` warnings in logs).

---

## 7. Failure Handling & Emergency Rollback

1. **Failure During Migration (`Step 3`)**:
   - Because `20261112000000_reconcile_full_manager_schema.sql` runs inside `BEGIN; ... COMMIT;`, PostgreSQL rolls back automatically on error.
   - Read the exact SQL error + conflicting table/constraint, leave maintenance mode active, inspect offending legacy rows, and do **not** manually drop tables.
2. **Post-Commit Application Issue (`Step 5`)**:
   - **Preferred (zero data loss after cutover)**: Deploy an additive forward fix or restore PostgreSQL functions cleanly without dropping tables.
   - **Full State Revert (if rollback before traffic resume is required)**: Restore from Supabase PITR checkpoint recorded in Step 2 or `pg_restore` from `manager_prod_pre_*.dump` into a clean target instance / recovery project and redeploy the previous Manager commit.
