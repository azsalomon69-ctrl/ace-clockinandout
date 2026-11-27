begin;
create table if not exists public.shift_planning_settings(id boolean primary key default true check(id),max_shift_hours numeric not null default 12 check(max_shift_hours between 1 and 24),min_rest_hours numeric not null default 8 check(min_rest_hours between 0 and 24),weekly_hours numeric not null default 40 check(weekly_hours between 1 and 168),grace_minutes integer not null default 15 check(grace_minutes between 0 and 180));
insert into public.shift_planning_settings(id) values(true) on conflict do nothing;
create table if not exists public.shift_templates(id uuid primary key default gen_random_uuid(),project_id uuid not null references projects(id),name text not null check(length(trim(name)) between 1 and 80),start_time time not null,end_time time not null,created_by uuid not null references profiles(id),unique(project_id,name));
create table if not exists public.planned_shifts(id uuid primary key default gen_random_uuid(),project_id uuid not null references projects(id),employee_id uuid not null references profiles(id),start_at timestamptz not null,end_at timestamptz not null check(end_at>start_at),status text not null default 'DRAFT' check(status in ('DRAFT','PUBLISHED','IN_PROGRESS','COMPLETED','NO_SHOW','CANCELLED')),note text not null default '' check(length(note)<=1000),recurrence_id uuid,created_by uuid not null references profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),published_at timestamptz);
create index if not exists planned_shifts_employee_dates on public.planned_shifts(employee_id,start_at,end_at);
create index if not exists planned_shifts_project_dates on public.planned_shifts(project_id,start_at);
create table if not exists public.employee_availability(id uuid primary key default gen_random_uuid(),employee_id uuid not null references profiles(id),start_at timestamptz not null,end_at timestamptz not null check(end_at>start_at),type text not null check(type in ('AVAILABLE','UNAVAILABLE')),note text not null default '' check(length(note)<=500),created_at timestamptz not null default now());
create index if not exists employee_availability_dates on public.employee_availability(employee_id,start_at,end_at);
create table if not exists public.shift_notifications(id uuid primary key default gen_random_uuid(),employee_id uuid not null references profiles(id),shift_id uuid not null references planned_shifts(id),kind text not null check(kind in ('PUBLISHED','UPDATED','CANCELLED')),details jsonb not null,created_at timestamptz not null default now(),seen_at timestamptz);
alter table public.time_entries add column if not exists planned_shift_id uuid references public.planned_shifts(id);
create unique index if not exists time_entries_planned_shift_unique on public.time_entries(planned_shift_id) where planned_shift_id is not null;
do $$declare t text;begin foreach t in array array['shift_planning_settings','shift_templates','planned_shifts','employee_availability','shift_notifications'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant select,insert,update,delete on public.%I to service_role',t);end loop;end $$;
create or replace function public.require_shift_planner(p_actor uuid,p_project uuid) returns void language plpgsql security definer set search_path=public as $$begin
 if not public.project_manager_allowed(p_actor,p_project,true) then raise exception 'SHIFT_PLAN_ACCESS_REQUIRED';end if;
end $$;
create or replace function public.validate_planned_shift(p_project uuid,p_employee uuid,p_start timestamptz,p_end timestamptz,p_exclude uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare cfg shift_planning_settings%rowtype;d date;w timestamptz;warnings jsonb:='[]';hours numeric;begin
 perform pg_advisory_xact_lock(hashtextextended(p_employee::text,49));
 select * into cfg from shift_planning_settings where id;
 if p_start is null or p_end is null or p_end<=p_start or p_start<=clock_timestamp() then raise exception 'SHIFT_FUTURE_REQUIRED';end if;
 d:=(p_start at time zone 'Asia/Manila')::date;
 if d>((clock_timestamp() at time zone 'Asia/Manila')::date+interval '2 months')::date then raise exception 'SHIFT_RANGE_EXCEEDED';end if;
 if extract(epoch from(p_end-p_start))/3600>cfg.max_shift_hours then raise exception 'SHIFT_TOO_LONG';end if;
 if not exists(select 1 from projects where id=p_project and status='ACTIVE' and start_date<=d and (end_date is null or end_date>=d)) then raise exception 'SHIFT_PROJECT_UNAVAILABLE';end if;
 if not exists(select 1 from profiles where id=p_employee and role='USER' and status='ACTIVE' and permanently_deleted_at is null) then raise exception 'SHIFT_EMPLOYEE_UNAVAILABLE';end if;
 if not exists(select 1 from project_memberships where project_id=p_project and user_id=p_employee and joined_at<=p_start and (left_at is null or left_at>=p_end)) then raise exception 'SHIFT_MEMBERSHIP_REQUIRED';end if;
 if exists(select 1 from planned_shifts where employee_id=p_employee and id is distinct from p_exclude and status<>'CANCELLED' and start_at<p_end and end_at>p_start) then raise exception 'SHIFT_EMPLOYEE_BUSY';end if;
 if exists(select 1 from planned_shifts where employee_id=p_employee and id is distinct from p_exclude and status<>'CANCELLED' and start_at<p_end+make_interval(secs=>(cfg.min_rest_hours*3600)::double precision) and end_at>p_start-make_interval(secs=>(cfg.min_rest_hours*3600)::double precision)) then raise exception 'SHIFT_REST_REQUIRED';end if;
 if exists(select 1 from employee_availability where employee_id=p_employee and type='UNAVAILABLE' and start_at<p_end and end_at>p_start) then warnings:=warnings||jsonb_build_array('Employee marked unavailable during this shift.');end if;
 w:=(d-extract(dow from d)::integer)::timestamp at time zone 'Asia/Manila';
 select coalesce(sum(extract(epoch from(least(end_at,w+interval '7 days')-greatest(start_at,w)))/3600),0) into hours from planned_shifts where employee_id=p_employee and id is distinct from p_exclude and status<>'CANCELLED' and start_at<w+interval '7 days' and end_at>w;
 if hours+extract(epoch from(least(p_end,w+interval '7 days')-greatest(p_start,w)))/3600>cfg.weekly_hours then warnings:=warnings||jsonb_build_array('Employee exceeds the weekly hours limit.');end if;
 if p_end>w+interval '7 days' then
  select coalesce(sum(extract(epoch from(least(end_at,w+interval '14 days')-greatest(start_at,w+interval '7 days')))/3600),0) into hours from planned_shifts where employee_id=p_employee and id is distinct from p_exclude and status<>'CANCELLED' and start_at<w+interval '14 days' and end_at>w+interval '7 days';
  if hours+extract(epoch from(p_end-(w+interval '7 days')))/3600>cfg.weekly_hours then warnings:=warnings||jsonb_build_array('Employee exceeds the weekly hours limit.');end if;
 end if;
 return warnings;
end $$;
create or replace function public.save_planned_shifts(p_actor uuid,p_project uuid,p_rows jsonb,p_request uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare r record;old planned_shifts%rowtype;sid uuid;employee uuid;starts timestamptz;ends timestamptz;warnings jsonb:='[]';ids jsonb:='[]';begin
 perform 1 from projects where id=p_project for no key update;perform require_shift_planner(p_actor,p_project);
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 200 then raise exception 'SHIFT_INVALID_BATCH';end if;
 -- Lock employees in a consistent order across campaigns before checking any conflicts.
 for r in select distinct value->>'employeeId' as employee from jsonb_array_elements(p_rows) order by 1 loop perform pg_advisory_xact_lock(hashtextextended(r.employee,49));end loop;
 for r in select value from jsonb_array_elements(p_rows) loop
  sid:=(r.value->>'id')::uuid;employee:=(r.value->>'employeeId')::uuid;starts:=(r.value->>'startAt')::timestamptz;ends:=(r.value->>'endAt')::timestamptz;
  old:=null;
  if sid is not null then select * into old from planned_shifts where id=sid and project_id=p_project for update;if not found then raise exception 'SHIFT_NOT_FOUND';end if;
   if old.status not in ('DRAFT','PUBLISHED') or old.start_at<=clock_timestamp() then raise exception 'SHIFT_ALREADY_STARTED';end if;
   if not exists(select 1 from project_memberships m where m.project_id=old.project_id and m.user_id=old.employee_id and m.joined_at<=old.start_at and (m.left_at is null or m.left_at>=old.end_at)) and not exists(select 1 from profiles where id=p_actor and role='ADMIN') then raise exception 'SHIFT_REVIEW_ADMIN_REQUIRED';end if;
  end if;
  if old.employee_id is not null and old.employee_id<>employee then perform pg_advisory_xact_lock(hashtextextended(old.employee_id::text,49));end if;
  warnings:=warnings||validate_planned_shift(p_project,employee,starts,ends,sid);
  if sid is null then
   insert into planned_shifts(project_id,employee_id,start_at,end_at,note,recurrence_id,created_by) values(p_project,employee,starts,ends,coalesce(r.value->>'note',''),(r.value->>'recurrenceId')::uuid,p_actor) returning id into sid;
  else
   update planned_shifts set employee_id=employee,start_at=starts,end_at=ends,note=coalesce(r.value->>'note',''),updated_at=clock_timestamp() where id=sid;
   if old.status='PUBLISHED' then
    if old.employee_id<>employee then insert into shift_notifications(employee_id,shift_id,kind,details) values(old.employee_id,sid,'CANCELLED',to_jsonb(old));end if;
    insert into shift_notifications(employee_id,shift_id,kind,details) select employee,sid,'UPDATED',to_jsonb(s) from planned_shifts s where id=sid;
   end if;
  end if;
  insert into audit_logs(user_id,action,entity_type,entity_id,description,request_id) values(p_actor,case when old.id is null then 'CREATE_PLANNED_SHIFT' else 'UPDATE_PLANNED_SHIFT' end,'PLANNED_SHIFT',sid,'Saved planned shift',p_request);
  ids:=ids||jsonb_build_array(sid);
 end loop;
 return jsonb_build_object('ids',ids,'warnings',warnings);
end $$;
create or replace function public.change_planned_shift_status(p_actor uuid,p_project uuid,p_ids uuid[],p_publish boolean,p_request uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare s planned_shifts%rowtype;target uuid;warnings jsonb:='[]';n integer:=0;begin
 perform 1 from projects where id=p_project for no key update;perform require_shift_planner(p_actor,p_project);
 if p_publish is null or p_ids is null or cardinality(p_ids) not between 1 and 200 or array_position(p_ids,null) is not null then raise exception 'SHIFT_INVALID_BATCH';end if;
 for target in select distinct x from unnest(p_ids) x order by x loop
  select * into s from planned_shifts where id=target and project_id=p_project for update;if not found then raise exception 'SHIFT_NOT_FOUND';end if;
  perform pg_advisory_xact_lock(hashtextextended(s.employee_id::text,49));
  if p_publish then
   if s.status='PUBLISHED' then continue;end if;
   if s.status<>'DRAFT' then raise exception 'SHIFT_ALREADY_STARTED';end if;
   warnings:=warnings||validate_planned_shift(s.project_id,s.employee_id,s.start_at,s.end_at,s.id);
   update planned_shifts set status='PUBLISHED',published_at=clock_timestamp(),updated_at=clock_timestamp() where id=s.id;
   insert into shift_notifications(employee_id,shift_id,kind,details) values(s.employee_id,s.id,'PUBLISHED',to_jsonb(s));
  else
   if s.status='CANCELLED' then continue;end if;
   if s.start_at<=clock_timestamp() or s.status not in ('DRAFT','PUBLISHED') then raise exception 'SHIFT_ALREADY_STARTED';end if;
   if not exists(select 1 from project_memberships m where m.project_id=s.project_id and m.user_id=s.employee_id and m.joined_at<=s.start_at and (m.left_at is null or m.left_at>=s.end_at)) and not exists(select 1 from profiles where id=p_actor and role='ADMIN') then raise exception 'SHIFT_REVIEW_ADMIN_REQUIRED';end if;
   update planned_shifts set status='CANCELLED',updated_at=clock_timestamp() where id=s.id;
   if s.status='PUBLISHED' then insert into shift_notifications(employee_id,shift_id,kind,details) values(s.employee_id,s.id,'CANCELLED',to_jsonb(s));end if;
  end if;
  n:=n+1;
  insert into audit_logs(user_id,action,entity_type,entity_id,description,request_id) values(p_actor,case when p_publish then 'PUBLISH_SHIFT' else 'CANCEL_SHIFT' end,'PLANNED_SHIFT',s.id,'Changed planned shift status',p_request);
 end loop;
 return jsonb_build_object('changed',n,'warnings',warnings);
end $$;
create or replace function public.planning_board(p_actor uuid,p_project uuid,p_from date,p_to date) returns jsonb language plpgsql security definer set search_path=public as $$
declare start_range timestamptz;end_range timestamptz;result jsonb;begin
 perform require_shift_planner(p_actor,p_project);
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>30 then raise exception 'SHIFT_INVALID_RANGE';end if;
 start_range:=p_from::timestamp at time zone 'Asia/Manila';end_range:=(p_to+1)::timestamp at time zone 'Asia/Manila';
 update planned_shifts set status='NO_SHOW',updated_at=clock_timestamp() where project_id=p_project and status='PUBLISHED' and start_at+make_interval(mins=>(select grace_minutes from shift_planning_settings where id))<clock_timestamp();
 with employees as(select u.id,u.full_name from profiles u where u.role='USER' and u.permanently_deleted_at is null and (exists(select 1 from project_memberships m where m.project_id=p_project and m.user_id=u.id and m.joined_at<end_range and (m.left_at is null or m.left_at>=start_range)) or exists(select 1 from planned_shifts s where s.project_id=p_project and s.employee_id=u.id and s.start_at<end_range and s.end_at>start_range)))
 select jsonb_build_object('employees',coalesce((select jsonb_agg(to_jsonb(e) order by full_name,id) from employees e),'[]'::jsonb),
 'shifts',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('needs_review',not exists(select 1 from project_memberships m where m.project_id=s.project_id and m.user_id=s.employee_id and m.joined_at<=s.start_at and (m.left_at is null or m.left_at>=s.end_at))) order by s.start_at,s.id) from planned_shifts s where s.project_id=p_project and s.start_at<end_range and s.end_at>start_range),'[]'::jsonb),
 'availability',coalesce((select jsonb_agg(to_jsonb(a)) from employee_availability a where a.employee_id in(select id from employees) and a.start_at<end_range and a.end_at>start_range and exists(select 1 from project_memberships m where m.project_id=p_project and m.user_id=a.employee_id and m.joined_at<least(a.end_at,end_range) and (m.left_at is null or m.left_at>greatest(a.start_at,start_range)))),'[]'::jsonb),
 'busy',coalesce((select jsonb_agg(jsonb_build_object('employee_id',s.employee_id,'start_at',s.start_at,'end_at',s.end_at)) from planned_shifts s where s.employee_id in(select id from employees) and s.project_id<>p_project and s.status<>'CANCELLED' and s.start_at<end_range and s.end_at>start_range and exists(select 1 from project_memberships m where m.project_id=p_project and m.user_id=s.employee_id and m.joined_at<least(s.end_at,end_range) and (m.left_at is null or m.left_at>greatest(s.start_at,start_range)))),'[]'::jsonb),
 'templates',coalesce((select jsonb_agg(to_jsonb(t) order by t.name) from shift_templates t where t.project_id=p_project),'[]'::jsonb),'settings',(select to_jsonb(c) from shift_planning_settings c where id)) into result;
 return result;
end $$;
create or replace function public.save_shift_availability(p_actor uuid,p_id uuid,p_start timestamptz,p_end timestamptz,p_type text,p_note text,p_remove boolean default false) returns uuid language plpgsql security definer set search_path=public as $$
declare old employee_availability%rowtype;result uuid;begin
 if not exists(select 1 from profiles where id=p_actor and role='USER' and status='ACTIVE' and permanently_deleted_at is null) then raise exception 'SHIFT_EMPLOYEE_UNAVAILABLE';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text,49));
 if p_id is not null then select * into old from employee_availability where id=p_id and employee_id=p_actor for update;if not found then raise exception 'SHIFT_NOT_FOUND';end if;end if;
 if p_id is not null and exists(select 1 from planned_shifts where employee_id=p_actor and status in ('PUBLISHED','IN_PROGRESS','COMPLETED','NO_SHOW') and start_at<old.end_at and end_at>old.start_at) then raise exception 'SHIFT_AVAILABILITY_LOCKED';end if;
 if p_remove then if p_id is null then raise exception 'SHIFT_NOT_FOUND';end if;delete from employee_availability where id=p_id;return p_id;end if;
 if p_start is null or p_end is null or p_end<=p_start or (p_start at time zone 'Asia/Manila')::date<(clock_timestamp() at time zone 'Asia/Manila')::date or p_end>(((clock_timestamp() at time zone 'Asia/Manila')::date+interval '2 months')::date+1)::timestamp at time zone 'Asia/Manila' or p_type not in ('AVAILABLE','UNAVAILABLE') or p_type is null or length(coalesce(p_note,''))>500 then raise exception 'SHIFT_INVALID_AVAILABILITY';end if;
 if exists(select 1 from planned_shifts where employee_id=p_actor and status in ('PUBLISHED','IN_PROGRESS','COMPLETED','NO_SHOW') and start_at<p_end and end_at>p_start) then raise exception 'SHIFT_AVAILABILITY_LOCKED';end if;
 if p_id is null then insert into employee_availability(employee_id,start_at,end_at,type,note) values(p_actor,p_start,p_end,p_type,coalesce(p_note,'')) returning id into result;
 else update employee_availability set start_at=p_start,end_at=p_end,type=p_type,note=coalesce(p_note,'') where id=p_id;result:=p_id;end if;
 return result;
end $$;
create or replace function public.employee_shift_schedule(p_actor uuid,p_from date,p_to date) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from profiles where id=p_actor and role='USER' and status='ACTIVE' and permanently_deleted_at is null) then raise exception 'SHIFT_EMPLOYEE_UNAVAILABLE';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>93 then raise exception 'SHIFT_INVALID_RANGE';end if;
 update planned_shifts set status='NO_SHOW',updated_at=clock_timestamp() where employee_id=p_actor and status='PUBLISHED' and start_at+make_interval(mins=>(select grace_minutes from shift_planning_settings where id))<clock_timestamp();
 return jsonb_build_object('shifts',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('project_name',p.name) order by s.start_at) from planned_shifts s join projects p on p.id=s.project_id where s.employee_id=p_actor and s.status<>'DRAFT' and s.start_at<((p_to+1)::timestamp at time zone 'Asia/Manila') and s.end_at>(p_from::timestamp at time zone 'Asia/Manila')),'[]'::jsonb),
 'availability',coalesce((select jsonb_agg(to_jsonb(a) order by a.start_at) from employee_availability a where a.employee_id=p_actor and a.start_at<((p_to+1)::timestamp at time zone 'Asia/Manila') and a.end_at>(p_from::timestamp at time zone 'Asia/Manila')),'[]'::jsonb),
 'notifications',coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc) from (select * from shift_notifications where employee_id=p_actor order by created_at desc limit 50)n),'[]'::jsonb));
end $$;
create or replace function public.link_planned_attendance() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='INSERT' and new.project_id is not null and new.planned_shift_id is null then
  select s.id into new.planned_shift_id from planned_shifts s where s.employee_id=new.user_id and s.project_id=new.project_id and s.status in ('PUBLISHED','NO_SHOW') and new.clock_in_at between s.start_at-interval '4 hours' and s.end_at+interval '4 hours' and not exists(select 1 from time_entries e where e.planned_shift_id=s.id) order by abs(extract(epoch from(s.start_at-new.clock_in_at))),s.id limit 1 for update;
 end if;return new;
end $$;
create or replace function public.sync_planned_attendance() returns trigger language plpgsql security definer set search_path=public as $$begin
 if new.planned_shift_id is not null then update planned_shifts set status=case when new.clock_out_at is null then 'IN_PROGRESS' else 'COMPLETED' end,updated_at=clock_timestamp() where id=new.planned_shift_id;end if;return new;
end $$;
drop trigger if exists zz_link_planned_attendance on public.time_entries;
create trigger zz_link_planned_attendance before insert on public.time_entries for each row execute function public.link_planned_attendance();
drop trigger if exists sync_planned_attendance on public.time_entries;
create trigger sync_planned_attendance after insert or update of clock_out_at on public.time_entries for each row execute function public.sync_planned_attendance();
do $$declare r record;begin for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('require_shift_planner','validate_planned_shift','save_planned_shifts','change_planned_shift_status','planning_board','save_shift_availability','employee_shift_schedule','link_planned_attendance','sync_planned_attendance') loop execute format('revoke all on function %s from public,anon,authenticated',r.signature);execute format('grant execute on function %s to service_role',r.signature);end loop;end $$;
notify pgrst,'reload schema';
commit;
select 'READY' as status,to_regclass('public.planned_shifts') is not null as planning_ready,exists(select 1 from pg_trigger where tgname='zz_link_planned_attendance') as attendance_link_ready,not has_function_privilege('authenticated','public.save_planned_shifts(uuid,uuid,jsonb,uuid)','EXECUTE') as direct_access_blocked;
