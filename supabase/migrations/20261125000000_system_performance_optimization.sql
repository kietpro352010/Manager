-- Migration: 20261125000000_system_performance_optimization.sql
-- 100% additive, idempotent, non-destructive PostgreSQL / Supabase optimization:
-- 1. Partial, composite & covering (INCLUDE) B-Tree indexes for Index-Only Scans on hot
--    Worker Poll, Discord Link, Assignment, Audit Log, Session, User Expiry, Link4M & Outbox paths.
-- 2. Aggressive Autovacuum / Autoanalyze thresholds on high-churn tables to prevent dead-tuple bloat
--    and reduce 20s+ PostgreSQL WAL checkpoint stalls.

BEGIN;

-- 1. Hot-path partial, composite & covering indexes (wrapped in schema guards for legacy compatibility)
DO $$
BEGIN
  -- Fast FIFO worker command poll: SELECT ... FROM manager_commands WHERE worker_id = $1 AND status = 'queued' ORDER BY created_at ASC
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'manager_commands') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_manager_commands_worker_queued_fifo ON public.manager_commands (worker_id, created_at ASC) WHERE status = ''queued''';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_manager_commands_cleanup_terminal ON public.manager_commands (created_at) WHERE status IN (''completed'', ''failed'', ''expired'')';
  END IF;

  -- Index-Only Scan for active Discord user resolution:
  -- SELECT discord_user_id, username, manager_user_id FROM manager_discord_links WHERE status = 'active'
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'manager_discord_links' AND column_name = 'username'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_manager_discord_links_active_covering ON public.manager_discord_links (discord_user_id) INCLUDE (username, manager_user_id) WHERE status = ''active''';
  END IF;

  -- Index-Only Scan for worker ownership lookup:
  -- SELECT worker_id FROM manager_assignments WHERE user_id = $1 ORDER BY assigned_at
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'manager_assignments' AND column_name = 'assigned_at'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_manager_assignments_user_covering ON public.manager_assignments (user_id, assigned_at) INCLUDE (worker_id)';
  END IF;

  -- Partial index for active non-permanent user expiration sweeps
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'manager_users' AND column_name = 'is_permanent'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_manager_users_active_expiry ON public.manager_users (expires_at) WHERE is_permanent = false AND expires_at IS NOT NULL AND status IN (''active'', ''grace_period'', ''expiring'')';
  END IF;

  -- Fast filtered system/category audit log queries: WHERE log_type = 'system' ORDER BY timestamp DESC LIMIT 50
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'log_type'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_audit_logs_log_type_timestamp ON public.audit_logs (log_type, timestamp DESC)';
  END IF;

  -- Fast expired session pruning: DELETE FROM manager_sessions WHERE expires_at < $1
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'manager_sessions' AND column_name = 'expires_at'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_manager_sessions_expires_at ON public.manager_sessions (expires_at)';
  END IF;

  -- Fast Link4M purge cleanup: DELETE FROM manager_link4m_attempts WHERE purge_at < now()
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'manager_link4m_attempts' AND column_name = 'purge_at'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_link4m_purge_at ON public.manager_link4m_attempts (purge_at) WHERE purge_at IS NOT NULL';
  END IF;

  -- Fast Outbox claim scan: WHERE status = 'pending' ORDER BY next_retry_at ASC
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'manager_outbox_queue' AND column_name = 'next_retry_at'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_outbox_pending_next_retry ON public.manager_outbox_queue (next_retry_at ASC) WHERE status = ''pending''';
  END IF;
END $$;

-- 2. Autovacuum & Autoanalyze tuning for high-churn operational tables
--    Reclaims dead tuples at 5% churn (vs 20% default) and refreshes planner stats at 2% churn (vs 10% default)
DO $$
DECLARE
  v_tbl text;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY[
    'manager_workers',
    'manager_commands',
    'manager_outbox_queue',
    'manager_locks',
    'manager_sessions',
    'bot_position_state',
    'manager_discord_links',
    'audit_logs'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = v_tbl) THEN
      EXECUTE format(
        'ALTER TABLE public.%I SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02)',
        v_tbl
      );
    END IF;
  END LOOP;
END $$;

INSERT INTO public.manager_schema_migrations (version)
SELECT '20261125000000_system_performance_optimization'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'manager_schema_migrations')
ON CONFLICT (version) DO NOTHING;

COMMIT;
