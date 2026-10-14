-- Seed ace_debug with synthetic records only. Replace the email below with
-- the head administrator's existing Supabase Auth email, then run this after
-- debug-workspace.sql. The script reads that one Auth row but does not modify
-- auth.users or any public application row.

begin;

do $$
declare
  v_head_admin_email text := lower('REPLACE_WITH_HEAD_ADMIN_EMAIL');
  v_head_admin_id uuid;
  v_department_id uuid;
  v_project_id uuid;
  v_schedule_id uuid;
  v_test_admin_id uuid := '10000000-0000-4000-8000-000000000001';
begin
  select id into v_head_admin_id
  from auth.users
  where lower(email) = v_head_admin_email
  order by created_at desc
  limit 1;

  if v_head_admin_email = 'replace_with_head_admin_email' or v_head_admin_id is null then
    raise exception 'Replace the head-admin email placeholder with an existing Supabase Auth email';
  end if;

  insert into ace_debug.departments (name, description)
  values ('ACE Debug Department', 'Synthetic data for the isolated employee test workspace')
  on conflict (name) do update set description = excluded.description
  returning id into v_department_id;

  insert into ace_debug.projects (name, description, is_active)
  values ('Debug Sample Project', 'Synthetic project for testing employee workflows', true)
  on conflict (name) do update set description = excluded.description, is_active = true
  returning id into v_project_id;

  insert into ace_debug.profiles (id, email, full_name, role, status, department_id)
  values (v_test_admin_id, 'debug-admin@ace.invalid', 'Debug Test Administrator', 'ADMIN'::public.user_role, 'ACTIVE'::public.user_status, v_department_id)
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    role = excluded.role,
    status = excluded.status,
    department_id = excluded.department_id;

  -- The real administrator's Auth identity is mapped to an employee profile
  -- only in ace_debug. The public profile and role are not modified.
  insert into ace_debug.profiles (id, email, full_name, role, status, department_id)
  select v_head_admin_id, auth_user.email, 'Debug Employee', 'USER'::public.user_role, 'ACTIVE'::public.user_status, v_department_id
  from auth.users auth_user
  where auth_user.id = v_head_admin_id
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    role = excluded.role,
    status = excluded.status,
    department_id = excluded.department_id,
    permanently_deleted_at = null;

  select id into v_schedule_id
  from ace_debug.work_schedules
  where name = 'Debug Flexible Schedule'
  order by created_at
  limit 1;

  if v_schedule_id is null then
    insert into ace_debug.work_schedules (
      name, schedule_type, daily_elapsed_minutes, scheduled_weekdays,
      is_active, created_by_user_id
    ) values (
      'Debug Flexible Schedule', 'FLEX', 540, array[1, 2, 3, 4, 5]::smallint[],
      true, v_test_admin_id
    ) returning id into v_schedule_id;
  else
    update ace_debug.work_schedules
    set schedule_type = 'FLEX', start_time = null, end_time = null,
        daily_elapsed_minutes = 540, scheduled_weekdays = array[1, 2, 3, 4, 5]::smallint[],
        is_active = true, created_by_user_id = v_test_admin_id
    where id = v_schedule_id;
  end if;

  insert into ace_debug.user_projects (user_id, project_id)
  values (v_head_admin_id, v_project_id)
  on conflict (user_id, project_id) do nothing;

  insert into ace_debug.user_schedule_assignments (user_id, schedule_id, assigned_by_user_id)
  values (v_head_admin_id, v_schedule_id, v_test_admin_id)
  on conflict (user_id) do update set schedule_id = excluded.schedule_id, assigned_by_user_id = excluded.assigned_by_user_id;

  insert into ace_debug.profile_tutorial_progress (profile_id, role)
  values (v_head_admin_id, 'USER')
  on conflict (profile_id, role) do nothing;

  -- One completed synthetic shift gives the employee dashboard history while
  -- leaving the employee free to test clock-in immediately.
  if not exists (
    select 1 from ace_debug.time_entries
    where user_id = v_head_admin_id and project_id = v_project_id
      and user_note = 'Synthetic sample' and final_note = 'Synthetic sample'
  ) then
    insert into ace_debug.time_entries (
      user_id, project_id, clock_in_at, clock_out_at, user_note, final_note,
      schedule_id, schedule_type, scheduled_start_time, scheduled_end_time,
      target_seconds, scheduled_weekdays
    ) values (
      v_head_admin_id, v_project_id,
      date_trunc('day', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila' - interval '1 day' + interval '9 hours',
      date_trunc('day', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila' - interval '1 day' + interval '17 hours',
      'Synthetic sample', 'Synthetic sample', v_schedule_id, 'FLEX', null, null,
      32400, array[1, 2, 3, 4, 5]::smallint[]
    );
  end if;
end;
$$;

commit;
