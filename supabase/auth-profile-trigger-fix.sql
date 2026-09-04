-- Repairs the Auth trigger used when a person signs in with Google for the
-- first time. Run this whole file once in Supabase SQL Editor.
-- It preserves existing users, invitations, and time records.

begin;

-- Older installations may be missing fields introduced by the invitation flow.
alter table public.profiles
  add column if not exists profile_picture_url text,
  add column if not exists department_id uuid;

alter table public.invitations
  add column if not exists role public.user_role,
  add column if not exists department_id uuid,
  add column if not exists expires_at timestamptz,
  add column if not exists accepted_at timestamptz;

update public.invitations
set role = coalesce(role, 'USER'::public.user_role),
    expires_at = coalesce(expires_at, invited_at + interval '7 days', now() + interval '7 days')
where role is null or expires_at is null;

alter table public.invitations
  alter column role set default 'USER'::public.user_role,
  alter column role set not null,
  alter column expires_at set default now() + interval '7 days',
  alter column expires_at set not null;

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

  insert into public.profiles (
    id, email, full_name, profile_picture_url, role, status, department_id
  ) values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    new.raw_user_meta_data ->> 'avatar_url',
    coalesce(invitation_role, 'USER'::public.user_role),
    case when invitation_id is null then 'PENDING'::public.user_status else 'ACTIVE'::public.user_status end,
    invitation_department_id
  ) on conflict (id) do nothing;

  if invitation_id is not null then
    update public.invitations
    set status = 'ACCEPTED', accepted_at = now()
    where id = invitation_id;
  end if;

  return new;
end;
$$;

drop trigger if exists auth_user_profile on auth.users;
create trigger auth_user_profile
after insert on auth.users
for each row execute function public.create_profile_for_auth_user();

commit;
