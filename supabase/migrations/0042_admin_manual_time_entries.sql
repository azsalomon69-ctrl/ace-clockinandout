begin;

alter table public.time_entries
  add column manual_created_by uuid references public.profiles(id),
  add column manual_reason text;

-- Use the queue's employee lock too. Ordinary attendance remains unchanged,
-- except that it cannot overlap an administrator-entered interval.
create function public.guard_manual_time_overlap() returns trigger
language plpgsql set search_path = public as $$
begin
  perform 1 from public.profiles where id = new.user_id for no key update;
  if new.deleted_at is null and exists (
    select 1 from public.time_entries e
    where e.user_id = new.user_id and e.id <> new.id and e.deleted_at is null
      and (new.manual_created_by is not null or e.manual_created_by is not null)
      and e.clock_in_at < coalesce(new.clock_out_at, 'infinity'::timestamptz)
      and coalesce(e.clock_out_at, 'infinity'::timestamptz) > new.clock_in_at
  ) then
    raise exception 'TIME_ENTRY_OVERLAP' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger guard_manual_time_overlap before insert or update of clock_in_at, clock_out_at, deleted_at
on public.time_entries for each row execute function public.guard_manual_time_overlap();

create function public.admin_add_time_entry(
  p_actor uuid, p_employee uuid, p_entry uuid, p_clock_in timestamptz,
  p_clock_out timestamptz, p_project uuid, p_reason text,
  p_ip inet default null, p_agent text default null, p_request uuid default null
) returns public.time_entries language plpgsql security definer set search_path = public as $$
declare
  v_entry public.time_entries;
begin
  if not exists(select 1 from public.profiles where id=p_actor and role='ADMIN'
    and status='ACTIVE' and permanently_deleted_at is null) then
    raise exception 'ADMIN_REQUIRED' using errcode='P0001';
  end if;
  perform 1 from public.profiles where id=p_employee and role='USER'
    and permanently_deleted_at is null for no key update;
  if not found then raise exception 'EMPLOYEE_NOT_FOUND' using errcode='P0001'; end if;
  if p_entry is null or p_clock_in is null or p_clock_out is null
    or not isfinite(p_clock_in) or not isfinite(p_clock_out)
    or p_clock_out <= p_clock_in or p_clock_out > clock_timestamp()
    or p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'INVALID_MANUAL_ENTRY' using errcode='P0001';
  end if;
  select * into v_entry from public.time_entries where id=p_entry;
  if found then
    if v_entry.user_id=p_employee and v_entry.manual_created_by=p_actor
      and v_entry.clock_in_at=p_clock_in and v_entry.clock_out_at=p_clock_out
      and v_entry.project_id is not distinct from p_project
      and v_entry.manual_reason=btrim(p_reason) and v_entry.deleted_at is null then
      return v_entry;
    end if;
    raise exception 'MANUAL_ENTRY_CONFLICT' using errcode='P0001';
  end if;
  if p_project is not null and not exists(select 1 from public.projects where id=p_project and is_active) then
    raise exception 'PROJECT_UNAVAILABLE' using errcode='P0001';
  end if;
  -- Historical schedule assignments cannot be reconstructed reliably. Leave
  -- the schedule snapshot empty rather than inventing retrospective compliance.
  insert into public.time_entries(id,user_id,project_id,clock_in_at,clock_out_at,manual_created_by,manual_reason)
  values(p_entry,p_employee,p_project,p_clock_in,p_clock_out,p_actor,btrim(p_reason)) returning * into v_entry;
  insert into public.audit_logs(user_id,action,entity_type,entity_id,description,ip_address,user_agent,request_id)
  values(p_actor,'ADMIN_ADD_TIME_ENTRY','TIME_ENTRY',v_entry.id,
    format('Added missed shift for %s from %s to %s. Reason: %s',p_employee,p_clock_in,p_clock_out,btrim(p_reason)),p_ip,p_agent,p_request);
  return v_entry;
end;
$$;
revoke all on function public.admin_add_time_entry(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text,inet,text,uuid) from public,anon,authenticated;
grant execute on function public.admin_add_time_entry(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text,inet,text,uuid) to service_role;

notify pgrst, 'reload schema';
commit;
