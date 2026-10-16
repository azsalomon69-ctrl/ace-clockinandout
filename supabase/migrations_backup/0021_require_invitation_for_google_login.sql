-- Google sign-in is invitation-only. An account without an active, matching
-- invitation is rejected before it can create a pending profile.

create or replace function public.create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation_id uuid;
  invitation_role public.user_role;
  invitation_department_id uuid;
begin
  select id, role, department_id
    into invitation_id, invitation_role, invitation_department_id
  from public.invitations
  where lower(email) = lower(new.email)
    and status = 'PENDING'
    and expires_at > now()
  order by invited_at desc
  limit 1;

  if invitation_id is null then
    raise exception 'INVITATION_REQUIRED'
      using errcode = 'P0001', message = 'An active invitation is required for this workspace';
  end if;

  insert into public.profiles (
    id, email, full_name, profile_picture_url, role, status, department_id
  ) values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'),
    invitation_role,
    'ACTIVE'::public.user_status,
    invitation_department_id
  ) on conflict (id) do nothing;

  update public.invitations
  set status = 'ACCEPTED', accepted_at = now()
  where id = invitation_id;

  return new;
end;
$$;

alter function public.create_profile_for_auth_user() owner to postgres;
