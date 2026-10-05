# ACE Clock In/Out — production diagnostic and remediation plan

Audit date: 5 October 2026, Asia/Manila. Committed baseline: `640f1269bddf219930db335e443f7d07e6a389eb`.

This is the diagnosis-first deliverable. No application source, migration, dependency, production record, session, or deployed service was changed. Four pre-existing untracked files were inspected separately: `backend/server/session-security.js`, `backend/tests/session-security.test.js`, `scripts/backend-reliability.integration.js`, and `supabase/migrations/0026_backend_reliability.sql`. They are drafts, not evidence that the running API has been fixed. The server does not import the session-security module or call its new RPCs.

Evidence scope: repository source, SQL scripts and migrations, build configuration, dependency declarations and usage, local tests, and Git history. Production schema/ACLs, deployment version, data population, provider configuration, backups, logs, latency, and active users were not accessed. For those matters: **Not confirmed from the current codebase.** Source findings below are not claims that an exploit or incident has already occurred.

Verification performed:

- Explicitly ran the local `backend/tests/*.test.js` files: **134 passed, 0 failed**; four belong to the untracked draft. Output: `test-results.txt` beside this report. The staging concurrency script was deliberately excluded.
- Ran `scripts/security-regression-check.js`: passed.
- Built all 23 HTML pages and 17 bundled assets into an isolated audit output directory using a placeholder API URL; build passed. Original `dist` was preserved. Generated audit build files were inspected and removed. Summary: `build-results.txt`.
- Ran six offline diagnostic reproductions: chat read loss, last-admin check interleaving, stale clock-out UI, hashed route mismatch, overnight approval arithmetic, and avatar retry deletion. Run `node deliverables/production-audit/reproduce.mjs` to repeat. These assert existing defects, not corrected behavior. SQL arithmetic and route mocks do not substitute for PostgreSQL/browser integration tests.
- Did not run a hosted integration suite, execute migrations, seed an administrator, or run `db:verify` against an unknown database. The existing verifier invokes mutating RPCs using an assumed-absent UUID; it is not intrinsically a read-only catalog inspection.

## A. Executive Summary

The system has a sound foundation for preserving shifts: a database unique index prevents two open entries per user; clock-in and clock-out write audit evidence transactionally; timestamps and generated durations live in PostgreSQL; the browser timer is not the authoritative record. Most administrative routes have explicit server-side role checks, and most privileged RPCs are restricted to the service role.

The principal risk is inconsistent ownership of rules across API checks, database functions, browser state, and several database installation paths. The problems warrant targeted corrections, not a rewrite.

Highest priorities:

1. **F01:** Overtime approval is a privileged SQL function without an explicit execution restriction or actor authorization. The repository creates a vulnerable permission arrangement under normal PostgreSQL defaults; actual production grants must be checked immediately.
2. **F02:** The advertised production upgrade script conflicts with numbered migrations, reintroduces retired break fields, recreates duration, and does not supply all current API contracts. Applying the wrong script is a deployment hazard.
3. **F03–F05:** Administrator survival, session revocation, and account activation are not consistently enforced at their authoritative boundary. Concurrent demotions can pass together; logout protection is process-local; re-invitation can leave an ACTIVE profile banned in Auth.
4. **F06–F08:** Overnight overtime can be incorrect, reporting has incomplete/stale read paths, and a successful clock operation followed by a lost response leaves the UI unable to reconcile without reload.

Duplication is moderate in formatting, CRUD and browser view helpers, but more serious in account lifecycle, database bootstrap, and reporting. There is no evidence of a large family of `Fixed2`/`V3` helpers. Patch accumulation is clearest in onboarding/navigation, schema recovery scripts, and broad startup data loading. Recent Git history supports these areas of churn; it does not establish AI authorship.

No declared library was confirmed to be a ghost dependency. All 11 runtime and four development dependencies have a current application, build, or script use. There are actual dead-code candidates and an undeclared `pg` import in the untracked integration draft.

Do not deploy the untracked reliability draft as a complete remedy. It adds useful mechanisms, but it is not wired into the API and has not proved compatibility with real Supabase sessions or old/new API coexistence. In particular, an old API will ignore the new session-revocation table.

Recommended strategy: establish the real deployed database contract and transition tests; close the narrow RPC permission gap; enforce lifecycle invariants transactionally; repair clock reconciliation and reporting; then consolidate and simplify. Preserve all valid historical records. No proposed time-tracking change currently meets the user's production-safety proof requirement.

## B. Architecture Map

### Actual components and ownership

| Layer | Real implementation | Responsibility / source of truth |
|---|---|---|
| Static pages | `frontend/*.html`, `frontend/css/app.css` | 23 pages; shared shell, page markup and presentation |
| Browser application | `frontend/js/script.js` | Global `AppState`, DTO mapping, startup data loading, clock controls, reports, chat, navigation, dialogs, notifications |
| Browser Auth | `frontend/js/supabase-auth.js` | Supabase client/session persistence, bearer API requests, one shared refresh attempt on 401 |
| Specialized views | `admin-sections.js`, `schedule-flex.js`, `employee-profile.js`, `individual-reports.js`, deletion views, `chat-log.js` | Additional reads and UI actions, sometimes duplicating global state |
| Onboarding | `onboarding.js`, `onboarding-config.js` | Role-specific tutorial state, local fallback, coachmarks and route lifecycle |
| API | `backend/server/index.js` | Single Express module, validation, permission middleware, direct Supabase queries, mail, upload signing, SSE, errors |
| Database | `supabase/schema.sql`, loose SQL scripts, numbered migrations | Relational state, generated duration, constraints, RLS, privileged transactional RPCs |
| Authentication provider | Supabase Auth; Google OAuth in browser | Identity, refresh sessions, account bans; application roles/status remain in `profiles` |
| External services | Cloudinary; Gmail API and SMTP | Avatar objects and invitation delivery |
| Local caches | Maps in API process | JWKS, identity/profile lookup, reference data, revoked token hashes, pending presence, SSE subscribers |
| Build / deployment | `scripts/build-frontend.js`, `render.yaml`, `frontend/_headers` | Minified hashed static assets; Render Node API, `/health`; static host setup is external |

No repository ORM, separate controller/service/repository hierarchy, durable worker queue, distributed cache, webhook receiver, or cron service was found. The presence timer is an in-process interval. SSE delivery is local to one API process. PostgreSQL is accessed through the service-key Supabase client; therefore application authorization and RPC privileges are critical even with table RLS enabled.

The current tracked schema defines departments, profiles, projects, user_projects, invitations, time_entries, schedules/assignments, remarks, reports/exports and audit_logs. Other installation scripts/migrations add employee_messages and tutorial progress. `access_requests` is retired by migration 0020. The base schema alone is not the complete deployed contract.

### Production-critical clock flow

1. `handleClockIn` (`script.js:2460`) posts the chosen project to `/v1/time-entries/clock-in`.
2. `authenticate` loads identity/profile; `activeOnly` checks status. The route validates project assignment, checks open entries, reads the assigned schedule and snapshots its fields (`index.js:1016`).
3. `clock_in_entry_with_audit` (0018) creates the entry and its audit row in one transaction. `one_open_entry_per_user` (`schema.sql:93`) is the concurrent duplicate protection; the preliminary SELECT is only a friendly check.
4. Browser state receives the persisted UUID and original timestamp. On reload, `loadDatabase` locates the signed-in user's open entry among downloaded entries (`script.js:334`). Neither deployment nor browser closure inherently removes that row.
5. `handleClockOut` submits that UUID and a required note. `/clock-out` calls `clock_out_entry` with authenticated actor information (`index.js:1055`).
6. The current numbered function in 0009 conditionally updates an open authorized row and appends audit evidence atomically. PostgreSQL calculates duration from stored timestamps. The API supplies the final time; browser elapsed seconds are display-only.
7. Browser replaces the returned entry, clears active UI state, and reports success. It does not reconcile a 409 or lost response (F08).

### Other important flows

- **Login:** Google/Supabase creates identity → Auth trigger requires a pending unexpired invitation → profile ACTIVE → browser bearer requests → `/v1/me` → global startup data load. Tutorial storage failure has a specific startup fallback.
- **Account administration:** admin middleware → application head-admin/self/last-admin checks → profile lifecycle RPCs. Archive/restore updates Auth ban and profile/audit together; invitation activation bypasses that canonical mechanism.
- **Reports:** database entries → global browser history → browser filters/XLSX or print. Separate API calls save filters/counts and export metadata. No stored immutable report payload is present.
- **Chat:** POST persists a message → local SSE notification → browser re-fetches conversation. GET both returns messages and marks reads. Database rows survive restart; event delivery does not.
- **Photo:** signed Cloudinary upload → browser direct upload → completion API checks asset → profile URL update → old object destruction. Completion is not retry-safe.

There is no demonstrated ES-module cycle in the tracked server. The more relevant coupling is browser globals: view modules rely on `AppState`, `ACEAuth`, formatting/dialog helpers and lifecycle events from `script.js`; custom navigation in turn mounts these view modules by filename.

## C. Critical & High-Priority Findings

The finding cards state the diagnosis and required tests. Section N supplies the complete production/data/session/workflow/coexistence/rollback classification for **every P1/P2 proposal**. No P0 incident is asserted without production verification.

### F01 — Privileged overtime RPC lacks an explicit access boundary

- **Severity:** P1. **Confidence:** HIGH for repository omission; production exposure requires verification.
- **Evidence / affected code:** `supabase/migrations/0010_overtime_approval.sql:3–14`, `index.js:1095`. The SQL is `SECURITY DEFINER`, accepts arbitrary entry/admin UUIDs, checks entry state but not the caller, and contains no revoke/grant. Repository-wide search found no later restriction for this function.
- **Current behavior / problem:** Express checks admin access, but a directly executable Supabase RPC bypasses Express. A caller with suitable IDs could change approved overtime and attribute the audit to another profile if standard grants remain.
- **Root cause / invariant:** authorization assumed to exist only at the HTTP route. Every elevated database entry point must have explicit allowed callers and trustworthy actor semantics.
- **Correction:** verify effective production grants; restrict this exact signature to service_role in one transaction, preserving the API contract. Evaluate actor validation inside the function with current role rules. Do not rewrite overtime records as part of the ACL correction.
- **Required tests:** anon and ordinary authenticated RPC calls denied; authorized API approval succeeds; audit attribution correct; no mutation on rejected calls. Test actual PostgreSQL grants, not text matching.
- **Risk of correction:** a legitimate direct client caller, if one exists outside this repository, would stop working. No such caller was found here.

PostgreSQL documents PUBLIC execution permission on newly created functions and the need to restrict security-definer functions: [CREATE FUNCTION](https://www.postgresql.org/docs/current/sql-createfunction.html). Effective production defaults remain unverified.

### F02 — Competing SQL installation paths can change production behavior

- **Severity:** P1. **Confidence:** HIGH.
- **Evidence:** `current-production-upgrade.sql:2–5,22–24,111–133,157–171`; migration `0009_remove_break_tracking.sql:9–20`; `0014_transactional_lifecycle_audit_and_request_ids.sql:243`; duplicate `0009_*` prefixes; README database/setup instructions.
- **Current behavior:** the “current” upgrade promises completeness/rerunnability but adds break columns and drops/recreates duration with break subtraction. Migration 0009 removes those columns and calculates elapsed time. The upgrade also recreates the obsolete one-argument permanent-delete RPC and marks NOT_STARTED tutorial records SKIPPED. It does not install clock-in RPC 0018 or role tutorial table 0025.
- **Root cause / invariant:** manually maintained bootstrap, incremental upgrades and repair scripts have diverged. A release needs one explicit reproducible schema contract and migration order.
- **Correction:** establish the live ledger and function/constraint definitions first. Document a single approved forward path; label obsolete scripts as historical. Build an empty-install fixture and upgrade fixture before generating a baseline. Do not replay old “safe” scripts or edit already-applied migrations to pretend they were different.
- **Required tests:** complete fresh install, supported old-schema upgrade, API contract plus ACL checks, old-clock-in/new-clock-out, and rollback with new entries. Detect duplicate version IDs before adopting a migration runner.
- **Risk:** blanket SQL replay can lock tables, fail on dependencies, change historical duration interpretation, remove data, or restore obsolete functions. This is not a code-cleanup deployment.

### F03 — Two administrative changes can remove the last active admin

- **Severity:** P1. **Confidence:** HIGH for race; live occurrence unknown.
- **Evidence:** `guardProfileLifecycle`, `index.js:486–517`; role/status functions in migrations 0023/0024 lock only the target row. The offline interleaving lets both checks pass with two admins.
- **Current behavior:** concurrent administrators can each see count=2 and demote the other. Separate target-row locks do not serialize the global invariant. Invitation activation can also change roles through another path.
- **Root cause / invariant:** a global invariant is checked outside the transaction that changes it. At least one non-deleted ACTIVE ADMIN must remain after every committed mutation.
- **Correction:** enforce a shared transactional database guard covering all insert/update/delete paths that affect the population. Keep the API check for explanatory errors. Review the pre-existing 0026 counter-trigger draft rather than inventing a second competing solution; test initial state, counter consistency, permissions and rollback.
- **Required tests:** two-target demotion/denial/archive races, invitation demotion, failed audit rollback, existing zero-admin state, admin creation/deletion, and mixed old/new writers.
- **Risk:** introducing a trigger changes every profile writer, including old APIs and operational SQL. Map all writers before rollout.

### F04 — Logout revocation and permission freshness are process-local

- **Severity:** P1. **Confidence:** HIGH.
- **Evidence:** `index.js:24–50,427–468,615–624`; 500-entry `revokedTokenCache`, fixed one-hour TTL, five-second `profileCache`; lifecycle routes do not invalidate target profiles.
- **Current behavior:** logout denies one token hash on one process. Restart, another instance, eviction or token rotation bypasses that local marker while an access JWT is still valid. A demoted/denied user can retain cached application permissions briefly. Fetching fresh Auth identity for administrators does not refresh `profiles.role`.
- **Root cause / invariant:** identity signature validity, application permission state, and session revocation are conflated. If session-end promises immediate denial, that denial must survive restart and apply to the logical session on every instance.
- **Correction:** establish intended logout semantics; use shared session revocation/current permission checks for protected actions, with a retryable outage response. Review the untracked module and 0026 together; do not deploy either independently as proof of a fix. Do not invalidate every session to simplify migration.
- **Required tests:** revoked-token replay across two instances/restart, refreshed tokens sharing a session ID, current role/status, provider outage, existing sessions, and open-shift completion through deployment and rollback.
- **Risk:** a new requirement for Auth session rows/claims may reject valid legacy sessions; old instances ignore the new store. This needs an explicit coexistence strategy.

Supabase documents that access tokens can remain valid until expiry after sign-out: [Signing out](https://supabase.com/docs/guides/auth/signout). Therefore local JWT verification alone does not prove a session remains active.

### F05 — Re-invitation can leave ACTIVE users banned and partially commit access

- **Severity:** P1. **Confidence:** HIGH.
- **Evidence:** `index.js:887–926` directly updates profiles and invitation rows in separate calls; `0015_atomic_archive_restore_auth_state.sql:37–48` sets/clears `auth.users.banned_until` only in archive/restore. `audit()` at `index.js:519` logs and swallows DB errors.
- **Current behavior:** re-inviting an archived profile sets ACTIVE but does not clear its Auth ban. A failed later invitation/audit write can leave access changed despite an error or missing evidence. A normal approval route also differs from restore semantics.
- **Root cause / invariant:** competing account-activation implementations. Profile state, allowed login state, accepted invitation and security audit must represent one committed transition.
- **Correction:** define activation versus restoration semantics, then route existing-profile invitations through one atomic operation covering profile, Auth and audit. Keep email outside the transaction and report delivery separately, as the API already attempts. Review `ace_invite_with_audit` in the draft, including concurrent Auth signup and cancellation.
- **Required tests:** archived re-invite, pending legacy profile, already-active profile, failed audit, simultaneous invitations/signup/cancellation, head-admin protection and last-admin preservation.
- **Risk:** do not blindly clear all bans or batch-reactivate existing records. Inspect the affected population and its intended state first.

### F06 — Overtime approval mishandles overnight shifts and survives time edits unchanged

- **Severity:** P1. **Confidence:** HIGH for code/arithmetic; affected production population unknown.
- **Evidence:** migration 0010 constructs scheduled end from the clock-in calendar date plus end time; API schedule validation accepts any valid start/end times (`index.js:638–645`). `admin_correct_entry` in 0009 updates timestamps without reconciling approved overtime; UI approval is hidden once `overtimeApprovedAt` is set (`admin-sections.js:154`).
- **Current behavior:** a 22:00–06:00 shift ending at 06:00 next day calculates 86,400 overtime seconds instead of zero. Later time corrections leave the old approval amount/actor/timestamp intact.
- **Root cause / invariant:** a wall-clock end is treated as a same-day instant, and a derived approval is detached from its input version. Approved overtime must correspond to the intended scheduled interval and reviewed timestamps.
- **Correction:** specify overnight/early-start/day attribution rules, compute the correct Manila interval in the canonical SQL operation, and define whether a correction invalidates approval or requires reapproval. Do not silently recalculate historical approvals.
- **Required tests:** daytime, overnight, early arrivals, multi-day entry, unscheduled/FLEX, weekend, correction after approval, concurrent correction/approval and repeated approval/audit behavior.
- **Risk:** this changes consequential reported hours. Historical remediation requires exact detection, review, backup and a reversible plan separate from forward code correction.

### F07 — Reporting has incomplete, stale and competing data reads

- **Severity:** P1. **Confidence:** HIGH for inconsistent read strategies; MEDIUM for production truncation impact.
- **Evidence:** `script.js:276–340` paginates all history; `employee-profile.js:28–33` instead loads unpaged `/v1/time-entries`; `index.js:986–997` fetches all completed rows for leaderboard without range/aggregate; users/projects/remarks/assignments have unpaged callers. `script.js:2658–2673,3974` exports from cached `AppState`; API report counts query current DB (`index.js:1149–1194`).
- **Current behavior:** some screens use complete paged history, others a single provider-limited response. A long-lived tab can export cached rows while saving a new count from current data. Archived users are excluded from `/v1/users` by default, weakening historical names and department filtering in the browser.
- **Root cause / invariant:** no canonical complete report dataset or snapshot boundary. A report's displayed count, filters and exported rows must refer to the same authorized population and time interpretation.
- **Correction:** use filtered paged reads or database aggregates with explicit completeness; generate exports from a fresh consistent dataset. Preserve historical profile IDs and resolve archived identities where reports require them. Decide whether saved reports are live queries or immutable artifacts and label that honestly.
- **Required tests:** above the actual Supabase row cap, more than 1,000 entries/users/assignments, archived employee history, concurrent insert during paging, old tab after correction, equal-timestamp pagination and Manila day boundaries.
- **Risk:** changing historical interpretation or report membership without comparison is unsafe. Actual row cap and dataset size are not confirmed; no claim of a measured production truncation is made.

### F08 — Successful clock mutation with lost response leaves incompatible UI state

- **Severity:** P1. **Confidence:** HIGH.
- **Evidence:** `handleClockIn` / `handleClockOut`, `script.js:2460–2493`; conditional close RPC; offline 409 reproduction. There is no periodic authoritative active-entry reconciliation in the clock UI.
- **Current behavior:** after a committed clock-in whose response is lost, retry returns conflict while UI still offers clock-in. After a committed clock-out whose response is lost, retry returns ENTRY_ALREADY_CLOSED while the timer remains active. An admin stop or another tab produces the same stale-state problem. Reload can recover from database state.
- **Root cause / invariant:** action success is inferred solely from delivery of one response. Browser state must converge to the persisted active entry after ambiguous results.
- **Correction:** re-read the user's canonical active state after ambiguous failure/conflict, retaining original entry UUID and timestamp. If needed, implement deliberate request idempotency; current X-Request-ID is audit correlation, not general deduplication. Never “recover” by resetting or creating a replacement shift.
- **Required tests:** commit then drop response; two tabs; concurrent admin stop; deployment between clock-in/out; repeated close; rollback/new rows; unchanged original timestamp and exactly one open entry.
- **Risk:** reconciliation must not clear a still-open shift when the read itself fails. Preserve the last known state and show retryable uncertainty.

### F09 — Chat pagination and read acknowledgment lose visibility of new messages

- **Severity:** P2. **Confidence:** HIGH.
- **Evidence:** `/v1/employee-chat/messages/:userId`, `index.js:773–781`; `.order('created_at').limit(200)` followed by unbounded incoming unread UPDATE. Confirmed with 201 mock records.
- **Current behavior:** oldest 200 are always returned; the 201st message is not displayed but is marked read. A new message arriving between SELECT and UPDATE can also be marked read without delivery. `select('*')` exposes original/deleted message bodies to conversation participants even though UI hides them and a comment describes original-body retention for the restricted log.
- **Root cause / invariant:** retrieval window and read acknowledgment are disconnected; API projection does not match presentation intent. Acknowledgment should cover only delivered/seen messages, and restricted audit fields should not leak merely because the UI omits them.
- **Correction:** stable recent-message/cursor pagination, explicit client acknowledgment of returned IDs/high-water mark, participant-safe field projection. Confirm intended access to original/deleted bodies before changing that contract.
- **Required tests:** 201+ messages, new arrival between read/ack, equal timestamps, deleted/edited messages, backward paging and participant versus head-admin field access.
- **Risk:** existing false read markers cannot safely be reversed wholesale. Fix future acknowledgment without inventing past read history.

### F10 — Report/export persistence and other audit paths are not atomic

- **Severity:** P2. **Confidence:** HIGH.
- **Evidence:** `index.js:1174–1195` inserts report, export and audit in three calls; other administrative CRUD routes call the best-effort `audit()` helper after committing. `admin-sections.js:478` saves export metadata before browser export/print.
- **Current behavior:** failure can leave a report without export/audit and retry can duplicate records. Saved “exported” evidence proves intent/metadata creation, not download or print completion. Existing tests assert source ordering, not transactional rollback.
- **Root cause / invariant:** inconsistent policy on which mutations require durable audit evidence and what an export event means.
- **Correction:** make required report/export/audit records one transaction with a stable operation key; define requested/generated/delivered semantics supported by actual evidence. Identify security-sensitive CRUD needing atomic audit. Keep optional notification delivery best-effort.
- **Required tests:** fail each write, retry same operation, concurrent clicks, workbook-generation failure, cancelled print and invalid references.
- **Risk:** do not delete apparent duplicate historical reports without establishing their meaning; they may represent distinct exports.

### F11 — Schedule deletion changes historical applicability and races assignment

- **Severity:** P2. **Confidence:** HIGH.
- **Evidence:** schedule snapshot FK `0003_time_entry_schedule_snapshot.sql:5` uses ON DELETE SET NULL; compliance function in 0009 treats null schedule_id as NOT_APPLICABLE; `index.js:647–653` checks assignment count then deletes; assignment FK in `schema.sql:112` uses ON DELETE CASCADE.
- **Current behavior:** deleting an unassigned but historically used schedule clears snapshot schedule_id, making retained snapshot fields fail applicability checks. Assignment created between count and delete can be cascaded away despite the UI's “unassign first” promise. No live API caller of compliance RPC was found; external usage is unverified.
- **Root cause / invariant:** historical meaning depends on a mutable reference, and assignment/delete are not protected as one invariant.
- **Correction:** derive historical applicability from persisted snapshot fields; prefer schedule retirement or transactionally protected deletion/assignment. Preserve null-snapshot historical entries as unscheduled; do not backfill guessed schedules.
- **Required tests:** delete referenced historical schedule, active snapshot across deployment, parallel assignment/delete, unscheduled records, weekdays and overnight classification.
- **Risk:** changing deletion behavior and historical classifications requires contract comparison, even though duration timestamps need not change.

### F12 — Hashed production bundles defeat custom dashboard navigation

- **Severity:** P2. **Confidence:** HIGH for deterministic filename mismatch; browser UX not exercised.
- **Evidence:** `script.js:711–880` recognizes raw script filenames; `build-frontend.js:29–83,94–122` replaces those names with hashes. Isolated built dashboard contains seven hashed script references.
- **Current behavior:** unsupported-module detection sees hashes rather than known filenames and deliberately falls back to `location.assign`. Even source pages include onboarding scripts not excluded from that recognition rule. Intended partial navigation is frequently replaced by full reload.
- **Root cause / invariant:** runtime behavior is coupled to source filenames that the build intentionally erases. Page identity and mount lifecycle must survive production compilation.
- **Correction:** choose explicit page/module metadata or ordinary page navigation; avoid adding more filename regex fallbacks. First test real built pages, Back/Forward, forms, tutorials and clock state. If retaining soft navigation, fix unowned recurring `startClock()` intervals on remount.
- **Required tests:** built assets only, every route, mixed old/new assets, old page during deploy, form preservation, one timer per mounted lifecycle and full-reload fallback.
- **Risk:** navigation changes can discard active form drafts. Database clock persistence is separate, but UI recovery still needs a transition test.

### F13 — Avatar completion is not retry-safe; advertised upload limits are not verified

- **Severity:** P2. **Confidence:** HIGH.
- **Evidence:** `index.js:585–606`. Completion persists the selected public ID, then destroys `req.profile.profile_picture_public_id` without checking equality. Offline repeat-completion reproduction destroys the selected ID.
- **Current behavior:** retrying completion after profile cache refresh can delete the current avatar. Upload signature validation checks client-reported size/type; completion does not verify actual resource bytes/format.
- **Root cause / invariant:** external side effects lack idempotency and authoritative validation. Finalizing an already-selected asset must preserve it; resource limits must be checked against real upload results/provider enforcement.
- **Correction:** make completion idempotent, compare prior/next IDs and validate actual asset attributes; define cleanup failure handling without rolling back a valid profile change. Verify configured provider restrictions rather than assume them.
- **Required tests:** repeated completion, concurrent uploads, old-profile cache, object-delete failure, oversized asset and wrong format.
- **Risk:** profile URL must never be committed to a deleted object. Existing valid images need no migration or bulk cleanup.

### F14 — Test and deployment checks do not prove the live database contract

- **Severity:** P2. **Confidence:** HIGH.
- **Evidence:** `time-entries.concurrency.staging.js:57` and subsequent cases still call retired break endpoints; `verify-database-contract.js:17–43` accepts any P0001 and omits clock-in/overtime privilege checks; many test files use regex/source slicing. `render.yaml` runs install/start, without a schema/test gate. `seed-admin.js:20` creates an Auth user before an invitation exists despite the current invitation-only trigger.
- **Current behavior:** 134 passing local tests coexist with the reproduced failures. The stale concurrency harness cannot complete against current endpoints. Fresh administrator bootstrap can fail at the Auth trigger. Migration 0025 has a deliberate legacy fallback, but general API readiness does not establish required RPC availability.
- **Root cause / invariant:** source-shape checks and one-off repair scripts substitute for an executable release contract. Release validation must exercise real constraints, current endpoints, bootstrap and upgrade transitions.
- **Correction:** retain useful unit tests; replace obsolete scenarios and add isolated database/HTTP/built-browser gates. Inspect catalog functions/ACLs read-only before mutation tests. Define a safe first-admin provisioning path; do not disable invitation enforcement casually.
- **Required tests:** fresh install/seed, full supported upgrade, real denied RPC permissions, transaction failures, concurrency and all four old/new code/data combinations.
- **Risk:** the existing staging harness writes records before reaching retired endpoints. Never run it against production; hostname rejection plus an opt-in flag is not proof of isolation.

### F15 — Presence and live-delivery assumptions do not survive process boundaries

- **Severity:** P2. **Confidence:** HIGH for local state/time mismatch; production impact depends on topology.
- **Evidence:** `index.js:24,53–83,743–762`; browser `presenceWindowMs=4 minutes`, heartbeat every 90 seconds, server flush every five minutes, chat fallback every five minutes (`script.js:32,1126,2416`).
- **Current behavior:** an active user can be shown offline during each gap between a four-minute threshold and five-minute persistence. Chat/remark SSE events reach only subscribers on the handling process. Streams are authenticated at open, not reauthorized after role/status/session changes. Pending presence is lost on restart; no explicit shutdown flush/drain is defined.
- **Root cause / invariant:** process-local optimization is treated as shared authoritative freshness. Presence thresholds must match persistence cadence; notification delivery must recover independently of instance routing.
- **Correction:** align presence timing; bound stream lifetime and reauthorization; ensure clients recover missed notifications. Add shared delivery only if actual multi-instance requirements justify it; do not introduce a queue merely for theoretical scale.
- **Required tests:** two processes, restarted stream, revoked session on open stream, background/foreground tab, slow consumer and heartbeat timing.
- **Risk:** changes can briefly reconnect chat streams; no clock records should be mutated. Stream events currently contain notification/typing identifiers, not message bodies; severity should not imply wholesale message disclosure.

### F16 — Profile/provider failures can masquerade as authorization loss

- **Severity:** P2. **Confidence:** HIGH.
- **Evidence:** `authenticate` catch at `index.js:456`, fresh Auth middleware catches, `supabase-auth.js:48–61`, `script.js:418–433`; Gmail/JWKS fetches have no explicit timeout (`index.js:189–240,380–397`).
- **Current behavior:** a profile query outage is converted to 403 “profile unavailable”; browser startup redirects to login. Some Auth lookup failures become 401 and trigger refresh/sign-out behavior. Mail/provider waits can hold a request without an application deadline.
- **Root cause / invariant:** invalid identity, denied access, and unavailable dependencies share error handling. Temporary service failure must not be asserted as session invalidity or force loss of active UI context.
- **Correction:** classify provider errors, return retryable 503 for availability problems, preserve last-known shift state, and impose bounded provider deadlines. Reuse the existing request/refresh abstraction; do not add a second generic retry layer.
- **Required tests:** profile DB outage, JWKS rotation/outage, Auth unavailable versus expired token, bounded mail timeout, recovery without loss of original shift.
- **Risk:** careless retry policy can duplicate mutations or cause retry storms. Retry reads/reconciliation separately from non-idempotent writes.

## D. Duplication Report

| Responsibility / evidence | Classification | Canonical implementation and callers | Before removing alternatives |
|---|---|---|---|
| SQL bootstrap/upgrade/loose patches/numbered functions | Competing and diverging implementations; F02 | Approved numbered forward migration path plus generated/tested baseline | Discover live lineage; prove fresh install and upgrade; archive historical scripts rather than erase history |
| Profile activation: invitations, approval, restore; `admin_update_profile_with_audit` still has APPROVAL/CHANGE_ROLE branches while routes use separate idempotent RPCs | Dangerous duplicated business rules; F03/F05 | One transactional lifecycle contract; all invite/status/role/archive callers | Preserve different intended semantics, Auth bans, no-op audit behavior and old RPC signatures during coexistence |
| `change_user_status_with_audit` in 0016 and 0023; role equivalent 0017/0024 | Repeated definitions for repair | Latest effective identical contract, not a new V2 wrapper | Migration history is not dead runtime code. Do not remove applied migrations; confirm repair necessity from live state |
| Complete global history vs employee-profile unpaged history vs leaderboard all-row read | Diverging query completeness; F07 | Shared server-side filtered/paged query contract and aggregates; global reports, profile reports, leaderboard | More-than-cap fixtures, archived identities, filters, stable ordering, expected response shapes |
| Report date/filter logic in API reports, time-entry exports and browser `filterEntriesForReport` | Business rule duplicated across trust boundary | Server defines report membership; browser preview mirrors that contract | Existing Manila boundary test is useful; also compare actual exported rows with count and filters |
| HTML escaping in `script.js`, `admin-sections.js`, `employee-profile.js`, deletion/chat/schedule views | Accidental near duplication | Existing escape behavior can become one browser helper when lifecycle is stable | Verify all five special characters and script load order; do not conflate URL validation or CSV escaping with HTML escaping |
| Duration/date formatting across browser modules | Near duplicate, partly legitimate | One formatting API with explicit display timezone and unit options | Preserve compact table versus clock timer formats; report dates must not silently inherit device timezone |
| Departments/projects CRUD in `index.js:627–635` | Legitimate repetition at current size | Existing query/page/validation helpers are sufficient | Do not build a generic CRUD framework merely to save these few routes |
| Browser `liveRequest` forwarding to `ACEAuth.request` | Thin convenience wrapper | `ACEAuth` already owns bearer refresh/error behavior | Remove only if readability improves and exported/global callers are known |
| Browser/API validation | Legitimate dual enforcement | Server remains authoritative; browser supplies prompt feedback | Do not delete server checks because matching UI validation exists |
| Schedule compliance versus approval/reminders | Related but different rules | SQL for persisted approval; explicit snapshot/timezone contract for reminders/compliance | Do not merge target-duration overtime and approved-after-end overtime without deciding their distinct business meanings |

No convincing repository-wide family of “fixed/new/final” duplicate helpers was found. The main duplication problem is competing state ownership, not naming style.

## E. Patch-Over-Patch / High-Churn Report

Measured file touches in the last 100 commits: `script.js` 43; `admin-sections.js` 24; server 21; onboarding config 16; onboarding engine 8; CSS 55. Many HTML files have 47–53 touches, partly from synchronized cache-bust/version edits. These counts include cosmetic edits and are signals, not defect rates.

1. **Reporting/startup:** pagination commits `0b07f62` and `9ae5a95` → incomplete history correction `744620b` → `loadAllTimeEntries` retrieves every page for global startup → employee-profile still performs its own unpaged request. Root cause is no shared definition of complete filtered data, with analytics and active-state discovery attached to one global load. Replace with explicit query contracts and independent active-entry recovery, not another fallback to “load everything.”
2. **Auth/presence:** local JWT verification and batching in `ca19d32` → reduced provider requests/log volume → revocation remains local and presence persists slower than the UI's online threshold. The optimization is understandable, but security/freshness semantics must be explicit. A second cache wrapper will not establish shared revocation.
3. **Schema repair:** transactional lifecycle work `e995b3f` → missing project contract repaired in `cc1d3ff` → missing role/status RPCs restored in `5836851` → tutorial startup fallback `4b897eb`. Root cause is absent reproducible migration/deployment contract. Individual repair files are evidence of drift, not proof that production currently lacks each object.
4. **Onboarding/navigation:** commits `1fec51b`, `d1896ac`, `411cb1e`, `4fe0d8c`, `750bd22`, `4b897eb` address visible targets, navigation, persistence and startup availability. Current complexity includes local/server progress, role versions, event timing, visibility checks and route transitions. Replace implicit lifecycle dependencies with a tested page-ready/mount contract; preserve local fallback for interrupted saves until proven unnecessary.
5. **Email delivery:** header encoding `e24c0da`, navigation/design changes, then `aaad8e4` transport hardening. SMTP plus Gmail API is justified by two configured transport paths, not automatically over-engineering. The missing invariant is bounded, separately reported delivery after a committed invitation; do not roll access back because mail fails.

The local-auth-preview addition `f769c6d` and explicit revert `873e9a1`, and retired Green configuration removal `640f126`, are real history. They do not by themselves establish a recurring production bug.

## F. Database & Data-Integrity Findings

**Strengths:** one-open-entry partial unique index; FK-backed entry ownership; clock-out-after-clock-in check; generated duration; composite project assignment key; role/status enums; per-role tutorial primary key; atomic audit for core clock/lifecycle mutations; table RLS; append-only audit trigger.

**Prioritized gaps:** F01 function ACL; F02 migration lineage; F03 cross-row admin invariant; F05 multi-resource account transition; F06 approved derived values; F07 provider-capped reads; F10 partial report commits; F11 snapshot reference/deletion.

Additional evidence requiring care:

- Migration 0022 **deletes duplicate assignment pairs** and fills null assignment timestamps; it is not merely an index addition. Verify population and preserve original rows before any replay. Its primary-key check accepts any existing primary key, not specifically the required pair.
- Migration 0019 fills every null `seen_at` with `created_at`. Replaying it would acknowledge newer unread remarks too. It is a one-time migration, not harmless recurring repair.
- Migration 0018 inserts backfilled clock-in audit evidence. It is labeled as backfill, but changes historical audit population. Avoid replay without confirming its purpose and scope.
- Migration 0020 drops the retired access-request table. Existing historical records in that table, if still present, require retention approval/backup before executing it now.
- `schema.sql` starts with an Auth→profiles cascade; loose history-preservation scripts remove that FK. Verify actual constraints before permanent-login deletion. Do not infer that base-schema and production behavior match.
- Schedule compliance in 0009 returns NOT_APPLICABLE on off-days but no longer suppresses every metric as 0008 did. No current runtime API caller was found; treat this as a compatibility concern requiring external-caller discovery before changing it.
- `time_entries_user_clock_in_idx` already exists in the base schema; migration 0011's same-name IF NOT EXISTS cannot convert it into a partial index. This is migration-definition drift, not proof of a current performance problem.
- Invitation matching lowercases emails, while the unique pending-email index is case-sensitive. API writes normalize; historic/external mixed-case writes are a candidate population, not confirmed duplicates.
- `X-Request-ID` is stored but not generally unique or enforced as an operation key. State-based idempotent role/status RPCs and unique-open-entry protection should not be described as global request idempotency.

The companion `production-readonly-checks.sql` discovers effective ACLs, duration expression, indexes/constraints, active-state counts, Auth/profile mismatch, overnight approvals and migration-ledger presence. It was **not executed**. Counts identify candidates only; they do not authorize correction.

For any necessary data repair: define exact IDs/criteria in a protected environment; export affected rows and related audit evidence; dry-run with counts/diffs; record originals; execute a separately approved bounded transaction; validate relationships/timestamps/totals; retain a rollback mapping. Do not delete records because implementations are duplicated.

## G. Over-Engineering Findings

- **Justified:** database RPCs for atomic clocks/audit; schedule snapshots; per-role tutorial persistence; Auth refresh deduplication; unique open-entry index; transport-specific mail handling; soft deletion and preserved profile identities.
- **Questionable:** global startup reads for every protected page; custom navigation and repeated mount logic; handwritten select/autocomplete/menu implementations spread through the large shared script; multiple local caches with different freshness assumptions. Simplify only where tests demonstrate the replacement supports keyboard use, timing and active workflows.
- **Clear unnecessary work in current behavior:** a custom navigation pipeline that production hashes force back to full reload (F12); downloading complete history to discover one active entry (F07/F08); a no-op sidebar asset on nearly every page.
- Large CSS is not itself evidence that selectors can be deleted. The existing `consolidate-css.js` compares production optimizer output before permitting writes; retain that safety property. Responsive/theme/state repetition is often intentional.

There is no need demonstrated for a new framework, ORM, state library, dependency-injection system, cache service or repository layer. Extracting every small function from the server would not repair its transaction boundaries.

## H. Ghost Library / Dependency Report

| Dependency | Actual use | Classification |
|---|---|---|
| `@supabase/supabase-js` | API/seed/staging scripts; UMD copied by build | Actively required |
| `cloudinary` | Upload signature, resource validation, old asset deletion | Required for configured avatar feature |
| `cors`, `helmet`, `express-rate-limit` | API browser policy, security headers, rate limits | Actively required |
| `express`, `morgan` | Routing/middleware and request logs | Actively required |
| `dotenv` | Server and operational script environment loading | Actively required; not infer unused from browser imports |
| `jsonwebtoken` | Local HS256/ES256 JWT verification; draft session decoder | Actively required; local verification needs F04's semantic correction |
| `nodemailer` | SMTP branch when configured; Gmail API uses fetch separately | Conditional active requirement; no basis to remove without transport inventory |
| `xlsx` | Build copies local bundle; browser workbook export | Required; runtime is browser despite no backend import |
| `clean-css` | Build plus guarded CSS maintenance script | Required development/build tool |
| `html-minifier-terser`, `terser` | HTML/JS production build | Required development/build tools |
| `parse5` | `scripts/html-transforms.mjs`, build and fixture HTML transforms | Required indirect build/test usage |
| `qs` override | Transitive dependency override, not direct application import | Not a ghost library |
| `pg` | Only pre-existing untracked integration script import | Undeclared draft prerequisite, not a installed-dependency cleanup candidate |

No removals are recommended from import counts alone. The XLSX bundle is injected into every page carrying `script.js`, including pages that do not export; delayed/page-specific loading is a performance option, not proof the library is unused. The dependency lock and source were reviewed; a current advisory database/network package audit was not run, so no claim of vulnerability-free dependencies is made.

## I. Dead / Legacy Code

- **P3, HIGH:** `employeeOnly` (`index.js:471`) has no call site found in runtime source.
- **P3, HIGH:** `downloadCsv` (`admin-sections.js:458`) has no call site found; current export UI chooses XLSX/PDF. Verify no external/global consumer before deletion.
- **P3, HIGH:** `sidebar.js` only adds an empty `ace-session-verified` listener, but is still referenced by many HTML files. Remove references and asset together only after built-page comparison.
- **P3, MEDIUM:** `planned_end_at` and its index remain in SQL with no active scheduling writer/consumer found. This is a schema compatibility candidate, **not** permission to drop the column or stored values.
- **P3, MEDIUM:** `compute_schedule_compliance` has a contract-verifier reference but no live API invocation in this repository. Discover direct external consumers before retiring it.
- Retired break/access-request SQL files remain operational hazards if presented as current, but are useful history. Label/archive operational instructions rather than delete migrations.
- `admin-management.html` and `admin-management-redirect.js` are compatibility entry points; preserve old bookmarks unless usage has been checked.
- The four untracked reliability files are active drafts, not abandoned code to remove.

## J. Performance Findings

**Directly evidenced work amplification:**

- Startup reads every page of history, with exact counts per page, then admin users/invitations/reports/audits; unrelated feature failure can delay clock controls. Work grows with company history.
- Employee profile repeats broad reads already represented in global startup. Admin sections independently refresh their own paged lists.
- Search/remarks/project-membership filters first fetch ID sets then send large IN filters. These can hit response/URL limits and incomplete populations; use relation filters/joins or a properly scoped server query after measurement.
- Leaderboard calculates totals in Node from fetched rows rather than an aggregate with guaranteed completeness.
- `employeeTimeEntries`, report rendering and some charts repeatedly find users inside entry loops. Runtime CPU impact has not been measured; lower priority than correctness/completeness.
- Presence update batching saves writes but its cadence currently violates UI freshness (F15).
- Build globally includes XLSX; custom navigation often then reloads those pages (F12).

**Likely risks, not measured incidents:** initial-load latency at large history sizes; high shared-office IP traffic hitting the 600/15-minute API limiter; unbounded SSE subscriber sets and slow-client write buffering; repeated forced JWKS refresh for unknown key IDs; lack of provider deadlines.

**Do not prioritize without evidence:** replacing every array find with a Map, adding Redis, background report generation, sharding, or speculative database indexes. Inspect row counts, query plans, response sizes, p95 startup and clock-out latency first. No production benchmark was run.

## K. Security Findings

Priority is F01 privileged RPC access, then F04 session/permission semantics and F05 lifecycle consistency. F09's unrestricted message projection, F13's upload enforcement, and F15's stream authorization deserve narrower fixes.

Positive controls include: service key stays on server; browser gets publishable key only; route guards protect admin-only data; UUID validation on primary route parameters; employee time queries constrain ownership; time writes are service-only in the migration path; no raw SQL string execution from browser inputs; CSP disallows inline scripts; HTML escaping is widely used; CORS has an explicit production origin allowlist; append-only audit protections exist.

Limits and follow-up:

- Query-builder filter strings still interpolate search text after partial punctuation normalization. No confirmed SQL injection or cross-user access bypass was established. Test PostgREST filter grammar/error handling without labeling it raw SQL injection.
- Profile cache delays revocation, and broad catches turn dependency failures into auth failures. Fix semantics rather than relying on hidden UI buttons.
- Bearer Authorization rather than ambient authentication cookies is used for the API; no new CSRF mechanism is justified solely by generic checklist wording.
- Tracked environment files are examples; real `.env*` files are ignored. Secret values were not printed. This audit is not a complete historical secret scan.
- Static headers contain a fixed API hostname while build permits arbitrary `ACE_API_URL`. Actual frontend hosting headers/clean-route rules are **Not confirmed from the current codebase**; a different deployment target needs matching CSP and rewrites. The build copies `_headers` unchanged.
- The database contract verifier checks availability as service_role, not effective anon/authenticated denial. A successful health check likewise proves DB connectivity, not complete release safety.

## L. Testing Gaps

The 134 passing tests are useful but uneven: many assert regex/source fragments, several execute extracted handlers in VM mocks, and tutorial tests exercise a fixture backend. These protect known formatting/contracts but cannot prove PostgreSQL ACLs, transaction isolation, constraints, actual provider caps, real browser navigation or rollout safety. The four new session module tests do not test the active Express authentication path.

Required invariant suite before remediation rollout:

1. Real database unique-open-entry conflict with simultaneous clock-ins; conditional close race with correct single audit.
2. **Old API clock-in → deploy → new API reads and clocks out using the same UUID, user ID and original timestamp; exact intended duration; no duplicate record.**
3. New clock-in → rollback → old API reads/completes. Mixed APIs operate against the same expanded schema.
4. Lost response after committed clock-in/out; cross-tab and admin-stop reconciliation.
5. Direct anon/authenticated denial for every privileged RPC, especially overtime.
6. Last-admin mutation races across all writers, including invite and old APIs.
7. Auth/profile/invitation/audit failure injection and rollback; revoked logical sessions across instances.
8. Overnight/timezone/schedule deletion and approval correction tests with historic null snapshots.
9. Above-cap report/employee/chat populations; count equals generated rows; archived users retain identity.
10. Actual hashed production pages: navigation, focus/keyboard controls, repeated mounts, tutorials, clocks and expired sessions.
11. Fresh schema provisioning, first administrator, every supported upgrade chain, constraint/ACL checks, and one-time migration protections.

Do not fix the tests simply to assert the new implementation text. Test outcomes and invariants. Replace retired break scenarios in the staging suite, and use an isolated disposable database with verified identity before permitting writes.

## M. Live Workflow Compatibility

These are repository-based assessments, not a live safety certification. No currently proposed clock/auth/schema change is classified SAFE without transition proof.

| Workflow spanning deployment | Old → new assessment | Mandatory preservation / test |
|---|---|---|
| Open shift → clock-out | Same current UUID/timestamp contract is structurally compatible; fixes unproven | Preserve entry/user IDs, original clock-in, null clock-out; new close and rollback close; no duplicate/reset |
| Clock-in/out response in flight | Existing UI cannot reconcile lost response (F08) | Commit/drop-response test; re-read state without changing original timestamp |
| Archived/denied employee with open shift | Employee middleware blocks clock-out; admin route can resolve it | Define approved operational resolution; do not auto-close during migration or reactivate accounts implicitly |
| Active Supabase session / refreshing token | Current process restart loses local denylist; new draft may impose additional requirements | Existing session claims/rows supported; only revoked sessions rejected; recoverable outage handling |
| Admin form changing user role/status | UI may be stale; API permissions cached; concurrent writes possible | Fresh checks plus global DB invariant; head-admin rules and audit preserved |
| Invite → Google login → acceptance | Trigger/API race and old-profile activation need testing | One intended identity/invitation transition; Auth ban agrees with profile |
| Schedule assignment or deletion during clock-in | Snapshot read can race changes/deletion | Chosen assignment semantics explicit; persisted snapshot never guessed/backfilled |
| Overtime review / time correction | Derived approval can become stale | Interval/version or reapproval rule; preserve original approval evidence |
| Report preparation → download | Browser data can be older than saved count | Consistent fresh data and clear artifact semantics; old saved filter shapes remain readable |
| Chat / SSE connection | Restart reconnects; cross-process event delivery not guaranteed | Persisted messages recover via pagination; acknowledge only viewed data; token reauthorization |
| Uploaded photo awaiting completion | External asset persists; repeated completion can delete chosen asset | Accept valid pre-deploy upload, idempotent completion and safe old-asset cleanup |
| Tutorial in progress / pending save | Role progress is compatible expansion; rollback sees legacy snapshot | Preserve version/role progress; do not reset tutorials or block clock UI on tutorial outage |
| Unsaved forms / navigation | Full reload or old/new DOM mismatch can lose drafts | Built-page transitions; deliberate form preservation or explicit user navigation behavior |
| Presence heartbeat queued in memory | Pending values disappear at restart | Temporary presence staleness acceptable only by documented policy; no clock mutation |
| Time-entry archive/restore/permanent delete | Current RPC guards open shift deletion; existing IDs preserved on soft restore | Test old/new operation names; no destructive schema cleanup during rollout |

No durable background jobs, payments, subscriptions or webhooks were found, so compatibility requirements for them are N/A. Mail may be in-flight inside an invitation HTTP request; preserve committed access and separate delivery status if that process stops.

## N. Production Deployment Risk

For every proposal, existing **valid production data remains untouched unless explicitly stated**. “Compatible” below is a design target, not proof of deployed behavior. Where evidence is incomplete: **REQUIRES PRODUCTION-SAFETY VERIFICATION BEFORE IMPLEMENTATION.**

| ID | Production / existing-data impact | Active-user, active-session and active-workflow impact | DB migration required | Existing records / backward compatibility | Old/new coexistence | Rollback conditions | Classification |
|---|---|---|---|---|---|---|---|
| F01 | Narrow function ACL; no record changes | Denies unauthorized RPC callers; legitimate API approval should continue; sessions/clocks unchanged | Yes, permission DDL | Yes by signature; direct consumers require verification | Yes if API service role retained | Keep restrictive grants; do not restore exposure to roll back app | SAFE WITH PRECAUTIONS |
| F02 | Prevent wrong migration execution; baseline work may expose substantial drift | Wrong DDL can disrupt active shifts and all authenticated workflows | Depends on actual drift | Requires verification against actual DB and old API | Requires verification | Restore recorded definitions; destructive data changes need backups, not app-only rollback | SAFE WITH PRECAUTIONS for new path; blind replay is DISRUPTIVE |
| F03 | Global profile-write guard; new guard state, no historical attendance rewrite | Competing admin mutation rejected; sessions remain; administrative forms must handle conflict | Yes | Existing records require population validation; old writes should satisfy invariant | Yes if guard covers every writer | Retain guard on app rollback; removing it restores race; test failure mappings in old API | SAFE WITH PRECAUTIONS |
| F04 | Shared revocation/current permission reads; no shift rewrite | Revoked sessions denied; valid sessions must survive; open shifts must remain closable | Yes for proposed shared store | Requires verification of legacy session claims/Auth schema | No security guarantee while old API ignores store; sequencing required | Old rollback revives weaker revocation; maintain compatible enforcement or accept documented risk | SAFE WITH PRECAUTIONS; forced mass logout is DISRUPTIVE |
| F05 | Atomic future account transitions; targeted access changes only | Intended restored user can log in; no mass activation; admin form/retry semantics change | Yes | Existing profiles preserved; old clients keep request shape | Requires verification: old direct-write path still splits state | Keep compatible RPC; app rollback restores old bug; no automatic rebanning | SAFE WITH PRECAUTIONS |
| F06 | Correct future overtime computation; historical approvals untouched | Approval/correction workflow changes; sessions unchanged; open shift duration policy preserved | Yes for SQL function | Requires verification of interval rules; API shape can stay | Mixed semantics undesirable for approval/correction; sequence writers | Forward correction preferred; never recompute old approvals merely to roll back | SAFE WITH PRECAUTIONS; bulk historical recalculation is DISRUPTIVE |
| F07 | Complete filtered reports/aggregates; no record rewrite | More accurate reports; valid sessions unchanged; decouple active clock retrieval | Not inherently; aggregate RPC may require additive DDL | Existing filters/IDs retained; historical membership comparison required | Yes with legacy response compatibility | Retain old endpoints/additive schema; old UI may retain incomplete data | SAFE WITH PRECAUTIONS |
| F08 | Browser reconciliation, optional additive active read | Preserves actual active shift through uncertain responses; no session reset | No for minimal read/reconcile | Yes by original UUID/timestamp contract; tests required | Yes | Revert UI without data changes; retain any additive endpoint | SAFE WITH PRECAUTIONS |
| F09 | Future message paging/ack; leave existing read history | Old chat clients need compatible window; sessions unchanged; unread behavior changes | No necessarily | Existing message IDs/bodies preserved; restricted field projection needs client check | Requires versioned/compatible ack semantics so old GET does not mark unseen rows | Old rollback restores incorrect ack; do not mass reset read_at | SAFE WITH PRECAUTIONS |
| F10 | Atomic future report/export audit, operation keys if needed | Export retries become deterministic; sessions/clocks unchanged | Yes for transactional RPC; additive key if chosen | Existing reports preserved; old request shapes supported | Requires verification of old split writer | Retain additive objects; app rollback may restore partial writes | SAFE WITH PRECAUTIONS |
| F11 | Preserve historical snapshot semantics; change schedule removal contract | Assign/delete conflicts handled; active snapshot untouched; sessions unchanged | Depends: SQL function and/or FK/retirement policy | Historical nulls must remain meaningful; no inferred backfill | Requires both writers honoring chosen deletion rule | Retain snapshots and compatible columns; no reconstruction from current assignment | SAFE WITH PRECAUTIONS |
| F12 | Navigation/build metadata or simplification only | Forms/tutorials/timer display may remount; sessions and DB records persist | No | Existing URLs/assets require compatibility | Requires old-assets retention policy | Roll back complete static artifact; verify old tab can still call API | SAFE WITH PRECAUTIONS |
| F13 | Retry-safe object finalization/validation | Pre-deploy uploads must complete; sessions/clocks unchanged | No | Existing avatar URLs retained | Requires verifying old writer cannot delete newly selected object | App rollback can restore destructive retry; retain guard if possible | SAFE WITH PRECAUTIONS |
| F14 | Tests/catalog checks/bootstrap contract; no production action in diagnostic stage | No user/session/workflow effect until a release process is changed | No for tests/docs | Yes | N/A for offline artifacts | Revert test/docs only; no data rollback needed | SAFE for offline checks; staging writes require isolation |
| F15 | Cadence/recovery/stream authorization | Brief reconnect; accurate presence; sessions checked without mass logout; clocks unaffected | No for minimal correction | Yes for payload compatibility | Yes for compatible payloads; shared delivery depends on topology | Revert stream/cadence settings; no attendance data reversal | SAFE WITH PRECAUTIONS |
| F16 | Retryable errors and request deadlines | Existing sessions and open-shift context preserved through outage | No | Yes, status contract must match old clients | Yes if old client handles 503 retryably, verify | Revert code; no schema/data reversal | SAFE WITH PRECAUTIONS |

**SAFE now:** diagnostic documents, offline reproductions, read-only catalog-query preparation, isolated test improvements, dependency inventory. Verified no-op cleanup can be a later independent change.

**DISRUPTIVE and not authorized for automatic implementation:** replaying conflicting/destructive legacy SQL; resetting active entries or sessions; dropping compatibility columns/functions without usage evidence; bulk overtime or duration recalculation; deleting alleged duplicate production records; mass tutorial/read-state resets. These require a concrete reviewed procedure, backup, affected population and explicit approval.

## O. Remediation Plan

### Phase 0 — Protect production

- **Dependencies:** none; begins with discovery, not mutations.
- **Work:** record deployed API/frontend commit and active DB definitions/ACLs; identify migration ledger and externally invoked RPCs; count active shifts without exposing employees; confirm backup/restore availability; select a disposable staging database. Replace obsolete concurrency tests and add transition fixtures. Retain the four existing drafts for review, not auto-deployment.
- **Production risk:** low for read-only checks; unverified test targets are unacceptable. Capture a protected baseline of open entry IDs, owners and clock-in times before any later rollout.
- **Benefit:** distinguishes repository defects from live exposure; makes compatibility measurable.
- **Tests:** all Section L gates, initially failing where appropriate; confirm expected source/DB versions.
- **Rollback:** no production writes; retain original definitions/artifacts and restore drill evidence for subsequent phases.

### Phase 1 — Fix root causes

- **Dependencies:** actual grants/schema known; isolated integration tests; defined interval/lifecycle semantics.
- **Work order:** F01 narrow ACL fix first; F03 global admin guard; F05 transactional activation; F04 compatible session enforcement; F08 clock reconciliation; F06 future approval correctness; F07 complete report membership. Split permission and arithmetic changes to overtime into separately reviewable patches.
- **Production risk:** SAFE WITH PRECAUTIONS. Sequence additive DB changes before compatible API, then browser. Run old/new API versions together in staging. Do not change active entry IDs/timestamps or generated-duration semantics as an incidental refactor.
- **Benefit:** eliminates concrete security/integrity failures instead of layering UI checks.
- **Tests:** direct denied RPC access, failed audit rollback, races, legacy session/record fixtures, commit/drop-response, original clock-in preservation, overnight cases, large history reports.
- **Rollback:** retain compatible additive objects; roll back application independently where safe. Shared revocation and required guards must not be silently bypassed by old code. Prefer forward correction over reverting a security boundary.

### Phase 2 — Consolidate

- **Dependencies:** corrected invariants with behavioral tests.
- **Work:** move all account transitions onto the chosen transactional contract; unify complete report queries; adopt a canonical installation path; let browser formatting reuse existing helpers where equivalent. Keep legacy API/RPC signatures as thin compatible entry points only while needed.
- **Production risk:** moderate caller-migration risk; no historical cleanup.
- **Benefit:** fewer sources of truth and fewer opportunities for one path to bypass constraints.
- **Tests:** caller inventory, response compatibility, old clients, historical profiles, exact report membership and equivalent output.
- **Rollback:** preserve old signatures and data shapes until rollout verification; remove alternatives only in a later release with usage evidence.

### Phase 3 — Simplify

- **Dependencies:** production behavior stable under new canonical paths.
- **Work:** resolve F12 navigation contract; decouple critical active-shift recovery from noncritical startup reads; correct F09 chat window/ack, F13 photo finalization, F15 presence/stream recovery and F16 outage handling. Remove superseded workarounds only after corresponding root correction proves them unnecessary.
- **Production risk:** UI lifecycle and in-flight operation compatibility, not a justification to rewrite the frontend.
- **Benefit:** predictable recovery and less incidental state.
- **Tests:** built-browser flows, form/clock preservation, message acknowledgments, repeat uploads, multiple instance notifications and dependency outages.
- **Rollback:** complete static artifacts, preserved URLs and compatible API contracts; no data resets to make old UI work.

### Phase 4 — Remove dead weight

- **Dependencies:** reference and external-consumer verification.
- **Work:** remove unused `employeeOnly`, unused CSV helper, no-op sidebar asset/references if confirmed; label retired SQL operational paths; keep necessary migration history. No library removal is justified by current evidence.
- **Production risk:** low for verified dead code, higher for schema removal; schema cleanup remains separate and delayed.
- **Benefit:** less misleading code and fewer accidental operational entry points.
- **Tests:** build, relevant browser smoke tests, script inventory; preserve CSS output-equivalence checks for stylistic consolidation.
- **Rollback:** code/artifact revert; no production database changes in this phase by default.

### Phase 5 — Optimize demonstrated bottlenecks

- **Dependencies:** measured startup/query/payload baselines and correct reporting.
- **Work:** replace whole-history startup with scoped reads/aggregates; avoid duplicate profile-view fetches; optimize ID-set queries; load XLSX where needed. Add indexes only after query-plan evidence; adopt shared SSE delivery only if topology requires it.
- **Production risk:** pagination and aggregation correctness; use additive rollout and compare results.
- **Benefit:** lower startup latency and provider load as history grows.
- **Tests:** result equivalence at scale, stable pagination under concurrent writes, request counts and p95 latency, active clock independently available.
- **Rollback:** retain old compatible query routes during rollout; revert performance implementation without rewriting data.

### Targeted post-release verification

Use existing structured request IDs and add only actionable counters: failed/conflicted clock-outs, reconciliation outcomes, unique-open-entry violations, rejected last-admin transitions, denied privileged RPC attempts, session-check 503s, report count/data disagreement, missed chat recovery and provider timeouts. Do not log tokens, message bodies, notes, email contents or full employee records.

For each rollout, compare the protected active-entry baseline before/after: same entry ID, owner and clock-in timestamp; still active unless an authorized action closed it; eventual clock-out duration follows the approved policy. Observe legitimate user completion on the canary, confirm rollback compatibility in staging, then expand. **Until those checks pass, uninterrupted clock-in → deployment → clock-out is not proven.**
