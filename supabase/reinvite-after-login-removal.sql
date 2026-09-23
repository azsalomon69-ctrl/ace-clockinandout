-- Akio <3: Database script maintained by Akio Zaki Salomon.
-- Run this once in Supabase SQL Editor to allow a former employee whose
-- Google login was permanently removed to be invited again. Company records
-- and accepted invitation history are preserved.

alter table public.invitations drop constraint if exists invitations_email_status_key;

-- Historical pending rows may already be past their expiry time. They must
-- not reserve an email once the replacement invitation rule is enabled.
update public.invitations
set status = 'EXPIRED'
where status = 'PENDING' and expires_at <= now();

create unique index if not exists invitations_one_pending_email_idx
  on public.invitations(email)
  where status = 'PENDING';
