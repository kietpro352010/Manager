-- Remove old pending GUI/inventory work and persist reset only after the worker ACKs.
alter table public.manager_workers drop column if exists schedule;
update public.manager_commands
set status = 'expired', completed_at = now()
where status in ('queued', 'delivered')
  and action in ('inventory', 'container-open', 'container-click', 'container-close');

alter table public.manager_commands drop constraint if exists manager_commands_action_check;
alter table public.manager_commands add constraint manager_commands_action_check
  check (action in ('start', 'stop', 'restart', 'resume', 'status', 'chat', 'reset', 'set-afk-mode', 'set-proxy'))
  not valid;

create or replace function public.manager_complete_worker_command(
  p_worker_id text, p_command_id uuid, p_result jsonb
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
  where worker_id = p_worker_id and command_id = p_command_id and status = 'delivered'
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

revoke all on function public.manager_complete_worker_command(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.manager_reset_worker_data(text) from public, anon, authenticated;
grant execute on function public.manager_complete_worker_command(text, uuid, jsonb) to service_role;
grant execute on function public.manager_reset_worker_data(text) to service_role;

insert into public.manager_schema_migrations(version)
values ('20261111000000_worker_reset_data')
on conflict (version) do nothing;
