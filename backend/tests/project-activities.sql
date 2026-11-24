\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create role service_role;
create table public.projects(id uuid primary key,name text,is_active boolean default true);
create table public.user_projects(user_id uuid,project_id uuid);
create table public.time_entries(id uuid primary key,user_id uuid,project_id uuid,clock_in_at timestamptz,
clock_out_at timestamptz,deleted_at timestamptz,final_note text,break_started_at timestamptz,break_seconds integer default 0);
create table public.audit_logs(user_id uuid,action text,entity_type text,entity_id uuid,description text,ip_address inet,user_agent text);
create table public.queued_clock_actions(user_id uuid,payload jsonb,tapped_at timestamptz,received_at timestamptz default now());
\i supabase/migrations/0002_clock_out_rpc.sql
\i supabase/migrations/0038_project_activities.sql
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
