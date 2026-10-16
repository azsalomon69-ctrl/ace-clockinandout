-- Archive/restore previously changed Supabase Auth through an HTTP Admin API
-- before recording the profile/audit transaction. Keep Auth's ban field,
-- profile status, and immutable audit event in one database transaction.

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
set search_path = public, auth
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
      update auth.users set banned_until = now() + interval '100 years' where id = v_target.id;
      if not found then raise exception 'AUTH_ACCOUNT_NOT_FOUND' using errcode = 'P0001'; end if;
      update public.profiles set status = 'DENIED' where id = v_target.id returning * into v_target;
      v_action := 'ARCHIVE_USER';
      v_description := format('Archived user %s', v_target.email);
    when 'RESTORE_USER' then
      update auth.users set banned_until = null where id = v_target.id;
      if not found then raise exception 'AUTH_ACCOUNT_NOT_FOUND' using errcode = 'P0001'; end if;
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
