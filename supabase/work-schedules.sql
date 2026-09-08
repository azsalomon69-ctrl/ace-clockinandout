-- Run once in the Supabase SQL Editor to enable fixed schedules and flextime.
create table if not exists public.work_schedules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  schedule_type text not null check (schedule_type in ('FIXED', 'FLEX')),
  start_time time,
  end_time time,
  daily_elapsed_minutes integer not null default 540 check (daily_elapsed_minutes between 60 and 1440),
  break_limit_minutes integer not null default 60 check (break_limit_minutes between 0 and 360),
  is_active boolean not null default true,
  created_by_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fixed_schedule_times check (schedule_type = 'FLEX' or (start_time is not null and end_time is not null))
);
create table if not exists public.user_schedule_assignments (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  schedule_id uuid not null references public.work_schedules(id) on delete cascade,
  assigned_by_user_id uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now()
);
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists work_schedules_updated_at on public.work_schedules;
create trigger work_schedules_updated_at before update on public.work_schedules for each row execute function public.set_updated_at();
alter table public.work_schedules enable row level security;
alter table public.user_schedule_assignments enable row level security;
