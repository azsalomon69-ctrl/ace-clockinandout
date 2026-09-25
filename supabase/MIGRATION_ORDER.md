# Supabase migration order

Use this document when provisioning a new Supabase project, bringing an existing project up to the current schema, or re-offering the built-in tutorial.

Before changing a production database, take a Supabase backup and run the SQL in the Supabase SQL Editor with an administrator account.

## New Supabase project

Run these files in this order:

1. `schema.sql`
2. `current-production-upgrade.sql`
3. `migrations/0001_break_end_rpc.sql`
4. `migrations/0002_clock_out_rpc.sql`
5. `migrations/0003_time_entry_schedule_snapshot.sql`
6. `migrations/0004_compute_schedule_compliance.sql`
7. `migrations/0005_access_request_expiry_24_hours.sql`
8. `migrations/0006_lock_down_time_entries_rls.sql`
9. `migrations/0007_admin_time_entry_rpcs.sql`
10. `migrations/0008_schedule_workdays.sql`
11. `migrations/0009_profile_tutorial_state.sql`
12. `migrations/0009_remove_break_tracking.sql`
13. `migrations/0010_overtime_approval.sql`
14. `migrations/0011_review_exports_and_reporting_indexes.sql`
15. `migrations/0012_preserve_original_chat_message.sql`
16. `migrations/0013_access_request_atomic_audit.sql`
17. `migrations/0014_transactional_lifecycle_audit_and_request_ids.sql`
18. `migrations/0015_atomic_archive_restore_auth_state.sql`
19. `migrations/0016_idempotent_user_status_audit.sql`
20. `migrations/0017_idempotent_user_role_audit.sql`

Then run:

```bash
npm run db:verify
```

`schema.sql` establishes the baseline tables and policies. `current-production-upgrade.sql` is idempotent and adds every database object required by the current API that may be absent from an older base schema. The numbered migrations then add the current atomic clock, schedule-compliance, access-request expiry, RLS, admin time-entry, workday, and tutorial-state behavior.

`schema.sql` already contains the final access-request trigger and `review_access_request(...)` RPC used by migration 0013. Running migration 0013 after the clean-install sequence is still intentional: it makes the fresh-install path and the existing-project path converge on the same explicit migration contract.

The other SQL files in `supabase/` are retained as targeted historical upgrades for deployments that adopted a feature before the consolidated upgrade existed. Do not run them in addition to the sequence above unless a maintainer has identified that exact missing feature. `access-request-flow.sql` is one such legacy upgrade: it supplies the access-request columns and indexes that a pre-existing project may lack; it is not an extra clean-install step. For example, `r2-profile-photos.sql` configures profile-photo fields, while image storage itself is handled by Cloudinary.

## Existing production project

Do not rerun `schema.sql` over a working production database.

1. Back up the database.
2. Run `current-production-upgrade.sql` first.
3. Run the relevant missing numbered files in `supabase/migrations/` in order, only when the database has not already received them.
4. Before migration 0013, run the **Access-request 0013 preflight** below. If it reports that `profile_id`, `requested_role`, `expires_at`, or `request_ip` is missing, apply `access-request-flow.sql` first, then rerun the preflight. This legacy upgrade also creates the supporting access-request indexes and removes the historical one-row-per-email constraint.
5. Apply `migrations/0013_access_request_atomic_audit.sql` only after its prerequisites are present.
6. Apply `migrations/0014_transactional_lifecycle_audit_and_request_ids.sql` after 0013. It adds the nullable audit correlation field and transactional lifecycle/time-entry functions.
7. Apply `migrations/0015_atomic_archive_restore_auth_state.sql` after 0014. It places Auth ban/unban state, profile state, and audit evidence in the archive/restore transaction.
8. Apply `migrations/0016_idempotent_user_status_audit.sql` after 0015. It makes approval/denial retries audit-idempotent.
9. Apply `migrations/0017_idempotent_user_role_audit.sql` after 0016. It makes role-change retries audit-idempotent.
10. Run `npm run db:verify` and resolve any reported missing table, column, or RPC before deploying the API.

The repository retains several older, feature-specific SQL files because earlier deployments may have applied them individually. They are not extra steps on top of the current fresh-install order unless a maintainer has specifically identified a missing feature. Do not blindly re-run historical patches such as schedule, break, notes, or soft-delete migrations against a current schema.

### Access-request 0013 preflight

Run this read-only query in the Supabase SQL Editor before applying 0013 to an existing project. Every required column/object check must return `present`, and the duplicate-pending query must return zero rows. `npm run db:verify` performs the API-visible table/RPC checks as well; this SQL preflight additionally checks database-only triggers, RLS, and function grants.

```sql
with required_columns(table_name, column_name) as (
  values
    ('access_requests', 'profile_id'),
    ('access_requests', 'requested_role'),
    ('access_requests', 'expires_at'),
    ('access_requests', 'request_ip'),
    ('access_requests', 'reviewed_by_user_id'),
    ('audit_logs', 'user_id'),
    ('audit_logs', 'action'),
    ('audit_logs', 'entity_type'),
    ('audit_logs', 'entity_id'),
    ('audit_logs', 'description')
)
select rc.table_name, rc.column_name,
  case when c.column_name is null then 'MISSING' else 'present' end as status
from required_columns rc
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name = rc.table_name
 and c.column_name = rc.column_name
order by rc.table_name, rc.column_name;

select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('access_requests', 'audit_logs')
order by c.relname;

select c.relname as table_name, t.tgname as trigger_name, t.tgenabled
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('access_requests', 'audit_logs')
  and not t.tgisinternal
order by c.relname, t.tgname;

select
  to_regprocedure('public.review_access_request(uuid,uuid,text,public.user_role,uuid)')
    as review_rpc,
  has_function_privilege(
    'service_role',
    'public.review_access_request(uuid,uuid,text,public.user_role,uuid)',
    'EXECUTE'
  ) as service_role_can_execute,
  has_function_privilege(
    'authenticated',
    'public.review_access_request(uuid,uuid,text,public.user_role,uuid)',
    'EXECUTE'
  ) as authenticated_can_execute;

select profile_id, count(*) as live_pending_requests
from public.access_requests
where status = 'PENDING' and expires_at > now()
group by profile_id
having count(*) > 1;
```

Before 0013, the `access_requests_audit`, `access_requests_one_pending`, and `review_access_request` entries are expected to be absent. After it, the trigger list must contain both access-request triggers, `audit_logs_immutable` must remain present, the RPC must resolve, `service_role_can_execute` must be true, and `authenticated_can_execute` must be false.

### Controlled deployment of 0013

Migration 0013 and the matching API revision are an all-or-nothing release pair. The old API writes a best-effort access-request audit entry after its request/review state write; 0013 adds the database audit trigger. During an **old API + new database** overlap, the same access-request event can be recorded twice. During a **new API + old database** overlap, request creation can lose its audit event and reviews fail because `review_access_request` does not exist.

Use a controlled maintenance window: take traffic away from the API (or disable access-request actions), verify the preflight, apply 0013, run `npm run db:verify`, deploy the matching new API, verify health and one safe access-request flow, then restore traffic. Do not roll back only one side. If rollback is necessary, place the API back in maintenance first, restore both the database state and the matching old API together, then verify the old behavior. A compatibility bridge is technically possible but would intentionally retain a non-atomic review path and requires migration-presence detection, so it is not a safe zero-downtime substitute.

## Re-offer the tutorial

Tutorial progress lives in `public.profiles`. Reset only the users who should receive the tutorial again.

### Reset selected users

Replace the email list as needed. Use version `4` for employees and version `6` for administrators.

```sql
UPDATE public.profiles
SET
  tutorial_status = 'NOT_STARTED',
  tutorial_step = 0,
  tutorial_version = CASE
    WHEN role = 'ADMIN' THEN 6
    ELSE 4
  END,
  tutorial_started_at = NULL,
  tutorial_completed_at = NULL,
  tutorial_skipped_at = NULL
WHERE email IN (
  'employee@example.com',
  'admin@example.com'
)
RETURNING full_name, email, role, tutorial_status, tutorial_step, tutorial_version;
```

### Reset all employees

```sql
UPDATE public.profiles
SET
  tutorial_status = 'NOT_STARTED',
  tutorial_step = 0,
  tutorial_version = 4,
  tutorial_started_at = NULL,
  tutorial_completed_at = NULL,
  tutorial_skipped_at = NULL
WHERE role = 'USER';
```

### Reset all administrators

```sql
UPDATE public.profiles
SET
  tutorial_status = 'NOT_STARTED',
  tutorial_step = 0,
  tutorial_version = 6,
  tutorial_started_at = NULL,
  tutorial_completed_at = NULL,
  tutorial_skipped_at = NULL
WHERE role = 'ADMIN';
```

The tutorial starts again on the user’s next active session. It guides through the visible sidebar rather than automatically navigating away from their current page.

## Deployment checks after a migration

1. Run `npm run db:verify` with the API environment configured.
2. Confirm the API health endpoint returns successfully: `/health`.
3. Sign in as one administrator and one employee.
4. Confirm the correct role-specific sidebar, Need help content, and tutorial version appear.
5. Test a safe invitation or access-request flow before relying on production mail delivery.
