-- Local isolated test fixtures only. Never run on hosted databases.
\set ON_ERROR_STOP on
begin;
insert into profiles(id,role,status,full_name,email) values
('00000000-0000-4000-8000-000000000801','ADMIN','ACTIVE','Admin','membership-admin@example.test'),
('00000000-0000-4000-8000-000000000802','USER','ACTIVE','Employee','membership-employee@example.test'),
('00000000-0000-4000-8000-000000000803','USER','ACTIVE','Employee 2','membership-employee2@example.test'),
('00000000-0000-4000-8000-000000000804','CLIENT','ACTIVE','Client','membership-client@example.test');
insert into projects(id,name,type,start_date) values('00000000-0000-4000-8000-000000000811','Membership campaign','CAMPAIGN',(now() at time zone 'Asia/Manila')::date);
do $$declare a uuid:='00000000-0000-4000-8000-000000000801';p uuid:='00000000-0000-4000-8000-000000000811';u uuid:='00000000-0000-4000-8000-000000000802';r jsonb;begin
 r:=change_project_memberships(a,p,jsonb_build_array(jsonb_build_object('employeeId',u,'joinedOn',(now() at time zone 'Asia/Manila')::date-2)));
 if r->>'changed'<>'1' then raise exception 'Not assigned';end if;
 r:=change_project_memberships(a,p,jsonb_build_array(jsonb_build_object('employeeId',u)));
 if r->>'skipped'<>'1' then raise exception 'Existing assignment duplicated';end if;
 if not exists(select 1 from user_projects where user_id=u and project_id=p) then raise exception 'Current assignment missing';end if;
 begin perform change_project_memberships(a,p,jsonb_build_array(jsonb_build_object('employeeId','00000000-0000-4000-8000-000000000803'),jsonb_build_object('employeeId','00000000-0000-4000-8000-000000000804')));raise exception 'Non-employee accepted';exception when raise_exception then if sqlerrm<>'MEMBERSHIP_EMPLOYEE_REQUIRED' then raise;end if;end;
 if exists(select 1 from user_projects where user_id='00000000-0000-4000-8000-000000000803' and project_id=p) then raise exception 'Partial batch committed';end if;
 begin perform change_project_memberships(u,p,jsonb_build_array(jsonb_build_object('employeeId',u)));raise exception 'Nonadmin accepted';exception when raise_exception then if sqlerrm<>'ADMIN_REQUIRED' then raise;end if;end;
end $$;
insert into time_entries(id,user_id,project_id,clock_in_at) values('00000000-0000-4000-8000-000000000821','00000000-0000-4000-8000-000000000802','00000000-0000-4000-8000-000000000811',now());
select change_project_memberships('00000000-0000-4000-8000-000000000801','00000000-0000-4000-8000-000000000811','[{"employeeId":"00000000-0000-4000-8000-000000000802"}]',true);
select clock_out_entry(p_actor_user_id:='00000000-0000-4000-8000-000000000802',p_entry_id:='00000000-0000-4000-8000-000000000821',p_actor_role:='USER',p_final_note:='Done',p_now:=now()+interval '1 hour');
do $$declare a uuid:='00000000-0000-4000-8000-000000000801';p uuid:='00000000-0000-4000-8000-000000000811';u uuid:='00000000-0000-4000-8000-000000000802';begin
 if not exists(select 1 from project_memberships where user_id=u and project_id=p and left_at is not null) then raise exception 'History lost';end if;
 begin perform change_project_memberships(a,p,jsonb_build_array(jsonb_build_object('employeeId',u,'joinedOn',(now() at time zone 'Asia/Manila')::date-1)));raise exception 'Overlap allowed';exception when raise_exception then if sqlerrm<>'MEMBERSHIP_OVERLAP' then raise;end if;end;
 perform change_project_memberships(a,p,jsonb_build_array(jsonb_build_object('employeeId',u)));
 if (select count(*) from project_memberships where user_id=u and project_id=p)<>2 then raise exception 'Rejoin lost history';end if;
 delete from user_projects where user_id=u and project_id=p;
 if exists(select 1 from project_memberships where user_id=u and project_id=p and left_at is null) then raise exception 'Legacy removal missed';end if;
 insert into user_projects(user_id,project_id) values(u,p);
 if not exists(select 1 from project_memberships where user_id=u and project_id=p and left_at is null) then raise exception 'Legacy assignment missed';end if;
end $$;
rollback;
select 'Membership history, bulk rollback, authorization, rejoin and open shift clock-out passed' as result;
