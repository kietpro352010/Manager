# Production Database Migration Plan (Phase 3)

This document defines the zero-data-loss database convergence architecture for upgrading existing Supabase PostgreSQL environments of `kietpro352010/Manager` to the canonical schema without dropping live customer, key, assignment, session, audit, or command data.

---

## 1. Objectives & Strict Safety Invariants

1. **Zero Data Loss**: Every existing row across `manager_workers`, `manager_commands`, `manager_keys`, `manager_link4m_attempts`, `manager_settings`, `manager_audit`, `manager_access`, `manager_worker_assignments`, `manager_counters`, and any partial web/runtime tables is preserved or promoted non-destructively.
2. **Never Execute `reset_and_setup.sql` on Production**: `supabase/reset_and_setup.sql` issues `DROP TABLE ... CASCADE` / `DROP FUNCTION ... CASCADE` in Part 1 and is restricted strictly to disposable test sandboxes.
3. **Transactional Atomicity**: [`supabase/migrations/20261112000000_reconcile_full_manager_schema.sql`](file:///D:/manager%20deploy/supabase/migrations/20261112000000_reconcile_full_manager_schema.sql) runs inside `BEGIN; ... COMMIT;` followed by `NOTIFY pgrst, 'reload schema';`. Any error aborts cleanly without leaving half-migrated tables or broken function overloads.
4. **Idempotent Re-execution**: Safe to apply over:
   - Legacy 10-table Discord-origin schemas (`20261107`–`20261111120000`),
   - Pre-fix schemas with `manager_commands.command_id` typed as `uuid` and legacy `worker_id` FK,
   - Partial `schema-sql.js` deployments missing newer RPCs or constraints,
   - Already-converged databases (no-op idempotency).

---

## 2. How `20261112000000_reconcile_full_manager_schema.sql` Handles Incompatibilities

| Area | Pre-Convergence Risk / State | Non-Destructive Strategy in `20261112000000` |
|---|---|---|
| `manager_audit` (base table vs view collision) | `20261107` created `manager_audit` as a 6-column identity table; canonical schema expects `audit_logs` (table) + `manager_audit` (`security_invoker` view). | **Stage A1–A2**: Creates `public.audit_logs`, copies every row (`id = 'legacy_audit_' \|\| ma.id::text`, `ON CONFLICT (id) DO NOTHING`), then drops the legacy table `manager_audit` (only when `pg_class.relkind IN ('r', 'p')`) before creating the `security_invoker = true` view over `audit_logs`. |
| `manager_access`, `manager_worker_assignments`, `manager_counters` | Legacy 10-table Discord tables replaced canonically by `manager_users`, `manager_assignments`, `manager_discord_links`, and `manager_bot_number_seq`. | **Stage A3–A4**: Backfills `manager_worker_assignments -> manager_assignments`, `manager_access -> manager_users` + `manager_discord_links`, and syncs `manager_bot_number_seq` to `GREATEST(MAX(bot_number), counter.value)`. Retains all three legacy tables intact behind RLS (`service_role` only) with zero destructive `DROP TABLE`. |
| `manager_workers` | Legacy `bot_number bigint`, strict `CHECK`s (`name`, `provider`, `worker_id`), nullable differences. | **Stage A4**: Drops narrow legacy `CHECK`s, converts `bot_number` to `integer`, relaxes legacy `NOT NULL` on `name`/`provider`/`secret_ciphertext`. |
| `manager_keys` | Legacy `key_id` PK, `worker_ids text[]`, `used_users text[]`, strict `code_hash` regex / `NOT NULL`. | **Stage A5**: Adds canonical Web/API columns (`id`, `code`, `duration_days`, `bot_ids`, `used`, etc.), converts `worker_ids` & `used_users` from `ARRAY` (`text[]`) to `jsonb`, drops `NOT NULL` on Discord-only fields, drops `manager_keys_pkey` on `key_id` before dropping `NOT NULL` on `key_id` and promoting `id` to `PRIMARY KEY` (with unique index on `key_id`). |
| `manager_link4m_attempts` | Legacy Discord snowflake regex `user_id ~ '^[0-9]{17,20}$'`, `daily_date date NOT NULL`, missing Web columns. | **Stage A6**: Drops legacy `CHECK`s, adds all missing Web columns (`username`, `vietnam_date`, `provider_short_url`, etc.), converts `daily_date date -> text` (`YYYY-MM-DD`), relaxes `NOT NULL` on `user_id`/`purge_at`, and backfills dual columns. |
| `manager_commands` (`command_id uuid` vs `text`, FK) | Older production deployments used `command_id uuid` + FK `manager_commands_worker_id_fkey` and `uuid`-typed RPC parameters (`p_command_id uuid`). | **Stage A7–A8 & Stage B**: Drops `manager_commands_worker_id_fkey`, drops all incompatible `uuid` / scalar / stale overloaded function signatures (`DROP FUNCTION IF EXISTS`), alters `command_id` to `text` (`USING command_id::text`) cleanly in `DO $$ ... END $$;`, enforces `manager_commands_status_check` and `NOT VALID` `manager_commands_action_check`. |
| Security Hardening | 20 older functions used `SET search_path = public` (without `pg_temp`); 4 views omitted `security_invoker = true` and `PUBLIC` revoke; `sync_bot_schedules_column()` lacked `PUBLIC` revoke. | **Stage B**: Recreates all 4 views `WITH (security_invoker = true)` + `REVOKE ALL ... FROM PUBLIC, anon, authenticated;`; upgrades all 51 functions to `SECURITY DEFINER SET search_path = public, pg_temp` + `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;`. |
| Migration Tracking | Partial DBs lacked `manager_schema_migrations` entries for canonical checkpoints. | **Stage C**: Records all 7 migration IDs (`20261107_manager_schema` through `20261112000000_reconcile_full_manager_schema`) idempotently via `ON CONFLICT (version) DO NOTHING`. |

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
