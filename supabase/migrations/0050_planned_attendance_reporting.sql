-- Part 6: read-only planned versus actual attendance. Apply after 0049 on staging.
begin;
create or replace function public.client_attendance_v3(p_actor uuid,p_projects uuid[],p_from date,p_to date,p_status text default null,p_page integer default 1,p_size integer default 25,p_employee uuid default null,p_view text default 'shifts',p_attendance text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare allowed uuid[]; result jsonb; at_time timestamptz:=statement_timestamp(); today date:=(statement_timestamp() at time zone 'Asia/Manila')::date; grace integer;
begin
 if not exists(select 1 from profiles where id=p_actor and role in ('CLIENT','USER') and status='ACTIVE' and permanently_deleted_at is null) then raise exception 'CLIENT_ACCESS_REQUIRED';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 or p_page is null or p_page<1 or p_page>100000 or p_size is null or p_size<1 or p_size>10000 or p_view is null or p_view not in ('shifts','employees') or (p_status is not null and p_status not in ('ACTIVE','COMPLETED')) or (p_attendance is not null and p_attendance not in ('ON_TIME','LATE','NO_SHOW','UNSCHEDULED','PLANNED','WAITING')) then raise exception 'INVALID_FILTERS';end if;
 select coalesce(array_agg(project_id),'{}'::uuid[]) into allowed from client_project_access where user_id=p_actor and revoked_at is null;
 if cardinality(allowed)=0 then raise exception 'CLIENT_ACCESS_REQUIRED';end if;
 if p_projects is not null and (array_position(p_projects,null) is not null or not(p_projects<@allowed)) then raise exception 'PROJECT_ACCESS_DENIED';end if;
 allowed:=coalesce(p_projects,allowed);
 select grace_minutes into grace from shift_planning_settings where id;
 with actual as (
  select e.id,e.user_id,e.project_id,e.clock_in_at,e.clock_out_at,
   greatest(0,coalesce(e.duration_seconds,extract(epoch from(at_time-e.clock_in_at))::integer)-coalesce((select sum(greatest(0,(x->>'duration_seconds')::integer)) from jsonb_array_elements(e.activities) x where x->>'project_id' is distinct from e.project_id::text),0))::bigint as worked_seconds,
   coalesce((select jsonb_agg(jsonb_build_object('description',x->>'description','started_at',x->>'started_at','ended_at',x->>'ended_at','duration_seconds',x->'duration_seconds') order by x->>'started_at') from jsonb_array_elements(e.activities) x where x->>'project_id'=e.project_id::text and coalesce(x->>'description','') not in ('','No activity recorded')),'[]'::jsonb) as activities,
   s.id as planned_shift_id,s.start_at as planned_start_at,s.end_at as planned_end_at
  from time_entries e left join planned_shifts s on s.id=e.planned_shift_id and s.project_id=e.project_id and s.employee_id=e.user_id and s.status not in ('DRAFT','CANCELLED')
  where e.deleted_at is null and e.project_id=any(allowed)
 ), combined as (
  select * from actual
  union all
  select s.id,s.employee_id,s.project_id,null::timestamptz,null::timestamptz,0::bigint,'[]'::jsonb,s.id,s.start_at,s.end_at
  from planned_shifts s where s.project_id=any(allowed) and s.status not in ('DRAFT','CANCELLED') and not exists(select 1 from time_entries e where e.planned_shift_id=s.id and e.deleted_at is null and e.user_id=s.employee_id and e.project_id=s.project_id)
 ), dated as (
  select c.*,p.name as project_name,u.full_name as employee_name,u.profile_picture_url as employee_picture_url,
   case when c.clock_in_at is not null then case when c.planned_start_at is null then 'UNSCHEDULED' when c.clock_in_at>c.planned_start_at+make_interval(mins=>coalesce(grace,15)) then 'LATE' else 'ON_TIME' end
    when at_time>c.planned_start_at+make_interval(mins=>coalesce(grace,15)) then 'NO_SHOW' when at_time>=c.planned_start_at then 'WAITING' else 'PLANNED' end as attendance_status,
   case when c.clock_in_at is not null and c.planned_start_at is not null then floor(extract(epoch from(c.clock_in_at-c.planned_start_at))/60)::integer end as arrival_difference_minutes,
   case when c.clock_out_at is not null and c.planned_start_at is not null then floor((c.worked_seconds-extract(epoch from(c.planned_end_at-c.planned_start_at)))/60)::integer end as difference_minutes
  from combined c join profiles u on u.id=c.user_id join projects p on p.id=c.project_id
  where case when p_status='ACTIVE' then (c.clock_in_at is not null and c.clock_out_at is null) or (coalesce(c.clock_in_at,c.planned_start_at) at time zone 'Asia/Manila')::date=today or (c.clock_out_at at time zone 'Asia/Manila')::date=today or (c.clock_in_at is null and (c.planned_end_at at time zone 'Asia/Manila')::date=today)
   else coalesce(c.clock_in_at,c.planned_start_at)>=(p_from::timestamp at time zone 'Asia/Manila') and coalesce(c.clock_in_at,c.planned_start_at)<((p_to+1)::timestamp at time zone 'Asia/Manila') end
   and (p_status is distinct from 'COMPLETED' or c.clock_out_at is not null)
 ), scoped as(select * from dated where (p_employee is null or user_id=p_employee) and (p_attendance is null or attendance_status=p_attendance)),
 summaries as(select user_id,max(employee_name) as employee_name,max(employee_picture_url) as employee_picture_url,array_agg(distinct project_name order by project_name) as project_names,
  count(*) as shifts,count(*) filter(where clock_in_at is not null and clock_out_at is null) as active,coalesce(sum(worked_seconds),0) as worked_seconds,
  count(*) filter(where attendance_status='LATE') as late,count(*) filter(where attendance_status='NO_SHOW') as absences,
  coalesce(sum(extract(epoch from(planned_end_at-planned_start_at))),0)::bigint as planned_seconds from scoped group by user_id),
 page_rows as(select * from scoped order by coalesce(clock_in_at,planned_start_at) desc,id limit p_size offset ((p_page::bigint-1)*p_size)),
 summary_rows as(select * from summaries order by employee_name,user_id limit p_size offset ((p_page::bigint-1)*p_size))
 select jsonb_build_object('items',case when p_view='employees' then coalesce((select jsonb_agg(to_jsonb(r) order by employee_name,user_id) from summary_rows r),'[]'::jsonb) else coalesce((select jsonb_agg(to_jsonb(r) order by coalesce(clock_in_at,planned_start_at) desc,id) from page_rows r),'[]'::jsonb) end,
  'total',case when p_view='employees' then (select count(*) from summaries) else (select count(*) from scoped) end,'shifts',(select count(*) from scoped),'worked_seconds',(select coalesce(sum(worked_seconds),0) from scoped),
  'active',(select count(*) from scoped where clock_in_at is not null and clock_out_at is null),'employees',(select count(distinct user_id) from scoped),
  'not_arrived',(select count(*) from scoped where clock_in_at is null),'late',(select count(*) from scoped where attendance_status='LATE'),'absences',(select count(*) from scoped where attendance_status='NO_SHOW'),
  'finished_today',(select count(*) from scoped where (clock_out_at at time zone 'Asia/Manila')::date=today),
  'employee_options',coalesce((select jsonb_agg(jsonb_build_object('id',user_id,'name',employee_name) order by employee_name,user_id) from(select distinct user_id,employee_name from dated)e),'[]'::jsonb),'page',p_page,'pageSize',p_size,'as_of',at_time) into result;
 return result;
end $$;
revoke all on function public.client_attendance_v3(uuid,uuid[],date,date,text,integer,integer,uuid,text,text) from public,anon,authenticated;
grant execute on function public.client_attendance_v3(uuid,uuid[],date,date,text,integer,integer,uuid,text,text) to service_role;
notify pgrst,'reload schema';
commit;
select 'READY' as status,to_regprocedure('public.client_attendance_v3(uuid,uuid[],date,date,text,integer,integer,uuid,text,text)') is not null as reporting_ready,has_function_privilege('service_role','public.client_attendance_v3(uuid,uuid[],date,date,text,integer,integer,uuid,text,text)','EXECUTE') as api_allowed,not has_function_privilege('authenticated','public.client_attendance_v3(uuid,uuid[],date,date,text,integer,integer,uuid,text,text)','EXECUTE') as direct_access_blocked;
