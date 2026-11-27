-- Isolated local fixtures only. Never run on hosted databases.
\set ON_ERROR_STOP on
begin;
insert into profiles(id,role,status,full_name,email) values ('00000000-0000-4000-8000-000000000701','ADMIN','ACTIVE','Admin','report-admin@example.test'),('00000000-0000-4000-8000-000000000702','CLIENT','ACTIVE','Viewer','report-view@example.test'),('00000000-0000-4000-8000-000000000704','USER','ACTIVE','Employee','report-employee@example.test');
insert into projects(id,name,start_date) values ('00000000-0000-4000-8000-000000000711','Visible reporting',(now() at time zone 'Asia/Manila')::date-5),('00000000-0000-4000-8000-000000000712','Private reporting',(now() at time zone 'Asia/Manila')::date-5);
select set_project_manager('00000000-0000-4000-8000-000000000701','00000000-0000-4000-8000-000000000711','00000000-0000-4000-8000-000000000702','VIEW');
do $$declare actor uuid:='00000000-0000-4000-8000-000000000702';employee uuid:='00000000-0000-4000-8000-000000000704';project uuid:='00000000-0000-4000-8000-000000000711';other uuid:='00000000-0000-4000-8000-000000000712';sid uuid;r jsonb;d date:=(now() at time zone 'Asia/Manila')::date;begin
 update shift_planning_settings set grace_minutes=15 where id;
 insert into planned_shifts(project_id,employee_id,start_at,end_at,status,created_by) values(project,employee,now()-interval '2 hours',now()-interval '1 hour','PUBLISHED','00000000-0000-4000-8000-000000000701') returning id into sid;
 insert into time_entries(id,user_id,project_id,planned_shift_id,clock_in_at,clock_out_at) values(gen_random_uuid(),employee,project,sid,now()-interval '100 minutes',now()-interval '50 minutes');
 insert into planned_shifts(project_id,employee_id,start_at,end_at,status,created_by) values(project,employee,now()-interval '4 hours',now()-interval '3 hours','PUBLISHED','00000000-0000-4000-8000-000000000701'),(project,employee,now()+interval '1 hour',now()+interval '2 hours','PUBLISHED','00000000-0000-4000-8000-000000000701'),(project,employee,now()+interval '3 hours',now()+interval '4 hours','DRAFT','00000000-0000-4000-8000-000000000701'),(project,employee,now()+interval '5 hours',now()+interval '6 hours','CANCELLED','00000000-0000-4000-8000-000000000701'),(other,employee,now()-interval '4 hours',now()-interval '3 hours','PUBLISHED','00000000-0000-4000-8000-000000000701');
 insert into time_entries(id,user_id,project_id,clock_in_at,clock_out_at) values(gen_random_uuid(),employee,project,now()-interval '1 day',now()-interval '23 hours');
 r:=client_attendance_v3(actor,null,d-2,d+2);
 if (r->>'total')::int<>4 or (r->>'worked_seconds')::int<>6600 or (r->>'late')::int<>1 or (r->>'absences')::int<>1 then raise exception 'Incorrect reporting totals: %',r;end if;
 if exists(select 1 from jsonb_array_elements(r->'items')e where e->>'project_name'='Private reporting') then raise exception 'Private project leaked';end if;
 r:=client_attendance_v3(actor,null,d-2,d+2,null,1,25,null,'shifts','LATE');
 if (r->>'total')::int<>1 or (r->'items'->0->>'arrival_difference_minutes')::int<>20 or (r->'items'->0->>'difference_minutes')::int<>-10 then raise exception 'Late/difference calculation wrong: %',r;end if;
 r:=client_attendance_v3(actor,null,d-2,d+2,null,1,25,null,'employees');
 if (r->'items'->0->>'late')::int<>1 or (r->'items'->0->>'absences')::int<>1 or (r->'items'->0->>'planned_seconds')::int<>10800 then raise exception 'Employee totals wrong: %',r;end if;
 r:=client_attendance_v3(actor,null,d-2,d+2,null,1,25,null,'shifts','NO_SHOW');
 if (r->>'total')::int<>1 or r->'items'->0->>'clock_in_at' is not null or (r->>'active')::int<>0 then raise exception 'Missing clock-in counted active';end if;
 begin perform client_attendance_v3(actor,array[other],d-2,d+2);raise exception 'Forged project accepted';exception when raise_exception then if sqlerrm<>'PROJECT_ACCESS_DENIED' then raise;end if;end;
 -- Exact grace boundary is on time, and an overnight completion belongs to today's live summary.
 insert into planned_shifts(project_id,employee_id,start_at,end_at,status,created_by) values(project,employee,now()-interval '8 hours',now()-interval '7 hours','PUBLISHED','00000000-0000-4000-8000-000000000701') returning id into sid;
 insert into time_entries(id,user_id,project_id,planned_shift_id,clock_in_at,clock_out_at) values(gen_random_uuid(),employee,project,sid,now()-interval '8 hours'+interval '15 minutes',now()-interval '7 hours');
 r:=client_attendance_v3(actor,null,d-2,d+2,null,1,25,null,'shifts','ON_TIME');
 if (r->>'total')::int<>1 then raise exception 'Grace boundary should be on time: %',r;end if;
 insert into time_entries(id,user_id,project_id,clock_in_at,clock_out_at) values(gen_random_uuid(),employee,project,(d-1)::timestamp at time zone 'Asia/Manila',d::timestamp at time zone 'Asia/Manila'+interval '1 minute');
 r:=client_attendance_v3(actor,null,d,d,'ACTIVE');
 if not exists(select 1 from jsonb_array_elements(r->'items')e where (e->>'clock_in_at')::timestamptz=(d-1)::timestamp at time zone 'Asia/Manila') then raise exception 'Overnight completion missing';end if;
 update client_project_access set revoked_at=now() where user_id=actor;
 begin perform client_attendance_v3(actor,null,d-2,d+2);raise exception 'Revocation ignored';exception when raise_exception then if sqlerrm<>'CLIENT_ACCESS_REQUIRED' then raise;end if;end;
end $$;
rollback;
