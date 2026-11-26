-- Staging Part 1: additive read-only filters and employee summaries.
-- Preserves the original RPC for older deployed API instances.
begin;
create or replace function public.client_attendance_v2(p_actor uuid,p_projects uuid[],p_from date,p_to date,p_status text default null,p_page integer default 1,p_size integer default 25,p_employee uuid default null,p_view text default 'shifts')
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_allowed uuid[]; v_result jsonb;
begin
 if not exists(select 1 from profiles where id=p_actor and role='CLIENT' and status='ACTIVE' and permanently_deleted_at is null) then raise exception 'CLIENT_ACCESS_REQUIRED'; end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 or p_page is null or p_page<1 or p_page>100000
  or p_view is null or p_view not in ('shifts','employees') or p_size is null or p_size<1 or p_size>10000 or (p_status is not null and p_status not in ('ACTIVE','COMPLETED')) then raise exception 'INVALID_FILTERS'; end if;
 select coalesce(array_agg(project_id),'{}'::uuid[]) into v_allowed from client_project_access where user_id=p_actor and revoked_at is null;
 if p_projects is not null and (array_position(p_projects,null) is not null or not(p_projects<@v_allowed)) then raise exception 'PROJECT_ACCESS_DENIED'; end if;
 v_allowed:=coalesce(p_projects,v_allowed);
 with base_scoped as (
  select e.id,e.user_id,e.project_id,e.clock_in_at,e.clock_out_at,
   greatest(0,coalesce(e.duration_seconds,extract(epoch from(clock_timestamp()-e.clock_in_at))::integer)-coalesce((select sum(greatest(0,(x->>'duration_seconds')::integer)) from jsonb_array_elements(e.activities) x where x->>'project_id' is distinct from e.project_id::text),0)) as worked_seconds,
   p.name as project_name,u.full_name as employee_name,u.profile_picture_url as employee_picture_url,
   coalesce((select jsonb_agg(jsonb_build_object('description',x->>'description','started_at',x->>'started_at','ended_at',x->>'ended_at','duration_seconds',x->'duration_seconds') order by x->>'started_at')
    from jsonb_array_elements(e.activities) x where x->>'project_id'=e.project_id::text and coalesce(x->>'description','') not in ('','No activity recorded')),'[]'::jsonb) as activities
  from time_entries e join projects p on p.id=e.project_id join profiles u on u.id=e.user_id
  where e.project_id=any(v_allowed) and e.deleted_at is null
   and (p_status='ACTIVE' or (e.clock_in_at >= (p_from::timestamp at time zone 'Asia/Manila') and e.clock_in_at < ((p_to+1)::timestamp at time zone 'Asia/Manila')))
   and (p_status is null or (p_status='ACTIVE' and e.clock_out_at is null) or(p_status='COMPLETED' and e.clock_out_at is not null))
 ), scoped as(select * from base_scoped where p_employee is null or user_id=p_employee),
 summaries as(select user_id,max(employee_name) as employee_name,max(employee_picture_url) as employee_picture_url,
  array_agg(distinct project_name order by project_name) as project_names,count(*) as shifts,
  count(*) filter(where clock_out_at is null) as active,sum(worked_seconds) as worked_seconds
  from scoped group by user_id),
 page_rows as(select * from scoped order by clock_in_at desc,id limit p_size offset ((p_page::bigint-1)*p_size)),
 summary_rows as(select * from summaries order by employee_name,user_id limit p_size offset ((p_page::bigint-1)*p_size))
 select jsonb_build_object('items',case when p_view='employees' then coalesce((select jsonb_agg(to_jsonb(r) order by r.employee_name,r.user_id) from summary_rows r),'[]'::jsonb)
  else coalesce((select jsonb_agg(to_jsonb(r) order by r.clock_in_at desc,r.id) from page_rows r),'[]'::jsonb) end,
  'total',case when p_view='employees' then (select count(*) from summaries) else (select count(*) from scoped) end,
  'shifts',(select count(*) from scoped),'worked_seconds',(select coalesce(sum(worked_seconds),0) from scoped),
  'active',(select count(*) from scoped where clock_out_at is null),'employees',(select count(distinct user_id) from scoped),
  'employee_options',coalesce((select jsonb_agg(jsonb_build_object('id',user_id,'name',employee_name) order by employee_name,user_id) from (select distinct user_id,employee_name from base_scoped) e),'[]'::jsonb),
  'page',p_page,'pageSize',p_size) into v_result;
 return v_result;
end $$;

revoke all on function public.client_attendance_v2(uuid,uuid[],date,date,text,integer,integer,uuid,text) from public,anon,authenticated;
grant execute on function public.client_attendance_v2(uuid,uuid[],date,date,text,integer,integer,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;

select 'READY' as status, to_regprocedure('public.client_attendance_v2(uuid,uuid[],date,date,text,integer,integer,uuid,text)') is not null as function_ready, has_function_privilege('service_role','public.client_attendance_v2(uuid,uuid[],date,date,text,integer,integer,uuid,text)','EXECUTE') as api_allowed, not has_function_privilege('authenticated','public.client_attendance_v2(uuid,uuid[],date,date,text,integer,integer,uuid,text)','EXECUTE') as direct_access_blocked;
