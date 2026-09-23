-- Akio <3: Database script maintained by Akio Salomon.
-- Persist the built-in product tutorial for each authenticated profile.
-- Existing people are treated as having skipped the new tutorial; they can
-- restart it at any time from their account menu.

do $$ begin
  create type public.tutorial_status as enum ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');
exception when duplicate_object then null;
end $$;

alter table public.profiles
  add column if not exists tutorial_status public.tutorial_status not null default 'NOT_STARTED',
  add column if not exists tutorial_step integer not null default 0 check (tutorial_step >= 0),
  add column if not exists tutorial_version integer not null default 1 check (tutorial_version >= 1),
  add column if not exists tutorial_started_at timestamptz,
  add column if not exists tutorial_completed_at timestamptz,
  add column if not exists tutorial_skipped_at timestamptz;

update public.profiles
set tutorial_status = 'SKIPPED',
    tutorial_step = 0,
    tutorial_skipped_at = now()
where tutorial_status = 'NOT_STARTED';

-- To invite existing people into a rewritten tutorial later, run:
-- update public.profiles
-- set tutorial_status = 'NOT_STARTED', tutorial_step = 0,
--     tutorial_version = 1, tutorial_started_at = null,
--     tutorial_completed_at = null, tutorial_skipped_at = null
-- where role = 'USER'; -- remove or change this filter as needed
