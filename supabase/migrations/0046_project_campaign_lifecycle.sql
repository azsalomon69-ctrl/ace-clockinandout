-- Part 2, staging only: preserve existing projects, assignments and attendance.
begin;
alter table public.projects add column if not exists type text not null default 'PROJECT',
 add column if not exists status text,
 add column if not exists start_date date,
 add column if not exists end_date date,
 add column if not exists color text not null default '#357bb8',
 add column if not exists client_name text,
 add column if not exists department_id uuid references public.departments(id) on delete set null;
update public.projects p set status=coalesce(status,case when is_active then 'ACTIVE' else 'PAUSED' end),start_date=coalesce(start_date,least((created_at at time zone 'Asia/Manila')::date,(select min((e.clock_in_at at time zone 'Asia/Manila')::date) from public.time_entries e where e.project_id=p.id)));
alter table public.projects alter column status set not null,alter column status set default 'ACTIVE',alter column start_date set not null,alter column start_date set default ((now() at time zone 'Asia/Manila')::date);
alter table public.projects drop constraint if exists projects_name_key;
alter table public.projects drop constraint if exists projects_type_check;
alter table public.projects drop constraint if exists projects_status_check;
alter table public.projects drop constraint if exists projects_dates_check;
alter table public.projects drop constraint if exists projects_color_check;
alter table public.projects drop constraint if exists projects_name_check;
alter table public.projects add constraint projects_type_check check(type in ('PROJECT','CAMPAIGN')),
 add constraint projects_status_check check(status in ('ACTIVE','PAUSED','ARCHIVED')),
 add constraint projects_dates_check check(end_date is null or end_date>=start_date),
 add constraint projects_color_check check(color ~ '^#[0-9A-Fa-f]{6}$'),
 add constraint projects_name_check check(length(btrim(name)) between 1 and 160);
create unique index if not exists projects_active_name_unique on public.projects(lower(btrim(name))) where status='ACTIVE';
create or replace function public.sync_project_lifecycle() returns trigger language plpgsql set search_path=public as $$
begin
 new.name:=btrim(new.name); new.is_active:=new.status='ACTIVE'; return new;
end $$;
drop trigger if exists sync_project_lifecycle on public.projects;
create trigger sync_project_lifecycle before insert or update on public.projects for each row execute function public.sync_project_lifecycle();
update public.projects set is_active=status='ACTIVE';
create or replace function public.guard_project_history() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from public.time_entries where project_id=old.id or activities @> jsonb_build_array(jsonb_build_object('project_id',old.id::text))) then raise exception 'PROJECT_HISTORY_EXISTS'; end if;
 return old;
end $$;
drop trigger if exists guard_project_history on public.projects;
create trigger guard_project_history before delete on public.projects for each row execute function public.guard_project_history();
create or replace function public.guard_project_clock_in() returns trigger language plpgsql security definer set search_path=public as $$
declare p public.projects%rowtype; shift_day date;
begin
 if new.project_id is null or new.clock_out_at is not null then return new; end if;
 if tg_op='UPDATE' and new.project_id is not distinct from old.project_id then return new; end if;
 select * into p from public.projects where id=new.project_id for share;
 shift_day:=(new.clock_in_at at time zone 'Asia/Manila')::date;
 if not found or p.status<>'ACTIVE' or shift_day<p.start_date or (p.end_date is not null and shift_day>p.end_date) then raise exception 'PROJECT_NOT_AVAILABLE'; end if;
 return new;
end $$;
drop trigger if exists guard_project_clock_in on public.time_entries;
create trigger guard_project_clock_in before insert or update of project_id on public.time_entries for each row execute function public.guard_project_clock_in();
create or replace function public.project_management_summary(p_actor uuid) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from public.profiles where id=p_actor and role='ADMIN' and status='ACTIVE' and permanently_deleted_at is null) then raise exception 'ADMIN_REQUIRED'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'employees',(select count(*) from public.user_projects a join public.profiles u on u.id=a.user_id where a.project_id=p.id and u.role='USER' and u.permanently_deleted_at is null),'clients',(select count(*) from public.client_project_access a join public.profiles u on u.id=a.user_id where a.project_id=p.id and a.revoked_at is null and u.role='CLIENT' and u.permanently_deleted_at is null),'working_now',(select count(distinct e.user_id) from public.time_entries e join public.profiles u on u.id=e.user_id where e.project_id=p.id and e.clock_out_at is null and e.deleted_at is null and u.role='USER')) order by p.name) from public.projects p),'[]'::jsonb);
end $$;
-- Keep queued-clock rejection/review behavior intact while adding the same date gate.
-- Patch only the existing project check; preserve every other deployed RPC detail.
do $lifecycle$
declare r record; definition text; gate text; tap text;
begin
 for r in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('sync_queued_clock_action','resolve_queued_clock_review') loop
  definition:=pg_get_functiondef(r.oid);
  if position('/* ace_project_dates */' in definition)>0 then continue;end if;
  if position('and p.is_active' in definition)=0 then raise exception 'QUEUE_PROJECT_GUARD_NOT_FOUND: %',r.proname;end if;
  tap:=case when r.proname='sync_queued_clock_action' then 'v_tap' else 'v_action.tapped_at' end;
  gate:='and p.is_active /* ace_project_dates */ and p.start_date <= ('||tap||' at time zone ''Asia/Manila'')::date and (p.end_date is null or p.end_date >= ('||tap||' at time zone ''Asia/Manila'')::date)';
  execute replace(definition,'and p.is_active',gate);
 end loop;
end $lifecycle$;
revoke all on function public.sync_project_lifecycle(),public.guard_project_history(),public.guard_project_clock_in(),public.project_management_summary(uuid) from public,anon,authenticated;
grant execute on function public.project_management_summary(uuid) to service_role;
notify pgrst,'reload schema';
commit;
select 'READY' as status,exists(select 1 from pg_trigger where tgname='guard_project_clock_in') as clock_in_guard,exists(select 1 from pg_trigger where tgname='guard_project_history') as history_guard,not has_function_privilege('authenticated','public.project_management_summary(uuid)','EXECUTE') as direct_access_blocked;
