begin;
alter table public.time_entries add column if not exists overtime_approved_seconds integer not null default 0 check (overtime_approved_seconds >= 0), add column if not exists overtime_approved_by_user_id uuid references public.profiles(id) on delete set null, add column if not exists overtime_approved_at timestamptz;
create or replace function public.approve_entry_overtime(p_entry_id uuid, p_admin_id uuid) returns public.time_entries language plpgsql security definer set search_path = public as $$
declare v_entry public.time_entries; v_end timestamptz; v_seconds integer;
begin
 select * into v_entry from public.time_entries where id=p_entry_id and deleted_at is null and clock_out_at is not null for update;
 if not found then raise exception 'ENTRY_NOT_FOUND' using errcode='P0001'; end if;
 if v_entry.schedule_type is distinct from 'FIXED' or v_entry.scheduled_end_time is null then raise exception 'NO_FIXED_SCHEDULE' using errcode='P0001'; end if;
 v_end := ((v_entry.clock_in_at at time zone 'Asia/Manila')::date + v_entry.scheduled_end_time) at time zone 'Asia/Manila';
 v_seconds := greatest(0,floor(extract(epoch from (v_entry.clock_out_at-v_end)))::integer);
 update public.time_entries set overtime_approved_seconds=v_seconds,overtime_approved_by_user_id=p_admin_id,overtime_approved_at=now() where id=p_entry_id returning * into v_entry;
 insert into public.audit_logs(user_id,action,entity_type,entity_id,description) values(p_admin_id,'APPROVE_OVERTIME','TIME_ENTRY',p_entry_id,format('Approved %s overtime seconds',v_seconds)); return v_entry;
end; $$;
commit;
