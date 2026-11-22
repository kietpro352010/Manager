-- Migration: 20261122000000_deep_audit_remediation_safe.sql
-- 100% additive, idempotent, non-destructive migration for Deep Audit findings:
-- STORE-SQL-03, STORE-SQL-04, STORE-SQL-14, ENT-01, ENT-02

BEGIN;

-- 1. Ensure all user security and audit columns exist safely (STORE-SQL-04)
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS registration_ip text;
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS device_fingerprint text;
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS registration_user_agent text;
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS last_login_ip text;
ALTER TABLE public.manager_users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

-- 2. Indexes for performance and lookup (STORE-SQL-14)
CREATE INDEX IF NOT EXISTS idx_users_fingerprint ON public.manager_users(device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_users_reg_ip ON public.manager_users(registration_ip);
CREATE INDEX IF NOT EXISTS idx_users_last_login_ip ON public.manager_users(last_login_ip);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_ip_timestamp ON public.audit_logs(actor_ip, timestamp DESC);

-- 3. Ensure service_role has full table permissions (STORE-SQL-03)
GRANT ALL ON TABLE public.manager_users TO service_role;
GRANT ALL ON TABLE public.manager_keys TO service_role;
GRANT ALL ON TABLE public.manager_sessions TO service_role;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'manager_ip_whitelist') THEN
    EXECUTE 'GRANT ALL ON TABLE public.manager_ip_whitelist TO service_role';
  END IF;
END $$;

-- 4. ENT-01: Disallow disabled users from redeeming keys in manager_redeem_code_with_access
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

-- 5. ENT-02: Fix is_permanent inference in apply_manager_users_snapshot_locked & insert_manager_users_if_absent
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

-- 6. Record migration in manager_schema_migrations
INSERT INTO public.manager_schema_migrations (version)
VALUES ('20261122000000_deep_audit_remediation_safe')
ON CONFLICT (version) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';
