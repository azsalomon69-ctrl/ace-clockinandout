-- Akio <3: Database script maintained by Akio Zaki Salomon.
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
  profile_picture_public_id text,
  role public.user_role not null default 'USER',
  status public.user_status not null default 'PENDING',
  department_id uuid references public.departments(id) on delete set null,
  last_login_at timestamptz,
  last_logout_at timestamptz,
  last_seen_at timestamptz,
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
  accepted_at timestamptz
);
-- An email may have historical accepted invitations, but only one active
-- invitation may be pending at a time. This permits reinviting someone whose
-- previous Google login was permanently removed.
create unique index invitations_one_pending_email_idx
  on public.invitations(email)
  where status = 'PENDING';

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
  expires_at timestamptz not null default now() + interval '24 hours',
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
  planned_end_at timestamptz,
  user_note text,
  final_note text,
  stopped_by_user_id uuid references public.profiles(id) on delete set null,
  stopped_by_at timestamptz,
  overtime_approved_seconds integer not null default 0 check (overtime_approved_seconds >= 0),
  overtime_approved_by_user_id uuid references public.profiles(id) on delete set null,
  overtime_approved_at timestamptz,
  duration_seconds integer generated always as (
    case when clock_out_at is null then null
    else greatest(0, extract(epoch from (clock_out_at - clock_in_at))::integer) end
  ) stored,
  deleted_at timestamptz,
  deleted_by_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint clock_out_after_clock_in check (clock_out_at is null or clock_out_at >= clock_in_at),
  constraint time_entries_user_note_length check (user_note is null or char_length(user_note) <= 50),
  constraint time_entries_final_note_length check (final_note is null or char_length(final_note) <= 50)
);
create unique index one_open_entry_per_user on public.time_entries(user_id) where clock_out_at is null;
create index time_entries_user_clock_in_idx on public.time_entries(user_id, clock_in_at desc);

create table public.work_schedules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  schedule_type text not null check (schedule_type in ('FIXED', 'FLEX')),
  start_time time,
  end_time time,
  daily_elapsed_minutes integer not null default 540 check (daily_elapsed_minutes between 60 and 1440),
  is_active boolean not null default true,
  created_by_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fixed_schedule_times check (schedule_type = 'FLEX' or (start_time is not null and end_time is not null))
);

create table public.user_schedule_assignments (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  schedule_id uuid not null references public.work_schedules(id) on delete cascade,
  assigned_by_user_id uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now()
);

create table public.admin_remarks (
  id uuid primary key default gen_random_uuid(),
  time_entry_id uuid not null references public.time_entries(id) on delete cascade,
  admin_user_id uuid not null references public.profiles(id),
  remark text not null check (char_length(trim(remark)) > 0),
  seen_at timestamptz,
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
  request_id uuid,
  created_at timestamptz not null default now()
);

create index audit_logs_request_id_idx on public.audit_logs(request_id) where request_id is not null;

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger admin_remarks_updated_at before update on public.admin_remarks for each row execute function public.set_updated_at();
create trigger work_schedules_updated_at before update on public.work_schedules for each row execute function public.set_updated_at();

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

-- Keep access-request creation/review audit evidence atomic with the change.
-- Production upgrades use migrations/0013_access_request_atomic_audit.sql.
create or replace function public.audit_access_request_change() returns trigger language plpgsql security definer set search_path = public as $$
declare v_action text; v_actor uuid; v_description text;
begin
  if tg_op = 'INSERT' then v_action := 'REQUEST_ACCESS'; v_actor := new.profile_id; v_description := 'Requested account approval';
  elsif new.status is distinct from old.status then
    v_action := case new.status when 'ACTIVE' then 'APPROVE_ACCESS_REQUEST' when 'DENIED' then 'DENY_ACCESS_REQUEST' else 'UPDATE_ACCESS_REQUEST' end;
    v_actor := coalesce(new.reviewed_by_user_id, new.profile_id);
    v_description := case new.status when 'ACTIVE' then format('Approved %s', new.email) when 'DENIED' then format('Denied %s', new.email) else format('Updated access request for %s', new.email) end;
  elsif new.expires_at is distinct from old.expires_at and old.status = 'PENDING' and old.expires_at <= now() and new.expires_at > now() then
    v_action := 'REQUEST_ACCESS'; v_actor := new.profile_id; v_description := 'Requested account approval again after expiry';
  else return new; end if;
  insert into public.audit_logs (user_id, action, entity_type, entity_id, description) values (v_actor, v_action, 'ACCESS_REQUEST', new.id, v_description);
  return new;
end; $$;
create trigger access_requests_audit after insert or update on public.access_requests for each row execute function public.audit_access_request_change();

create or replace function public.serialize_pending_access_request() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'PENDING' then return new; end if;
  perform pg_advisory_xact_lock(hashtext(new.profile_id::text));
  if exists (select 1 from public.access_requests where profile_id = new.profile_id and id is distinct from new.id and status = 'PENDING' and expires_at > now()) then
    raise exception 'ACCESS_REQUEST_ALREADY_PENDING' using errcode = '23505';
  end if;
  return new;
end; $$;
create trigger access_requests_one_pending before insert or update of profile_id, status, expires_at on public.access_requests for each row execute function public.serialize_pending_access_request();

create or replace function public.review_access_request(p_request_id uuid, p_actor_user_id uuid, p_decision text, p_role public.user_role, p_department_id uuid default null)
returns public.access_requests language plpgsql security definer set search_path = public as $$
declare v_request public.access_requests; v_status public.user_status;
begin
  select * into v_request from public.access_requests where id = p_request_id for update;
  if not found then raise exception 'ACCESS_REQUEST_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_request.status <> 'PENDING' then raise exception 'ACCESS_REQUEST_ALREADY_REVIEWED' using errcode = 'P0001'; end if;
  if v_request.expires_at <= now() then raise exception 'ACCESS_REQUEST_EXPIRED' using errcode = 'P0001'; end if;
  if v_request.profile_id is null then raise exception 'ACCESS_REQUEST_LEGACY_PROFILE' using errcode = 'P0001'; end if;
  if p_decision not in ('APPROVE', 'DENY') then raise exception 'ACCESS_REQUEST_INVALID_DECISION' using errcode = 'P0001'; end if;
  v_status := case when p_decision = 'APPROVE' then 'ACTIVE'::public.user_status else 'DENIED'::public.user_status end;
  if p_decision = 'APPROVE' then update public.profiles set status = v_status, role = p_role, department_id = p_department_id where id = v_request.profile_id;
  else update public.profiles set status = v_status where id = v_request.profile_id; end if;
  update public.access_requests set status = v_status, reviewed_at = now(), reviewed_by_user_id = p_actor_user_id where id = v_request.id returning * into v_request;
  return v_request;
end; $$;
revoke all on function public.review_access_request(uuid, uuid, text, public.user_role, uuid) from public, anon, authenticated;
grant execute on function public.review_access_request(uuid, uuid, text, public.user_role, uuid) to service_role;

alter table public.departments enable row level security;
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.user_projects enable row level security;
alter table public.invitations enable row level security;
alter table public.access_requests enable row level security;
alter table public.time_entries enable row level security;
alter table public.admin_remarks enable row level security;
alter table public.work_schedules enable row level security;
alter table public.user_schedule_assignments enable row level security;
alter table public.reports enable row level security;
alter table public.report_exports enable row level security;
alter table public.audit_logs enable row level security;

-- The Express API uses the server-only Supabase secret key. Authenticated users
-- may read their own profile and time entries, but all writes go through the API.
create policy "read own profile" on public.profiles for select to authenticated using (id = auth.uid());
create policy "read own entries" on public.time_entries for select to authenticated using (user_id = auth.uid());
