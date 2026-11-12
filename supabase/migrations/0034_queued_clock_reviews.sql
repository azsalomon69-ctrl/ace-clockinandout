begin;

alter table public.queued_clock_actions add column device_category text;
alter table public.time_entries add column queued_clock_synced_late boolean not null default false;

update public.time_entries e set queued_clock_synced_late = true
where exists (select 1 from public.queued_clock_actions a
  where a.user_id = e.user_id and a.status_code in (200, 201)
    and a.response->'entry'->>'id' = e.id::text
    and a.received_at - a.tapped_at > interval '10 minutes');

create table public.queued_clock_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  action_id uuid,
  bucket text not null check (bucket in ('timing', 'integrity', 'missing')),
  code text not null,
  evidence jsonb not null default '{}'::jsonb,
  opened_at timestamptz not null default clock_timestamp(),
  opened_by uuid references public.profiles(id),
  decision text check (decision in ('accepted', 'rejected')),
  decision_reason text,
  decided_at timestamptz,
  decided_by uuid references public.profiles(id),
  accepted_entry jsonb,
  foreign key (user_id, action_id) references public.queued_clock_actions(user_id, action_id),
  unique (user_id, action_id, code)
);
create index queued_clock_reviews_bucket_idx on public.queued_clock_reviews(bucket, opened_at desc, id);
alter table public.queued_clock_reviews enable row level security;
revoke all on public.queued_clock_reviews from public, anon, authenticated;
grant select on public.queued_clock_reviews to service_role;

insert into public.queued_clock_reviews (user_id, action_id, bucket, code, opened_at)
select user_id, action_id, response->>'bucket', response->>'code', received_at
from public.queued_clock_actions where status_code = 409 and response->>'state' = 'needs_review';

-- Preserve the original POST result. The separately stored decision can
-- satisfy a dependent clock-out after its clock-in is approved.

create or replace function public.sync_queued_clock_action(
  p_user_id uuid, p_session_id uuid, p_action_id uuid, p_payload jsonb,
  p_received_at timestamptz, p_ip_address inet, p_user_agent text, p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tap timestamptz := (p_payload->>'tappedAt')::timestamptz;
  v_type text := p_payload->>'type';
  v_project uuid := (p_payload->>'projectId')::uuid;
  v_entry_id uuid := (p_payload->>'entryId')::uuid;
  v_dependency uuid := (p_payload->>'clockInActionId')::uuid;
  v_elapsed bigint := (p_payload->>'anchorElapsedMs')::bigint;
  v_anchor_at timestamptz;
  v_clock_error bigint;
  v_claim uuid;
  v_previous public.queued_clock_actions;
  v_entry public.time_entries;
  v_approved_in jsonb;
  v_schedule public.work_schedules;
  v_reason text;
  v_bucket text := 'integrity';
  v_status integer;
  v_response jsonb;
  v_first_received_at timestamptz := p_received_at;
  v_device text := case when nullif(trim(p_user_agent), '') is null then null when p_user_agent ~* 'Android|iPhone|iPad|iPod|Mobile|Windows Phone|IEMobile' then 'mobile' else 'pc web' end;
begin
  -- Use the same lock order as ace_end_session so a signed-out session
  -- cannot submit a queued action after the revocation commits.
  perform 1 from auth.sessions
    where id = p_session_id and user_id = p_user_id for share;
  if not found or (public.ace_session_profile(p_user_id, p_session_id)).id is null then
    return jsonb_build_object('status', 401, 'body', jsonb_build_object('code', 'INVALID_SESSION'));
  end if;

  -- Serialize queue actions for an employee and recheck active access in the write transaction.
  perform 1 from public.profiles
    where id = p_user_id and role = 'USER' and status = 'ACTIVE'
      and permanently_deleted_at is null for no key update;
  if not found then
    return jsonb_build_object('status', 403, 'body', jsonb_build_object('code', 'EMPLOYEE_ACCESS_REQUIRED'));
  end if;

  insert into public.queued_clock_actions (user_id, action_id, payload, tapped_at, received_at, device_category)
    values (p_user_id, p_action_id, p_payload, v_tap, p_received_at, v_device)
    on conflict (user_id, action_id) do nothing returning action_id into v_claim;
  if not found then
    select * into strict v_previous from public.queued_clock_actions
      where user_id = p_user_id and action_id = p_action_id;
    if v_previous.payload is distinct from p_payload then
      insert into public.queued_clock_reviews (user_id, action_id, bucket, code, evidence, opened_at)
        values (p_user_id, p_action_id, 'integrity', 'ACTION_PAYLOAD_MISMATCH',
          jsonb_build_object('attempt', p_payload, 'device', v_device), p_received_at)
        on conflict (user_id, action_id, code) do nothing;
      return jsonb_build_object('status', 409, 'body',
        jsonb_build_object('code', 'ACTION_PAYLOAD_MISMATCH', 'state', 'needs_review', 'bucket', 'integrity'));
    end if;
    if v_previous.status_code <> 425 then
      return jsonb_build_object('status', v_previous.status_code, 'body', v_previous.response);
    end if;
    v_first_received_at := v_previous.received_at;
  end if;

  if v_tap > p_received_at and v_tap <= p_received_at + interval '2 minutes' then
    v_response := jsonb_build_object('code', 'TAP_NOT_YET_VALID', 'retryAt', v_tap);
    update public.queued_clock_actions set status_code = 425, response = v_response
      where user_id = p_user_id and action_id = p_action_id;
    return jsonb_build_object('status', 425, 'body', v_response);
  end if;

  if p_payload->>'anchorId' is not null and v_elapsed between 0 and 900000 then
    select server_at into v_anchor_at from public.clock_sync_anchors
      where id = (p_payload->>'anchorId')::uuid and user_id = p_user_id and session_id = p_session_id
        and server_at <= p_received_at and server_at >= p_received_at - interval '5 hours';
    if found and v_anchor_at + v_elapsed * interval '1 millisecond' <= p_received_at then
      v_clock_error := round(extract(epoch from (v_tap - v_anchor_at)) * 1000)::bigint - v_elapsed;
    end if;
  end if;

  if v_tap > p_received_at + interval '2 minutes' then v_reason := 'TAP_IN_FUTURE';
  elsif v_tap < p_received_at - interval '4 hours' then v_reason := 'TAP_TOO_OLD';
  elsif abs(v_clock_error) > 300000 then v_reason := 'DEVICE_CLOCK_MISMATCH';
  elsif v_tap < p_received_at - interval '10 minutes' and v_clock_error is null then
    v_reason := 'CLOCK_EVIDENCE_UNAVAILABLE';
    v_bucket := 'timing';
  end if;

  if v_type = 'clock_out' then
    if v_dependency is not null then
      select * into v_previous from public.queued_clock_actions
        where user_id = p_user_id and action_id = v_dependency;
      if found and v_previous.payload->>'type' = 'clock_in' then
        if v_previous.status_code = 201 then
          v_approved_in := v_previous.response->'entry';
        else
          select accepted_entry into v_approved_in from public.queued_clock_reviews
          where user_id = p_user_id and action_id = v_dependency and decision = 'accepted';
        end if;
      end if;
      if v_approved_in is null then
        v_response := jsonb_build_object('code', 'CLOCK_IN_NOT_CONFIRMED');
        update public.queued_clock_actions set status_code = 425, response = v_response
          where user_id = p_user_id and action_id = p_action_id;
        return jsonb_build_object('status', 425, 'body', v_response);
      end if;
      v_entry_id := (v_approved_in->>'id')::uuid;
    end if;
    select * into v_entry from public.time_entries
      where id = v_entry_id and user_id = p_user_id for update;
    if not found or v_entry.deleted_at is not null or v_entry.clock_out_at is not null then
      v_reason := 'SHIFT_NOT_OPEN';
      v_bucket := 'integrity';
    elsif v_tap < v_entry.clock_in_at then
      v_reason := 'TAP_BEFORE_CLOCK_IN';
      v_bucket := 'integrity';
    end if;
    if v_reason is null then
      update public.time_entries set clock_out_at = v_tap, final_note = p_payload->>'note'
        where id = v_entry_id returning * into v_entry;
    end if;
  elsif v_type = 'clock_in' then
    if exists (select 1 from public.time_entries where user_id = p_user_id and deleted_at is null
               and (clock_out_at is null or clock_out_at > v_tap)) then
      v_reason := 'SHIFT_OVERLAP';
      v_bucket := 'integrity';
    elsif v_project is not null and not exists (
      select 1 from public.user_projects as up join public.projects as p on p.id = up.project_id
      where up.user_id = p_user_id and up.project_id = v_project and p.is_active
    ) then
      v_reason := 'PROJECT_UNAVAILABLE';
      v_bucket := 'integrity';
    end if;
    if v_reason is null then
      select w.* into v_schedule from public.work_schedules as w
        join public.user_schedule_assignments as a on a.schedule_id = w.id
        where a.user_id = p_user_id;
      insert into public.time_entries (
        user_id, project_id, clock_in_at, schedule_id, schedule_type,
        scheduled_start_time, scheduled_end_time, target_seconds, scheduled_weekdays
      ) values (
        p_user_id, v_project, v_tap, v_schedule.id, v_schedule.schedule_type,
        v_schedule.start_time, v_schedule.end_time, v_schedule.daily_elapsed_minutes * 60,
        v_schedule.scheduled_weekdays
      ) on conflict (user_id) where clock_out_at is null do nothing returning * into v_entry;
      if not found then
        v_reason := 'SHIFT_OVERLAP';
        v_bucket := 'integrity';
      end if;
    end if;
  else
    raise exception 'Invalid queued clock action';
  end if;

  if v_reason is null then
    if v_first_received_at - v_tap > interval '10 minutes' and not v_entry.queued_clock_synced_late then
      update public.time_entries set queued_clock_synced_late = true where id = v_entry.id returning * into v_entry;
    end if;
    v_status := case when v_type = 'clock_in' then 201 else 200 end;
    v_response := jsonb_build_object('state', 'confirmed', 'entry', to_jsonb(v_entry),
      'receivedAt', v_first_received_at, 'acceptedLate', v_tap < v_first_received_at - interval '10 minutes');
    insert into public.audit_logs (user_id, action, entity_type, entity_id, description, ip_address, user_agent, request_id)
      values (p_user_id, upper(v_type) || ' (' || coalesce(v_device, 'unknown') || ')', 'TIME_ENTRY', v_entry.id,
        'Synced queued clock action ' || p_action_id, p_ip_address, p_user_agent, p_request_id);
  else
    v_status := 409;
    v_response := jsonb_build_object('state', 'needs_review', 'bucket', v_bucket,
      'code', v_reason, 'actionId', p_action_id, 'receivedAt', v_first_received_at);
    insert into public.queued_clock_reviews (user_id, action_id, bucket, code, opened_at)
      values (p_user_id, p_action_id, v_bucket, v_reason, p_received_at)
      on conflict (user_id, action_id, code) do nothing;
  end if;
  update public.queued_clock_actions
    set status_code = v_status, response = v_response, clock_error_ms = v_clock_error
    where user_id = p_user_id and action_id = p_action_id;
  return jsonb_build_object('status', v_status, 'body', v_response);
end;
$$;

create function public.open_missing_clock_review(
  p_actor uuid, p_user uuid, p_type text, p_reported_at timestamptz,
  p_detail text, p_action_id uuid, p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_case public.queued_clock_reviews;
begin
  if not exists (select 1 from public.profiles
    where id = p_actor and role = 'ADMIN' and status = 'ACTIVE' and permanently_deleted_at is null)
  then return jsonb_build_object('status', 403, 'error', 'Administrator access required.'); end if;
  if p_type is null or p_type not in ('clock_in', 'clock_out') or p_reported_at is null
    or p_reported_at > clock_timestamp() or nullif(trim(p_detail), '') is null
  then return jsonb_build_object('status', 400, 'error', 'Supply the reported action, time, and details.'); end if;

  -- Serialize against a sync for this employee. A later receipt remains a
  -- separate record and is surfaced when the administrator reopens the case.
  perform 1 from public.profiles where id = p_user and role = 'USER' for no key update;
  if not found then return jsonb_build_object('status', 404, 'error', 'Employee was not found.'); end if;
  if exists (select 1 from public.queued_clock_actions a where a.user_id = p_user
    and ((p_action_id is not null and a.action_id = p_action_id)
      or (p_action_id is null and a.payload->>'type' = p_type
        and a.tapped_at between p_reported_at - interval '15 minutes' and p_reported_at + interval '15 minutes')))
  then return jsonb_build_object('status', 409, 'error', 'A matching or nearby server receipt exists. Review it before opening a missing-action case.'); end if;

  insert into public.queued_clock_reviews (user_id, bucket, code, evidence, opened_by)
    values (p_user, 'missing', 'REPORTED_ACTION_MISSING',
      jsonb_build_object('type', p_type, 'reportedAt', p_reported_at, 'detail', p_detail, 'reportedActionId', p_action_id), p_actor)
    returning * into v_case;
  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, request_id)
    values (p_actor, 'OPEN_MISSING_CLOCK_REVIEW', 'QUEUED_CLOCK_REVIEW', v_case.id, p_detail, p_request_id);
  return jsonb_build_object('status', 201, 'review', to_jsonb(v_case));
end;
$$;

create function public.resolve_queued_clock_review(
  p_actor uuid, p_id uuid, p_decision text, p_reason text, p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid;
  v_case public.queued_clock_reviews;
  v_action public.queued_clock_actions;
  v_entry public.time_entries;
  v_schedule public.work_schedules;
  v_project uuid;
  v_entry_id uuid;
  v_dependency uuid;
  v_now timestamptz;
begin
  if not exists (select 1 from public.profiles
    where id = p_actor and role = 'ADMIN' and status = 'ACTIVE' and permanently_deleted_at is null)
  then return jsonb_build_object('status', 403, 'error', 'Administrator access required.'); end if;
  if p_decision is null or p_decision not in ('accepted', 'rejected') or nullif(trim(p_reason), '') is null
  then return jsonb_build_object('status', 400, 'error', 'A decision and reason are required.'); end if;

  select user_id into v_user from public.queued_clock_reviews where id = p_id;
  if not found then return jsonb_build_object('status', 404, 'error', 'Review was not found.'); end if;
  perform 1 from public.profiles where id = v_user for no key update;
  select * into strict v_case from public.queued_clock_reviews where id = p_id for update;
  if v_case.decision is not null
  then return jsonb_build_object('status', 409, 'error', 'This review was already resolved.'); end if;
  v_now := clock_timestamp();

  if p_decision = 'accepted' then
    if v_case.bucket = 'missing' or v_case.code = 'ACTION_PAYLOAD_MISMATCH'
    then return jsonb_build_object('status', 409, 'error', 'This case cannot apply an attendance change. Use the existing correction workflow when appropriate.'); end if;
    if not exists (select 1 from public.profiles where id = v_user and role = 'USER' and status = 'ACTIVE' and permanently_deleted_at is null)
    then return jsonb_build_object('status', 409, 'error', 'The employee is no longer active.'); end if;
    select * into strict v_action from public.queued_clock_actions where user_id = v_user and action_id = v_case.action_id;
    if v_action.status_code is distinct from 409 or v_action.tapped_at > v_now
    then return jsonb_build_object('status', 409, 'error', 'The tap cannot be applied at this time.'); end if;

    if v_action.payload->>'type' = 'clock_out' then
      v_entry_id := (v_action.payload->>'entryId')::uuid;
      v_dependency := (v_action.payload->>'clockInActionId')::uuid;
      if v_dependency is not null then
        select coalesce(a.response->'entry'->>'id', r.accepted_entry->>'id')::uuid into v_entry_id
          from public.queued_clock_actions a left join public.queued_clock_reviews r
            on r.user_id = a.user_id and r.action_id = a.action_id and r.decision = 'accepted'
          where a.user_id = v_user and a.action_id = v_dependency and a.payload->>'type' = 'clock_in';
      end if;
      select * into v_entry from public.time_entries where id = v_entry_id and user_id = v_user for update;
      if not found or v_entry.deleted_at is not null or v_entry.clock_out_at is not null or v_action.tapped_at < v_entry.clock_in_at
      then return jsonb_build_object('status', 409, 'error', 'The shift cannot accept this tap. Use Correct time on the existing entry if a correction is warranted.'); end if;
      update public.time_entries set clock_out_at = v_action.tapped_at, final_note = v_action.payload->>'note'
        where id = v_entry_id returning * into v_entry;
    else
      v_project := (v_action.payload->>'projectId')::uuid;
      perform 1 from public.time_entries where user_id = v_user and deleted_at is null
        and (clock_out_at is null or clock_out_at > v_action.tapped_at) for update;
      if found
      then return jsonb_build_object('status', 409, 'error', 'This tap overlaps an existing shift. Use the existing correction workflow if appropriate.'); end if;
      if v_project is not null and not exists (
        select 1 from public.user_projects up join public.projects p on p.id = up.project_id
        where up.user_id = v_user and up.project_id = v_project and p.is_active)
      then return jsonb_build_object('status', 409, 'error', 'The requested project is no longer available to this employee.'); end if;
      select w.* into v_schedule from public.work_schedules w
        join public.user_schedule_assignments a on a.schedule_id = w.id where a.user_id = v_user;
      insert into public.time_entries (user_id, project_id, clock_in_at, schedule_id, schedule_type,
        scheduled_start_time, scheduled_end_time, target_seconds, scheduled_weekdays)
        values (v_user, v_project, v_action.tapped_at, v_schedule.id, v_schedule.schedule_type,
          v_schedule.start_time, v_schedule.end_time, v_schedule.daily_elapsed_minutes * 60, v_schedule.scheduled_weekdays)
        on conflict (user_id) where clock_out_at is null do nothing returning * into v_entry;
      if not found
      then return jsonb_build_object('status', 409, 'error', 'An active shift already exists.'); end if;
    end if;
  end if;

  if p_decision = 'accepted' and v_action.received_at - v_action.tapped_at > interval '10 minutes'
    and not v_entry.queued_clock_synced_late then
    update public.time_entries set queued_clock_synced_late = true where id = v_entry.id returning * into v_entry;
  end if;

  update public.queued_clock_reviews set decision = p_decision, decision_reason = p_reason,
    decided_at = v_now, decided_by = p_actor,
    accepted_entry = case when p_decision = 'accepted' then to_jsonb(v_entry) end
    where id = p_id returning * into v_case;
  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, request_id)
    values (p_actor, upper(p_decision) || '_QUEUED_CLOCK_REVIEW', 'QUEUED_CLOCK_REVIEW', p_id,
      p_reason || case when v_entry.id is not null then ' (time entry ' || v_entry.id || ')' else '' end, p_request_id);
  return jsonb_build_object('status', 200, 'review', to_jsonb(v_case));
end;
$$;

create function public.queued_clock_weekly_metrics()
returns table (week_manila date, accepted bigint, delayed_10_to_30 bigint, percentage numeric)
language sql stable
set search_path = pg_catalog, public
as $$
  with accepted_actions as (
    select a.received_at, a.tapped_at, coalesce(r.decided_at, a.received_at) as accepted_at
    from public.queued_clock_actions a left join public.queued_clock_reviews r
      on r.user_id = a.user_id and r.action_id = a.action_id and r.decision = 'accepted'
    where a.status_code in (200, 201) or r.id is not null
  ), weeks as (
    select generate_series(date_trunc('week', now() at time zone 'Asia/Manila') - interval '11 weeks',
      date_trunc('week', now() at time zone 'Asia/Manila'), interval '1 week')::date as week_start
  )
  select w.week_start, count(a.accepted_at), count(*) filter (where a.received_at - a.tapped_at > interval '10 minutes'
    and a.received_at - a.tapped_at <= interval '30 minutes'),
    round(100.0 * count(*) filter (where a.received_at - a.tapped_at > interval '10 minutes'
    and a.received_at - a.tapped_at <= interval '30 minutes') / nullif(count(a.accepted_at), 0), 2)
  from weeks w left join accepted_actions a on date_trunc('week', a.accepted_at at time zone 'Asia/Manila')::date = w.week_start
  group by w.week_start order by w.week_start desc;
$$;

revoke all on function public.open_missing_clock_review(uuid, uuid, text, timestamptz, text, uuid, uuid),
  public.resolve_queued_clock_review(uuid, uuid, text, text, uuid),
  public.queued_clock_weekly_metrics() from public, anon, authenticated;
grant execute on function public.open_missing_clock_review(uuid, uuid, text, timestamptz, text, uuid, uuid),
  public.resolve_queued_clock_review(uuid, uuid, text, text, uuid),
  public.queued_clock_weekly_metrics() to service_role;

commit;
