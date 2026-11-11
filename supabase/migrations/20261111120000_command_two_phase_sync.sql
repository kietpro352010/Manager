-- Harden two-phase durable RESET command execution & state synchronization
-- with monotonic fencing tokens, lease renewal, lease verification, and
-- expanded status check constraint.

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

drop function if exists public.manager_record_command_execution(text, uuid, jsonb, text, integer);
create or replace function public.manager_record_command_execution(
  p_worker_id text,
  p_command_id uuid,
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
create or replace function public.manager_renew_command_sync_lease(
  p_worker_id text,
  p_command_id uuid,
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
create or replace function public.manager_verify_command_sync_lease(
  p_worker_id text,
  p_command_id uuid,
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
create or replace function public.manager_mark_command_sync_pending(
  p_worker_id text,
  p_command_id uuid,
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
create or replace function public.manager_finalize_command_sync(
  p_worker_id text,
  p_command_id uuid,
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

revoke all on function public.manager_record_command_execution(text, uuid, jsonb, text, integer) from public, anon, authenticated;
revoke all on function public.manager_renew_command_sync_lease(text, uuid, text, integer, bigint) from public, anon, authenticated;
revoke all on function public.manager_verify_command_sync_lease(text, uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.manager_mark_command_sync_pending(text, uuid, jsonb, boolean, text, bigint) from public, anon, authenticated;
revoke all on function public.manager_finalize_command_sync(text, uuid, jsonb, text, bigint) from public, anon, authenticated;
revoke all on function public.manager_claim_pending_command_syncs(text, integer, integer) from public, anon, authenticated;

grant execute on function public.manager_record_command_execution(text, uuid, jsonb, text, integer) to service_role;
grant execute on function public.manager_renew_command_sync_lease(text, uuid, text, integer, bigint) to service_role;
grant execute on function public.manager_verify_command_sync_lease(text, uuid, text, bigint) to service_role;
grant execute on function public.manager_mark_command_sync_pending(text, uuid, jsonb, boolean, text, bigint) to service_role;
grant execute on function public.manager_finalize_command_sync(text, uuid, jsonb, text, bigint) to service_role;
grant execute on function public.manager_claim_pending_command_syncs(text, integer, integer) to service_role;

insert into public.manager_schema_migrations(version)
values ('20261111120000_command_two_phase_sync')
on conflict (version) do nothing;
