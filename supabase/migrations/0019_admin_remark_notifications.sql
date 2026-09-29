-- Administrator feedback notification state.
-- Safe for existing projects: historical feedback is acknowledged so only
-- feedback posted after this migration creates a new notification.
begin;

alter table public.admin_remarks add column if not exists seen_at timestamptz;

update public.admin_remarks
set seen_at = created_at
where seen_at is null;

create index if not exists admin_remarks_unseen_idx
  on public.admin_remarks (time_entry_id, seen_at)
  where seen_at is null;

commit;
