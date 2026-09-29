# Supabase dependency audit and incremental decoupling plan

Date: 2026-09-30. Scope: static, whole-repository audit (source, SQL, scripts, deployment configuration, and environment-template names). No credentials were read or printed, and no live Supabase request was made.

## Executive conclusion

This application is **already data-API mediated**: the browser uses Supabase only for Google login/session lifecycle, then calls the Express API with its access token. There are **no source-level browser calls to `rest/v1`, Supabase Storage, Edge Functions, or Supabase Realtime**. Application reads and writes flow through Express, whose service/secret client bypasses RLS. That is an unusually good starting point for a staged migration.

The remaining Supabase lock-in is meaningful but contained:

1. GoTrue/Google OAuth and the browser session format.
2. Server validation of Supabase bearer tokens and one Admin API user listing used only for Google avatar enrichment.
3. The database schema's `auth.users` foreign key, auth-user creation trigger, archive/restore/delete SQL, two direct-read RLS policies, and `service_role` grants.
4. The server's use of the Supabase JS/PostgREST query builder. This is an adapter rewrite, not a frontend rewrite.

The concurrency-critical clock operations are PostgreSQL RPCs/transactions. Keep those database functions and constraints during a migration; replace only their PostgREST invocation with a normal PostgreSQL connection. Do not move their state transitions into application code as part of decoupling.

## Inventory

### Service summary

| Service | Used? | Where and how | Caller / reads-writes / RLS |
|---|---:|---|---|
| Auth (GoTrue) | Yes | Google OAuth, persisted/auto-refreshed browser sessions, logout; backend token validation; admin user listing/seed creation | Frontend and backend; session read/write and backend read; backend authorization comes from `profiles`, not RLS |
| Postgres through PostgREST / Supabase JS | Yes | Every application table query and RPC from Express | Backend only; reads and writes; service key normally bypasses RLS |
| PostgreSQL RPC | Yes | Clock state changes, user lifecycle/audit, archive/delete, overtime | Backend only; writes/transactional; granted to `service_role` |
| RLS | Configured | Enabled on primary tables; only two policies permit direct authenticated reads | No current source-level direct data caller; not the main backend authorization mechanism |
| Storage | No | Profile images use Cloudinary | N/A |
| Edge Functions | No | None found | N/A |
| Supabase Realtime | No | Chat uses an Express SSE endpoint, not Realtime | N/A |

### Runtime code

| Location | Service, direction, operation, authorization dependency |
|---|---|
| `frontend/js/supabase-auth.js:9-17` | Auth SDK is constructed from `/v1/auth/config`; frontend read/configuration. |
| `frontend/js/supabase-auth.js:23,34-45` | GoTrue sign-out, get-session, refresh-session; frontend session reads/writes. The token is sent as `Authorization: Bearer` to Express. No PostgREST/RLS call. |
| `frontend/js/script.js:483-504` | Reads the session then calls API login audit endpoint; frontend Auth read plus backend write. |
| `frontend/js/script.js:2339-2341` | `signInWithOAuth({ provider: 'google' })`; frontend GoTrue/Google OAuth write/redirect. |
| `frontend/js/script.js:2370-2383` | API logout audit then GoTrue sign-out; frontend/backend write. |
| `backend/server/index.js:9,13,17` | Imports and creates the server-only Supabase client from `SUPABASE_URL`/`SUPABASE_SECRET_KEY`. This client supplies Auth Admin/Auth validation and PostgREST/RPC access. |
| `backend/server/index.js:287-291` | `auth.admin.listUsers()` for Google avatar metadata fallback only; backend Auth admin read; no authorization decision relies on it. |
| `backend/server/index.js:294-315` | `auth.getUser(token)` verifies each bearer token, then loads the matching `profiles` row. Backend Auth read; API authorization is subsequently enforced by backend middleware at `317-320`. |
| `backend/server/index.js:34,360,369,376,393-448` | Profile lookup/updates, audit write, health query and login/heartbeat/logout writes through PostgREST; backend reads/writes, service-role bypasses RLS. |
| `backend/server/index.js:452-995` | All remaining application endpoints use `db.from(...)` and `db.rpc(...)` (full endpoint mapping below); backend reads/writes, with Express `authenticate`, `activeOnly`, `adminOnly`, or `specialAdminOnly` enforcing access. |
| `backend/server/index.js:384` | Publishes Supabase URL and publishable key to browsers for Auth. It must be replaced only when Auth changes. |

### Backend PostgREST/RPC endpoint map

All entries in this table are **backend-only**. All use the server secret/service credential, so RLS is not the authorization relied upon in production API requests.

| Server lines | API capability | Operation | Backend authorization |
|---|---|---|---|
| `452-455` | Departments | list / create / update / delete | `activeOnly`; admin for writes |
| `457-460` | Projects | list / create / update / delete | `activeOnly`; admin for writes |
| `461-485` | Work schedules and assignments | list/create/delete/read/assign/unassign | admin except `my-schedule` (active user) |
| `488-490` | User-project assignments | list / upsert / delete | active user list scoped in code; admin writes |
| `492-504, 626-683` | Users/profiles, approval, role, department, archive/restore/permanent deletion | read / transactional writes | admin and head-admin protection in code; lifecycle uses RPCs and `auth.users` |
| `517-619` | Employee chat and admin chat log | reads / inserts / updates / soft delete / SSE notification | active-user checks and ownership filters in code; special admin for log |
| `688-736` | Invitations | read / create / update / delete | admin; email delivery is not Supabase |
| `738-812` | Time entry lists, leaderboard, remarks | reads / remark write / mark-read write | active user list is filtered in code; admin for cross-user/admin operations |
| `815-936` | Clock-in/out, admin stop/correction, overtime, archive/restore/permanent delete | reads plus transactional RPC writes | active/admin middleware; RPC parameters include the acting profile ID |
| `943-991` | Reports and exports | reads / inserts / delete | admin |
| `995` | Audit logs | read | admin |

The RPC calls are at `backend/server/index.js:630,641,652,661,671,683,839,851,863,878,890,918,929,936`: `change_user_status_with_audit`, `change_user_role_with_audit`, `admin_update_profile_with_audit`, `permanently_remove_archived_login`, `clock_in_entry_with_audit`, `clock_out_entry`, `admin_stop_entry`, `admin_correct_entry`, `approve_entry_overtime`, and `archive_time_entry_with_audit`.

### Database schema, migrations, and SQL upgrades

Every `.sql` file under `supabase/` is a Supabase deployment dependency because it is applied through the Supabase SQL Editor or recorded as a Supabase migration. The files below are grouped without omitting any:

| Files and lines | Dependency / service | Read-write / lock-in |
|---|---|---|
| `supabase/schema.sql:20,190,198-214` | `auth.users` FK and after-insert trigger; RLS on 12 tables; policies using `authenticated` and `auth.uid()` | Auth schema and GoTrue role lock-in. Two direct-read policies only; all API writes use service role. |
| `supabase/auth-profile-trigger-fix.sql:91-97`, `supabase/current-production-upgrade.sql:74-78` | Auth-user profile trigger (function owner `postgres`) | Auth schema/role lock-in; write-on-user-create. |
| `supabase/permanent-user-delete.sql:42-50`, `supabase/current-production-upgrade.sql:129-137`, `supabase/migrations/0014_transactional_lifecycle_audit_and_request_ids.sql:243-269` | Deletes from `auth.users`; grants function to `service_role` | Auth lifecycle + service role lock-in; write. |
| `supabase/migrations/0015_atomic_archive_restore_auth_state.sql:43-49,64-65` | Updates `auth.users.banned_until`; `service_role` grant | GoTrue account disable/restore lock-in; write. |
| `supabase/migrations/0001_break_end_rpc.sql:56-57`, `0002_clock_out_rpc.sql:62-63`, `0007_admin_time_entry_rpcs.sql:111-114`, `0016_idempotent_user_status_audit.sql:37-38`, `0017_idempotent_user_role_audit.sql:30-31`, `0018_time_entry_clock_in_audit.sql:71-72` | RPC execute grants to `service_role` | PostgREST role convention lock-in; function logic itself is portable PostgreSQL. |
| `supabase/migrations/0013_access_request_atomic_audit.sql:52-127`, `0014_transactional_lifecycle_audit_and_request_ids.sql:48-241` | Triggers, transactional RPCs, `pg_advisory_xact_lock`, service-role grants | PostgreSQL-native concurrency/audit logic; preserve it. `pg_advisory_xact_lock` is not Supabase-specific. Historical access-request feature is removed in `0020`. |
| `supabase/work-schedules.sql:26-28`, `supabase/employee-chat.sql:21`, `supabase/schema.sql:167-196` | Ordinary triggers and RLS enablement | Triggers are portable PostgreSQL; RLS is PostgreSQL-native but current `authenticated` policy role is Supabase-specific. |
| `supabase/access-request-flow.sql:1-53`, `admin-remark-notifications.sql:1-5`, `admin-stop-clock.sql:1-4`, `allow-profile-history.sql:1-10`, `breaks.sql:1-22`, `clock-entry-notes.sql:1-13`, `employee-presence.sql:1-7`, `r2-profile-photos.sql:1-4`, `reinvite-after-login-removal.sql:1-16`, `scheduled-time-entries.sql:1-8`, `soft-delete-time-entries.sql:1-7` | Historical/targeted SQL upgrades; comments instruct running in Supabase SQL Editor | Mostly portable table/index/function changes; retain in migration history and reconcile against the live schema before exporting. |
| `supabase/migrations/0003_time_entry_schedule_snapshot.sql:1-10`, `0004_compute_schedule_compliance.sql:1-49`, `0005_access_request_expiry_24_hours.sql:1-4`, `0006_lock_down_time_entries_rls.sql:1-9`, `0008_schedule_workdays.sql:1-69`, `0009_profile_tutorial_state.sql:1-30`, `0009_remove_break_tracking.sql:1-102`, `0010_overtime_approval.sql:1-14`, `0011_review_exports_and_reporting_indexes.sql:1-13`, `0012_preserve_original_chat_message.sql:1-5`, `0019_admin_remark_notifications.sql:1-16`, `0020_remove_access_request_flow.sql:1-12` | Versioned database changes | PostgreSQL/application schema; `0006` changes RLS; the rest appear portable. |
| `supabase/MIGRATION_ORDER.md:1-51` | Provisioning and migration process assumes Supabase project, backup, and SQL Editor | Operational dependency, not runtime. |

No Supabase Edge Functions, Storage buckets, Realtime channels, `supabase_auth_admin`, custom JWT claims, or `auth.jwt()` references were found. `gen_random_uuid()` and `pg_advisory_xact_lock` are PostgreSQL features, not a Supabase extension dependency (confirm extensions on the live database before export).

### Build, tests, configuration, documentation, and browser loading

| Location | Dependency |
|---|---|
| `package.json:22`; `package-lock.json:11,81-159` | `@supabase/supabase-js` plus Auth, Functions, PostgREST, Realtime, Storage transitive packages. The application calls only Auth/PostgREST/Auth Admin. |
| `scripts/build-frontend.js:31-34,44,57,59` | Copies the Supabase browser UMD bundle and auth wrapper into `dist`; build dependency. |
| `scripts/seed-admin.js:3-17` | Service client and Auth Admin `listUsers`/`createUser`; setup-time Auth write. |
| `scripts/verify-database-contract.js:3-42` | Service client runs production-schema RPC contract checks; backend PostgREST/RPC test. |
| `scripts/security-integration.staging.js:4-31,90,96,162`; `backend/tests/time-entries.concurrency.staging.js:4-31,204` | Staging GoTrue password sign-in and sign-out; live integration/concurrency test. |
| `scripts/security-regression-check.js:11,25,50`; `backend/tests/*.test.js` locations reported by search (notably `transactional-audit-reliability`, `time-entry-reporting-audit`, `profile-lifecycle`, `auth-recovery`, `live-chat`, `access-request-removal`) | Static assertions that encode Supabase/RPC/RLS/Auth behavior. Update alongside adapter/auth changes. |
| `.env.example:7-11`, `.env.test.example:7-8`, `render.yaml:13-17` | Environment variable **names only**: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `ACE_TEST_SUPABASE_URL`, `ACE_TEST_SUPABASE_PUBLISHABLE_KEY`. |
| `frontend/_headers:6` | CSP permits `https://*.supabase.co`; remove only after Auth moves. |
| All HTML pages that load `js/supabase.js` and `js/supabase-auth.js` (listed by search at lines 2-4 or 14-17): `users.html`, `user-dashboard.html`, `time-entry-details.html`, `time-entries.html`, `settings.html`, `schedule-flex.html`, `reports.html`, `remarks.html`, `projects.html`, `login.html`, `chat-log.html`, `audit-logs.html`, `admin-time-entries.html`, `admin-dashboard.html`, `invitations.html`, `individual-reports.html`, `employee-profile.html`, `departments.html`, `deleted-users.html`, `deleted-time-entries.html` | Browser Auth SDK loading. Generated `dist/` is intentionally excluded from source audit; it inherits this dependency from the build. |
| `README.md:14-35,72-98,119-133,159,171-177,199-201,249,269-271,328,337,341`; `ONBOARDING.md:50,59` | Architecture, setup, and operating documentation dependency. |

No GitHub Actions/CI workflow, `supabase/config.toml`, Docker/Compose Supabase service, or other CI configuration was found in the repository.

## Authorization and lock-in analysis

### What enforces authorization today

* **Backend code is the effective authorization boundary.** `authenticate` validates a Supabase token and loads the profile; `activeOnly`, `adminOnly`, `specialAdminOnly`, ownership predicates, head-admin checks, and actor IDs supplied to RPCs determine access. See `backend/server/index.js:294-320` and the endpoint map.
* **RLS is defense in depth, not the production API policy engine.** It is enabled for primary tables at `supabase/schema.sql:198-209`, but only `profiles` and `time_entries` have direct authenticated-read policies at `213-214`. The Express service client bypasses RLS. The browser currently does not query these tables directly, so removing those policies after a full server-only cutover is feasible but should occur only after a live access test.
* **Database constraints/transactions enforce correctness.** The clock/user/audit RPCs, triggers, append-only audit trigger, and advisory lock protect invariants beyond middleware. They should remain in PostgreSQL.

### Supabase-specific rewrites required for a complete departure

* Replace `auth.users` FK with an application-owned `users`/`identities` table or retain UUIDs and change the FK target. Recreate the new-user profile provisioning path outside the `auth` schema trigger.
* Replace mutations of `auth.users.banned_until` and deletion of `auth.users` with the selected authentication system's disable/delete API, with a compensating-operation strategy because cross-system transactions are not automatic.
* Replace GoTrue browser methods (`signInWithOAuth`, `getSession`, `refreshSession`, `signOut`), OAuth redirect/callback behavior, persisted tokens, and Express `getUser(token)` validation. The current backend does **not** locally parse JWT claims; it delegates validation to GoTrue and trusts `user.id`, so it is coupled to token validation and subject identity, not custom claims.
* Replace Supabase JS/PostgREST builder calls and `.rpc()` calls with a PostgreSQL driver/data-access layer. Preserve function signatures and transactional SQL first; no need to rewrite frontend endpoints.
* Translate/removal of `service_role`, `authenticated`, `anon`, and function grants. These are Supabase role conventions. PostgreSQL roles/grants/RLS can remain, but must be deliberately designed for the new server connection role.

## Replaceability and work count

Counts are rough, intentionally include test/config/documentation companion files, and count externally visible Express routes rather than every database table query.

| Category | Included work | Files / endpoints | Estimate |
|---|---|---:|---|
| Easy to replace | Server-only PostgREST reads/writes; database-health check; data adapter; portable schema/RPC execution path; docs/scripts | 6-10 files; about 35 existing data endpoints | 2-5 days including regression tests. |
| Medium | RLS cleanup/translation; server-side Supabase Admin avatar lookup; migration-role grants; deployment/test configuration; ensuring all browser data stays behind API | 8-14 files; 0 new public endpoints (retain all existing ones) | 3-7 days, including production-like verification. |
| Hard | GoTrue/Google OAuth, callback/session persistence/refresh/logout, backend token validation, auth-schema trigger/FK, archive/restore/delete behavior, seed/test flow | 10-18 files; 4 auth-adjacent API endpoints plus every protected route's middleware contract | 2-4 weeks, depending on the replacement identity provider and parallel-run period. |

At 30-100 users, a cautious team should schedule the hard phase as **several weeks elapsed time**, even if coding time is lower, because it needs controlled account migration, real OAuth validation, and a rollback window.

## Lowest-risk decoupling path

The ordering deliberately leaves Supabase Auth in place until data access is portable. Each phase preserves the existing `/v1/...` frontend contract.

| Step | Change | Risk | Verification | Rollback |
|---|---|---|---|---|
| 0. Baseline and backup | Record schema/functions/roles/extensions from production; take a provider backup and a test `pg_dump`; document exact migration state. Add route-level contract tests for clock-in/out and lifecycle. | Low operational risk; unknown schema drift is the real concern. | Run existing static tests locally. Live database verification, staging security test, and concurrency test require credentials not configured locally. | No app change. Keep verified backup and migration manifest. |
| 1. Formalize the API boundary | Keep every existing frontend request unchanged. Add a small server data-access interface around current `db.from`/`db.rpc`; do not change SQL behavior. Confirm no page bypasses `ACEAuth.request`. | Low-medium; adapter refactor can alter query shapes/pagination. | Unit/contract tests compare JSON/status/error behavior for all routes; exercise clock race tests on a credentialed staging project. | Feature flag or one-line adapter selection back to the current Supabase client. |
| 2. Move server data access to direct Postgres | Use one normal PostgreSQL connection pool from Express, implemented behind the adapter. Translate queries incrementally while retaining the same tables, RPCs, constraints, and endpoint responses. Supabase remains the database host and Auth issuer. | Medium: query semantics, connection pooling, and transaction boundaries. | Shadow-read selected endpoints against both adapters; run write tests once, then compare affected rows/audit rows. Run simultaneous clock-in/out tests; verify one-open-entry invariant and audit request IDs. | Keep the Supabase/PostgREST adapter enabled until each route has comparison evidence; revert adapter routing without frontend deployment. |
| 3. Make authorization explicitly server-only | With browser direct data access confirmed absent, retain middleware checks, make owner/admin predicates explicit in direct SQL, and create a least-privilege database role for Express. Keep RLS temporarily as defense in depth; later remove/translate Supabase-only `authenticated`/`auth.uid()` policies after an access matrix test. | Medium-high: an omitted predicate is a data exposure. | Test matrix: active/inactive user, user vs. another user, admin, special admin, archived user; verify each route returns current status codes. Live tests need staging credentials. | Re-enable prior RLS policies and route the affected endpoint back through the established adapter. |
| 4. Export portable database ownership | Produce a clean migration baseline from the actual live schema: public tables, indexes, types, triggers, functions, extensions, and grants. Replace only Supabase role grants with a portable app role; keep PostgreSQL and all clock/audit RPCs. Create a dry-run restore to a disposable Postgres instance. | Medium: live SQL may differ from repository history. | Schema diff and data-count/checksum sampling after `pg_dump`/restore; execute all transactional function tests. | Keep Supabase database authoritative; discard the disposable target. No cutover. |
| 5. Optionally change database host | Deploy the same backend adapter against the restored PostgreSQL database using a canary/maintenance window. Keep Supabase Auth and existing UUID subject IDs. Reconcile writes only during a short controlled cutover; there is no safe multi-writer replication plan justified at 100 users. | High but bounded; split-brain is the main risk. | Read-only soak, maintenance cutover, count/invariant/audit comparison, then normal concurrency tests. | Point the backend connection string back to Supabase before accepting further writes on the new database; restore from backup only if needed. |
| 6. Only then consider Auth replacement | Choose an OIDC-capable provider or self-hosted identity solution; map existing Supabase user UUID to the new immutable subject ID; add dual-token validation in Express for a bounded migration period. Replace profile provisioning and `auth.users` lifecycle actions with provider APIs/outbox-style compensating records. Change browser auth wrapper, not the application UI/API. | High: sessions, Google OAuth redirects, account linking, archived users, and disable/delete behavior. | Test new/returning Google users, refresh, logout, expired/revoked session, archived/restore/delete, and every authorization role. Requires staging OAuth credentials and redirect URLs. | Keep Supabase token validation and login available during the dual-validation window; do not delete Supabase users until the rollback window closes. |
| 7. Remove Supabase residue | Remove browser bundle/config/CSP allowance, package dependency, old secrets, Supabase-specific migration pieces, and stale docs only after metrics show no Supabase Auth/data traffic and rollback retention expires. | Low after the parallel period. | Repository search and deploy-environment audit; login and protected-route smoke test with the new system. | Revert the final cleanup commit while retained credentials/provider configuration still exist. |

No Redis, queue, or additional managed service is required here. PostgreSQL transactions, unique constraints, the existing RPCs, and a conventional connection pool are sufficient at this scale. A queue is only worth reconsidering if you later introduce durable asynchronous jobs (for example, high-volume notifications or exports), not for clock correctness.

## Do not decouple yet (or at all, unless there is a business reason)

* **Do not replace Supabase Auth merely to reduce vendor count.** At 30-100 users, Google OAuth, secure refresh/session handling, account recovery, and admin lifecycle behavior are the costly part with little operational payoff. Keep it after moving database access if vendor independence is the only goal.
* **Do not rewrite the clock RPCs into Express.** Their PostgreSQL transaction boundaries, idempotency/audit behavior, and advisory lock are the right place for concurrency correctness. They are portable PostgreSQL already.
* **Do not remove RLS before direct browser access is demonstrably absent in deployed assets and the backend connection role is least privilege.** It is not currently the principal control, but it remains useful blast-radius reduction.
* **Do not run both old and new databases as writable systems.** At this size, a brief maintenance/cutover window with backup and validation is safer and cheaper than replication or conflict resolution.
* **Do not introduce Redis, a message queue, a frontend rewrite, or a non-Postgres database.** None solves an identified requirement in this codebase or at this user count.

## Live-testing limitations

Local templates explicitly contain placeholders and no staging Supabase credentials are configured. Therefore the following are planned, not executed: token/OAuth validation, RLS behavior, service-role bypass behavior, exact live schema/extension/role inventory, `pg_dump` restoration, staging security integration tests, and the time-entry concurrency test. Static evidence above is sufficient to plan the first two phases, but production cutover decisions must wait for those live checks.
