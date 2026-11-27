-- Part 9: keep planned attendance consistent through corrections, removal and restore.
begin;
create or replace function public.link_planned_attendance() returns trigger language plpgsql security definer set search_path=public as $$
declare previous_id uuid; rematch boolean;
begin
 if tg_op='UPDATE' then previous_id:=old.planned_shift_id;end if;
 if new.deleted_at is not null then new.planned_shift_id:=null;return new;end if;
 -- An invalid historical link must never prevent a real employee from clocking out.
 if new.planned_shift_id is not null and not exists(select 1 from planned_shifts s where s.id=new.planned_shift_id and s.employee_id=new.user_id and s.project_id=new.project_id and s.status not in ('DRAFT','CANCELLED')) then new.planned_shift_id:=null;end if;
 rematch:=new.planned_shift_id is null;
 if tg_op='UPDATE' then rematch:=rematch or new.clock_in_at is distinct from old.clock_in_at or new.project_id is distinct from old.project_id or new.user_id is distinct from old.user_id or old.deleted_at is not null;end if;
 if rematch and new.project_id is not null then
  select s.id into new.planned_shift_id from planned_shifts s
  where s.employee_id=new.user_id and s.project_id=new.project_id
   and (s.status in ('PUBLISHED','NO_SHOW') or (s.id=previous_id and s.status in ('IN_PROGRESS','COMPLETED')))
   and new.clock_in_at between s.start_at-interval '4 hours' and s.end_at+interval '4 hours'
   and not exists(select 1 from time_entries e where e.planned_shift_id=s.id and e.id<>new.id and e.deleted_at is null)
  order by abs(extract(epoch from(s.start_at-new.clock_in_at))),s.id limit 1 for update;
 elsif new.project_id is null then new.planned_shift_id:=null;
 end if;
 return new;
end $$;
create or replace function public.sync_planned_attendance() returns trigger language plpgsql security definer set search_path=public as $$
declare previous_id uuid; current_id uuid; target uuid; attendance record; planned record; grace integer;
begin
 if tg_op<>'INSERT' then previous_id:=old.planned_shift_id;end if;
 if tg_op<>'DELETE' then current_id:=new.planned_shift_id;end if;
 select grace_minutes into grace from shift_planning_settings where id;
 for target in select distinct x from unnest(array[previous_id,current_id])x where x is not null order by x loop
  select * into planned from planned_shifts where id=target for update;
  if not found or planned.status in ('DRAFT','CANCELLED') then continue;end if;
  select e.clock_out_at into attendance from time_entries e where e.planned_shift_id=target and e.deleted_at is null limit 1;
  if found then update planned_shifts set status=case when attendance.clock_out_at is null then 'IN_PROGRESS' else 'COMPLETED' end,updated_at=clock_timestamp() where id=target;
  else update planned_shifts set status=case when planned.start_at+make_interval(mins=>coalesce(grace,15))<clock_timestamp() then 'NO_SHOW' else 'PUBLISHED' end,updated_at=clock_timestamp() where id=target;
  end if;
 end loop;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
drop trigger if exists zz_link_planned_attendance on public.time_entries;
create trigger zz_link_planned_attendance before insert or update of clock_in_at,clock_out_at,project_id,user_id,deleted_at,planned_shift_id on public.time_entries for each row execute function public.link_planned_attendance();
drop trigger if exists sync_planned_attendance on public.time_entries;
create trigger sync_planned_attendance after insert or update of clock_in_at,clock_out_at,project_id,user_id,deleted_at,planned_shift_id or delete on public.time_entries for each row execute function public.sync_planned_attendance();
-- Repair old links without changing clock-in/out timestamps, notes or activities.
update public.time_entries e set planned_shift_id=null where e.deleted_at is not null and e.planned_shift_id is not null;
update public.time_entries e set planned_shift_id=null where e.planned_shift_id is not null and not exists(select 1 from public.planned_shifts s where s.id=e.planned_shift_id and s.employee_id=e.user_id and s.project_id=e.project_id and s.status not in ('DRAFT','CANCELLED'));
update public.planned_shifts s set status=case when e.clock_out_at is null then 'IN_PROGRESS' else 'COMPLETED' end,updated_at=clock_timestamp() from public.time_entries e where e.planned_shift_id=s.id and e.deleted_at is null and e.user_id=s.employee_id and e.project_id=s.project_id and s.status not in ('DRAFT','CANCELLED') and s.status is distinct from case when e.clock_out_at is null then 'IN_PROGRESS' else 'COMPLETED' end;
update public.planned_shifts s set status=case when s.start_at+make_interval(mins=>(select grace_minutes from public.shift_planning_settings where id))<clock_timestamp() then 'NO_SHOW' else 'PUBLISHED' end,updated_at=clock_timestamp() where s.status in ('IN_PROGRESS','COMPLETED') and not exists(select 1 from public.time_entries e where e.planned_shift_id=s.id and e.deleted_at is null and e.user_id=s.employee_id and e.project_id=s.project_id);
create or replace function public.attendance_plan_details(p_actor uuid,p_entries uuid[]) returns jsonb language plpgsql security definer set search_path=public as $$
declare is_admin boolean; result jsonb; grace integer;
begin
 select role='ADMIN' into is_admin from profiles where id=p_actor and role in ('ADMIN','USER') and status='ACTIVE' and permanently_deleted_at is null;
 if not found then raise exception 'ATTENDANCE_ACCESS_REQUIRED';end if;
 if p_entries is null or cardinality(p_entries)>1000 or array_position(p_entries,null) is not null then raise exception 'INVALID_FILTERS';end if;
 select grace_minutes into grace from shift_planning_settings where id;
 select coalesce(jsonb_object_agg(e.id,jsonb_build_object('planned_shift_id',s.id,'planned_start_at',s.start_at,'planned_end_at',s.end_at,'planned_seconds',extract(epoch from(s.end_at-s.start_at))::bigint,'attendance_status',case when e.clock_in_at>s.start_at+make_interval(mins=>coalesce(grace,15)) then 'LATE' else 'ON_TIME' end,'arrival_difference_minutes',floor(extract(epoch from(e.clock_in_at-s.start_at))/60)::integer,'difference_minutes',case when e.clock_out_at is not null then floor((e.duration_seconds-extract(epoch from(s.end_at-s.start_at)))/60)::integer end)),'{}'::jsonb)
 into result from time_entries e join planned_shifts s on s.id=e.planned_shift_id and s.employee_id=e.user_id and s.project_id=e.project_id and s.status not in ('DRAFT','CANCELLED') where e.id=any(p_entries) and (is_admin or e.user_id=p_actor) and e.deleted_at is null;
 return result;
end $$;
revoke all on function public.link_planned_attendance(),public.sync_planned_attendance(),public.attendance_plan_details(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.link_planned_attendance(),public.sync_planned_attendance(),public.attendance_plan_details(uuid,uuid[]) to service_role;
notify pgrst,'reload schema';
commit;
select 'READY' as status,to_regprocedure('public.attendance_plan_details(uuid,uuid[])') is not null as comparison_ready,exists(select 1 from pg_trigger where tgname='sync_planned_attendance' and (tgtype&8)=8) as removal_sync_ready,not has_function_privilege('authenticated','public.attendance_plan_details(uuid,uuid[])','EXECUTE') as direct_access_blocked;
