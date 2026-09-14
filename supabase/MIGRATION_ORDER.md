# Database migration order

The API requires every item below. Running only `schema.sql` is incomplete and
will cause runtime failures in chat and time tracking.

## New project

Run these files in the Supabase SQL Editor, in this exact order:

1. `supabase/schema.sql`
2. `supabase/access-request-flow.sql`
3. `supabase/employee-chat.sql`
4. `supabase/migrations/0001_break_end_rpc.sql`
5. `supabase/migrations/0002_clock_out_rpc.sql`
6. `supabase/migrations/0003_time_entry_schedule_snapshot.sql`
7. `supabase/migrations/0004_compute_schedule_compliance.sql`
8. `supabase/migrations/0005_access_request_expiry_24_hours.sql`
9. `supabase/migrations/0006_lock_down_time_entries_rls.sql`
10. `supabase/migrations/0007_admin_time_entry_rpcs.sql`
11. `supabase/migrations/0008_schedule_workdays.sql`
12. `supabase/r2-profile-photos.sql`
13. `supabase/permanent-user-delete.sql`
14. `supabase/admin-remark-notifications.sql`

Then configure the environment variables and run `npm run db:verify` from a
machine with the target project's `SUPABASE_URL` and `SUPABASE_SECRET_KEY`.

## Existing project

Do **not** rerun `schema.sql`. Apply `supabase/current-production-upgrade.sql`
first, then apply every missing file in the new-project list above. Review each
file before applying it: older installations can have feature-specific patches
already present.

## Operational rule

Record each applied file and timestamp in the deployment change record. A
future migration tool may replace this manual sequence, but it must preserve
the same order and run `npm run db:verify` before the API is released.
