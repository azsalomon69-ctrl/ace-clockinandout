-- Isolated local fixtures only. Never run on hosted databases.
\set ON_ERROR_STOP on
begin;
insert into profiles(id,role,status,full_name,email) values('00000000-0000-4000-8000-000000000901','ADMIN','ACTIVE','Admin','notice-admin@example.test'),('00000000-0000-4000-8000-000000000902','USER','ACTIVE','Employee A','notice-a@example.test'),('00000000-0000-4000-8000-000000000903','USER','ACTIVE','Employee B','notice-b@example.test'),('00000000-0000-4000-8000-000000000904','CLIENT','ACTIVE','Planner','notice-plan@example.test'),('00000000-0000-4000-8000-000000000905','CLIENT','ACTIVE','Viewer','notice-view@example.test');
insert into projects(id,name,start_date) values('00000000-0000-4000-8000-000000000911','Notification campaign',(now() at time zone 'Asia/Manila')::date-1);
select change_project_memberships('00000000-0000-4000-8000-000000000901','00000000-0000-4000-8000-000000000911','[{"employeeId":"00000000-0000-4000-8000-000000000902"},{"employeeId":"00000000-0000-4000-8000-000000000903"}]');
select set_project_manager('00000000-0000-4000-8000-000000000901','00000000-0000-4000-8000-000000000911','00000000-0000-4000-8000-000000000904','VIEW_PLAN');
select set_project_manager('00000000-0000-4000-8000-000000000901','00000000-0000-4000-8000-000000000911','00000000-0000-4000-8000-000000000905','VIEW');
do $$declare admin uuid:='00000000-0000-4000-8000-000000000901';a uuid:='00000000-0000-4000-8000-000000000902';b uuid:='00000000-0000-4000-8000-000000000903';manager uuid:='00000000-0000-4000-8000-000000000904';viewer uuid:='00000000-0000-4000-8000-000000000905';project uuid:='00000000-0000-4000-8000-000000000911';t timestamptz:=(((now() at time zone 'Asia/Manila')::date+2)::timestamp at time zone 'Asia/Manila')+interval '8 hours';r jsonb;sid uuid;second_id uuid;d date:=(now() at time zone 'Asia/Manila')::date;begin
 r:=save_planned_shifts(manager,project,jsonb_build_array(jsonb_build_object('employeeId',a,'startAt',t,'endAt',t+interval '8 hours','note','Support')));sid:=(r->'ids'->>0)::uuid;
 r:=save_planned_shifts(manager,project,jsonb_build_array(jsonb_build_object('employeeId',a,'startAt',t+interval '2 days','endAt',t+interval '2 days 8 hours','note','Second draft')));second_id:=(r->'ids'->>0)::uuid;
 if jsonb_array_length(employee_shift_schedule(a,d,d+8)->'shifts')<>0 or exists(select 1 from shift_notifications where employee_id=a) then raise exception 'Draft leaked';end if;
 begin perform change_planned_shift_status(viewer,project,array[sid],true);raise exception 'Viewer published';exception when raise_exception then if sqlerrm<>'SHIFT_PLAN_ACCESS_REQUIRED' then raise;end if;end;
 perform change_planned_shift_status(manager,project,array[sid],true);perform change_planned_shift_status(manager,project,array[sid],true);
 r:=employee_shift_schedule(a,d,d+8);
 if jsonb_array_length(r->'shifts')<>1 or (r->>'unread_updates')::int<>1 or r->'notifications'->0->'details'->>'project_name'<>'Notification campaign' or r->'notifications'->0->'details'->>'status'<>'PUBLISHED' then raise exception 'Publication payload wrong: %',r;end if;
 if (select status from planned_shifts where id=second_id)<>'DRAFT' then raise exception 'Unselected draft was published';end if;
 perform save_planned_shifts(manager,project,jsonb_build_array(jsonb_build_object('id',sid,'employeeId',a,'startAt',t,'endAt',t+interval '8 hours','note','Support')));
 if (select count(*) from shift_notifications where employee_id=a)<>1 then raise exception 'Unchanged save sent a duplicate notice';end if;
 perform save_planned_shifts(manager,project,jsonb_build_array(jsonb_build_object('id',sid,'employeeId',a,'startAt',t+interval '1 hour','endAt',t+interval '9 hours','note','Changed hours')));
 if not exists(select 1 from shift_notifications where employee_id=a and kind='UPDATED' and (details->>'previous_start_at')::timestamptz=t and (details->>'start_at')::timestamptz=t+interval '1 hour') then raise exception 'Changed times missing';end if;
 perform save_planned_shifts(manager,project,jsonb_build_array(jsonb_build_object('id',sid,'employeeId',b,'startAt',t+interval '1 hour','endAt',t+interval '9 hours','note','Changed hours')));
 if not exists(select 1 from shift_notifications where employee_id=a and kind='CANCELLED') or not exists(select 1 from shift_notifications where employee_id=b and kind='PUBLISHED') then raise exception 'Reassignment notices incorrect';end if;
 r:=employee_shift_schedule(a,d,d+8);if jsonb_array_length(r->'shifts')<>0 or (r->>'unread_updates')::int<>3 then raise exception 'Reassigned employee can still see shift';end if;
 perform change_planned_shift_status(manager,project,array[sid],false);perform change_planned_shift_status(manager,project,array[sid],false);
 r:=employee_shift_schedule(b,d,d+8);if (r->>'unread_updates')::int<>2 then raise exception 'Cancellation duplicate or missing';end if;
 if exists(select 1 from jsonb_array_elements(r->'notifications')n where (n->>'employee_id')::uuid<>b) then raise exception 'Other employee notifications leaked';end if;
 perform set_project_manager(admin,project,manager,'VIEW',true);
 begin perform change_planned_shift_status(manager,project,array[second_id],true);raise exception 'Revoked planner published';exception when raise_exception then if sqlerrm<>'SHIFT_PLAN_ACCESS_REQUIRED' then raise;end if;end;
end $$;
rollback;
