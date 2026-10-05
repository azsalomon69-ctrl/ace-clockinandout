-- Diagnostic queries only. NOT executed during this audit.
-- Run with an authorized read-only database connection. Results may contain
-- internal schema details. Do not attach raw employee records or credentials.
begin transaction read only;
set local statement_timeout = '15s';

-- Actual function signatures, security mode, and API-role access.
select p.oid::regprocedure as signature, p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
 'approve_entry_overtime','clock_in_entry_with_audit','clock_out_entry',
 'admin_stop_entry','admin_correct_entry','admin_update_profile_with_audit',
 'change_user_status_with_audit','change_user_role_with_audit',
 'archive_time_entry_with_audit','permanently_remove_archived_login',
 'compute_schedule_compliance','ace_session_profile','ace_end_session');

-- The generated expression must match the deliberately chosen duration policy.
select column_name, data_type, is_generated, generation_expression
from information_schema.columns
where table_schema='public' and table_name='time_entries'
and column_name in ('duration_seconds','break_seconds','break_started_at',
 'schedule_id','scheduled_start_time','scheduled_end_time','scheduled_weekdays');

select tablename, indexname, indexdef from pg_indexes
where schemaname='public' and tablename in ('time_entries','user_projects','invitations');
select conrelid::regclass as relation, conname, pg_get_constraintdef(oid) as definition
from pg_constraint where conrelid in ('public.profiles'::regclass,
 'public.time_entries'::regclass,'public.user_schedule_assignments'::regclass);

-- Counts identify candidates; they do NOT authorize rewriting or deleting them.
select count(*) as open_entries,
 count(*) filter (where deleted_at is not null) as archived_open_entries,
 count(*) filter (where clock_in_at < now()-interval '16 hours') as open_over_16h
from public.time_entries where clock_out_at is null;
select count(*) as users_with_multiple_open_entries from (
 select user_id from public.time_entries where clock_out_at is null
 group by user_id having count(*)>1
) t;
select count(*) as open_entries_with_inactive_owner
from public.time_entries e join public.profiles p on p.id=e.user_id
where e.clock_out_at is null and (p.status<>'ACTIVE' or p.permanently_deleted_at is not null);
select count(*) as active_admins from public.profiles
where role='ADMIN' and status='ACTIVE' and permanently_deleted_at is null;
select count(*) as active_profiles_with_auth_ban
from public.profiles p join auth.users u on u.id=p.id
where p.status='ACTIVE' and p.permanently_deleted_at is null and u.banned_until>now();

select count(*) as overnight_snapshot_entries,
 count(*) filter (where overtime_approved_at is not null) as already_approved
from public.time_entries
where schedule_type='FIXED' and scheduled_end_time<scheduled_start_time;
select count(*) as snapshots_with_removed_schedule
from public.time_entries where schedule_id is null and schedule_type is not null;
select count(*) as conversations_over_200 from (
 select least(sender_id,recipient_id), greatest(sender_id,recipient_id)
 from public.employee_messages group by 1,2 having count(*)>200
) t;

-- Migration ledger presence is discovery only; do not assume a tool was used.
select to_regclass('supabase_migrations.schema_migrations') as migration_ledger;
rollback;
