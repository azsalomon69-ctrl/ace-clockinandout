-- Akio <3: Database migration maintained by Akio Zaki Salomon.
-- Retire break tracking. Worked time is the full elapsed interval from
-- clock-in to clock-out.
begin;

drop function if exists public.end_break_entry(uuid, uuid, text, timestamptz, inet, text);
drop function if exists public.compute_schedule_compliance(uuid);

-- duration_seconds previously depended on break_seconds. Remove that generated
-- column first, then recreate it from the full clock-in/clock-out interval.
alter table public.time_entries drop column if exists duration_seconds;
alter table public.time_entries drop column if exists break_started_at;
alter table public.time_entries drop column if exists break_seconds;
alter table public.time_entries drop column if exists break_limit_seconds;
alter table public.work_schedules drop column if exists break_limit_minutes;

alter table public.time_entries add column duration_seconds integer generated always as (
  case when clock_out_at is null then null
  else greatest(0, extract(epoch from (clock_out_at - clock_in_at))::integer) end
) stored;

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
declare v_entry public.time_entries;
begin
  update public.time_entries
  set clock_out_at = p_now,
      final_note = p_final_note
  where id = p_entry_id and clock_out_at is null
    and (user_id = p_actor_user_id or p_actor_role = 'ADMIN')
  returning * into v_entry;

  if not found then
    if exists (select 1 from public.time_entries where id = p_entry_id and (user_id = p_actor_user_id or p_actor_role = 'ADMIN')) then
      raise exception 'ENTRY_ALREADY_CLOSED' using errcode = 'P0001';
    end if;
    raise exception 'NOT_FOUND_OR_FORBIDDEN' using errcode = 'P0001';
  end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, ip_address, user_agent)
  values (p_actor_user_id, format('CLOCK_OUT (%s)', case when p_user_agent ~* 'Android|iPhone|iPad|iPod|Mobile|Windows Phone|IEMobile|Opera Mini' then 'mobile' else 'pc web' end), 'TIME_ENTRY', p_entry_id, format('Completed a time entry from %s', case when p_user_agent ~* 'Android|iPhone|iPad|iPod|Mobile|Windows Phone|IEMobile|Opera Mini' then 'mobile' else 'pc web' end), p_ip_address, p_user_agent);
  return v_entry;
end;
$$;

create or replace function public.admin_stop_entry(p_entry_id uuid, p_actor_user_id uuid)
returns public.time_entries language plpgsql security definer set search_path = public as $$
declare v_entry public.time_entries;
begin
  update public.time_entries as entry set clock_out_at = now(), stopped_by_user_id = p_actor_user_id, stopped_by_at = now()
  where entry.id = p_entry_id and entry.clock_out_at is null and entry.deleted_at is null
    and exists (select 1 from public.profiles profile where profile.id = entry.user_id and profile.role = 'USER')
  returning entry.* into v_entry;
  if not found then raise exception 'ENTRY_NOT_FOUND' using errcode = 'P0001'; end if;
  insert into public.audit_logs (user_id, action, entity_type, entity_id, description) values (p_actor_user_id, 'ADMIN_STOP_CLOCK', 'TIME_ENTRY', p_entry_id, 'Stopped an employee shift');
  return v_entry;
end;
$$;

create or replace function public.admin_correct_entry(p_entry_id uuid, p_actor_user_id uuid, p_clock_in timestamptz, p_clock_out timestamptz)
returns public.time_entries language plpgsql security definer set search_path = public as $$
declare v_entry public.time_entries;
begin
  if p_clock_out < p_clock_in then raise exception 'INVALID_TIME_RANGE' using errcode = 'P0001'; end if;
  update public.time_entries as entry set clock_in_at = p_clock_in, clock_out_at = p_clock_out
  where entry.id = p_entry_id and entry.deleted_at is null
    and exists (select 1 from public.profiles profile where profile.id = entry.user_id and profile.role = 'USER')
  returning entry.* into v_entry;
  if not found then raise exception 'ENTRY_NOT_FOUND' using errcode = 'P0001'; end if;
  insert into public.audit_logs (user_id, action, entity_type, entity_id, description) values (p_actor_user_id, 'ADMIN_CORRECT_TIME', 'TIME_ENTRY', p_entry_id, 'Corrected an employee time entry');
  return v_entry;
end;
$$;

-- Keep the existing compliance API available, but calculate it without any
-- break fields. The final column remains for backward-compatible callers and
-- is always null because break overage no longer exists.
create or replace function public.compute_schedule_compliance(p_entry_id uuid)
returns table (classification text, late_seconds integer, undertime_seconds integer, overtime_seconds integer, break_overage_seconds integer)
language sql stable set search_path = public as $$
  select
    case when entry.schedule_id is null or not ((extract(dow from (entry.clock_in_at at time zone 'Asia/Manila'))::smallint) = any(coalesce(entry.scheduled_weekdays, array[1,2,3,4,5]::smallint[]))) then 'NOT_APPLICABLE' else 'APPLICABLE' end,
    case when entry.schedule_id is null or entry.schedule_type is distinct from 'FIXED' or entry.scheduled_start_time is null then null else greatest(0, extract(epoch from ((entry.clock_in_at at time zone 'Asia/Manila')::time - entry.scheduled_start_time))::integer) end,
    case when entry.schedule_id is null or entry.duration_seconds is null or entry.target_seconds is null then null else greatest(0, entry.target_seconds - entry.duration_seconds) end,
    case when entry.schedule_id is null or entry.duration_seconds is null or entry.target_seconds is null then null else greatest(0, entry.duration_seconds - entry.target_seconds) end,
    null::integer
  from public.time_entries entry where entry.id = p_entry_id;
$$;

commit;
