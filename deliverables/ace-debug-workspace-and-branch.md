# ACE Debug Workspace and Branch Guide

**Status snapshot:** 15 October 2026  
**Source branch:** `akio/employee-debug-workspace`  
**Source commit at snapshot:** `62643d5` (`Enlarge admin dashboard quick actions card`)

This guide describes the isolated employee test workspace, where its data lives, how its service is built, and what is currently in its Git branch. It supplements the setup scripts; it does not replace them.

## Backend stability and change policy

The production backend on `main` is considered stable. Routine ACE Debug work should focus on frontend styling, layout, and interaction refinements. Keep the debug backend aligned with the production backend and do not make backend changes in either environment as part of frontend-only work. Change backend code only when a new feature actually requires a backend capability; review that requirement explicitly and keep any test-workspace isolation safeguards intact. Debug-only schema setup and service configuration are not production backend changes and must not be promoted to `main` as part of a frontend release.

## At a glance

| Workspace | Frontend | API | Application-data schema | Purpose |
| --- | --- | --- | --- | --- |
| Production | [aceclock.onrender.com](https://aceclock.onrender.com/) | `ace-clockinandout.onrender.com` | `public` | Real employee and administrator operations |
| ACE Debug | [ace-clock-debug-workspace.onrender.com](https://ace-clock-debug-workspace.onrender.com/) | Same debug service origin | `ace_debug` | Synthetic employee and administrator testing |

The two workspaces use separate Render services and separate builds. A change deployed to ACE Debug does not automatically update the production static site. The Supabase project and Supabase Auth are shared, while application rows used by the debug API are stored in `ace_debug`.

## Isolation model

The important boundary is the API's fixed database schema. At startup, the server reads `ACE_DEBUG_MODE` and `SUPABASE_DB_SCHEMA` and rejects mismatched values:

- Production API: `ACE_DEBUG_MODE=false`, `SUPABASE_DB_SCHEMA=public` (or the default `public`).
- Debug API: `ACE_DEBUG_MODE=true`, `SUPABASE_DB_SCHEMA=ace_debug`.

The debug browser build must also set `ACE_DEBUG_MODE=true` and an explicit `ACE_API_URL` for the debug service. It must not use a production API fallback. The build adds a visible **TEST DATA** banner and a return link to the production admin workspace. Its Content Security Policy removes the production API origin from `connect-src` and allows the configured debug origin.

The backend uses the server-only Supabase secret key. That key bypasses RLS, so RLS alone is not the isolation mechanism. The server-side schema setting, the debug-only API instance, and the schema-qualified debug functions keep application queries and writes in `ace_debug`. The setup SQL grants the schema's tables and functions to `service_role`, and revokes browser-role grants from `anon` and `authenticated`.

There are no copied employee rows from `public`. The seed template creates synthetic department, project, schedule, time-entry, and profile data in `ace_debug`. It maps the head administrator's existing Auth user ID to a synthetic `Debug Employee` profile only in `ace_debug`; the production profile and role are not changed. The seed also creates a separate synthetic debug administrator profile for internal test relationships.

Supabase Auth, Auth session identity, project-level Supabase logs, database capacity, and usage quotas remain shared. `ace_debug.ace_revoked_sessions` has a deliberate reference to `auth.sessions` for session validation; it does not put application records in `public`. Debug actions may be recorded in `ace_debug.audit_logs`; they do not use production audit rows or production audit-writing RPCs.

## Debug role switch

The role switch is available only in the debug build and only to the authenticated head administrator. The API verifies the current Auth user, the matching debug profile, and the configured head-admin email before accepting `POST /v1/debug/switch-role`.

The switch changes the role on that user's `ace_debug.profiles` row between `USER` and `ADMIN`, clears the profile cache, and reloads the corresponding dashboard. It does not alter `public.profiles` and does not turn on production head-admin privileges. When the debug profile is `ADMIN`, administrator workflows still operate against debug-schema data.

## Tables and database objects

`supabase/debug-workspace.sql` prepares these application tables in `ace_debug`:

- `departments`
- `profiles`
- `projects`
- `invitations`
- `user_projects`
- `time_entries`
- `work_schedules`
- `user_schedule_assignments`
- `admin_remarks`
- `employee_messages`
- `profile_tutorial_progress`
- `reports`
- `report_exports`
- `audit_logs`

It also creates `ace_debug.ace_revoked_sessions`. Table definitions are cloned without cloning production rows. The setup recreates the selected application foreign keys so they point within `ace_debug`; `supabase/debug-workspace-verify-access.sql` checks for foreign keys pointing to `public` and browser-role grants.

The debug schema defines its own update/audit triggers and session, clock-in, and clock-out functions. Those functions write to debug tables. The contract function `ace_debug.ace_backend_contract()` is checked by the debug database verifier. Column types such as the existing PostgreSQL role and status enums are reused from `public`; they are shared type definitions, not shared employee records.

### Why the three admin tables were added

The debug administrator view calls routes that also exist in production. The reported `/v1/invitations` 500 was caused by the missing `ace_debug.invitations` table. The `/v1/reports` route reads/writes `ace_debug.reports` and `ace_debug.report_exports`. The other required profile, project, time-entry, and audit tables were already part of the debug schema setup. Therefore the recent database change added those three missing tables and their internal foreign-key relationships rather than copying every production table.

The source scripts now include all three. The user previously reported 500 responses before confirming that the updated SQL had been applied, so database readiness for those routes remains to be verified in Supabase. A successful `/health` response confirms that the service can reach its configured schema's `profiles` table; it does not prove every route's tables exist.

## Supabase setup and verification

Use the SQL Editor in the existing Supabase project. Review each script before running it:

1. Run [`supabase/debug-workspace.sql`](../supabase/debug-workspace.sql) to create/update the debug tables, constraints, grants, triggers, and RPCs. It creates table definitions only; it does not copy production data.
2. Run [`supabase/debug-workspace-repair-foreign-keys.sql`](../supabase/debug-workspace-repair-foreign-keys.sql) to repair any copied foreign keys that still point to `public`.
3. If the synthetic employee seed has not been created, use [`supabase/debug-workspace-seed.template.sql`](../supabase/debug-workspace-seed.template.sql). Replace its email placeholder with the existing head-admin Auth email before execution. The seed reads that Auth record and writes synthetic application rows only to `ace_debug`.
4. Run [`supabase/debug-workspace-verify-access.sql`](../supabase/debug-workspace-verify-access.sql). Expected checks include zero foreign keys to `public`, zero table/function grants to `anon` or `authenticated`, and `true` for the `service_role` access checks.
5. Run the backend contract verifier with the debug API environment set: `ACE_DEBUG_MODE=true`, `SUPABASE_DB_SCHEMA=ace_debug`, `SUPABASE_URL`, and `SUPABASE_SECRET_KEY`. It verifies core columns and specifically checks `invitations`, `reports`, and `report_exports` with their profile/report relationships.

Configure `ace_debug` as a schema accepted by the Supabase Data API so the server client can select it with its schema setting. Keep table/function access server-side: do not grant `anon` or `authenticated` access or create browser-facing policies for these tables. Do not turn on every exposure warning blindly; use the SQL grant model and verification query as the authority for privileges.

## Render service setup

The live debug workspace is a separately created Render Web Service in the existing Render project. The chosen workflow is to manage it in the Render dashboard, without creating or syncing a Blueprint. This does not create another Render project.

The repository still contains a `render.yaml` entry for the debug service. Do not use or sync that Blueprint configuration for the current manually managed service; its presence in the repository is not evidence that the Render service is managed by a Blueprint.

Configure the debug service to deploy from `akio/employee-debug-workspace` with:

```text
Build command: npm install --include=dev && npm run build
Start command: npm start
Health check:  /health
```

The build command includes development dependencies because the frontend build uses `clean-css`, `html-minifier-terser`, and `terser`. A prior deploy using plain `npm install` failed because `clean-css` was not installed.

Set these server/build environment values in the Render dashboard (never commit secret values):

```text
NODE_ENV=production
ACE_DEBUG_MODE=true
SUPABASE_DB_SCHEMA=ace_debug
SUPABASE_URL=<the existing Supabase project URL>
SUPABASE_SECRET_KEY=<server-only Supabase secret key>
SUPABASE_PUBLISHABLE_KEY=<Supabase publishable key used by Auth in the browser>
HEAD_ADMIN_EMAIL=<the head administrator's existing Auth email>
ACE_API_URL=<https://ace-clock-debug-workspace.onrender.com>
FRONTEND_ORIGIN=<https://ace-clock-debug-workspace.onrender.com>
ACE_ADMIN_WORKSPACE_URL=https://aceclock.onrender.com/
```

`ACE_API_URL` and `FRONTEND_ORIGIN` must use the exact debug service origin assigned by Render. `ACE_ADMIN_WORKSPACE_URL` points the test-data banner back to the regular production frontend. Keep Supabase secret keys only in the Render service's server environment. If Auth redirects fail, add the debug `/login` URL to Supabase Auth's allowed redirect URLs; keep the production Site URL unchanged.

The debug service's expected health response identifies the debug service and reports `schema: "ace_debug"`. Render free instances may sleep when idle and take time to wake. The debug service's own deployment status and the Supabase SQL state should be checked separately.

## Git branch guide

### Current branch state

At the snapshot above:

- `akio/employee-debug-workspace` is checked out and tracks `origin/akio/employee-debug-workspace`.
- Its source head is `62643d5`; the worktree was clean before this documentation file was created.
- `origin/main` is at `23e65f8`. The feature branch contains 25 commits beyond that ref and no commits behind it.
- The local `main` ref is at `4c822d5`, six commits behind `origin/main`.

These counts are a dated snapshot. Recheck remote refs before merging or releasing. The branch has not been merged into `main` as of this snapshot.

### What the branch contains

This is the working branch for the isolated employee test workspace, but it also contains subsequent employee/admin interface refinements. Relative to `origin/main` at the snapshot, the branch changes 14 files, chiefly:

- Debug API schema pinning, API mode checks, debug role switching, and serving the debug frontend from the debug service.
- Frontend build-time API targeting, debug banner, return link, CSP restrictions, and generated asset building.
- Supabase setup, seed, foreign-key repair, access verification, and database contract verification scripts.
- Employee dashboard spacing, theme, icon, and button styling updates; admin dropdown clipping fixes and quick-action layout updates.
- Render configuration and repository documentation.

The branch's key debug-related commits include `a3cf119` (initial isolated workspace), `2bc74d0` (add missing admin tables), and `ee51b50` (dropdown clipping and debug role switch). Later commits include shared employee UI refinements; inspect the complete diff before promoting the whole branch.

### Branch workflow and production separation

Push ordinary debug-workspace development to `akio/employee-debug-workspace`. The debug Render service must be configured to deploy that branch; confirm its deployed commit in the Render dashboard after a push. The production static site is a different Render service and does not update merely because the debug service builds a newer commit.

Promote reviewed frontend changes from this branch to `main` as a frontend-only change. Do not merge the entire debug branch: it also contains debug API isolation, schema SQL, backend contract checks, and Render configuration. Keep those changes on the debug branch. Before a frontend promotion, review frontend JavaScript for debug-only calls and confirm that production behavior does not depend on debug API fields or routes. Keep the debug service manually managed in Render; do not sync `render.yaml` as a Blueprint.

## Source files

- API schema selection and debug guards: `backend/server/index.js`
- Debug frontend build and test banner: `scripts/build-frontend.js`
- Database setup: `supabase/debug-workspace.sql`
- Synthetic seed: `supabase/debug-workspace-seed.template.sql`
- Foreign-key repair: `supabase/debug-workspace-repair-foreign-keys.sql`
- Read-only access verification: `supabase/debug-workspace-verify-access.sql`
- Backend schema contract check: `scripts/verify-database-contract.js`
- Debug environment variable examples: `.env.example`
- Existing planning notes: `deliverables/employee-debug-workspace-plan.md`
