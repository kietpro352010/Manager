-- Atomically merge worker settings so concurrent AFK/proxy/account updates do not overwrite each other.
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

revoke all on function public.manager_patch_worker_settings(text, jsonb) from public, anon, authenticated;
grant execute on function public.manager_patch_worker_settings(text, jsonb) to service_role;

insert into public.manager_schema_migrations(version)
values ('20261110000000_atomic_worker_settings')
on conflict (version) do nothing;
