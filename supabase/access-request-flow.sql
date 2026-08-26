-- Run once in the Supabase SQL Editor for existing ACE projects.
-- It upgrades the original access-request table to the Google-account approval flow.

alter table public.invitations
  add column if not exists role public.user_role not null default 'USER',
  add column if not exists department_id uuid references public.departments(id) on delete set null;

alter table public.access_requests
  add column if not exists profile_id uuid references public.profiles(id) on delete cascade,
  add column if not exists requested_role public.user_role not null default 'USER',
  add column if not exists expires_at timestamptz not null default now() + interval '2 minutes',
  add column if not exists request_ip inet;

alter table public.access_requests drop constraint if exists access_requests_email_key;
create index if not exists access_requests_profile_created_idx on public.access_requests(profile_id, created_at desc);
create index if not exists access_requests_ip_created_idx on public.access_requests(request_ip, created_at desc);

-- A pre-authorized invitation is consumed when that exact email first signs in
-- with Google. It never grants access to a different Google account.
create or replace function public.create_profile_for_auth_user() returns trigger language plpgsql security definer set search_path = public as $$
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

  insert into public.profiles (id, email, full_name, profile_picture_url, role, status, department_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
    new.raw_user_meta_data->>'avatar_url',
    coalesce(invitation_role, 'USER'::public.user_role),
    case when invitation_id is null then 'PENDING'::public.user_status else 'ACTIVE'::public.user_status end,
    invitation_department_id
  )
  on conflict (id) do nothing;

  if invitation_id is not null then
    update public.invitations set status = 'ACCEPTED', accepted_at = now() where id = invitation_id;
  end if;
  return new;
end;
$$;
