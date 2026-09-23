-- Akio <3: Database script maintained by Akio Salomon.
-- Run once in Supabase SQL Editor before deploying the soft-delete feature.
alter table public.time_entries
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_user_id uuid references public.profiles(id) on delete set null;

create index if not exists time_entries_deleted_at_idx on public.time_entries(deleted_at);
