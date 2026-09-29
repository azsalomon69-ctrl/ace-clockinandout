-- Self-service access requests are intentionally not part of the ACE access
-- model. Administrators and HR provision access through invitations only.
-- Historical audit_logs rows are retained because they are append-only evidence.

drop trigger if exists access_requests_audit on public.access_requests;
drop trigger if exists access_requests_one_pending on public.access_requests;
drop function if exists public.audit_access_request_change();
drop function if exists public.serialize_pending_access_request();
drop function if exists public.review_access_request(uuid, uuid, text, public.user_role, uuid);
drop function if exists public.review_access_request(uuid, uuid, text, public.user_role, uuid, uuid);
drop function if exists public.submit_access_request(uuid, uuid, text, text, text, text, inet, timestamptz, uuid);
drop table if exists public.access_requests;
