-- Akio <3: Database script maintained by Akio Salomon.
-- Run this once in the Supabase SQL Editor.
-- This keeps every public profile and all business records. It only breaks the
-- profile-to-auth foreign key so deleting an Auth user does not cascade into
-- public.profiles, then adds a marker used to hide permanently removed users.

alter table public.profiles
  drop constraint if exists profiles_id_fkey;

alter table public.profiles
  add column if not exists permanently_deleted_at timestamptz;

create index if not exists profiles_permanently_deleted_at_idx
  on public.profiles(permanently_deleted_at)
  where permanently_deleted_at is not null;

-- Server-only function. It deletes only the user's Supabase Auth identity
-- (including their Google sign-in) and hides their preserved profile.
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
  where id = target_user_id
    and permanently_deleted_at is null;

  if not found then
    raise exception 'Archived user not found';
  end if;

  if target_status <> 'DENIED' then
    raise exception 'Only archived users can be permanently deleted';
  end if;

  update public.profiles
  set permanently_deleted_at = now()
  where id = target_user_id;

  delete from auth.users where id = target_user_id;
end;
$$;

revoke all on function public.permanently_remove_archived_login(uuid) from public, anon, authenticated;
grant execute on function public.permanently_remove_archived_login(uuid) to service_role;
