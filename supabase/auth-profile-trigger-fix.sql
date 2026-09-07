-- Repairs the Auth trigger used when a person signs in with Google for the
-- first time. Run this whole file once in Supabase SQL Editor.
-- It preserves existing users, invitations, and time records.

begin;

-- Older installations sometimes made profile email unique. That prevents a
-- new Google Auth identity from being created when a permanently removed
-- login's historical profile is intentionally retained.
alter table public.profiles drop constraint if exists profiles_email_key;

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
  -- Always create the base profile first. An invitation lookup must never
  -- prevent Auth from saving a newly created Google user.
  insert into public.profiles (
    id, email, full_name, role, status
  ) values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    'USER'::public.user_role,
    'PENDING'::public.user_status
  ) on conflict (id) do nothing;

  begin
    select id, role, department_id
      into invitation_id, invitation_role, invitation_department_id
    from public.invitations
    where lower(email) = lower(new.email)
      and status = 'PENDING'
      and expires_at > now()
    order by invited_at desc
    limit 1;

    if invitation_id is not null then
      update public.profiles
      set role = invitation_role,
          status = 'ACTIVE'::public.user_status,
          department_id = invitation_department_id,
          profile_picture_url = new.raw_user_meta_data ->> 'avatar_url'
      where id = new.id;

      update public.invitations
      set status = 'ACCEPTED', accepted_at = now()
      where id = invitation_id;
    end if;
  exception when others then
    -- The profile above remains saved even if legacy invitation data is bad.
    raise warning 'Could not apply invitation for new Auth user: %', sqlerrm;
  end;

  return new;
end;
$$;

-- Auth invokes this as a privileged trigger. Make the SQL Editor owner
-- explicit so the security-definer function can write application tables.
alter function public.create_profile_for_auth_user() owner to postgres;

drop trigger if exists auth_user_profile on auth.users;
create trigger auth_user_profile
after insert on auth.users
for each row execute function public.create_profile_for_auth_user();

commit;
