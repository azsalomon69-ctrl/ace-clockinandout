-- Run this file in Supabase SQL Editor before starting the API.
create extension if not exists pgcrypto;

create type public.user_role as enum ('ADMIN', 'USER');
create type public.user_status as enum ('PENDING', 'ACTIVE', 'DENIED');
create type public.invitation_status as enum ('PENDING', 'ACCEPTED', 'EXPIRED', 'CANCELLED');
create type public.report_type as enum ('DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM', 'TEAM_PERFORMANCE');
create type public.export_file_type as enum ('CSV', 'XLSX', 'PDF');

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  profile_picture_url text,
  role public.user_role not null default 'USER',
  status public.user_status not null default 'PENDING',
  department_id uuid references public.departments(id) on delete set null,
  last_login_at timestamptz,
  last_logout_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.user_projects (
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (user_id, project_id)
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  invited_by_user_id uuid not null references public.profiles(id),
  email text not null,
  role public.user_role not null default 'USER',
  department_id uuid references public.departments(id) on delete set null,
  status public.invitation_status not null default 'PENDING',
  invited_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  unique (email, status)
);

create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  profile_id uuid references public.profiles(id) on delete cascade,
  full_name text not null,
  requested_department text,
  message text,
  requested_role public.user_role not null default 'USER',
  status public.user_status not null default 'PENDING',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 minutes',
  request_ip inet,
  reviewed_at timestamptz,
  reviewed_by_user_id uuid references public.profiles(id)
);

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  project_id uuid references public.projects(id) on delete set null,
  clock_in_at timestamptz not null default now(),
  clock_out_at timestamptz,
  user_note text,
  duration_seconds integer generated always as (
    case when clock_out_at is null then null
    else greatest(0, extract(epoch from (clock_out_at - clock_in_at))::integer) end
  ) stored,
  deleted_at timestamptz,
  deleted_by_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint clock_out_after_clock_in check (clock_out_at is null or clock_out_at >= clock_in_at)
);
create unique index one_open_entry_per_user on public.time_entries(user_id) where clock_out_at is null;
create index time_entries_user_clock_in_idx on public.time_entries(user_id, clock_in_at desc);

create table public.admin_remarks (
  id uuid primary key default gen_random_uuid(),
  time_entry_id uuid not null references public.time_entries(id) on delete cascade,
  admin_user_id uuid not null references public.profiles(id),
  remark text not null check (char_length(trim(remark)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  created_by_user_id uuid not null references public.profiles(id),
  report_type public.report_type not null,
  date_from date not null,
  date_to date not null,
  filters jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  total_records integer not null default 0,
  constraint report_date_range_valid check (date_to >= date_from)
);

create table public.report_exports (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  exported_by_user_id uuid not null references public.profiles(id),
  file_name text not null,
  file_type public.export_file_type not null,
  file_url text,
  exported_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  description text,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger admin_remarks_updated_at before update on public.admin_remarks for each row execute function public.set_updated_at();

-- Profiles are created automatically after Google/email sign-up.
create or replace function public.create_profile_for_auth_user() returns trigger language plpgsql security definer set search_path = public as $$
declare
  invitation_id uuid;
  invitation_role public.user_role;
  invitation_department_id uuid;
begin
  select id, role, department_id into invitation_id, invitation_role, invitation_department_id from public.invitations
  where lower(email) = lower(new.email) and status = 'PENDING' and expires_at > now()
  order by invited_at desc limit 1;
  insert into public.profiles (id, email, full_name, profile_picture_url, role, status, department_id)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), new.raw_user_meta_data->>'avatar_url', coalesce(invitation_role, 'USER'::public.user_role), case when invitation_id is null then 'PENDING'::public.user_status else 'ACTIVE'::public.user_status end, invitation_department_id)
  on conflict (id) do nothing;
  if invitation_id is not null then
    update public.invitations set status = 'ACCEPTED', accepted_at = now() where id = invitation_id;
  end if;
  return new;
end;
$$;
create trigger auth_user_profile after insert on auth.users for each row execute function public.create_profile_for_auth_user();

-- Audit logs are append-only at the database level.
create or replace function public.prevent_audit_log_changes() returns trigger language plpgsql as $$
begin raise exception 'audit_logs are append-only'; end;
$$;
create trigger audit_logs_immutable before update or delete on public.audit_logs for each row execute function public.prevent_audit_log_changes();

alter table public.departments enable row level security;
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.user_projects enable row level security;
alter table public.invitations enable row level security;
alter table public.access_requests enable row level security;
alter table public.time_entries enable row level security;
alter table public.admin_remarks enable row level security;
alter table public.reports enable row level security;
alter table public.report_exports enable row level security;
alter table public.audit_logs enable row level security;

-- The Express API uses the server-only Supabase secret key. These policies allow
-- authenticated users to read their own profile and own time entries if direct
-- browser reads are introduced later.
create policy "read own profile" on public.profiles for select to authenticated using (id = auth.uid());
create policy "read own entries" on public.time_entries for select to authenticated using (user_id = auth.uid());
create policy "create own entries" on public.time_entries for insert to authenticated with check (user_id = auth.uid());
create policy "update own open entries" on public.time_entries for update to authenticated using (user_id = auth.uid() and clock_out_at is null);
