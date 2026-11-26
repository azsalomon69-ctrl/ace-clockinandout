-- Isolated database regression tests. Run after 0043 and 0044.
\set ON_ERROR_STOP on
begin;
insert into profiles(id,role,status,full_name,email) values
('00000000-0000-4000-8000-000000000401','ADMIN','ACTIVE','Admin','admin@example.test'),
('00000000-0000-4000-8000-000000000402','CLIENT','ACTIVE','Client A','clienta@example.test'),
('00000000-0000-4000-8000-000000000403','CLIENT','ACTIVE','Client B','clientb@example.test'),
('00000000-0000-4000-8000-000000000404','USER','ACTIVE','Employee','employee@example.test');
insert into projects(id,name) values('00000000-0000-4000-8000-000000000411','Project A'),('00000000-0000-4000-8000-000000000412','Project B');
insert into time_entries(id,user_id,project_id,clock_in_at,clock_out_at,activities,final_note) values
('00000000-0000-4000-8000-000000000421','00000000-0000-4000-8000-000000000404','00000000-0000-4000-8000-000000000411','2026-11-27T00:00Z','2026-11-27T09:00Z',
'[{"project_id":"00000000-0000-4000-8000-000000000411","description":"Allowed work","duration_seconds":28800,"started_at":"2026-11-27T00:00Z","ended_at":"2026-11-27T08:00Z"},{"project_id":"00000000-0000-4000-8000-000000000412","description":"Secret work","duration_seconds":3600,"started_at":"2026-11-27T08:00Z","ended_at":"2026-11-27T09:00Z"}]','Sensitive internal final note'),
('00000000-0000-4000-8000-000000000422','00000000-0000-4000-8000-000000000404','00000000-0000-4000-8000-000000000412','2026-11-26T00:00Z','2026-11-26T09:00Z','[]',null);
select set_client_project_access('00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000402',array['00000000-0000-4000-8000-000000000411']::uuid[]);
do $$
declare result jsonb;
begin
 result:=client_attendance_v2('00000000-0000-4000-8000-000000000402',null,'2026-11-01','2026-11-30');
 if (result->>'total')::int<>1 then raise exception 'Wrong project scope'; end if;
 if result::text like '%Secret work%' or result::text like '%Sensitive internal%' or result::text like '%employee@example%' or result::text like '%manual_reason%' then raise exception 'Private field leaked'; end if;
 if (result->>'worked_seconds')::int<>28800 then raise exception 'Foreign project time leaked'; end if;
 if (client_attendance_v2('00000000-0000-4000-8000-000000000403',null,'2026-11-01','2026-11-30')->>'total')::int<>0 then raise exception 'Empty access exposed attendance'; end if;
 begin
 perform client_attendance_v2('00000000-0000-4000-8000-000000000402',array['00000000-0000-4000-8000-000000000412']::uuid[],'2026-11-01','2026-11-30');
 raise exception 'Forged project allowed'; exception when raise_exception then if sqlerrm<>'PROJECT_ACCESS_DENIED' then raise; end if; end;
 begin
 perform client_projects('00000000-0000-4000-8000-000000000404');
 raise exception 'Employee client API allowed'; exception when raise_exception then if sqlerrm<>'CLIENT_ACCESS_REQUIRED' then raise; end if; end;
 begin
 perform set_client_project_access('00000000-0000-4000-8000-000000000402','00000000-0000-4000-8000-000000000403',array['00000000-0000-4000-8000-000000000411']::uuid[]);
 raise exception 'Client granted access'; exception when raise_exception then if sqlerrm<>'ADMIN_REQUIRED' then raise; end if; end;
end $$;
savepoint multi_project;
select set_client_project_access('00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000402',array['00000000-0000-4000-8000-000000000411','00000000-0000-4000-8000-000000000412']::uuid[]);
do $$declare result jsonb;begin
 result:=client_attendance_v2('00000000-0000-4000-8000-000000000402',null,'2026-11-01','2026-11-30',null,1,25,null,'employees');
 if (result->>'total')::int<>1 or (result->>'shifts')::int<>2 or (result->'items'->0->>'shifts')::int<>2 then raise exception 'Summary not grouped by employee'; end if;
 if (result->>'worked_seconds')::int<>61200 then raise exception 'Wrong summary duration'; end if;
 result:=client_attendance_v2('00000000-0000-4000-8000-000000000402',null,'2026-11-01','2026-11-30',null,1,1);
 if jsonb_array_length(result->'items')<>1 or (result->>'shifts')::int<>2 or (result->>'worked_seconds')::int<>61200 then raise exception 'Totals depend on pagination'; end if;
 result:=client_attendance_v2('00000000-0000-4000-8000-000000000402',null,'2026-11-01','2026-11-30',null,1,25,'00000000-0000-4000-8000-000000000403','employees');
 if (result->>'total')::int<>0 then raise exception 'Forged employee exposed rows'; end if;
end $$;
rollback to multi_project;
-- Emulate a former employee with their own entry: direct REST cannot bypass scopes.
update time_entries set user_id='00000000-0000-4000-8000-000000000402' where id='00000000-0000-4000-8000-000000000421';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000402',true);
do $$begin if exists(select 1 from time_entries) then raise exception 'Direct RLS bypass'; end if; end $$;
reset role;
select set_client_project_access('00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000402','{}');
do $$begin
 if (client_attendance_v2('00000000-0000-4000-8000-000000000402',null,'2026-11-01','2026-11-30')->>'total')::int<>0 then raise exception 'Revocation did not take effect'; end if;
 if (select count(*) from audit_logs where action in('GRANT_CLIENT_ACCESS','REVOKE_CLIENT_ACCESS') and entity_id='00000000-0000-4000-8000-000000000411')<>2 then raise exception 'Audit missing'; end if;
 if has_function_privilege('authenticated','public.client_attendance_v2(uuid,uuid[],date,date,text,integer,integer,uuid,text)','EXECUTE') then raise exception 'Public RPC bypass'; end if;
end $$;
rollback;
