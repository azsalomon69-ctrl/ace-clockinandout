-- Akio <3: Database script maintained by Akio Salomon.
-- Schedules apply only on explicitly selected weekdays: 0 = Sunday through 6 = Saturday.
-- Existing schedules default to Monday through Friday so they do not create
-- weekend late, undertime, or break-overage classifications.
alter table public.work_schedules
  add column if not exists scheduled_weekdays smallint[] not null default array[1, 2, 3, 4, 5]::smallint[];

alter table public.work_schedules
  drop constraint if exists work_schedules_scheduled_weekdays_valid;
alter table public.work_schedules
  add constraint work_schedules_scheduled_weekdays_valid
  check (
    cardinality(scheduled_weekdays) > 0
    and scheduled_weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
  );

alter table public.time_entries
  add column if not exists scheduled_weekdays smallint[];

-- Recreate compliance calculation using the clock-in date in Asia/Manila.
create or replace function public.compute_schedule_compliance(p_entry_id uuid)
returns table (
  classification text,
  late_seconds integer,
  undertime_seconds integer,
  overtime_seconds integer,
  break_overage_seconds integer
)
language sql
stable
set search_path = public
as $$
  select
    case
      when entry.schedule_id is null
        or not ((extract(dow from (entry.clock_in_at at time zone 'Asia/Manila'))::smallint)
          = any(coalesce(entry.scheduled_weekdays, array[1, 2, 3, 4, 5]::smallint[])))
        then 'NOT_APPLICABLE'
      else 'APPLICABLE'
    end as classification,
    case
      when entry.schedule_id is null
        or not ((extract(dow from (entry.clock_in_at at time zone 'Asia/Manila'))::smallint)
          = any(coalesce(entry.scheduled_weekdays, array[1, 2, 3, 4, 5]::smallint[])))
        or entry.schedule_type is distinct from 'FIXED'
        or entry.scheduled_start_time is null then null
      else greatest(0, extract(epoch from ((entry.clock_in_at at time zone 'Asia/Manila')::time - entry.scheduled_start_time))::integer)
    end as late_seconds,
    case
      when entry.schedule_id is null or entry.duration_seconds is null or entry.target_seconds is null
        or not ((extract(dow from (entry.clock_in_at at time zone 'Asia/Manila'))::smallint)
          = any(coalesce(entry.scheduled_weekdays, array[1, 2, 3, 4, 5]::smallint[]))) then null
      else greatest(0, entry.target_seconds - (entry.duration_seconds + entry.break_seconds))
    end as undertime_seconds,
    case
      when entry.schedule_id is null or entry.duration_seconds is null or entry.target_seconds is null
        or not ((extract(dow from (entry.clock_in_at at time zone 'Asia/Manila'))::smallint)
          = any(coalesce(entry.scheduled_weekdays, array[1, 2, 3, 4, 5]::smallint[]))) then null
      else greatest(0, (entry.duration_seconds + entry.break_seconds) - entry.target_seconds)
    end as overtime_seconds,
    case
      when entry.schedule_id is null or entry.break_limit_seconds is null
        or not ((extract(dow from (entry.clock_in_at at time zone 'Asia/Manila'))::smallint)
          = any(coalesce(entry.scheduled_weekdays, array[1, 2, 3, 4, 5]::smallint[]))) then null
      else greatest(0, entry.break_seconds - entry.break_limit_seconds)
    end as break_overage_seconds
  from public.time_entries as entry
  where entry.id = p_entry_id;
$$;
