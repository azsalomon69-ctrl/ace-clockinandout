-- Retried role changes should not manufacture another audit event when the
-- requested role is already the profile's current role.
create or replace function public.change_user_role_with_audit(
  p_target_user_id uuid,
  p_actor_user_id uuid,
  p_role public.user_role,
  p_request_id uuid default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare v_target public.profiles;
begin
  if p_role is null then raise exception 'INVALID_PROFILE_ROLE' using errcode = 'P0001'; end if;
  select * into v_target from public.profiles where id = p_target_user_id for update;
  if not found then raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0001'; end if;

  -- Idempotent retry: preserve the response without recording a false change.
  if v_target.role = p_role then return v_target; end if;

  update public.profiles set role = p_role where id = v_target.id returning * into v_target;
  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, request_id)
  values (p_actor_user_id, 'CHANGE_ROLE', 'PROFILE', v_target.id, format('Changed %s role to %s', v_target.email, p_role), p_request_id);
  return v_target;
end;
$$;

revoke all on function public.change_user_role_with_audit(uuid, uuid, public.user_role, uuid) from public, anon, authenticated;
grant execute on function public.change_user_role_with_audit(uuid, uuid, public.user_role, uuid) to service_role;
