BEGIN;

CREATE TABLE IF NOT EXISTS public.manager_ip_whitelist (
  ip text PRIMARY KEY,
  reason text NOT NULL DEFAULT '',
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.manager_ip_whitelist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.manager_ip_whitelist FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.manager_ip_whitelist TO service_role;

-- Recover trial worker IDs from the durable registration field.
UPDATE public.manager_users
SET assigned_bot_ids = jsonb_build_array(trial_bot_id),
    bot_count = GREATEST(COALESCE(bot_count, 1), 1),
    updated_at = now()
WHERE is_trial = true
  AND NULLIF(trial_bot_id, '') IS NOT NULL
  AND (
    COALESCE(jsonb_typeof(assigned_bot_ids), 'null') <> 'array'
    OR COALESCE(assigned_bot_ids, '[]'::jsonb) = '[]'::jsonb
  )
  AND EXISTS (SELECT 1 FROM public.manager_workers w WHERE w.worker_id = trial_bot_id);

-- Rebuild assignment rows from user arrays; preserve existing exclusive owners.
INSERT INTO public.manager_assignments (worker_id, user_id, assigned_by, assigned_at)
SELECT DISTINCT ON (assigned.worker_id)
       assigned.worker_id,
       COALESCE(NULLIF(u.id, ''), 'usr_' || u.username),
       'migration:20261118',
       now()
FROM public.manager_users u
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE WHEN jsonb_typeof(u.assigned_bot_ids) = 'array' THEN u.assigned_bot_ids ELSE '[]'::jsonb END
) AS assigned(worker_id)
WHERE EXISTS (SELECT 1 FROM public.manager_workers w WHERE w.worker_id = assigned.worker_id)
ORDER BY assigned.worker_id, u.created_at ASC NULLS LAST, u.id, u.username
ON CONFLICT (worker_id) DO NOTHING;

-- Keep manager_users.assigned_bot_ids aligned with the assignment table.
UPDATE public.manager_users u
SET assigned_bot_ids = COALESCE((
      SELECT jsonb_agg(a.worker_id ORDER BY a.assigned_at, a.worker_id)
      FROM public.manager_assignments a
      WHERE a.user_id = COALESCE(NULLIF(u.id, ''), 'usr_' || u.username)
         OR lower(a.user_id) = lower(u.username)
    ), '[]'::jsonb),
    updated_at = now()
WHERE u.assigned_bot_ids IS DISTINCT FROM COALESCE((
  SELECT jsonb_agg(a.worker_id ORDER BY a.assigned_at, a.worker_id)
  FROM public.manager_assignments a
  WHERE a.user_id = COALESCE(NULLIF(u.id, ''), 'usr_' || u.username)
     OR lower(a.user_id) = lower(u.username)
), '[]'::jsonb);

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
    AND COALESCE(w.settings->>'rentable', 'true') <> 'false'
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
        registration_ip = COALESCE(p_values->>'registration_ip', manager_users.registration_ip),
        device_fingerprint = COALESCE(p_values->>'device_fingerprint', manager_users.device_fingerprint),
        registration_user_agent = COALESCE(p_values->>'registration_user_agent', manager_users.registration_user_agent),
        updated_at = v_now
    WHERE username = v_user.username;
  ELSE
    INSERT INTO public.manager_users (
      id, username, role, status, is_permanent, expires_at, plan_name,
      bot_aliases, allow_account_change, lock_reason, note, bot_count,
      assigned_bot_ids, registration_ip, device_fingerprint, registration_user_agent, updated_at
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
      NULLIF(p_values->>'registration_ip', ''),
      NULLIF(p_values->>'device_fingerprint', ''),
      NULLIF(p_values->>'registration_user_agent', ''),
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
      registration_ip = COALESCE(EXCLUDED.registration_ip, manager_users.registration_ip),
      device_fingerprint = COALESCE(EXCLUDED.device_fingerprint, manager_users.device_fingerprint),
      registration_user_agent = COALESCE(EXCLUDED.registration_user_agent, manager_users.registration_user_agent),
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

INSERT INTO public.manager_schema_migrations (version)
VALUES ('20261118_manager_data_sync_and_ip_whitelist')
ON CONFLICT (version) DO NOTHING;

COMMIT;
NOTIFY pgrst, 'reload schema';
