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
