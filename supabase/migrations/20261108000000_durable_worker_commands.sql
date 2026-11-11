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
declare changed integer;
begin
  update public.manager_commands
  set status = case when p_result->>'ok' = 'false' then 'failed' else 'completed' end,
      result = p_result, completed_at = now()
  where worker_id = p_worker_id and command_id = p_command_id and status in ('delivered', 'queued');
  get diagnostics changed = row_count;
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
