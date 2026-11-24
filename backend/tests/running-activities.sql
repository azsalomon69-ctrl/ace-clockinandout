-- Run after backend/tests/project-activities.sql in an isolated test database.
\set ON_ERROR_STOP on
\i supabase/migrations/0041_running_activities.sql
alter table time_entries add column duration_seconds integer generated always as (
  case when clock_out_at is null then null else greatest(0,extract(epoch from (clock_out_at-clock_in_at))::integer) end
) stored;
insert into time_entries(id,user_id,project_id,clock_in_at) values(
  '00000000-0000-4000-8000-000000000111','00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000001','2026-11-24T00:00:00.200Z');
select change_project_activity('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000111',
  'Support tickets','First activity note','00000000-0000-4000-8000-000000000112',null,'2026-11-24T00:00:00.200Z');
-- Identical retry retains one running activity.
select change_project_activity('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000111',
  'Support tickets','First activity note','00000000-0000-4000-8000-000000000112',null,'2026-11-24T00:00:01Z');
select change_project_activity('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000111',
  'Client calls','Second activity note','00000000-0000-4000-8000-000000000113','00000000-0000-4000-8000-000000000112','2026-11-24T03:00:00.700Z');
do $$
begin
  begin
    perform change_project_activity('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000111',
      'Stale tab','Note','00000000-0000-4000-8000-000000000119','00000000-0000-4000-8000-000000000112','2026-11-24T04:00Z');
    raise exception 'Stale change was accepted';
  exception when raise_exception then if sqlerrm<>'ACTIVITY_CHANGED' then raise; end if;
  end;
end $$;
select change_project_activity('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000111',
  'Documentation','Final activity note','00000000-0000-4000-8000-000000000114','00000000-0000-4000-8000-000000000113','2026-11-24T05:00:00.700Z');
select clock_out_project_entry('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000111','USER',
  '00000000-0000-4000-8000-000000000001','Work complete','2026-11-24T09:00:00.800Z');
do $$
declare e time_entries; total bigint;
begin
  select * into e from time_entries where id='00000000-0000-4000-8000-000000000111';
  select sum((a->>'duration_seconds')::bigint) into total from jsonb_array_elements(e.activities) a;
  if jsonb_array_length(e.activities)<>3 or total<>e.duration_seconds or e.duration_seconds<>32401 then raise exception 'Activity durations differ from shift total'; end if;
  if e.activities->2->>'description'<>'Documentation' or e.activities->2->>'completion_note'<>'Work complete' then raise exception 'Final activity overwritten'; end if;
  if e.activities->0->>'note'<>'First activity note' then raise exception 'Activity note lost'; end if;
  if exists(select 1 from jsonb_array_elements(e.activities) a where a->>'ended_at' is null) then raise exception 'Activity still running after clock-out'; end if;
end $$;
-- No-project employees retain untracked time before starting their first activity.
insert into time_entries(id,user_id,clock_in_at) values(
  '00000000-0000-4000-8000-000000000121','00000000-0000-4000-8000-000000000089','2026-11-24T00:00Z');
select change_project_activity('00000000-0000-4000-8000-000000000089','00000000-0000-4000-8000-000000000121',
  'Admin work',null,'00000000-0000-4000-8000-000000000122',null,'2026-11-24T01:00Z');
update time_entries set clock_out_at='2026-11-24T09:00Z',final_note='Queued close'
 where id='00000000-0000-4000-8000-000000000121';
do $$
declare e time_entries;
begin
  select * into e from time_entries where id='00000000-0000-4000-8000-000000000121';
  if jsonb_array_length(e.activities)<>2 or e.activities->0->>'description'<>'No activity recorded'
     or (e.activities->1->>'duration_seconds')::bigint<>28800 or e.activities->1->>'project_id' is not null then
    raise exception 'Unassigned running activity or prior untracked time lost';
  end if;
end $$;
select 'Running activities, retries, stale tabs, notes and clock-out totals verified' as result;
