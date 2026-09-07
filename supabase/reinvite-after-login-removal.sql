-- Run this once in Supabase SQL Editor to allow a former employee whose
-- Google login was permanently removed to be invited again. Company records
-- and accepted invitation history are preserved.

alter table public.invitations drop constraint if exists invitations_email_status_key;

create unique index if not exists invitations_one_pending_email_idx
  on public.invitations(email)
  where status = 'PENDING';
