-- Run once in the Supabase SQL Editor to record administrator-stopped shifts.
alter table public.time_entries add column if not exists stopped_by_user_id uuid references public.profiles(id) on delete set null;
alter table public.time_entries add column if not exists stopped_by_at timestamptz;
