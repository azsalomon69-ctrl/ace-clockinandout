-- Run once in Supabase SQL Editor before deploying scheduled clock-out.
alter table public.time_entries
  add column if not exists planned_end_at timestamptz;

create index if not exists time_entries_planned_end_idx
  on public.time_entries(planned_end_at)
  where clock_out_at is null and planned_end_at is not null;
