-- D3: attribute legacy progress to profiles.role at migration time.
-- Seed the other role as NOT_STARTED; never overwrite existing role records.
-- Preserve legacy columns as a rollback snapshot. New two-role progress cannot
-- be losslessly merged back into the old single record.
begin;

create table if not exists public.profile_tutorial_progress (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('USER', 'ADMIN')),
  tutorial_status public.tutorial_status not null default 'NOT_STARTED',
  tutorial_step integer not null default 0 check (tutorial_step >= 0),
  tutorial_version integer not null default 1 check (tutorial_version >= 1),
  tutorial_started_at timestamptz,
  tutorial_completed_at timestamptz,
  tutorial_skipped_at timestamptz,
  primary key (profile_id, role)
);

insert into public.profile_tutorial_progress (
  profile_id, role, tutorial_status, tutorial_step, tutorial_version,
  tutorial_started_at, tutorial_completed_at, tutorial_skipped_at
)
select p.id, r.role,
  case when p.role::text = r.role then p.tutorial_status else 'NOT_STARTED'::public.tutorial_status end,
  case when p.role::text = r.role then p.tutorial_step else 0 end,
  case when p.role::text = r.role then p.tutorial_version else 1 end,
  case when p.role::text = r.role then p.tutorial_started_at end,
  case when p.role::text = r.role then p.tutorial_completed_at end,
  case when p.role::text = r.role then p.tutorial_skipped_at end
from public.profiles p
cross join (values ('USER'), ('ADMIN')) as r(role)
on conflict (profile_id, role) do nothing;

alter table public.profile_tutorial_progress enable row level security;
revoke all on public.profile_tutorial_progress from public, anon, authenticated;
grant select, insert, update on public.profile_tutorial_progress to service_role;

commit;
