begin;

-- Run after migrations through 0029. Existing schedules and historical entries
-- are unchanged. AS_NEEDED has no recurring required attendance days.
alter table public.work_schedules drop constraint if exists work_schedules_schedule_type_check;
alter table public.work_schedules add constraint work_schedules_schedule_type_check
  check (schedule_type in ('FIXED', 'FLEX', 'AS_NEEDED'));
alter table public.work_schedules drop constraint if exists fixed_schedule_times;
alter table public.work_schedules add constraint fixed_schedule_times
  check (schedule_type <> 'FIXED' or (start_time is not null and end_time is not null));
alter table public.work_schedules drop constraint if exists work_schedules_scheduled_weekdays_valid;
alter table public.work_schedules add constraint work_schedules_scheduled_weekdays_valid
  check ((schedule_type = 'AS_NEEDED' and cardinality(scheduled_weekdays) = 0)
    or (schedule_type <> 'AS_NEEDED' and cardinality(scheduled_weekdays) > 0
      and scheduled_weekdays <@ array[0,1,2,3,4,5,6]::smallint[]));
alter table public.time_entries drop constraint if exists time_entries_schedule_type_check;
alter table public.time_entries add constraint time_entries_schedule_type_check
  check (schedule_type is null or schedule_type in ('FIXED', 'FLEX', 'AS_NEEDED'));

-- Evaluate actual shifts, including weekends for AS_NEEDED. No time entry
-- means no compliance result; never infer an absence for AS_NEEDED schedules.
create or replace function public.compute_schedule_compliance(p_entry_id uuid)
returns table (classification text, late_seconds integer, undertime_seconds integer, overtime_seconds integer, break_overage_seconds integer)
language sql stable set search_path = public as $$
  select
    case when entry.schedule_id is null or (entry.schedule_type is distinct from 'AS_NEEDED' and not ((extract(dow from (entry.clock_in_at at time zone 'Asia/Manila'))::smallint) = any(coalesce(entry.scheduled_weekdays, array[1,2,3,4,5]::smallint[])))) then 'NOT_APPLICABLE' else 'APPLICABLE' end,
    case when entry.schedule_id is null or entry.schedule_type is distinct from 'FIXED' or entry.scheduled_start_time is null then null else greatest(0, extract(epoch from ((entry.clock_in_at at time zone 'Asia/Manila')::time - entry.scheduled_start_time))::integer) end,
    case when entry.schedule_id is null or entry.duration_seconds is null or entry.target_seconds is null then null else greatest(0, entry.target_seconds - entry.duration_seconds) end,
    case when entry.schedule_id is null or entry.duration_seconds is null or entry.target_seconds is null then null else greatest(0, entry.duration_seconds - entry.target_seconds) end,
    null::integer
  from public.time_entries entry where entry.id = p_entry_id;
$$;
commit;
