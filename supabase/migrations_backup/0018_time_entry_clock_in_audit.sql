-- A clock-in and its audit evidence must be one database transaction.  The
-- historical backfill is deliberately idempotent so existing deployments can
-- safely apply this migration once they have completed the earlier sequence.

begin;

insert into public.audit_logs (user_id, action, entity_type, entity_id, description, created_at)
select
  entry.user_id,
  'CLOCK_IN',
  'TIME_ENTRY',
  entry.id,
  'Backfilled clock-in audit record for an existing time entry',
  entry.clock_in_at
from public.time_entries as entry
where not exists (
  select 1
  from public.audit_logs as audit
  where audit.entity_type = 'TIME_ENTRY'
    and audit.entity_id = entry.id
    and audit.action like 'CLOCK_IN%'
);

create or replace function public.clock_in_entry_with_audit(
  p_actor_user_id uuid,
  p_project_id uuid,
  p_schedule_id uuid,
  p_schedule_type text,
  p_scheduled_start_time time,
  p_scheduled_end_time time,
  p_target_seconds integer,
  p_scheduled_weekdays smallint[],
  p_ip_address inet default null,
  p_user_agent text default null,
  p_request_id uuid default null
)
returns public.time_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.time_entries;
  v_device text;
begin
  insert into public.time_entries (
    user_id, project_id, schedule_id, schedule_type, scheduled_start_time,
    scheduled_end_time, target_seconds, scheduled_weekdays
  ) values (
    p_actor_user_id, p_project_id, p_schedule_id, p_schedule_type,
    p_scheduled_start_time, p_scheduled_end_time, p_target_seconds,
    p_scheduled_weekdays
  ) returning * into v_entry;

  v_device := case when p_user_agent ~* 'Android|iPhone|iPad|iPod|Mobile|Windows Phone|IEMobile|Opera Mini' then 'mobile' else 'pc web' end;
  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, ip_address, user_agent, request_id)
  values (
    p_actor_user_id,
    format('CLOCK_IN (%s)', v_device),
    'TIME_ENTRY',
    v_entry.id,
    format('Started a time entry from %s', v_device),
    p_ip_address,
    p_user_agent,
    p_request_id
  );
  return v_entry;
end;
$$;

revoke all on function public.clock_in_entry_with_audit(uuid, uuid, uuid, text, time, time, integer, smallint[], inet, text, uuid) from public, anon, authenticated;
grant execute on function public.clock_in_entry_with_audit(uuid, uuid, uuid, text, time, time, integer, smallint[], inet, text, uuid) to service_role;

commit;
