begin;

create or replace function public.change_project_activity(
  p_actor uuid, p_entry uuid, p_description text, p_note text, p_action uuid,
  p_expected_activity uuid default null, p_now timestamptz default clock_timestamp()
) returns public.time_entries language plpgsql security definer set search_path=public as $$
declare
  v_entry public.time_entries;
  v_last jsonb;
  v_project_name text;
  v_start timestamptz;
  v_seconds bigint;
begin
  select * into v_entry from public.time_entries where id=p_entry and user_id=p_actor and deleted_at is null for update;
  if not found then raise exception 'ENTRY_NOT_FOUND'; end if;
  if p_action is null or p_description is null or length(trim(p_description)) not between 1 and 50
     or length(coalesce(p_note,''))>1000 then raise exception 'INVALID_ACTIVITY'; end if;
  select a into v_last from jsonb_array_elements(v_entry.activities) a where a->>'id'=p_action::text;
  if found then
    if v_last->>'description' is distinct from trim(p_description) or coalesce(v_last->>'note','') is distinct from coalesce(trim(p_note),'') then
      raise exception 'ACTIVITY_PAYLOAD_MISMATCH';
    end if;
    return v_entry;
  end if;
  if v_entry.clock_out_at is not null then raise exception 'ENTRY_ALREADY_CLOSED'; end if;
  v_last := v_entry.activities->-1;
  if (case when v_last is not null and v_last->>'ended_at' is null then (v_last->>'id')::uuid else null end)
       is distinct from p_expected_activity then raise exception 'ACTIVITY_CHANGED'; end if;
  select name into v_project_name from public.projects where id=v_entry.project_id;
  v_start := coalesce((v_last->>'ended_at')::timestamptz,(v_last->>'started_at')::timestamptz,v_entry.clock_in_at);
  if p_now < v_start then raise exception 'ACTIVITY_TIME_CONFLICT'; end if;
  v_seconds := greatest(0,extract(epoch from (p_now-v_entry.clock_in_at))::bigint)
    - coalesce((select sum((a->>'duration_seconds')::bigint) from jsonb_array_elements(v_entry.activities) a where a->>'ended_at' is not null),0);
  if v_last is not null and v_last->>'ended_at' is null then
    v_entry.activities := jsonb_set(v_entry.activities,array[(jsonb_array_length(v_entry.activities)-1)::text],
      v_last || jsonb_build_object('ended_at',p_now,'duration_seconds',v_seconds));
  elsif v_seconds>0 then
    v_entry.activities := v_entry.activities || jsonb_build_array(jsonb_build_object(
      'id',gen_random_uuid(),'project_id',v_entry.project_id,'project_name',coalesce(v_project_name,'No project'),
      'description','No activity recorded','started_at',v_start,'ended_at',p_now,'duration_seconds',v_seconds));
  end if;
  v_entry.activities := v_entry.activities || jsonb_build_array(jsonb_build_object(
    'id',p_action,'project_id',v_entry.project_id,'project_name',coalesce(v_project_name,'No project'),
    'description',trim(p_description),'note',coalesce(trim(p_note),''),'started_at',p_now,'ended_at',null,'duration_seconds',0));
  update public.time_entries set activities=v_entry.activities where id=p_entry returning * into v_entry;
  insert into public.audit_logs(user_id,action,entity_type,entity_id,description)
    values(p_actor,'CHANGE_ACTIVITY','TIME_ENTRY',p_entry,'Started a new activity within the running shift');
  return v_entry;
end $$;
revoke all on function public.change_project_activity(uuid,uuid,text,text,uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.change_project_activity(uuid,uuid,text,text,uuid,uuid,timestamptz) to service_role;

create or replace function public.finish_project_activities()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_last jsonb;
  v_start timestamptz;
  v_project uuid;
  v_name text;
  v_payload jsonb;
  v_seconds bigint;
begin
  if new.clock_in_at is distinct from old.clock_in_at and jsonb_array_length(old.activities)>0 then
    raise exception 'ACTIVITY_TIME_CONFLICT: recorded activities prevent changing clock-in';
  end if;
  if new.clock_out_at is null or old.clock_out_at is not null then
    if new.clock_out_at is distinct from old.clock_out_at and jsonb_array_length(old.activities)>0 then
      raise exception 'ACTIVITY_TIME_CONFLICT: recorded activities prevent changing clock-out';
    end if;
    return new;
  end if;
  v_last := new.activities->-1;
  v_start := coalesce((v_last->>'ended_at')::timestamptz,(v_last->>'started_at')::timestamptz,new.clock_in_at);
  if new.clock_out_at < v_start then raise exception 'ACTIVITY_TIME_CONFLICT: clock-out precedes an activity'; end if;
  v_seconds := greatest(0,extract(epoch from (new.clock_out_at-new.clock_in_at))::bigint)
    - coalesce((select sum((a->>'duration_seconds')::bigint) from jsonb_array_elements(new.activities) a where a->>'ended_at' is not null),0);
  if v_last is not null and v_last->>'ended_at' is null then
    new.activities := jsonb_set(new.activities,array[(jsonb_array_length(new.activities)-1)::text],
      v_last || jsonb_build_object('ended_at',new.clock_out_at,'duration_seconds',v_seconds,
        'completion_note',coalesce(new.final_note,'')));
    return new;
  end if;
  v_project := coalesce(new.final_activity_project_id,new.project_id);
  if v_project is null then
    select payload into v_payload from public.queued_clock_actions where user_id=new.user_id
      and tapped_at=new.clock_out_at and payload->>'type'='clock_out' order by received_at desc limit 1;
    v_project := (v_payload->>'activityProjectId')::uuid;
  end if;
  select name into v_name from public.projects where id=v_project;
  new.activities := new.activities || jsonb_build_array(jsonb_build_object(
    'id',gen_random_uuid(),'project_id',v_project,'project_name',coalesce(v_name,'No project'),
    'description',coalesce(new.final_note,'Shift ended'),'started_at',v_start,
    'ended_at',new.clock_out_at,'duration_seconds',v_seconds));
  return new;
end $$;
-- An older offline clock-out must be reviewed if another device already started
-- an activity after that tap. Keep its saved receipt instead of retrying forever.
do $queue$
declare definition text;
begin
  if to_regprocedure('public.sync_queued_clock_action(uuid,uuid,uuid,jsonb,timestamptz,inet,text,uuid)') is not null then
    definition := pg_get_functiondef('public.sync_queued_clock_action(uuid,uuid,uuid,jsonb,timestamptz,inet,text,uuid)'::regprocedure);
    if position('TAP_BEFORE_ACTIVITY' in definition)=0 then
      if position('elsif v_tap < v_entry.clock_in_at then' in definition)=0 then
        raise exception 'Queued clock function differs from the expected staging version';
      end if;
      definition := replace(definition,'elsif v_tap < v_entry.clock_in_at then',
        'elsif v_tap < coalesce((v_entry.activities->-1->>''started_at'')::timestamptz,v_entry.clock_in_at) and v_tap >= v_entry.clock_in_at then
           v_reason := ''TAP_BEFORE_ACTIVITY'';
           v_bucket := ''integrity'';
         elsif v_tap < v_entry.clock_in_at then');
      execute definition;
    end if;
  end if;
end;
$queue$;
notify pgrst,'reload schema';
commit;
