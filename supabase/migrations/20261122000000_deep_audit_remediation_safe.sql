-- Migration: 20261122000000_deep_audit_remediation_safe.sql
-- 100% additive, idempotent, non-destructive migration for Deep Audit findings:
-- STORE-SQL-03, STORE-SQL-04, STORE-SQL-05, STORE-SQL-08, STORE-SQL-12,
-- STORE-SQL-14, STORE-SQL-15, ENT-01..12

BEGIN;

CREATE TABLE IF NOT EXISTS public.manager_schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.manager_schema_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.manager_schema_migrations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.manager_schema_migrations TO service_role;

CREATE TABLE IF NOT EXISTS public.manager_ip_whitelist (
  ip text PRIMARY KEY,
  reason text NOT NULL DEFAULT '',
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.manager_ip_whitelist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.manager_ip_whitelist FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.manager_ip_whitelist TO service_role;

-- 1. Ensure all user columns exist safely (STORE-SQL-04)
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS discord_user_id text;
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS is_trial boolean NOT NULL DEFAULT false;
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS trial_bot_id text;
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS registration_ip text;
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS device_fingerprint text;
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS registration_user_agent text;
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS last_login_ip text;
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

-- 2. Partial unique index for active Discord links (STORE-SQL-12)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'manager_discord_links') THEN
    EXECUTE 'ALTER TABLE public.manager_discord_links DROP CONSTRAINT IF EXISTS manager_discord_links_user_unique';
    IF EXISTS (
      SELECT 1 FROM public.manager_discord_links
      WHERE status = 'active'
      GROUP BY manager_user_id
      HAVING count(*) > 1
    ) THEN
      RAISE NOTICE 'Duplicate active rows detected in manager_discord_links; skipping idx_manager_discord_links_active_user_unique creation until cleaned up.';
    ELSE
      EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_manager_discord_links_active_user_unique ON public.manager_discord_links(manager_user_id) WHERE status = ''active''';
    END IF;
  END IF;
END $$;

-- 3. Indexes for performance and lookup (STORE-SQL-14)
CREATE INDEX IF NOT EXISTS idx_manager_users_discord_user_id ON public.manager_users(discord_user_id);
CREATE INDEX IF NOT EXISTS idx_users_fingerprint ON public.manager_users(device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_users_reg_ip ON public.manager_users(registration_ip);
CREATE INDEX IF NOT EXISTS idx_users_last_login_ip ON public.manager_users(last_login_ip);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON public.audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_ip_timestamp ON public.audit_logs(actor_ip, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_manager_users_username_lower_btrim ON public.manager_users(lower(btrim(username)));
CREATE INDEX IF NOT EXISTS idx_manager_users_assigned_bot_ids_gin ON public.manager_users USING gin (assigned_bot_ids);
CREATE INDEX IF NOT EXISTS idx_manager_assignments_user_id ON public.manager_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_manager_sessions_user_id ON public.manager_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_link4m_user_rewarded_desc ON public.manager_link4m_attempts(lower(btrim(username)), status, rewarded_at DESC);
CREATE INDEX IF NOT EXISTS idx_link4m_user_vdate_status ON public.manager_link4m_attempts(lower(btrim(username)), vietnam_date, status);

-- 4. Permissions & sequence least privilege (STORE-SQL-03, STORE-SQL-15)
GRANT ALL ON TABLE public.manager_users TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.manager_users TO service_role;
GRANT ALL ON TABLE public.manager_keys TO service_role;
GRANT ALL ON TABLE public.manager_sessions TO service_role;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'manager_ip_whitelist') THEN
    EXECUTE 'GRANT ALL ON TABLE public.manager_ip_whitelist TO service_role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'manager_bot_number_seq' AND c.relkind = 'S') THEN
    EXECUTE 'REVOKE ALL ON SEQUENCE public.manager_bot_number_seq FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.manager_bot_number_seq TO service_role';
  END IF;
END $$;

-- 5. Hardened session, Link4M, access & redeem RPCs
CREATE OR REPLACE FUNCTION public.create_manager_user_session(
  p_expected_revision bigint,
  p_session jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
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
REVOKE ALL ON FUNCTION public.create_manager_user_session(bigint,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_manager_user_session(bigint,jsonb) TO service_role;

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
  v_resolved_username text;
  v_user record;
  v_today_count integer;
  v_last_rewarded_at timestamptz;
  v_active_attempt record;
  v_now timestamptz := now();
  v_vn_date text;
  v_expires_at timestamptz := v_now + interval '15 minutes';
  v_limit integer := GREATEST(1, LEAST(10, COALESCE(p_daily_limit, 2)));
  v_hours integer := GREATEST(1, LEAST(48, COALESCE(p_reward_hours, 12)));
BEGIN
  IF p_attempt_id IS NULL OR btrim(p_attempt_id) = '' OR
     p_token_hash IS NULL OR btrim(p_token_hash) = '' OR
     p_username IS NULL OR btrim(p_username) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_ARGUMENTS', 'message', 'Tham số đầu vào không được để trống hoặc NULL.');
  END IF;

  v_vn_date := COALESCE(NULLIF(btrim(p_vietnam_date), ''), to_char((v_now AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD'));

  -- 1. Consistent locking order: Always lock manager_users first
  SELECT * INTO v_user
  FROM public.manager_users
  WHERE lower(btrim(username)) = v_username
     OR id = btrim(p_username)
     OR discord_user_id = btrim(p_username)
  FOR UPDATE
  LIMIT 1;

  IF NOT FOUND OR v_user.username IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND', 'message', 'Tài khoản người dùng không tồn tại.');
  END IF;

  IF v_user.status IS NULL OR lower(btrim(v_user.status)) NOT IN ('active', 'expired', 'grace_period', 'expiring') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'USER_LOCKED', 'message', 'Tài khoản không ở trạng thái hợp lệ để vượt link nhận thưởng.');
  END IF;

  v_resolved_username := lower(btrim(v_user.username));

  -- 2. Lock manager_link4m_attempts second; reuse ONLY attempts that have a persisted provider_short_url
  SELECT * INTO v_active_attempt
  FROM public.manager_link4m_attempts
  WHERE lower(btrim(username)) IN (v_resolved_username, v_username)
    AND status = 'pending'
    AND expires_at > v_now
    AND NULLIF(btrim(COALESCE(provider_short_url, '')), '') IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'reused', true,
      'attemptId', v_active_attempt.attempt_id,
      'expiresAt', v_active_attempt.expires_at,
      'providerUrl', v_active_attempt.provider_short_url,
      'isPermanent', COALESCE(v_user.is_permanent, false),
      'supportMode', COALESCE(v_user.is_permanent, false)
    );
  END IF;

  SELECT rewarded_at INTO v_last_rewarded_at
  FROM public.manager_link4m_attempts
  WHERE lower(btrim(username)) IN (v_resolved_username, v_username)
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

  SELECT count(*) INTO v_today_count
  FROM public.manager_link4m_attempts
  WHERE lower(btrim(username)) IN (v_resolved_username, v_username)
    AND vietnam_date = v_vn_date
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
    attempt_id, username, user_id, token_hash, status, vietnam_date, daily_date,
    created_at, expires_at, reward_hours, ip_address, provider_reference, sync_status
  ) VALUES (
    p_attempt_id, v_resolved_username, v_user.id, p_token_hash, 'pending', v_vn_date, v_vn_date,
    v_now, v_expires_at, CASE WHEN v_user.is_permanent IS TRUE THEN 0 ELSE v_hours END, COALESCE(p_ip_address, ''), COALESCE(p_provider_reference, ''), 'synced'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'reused', false,
    'attemptId', p_attempt_id,
    'todayCount', v_today_count,
    'remaining', v_limit - v_today_count,
    'expiresAt', v_expires_at,
    'isPermanent', COALESCE(v_user.is_permanent, false),
    'supportMode', COALESCE(v_user.is_permanent, false)
  );
END;
$l4m_start$;
REVOKE ALL ON FUNCTION public.start_manager_link4m_attempt(text,text,text,text,integer,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_manager_link4m_attempt(text,text,text,text,integer,integer,text,text) TO service_role;

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
  v_resolved_username text;
  v_user record;
  v_attempt record;
  v_now timestamptz := now();
  v_vn_date text := to_char((v_now AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD');
  v_daily_limit integer := 2;
  v_today_count integer := 0;
  v_last_rewarded_at timestamptz;
  v_current_expires_at timestamptz;
  v_new_expires_at timestamptz;
  v_new_revision bigint;
  v_reward_hours integer;
  v_reward_interval interval;
BEGIN
  IF p_attempt_id IS NULL OR btrim(p_attempt_id) = '' OR
     p_token_hash IS NULL OR btrim(p_token_hash) = '' OR
     p_username IS NULL OR btrim(p_username) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_ARGUMENTS', 'message', 'Tham số đầu vào không được để trống hoặc NULL.');
  END IF;

  -- 1. Consistent locking order: Lock manager_users FIRST across all RPCs
  SELECT * INTO v_user
  FROM public.manager_users
  WHERE lower(btrim(username)) = v_username
     OR id = btrim(p_username)
     OR discord_user_id = btrim(p_username)
  FOR UPDATE
  LIMIT 1;

  IF NOT FOUND OR v_user.username IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND', 'message', 'Tài khoản người dùng không tồn tại.');
  END IF;

  IF v_user.status IS NULL OR lower(btrim(v_user.status)) NOT IN ('active', 'expired', 'grace_period', 'expiring') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'USER_LOCKED', 'message', 'Tài khoản không ở trạng thái hợp lệ để nhận thưởng.');
  END IF;

  v_resolved_username := lower(btrim(v_user.username));

  -- 2. Lock manager_link4m_attempts SECOND
  SELECT * INTO v_attempt
  FROM public.manager_link4m_attempts
  WHERE attempt_id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ATTEMPT_NOT_FOUND', 'message', 'Không tìm thấy phiên vượt link này.');
  END IF;

  IF v_attempt.token_hash IS DISTINCT FROM p_token_hash THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TOKEN', 'message', 'Mã bảo mật phiên vượt link không hợp lệ.');
  END IF;

  IF lower(btrim(COALESCE(v_attempt.username, ''))) NOT IN (v_resolved_username, v_username)
     AND COALESCE(v_attempt.user_id, '') IS DISTINCT FROM v_user.id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'USER_MISMATCH', 'message', 'Phiên vượt link không thuộc về tài khoản này.');
  END IF;

  IF v_attempt.status = 'rewarded' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'replayed', true,
      'permanent', COALESCE(v_user.is_permanent, false),
      'supportAdmin', COALESCE(v_user.is_permanent, false),
      'addedHours', CASE WHEN v_user.is_permanent IS TRUE THEN 0 ELSE COALESCE(v_attempt.reward_hours, p_reward_hours, 12) END,
      'expiresAt', v_user.expires_at,
      'message', CASE WHEN v_user.is_permanent IS TRUE THEN 'Cảm ơn bạn đã vượt link ủng hộ Admin! (Tài khoản VIP Vĩnh viễn không cộng thêm thời gian.)' ELSE 'Phiên vượt link này đã nhận thưởng trước đó.' END
    );
  END IF;

  IF v_attempt.status NOT IN ('pending', 'verified') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_STATUS', 'message', 'Trạng thái phiên không hợp lệ: ' || COALESCE(v_attempt.status, 'NULL'));
  END IF;

  IF v_attempt.expires_at IS NULL OR v_attempt.expires_at <= v_now THEN
    UPDATE public.manager_link4m_attempts SET status = 'expired', failure_reason = 'Phiên vượt link đã quá hạn hoặc thiếu thời hạn.' WHERE attempt_id = p_attempt_id;
    RETURN jsonb_build_object('ok', false, 'error', 'ATTEMPT_EXPIRED', 'message', 'Phiên vượt link đã hết hạn thời gian thực hiện.');
  END IF;

  IF v_user.is_permanent IS TRUE THEN
    UPDATE public.manager_link4m_attempts
    SET status = 'rewarded',
        verified_at = COALESCE(verified_at, v_now),
        rewarded_at = v_now,
        sync_status = 'synced',
        failure_reason = 'Vượt link ủng hộ Admin (VIP Vĩnh viễn không cộng thêm thời gian).'
    WHERE attempt_id = p_attempt_id;
    RETURN jsonb_build_object(
      'ok', true,
      'permanent', true,
      'supportAdmin', true,
      'addedHours', 0,
      'expiresAt', NULL,
      'message', 'Cảm ơn bạn đã vượt link ủng hộ Admin! (Tài khoản VIP Vĩnh viễn không cộng thêm thời gian.)'
    );
  END IF;

  -- ENT-03: Re-check 2h cooldown and daily limit inside claim transaction under FOR UPDATE
  SELECT rewarded_at INTO v_last_rewarded_at
  FROM public.manager_link4m_attempts
  WHERE lower(btrim(username)) IN (v_resolved_username, v_username)
    AND status = 'rewarded'
    AND attempt_id <> p_attempt_id
  ORDER BY rewarded_at DESC NULLS LAST
  LIMIT 1;

  IF v_last_rewarded_at IS NOT NULL AND (v_now - v_last_rewarded_at) < interval '2 hours' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'COOLDOWN',
      'message', 'Khoảng cách giữa 2 lần vượt link tối thiểu là 2 tiếng.'
    );
  END IF;

  SELECT GREATEST(1, LEAST(10, COALESCE((value->>'dailyLimit')::integer, 2)))
  INTO v_daily_limit
  FROM public.manager_settings
  WHERE key = 'link4m_runtime'
  LIMIT 1;
  v_daily_limit := COALESCE(v_daily_limit, 2);

  SELECT count(*) INTO v_today_count
  FROM public.manager_link4m_attempts
  WHERE lower(btrim(username)) IN (v_resolved_username, v_username)
    AND vietnam_date = v_vn_date
    AND status = 'rewarded';

  IF v_today_count >= v_daily_limit THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'DAILY_LIMIT_REACHED',
      'count', v_today_count,
      'limit', v_daily_limit,
      'message', 'Đã hết lượt vượt link hôm nay (' || v_today_count || '/' || v_daily_limit || ' lượt).'
    );
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
      status = CASE WHEN lower(COALESCE(v_user.status, '')) IN ('expired', 'grace_period', 'expiring') THEN 'active' ELSE v_user.status END,
      updated_at = v_now
  WHERE username = v_user.username;
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
    'username', v_resolved_username,
    'addedHours', v_reward_hours,
    'expiresAt', v_new_expires_at,
    'userRevision', v_new_revision,
    'message', 'Đã cộng thành công ' || v_reward_hours || ' giờ sử dụng vào tài khoản!'
  );
END;
$l4m_claim$;
REVOKE ALL ON FUNCTION public.claim_manager_link4m_reward(text,text,text,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_manager_link4m_reward(text,text,text,integer,text) TO service_role;

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
  v_effective_status text;
  v_worker_json jsonb := to_jsonb(COALESCE(p_worker_ids, ARRAY[]::text[]));
  v_worker_count integer := COALESCE(array_length(p_worker_ids, 1), 0);
  v_now timestamptz := now();
BEGIN
  IF v_clean_user = '' THEN
    RAISE EXCEPTION 'Thiếu user_id khi cập nhật quyền người dùng.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('user:' || v_clean_user));

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
        expires_at = CASE WHEN p_values ? 'expires_at' THEN NULLIF(btrim(COALESCE(p_values->>'expires_at', '')), '')::timestamptz ELSE manager_users.expires_at END,
        plan_name = COALESCE(p_values->>'plan_name', manager_users.plan_name),
        bot_aliases = COALESCE(p_values->'bot_aliases', manager_users.bot_aliases),
        allow_account_change = COALESCE((p_values->>'allow_account_change')::boolean, manager_users.allow_account_change),
        lock_reason = COALESCE(p_values->>'lock_reason', manager_users.lock_reason),
        note = COALESCE(p_values->>'note', manager_users.note),
        bot_count = GREATEST(COALESCE((p_values->>'bot_count')::integer, manager_users.bot_count, 1), v_worker_count),
        assigned_bot_ids = v_worker_json,
        registration_ip = COALESCE(NULLIF(btrim(COALESCE(p_values->>'registration_ip', '')), ''), manager_users.registration_ip),
        device_fingerprint = COALESCE(NULLIF(btrim(COALESCE(p_values->>'device_fingerprint', '')), ''), manager_users.device_fingerprint),
        registration_user_agent = COALESCE(NULLIF(btrim(COALESCE(p_values->>'registration_user_agent', '')), ''), manager_users.registration_user_agent),
        last_login_ip = COALESCE(NULLIF(btrim(COALESCE(p_values->>'last_login_ip', '')), ''), manager_users.last_login_ip),
        last_login_at = COALESCE(NULLIF(btrim(COALESCE(p_values->>'last_login_at', '')), '')::timestamptz, manager_users.last_login_at),
        discord_user_id = COALESCE(NULLIF(btrim(COALESCE(p_values->>'discord_user_id', '')), ''), manager_users.discord_user_id),
        is_trial = COALESCE((p_values->>'is_trial')::boolean, manager_users.is_trial),
        trial_bot_id = COALESCE(NULLIF(btrim(COALESCE(p_values->>'trial_bot_id', '')), ''), manager_users.trial_bot_id),
        updated_at = v_now
    WHERE username = v_user.username;
  ELSE
    INSERT INTO public.manager_users (
      id, username, role, status, is_permanent, expires_at, plan_name,
      bot_aliases, allow_account_change, lock_reason, note, bot_count,
      assigned_bot_ids, registration_ip, device_fingerprint, registration_user_agent,
      last_login_ip, last_login_at, discord_user_id, is_trial, trial_bot_id, updated_at
    ) VALUES (
      v_target_id,
      v_target_username,
      COALESCE(p_values->>'role', 'user'),
      COALESCE(p_values->>'status', 'active'),
      COALESCE((p_values->>'is_permanent')::boolean, false),
      NULLIF(btrim(COALESCE(p_values->>'expires_at', '')), '')::timestamptz,
      COALESCE(p_values->>'plan_name', 'Gói mặc định'),
      COALESCE(p_values->'bot_aliases', '{}'::jsonb),
      COALESCE((p_values->>'allow_account_change')::boolean, true),
      COALESCE(p_values->>'lock_reason', ''),
      COALESCE(p_values->>'note', ''),
      GREATEST(COALESCE((p_values->>'bot_count')::integer, 1), v_worker_count),
      v_worker_json,
      NULLIF(btrim(COALESCE(p_values->>'registration_ip', '')), ''),
      NULLIF(btrim(COALESCE(p_values->>'device_fingerprint', '')), ''),
      NULLIF(btrim(COALESCE(p_values->>'registration_user_agent', '')), ''),
      NULLIF(btrim(COALESCE(p_values->>'last_login_ip', '')), ''),
      NULLIF(btrim(COALESCE(p_values->>'last_login_at', '')), '')::timestamptz,
      NULLIF(btrim(COALESCE(p_values->>'discord_user_id', '')), ''),
      COALESCE((p_values->>'is_trial')::boolean, false),
      NULLIF(btrim(COALESCE(p_values->>'trial_bot_id', '')), ''),
      v_now
    )
    ON CONFLICT (username) DO UPDATE SET
      role = COALESCE(EXCLUDED.role, manager_users.role),
      status = COALESCE(EXCLUDED.status, manager_users.status),
      is_permanent = COALESCE(EXCLUDED.is_permanent, manager_users.is_permanent),
      expires_at = CASE WHEN p_values ? 'expires_at' THEN NULLIF(btrim(COALESCE(p_values->>'expires_at', '')), '')::timestamptz ELSE manager_users.expires_at END,
      plan_name = COALESCE(EXCLUDED.plan_name, manager_users.plan_name),
      bot_aliases = COALESCE(EXCLUDED.bot_aliases, manager_users.bot_aliases),
      allow_account_change = COALESCE(EXCLUDED.allow_account_change, manager_users.allow_account_change),
      lock_reason = COALESCE(EXCLUDED.lock_reason, manager_users.lock_reason),
      note = COALESCE(EXCLUDED.note, manager_users.note),
      bot_count = GREATEST(COALESCE(EXCLUDED.bot_count, manager_users.bot_count, 1), v_worker_count),
      assigned_bot_ids = v_worker_json,
      registration_ip = COALESCE(EXCLUDED.registration_ip, manager_users.registration_ip),
      device_fingerprint = COALESCE(EXCLUDED.device_fingerprint, manager_users.device_fingerprint),
      registration_user_agent = COALESCE(EXCLUDED.registration_user_agent, manager_users.registration_user_agent),
      last_login_ip = COALESCE(EXCLUDED.last_login_ip, manager_users.last_login_ip),
      last_login_at = COALESCE(EXCLUDED.last_login_at, manager_users.last_login_at),
      discord_user_id = COALESCE(EXCLUDED.discord_user_id, manager_users.discord_user_id),
      is_trial = COALESCE(EXCLUDED.is_trial, manager_users.is_trial),
      trial_bot_id = COALESCE(EXCLUDED.trial_bot_id, manager_users.trial_bot_id),
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
      NULLIF(btrim(COALESCE(p_values->>'expires_at', '')), '')::timestamptz,
      COALESCE(p_values->>'plan_name', 'Gói mặc định'),
      COALESCE(p_values->>'note', ''),
      v_now
    ) ON CONFLICT (user_id) DO UPDATE SET
      role = EXCLUDED.role, status = EXCLUDED.status, is_permanent = EXCLUDED.is_permanent,
      expires_at = CASE WHEN p_values ? 'expires_at' THEN EXCLUDED.expires_at ELSE manager_access.expires_at END,
      plan_name = EXCLUDED.plan_name, note = EXCLUDED.note, updated_at = v_now;
  END IF;

  IF p_worker_ids IS NOT NULL AND v_worker_count > 0 THEN
    UPDATE public.manager_users AS other_user
    SET assigned_bot_ids = COALESCE((
          SELECT jsonb_agg(assigned.worker_id)
          FROM jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(other_user.assigned_bot_ids) = 'array' THEN other_user.assigned_bot_ids ELSE '[]'::jsonb END
          ) AS assigned(worker_id)
          WHERE NOT (assigned.worker_id = ANY(p_worker_ids))
        ), '[]'::jsonb),
        updated_at = v_now
    WHERE other_user.id IS DISTINCT FROM v_target_id
      AND lower(other_user.username) <> v_target_username
      AND other_user.role <> 'admin'
      AND other_user.assigned_bot_ids ?| p_worker_ids;
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

  SELECT lower(COALESCE(status, 'active')) INTO v_effective_status
  FROM public.manager_users
  WHERE id = v_target_id OR username = v_target_username
  LIMIT 1;

  IF v_effective_status = 'disabled' THEN
    PERFORM public.revoke_manager_user_sessions(v_target_id);
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
  v_is_permanent boolean;
  v_add_days integer := 0;
  v_duration_ms bigint := 0;
  v_computed_expires_at timestamptz;
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

  IF COALESCE(v_key.max_uses, 1) < 0 THEN
    RAISE EXCEPTION 'Mã kích hoạt có cấu hình giới hạn lượt sử dụng không hợp lệ.';
  END IF;

  IF v_key.expires_at IS NOT NULL AND v_key.expires_at <= v_now THEN
    RAISE EXCEPTION 'Mã kích hoạt này đã hết hạn sử dụng.';
  END IF;

  SELECT * INTO v_user
  FROM public.manager_users
  WHERE id = p_user_id
     OR lower(username) = v_clean_user
     OR (v_hint_username <> '' AND lower(username) = v_hint_username)
     OR discord_user_id = p_user_id
  FOR UPDATE
  LIMIT 1;

  IF FOUND AND lower(COALESCE(v_user.status, '')) = 'disabled' THEN
    RAISE EXCEPTION 'Tài khoản người dùng đã bị khóa, không thể kích hoạt mã quà tặng.';
  END IF;

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

  IF p_worker_ids IS NOT NULL AND v_worker_count > 0
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'manager_assignments') THEN
    IF EXISTS (
      SELECT 1 FROM public.manager_assignments ma
      WHERE ma.worker_id = ANY(p_worker_ids)
        AND ma.user_id NOT IN (v_clean_user, v_target_id, v_target_username, lower(v_target_username), lower(v_target_id))
    ) THEN
      RAISE EXCEPTION 'BOT_OWNERSHIP_CONFLICT: Một hoặc nhiều bot đã thuộc sở hữu tài khoản khác.';
    END IF;
  END IF;

  v_used_arr := CASE
    WHEN jsonb_typeof(COALESCE(v_key.used_users, '[]'::jsonb)) = 'array' THEN COALESCE(v_key.used_users, '[]'::jsonb)
    ELSE '[]'::jsonb
  END;

  IF (COALESCE(v_key.used_users, '[]'::jsonb) ? v_clean_user AND jsonb_typeof(COALESCE(v_key.used_users, '[]'::jsonb)) = 'array')
     OR (v_used_arr ? v_target_username)
     OR (v_used_arr ? v_target_id)
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(v_used_arr) AS u(val)
       WHERE lower(btrim(u.val)) IN (v_clean_user, lower(v_target_username), lower(v_target_id))
     ) THEN
    RAISE EXCEPTION 'Tài khoản của bạn đã từng nhập mã kích hoạt này rồi.';
  END IF;

  IF v_key.used = true OR (COALESCE(v_key.max_uses, 1) > 0 AND COALESCE(v_key.used_count, 0) >= COALESCE(v_key.max_uses, 1)) THEN
    RAISE EXCEPTION 'Mã kích hoạt này đã được sử dụng hết số lần cho phép.';
  END IF;

  v_is_permanent := COALESCE((p_access_values->>'is_permanent')::boolean, v_key.is_permanent, v_user.is_permanent, false);
  v_add_days := COALESCE(
    NULLIF(btrim(COALESCE(p_access_values->>'add_days', '')), '')::integer,
    CASE WHEN COALESCE(v_key.days, 0) > 0 THEN v_key.days
         WHEN COALESCE(v_key.duration_days, 0) > 0 THEN v_key.duration_days
         ELSE 0 END,
    0
  );
  v_duration_ms := COALESCE(
    NULLIF(btrim(COALESCE(p_access_values->>'duration_ms', '')), '')::bigint,
    CASE WHEN COALESCE(v_key.duration_ms, 0) > 0 THEN v_key.duration_ms ELSE 0 END,
    0
  );

  IF v_is_permanent THEN
    v_computed_expires_at := NULL;
  ELSIF v_duration_ms > 0 THEN
    v_computed_expires_at := GREATEST(COALESCE(v_user.expires_at, v_now), v_now) + ((v_duration_ms::double precision / 1000.0) * interval '1 second');
  ELSIF v_add_days > 0 THEN
    v_computed_expires_at := GREATEST(COALESCE(v_user.expires_at, v_now), v_now) + make_interval(days => v_add_days);
  ELSIF p_access_values ? 'expires_at' THEN
    v_computed_expires_at := NULLIF(btrim(COALESCE(p_access_values->>'expires_at', '')), '')::timestamptz;
  ELSE
    v_computed_expires_at := v_user.expires_at;
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
        is_permanent = v_is_permanent,
        expires_at = v_computed_expires_at,
        plan_name = COALESCE(p_access_values->>'plan_name', v_key.plan_name, manager_users.plan_name),
        allow_account_change = COALESCE((p_access_values->>'allow_account_change')::boolean, manager_users.allow_account_change),
        note = COALESCE(p_access_values->>'note', manager_users.note),
        assigned_bot_ids = CASE WHEN v_worker_count > 0 THEN v_worker_json ELSE manager_users.assigned_bot_ids END,
        bot_count = GREATEST(COALESCE(manager_users.bot_count, 1), COALESCE((p_access_values->>'bot_count')::integer, 1), COALESCE(v_key.bot_count, 1), v_worker_count),
        updated_at = v_now
    WHERE username = v_user.username;
  ELSE
    INSERT INTO public.manager_users (
      id, username, role, status, is_permanent, expires_at, plan_name,
      allow_account_change, note, assigned_bot_ids, bot_count, updated_at
    ) VALUES (
      v_target_id,
      v_target_username,
      'user',
      'active',
      v_is_permanent,
      v_computed_expires_at,
      COALESCE(p_access_values->>'plan_name', v_key.plan_name, 'Standard'),
      COALESCE((p_access_values->>'allow_account_change')::boolean, true),
      COALESCE(p_access_values->>'note', ''),
      v_worker_json,
      GREATEST(COALESCE((p_access_values->>'bot_count')::integer, 1), COALESCE(v_key.bot_count, 1), v_worker_count),
      v_now
    ) ON CONFLICT (username) DO UPDATE SET
      status = 'active',
      is_permanent = COALESCE(EXCLUDED.is_permanent, manager_users.is_permanent),
      expires_at = COALESCE(EXCLUDED.expires_at, manager_users.expires_at),
      plan_name = COALESCE(p_access_values->>'plan_name', EXCLUDED.plan_name),
      allow_account_change = COALESCE((p_access_values->>'allow_account_change')::boolean, manager_users.allow_account_change),
      note = COALESCE(p_access_values->>'note', manager_users.note),
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
      v_is_permanent,
      v_computed_expires_at,
      COALESCE(p_access_values->>'plan_name', v_key.plan_name, 'Standard'),
      v_now
    ) ON CONFLICT (user_id) DO UPDATE SET
      status = 'active',
      is_permanent = EXCLUDED.is_permanent,
      expires_at = CASE WHEN EXCLUDED.is_permanent THEN NULL ELSE COALESCE(EXCLUDED.expires_at, manager_access.expires_at) END,
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
  v_vn_date text := to_char((v_now AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD');
  v_daily_limit integer := 2;
  v_today_count integer := 0;
  v_last_rewarded_at timestamptz;
  v_user public.manager_users;
  v_worker_json jsonb := to_jsonb(COALESCE(p_worker_ids, ARRAY[]::text[]));
  v_worker_count integer := COALESCE(array_length(p_worker_ids, 1), 0);
BEGIN
  -- ENT-10: Always lock manager_users FIRST
  SELECT * INTO v_user
  FROM public.manager_users
  WHERE id = p_user_id
     OR lower(username) = v_clean_user
     OR (v_hint_username <> '' AND lower(username) = v_hint_username)
     OR discord_user_id = p_user_id
  FOR UPDATE
  LIMIT 1;

  IF NOT FOUND OR v_user.username IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy tài khoản người dùng để cộng thưởng Link4M.';
  END IF;

  IF v_user.status IS NULL OR lower(btrim(v_user.status)) NOT IN ('active', 'expired', 'grace_period', 'expiring') THEN
    RAISE EXCEPTION 'Tài khoản người dùng đang bị khóa hoặc không hợp lệ.';
  END IF;

  -- ENT-03: Re-check cooldown and daily limit under FOR UPDATE lock
  SELECT rewarded_at INTO v_last_rewarded_at
  FROM public.manager_link4m_attempts
  WHERE lower(btrim(username)) IN (lower(btrim(v_user.username)), v_clean_user)
    AND status = 'rewarded'
    AND attempt_id <> p_attempt_id
  ORDER BY rewarded_at DESC NULLS LAST
  LIMIT 1;

  IF v_last_rewarded_at IS NOT NULL AND (v_now - v_last_rewarded_at) < interval '2 hours' THEN
    RAISE EXCEPTION 'Khoảng cách giữa 2 lần vượt link tối thiểu là 2 tiếng.';
  END IF;

  SELECT GREATEST(1, LEAST(10, COALESCE((value->>'dailyLimit')::integer, 2)))
  INTO v_daily_limit
  FROM public.manager_settings
  WHERE key = 'link4m_runtime'
  LIMIT 1;
  v_daily_limit := COALESCE(v_daily_limit, 2);

  SELECT count(*) INTO v_today_count
  FROM public.manager_link4m_attempts
  WHERE lower(btrim(username)) IN (lower(btrim(v_user.username)), v_clean_user)
    AND vietnam_date = v_vn_date
    AND status = 'rewarded';

  IF v_today_count >= v_daily_limit THEN
    RAISE EXCEPTION 'Đã hết lượt vượt link hôm nay (%/% lượt).', v_today_count, v_daily_limit;
  END IF;

  v_target_username := COALESCE(
    NULLIF(v_user.username, ''),
    NULLIF(v_hint_username, ''),
    CASE WHEN left(v_clean_user, 4) = 'usr_' THEN substring(v_clean_user FROM 5) ELSE v_clean_user END
  );
  v_target_id := COALESCE(
    NULLIF(v_user.id, ''),
    CASE WHEN left(lower(trim(COALESCE(p_user_id, ''))), 4) = 'usr_' THEN trim(p_user_id) ELSE 'usr_' || v_target_username END
  );

  IF p_worker_ids IS NOT NULL AND v_worker_count > 0
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'manager_assignments') THEN
    IF EXISTS (
      SELECT 1 FROM public.manager_assignments ma
      WHERE ma.worker_id = ANY(p_worker_ids)
        AND ma.user_id NOT IN (v_clean_user, v_target_id, v_target_username, lower(v_target_username), lower(v_target_id))
    ) THEN
      RAISE EXCEPTION 'BOT_OWNERSHIP_CONFLICT: Một hoặc nhiều bot đã thuộc sở hữu tài khoản khác.';
    END IF;
  END IF;

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

  UPDATE public.manager_users
  SET status = CASE WHEN lower(COALESCE(status, '')) IN ('expired', 'grace_period', 'expiring') THEN 'active' ELSE status END,
      expires_at = CASE
        WHEN p_access_values ? 'expires_at' THEN NULLIF(btrim(COALESCE(p_access_values->>'expires_at', '')), '')::timestamptz
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

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'manager_access') THEN
    INSERT INTO public.manager_access (
      user_id, role, status, is_permanent, expires_at, plan_name, note, updated_at
    ) VALUES (
      v_target_id,
      COALESCE(p_access_values->>'role', v_user.role, 'user'),
      'active',
      COALESCE((p_access_values->>'is_permanent')::boolean, v_user.is_permanent, false),
      CASE WHEN p_access_values ? 'expires_at' THEN NULLIF(btrim(COALESCE(p_access_values->>'expires_at', '')), '')::timestamptz ELSE v_user.expires_at END,
      COALESCE(p_access_values->>'plan_name', v_user.plan_name, 'Standard'),
      COALESCE(p_access_values->>'note', v_user.note, ''),
      v_now
    ) ON CONFLICT (user_id) DO UPDATE SET
      status = CASE WHEN lower(COALESCE(manager_access.status, '')) IN ('expired', 'grace_period', 'expiring') THEN 'active' ELSE manager_access.status END,
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

-- 6. Preserve non-permanent default in snapshot/import RPCs (ENT-02)
CREATE OR REPLACE FUNCTION public.apply_manager_users_snapshot_locked(
  p_expected_revision bigint,
  p_users jsonb,
  p_allow_empty boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
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
    SELECT lower(btrim(item.value->>'username'))
    FROM jsonb_array_elements(p_users) AS item(value)
    GROUP BY lower(btrim(item.value->>'username'))
    HAVING count(*) > 1
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DUPLICATE_USERNAME', 'revision', v_revision);
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
        is_permanent = COALESCE((v_user->>'is_permanent')::boolean, false),
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
          is_permanent = COALESCE((v_user->>'is_permanent')::boolean, false),
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
        COALESCE((v_user->>'is_permanent')::boolean, false),
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
    WHERE btrim(COALESCE(item.value->>'id', '')) = u.id
       OR lower(btrim(COALESCE(item.value->>'username', ''))) = lower(u.username)
  );

  UPDATE public.manager_user_state
  SET revision = revision + 1, updated_at = now()
  WHERE singleton = true
  RETURNING revision INTO v_revision;

  v_result := jsonb_build_object('ok', true, 'revision', v_revision);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_manager_users_snapshot_locked(bigint,jsonb,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_manager_users_snapshot_locked(bigint,jsonb,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.insert_manager_users_if_absent(p_users jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
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
    SELECT lower(btrim(item.value->>'username'))
    FROM jsonb_array_elements(p_users) AS item(value)
    GROUP BY lower(btrim(item.value->>'username'))
    HAVING count(*) > 1
  ) OR EXISTS (
    SELECT btrim(COALESCE(value->>'id', ''))
    FROM jsonb_array_elements(p_users) AS item(value)
    GROUP BY btrim(COALESCE(value->>'id', ''))
    HAVING btrim(COALESCE(value->>'id', '')) = '' OR count(*) > 1
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DUPLICATE_USERS_IN_BATCH');
  END IF;
  IF EXISTS (
    SELECT assigned.value
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
      COALESCE((v_user->>'is_permanent')::boolean, false),
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
REVOKE ALL ON FUNCTION public.insert_manager_users_if_absent(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_manager_users_if_absent(jsonb) TO service_role;

-- 7. Record migration in manager_schema_migrations
INSERT INTO public.manager_schema_migrations (version)
VALUES ('20261122000000_deep_audit_remediation_safe')
ON CONFLICT (version) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';
