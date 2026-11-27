begin;
create table if not exists public.project_memberships(
 id uuid primary key default gen_random_uuid(),project_id uuid not null references public.projects(id),user_id uuid not null references public.profiles(id),
 joined_at timestamptz not null, left_at timestamptz, assigned_by uuid references public.profiles(id),removed_by uuid references public.profiles(id),
 check(left_at is null or left_at>=joined_at)
);
create unique index if not exists project_memberships_open_unique on public.project_memberships(project_id,user_id) where left_at is null;
create index if not exists project_memberships_history on public.project_memberships(project_id,joined_at desc);
alter table public.project_memberships enable row level security;
revoke all on public.project_memberships from public,anon,authenticated;
grant select,insert,update,delete on public.project_memberships to service_role;
insert into public.project_memberships(project_id,user_id,joined_at)
 select project_id,user_id,assigned_at from public.user_projects a where not exists(select 1 from public.project_memberships m where m.project_id=a.project_id and m.user_id=a.user_id and m.left_at is null);
create or replace function public.keep_project_membership_history() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='DELETE' then update public.project_memberships set left_at=clock_timestamp() where project_id=old.project_id and user_id=old.user_id and left_at is null;return old;end if;
 perform 1 from public.profiles where id=new.user_id and role='USER' and status='ACTIVE' and permanently_deleted_at is null for no key update;
 if not found then raise exception 'MEMBERSHIP_EMPLOYEE_REQUIRED';end if;
 if exists(select 1 from public.client_project_access where project_id=new.project_id and user_id=new.user_id and revoked_at is null) then raise exception 'MEMBERSHIP_MANAGER_CONFLICT';end if;
 insert into public.project_memberships(project_id,user_id,joined_at) values(new.project_id,new.user_id,new.assigned_at) on conflict(project_id,user_id) where left_at is null do nothing;
 return new;
end $$;
drop trigger if exists keep_project_membership_history on public.user_projects;
create trigger keep_project_membership_history after insert or delete on public.user_projects for each row execute function public.keep_project_membership_history();
create or replace function public.change_project_memberships(p_actor uuid,p_project uuid,p_assignments jsonb,p_remove boolean default false,p_request uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r record; person uuid; joined timestamptz; joined_on date; changed integer:=0; skipped integer:=0; project_status text;
begin
 if not exists(select 1 from public.profiles where id=p_actor and role='ADMIN' and status='ACTIVE' and permanently_deleted_at is null) then raise exception 'ADMIN_REQUIRED';end if;
 if p_assignments is null or jsonb_typeof(p_assignments)<>'array' or jsonb_array_length(p_assignments) not between 1 and 200 then raise exception 'MEMBERSHIP_INVALID_BATCH';end if;
 select status into project_status from public.projects where id=p_project for update;if not found then raise exception 'MEMBERSHIP_PROJECT_REQUIRED';end if;
 if project_status='ARCHIVED' and not p_remove then raise exception 'MEMBERSHIP_PROJECT_ARCHIVED';end if;
 if (select count(distinct x->>'employeeId') from jsonb_array_elements(p_assignments) x)<>jsonb_array_length(p_assignments) then raise exception 'MEMBERSHIP_DUPLICATE_EMPLOYEE';end if;
 for r in select value from jsonb_array_elements(p_assignments) order by value->>'employeeId' loop
  person:=(r.value->>'employeeId')::uuid;
  perform 1 from public.profiles where id=person and (p_remove or (role='USER' and status='ACTIVE' and permanently_deleted_at is null)) for no key update;
  if not found then raise exception 'MEMBERSHIP_EMPLOYEE_REQUIRED';end if;
  if p_remove then
   update public.project_memberships set left_at=clock_timestamp(),removed_by=p_actor where project_id=p_project and user_id=person and left_at is null;
   if not found then skipped:=skipped+1;continue;end if;
   delete from public.user_projects where project_id=p_project and user_id=person;
   changed:=changed+1;
   insert into public.audit_logs(user_id,action,entity_type,entity_id,description,request_id) values(p_actor,'END_PROJECT_MEMBERSHIP','PROJECT',p_project,format('Ended employee %s membership',person),p_request);
  else
   if exists(select 1 from public.client_project_access where project_id=p_project and user_id=person and revoked_at is null) then raise exception 'MEMBERSHIP_MANAGER_CONFLICT';end if;
   joined_on:=coalesce((r.value->>'joinedOn')::date,(clock_timestamp() at time zone 'Asia/Manila')::date);
   if joined_on>(clock_timestamp() at time zone 'Asia/Manila')::date then raise exception 'MEMBERSHIP_FUTURE_JOIN';end if;
   if exists(select 1 from public.project_memberships where project_id=p_project and user_id=person and left_at is null) then skipped:=skipped+1;continue;end if;
   joined:=case when joined_on=(clock_timestamp() at time zone 'Asia/Manila')::date then clock_timestamp() else joined_on::timestamp at time zone 'Asia/Manila' end;
   if exists(select 1 from public.project_memberships where project_id=p_project and user_id=person and left_at>joined) then raise exception 'MEMBERSHIP_OVERLAP';end if;
   insert into public.project_memberships(project_id,user_id,joined_at,assigned_by) values(p_project,person,joined,p_actor);
   insert into public.user_projects(user_id,project_id,assigned_at) values(person,p_project,joined) on conflict(user_id,project_id) do nothing;
   changed:=changed+1;
   insert into public.audit_logs(user_id,action,entity_type,entity_id,description,request_id) values(p_actor,'ADD_PROJECT_MEMBERSHIP','PROJECT',p_project,format('Assigned employee %s from %s',person,joined),p_request);
  end if;
 end loop;
 return jsonb_build_object('changed',changed,'skipped',skipped);
end $$;
create or replace function public.preview_project_memberships(p_actor uuid,p_rows jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from public.profiles where id=p_actor and role='ADMIN' and status='ACTIVE' and permanently_deleted_at is null) then raise exception 'ADMIN_REQUIRED';end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>200 then raise exception 'MEMBERSHIP_INVALID_BATCH';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('row',r.value->'row','employeeId',p.id,'name',p.full_name,'email',p.email,'joinedOn',r.value->>'joinedOn','error',case when p.id is null then 'Employee not found' when p.role<>'USER' or p.status<>'ACTIVE' or p.permanently_deleted_at is not null then 'Choose an active employee' else null end) order by r.ordinality)
 from jsonb_array_elements(p_rows) with ordinality r left join public.profiles p on (case when coalesce(r.value->>'employeeId','')<>'' then p.id::text=r.value->>'employeeId' else lower(p.email)=lower(r.value->>'email') end)),'[]'::jsonb);
end $$;
revoke all on function public.keep_project_membership_history(),public.change_project_memberships(uuid,uuid,jsonb,boolean,uuid),public.preview_project_memberships(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.change_project_memberships(uuid,uuid,jsonb,boolean,uuid),public.preview_project_memberships(uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
select 'READY' as status,to_regclass('public.project_memberships') is not null as history_ready,exists(select 1 from pg_trigger where tgname='keep_project_membership_history') as legacy_paths_preserved,not has_function_privilege('authenticated','public.change_project_memberships(uuid,uuid,jsonb,boolean,uuid)','EXECUTE') as direct_access_blocked;
