-- Repair the project-assignment contract used by PUT /v1/users/:id/projects/:projectId.
-- Safe for existing installations: duplicate legacy assignments are collapsed
-- before the composite primary key is enforced.

create table if not exists public.user_projects (
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (user_id, project_id)
);

alter table public.user_projects
  add column if not exists assigned_at timestamptz;

update public.user_projects
set assigned_at = now()
where assigned_at is null;

alter table public.user_projects
  alter column assigned_at set default now(),
  alter column assigned_at set not null;

-- Earlier deployments could contain duplicate pairs when the table was created
-- outside the repository schema. Preserve the oldest assignment for each pair.
delete from public.user_projects duplicate
using public.user_projects retained
where duplicate.user_id = retained.user_id
  and duplicate.project_id = retained.project_id
  and (
    duplicate.assigned_at > retained.assigned_at
    or (duplicate.assigned_at = retained.assigned_at and duplicate.ctid > retained.ctid)
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_projects'::regclass
      and contype = 'p'
  ) then
    alter table public.user_projects
      add constraint user_projects_pkey primary key (user_id, project_id);
  end if;
end $$;

alter table public.user_projects enable row level security;
