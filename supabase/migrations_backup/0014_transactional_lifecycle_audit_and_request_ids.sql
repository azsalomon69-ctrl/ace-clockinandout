-- Keep high-risk lifecycle and destructive time-entry changes inseparable from
-- their audit evidence. Request IDs are generated/validated by Express and
-- are operational correlation values, never credentials or session IDs.

alter table public.audit_logs
  add column if not exists request_id uuid;

create index if not exists audit_logs_request_id_idx
  on public.audit_logs(request_id)
  where request_id is not null;

create or replace function public.submit_access_request(
  p_existing_request_id uuid,
  p_profile_id uuid,
  p_email text,
  p_full_name text,
  p_requested_department text,
  p_message text,
  p_request_ip inet,
  p_expires_at timestamptz,
  p_request_id uuid default null
)
returns public.access_requests
language plpgsql
security definer
set search_path = public
as $$
declare v_request public.access_requests;
begin
  perform set_config('ace.request_id', coalesce(p_request_id::text, ''), true);
  if p_existing_request_id is null then
    insert into public.access_requests (profile_id, email, full_name, requested_department, message, requested_role, request_ip, expires_at)
    values (p_profile_id, p_email, p_full_name, p_requested_department, p_message, 'USER', p_request_ip, p_expires_at)
    returning * into v_request;
  else
    update public.access_requests
    set profile_id = p_profile_id, email = p_email, full_name = p_full_name,
        requested_department = p_requested_department, message = p_message,
        requested_role = 'USER', request_ip = p_request_ip, expires_at = p_expires_at
    where id = p_existing_request_id
    returning * into v_request;
    if not found then raise exception 'ACCESS_REQUEST_NOT_FOUND' using errcode = 'P0001'; end if;
  end if;
  return v_request;
end;
$$;

revoke all on function public.submit_access_request(uuid, uuid, text, text, text, text, inet, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.submit_access_request(uuid, uuid, text, text, text, text, inet, timestamptz, uuid) to service_role;

-- Replace the 0013 review RPC with the correlation-aware signature. The
-- operation and its access-request audit trigger still share one transaction.
drop function if exists public.review_access_request(uuid, uuid, text, public.user_role, uuid);
create function public.review_access_request(
  p_request_id uuid,
  p_actor_user_id uuid,
  p_decision text,
  p_role public.user_role,
  p_department_id uuid default null,
  p_correlation_id uuid default null
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

  -- The trigger reads this transaction-local setting and writes the same
  -- correlation value with the immutable audit record.
  perform set_config('ace.request_id', coalesce(p_correlation_id::text, ''), true);
  update public.access_requests
  set status = v_status, reviewed_at = now(), reviewed_by_user_id = p_actor_user_id
  where id = v_request.id
  returning * into v_request;
  return v_request;
end;
$$;

revoke all on function public.review_access_request(uuid, uuid, text, public.user_role, uuid, uuid) from public, anon, authenticated;
grant execute on function public.review_access_request(uuid, uuid, text, public.user_role, uuid, uuid) to service_role;

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
    v_action := 'REQUEST_ACCESS'; v_actor := new.profile_id; v_description := 'Requested account approval';
  elsif new.status is distinct from old.status then
    v_action := case new.status when 'ACTIVE' then 'APPROVE_ACCESS_REQUEST' when 'DENIED' then 'DENY_ACCESS_REQUEST' else 'UPDATE_ACCESS_REQUEST' end;
    v_actor := coalesce(new.reviewed_by_user_id, new.profile_id);
    v_description := case new.status when 'ACTIVE' then format('Approved %s', new.email) when 'DENIED' then format('Denied %s', new.email) else format('Updated access request for %s', new.email) end;
  elsif new.expires_at is distinct from old.expires_at and old.status = 'PENDING' and old.expires_at <= now() and new.expires_at > now() then
    v_action := 'REQUEST_ACCESS'; v_actor := new.profile_id; v_description := 'Requested account approval again after expiry';
  else
    return new;
  end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, request_id)
  values (v_actor, v_action, 'ACCESS_REQUEST', new.id, v_description, nullif(current_setting('ace.request_id', true), '')::uuid);
  return new;
end;
$$;

create or replace function public.admin_update_profile_with_audit(
  p_target_user_id uuid,
  p_actor_user_id uuid,
  p_operation text,
  p_role public.user_role default null,
  p_status public.user_status default null,
  p_department_id uuid default null,
  p_request_id uuid default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.profiles;
  v_action text;
  v_description text;
begin
  select * into v_target from public.profiles where id = p_target_user_id for update;
  if not found then raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0001'; end if;

  case p_operation
    when 'APPROVAL' then
      if p_status not in ('ACTIVE', 'DENIED') then raise exception 'INVALID_PROFILE_STATUS' using errcode = 'P0001'; end if;
      update public.profiles set status = p_status where id = v_target.id returning * into v_target;
      v_action := case when p_status = 'ACTIVE' then 'APPROVE' else 'DENY' end;
      v_description := format('%s user %s', p_status, v_target.email);
    when 'CHANGE_ROLE' then
      if p_role is null then raise exception 'INVALID_PROFILE_ROLE' using errcode = 'P0001'; end if;
      update public.profiles set role = p_role where id = v_target.id returning * into v_target;
      v_action := 'CHANGE_ROLE';
      v_description := format('Changed %s role to %s', v_target.email, p_role);
    when 'ASSIGN_DEPARTMENT' then
      update public.profiles set department_id = p_department_id where id = v_target.id returning * into v_target;
      v_action := 'ASSIGN_DEPARTMENT';
      v_description := format('Updated department for %s', v_target.email);
    when 'ARCHIVE_USER' then
      update public.profiles set status = 'DENIED' where id = v_target.id returning * into v_target;
      v_action := 'ARCHIVE_USER';
      v_description := format('Archived user %s', v_target.email);
    when 'RESTORE_USER' then
      update public.profiles set status = 'ACTIVE' where id = v_target.id returning * into v_target;
      v_action := 'RESTORE_USER';
      v_description := format('Restored user %s', v_target.email);
    else
      raise exception 'INVALID_PROFILE_OPERATION' using errcode = 'P0001';
  end case;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, request_id)
  values (p_actor_user_id, v_action, 'PROFILE', v_target.id, v_description, p_request_id);
  return v_target;
end;
$$;

revoke all on function public.admin_update_profile_with_audit(uuid, uuid, text, public.user_role, public.user_status, uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_update_profile_with_audit(uuid, uuid, text, public.user_role, public.user_status, uuid, uuid) to service_role;

create or replace function public.archive_time_entry_with_audit(
  p_entry_id uuid,
  p_actor_user_id uuid,
  p_operation text,
  p_request_id uuid default null
)
returns public.time_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.time_entries;
  v_action text;
  v_description text;
begin
  if p_operation = 'DELETE' then
    update public.time_entries
    set deleted_at = now(), deleted_by_user_id = p_actor_user_id
    where id = p_entry_id and deleted_at is null and clock_out_at is not null
    returning * into v_entry;
    if not found then
      if exists (select 1 from public.time_entries where id = p_entry_id and deleted_at is null and clock_out_at is null) then
        raise exception 'ENTRY_OPEN' using errcode = 'P0001';
      end if;
      raise exception 'ENTRY_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_action := 'DELETE';
    v_description := 'Moved time entry to deleted data';
  elsif p_operation = 'RESTORE' then
    update public.time_entries
    set deleted_at = null, deleted_by_user_id = null
    where id = p_entry_id and deleted_at is not null
    returning * into v_entry;
    if not found then raise exception 'ENTRY_NOT_FOUND' using errcode = 'P0001'; end if;
    v_action := 'RESTORE';
    v_description := 'Restored time entry';
  elsif p_operation = 'PERMANENT_DELETE' then
    delete from public.time_entries
    where id = p_entry_id and deleted_at is not null
    returning * into v_entry;
    if not found then raise exception 'ENTRY_NOT_FOUND' using errcode = 'P0001'; end if;
    v_action := 'PERMANENT_DELETE';
    v_description := format('Permanently deleted archived time entry for user %s', v_entry.user_id);
  else
    raise exception 'INVALID_TIME_ENTRY_OPERATION' using errcode = 'P0001';
  end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, request_id)
  values (p_actor_user_id, v_action, 'TIME_ENTRY', p_entry_id, v_description, p_request_id);
  return v_entry;
end;
$$;

revoke all on function public.archive_time_entry_with_audit(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.archive_time_entry_with_audit(uuid, uuid, text, uuid) to service_role;

drop function if exists public.permanently_remove_archived_login(uuid);
create function public.permanently_remove_archived_login(
  p_target_user_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_target public.profiles;
begin
  select * into v_target from public.profiles where id = p_target_user_id for update;
  if not found or v_target.permanently_deleted_at is not null then raise exception 'ARCHIVED_USER_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_target.status <> 'DENIED' then raise exception 'ONLY_ARCHIVED_USERS' using errcode = 'P0001'; end if;

  update public.profiles set permanently_deleted_at = now() where id = v_target.id;
  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, request_id)
  values (p_actor_user_id, 'PERMANENT_DELETE_USER', 'PROFILE', v_target.id, format('Permanently deleted archived user %s', v_target.email), p_request_id);
  delete from auth.users where id = v_target.id;
end;
$$;

revoke all on function public.permanently_remove_archived_login(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.permanently_remove_archived_login(uuid, uuid, uuid) to service_role;
