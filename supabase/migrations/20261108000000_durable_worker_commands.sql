-- Durable Wispbyte command queue. Apply after 20261107_manager_schema.sql.

create table if not exists public.manager_commands (
  command_id uuid primary key,
  worker_id text not null references public.manager_workers(worker_id) on delete cascade,
  action text not null check (action in (
    'start', 'stop', 'restart', 'resume', 'status', 'chat', 'inventory',
    'container-open', 'container-click', 'container-close', 'set-afk-mode', 'set-proxy'
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

create or replace function public.manager_enqueue_worker_command(
  p_command_id uuid, p_worker_id text, p_action text, p_payload jsonb, p_created_at timestamptz, p_expires_at timestamptz
)
returns public.manager_commands
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.manager_commands;
  queued_count integer;
begin
  perform 1 from public.manager_workers where worker_id = p_worker_id and enabled for update;
  if not found then return null; end if;

  update public.manager_commands set status = 'expired'
  where worker_id = p_worker_id and status = 'queued' and expires_at <= now();
  select count(*) into queued_count from public.manager_commands
  where worker_id = p_worker_id and status = 'queued' and expires_at > now();
  if queued_count >= 5 then return null; end if;

  insert into public.manager_commands(command_id, worker_id, action, payload, status, created_at, expires_at)
  values (p_command_id, p_worker_id, p_action, coalesce(p_payload, '{}'::jsonb), 'queued', p_created_at, p_expires_at)
  returning * into result;
  return result;
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

create or replace function public.manager_complete_worker_command(
  p_worker_id text, p_command_id uuid, p_result jsonb
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
  where worker_id = p_worker_id and command_id = p_command_id and status = 'delivered';
  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;

create or replace function public.manager_expire_worker_command(p_command_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.manager_commands set status = 'expired'
  where command_id = p_command_id and status in ('queued', 'delivered');
$$;

alter table public.manager_commands enable row level security;
revoke all on public.manager_commands from public, anon, authenticated;
grant all on public.manager_commands to service_role;

revoke all on function public.manager_enqueue_worker_command(uuid, text, text, jsonb, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.manager_take_worker_command(text) from public, anon, authenticated;
revoke all on function public.manager_complete_worker_command(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.manager_expire_worker_command(uuid) from public, anon, authenticated;
grant execute on function public.manager_enqueue_worker_command(uuid, text, text, jsonb, timestamptz, timestamptz) to service_role;
grant execute on function public.manager_take_worker_command(text) to service_role;
grant execute on function public.manager_complete_worker_command(text, uuid, jsonb) to service_role;
grant execute on function public.manager_expire_worker_command(uuid) to service_role;

insert into public.manager_schema_migrations(version) values ('20261108000000_durable_worker_commands')
on conflict (version) do nothing;
