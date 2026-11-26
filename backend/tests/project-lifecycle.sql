-- Isolated local regression test. Never run test fixtures on hosted databases.
\set ON_ERROR_STOP on
begin;
insert into profiles(id,role,status,full_name,email) values
('00000000-0000-4000-8000-000000000901','ADMIN','ACTIVE','Admin','lifecycle-admin@example.test'),
('00000000-0000-4000-8000-000000000902','USER','ACTIVE','Employee','lifecycle-employee@example.test'),
('00000000-0000-4000-8000-000000000903','USER','ACTIVE','Employee 2','lifecycle-employee2@example.test'),
('00000000-0000-4000-8000-000000000904','CLIENT','ACTIVE','Client','lifecycle-client@example.test');
insert into projects(id,name,type,start_date) values('00000000-0000-4000-8000-000000000911','Lifecycle campaign','CAMPAIGN',(now() at time zone 'Asia/Manila')::date);
insert into user_projects(user_id,project_id) values('00000000-0000-4000-8000-000000000902','00000000-0000-4000-8000-000000000911');
select set_client_project_access('00000000-0000-4000-8000-000000000901','00000000-0000-4000-8000-000000000904',array['00000000-0000-4000-8000-000000000911']::uuid[]);
insert into time_entries(id,user_id,project_id,clock_in_at) values('00000000-0000-4000-8000-000000000921','00000000-0000-4000-8000-000000000902','00000000-0000-4000-8000-000000000911',now());
update projects set status='PAUSED' where id='00000000-0000-4000-8000-000000000911';
do $$begin
 if (select is_active from projects where id='00000000-0000-4000-8000-000000000911') then raise exception 'Paused project still active'; end if;
 begin
 insert into time_entries(user_id,project_id,clock_in_at) values('00000000-0000-4000-8000-000000000903','00000000-0000-4000-8000-000000000911',now());
 raise exception 'Paused project clock-in allowed';exception when raise_exception then if sqlerrm<>'PROJECT_NOT_AVAILABLE' then raise; end if;end;
end $$;
-- Closing an existing shift must continue to work after pausing.
select clock_out_entry(p_actor_user_id:='00000000-0000-4000-8000-000000000902',p_entry_id:='00000000-0000-4000-8000-000000000921',p_actor_role:='USER',p_final_note:='Completed work',p_now:=now()+interval '1 hour');
update projects set status='ARCHIVED' where id='00000000-0000-4000-8000-000000000911';
do $$declare summary jsonb;begin
 if not exists(select 1 from time_entries where project_id='00000000-0000-4000-8000-000000000911' and clock_out_at is not null) then raise exception 'History lost';end if;
 begin delete from projects where id='00000000-0000-4000-8000-000000000911';raise exception 'Project history deleted';exception when raise_exception then if sqlerrm<>'PROJECT_HISTORY_EXISTS' then raise;end if;end;
 begin insert into time_entries(user_id,project_id,clock_in_at) values('00000000-0000-4000-8000-000000000903','00000000-0000-4000-8000-000000000911',now());raise exception 'Archive clock-in allowed';exception when raise_exception then if sqlerrm<>'PROJECT_NOT_AVAILABLE' then raise;end if;end;
 summary:=project_management_summary('00000000-0000-4000-8000-000000000901');
 if not exists(select 1 from jsonb_array_elements(summary) r where r->>'id'='00000000-0000-4000-8000-000000000911' and (r->>'employees')::int=1 and (r->>'clients')::int=1 and (r->>'working_now')::int=0) then raise exception 'Wrong roster counts';end if;
 begin perform project_management_summary('00000000-0000-4000-8000-000000000904');raise exception 'Client accessed admin summary';exception when raise_exception then if sqlerrm<>'ADMIN_REQUIRED' then raise;end if;end;
end $$;
insert into projects(id,name,start_date,end_date) values
('00000000-0000-4000-8000-000000000912','Future project',(now() at time zone 'Asia/Manila')::date+1,null),
('00000000-0000-4000-8000-000000000913','Expired project',(now() at time zone 'Asia/Manila')::date-2,(now() at time zone 'Asia/Manila')::date-1),
('00000000-0000-4000-8000-000000000914','Legacy activity project',(now() at time zone 'Asia/Manila')::date,null);
do $$declare target uuid;begin
 foreach target in array array['00000000-0000-4000-8000-000000000912','00000000-0000-4000-8000-000000000913']::uuid[] loop
 begin insert into time_entries(user_id,project_id,clock_in_at) values('00000000-0000-4000-8000-000000000903',target,now());raise exception 'Out-of-date clock-in allowed';exception when raise_exception then if sqlerrm<>'PROJECT_NOT_AVAILABLE' then raise;end if;end;
 end loop;
 begin insert into projects(id,name,start_date,end_date) values('00000000-0000-4000-8000-000000000915','Invalid dates','2026-12-02','2026-12-01');raise exception 'Invalid dates allowed';exception when check_violation then null;end;
 begin insert into projects(id,name) values('00000000-0000-4000-8000-000000000916',' FUTURE PROJECT ');raise exception 'Duplicate active name allowed';exception when unique_violation then null;end;
end $$;
update time_entries set activities='[{"project_id":"00000000-0000-4000-8000-000000000914","description":"Legacy work","duration_seconds":60}]' where id='00000000-0000-4000-8000-000000000921';
do $$begin
 begin delete from projects where id='00000000-0000-4000-8000-000000000914';raise exception 'Activity history deleted';exception when raise_exception then if sqlerrm<>'PROJECT_HISTORY_EXISTS' then raise;end if;end;
end $$;
-- Queued clock-ins use the existing review outcome rather than retrying a DB error.
insert into user_projects(user_id,project_id) values('00000000-0000-4000-8000-000000000903','00000000-0000-4000-8000-000000000912');
insert into auth.sessions(id,user_id) values('00000000-0000-4000-8000-000000000941','00000000-0000-4000-8000-000000000903');
do $$declare result jsonb; review uuid;begin
 result:=sync_queued_clock_action('00000000-0000-4000-8000-000000000903','00000000-0000-4000-8000-000000000941','00000000-0000-4000-8000-000000000942',jsonb_build_object('type','clock_in','projectId','00000000-0000-4000-8000-000000000912','tappedAt',now(),'anchorElapsedMs',0),now(),'127.0.0.1','Local regression',null);
 if (result->>'status')::int<>409 or result->'body'->>'code'<>'PROJECT_UNAVAILABLE' then raise exception 'Queued date guard failed: %',result;end if;
 select id into review from queued_clock_reviews where action_id='00000000-0000-4000-8000-000000000942';
 result:=resolve_queued_clock_review('00000000-0000-4000-8000-000000000901',review,'accepted','Local regression',null);
 if (result->>'status')::int<>409 then raise exception 'Review approval bypassed project dates: %',result;end if;
 if exists(select 1 from time_entries where project_id='00000000-0000-4000-8000-000000000912') then raise exception 'Queued invalid shift inserted';end if;
end $$;
-- A project with no attendance can still be physically deleted.
delete from projects where id='00000000-0000-4000-8000-000000000913';
-- Resume an archived project without replacing its assignments or history.
update projects set status='ACTIVE' where id='00000000-0000-4000-8000-000000000911';
do $$begin
 if not (select is_active from projects where id='00000000-0000-4000-8000-000000000911') then raise exception 'Resume failed';end if;
 if not exists(select 1 from user_projects where project_id='00000000-0000-4000-8000-000000000911') then raise exception 'Assignment lost';end if;
end $$;
rollback;
