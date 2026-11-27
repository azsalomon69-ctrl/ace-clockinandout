-- Local test fixtures only, never hosted databases.
\set ON_ERROR_STOP on
begin;
insert into profiles(id,role,status,full_name,email) values
('00000000-0000-4000-8000-000000000701','ADMIN','ACTIVE','Admin','manager-admin@example.test'),
('00000000-0000-4000-8000-000000000702','USER','ACTIVE','Manager','manager-user@example.test'),
('00000000-0000-4000-8000-000000000703','USER','ACTIVE','Employee','manager-employee@example.test'),
('00000000-0000-4000-8000-000000000704','CLIENT','ACTIVE','Client','manager-client@example.test');
insert into projects(id,name,start_date) values
('00000000-0000-4000-8000-000000000711','Manager project A',(now() at time zone 'Asia/Manila')::date-1),
('00000000-0000-4000-8000-000000000712','Manager project B',(now() at time zone 'Asia/Manila')::date-1);
insert into user_projects(user_id,project_id) values('00000000-0000-4000-8000-000000000703','00000000-0000-4000-8000-000000000711');
insert into time_entries(id,user_id,project_id,clock_in_at,clock_out_at) values
('00000000-0000-4000-8000-000000000721','00000000-0000-4000-8000-000000000703','00000000-0000-4000-8000-000000000711',now()-interval '4 hour',now()-interval '3 hour'),
('00000000-0000-4000-8000-000000000722','00000000-0000-4000-8000-000000000703','00000000-0000-4000-8000-000000000712',now()-interval '2 hour',now()-interval '1 hour');
do $$declare a uuid:='00000000-0000-4000-8000-000000000701';m uuid:='00000000-0000-4000-8000-000000000702';p uuid:='00000000-0000-4000-8000-000000000711';q uuid:='00000000-0000-4000-8000-000000000712';r jsonb;begin
 perform set_client_project_access(a,'00000000-0000-4000-8000-000000000704',array[p]);
 if (select access_level from client_project_access where user_id='00000000-0000-4000-8000-000000000704' and project_id=p)<>'VIEW' then raise exception 'Legacy client access not view only';end if;
 perform set_project_manager(a,p,'00000000-0000-4000-8000-000000000704','VIEW_PLAN');
 perform set_client_project_access(a,'00000000-0000-4000-8000-000000000704',array[p]);
 if (select access_level from client_project_access where user_id='00000000-0000-4000-8000-000000000704' and project_id=p)<>'VIEW_PLAN' then raise exception 'Legacy editor reset existing manager level';end if;
 perform set_project_manager(a,p,m,'VIEW');
 if not project_manager_allowed(m,p) or project_manager_allowed(m,p,true) then raise exception 'View permission invalid';end if;
 r:=client_attendance_v2(m,array[p],(now() at time zone 'Asia/Manila')::date-1,(now() at time zone 'Asia/Manila')::date);
 if (r->>'total')::int<>1 then raise exception 'Scoped history wrong: %',r;end if;
 begin perform client_attendance_v2(m,array[q],current_date-1,current_date);raise exception 'Other project visible';exception when raise_exception then if sqlerrm<>'PROJECT_ACCESS_DENIED' then raise;end if;end;
 perform set_project_manager(a,q,m,'VIEW_PLAN');
 if not project_manager_allowed(m,q,true) or project_manager_allowed(m,p,true) then raise exception 'Per-project levels mixed';end if;
 if not exists(select 1 from jsonb_array_elements(client_projects(m)) x where x->>'id'=q::text and x->>'access_level'='VIEW_PLAN') then raise exception 'Missing level in projects';end if;
 begin perform set_project_manager(a,p,'00000000-0000-4000-8000-000000000703','VIEW');raise exception 'Employee can manage own project';exception when raise_exception then if sqlerrm<>'EMPLOYEE_ASSIGNMENT_CONFLICT' then raise;end if;end;
 begin insert into user_projects(user_id,project_id) values(m,p);raise exception 'Manager can become employee';exception when raise_exception then if sqlerrm<>'MEMBERSHIP_MANAGER_CONFLICT' then raise;end if;end;
 begin perform set_project_manager(m,p,'00000000-0000-4000-8000-000000000704','VIEW_PLAN');raise exception 'Manager can grant permissions';exception when raise_exception then if sqlerrm<>'ADMIN_REQUIRED' then raise;end if;end;
 perform set_project_manager(a,q,m,'VIEW');if project_manager_allowed(m,q,true) then raise exception 'Downgrade not immediate';end if;
 perform set_project_manager(a,p,m,'VIEW',true);if project_manager_allowed(m,p) then raise exception 'Revoke not immediate';end if;
 begin perform client_attendance_v2(m,array[p],current_date-1,current_date);raise exception 'Revoked data visible';exception when raise_exception then if sqlerrm<>'PROJECT_ACCESS_DENIED' then raise;end if;end;
 if not exists(select 1 from audit_logs where entity_id=p and action='REVOKE_MANAGER_ACCESS') or not exists(select 1 from audit_logs where entity_id=q and action='CHANGE_MANAGER_ACCESS') then raise exception 'Audit missing';end if;
 if not exists(select 1 from time_entries where project_id=p) then raise exception 'Revocation deleted attendance';end if;
 update profiles set status='PENDING' where id=m;
 if project_manager_allowed(m,q) then raise exception 'Inactive manager allowed';end if;
end $$;
rollback;
select 'Manager levels, role checks, scope, conflict, downgrade/revoke and audit passed' as result;
