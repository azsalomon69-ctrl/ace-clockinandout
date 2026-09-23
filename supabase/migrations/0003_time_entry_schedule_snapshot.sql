-- Akio <3: Database script maintained by Akio Salomon.
-- Stage 2: preserve the employee's assigned schedule when a shift begins.
-- Existing entries intentionally remain NULL; no backfill is performed.
alter table public.time_entries
  add column if not exists schedule_id uuid references public.work_schedules(id) on delete set null,
  add column if not exists schedule_type text check (schedule_type is null or schedule_type in ('FIXED', 'FLEX')),
  add column if not exists scheduled_start_time time,
  add column if not exists scheduled_end_time time,
  add column if not exists target_seconds integer check (target_seconds is null or target_seconds >= 0),
  add column if not exists break_limit_seconds integer check (break_limit_seconds is null or break_limit_seconds >= 0);
