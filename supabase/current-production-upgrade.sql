-- Run this once in Supabase SQL Editor for an existing ACE project before
-- deploying the current backend. It is safe to run more than once.
-- It adds every database object used by the current API that may be absent
-- from older schema installations.

begin;

-- Make Google sign-in resilient: a profile is created first, and a malformed
-- legacy invitation can never make Supabase Auth reject the new user.
alter table public.profiles add column if not exists profile_picture_url text;
alter table public.invitations
  add column if not exists role public.user_role,
  add column if not exists department_id uuid references public.departments(id) on delete set null,
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

-- Historical accepted invitations must not block a former employee from
-- receiving a new invitation after their Google login was permanently removed.
alter table public.invitations drop constraint if exists invitations_email_status_key;
create unique index if not exists invitations_one_pending_email_idx
  on public.invitations(email)
  where status = 'PENDING';

create or replace function public.create_profile_for_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare invitation_id uuid; invitation_role public.user_role; invitation_department_id uuid;
begin
  insert into public.profiles (id, email, full_name, role, status)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), 'USER'::public.user_role, 'PENDING'::public.user_status)
  on conflict (id) do nothing;
  begin
    select id, role, department_id into invitation_id, invitation_role, invitation_department_id
    from public.invitations
    where lower(email) = lower(new.email) and status = 'PENDING' and expires_at > now()
    order by invited_at desc limit 1;
    if invitation_id is not null then
      update public.profiles set role = invitation_role, status = 'ACTIVE'::public.user_status, department_id = invitation_department_id, profile_picture_url = new.raw_user_meta_data ->> 'avatar_url' where id = new.id;
      update public.invitations set status = 'ACCEPTED', accepted_at = now() where id = invitation_id;
    end if;
  exception when others then
    raise warning 'Could not apply invitation for new Auth user: %', sqlerrm;
  end;
  return new;
end;
$$;
alter function public.create_profile_for_auth_user() owner to postgres;
drop trigger if exists auth_user_profile on auth.users;
create trigger auth_user_profile after insert on auth.users for each row execute function public.create_profile_for_auth_user();

alter table public.time_entries
  add column if not exists planned_end_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_user_id uuid references public.profiles(id) on delete set null;

create index if not exists time_entries_planned_end_idx
  on public.time_entries(planned_end_at)
  where clock_out_at is null and planned_end_at is not null;
create index if not exists time_entries_deleted_at_idx on public.time_entries(deleted_at);

alter table public.profiles
  add column if not exists last_seen_at timestamptz,
  add column if not exists permanently_deleted_at timestamptz;

create index if not exists profiles_last_seen_at_idx on public.profiles(last_seen_at desc);
create index if not exists profiles_permanently_deleted_at_idx
  on public.profiles(permanently_deleted_at)
  where permanently_deleted_at is not null;

-- Preserve company records when an Auth login is permanently removed.
alter table public.profiles drop constraint if exists profiles_id_fkey;

create or replace function public.permanently_remove_archived_login(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_status public.user_status;
begin
  select status into target_status
  from public.profiles
  where id = target_user_id and permanently_deleted_at is null;

  if not found then raise exception 'Archived user not found'; end if;
  if target_status <> 'DENIED' then raise exception 'Only archived users can be permanently deleted'; end if;

  update public.profiles set permanently_deleted_at = now() where id = target_user_id;
  delete from auth.users where id = target_user_id;
end;
$$;

revoke all on function public.permanently_remove_archived_login(uuid) from public, anon, authenticated;
grant execute on function public.permanently_remove_archived_login(uuid) to service_role;

create table if not exists public.employee_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  read_at timestamptz,
  constraint employee_messages_no_self_chat check (sender_id <> recipient_id)
);

create index if not exists employee_messages_conversation_idx
  on public.employee_messages(sender_id, recipient_id, created_at);
create index if not exists employee_messages_recipient_unread_idx
  on public.employee_messages(recipient_id, read_at) where read_at is null;

alter table public.employee_messages enable row level security;

commit;
