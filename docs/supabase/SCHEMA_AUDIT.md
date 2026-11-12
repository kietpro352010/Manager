# Supabase & PostgreSQL Schema Audit (Phase 1)

- **Repository**: `kietpro352010/Manager` (`D:\manager deploy`)
- **Base Commit Verified**: `dca3b2a13b2e914606a8ea1a88743a60e4630e5c` (`main`)
- **Scope Inspected**:
  - SQL sources: `src/storage/schema-sql.js`, `supabase/setup.sql`, `supabase/reset_and_setup.sql`, and all 6 files in `supabase/migrations/`
  - Runtime storage & services: `src/storage/supabase-client.js`, `src/storage/supabase-dashboard-store.js`, `src/storage/supabase-worker-store.js`, `src/storage/supabase-command-store.js`, `src/services/command-broker.js`, `src/services/worker-registry.js`, `src/services/entitlement-service.js`, `src/services/link4m-service.js`, `src/http/app.js`, `src/http/routes/admin-api.js`
  - Existing tests & CI: `tests/integration.test.js`, `tests/services-wiring.test.js`, `tests/storage-sql.test.js`, `.github/workflows/ci.yml`
- **Production Safety Note**: Live Supabase production was **never queried or modified**. Any references to live production state (e.g., 19/23 missing tables or `command_id uuid`) are attributed solely to `agent-notes/01-project-state-and-git-timeline.md`, `agent-notes/02-findings-and-fixes-summary.md`, and `agent-notes/03-supabase-live-status-and-sql-options.md`.

---

## 1. Executive Summary

The repository currently maintains **two divergent PostgreSQL schema histories** that collide when applied to the same database and leave gaps against runtime requirements:

1. **Runtime / Web + Discord Full Schema (`src/storage/schema-sql.js` & `supabase/reset_and_setup.sql` Part 2)**:
   - Defines **26 tables**, **4 compatibility views**, **1 sequence**, **5 triggers**, and **50 functions**.
   - Contains a **P0 PostgreSQL syntax error** (`DO \nBEGIN ... END;` without `$$` dollar quotes around the `manager_commands.command_id` `uuid -> text` migration block).
   - Has security hardening gaps on 20 older functions (`SET search_path = public` instead of `public, pg_temp`) and 4 views (missing `PUBLIC` in `REVOKE` and missing `security_invoker = true`).
2. **Discord-Origin Migration Chain (`supabase/setup.sql` & `supabase/migrations/20261107..20261111120000`)**:
   - Defines only **10 tables**, **0 views**, **0 sequences**, **0 triggers**, and **20 unique functions** (23 `CREATE OR REPLACE FUNCTION` blocks in `setup.sql` due to 3 duplicated definitions).
   - Missing **21 runtime tables** and **30 runtime functions** used by Web Auth, Sessions, Dashboard, Bot Registry/Logs/Position, Outbox Queue, Pending Allocations, and Discord Links.
   - Contains incompatible structural contracts on shared tables (`manager_audit` as a base table vs view, `manager_keys.used_users` as `text[]` vs `jsonb`, `manager_keys` PK `key_id` vs `id`, `manager_link4m_attempts.user_id` restricted to 17–20 digit Discord snowflakes and `daily_date` as `date` vs `text`, `manager_workers.bot_number` as `bigint` via `manager_counters` vs `integer` via `manager_bot_number_seq`).
3. **Runtime Store & Migration Drift**:
   - `SUPABASE_REQUIRED_TABLES` lists **23** of the **26** tables queried by runtime (omits `manager_assignments`, `manager_discord_links`, `manager_settings`).
   - `SupabaseAdapter.testConnection()` probes **24** RPCs and omits **21** `manager_*` RPCs (`SupabaseCommandStore.probeStateSyncRpcs()` probes 6 of them separately).
   - `src/services/entitlement-service.js:271` inserts non-existent columns (`user_id`, `required_bot_count`) into `manager_pending_allocations`.
   - `src/storage/schema-sql.js:911` revokes `INSERT, UPDATE, DELETE, TRUNCATE` on `manager_users` from `service_role`, which causes `SupabaseDashboardStore.clearAccess()` (`DELETE FROM manager_users`) and fallback write paths on `manager_users` to fail against real PostgreSQL with SQLSTATE `42501`.
   - `src/http/routes/admin-api.js:279` deletes directly from `manager_audit` (which is a read-over view in `schema-sql.js`) instead of clearing `audit_logs`.

---

## 2. Database Object Comparison Matrix

### 2.1 High-Level Counts by Source

| Object Type | Runtime Code References | `src/storage/schema-sql.js` | `supabase/setup.sql` | `supabase/migrations/` | `supabase/reset_and_setup.sql` |
|---|---:|---:|---:|---:|---:|
| Tables | 26 runtime tables (`23` in `SUPABASE_REQUIRED_TABLES`) | 26 | 10 | 10 | 26 (+drops 34 rels in Part 1) |
| Views | 1 queried directly (`manager_audit` delete in `admin-api.js`) | 4 | 0 | 0 | 4 |
| Sequences | Used via `manager_next_bot_number` | 1 (`manager_bot_number_seq`) | 0 (uses `manager_counters`) | 0 | 1 |
| Triggers | Relied on for revision & cutoff integrity | 5 | 0 | 0 | 5 |
| Functions (unique / raw defs) | 45 unique RPCs called + 5 trigger/internal fns | 50 / 50 | 20 / 23 (3 duplicates) | 22 / 31 (accumulated across 6 files) | 50 / 50 |
| RLS Policies | `service_role` bypass / `anon`+`authenticated` blocked | 0 explicit policies (RLS enabled + `REVOKE ALL`) | 0 explicit policies (RLS enabled + `REVOKE ALL`) | 0 explicit policies | 0 explicit policies |

---

### 2.2 Complete Table Matrix (All 31 Unique Tables Across Repo)

| # | Table Name | Runtime Access / Owner | `schema-sql.js` | `setup.sql` | `migrations/` | `reset_and_setup.sql` | Status & Mismatches |
|---|---|---|---|---|---|---|---|
| 1 | `audit_logs` | `SupabaseAdapter` / `SupabaseDashboardStore` (`AUDIT`) | 15 cols, 3 idx, RLS | MISSING | MISSING | 15 cols | Present in `schema-sql.js` only; `manager_audit` view aliases this table. |
| 2 | `bot_chat_logs` | `SupabaseAdapter` (chat logs + clear cutoff trigger) | 7 cols, 2 idx, trigger `reject_cleared_chat_log`, RLS | MISSING | MISSING | 7 cols | Missing from `setup.sql` / migrations. |
| 3 | `bot_event_logs` | `SupabaseAdapter` (event logs + clear cutoff trigger) | 7 cols, 2 idx, trigger `reject_cleared_event_log`, RLS | MISSING | MISSING | 7 cols | Missing from `setup.sql` / migrations. |
| 4 | `bot_log_clear_cutoffs` | `SupabaseAdapter` (`set_bot_log_clear_cutoff`) | 4 cols, RLS (`service_role` SELECT only) | MISSING | MISSING | 4 cols | Missing from `setup.sql` / migrations. |
| 5 | `bot_position_logs` | `SupabaseAdapter` (`record_bot_position_change`) | 10 cols, 3 idx, RLS | MISSING | MISSING | 10 cols | Missing from `setup.sql` / migrations. |
| 6 | `bot_position_state` | `SupabaseAdapter` (`record_bot_position_change`) | 6 cols, 1 idx, RLS | MISSING | MISSING | 6 cols | Missing from `setup.sql` / migrations. |
| 7 | `bot_registry` | `SupabaseAdapter` / `SupabaseWorkerStore` | 7 cols, RLS | MISSING | MISSING | 7 cols | Missing from `setup.sql` / migrations. |
| 8 | `bot_settings` | `SupabaseAdapter` / `SupabaseWorkerStore` | 11 cols, 1 idx, trigger `trg_sync_bot_schedules`, RLS | MISSING | MISSING | 11 cols | Missing from `setup.sql` / migrations. |
| 9 | `manager_assignments` | `SupabaseDashboardStore` (`ASSIGNMENTS`) | 4 cols (`worker_id` PK, `user_id`, `assigned_by`, `assigned_at`), RLS | MISSING (`manager_worker_assignments`) | MISSING | 4 cols | **OMITTED** from `SUPABASE_REQUIRED_TABLES`; collides conceptually with legacy `manager_worker_assignments`. |
| 10 | `manager_backups` | `SupabaseAdapter` / `SupabaseDashboardStore` (`BACKUPS`) | 5 cols, 2 idx, RLS | MISSING | MISSING | 5 cols | Missing from `setup.sql` / migrations; aliased by `backups` view. |
| 11 | `manager_commands` | `SupabaseCommandStore` (`TABLE = 'manager_commands'`) | 10 cols (`command_id text`), 4 idx, **NO status/action CHECK** | 10 cols (`command_id text`), 4 idx, action+status `CHECK`, FK -> `manager_workers` | 10 cols (added in `20261108`, hardened in `20261111120000`) | 10 cols | **P0 syntax error** in `schema-sql.js` & `reset_and_setup.sql` around `ALTER COLUMN command_id TYPE text` (`DO` missing `$$`). `schema-sql.js` also lacks `CHECK` constraints for `action` & `status` and `expires_at NOT NULL`. |
| 12 | `manager_discord_links` | `SupabaseDashboardStore` (`discord_links` RPC & fallback) | 7 cols, 1 idx, `UNIQUE (manager_user_id)`, RLS | MISSING | MISSING | 7 cols | **OMITTED** from `SUPABASE_REQUIRED_TABLES` and `setup.sql`. |
| 13 | `manager_key_usage_transactions` | `SupabaseAdapter` (`consume_manager_key_usage`) | 6 cols, RLS (`service_role` SELECT only) | MISSING | MISSING | 6 cols | Missing from `setup.sql` / migrations. |
| 14 | `manager_keys` | `SupabaseDashboardStore` & `SupabaseAdapter` | **32 cols** (`id` PK, `used_users jsonb`, `worker_ids jsonb`, `bot_ids jsonb`, `assigned_bot_ids jsonb`) | **17 cols** (`key_id` PK, `used_users text[]`, `worker_ids text[]`, no `id`/`code`/`used`/`used_by`/`used_at`) | 17 cols (`20261107`) | 32 cols | **Severe schema divergence**: PK, array vs `jsonb` column types, `code_hash`/`code_suffix` constraints. |
| 15 | `manager_link4m_attempts` | `Link4mService` / `SupabaseDashboardStore` / `SupabaseAdapter` | **22 cols** (`user_id` nullable, `daily_date text`, `vietnam_date text`, `username text`, `purge_at` nullable) | **12 cols** (`user_id` Discord regex `^[0-9]{17,20}$` `NOT NULL`, `daily_date date NOT NULL`, `purge_at NOT NULL`) | 12 cols (`20261107`) | 22 cols | **Severe schema divergence**: Discord-only regex blocks Web usernames (`usr_*`), `date` vs `text`, missing 10 columns (`username`, `vietnam_date`, `provider_short_url`, etc.). |
| 16 | `manager_locks` | `SupabaseAdapter` (`withManagerLock`, fencing RPCs) | 5 cols (`lock_key`, `owner_id`, `lease_until`, `fencing_token`, `updated_at`), RLS | MISSING | MISSING | 5 cols | Missing from `setup.sql` / migrations. |
| 17 | `manager_migration_entitlement_undo` | Entitlement migration safety audit table (`SUPABASE_REQUIRED_TABLES`) | 7 cols, composite PK `(migration_id, entity_type, entity_key)`, RLS | MISSING | MISSING | 7 cols | Missing from `setup.sql` / migrations. |
| 18 | `manager_outbox_queue` | `SupabaseAdapter` / `CommandBroker` / `SupabaseDashboardStore` | 22 cols, 1 partial idx, RLS | MISSING | MISSING | 22 cols | Missing from `setup.sql` / migrations. |
| 19 | `manager_pending_allocations` | `SupabaseAdapter` / `EntitlementService` | 16 cols (`missing_bot_count`, `target_bot_count`, `username`, NO `user_id`/`required_bot_count`), 2 idx, RLS | MISSING | MISSING | 16 cols | Missing from `setup.sql` / migrations; **`entitlement-service.js:271` inserts wrong column names**. |
| 20 | `manager_session_revocations` | `SupabaseAdapter` (`revoke_manager_session`, trigger) | 2 cols, RLS (`service_role` SELECT only) | MISSING | MISSING | 2 cols | Missing from `setup.sql` / migrations. |
| 21 | `manager_sessions` | `SupabaseAdapter` (`read_manager_session`, `create_manager_user_session`) | 10 cols, 3 idx, trigger `manager_sessions_reject_revoked`, RLS | MISSING | MISSING | 10 cols | Missing from `setup.sql` / migrations. |
| 22 | `manager_settings` | `SupabaseDashboardStore` (`SETTINGS`), `manager-runtime-settings.js`, `wispbyte-keepalive.js` | 3 cols (`key`, `value`, `updated_at`), RLS | 3 cols (`key` check `1..80`), RLS | 3 cols (`20261107`) | 3 cols | **OMITTED** from `SUPABASE_REQUIRED_TABLES` (`supabase-client.js`). |
| 23 | `manager_user_state` | Singleton revision counter (`save_manager_users_snapshot`) | 3 cols, RLS (`service_role` SELECT only) | MISSING | MISSING | 3 cols | Missing from `setup.sql` / migrations. |
| 24 | `manager_users` | `SupabaseAdapter` / `SupabaseDashboardStore` (`USERS`) | 20 cols, 4 idx, trigger `manager_users_revision_after_write`, **service_role DML revoked** | MISSING (`manager_access`) | MISSING | 20 cols | Missing from `setup.sql` / migrations; `REVOKE INSERT, UPDATE, DELETE` from `service_role` breaks direct writes in `SupabaseDashboardStore`. |
| 25 | `manager_users_write_transactions` | Idempotent snapshot save log (`save_manager_users_snapshot`) | 5 cols, RLS (`service_role` SELECT only) | MISSING | MISSING | 5 cols | Missing from `setup.sql` / migrations. |
| 26 | `manager_workers` | `SupabaseWorkerStore` / `WorkerRegistry` | 15 cols (`bot_number integer`), duplicate idx `idx_manager_workers_enabled` | 15 cols (`bot_number bigint NOT NULL`), strict `CHECK`s | 15–16 cols (`schedule` dropped in `20261111`) | 15 cols | Type diff on `bot_number` (`integer` vs `bigint`), `status` default (`offline` vs `registered`), strict `CHECK` constraints in `setup.sql` only. |
| 27 | `manager_access` (**LEGACY**) | Fallback read/dual-write in `SupabaseDashboardStore` (`ACCESS`) | MISSING | 12 cols (`user_id ~ '^[0-9]{17,20}$'`, `role`, `status`, `is_permanent`) | 12 cols (`20261107`) | Dropped in Part 1 | Discord-only legacy entitlement table; replaced by `manager_users`. |
| 28 | `manager_audit` (**COLLISION**) | `admin-api.js:279` direct delete; legacy logs | **VIEW** over `audit_logs` | **BASE TABLE** (6 cols, identity PK) | **BASE TABLE** (`20261107`) | Dropped as table/view, recreated as **VIEW** | **P0/P1 Collision**: View in `schema-sql.js` vs Table in `setup.sql`. Applying `schema-sql.js` over `20261107` fails (`"manager_audit" is not a view`). |
| 29 | `manager_counters` (**LEGACY**) | None in `src/` (only `setup.sql` RPC `manager_next_bot_number`) | MISSING | 3 cols (`counter_name`, `value`, `updated_at`) | 3 cols (`20261107`) | Dropped in Part 1 | Used only by `setup.sql` version of `manager_next_bot_number()`. |
| 30 | `manager_schema_migrations` (**META**) | None in `src/` (`tests/storage-sql.test.js` checks version inserts) | MISSING | 2 cols (`version`, `applied_at`) | 2 cols (`20261107`..`20261111120000`) | Dropped in Part 1 | Tracks applied migrations, missing from `schema-sql.js`! |
| 31 | `manager_worker_assignments` (**LEGACY**) | Dual-read/write only in `setup.sql` RPCs (`manager_set_user_access`) | MISSING | 4 cols (FK -> `manager_workers` & `manager_access`) | 4 cols (`20261107`) | Dropped in Part 1 | Replaced by `manager_assignments` in `schema-sql.js`. |

---

### 2.3 Views, Sequences & Triggers Audit

| Object | Kind | `schema-sql.js` / `reset_and_setup.sql` | `setup.sql` / `migrations/` | Security & Idempotency Findings |
|---|---|---|---|---|
| `public.manager_audit` | View (or legacy table) | `VIEW` `SELECT * FROM public.audit_logs` | Base `TABLE` (6 cols) | Missing `WITH (security_invoker = true)`; `REVOKE ALL` omits `PUBLIC` (only revokes `anon, authenticated`). |
| `public.backups` | View | `VIEW` `SELECT * FROM public.manager_backups` | None | Same view hardening gap (`security_invoker`, `PUBLIC` revoke). |
| `public.system_settings` | View | `VIEW` from `bot_registry WHERE id = 'default'` | None | Same view hardening gap. |
| `public.bot_schedules` | View | `VIEW` from `bot_settings` | None | Same view hardening gap. |
| `public.manager_bot_number_seq` | Sequence | `CREATE SEQUENCE IF NOT EXISTS` synced to `MAX(bot_number)` | None | Safe; granted `USAGE, SELECT` to `service_role`. |
| `trg_sync_bot_schedules` | Trigger (`bot_settings`) | `BEFORE INSERT OR UPDATE` -> `sync_bot_schedules_column()` | None | `sync_bot_schedules_column()` lacks `REVOKE ALL FROM PUBLIC, anon, authenticated`. |
| `reject_cleared_event_log` | Trigger (`bot_event_logs`) | `BEFORE INSERT` -> `reject_cleared_bot_log()` | None | `reject_cleared_bot_log()` uses mutable `search_path = public` (missing `pg_temp`). |
| `reject_cleared_chat_log` | Trigger (`bot_chat_logs`) | `BEFORE INSERT` -> `reject_cleared_bot_log()` | None | Same `search_path = public`. |
| `manager_users_revision_after_write` | Trigger (`manager_users`) | `AFTER INSERT OR UPDATE OR DELETE` -> `bump_manager_users_revision()` | None | `bump_manager_users_revision()` uses `search_path = public`. |
| `manager_sessions_reject_revoked` | Trigger (`manager_sessions`) | `BEFORE INSERT OR UPDATE` -> `reject_revoked_manager_session()` | None | `reject_revoked_manager_session()` uses `search_path = public`. |

---

### 2.4 Complete Function / RPC Audit (All 52 Unique Functions)

| Group | Function Name | Called in Runtime? | `schema-sql.js` Signature & `search_path` | `setup.sql` / `migrations/` Signature & `search_path` | Divergence / Defect |
|---|---|---|---|---|---|
| **Worker Lifecycle** | `manager_next_bot_number()` | `SupabaseWorkerStore` | `RETURNS integer`, `search_path = public, pg_temp` | `RETURNS bigint`, `search_path = ''` (uses `manager_counters`) | Return type (`int` vs `bigint`) & storage backend (`seq` vs `manager_counters`). |
| | `manager_patch_worker_settings(text, jsonb)` | `SupabaseWorkerStore` | `RETURNS jsonb`, updates any matching worker, no object check | Checks `jsonb_typeof = 'object'`, `AND enabled`, raises on missing/disabled | Behavioral diff on invalid patch or disabled worker. |
| | `manager_reset_worker_data(text)` | `SupabaseWorkerStore` | Sets `settings='{}'`, `status='offline'`, leaves `events`, no `enabled` filter | Strips `'mcCredentialsCiphertext'`, clears `events='[]'`, sets `status='stopped'`, filters `AND enabled` | Behavioral diff on `events` / preserved settings / `status.state`. |
| | `manager_append_worker_event(text, jsonb)` | `SupabaseWorkerStore` | `RETURNS boolean`, unbounded array append `(events \|\| p_event)` | `RETURNS void`, caps array to last 100 entries | Return type (`boolean` vs `void`) & unbounded JSONB growth in `schema-sql.js`. |
| **Command Queue & Two-Phase Sync** | `manager_enqueue_worker_command(text, text, text, jsonb, timestamptz, timestamptz, boolean)` | `SupabaseCommandStore` | `RETURNS SETOF manager_commands`, no `enabled` check, no expired-cleanup, no max-5 queue cap | `RETURNS SETOF manager_commands`, locks `enabled` worker, expires stale queued cmds, enforces max 5 queued | Missing queue guardrails (`enabled` + cap 5) in `schema-sql.js`. |
| | `manager_take_worker_command(text)` | `SupabaseCommandStore` | `RETURNS SETOF manager_commands` | `RETURNS public.manager_commands` (scalar SQL fn!) | Scalar SQL function in `setup.sql` emits all-NULL composite row on empty result vs 0 rows from `SETOF`. |
| | `manager_complete_worker_command(text, text, jsonb)` | `SupabaseCommandStore` | `RETURNS boolean`, always sets `status='completed'`, `search_path = public, pg_temp` | Sets `'failed'` when `p_result->>'ok' = 'false'`; `20261111120000` uses two-phase compatible logic (`search_path = ''`) | `schema-sql.js` ignores `p_result->>'ok' = 'false'`. |
| | `manager_expire_worker_command(text)` | `SupabaseCommandStore` | `RETURNS boolean`, `search_path = public, pg_temp` | `RETURNS boolean`, `search_path = ''` | Compatible (`p_command_id text`); `setup.sql` defines twice. |
| | `manager_record_command_execution(text, text, jsonb, text, integer)` | `SupabaseCommandStore` | `RETURNS jsonb` (`p_command_id text`), `search_path = public, pg_temp` | `RETURNS jsonb` (`p_command_id text`), `search_path = ''` | Now aligned on `text` (`e3c94ec`), except `setup.sql` uses `search_path = ''`. |
| | `manager_renew_command_sync_lease(text, text, text, integer, bigint)` | `SupabaseCommandStore` | `RETURNS jsonb`, `public, pg_temp` | `RETURNS jsonb`, `''` | Aligned. |
| | `manager_verify_command_sync_lease(text, text, text, bigint)` | `SupabaseCommandStore` | `RETURNS jsonb`, `public, pg_temp` | `RETURNS jsonb`, `''` | Aligned. |
| | `manager_mark_command_sync_pending(text, text, jsonb, boolean, text, bigint)` | `SupabaseCommandStore` | `RETURNS boolean`, `public, pg_temp` | `RETURNS boolean`, `''` | Aligned. |
| | `manager_finalize_command_sync(text, text, jsonb, text, bigint)` | `SupabaseCommandStore` | `RETURNS boolean`, `public, pg_temp` | `RETURNS boolean`, `''` | Aligned. |
| | `manager_claim_pending_command_syncs(text, integer, integer)` | `SupabaseCommandStore` | `RETURNS SETOF manager_commands`, `public, pg_temp` | `RETURNS SETOF manager_commands`, `''` | Aligned. |
| **Access / Users / Discord / Trial** | `manager_set_user_access(text, jsonb, text[], text)` | `SupabaseDashboardStore` | `RETURNS SETOF manager_users`, writes `manager_users` + `manager_assignments` + conditional `manager_access` | `RETURNS public.manager_access`, writes `manager_access` + `manager_worker_assignments` | Incompatible target tables & return types. |
| | `manager_redeem_code_with_access(text, text, jsonb, text[], text)` | `SupabaseDashboardStore` | `RETURNS SETOF manager_keys`, `used_users` as `jsonb`, dual-writes `manager_users`/`manager_assignments` | `RETURNS public.manager_keys`, `used_users` as `text[]`, writes `manager_access` | Incompatible array vs jsonb, target user table, and `DEFAULT ''`. |
| | `manager_register_trial_user(text, text, text, integer, text)` | `SupabaseDashboardStore` | `RETURNS jsonb`, `public, pg_temp` | MISSING | Absent from `setup.sql` / migrations. |
| | `manager_link_discord_account(text, text, text)` | `SupabaseDashboardStore` | `RETURNS jsonb`, `public, pg_temp` | MISSING | Absent from `setup.sql` / migrations. |
| | `manager_unlink_discord_account(text)` | `SupabaseDashboardStore` | `RETURNS jsonb`, `public, pg_temp` | MISSING | Absent from `setup.sql` / migrations. |
| | `manager_claim_link4m_attempt(text, text, timestamptz)` | `SupabaseDashboardStore` | `RETURNS SETOF manager_link4m_attempts`, `DEFAULT now()` | `RETURNS public.manager_link4m_attempts` (no default) | Return type (`SETOF` vs scalar) and default parameter. |
| | `manager_complete_link4m_reward(text, text, jsonb, text[], text)` | `SupabaseDashboardStore` | `RETURNS SETOF manager_link4m_attempts`, `DEFAULT ''`, writes `manager_users`+`manager_access` | `RETURNS public.manager_link4m_attempts`, writes `manager_access` only | Return type & target user table. |
| **Legacy Discord Keys** | `manager_consume_key(text, text)` | **UNUSED in `src/`** | MISSING | `RETURNS public.manager_keys`, `used_users text[]` | Legacy `20261107` only (`SupabaseDashboardStore` uses `manager_redeem_code_with_access`). |
| | `manager_release_consumed_key(text, text)` | **UNUSED in `src/`** | MISSING | `RETURNS boolean`, `used_users text[]` | Legacy `20261107` only. |
| **Core Manager Adapter RPCs (23)** | `acquire_manager_lock`, `release_manager_lock`, `renew_manager_lock`, `verify_manager_lock_fencing`, `patch_manager_registry`, `set_bot_log_clear_cutoff`, `record_bot_position_change`, `consume_manager_key_usage`, `read_manager_users_snapshot`, `read_manager_session`, `read_manager_authorization`, `revoke_manager_session`, `create_manager_user_session`, `apply_manager_users_snapshot_locked`, `save_manager_users_snapshot`, `insert_manager_users_if_absent`, `redeem_manager_key_and_save_users`, `start_manager_link4m_attempt`, `claim_manager_link4m_reward`, `update_manager_link4m_sync_status`, `set_manager_link4m_short_url`, `rollback_manager_link4m_attempt`, `claim_manager_outbox_batch`, `claim_manager_pending_allocations`, `prune_manager_historical_data` | `SupabaseAdapter` (`supabase-client.js`) + `SupabaseWorkerStore` / `SupabaseDashboardStore` / `Link4mService` | Present in `schema-sql.js` (25 fns incl. 4 triggers below; **16 of 21 non-trigger RPCs here use `SET search_path = public` without `pg_temp`**) | **ALL 25 MISSING** | **P0 gap**: None of the core Web/Lock/User/Session/Outbox/Position RPCs exist in `setup.sql` or `migrations/`. |
| **Trigger Functions (4)** | `sync_bot_schedules_column`, `reject_cleared_bot_log`, `bump_manager_users_revision`, `reject_revoked_manager_session` | Triggered automatically by PostgreSQL | Present in `schema-sql.js` (all 4 use mutable `search_path = public`; `sync_bot_schedules_column` also lacks `REVOKE ALL FROM PUBLIC`) | **ALL 4 MISSING** | Must be hardened with `SET search_path = public, pg_temp` and `REVOKE ALL ... FROM PUBLIC, anon, authenticated`. |

---

## 3. Security, Constraints, and Runtime Findings (Severity Matrix)

| Severity | Finding | Exact Evidence (File & Line / Object) | Concrete Impact |
|---|---|---|---|
| **P0** | Broken `DO` block syntax in `schema-sql.js` & `reset_and_setup.sql` | `src/storage/schema-sql.js` (around `manager_commands.command_id` migration, formatted L2127) and `supabase/reset_and_setup.sql` | Executing either file directly in PostgreSQL / Supabase SQL Editor fails immediately with a syntax error near `BEGIN` because `DO` and `END` lack `$$` dollar-quoting delimiters. |
| **P0** | `setup.sql` & `supabase/migrations/` omit 21 of 26 runtime tables and 30 of 50 functions | `supabase/setup.sql`, `supabase/migrations/20261107..20261111120000` vs `SUPABASE_REQUIRED_TABLES` (`src/storage/supabase-client.js:19-27`) | Any fresh or migrated environment built from `setup.sql` / existing migrations fails `testConnection()`, auth sessions, bot logs, outbox queue, and distributed locks. |
| **P0** | `manager_audit` object type collision (base table vs view) | `supabase/migrations/20261107_manager_schema.sql:84` (`TABLE`) vs `src/storage/schema-sql.js` (`VIEW` over `audit_logs`) & `src/http/routes/admin-api.js:279` | Running `schema-sql.js` on a legacy `20261107` database fails `CREATE OR REPLACE VIEW public.manager_audit`; `admin-api.js:279` also calls `.from('manager_audit').delete().neq('id', 0)` ignoring errors instead of clearing `audit_logs`. |
| **P1** | `manager_keys` & `manager_link4m_attempts` schema/type incompatibility | `20261107_manager_schema.sql:62-80,101-118` vs `schema-sql.js` & `src/storage/supabase-dashboard-store.js` | `manager_keys.used_users` / `worker_ids` are `text[]` in `20261107` vs `jsonb` in `schema-sql.js`; `key_id` PK lacks `id`; `manager_link4m_attempts.user_id ~ '^[0-9]{17,20}$'` rejects all Web accounts (`usr_*`), `daily_date` is `date` vs `text`, and 10 columns are absent. |
| **P1** | `manager_pending_allocations` insert uses wrong column names | `src/services/entitlement-service.js:271-278` vs `manager_pending_allocations` in `schema-sql.js` & `supabase-client.js:2223` | `entitlement-service.js` inserts `{ user_id, required_bot_count }`, neither of which exists on `manager_pending_allocations` (`username`, `target_bot_count`, `missing_bot_count`), causing PostgREST `PGRST204` errors caught and logged only as warnings. |
| **P1** | `service_role` DML revocation on `manager_users` breaks `SupabaseDashboardStore.clearAccess()` & fallbacks | `schema-sql.js` (L911 formatted: `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.manager_users FROM service_role`) vs `supabase-dashboard-store.js:394,441,821,877-878` | Direct `.from('manager_users').delete()` (`clearAccess`) and `.update`/`.upsert` fallbacks fail against real PostgreSQL with `42501 permission denied for table manager_users`, while `clearAccess` swallows errors silently. |
| **P1** | Incomplete health/readiness table & RPC probes | `src/storage/supabase-client.js:19-27` (`23` tables) & `L372-383` (`24` RPCs) | `SUPABASE_REQUIRED_TABLES` omits `manager_assignments`, `manager_discord_links`, `manager_settings`; `testConnection()` omits 21 `manager_*` worker/command/access/trial/discord/link4m RPCs. |
| **P1** | `SupabaseWorkerStore.resetData()` fallback writes string `'offline'` into `jsonb` status | `src/storage/supabase-worker-store.js:117` | Fallback sends `status: 'offline'` instead of `{ state: 'offline', online: false }`, and RPC definitions in `schema-sql.js` vs `20261111000000` diverge on whether non-credential settings & `events` are cleared. |
| **P1** | `manager_commands` constraints absent in `schema-sql.js` | `schema-sql.js` vs `20261111120000_command_two_phase_sync.sql:23-42` | `schema-sql.js` omits `manager_commands_action_check` and `manager_commands_status_check`, allowing inconsistent statuses if built outside migrations. |
| **P2** | Link4M `username` vs `userId` mismatch hazard on Web reward claim | `src/services/link4m-service.js:397-402` vs `claim_manager_link4m_reward` (`schema-sql.js`) | `SupabaseDashboardStore.createLinkAttempt` populates `username` from `record.username \|\| userId` while `Link4mService` passes `member.username \|\| attempt.userId`; if `attempt.username = 'usr_alice'` and `member.username = 'alice'`, RPC returns `USER_MISMATCH` (`ok: false`). |
| **P2** | `SET search_path = public` (without `pg_temp`) on 20 `SECURITY DEFINER` functions | `schema-sql.js` L282..L1495 (first 20 functions) | Vulnerable to temp-table shadowing (`pg_temp`) if unqualified references or resolution fallbacks occur under `SECURITY DEFINER`. |
| **P2** | View privilege & `security_invoker` gaps | `schema-sql.js` views (`manager_audit`, `backups`, `system_settings`, `bot_schedules`) | Views lack `WITH (security_invoker = true)` and `REVOKE ALL ... FROM PUBLIC`. `sync_bot_schedules_column()` also lacks `REVOKE ALL ... FROM PUBLIC, anon, authenticated`. |
| **P2** | Duplicated index, duplicated functions, scalar vs `SETOF` return types | `schema-sql.js` (`idx_manager_workers_enabled` twice), `setup.sql` (3 duplicated `CREATE OR REPLACE FUNCTION` blocks; scalar `manager_take_worker_command`), `tests/storage-sql.test.js` | Structural clutter; scalar `RETURNS public.manager_commands` emits all-NULL composite rows on 0 matched rows in PostgREST/SQL; `storage-sql.test.js` never executes SQL on real PostgreSQL. |
| **P3** | `SupabaseCommandStore.initialize()` silently swallows table errors; `agent-notes/` vs repo drift | `src/storage/supabase-command-store.js:230-236` | Logs warning only; production readiness still depended on manual operator SQL copy/paste. |

---

## 4. Post-Audit Reconciliation Status (Phases 2–7 Update)

All P0, P1, and P2 baseline findings above have been reconciled in subsequent phases while keeping the Section 1–3 numbers untouched as the pre-reconciliation Phase 1 record:

- **Canonical Target ([SCHEMA_SOURCE_OF_TRUTH.md](file:///D:/manager%20deploy/docs/supabase/SCHEMA_SOURCE_OF_TRUTH.md))**: Standardized at **27 base tables** (26 `SUPABASE_REQUIRED_TABLES` + `manager_schema_migrations`), **4 `security_invoker` views**, **1 sequence** (`manager_bot_number_seq`), **5 triggers**, and **52 `SECURITY DEFINER` functions** (`SET search_path = public, pg_temp`, revoked from `PUBLIC, anon, authenticated`), with additions of `manager_delete_user_access(text)` and `revoke_manager_user_sessions(text)`.
- **SQL & Controlled Upgrade Migrations**: Fixed the broken `DO` block in `src/storage/schema-sql.js` and `supabase/reset_and_setup.sql`, synchronized `supabase/setup.sql` 1:1 with `schema-sql.js`, authored `supabase/migrations/20261112000000_reconcile_full_manager_schema.sql` (including controlled backfill + replacement `DROP TABLE public.manager_audit` -> view and guarded legacy constraint/column upgrades), and added `supabase/migrations/20261112120000_session_revocation_and_migration_guards.sql` for atomic session revocation on user delete/disable.
- **Runtime Alignment**: Expanded `SUPABASE_REQUIRED_TABLES` (`23 -> 26`) and `SupabaseAdapter.testConnection()` RPC probes (`24 -> 47`), wired `manager_delete_user_access` and `revoke_manager_user_sessions` into `SupabaseDashboardStore`, `admin-api.js`, and `app.js` multi-process fail-closed auth middleware, fixed `audit_logs` reads/writes/clears, fixed `manager_pending_allocations` columns, fixed `username` forwarding in `link4m-service.js`, and fixed `SupabaseWorkerStore.resetData()` fallback payload.
- **Verification**: Covered by `tests/storage-sql.test.js`, real PostgreSQL 16 test suites in `tests/postgres-real.test.js`, and GitHub Actions `postgres:16` CI in `.github/workflows/ci.yml`.
