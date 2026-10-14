-- Prepare an isolated employee-test schema in the existing Supabase project.
-- This creates empty ace_debug tables from current public table definitions;
-- it does not copy production rows or change public tables. Review first.
-- After applying, add ace_debug to Supabase's exposed schemas. Keep all grants
-- limited to service_role; do not add browser-facing policies.

begin;

create schema if not exists ace_debug;
revoke all on schema ace_debug from public, anon, authenticated;
grant usage on schema ace_debug to service_role;
alter default privileges in schema ace_debug revoke all on tables from public, anon, authenticated;
alter default privileges in schema ace_debug grant select, insert, update, delete on tables to service_role;
alter default privileges in schema ace_debug revoke all on sequences from public, anon, authenticated;
alter default privileges in schema ace_debug grant usage, select on sequences to service_role;
alter default privileges in schema ace_debug revoke execute on functions from public, anon, authenticated;
alter default privileges in schema ace_debug grant execute on functions to service_role;

do $$
declare
  v_table text;
  v_fk record;
  v_definition text;
  v_tables text[] := array[
    'departments', 'profiles', 'projects', 'user_projects',
    'time_entries', 'work_schedules', 'user_schedule_assignments',
    'admin_remarks', 'employee_messages', 'profile_tutorial_progress',
    'audit_logs'
  ];
begin
  foreach v_table in array v_tables loop
    if to_regclass(format('public.%I', v_table)) is null then
      raise exception 'Required production table public.% is missing; no debug tables were prepared', v_table;
    end if;
    execute format(
      'create table if not exists ace_debug.%I (like public.%I including all)',
      v_table, v_table
    );
  end loop;

  -- LIKE intentionally does not copy foreign keys. Recreate the selected
  -- relationships inside ace_debug so test records can never reference or
  -- cascade into public application rows.
  for v_fk in
    select source.relname as table_name,
           constraint_row.conname as constraint_name,
           constraint_row.oid as constraint_oid,
           target_ns.nspname as target_schema,
           target.relname as target_table
    from pg_constraint constraint_row
    join pg_class source on source.oid = constraint_row.conrelid
    join pg_namespace source_ns on source_ns.oid = source.relnamespace
    join pg_class target on target.oid = constraint_row.confrelid
    join pg_namespace target_ns on target_ns.oid = target.relnamespace
    where constraint_row.contype = 'f'
      and source_ns.nspname = 'public'
      and source.relname = any(v_tables)
  loop
    if v_fk.target_schema <> 'public' or not (v_fk.target_table = any(v_tables)) then
      raise exception 'Foreign key %.% points outside the selected public application tables', v_fk.table_name, v_fk.constraint_name;
    end if;
    if not exists (
      select 1 from pg_constraint existing
      where existing.conrelid = format('ace_debug.%I', v_fk.table_name)::regclass
        and existing.conname = v_fk.constraint_name
    ) then
      v_definition := pg_get_constraintdef(v_fk.constraint_oid);
      -- pg_get_constraintdef may omit the `public` qualifier when that
      -- schema is on search_path. Qualify both forms so cloned constraints
      -- always point to the isolated ace_debug tables.
      v_definition := replace(
        v_definition,
        format('REFERENCES public.%I', v_fk.target_table),
        format('REFERENCES ace_debug.%I', v_fk.target_table)
      );
      v_definition := replace(
        v_definition,
        format('REFERENCES %I(', v_fk.target_table),
        format('REFERENCES ace_debug.%I(', v_fk.target_table)
      );
      if position(format('REFERENCES ace_debug.%I', v_fk.target_table) in v_definition) = 0 then
        raise exception 'Could not safely rewrite foreign key %.% to ace_debug.%', v_fk.table_name, v_fk.constraint_name, v_fk.target_table;
      end if;
      execute format('alter table ace_debug.%I add constraint %I %s', v_fk.table_name, v_fk.constraint_name, v_definition);
    end if;
  end loop;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'departments', 'profiles', 'projects', 'user_projects',
    'time_entries', 'work_schedules', 'user_schedule_assignments',
    'admin_remarks', 'employee_messages', 'profile_tutorial_progress',
    'audit_logs'
  ] loop
    execute format('alter table ace_debug.%I enable row level security', v_table);
  end loop;
end;
$$;

-- Auth remains shared for sign-in and token verification. Revocations and
-- application session profiles remain in the debug schema.
create table if not exists ace_debug.ace_revoked_sessions (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  revoked_at timestamptz not null default now()
);
alter table ace_debug.ace_revoked_sessions enable row level security;

-- Do not inherit public triggers. Debug triggers and RPCs write only to
-- ace_debug tables.
create or replace function ace_debug.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on ace_debug.profiles;
create trigger profiles_updated_at before update on ace_debug.profiles
for each row execute function ace_debug.set_updated_at();
drop trigger if exists admin_remarks_updated_at on ace_debug.admin_remarks;
create trigger admin_remarks_updated_at before update on ace_debug.admin_remarks
for each row execute function ace_debug.set_updated_at();
drop trigger if exists work_schedules_updated_at on ace_debug.work_schedules;
create trigger work_schedules_updated_at before update on ace_debug.work_schedules
for each row execute function ace_debug.set_updated_at();

create or replace function ace_debug.prevent_audit_log_changes()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'ace_debug.audit_logs are append-only';
end;
$$;
drop trigger if exists audit_logs_immutable on ace_debug.audit_logs;
create trigger audit_logs_immutable before update or delete on ace_debug.audit_logs
for each row execute function ace_debug.prevent_audit_log_changes();

create or replace function ace_debug.ace_session_profile(p_user_id uuid, p_session_id uuid)
returns ace_debug.profiles
language sql stable security definer set search_path = '' as $$
  select profile.*
  from ace_debug.profiles profile
  join auth.sessions session_row on session_row.user_id = profile.id and session_row.id = p_session_id
  join auth.users auth_user on auth_user.id = profile.id
  where profile.id = p_user_id
    and profile.permanently_deleted_at is null
    and (session_row.not_after is null or session_row.not_after > now())
    and (auth_user.banned_until is null or auth_user.banned_until < now())
    and not exists (
      select 1 from ace_debug.ace_revoked_sessions revoked
      where revoked.session_id = session_row.id
    );
$$;

create or replace function ace_debug.ace_end_session(p_user_id uuid, p_session_id uuid, p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from auth.sessions where id = p_session_id and user_id = p_user_id for update;
  if not found then return; end if;
  insert into ace_debug.ace_revoked_sessions(session_id) values (p_session_id) on conflict do nothing;
  if not found then return; end if;
  update ace_debug.profiles set last_logout_at = now() where id = p_user_id;
  insert into ace_debug.audit_logs(user_id, action, entity_type, entity_id, description, request_id)
  values (p_user_id, 'LOGOUT', 'PROFILE', p_user_id, 'Signed out of employee test workspace', p_request_id);
end;
$$;

create or replace function ace_debug.clock_in_entry_with_audit(
  p_actor_user_id uuid,
  p_project_id uuid,
  p_schedule_id uuid,
  p_schedule_type text,
  p_scheduled_start_time time,
  p_scheduled_end_time time,
  p_target_seconds integer,
  p_scheduled_weekdays smallint[],
  p_ip_address inet default null,
  p_user_agent text default null,
  p_request_id uuid default null
)
returns ace_debug.time_entries
language plpgsql security definer set search_path = '' as $$
declare
  v_entry ace_debug.time_entries;
  v_device text;
begin
  insert into ace_debug.time_entries (
    user_id, project_id, schedule_id, schedule_type, scheduled_start_time,
    scheduled_end_time, target_seconds, scheduled_weekdays
  ) values (
    p_actor_user_id, p_project_id, p_schedule_id, p_schedule_type,
    p_scheduled_start_time, p_scheduled_end_time, p_target_seconds,
    p_scheduled_weekdays
  ) returning * into v_entry;

  v_device := case when p_user_agent ~* 'Android|iPhone|iPad|iPod|Mobile|Windows Phone|IEMobile|Opera Mini' then 'mobile' else 'pc web' end;
  insert into ace_debug.audit_logs (user_id, action, entity_type, entity_id, description, ip_address, user_agent, request_id)
  values (
    p_actor_user_id,
    format('CLOCK_IN (%s)', v_device),
    'TIME_ENTRY', v_entry.id,
    format('Started a test time entry from %s', v_device),
    p_ip_address, p_user_agent, p_request_id
  );
  return v_entry;
end;
$$;

create or replace function ace_debug.clock_out_entry(
  p_actor_user_id uuid,
  p_entry_id uuid,
  p_actor_role text,
  p_final_note text,
  p_now timestamptz default now(),
  p_ip_address inet default null,
  p_user_agent text default null
)
returns ace_debug.time_entries
language plpgsql security definer set search_path = '' as $$
declare
  v_entry ace_debug.time_entries;
  v_device text;
begin
  update ace_debug.time_entries
  set clock_out_at = p_now,
      final_note = p_final_note,
      break_started_at = null,
      break_seconds = break_seconds + case
        when break_started_at is null then 0
        else greatest(0, floor(extract(epoch from (p_now - break_started_at)))::integer)
      end
  where id = p_entry_id
    and clock_out_at is null
    and (user_id = p_actor_user_id or p_actor_role = 'ADMIN')
  returning * into v_entry;

  if not found then
    if exists (select 1 from ace_debug.time_entries where id = p_entry_id and (user_id = p_actor_user_id or p_actor_role = 'ADMIN')) then
      raise exception 'ENTRY_ALREADY_CLOSED' using errcode = 'P0001';
    end if;
    raise exception 'NOT_FOUND_OR_FORBIDDEN' using errcode = 'P0001';
  end if;

  v_device := case when p_user_agent ~* 'Android|iPhone|iPad|iPod|Mobile|Windows Phone|IEMobile|Opera Mini' then 'mobile' else 'pc web' end;
  insert into ace_debug.audit_logs (user_id, action, entity_type, entity_id, description, ip_address, user_agent)
  values (p_actor_user_id, format('CLOCK_OUT (%s)', v_device), 'TIME_ENTRY', p_entry_id,
          format('Completed a test time entry from %s', v_device), p_ip_address, p_user_agent);
  return v_entry;
end;
$$;

create or replace function ace_debug.ace_backend_contract()
returns integer language sql stable security definer set search_path = '' as $$
  select 1;
$$;

-- The only role with schema access is the server-only key's Postgres role.
revoke all on all tables in schema ace_debug from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema ace_debug to service_role;
grant usage, select on all sequences in schema ace_debug to service_role;
revoke all on all functions in schema ace_debug from public, anon, authenticated;
grant execute on function ace_debug.ace_session_profile(uuid, uuid),
  ace_debug.ace_end_session(uuid, uuid, uuid),
  ace_debug.clock_in_entry_with_audit(uuid, uuid, uuid, text, time, time, integer, smallint[], inet, text, uuid),
  ace_debug.clock_out_entry(uuid, uuid, text, text, timestamptz, inet, text),
  ace_debug.ace_backend_contract()
  to service_role;

commit;

notify pgrst, 'reload schema';
