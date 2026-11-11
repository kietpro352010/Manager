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
  schedule jsonb not null default '{}'::jsonb,
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
grant execute on function public.manager_next_bot_number() to service_role;
grant execute on function public.manager_set_user_access(text, jsonb, text[], text) to service_role;
grant execute on function public.manager_consume_key(text, text) to service_role;
grant execute on function public.manager_release_consumed_key(text, text) to service_role;
grant execute on function public.manager_claim_link4m_attempt(text, text, timestamptz) to service_role;
grant execute on function public.manager_append_worker_event(text, jsonb) to service_role;

insert into public.manager_schema_migrations(version) values ('20261107_manager_schema')
on conflict (version) do nothing;
