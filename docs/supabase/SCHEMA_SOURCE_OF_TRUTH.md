# Supabase Schema Single Source of Truth (Phase 2)

This document establishes the authoritative schema architecture and anti-drift contract for `kietpro352010/Manager`.

---

## 1. Authoritative Source of Truth Model

### 1.1 Production Upgrades: `supabase/migrations/` (Ordered, Additive, Non-Destructive)
- Every existing or production Supabase database is upgraded exclusively by running **ordered SQL migrations** in [`supabase/migrations/`](file:///D:/manager%20deploy/supabase/migrations/) and recording each applied version in `public.manager_schema_migrations(version, applied_at)`.
- All migrations MUST be idempotent, non-destructive (`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, guarded `ALTER TABLE` / data backfills inside `DO $$ ... END $$;`), and MUST end with `NOTIFY pgrst, 'reload schema';`.
- `20261112000000_reconcile_full_manager_schema.sql` serves as the convergence migration bridging legacy 10-table databases (`20261107`–`20261111120000`) and partial production schemas to the canonical target state with **zero data loss**.

### 1.2 Full Target DDL Definition: `src/storage/schema-sql.js` (Exported as Runtime Schema)
- [`src/storage/schema-sql.js`](file:///D:/manager%20deploy/src/storage/schema-sql.js) is the canonical programmatic representation of the full target PostgreSQL schema exposed via `/api/manager/supabase/schema` and referenced by runtime stores.
- Target canonical object set:
  - **27 base tables**: the **26 runtime tables** plus `public.manager_schema_migrations`.
  - **4 security-invoker compatibility views**: `manager_audit`, `backups`, `system_settings`, `bot_schedules`.
  - **1 sequence**: `public.manager_bot_number_seq`.
  - **5 triggers**: `trg_sync_bot_schedules`, `reject_cleared_event_log`, `reject_cleared_chat_log`, `manager_users_revision_after_write`, `manager_sessions_reject_revoked`.
  - **51 canonical functions**: 50 existing canonical functions + `manager_delete_user_access(text)` (atomic `SECURITY DEFINER` user deletion RPC required because `service_role` direct `DELETE` on `manager_users` is revoked), ALL hardened with:
    - `SECURITY DEFINER`
    - `SET search_path = public, pg_temp`
    - `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated;`
    - `GRANT EXECUTE ON FUNCTION ... TO service_role;` (explicitly excluding `PUBLIC`/`anon`/`authenticated`).

### 1.3 Clean Install Entrypoint: `supabase/setup.sql`
- [`supabase/setup.sql`](file:///D:/manager%20deploy/supabase/setup.sql) is a **non-destructive fresh-install script** that MUST stay **100% schema-identical** to `src/storage/schema-sql.js` plus seeding `manager_schema_migrations` for all migrations up to the current release.
- It NEVER contains `DROP TABLE`, `DROP VIEW`, `DROP SCHEMA`, or `CASCADE` table drops, and NEVER duplicates function definitions.

### 1.4 Clean Sandbox / Dev Reset Only: `supabase/reset_and_setup.sql`
- [`supabase/reset_and_setup.sql`](file:///D:/manager%20deploy/supabase/reset_and_setup.sql) is strictly for **disposable development / test sandboxes** — **NEVER for production**.
- Part 1 cleanly drops Manager/Bot tables, views, sequences, and functions in `public`.
- Part 2 MUST be an exact mirror of `src/storage/schema-sql.js` plus migration version seeds.

---

## 2. Authoritative Object Inventory

### 2.1 Runtime Required Tables (`SUPABASE_REQUIRED_TABLES` = 26 Tables)
All 26 runtime tables MUST be listed in [`SUPABASE_REQUIRED_TABLES`](file:///D:/manager%20deploy/src/storage/supabase-client.js):
- **Core Auth / Sessions / Keys / Entitlements (8)**: `manager_users`, `manager_user_state`, `manager_users_write_transactions`, `manager_sessions`, `manager_session_revocations`, `manager_keys`, `manager_key_usage_transactions`, `manager_migration_entitlement_undo`
- **Dashboard / Assignments / Discord / Settings / Audit / Backups (5)**: `manager_assignments`, `manager_discord_links`, `manager_settings`, `audit_logs`, `manager_backups`
- **Workers & Bot Telemetry / State / Logs (9)**: `manager_workers`, `manager_commands`, `bot_registry`, `bot_settings`, `bot_chat_logs`, `bot_event_logs`, `bot_log_clear_cutoffs`, `bot_position_state`, `bot_position_logs`
- **Reliability / Locks / Queue / Allocations / Rewards (4)**: `manager_locks`, `manager_outbox_queue`, `manager_pending_allocations`, `manager_link4m_attempts`
- **Migration Tracking Metadata Table (1 additional in canonical DB = 27 total)**: `manager_schema_migrations` (verified by deploy tooling / migration checks).

### 2.2 Canonical `manager_commands` & Worker Queue Contract
- `manager_commands.command_id` is **`text` PRIMARY KEY** across every SQL file and RPC (`cmd_<UUID>`, raw UUID strings preserved).
- Constraints:
  - `manager_commands_action_check`: `NOT VALID` (safe for historical rows), permitting all active + resume actions (`start`, `stop`, `restart`, `resume`, `status`, `chat`, `reset`, `set-afk-mode`, `set-proxy`, `reconnect`, `respawn`, `inventory`, `look`, `toss`, `window_click`, `window_close`).
  - `manager_commands_status_check`: `('queued', 'delivered', 'execution_completed', 'state_sync_pending', 'state_sync_failed', 'completed', 'failed', 'expired')`.
- Two-phase RESET state synchronization RPCs (`manager_record_command_execution`, `manager_renew_command_sync_lease`, `manager_verify_command_sync_lease`, `manager_mark_command_sync_pending`, `manager_finalize_command_sync`, `manager_claim_pending_command_syncs`) accept `p_command_id text` and remain the sole safe path for multi-instance execution.

### 2.3 Canonical Worker Reset & Queue Semantics
- `manager_next_bot_number()` returns `integer` backed by `public.manager_bot_number_seq` (synced above `MAX(bot_number)`).
- `manager_reset_worker_data(text)` returns `boolean`, resets `settings = '{}'::jsonb`, `events = '[]'::jsonb`, `last_event = NULL`, `status = '{"state":"offline","online":false}'::jsonb`, `updated_at = now()`, preserving runtime behavior expected by `CommandBroker` & `WorkerRegistry`.
- `manager_enqueue_worker_command` returns `SETOF public.manager_commands` and coalesces active `queued` commands when `p_allow_coalesce = true`.
- `manager_take_worker_command` returns `SETOF public.manager_commands` (zero rows when queue empty — never scalar NULL row).

---

## 3. Legacy Object Disposition Plan

| Legacy Object (from `20261107`) | Resolution in Reconciliation Migration (`20261112000000`) | Long-Term State |
|---|---|---|
| `public.manager_audit` (base table) | Migrate all rows into `public.audit_logs` (`id = 'legacy_audit_' \|\| ma.id::text`, `ON CONFLICT (id) DO NOTHING`), drop legacy table `public.manager_audit`, replace with compatibility `VIEW public.manager_audit` (`WITH (security_invoker = true)`) over `public.audit_logs`. | Compatibility view only; runtime writes/clears use `audit_logs`. |
| `public.manager_access` (base table) | Non-destructively backfill into `public.manager_users` (`ON CONFLICT (username) DO NOTHING`) while keeping existing table intact & locked (`RLS`, `service_role` only). Canonical access RPCs (`manager_set_user_access`, `manager_redeem_code_with_access`, `manager_complete_link4m_reward`) retain guarded compatibility writes only if `manager_access` exists. | Deprecated legacy read/compat table; zero destructive drop in migration. |
| `public.manager_worker_assignments` (base table) | Non-destructively backfill into `public.manager_assignments` (`ON CONFLICT DO NOTHING`) while keeping legacy table intact without destructive drop. | Deprecated legacy table; canonical runtime reads/writes `manager_assignments`. |
| `public.manager_counters` (base table) | Sync `manager_bot_number_seq` to `GREATEST(MAX(bot_number), COALESCE(counter.value, 0))` if `manager_counters` exists; keep `manager_counters` untouched (non-destructive). | Superseded by `manager_bot_number_seq`. |
| `manager_keys` (`text[]`, `key_id` PK) | Upgrade in-place without row loss: add missing canonical columns, backfill `id = key_id`, convert `used_users` / `worker_ids` `text[] -> jsonb`, relax rigid `code_hash` regex / `NOT NULL` where Web keys do not populate Discord-only fields. | Single unified `manager_keys` (`jsonb` arrays). |
| `manager_link4m_attempts` (Discord-only regex + `daily_date date`) | Drop `manager_link4m_attempts_user_id_check` Discord-only constraint; add missing columns (`username`, `vietnam_date`, `provider_short_url`, etc.); backfill `username = user_id`; convert `daily_date date -> text` (`to_char(daily_date, 'YYYY-MM-DD')`); allow nullable `user_id`/`purge_at`. | Unified Web + Discord Link4M table. |
| `manager_consume_key`, `manager_release_consumed_key` | Drop stale `text[]`-dependent function overloads cleanly (`DROP FUNCTION IF EXISTS`) or replace/retire because `manager_keys.used_users` is canonical `jsonb` and runtime uses `consume_manager_key_usage` / `manager_redeem_code_with_access`. | Retired legacy helper functions. |

---

## 4. Schema Drift Prevention Rule

Every commit touching SQL or storage contracts MUST pass both structural tests (`tests/storage-sql.test.js`) AND real PostgreSQL integration & parity tests (`tests/postgres-real.test.js`):
1. Executing **Method A** (ordered `supabase/migrations/*.sql` cleanly on an empty database), **Method B** (`supabase/setup.sql`), **Method C** (`src/storage/schema-sql.js`), and **Method D** (`supabase/reset_and_setup.sql`) MUST produce **identical `pg_catalog` tables, columns, column types, views, triggers, sequence, and function signatures** (ignoring legacy-only backup tables if upgraded from an older snapshot).
2. Applying `supabase/migrations/20261112000000_reconcile_full_manager_schema.sql` on top of a pre-populated legacy `20261107`–`20261111120000` database MUST converge to exact parity on all 27 canonical tables, 4 views, 5 triggers, and 51 functions with zero row loss.
3. Static security & SQL syntax checks MUST verify zero missing `$$` blocks, zero duplicate function/index definitions in `setup.sql`, zero `SET search_path` functions omitting `pg_temp`, and `SUPABASE_REQUIRED_TABLES` matching all 26 runtime tables.
