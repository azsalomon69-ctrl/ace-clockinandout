-- Atomically closes an active time entry and records its audit event. The API
-- supplies p_actor_role from its server-verified profile; clients never supply
-- it, and direct calls are limited to the Supabase service role.
create or replace function public.clock_out_entry(
  p_actor_user_id uuid,
  p_entry_id uuid,
  p_actor_role text,
  p_final_note text,
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
  set clock_out_at = p_now,
      final_note = p_final_note,
      break_started_at = null,
      break_seconds = break_seconds + case
        when break_started_at is null then 0
        else greatest(0, floor(extract(epoch from (p_now - break_started_at)))::integer)
      end
  where id = p_entry_id
    and clock_out_at is null
    and (user_id = p_actor_user_id or p_actor_role = 'ADMIN')
  returning * into v_entry;

  if not found then
    if exists (
      select 1
      from public.time_entries
      where id = p_entry_id
        and (user_id = p_actor_user_id or p_actor_role = 'ADMIN')
    ) then
      raise exception 'ENTRY_ALREADY_CLOSED' using errcode = 'P0001';
    end if;
    raise exception 'NOT_FOUND_OR_FORBIDDEN' using errcode = 'P0001';
  end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, ip_address, user_agent)
  values (
    p_actor_user_id,
    format('CLOCK_OUT (%s)', case when p_user_agent ~* 'Android|iPhone|iPad|iPod|Mobile|Windows Phone|IEMobile|Opera Mini' then 'mobile' else 'pc web' end),
    'TIME_ENTRY',
    p_entry_id,
    format('Completed a time entry from %s', case when p_user_agent ~* 'Android|iPhone|iPad|iPod|Mobile|Windows Phone|IEMobile|Opera Mini' then 'mobile' else 'pc web' end),
    p_ip_address,
    p_user_agent
  );

  return v_entry;
end;
$$;

revoke all on function public.clock_out_entry(uuid, uuid, text, text, timestamptz, inet, text) from public, anon, authenticated;
grant execute on function public.clock_out_entry(uuid, uuid, text, text, timestamptz, inet, text) to service_role;
