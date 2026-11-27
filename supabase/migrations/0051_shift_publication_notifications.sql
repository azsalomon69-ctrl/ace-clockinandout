-- Part 8: accurate publication notices, change details, and scoped unread counts.
begin;
do $patch$
declare definition text;
begin
 definition:=pg_get_functiondef('public.save_planned_shifts(uuid,uuid,jsonb,uuid)'::regprocedure);
 if position('/* ace_notifications_v2 */' in definition)=0 then
  if position('if old.status=''PUBLISHED'' then' in definition)=0 then raise exception 'PUBLISHED_NOTICE_GUARD_NOT_FOUND';end if;
  definition:=replace(definition,'if old.status=''PUBLISHED'' then','/* ace_notifications_v2 */ if old.status=''PUBLISHED'' and (old.employee_id,old.start_at,old.end_at,old.note) is distinct from (employee,starts,ends,coalesce(r.value->>''note'','''')) then');
  if position('select employee,sid,''UPDATED'',to_jsonb(s) from planned_shifts' in definition)=0 then raise exception 'UPDATED_NOTICE_NOT_FOUND';end if;
  definition:=replace(definition,'select employee,sid,''UPDATED'',to_jsonb(s) from planned_shifts','select employee,sid,case when old.employee_id<>employee then ''PUBLISHED'' else ''UPDATED'' end,to_jsonb(s)||case when old.employee_id=employee then jsonb_build_object(''previous_start_at'',old.start_at,''previous_end_at'',old.end_at) else ''{}''::jsonb end from planned_shifts');
  execute definition;
 end if;
 definition:=pg_get_functiondef('public.change_planned_shift_status(uuid,uuid,uuid[],boolean,uuid)'::regprocedure);
 if position('/* ace_published_snapshot */' in definition)=0 then
  if position('values(s.employee_id,s.id,''PUBLISHED'',to_jsonb(s))' in definition)=0 then raise exception 'PUBLISHED_SNAPSHOT_NOT_FOUND';end if;
  definition:=replace(definition,'values(s.employee_id,s.id,''PUBLISHED'',to_jsonb(s))','/* ace_published_snapshot */ values(s.employee_id,s.id,''PUBLISHED'',(select to_jsonb(published) from planned_shifts published where published.id=s.id))');execute definition;
 end if;
end $patch$;
create or replace function public.employee_shift_schedule(p_actor uuid,p_from date,p_to date) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from profiles where id=p_actor and role='USER' and status='ACTIVE' and permanently_deleted_at is null) then raise exception 'SHIFT_EMPLOYEE_UNAVAILABLE';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>93 then raise exception 'SHIFT_INVALID_RANGE';end if;
 update planned_shifts set status='NO_SHOW',updated_at=clock_timestamp() where employee_id=p_actor and status='PUBLISHED' and start_at+make_interval(mins=>(select grace_minutes from shift_planning_settings where id))<clock_timestamp();
 return jsonb_build_object('shifts',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('project_name',p.name) order by s.start_at) from planned_shifts s join projects p on p.id=s.project_id where s.employee_id=p_actor and s.status<>'DRAFT' and s.start_at<((p_to+1)::timestamp at time zone 'Asia/Manila') and s.end_at>(p_from::timestamp at time zone 'Asia/Manila')),'[]'::jsonb),
 'unread_updates',(select count(*) from shift_notifications where employee_id=p_actor and seen_at is null),
 'availability',coalesce((select jsonb_agg(to_jsonb(a) order by a.start_at) from employee_availability a where a.employee_id=p_actor and a.start_at<((p_to+1)::timestamp at time zone 'Asia/Manila') and a.end_at>(p_from::timestamp at time zone 'Asia/Manila')),'[]'::jsonb),
 'notifications',coalesce((select jsonb_agg(to_jsonb(n)||jsonb_build_object('details',n.details||jsonb_build_object('project_name',p.name)) order by n.created_at desc,n.id) from (select * from shift_notifications where employee_id=p_actor order by created_at desc,id limit 50)n left join projects p on p.id::text=n.details->>'project_id'),'[]'::jsonb));
end $$;
revoke all on function public.employee_shift_schedule(uuid,date,date) from public,anon,authenticated;
grant execute on function public.employee_shift_schedule(uuid,date,date) to service_role;
notify pgrst,'reload schema';
commit;
select 'READY' as status,position('ace_notifications_v2' in pg_get_functiondef('public.save_planned_shifts(uuid,uuid,jsonb,uuid)'::regprocedure))>0 as change_notices_ready,position('unread_updates' in pg_get_functiondef('public.employee_shift_schedule(uuid,date,date)'::regprocedure))>0 as unread_counts_ready,not has_function_privilege('authenticated','public.employee_shift_schedule(uuid,date,date)','EXECUTE') as direct_access_blocked;
