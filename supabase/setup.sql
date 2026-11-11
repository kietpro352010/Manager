-- One-time install script for KingMC Discord Manager. Paste this whole file into Supabase SQL Editor and run it.
-- It combines the ordered migrations below and is safe to rerun. Keep the individual migration files as the source of truth.

-- ===== BEGIN 20261107_manager_schema.sql =====

-- KingMC Discord manager storage. Run this migration in Supabase SQL Editor.
-- The Discord manager uses a server-only Supabase secret/service role key.

create table if not exists public.manager_schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists public.manager_counters (
  counter_name text primary key,
  value bigint not null default 0 check (value >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.manager_workers (
  worker_id text primary key check (worker_id ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  bot_number bigint not null unique check (bot_number > 0),
  name text not null check (char_length(name) between 1 and 64),
  provider text not null check (provider in ('render', 'wispbyte')),
  service_url text not null default '',
  render_service_id text not null default '',
  secret_ciphertext text not null,
  enabled boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  status jsonb not null default '{"state":"registered","online":false}'::jsonb,
  events jsonb not null default '[]'::jsonb check (jsonb_typeof(events) = 'array'),
  last_event jsonb,
  last_heartbeat timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists manager_workers_updated_idx on public.manager_workers (updated_at desc);
create index if not exists manager_workers_enabled_heartbeat_idx on public.manager_workers (last_heartbeat desc) where enabled;

create table if not exists public.manager_access (
  user_id text primary key check (user_id ~ '^[0-9]{17,20}$'),
  role text not null check (role in ('user', 'admin')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  is_permanent boolean not null default false,
  expires_at timestamptz,
  plan_name text not null default 'Standard' check (char_length(plan_name) <= 64),
  note text not null default '' check (char_length(note) <= 300),
  username text not null default '' check (char_length(username) <= 64),
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (role <> 'admin' or is_permanent)
);
create index if not exists manager_access_updated_idx on public.manager_access (updated_at desc);
create index if not exists manager_access_expiry_idx on public.manager_access (expires_at) where role = 'user' and status = 'active' and not is_permanent;

create table if not exists public.manager_worker_assignments (
  worker_id text primary key references public.manager_workers(worker_id) on delete cascade,
  user_id text not null references public.manager_access(user_id) on delete cascade,
  assigned_by text,
  assigned_at timestamptz not null default now()
);
create index if not exists manager_worker_assignments_user_idx on public.manager_worker_assignments (user_id, assigned_at);

create table if not exists public.manager_keys (
  key_id text primary key,
  code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
  code_suffix text not null check (char_length(code_suffix) between 1 and 8),
  status text not null default 'unused' check (status in ('unused', 'used')),
  days integer not null check (days = -1 or days > 0),
  is_permanent boolean not null default false,
  bot_count integer not null default 0 check (bot_count between 0 and 25),
  worker_ids text[] not null default '{}',
  plan_name text not null default 'Standard' check (char_length(plan_name) <= 64),
  max_uses integer not null default 1 check (max_uses between 1 and 1000),
  used_count integer not null default 0 check (used_count between 0 and max_uses),
  used_users text[] not null default '{}',
  expires_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  last_used_by text
);
create index if not exists manager_keys_created_idx on public.manager_keys (created_at desc);
create index if not exists manager_keys_unused_expiry_idx on public.manager_keys (expires_at) where status = 'unused';

create table if not exists public.manager_audit (
  id bigint generated always as identity primary key,
  actor_id text,
  action text not null check (char_length(action) between 1 and 80),
  target text not null default '' check (char_length(target) <= 160),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists manager_audit_created_idx on public.manager_audit (created_at desc);
create index if not exists manager_audit_actor_created_idx on public.manager_audit (actor_id, created_at desc);

create table if not exists public.manager_settings (
  key text primary key check (char_length(key) between 1 and 80),
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.manager_link4m_attempts (
  attempt_id text primary key,
  user_id text not null check (user_id ~ '^[0-9]{17,20}$'),
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  reward_hours integer not null check (reward_hours between 1 and 48),
  status text not null check (status in ('pending', 'processing', 'rewarded', 'expired')),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  provider_url text not null default '',
  purge_at timestamptz not null,
  daily_date date not null,
  processing_at timestamptz,
  rewarded_at timestamptz
);
create index if not exists manager_link4m_user_created_idx on public.manager_link4m_attempts (user_id, created_at desc);
create index if not exists manager_link4m_rewarded_idx on public.manager_link4m_attempts (user_id, rewarded_at desc) where status = 'rewarded';
create index if not exists manager_link4m_pending_expiry_idx on public.manager_link4m_attempts (user_id, expires_at) where status = 'pending';
create index if not exists manager_link4m_purge_idx on public.manager_link4m_attempts (purge_at);

create or replace function public.manager_next_bot_number()
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into public.manager_counters as counter
  values ('botNumber', coalesce((select max(bot_number) + 1 from public.manager_workers), 1), now())
  on conflict (counter_name) do update
    set value = greatest(counter.value + 1,
      coalesce((select max(bot_number) + 1 from public.manager_workers), 1)), updated_at = now()
  returning value;
$$;

create or replace function public.manager_set_user_access(
  p_user_id text, p_values jsonb, p_worker_ids text[], p_actor_id text
)
returns public.manager_access
language plpgsql
security definer
set search_path = ''
as $$
declare result public.manager_access;
begin
  insert into public.manager_access(
    user_id, role, status, is_permanent, expires_at, plan_name, note, username, created_by, updated_by, created_at, updated_at
  ) values (
    p_user_id,
    coalesce(p_values->>'role', 'user'),
    coalesce(p_values->>'status', 'active'),
    coalesce((p_values->>'is_permanent')::boolean, false),
    nullif(p_values->>'expires_at', '')::timestamptz,
    coalesce(p_values->>'plan_name', 'Standard'),
    coalesce(p_values->>'note', ''),
    coalesce(p_values->>'username', ''),
    p_actor_id, p_actor_id, now(), now()
  )
  on conflict (user_id) do update set
    role = excluded.role, status = excluded.status, is_permanent = excluded.is_permanent,
    expires_at = excluded.expires_at, plan_name = excluded.plan_name, note = excluded.note,
    username = excluded.username, updated_by = p_actor_id, updated_at = now();

  delete from public.manager_worker_assignments where user_id = p_user_id;
  insert into public.manager_worker_assignments(worker_id, user_id, assigned_by, assigned_at)
  select distinct requested.worker_id, p_user_id, p_actor_id, now()
  from unnest(coalesce(p_worker_ids, '{}'::text[])) as requested(worker_id);

  select * into result from public.manager_access where user_id = p_user_id;
  return result;
end;
$$;

create or replace function public.manager_consume_key(p_code_hash text, p_user_id text)
returns public.manager_keys
language plpgsql
security definer
set search_path = ''
as $$
declare result public.manager_keys;
begin
  update public.manager_keys
  set used_count = used_count + 1,
      used_users = array_append(used_users, p_user_id),
      last_used_at = now(), last_used_by = p_user_id,
      status = case when used_count + 1 >= max_uses then 'used' else 'unused' end
  where code_hash = p_code_hash and status = 'unused' and not (p_user_id = any(used_users))
    and used_count < max_uses and (expires_at is null or expires_at > now())
  returning * into result;
  return result;
end;
$$;

create or replace function public.manager_release_consumed_key(p_code_hash text, p_user_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare changed integer;
begin
  update public.manager_keys
  set used_count = greatest(0, used_count - 1),
      used_users = array_remove(used_users, p_user_id),
      status = case when greatest(0, used_count - 1) < max_uses then 'unused' else 'used' end
  where code_hash = p_code_hash and p_user_id = any(used_users);
  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;

create or replace function public.manager_claim_link4m_attempt(p_attempt_id text, p_token_hash text, p_now timestamptz)
returns public.manager_link4m_attempts
language sql
security definer
set search_path = ''
as $$
  update public.manager_link4m_attempts
  set status = 'processing', processing_at = p_now
  where attempt_id = p_attempt_id and token_hash = p_token_hash and status = 'pending' and expires_at > p_now
  returning *;
$$;

create or replace function public.manager_append_worker_event(p_worker_id text, p_event jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.manager_workers
  set last_event = p_event,
      events = (
        select coalesce(jsonb_agg(item order by ordinal), '[]'::jsonb)
        from jsonb_array_elements(coalesce(events, '[]'::jsonb) || jsonb_build_array(p_event))
          with ordinality as appended(item, ordinal)
        where ordinal > greatest(0, jsonb_array_length(coalesce(events, '[]'::jsonb)) - 99)
      ),
      updated_at = now()
  where worker_id = p_worker_id;
$$;

create or replace function public.manager_patch_worker_settings(p_worker_id text, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare updated_settings jsonb;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'worker settings patch must be a JSON object';
  end if;

  update public.manager_workers
  set settings = coalesce(settings, '{}'::jsonb) || p_patch,
      updated_at = now()
  where worker_id = p_worker_id and enabled
  returning settings into updated_settings;

  if not found then
    raise exception 'worker not found or disabled';
  end if;

  return updated_settings;
end;
$$;

-- All access is server-side through the manager. Browser/client roles receive no table access.
alter table public.manager_counters enable row level security;
alter table public.manager_workers enable row level security;
alter table public.manager_access enable row level security;
alter table public.manager_worker_assignments enable row level security;
alter table public.manager_keys enable row level security;
alter table public.manager_audit enable row level security;
alter table public.manager_settings enable row level security;
alter table public.manager_link4m_attempts enable row level security;
alter table public.manager_schema_migrations enable row level security;

revoke all on public.manager_counters, public.manager_workers, public.manager_access,
  public.manager_worker_assignments, public.manager_keys, public.manager_audit,
  public.manager_settings, public.manager_link4m_attempts from public, anon, authenticated;
revoke all on public.manager_schema_migrations from public, anon, authenticated;
grant all on public.manager_counters, public.manager_workers, public.manager_access,
  public.manager_worker_assignments, public.manager_keys, public.manager_audit,
  public.manager_settings, public.manager_link4m_attempts to service_role;
grant select on public.manager_schema_migrations to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke all on function public.manager_next_bot_number() from public, anon, authenticated;
revoke all on function public.manager_set_user_access(text, jsonb, text[], text) from public, anon, authenticated;
revoke all on function public.manager_consume_key(text, text) from public, anon, authenticated;
revoke all on function public.manager_release_consumed_key(text, text) from public, anon, authenticated;
revoke all on function public.manager_claim_link4m_attempt(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.manager_append_worker_event(text, jsonb) from public, anon, authenticated;
revoke all on function public.manager_patch_worker_settings(text, jsonb) from public, anon, authenticated;
grant execute on function public.manager_next_bot_number() to service_role;
grant execute on function public.manager_set_user_access(text, jsonb, text[], text) to service_role;
grant execute on function public.manager_consume_key(text, text) to service_role;
grant execute on function public.manager_release_consumed_key(text, text) to service_role;
grant execute on function public.manager_claim_link4m_attempt(text, text, timestamptz) to service_role;
grant execute on function public.manager_append_worker_event(text, jsonb) to service_role;
grant execute on function public.manager_patch_worker_settings(text, jsonb) to service_role;

insert into public.manager_schema_migrations(version) values ('20261107_manager_schema')
on conflict (version) do nothing;


-- ===== END 20261107_manager_schema.sql =====


-- ===== BEGIN 20261108000000_durable_worker_commands.sql =====

-- Durable Wispbyte command queue. Apply after 20261107_manager_schema.sql.

create table if not exists public.manager_commands (
  command_id text primary key,
  worker_id text not null references public.manager_workers(worker_id) on delete cascade,
  action text not null check (action in (
    'start', 'stop', 'restart', 'resume', 'status', 'chat', 'reset', 'set-afk-mode', 'set-proxy',
    'reconnect', 'respawn', 'inventory', 'look', 'toss', 'window_click', 'window_close',
    'container-open', 'container-click', 'container-close'
  )),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status text not null default 'queued' check (status in ('queued', 'delivered', 'completed', 'failed', 'expired')),
  result jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  delivered_at timestamptz,
  completed_at timestamptz
);

create index if not exists manager_commands_queue_idx on public.manager_commands (worker_id, created_at)
  where status = 'queued';
create index if not exists manager_commands_expiry_idx on public.manager_commands (expires_at)
  where status in ('queued', 'delivered');
create index if not exists manager_commands_history_idx on public.manager_commands (created_at desc)
  where status in ('completed', 'failed', 'expired');

drop function if exists public.manager_enqueue_worker_command(uuid, text, text, jsonb, timestamptz, timestamptz);
drop function if exists public.manager_enqueue_worker_command(text, text, text, jsonb, timestamptz, timestamptz);
create or replace function public.manager_enqueue_worker_command(
  p_command_id text,
  p_worker_id text,
  p_action text,
  p_payload jsonb,
  p_created_at timestamptz,
  p_expires_at timestamptz,
  p_allow_coalesce boolean default false
)
returns setof public.manager_commands
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.manager_commands;
  result public.manager_commands;
  queued_count integer;
begin
  perform 1 from public.manager_workers where worker_id = p_worker_id and enabled for update;
  if not found then return; end if;

  update public.manager_commands set status = 'expired'
  where worker_id = p_worker_id and status = 'queued' and expires_at <= now();

  if p_allow_coalesce then
    perform pg_advisory_xact_lock(hashtext(p_worker_id || ':' || p_action));

    select * into v_existing
    from public.manager_commands
    where worker_id = p_worker_id
      and action = p_action
      and status = 'queued'
      and expires_at > now()
    order by created_at desc
    limit 1
    for update;

    if found then
      update public.manager_commands
      set payload = coalesce(p_payload, '{}'::jsonb),
          expires_at = p_expires_at,
          created_at = p_created_at
      where command_id = v_existing.command_id
      returning * into result;

      return next result;
      return;
    end if;
  end if;

  select count(*) into queued_count from public.manager_commands
  where worker_id = p_worker_id and status = 'queued' and expires_at > now();
  if queued_count >= 5 then return; end if;

  insert into public.manager_commands(command_id, worker_id, action, payload, status, created_at, expires_at)
  values (p_command_id, p_worker_id, p_action, coalesce(p_payload, '{}'::jsonb), 'queued', p_created_at, p_expires_at)
  returning * into result;
  return next result;
end;
$$;

create or replace function public.manager_take_worker_command(p_worker_id text)
returns public.manager_commands
language sql
security definer
set search_path = ''
as $$
  with candidate as (
    select command_id from public.manager_commands
    where worker_id = p_worker_id and status = 'queued' and expires_at > now()
    order by created_at asc for update skip locked limit 1
  )
  update public.manager_commands as command
  set status = 'delivered', delivered_at = now()
  from candidate
  where command.command_id = candidate.command_id
  returning command.*;
$$;

drop function if exists public.manager_complete_worker_command(text, uuid, jsonb);
create or replace function public.manager_complete_worker_command(
  p_worker_id text, p_command_id text, p_result jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
  completed_action text;
begin
  update public.manager_commands
  set status = case when p_result->>'ok' = 'false' then 'failed' else 'completed' end,
      result = p_result, completed_at = now()
  where worker_id = p_worker_id and command_id = p_command_id and status in ('delivered', 'queued');
  get diagnostics changed = row_count;
  if changed > 0 then
    select action into completed_action from public.manager_commands where command_id = p_command_id;
    if completed_action = 'reset' and p_result->>'ok' = 'true' then
      update public.manager_workers
      set settings = coalesce(settings, '{}'::jsonb) - 'mcCredentialsCiphertext',
          events = '[]'::jsonb,
          last_event = null,
          status = jsonb_build_object('state', 'stopped', 'online', false, 'reconnectAttempts', 0, 'reconnectCount', 0),
          updated_at = now()
      where worker_id = p_worker_id;
    end if;
  end if;
  return changed > 0;
end;
$$;

drop function if exists public.manager_expire_worker_command(uuid);
drop function if exists public.manager_expire_worker_command(text);
create or replace function public.manager_expire_worker_command(p_command_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare changed integer;
begin
  update public.manager_commands set status = 'expired'
  where command_id = p_command_id and status in ('queued', 'delivered');
  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;

alter table public.manager_commands enable row level security;
revoke all on public.manager_commands from public, anon, authenticated;
grant all on public.manager_commands to service_role;

revoke all on function public.manager_enqueue_worker_command(text, text, text, jsonb, timestamptz, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.manager_take_worker_command(text) from public, anon, authenticated;
revoke all on function public.manager_complete_worker_command(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.manager_expire_worker_command(text) from public, anon, authenticated;
grant execute on function public.manager_enqueue_worker_command(text, text, text, jsonb, timestamptz, timestamptz, boolean) to service_role;
grant execute on function public.manager_take_worker_command(text) to service_role;
grant execute on function public.manager_complete_worker_command(text, text, jsonb) to service_role;
grant execute on function public.manager_expire_worker_command(text) to service_role;

insert into public.manager_schema_migrations(version) values ('20261108000000_durable_worker_commands')
on conflict (version) do nothing;


-- ===== END 20261108000000_durable_worker_commands.sql =====


-- ===== BEGIN 20261109000000_atomic_entitlement_rewards.sql =====

-- Make code redemption and Link4M access grants atomic across manager tables.
-- Apply after the manager schema and durable worker-command migrations.

create or replace function public.manager_redeem_code_with_access(
  p_code_hash text, p_user_id text, p_access_values jsonb, p_worker_ids text[], p_actor_id text
)
returns public.manager_keys
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.manager_keys;
begin
  update public.manager_keys
  set used_count = used_count + 1,
      used_users = array_append(used_users, p_user_id),
      last_used_at = now(), last_used_by = p_user_id,
      status = case when used_count + 1 >= max_uses then 'used' else 'unused' end
  where code_hash = p_code_hash and status = 'unused' and not (p_user_id = any(used_users))
    and used_count < max_uses and (expires_at is null or expires_at > now())
  returning * into result;
  if not found then return null; end if;

  perform public.manager_set_user_access(p_user_id, p_access_values, p_worker_ids, p_actor_id);
  return result;
end;
$$;

create or replace function public.manager_complete_link4m_reward(
  p_attempt_id text, p_user_id text, p_access_values jsonb, p_worker_ids text[], p_actor_id text
)
returns public.manager_link4m_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_row public.manager_link4m_attempts;
begin
  select * into attempt_row from public.manager_link4m_attempts
  where attempt_id = p_attempt_id and user_id = p_user_id and status = 'processing'
  for update;
  if not found then return null; end if;

  perform public.manager_set_user_access(p_user_id, p_access_values, p_worker_ids, p_actor_id);
  update public.manager_link4m_attempts
  set status = 'rewarded', rewarded_at = now(), processing_at = null
  where attempt_id = p_attempt_id and user_id = p_user_id and status = 'processing'
  returning * into attempt_row;
  if not found then raise exception 'Link4M attempt state changed during reward'; end if;
  return attempt_row;
end;
$$;

revoke all on function public.manager_redeem_code_with_access(text, text, jsonb, text[], text) from public, anon, authenticated;
revoke all on function public.manager_complete_link4m_reward(text, text, jsonb, text[], text) from public, anon, authenticated;
grant execute on function public.manager_redeem_code_with_access(text, text, jsonb, text[], text) to service_role;
grant execute on function public.manager_complete_link4m_reward(text, text, jsonb, text[], text) to service_role;

insert into public.manager_schema_migrations(version) values ('20261109000000_atomic_entitlement_rewards')
on conflict (version) do nothing;


-- ===== END 20261109000000_atomic_entitlement_rewards.sql =====

-- Atomic worker settings migration.
insert into public.manager_schema_migrations(version) values ('20261110000000_atomic_worker_settings')
on conflict (version) do nothing;

alter table public.manager_workers drop column if exists schedule;

-- A reset is only recorded after a worker acknowledges the reset command. This RPC
-- is also used by the Render request/response transport.
create or replace function public.manager_reset_worker_data(p_worker_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare changed integer;
begin
  update public.manager_workers
  set settings = coalesce(settings, '{}'::jsonb) - 'mcCredentialsCiphertext',
      events = '[]'::jsonb,
      last_event = null,
      status = jsonb_build_object('state', 'stopped', 'online', false, 'reconnectAttempts', 0, 'reconnectCount', 0),
      updated_at = now()
  where worker_id = p_worker_id and enabled;
  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;

revoke all on function public.manager_reset_worker_data(text) from public, anon, authenticated;
grant execute on function public.manager_reset_worker_data(text) to service_role;

alter table public.manager_commands drop constraint if exists manager_commands_action_check;
update public.manager_commands
set status = 'expired', completed_at = now()
where status in ('queued', 'delivered')
  and action in ('inventory', 'container-open', 'container-click', 'container-close');

alter table public.manager_commands add constraint manager_commands_action_check
  check (action in (
    'start', 'stop', 'restart', 'resume', 'status', 'chat', 'reset', 'set-afk-mode', 'set-proxy',
    'reconnect', 'respawn', 'inventory', 'look', 'toss', 'window_click', 'window_close'
  ))
  not valid;

insert into public.manager_schema_migrations(version) values ('20261111000000_worker_reset_data')
on conflict (version) do nothing;

-- ===== BEGIN 20261111120000_command_two_phase_sync.sql =====
-- Ensure manager_commands.command_id supports cmd_<UUID> (text) safely in-place even on existing uuid DBs.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'manager_commands'
      and column_name = 'command_id'
      and data_type <> 'text'
  ) then
    alter table public.manager_commands
      alter column command_id type text
      using command_id::text;
  end if;
end
$$;

alter table public.manager_commands drop constraint if exists manager_commands_action_check;
alter table public.manager_commands add constraint manager_commands_action_check
  check (action in (
    'start', 'stop', 'restart', 'resume', 'status', 'chat', 'reset', 'set-afk-mode', 'set-proxy',
    'reconnect', 'respawn', 'inventory', 'look', 'toss', 'window_click', 'window_close'
  ))
  not valid;

alter table public.manager_commands drop constraint if exists manager_commands_status_check;
alter table public.manager_commands add constraint manager_commands_status_check
  check (status in (
    'queued',
    'delivered',
    'execution_completed',
    'state_sync_pending',
    'state_sync_failed',
    'completed',
    'failed',
    'expired'
  ));

create index if not exists idx_manager_commands_state_sync
  on public.manager_commands (created_at asc)
  where status in ('execution_completed', 'state_sync_pending');

-- Upgrade queue lifecycle RPCs from legacy uuid signatures to text (cmd_<UUID>) without overload ambiguity.
drop function if exists public.manager_enqueue_worker_command(uuid, text, text, jsonb, timestamptz, timestamptz);
drop function if exists public.manager_enqueue_worker_command(text, text, text, jsonb, timestamptz, timestamptz);
drop function if exists public.manager_enqueue_worker_command(text, text, text, jsonb, timestamptz, timestamptz, boolean);
create or replace function public.manager_enqueue_worker_command(
  p_command_id text,
  p_worker_id text,
  p_action text,
  p_payload jsonb,
  p_created_at timestamptz,
  p_expires_at timestamptz,
  p_allow_coalesce boolean default false
)
returns setof public.manager_commands
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.manager_commands;
  result public.manager_commands;
  queued_count integer;
begin
  perform 1 from public.manager_workers where worker_id = p_worker_id and enabled for update;
  if not found then return; end if;

  update public.manager_commands set status = 'expired'
  where worker_id = p_worker_id and status = 'queued' and expires_at <= now();

  if p_allow_coalesce then
    perform pg_advisory_xact_lock(hashtext(p_worker_id || ':' || p_action));

    select * into v_existing
    from public.manager_commands
    where worker_id = p_worker_id
      and action = p_action
      and status = 'queued'
      and expires_at > now()
    order by created_at desc
    limit 1
    for update;

    if found then
      update public.manager_commands
      set payload = coalesce(p_payload, '{}'::jsonb),
          expires_at = p_expires_at,
          created_at = p_created_at
      where command_id = v_existing.command_id
      returning * into result;

      return next result;
      return;
    end if;
  end if;

  select count(*) into queued_count from public.manager_commands
  where worker_id = p_worker_id and status = 'queued' and expires_at > now();
  if queued_count >= 5 then return; end if;

  insert into public.manager_commands(command_id, worker_id, action, payload, status, created_at, expires_at)
  values (p_command_id, p_worker_id, p_action, coalesce(p_payload, '{}'::jsonb), 'queued', p_created_at, p_expires_at)
  returning * into result;
  return next result;
end;
$$;

drop function if exists public.manager_complete_worker_command(text, uuid, jsonb);
drop function if exists public.manager_complete_worker_command(text, text, jsonb);
create or replace function public.manager_complete_worker_command(
  p_worker_id text, p_command_id text, p_result jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
  completed_action text;
begin
  update public.manager_commands
  set status = case when p_result->>'ok' = 'false' then 'failed' else 'completed' end,
      result = p_result, completed_at = now()
  where worker_id = p_worker_id and command_id = p_command_id and status in ('delivered', 'queued')
  returning action into completed_action;
  get diagnostics changed = row_count;

  if changed > 0 and completed_action = 'reset' and p_result->>'ok' = 'true' then
    update public.manager_workers
    set settings = coalesce(settings, '{}'::jsonb) - 'mcCredentialsCiphertext',
        events = '[]'::jsonb,
        last_event = null,
        status = jsonb_build_object('state', 'stopped', 'online', false, 'reconnectAttempts', 0, 'reconnectCount', 0),
        updated_at = now()
    where worker_id = p_worker_id;
  end if;
  return changed > 0;
end;
$$;

drop function if exists public.manager_expire_worker_command(uuid);
drop function if exists public.manager_expire_worker_command(text);
create or replace function public.manager_expire_worker_command(p_command_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare changed integer;
begin
  update public.manager_commands set status = 'expired'
  where command_id = p_command_id and status in ('queued', 'delivered');
  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;

drop function if exists public.manager_record_command_execution(text, uuid, jsonb, text, integer);
drop function if exists public.manager_record_command_execution(text, text, jsonb, text, integer);
create or replace function public.manager_record_command_execution(
  p_worker_id text,
  p_command_id text,
  p_result jsonb default null,
  p_lease_owner text default null,
  p_lease_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_safe_secs integer := greatest(1, least(3600, coalesce(p_lease_seconds, 60)));
  v_new_lease text := to_char((v_now + make_interval(secs => v_safe_secs)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_now_iso text := to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_row public.manager_commands;
  v_existing_sync jsonb;
  v_incoming_sync jsonb;
  v_merged_sync jsonb;
  v_lease_until timestamptz;
  v_existing_token bigint := 0;
  v_next_token bigint := 0;
  v_updated_row public.manager_commands;
begin
  select * into v_row
  from public.manager_commands
  where command_id = p_command_id
    and worker_id = p_worker_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_row.status = 'completed' then
    return jsonb_build_object('ok', true, 'alreadyCompleted', true, 'status', 'completed', 'command', row_to_json(v_row)::jsonb);
  end if;

  if v_row.status = 'state_sync_failed' then
    return jsonb_build_object('ok', false, 'reason', 'state_sync_failed', 'status', 'state_sync_failed');
  end if;

  if v_row.status not in ('delivered', 'queued', 'execution_completed', 'state_sync_pending') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status', 'status', v_row.status);
  end if;

  v_existing_sync := coalesce(v_row.result->'_stateSync', '{}'::jsonb);
  begin
    v_lease_until := nullif(v_existing_sync->>'leaseUntil', '')::timestamptz;
  exception when others then
    v_lease_until := null;
  end;
  begin
    v_existing_token := coalesce(nullif(v_existing_sync->>'fencingToken', '')::bigint, 0);
  exception when others then
    v_existing_token := 0;
  end;

  if v_row.status in ('execution_completed', 'state_sync_pending')
     and nullif(v_existing_sync->>'leaseOwner', '') is not null
     and v_lease_until is not null
     and v_lease_until > v_now
     and (p_lease_owner is null or (v_existing_sync->>'leaseOwner') <> p_lease_owner) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'state_sync_in_progress',
      'status', v_row.status,
      'fencingToken', v_existing_token
    );
  end if;

  v_next_token := case
    when nullif(p_lease_owner, '') is not null then greatest(v_existing_token, 0) + 1
    else greatest(v_existing_token, 0)
  end;

  v_incoming_sync := coalesce(p_result->'_stateSync', '{}'::jsonb);
  v_merged_sync := v_existing_sync || v_incoming_sync || jsonb_build_object(
    'pending', true,
    'executionCompleted', true,
    'attempts', coalesce((v_existing_sync->>'attempts')::integer, (v_incoming_sync->>'attempts')::integer, 0),
    'leaseOwner', p_lease_owner,
    'leaseUntil', case when nullif(p_lease_owner, '') is not null then v_new_lease else null end,
    'fencingToken', v_next_token,
    'updatedAt', v_now_iso
  );

  update public.manager_commands
  set status = 'execution_completed',
      result = jsonb_set(coalesce(p_result, v_row.result, '{}'::jsonb), '{_stateSync}', v_merged_sync, true),
      completed_at = null
  where command_id = p_command_id
    and worker_id = p_worker_id
  returning * into v_updated_row;

  return jsonb_build_object(
    'ok', true,
    'alreadyCompleted', false,
    'status', 'execution_completed',
    'fencingToken', v_next_token,
    'leaseUntil', case when nullif(p_lease_owner, '') is not null then v_new_lease else null end,
    'command', row_to_json(v_updated_row)::jsonb
  );
end;
$$;

drop function if exists public.manager_renew_command_sync_lease(text, uuid, text, integer, bigint);
drop function if exists public.manager_renew_command_sync_lease(text, text, text, integer, bigint);
create or replace function public.manager_renew_command_sync_lease(
  p_worker_id text,
  p_command_id text,
  p_lease_owner text,
  p_lease_seconds integer default 60,
  p_fencing_token bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_safe_secs integer := greatest(1, least(3600, coalesce(p_lease_seconds, 60)));
  v_new_lease text := to_char((v_now + make_interval(secs => v_safe_secs)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_now_iso text := to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_row public.manager_commands;
  v_sync jsonb;
  v_owner text;
  v_lease_until timestamptz;
  v_token bigint := 0;
begin
  if coalesce(btrim(p_lease_owner), '') = '' then
    return jsonb_build_object('ok', false, 'lost', true, 'reason', 'invalid_lease_owner');
  end if;

  select * into v_row
  from public.manager_commands
  where command_id = p_command_id
    and worker_id = p_worker_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'lost', true, 'reason', 'not_found');
  end if;

  if v_row.status not in ('execution_completed', 'state_sync_pending') then
    return jsonb_build_object('ok', false, 'lost', true, 'reason', 'invalid_status', 'status', v_row.status);
  end if;

  v_sync := coalesce(v_row.result->'_stateSync', '{}'::jsonb);
  v_owner := nullif(v_sync->>'leaseOwner', '');
  begin
    v_lease_until := nullif(v_sync->>'leaseUntil', '')::timestamptz;
  exception when others then
    v_lease_until := null;
  end;
  begin
    v_token := coalesce(nullif(v_sync->>'fencingToken', '')::bigint, 0);
  exception when others then
    v_token := 0;
  end;

  if v_owner is distinct from p_lease_owner then
    return jsonb_build_object('ok', false, 'lost', true, 'reason', 'lease_owner_mismatch', 'currentOwner', v_owner, 'currentFencingToken', v_token);
  end if;

  if p_fencing_token is not null and v_token <> p_fencing_token then
    return jsonb_build_object('ok', false, 'lost', true, 'reason', 'fencing_token_mismatch', 'currentOwner', v_owner, 'currentFencingToken', v_token);
  end if;

  if v_lease_until is null or v_lease_until <= v_now then
    return jsonb_build_object('ok', false, 'lost', true, 'reason', 'lease_expired', 'currentOwner', v_owner, 'currentFencingToken', v_token);
  end if;

  update public.manager_commands
  set result = jsonb_set(
        coalesce(v_row.result, '{}'::jsonb),
        '{_stateSync}',
        v_sync || jsonb_build_object(
          'leaseUntil', v_new_lease,
          'updatedAt', v_now_iso
        ),
        true
      )
  where command_id = p_command_id
    and worker_id = p_worker_id;

  return jsonb_build_object(
    'ok', true,
    'lost', false,
    'leaseOwner', v_owner,
    'leaseUntil', v_new_lease,
    'fencingToken', v_token
  );
end;
$$;

drop function if exists public.manager_verify_command_sync_lease(text, uuid, text, bigint);
drop function if exists public.manager_verify_command_sync_lease(text, text, text, bigint);
create or replace function public.manager_verify_command_sync_lease(
  p_worker_id text,
  p_command_id text,
  p_lease_owner text,
  p_fencing_token bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_row public.manager_commands;
  v_sync jsonb;
  v_owner text;
  v_lease_until timestamptz;
  v_token bigint := 0;
begin
  if coalesce(btrim(p_lease_owner), '') = '' then
    return jsonb_build_object('ok', false, 'held', false, 'reason', 'invalid_lease_owner');
  end if;

  select * into v_row
  from public.manager_commands
  where command_id = p_command_id
    and worker_id = p_worker_id;

  if not found then
    return jsonb_build_object('ok', false, 'held', false, 'reason', 'not_found');
  end if;

  if v_row.status not in ('execution_completed', 'state_sync_pending') then
    return jsonb_build_object('ok', false, 'held', false, 'reason', 'invalid_status', 'status', v_row.status);
  end if;

  v_sync := coalesce(v_row.result->'_stateSync', '{}'::jsonb);
  v_owner := nullif(v_sync->>'leaseOwner', '');
  begin
    v_lease_until := nullif(v_sync->>'leaseUntil', '')::timestamptz;
  exception when others then
    v_lease_until := null;
  end;
  begin
    v_token := coalesce(nullif(v_sync->>'fencingToken', '')::bigint, 0);
  exception when others then
    v_token := 0;
  end;

  if v_owner is distinct from p_lease_owner then
    return jsonb_build_object('ok', false, 'held', false, 'reason', 'lease_owner_mismatch', 'currentOwner', v_owner, 'currentFencingToken', v_token);
  end if;

  if p_fencing_token is not null and v_token <> p_fencing_token then
    return jsonb_build_object('ok', false, 'held', false, 'reason', 'fencing_token_mismatch', 'currentOwner', v_owner, 'currentFencingToken', v_token);
  end if;

  if v_lease_until is null or v_lease_until <= v_now then
    return jsonb_build_object('ok', false, 'held', false, 'reason', 'lease_expired', 'currentOwner', v_owner, 'currentFencingToken', v_token);
  end if;

  return jsonb_build_object(
    'ok', true,
    'held', true,
    'leaseOwner', v_owner,
    'leaseUntil', v_sync->>'leaseUntil',
    'fencingToken', v_token
  );
end;
$$;

drop function if exists public.manager_mark_command_sync_pending(text, uuid, jsonb, boolean);
drop function if exists public.manager_mark_command_sync_pending(text, uuid, jsonb, boolean, text, bigint);
drop function if exists public.manager_mark_command_sync_pending(text, text, jsonb, boolean);
drop function if exists public.manager_mark_command_sync_pending(text, text, jsonb, boolean, text, bigint);
create or replace function public.manager_mark_command_sync_pending(
  p_worker_id text,
  p_command_id text,
  p_sync_state jsonb default '{}'::jsonb,
  p_terminal_failed boolean default false,
  p_lease_owner text default null,
  p_fencing_token bigint default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.manager_commands;
  v_sync jsonb;
  v_owner text;
  v_token bigint := 0;
  v_incoming_token bigint := 0;
  v_next_sync jsonb;
begin
  select * into v_row
  from public.manager_commands
  where command_id = p_command_id
    and worker_id = p_worker_id
  for update;

  if not found then
    return false;
  end if;

  if v_row.status not in ('queued', 'delivered', 'execution_completed', 'state_sync_pending') then
    return false;
  end if;

  v_sync := coalesce(v_row.result->'_stateSync', '{}'::jsonb);
  v_owner := nullif(v_sync->>'leaseOwner', '');
  begin
    v_token := coalesce(nullif(v_sync->>'fencingToken', '')::bigint, 0);
  exception when others then
    v_token := 0;
  end;
  begin
    v_incoming_token := coalesce(nullif(p_sync_state->>'fencingToken', '')::bigint, 0);
  exception when others then
    v_incoming_token := 0;
  end;

  if p_lease_owner is not null and v_owner is not null and v_owner <> p_lease_owner then
    return false;
  end if;

  if p_fencing_token is not null and v_token > 0 and v_token <> p_fencing_token then
    return false;
  end if;

  v_next_sync := coalesce(p_sync_state, '{}'::jsonb) || jsonb_build_object(
    'fencingToken', greatest(v_token, v_incoming_token, coalesce(p_fencing_token, 0))
  );

  update public.manager_commands
  set status = case when p_terminal_failed then 'state_sync_failed' else 'state_sync_pending' end,
      result = jsonb_set(coalesce(v_row.result, '{}'::jsonb), '{_stateSync}', v_next_sync, true),
      completed_at = null
  where command_id = p_command_id
    and worker_id = p_worker_id;
  return found;
end;
$$;

drop function if exists public.manager_finalize_command_sync(text, uuid, jsonb, text);
drop function if exists public.manager_finalize_command_sync(text, uuid, jsonb, text, bigint);
drop function if exists public.manager_finalize_command_sync(text, text, jsonb, text);
drop function if exists public.manager_finalize_command_sync(text, text, jsonb, text, bigint);
create or replace function public.manager_finalize_command_sync(
  p_worker_id text,
  p_command_id text,
  p_result jsonb default null,
  p_lease_owner text default null,
  p_fencing_token bigint default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_row public.manager_commands;
  v_owner text;
  v_token bigint := 0;
begin
  select * into v_row
  from public.manager_commands
  where command_id = p_command_id
    and worker_id = p_worker_id
  for update;

  if not found then
    return false;
  end if;

  if v_row.status = 'completed' then
    return true;
  end if;

  if v_row.status not in ('queued', 'delivered', 'execution_completed', 'state_sync_pending') then
    return false;
  end if;

  v_owner := nullif(v_row.result->'_stateSync'->>'leaseOwner', '');
  begin
    v_token := coalesce(nullif(v_row.result->'_stateSync'->>'fencingToken', '')::bigint, 0);
  exception when others then
    v_token := 0;
  end;

  if p_lease_owner is not null and v_owner is not null and v_owner <> p_lease_owner then
    return false;
  end if;

  if p_fencing_token is not null and v_token > 0 and v_token <> p_fencing_token then
    return false;
  end if;

  update public.manager_commands
  set status = 'completed',
      result = (coalesce(p_result, v_row.result, '{}'::jsonb) - '_stateSync'),
      completed_at = v_now
  where command_id = p_command_id
    and worker_id = p_worker_id;
  return found;
end;
$$;

drop function if exists public.manager_claim_pending_command_syncs(text, integer, integer);
create or replace function public.manager_claim_pending_command_syncs(
  p_lease_owner text,
  p_limit integer default 10,
  p_lease_seconds integer default 60
)
returns setof public.manager_commands
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_safe_secs integer := greatest(1, least(3600, coalesce(p_lease_seconds, 60)));
  v_lease_until text := to_char((v_now + make_interval(secs => v_safe_secs)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_now_iso text := to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if coalesce(btrim(p_lease_owner), '') = '' then
    return;
  end if;

  return query
  with candidate as (
    select c.command_id
    from public.manager_commands c
    where c.status in ('state_sync_pending', 'execution_completed')
      and (
        nullif(c.result->'_stateSync'->>'nextRetryAt', '') is null
        or (c.result->'_stateSync'->>'nextRetryAt')::timestamptz <= v_now
      )
      and (
        nullif(c.result->'_stateSync'->>'leaseUntil', '') is null
        or (c.result->'_stateSync'->>'leaseUntil')::timestamptz <= v_now
      )
    order by c.created_at asc
    limit greatest(1, least(100, coalesce(p_limit, 10)))
    for update of c skip locked
  )
  update public.manager_commands cmd
  set status = 'state_sync_pending',
      result = jsonb_set(
        coalesce(cmd.result, '{}'::jsonb),
        '{_stateSync}',
        coalesce(cmd.result->'_stateSync', '{}'::jsonb) || jsonb_build_object(
          'pending', true,
          'leaseOwner', p_lease_owner,
          'leaseUntil', v_lease_until,
          'fencingToken', coalesce(nullif(cmd.result->'_stateSync'->>'fencingToken', '')::bigint, 0) + 1,
          'updatedAt', v_now_iso
        ),
        true
      )
  from candidate cand
  where cmd.command_id = cand.command_id
  returning cmd.*;
end;
$$;

revoke all on function public.manager_enqueue_worker_command(text, text, text, jsonb, timestamptz, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.manager_complete_worker_command(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.manager_expire_worker_command(text) from public, anon, authenticated;
revoke all on function public.manager_record_command_execution(text, text, jsonb, text, integer) from public, anon, authenticated;
revoke all on function public.manager_renew_command_sync_lease(text, text, text, integer, bigint) from public, anon, authenticated;
revoke all on function public.manager_verify_command_sync_lease(text, text, text, bigint) from public, anon, authenticated;
revoke all on function public.manager_mark_command_sync_pending(text, text, jsonb, boolean, text, bigint) from public, anon, authenticated;
revoke all on function public.manager_finalize_command_sync(text, text, jsonb, text, bigint) from public, anon, authenticated;
revoke all on function public.manager_claim_pending_command_syncs(text, integer, integer) from public, anon, authenticated;

grant execute on function public.manager_enqueue_worker_command(text, text, text, jsonb, timestamptz, timestamptz, boolean) to service_role;
grant execute on function public.manager_complete_worker_command(text, text, jsonb) to service_role;
grant execute on function public.manager_expire_worker_command(text) to service_role;
grant execute on function public.manager_record_command_execution(text, text, jsonb, text, integer) to service_role;
grant execute on function public.manager_renew_command_sync_lease(text, text, text, integer, bigint) to service_role;
grant execute on function public.manager_verify_command_sync_lease(text, text, text, bigint) to service_role;
grant execute on function public.manager_mark_command_sync_pending(text, text, jsonb, boolean, text, bigint) to service_role;
grant execute on function public.manager_finalize_command_sync(text, text, jsonb, text, bigint) to service_role;
grant execute on function public.manager_claim_pending_command_syncs(text, integer, integer) to service_role;

insert into public.manager_schema_migrations(version)
values ('20261111120000_command_two_phase_sync')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
-- ===== END 20261111120000_command_two_phase_sync.sql =====


