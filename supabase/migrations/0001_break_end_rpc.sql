-- Akio <3: Database script maintained by Akio Zaki Salomon.
-- Atomically ends an active break and records its audit event. This function
-- is intentionally callable only by the server-side Supabase service role.
create or replace function public.end_break_entry(
  p_actor_user_id uuid,
  p_entry_id uuid,
  p_actor_role text,
  p_now timestamptz default now(),
  p_ip_address inet default null,
  p_user_agent text default null
)
returns public.time_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.time_entries;
begin
  update public.time_entries
  set break_started_at = null,
      break_seconds = break_seconds + greatest(0, floor(extract(epoch from (p_now - break_started_at)))::integer)
  where id = p_entry_id
    and clock_out_at is null
    and break_started_at is not null
    and (user_id = p_actor_user_id or p_actor_role = 'ADMIN')
  returning * into v_entry;

  if not found then
    if exists (
      select 1
      from public.time_entries
      where id = p_entry_id
        and (user_id = p_actor_user_id or p_actor_role = 'ADMIN')
    ) then
      raise exception 'BREAK_NOT_ACTIVE' using errcode = 'P0001';
    end if;
    raise exception 'NOT_FOUND_OR_FORBIDDEN' using errcode = 'P0001';
  end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, ip_address, user_agent)
  values (
    p_actor_user_id,
    'BREAK_END',
    'TIME_ENTRY',
    p_entry_id,
    'Ended a work break',
    p_ip_address,
    p_user_agent
  );

  return v_entry;
end;
$$;

revoke all on function public.end_break_entry(uuid, uuid, text, timestamptz, inet, text) from public, anon, authenticated;
grant execute on function public.end_break_entry(uuid, uuid, text, timestamptz, inet, text) to service_role;
