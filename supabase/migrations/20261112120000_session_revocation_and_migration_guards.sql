-- ============================================================================
-- Migration: 20261112120000_session_revocation_and_migration_guards.sql
-- Purpose:   1. Ensure user deletion & user disabling atomically revoke all
--               sessions across manager_sessions and manager_session_revocations.
--            2. Harden read_manager_session & read_manager_authorization to fail
--               closed when the underlying non-admin user does not exist or
--               is disabled (preventing stale session survival across restarts/
--               processes or concurrent admin actions).
--            3. Clean up any pre-existing orphaned/disabled user sessions and
--               verify converged schema invariants after 20261112000000.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.revoke_manager_user_sessions(p_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $revoke_user_sessions$
DECLARE
  v_clean text := trim(COALESCE(p_user_id, ''));
  v_lower text := lower(v_clean);
  v_bare text := CASE WHEN left(v_lower, 4) = 'usr_' THEN substring(v_lower FROM 5) ELSE v_lower END;
  v_user public.manager_users;
  v_candidates text[];
  v_revoked integer := 0;
BEGIN
  IF v_clean = '' THEN
    RETURN jsonb_build_object('ok', true, 'revokedCount', 0, 'userId', '');
  END IF;

  SELECT * INTO v_user
  FROM public.manager_users
  WHERE id = v_clean
     OR lower(username) = v_lower
     OR lower(username) = v_bare
     OR discord_user_id = v_clean
  LIMIT 1;

  v_candidates := ARRAY(
    SELECT DISTINCT val
    FROM unnest(ARRAY[
      v_clean,
      v_lower,
      v_bare,
      CASE WHEN v_bare <> '' THEN 'usr_' || v_bare ELSE NULL END,
      v_user.id,
      v_user.username,
      lower(COALESCE(v_user.username, '')),
      NULLIF(trim(COALESCE(v_user.discord_user_id, '')), '')
    ]) AS val
    WHERE val IS NOT NULL AND val <> ''
  );

  WITH doomed AS (
    DELETE FROM public.manager_sessions AS s
    WHERE s.role <> 'admin'
      AND (
        s.user_id = ANY(v_candidates)
        OR lower(s.username) = ANY(v_candidates)
      )
    RETURNING s.token_hash
  ),
  recorded AS (
    INSERT INTO public.manager_session_revocations(token_hash, revoked_at)
    SELECT d.token_hash, now()
    FROM doomed d
    WHERE COALESCE(btrim(d.token_hash), '') <> ''
    ON CONFLICT (token_hash) DO UPDATE
      SET revoked_at = EXCLUDED.revoked_at
    RETURNING token_hash
  )
  SELECT count(*)::integer INTO v_revoked FROM recorded;

  RETURN jsonb_build_object(
    'ok', true,
    'revokedCount', COALESCE(v_revoked, 0),
    'userId', COALESCE(NULLIF(v_user.id, ''), v_clean)
  );
END;
$revoke_user_sessions$;

REVOKE ALL ON FUNCTION public.revoke_manager_user_sessions(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_manager_user_sessions(text) TO service_role;

CREATE OR REPLACE FUNCTION public.read_manager_session(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
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
    )
    AND (
      s.role = 'admin'
      OR EXISTS (
        SELECT 1 FROM public.manager_users AS u
        WHERE u.id = s.user_id
          AND lower(u.username) = lower(s.username)
          AND lower(COALESCE(u.status, 'active')) <> 'disabled'
      )
    );
  RETURN jsonb_build_object('ok', true, 'session', v_session);
END;
$$;

CREATE OR REPLACE FUNCTION public.read_manager_authorization(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.manager_sessions%ROWTYPE;
  v_user public.manager_users%ROWTYPE;
  v_user_json jsonb;
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
    SELECT * INTO v_user
    FROM public.manager_users AS u
    WHERE u.id = v_session.user_id
      AND lower(u.username) = lower(v_session.username);

    IF NOT FOUND THEN
      INSERT INTO public.manager_session_revocations(token_hash, revoked_at)
      VALUES (p_token_hash, now())
      ON CONFLICT (token_hash) DO NOTHING;
      DELETE FROM public.manager_sessions WHERE token_hash = p_token_hash;
      RETURN jsonb_build_object('ok', true, 'session', NULL, 'user', NULL, 'revoked', true, 'reason', 'USER_NOT_FOUND');
    END IF;

    v_user_json := jsonb_build_object(
      'id', v_user.id, 'username', v_user.username, 'status', v_user.status,
      'assigned_bot_ids', v_user.assigned_bot_ids, 'expires_at', v_user.expires_at,
      'plan_name', v_user.plan_name, 'allow_account_change', v_user.allow_account_change,
      'is_permanent', v_user.is_permanent,
      'lock_reason', v_user.lock_reason
    );

    IF lower(COALESCE(v_user.status, 'active')) = 'disabled' THEN
      INSERT INTO public.manager_session_revocations(token_hash, revoked_at)
      VALUES (p_token_hash, now())
      ON CONFLICT (token_hash) DO NOTHING;
      DELETE FROM public.manager_sessions WHERE token_hash = p_token_hash;
      RETURN jsonb_build_object('ok', true, 'session', NULL, 'user', v_user_json, 'revoked', true, 'reason', 'USER_DISABLED');
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'session', to_jsonb(v_session), 'user', v_user_json);
END;
$$;

REVOKE ALL ON FUNCTION public.read_manager_session(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.read_manager_authorization(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_manager_session(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_manager_authorization(text) TO service_role;

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

DROP FUNCTION IF EXISTS public.manager_delete_user_access(text);
CREATE OR REPLACE FUNCTION public.manager_delete_user_access(
  p_user_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $del_access$
DECLARE
  v_clean text := trim(COALESCE(p_user_id, ''));
  v_lower text := lower(v_clean);
  v_bare text := CASE WHEN left(v_lower, 4) = 'usr_' THEN substring(v_lower FROM 5) ELSE v_lower END;
  v_user public.manager_users;
  v_candidates text[];
  v_deleted integer := 0;
  v_session_rev jsonb;
BEGIN
  IF v_clean = '' THEN
    RETURN jsonb_build_object('ok', true, 'deleted', false, 'userId', '', 'revokedSessions', 0);
  END IF;

  SELECT * INTO v_user
  FROM public.manager_users
  WHERE id = v_clean
     OR lower(username) = v_lower
     OR lower(username) = v_bare
     OR discord_user_id = v_clean
  FOR UPDATE
  LIMIT 1;

  v_session_rev := public.revoke_manager_user_sessions(COALESCE(NULLIF(v_user.id, ''), v_clean));

  v_candidates := ARRAY(
    SELECT DISTINCT val
    FROM unnest(ARRAY[
      v_clean,
      v_lower,
      v_bare,
      CASE WHEN v_bare <> '' THEN 'usr_' || v_bare ELSE NULL END,
      v_user.id,
      v_user.username,
      lower(COALESCE(v_user.username, '')),
      NULLIF(trim(COALESCE(v_user.discord_user_id, '')), '')
    ]) AS val
    WHERE val IS NOT NULL AND val <> ''
  );

  DELETE FROM public.manager_assignments
  WHERE user_id = ANY(v_candidates);

  DELETE FROM public.manager_discord_links
  WHERE manager_user_id = ANY(v_candidates)
     OR lower(username) = ANY(v_candidates)
     OR discord_user_id = ANY(v_candidates);

  IF to_regclass('public.manager_access') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.manager_access WHERE user_id = ANY($1)' USING v_candidates;
  END IF;

  DELETE FROM public.manager_users
  WHERE id = ANY(v_candidates)
     OR lower(username) = ANY(v_candidates);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted', v_deleted > 0,
    'userId', COALESCE(NULLIF(v_user.id, ''), v_clean),
    'revokedSessions', COALESCE((v_session_rev->>'revokedCount')::integer, 0)
  );
END;
$del_access$;
REVOKE ALL ON FUNCTION public.manager_delete_user_access(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_delete_user_access(text) TO service_role;

-- One-time cleanup of any pre-existing sessions belonging to deleted or disabled users
WITH doomed AS (
  DELETE FROM public.manager_sessions AS s
  WHERE s.role <> 'admin'
    AND NOT EXISTS (
      SELECT 1 FROM public.manager_users AS u
      WHERE u.id = s.user_id
        AND lower(u.username) = lower(s.username)
        AND lower(COALESCE(u.status, 'active')) <> 'disabled'
    )
  RETURNING s.token_hash
)
INSERT INTO public.manager_session_revocations(token_hash, revoked_at)
SELECT d.token_hash, now()
FROM doomed d
WHERE COALESCE(btrim(d.token_hash), '') <> ''
ON CONFLICT (token_hash) DO NOTHING;

-- Post-reconciliation invariant verification
DO $$
DECLARE
  v_audit_kind "char";
  v_bot_num_type text;
  v_cmd_id_type text;
  v_used_users_type text;
  v_daily_date_type text;
BEGIN
  SELECT c.relkind INTO v_audit_kind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'manager_audit';
  IF v_audit_kind IS DISTINCT FROM 'v' THEN
    RAISE EXCEPTION 'INVARIANT FAILED: public.manager_audit expected view (relkind=''v''), got %', COALESCE(v_audit_kind::text, '<null>');
  END IF;

  SELECT data_type INTO v_bot_num_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'manager_workers' AND column_name = 'bot_number';
  IF v_bot_num_type IS DISTINCT FROM 'integer' THEN
    RAISE EXCEPTION 'INVARIANT FAILED: public.manager_workers.bot_number expected integer, got %', COALESCE(v_bot_num_type, '<null>');
  END IF;

  SELECT data_type INTO v_cmd_id_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'manager_commands' AND column_name = 'command_id';
  IF v_cmd_id_type IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 'INVARIANT FAILED: public.manager_commands.command_id expected text, got %', COALESCE(v_cmd_id_type, '<null>');
  END IF;

  SELECT data_type INTO v_used_users_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'manager_keys' AND column_name = 'used_users';
  IF v_used_users_type IS DISTINCT FROM 'jsonb' THEN
    RAISE EXCEPTION 'INVARIANT FAILED: public.manager_keys.used_users expected jsonb, got %', COALESCE(v_used_users_type, '<null>');
  END IF;

  SELECT data_type INTO v_daily_date_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'manager_link4m_attempts' AND column_name = 'daily_date';
  IF v_daily_date_type IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 'INVARIANT FAILED: public.manager_link4m_attempts.daily_date expected text, got %', COALESCE(v_daily_date_type, '<null>');
  END IF;
END
$$;

INSERT INTO public.manager_schema_migrations (version)
VALUES ('20261112120000_session_revocation_and_migration_guards')
ON CONFLICT (version) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';
