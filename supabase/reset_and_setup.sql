-- ============================================================================
-- KINGMC MANAGER - FULL SUPABASE RESET & CANONICAL SCHEMA SETUP
-- CẢNH BÁO: PHẦN 1 SẼ XÓA SẠCH TOÀN BỘ BẢNG/VIEW/SEQUENCE/FUNCTION CŨ CỦA
-- MANAGER & BOT TRONG SCHEMA `public` (BAO GỒM DỮ LIỆU HIỆN TẠI TRONG CÁC BẢNG ĐÓ).
-- Chỉ copy & chạy trong Supabase SQL Editor khi muốn làm sạch DB và dựng lại chuẩn.
-- ============================================================================

-- PHẦN 1: XÓA SẠCH TOÀN BỘ BẢNG, VIEW, SEQUENCE & HÀM CŨ/SAI TRONG `public`
BEGIN;

DO $$
DECLARE
  v_rel record;
  v_fn record;
BEGIN
  -- 1. Xóa toàn bộ bảng / view thuộc hệ thống Manager & Bot trong schema public
  FOR v_rel IN
    SELECT c.relname, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm')
      AND NOT c.relispartition
      AND (
        c.relname = ANY (ARRAY[
          'audit_logs',
          'backups',
          'system_settings',
          'bot_schedules',
          'bot_registry',
          'bot_settings',
          'bot_chat_logs',
          'bot_event_logs',
          'bot_position_state',
          'bot_position_logs',
          'bot_log_clear_cutoffs',
          'manager_schema_migrations',
          'manager_counters',
          'manager_access',
          'manager_worker_assignments',
          'manager_assignments',
          'manager_audit',
          'manager_users',
          'manager_discord_links',
          'manager_settings',
          'manager_migration_entitlement_undo',
          'manager_keys',
          'manager_sessions',
          'manager_backups',
          'manager_locks',
          'manager_key_usage_transactions',
          'manager_user_state',
          'manager_users_write_transactions',
          'manager_session_revocations',
          'manager_outbox_queue',
          'manager_pending_allocations',
          'manager_link4m_attempts',
          'manager_workers',
          'manager_commands'
        ])
        OR c.relname ~ '^(manager_|bot_)'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e'
      )
  LOOP
    IF v_rel.relkind = 'm' THEN
      EXECUTE format('DROP MATERIALIZED VIEW IF EXISTS public.%I CASCADE;', v_rel.relname);
    ELSIF v_rel.relkind = 'v' THEN
      EXECUTE format('DROP VIEW IF EXISTS public.%I CASCADE;', v_rel.relname);
    ELSE
      EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE;', v_rel.relname);
    END IF;
  END LOOP;

  -- 2. Xóa sequence đánh số bot cũ
  DROP SEQUENCE IF EXISTS public.manager_bot_number_seq CASCADE;

  -- 3. Xóa toàn bộ function cũ/overload thuộc Manager & Bot trong schema public
  FOR v_fn IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname ~ '^(manager_|bot_|audit_|sync_bot_|record_bot_|acquire_manager_|release_manager_|renew_manager_|verify_manager_|patch_manager_|set_bot_|reject_|consume_manager_|bump_manager_|read_manager_|revoke_manager_|create_manager_|apply_manager_|save_manager_|insert_manager_|redeem_manager_|start_manager_|claim_manager_|update_manager_|set_manager_|rollback_manager_|prune_manager_)'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.%I(%s) CASCADE;', v_fn.proname, v_fn.args);
  END LOOP;
END $$;

COMMIT;

-- ============================================================================
-- PHẦN 2: THIẾT LẬP TOÀN BỘ SCHEMA CHUẨN THEO MANAGER (26 BẢNG, 4 VIEWS, 50 RPCS)
-- ============================================================================

-- KingMC Bot Manager storage contract, aligned with manager.js and bot.js.
-- Safe to run more than once. Keeps legacy columns/rows and adds the current API schema.
--
-- SCHEMA VERSION: 2026-10-30-v11.9 (Audit V4 Master Directive)
--   - Link4M RPC chỉ chặn user 'disabled'; user 'expired' ĐƯỢC vượt link để hồi sinh.
--   - claim_manager_link4m_reward revive 'expired' -> 'active' ATOMIC (cùng UPDATE với
--     expires_at), chỉ chạy sau khi attempt đã được xác minh (token/status/expiry).
--   - Không tự mở khóa 'disabled' (chỉ admin mới có quyền).
-- ROLLBACK: toàn bộ hàm dùng CREATE OR REPLACE — chạy lại nguyên văn bản schema NGAY TRƯỚC
--   (phiên bản 2026-10-28) là quay về hành vi cũ, không mất dữ liệu. Nếu chỉ muốn rollback
--   riêng BUG-09: khôi phục guard chặn trạng thái khác active ở cả hai RPC và bỏ dòng
--   `status = CASE WHEN v_user.status = 'expired' ...` trong UPDATE manager_users của claim.
--
BEGIN;

CREATE TABLE IF NOT EXISTS public.manager_users (
  id text,
  username text PRIMARY KEY,
  password text,
  password_hash text,
  role text NOT NULL DEFAULT 'user',
  status text NOT NULL DEFAULT 'active',
  assigned_bot_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamptz,
  plan_name text NOT NULL DEFAULT 'Gói mặc định',
  bot_aliases jsonb NOT NULL DEFAULT '{}'::jsonb,
  allow_account_change boolean NOT NULL DEFAULT true,
  lock_reason text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  bot_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS id text;
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS password text;
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS assigned_bot_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS plan_name text NOT NULL DEFAULT 'Gói mặc định';
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS bot_aliases jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS allow_account_change boolean NOT NULL DEFAULT true;
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS lock_reason text NOT NULL DEFAULT '';
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS note text NOT NULL DEFAULT '';
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS is_permanent boolean NOT NULL DEFAULT false;
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS bot_count integer NOT NULL DEFAULT 1;
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS discord_user_id text;
CREATE INDEX IF NOT EXISTS idx_manager_users_discord_user_id ON public.manager_users(discord_user_id);
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS is_trial boolean NOT NULL DEFAULT false;
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS trial_bot_id text;
CREATE TABLE IF NOT EXISTS public.manager_assignments (
  worker_id text PRIMARY KEY,
  user_id text NOT NULL,
  assigned_by text NOT NULL DEFAULT 'system',
  assigned_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.manager_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.manager_assignments FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.manager_assignments TO service_role;
CREATE TABLE IF NOT EXISTS public.manager_discord_links (
  discord_user_id text PRIMARY KEY,
  manager_user_id text NOT NULL,
  username text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active',
  revoked_at timestamptz,
  CONSTRAINT manager_discord_links_user_unique UNIQUE (manager_user_id)
);
CREATE INDEX IF NOT EXISTS idx_manager_discord_links_user_id ON public.manager_discord_links(manager_user_id);
ALTER TABLE public.manager_discord_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.manager_discord_links FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.manager_discord_links TO service_role;

CREATE TABLE IF NOT EXISTS public.manager_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.manager_settings ADD COLUMN IF NOT EXISTS key text;
ALTER TABLE public.manager_settings ADD COLUMN IF NOT EXISTS value jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.manager_settings ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.manager_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.manager_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.manager_settings TO service_role;
UPDATE public.manager_users SET bot_count = GREATEST(bot_count, jsonb_array_length(assigned_bot_ids)) WHERE jsonb_typeof(assigned_bot_ids) = 'array' AND jsonb_array_length(assigned_bot_ids) > bot_count;
CREATE TABLE IF NOT EXISTS public.manager_migration_entitlement_undo (
  migration_id text NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('user', 'key')),
  entity_key text NOT NULL,
  old_is_permanent boolean NOT NULL,
  new_is_permanent boolean NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  rolled_back_at timestamptz,
  PRIMARY KEY (migration_id, entity_type, entity_key)
);
ALTER TABLE public.manager_migration_entitlement_undo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.manager_migration_entitlement_undo FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.manager_migration_entitlement_undo TO service_role;
INSERT INTO public.manager_migration_entitlement_undo (migration_id, entity_type, entity_key, old_is_permanent, new_is_permanent) SELECT '2026-10-30-v11.9', 'user', username, is_permanent, true FROM public.manager_users WHERE is_permanent = false AND expires_at IS NULL AND (plan_name ILIKE '%vĩnh viễn%' OR plan_name ILIKE '%permanent%' OR plan_name ILIKE '%lifetime%') AND status = 'active' AND role <> 'admin' ON CONFLICT (migration_id, entity_type, entity_key) DO UPDATE SET old_is_permanent = EXCLUDED.old_is_permanent, new_is_permanent = EXCLUDED.new_is_permanent, captured_at = now();
UPDATE public.manager_users SET is_permanent = true, updated_at = now() WHERE is_permanent = false AND expires_at IS NULL AND (plan_name ILIKE '%vĩnh viễn%' OR plan_name ILIKE '%permanent%' OR plan_name ILIKE '%lifetime%') AND status = 'active' AND role <> 'admin';
ALTER TABLE public.manager_users ALTER COLUMN password_hash DROP NOT NULL;
UPDATE public.manager_users SET id = 'usr_' || username WHERE id IS NULL OR btrim(id) = '';
UPDATE public.manager_users SET password = password_hash WHERE (password IS NULL OR password = '') AND password_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_manager_users_id_unique ON public.manager_users(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_manager_users_username_unique ON public.manager_users(username);

CREATE TABLE IF NOT EXISTS public.manager_keys (
  id text PRIMARY KEY,
  code text,
  key_code text,
  days integer NOT NULL DEFAULT 1,
  duration_days integer NOT NULL DEFAULT 0,
  duration_ms bigint NOT NULL DEFAULT 0,
  plan_name text NOT NULL DEFAULT 'Gói mặc định',
  bot_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  assigned_bot_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  bot_count integer NOT NULL DEFAULT 1,
  used boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'unused',
  allow_account_change boolean NOT NULL DEFAULT true,
  used_by text,
  used_at timestamptz,
  max_uses integer NOT NULL DEFAULT 1,
  used_count integer NOT NULL DEFAULT 0,
  used_users jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS id text;
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS key_code text;
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS days integer NOT NULL DEFAULT 1;
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS duration_days integer NOT NULL DEFAULT 0;
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS duration_ms bigint NOT NULL DEFAULT 0;
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS role text DEFAULT 'user';
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS plan_name text NOT NULL DEFAULT 'Gói mặc định';
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS bot_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS assigned_bot_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS bot_count integer NOT NULL DEFAULT 1;
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS used boolean NOT NULL DEFAULT false;
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'unused';
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS allow_account_change boolean NOT NULL DEFAULT true;
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS used_by text;
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS used_at timestamptz;
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS max_uses integer NOT NULL DEFAULT 1;
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS used_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS used_users jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS is_permanent boolean NOT NULL DEFAULT false;
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS key_id text;
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS key text;
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS code_hash text;
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS code_suffix text;
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS worker_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS created_by text;
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS last_used_at timestamptz;
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS last_used_by text;
ALTER TABLE public.manager_keys ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
UPDATE public.manager_keys SET is_permanent = true WHERE days = -1 OR duration_days = -1;
UPDATE public.manager_keys SET code = key_code WHERE code IS NULL OR code = '';
UPDATE public.manager_keys SET key_code = code WHERE key_code IS NULL OR key_code = '';
UPDATE public.manager_keys SET key = COALESCE(NULLIF(code, ''), key_code) WHERE key IS NULL OR key = '';
UPDATE public.manager_keys SET id = 'key_' || code WHERE (id IS NULL OR id = '') AND code IS NOT NULL;
UPDATE public.manager_keys SET key_id = id WHERE (key_id IS NULL OR key_id = '') AND id IS NOT NULL;
UPDATE public.manager_keys SET days = duration_days WHERE duration_days > 0 AND (days IS NULL OR days = 1);
UPDATE public.manager_keys SET bot_ids = assigned_bot_ids WHERE bot_ids = '[]'::jsonb AND assigned_bot_ids <> '[]'::jsonb;
UPDATE public.manager_keys SET worker_ids = bot_ids WHERE worker_ids = '[]'::jsonb AND bot_ids <> '[]'::jsonb;
UPDATE public.manager_keys SET used = (lower(status) IN ('used','active','redeemed')) WHERE status IS NOT NULL AND used = false;
CREATE UNIQUE INDEX IF NOT EXISTS idx_manager_keys_code_unique ON public.manager_keys(code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_manager_keys_id_unique ON public.manager_keys(id);
CREATE INDEX IF NOT EXISTS idx_manager_keys_code_hash ON public.manager_keys(code_hash);
CREATE INDEX IF NOT EXISTS idx_manager_keys_key_id ON public.manager_keys(key_id);

CREATE TABLE IF NOT EXISTS public.bot_registry (
  id text PRIMARY KEY,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Earlier versions stored one bot per row with numeric ids. Convert the id type
-- without removing those rows, then create the singleton registry document.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='bot_registry'
      AND column_name='id' AND data_type <> 'text'
  ) THEN
    ALTER TABLE public.bot_registry ALTER COLUMN id TYPE text USING id::text;
  END IF;
END $$;
ALTER TABLE public.bot_registry ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.bot_registry ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.bot_registry ADD COLUMN IF NOT EXISTS url text;
ALTER TABLE public.bot_registry ADD COLUMN IF NOT EXISTS label text DEFAULT '';
ALTER TABLE public.bot_registry ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;
ALTER TABLE public.bot_registry ADD COLUMN IF NOT EXISTS admin_password text DEFAULT '';
DO $$
DECLARE
  legacy_bots jsonb;
  legacy_id_map jsonb;
  legacy_order jsonb;
  legacy_admin text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.bot_registry WHERE id='default') THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('label', COALESCE(label,''), 'url', url) ORDER BY sort_order, id), '[]'::jsonb),
           COALESCE(jsonb_object_agg(url, id), '{}'::jsonb),
           COALESCE(jsonb_agg(url ORDER BY sort_order, id), '[]'::jsonb),
           COALESCE(max(admin_password), '')
      INTO legacy_bots, legacy_id_map, legacy_order, legacy_admin
      FROM public.bot_registry
      WHERE id <> 'default' AND url IS NOT NULL AND btrim(url) <> '';
    INSERT INTO public.bot_registry(id, data, updated_at, url, label, sort_order, admin_password)
      VALUES ('default', jsonb_build_object(
        'dynamicBots', legacy_bots, 'botIdMap', legacy_id_map,
        'orderUrls', legacy_order, 'adminPassword', legacy_admin,
        'disabledEnvUrls', '[]'::jsonb, 'disabledEnvIds', '[]'::jsonb,
        'overrides', '[]'::jsonb, 'order', '[]'::jsonb,
        'botAliases', '{}'::jsonb, 'botTags', '{}'::jsonb,
        'systemSettings', '{}'::jsonb, 'lastBotId', 0
      ), now(), '', 'KingMC Registry', -1, legacy_admin) ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.manager_sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL DEFAULT '',
  username text NOT NULL,
  role text NOT NULL DEFAULT 'user',
  assigned_bot_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at bigint NOT NULL DEFAULT 0,
  plan_name text NOT NULL DEFAULT 'Gói thường',
  allow_account_change boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.manager_sessions ADD COLUMN IF NOT EXISTS user_id text NOT NULL DEFAULT '';
ALTER TABLE public.manager_sessions ADD COLUMN IF NOT EXISTS token_hash text;
ALTER TABLE public.manager_sessions ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE public.manager_sessions ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';
ALTER TABLE public.manager_sessions ADD COLUMN IF NOT EXISTS assigned_bot_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.manager_sessions ADD COLUMN IF NOT EXISTS expires_at bigint NOT NULL DEFAULT 0;
ALTER TABLE public.manager_sessions ADD COLUMN IF NOT EXISTS plan_name text NOT NULL DEFAULT 'Gói thường';
ALTER TABLE public.manager_sessions ADD COLUMN IF NOT EXISTS allow_account_change boolean NOT NULL DEFAULT true;
ALTER TABLE public.manager_sessions ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE public.manager_sessions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
UPDATE public.manager_sessions SET user_id = username WHERE user_id IS NULL OR user_id = '';

CREATE TABLE IF NOT EXISTS public.bot_settings (
  bot_id text PRIMARY KEY,
  username text NOT NULL DEFAULT '',
  password text NOT NULL DEFAULT '',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  proxy jsonb NOT NULL DEFAULT '{}'::jsonb,
  schedules jsonb NOT NULL DEFAULT '[]'::jsonb,
  bot_schedules jsonb NOT NULL DEFAULT '[]'::jsonb,
  auto_chat jsonb NOT NULL DEFAULT '[]'::jsonb,
  manually_stopped boolean NOT NULL DEFAULT false,
  synced_auth jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bot_settings ADD COLUMN IF NOT EXISTS username text NOT NULL DEFAULT '';
ALTER TABLE public.bot_settings ADD COLUMN IF NOT EXISTS bot_id text;
ALTER TABLE public.bot_settings ADD COLUMN IF NOT EXISTS password text NOT NULL DEFAULT '';
ALTER TABLE public.bot_settings ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.bot_settings ADD COLUMN IF NOT EXISTS proxy jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.bot_settings ADD COLUMN IF NOT EXISTS schedules jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.bot_settings ADD COLUMN IF NOT EXISTS bot_schedules jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.bot_settings ADD COLUMN IF NOT EXISTS auto_chat jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.bot_settings ADD COLUMN IF NOT EXISTS manually_stopped boolean NOT NULL DEFAULT false;
ALTER TABLE public.bot_settings ADD COLUMN IF NOT EXISTS synced_auth jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.bot_settings ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.sync_bot_schedules_column()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.schedules IS NOT NULL AND (NEW.bot_schedules IS NULL OR NEW.bot_schedules = '[]'::jsonb) AND NEW.schedules <> '[]'::jsonb THEN
    NEW.bot_schedules := NEW.schedules;
  ELSIF NEW.bot_schedules IS NOT NULL AND (NEW.schedules IS NULL OR NEW.schedules = '[]'::jsonb) AND NEW.bot_schedules <> '[]'::jsonb THEN
    NEW.schedules := NEW.bot_schedules;
  ELSIF NEW.schedules IS NOT NULL AND NEW.bot_schedules IS NULL THEN
    NEW.bot_schedules := NEW.schedules;
  ELSIF NEW.bot_schedules IS NOT NULL AND NEW.schedules IS NULL THEN
    NEW.schedules := NEW.bot_schedules;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_bot_schedules ON public.bot_settings;
CREATE TRIGGER trg_sync_bot_schedules
BEFORE INSERT OR UPDATE ON public.bot_settings
FOR EACH ROW EXECUTE FUNCTION public.sync_bot_schedules_column();

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id text PRIMARY KEY,
  bot_id text,
  log_type text NOT NULL DEFAULT 'SYSTEM',
  category text NOT NULL DEFAULT 'SYSTEM',
  action text NOT NULL DEFAULT '',
  action_label text NOT NULL DEFAULT '',
  actor_username text NOT NULL DEFAULT 'system',
  actor_role text NOT NULL DEFAULT 'system',
  actor_ip text NOT NULL DEFAULT '',
  target jsonb NOT NULL DEFAULT '{}'::jsonb,
  details text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'SUCCESS',
  timestamp timestamptz NOT NULL DEFAULT now(),
  actor jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text NOT NULL DEFAULT ''
);
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS bot_id text;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS id text;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS log_type text NOT NULL DEFAULT 'SYSTEM';
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'SYSTEM';
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS action text NOT NULL DEFAULT '';
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS action_label text NOT NULL DEFAULT '';
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS actor_username text NOT NULL DEFAULT 'system';
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS actor_role text NOT NULL DEFAULT 'system';
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS actor_ip text NOT NULL DEFAULT '';
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS target jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS details text NOT NULL DEFAULT '';
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'SUCCESS';
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS timestamp timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS actor jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS ip text NOT NULL DEFAULT '';
UPDATE public.audit_logs SET
  actor_username = COALESCE(NULLIF(actor_username, 'system'), actor->>'username', 'system'),
  actor_role = COALESCE(NULLIF(actor_role, 'system'), actor->>'role', 'system'),
  actor_ip = COALESCE(NULLIF(actor_ip, ''), ip, ''),
  bot_id = COALESCE(NULLIF(bot_id, ''), NULLIF(target->>'botId',''), NULLIF(target->>'bot_id',''))
WHERE actor IS NOT NULL OR ip <> '' OR bot_id IS NULL;

CREATE TABLE IF NOT EXISTS public.bot_chat_logs (
  id text PRIMARY KEY,
  bot_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sender text NOT NULL DEFAULT 'SERVER',
  event_type text NOT NULL DEFAULT 'CHAT',
  message text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.bot_chat_logs ADD COLUMN IF NOT EXISTS id text;
ALTER TABLE public.bot_chat_logs ADD COLUMN IF NOT EXISTS bot_id text;
ALTER TABLE public.bot_chat_logs ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.bot_chat_logs ADD COLUMN IF NOT EXISTS sender text NOT NULL DEFAULT 'SERVER';
ALTER TABLE public.bot_chat_logs ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'CHAT';
ALTER TABLE public.bot_chat_logs ADD COLUMN IF NOT EXISTS message text NOT NULL DEFAULT '';
ALTER TABLE public.bot_chat_logs ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE IF NOT EXISTS public.bot_event_logs (
  id text PRIMARY KEY,
  bot_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  level text NOT NULL DEFAULT 'INFO',
  event_type text NOT NULL DEFAULT 'SYSTEM',
  message text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.bot_event_logs ADD COLUMN IF NOT EXISTS id text;
ALTER TABLE public.bot_event_logs ADD COLUMN IF NOT EXISTS bot_id text;
ALTER TABLE public.bot_event_logs ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.bot_event_logs ADD COLUMN IF NOT EXISTS level text NOT NULL DEFAULT 'INFO';
ALTER TABLE public.bot_event_logs ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'SYSTEM';
ALTER TABLE public.bot_event_logs ADD COLUMN IF NOT EXISTS message text NOT NULL DEFAULT '';
ALTER TABLE public.bot_event_logs ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE IF NOT EXISTS public.bot_position_state (
  bot_id text PRIMARY KEY,
  position jsonb NOT NULL DEFAULT '{}'::jsonb,
  dimension text NOT NULL DEFAULT 'unknown',
  location_state text NOT NULL DEFAULT 'Unknown',
  last_event_key text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bot_position_state ADD COLUMN IF NOT EXISTS bot_id text;
ALTER TABLE public.bot_position_state ADD COLUMN IF NOT EXISTS position jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.bot_position_state ADD COLUMN IF NOT EXISTS dimension text NOT NULL DEFAULT 'unknown';
ALTER TABLE public.bot_position_state ADD COLUMN IF NOT EXISTS location_state text NOT NULL DEFAULT 'Unknown';
ALTER TABLE public.bot_position_state ADD COLUMN IF NOT EXISTS last_event_key text;
ALTER TABLE public.bot_position_state ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS public.bot_position_logs (
  id text PRIMARY KEY,
  bot_id text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  from_position jsonb,
  to_position jsonb NOT NULL,
  from_dimension text,
  to_dimension text NOT NULL DEFAULT 'unknown',
  location_state text NOT NULL DEFAULT 'Unknown',
  reason text NOT NULL DEFAULT 'MOVE',
  event_key text NOT NULL UNIQUE
);
ALTER TABLE public.bot_position_logs ADD COLUMN IF NOT EXISTS id text;
ALTER TABLE public.bot_position_logs ADD COLUMN IF NOT EXISTS bot_id text;
ALTER TABLE public.bot_position_logs ADD COLUMN IF NOT EXISTS changed_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.bot_position_logs ADD COLUMN IF NOT EXISTS from_position jsonb;
ALTER TABLE public.bot_position_logs ADD COLUMN IF NOT EXISTS to_position jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.bot_position_logs ADD COLUMN IF NOT EXISTS from_dimension text;
ALTER TABLE public.bot_position_logs ADD COLUMN IF NOT EXISTS to_dimension text NOT NULL DEFAULT 'unknown';
ALTER TABLE public.bot_position_logs ADD COLUMN IF NOT EXISTS location_state text NOT NULL DEFAULT 'Unknown';
ALTER TABLE public.bot_position_logs ADD COLUMN IF NOT EXISTS reason text NOT NULL DEFAULT 'MOVE';
ALTER TABLE public.bot_position_logs ADD COLUMN IF NOT EXISTS event_key text;
CREATE TABLE IF NOT EXISTS public.manager_backups (
  name text PRIMARY KEY,
  bot_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  size_bytes integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.manager_backups ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.manager_backups ADD COLUMN IF NOT EXISTS bot_id text;
ALTER TABLE public.manager_backups ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.manager_backups ADD COLUMN IF NOT EXISTS size_bytes integer NOT NULL DEFAULT 0;
ALTER TABLE public.manager_backups ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Repair nullable legacy identifiers without deleting or merging existing rows.
UPDATE public.audit_logs SET id = md5(random()::text || clock_timestamp()::text || ctid::text) WHERE id IS NULL OR btrim(id) = '';
UPDATE public.bot_chat_logs SET id = md5(random()::text || clock_timestamp()::text || ctid::text) WHERE id IS NULL OR btrim(id) = '';
UPDATE public.bot_event_logs SET id = md5(random()::text || clock_timestamp()::text || ctid::text) WHERE id IS NULL OR btrim(id) = '';
UPDATE public.bot_position_logs SET id = md5(random()::text || clock_timestamp()::text || ctid::text) WHERE id IS NULL OR btrim(id) = '';
UPDATE public.bot_position_logs SET event_key = 'legacy:' || id WHERE event_key IS NULL OR btrim(event_key) = '';

CREATE INDEX IF NOT EXISTS idx_manager_users_role_status ON public.manager_users(role, status);
CREATE INDEX IF NOT EXISTS idx_manager_keys_used_created ON public.manager_keys(used, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manager_sessions_username ON public.manager_sessions(username);
CREATE INDEX IF NOT EXISTS idx_manager_sessions_expires_at ON public.manager_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_bot_time ON public.audit_logs(bot_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_time ON public.audit_logs(actor_username, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_bot_chat_logs_bot_time ON public.bot_chat_logs(bot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_event_logs_bot_time ON public.bot_event_logs(bot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_position_logs_bot_time ON public.bot_position_logs(bot_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_manager_backups_bot_time ON public.manager_backups(bot_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_manager_sessions_token_hash_unique ON public.manager_sessions(token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_settings_bot_id_unique ON public.bot_settings(bot_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_logs_id_unique ON public.audit_logs(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_chat_logs_id_unique ON public.bot_chat_logs(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_event_logs_id_unique ON public.bot_event_logs(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_position_state_bot_id_unique ON public.bot_position_state(bot_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_position_logs_id_unique ON public.bot_position_logs(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_position_logs_event_key_unique ON public.bot_position_logs(event_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_manager_backups_name_unique ON public.manager_backups(name);

ALTER TABLE public.manager_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manager_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manager_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_chat_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_event_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_position_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_position_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manager_backups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.manager_users, public.manager_keys, public.bot_registry,
  public.manager_sessions, public.bot_settings, public.audit_logs,
  public.bot_chat_logs, public.bot_event_logs, public.bot_position_state,
  public.bot_position_logs, public.manager_backups FROM anon, authenticated;
GRANT ALL ON public.manager_users, public.manager_keys, public.bot_registry,
  public.manager_sessions, public.bot_settings, public.audit_logs,
  public.bot_chat_logs, public.bot_event_logs, public.bot_position_state,
  public.bot_position_logs, public.manager_backups TO service_role;

CREATE OR REPLACE FUNCTION public.record_bot_position_change(
  p_id text,
  p_bot_id text,
  p_changed_at timestamptz,
  p_to_position jsonb,
  p_to_dimension text,
  p_location_state text,
  p_reason text,
  p_event_key text,
  p_min_distance double precision DEFAULT 5.0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prior public.bot_position_state%ROWTYPE;
  dx double precision := 0;
  dy double precision := 0;
  dz double precision := 0;
  distance double precision := 0;
  dimension_changed boolean := false;
  state_changed boolean := false;
BEGIN
  IF p_bot_id IS NULL OR p_bot_id !~ '^[1-9][0-9]{0,8}$' THEN
    RAISE EXCEPTION 'Invalid bot_id';
  END IF;
  IF p_event_key IS NULL OR btrim(p_event_key) = '' THEN
    RAISE EXCEPTION 'event_key is required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bot_position_logs WHERE event_key = p_event_key) THEN
    RETURN jsonb_build_object('ok', true, 'recorded', false, 'duplicate', true);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('bot-position:' || p_bot_id)::bigint);
  -- Recheck under the bot lock so a concurrent retry cannot advance state twice.
  IF EXISTS (SELECT 1 FROM public.bot_position_logs WHERE event_key = p_event_key) THEN
    RETURN jsonb_build_object('ok', true, 'recorded', false, 'duplicate', true);
  END IF;
  SELECT * INTO prior FROM public.bot_position_state WHERE bot_id = p_bot_id FOR UPDATE;
  IF FOUND THEN
    dimension_changed := COALESCE(prior.dimension, '') <> COALESCE(p_to_dimension, 'unknown');
    state_changed := COALESCE(prior.location_state, '') <> COALESCE(p_location_state, 'Unknown');
    BEGIN
      dx := COALESCE((p_to_position->>'x')::double precision, 0) - COALESCE((prior.position->>'x')::double precision, 0);
      dy := COALESCE((p_to_position->>'y')::double precision, 0) - COALESCE((prior.position->>'y')::double precision, 0);
      dz := COALESCE((p_to_position->>'z')::double precision, 0) - COALESCE((prior.position->>'z')::double precision, 0);
      distance := sqrt(dx*dx + dy*dy + dz*dz);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      distance := 0;
    END;
    IF NOT dimension_changed AND NOT state_changed AND distance < GREATEST(COALESCE(p_min_distance, 5.0), 0) THEN
      RETURN jsonb_build_object('ok', true, 'recorded', false, 'duplicate', false, 'distance', distance);
    END IF;
  END IF;

  INSERT INTO public.bot_position_logs(id, bot_id, changed_at, from_position, to_position,
    from_dimension, to_dimension, location_state, reason, event_key)
  VALUES (COALESCE(NULLIF(p_id,''), md5(random()::text || clock_timestamp()::text)), p_bot_id,
    COALESCE(p_changed_at, now()), CASE WHEN prior.bot_id IS NULL THEN NULL ELSE prior.position END,
    COALESCE(p_to_position, '{}'::jsonb), CASE WHEN prior.bot_id IS NULL THEN NULL ELSE prior.dimension END,
    COALESCE(p_to_dimension, 'unknown'), COALESCE(p_location_state, 'Unknown'),
    COALESCE(NULLIF(p_reason,''), 'MOVE'), p_event_key)
  ON CONFLICT (event_key) DO NOTHING;

  INSERT INTO public.bot_position_state(bot_id, position, dimension, location_state, last_event_key, updated_at)
  VALUES (p_bot_id, COALESCE(p_to_position, '{}'::jsonb), COALESCE(p_to_dimension, 'unknown'),
    COALESCE(p_location_state, 'Unknown'), p_event_key, COALESCE(p_changed_at, now()))
  ON CONFLICT (bot_id) DO UPDATE SET position=EXCLUDED.position, dimension=EXCLUDED.dimension,
    location_state=EXCLUDED.location_state, last_event_key=EXCLUDED.last_event_key, updated_at=EXCLUDED.updated_at;
  RETURN jsonb_build_object('ok', true, 'recorded', true, 'distance', distance);
END;
$$;
REVOKE ALL ON FUNCTION public.record_bot_position_change(text,text,timestamptz,jsonb,text,text,text,text,double precision) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_bot_position_change(text,text,timestamptz,jsonb,text,text,text,text,double precision) TO service_role;

COMMIT;

BEGIN;

CREATE TABLE IF NOT EXISTS public.manager_locks (
  lock_key text PRIMARY KEY,
  owner_id text NOT NULL,
  lease_until timestamptz NOT NULL,
  fencing_token bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.manager_locks ADD COLUMN IF NOT EXISTS fencing_token bigint NOT NULL DEFAULT 1;
ALTER TABLE public.manager_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.manager_locks FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.manager_locks TO service_role;

CREATE TABLE IF NOT EXISTS public.manager_key_usage_transactions (
  transaction_id text PRIMARY KEY,
  key_id text NOT NULL,
  username text NOT NULL,
  usage_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.manager_key_usage_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.manager_key_usage_transactions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.manager_key_usage_transactions TO service_role;

CREATE TABLE IF NOT EXISTS public.bot_log_clear_cutoffs (
  bot_id text PRIMARY KEY,
  event_cutoff timestamptz,
  chat_cutoff timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bot_log_clear_cutoffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bot_log_clear_cutoffs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.bot_log_clear_cutoffs TO service_role;

DROP FUNCTION IF EXISTS public.acquire_manager_lock(text,text,integer);
CREATE OR REPLACE FUNCTION public.acquire_manager_lock(
  p_lock_key text,
  p_owner_id text,
  p_lease_seconds integer DEFAULT 900
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_lease_interval interval;
  v_now timestamptz := now();
  v_current RECORD;
  v_token bigint;
BEGIN
  IF COALESCE(btrim(p_lock_key), '') = '' OR COALESCE(btrim(p_owner_id), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'fencing_token', 0);
  END IF;

  v_lease_interval := make_interval(secs => GREATEST(30, LEAST(COALESCE(p_lease_seconds, 900), 3600)));

  SELECT owner_id, lease_until, fencing_token INTO v_current
  FROM public.manager_locks
  WHERE lock_key = p_lock_key
  FOR UPDATE;

  IF NOT FOUND THEN
    v_token := 1;
    INSERT INTO public.manager_locks(lock_key, owner_id, lease_until, updated_at, fencing_token)
    VALUES (p_lock_key, p_owner_id, v_now + v_lease_interval, v_now, v_token);
    RETURN jsonb_build_object('ok', true, 'fencing_token', v_token);
  END IF;

  IF v_current.owner_id <> p_owner_id AND v_current.lease_until > v_now THEN
    RETURN jsonb_build_object('ok', false, 'fencing_token', v_current.fencing_token);
  END IF;

  v_token := COALESCE(v_current.fencing_token, 0) + 1;
  UPDATE public.manager_locks
  SET owner_id = p_owner_id,
      lease_until = v_now + v_lease_interval,
      updated_at = v_now,
      fencing_token = v_token
  WHERE lock_key = p_lock_key;

  RETURN jsonb_build_object('ok', true, 'fencing_token', v_token);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_manager_lock(p_lock_key text, p_owner_id text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE affected integer;
BEGIN
  DELETE FROM public.manager_locks WHERE lock_key = p_lock_key AND owner_id = p_owner_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_manager_lock(
  p_lock_key text,
  p_owner_id text,
  p_lease_seconds integer DEFAULT 900
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE affected integer;
BEGIN
  UPDATE public.manager_locks
  SET lease_until = now() + make_interval(secs => GREATEST(30, LEAST(COALESCE(p_lease_seconds, 900), 3600))),
      updated_at = now()
  WHERE lock_key = p_lock_key AND owner_id = p_owner_id AND lease_until > now();
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_manager_lock_fencing(
  p_lock_key text,
  p_owner_id text,
  p_fencing_token bigint
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_valid boolean := false;
BEGIN
  IF COALESCE(btrim(p_lock_key), '') = '' OR COALESCE(btrim(p_owner_id), '') = '' OR p_fencing_token IS NULL OR p_fencing_token <= 0 THEN
    RETURN false;
  END IF;

  SELECT (owner_id = p_owner_id AND fencing_token = p_fencing_token AND lease_until > now()) INTO v_valid
  FROM public.manager_locks
  WHERE lock_key = p_lock_key;

  RETURN COALESCE(v_valid, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.patch_manager_registry(
  p_patch jsonb DEFAULT '{}'::jsonb,
  p_pending_reset_patch jsonb DEFAULT '{}'::jsonb,
  p_pending_reset_deletes text[] DEFAULT '{}'::text[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_data jsonb;
  v_resets jsonb;
  v_key text;
BEGIN
  INSERT INTO public.bot_registry(id, data, updated_at)
  VALUES ('default', '{}'::jsonb, now()) ON CONFLICT (id) DO NOTHING;
  SELECT COALESCE(data, '{}'::jsonb) INTO v_data
  FROM public.bot_registry WHERE id = 'default' FOR UPDATE;
  v_data := v_data || COALESCE(p_patch, '{}'::jsonb);
  v_resets := CASE WHEN jsonb_typeof(v_data->'pendingResets') = 'object' THEN v_data->'pendingResets' ELSE '{}'::jsonb END;
  FOREACH v_key IN ARRAY COALESCE(p_pending_reset_deletes, '{}'::text[]) LOOP
    v_resets := v_resets - v_key;
  END LOOP;
  v_resets := v_resets || CASE WHEN jsonb_typeof(p_pending_reset_patch) = 'object' THEN p_pending_reset_patch ELSE '{}'::jsonb END;
  v_data := jsonb_set(v_data, '{pendingResets}', v_resets, true);
  UPDATE public.bot_registry SET data = v_data, updated_at = now() WHERE id = 'default';
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_bot_log_clear_cutoff(
  p_bot_id text,
  p_kind text,
  p_cutoff timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_cutoff timestamptz;
BEGIN
  IF p_bot_id IS NULL OR p_bot_id !~ '^[1-9][0-9]{0,8}$' OR p_cutoff IS NULL OR p_kind IS NULL OR p_kind NOT IN ('event','chat') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  END IF;
  IF p_kind = 'event' THEN
    INSERT INTO public.bot_log_clear_cutoffs(bot_id, event_cutoff, updated_at)
    VALUES (p_bot_id, p_cutoff, now())
    ON CONFLICT (bot_id) DO UPDATE SET
      event_cutoff = CASE WHEN public.bot_log_clear_cutoffs.event_cutoff IS NULL THEN EXCLUDED.event_cutoff ELSE GREATEST(public.bot_log_clear_cutoffs.event_cutoff, EXCLUDED.event_cutoff) END,
      updated_at = now()
    RETURNING event_cutoff INTO v_cutoff;
  ELSE
    INSERT INTO public.bot_log_clear_cutoffs(bot_id, chat_cutoff, updated_at)
    VALUES (p_bot_id, p_cutoff, now())
    ON CONFLICT (bot_id) DO UPDATE SET
      chat_cutoff = CASE WHEN public.bot_log_clear_cutoffs.chat_cutoff IS NULL THEN EXCLUDED.chat_cutoff ELSE GREATEST(public.bot_log_clear_cutoffs.chat_cutoff, EXCLUDED.chat_cutoff) END,
      updated_at = now()
    RETURNING chat_cutoff INTO v_cutoff;
  END IF;
  RETURN jsonb_build_object('ok', true, 'cutoff', v_cutoff);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_cleared_bot_log()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_cutoff timestamptz;
BEGIN
  IF TG_TABLE_NAME = 'bot_event_logs' THEN
    SELECT event_cutoff INTO v_cutoff FROM public.bot_log_clear_cutoffs WHERE bot_id = NEW.bot_id;
  ELSE
    SELECT chat_cutoff INTO v_cutoff FROM public.bot_log_clear_cutoffs WHERE bot_id = NEW.bot_id;
  END IF;
  IF v_cutoff IS NOT NULL AND NEW.created_at < v_cutoff THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reject_cleared_event_log ON public.bot_event_logs;
CREATE TRIGGER reject_cleared_event_log BEFORE INSERT ON public.bot_event_logs
FOR EACH ROW EXECUTE FUNCTION public.reject_cleared_bot_log();
DROP TRIGGER IF EXISTS reject_cleared_chat_log ON public.bot_chat_logs;
CREATE TRIGGER reject_cleared_chat_log BEFORE INSERT ON public.bot_chat_logs
FOR EACH ROW EXECUTE FUNCTION public.reject_cleared_bot_log();

CREATE OR REPLACE FUNCTION public.consume_manager_key_usage(p_code text, p_username text, p_transaction_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_key public.manager_keys%ROWTYPE;
  v_code text := upper(btrim(COALESCE(p_code, '')));
  v_username text := lower(btrim(COALESCE(p_username, '')));
  v_users jsonb;
  v_count integer;
  v_max integer;
  v_used_by text;
  v_transaction public.manager_key_usage_transactions%ROWTYPE;
BEGIN
  IF v_code = '' OR v_username = '' OR COALESCE(btrim(p_transaction_id), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  END IF;
  SELECT * INTO v_transaction FROM public.manager_key_usage_transactions WHERE transaction_id = p_transaction_id;
  IF FOUND THEN
    IF v_transaction.username <> v_username OR upper(COALESCE(v_transaction.usage_snapshot->>'code', v_transaction.usage_snapshot->>'key_code', '')) <> v_code THEN
      RETURN jsonb_build_object('ok', false, 'error', 'TRANSACTION_MISMATCH');
    END IF;
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'transactionId', p_transaction_id, 'row', v_transaction.usage_snapshot);
  END IF;
  SELECT * INTO v_key
  FROM public.manager_keys
  WHERE upper(COALESCE(NULLIF(code, ''), key_code, '')) = v_code
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'KEY_NOT_FOUND');
  END IF;

  -- A duplicate request may have waited on this key row while its first attempt committed.
  SELECT * INTO v_transaction FROM public.manager_key_usage_transactions WHERE transaction_id = p_transaction_id;
  IF FOUND THEN
    IF v_transaction.username <> v_username
       OR upper(COALESCE(v_transaction.usage_snapshot->>'code', v_transaction.usage_snapshot->>'key_code', '')) <> v_code THEN
      RETURN jsonb_build_object('ok', false, 'error', 'TRANSACTION_MISMATCH');
    END IF;
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'transactionId', p_transaction_id, 'row', v_transaction.usage_snapshot);
  END IF;

  v_max := COALESCE(v_key.max_uses, 1);
  IF v_max < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_MAX_USES');
  END IF;
  v_users := CASE WHEN jsonb_typeof(v_key.used_users) = 'array' THEN v_key.used_users ELSE '[]'::jsonb END;
  IF jsonb_array_length(v_users) > 0 THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(lower(btrim(value)))), '[]'::jsonb) INTO v_users
    FROM jsonb_array_elements_text(v_users) AS u(value)
    WHERE btrim(value) <> '';
  END IF;
  IF jsonb_array_length(v_users) = 0 AND COALESCE(v_key.used_by, '') <> '' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(lower(btrim(value)))), '[]'::jsonb) INTO v_users
    FROM unnest(string_to_array(v_key.used_by, ',')) AS value
    WHERE btrim(value) <> '';
  END IF;
  IF v_users ? v_username THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_USED');
  END IF;
  v_count := GREATEST(COALESCE(v_key.used_count, 0), jsonb_array_length(v_users), CASE WHEN v_key.used THEN 1 ELSE 0 END);
  IF v_max > 0 AND v_count >= v_max THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EXHAUSTED');
  END IF;

  v_users := v_users || jsonb_build_array(v_username);
  v_count := v_count + 1;
  SELECT string_agg(value, ', ' ORDER BY ord) INTO v_used_by
  FROM jsonb_array_elements_text(v_users) WITH ORDINALITY AS u(value, ord);
  UPDATE public.manager_keys
  SET used_users = v_users,
      used_count = v_count,
      used_by = v_used_by,
      used_at = now(),
      used = (v_max > 0 AND v_count >= v_max)
  WHERE id = v_key.id
  RETURNING * INTO v_key;
  INSERT INTO public.manager_key_usage_transactions(transaction_id, key_id, username, usage_snapshot)
  VALUES (p_transaction_id, v_key.id, v_username, to_jsonb(v_key));
  RETURN jsonb_build_object('ok', true, 'transactionId', p_transaction_id, 'row', to_jsonb(v_key));
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_manager_lock(text,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_manager_lock(text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renew_manager_lock(text,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_manager_lock_fencing(text,text,bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.patch_manager_registry(jsonb,jsonb,text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_bot_log_clear_cutoff(text,text,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_cleared_bot_log() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_manager_key_usage(text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_manager_lock(text,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_manager_lock(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_manager_lock(text,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_manager_lock_fencing(text,text,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.patch_manager_registry(jsonb,jsonb,text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_bot_log_clear_cutoff(text,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_manager_key_usage(text,text,text) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

BEGIN;

-- User entitlement fields were previously accepted by Manager but not persisted.
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS allow_account_change boolean NOT NULL DEFAULT true;
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS lock_reason text NOT NULL DEFAULT '';
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS note text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS public.manager_user_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.manager_user_state(singleton, revision)
VALUES (true, 1) ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.manager_users_write_transactions (
  transaction_id uuid PRIMARY KEY,
  expected_revision bigint NOT NULL,
  users_payload jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.manager_session_revocations (
  token_hash text PRIMARY KEY,
  revoked_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.manager_key_usage_transactions
  ADD COLUMN IF NOT EXISTS user_revision bigint;

ALTER TABLE public.manager_user_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manager_users_write_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manager_session_revocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.manager_user_state FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.manager_users_write_transactions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.manager_session_revocations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.manager_user_state, public.manager_session_revocations, public.manager_users_write_transactions, public.manager_key_usage_transactions, public.bot_log_clear_cutoffs TO service_role;
-- Force every service-role user write through the revision-checked RPCs below.
-- This makes stale legacy snapshot upserts fail closed during mixed-version deploys.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.manager_users FROM service_role;
GRANT SELECT ON TABLE public.manager_users TO service_role;

CREATE OR REPLACE FUNCTION public.bump_manager_users_revision()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.manager_user_state
  SET revision = revision + 1, updated_at = now()
  WHERE singleton = true;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS manager_users_revision_after_write ON public.manager_users;
CREATE TRIGGER manager_users_revision_after_write
AFTER INSERT OR UPDATE OR DELETE ON public.manager_users
FOR EACH STATEMENT EXECUTE FUNCTION public.bump_manager_users_revision();

CREATE OR REPLACE FUNCTION public.reject_revoked_manager_session()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.manager_session_revocations
    WHERE token_hash = NEW.token_hash
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS manager_sessions_reject_revoked ON public.manager_sessions;
CREATE TRIGGER manager_sessions_reject_revoked
BEFORE INSERT OR UPDATE ON public.manager_sessions
FOR EACH ROW EXECUTE FUNCTION public.reject_revoked_manager_session();

CREATE OR REPLACE FUNCTION public.read_manager_users_snapshot()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH state_cte AS (
    SELECT COALESCE(revision, 1) AS revision
    FROM public.manager_user_state
    WHERE singleton = true
  ),
  users_cte AS (
    SELECT COALESCE(jsonb_agg(to_jsonb(u) ORDER BY u.username), '[]'::jsonb) AS users
    FROM public.manager_users AS u
  )
  SELECT jsonb_build_object(
    'ok', true,
    'revision', state_cte.revision,
    'users', users_cte.users
  ) INTO v_result
  FROM state_cte, users_cte;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.read_manager_session(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_session jsonb;
BEGIN
  IF COALESCE(btrim(p_token_hash), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TOKEN_HASH');
  END IF;
  SELECT to_jsonb(s) INTO v_session
  FROM public.manager_sessions AS s
  WHERE s.token_hash = p_token_hash
    AND s.expires_at > (extract(epoch FROM now()) * 1000)::bigint
    AND NOT EXISTS (
      SELECT 1 FROM public.manager_session_revocations AS r
      WHERE r.token_hash = s.token_hash
    );
  RETURN jsonb_build_object('ok', true, 'session', v_session);
END;
$$;

CREATE OR REPLACE FUNCTION public.read_manager_authorization(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_session public.manager_sessions%ROWTYPE;
  v_user jsonb;
BEGIN
  IF COALESCE(btrim(p_token_hash), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TOKEN_HASH');
  END IF;
  SELECT * INTO v_session
  FROM public.manager_sessions AS s
  WHERE s.token_hash = p_token_hash
    AND s.expires_at > (extract(epoch FROM now()) * 1000)::bigint
    AND NOT EXISTS (
      SELECT 1 FROM public.manager_session_revocations AS r
      WHERE r.token_hash = s.token_hash
    );
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'session', NULL, 'user', NULL);
  END IF;
  IF v_session.role <> 'admin' THEN
    SELECT jsonb_build_object(
      'id', u.id, 'username', u.username, 'status', u.status,
      'assigned_bot_ids', u.assigned_bot_ids, 'expires_at', u.expires_at,
      'plan_name', u.plan_name, 'allow_account_change', u.allow_account_change,
      'is_permanent', u.is_permanent,
      'lock_reason', u.lock_reason
    ) INTO v_user
    FROM public.manager_users AS u
    WHERE u.id = v_session.user_id
      AND lower(u.username) = lower(v_session.username);
  END IF;
  RETURN jsonb_build_object('ok', true, 'session', to_jsonb(v_session), 'user', v_user);
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_manager_session(p_token_hash text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF COALESCE(btrim(p_token_hash), '') = '' THEN RETURN false; END IF;
  INSERT INTO public.manager_session_revocations(token_hash, revoked_at)
  VALUES (p_token_hash, now())
  ON CONFLICT (token_hash) DO NOTHING;
  DELETE FROM public.manager_sessions WHERE token_hash = p_token_hash;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_manager_user_session(
  p_expected_revision bigint,
  p_session jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_revision bigint;
  v_user_id text;
  v_username text;
  v_token_hash text;
  v_expires_at bigint;
  v_rows integer;
BEGIN
  v_user_id := btrim(COALESCE(p_session->>'user_id', ''));
  v_username := btrim(COALESCE(p_session->>'username', ''));
  v_token_hash := btrim(COALESCE(p_session->>'token_hash', ''));
  v_expires_at := NULLIF(p_session->>'expires_at', '')::bigint;
  IF v_user_id = '' OR v_username = '' OR v_token_hash !~ '^[a-f0-9]{64}$' OR v_expires_at IS NULL
     OR v_expires_at <= (extract(epoch FROM now()) * 1000)::bigint THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_SESSION');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.manager_users AS u
    WHERE u.id = v_user_id AND lower(u.username) = lower(v_username)
      AND lower(COALESCE(u.status, 'active')) <> 'disabled'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'USER_CHANGED');
  END IF;
  SELECT revision INTO v_revision
  FROM public.manager_user_state
  WHERE singleton = true FOR UPDATE;
  INSERT INTO public.manager_sessions(
    token_hash, user_id, username, role, assigned_bot_ids, expires_at,
    plan_name, allow_account_change, status, updated_at
  ) VALUES (
    v_token_hash, v_user_id, v_username, 'user',
    COALESCE(p_session->'assigned_bot_ids', '[]'::jsonb), v_expires_at,
    COALESCE(NULLIF(p_session->>'plan_name', ''), 'Gói thường'),
    COALESCE((p_session->>'allow_account_change')::boolean, true),
    COALESCE(NULLIF(p_session->>'status', ''), 'active'), now()
  ) ON CONFLICT (token_hash) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_NOT_CREATED');
  END IF;
  RETURN jsonb_build_object('ok', true, 'revision', v_revision);
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_manager_users_snapshot_locked(
  p_expected_revision bigint,
  p_users jsonb,
  p_allow_empty boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_revision bigint;
  v_user jsonb;
  v_id text;
  v_username text;
  v_affected integer;
  v_result jsonb;
BEGIN
  SELECT revision INTO v_revision
  FROM public.manager_user_state
  WHERE singleton = true FOR UPDATE;
  IF v_revision IS DISTINCT FROM p_expected_revision THEN
    RETURN jsonb_build_object('ok', false, 'error', 'REVISION_CONFLICT', 'revision', v_revision);
  END IF;
  IF p_users IS NULL OR jsonb_typeof(p_users) <> 'array' OR (jsonb_array_length(p_users) = 0 AND NOT p_allow_empty) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_OR_EMPTY_SNAPSHOT', 'revision', v_revision);
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_users) AS item(value)
    GROUP BY lower(btrim(value->>'username'))
    HAVING lower(btrim(value->>'username')) = '' OR count(*) > 1
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DUPLICATE_OR_INVALID_USERNAME', 'revision', v_revision);
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_users) AS item(value)
    WHERE jsonb_typeof(item.value->'assigned_bot_ids') NOT IN ('array', 'null')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_BOT_ASSIGNMENTS', 'revision', v_revision);
  END IF;
  IF EXISTS (
    SELECT btrim(bot_id.value)
    FROM jsonb_array_elements(p_users) AS item(value)
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(item.value->'assigned_bot_ids') = 'array'
        THEN item.value->'assigned_bot_ids' ELSE '[]'::jsonb END
    ) AS bot_id(value)
    GROUP BY btrim(bot_id.value)
    HAVING btrim(bot_id.value) = '' OR count(DISTINCT lower(btrim(item.value->>'username'))) > 1
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BOT_OWNERSHIP_CONFLICT', 'revision', v_revision);
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_users) AS item(value)
    GROUP BY btrim(COALESCE(value->>'id', ''))
    HAVING btrim(COALESCE(value->>'id', '')) = '' OR count(*) > 1
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DUPLICATE_OR_INVALID_USER_ID', 'revision', v_revision);
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_users) AS item(value)
    WHERE btrim(COALESCE(item.value->>'username', '')) = ''
       OR btrim(COALESCE(item.value->>'id', '')) = ''
       OR btrim(COALESCE(item.value->>'password', '')) = ''
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_USER_ROW', 'revision', v_revision);
  END IF;

  FOR v_user IN SELECT value FROM jsonb_array_elements(p_users) AS item(value)
  LOOP
    v_username := btrim(COALESCE(v_user->>'username', ''));
    v_id := btrim(COALESCE(v_user->>'id', ''));
    IF v_username = '' OR v_id = '' OR COALESCE(v_user->>'password', '') = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'INVALID_USER_ROW', 'revision', v_revision);
    END IF;

    UPDATE public.manager_users AS u
    SET id = v_id,
        username = v_username,
        password = v_user->>'password',
        role = COALESCE(NULLIF(v_user->>'role', ''), 'user'),
        status = COALESCE(NULLIF(v_user->>'status', ''), 'active'),
        assigned_bot_ids = COALESCE(v_user->'assigned_bot_ids', '[]'::jsonb),
        expires_at = NULLIF(v_user->>'expires_at', '')::timestamptz,
        plan_name = COALESCE(NULLIF(v_user->>'plan_name', ''), 'Gói mặc định'),
        bot_aliases = CASE WHEN jsonb_typeof(v_user->'bot_aliases') = 'object' THEN v_user->'bot_aliases' ELSE '{}'::jsonb END,
        allow_account_change = COALESCE((v_user->>'allow_account_change')::boolean, true),
        is_permanent = COALESCE((v_user->>'is_permanent')::boolean, (NULLIF(v_user->>'expires_at', '') IS NULL AND COALESCE(NULLIF(v_user->>'role', ''), 'user') <> 'admin' AND COALESCE(NULLIF(v_user->>'status', ''), 'active') = 'active'), false),
        lock_reason = COALESCE(v_user->>'lock_reason', ''),
        note = COALESCE(v_user->>'note', ''),
        bot_count = GREATEST(1, COALESCE((v_user->>'bot_count')::integer, jsonb_array_length(COALESCE(v_user->'assigned_bot_ids', '[]'::jsonb)), 1)),
        created_at = COALESCE(NULLIF(v_user->>'created_at', '')::timestamptz, u.created_at, now()),
        updated_at = COALESCE(NULLIF(v_user->>'updated_at', '')::timestamptz, now())
    WHERE u.id = v_id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected = 0 THEN
      UPDATE public.manager_users AS u
      SET id = v_id,
          username = v_username,
          password = v_user->>'password',
          role = COALESCE(NULLIF(v_user->>'role', ''), 'user'),
          status = COALESCE(NULLIF(v_user->>'status', ''), 'active'),
          assigned_bot_ids = COALESCE(v_user->'assigned_bot_ids', '[]'::jsonb),
          expires_at = NULLIF(v_user->>'expires_at', '')::timestamptz,
          plan_name = COALESCE(NULLIF(v_user->>'plan_name', ''), 'Gói mặc định'),
          bot_aliases = CASE WHEN jsonb_typeof(v_user->'bot_aliases') = 'object' THEN v_user->'bot_aliases' ELSE '{}'::jsonb END,
          allow_account_change = COALESCE((v_user->>'allow_account_change')::boolean, true),
          is_permanent = COALESCE((v_user->>'is_permanent')::boolean, (NULLIF(v_user->>'expires_at', '') IS NULL AND COALESCE(NULLIF(v_user->>'role', ''), 'user') <> 'admin' AND COALESCE(NULLIF(v_user->>'status', ''), 'active') = 'active'), false),
          lock_reason = COALESCE(v_user->>'lock_reason', ''),
          note = COALESCE(v_user->>'note', ''),
          bot_count = GREATEST(1, COALESCE((v_user->>'bot_count')::integer, jsonb_array_length(COALESCE(v_user->'assigned_bot_ids', '[]'::jsonb)), 1)),
          created_at = COALESCE(NULLIF(v_user->>'created_at', '')::timestamptz, u.created_at, now()),
          updated_at = COALESCE(NULLIF(v_user->>'updated_at', '')::timestamptz, now())
      WHERE lower(u.username) = lower(v_username);
      GET DIAGNOSTICS v_affected = ROW_COUNT;
    END IF;
    IF v_affected = 0 THEN
      INSERT INTO public.manager_users(
        id, username, password, role, status, assigned_bot_ids, expires_at,
        plan_name, bot_aliases, allow_account_change, is_permanent, lock_reason, note,
        bot_count, created_at, updated_at
      ) VALUES (
        v_id, v_username, v_user->>'password',
        COALESCE(NULLIF(v_user->>'role', ''), 'user'),
        COALESCE(NULLIF(v_user->>'status', ''), 'active'),
        COALESCE(v_user->'assigned_bot_ids', '[]'::jsonb),
        NULLIF(v_user->>'expires_at', '')::timestamptz,
        COALESCE(NULLIF(v_user->>'plan_name', ''), 'Gói mặc định'),
        CASE WHEN jsonb_typeof(v_user->'bot_aliases') = 'object' THEN v_user->'bot_aliases' ELSE '{}'::jsonb END,
        COALESCE((v_user->>'allow_account_change')::boolean, true),
        COALESCE((v_user->>'is_permanent')::boolean, (NULLIF(v_user->>'expires_at', '') IS NULL AND COALESCE(NULLIF(v_user->>'role', ''), 'user') <> 'admin' AND COALESCE(NULLIF(v_user->>'status', ''), 'active') = 'active'), false),
        COALESCE(v_user->>'lock_reason', ''), COALESCE(v_user->>'note', ''),
        GREATEST(1, COALESCE((v_user->>'bot_count')::integer, jsonb_array_length(COALESCE(v_user->'assigned_bot_ids', '[]'::jsonb)), 1)),
        COALESCE(NULLIF(v_user->>'created_at', '')::timestamptz, now()),
        COALESCE(NULLIF(v_user->>'updated_at', '')::timestamptz, now())
      );
    END IF;
  END LOOP;

  DELETE FROM public.manager_users AS u
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_users) AS item(value)
    WHERE COALESCE(item.value->>'id', '') = u.id
       OR lower(COALESCE(item.value->>'username', '')) = lower(u.username)
  );

  SELECT revision INTO v_revision FROM public.manager_user_state WHERE singleton = true;
  v_result := jsonb_build_object('ok', true, 'revision', v_revision);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_manager_users_snapshot(
  p_expected_revision bigint,
  p_transaction_id uuid,
  p_users jsonb,
  p_allow_empty boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_existing public.manager_users_write_transactions%ROWTYPE;
  v_result jsonb;
BEGIN
  IF p_transaction_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TRANSACTION_ID');
  END IF;
  PERFORM 1 FROM public.manager_user_state WHERE singleton = true FOR UPDATE;
  SELECT * INTO v_existing FROM public.manager_users_write_transactions WHERE transaction_id = p_transaction_id;
  IF FOUND THEN
    IF v_existing.expected_revision <> p_expected_revision OR v_existing.users_payload <> p_users THEN
      RETURN jsonb_build_object('ok', false, 'error', 'TRANSACTION_MISMATCH');
    END IF;
    RETURN v_existing.result;
  END IF;
  v_result := public.apply_manager_users_snapshot_locked(p_expected_revision, p_users, p_allow_empty);
  IF COALESCE((v_result->>'ok')::boolean, false) THEN
    INSERT INTO public.manager_users_write_transactions(transaction_id, expected_revision, users_payload, result)
    VALUES (p_transaction_id, p_expected_revision, p_users, v_result);
    DELETE FROM public.manager_users_write_transactions WHERE created_at < now() - interval '24 hours';
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.insert_manager_users_if_absent(p_users jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user jsonb;
  v_id text;
  v_username text;
  v_revision bigint;
  v_inserted integer := 0;
  v_rows integer;
BEGIN
  PERFORM 1 FROM public.manager_user_state WHERE singleton = true FOR UPDATE;
  IF p_users IS NULL OR jsonb_typeof(p_users) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_USERS');
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_users) AS item(value)
    WHERE btrim(COALESCE(item.value->>'username', '')) = ''
       OR btrim(COALESCE(item.value->>'id', '')) = ''
       OR btrim(COALESCE(item.value->>'password', '')) = ''
       OR (item.value ? 'assigned_bot_ids' AND jsonb_typeof(item.value->'assigned_bot_ids') NOT IN ('array', 'null'))
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_USER_ROW');
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_users) AS item(value)
    GROUP BY lower(btrim(value->>'username'))
    HAVING lower(btrim(value->>'username')) = '' OR count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_users) AS item(value)
    GROUP BY btrim(COALESCE(value->>'id', ''))
    HAVING btrim(COALESCE(value->>'id', '')) = '' OR count(*) > 1
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DUPLICATE_OR_INVALID_USER');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_users) AS item(value)
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(item.value->'assigned_bot_ids') = 'array'
        THEN item.value->'assigned_bot_ids' ELSE '[]'::jsonb END
    ) AS assigned(value)
    GROUP BY assigned.value
    HAVING assigned.value = '' OR count(DISTINCT lower(btrim(item.value->>'username'))) > 1
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_users) AS item(value)
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(item.value->'assigned_bot_ids') = 'array'
        THEN item.value->'assigned_bot_ids' ELSE '[]'::jsonb END
    ) AS assigned(value)
    JOIN public.manager_users AS existing
      ON existing.assigned_bot_ids ? assigned.value
     AND existing.id <> COALESCE(item.value->>'id', '')
     AND lower(existing.username) <> lower(COALESCE(item.value->>'username', ''))
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BOT_OWNERSHIP_CONFLICT');
  END IF;
  FOR v_user IN SELECT value FROM jsonb_array_elements(p_users) AS item(value)
  LOOP
    v_username := btrim(COALESCE(v_user->>'username', ''));
    v_id := btrim(COALESCE(v_user->>'id', ''));
    IF v_username = '' OR v_id = '' OR COALESCE(v_user->>'password', '') = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'INVALID_USER_ROW');
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.manager_users AS existing
      WHERE lower(existing.username) = lower(v_username) OR existing.id = v_id
    ) THEN
      CONTINUE;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(v_user->'assigned_bot_ids', '[]'::jsonb)) AS assigned(value)
      JOIN public.manager_users AS existing
        ON existing.assigned_bot_ids ? (assigned.value #>> '{}')
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'BOT_OWNERSHIP_CONFLICT');
    END IF;
    INSERT INTO public.manager_users(
      id, username, password, role, status, assigned_bot_ids, expires_at,
      plan_name, bot_aliases, allow_account_change, is_permanent, lock_reason, note,
      bot_count, created_at, updated_at
    ) VALUES (
      v_id, v_username, v_user->>'password',
      COALESCE(NULLIF(v_user->>'role', ''), 'user'),
      COALESCE(NULLIF(v_user->>'status', ''), 'active'),
      COALESCE(v_user->'assigned_bot_ids', '[]'::jsonb),
      NULLIF(v_user->>'expires_at', '')::timestamptz,
      COALESCE(NULLIF(v_user->>'plan_name', ''), 'Gói mặc định'),
      CASE WHEN jsonb_typeof(v_user->'bot_aliases') = 'object' THEN v_user->'bot_aliases' ELSE '{}'::jsonb END,
      COALESCE((v_user->>'allow_account_change')::boolean, true),
      COALESCE((v_user->>'is_permanent')::boolean, (NULLIF(v_user->>'expires_at', '') IS NULL AND COALESCE(NULLIF(v_user->>'role', ''), 'user') <> 'admin' AND COALESCE(NULLIF(v_user->>'status', ''), 'active') = 'active'), false),
      COALESCE(v_user->>'lock_reason', ''), COALESCE(v_user->>'note', ''),
      GREATEST(1, COALESCE((v_user->>'bot_count')::integer, jsonb_array_length(COALESCE(v_user->'assigned_bot_ids', '[]'::jsonb)), 1)),
      COALESCE(NULLIF(v_user->>'created_at', '')::timestamptz, now()),
      COALESCE(NULLIF(v_user->>'updated_at', '')::timestamptz, now())
    ) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_inserted := v_inserted + v_rows;
  END LOOP;
  SELECT revision INTO v_revision FROM public.manager_user_state WHERE singleton = true;
  RETURN jsonb_build_object('ok', true, 'inserted', v_inserted, 'revision', v_revision);
END;
$$;

CREATE OR REPLACE FUNCTION public.redeem_manager_key_and_save_users(
  p_code text,
  p_username text,
  p_transaction_id text,
  p_expected_revision bigint,
  p_users jsonb,
  p_allow_empty boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_key public.manager_keys%ROWTYPE;
  v_transaction public.manager_key_usage_transactions%ROWTYPE;
  v_code text := upper(btrim(COALESCE(p_code, '')));
  v_username text := lower(btrim(COALESCE(p_username, '')));
  v_users jsonb;
  v_count integer;
  v_max integer;
  v_used_by text;
  v_user_revision bigint;
  v_result jsonb;
BEGIN
  IF v_code = '' OR v_username = '' OR COALESCE(btrim(p_transaction_id), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  END IF;
  PERFORM 1 FROM public.manager_user_state WHERE singleton = true FOR UPDATE;
  SELECT * INTO v_transaction FROM public.manager_key_usage_transactions WHERE transaction_id = p_transaction_id;
  IF FOUND THEN
    IF lower(v_transaction.username) <> v_username
       OR upper(COALESCE(v_transaction.usage_snapshot->>'code', v_transaction.usage_snapshot->>'key_code', '')) <> v_code THEN
      RETURN jsonb_build_object('ok', false, 'error', 'TRANSACTION_MISMATCH');
    END IF;
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'transactionId', p_transaction_id,
      'row', v_transaction.usage_snapshot, 'userRevision', v_transaction.user_revision);
  END IF;
  SELECT * INTO v_key
  FROM public.manager_keys
  WHERE upper(COALESCE(NULLIF(code, ''), key_code, '')) = v_code
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'KEY_NOT_FOUND'); END IF;

  v_max := COALESCE(v_key.max_uses, 1);
  IF v_max < 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_MAX_USES'); END IF;
  IF v_key.expires_at IS NOT NULL AND v_key.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'KEY_EXPIRED');
  END IF;
  v_users := CASE WHEN jsonb_typeof(v_key.used_users) = 'array' THEN v_key.used_users ELSE '[]'::jsonb END;
  IF jsonb_array_length(v_users) > 0 THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(lower(btrim(value)))), '[]'::jsonb) INTO v_users
    FROM jsonb_array_elements_text(v_users) AS item(value) WHERE btrim(value) <> '';
  END IF;
  IF jsonb_array_length(v_users) = 0 AND COALESCE(v_key.used_by, '') <> '' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(lower(btrim(value)))), '[]'::jsonb) INTO v_users
    FROM unnest(string_to_array(v_key.used_by, ',')) AS value WHERE btrim(value) <> '';
  END IF;
  IF v_users ? v_username THEN RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_USED'); END IF;
  v_count := GREATEST(COALESCE(v_key.used_count, 0), jsonb_array_length(v_users), CASE WHEN v_key.used THEN 1 ELSE 0 END);
  IF v_max > 0 AND v_count >= v_max THEN RETURN jsonb_build_object('ok', false, 'error', 'EXHAUSTED'); END IF;

  v_users := v_users || jsonb_build_array(v_username);
  v_count := v_count + 1;
  SELECT string_agg(value, ', ' ORDER BY ord) INTO v_used_by
  FROM jsonb_array_elements_text(v_users) WITH ORDINALITY AS item(value, ord);
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_users) AS item(value)
    WHERE lower(btrim(item.value->>'username')) = v_username
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'REDEEM_USER_MISSING');
  END IF;
  v_result := public.apply_manager_users_snapshot_locked(p_expected_revision, p_users, p_allow_empty);
  IF NOT COALESCE((v_result->>'ok')::boolean, false) THEN RETURN v_result; END IF;

  UPDATE public.manager_keys
  SET used_users = v_users, used_count = v_count, used_by = v_used_by,
      used_at = now(), used = (v_max > 0 AND v_count >= v_max)
  WHERE id = v_key.id
  RETURNING * INTO v_key;
  SELECT revision INTO v_user_revision FROM public.manager_user_state WHERE singleton = true;
  INSERT INTO public.manager_key_usage_transactions(transaction_id, key_id, username, usage_snapshot, user_revision)
  VALUES (p_transaction_id, v_key.id, v_username, to_jsonb(v_key), v_user_revision);
  RETURN jsonb_build_object('ok', true, 'transactionId', p_transaction_id,
    'row', to_jsonb(v_key), 'userRevision', v_user_revision);
END;
$$;

REVOKE ALL ON FUNCTION public.bump_manager_users_revision() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_revoked_manager_session() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.read_manager_users_snapshot() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.read_manager_session(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.read_manager_authorization(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_manager_session(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_manager_user_session(bigint,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_manager_users_snapshot_locked(bigint,jsonb,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_manager_users_snapshot(bigint,uuid,jsonb,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.insert_manager_users_if_absent(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.redeem_manager_key_and_save_users(text,text,text,bigint,jsonb,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_manager_users_snapshot() TO service_role;
GRANT EXECUTE ON FUNCTION public.read_manager_session(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_manager_authorization(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_manager_session(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_manager_user_session(bigint,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_manager_users_snapshot(bigint,uuid,jsonb,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.insert_manager_users_if_absent(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.redeem_manager_key_and_save_users(text,text,text,bigint,jsonb,boolean) TO service_role;

-- Compatibility views for alternative table names & aliases
CREATE OR REPLACE VIEW public.manager_audit AS SELECT * FROM public.audit_logs;
CREATE OR REPLACE VIEW public.backups AS SELECT * FROM public.manager_backups;
CREATE OR REPLACE VIEW public.system_settings AS
SELECT
  id,
  (data->'systemSettings') AS settings,
  updated_at
FROM public.bot_registry
WHERE id = 'default';

CREATE OR REPLACE VIEW public.bot_schedules AS
SELECT
  bot_id,
  COALESCE(bot_schedules, schedules) AS schedules,
  updated_at
FROM public.bot_settings;

GRANT ALL ON public.manager_audit TO service_role;
GRANT ALL ON public.backups TO service_role;
GRANT ALL ON public.system_settings TO service_role;
GRANT ALL ON public.bot_schedules TO service_role;
REVOKE ALL ON public.manager_audit, public.backups, public.system_settings, public.bot_schedules FROM anon, authenticated;



CREATE TABLE IF NOT EXISTS public.manager_outbox_queue (
  id text PRIMARY KEY,
  bot_id integer NOT NULL,
  type text NOT NULL DEFAULT 'auth_sync',
  event_type text DEFAULT 'auth_sync',
  aggregate_type text DEFAULT 'bot',
  aggregate_id text DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  backoff_ms integer NOT NULL DEFAULT 3000,
  processing_started_at timestamptz,
  completed_at timestamptz,
  lease_owner text,
  lease_until timestamptz,
  last_status_code integer,
  error_code text,
  last_error text,
  committed_transaction jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.manager_outbox_queue ADD COLUMN IF NOT EXISTS bot_id integer;
ALTER TABLE public.manager_outbox_queue ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'auth_sync';
ALTER TABLE public.manager_outbox_queue ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;
ALTER TABLE public.manager_outbox_queue ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE public.manager_outbox_queue ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.manager_outbox_queue ADD COLUMN IF NOT EXISTS lease_owner text;
ALTER TABLE public.manager_outbox_queue ADD COLUMN IF NOT EXISTS lease_until timestamptz;
ALTER TABLE public.manager_outbox_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.manager_outbox_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.manager_outbox_queue TO service_role;
CREATE INDEX IF NOT EXISTS idx_manager_outbox_queue_claim
  ON public.manager_outbox_queue(status, next_retry_at)
  WHERE status IN ('pending', 'processing');

CREATE TABLE IF NOT EXISTS public.manager_pending_allocations (
  id text PRIMARY KEY,
  username text NOT NULL,
  target_bot_count integer NOT NULL DEFAULT 1,
  current_assigned integer NOT NULL DEFAULT 0,
  missing_bot_count integer NOT NULL DEFAULT 1,
  preferred_bot_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending_retry',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 10,
  lease_owner text,
  lease_until timestamptz,
  last_error text,
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.manager_pending_allocations ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE public.manager_pending_allocations ADD COLUMN IF NOT EXISTS lease_owner text;
ALTER TABLE public.manager_pending_allocations ADD COLUMN IF NOT EXISTS lease_until timestamptz;
ALTER TABLE public.manager_pending_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.manager_pending_allocations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.manager_pending_allocations TO service_role;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mgr_pending_alloc_user_pending ON public.manager_pending_allocations (username) WHERE (status IN ('pending', 'pending_retry'));
CREATE INDEX IF NOT EXISTS idx_manager_pending_allocations_claim
  ON public.manager_pending_allocations(status, next_retry_at)
  WHERE status = 'pending_retry';

CREATE TABLE IF NOT EXISTS public.manager_link4m_attempts (
  attempt_id text PRIMARY KEY,
  username text NOT NULL,
  token_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  vietnam_date text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  rewarded_at timestamptz,
  reward_hours integer NOT NULL DEFAULT 12,
  ip_address text NOT NULL DEFAULT '',
  provider_reference text NOT NULL DEFAULT '',
  failure_reason text NOT NULL DEFAULT '',
  sync_status text NOT NULL DEFAULT 'synced'
);
-- NEW-01 (Wave B1): tách URL rút gọn provider khỏi provider_reference (callback/return URL).
-- provider_reference = return URL của Manager (audit trail); provider_short_url = link rút gọn
-- do provider sinh ra SAU khi createRewardLink thành công (persist để nhánh reuse trả đúng URL).
ALTER TABLE public.manager_link4m_attempts ADD COLUMN IF NOT EXISTS provider_short_url text NOT NULL DEFAULT '';
ALTER TABLE public.manager_link4m_attempts ADD COLUMN IF NOT EXISTS attempt_id text;
ALTER TABLE public.manager_link4m_attempts ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE public.manager_link4m_attempts ADD COLUMN IF NOT EXISTS token_hash text;
ALTER TABLE public.manager_link4m_attempts ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.manager_link4m_attempts ADD COLUMN IF NOT EXISTS vietnam_date text;
ALTER TABLE public.manager_link4m_attempts ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.manager_link4m_attempts ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE public.manager_link4m_attempts ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE public.manager_link4m_attempts ADD COLUMN IF NOT EXISTS rewarded_at timestamptz;
ALTER TABLE public.manager_link4m_attempts ADD COLUMN IF NOT EXISTS reward_hours integer NOT NULL DEFAULT 12;
ALTER TABLE public.manager_link4m_attempts ADD COLUMN IF NOT EXISTS ip_address text NOT NULL DEFAULT '';
ALTER TABLE public.manager_link4m_attempts ADD COLUMN IF NOT EXISTS provider_reference text NOT NULL DEFAULT '';
ALTER TABLE public.manager_link4m_attempts ADD COLUMN IF NOT EXISTS failure_reason text NOT NULL DEFAULT '';
ALTER TABLE public.manager_link4m_attempts ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'synced';
ALTER TABLE public.manager_link4m_attempts ADD COLUMN IF NOT EXISTS user_id text;
ALTER TABLE public.manager_link4m_attempts ADD COLUMN IF NOT EXISTS provider_url text NOT NULL DEFAULT '';
ALTER TABLE public.manager_link4m_attempts ADD COLUMN IF NOT EXISTS daily_date text NOT NULL DEFAULT '';
ALTER TABLE public.manager_link4m_attempts ADD COLUMN IF NOT EXISTS purge_at timestamptz;
ALTER TABLE public.manager_link4m_attempts ADD COLUMN IF NOT EXISTS processing_at timestamptz;
ALTER TABLE public.manager_link4m_attempts ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE public.manager_link4m_attempts ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.manager_link4m_attempts ALTER COLUMN username SET DEFAULT '';
ALTER TABLE public.manager_link4m_attempts ALTER COLUMN vietnam_date SET DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_link4m_attempts_user_date ON public.manager_link4m_attempts(username, vietnam_date);
CREATE INDEX IF NOT EXISTS idx_link4m_attempts_user_id_created ON public.manager_link4m_attempts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_link4m_attempts_status ON public.manager_link4m_attempts(status);
CREATE INDEX IF NOT EXISTS idx_link4m_attempts_token_hash ON public.manager_link4m_attempts(token_hash);
CREATE INDEX IF NOT EXISTS idx_link4m_attempts_sync_status ON public.manager_link4m_attempts(sync_status);
CREATE INDEX IF NOT EXISTS idx_link4m_attempts_purge_at ON public.manager_link4m_attempts(purge_at);

ALTER TABLE public.manager_link4m_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.manager_link4m_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.manager_link4m_attempts TO service_role;

-- 1. Atomic RPC: start_manager_link4m_attempt
CREATE OR REPLACE FUNCTION public.start_manager_link4m_attempt(
  p_attempt_id text,
  p_token_hash text,
  p_username text,
  p_vietnam_date text,
  p_daily_limit integer DEFAULT 2,
  p_reward_hours integer DEFAULT 12,
  p_ip_address text DEFAULT '',
  p_provider_reference text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $l4m_start$
DECLARE
  v_username text := lower(btrim(p_username));
  v_user record;
  v_today_count integer;
  v_last_rewarded_at timestamptz;
  v_active_attempt record;
  v_now timestamptz := now();
  v_expires_at timestamptz := v_now + interval '15 minutes';
  v_limit integer := GREATEST(1, LEAST(10, COALESCE(p_daily_limit, 2)));
  v_hours integer := GREATEST(1, LEAST(48, COALESCE(p_reward_hours, 12)));
BEGIN
  -- §3.2 Null and empty input guards
  IF p_attempt_id IS NULL OR btrim(p_attempt_id) = '' OR
     p_token_hash IS NULL OR btrim(p_token_hash) = '' OR
     p_username IS NULL OR btrim(p_username) = '' OR
     p_vietnam_date IS NULL OR btrim(p_vietnam_date) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_ARGUMENTS', 'message', 'Tham số đầu vào không được để trống hoặc NULL.');
  END IF;

  -- 1. Consistent locking order: Always lock manager_users first
  SELECT * INTO v_user
  FROM public.manager_users
  WHERE lower(btrim(username)) = v_username
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND', 'message', 'Tài khoản người dùng không tồn tại.');
  END IF;

  -- §3.2: Strict status allowlist. Only 'active' and 'expired' are permitted; disabled/unknown/null fail-closed
  IF v_user.status NOT IN ('active', 'expired') OR v_user.status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'USER_LOCKED', 'message', 'Tài khoản không ở trạng thái hợp lệ để vượt link nhận thưởng.');
  END IF;

  IF v_user.is_permanent IS TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PERMANENT_ACCOUNT', 'message', 'Tài khoản VIP Vĩnh viễn không cần vượt link.');
  END IF;

  -- 2. Lock manager_link4m_attempts second
  SELECT * INTO v_active_attempt
  FROM public.manager_link4m_attempts
  WHERE lower(btrim(username)) = v_username
    AND status = 'pending'
    AND expires_at > v_now
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'reused', true,
      'attemptId', v_active_attempt.attempt_id,
      'expiresAt', v_active_attempt.expires_at,
      'providerUrl', v_active_attempt.provider_short_url
    );
  END IF;

  -- Check cooldown: at least 2 hours between rewarded claims
  SELECT rewarded_at INTO v_last_rewarded_at
  FROM public.manager_link4m_attempts
  WHERE lower(btrim(username)) = v_username
    AND status = 'rewarded'
  ORDER BY rewarded_at DESC NULLS LAST
  LIMIT 1;

  IF v_last_rewarded_at IS NOT NULL AND (v_now - v_last_rewarded_at) < interval '2 hours' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'COOLDOWN',
      'message', 'Khoảng cách giữa 2 lần vượt link tối thiểu là 2 tiếng.',
      'cooldownRemainingMs', GREATEST(0, EXTRACT(EPOCH FROM ((v_last_rewarded_at + interval '2 hours') - v_now)) * 1000)
    );
  END IF;

  -- Daily quota check: Count ONLY rewarded attempts
  SELECT count(*) INTO v_today_count
  FROM public.manager_link4m_attempts
  WHERE lower(btrim(username)) = v_username
    AND vietnam_date = p_vietnam_date
    AND status = 'rewarded';

  IF v_today_count >= v_limit THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'DAILY_LIMIT_REACHED',
      'count', v_today_count,
      'limit', v_limit,
      'message', 'Đã hết lượt vượt link hôm nay (' || v_today_count || '/' || v_limit || ' lượt). Làm mới lúc 00:00 VN.'
    );
  END IF;

  INSERT INTO public.manager_link4m_attempts (
    attempt_id, username, token_hash, status, vietnam_date,
    created_at, expires_at, reward_hours, ip_address, provider_reference, sync_status
  ) VALUES (
    p_attempt_id, v_username, p_token_hash, 'pending', p_vietnam_date,
    v_now, v_expires_at, v_hours, COALESCE(p_ip_address, ''), COALESCE(p_provider_reference, ''), 'synced'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'reused', false,
    'attemptId', p_attempt_id,
    'todayCount', v_today_count,
    'remaining', v_limit - v_today_count,
    'expiresAt', v_expires_at
  );
END;
$l4m_start$;

-- 2. Atomic RPC: claim_manager_link4m_reward
CREATE OR REPLACE FUNCTION public.claim_manager_link4m_reward(
  p_attempt_id text,
  p_token_hash text,
  p_username text,
  p_reward_hours integer DEFAULT 12,
  p_provider_reference text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $l4m_claim$
DECLARE
  v_username text := lower(btrim(p_username));
  v_user record;
  v_attempt record;
  v_now timestamptz := now();
  v_current_expires_at timestamptz;
  v_new_expires_at timestamptz;
  v_new_revision bigint;
  v_reward_hours integer;
  v_reward_interval interval;
BEGIN
  -- §3.2 Null and empty input guards
  IF p_attempt_id IS NULL OR btrim(p_attempt_id) = '' OR
     p_token_hash IS NULL OR btrim(p_token_hash) = '' OR
     p_username IS NULL OR btrim(p_username) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_ARGUMENTS', 'message', 'Tham số đầu vào không được để trống hoặc NULL.');
  END IF;

  -- 1. Consistent locking order: Lock manager_users FIRST across all RPCs
  SELECT * INTO v_user
  FROM public.manager_users
  WHERE lower(btrim(username)) = v_username
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND', 'message', 'Tài khoản người dùng không tồn tại.');
  END IF;

  -- §3.2 Strict status allowlist: Only 'active' and 'expired' can claim rewards
  IF v_user.status NOT IN ('active', 'expired') OR v_user.status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'USER_LOCKED', 'message', 'Tài khoản không ở trạng thái hợp lệ để nhận thưởng.');
  END IF;

  -- 2. Lock manager_link4m_attempts SECOND
  SELECT * INTO v_attempt
  FROM public.manager_link4m_attempts
  WHERE attempt_id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ATTEMPT_NOT_FOUND', 'message', 'Không tìm thấy phiên vượt link này.');
  END IF;

  -- §3.2 Null-safe comparisons with IS DISTINCT FROM
  IF v_attempt.token_hash IS DISTINCT FROM p_token_hash THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TOKEN', 'message', 'Mã bảo mật phiên vượt link không hợp lệ.');
  END IF;

  IF lower(btrim(v_attempt.username)) IS DISTINCT FROM v_username THEN
    RETURN jsonb_build_object('ok', false, 'error', 'USER_MISMATCH', 'message', 'Phiên vượt link không thuộc về tài khoản này.');
  END IF;

  IF v_attempt.status = 'rewarded' THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'expiresAt', v_user.expires_at, 'message', 'Phiên vượt link này đã nhận thưởng trước đó.');
  END IF;

  IF v_attempt.status NOT IN ('pending', 'verified') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_STATUS', 'message', 'Trạng thái phiên không hợp lệ: ' || COALESCE(v_attempt.status, 'NULL'));
  END IF;

  IF v_attempt.expires_at IS NULL OR v_attempt.expires_at <= v_now THEN
    UPDATE public.manager_link4m_attempts SET status = 'expired', failure_reason = 'Phiên vượt link đã quá hạn hoặc thiếu thời hạn.' WHERE attempt_id = p_attempt_id;
    RETURN jsonb_build_object('ok', false, 'error', 'ATTEMPT_EXPIRED', 'message', 'Phiên vượt link đã hết hạn thời gian thực hiện.');
  END IF;

  IF v_user.is_permanent IS TRUE THEN
    UPDATE public.manager_link4m_attempts SET status = 'rewarded', rewarded_at = v_now, failure_reason = 'Tài khoản VIP Vĩnh viễn (không tiêu thụ thêm thời gian).' WHERE attempt_id = p_attempt_id;
    RETURN jsonb_build_object('ok', true, 'permanent', true, 'expiresAt', NULL, 'message', 'Tài khoản của bạn là VIP Vĩnh viễn!');
  END IF;

  v_reward_hours := GREATEST(1, LEAST(48, COALESCE(v_attempt.reward_hours, p_reward_hours, 12)));
  v_reward_interval := (v_reward_hours || ' hours')::interval;

  v_current_expires_at := v_user.expires_at;
  IF v_current_expires_at > v_now THEN
    v_new_expires_at := v_current_expires_at + v_reward_interval;
  ELSE
    v_new_expires_at := v_now + v_reward_interval;
  END IF;

  UPDATE public.manager_users
  SET expires_at = v_new_expires_at,
      status = CASE WHEN v_user.status = 'expired' THEN 'active' ELSE v_user.status END,
      updated_at = v_now
  WHERE lower(btrim(username)) = v_username;
  SELECT revision INTO v_new_revision FROM public.manager_user_state WHERE singleton = true;

  UPDATE public.manager_link4m_attempts
  SET status = 'rewarded',
      verified_at = COALESCE(verified_at, v_now),
      rewarded_at = v_now,
      sync_status = 'synced',
      provider_reference = COALESCE(NULLIF(p_provider_reference, ''), provider_reference)
  WHERE attempt_id = p_attempt_id;

  RETURN jsonb_build_object(
    'ok', true,
    'username', v_username,
    'addedHours', v_reward_hours,
    'expiresAt', v_new_expires_at,
    'userRevision', v_new_revision,
    'message', 'Đã cộng thành công ' || v_reward_hours || ' giờ sử dụng vào tài khoản!'
  );
END;
$l4m_claim$;

CREATE OR REPLACE FUNCTION public.update_manager_link4m_sync_status(
  p_attempt_id text,
  p_sync_status text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $l4m_sync$
BEGIN
  UPDATE public.manager_link4m_attempts
  SET sync_status = p_sync_status
  WHERE attempt_id = p_attempt_id;
  RETURN FOUND;
END;
$l4m_sync$;

-- 3b. Utility RPC: set_manager_link4m_short_url (NEW-01, Wave B1)
-- Persist URL rút gọn provider SAU khi createRewardLink thành công. Chỉ ghi khi attempt
-- còn 'pending' (không đụng attempt đã verified/rewarded/expired). Trả false nếu không
-- tìm thấy attempt hoặc attempt không còn pending — route coi như persist-thất-bại-mềm
-- (reuse lần sau sẽ sinh lại shortlink, không tiêu thêm hạn mức).
CREATE OR REPLACE FUNCTION public.set_manager_link4m_short_url(
  p_attempt_id text,
  p_short_url text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $l4m_short$
BEGIN
  UPDATE public.manager_link4m_attempts
  SET provider_short_url = COALESCE(NULLIF(p_short_url, ''), provider_short_url)
  WHERE attempt_id = p_attempt_id AND status = 'pending';
  RETURN FOUND;
END;
$l4m_short$;

-- 4. Utility RPC: rollback_manager_link4m_attempt
CREATE OR REPLACE FUNCTION public.rollback_manager_link4m_attempt(
  p_attempt_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $l4m_rollback$
BEGIN
  DELETE FROM public.manager_link4m_attempts
  WHERE attempt_id = p_attempt_id AND status = 'pending';
  RETURN FOUND;
END;
$l4m_rollback$;

REVOKE ALL ON FUNCTION public.start_manager_link4m_attempt(text,text,text,text,integer,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_manager_link4m_attempt(text,text,text,text,integer,integer,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.claim_manager_link4m_reward(text,text,text,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_manager_link4m_reward(text,text,text,integer,text) TO service_role;

REVOKE ALL ON FUNCTION public.update_manager_link4m_sync_status(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_manager_link4m_sync_status(text,text) TO service_role;

REVOKE ALL ON FUNCTION public.set_manager_link4m_short_url(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_manager_link4m_short_url(text,text) TO service_role;

REVOKE ALL ON FUNCTION public.rollback_manager_link4m_attempt(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rollback_manager_link4m_attempt(text) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_manager_outbox_batch(
  p_worker_id text,
  p_limit integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 60
)
RETURNS SETOF public.manager_outbox_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $outbox_claim$
DECLARE
  v_now timestamptz := now();
  v_lease_until timestamptz := v_now + (p_lease_seconds || ' seconds')::interval;
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT id
    FROM public.manager_outbox_queue
    WHERE (status = 'pending' AND (next_retry_at <= v_now OR next_retry_at IS NULL))
       OR (status = 'processing' AND lease_until <= v_now)
    ORDER BY next_retry_at ASC
    LIMIT GREATEST(1, LEAST(100, p_limit))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.manager_outbox_queue q
  SET status = 'processing',
      processing_started_at = v_now,
      lease_until = v_lease_until,
      lease_owner = p_worker_id,
      attempts = q.attempts + 1,
      updated_at = v_now
  FROM candidate c
  WHERE q.id = c.id
  RETURNING q.*;
END;
$outbox_claim$;

REVOKE ALL ON FUNCTION public.claim_manager_outbox_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_manager_outbox_batch(text, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_manager_pending_allocations(
  p_worker_id text,
  p_limit integer DEFAULT 5,
  p_lease_seconds integer DEFAULT 60
)
RETURNS SETOF public.manager_pending_allocations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $alloc_claim$
DECLARE
  v_now timestamptz := now();
  v_lease_until timestamptz := v_now + (p_lease_seconds || ' seconds')::interval;
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT id
    FROM public.manager_pending_allocations
    WHERE status = 'pending_retry'
      AND (next_retry_at <= v_now OR next_retry_at IS NULL)
      AND (lease_until IS NULL OR lease_until <= v_now)
    ORDER BY created_at ASC
    LIMIT GREATEST(1, LEAST(50, p_limit))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.manager_pending_allocations a
  SET lease_owner = p_worker_id,
      lease_until = v_lease_until,
      attempts = a.attempts + 1,
      updated_at = v_now
  FROM candidate c
  WHERE a.id = c.id
  RETURNING a.*;
END;
$alloc_claim$;

REVOKE ALL ON FUNCTION public.claim_manager_pending_allocations(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_manager_pending_allocations(text, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.prune_manager_historical_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $prune$
DECLARE
  v_deleted_tx integer := 0;
  v_deleted_rev integer := 0;
  v_deleted_outbox integer := 0;
BEGIN
  DELETE FROM public.manager_users_write_transactions WHERE created_at < now() - interval '24 hours';
  GET DIAGNOSTICS v_deleted_tx = ROW_COUNT;
  DELETE FROM public.manager_session_revocations WHERE revoked_at < now() - interval '31 days';
  GET DIAGNOSTICS v_deleted_rev = ROW_COUNT;
  DELETE FROM public.manager_outbox_queue WHERE status IN ('completed', 'dead_letter') AND updated_at < now() - interval '7 days';
  GET DIAGNOSTICS v_deleted_outbox = ROW_COUNT;
  DELETE FROM public.bot_event_logs WHERE created_at < now() - interval '14 days';
  DELETE FROM public.bot_chat_logs WHERE created_at < now() - interval '14 days';
  DELETE FROM public.bot_position_logs WHERE changed_at < now() - interval '14 days';
  RETURN jsonb_build_object('ok', true, 'deleted_write_transactions', v_deleted_tx, 'deleted_session_revocations', v_deleted_rev, 'deleted_outbox_items', v_deleted_outbox);
END;
$prune$;

REVOKE ALL ON FUNCTION public.prune_manager_historical_data() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_manager_historical_data() TO service_role;

-- -----------------------------------------------------------------------------
-- MANAGER WORKERS & COMMANDS STORE CONTRACT (V11.8 Enterprise Audit)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.manager_workers (
  worker_id text PRIMARY KEY,
  bot_number integer UNIQUE,
  name text,
  provider text DEFAULT 'wispbyte',
  service_url text,
  render_service_id text,
  secret_ciphertext text,
  enabled boolean DEFAULT true,
  settings jsonb DEFAULT '{}'::jsonb,
  status jsonb DEFAULT '{"state":"offline","online":false}'::jsonb,
  events jsonb DEFAULT '[]'::jsonb,
  last_event jsonb,
  last_heartbeat timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_manager_workers_enabled ON public.manager_workers(enabled);
ALTER TABLE public.manager_workers ADD COLUMN IF NOT EXISTS bot_number integer;
CREATE INDEX IF NOT EXISTS idx_manager_workers_enabled ON public.manager_workers(enabled);
CREATE INDEX IF NOT EXISTS idx_manager_workers_bot_number ON public.manager_workers(bot_number);
CREATE SEQUENCE IF NOT EXISTS public.manager_bot_number_seq;
DO $$
DECLARE
  v_max integer;
BEGIN
  SELECT MAX(bot_number) INTO v_max FROM public.manager_workers;
  IF v_max IS NULL OR v_max <= 0 THEN
    PERFORM setval('public.manager_bot_number_seq', 1, false);
  ELSE
    PERFORM setval('public.manager_bot_number_seq', v_max, true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'manager_workers_bot_number_unique'
  ) THEN
    BEGIN
      ALTER TABLE public.manager_workers ADD CONSTRAINT manager_workers_bot_number_unique UNIQUE (bot_number);
    EXCEPTION WHEN duplicate_table OR duplicate_object THEN
      NULL;
    END;
  END IF;
END $$
;
GRANT USAGE, SELECT ON SEQUENCE public.manager_bot_number_seq TO service_role;

CREATE TABLE IF NOT EXISTS public.manager_commands (
  command_id text PRIMARY KEY,
  worker_id text NOT NULL,
  action text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  result jsonb,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  delivered_at timestamptz,
  completed_at timestamptz
);
DO 
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'manager_commands'
      AND column_name = 'command_id'
      AND data_type <> 'text'
  ) THEN
    ALTER TABLE public.manager_commands
      ALTER COLUMN command_id TYPE text
      USING command_id::text;
  END IF;
END
;
CREATE INDEX IF NOT EXISTS idx_manager_commands_worker_status ON public.manager_commands(worker_id, status);
CREATE INDEX IF NOT EXISTS idx_manager_commands_expires ON public.manager_commands(expires_at);
CREATE INDEX IF NOT EXISTS idx_manager_commands_state_sync ON public.manager_commands(created_at ASC) WHERE status IN ('execution_completed', 'state_sync_pending');

ALTER TABLE public.manager_workers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.manager_workers FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.manager_workers TO service_role;

ALTER TABLE public.manager_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.manager_commands FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.manager_commands TO service_role;

CREATE OR REPLACE FUNCTION public.manager_next_bot_number()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $next_num$
DECLARE
  v_num integer;
BEGIN
  LOOP
    v_num := nextval('public.manager_bot_number_seq')::integer;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.manager_workers WHERE bot_number = v_num
    );
  END LOOP;
  RETURN v_num;
END;
$next_num$;
REVOKE ALL ON FUNCTION public.manager_next_bot_number() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_next_bot_number() TO service_role;

CREATE OR REPLACE FUNCTION public.manager_patch_worker_settings(
  p_worker_id text,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $patch_settings$
DECLARE
  v_settings jsonb;
BEGIN
  UPDATE public.manager_workers
  SET settings = COALESCE(settings, '{}'::jsonb) || p_patch,
      updated_at = now()
  WHERE worker_id = p_worker_id
  RETURNING settings INTO v_settings;
  RETURN v_settings;
END;
$patch_settings$;
REVOKE ALL ON FUNCTION public.manager_patch_worker_settings(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_patch_worker_settings(text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.manager_reset_worker_data(
  p_worker_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $reset_data$
BEGIN
  UPDATE public.manager_workers
  SET settings = '{}'::jsonb,
      status = '{"state":"offline","online":false}'::jsonb,
      last_event = NULL,
      updated_at = now()
  WHERE worker_id = p_worker_id;
  RETURN true;
END;
$reset_data$;
REVOKE ALL ON FUNCTION public.manager_reset_worker_data(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_reset_worker_data(text) TO service_role;

CREATE OR REPLACE FUNCTION public.manager_append_worker_event(
  p_worker_id text,
  p_event jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $append_evt$
BEGIN
  UPDATE public.manager_workers
  SET last_event = p_event,
      events = CASE
        WHEN jsonb_typeof(events) = 'array' THEN (events || p_event)
        ELSE jsonb_build_array(p_event)
      END,
      updated_at = now()
  WHERE worker_id = p_worker_id;
  RETURN true;
END;
$append_evt$;
REVOKE ALL ON FUNCTION public.manager_append_worker_event(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_append_worker_event(text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.manager_take_worker_command(
  p_worker_id text
)
RETURNS SETOF public.manager_commands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $take_cmd$
DECLARE
  v_now timestamptz := now();
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT command_id
    FROM public.manager_commands
    WHERE worker_id = p_worker_id
      AND status = 'queued'
      AND expires_at > v_now
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.manager_commands cmd
  SET status = 'delivered',
      delivered_at = v_now
  FROM candidate c
  WHERE cmd.command_id = c.command_id
  RETURNING cmd.*;
END;
$take_cmd$;
REVOKE ALL ON FUNCTION public.manager_take_worker_command(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_take_worker_command(text) TO service_role;

DROP FUNCTION IF EXISTS public.manager_enqueue_worker_command(uuid, text, text, jsonb, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.manager_enqueue_worker_command(text, text, text, jsonb, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.manager_enqueue_worker_command(
  p_command_id text,
  p_worker_id text,
  p_action text,
  p_payload jsonb,
  p_created_at timestamptz,
  p_expires_at timestamptz,
  p_allow_coalesce boolean DEFAULT false
)
RETURNS SETOF public.manager_commands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $enqueue_cmd$
DECLARE
  v_existing public.manager_commands;
  v_row public.manager_commands;
BEGIN
  IF p_allow_coalesce THEN
    PERFORM pg_advisory_xact_lock(hashtext(p_worker_id || ':' || p_action));

    SELECT * INTO v_existing
    FROM public.manager_commands
    WHERE worker_id = p_worker_id
      AND action = p_action
      AND status = 'queued'
      AND expires_at > now()
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      UPDATE public.manager_commands
      SET payload = COALESCE(p_payload, '{}'::jsonb),
          expires_at = p_expires_at,
          created_at = p_created_at
      WHERE command_id = v_existing.command_id
      RETURNING * INTO v_row;

      RETURN NEXT v_row;
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.manager_commands (
    command_id, worker_id, action, payload, status, created_at, expires_at
  ) VALUES (
    p_command_id, p_worker_id, p_action, COALESCE(p_payload, '{}'::jsonb), 'queued', p_created_at, p_expires_at
  )
  RETURNING * INTO v_row;

  RETURN NEXT v_row;
END;
$enqueue_cmd$;
REVOKE ALL ON FUNCTION public.manager_enqueue_worker_command(text, text, text, jsonb, timestamptz, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_enqueue_worker_command(text, text, text, jsonb, timestamptz, timestamptz, boolean) TO service_role;

DROP FUNCTION IF EXISTS public.manager_complete_worker_command(text, uuid, jsonb);
CREATE OR REPLACE FUNCTION public.manager_complete_worker_command(
  p_worker_id text,
  p_command_id text,
  p_result jsonb DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $complete_cmd$
DECLARE
  v_updated integer := 0;
BEGIN
  UPDATE public.manager_commands
  SET status = 'completed',
      result = COALESCE(p_result, '{}'::jsonb),
      completed_at = now()
  WHERE command_id = p_command_id
    AND worker_id = p_worker_id
    AND status IN ('delivered', 'queued');
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$complete_cmd$;
REVOKE ALL ON FUNCTION public.manager_complete_worker_command(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_complete_worker_command(text, text, jsonb) TO service_role;

DROP FUNCTION IF EXISTS public.manager_expire_worker_command(uuid);
CREATE OR REPLACE FUNCTION public.manager_expire_worker_command(
  p_command_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $expire_cmd$
DECLARE
  v_updated integer := 0;
BEGIN
  UPDATE public.manager_commands
  SET status = 'expired'
  WHERE command_id = p_command_id
    AND status IN ('queued', 'delivered');
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$expire_cmd$;
REVOKE ALL ON FUNCTION public.manager_expire_worker_command(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_expire_worker_command(text) TO service_role;

CREATE INDEX IF NOT EXISTS idx_manager_commands_status_created ON public.manager_commands(status, created_at);

DROP FUNCTION IF EXISTS public.manager_record_command_execution(text, uuid, jsonb, text, integer);
DROP FUNCTION IF EXISTS public.manager_record_command_execution(text, text, jsonb, text, integer);
CREATE OR REPLACE FUNCTION public.manager_record_command_execution(
  p_worker_id text,
  p_command_id text,
  p_result jsonb DEFAULT NULL,
  p_lease_owner text DEFAULT NULL,
  p_lease_seconds integer DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $record_exec$
DECLARE
  v_now timestamptz := now();
  v_safe_secs integer := GREATEST(1, LEAST(3600, COALESCE(p_lease_seconds, 60)));
  v_lease_until timestamptz;
  v_new_lease text := to_char((v_now + make_interval(secs => v_safe_secs)) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_now_iso text := to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_row public.manager_commands;
  v_existing_sync jsonb;
  v_incoming_sync jsonb;
  v_merged_sync jsonb;
  v_existing_token bigint := 0;
  v_next_token bigint := 0;
  v_updated_row public.manager_commands;
BEGIN
  SELECT * INTO v_row
  FROM public.manager_commands
  WHERE command_id = p_command_id
    AND worker_id = p_worker_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_row.status = 'completed' THEN
    RETURN jsonb_build_object('ok', true, 'alreadyCompleted', true, 'status', 'completed', 'command', row_to_json(v_row)::jsonb);
  END IF;

  IF v_row.status = 'state_sync_failed' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'state_sync_failed', 'status', 'state_sync_failed');
  END IF;

  IF v_row.status NOT IN ('delivered', 'queued', 'execution_completed', 'state_sync_pending') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_status', 'status', v_row.status);
  END IF;

  v_existing_sync := COALESCE(v_row.result->'_stateSync', '{}'::jsonb);
  BEGIN
    v_lease_until := NULLIF(v_existing_sync->>'leaseUntil', '')::timestamptz;
  EXCEPTION WHEN others THEN
    v_lease_until := NULL;
  END;
  BEGIN
    v_existing_token := COALESCE(NULLIF(v_existing_sync->>'fencingToken', '')::bigint, 0);
  EXCEPTION WHEN others THEN
    v_existing_token := 0;
  END;

  IF v_row.status IN ('execution_completed', 'state_sync_pending')
     AND NULLIF(v_existing_sync->>'leaseOwner', '') IS NOT NULL
     AND v_lease_until IS NOT NULL
     AND v_lease_until > v_now
     AND (p_lease_owner IS NULL OR (v_existing_sync->>'leaseOwner') <> p_lease_owner) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'state_sync_in_progress',
      'status', v_row.status,
      'fencingToken', v_existing_token
    );
  END IF;

  v_next_token := CASE
    WHEN NULLIF(p_lease_owner, '') IS NOT NULL THEN GREATEST(v_existing_token, 0) + 1
    ELSE GREATEST(v_existing_token, 0)
  END;

  v_incoming_sync := COALESCE(p_result->'_stateSync', '{}'::jsonb);
  v_merged_sync := v_existing_sync || v_incoming_sync || jsonb_build_object(
    'pending', true,
    'executionCompleted', true,
    'attempts', COALESCE((v_existing_sync->>'attempts')::integer, (v_incoming_sync->>'attempts')::integer, 0),
    'leaseOwner', p_lease_owner,
    'leaseUntil', CASE WHEN NULLIF(p_lease_owner, '') IS NOT NULL THEN v_new_lease ELSE NULL END,
    'fencingToken', v_next_token,
    'updatedAt', v_now_iso
  );

  UPDATE public.manager_commands
  SET status = 'execution_completed',
      result = jsonb_set(COALESCE(p_result, v_row.result, '{}'::jsonb), '{_stateSync}', v_merged_sync, true),
      completed_at = NULL
  WHERE command_id = p_command_id
    AND worker_id = p_worker_id
  RETURNING * INTO v_updated_row;

  RETURN jsonb_build_object(
    'ok', true,
    'alreadyCompleted', false,
    'status', 'execution_completed',
    'fencingToken', v_next_token,
    'leaseUntil', CASE WHEN NULLIF(p_lease_owner, '') IS NOT NULL THEN v_new_lease ELSE NULL END,
    'command', row_to_json(v_updated_row)::jsonb
  );
END;
$record_exec$;

DROP FUNCTION IF EXISTS public.manager_renew_command_sync_lease(text, uuid, text, integer, bigint);
DROP FUNCTION IF EXISTS public.manager_renew_command_sync_lease(text, text, text, integer, bigint);
CREATE OR REPLACE FUNCTION public.manager_renew_command_sync_lease(
  p_worker_id text,
  p_command_id text,
  p_lease_owner text,
  p_lease_seconds integer DEFAULT 60,
  p_fencing_token bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $renew_sync$
DECLARE
  v_now timestamptz := now();
  v_safe_secs integer := GREATEST(1, LEAST(3600, COALESCE(p_lease_seconds, 60)));
  v_new_lease text := to_char((v_now + make_interval(secs => v_safe_secs)) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_now_iso text := to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_row public.manager_commands;
  v_sync jsonb;
  v_owner text;
  v_lease_until timestamptz;
  v_token bigint := 0;
BEGIN
  IF COALESCE(btrim(p_lease_owner), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'lost', true, 'reason', 'invalid_lease_owner');
  END IF;

  SELECT * INTO v_row
  FROM public.manager_commands
  WHERE command_id = p_command_id
    AND worker_id = p_worker_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'lost', true, 'reason', 'not_found');
  END IF;

  IF v_row.status NOT IN ('execution_completed', 'state_sync_pending') THEN
    RETURN jsonb_build_object('ok', false, 'lost', true, 'reason', 'invalid_status', 'status', v_row.status);
  END IF;

  v_sync := COALESCE(v_row.result->'_stateSync', '{}'::jsonb);
  v_owner := NULLIF(v_sync->>'leaseOwner', '');
  BEGIN
    v_lease_until := NULLIF(v_sync->>'leaseUntil', '')::timestamptz;
  EXCEPTION WHEN others THEN
    v_lease_until := NULL;
  END;
  BEGIN
    v_token := COALESCE(NULLIF(v_sync->>'fencingToken', '')::bigint, 0);
  EXCEPTION WHEN others THEN
    v_token := 0;
  END;

  IF v_owner IS DISTINCT FROM p_lease_owner THEN
    RETURN jsonb_build_object('ok', false, 'lost', true, 'reason', 'lease_owner_mismatch', 'currentOwner', v_owner, 'currentFencingToken', v_token);
  END IF;

  IF p_fencing_token IS NOT NULL AND v_token <> p_fencing_token THEN
    RETURN jsonb_build_object('ok', false, 'lost', true, 'reason', 'fencing_token_mismatch', 'currentOwner', v_owner, 'currentFencingToken', v_token);
  END IF;

  IF v_lease_until IS NULL OR v_lease_until <= v_now THEN
    RETURN jsonb_build_object('ok', false, 'lost', true, 'reason', 'lease_expired', 'currentOwner', v_owner, 'currentFencingToken', v_token);
  END IF;

  UPDATE public.manager_commands
  SET result = jsonb_set(
        COALESCE(v_row.result, '{}'::jsonb),
        '{_stateSync}',
        v_sync || jsonb_build_object(
          'leaseUntil', v_new_lease,
          'updatedAt', v_now_iso
        ),
        true
      )
  WHERE command_id = p_command_id
    AND worker_id = p_worker_id;

  RETURN jsonb_build_object(
    'ok', true,
    'lost', false,
    'leaseOwner', v_owner,
    'leaseUntil', v_new_lease,
    'fencingToken', v_token
  );
END;
$renew_sync$;

DROP FUNCTION IF EXISTS public.manager_verify_command_sync_lease(text, uuid, text, bigint);
DROP FUNCTION IF EXISTS public.manager_verify_command_sync_lease(text, text, text, bigint);
CREATE OR REPLACE FUNCTION public.manager_verify_command_sync_lease(
  p_worker_id text,
  p_command_id text,
  p_lease_owner text,
  p_fencing_token bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $verify_sync$
DECLARE
  v_now timestamptz := now();
  v_row public.manager_commands;
  v_sync jsonb;
  v_owner text;
  v_lease_until timestamptz;
  v_token bigint := 0;
BEGIN
  IF COALESCE(btrim(p_lease_owner), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'held', false, 'reason', 'invalid_lease_owner');
  END IF;

  SELECT * INTO v_row
  FROM public.manager_commands
  WHERE command_id = p_command_id
    AND worker_id = p_worker_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'held', false, 'reason', 'not_found');
  END IF;

  IF v_row.status NOT IN ('execution_completed', 'state_sync_pending') THEN
    RETURN jsonb_build_object('ok', false, 'held', false, 'reason', 'invalid_status', 'status', v_row.status);
  END IF;

  v_sync := COALESCE(v_row.result->'_stateSync', '{}'::jsonb);
  v_owner := NULLIF(v_sync->>'leaseOwner', '');
  BEGIN
    v_lease_until := NULLIF(v_sync->>'leaseUntil', '')::timestamptz;
  EXCEPTION WHEN others THEN
    v_lease_until := NULL;
  END;
  BEGIN
    v_token := COALESCE(NULLIF(v_sync->>'fencingToken', '')::bigint, 0);
  EXCEPTION WHEN others THEN
    v_token := 0;
  END;

  IF v_owner IS DISTINCT FROM p_lease_owner THEN
    RETURN jsonb_build_object('ok', false, 'held', false, 'reason', 'lease_owner_mismatch', 'currentOwner', v_owner, 'currentFencingToken', v_token);
  END IF;

  IF p_fencing_token IS NOT NULL AND v_token <> p_fencing_token THEN
    RETURN jsonb_build_object('ok', false, 'held', false, 'reason', 'fencing_token_mismatch', 'currentOwner', v_owner, 'currentFencingToken', v_token);
  END IF;

  IF v_lease_until IS NULL OR v_lease_until <= v_now THEN
    RETURN jsonb_build_object('ok', false, 'held', false, 'reason', 'lease_expired', 'currentOwner', v_owner, 'currentFencingToken', v_token);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'held', true,
    'leaseOwner', v_owner,
    'leaseUntil', v_sync->>'leaseUntil',
    'fencingToken', v_token
  );
END;
$verify_sync$;

DROP FUNCTION IF EXISTS public.manager_mark_command_sync_pending(text, uuid, jsonb, boolean);
DROP FUNCTION IF EXISTS public.manager_mark_command_sync_pending(text, uuid, jsonb, boolean, text, bigint);
DROP FUNCTION IF EXISTS public.manager_mark_command_sync_pending(text, text, jsonb, boolean);
DROP FUNCTION IF EXISTS public.manager_mark_command_sync_pending(text, text, jsonb, boolean, text, bigint);
CREATE OR REPLACE FUNCTION public.manager_mark_command_sync_pending(
  p_worker_id text,
  p_command_id text,
  p_sync_state jsonb DEFAULT '{}'::jsonb,
  p_terminal_failed boolean DEFAULT false,
  p_lease_owner text DEFAULT NULL,
  p_fencing_token bigint DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $mark_sync$
DECLARE
  v_row public.manager_commands;
  v_sync jsonb;
  v_owner text;
  v_token bigint := 0;
  v_incoming_token bigint := 0;
  v_next_sync jsonb;
BEGIN
  SELECT * INTO v_row
  FROM public.manager_commands
  WHERE command_id = p_command_id
    AND worker_id = p_worker_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_row.status NOT IN ('queued', 'delivered', 'execution_completed', 'state_sync_pending') THEN
    RETURN false;
  END IF;

  v_sync := COALESCE(v_row.result->'_stateSync', '{}'::jsonb);
  v_owner := NULLIF(v_sync->>'leaseOwner', '');
  BEGIN
    v_token := COALESCE(NULLIF(v_sync->>'fencingToken', '')::bigint, 0);
  EXCEPTION WHEN others THEN
    v_token := 0;
  END;
  BEGIN
    v_incoming_token := COALESCE(NULLIF(p_sync_state->>'fencingToken', '')::bigint, 0);
  EXCEPTION WHEN others THEN
    v_incoming_token := 0;
  END;

  IF p_lease_owner IS NOT NULL AND v_owner IS NOT NULL AND v_owner <> p_lease_owner THEN
    RETURN false;
  END IF;

  IF p_fencing_token IS NOT NULL AND v_token > 0 AND v_token <> p_fencing_token THEN
    RETURN false;
  END IF;

  v_next_sync := COALESCE(p_sync_state, '{}'::jsonb) || jsonb_build_object(
    'fencingToken', GREATEST(v_token, v_incoming_token, COALESCE(p_fencing_token, 0))
  );

  UPDATE public.manager_commands
  SET status = CASE WHEN p_terminal_failed THEN 'state_sync_failed' ELSE 'state_sync_pending' END,
      result = jsonb_set(COALESCE(v_row.result, '{}'::jsonb), '{_stateSync}', v_next_sync, true),
      completed_at = NULL
  WHERE command_id = p_command_id
    AND worker_id = p_worker_id;
  RETURN FOUND;
END;
$mark_sync$;

DROP FUNCTION IF EXISTS public.manager_finalize_command_sync(text, uuid, jsonb, text);
DROP FUNCTION IF EXISTS public.manager_finalize_command_sync(text, uuid, jsonb, text, bigint);
DROP FUNCTION IF EXISTS public.manager_finalize_command_sync(text, text, jsonb, text);
DROP FUNCTION IF EXISTS public.manager_finalize_command_sync(text, text, jsonb, text, bigint);
CREATE OR REPLACE FUNCTION public.manager_finalize_command_sync(
  p_worker_id text,
  p_command_id text,
  p_result jsonb DEFAULT NULL,
  p_lease_owner text DEFAULT NULL,
  p_fencing_token bigint DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $finalize_sync$
DECLARE
  v_now timestamptz := now();
  v_row public.manager_commands;
  v_owner text;
  v_token bigint := 0;
BEGIN
  SELECT * INTO v_row
  FROM public.manager_commands
  WHERE command_id = p_command_id
    AND worker_id = p_worker_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_row.status = 'completed' THEN
    RETURN true;
  END IF;

  IF v_row.status NOT IN ('queued', 'delivered', 'execution_completed', 'state_sync_pending') THEN
    RETURN false;
  END IF;

  v_owner := NULLIF(v_row.result->'_stateSync'->>'leaseOwner', '');
  BEGIN
    v_token := COALESCE(NULLIF(v_row.result->'_stateSync'->>'fencingToken', '')::bigint, 0);
  EXCEPTION WHEN others THEN
    v_token := 0;
  END;

  IF p_lease_owner IS NOT NULL AND v_owner IS NOT NULL AND v_owner <> p_lease_owner THEN
    RETURN false;
  END IF;

  IF p_fencing_token IS NOT NULL AND v_token > 0 AND v_token <> p_fencing_token THEN
    RETURN false;
  END IF;

  UPDATE public.manager_commands
  SET status = 'completed',
      result = (COALESCE(p_result, v_row.result, '{}'::jsonb) - '_stateSync'),
      completed_at = v_now
  WHERE command_id = p_command_id
    AND worker_id = p_worker_id;
  RETURN FOUND;
END;
$finalize_sync$;

DROP FUNCTION IF EXISTS public.manager_claim_pending_command_syncs(text, integer, integer);
CREATE OR REPLACE FUNCTION public.manager_claim_pending_command_syncs(
  p_lease_owner text,
  p_limit integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 60
)
RETURNS SETOF public.manager_commands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $claim_sync$
DECLARE
  v_now timestamptz := now();
  v_safe_secs integer := GREATEST(1, LEAST(3600, COALESCE(p_lease_seconds, 60)));
  v_lease_until text := to_char((v_now + make_interval(secs => v_safe_secs)) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_now_iso text := to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  IF COALESCE(btrim(p_lease_owner), '') = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT c.command_id
    FROM public.manager_commands c
    WHERE c.status IN ('state_sync_pending', 'execution_completed')
      AND (
        NULLIF(c.result->'_stateSync'->>'nextRetryAt', '') IS NULL
        OR (c.result->'_stateSync'->>'nextRetryAt')::timestamptz <= v_now
      )
      AND (
        NULLIF(c.result->'_stateSync'->>'leaseUntil', '') IS NULL
        OR (c.result->'_stateSync'->>'leaseUntil')::timestamptz <= v_now
      )
    ORDER BY c.created_at ASC
    LIMIT GREATEST(1, LEAST(100, COALESCE(p_limit, 10)))
    FOR UPDATE OF c SKIP LOCKED
  )
  UPDATE public.manager_commands cmd
  SET status = 'state_sync_pending',
      result = jsonb_set(
        COALESCE(cmd.result, '{}'::jsonb),
        '{_stateSync}',
        COALESCE(cmd.result->'_stateSync', '{}'::jsonb) || jsonb_build_object(
          'pending', true,
          'leaseOwner', p_lease_owner,
          'leaseUntil', v_lease_until,
          'fencingToken', COALESCE(NULLIF(cmd.result->'_stateSync'->>'fencingToken', '')::bigint, 0) + 1,
          'updatedAt', v_now_iso
        ),
        true
      )
  FROM candidate cand
  WHERE cmd.command_id = cand.command_id
  RETURNING cmd.*;
END;
$claim_sync$;

REVOKE ALL ON FUNCTION public.manager_record_command_execution(text, text, jsonb, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.manager_renew_command_sync_lease(text, text, text, integer, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.manager_verify_command_sync_lease(text, text, text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.manager_mark_command_sync_pending(text, text, jsonb, boolean, text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.manager_finalize_command_sync(text, text, jsonb, text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.manager_claim_pending_command_syncs(text, integer, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.manager_record_command_execution(text, text, jsonb, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.manager_renew_command_sync_lease(text, text, text, integer, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.manager_verify_command_sync_lease(text, text, text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.manager_mark_command_sync_pending(text, text, jsonb, boolean, text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.manager_finalize_command_sync(text, text, jsonb, text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.manager_claim_pending_command_syncs(text, integer, integer) TO service_role;



-- ============================================================================
-- AUDIT ENHANCEMENTS: ATOMIC SEQUENCE & MISSING RPCS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.manager_set_user_access(
  p_user_id text,
  p_values jsonb,
  p_worker_ids text[],
  p_actor_id text DEFAULT ''
)
RETURNS SETOF public.manager_users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $set_access$
DECLARE
  v_clean_user text := lower(trim(COALESCE(p_user_id, '')));
  v_hint_username text := lower(trim(COALESCE(p_values->>'username', '')));
  v_user public.manager_users;
  v_target_username text;
  v_target_id text;
  v_worker_json jsonb := to_jsonb(COALESCE(p_worker_ids, ARRAY[]::text[]));
  v_worker_count integer := COALESCE(array_length(p_worker_ids, 1), 0);
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_user
  FROM public.manager_users
  WHERE id = p_user_id
     OR lower(username) = v_clean_user
     OR (v_hint_username <> '' AND lower(username) = v_hint_username)
  FOR UPDATE
  LIMIT 1;

  v_target_username := COALESCE(
    NULLIF(v_user.username, ''),
    NULLIF(v_hint_username, ''),
    CASE WHEN left(v_clean_user, 4) = 'usr_' THEN substring(v_clean_user FROM 5) ELSE v_clean_user END
  );
  v_target_id := COALESCE(
    NULLIF(v_user.id, ''),
    NULLIF(p_values->>'id', ''),
    CASE WHEN left(lower(trim(COALESCE(p_user_id, ''))), 4) = 'usr_' THEN trim(p_user_id) ELSE 'usr_' || v_target_username END
  );

  IF v_user.username IS NOT NULL THEN
    UPDATE public.manager_users
    SET role = COALESCE(p_values->>'role', manager_users.role),
        status = COALESCE(p_values->>'status', manager_users.status),
        is_permanent = COALESCE((p_values->>'is_permanent')::boolean, manager_users.is_permanent),
        expires_at = CASE WHEN p_values ? 'expires_at' THEN (p_values->>'expires_at')::timestamptz ELSE manager_users.expires_at END,
        plan_name = COALESCE(p_values->>'plan_name', manager_users.plan_name),
        bot_aliases = COALESCE(p_values->'bot_aliases', manager_users.bot_aliases),
        allow_account_change = COALESCE((p_values->>'allow_account_change')::boolean, manager_users.allow_account_change),
        lock_reason = COALESCE(p_values->>'lock_reason', manager_users.lock_reason),
        note = COALESCE(p_values->>'note', manager_users.note),
        bot_count = GREATEST(COALESCE((p_values->>'bot_count')::integer, manager_users.bot_count, 1), v_worker_count),
        assigned_bot_ids = v_worker_json,
        updated_at = v_now
    WHERE username = v_user.username;
  ELSE
    INSERT INTO public.manager_users (
      id, username, role, status, is_permanent, expires_at, plan_name,
      bot_aliases, allow_account_change, lock_reason, note, bot_count,
      assigned_bot_ids, updated_at
    ) VALUES (
      v_target_id,
      v_target_username,
      COALESCE(p_values->>'role', 'user'),
      COALESCE(p_values->>'status', 'active'),
      COALESCE((p_values->>'is_permanent')::boolean, false),
      CASE WHEN p_values ? 'expires_at' AND p_values->>'expires_at' IS NOT NULL THEN (p_values->>'expires_at')::timestamptz ELSE NULL END,
      COALESCE(p_values->>'plan_name', 'Gói mặc định'),
      COALESCE(p_values->'bot_aliases', '{}'::jsonb),
      COALESCE((p_values->>'allow_account_change')::boolean, true),
      COALESCE(p_values->>'lock_reason', ''),
      COALESCE(p_values->>'note', ''),
      GREATEST(COALESCE((p_values->>'bot_count')::integer, 1), v_worker_count),
      v_worker_json,
      v_now
    )
    ON CONFLICT (username) DO UPDATE SET
      role = COALESCE(EXCLUDED.role, manager_users.role),
      status = COALESCE(EXCLUDED.status, manager_users.status),
      is_permanent = COALESCE(EXCLUDED.is_permanent, manager_users.is_permanent),
      expires_at = CASE WHEN p_values ? 'expires_at' THEN (p_values->>'expires_at')::timestamptz ELSE manager_users.expires_at END,
      plan_name = COALESCE(EXCLUDED.plan_name, manager_users.plan_name),
      bot_aliases = COALESCE(EXCLUDED.bot_aliases, manager_users.bot_aliases),
      allow_account_change = COALESCE(EXCLUDED.allow_account_change, manager_users.allow_account_change),
      lock_reason = COALESCE(EXCLUDED.lock_reason, manager_users.lock_reason),
      note = COALESCE(EXCLUDED.note, manager_users.note),
      bot_count = GREATEST(COALESCE(EXCLUDED.bot_count, manager_users.bot_count, 1), v_worker_count),
      assigned_bot_ids = v_worker_json,
      updated_at = v_now;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'manager_access') THEN
    INSERT INTO public.manager_access (
      user_id, role, status, is_permanent, expires_at, plan_name, note, updated_at
    ) VALUES (
      v_target_id,
      COALESCE(p_values->>'role', 'user'),
      COALESCE(p_values->>'status', 'active'),
      COALESCE((p_values->>'is_permanent')::boolean, false),
      CASE WHEN p_values ? 'expires_at' AND p_values->>'expires_at' IS NOT NULL THEN (p_values->>'expires_at')::timestamptz ELSE NULL END,
      COALESCE(p_values->>'plan_name', 'Gói mặc định'),
      COALESCE(p_values->>'note', ''),
      v_now
    ) ON CONFLICT (user_id) DO UPDATE SET
      role = EXCLUDED.role, status = EXCLUDED.status, is_permanent = EXCLUDED.is_permanent,
      expires_at = EXCLUDED.expires_at, plan_name = EXCLUDED.plan_name, note = EXCLUDED.note, updated_at = v_now;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'manager_assignments') THEN
    DELETE FROM public.manager_assignments WHERE user_id IN (v_clean_user, v_target_id, v_target_username);
    IF p_worker_ids IS NOT NULL AND v_worker_count > 0 THEN
      INSERT INTO public.manager_assignments (worker_id, user_id, assigned_by, assigned_at)
      SELECT w_id, v_target_id, p_actor_id, v_now
      FROM unnest(p_worker_ids) AS w_id
      ON CONFLICT (worker_id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        assigned_by = EXCLUDED.assigned_by,
        assigned_at = EXCLUDED.assigned_at;
    END IF;
  END IF;

  RETURN QUERY SELECT * FROM public.manager_users WHERE id = v_target_id OR username = v_target_username LIMIT 1;
END;
$set_access$;
REVOKE ALL ON FUNCTION public.manager_set_user_access(text, jsonb, text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_set_user_access(text, jsonb, text[], text) TO service_role;

CREATE OR REPLACE FUNCTION public.manager_redeem_code_with_access(
  p_code_hash text,
  p_user_id text,
  p_access_values jsonb,
  p_worker_ids text[],
  p_actor_id text DEFAULT ''
)
RETURNS SETOF public.manager_keys
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $redeem_code$
DECLARE
  v_key public.manager_keys;
  v_user public.manager_users;
  v_clean_user text := lower(trim(COALESCE(p_user_id, '')));
  v_hint_username text := lower(trim(COALESCE(p_access_values->>'username', '')));
  v_target_username text;
  v_target_id text;
  v_used_arr jsonb;
  v_now timestamptz := now();
  v_worker_json jsonb := to_jsonb(COALESCE(p_worker_ids, ARRAY[]::text[]));
  v_worker_count integer := COALESCE(array_length(p_worker_ids, 1), 0);
BEGIN
  IF v_clean_user = '' THEN
    RAISE EXCEPTION 'Thiếu thông tin người dùng nhận mã kích hoạt.';
  END IF;

  SELECT * INTO v_key
  FROM public.manager_keys
  WHERE (code_hash = p_code_hash OR code = p_code_hash OR key_code = p_code_hash OR id = p_code_hash OR key_id = p_code_hash)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mã kích hoạt không tồn tại hoặc không hợp lệ.';
  END IF;

  IF v_key.expires_at IS NOT NULL AND v_key.expires_at <= v_now THEN
    RAISE EXCEPTION 'Mã kích hoạt này đã hết hạn sử dụng.';
  END IF;

  SELECT * INTO v_user
  FROM public.manager_users
  WHERE id = p_user_id
     OR lower(username) = v_clean_user
     OR (v_hint_username <> '' AND lower(username) = v_hint_username)
  FOR UPDATE
  LIMIT 1;

  v_target_username := COALESCE(
    NULLIF(v_user.username, ''),
    NULLIF(v_hint_username, ''),
    CASE WHEN left(v_clean_user, 4) = 'usr_' THEN substring(v_clean_user FROM 5) ELSE v_clean_user END
  );
  v_target_id := COALESCE(
    NULLIF(v_user.id, ''),
    NULLIF(p_access_values->>'id', ''),
    CASE WHEN left(lower(trim(COALESCE(p_user_id, ''))), 4) = 'usr_' THEN trim(p_user_id) ELSE 'usr_' || v_target_username END
  );

  v_used_arr := CASE
    WHEN jsonb_typeof(COALESCE(v_key.used_users, '[]'::jsonb)) = 'array' THEN COALESCE(v_key.used_users, '[]'::jsonb)
    ELSE '[]'::jsonb
  END;

  IF (COALESCE(v_key.used_users, '[]'::jsonb) ? v_clean_user AND jsonb_typeof(COALESCE(v_key.used_users, '[]'::jsonb)) = 'array')
     OR (v_used_arr ? v_target_username)
     OR (v_used_arr ? v_target_id) THEN
    RAISE EXCEPTION 'Tài khoản của bạn đã từng nhập mã kích hoạt này rồi.';
  END IF;

  IF v_key.used = true OR (COALESCE(v_key.max_uses, 1) > 0 AND COALESCE(v_key.used_count, 0) >= COALESCE(v_key.max_uses, 1)) THEN
    RAISE EXCEPTION 'Mã kích hoạt này đã được sử dụng hết số lần cho phép.';
  END IF;

  UPDATE public.manager_keys
  SET used_count = COALESCE(used_count, 0) + 1,
      used = CASE WHEN COALESCE(max_uses, 1) > 0 AND (COALESCE(used_count, 0) + 1) >= COALESCE(max_uses, 1) THEN true ELSE used END,
      status = CASE WHEN COALESCE(max_uses, 1) > 0 AND (COALESCE(used_count, 0) + 1) >= COALESCE(max_uses, 1) THEN 'used' ELSE 'active' END,
      used_users = CASE
        WHEN jsonb_typeof(COALESCE(used_users, '[]'::jsonb)) = 'array' THEN COALESCE(used_users, '[]'::jsonb) || to_jsonb(v_clean_user)
        ELSE jsonb_build_array(v_clean_user)
      END,
      used_by = CASE
        WHEN used_by IS NULL OR btrim(used_by) = '' THEN v_clean_user
        ELSE used_by || ',' || v_clean_user
      END,
      used_at = v_now,
      last_used_at = v_now,
      last_used_by = v_clean_user,
      updated_at = v_now
  WHERE id = v_key.id
  RETURNING * INTO v_key;

  IF v_user.username IS NOT NULL THEN
    UPDATE public.manager_users
    SET status = 'active',
        is_permanent = COALESCE((p_access_values->>'is_permanent')::boolean, v_key.is_permanent, manager_users.is_permanent),
        expires_at = CASE WHEN p_access_values ? 'expires_at' THEN (p_access_values->>'expires_at')::timestamptz ELSE manager_users.expires_at END,
        plan_name = COALESCE(p_access_values->>'plan_name', v_key.plan_name, manager_users.plan_name),
        assigned_bot_ids = CASE WHEN v_worker_count > 0 THEN v_worker_json ELSE manager_users.assigned_bot_ids END,
        bot_count = GREATEST(COALESCE(manager_users.bot_count, 1), COALESCE((p_access_values->>'bot_count')::integer, 1), COALESCE(v_key.bot_count, 1), v_worker_count),
        updated_at = v_now
    WHERE username = v_user.username;
  ELSE
    INSERT INTO public.manager_users (
      id, username, role, status, is_permanent, expires_at, plan_name,
      assigned_bot_ids, bot_count, updated_at
    ) VALUES (
      v_target_id,
      v_target_username,
      'user',
      'active',
      COALESCE((p_access_values->>'is_permanent')::boolean, v_key.is_permanent, false),
      CASE WHEN p_access_values ? 'expires_at' AND p_access_values->>'expires_at' IS NOT NULL THEN (p_access_values->>'expires_at')::timestamptz ELSE NULL END,
      COALESCE(p_access_values->>'plan_name', v_key.plan_name, 'Standard'),
      v_worker_json,
      GREATEST(COALESCE((p_access_values->>'bot_count')::integer, 1), COALESCE(v_key.bot_count, 1), v_worker_count),
      v_now
    ) ON CONFLICT (username) DO UPDATE SET
      status = 'active',
      is_permanent = COALESCE((p_access_values->>'is_permanent')::boolean, EXCLUDED.is_permanent),
      expires_at = CASE WHEN p_access_values ? 'expires_at' THEN (p_access_values->>'expires_at')::timestamptz ELSE manager_users.expires_at END,
      plan_name = COALESCE(p_access_values->>'plan_name', EXCLUDED.plan_name),
      assigned_bot_ids = CASE WHEN v_worker_count > 0 THEN v_worker_json ELSE manager_users.assigned_bot_ids END,
      bot_count = GREATEST(COALESCE(manager_users.bot_count, 1), EXCLUDED.bot_count),
      updated_at = v_now;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'manager_access') THEN
    INSERT INTO public.manager_access (
      user_id, role, status, is_permanent, expires_at, plan_name, updated_at
    ) VALUES (
      v_target_id,
      'user',
      'active',
      COALESCE((p_access_values->>'is_permanent')::boolean, v_key.is_permanent, false),
      CASE WHEN p_access_values ? 'expires_at' AND p_access_values->>'expires_at' IS NOT NULL THEN (p_access_values->>'expires_at')::timestamptz ELSE NULL END,
      COALESCE(p_access_values->>'plan_name', v_key.plan_name, 'Standard'),
      v_now
    ) ON CONFLICT (user_id) DO UPDATE SET
      status = 'active',
      is_permanent = EXCLUDED.is_permanent,
      expires_at = COALESCE(EXCLUDED.expires_at, manager_access.expires_at),
      plan_name = EXCLUDED.plan_name,
      updated_at = v_now;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'manager_assignments') THEN
    IF p_worker_ids IS NOT NULL AND v_worker_count > 0 THEN
      DELETE FROM public.manager_assignments
      WHERE user_id IN (v_clean_user, v_target_id, v_target_username)
        AND NOT (worker_id = ANY(p_worker_ids));

      INSERT INTO public.manager_assignments (worker_id, user_id, assigned_by, assigned_at)
      SELECT w_id, v_target_id, COALESCE(NULLIF(p_actor_id, ''), v_clean_user), v_now
      FROM unnest(p_worker_ids) AS w_id
      WHERE NOT EXISTS (
        SELECT 1 FROM public.manager_assignments ma
        WHERE ma.worker_id = w_id
          AND ma.user_id IN (v_clean_user, v_target_id, v_target_username)
      );
    END IF;
  END IF;

  RETURN NEXT v_key;
END;
$redeem_code$;
REVOKE ALL ON FUNCTION public.manager_redeem_code_with_access(text, text, jsonb, text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_redeem_code_with_access(text, text, jsonb, text[], text) TO service_role;

CREATE OR REPLACE FUNCTION public.manager_claim_link4m_attempt(
  p_attempt_id text,
  p_token_hash text,
  p_now timestamptz DEFAULT now()
)
RETURNS SETOF public.manager_link4m_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $claim_attempt$
DECLARE
  v_row public.manager_link4m_attempts;
  v_now timestamptz := COALESCE(p_now, now());
BEGIN
  UPDATE public.manager_link4m_attempts
  SET status = 'processing',
      processing_at = v_now,
      updated_at = v_now
  WHERE attempt_id = p_attempt_id
    AND status = 'pending'
    AND expires_at > v_now
    AND (p_token_hash IS NULL OR token_hash = p_token_hash)
  RETURNING * INTO v_row;

  IF FOUND THEN
    RETURN NEXT v_row;
  END IF;
  RETURN;
END;
$claim_attempt$;
REVOKE ALL ON FUNCTION public.manager_claim_link4m_attempt(text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_claim_link4m_attempt(text, text, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.manager_complete_link4m_reward(
  p_attempt_id text,
  p_user_id text,
  p_access_values jsonb,
  p_worker_ids text[],
  p_actor_id text DEFAULT ''
)
RETURNS SETOF public.manager_link4m_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $complete_reward$
DECLARE
  v_attempt public.manager_link4m_attempts;
  v_clean_user text := lower(trim(COALESCE(p_user_id, '')));
  v_hint_username text := lower(trim(COALESCE(p_access_values->>'username', '')));
  v_target_username text;
  v_target_id text;
  v_now timestamptz := now();
  v_user public.manager_users;
  v_worker_json jsonb := to_jsonb(COALESCE(p_worker_ids, ARRAY[]::text[]));
  v_worker_count integer := COALESCE(array_length(p_worker_ids, 1), 0);
BEGIN
  UPDATE public.manager_link4m_attempts
  SET status = 'rewarded',
      rewarded_at = v_now,
      completed_at = v_now,
      verified_at = COALESCE(verified_at, v_now),
      updated_at = v_now
  WHERE attempt_id = p_attempt_id
    AND status = 'processing'
  RETURNING * INTO v_attempt;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Phiên vượt link không ở trạng thái đang xử lý hoặc đã kết thúc.';
  END IF;

  SELECT * INTO v_user
  FROM public.manager_users
  WHERE id = p_user_id
     OR lower(username) = v_clean_user
     OR (v_hint_username <> '' AND lower(username) = v_hint_username)
  FOR UPDATE
  LIMIT 1;

  v_target_username := COALESCE(
    NULLIF(v_user.username, ''),
    NULLIF(v_hint_username, ''),
    CASE WHEN left(v_clean_user, 4) = 'usr_' THEN substring(v_clean_user FROM 5) ELSE v_clean_user END
  );
  v_target_id := COALESCE(
    NULLIF(v_user.id, ''),
    CASE WHEN left(lower(trim(COALESCE(p_user_id, ''))), 4) = 'usr_' THEN trim(p_user_id) ELSE 'usr_' || v_target_username END
  );

  IF v_user.username IS NOT NULL THEN
    UPDATE public.manager_users
    SET status = CASE WHEN status = 'expired' THEN 'active' ELSE status END,
        expires_at = CASE
          WHEN p_access_values ? 'expires_at' AND p_access_values->>'expires_at' IS NOT NULL THEN (p_access_values->>'expires_at')::timestamptz
          ELSE expires_at
        END,
        assigned_bot_ids = CASE
          WHEN v_worker_count > 0 THEN v_worker_json
          ELSE assigned_bot_ids
        END,
        bot_count = CASE
          WHEN v_worker_count > 0 THEN GREATEST(COALESCE(bot_count, 1), v_worker_count)
          ELSE bot_count
        END,
        updated_at = v_now
    WHERE username = v_user.username;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'manager_access') THEN
    INSERT INTO public.manager_access (
      user_id, role, status, is_permanent, expires_at, plan_name, note, updated_at
    ) VALUES (
      v_target_id,
      COALESCE(p_access_values->>'role', v_user.role, 'user'),
      'active',
      COALESCE((p_access_values->>'is_permanent')::boolean, v_user.is_permanent, false),
      CASE WHEN p_access_values ? 'expires_at' AND p_access_values->>'expires_at' IS NOT NULL THEN (p_access_values->>'expires_at')::timestamptz ELSE v_user.expires_at END,
      COALESCE(p_access_values->>'plan_name', v_user.plan_name, 'Standard'),
      COALESCE(p_access_values->>'note', v_user.note, ''),
      v_now
    ) ON CONFLICT (user_id) DO UPDATE SET
      status = CASE WHEN manager_access.status = 'expired' THEN 'active' ELSE manager_access.status END,
      expires_at = COALESCE(EXCLUDED.expires_at, manager_access.expires_at),
      updated_at = v_now;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'manager_assignments') THEN
    IF p_worker_ids IS NOT NULL AND v_worker_count > 0 THEN
      INSERT INTO public.manager_assignments (worker_id, user_id, assigned_by, assigned_at)
      SELECT w_id, v_target_id, COALESCE(NULLIF(p_actor_id, ''), v_clean_user), v_now
      FROM unnest(p_worker_ids) AS w_id
      WHERE NOT EXISTS (
        SELECT 1 FROM public.manager_assignments ma
        WHERE ma.worker_id = w_id
          AND ma.user_id IN (v_clean_user, v_target_id, v_target_username)
      );
    END IF;
  END IF;

  RETURN NEXT v_attempt;
END;
$complete_reward$;
REVOKE ALL ON FUNCTION public.manager_complete_link4m_reward(text, text, jsonb, text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_complete_link4m_reward(text, text, jsonb, text[], text) TO service_role;

CREATE OR REPLACE FUNCTION public.manager_register_trial_user(
  p_user_id text,
  p_username text,
  p_password text,
  p_trial_days integer DEFAULT 1,
  p_plan_name text DEFAULT 'FREE TRIAL'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $register_trial$
DECLARE
  v_clean_user text := lower(trim(COALESCE(p_username, '')));
  v_user_id text := COALESCE(NULLIF(trim(p_user_id), ''), 'usr_' || v_clean_user);
  v_now timestamptz := now();
  v_trial_days integer := GREATEST(1, COALESCE(p_trial_days, 1));
  v_expires_at timestamptz := v_now + (v_trial_days || ' days')::interval;
  v_worker_id text;
  v_bot_num integer;
BEGIN
  IF v_clean_user = '' THEN
    RAISE EXCEPTION 'Tên đăng nhập không hợp lệ.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.manager_users WHERE lower(username) = v_clean_user OR id = v_user_id) THEN
    RAISE EXCEPTION 'Tên đăng nhập này đã có người sử dụng.';
  END IF;

  SELECT w.worker_id, w.bot_number INTO v_worker_id, v_bot_num
  FROM public.manager_workers w
  WHERE w.enabled = true
    AND NOT EXISTS (
      SELECT 1 FROM public.manager_assignments a WHERE a.worker_id = w.worker_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.manager_users u WHERE u.assigned_bot_ids @> to_jsonb(w.worker_id)
    )
  ORDER BY w.bot_number ASC
  FOR UPDATE OF w SKIP LOCKED
  LIMIT 1;

  IF v_worker_id IS NULL THEN
    RAISE EXCEPTION 'NO_WORKERS_AVAILABLE: Hiện tại hệ thống không còn Bot rảnh để cấp dùng thử. Vui lòng liên hệ Quản trị viên.';
  END IF;

  INSERT INTO public.manager_users (
    id, username, password, role, status, is_permanent, is_trial, trial_bot_id,
    expires_at, plan_name, assigned_bot_ids, bot_count, note, created_at, updated_at
  ) VALUES (
    v_user_id,
    v_clean_user,
    p_password,
    'user',
    'active',
    false,
    true,
    v_worker_id,
    v_expires_at,
    COALESCE(p_plan_name, 'FREE TRIAL'),
    jsonb_build_array(v_worker_id),
    1,
    'Đăng ký mới (Free Trial 1 Bot)',
    v_now,
    v_now
  );

  INSERT INTO public.manager_assignments (worker_id, user_id, assigned_by, assigned_at)
  VALUES (v_worker_id, v_user_id, 'system:trial', v_now);

  RETURN jsonb_build_object(
    'ok', true,
    'userId', v_user_id,
    'username', v_clean_user,
    'workerId', v_worker_id,
    'botNumber', v_bot_num,
    'expiresAt', v_expires_at,
    'planName', COALESCE(p_plan_name, 'FREE TRIAL')
  );
END;
$register_trial$;
REVOKE ALL ON FUNCTION public.manager_register_trial_user(text, text, text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_register_trial_user(text, text, text, integer, text) TO service_role;

CREATE OR REPLACE FUNCTION public.manager_link_discord_account(
  p_discord_user_id text,
  p_manager_user_id text,
  p_username text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $link_discord$
DECLARE
  v_now timestamptz := now();
  v_clean_user text := lower(trim(p_username));
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.manager_discord_links
    WHERE discord_user_id = p_discord_user_id AND manager_user_id <> p_manager_user_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Tài khoản Discord này đã được liên kết với một tài khoản Web khác.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.manager_discord_links
    WHERE manager_user_id = p_manager_user_id AND discord_user_id <> p_discord_user_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Tài khoản Web này đã được liên kết với một tài khoản Discord khác.';
  END IF;

  INSERT INTO public.manager_discord_links (
    discord_user_id, manager_user_id, username, linked_at, last_verified_at, status
  ) VALUES (
    p_discord_user_id, p_manager_user_id, v_clean_user, v_now, v_now, 'active'
  ) ON CONFLICT (discord_user_id) DO UPDATE SET
    manager_user_id = EXCLUDED.manager_user_id,
    username = EXCLUDED.username,
    linked_at = v_now,
    last_verified_at = v_now,
    status = 'active',
    revoked_at = NULL;

  UPDATE public.manager_users
  SET discord_user_id = p_discord_user_id,
      updated_at = v_now
  WHERE username = v_clean_user OR id = p_manager_user_id;

  RETURN jsonb_build_object('ok', true, 'discordUserId', p_discord_user_id, 'managerUserId', p_manager_user_id);
END;
$link_discord$;
REVOKE ALL ON FUNCTION public.manager_link_discord_account(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_link_discord_account(text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.manager_unlink_discord_account(
  p_identifier text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $unlink_discord$
DECLARE
  v_id text := trim(p_identifier);
  v_row public.manager_discord_links%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.manager_discord_links
  WHERE discord_user_id = v_id OR manager_user_id = v_id OR lower(username) = lower(v_id);

  IF FOUND THEN
    DELETE FROM public.manager_discord_links WHERE discord_user_id = v_row.discord_user_id;
    UPDATE public.manager_users
    SET discord_user_id = NULL,
        updated_at = now()
    WHERE discord_user_id = v_row.discord_user_id OR username = v_row.username OR id = v_row.manager_user_id;
    RETURN jsonb_build_object('ok', true, 'unlinked', true);
  END IF;

  UPDATE public.manager_users
  SET discord_user_id = NULL,
      updated_at = now()
  WHERE discord_user_id = v_id OR username = lower(v_id) OR id = v_id;

  RETURN jsonb_build_object('ok', true, 'unlinked', true);
END;
$unlink_discord$;
REVOKE ALL ON FUNCTION public.manager_unlink_discord_account(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_unlink_discord_account(text) TO service_role;


COMMIT;
NOTIFY pgrst, 'reload schema';
