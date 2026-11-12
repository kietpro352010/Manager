# Production Database Migration Plan (Phase 3)

This document defines the zero-data-loss database convergence architecture for upgrading existing Supabase PostgreSQL environments of `kietpro352010/Manager` to the canonical schema without dropping live customer, key, assignment, session, audit, or command data.

---

## 1. Objectives & Strict Safety Invariants

1. **Customer Data Preservation**: Every existing row across `manager_workers`, `manager_commands`, `manager_keys`, `manager_link4m_attempts`, `manager_settings`, `manager_audit`, `manager_access`, `manager_worker_assignments`, `manager_counters`, and any partial web/runtime tables is preserved or promoted without losing customer, key, assignment, session, command, or audit rows.
2. **Never Execute `reset_and_setup.sql` on Production**: `supabase/reset_and_setup.sql` issues wholesale `DROP TABLE ... CASCADE` / `DROP FUNCTION ... CASCADE` in Part 1 and is restricted strictly to disposable test sandboxes.
3. **Transactional Atomicity**: [`supabase/migrations/20261112000000_reconcile_full_manager_schema.sql`](file:///D:/manager%20deploy/supabase/migrations/20261112000000_reconcile_full_manager_schema.sql) and [`supabase/migrations/20261112120000_session_revocation_and_migration_guards.sql`](file:///D:/manager%20deploy/supabase/migrations/20261112120000_session_revocation_and_migration_guards.sql) run inside `BEGIN; ... COMMIT;` followed by `NOTIFY pgrst, 'reload schema';`. Any error aborts cleanly without leaving half-migrated tables or broken function overloads.
4. **Idempotent Re-execution**: Safe to apply over:
   - Legacy 10-table Discord-origin schemas (`20261107`–`20261111120000`),
   - Pre-fix schemas with `manager_commands.command_id` typed as `uuid` and legacy `worker_id` FK,
   - Partial `schema-sql.js` deployments missing newer RPCs or constraints,
   - Already-converged databases (no-op idempotency).

---

## 2. How Convergence Migrations Handle Legacy Incompatibilities

| Area | Pre-Convergence Risk / State | Controlled Upgrade Strategy (`20261112000000` + `20261112120000`) |
|---|---|---|
| `manager_audit` (base table vs view collision) | `20261107` created `manager_audit` as a 6-column identity table; canonical schema expects `audit_logs` (table) + `manager_audit` (`security_invoker` view). | **Stage A1–A2 (`20261112000000`)**: Fails fast if external FKs or views depend on `manager_audit`. Creates `public.audit_logs`, copies every row (`id = 'legacy_audit_' \|\| ma.id::text`, `ON CONFLICT (id) DO NOTHING`), asserts `COUNT(audit_logs) >= COUNT(manager_audit)` for copied rows, and performs a controlled replacement `DROP TABLE public.manager_audit` (only when `relkind IN ('r','p')`) immediately followed by `CREATE OR REPLACE VIEW public.manager_audit WITH (security_invoker = true)`. |
| `manager_access`, `manager_worker_assignments`, `manager_counters` | Legacy 10-table Discord tables replaced canonically by `manager_users`, `manager_assignments`, `manager_discord_links`, and `manager_bot_number_seq`. | **Stage A3–A4**: Backfills `manager_worker_assignments -> manager_assignments`, `manager_access -> manager_users` + `manager_discord_links`, and syncs `manager_bot_number_seq` to `GREATEST(MAX(bot_number), counter.value)`. Retains all three legacy tables intact behind RLS (`service_role` only). |
| `manager_workers` | Legacy `bot_number bigint`, strict `CHECK`s (`name`, `provider`, `worker_id`), nullable differences. | **Stage A4**: Fails fast if external views depend on `bot_number` or any value falls outside 32-bit `integer`, drops narrow legacy `CHECK`s, converts `bot_number` to `integer`, and relaxes legacy `NOT NULL` on `name`/`provider`/`secret_ciphertext`. |
| `manager_keys` | Legacy `key_id` PK, `worker_ids text[]`, `used_users text[]`, strict `code_hash` regex / `NOT NULL`. | **Stage A5**: Drops narrow legacy `CHECK`s, checks for external FKs referencing `manager_keys_pkey` and duplicate/NULL `id` values before swapping PK, converts `worker_ids` & `used_users` from `text[]` to `jsonb`, drops `NOT NULL` on Discord-only fields, and promotes `id` to `PRIMARY KEY` (with unique index on `key_id`). |
| `manager_link4m_attempts` | Legacy Discord snowflake regex `user_id ~ '^[0-9]{17,20}$'`, `daily_date date NOT NULL`, missing Web columns. | **Stage A6**: Drops narrow legacy `CHECK`s (matching `user_id ~`, `status IN / ANY`, `daily_date`, `attempt_id`, `code`, `token_hash`), adds missing Web columns (`username`, `vietnam_date`, `provider_short_url`, etc.), converts `daily_date date -> text` (`YYYY-MM-DD`), relaxes `NOT NULL` on `user_id`/`purge_at`, and backfills dual columns. |
| `manager_commands` (`command_id uuid` vs `text`, FK) | Older production deployments used `command_id uuid` + dynamically named FK to `manager_workers(worker_id)` and `uuid`-typed RPC parameters (`p_command_id uuid`). | **Stage A7–A8 & Stage B**: Dynamically locates and drops any FK on `manager_commands` referencing `manager_workers` (because queued/historical commands must remain queryable when a worker is recreated or reset), drops stale overloaded function signatures (`DROP FUNCTION IF EXISTS`), alters `command_id` to `text` (`USING command_id::text`) cleanly in `DO $$ ... END $$;`, enforces `manager_commands_status_check` and `NOT VALID` `manager_commands_action_check`. |
| Security & Session Revocation Hardening | 20 older functions used `SET search_path = public` (without `pg_temp`); 4 views omitted `security_invoker = true`; deleting/disabling a user left old sessions valid until expiry. | **Stage B (`20261112000000`) + `20261112120000`**: Recreates all 4 views `WITH (security_invoker = true)` + `REVOKE ALL ... FROM PUBLIC, anon, authenticated;`; upgrades all **52** canonical functions to `SECURITY DEFINER SET search_path = public, pg_temp` + `GRANT EXECUTE ... TO service_role;`; adds `revoke_manager_user_sessions(text)`, hardens `read_manager_session`, `read_manager_authorization`, `manager_set_user_access`, and `manager_delete_user_access` to revoke sessions on deletion/disable, and cleans up pre-existing orphaned/disabled sessions. |
| Migration Tracking | Partial DBs lacked `manager_schema_migrations` entries for canonical checkpoints. | Records all **8** ordered migration IDs (`20261107_manager_schema` through `20261112120000_session_revocation_and_migration_guards`) idempotently via `ON CONFLICT (version) DO NOTHING`. |

---

## 3. Lock, Transaction & Rollback Boundaries

1. **Lock Exposure**:
   - Most statements use `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, and `CREATE INDEX IF NOT EXISTS`.
   - Brief `ACCESS EXCLUSIVE` locks occur on altered legacy tables (`manager_audit`, `manager_keys`, `manager_link4m_attempts`, `manager_commands`, `manager_workers`) during column type promotion and view swap. Keep active Manager API & bot polling traffic paused (maintenance window) while running on production so PostgREST / running transactions do not hold conflicting row locks.
2. **Rollback Philosophy**:
   - Because `20261112000000` wraps all DDL/DML inside `BEGIN; ... COMMIT;`, any runtime SQL error rolls back the entire transaction automatically with zero partial changes.
   - If an application regression is discovered *after* commit, do **not** run destructive SQL drops (`reset_and_setup.sql` or `DROP TABLE`); instead restore the pre-migration `pg_dump` / Supabase PITR snapshot or deploy a corrective forward migration. Legacy `manager_access`, `manager_worker_assignments`, and `manager_counters` remain untouched in `public` as fallback audit references.

---

## 4. Environment Progression Gate

Every release must pass the following gate order before touching production:

1. **Local / CI Automated Proof**:
   - `tests/integration.test.js`, `tests/services-wiring.test.js`, `tests/storage-sql.test.js`
   - `tests/postgres-real.test.js` (Suites A–F on real PostgreSQL 16, including legacy upgrade simulation in Suite B, multi-connection races in Suite D, crash/restart RESET recovery in Suite E, and role/`pg_temp` security in Suite F).
2. **Isolated Staging Database (Clone/Snapshot of Prod Shape)**:
   - Restore or clone production schema+data into a disposable staging branch/database, run `20261112000000_reconcile_full_manager_schema.sql`, inspect row-count preservation, and point a non-production Manager process at staging to verify `/ready` returns HTTP `200`.
3. **Production Execution**:
   - Follow [`PRODUCTION_MIGRATION_RUNBOOK.md`](file:///D:/manager%20deploy/docs/supabase/PRODUCTION_MIGRATION_RUNBOOK.md) step-by-step during a scheduled maintenance window.
