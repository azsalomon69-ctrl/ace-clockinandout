-- Isolated local fixtures only. Never run on hosted databases.
\set ON_ERROR_STOP on
begin;
insert into profiles(id,role,status,full_name,email) values('00000000-0000-4000-8000-000000001001','ADMIN','ACTIVE','Admin','link-admin@example.test'),('00000000-0000-4000-8000-000000001002','USER','ACTIVE','Employee A','link-a@example.test'),('00000000-0000-4000-8000-000000001003','USER','ACTIVE','Employee B','link-b@example.test'),('00000000-0000-4000-8000-000000001004','CLIENT','ACTIVE','Client','link-client@example.test');
insert into projects(id,name,start_date) values('00000000-0000-4000-8000-000000001011','Link project',(now() at time zone 'Asia/Manila')::date-1),('00000000-0000-4000-8000-000000001012','Other project',(now() at time zone 'Asia/Manila')::date-1);
select change_project_memberships('00000000-0000-4000-8000-000000001001','00000000-0000-4000-8000-000000001011','[{"employeeId":"00000000-0000-4000-8000-000000001002"},{"employeeId":"00000000-0000-4000-8000-000000001003"}]');
do $$declare admin uuid:='00000000-0000-4000-8000-000000001001';a uuid:='00000000-0000-4000-8000-000000001002';b uuid:='00000000-0000-4000-8000-000000001003';project uuid:='00000000-0000-4000-8000-000000001011';t timestamptz:=(((now() at time zone 'Asia/Manila')::date+1)::timestamp at time zone 'Asia/Manila')+interval '8 hours';r jsonb;one uuid;two uuid;foreign_plan uuid;bad_plan uuid;entry uuid:=gen_random_uuid();foreign_entry uuid:=gen_random_uuid();other_entry uuid:=gen_random_uuid();ids uuid[];begin
 update shift_planning_settings set grace_minutes=15 where id;
 r:=save_planned_shifts(admin,project,jsonb_build_array(jsonb_build_object('employeeId',a,'startAt',t,'endAt',t+interval '8 hours'),jsonb_build_object('employeeId',a,'startAt',t+interval '2 days','endAt',t+interval '2 days 8 hours'),jsonb_build_object('employeeId',b,'startAt',t+interval '4 days','endAt',t+interval '4 days 8 hours'),jsonb_build_object('employeeId',b,'startAt',t+interval '6 days','endAt',t+interval '6 days 8 hours')));
 one:=(r->'ids'->>0)::uuid;two:=(r->'ids'->>1)::uuid;foreign_plan:=(r->'ids'->>2)::uuid;bad_plan:=(r->'ids'->>3)::uuid;select array_agg(value::uuid) into ids from jsonb_array_elements_text(r->'ids');perform change_planned_shift_status(admin,project,ids,true);
 insert into time_entries(id,user_id,project_id,clock_in_at) values(entry,a,project,t+interval '20 minutes');
 if (select planned_shift_id from time_entries where id=entry) is distinct from one or (select status from planned_shifts where id=one)<>'IN_PROGRESS' then raise exception 'Clock-in did not link';end if;
 update time_entries set clock_out_at=t+interval '8 hours' where id=entry;
 r:=attendance_plan_details(a,array[entry]);if r->entry::text->>'attendance_status'<>'LATE' or (r->entry::text->>'difference_minutes')::int<>-20 or (select status from planned_shifts where id=one)<>'COMPLETED' then raise exception 'Clock-out comparison wrong: %',r;end if;
 -- This fixture has no recorded activities; retain the existing activity correction guard.
 update time_entries set activities='[]'::jsonb where id=entry;
 update time_entries set clock_in_at=t+interval '2 days 5 minutes',clock_out_at=t+interval '2 days 8 hours' where id=entry;
 if (select planned_shift_id from time_entries where id=entry) is distinct from two or (select status from planned_shifts where id=one)<>'PUBLISHED' or (select status from planned_shifts where id=two)<>'COMPLETED' then raise exception 'Correction did not relink';end if;
 update time_entries set deleted_at=now() where id=entry;
 if (select planned_shift_id from time_entries where id=entry) is not null or (select status from planned_shifts where id=two)<>'PUBLISHED' then raise exception 'Removal left stale plan';end if;
 update time_entries set deleted_at=null where id=entry;
 if (select planned_shift_id from time_entries where id=entry) is distinct from two or (select status from planned_shifts where id=two)<>'COMPLETED' then raise exception 'Restore did not relink';end if;
 delete from time_entries where id=entry;if (select status from planned_shifts where id=two)<>'PUBLISHED' then raise exception 'Physical removal left stale plan';end if;
 insert into time_entries(id,user_id,project_id,clock_in_at,clock_out_at) values(entry,a,'00000000-0000-4000-8000-000000001012',t,t+interval '8 hours');if (select planned_shift_id from time_entries where id=entry) is not null then raise exception 'Cross-project shift linked';end if;
 insert into time_entries(id,user_id,project_id,clock_in_at) values(foreign_entry,b,project,t+interval '4 days');
 if attendance_plan_details(a,array[foreign_entry])<>'{}'::jsonb or attendance_plan_details(admin,array[foreign_entry])='{}'::jsonb then raise exception 'Comparison ownership wrong';end if;
 begin perform attendance_plan_details('00000000-0000-4000-8000-000000001004',array[entry]);raise exception 'Client read raw comparison';exception when raise_exception then if sqlerrm<>'ATTENDANCE_ACCESS_REQUIRED' then raise;end if;end;
 -- Simulate a pre-existing corrupt link: repairing it must never prevent clock-out.
 alter table time_entries disable trigger zz_link_planned_attendance;
 insert into time_entries(id,user_id,project_id,planned_shift_id,clock_in_at) values(other_entry,a,project,bad_plan,t+interval '6 days');
 alter table time_entries enable trigger zz_link_planned_attendance;
 update time_entries set clock_out_at=t+interval '6 days 8 hours' where id=other_entry;
 if (select planned_shift_id from time_entries where id=other_entry) is not null or (select clock_out_at from time_entries where id=other_entry) is null then raise exception 'Bad historical link blocked clock-out';end if;
end $$;
rollback;
