-- Access requests are security-relevant state.  Their audit record must be
-- written in the same PostgreSQL transaction as the request itself, rather
-- than as a best-effort follow-up from the API.

create or replace function public.audit_access_request_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
  v_actor uuid;
  v_description text;
begin
  if tg_op = 'INSERT' then
    v_action := 'REQUEST_ACCESS';
    v_actor := new.profile_id;
    v_description := 'Requested account approval';
  elsif new.status is distinct from old.status then
    v_action := case new.status
      when 'ACTIVE' then 'APPROVE_ACCESS_REQUEST'
      when 'DENIED' then 'DENY_ACCESS_REQUEST'
      else 'UPDATE_ACCESS_REQUEST'
    end;
    v_actor := coalesce(new.reviewed_by_user_id, new.profile_id);
    v_description := case new.status
      when 'ACTIVE' then format('Approved %s', new.email)
      when 'DENIED' then format('Denied %s', new.email)
      else format('Updated access request for %s', new.email)
    end;
  -- An expired PENDING request is deliberately reopened by changing its
  -- expiry; retain a new, attributable submission event for that action.
  elsif new.expires_at is distinct from old.expires_at
    and old.status = 'PENDING'
    and old.expires_at <= now()
    and new.expires_at > now() then
    v_action := 'REQUEST_ACCESS';
    v_actor := new.profile_id;
    v_description := 'Requested account approval again after expiry';
  else
    return new;
  end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description)
  values (v_actor, v_action, 'ACCESS_REQUEST', new.id, v_description);
  return new;
end;
$$;

drop trigger if exists access_requests_audit on public.access_requests;
create trigger access_requests_audit
after insert or update on public.access_requests
for each row execute function public.audit_access_request_change();

-- Serialize submissions for a profile so two concurrent browser/API requests
-- cannot both pass the application-level "no pending request" check.
create or replace function public.serialize_pending_access_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'PENDING' then return new; end if;
  perform pg_advisory_xact_lock(hashtext(new.profile_id::text));
  if exists (
    select 1 from public.access_requests
    where profile_id = new.profile_id
      and id is distinct from new.id
      and status = 'PENDING'
      and expires_at > now()
  ) then
    raise exception 'ACCESS_REQUEST_ALREADY_PENDING' using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists access_requests_one_pending on public.access_requests;
create trigger access_requests_one_pending
before insert or update of profile_id, status, expires_at on public.access_requests
for each row execute function public.serialize_pending_access_request();

-- Approval changes the linked profile and access request together.  This is a
-- server-only RPC; the Express route still authenticates, authorizes, and
-- applies the head-admin lifecycle guard before invoking it.
create or replace function public.review_access_request(
  p_request_id uuid,
  p_actor_user_id uuid,
  p_decision text,
  p_role public.user_role,
  p_department_id uuid default null
)
returns public.access_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.access_requests;
  v_status public.user_status;
begin
  select * into v_request from public.access_requests where id = p_request_id for update;
  if not found then raise exception 'ACCESS_REQUEST_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_request.status <> 'PENDING' then raise exception 'ACCESS_REQUEST_ALREADY_REVIEWED' using errcode = 'P0001'; end if;
  if v_request.expires_at <= now() then raise exception 'ACCESS_REQUEST_EXPIRED' using errcode = 'P0001'; end if;
  if v_request.profile_id is null then raise exception 'ACCESS_REQUEST_LEGACY_PROFILE' using errcode = 'P0001'; end if;
  if p_decision not in ('APPROVE', 'DENY') then raise exception 'ACCESS_REQUEST_INVALID_DECISION' using errcode = 'P0001'; end if;

  v_status := case when p_decision = 'APPROVE' then 'ACTIVE'::public.user_status else 'DENIED'::public.user_status end;
  if p_decision = 'APPROVE' then
    update public.profiles set status = v_status, role = p_role, department_id = p_department_id where id = v_request.profile_id;
  else
    update public.profiles set status = v_status where id = v_request.profile_id;
  end if;

  update public.access_requests
  set status = v_status, reviewed_at = now(), reviewed_by_user_id = p_actor_user_id
  where id = v_request.id
  returning * into v_request;
  return v_request;
end;
$$;

revoke all on function public.review_access_request(uuid, uuid, text, public.user_role, uuid) from public, anon, authenticated;
grant execute on function public.review_access_request(uuid, uuid, text, public.user_role, uuid) to service_role;
