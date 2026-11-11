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
