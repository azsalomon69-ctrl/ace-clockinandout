-- Akio <3: Database script maintained by Akio Salomon.
-- Atomically stop and correct employee shifts so concurrent break changes cannot
-- be overwritten by a stale application-side read.
create or replace function public.admin_stop_entry(
  p_entry_id uuid,
  p_actor_user_id uuid
)
returns public.time_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.time_entries;
begin
  update public.time_entries as entry
  set clock_out_at = now(),
      break_started_at = null,
      break_seconds = entry.break_seconds + case
        when entry.break_started_at is null then 0
        else greatest(0, floor(extract(epoch from (now() - entry.break_started_at)))::integer)
      end,
      stopped_by_user_id = p_actor_user_id,
      stopped_by_at = now()
  where entry.id = p_entry_id
    and entry.clock_out_at is null
    and entry.deleted_at is null
    and exists (
      select 1 from public.profiles as profile
      where profile.id = entry.user_id and profile.role = 'USER'
    )
  returning entry.* into v_entry;

  if not found then
    if exists (select 1 from public.time_entries where id = p_entry_id and deleted_at is null and clock_out_at is not null) then
      raise exception 'ENTRY_ALREADY_CLOSED' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.time_entries as entry
      join public.profiles as profile on profile.id = entry.user_id
      where entry.id = p_entry_id and entry.deleted_at is null and profile.role <> 'USER'
    ) then
      raise exception 'NOT_EMPLOYEE_ENTRY' using errcode = 'P0001';
    end if;
    raise exception 'ENTRY_NOT_FOUND' using errcode = 'P0001';
  end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description)
  values (p_actor_user_id, 'ADMIN_STOP_CLOCK', 'TIME_ENTRY', p_entry_id, 'Stopped an employee shift');

  return v_entry;
end;
$$;

create or replace function public.admin_correct_entry(
  p_entry_id uuid,
  p_actor_user_id uuid,
  p_clock_in timestamptz,
  p_clock_out timestamptz
)
returns public.time_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.time_entries;
begin
  if p_clock_out < p_clock_in then
    raise exception 'INVALID_TIME_RANGE' using errcode = 'P0001';
  end if;

  update public.time_entries as entry
  set clock_in_at = p_clock_in,
      clock_out_at = p_clock_out,
      break_started_at = null,
      break_seconds = least(
        greatest(0, floor(extract(epoch from (p_clock_out - p_clock_in)))::integer),
        entry.break_seconds + case
          when entry.break_started_at is not null and entry.break_started_at < p_clock_out
            then greatest(0, floor(extract(epoch from (p_clock_out - entry.break_started_at)))::integer)
          else 0
        end
      )
  where entry.id = p_entry_id
    and entry.deleted_at is null
    and exists (
      select 1 from public.profiles as profile
      where profile.id = entry.user_id and profile.role = 'USER'
    )
  returning entry.* into v_entry;

  if not found then
    if exists (
      select 1 from public.time_entries as entry
      join public.profiles as profile on profile.id = entry.user_id
      where entry.id = p_entry_id and entry.deleted_at is null and profile.role <> 'USER'
    ) then
      raise exception 'NOT_EMPLOYEE_ENTRY' using errcode = 'P0001';
    end if;
    raise exception 'ENTRY_NOT_FOUND' using errcode = 'P0001';
  end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description)
  values (p_actor_user_id, 'ADMIN_CORRECT_TIME', 'TIME_ENTRY', p_entry_id, 'Corrected an employee time entry');

  return v_entry;
end;
$$;

revoke all on function public.admin_stop_entry(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_stop_entry(uuid, uuid) to service_role;
revoke all on function public.admin_correct_entry(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_correct_entry(uuid, uuid, timestamptz, timestamptz) to service_role;
