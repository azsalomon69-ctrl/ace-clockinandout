-- Isolated local fixtures only. Never run on hosted databases.
\set ON_ERROR_STOP on
begin;
insert into profiles(id,role,status,full_name,email) values
('00000000-0000-4000-8000-000000000601','ADMIN','ACTIVE','Planning admin','plan-admin@example.test'),
('00000000-0000-4000-8000-000000000602','CLIENT','ACTIVE','Planner','planner@example.test'),
('00000000-0000-4000-8000-000000000603','CLIENT','ACTIVE','Viewer','viewer@example.test'),
('00000000-0000-4000-8000-000000000604','USER','ACTIVE','Employee','plan-employee@example.test'),
('00000000-0000-4000-8000-000000000605','USER','ACTIVE','Employee 2','plan-employee2@example.test');
insert into projects(id,name,start_date) values('00000000-0000-4000-8000-000000000611','Planning campaign',(now() at time zone 'Asia/Manila')::date-2),('00000000-0000-4000-8000-000000000612','Other private campaign',(now() at time zone 'Asia/Manila')::date-2);
select change_project_memberships('00000000-0000-4000-8000-000000000601','00000000-0000-4000-8000-000000000611','[{"employeeId":"00000000-0000-4000-8000-000000000604"},{"employeeId":"00000000-0000-4000-8000-000000000605"}]');
select change_project_memberships('00000000-0000-4000-8000-000000000601','00000000-0000-4000-8000-000000000612','[{"employeeId":"00000000-0000-4000-8000-000000000604"}]');
select set_project_manager('00000000-0000-4000-8000-000000000601','00000000-0000-4000-8000-000000000611','00000000-0000-4000-8000-000000000602','VIEW_PLAN');
select set_project_manager('00000000-0000-4000-8000-000000000601','00000000-0000-4000-8000-000000000611','00000000-0000-4000-8000-000000000603','VIEW');
do $$declare admin uuid:='00000000-0000-4000-8000-000000000601';manager uuid:='00000000-0000-4000-8000-000000000602';viewer uuid:='00000000-0000-4000-8000-000000000603';employee uuid:='00000000-0000-4000-8000-000000000604';project uuid:='00000000-0000-4000-8000-000000000611';other uuid:='00000000-0000-4000-8000-000000000612';start_time timestamptz:=((now() at time zone 'Asia/Manila')::date+2)::timestamp at time zone 'Asia/Manila';s uuid;r jsonb;payload jsonb;begin
 start_time:=start_time+interval '8 hours';
 payload:=jsonb_build_array(jsonb_build_object('employeeId',employee,'startAt',start_time,'endAt',start_time+interval '8 hours','note','Morning shift'));
 begin perform save_planned_shifts(viewer,project,payload);raise exception 'Viewer can plan';exception when raise_exception then if sqlerrm<>'SHIFT_PLAN_ACCESS_REQUIRED' then raise;end if;end;
 r:=save_planned_shifts(manager,project,payload);s:=(r->'ids'->>0)::uuid;
 if jsonb_array_length(employee_shift_schedule(employee,current_date,current_date+10)->'shifts')<>0 then raise exception 'Draft leaked to employee';end if;
 begin perform save_planned_shifts(admin,other,payload);raise exception 'Cross-project overlap allowed';exception when raise_exception then if sqlerrm<>'SHIFT_EMPLOYEE_BUSY' then raise;end if;end;
 begin perform save_planned_shifts(manager,project,jsonb_build_array(jsonb_build_object('employeeId',employee,'startAt',start_time+interval '10 hour','endAt',start_time+interval '11 hour')));raise exception 'Rest violation allowed';exception when raise_exception then if sqlerrm<>'SHIFT_REST_REQUIRED' then raise;end if;end;
 perform save_shift_availability(employee,null,start_time,start_time+interval '8 hours','UNAVAILABLE','Appointment');
 r:=change_planned_shift_status(manager,project,array[s],true);
 if jsonb_array_length(r->'warnings')=0 then raise exception 'Unavailable warning missing';end if;
 if jsonb_array_length(employee_shift_schedule(employee,current_date,current_date+10)->'shifts')<>1 then raise exception 'Published shift missing';end if;
 if not exists(select 1 from shift_notifications where employee_id=employee and shift_id=s and kind='PUBLISHED') then raise exception 'Publication notice missing';end if;
 begin perform save_shift_availability(employee,null,start_time,start_time+interval '1 hour','AVAILABLE','');raise exception 'Published availability changed';exception when raise_exception then if sqlerrm<>'SHIFT_AVAILABILITY_LOCKED' then raise;end if;end;
 -- The same employee's other campaign remains anonymous in the board response.
 perform save_planned_shifts(admin,other,jsonb_build_array(jsonb_build_object('employeeId',employee,'startAt',start_time+interval '1 day','endAt',start_time+interval '1 day 8 hours','note','PRIVATE NOTE')));
 r:=planning_board(manager,project,(start_time at time zone 'Asia/Manila')::date,(start_time at time zone 'Asia/Manila')::date+1);
 if jsonb_array_length(r->'busy')<>1 or r::text like '%PRIVATE NOTE%' or r::text like '%Other private campaign%' then raise exception 'Other campaign details leaked';end if;
 -- Nearest published shift links without changing attendance duration logic.
 insert into time_entries(id,user_id,project_id,clock_in_at) values('00000000-0000-4000-8000-000000000621',employee,project,start_time);
 if not exists(select 1 from time_entries where id='00000000-0000-4000-8000-000000000621' and planned_shift_id=s) or (select status from planned_shifts where id=s)<>'IN_PROGRESS' then raise exception 'Attendance not linked';end if;
 update time_entries set clock_out_at=start_time+interval '8 hours' where id='00000000-0000-4000-8000-000000000621';
 if (select status from planned_shifts where id=s)<>'COMPLETED' then raise exception 'Completion not linked';end if;
 perform set_project_manager(admin,project,manager,'VIEW',true);
 begin perform planning_board(manager,project,current_date,current_date+1);raise exception 'Revoked planner can read';exception when raise_exception then if sqlerrm<>'SHIFT_PLAN_ACCESS_REQUIRED' then raise;end if;end;
end $$;

do $$declare admin uuid:='00000000-0000-4000-8000-000000000601';manager uuid:='00000000-0000-4000-8000-000000000602';employee uuid:='00000000-0000-4000-8000-000000000605';project uuid:='00000000-0000-4000-8000-000000000611';t timestamptz:=((now() at time zone 'Asia/Manila')::date+14)::timestamp at time zone 'Asia/Manila';r jsonb;before_count integer;sid uuid;ids uuid[];rows jsonb;begin
 t:=t+interval '8 hours';perform set_project_manager(admin,project,manager,'VIEW_PLAN');
 begin perform save_planned_shifts(admin,project,jsonb_build_array(jsonb_build_object('employeeId',employee,'startAt',t,'endAt',t+interval '13 hours')));raise exception 'Long shift allowed';exception when raise_exception then if sqlerrm<>'SHIFT_TOO_LONG' then raise;end if;end;
 begin perform save_planned_shifts(admin,project,jsonb_build_array(jsonb_build_object('employeeId',employee,'startAt',now()-interval '1 hour','endAt',now())));raise exception 'Past shift allowed';exception when raise_exception then if sqlerrm<>'SHIFT_FUTURE_REQUIRED' then raise;end if;end;
 begin perform save_planned_shifts(admin,project,jsonb_build_array(jsonb_build_object('employeeId',employee,'startAt',now()+interval '3 months','endAt',now()+interval '3 months 8 hours')));raise exception 'Beyond planning horizon allowed';exception when raise_exception then if sqlerrm<>'SHIFT_RANGE_EXCEEDED' then raise;end if;end;
 update projects set status='PAUSED' where id=project;
 begin perform save_planned_shifts(admin,project,jsonb_build_array(jsonb_build_object('employeeId',employee,'startAt',t,'endAt',t+interval '8 hours')));raise exception 'Paused planning allowed';exception when raise_exception then if sqlerrm<>'SHIFT_PROJECT_UNAVAILABLE' then raise;end if;end;
 update projects set status='ACTIVE' where id=project;
 select count(*) into before_count from planned_shifts;
 begin perform save_planned_shifts(admin,project,jsonb_build_array(jsonb_build_object('employeeId',employee,'startAt',t,'endAt',t+interval '8 hours'),jsonb_build_object('employeeId',manager,'startAt',t,'endAt',t+interval '8 hours')));raise exception 'Invalid batch accepted';exception when raise_exception then if sqlerrm<>'SHIFT_EMPLOYEE_UNAVAILABLE' then raise;end if;end;
 if (select count(*) from planned_shifts)<>before_count then raise exception 'Batch partially saved';end if;
 t:=t-make_interval(days=>extract(dow from(t at time zone 'Asia/Manila'))::integer);
 select jsonb_agg(jsonb_build_object('employeeId',employee,'startAt',t+n*interval '1 day','endAt',t+n*interval '1 day'+interval '8 hours')) into rows from generate_series(0,5)n;
 r:=save_planned_shifts(manager,project,rows);
 if jsonb_array_length(r->'warnings')=0 then raise exception 'Weekly quota warning missing';end if;
 select array_agg(value::uuid) into ids from jsonb_array_elements_text(r->'ids');
 perform save_shift_availability(employee,null,t+interval '1 day',t+interval '1 day 8 hours','UNAVAILABLE','Private availability after leave');
 perform change_planned_shift_status(manager,project,array[ids[1]],true);
 perform change_project_memberships(admin,project,jsonb_build_array(jsonb_build_object('employeeId',employee)),true);
 r:=planning_board(manager,project,(t at time zone 'Asia/Manila')::date,(t at time zone 'Asia/Manila')::date+6);
 if not exists(select 1 from jsonb_array_elements(r->'shifts')x where (x->>'needs_review')::boolean) then raise exception 'Removal review missing';end if;
 if jsonb_array_length(r->'availability')<>0 then raise exception 'Availability after leave leaked';end if;
 begin perform change_planned_shift_status(manager,project,ids,false);raise exception 'Manager bypassed cancellation approval';exception when raise_exception then if sqlerrm<>'SHIFT_REVIEW_ADMIN_REQUIRED' then raise;end if;end;
 perform change_planned_shift_status(admin,project,ids,false);
 if not exists(select 1 from shift_notifications where shift_id=ids[1] and kind='CANCELLED') then raise exception 'Cancellation notice missing';end if;
 -- No-show state is refreshed from the configured grace period; a late arrival still links.
 r:=save_planned_shifts(admin,project,jsonb_build_array(jsonb_build_object('employeeId','00000000-0000-4000-8000-000000000604','startAt',t+interval '20 days','endAt',t+interval '20 days 8 hours')));sid:=(r->'ids'->>0)::uuid;
 perform change_planned_shift_status(admin,project,array[sid],true);
 update planned_shifts set start_at=clock_timestamp()-interval '1 hour',end_at=clock_timestamp()+interval '7 hours' where id=sid;
 perform planning_board(admin,project,(now() at time zone 'Asia/Manila')::date,(now() at time zone 'Asia/Manila')::date);
 if (select status from planned_shifts where id=sid)<>'NO_SHOW' then raise exception 'No-show missing';end if;
 insert into time_entries(id,user_id,project_id,clock_in_at) values('00000000-0000-4000-8000-000000000623','00000000-0000-4000-8000-000000000604',project,clock_timestamp());
 if (select status from planned_shifts where id=sid)<>'IN_PROGRESS' then raise exception 'Late arrival not linked';end if;
 update time_entries set clock_out_at=clock_timestamp()+interval '1 hour' where id='00000000-0000-4000-8000-000000000623';
end $$;

rollback;
select 'Planning permissions, drafts, publication, conflicts, availability, scope and attendance linkage passed' as result;
