-- Run in an isolated test database with the normal schema and migration 0042.
\set ON_ERROR_STOP on
begin;
insert into profiles(id,role,status) values
('00000000-0000-4000-8000-000000000201','ADMIN','ACTIVE'),
('00000000-0000-4000-8000-000000000202','USER','ACTIVE');
select admin_add_time_entry('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000202',
'00000000-0000-4000-8000-000000000203','2026-01-01T22:00+08:00','2026-01-02T07:00+08:00',null,'Forgot clock-in');
-- An identical retry must not add another entry or audit row.
select admin_add_time_entry('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000202',
'00000000-0000-4000-8000-000000000203','2026-01-01T22:00+08:00','2026-01-02T07:00+08:00',null,'Forgot clock-in');
do $$
declare message text; n integer;
begin
 if (select duration_seconds from time_entries where id='00000000-0000-4000-8000-000000000203')<>32400 then raise exception 'Incorrect duration'; end if;
 select count(*) into n from audit_logs where entity_id='00000000-0000-4000-8000-000000000203' and action='ADMIN_ADD_TIME_ENTRY';
 if n<>1 then raise exception 'Duplicate audit'; end if;
 foreach message in array array['ADMIN_REQUIRED','INVALID_MANUAL_ENTRY','TIME_ENTRY_OVERLAP','MANUAL_ENTRY_CONFLICT','PROJECT_UNAVAILABLE','EMPLOYEE_NOT_FOUND'] loop
  begin
   perform admin_add_time_entry(
    case when message='ADMIN_REQUIRED' then '00000000-0000-4000-8000-000000000202'::uuid else '00000000-0000-4000-8000-000000000201'::uuid end,
    case when message='EMPLOYEE_NOT_FOUND' then '00000000-0000-4000-8000-000000000201'::uuid else '00000000-0000-4000-8000-000000000202'::uuid end,
    case when message='MANUAL_ENTRY_CONFLICT' then '00000000-0000-4000-8000-000000000203'::uuid else '00000000-0000-4000-8000-000000000204'::uuid end,
    '2026-01-01T15:00Z',case when message='INVALID_MANUAL_ENTRY' then '2026-01-01T14:00Z'::timestamptz else '2026-01-01T16:00Z'::timestamptz end,
    case when message='PROJECT_UNAVAILABLE' then '00000000-0000-4000-8000-000000000299'::uuid else null end,'A missed shift');
   raise exception 'Expected rejection: %',message;
  exception when raise_exception then if sqlerrm<>message then raise; end if; end;
 end loop;
 -- A regular entry cannot subsequently overlap the manually added shift.
 begin
 insert into time_entries(id,user_id,clock_in_at,clock_out_at) values('00000000-0000-4000-8000-000000000205','00000000-0000-4000-8000-000000000202','2026-01-01T15:00Z','2026-01-01T16:00Z');
 raise exception 'Normal overlap accepted';
 exception when raise_exception then if sqlerrm<>'TIME_ENTRY_OVERLAP' then raise; end if; end;
 -- Adjacent intervals are allowed.
 perform admin_add_time_entry('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000202',
 '00000000-0000-4000-8000-000000000206','2026-01-01T23:00Z','2026-01-02T00:00Z',null,'Adjacent shift');
 if has_function_privilege('authenticated','public.admin_add_time_entry(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text,inet,text,uuid)','EXECUTE') then raise exception 'Public RPC permission'; end if;
end $$;
-- A failed audit insert must roll back the new attendance row too.
create function public.test_manual_audit_failure() returns trigger language plpgsql as $$
begin raise exception 'TEST_AUDIT_FAILURE'; end $$;
create trigger test_manual_audit_failure before insert on public.audit_logs for each row execute function public.test_manual_audit_failure();
do $$
begin
 begin
 perform admin_add_time_entry('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000202',
 '00000000-0000-4000-8000-000000000207','2026-01-02T01:00Z','2026-01-02T02:00Z',null,'Missed clock-in');
 raise exception 'Audit failure ignored';
 exception when raise_exception then if sqlerrm<>'TEST_AUDIT_FAILURE' then raise; end if; end;
 if exists(select 1 from time_entries where id='00000000-0000-4000-8000-000000000207') then raise exception 'Unaudited entry survived'; end if;
end $$;
drop trigger test_manual_audit_failure on public.audit_logs;
insert into time_entries(id,user_id,clock_in_at) values('00000000-0000-4000-8000-000000000208','00000000-0000-4000-8000-000000000202','2026-01-02T01:00Z');
do $$
begin
 begin
 perform admin_add_time_entry('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000202',
 '00000000-0000-4000-8000-000000000209','2026-01-02T02:00Z','2026-01-02T03:00Z',null,'Missed clock-in');
 raise exception 'Active overlap accepted';
 exception when raise_exception then if sqlerrm<>'TIME_ENTRY_OVERLAP' then raise; end if; end;
end $$;
rollback;
