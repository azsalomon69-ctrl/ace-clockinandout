begin;

create table public.clock_sync_anchors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  session_id uuid not null,
  server_at timestamptz not null default clock_timestamp()
);
create index clock_sync_anchors_server_at_idx on public.clock_sync_anchors(server_at);

create table public.queued_clock_actions (
  user_id uuid not null references public.profiles(id),
  action_id uuid not null,
  payload jsonb not null,
  tapped_at timestamptz not null,
  received_at timestamptz not null,
  clock_error_ms bigint,
  status_code integer,
  response jsonb,
  primary key (user_id, action_id)
);
create index queued_clock_actions_review_idx on public.queued_clock_actions(received_at desc)
  where status_code = 409;

alter table public.clock_sync_anchors enable row level security;
alter table public.queued_clock_actions enable row level security;
revoke all on public.clock_sync_anchors, public.queued_clock_actions from public, anon, authenticated;
grant select, insert on public.clock_sync_anchors to service_role;
grant select on public.queued_clock_actions to service_role;

create function public.sync_queued_clock_action(
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
  v_schedule public.work_schedules;
  v_reason text;
  v_bucket text := 'integrity';
  v_status integer;
  v_response jsonb;
  v_first_received_at timestamptz := p_received_at;
  v_device text := case when p_user_agent ~* 'Android|iPhone|iPad|iPod|Mobile|Windows Phone|IEMobile' then 'mobile' else 'pc web' end;
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

  insert into public.queued_clock_actions (user_id, action_id, payload, tapped_at, received_at)
    values (p_user_id, p_action_id, p_payload, v_tap, p_received_at)
    on conflict (user_id, action_id) do nothing returning action_id into v_claim;
  if not found then
    select * into strict v_previous from public.queued_clock_actions
      where user_id = p_user_id and action_id = p_action_id;
    if v_previous.payload is distinct from p_payload then
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
      if not found or v_previous.payload->>'type' <> 'clock_in' or v_previous.status_code <> 201 then
        v_response := jsonb_build_object('code', 'CLOCK_IN_NOT_CONFIRMED');
        update public.queued_clock_actions set status_code = 425, response = v_response
          where user_id = p_user_id and action_id = p_action_id;
        return jsonb_build_object('status', 425, 'body', v_response);
      end if;
      v_entry_id := (v_previous.response->'entry'->>'id')::uuid;
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
    v_status := case when v_type = 'clock_in' then 201 else 200 end;
    v_response := jsonb_build_object('state', 'confirmed', 'entry', to_jsonb(v_entry),
      'receivedAt', v_first_received_at, 'acceptedLate', v_tap < p_received_at - interval '10 minutes');
    insert into public.audit_logs (user_id, action, entity_type, entity_id, description, ip_address, user_agent, request_id)
      values (p_user_id, upper(v_type) || ' (' || v_device || ')', 'TIME_ENTRY', v_entry.id,
        'Synced queued clock action ' || p_action_id, p_ip_address, p_user_agent, p_request_id);
  else
    v_status := 409;
    v_response := jsonb_build_object('state', 'needs_review', 'bucket', v_bucket,
      'code', v_reason, 'actionId', p_action_id, 'receivedAt', v_first_received_at);
  end if;
  update public.queued_clock_actions
    set status_code = v_status, response = v_response, clock_error_ms = v_clock_error
    where user_id = p_user_id and action_id = p_action_id;
  return jsonb_build_object('status', v_status, 'body', v_response);
end;
$$;

revoke all on function public.sync_queued_clock_action(uuid, uuid, uuid, jsonb, timestamptz, inet, text, uuid)
  from public, anon, authenticated;
grant execute on function public.sync_queued_clock_action(uuid, uuid, uuid, jsonb, timestamptz, inet, text, uuid)
  to service_role;

commit;
