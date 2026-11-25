-- Activity tracking and admin missed-shift release.
-- Run this ENTIRE script in Supabase SQL Editor, separately in staging and production.
-- Requires the existing application schema through migration 0037.
-- Safe to rerun. No attendance rows are inserted, updated, or deleted.
-- One transaction prevents partially installed activity/clock-out functions.
begin;
create temporary table ace_activity_release_counts on commit drop as
select count(*) as entries, coalesce(sum(duration_seconds),0) as worked_seconds from public.time_entries;

-- 0038_project_activities.sql
-- Project activity blocks share the parent shift's attendance interval.
alter table public.time_entries add column if not exists activities jsonb not null default '[]'::jsonb;
alter table public.time_entries add column if not exists final_activity_project_id uuid references public.projects(id);

create or replace function public.record_project_activity(
  p_actor uuid, p_entry uuid, p_project uuid, p_description text, p_action uuid,
  p_now timestamptz default clock_timestamp()
) returns public.time_entries language plpgsql security definer set search_path = public as $$
declare
  v_entry public.time_entries;
  v_start timestamptz;
  v_name text;
begin
  select * into v_entry from public.time_entries where id = p_entry and user_id = p_actor and deleted_at is null for update;
  if not found then raise exception 'ENTRY_NOT_FOUND'; end if;
  if exists (select 1 from jsonb_array_elements(v_entry.activities) a where a->>'id' = p_action::text) then
    if exists(select 1 from jsonb_array_elements(v_entry.activities) a
      where a->>'id'=p_action::text and (a->>'project_id' is distinct from p_project::text or a->>'description' is distinct from trim(p_description))) then
      raise exception 'ACTIVITY_PAYLOAD_MISMATCH';
    end if;
    return v_entry;
  end if;
  if v_entry.clock_out_at is not null then raise exception 'ENTRY_ALREADY_CLOSED'; end if;
  if p_action is null or p_description is null or length(trim(p_description)) not between 1 and 50 then raise exception 'INVALID_ACTIVITY'; end if;
  select p.name into v_name from public.projects p join public.user_projects u on u.project_id=p.id
    where p.id=p_project and u.user_id=p_actor and p.is_active = true;
  if not found then raise exception 'PROJECT_NOT_ASSIGNED'; end if;
  v_start := coalesce((v_entry.activities->-1->>'ended_at')::timestamptz, v_entry.clock_in_at);
  if v_entry.break_started_at is not null then raise exception 'ACTIVITY_TIME_CONFLICT: end the break first'; end if;
  if p_now <= v_start then raise exception 'ACTIVITY_TIME_CONFLICT'; end if;
  update public.time_entries set activities = activities || jsonb_build_array(jsonb_build_object(
    'id',p_action,'project_id',p_project,'project_name',v_name,'description',trim(p_description),
    'started_at',v_start,'ended_at',p_now,
    'duration_seconds',greatest(0,floor(extract(epoch from (p_now-v_entry.clock_in_at)))::bigint-v_entry.break_seconds)
      - coalesce((select sum((a->>'duration_seconds')::bigint) from jsonb_array_elements(v_entry.activities) a),0)
  )) where id=p_entry returning * into v_entry;
  insert into public.audit_logs(user_id,action,entity_type,entity_id,description)
    values(p_actor,'RECORD_PROJECT_ACTIVITY','TIME_ENTRY',p_entry,'Recorded project activity');
  return v_entry;
end $$;
revoke all on function public.record_project_activity(uuid,uuid,uuid,text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.record_project_activity(uuid,uuid,uuid,text,uuid,timestamptz) to service_role;

create or replace function public.finish_project_activities()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_start timestamptz;
  v_project uuid;
  v_name text;
  v_payload jsonb;
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
  v_start := coalesce((new.activities->-1->>'ended_at')::timestamptz,new.clock_in_at);
  if new.clock_out_at < v_start then raise exception 'ACTIVITY_TIME_CONFLICT: clock-out precedes an activity'; end if;
  v_project := new.final_activity_project_id;
  -- Queued actions are inserted in the same transaction before the shift closes.
  if v_project is null then
    select payload into v_payload from public.queued_clock_actions
      where user_id=new.user_id and tapped_at=new.clock_out_at and payload->>'type'='clock_out'
      order by received_at desc limit 1;
    v_project := (v_payload->>'activityProjectId')::uuid;
  end if;
  if v_project is not null then
    select p.name into v_name from public.projects p join public.user_projects u on u.project_id=p.id
      where p.id=v_project and u.user_id=new.user_id and p.is_active=true;
    if not found then raise exception 'PROJECT_NOT_ASSIGNED'; end if;
  end if;
  -- Old clients and administrative stops retain their remaining time explicitly unallocated.
  new.activities := new.activities || jsonb_build_array(jsonb_build_object(
    'id',gen_random_uuid(),'project_id',v_project,'project_name',coalesce(v_name,'Unallocated'),
    'description',coalesce(new.final_note,'Shift ended'),'started_at',v_start,'ended_at',new.clock_out_at,
    'duration_seconds',greatest(0,floor(extract(epoch from (new.clock_out_at-new.clock_in_at)))::bigint-new.break_seconds)
      - coalesce((select sum((a->>'duration_seconds')::bigint) from jsonb_array_elements(new.activities) a),0)));
  return new;
end $$;
drop trigger if exists finish_project_activities on public.time_entries;
create trigger finish_project_activities before update on public.time_entries
for each row execute function public.finish_project_activities();

create or replace function public.clock_out_project_entry(
  p_actor uuid,p_entry uuid,p_role text,p_project uuid,p_note text,p_now timestamptz,
  p_ip inet default null,p_agent text default null
) returns public.time_entries language plpgsql security definer set search_path=public as $$
declare v_entry public.time_entries;
begin
  update public.time_entries set final_activity_project_id=p_project
    where id=p_entry and clock_out_at is null and (user_id=p_actor or p_role='ADMIN');
  select * into v_entry from public.clock_out_entry(p_actor,p_entry,p_role,p_note,p_now,p_ip,p_agent);
  return v_entry;
end $$;
revoke all on function public.clock_out_project_entry(uuid,uuid,text,uuid,text,timestamptz,inet,text) from public,anon,authenticated;
grant execute on function public.clock_out_project_entry(uuid,uuid,text,uuid,text,timestamptz,inet,text) to service_role;


-- 0039_optional_activity_project.sql
create or replace function public.record_project_activity(
  p_actor uuid, p_entry uuid, p_project uuid, p_description text, p_action uuid,
  p_now timestamptz default clock_timestamp()
) returns public.time_entries language plpgsql security definer set search_path = public as $$
declare
  v_entry public.time_entries;
  v_start timestamptz;
  v_name text;
begin
  select * into v_entry from public.time_entries where id = p_entry and user_id = p_actor and deleted_at is null for update;
  if not found then raise exception 'ENTRY_NOT_FOUND'; end if;
  if exists (select 1 from jsonb_array_elements(v_entry.activities) a where a->>'id' = p_action::text) then
    if exists(select 1 from jsonb_array_elements(v_entry.activities) a
      where a->>'id'=p_action::text and (a->>'project_id' is distinct from p_project::text or a->>'description' is distinct from trim(p_description))) then
      raise exception 'ACTIVITY_PAYLOAD_MISMATCH';
    end if;
    return v_entry;
  end if;
  if v_entry.clock_out_at is not null then raise exception 'ENTRY_ALREADY_CLOSED'; end if;
  if p_action is null or p_description is null or length(trim(p_description)) not between 1 and 50 then raise exception 'INVALID_ACTIVITY'; end if;
  v_name := 'No project';
  if p_project is not null then
    select p.name into v_name from public.projects p join public.user_projects u on u.project_id=p.id
      where p.id=p_project and u.user_id=p_actor and p.is_active = true;
    if not found then raise exception 'PROJECT_NOT_ASSIGNED'; end if;
  end if;
  v_start := coalesce((v_entry.activities->-1->>'ended_at')::timestamptz, v_entry.clock_in_at);
  if v_entry.break_started_at is not null then raise exception 'ACTIVITY_TIME_CONFLICT: end the break first'; end if;
  if p_now <= v_start then raise exception 'ACTIVITY_TIME_CONFLICT'; end if;
  update public.time_entries set activities = activities || jsonb_build_array(jsonb_build_object(
    'id',p_action,'project_id',p_project,'project_name',v_name,'description',trim(p_description),
    'started_at',v_start,'ended_at',p_now,
    'duration_seconds',greatest(0,floor(extract(epoch from (p_now-v_entry.clock_in_at)))::bigint-v_entry.break_seconds)
      - coalesce((select sum((a->>'duration_seconds')::bigint) from jsonb_array_elements(v_entry.activities) a),0)
  )) where id=p_entry returning * into v_entry;
  insert into public.audit_logs(user_id,action,entity_type,entity_id,description)
    values(p_actor,'RECORD_PROJECT_ACTIVITY','TIME_ENTRY',p_entry,'Recorded project activity');
  return v_entry;
end $$;
revoke all on function public.record_project_activity(uuid,uuid,uuid,text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.record_project_activity(uuid,uuid,uuid,text,uuid,timestamptz) to service_role;


-- 0040_activity_elapsed_time.sql
-- Remove obsolete break-column references from the activity functions.

do $repair$
declare
  function_id regprocedure;
  definition text;
begin
  foreach function_id in array array[
    'public.record_project_activity(uuid,uuid,uuid,text,uuid,timestamptz)'::regprocedure,
    'public.finish_project_activities()'::regprocedure
  ] loop
    definition := pg_get_functiondef(function_id);
    definition := regexp_replace(
      definition,
      'if\s+v_entry\.break_started_at\s+is\s+not\s+null\s+then\s+raise\s+exception\s+''[^'']*'';\s*end\s+if;',
      '',
      'gi'
    );
    definition := regexp_replace(
      definition,
      '\s*-\s*(v_entry|new)\.break_seconds',
      '',
      'gi'
    );
    if definition ~* 'break_started_at|break_seconds' then
      raise exception 'Unexpected break reference in %', function_id;
    end if;
    execute definition;
  end loop;
end;
$repair$;
notify pgrst, 'reload schema';


-- 0041_running_activities.sql

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


-- 0042_admin_manual_time_entries.sql

alter table public.time_entries
  add column if not exists manual_created_by uuid references public.profiles(id),
  add column if not exists manual_reason text;

-- Use the queue's employee lock too. Ordinary attendance remains unchanged,
-- except that it cannot overlap an administrator-entered interval.
create or replace function public.guard_manual_time_overlap() returns trigger
language plpgsql set search_path = public as $$
begin
  perform 1 from public.profiles where id = new.user_id for no key update;
  if new.deleted_at is null and exists (
    select 1 from public.time_entries e
    where e.user_id = new.user_id and e.id <> new.id and e.deleted_at is null
      and (new.manual_created_by is not null or e.manual_created_by is not null)
      and e.clock_in_at < coalesce(new.clock_out_at, 'infinity'::timestamptz)
      and coalesce(e.clock_out_at, 'infinity'::timestamptz) > new.clock_in_at
  ) then
    raise exception 'TIME_ENTRY_OVERLAP' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_manual_time_overlap on public.time_entries;
create trigger guard_manual_time_overlap before insert or update of clock_in_at, clock_out_at, deleted_at
on public.time_entries for each row execute function public.guard_manual_time_overlap();

create or replace function public.admin_add_time_entry(
  p_actor uuid, p_employee uuid, p_entry uuid, p_clock_in timestamptz,
  p_clock_out timestamptz, p_project uuid, p_reason text,
  p_ip inet default null, p_agent text default null, p_request uuid default null
) returns public.time_entries language plpgsql security definer set search_path = public as $$
declare
  v_entry public.time_entries;
begin
  if not exists(select 1 from public.profiles where id=p_actor and role='ADMIN'
    and status='ACTIVE' and permanently_deleted_at is null) then
    raise exception 'ADMIN_REQUIRED' using errcode='P0001';
  end if;
  perform 1 from public.profiles where id=p_employee and role='USER'
    and permanently_deleted_at is null for no key update;
  if not found then raise exception 'EMPLOYEE_NOT_FOUND' using errcode='P0001'; end if;
  if p_entry is null or p_clock_in is null or p_clock_out is null
    or not isfinite(p_clock_in) or not isfinite(p_clock_out)
    or p_clock_out <= p_clock_in or p_clock_out > clock_timestamp()
    or p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'INVALID_MANUAL_ENTRY' using errcode='P0001';
  end if;
  select * into v_entry from public.time_entries where id=p_entry;
  if found then
    if v_entry.user_id=p_employee and v_entry.manual_created_by=p_actor
      and v_entry.clock_in_at=p_clock_in and v_entry.clock_out_at=p_clock_out
      and v_entry.project_id is not distinct from p_project
      and v_entry.manual_reason=btrim(p_reason) and v_entry.deleted_at is null then
      return v_entry;
    end if;
    raise exception 'MANUAL_ENTRY_CONFLICT' using errcode='P0001';
  end if;
  if p_project is not null and not exists(select 1 from public.projects where id=p_project and is_active) then
    raise exception 'PROJECT_UNAVAILABLE' using errcode='P0001';
  end if;
  -- Historical schedule assignments cannot be reconstructed reliably. Leave
  -- the schedule snapshot empty rather than inventing retrospective compliance.
  insert into public.time_entries(id,user_id,project_id,clock_in_at,clock_out_at,manual_created_by,manual_reason)
  values(p_entry,p_employee,p_project,p_clock_in,p_clock_out,p_actor,btrim(p_reason)) returning * into v_entry;
  insert into public.audit_logs(user_id,action,entity_type,entity_id,description,ip_address,user_agent,request_id)
  values(p_actor,'ADMIN_ADD_TIME_ENTRY','TIME_ENTRY',v_entry.id,
    format('Added missed shift for %s from %s to %s. Reason: %s',p_employee,p_clock_in,p_clock_out,btrim(p_reason)),p_ip,p_agent,p_request);
  return v_entry;
end;
$$;
revoke all on function public.admin_add_time_entry(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text,inet,text,uuid) from public,anon,authenticated;
grant execute on function public.admin_add_time_entry(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text,inet,text,uuid) to service_role;

notify pgrst, 'reload schema';


do $verify$
begin
 if (select entries from ace_activity_release_counts) <> (select count(*) from public.time_entries)
 or (select worked_seconds from ace_activity_release_counts) <> (select coalesce(sum(duration_seconds),0) from public.time_entries) then
  raise exception 'Attendance data changed unexpectedly; release cancelled';
 end if;
 if pg_get_functiondef('public.finish_project_activities()'::regprocedure) ~* 'break_started_at|break_seconds' then
  raise exception 'Clock-out function contains retired break columns; release cancelled';
 end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.time_entries'::regclass
   and tgname='finish_project_activities' and tgenabled='O') then
  raise exception 'Activity clock-out trigger is not enabled; release cancelled';
 end if;
 if has_function_privilege('authenticated','public.admin_add_time_entry(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text,inet,text,uuid)','EXECUTE') then
  raise exception 'Unexpected manual-entry RPC permission; release cancelled';
 end if;
end;
$verify$;
notify pgrst, 'reload schema';
commit;

select 'READY' as activity_release,
 (select count(*) from public.time_entries) as preserved_time_entries,
 exists(select 1 from pg_trigger where tgrelid='public.time_entries'::regclass and tgname='finish_project_activities' and tgenabled='O') as clock_out_trigger_enabled,
 to_regprocedure('public.change_project_activity(uuid,uuid,text,text,uuid,uuid,timestamptz)') is not null as running_activities_available,
 to_regprocedure('public.admin_add_time_entry(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text,inet,text,uuid)') is not null as manual_entries_available;
