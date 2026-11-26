begin;
create table if not exists public.client_project_access (
 user_id uuid not null references public.profiles(id),
 project_id uuid not null references public.projects(id),
 granted_by uuid not null references public.profiles(id),
 granted_at timestamptz not null default now(),
 revoked_at timestamptz,
 primary key(user_id,project_id)
);
alter table public.client_project_access enable row level security;
revoke all on public.client_project_access from public,anon,authenticated;
grant select,insert,update on public.client_project_access to service_role;

create or replace function public.set_client_project_access(p_actor uuid,p_client uuid,p_projects uuid[],p_request uuid default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_project uuid; v_old uuid[];
begin
 if not exists(select 1 from profiles where id=p_actor and role='ADMIN' and status='ACTIVE' and permanently_deleted_at is null) then raise exception 'ADMIN_REQUIRED'; end if;
 perform 1 from profiles where id=p_client and role='CLIENT' and permanently_deleted_at is null for no key update;
 if not found then raise exception 'CLIENT_UNAVAILABLE'; end if;
 if p_projects is null or cardinality(p_projects)>100 or array_position(p_projects,null) is not null then raise exception 'INVALID_PROJECTS'; end if;
 p_projects:=array(select distinct x from unnest(p_projects) x);
 if exists(select 1 from unnest(p_projects) x where not exists(select 1 from projects where id=x)) then raise exception 'INVALID_PROJECTS'; end if;
 if exists(select 1 from user_projects where user_id=p_client and project_id=any(p_projects)) then raise exception 'EMPLOYEE_ASSIGNMENT_CONFLICT'; end if;
 select coalesce(array_agg(project_id),'{}'::uuid[]) into v_old from client_project_access where user_id=p_client and revoked_at is null;
 update client_project_access set revoked_at=clock_timestamp() where user_id=p_client and revoked_at is null and not(project_id=any(p_projects));
 foreach v_project in array v_old loop
  if not(v_project=any(p_projects)) then insert into audit_logs(user_id,action,entity_type,entity_id,description,request_id)
  values(p_actor,'REVOKE_CLIENT_ACCESS','PROJECT',v_project,format('Revoked client %s access to project %s',p_client,v_project),p_request); end if;
 end loop;
 foreach v_project in array p_projects loop
  if not(v_project=any(v_old)) then
   insert into client_project_access(user_id,project_id,granted_by) values(p_client,v_project,p_actor)
   on conflict(user_id,project_id) do update set granted_by=excluded.granted_by,granted_at=clock_timestamp(),revoked_at=null;
   insert into audit_logs(user_id,action,entity_type,entity_id,description,request_id)
   values(p_actor,'GRANT_CLIENT_ACCESS','PROJECT',v_project,format('Granted client %s read-only access to project %s',p_client,v_project),p_request);
  end if;
 end loop;
end $$;

create or replace function public.client_projects(p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from profiles where id=p_actor and role='CLIENT' and status='ACTIVE' and permanently_deleted_at is null) then raise exception 'CLIENT_ACCESS_REQUIRED'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'is_active',p.is_active) order by p.name)
 from client_project_access a join projects p on p.id=a.project_id where a.user_id=p_actor and a.revoked_at is null),'[]'::jsonb);
end $$;

create or replace function public.client_attendance(p_actor uuid,p_projects uuid[],p_from date,p_to date,p_status text default null,p_page integer default 1,p_size integer default 25)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_allowed uuid[]; v_result jsonb;
begin
 if not exists(select 1 from profiles where id=p_actor and role='CLIENT' and status='ACTIVE' and permanently_deleted_at is null) then raise exception 'CLIENT_ACCESS_REQUIRED'; end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 or p_page is null or p_page<1 or p_page>100000
  or p_size is null or p_size<1 or p_size>10000 or (p_status is not null and p_status not in ('ACTIVE','COMPLETED')) then raise exception 'INVALID_FILTERS'; end if;
 select coalesce(array_agg(project_id),'{}'::uuid[]) into v_allowed from client_project_access where user_id=p_actor and revoked_at is null;
 if p_projects is not null and (array_position(p_projects,null) is not null or not(p_projects<@v_allowed)) then raise exception 'PROJECT_ACCESS_DENIED'; end if;
 v_allowed:=coalesce(p_projects,v_allowed);
 with scoped as (
  select e.id,e.user_id,e.project_id,e.clock_in_at,e.clock_out_at,
   greatest(0,coalesce(e.duration_seconds,extract(epoch from(clock_timestamp()-e.clock_in_at))::integer)-coalesce((select sum(greatest(0,(x->>'duration_seconds')::integer)) from jsonb_array_elements(e.activities) x where x->>'project_id' is distinct from e.project_id::text),0)) as worked_seconds,
   p.name as project_name,u.full_name as employee_name,
   coalesce((select jsonb_agg(jsonb_build_object('description',x->>'description','started_at',x->>'started_at','ended_at',x->>'ended_at','duration_seconds',x->'duration_seconds') order by x->>'started_at')
    from jsonb_array_elements(e.activities) x where x->>'project_id'=e.project_id::text and coalesce(x->>'description','') not in ('','No activity recorded')),'[]'::jsonb) as activities
  from time_entries e join projects p on p.id=e.project_id join profiles u on u.id=e.user_id
  where e.project_id=any(v_allowed) and e.deleted_at is null
   and (p_status='ACTIVE' or (e.clock_in_at >= (p_from::timestamp at time zone 'Asia/Manila') and e.clock_in_at < ((p_to+1)::timestamp at time zone 'Asia/Manila')))
   and (p_status is null or (p_status='ACTIVE' and e.clock_out_at is null) or(p_status='COMPLETED' and e.clock_out_at is not null))
 ), page_rows as(select * from scoped order by clock_in_at desc,id limit p_size offset ((p_page::bigint-1)*p_size))
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(r) order by r.clock_in_at desc,r.id) from page_rows r),'[]'::jsonb),
  'total',(select count(*) from scoped),'worked_seconds',(select coalesce(sum(worked_seconds),0) from scoped),
  'active',(select count(*) from scoped where clock_out_at is null),'employees',(select count(distinct user_id) from scoped),'page',p_page,'pageSize',p_size) into v_result;
 return v_result;
end $$;

-- Direct Supabase calls cannot bypass the scoped API. Existing employees keep
-- their own-entry policy; clients cannot use it to retrieve former attendance.
drop policy if exists client_no_direct_attendance on public.time_entries;
create policy client_no_direct_attendance on public.time_entries as restrictive for select to authenticated
 using (not exists(select 1 from public.profiles where id=auth.uid() and role='CLIENT'));
revoke all on function public.set_client_project_access(uuid,uuid,uuid[],uuid) from public,anon,authenticated;
revoke all on function public.client_projects(uuid) from public,anon,authenticated;
revoke all on function public.client_attendance(uuid,uuid[],date,date,text,integer,integer) from public,anon,authenticated;
grant execute on function public.set_client_project_access(uuid,uuid,uuid[],uuid) to service_role;
grant execute on function public.client_projects(uuid) to service_role;
grant execute on function public.client_attendance(uuid,uuid[],date,date,text,integer,integer) to service_role;
notify pgrst,'reload schema';
commit;
