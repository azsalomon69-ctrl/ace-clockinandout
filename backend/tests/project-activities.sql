\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create role service_role;
create table public.projects(id uuid primary key,name text,is_active boolean default true);
create table public.user_projects(user_id uuid,project_id uuid);
create table public.time_entries(id uuid primary key,user_id uuid,project_id uuid,clock_in_at timestamptz,
clock_out_at timestamptz,deleted_at timestamptz,final_note text);
create table public.audit_logs(user_id uuid,action text,entity_type text,entity_id uuid,description text,ip_address inet,user_agent text);
create table public.queued_clock_actions(user_id uuid,payload jsonb,tapped_at timestamptz,received_at timestamptz default now());
create or replace function public.clock_out_entry(
  p_actor_user_id uuid,
  p_entry_id uuid,
  p_actor_role text,
  p_final_note text,
  p_now timestamptz default now(),
  p_ip_address inet default null,
  p_user_agent text default null
)
returns public.time_entries
language plpgsql
security definer
set search_path = public
as $$
declare v_entry public.time_entries;
begin
  update public.time_entries
  set clock_out_at = p_now,
      final_note = p_final_note
  where id = p_entry_id and clock_out_at is null
    and (user_id = p_actor_user_id or p_actor_role = 'ADMIN')
  returning * into v_entry;

  if not found then
    if exists (select 1 from public.time_entries where id = p_entry_id and (user_id = p_actor_user_id or p_actor_role = 'ADMIN')) then
      raise exception 'ENTRY_ALREADY_CLOSED' using errcode = 'P0001';
    end if;
    raise exception 'NOT_FOUND_OR_FORBIDDEN' using errcode = 'P0001';
  end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, ip_address, user_agent)
  values (p_actor_user_id, format('CLOCK_OUT (%s)', case when p_user_agent ~* 'Android|iPhone|iPad|iPod|Mobile|Windows Phone|IEMobile|Opera Mini' then 'mobile' else 'pc web' end), 'TIME_ENTRY', p_entry_id, format('Completed a time entry from %s', case when p_user_agent ~* 'Android|iPhone|iPad|iPod|Mobile|Windows Phone|IEMobile|Opera Mini' then 'mobile' else 'pc web' end), p_ip_address, p_user_agent);
  return v_entry;
end;
$$;


\i supabase/migrations/0038_project_activities.sql
\i supabase/migrations/0039_optional_activity_project.sql
\i supabase/migrations/0040_activity_elapsed_time.sql
insert into projects values('00000000-0000-4000-8000-000000000001','Support',true),('00000000-0000-4000-8000-000000000002','Operations',true);
insert into user_projects values('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001'),
('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002');
insert into time_entries(id,user_id,clock_in_at) values('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000003','2026-11-24T00:00Z');
select record_project_activity('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','First task','00000000-0000-4000-8000-000000000005','2026-11-24T03:00Z');
-- A retry is idempotent, even when its HTTP response was lost.
select record_project_activity('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','First task','00000000-0000-4000-8000-000000000005','2026-11-24T03:01Z');
select record_project_activity('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000002','Second task','00000000-0000-4000-8000-000000000006','2026-11-24T05:00Z');
select clock_out_project_entry('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','USER','00000000-0000-4000-8000-000000000001','Last task','2026-11-24T09:00Z');
do $$
declare e time_entries; total bigint;
begin
select * into e from time_entries limit 1;
select sum((a->>'duration_seconds')::bigint) into total from jsonb_array_elements(e.activities) a;
if total<>32400 or jsonb_array_length(e.activities)<>3 or (e.activities->0->>'duration_seconds')::int<>10800 or (e.activities->1->>'duration_seconds')::int<>7200 then raise exception 'Incorrect 9-hour allocation'; end if;
begin
 perform record_project_activity('00000000-0000-4000-8000-000000000099',e.id,'00000000-0000-4000-8000-000000000001','Unauthorized',gen_random_uuid());
 raise exception 'Unauthorized activity accepted';
exception when others then if sqlerrm <> 'ENTRY_NOT_FOUND' then raise; end if; end;
begin
 update time_entries set clock_in_at=clock_in_at-interval '1 hour' where id=e.id;
 raise exception 'Correction damaged activities';
exception when others then if sqlerrm not like 'ACTIVITY_TIME_CONFLICT%' then raise; end if; end;
end $$;
-- A queued close must save its final project within the same shift update.
insert into time_entries(id,user_id,clock_in_at) values('00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000003','2026-11-24T00:00Z');
insert into queued_clock_actions(user_id,tapped_at,payload) values('00000000-0000-4000-8000-000000000003','2026-11-24T09:00Z','{"type":"clock_out","activityProjectId":"00000000-0000-4000-8000-000000000002"}');
update time_entries set clock_out_at='2026-11-24T09:00Z',final_note='Queued final task' where id='00000000-0000-4000-8000-000000000007';
do $$
begin
if not exists(select 1 from time_entries where id='00000000-0000-4000-8000-000000000007' and activities->0->>'project_name'='Operations') then raise exception 'Queued final project lost'; end if;
end $$;
select 'Project activity transaction checks passed' as result;

insert into time_entries(id,user_id,clock_in_at) values('00000000-0000-4000-8000-000000000088','00000000-0000-4000-8000-000000000089','2026-11-24T00:00Z');
select record_project_activity('00000000-0000-4000-8000-000000000089','00000000-0000-4000-8000-000000000088',null,'General admin work','00000000-0000-4000-8000-000000000090','2026-11-24T03:00Z');
select clock_out_project_entry('00000000-0000-4000-8000-000000000089','00000000-0000-4000-8000-000000000088','USER',null,'Finished','2026-11-24T09:00Z');
do $$
begin
if not exists(select 1 from time_entries where id='00000000-0000-4000-8000-000000000088' and activities->0->>'project_name'='No project' and jsonb_array_length(activities)=2 and (activities->0->>'duration_seconds')::int=10800 and (activities->1->>'duration_seconds')::int=21600) then raise exception 'Unassigned activity or final block failed'; end if;
end $$;
