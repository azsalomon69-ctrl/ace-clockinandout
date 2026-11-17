-- Run in an isolated database with migrations 0033 and 0034 applied.
begin;
alter table auth.users disable trigger user;
do $$
declare
  employee uuid := gen_random_uuid();
  reviewer uuid := gen_random_uuid();
  employee_session uuid := gen_random_uuid();
  second_device uuid := gen_random_uuid();
  schedule uuid := gen_random_uuid();
  start_action uuid := gen_random_uuid();
  end_action uuid := gen_random_uuid();
  conflict_action uuid := gen_random_uuid();
  metric_action uuid := gen_random_uuid();
  future_action uuid := gen_random_uuid();
  active_entry_id uuid;
  anchor_id uuid := gen_random_uuid();
  start_payload jsonb := '{"type":"clock_in","tappedAt":"2026-11-10T09:00:00.000Z"}';
  end_payload jsonb;
  result jsonb;
  initial_result jsonb;
  review_id uuid;
  shift_id uuid;
  entry public.time_entries;
  compliance record;
  before_metric bigint;
  after_metric bigint;
  metric_tap timestamptz := now() - interval '20 minutes';
begin
  insert into auth.users (id, email) values (employee, employee || '@example.test'), (reviewer, reviewer || '@example.test');
  insert into public.profiles (id, email, role, status)
    values (employee, employee || '@example.test', 'USER', 'ACTIVE'), (reviewer, reviewer || '@example.test', 'ADMIN', 'ACTIVE')
    on conflict (id) do update set role = excluded.role, status = excluded.status;
  insert into auth.sessions(id, user_id) values (employee_session, employee), (second_device, employee);
  insert into public.work_schedules(id,name,schedule_type,start_time,end_time,daily_elapsed_minutes)
    values (schedule,'Overnight review fixture','FIXED','17:00','02:00',540);
  insert into public.user_schedule_assignments(user_id,schedule_id) values (employee,schedule);

  initial_result := public.sync_queued_clock_action(employee, employee_session, start_action, start_payload,
    '2026-11-10 09:20Z', null, 'iPhone', null);
  if initial_result->'body'->>'bucket' is distinct from 'timing' then raise exception 'Expected a Timing receipt: %', initial_result; end if;
  if (select device_category from public.queued_clock_actions where action_id = start_action) is distinct from 'mobile' then raise exception 'Device evidence missing'; end if;
  select id into strict review_id from public.queued_clock_reviews where action_id = start_action;
  result := public.resolve_queued_clock_review(employee, review_id, 'accepted', 'Unauthorized', null);
  if result->>'status' is distinct from '403' then raise exception 'Employee gained review access'; end if;

  result := public.resolve_queued_clock_review(reviewer, review_id, 'accepted', 'Employee verified original start', null);
  if result->>'status' is distinct from '200' then raise exception 'Acceptance failed: %', result; end if;
  shift_id := (result->'review'->'accepted_entry'->>'id')::uuid;
  if (result->'review'->>'decided_by')::uuid is distinct from reviewer then raise exception 'Decision audit missing'; end if;
  result := public.sync_queued_clock_action(employee, employee_session, start_action, start_payload, now(), null, null, null);
  if result is distinct from initial_result then raise exception 'The original submission receipt changed'; end if;
  result := public.resolve_queued_clock_review(reviewer, review_id, 'rejected', 'Duplicate decision', null);
  if result->>'status' is distinct from '409' then raise exception 'Repeat decision was accepted'; end if;

  end_payload := jsonb_build_object('type', 'clock_out', 'clockInActionId', start_action,
    'tappedAt', '2026-11-10T19:00:00.000Z', 'note', 'Original note');
  result := public.sync_queued_clock_action(employee, employee_session, end_action, end_payload, '2026-11-10 19:03Z', null, null, null);
  if result->>'status' is distinct from '200' then raise exception 'Approved clock-in did not unblock clock-out: %', result; end if;
  select * into strict entry from public.time_entries where id = shift_id;
  if entry.clock_in_at is distinct from '2026-11-10 09:00Z'::timestamptz
    or entry.clock_out_at is distinct from '2026-11-10 19:00Z'::timestamptz
    or entry.duration_seconds is distinct from 36000 or not entry.queued_clock_synced_late
  then raise exception 'Attendance or late label used the wrong timestamp'; end if;
  select * into compliance from public.compute_schedule_compliance(shift_id);
  if compliance.late_seconds is distinct from 0 then raise exception 'An on-time shift was marked late'; end if;
  entry := public.approve_entry_overtime(shift_id, reviewer);
  if entry.overtime_approved_seconds is distinct from 3600 then raise exception 'Overnight overtime used the wrong end time'; end if;

  result := public.sync_queued_clock_action(employee, employee_session, end_action, end_payload || '{"note":"Changed"}',
    '2026-11-10 19:04Z', null, 'desktop', null);
  if result->>'status' is distinct from '409' or result->'body'->>'code' is distinct from 'ACTION_PAYLOAD_MISMATCH'
  then raise exception 'Changed payload was not detected'; end if;
  select id into strict review_id from public.queued_clock_reviews where action_id = end_action and bucket = 'integrity';
  result := public.resolve_queued_clock_review(reviewer, review_id, 'accepted', 'Must not overwrite', null);
  if result->>'status' is distinct from '409' then raise exception 'Changed payload was accepted'; end if;
  if (select payload->>'note' from public.queued_clock_actions where action_id = end_action) is distinct from 'Original note'
  then raise exception 'The original note changed'; end if;

  result := public.sync_queued_clock_action(employee, second_device, conflict_action,
    jsonb_build_object('type','clock_out','entryId',shift_id,'tappedAt','2026-11-10T19:01:00.000Z','note','Conflicting'),
    '2026-11-10 19:04Z', null, null, null);
  if result->'body'->>'code' is distinct from 'SHIFT_NOT_OPEN' then raise exception 'Closed shift was not flagged'; end if;
  select id into strict review_id from public.queued_clock_reviews where action_id = conflict_action;
  result := public.resolve_queued_clock_review(reviewer, review_id, 'accepted', 'Must not overwrite', null);
  if result->>'status' is distinct from '409' then raise exception 'Closed shift was overwritten'; end if;
  result := public.resolve_queued_clock_review(reviewer, review_id, 'rejected', 'Shift already closed', null);
  if result->'review'->>'decision_reason' is distinct from 'Shift already closed' then raise exception 'Rejection was not saved'; end if;

  result := public.open_missing_clock_review(reviewer, employee, 'clock_out', '2026-11-10 19:00Z', 'Reported', end_action, null);
  if result->>'status' is distinct from '409' then raise exception 'Missing case accepted despite matching receipt'; end if;
  result := public.open_missing_clock_review(reviewer, employee, 'clock_out', '2026-11-11 19:00Z', 'Reported', null, null);
  if result->'review'->>'bucket' is distinct from 'missing' then raise exception 'Missing case was not recorded separately'; end if;

  select delayed_10_to_30 into before_metric from public.queued_clock_weekly_metrics() limit 1;
  insert into public.clock_sync_anchors(id,user_id,session_id,server_at) values (anchor_id,employee,employee_session,metric_tap - interval '1 minute');
  result := public.sync_queued_clock_action(employee, employee_session, metric_action,
    jsonb_build_object('type','clock_in','tappedAt',metric_tap,'anchorId',anchor_id,'anchorElapsedMs',60000), now(), null, null, null);
  if result->>'status' is distinct from '201' or result->'body'->>'acceptedLate' is distinct from 'true'
  then raise exception 'Evidence-based late acceptance failed: %', result; end if;
  select delayed_10_to_30 into after_metric from public.queued_clock_weekly_metrics() limit 1;
  if after_metric is distinct from before_metric + 1 then raise exception 'Metric did not count the late accepted action once'; end if;

  active_entry_id := (result->'body'->'entry'->>'id')::uuid;
  result := public.sync_queued_clock_action(employee, employee_session, future_action,
    jsonb_build_object('type','clock_out','entryId',active_entry_id,'note','Future','tappedAt',now()+interval '1 minute'),
    now(), null, null, null);
  if result->'body'->>'code' is distinct from 'TAP_NOT_YET_VALID' then raise exception 'Future retry was not deferred'; end if;
  result := public.sync_queued_clock_action(employee, employee_session, gen_random_uuid(),
    jsonb_build_object('type','clock_out','entryId',active_entry_id,'note','Future','tappedAt',now()+interval '3 minutes'),
    now(), null, null, null);
  if result->'body'->>'code' is distinct from 'TAP_IN_FUTURE' or result->'body'->>'bucket' is distinct from 'integrity'
  then raise exception 'A large future clock error was not routed to Integrity'; end if;
  result := public.sync_queued_clock_action(employee, employee_session, gen_random_uuid(),
    jsonb_build_object('type','clock_out','entryId',active_entry_id,'note','Clock mismatch','tappedAt',metric_tap+interval '6 minutes',
      'anchorId',anchor_id,'anchorElapsedMs',60000), now(), null, null, null);
  if result->'body'->>'code' is distinct from 'DEVICE_CLOCK_MISMATCH' or result->'body'->>'bucket' is distinct from 'integrity'
  then raise exception 'A large estimated clock error was not routed to Integrity'; end if;
  if has_function_privilege('authenticated','public.resolve_queued_clock_review(uuid,uuid,text,text,uuid)','execute')
    or has_table_privilege('authenticated','public.queued_clock_reviews','select')
  then raise exception 'Direct browser access granted to review data'; end if;
end
$$;
rollback;
