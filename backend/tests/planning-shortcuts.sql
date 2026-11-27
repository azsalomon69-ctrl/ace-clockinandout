-- Isolated local fixtures only. Never run on hosted databases.
\set ON_ERROR_STOP on
begin;
insert into profiles(id,role,status,full_name,email) values('00000000-0000-4000-8000-000000000801','ADMIN','ACTIVE','Admin','shortcut-admin@example.test'),('00000000-0000-4000-8000-000000000802','USER','ACTIVE','Employee A','shortcut-a@example.test'),('00000000-0000-4000-8000-000000000803','USER','ACTIVE','Employee B','shortcut-b@example.test');
insert into projects(id,name,start_date) values('00000000-0000-4000-8000-000000000811','Shortcut project',(now() at time zone 'Asia/Manila')::date-1);
select change_project_memberships('00000000-0000-4000-8000-000000000801','00000000-0000-4000-8000-000000000811','[{"employeeId":"00000000-0000-4000-8000-000000000802"},{"employeeId":"00000000-0000-4000-8000-000000000803"}]');
do $$declare admin uuid:='00000000-0000-4000-8000-000000000801';a uuid:='00000000-0000-4000-8000-000000000802';b uuid:='00000000-0000-4000-8000-000000000803';project uuid:='00000000-0000-4000-8000-000000000811';series uuid:=gen_random_uuid();start_time timestamptz:=(((now() at time zone 'Asia/Manila')::date+2)::timestamp at time zone 'Asia/Manila')+interval '22 hours';rows jsonb;r jsonb;first_id uuid;before_count integer;begin
 select jsonb_agg(jsonb_build_object('employeeId',a,'startAt',start_time+n*interval '2 days','endAt',start_time+n*interval '2 days'+interval '8 hours','recurrenceId',series,'note','Overnight support')) into rows from generate_series(0,2)n;
 r:=save_planned_shifts(admin,project,rows);first_id:=(r->'ids'->>0)::uuid;
 if (select count(*) from planned_shifts where recurrence_id=series and status='DRAFT' and end_at-start_at=interval '8 hours')<>3 then raise exception 'Recurring overnight batch incorrect';end if;
 select jsonb_agg(jsonb_build_object('employeeId',employee_id,'startAt',start_at+interval '7 days','endAt',end_at+interval '7 days','note',note)) into rows from planned_shifts where recurrence_id=series;
 perform save_planned_shifts(admin,project,rows);
 if (select count(*) from planned_shifts where project_id=project and status='DRAFT')<>6 then raise exception 'Week copy overwrote source or published shifts';end if;
 perform save_planned_shifts(admin,project,jsonb_build_array(jsonb_build_object('id',first_id,'employeeId',b,'startAt',start_time+interval '1 day','endAt',start_time+interval '1 day 8 hours','note','Moved overnight')));
 if not exists(select 1 from planned_shifts where id=first_id and employee_id=b and end_at-start_at=interval '8 hours') then raise exception 'Shift move lost employee or duration';end if;
 select count(*) into before_count from planned_shifts where project_id=project;
 begin
 perform save_planned_shifts(admin,project,jsonb_build_array(jsonb_build_object('employeeId',a,'startAt',start_time+interval '20 days','endAt',start_time+interval '20 days 8 hours'),jsonb_build_object('employeeId',a,'startAt',start_time+interval '2 days','endAt',start_time+interval '2 days 8 hours')));raise exception 'Conflicting copied batch saved';
 exception when raise_exception then if sqlerrm<>'SHIFT_EMPLOYEE_BUSY' then raise;end if;end;
 if (select count(*) from planned_shifts where project_id=project)<>before_count then raise exception 'Conflicting copy partially saved';end if;
end $$;
rollback;
