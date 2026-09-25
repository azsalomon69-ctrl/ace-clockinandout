-- Retried approval/denial requests must return the current profile without
-- creating a second audit event when the requested status is already present.
create or replace function public.change_user_status_with_audit(
  p_target_user_id uuid,
  p_actor_user_id uuid,
  p_status public.user_status,
  p_request_id uuid default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare v_target public.profiles;
begin
  if p_status not in ('ACTIVE', 'DENIED') then raise exception 'INVALID_PROFILE_STATUS' using errcode = 'P0001'; end if;
  select * into v_target from public.profiles where id = p_target_user_id for update;
  if not found then raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0001'; end if;

  -- Idempotent retry: no state transition means no duplicate event.
  if v_target.status = p_status then return v_target; end if;

  update public.profiles set status = p_status where id = v_target.id returning * into v_target;
  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, request_id)
  values (
    p_actor_user_id,
    case when p_status = 'ACTIVE' then 'APPROVE' else 'DENY' end,
    'PROFILE',
    v_target.id,
    format('%s user %s', p_status, v_target.email),
    p_request_id
  );
  return v_target;
end;
$$;

revoke all on function public.change_user_status_with_audit(uuid, uuid, public.user_status, uuid) from public, anon, authenticated;
grant execute on function public.change_user_status_with_audit(uuid, uuid, public.user_status, uuid) to service_role;
