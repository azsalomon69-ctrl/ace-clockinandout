-- Run once in the Supabase SQL Editor for an existing ACE installation.
-- Break time is excluded from duration_seconds, while clock-in/out history remains intact.
begin;

alter table public.time_entries
  add column if not exists break_started_at timestamptz,
  add column if not exists break_seconds integer not null default 0;

alter table public.time_entries
  drop constraint if exists time_entries_break_seconds_check;
alter table public.time_entries
  add constraint time_entries_break_seconds_check check (break_seconds >= 0);

-- duration_seconds is generated, so recreate it with the break deduction.
alter table public.time_entries drop column if exists duration_seconds;
alter table public.time_entries add column duration_seconds integer generated always as (
  case when clock_out_at is null then null
  else greatest(0, extract(epoch from (clock_out_at - clock_in_at))::integer - break_seconds) end
) stored;

commit;
