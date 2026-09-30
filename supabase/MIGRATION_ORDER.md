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
21. `migrations/0018_time_entry_clock_in_audit.sql`
22. `migrations/0019_admin_remark_notifications.sql`
23. `migrations/0020_remove_access_request_flow.sql`
24. `migrations/0021_require_invitation_for_google_login.sql`
25. `migrations/0022_project_assignment_contract.sql`

Then run:

```bash
npm run db:verify
```

`schema.sql` establishes the baseline tables and policies. `current-production-upgrade.sql` is idempotent and adds every database object required by the current API that may be absent from an older base schema. The numbered migrations then add the current atomic clock, schedule-compliance, RLS, admin time-entry, workday, tutorial-state, and notification behavior.

The other SQL files in `supabase/` are retained as targeted historical upgrades for deployments that adopted a feature before the consolidated upgrade existed. Do not run them in addition to the sequence above unless a maintainer has identified that exact missing feature. Historical access-request migrations are retained only so older deployed databases can reach migration 0020; they do not represent a current product feature.

## Existing production project

Do not rerun `schema.sql` over a working production database.

1. Back up the database.
2. Run `current-production-upgrade.sql` first.
3. Run the relevant missing numbered files in `supabase/migrations/` in order, only when the database has not already received them.
4. Apply missing numbered files in order through `migrations/0019_admin_remark_notifications.sql`.
5. Apply `migrations/0020_remove_access_request_flow.sql`. It removes the retired self-service access-request table, triggers, and RPCs while retaining immutable historical audit logs.
6. Apply `migrations/0021_require_invitation_for_google_login.sql`. It rejects Google sign-ins that do not match an active invitation, preventing new pending profiles from being created.
6. Run `npm run db:verify` and resolve any reported missing table, column, or RPC before deploying the API.

The repository retains several older, feature-specific SQL files because earlier deployments may have applied them individually. They are not extra steps on top of the current fresh-install order unless a maintainer has specifically identified a missing feature. Do not blindly re-run historical patches such as schedule, break, notes, or soft-delete migrations against a current schema.

### Retiring self-service access requests

Apply migration 0020 only after the deployed API no longer exposes access-request routes. It removes the retired table and related database functions. Existing rows in `audit_logs` are intentionally not removed: those immutable records remain valid history.

## Re-offer the tutorial

Tutorial progress lives in `public.profiles`. Reset only the users who should receive the tutorial again.

### Reset selected users

Replace the email list as needed. Use version `8` for employees and version `14` for administrators.

```sql
UPDATE public.profiles
SET
  tutorial_status = 'NOT_STARTED',
  tutorial_step = 0,
  tutorial_version = CASE
    WHEN role = 'ADMIN' THEN 14
    ELSE 8
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
  tutorial_version = 8,
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
  tutorial_version = 14,
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
5. Test a safe administrator invitation flow before relying on production mail delivery.
