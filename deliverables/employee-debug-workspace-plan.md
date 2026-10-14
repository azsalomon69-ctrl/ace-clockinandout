# Employee debug workspace plan

## Goal

Let the head administrator use the real employee screens with synthetic test data, while leaving employee and production application records untouched. Keep the production administrator workspace available in its normal browser tab.

## Chosen setup

- Keep the existing Supabase project and Supabase Auth.
- Put all debug application records in a dedicated PostgreSQL schema named `ace_debug` (a separate namespace containing a parallel set of tables, rather than one extra table).
- Run a separate Render web service configured to use `ace_debug` as its only PostgREST schema. It serves its own separately built frontend and API from the same origin. Do not add a client-controlled schema switch to the production API.
- Mark every debug page clearly as **TEST DATA** and link back to the original admin workspace.
- Seed `ace_debug` with one synthetic employee profile for the head administrator’s authenticated account and a small set of fake projects, schedule, and time entries. Do not copy employee rows from `public`.
- Keep debug audit records in `ace_debug.audit_logs`. Debug actions must never call production audit-writing functions.

## Why a schema and separate API

The backend currently has roughly 110 direct table/RPC calls. A test table alone would not cover the related employee workflow, and a missed route could still read or write the existing `public` tables. The API uses a server-side Supabase secret key, which bypasses row-level security, so RLS by itself is not an isolation boundary.

The separate API instance makes the schema choice a server setting. Its profile lookup must succeed only for the seeded head-admin debug profile; it must never fall back to `public.profiles`. The debug profile has employee role in `ace_debug`, while the real admin profile in `public` remains unchanged.

## Data and database objects to prepare

Create only the tables, enum types, constraints, indexes, triggers, and RPCs required by the employee experience, with all foreign keys referencing other objects inside `ace_debug`. At minimum, review the current employee routes for:

- `profiles`, `projects`, `user_projects`
- `work_schedules`, `user_schedule_assignments`
- `time_entries`, `admin_remarks`, `employee_messages`
- `profile_tutorial_progress`, `audit_logs`, and revoked-session state
- employee clock-in/clock-out and session RPCs used by the API

Use independent schema-qualified copies of any functions that write data. Do not make debug RPCs delegate writes to `public` functions. Auth token verification can still use the project’s shared Supabase Auth service; application profiles, session revocation state, clock records, messages, tutorial progress, and audit rows belong to the debug schema.

## Access and switching

1. Sign in with the existing head-admin account on the separate test frontend.
2. The debug API verifies that account’s Auth token, then loads its `ace_debug.profiles` row, which grants only the synthetic `USER` experience.
3. All employee reads and writes go to `ace_debug`; no production employee data is copied into the debug workspace.
4. Return to the normal admin browser tab to resume the production admin experience.

Do not create an “impersonate employee” header or query parameter on the production API. Do not add other employees’ profiles to `ace_debug`.

## Rollout sequence

1. Add a schema-scoped API configuration that validates the configured schema name and defaults to `public` for the existing production service.
2. Prepare the `ace_debug` schema and synthetic seed in the existing Supabase project; run the read-only access and foreign-key verification before deployment.
3. Configure an isolated debug API instance with the debug schema and head-admin allowlist. Verify startup fails closed if debug tables or required RPCs are missing.
4. Build a separate frontend pointing only to that API; provide a visible test-data banner and an easy link back to the admin workspace.
5. Before enabling it, verify synthetic employee actions create rows only in `ace_debug` and that sentinel records in `public` remain unchanged.
6. Apply the schema migration and enable the debug instance only after the isolation checks pass.

## Shared project resources

This keeps application records separate, but Supabase Auth, project-level logs, database capacity, and usage quotas remain shared. Signing in still uses the real administrator Auth account. The debug application’s own profile, tutorial, work, and audit records remain in `ace_debug`.

## Current status

The owner has successfully applied the `ace_debug` schema, repaired its internal foreign keys, seeded the synthetic employee workspace, and run the read-only access check. It returned zero production foreign keys, zero browser-role grants, and successful server-role checks. No production employee records were copied into the debug schema. Local code pins separate production/debug API schemas, keeps the debug user in ordinary employee mode, and adds one debug service to the existing Render Blueprint so it stays in the same Render project. The debug service has not been deployed or configured.
