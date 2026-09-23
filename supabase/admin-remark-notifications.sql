-- Akio <3: Database script maintained by Akio Salomon.
-- Run once in the Supabase SQL Editor to persist employee remark notifications.
alter table public.admin_remarks add column if not exists seen_at timestamptz;
update public.admin_remarks set seen_at = now() where seen_at is null;
create index if not exists admin_remarks_unseen_idx on public.admin_remarks (time_entry_id, seen_at) where seen_at is null;
