begin;
alter table public.client_project_access add column if not exists access_level text not null default 'VIEW';
do $$begin if not exists(select 1 from pg_constraint where conrelid='public.client_project_access'::regclass and conname='client_project_access_level') then alter table public.client_project_access add constraint client_project_access_level check(access_level in ('VIEW','VIEW_PLAN'));end if;end $$;
create or replace function public.set_project_manager(p_actor uuid,p_project uuid,p_user uuid,p_level text default 'VIEW',p_revoke boolean default false,p_request uuid default null)
returns void language plpgsql security definer set search_path=public as $$
declare previous public.client_project_access%rowtype;begin
 if not exists(select 1 from profiles where id=p_actor and role='ADMIN' and status='ACTIVE' and permanently_deleted_at is null) then raise exception 'ADMIN_REQUIRED';end if;
 if p_level is null or p_level not in ('VIEW','VIEW_PLAN') or p_revoke is null then raise exception 'INVALID_MANAGER_LEVEL';end if;
 perform 1 from projects where id=p_project for no key update;if not found then raise exception 'MANAGER_PROJECT_REQUIRED';end if;
 perform 1 from profiles where id=p_user and (p_revoke or (role in ('CLIENT','USER') and status='ACTIVE' and permanently_deleted_at is null)) for no key update;if not found then raise exception 'MANAGER_ACCOUNT_REQUIRED';end if;
 select * into previous from client_project_access where user_id=p_user and project_id=p_project;
 if p_revoke then
  if previous.user_id is null or previous.revoked_at is not null then return;end if;
  update client_project_access set revoked_at=clock_timestamp() where user_id=p_user and project_id=p_project;
  insert into audit_logs(user_id,action,entity_type,entity_id,description,request_id) values(p_actor,'REVOKE_MANAGER_ACCESS','PROJECT',p_project,format('Revoked manager %s access (%s)',p_user,previous.access_level),p_request);return;
 end if;
 if exists(select 1 from user_projects where user_id=p_user and project_id=p_project) then raise exception 'EMPLOYEE_ASSIGNMENT_CONFLICT';end if;
 if previous.user_id is not null and previous.revoked_at is null and previous.access_level=p_level then return;end if;
 insert into client_project_access(user_id,project_id,access_level,granted_by) values(p_user,p_project,p_level,p_actor)
 on conflict(user_id,project_id) do update set access_level=excluded.access_level,granted_by=excluded.granted_by,granted_at=clock_timestamp(),revoked_at=null;
 insert into audit_logs(user_id,action,entity_type,entity_id,description,request_id) values(p_actor,case when previous.user_id is not null and previous.revoked_at is null then 'CHANGE_MANAGER_ACCESS' else 'GRANT_MANAGER_ACCESS' end,'PROJECT',p_project,format('Manager %s access: %s → %s',p_user,case when previous.revoked_at is null then previous.access_level else null end,p_level),p_request);
end $$;
-- A shared server-only gate for the planning APIs added in the next release.
create or replace function public.project_manager_allowed(p_actor uuid,p_project uuid,p_plan boolean default false) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from profiles u where u.id=p_actor and u.status='ACTIVE' and u.permanently_deleted_at is null and (u.role='ADMIN' or (u.role in ('CLIENT','USER') and exists(select 1 from client_project_access a where a.user_id=u.id and a.project_id=p_project and a.revoked_at is null and (not p_plan or a.access_level='VIEW_PLAN')))));
$$;
-- Preserve the existing scoped attendance queries and exports exactly; allow employee accounts with explicit grants too.
do $patch$declare signature text;definition text;begin
 foreach signature in array array['public.client_projects(uuid)','public.client_attendance(uuid,uuid[],date,date,text,integer,integer)','public.client_attendance_v2(uuid,uuid[],date,date,text,integer,integer,uuid,text)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if position('/* ace_manager_roles */' in definition)=0 then
   if position('role=''CLIENT''' in definition)>0 then definition:=replace(definition,'role=''CLIENT''','/* ace_manager_roles */ (role=''CLIENT'' or (role=''USER'' and exists(select 1 from public.client_project_access manager_grant where manager_grant.user_id=p_actor and manager_grant.revoked_at is null)))');
   elsif position('role in (''CLIENT'',''USER'')' in definition)>0 then definition:=replace(definition,'role in (''CLIENT'',''USER'')','/* ace_manager_roles */ (role=''CLIENT'' or (role=''USER'' and exists(select 1 from public.client_project_access manager_grant where manager_grant.user_id=p_actor and manager_grant.revoked_at is null)))');
   else raise exception 'MANAGER_ROLE_GUARD_NOT_FOUND: %',signature;end if;
  end if;
  if signature='public.client_projects(uuid)' and position('''access_level''' in definition)=0 then
   if position('''is_active'',p.is_active' in definition)=0 then raise exception 'MANAGER_PROJECT_FIELDS_NOT_FOUND';end if;
   definition:=replace(definition,'''is_active'',p.is_active','''is_active'',p.is_active,''access_level'',a.access_level');
  end if;execute definition;
 end loop;
 definition:=pg_get_functiondef('public.project_management_summary(uuid)'::regprocedure);
 definition:=replace(definition,'u.role=''CLIENT''','u.role in (''CLIENT'',''USER'')');execute definition;
end $patch$;
revoke all on function public.set_project_manager(uuid,uuid,uuid,text,boolean,uuid),public.project_manager_allowed(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_project_manager(uuid,uuid,uuid,text,boolean,uuid),public.project_manager_allowed(uuid,uuid,boolean) to service_role;
notify pgrst,'reload schema';
commit;
select 'READY' as status,exists(select 1 from information_schema.columns where table_schema='public' and table_name='client_project_access' and column_name='access_level') as levels_ready,has_function_privilege('service_role','public.set_project_manager(uuid,uuid,uuid,text,boolean,uuid)','EXECUTE') as api_allowed,not has_function_privilege('authenticated','public.set_project_manager(uuid,uuid,uuid,text,boolean,uuid)','EXECUTE') as direct_access_blocked;
