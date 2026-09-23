-- Akio <3: Database script maintained by Akio Salomon.
-- Stage 3: read-only schedule-compliance classification from entry snapshots.
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
    case when entry.schedule_id is null then 'NOT_APPLICABLE' else 'APPLICABLE' end as classification,
    case
      when entry.schedule_id is null or entry.schedule_type is distinct from 'FIXED' or entry.scheduled_start_time is null then null
      else greatest(
        0,
        extract(epoch from ((entry.clock_in_at at time zone 'Asia/Manila')::time - entry.scheduled_start_time))::integer
      )
    end as late_seconds,
    case
      when entry.schedule_id is null or entry.duration_seconds is null or entry.target_seconds is null then null
      else greatest(0, entry.target_seconds - (entry.duration_seconds + entry.break_seconds))
    end as undertime_seconds,
    case
      when entry.schedule_id is null or entry.duration_seconds is null or entry.target_seconds is null then null
      else greatest(0, (entry.duration_seconds + entry.break_seconds) - entry.target_seconds)
    end as overtime_seconds,
    case
      when entry.schedule_id is null or entry.break_limit_seconds is null then null
      else greatest(0, entry.break_seconds - entry.break_limit_seconds)
    end as break_overage_seconds
  from public.time_entries as entry
  where entry.id = p_entry_id;
$$;

-- Sanity-case expectations (all entries are completed):
-- FIXED, on time, full target: 09:00 clock-in; target 32400; duration 28800;
--   break 3600; break limit 3600 => APPLICABLE, late 0, undertime 0, overtime 0, overage 0.
-- FIXED, five minutes late, full target: 09:05 clock-in with the same target,
--   duration, and break => APPLICABLE, late 300, undertime 0, overtime 0, overage 0.
-- FIXED, on time, 30 minutes undertime: target 32400; duration 25200; break 3600
--   => APPLICABLE, late 0, undertime 1800, overtime 0, overage 0.
-- FLEX, one hour undertime: target 32400; duration 25200; break 3600
--   => APPLICABLE, late NULL, undertime 3600, overtime 0, overage 0.
-- No schedule: schedule_id NULL => NOT_APPLICABLE and all seconds values NULL.
