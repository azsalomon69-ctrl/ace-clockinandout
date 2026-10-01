# ACE Clock In/Out — project and maintenance guide

This is the single maintained Markdown guide for ACE Outsource Solutions' workforce time-tracking application. Start here when joining the project or opening a new coding chat. Source is maintained by Akio Zaki Salomon for ACE Outsource Solutions; confirm company permission before reusing it elsewhere.

Consolidated on **2026-10-01**, against checkout `4b897eb`. Source facts describe that checkout, not an independently verified production deployment. Update this guide when behavior changes; do not create competing setup or audit Markdown files.

## Start here: live-company operating rules

**Employees are actively using this system. Protect their clock records and access.**

- The owner has requested no further production pushes, deployments, hosting-setting changes, or database changes without explicit approval. Prior approval for onboarding repairs was task-specific, not standing permission for future releases.
- Local edits and offline tests do not deploy anything by themselves. A push to a hosting-linked branch may trigger a release. Never assume a documentation-only push is exempt.
- Develop on a separate branch. Establish an isolated staging frontend, API, Supabase project and test accounts before testing real writes. A preview website pointed at the production API/database is **not isolated**.
- Prefer an approved quiet maintenance window: employees finished and clocked out, no imminent shift starts, tested release and rollback ready. Do not stop anyone's shift to make a release convenient.
- Do not run seed scripts, mutation tests, tutorial resets, historical SQL patches or migrations against production during ordinary debugging. Verify environment destinations before credentialed commands.
- Preserve PostgreSQL constraints, transactional clock/lifecycle RPCs and audit history. Do not silently truncate time-entry history to improve loading speed.
- Distinguish source inspection, mocked behavior, real-browser fixtures, staging integration and live verification. A source-text assertion or public health check is not proof of an employee clock journey.
- Do not print secrets or ask employees to share tokens. `.env`, `.env.test`, generated builds and logs are ignored; examples contain placeholders only.

The repository does **not** establish that isolated staging or blue-green environments exist. Their setup was discussed, not implemented. Hosting settings, backups, billing plans and applied migration state need verification.

### Reading route for a new chat

1. Read this guide; run `git status --short` and `git log -5 --oneline`; preserve existing user changes.
2. Read [package.json](package.json), [render.yaml](render.yaml), and the relevant module below.
3. For data/auth changes, inspect [backend/server/index.js](backend/server/index.js), the relevant SQL and behavior tests together.
4. Choose checks that do not contact production. Report actual commands/results and evidence limitations.
5. Keep runtime changes targeted. Update this guide with lasting decisions, migration requirements and unverified work.

## Contents

- [Architecture and roles](#architecture-and-roles)
- [Source map](#source-map)
- [Clock and data invariants](#clock-and-data-invariants)
- [Local setup and configuration](#local-setup-and-configuration)
- [Tests and what they prove](#tests-and-what-they-prove)
- [Tutorials and help](#tutorials-and-help)
- [Database migrations](#database-migrations)
- [Deployment and staging](#deployment-and-staging)
- [Operations and troubleshooting](#operations-and-troubleshooting)
- [Historical audits and decisions](#historical-audits-and-decisions)
- [Known gaps and next work](#known-gaps-and-next-work)
- [Documentation provenance](#documentation-provenance)

## Architecture and roles

ACE is a static HTML/CSS/JavaScript frontend with a Node/Express API. Supabase supplies PostgreSQL and Auth, including Google sign-in. Data goes through the API using Supabase's HTTPS PostgREST/RPC client; the application has no direct PostgreSQL driver or pool.

```text
Browser: static frontend + Supabase Auth session
    | Bearer token, /v1 requests
    v
Node/Express API on Render
    |-- Supabase PostgREST --> PostgreSQL tables and transactional RPCs
    |-- Supabase Auth/JWKS --> identity verification and account operations
    |-- Gmail API / optional SMTP --> invitations
    |-- Cloudinary --> profile photos
    `-- process-local SSE --> chat and notification delivery
```

The documented frontend host is a separate Render Static Site, but its actual dashboard configuration is not in this repository. The API does not serve the frontend. The build's “Cloudflare headers” message does not establish Cloudflare as the live host.

| Role | Main capabilities |
| --- | --- |
| `USER` (employee) | Clock in/out, assigned projects/schedule, personal records, admin remarks, private chat with administrators, profile/settings |
| `ADMIN` | Invitations, people/department/project/schedule management, active entries, corrections/overtime, archive/recovery, reports/exports, audit logs |
| Head administrator | Server identifies `HEAD_ADMIN_EMAIL`; adds protected-account and restricted chat-log capabilities. Not a third database role. Uses the same ADMIN tutorial, at the owner's request. |

New Google sign-ins require a matching active invitation after migration 0021. Self-service access requests and break tracking are retired; old SQL/test references are historical, not active features.

### Authentication and security boundaries

- [supabase-auth.js](frontend/js/supabase-auth.js) creates the browser Auth client from `/v1/auth/config`, coalesces session reads/refreshes, sends tokens and handles expiry. Browser identity/role cache is not authoritative.
- API `authenticate` tries local JWT verification: configured legacy HS256 secret, otherwise ES256 public JWKS (10-minute key cache). It falls back to GoTrue `getUser`, coalesced/cached for 30 seconds. Older audits saying every request always calls GoTrue are outdated.
- Administrator/restricted middleware additionally checks fresh GoTrue identity. Profile lookups have a 5-second process-local cache. Authorization uses profile role/status and server ownership checks.
- The service/secret database client bypasses RLS. Express guards and scoped queries must enforce access. Keep RLS, grants, constraints and functions as additional protection.
- Head/last-admin protections and lifecycle guards live in API/SQL. Preserve them when editing invitations, roles, archive/restore or permanent deletion.
- CORS uses explicit comma-separated `FRONTEND_ORIGIN` values; production requires it. API headers use Helmet; browser headers/CSP come from [frontend/_headers](frontend/_headers).
- General/sensitive rate limits are 600/30 requests per 15 minutes, with process-local state. UUID request IDs are returned/logged and attached to audited operations.
- Logout records `/v1/auth/session-end`, evicts local auth/profile caches and holds a bounded one-hour token-hash revocation record. It is not durable across restarts or shared across instances.

Current application source does not use Supabase Storage, Edge Functions or Realtime. Cloudinary handles images; Express SSE handles events. Admin seeding uses Auth Admin; routine avatar enrichment no longer lists all Auth users.

## Source map

| Path | Purpose |
| --- | --- |
| [backend/server/index.js](backend/server/index.js) | Express, auth/authorization, caches, presence, mail, all `/v1` handlers, SSE, health/errors |
| [frontend/js/script.js](frontend/js/script.js) | `AppState`, initialization, shell/sidebar, clock/timer, dashboards, chat, help/search, remarks, reports/exports |
| [frontend/js/supabase-auth.js](frontend/js/supabase-auth.js) | Browser Auth client and API session recovery |
| [frontend/js/admin-sections.js](frontend/js/admin-sections.js) | Admin lists, filters, actions, invitations, projects, entry controls/exports |
| [onboarding-config.js](frontend/js/onboarding-config.js), [onboarding.js](frontend/js/onboarding.js) | Tutorial content and rendering/persistence/navigation engine |
| [schedule-flex.js](frontend/js/schedule-flex.js), [individual-reports.js](frontend/js/individual-reports.js) | Schedule/assignment forms and individual reporting |
| [employee-profile.js](frontend/js/employee-profile.js) | Employee detail view |
| [deleted-users.js](frontend/js/deleted-users.js), [deleted-time-entries.js](frontend/js/deleted-time-entries.js), [chat-log.js](frontend/js/chat-log.js) | Recovery and restricted log pages |
| [admin-management-redirect.js](frontend/js/admin-management-redirect.js), [sidebar.js](frontend/js/sidebar.js) | Legacy redirect and compatibility hook; current shell is in `script.js` |
| [frontend/css/app.css](frontend/css/app.css) | Shared styles, themes, layout, responsive UI and tutorial appearance |
| [frontend](frontend) | 23 HTML pages, `_headers`, logo/images/SVGs; some admin pages are small JS-rendered containers |
| [scripts/build-frontend.js](scripts/build-frontend.js) | Hashed/minified static assets and HTML into ignored `dist/` |
| [security-regression-check.js](scripts/security-regression-check.js) | Offline security contracts |
| [security-integration.staging.js](scripts/security-integration.staging.js) | Credentialed staging authorization/mutation checks |
| [verify-database-contract.js](scripts/verify-database-contract.js) | Credentialed schema/RPC checks |
| [seed-admin.js](scripts/seed-admin.js) | Creates/updates initial Auth user/admin profile; performs writes |
| [consolidate-css.js](scripts/consolidate-css.js) | CSS maintenance utility, not a normal build requirement |
| [backend/tests](backend/tests) | Node tests and real-browser tutorial fixture helpers |
| [schema.sql](supabase/schema.sql), [current-production-upgrade.sql](supabase/current-production-upgrade.sql), [migrations](supabase/migrations) | Historical baseline, patches and versioned SQL; see cautions below |
| [deliverables](deliverables) | Two PowerPoint walkthroughs; artifacts, not authoritative runtime documentation |
| [package.json](package.json), [package-lock.json](package-lock.json) | Node >=20, scripts and locked dependencies |
| [.env.example](.env.example), [.env.test.example](.env.test.example), [.gitignore](.gitignore), [render.yaml](render.yaml) | Configuration templates, ignore rules and API hosting declaration |

Pages: public `index`, `login`, `404`; employee `user-dashboard`, `time-entries`, `remarks`; shared `settings`; administrator `admin-dashboard`, `users`, `invitations`, `departments`, `projects`, `schedule-flex`, `admin-time-entries`, `deleted-time-entries`, `deleted-users`, `reports`, `individual-reports`, `audit-logs`, `employee-profile`, `time-entry-details`, `chat-log`; legacy redirect `admin-management`.

API families: `/v1/me` and tutorial/avatar subroutes; `/v1/auth/config` and session/presence routes; departments/projects/schedules/assignments; users/invitations; employee-chat/restricted admin chat log; time-entries/leaderboard/review/remarks; reports/exports; audit-logs. Inspect middleware and predicates before assuming access.

## Clock and data invariants

- Clock-in writes through `clock_in_entry_with_audit`; clock-out calls `clock_out_entry`. Explicit admin operations stop/correct/archive entries. Refresh or API restart does not itself clock someone out.
- Active means `clock_out_at IS NULL`. A partial unique index permits one open entry per user. Preserve it and the clock-out-after-clock-in constraint.
- The browser reconstructs the active session/timer from the saved clock-in timestamp. Completed duration derives from timestamps, not heartbeat ticks.
- Clock-out requires a short official note (API maximum 50 characters). New clock-in notes and break deductions are not current features.
- Clock-in snapshots schedule details/workdays. Later schedule edits must not rewrite historical snapshots.
- Reports use Manila calendar-day boundaries and exclude removed entries where specified. Preserve report-boundary behavior.
- `loadAllTimeEntries` fetches all pages (100 records/request). Lifetime totals, reports/exports, project totals, search and details depend on the full array. Replacing it with the first page silently changes results.
- Keep audit/clock/lifecycle RPC transaction boundaries. Historical SQL has different versions; inspect the applied function before changing it.
- A restart can interrupt a response even if its transaction committed. Clock submission has no durable offline queue or complete ambiguous-response reconciliation. Check resulting entries before repeating mutations.
- Presence/online dots and chat delivery are separate from clock records. A lost presence update does not stop a shift.

## Local setup and configuration

Use **isolated development/staging credentials**, never production credentials for interactive development. There is no verified one-command fresh database bootstrap; read [Database migrations](#database-migrations). The tutorial fixture needs no Supabase credentials.

1. Install locked dependencies using `npm ci`, including development dependencies for builds.
2. Copy `.env.example` to ignored `.env` and fill staging values. Do not commit it.
3. Start the API with `npm run dev` (`node --watch`); `npm start` runs without watch. Listener: `PORT` or 3000.
4. Build/serve the generated frontend. Raw HTML references generated browser assets, so serving only the repository root is not a reliable complete setup.

PowerShell, local API and static server on port 5500:

```powershell
$env:ACE_API_URL = 'http://localhost:3000'
npm run build
npm run preview:build -- --listen 5500
```

Set API `FRONTEND_ORIGIN=http://localhost:5500`. `preview:build` uses `npx serve dist` and may download `serve`. Configure Supabase/Google OAuth redirect URLs for the chosen non-production frontend.

| Variable(s) | Meaning |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY` | Required API project/credentials. Only URL/publishable key may reach the browser; secret/service key stays server-side. |
| `HEAD_ADMIN_EMAIL` | Required protected head-admin identity |
| `SUPABASE_JWT_SECRET` | Optional legacy HS256 secret; blank selects ES256 JWKS path. Never expose in frontend. |
| `PORT`, `NODE_ENV`, `FRONTEND_ORIGIN` | Listener, environment and browser-origin allowlist |
| `ACE_API_URL` / `ACE_API_URL_FALLBACK` | Frontend build target API URL; build requires a valid value |
| `INVITE_REDIRECT_URL`, `ALLOWED_EMAIL_DOMAINS` | Invitation destination and optional domain restrictions |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Optional profile-photo integration |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_FROM` | Preferred Gmail invitation delivery |
| `SMTP_USER`, `SMTP_APP_PASSWORD`, `SMTP_FROM`, `SMTP_PORT` | Optional SMTP fallback; verify host restrictions |
| `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD` | Used by `npm run seed:admin`, which writes Auth/profile data |
| `ACE_TEST_*` | Staging test URLs/accounts/options; see `.env.test.example` |

Seeding is not a production repair tool. Migration 0021's invitation-only trigger can affect creation of a brand-new seed account; verify bootstrap/invitation ordering in a disposable project rather than disabling production auth rules.

The build copies local Supabase/SheetJS browser bundles, minifies JS/CSS/HTML, hashes filenames, injects API configuration, rewrites asset links and copies `_headers`. It deletes/recreates `dist/`; do not hand-edit/commit generated assets. No source maps are emitted. Old dependency-vulnerability counts are dated observations, not current guarantees.

## Tests and what they prove

| Command | Scope and prerequisites |
| --- | --- |
| `npm test` | Mix of source/configuration contracts and executed mocked behavior; not live integration certification |
| `npm run test:security` | Offline source/header/auth-route contracts |
| `node --test backend/tests/tutorial-behavior.test.js` | Production route handlers with mocked identity and in-memory storage |
| `npm run build` | Build validation; requires API URL, no live API call needed |
| `npm run test:security:integration` | Real staging Auth/API checks using `.env.test`; some options mutate records |
| `npm run test:concurrency` | Staging mutation tests, currently outdated due to retired break-route references |
| `npm run db:verify` | Connects to Supabase, checks tables/columns and invokes RPCs with a fixed supposedly absent UUID; review target/UUID before use. Not an offline test or migration. |

URL/flag guards do not prove staging database isolation. Verify both API and Supabase destinations. Concurrency tests additionally require `ACE_TEST_RUN_CONCURRENCY=true`.

Test map:

- `auth-recovery`, `leaderboard-access`, `profile-lifecycle`, `report-boundaries`, `tutorial-behavior` include executed client/handler behavior using mocks or extracted production code.
- `onboarding` has 19 source/configuration-oriented contracts with limited pure-function execution; not browser journeys.
- `access-request-removal`, `database-contract-verifier`, `input-validation`, `invitation-email-headers`, `live-chat`, `live-refresh`, `project-assignment-contract`, `remark-notifications`, `time-entry-reporting-audit`, `transactional-audit-reliability` provide targeted regression contracts; inspect implementation before calling a check integration coverage.
- `helpers/tutorial-backend.mjs` extracts real route registrations/cache into a VM. Identity/storage are doubles; post-migration data is seeded, SQL is not executed.
- `helpers/tutorial-fixture-server.mjs`, `fixture-boot.js`, `fixture-runner.js` run production tutorial scripts against real HTML/CSS with deterministic data and selected production renderer fragments.

### Real-browser tutorial checks

```text
node backend/tests/helpers/tutorial-fixture-server.mjs
```

Open in a real browser:

http://127.0.0.1:4179/runner?tests=proof,B1,B2,B3,B4,B4local,B6,B7,B8,B9,B10

Require `RUN FINISHED` and every result PASS. Raw results: `/results`. Only one runner at a time (shared fixture identity/store). Restart after changes to imported helpers.

| Test | Coverage |
| --- | --- |
| proof | Real focus, visible geometry, document navigation, persistent localStorage |
| B1 / B2 | Employee/admin welcome, own-role lessons, completion and second login |
| B3 | Skip and second login, both roles |
| B4 | Employee completion, promotion, admin tutorial, completed employee state retained |
| B4local | Offline employee skip isolated from admin across promotion and recovery |
| B5 (Node) | Immediate GET sees acknowledged tutorial PATCH, both roles |
| B6 | Offline skip/completion/resume survive reload and synchronize |
| B7 | Start from Settings begins at lesson one |
| B8 | Profile field retains real browser focus under an interactive lesson |
| B9 | Clocked-in target, schedule assigned/unassigned, chat launcher |
| B10 | Empty user/entry/audit tables and protected first user retain visible targets |

The fixture replaces authentication, storage, navigation setup and unrelated app loading. It proves real-browser tutorial behavior, not hosted OAuth, SQL/RLS or a complete production clock journey.

Verification history: on 2026-10-01, checkout `4b897eb` passed **122 Node tests** and security checks. The preceding D3 repair passed 11 browser checks and frontend build; the later startup fix added six missing/inaccessible-table mocked cases (failed before, passed after). These are historical results. No live migration execution or production clock mutation was performed in those checks.

## Tutorials and help

Current configuration: **USER version 10, 10 steps; ADMIN version 19, 23 steps**. Head administrators use ADMIN content. Read config for exact selectors/copy; older four-step/twenty-step documentation was superseded.

The tutorial is a sequential coachmark flow; **Need help** is a searchable role-specific FAQ in `script.js`. FAQ searches stay client-side. Shell readiness events initialize the tutorial. Navigation can expand the real sidebar/group and automatically load the target page after saving progress; old guidance saying it always waits for manual navigation was inaccurate.

- Welcome Start and profile-menu Restart begin at step zero, even from Settings.
- Interactive lessons do not trap focus away from highlighted forms. Welcome/exit confirmation retain modal focus containment.
- Alternate visible targets cover Clock Out, missing schedule notices, empty admin tables and protected first rows.
- Saves are serialized through `PATCH /v1/me/tutorial`; localStorage retains pending writes if the API fails. Keys include user ID and role.
- Statuses: `NOT_STARTED`, `IN_PROGRESS`, `COMPLETED`, `SKIPPED`; zero-based steps; completion stores step count.
- Version bumps **do not re-offer** completed/skipped tutorials. The engine preserves that choice and silently updates the version. Use Restart or an approved targeted reset to re-offer.

Edit concrete visible instructions/selectors, inspect the page/renderer, and test both roles, empty/protected rows, clocked-in state, collapsed navigation, desktop/mobile, focus, save failure/reload and cross-page navigation. Do not restyle unrelated pages without evidence of a blocked tutorial step.

### D1–D7 repair history and startup incident

| ID | Repair | Source / verification |
| --- | --- | --- |
| D1 | Invalidate profile cache after save | API; B5, browser B1–B3 |
| D2 | Prefer pending local state over differently named server fields | `onboarding.js`; B6 |
| D3 | Independent server/local progress per role | API, engine, migration 0025; B4/B4local, timestamp/reset isolation |
| D4 | Start from Settings at the beginning | Engine; B7 |
| D5 | Permit real form focus during lessons | Engine; B8 |
| D6 | Employee Clock Out fallback, schedule/chat lessons | Config/engine; B9 |
| D7 | Alternate targets for unavailable admin rows | Config/engine; B10 |

Commits: `75f4728` contained the harness and D1/D2/D4–D7 changes; `750bd22` added D3; `4b897eb` repaired startup compatibility.

**Production incident:** D3 originally made `GET /v1/me` depend unconditionally on the new table, so missing/inaccessible tutorial storage could fail whole-app startup. The user reported a live 500. The exact live DB error was not observed, but missing-table/permission failures were reproduced. `4b897eb` catches tutorial-read failure and returns the already-authenticated legacy profile, logging a warning. Preserve this: optional tutorial storage must not block login/data loading. Tutorial PATCH still needs the role table; without it, pending writes use browser fallback. This is not proof that D3 is fully deployed.

### Role attribution and reset

Migration 0025 creates `profile_tutorial_progress`, keyed by `(profile_id, role)`, with status/step/version and started/completed/skipped timestamps. API uses the authenticated profile role, not a request-body role.

- Legacy state belongs to **`profiles.role` at migration time**. The other role starts `NOT_STARTED`, step 0, version 1, null timestamps.
- Reruns preserve existing destination rows; completed/skipped users retain current-role progress.
- Historical promotions cannot be inferred and may need a separately reviewed reset.
- Legacy columns remain a rollback snapshot. New two-role histories cannot be losslessly collapsed into the old slot. Preserve the new table during rollback; reverting code does not reconcile data.
- Old unscoped localStorage pending writes are retained but ignored because their role is unknowable. Unsynchronized old completion/skip may need repeating.
- **Production application of 0025 is unverified.** A SQL file or passing mock test is not evidence it was applied.

Prefer profile-menu Restart for one signed-in user. For an approved selected-user reset **after 0025**, target the new table:

```sql
UPDATE public.profile_tutorial_progress
SET tutorial_status = 'NOT_STARTED', tutorial_step = 0, tutorial_version = 10,
    tutorial_started_at = NULL, tutorial_completed_at = NULL, tutorial_skipped_at = NULL
WHERE profile_id = (SELECT id FROM public.profiles WHERE email = 'employee@example.com')
  AND role = 'USER';
```

This changes data; it is not diagnostic. Use ADMIN/version 19 only for an intentional admin reset. Check the target row exists. Before 0025 only, legacy fields live in `profiles`; do not run old broad “reset all users” snippets on current installations.

## Database migrations

Git does not establish database state. Existing deployments may have applied targeted SQL manually. Record actual table/function definitions and migration history, verify a restorable backup, and rehearse the exact change in staging. Never replay all historical SQL on production.

### Historical ordering and fresh-install limitation

The previous guide listed `schema.sql`, `current-production-upgrade.sql`, then the numbered files below. **This is not a verified fresh-install recipe.** Migration 0005 alters `public.access_requests`, but neither the baseline nor consolidated upgrade creates that retired table. Other old access-request migrations also depend on it. The consolidated upgrade reintroduces old break fields/duration behavior later removed by 0009. Do not blindly rerun it after newer migrations.

A fresh staging project needs a reviewed/tested bootstrap path accounting for these dependencies. This consolidation does not invent tables, silently skip dependent migrations or change SQL. Bootstrap repair is separate work before provisioning from scratch.

Preserved numbered history (both 0009 files are intentional):

| Order | File in `supabase/migrations/` | Purpose |
| --- | --- | --- |
| 1 | `0001_break_end_rpc.sql` | Historical break-end RPC |
| 2 | `0002_clock_out_rpc.sql` | Clock-out predecessor |
| 3 | `0003_time_entry_schedule_snapshot.sql` | Entry schedule snapshots |
| 4 | `0004_compute_schedule_compliance.sql` | Schedule compliance |
| 5 | `0005_access_request_expiry_24_hours.sql` | Historical expiry; needs retired table |
| 6 | `0006_lock_down_time_entries_rls.sql` | Restricts direct writes |
| 7 | `0007_admin_time_entry_rpcs.sql` | Admin stop/correction |
| 8 | `0008_schedule_workdays.sql` | Workday-aware schedules |
| 9 | `0009_profile_tutorial_state.sql` | Legacy tutorial state |
| 10 | `0009_remove_break_tracking.sql` | Retires breaks, full elapsed duration |
| 11 | `0010_overtime_approval.sql` | Overtime approval |
| 12 | `0011_review_exports_and_reporting_indexes.sql` | Review/reporting indexes |
| 13 | `0012_preserve_original_chat_message.sql` | Original chat history |
| 14 | `0013_access_request_atomic_audit.sql` | Historical access-request locking/audit |
| 15 | `0014_transactional_lifecycle_audit_and_request_ids.sql` | Lifecycle/archive/delete transactions and request IDs |
| 16 | `0015_atomic_archive_restore_auth_state.sql` | Atomic archive/restore Auth ban state |
| 17 | `0016_idempotent_user_status_audit.sql` | Idempotent status/audit |
| 18 | `0017_idempotent_user_role_audit.sql` | Idempotent role/audit |
| 19 | `0018_time_entry_clock_in_audit.sql` | Atomic clock-in/audit |
| 20 | `0019_admin_remark_notifications.sql` | Durable remark read state |
| 21 | `0020_remove_access_request_flow.sql` | Removes retired objects |
| 22 | `0021_require_invitation_for_google_login.sql` | Invitation-only profiles |
| 23 | `0022_project_assignment_contract.sql` | Project-assignment contract |
| 24 | `0023_restore_change_user_status_with_audit.sql` | Restores status RPC |
| 25 | `0024_restore_change_user_role_with_audit.sql` | Restores role RPC |
| 26 | `0025_role_tutorial_progress.sql` | Per-role tutorial progress |

Other root SQL files are targeted historical upgrades, not extra mandatory steps: access-request flow, admin remark notifications, admin stop, profile-history retention, Auth trigger fix, breaks, clock notes, chat/presence, permanent user deletion, R2 photo columns, reinvitation, schedule snapshots, soft deletion and work schedules. The R2 filename does not mean uploads currently use R2. Keep SQL history and inspect dependencies before using any patch.

For an existing database: identify exactly what is missing, approve the narrow migration, preserve old/new code compatibility, rehearse in staging, apply in the approved window, then verify schema and actual role/clock behavior. `/health` only checks profile-table connectivity, not every table/RPC.

## Deployment and staging

Checked-in API configuration: Render Web Service, Node >=20, `plan: free`, build `npm install`, start `npm start`, health `/health`. No persistent disk or graceful SIGTERM handler is declared. Actual plan/region/branch/auto-deploy/instance count are not verified by the file.

Documented static site: build `npm ci && npm run build`, publish `dist`, `ACE_API_URL` points at the intended API. This service is not declared in the Blueprint. A preview built with the production URL can still affect live data.

No GitHub Actions workflow or automatic test/migration gate is present in the reviewed Render build. A successful build does not establish working business behavior. Main-branch pushes may auto-deploy; verify settings before pushing.

### Intended workflow — not yet configured

```text
Employees --> production frontend --> production API --> real company database
Developers --> staging frontend ----> staging API ----> separate test database
                         tested release + explicit approval
                                      |
                                      v
                         controlled production promotion
```

Staging isolates experiments. Blue-green keeps two release versions and switches traffic after validation; it does not isolate database writes by itself or permit experiments against live data.

Before release:

1. Verify hosting destinations/settings, schema and backups; keep a known working release.
2. Test locally/staging, including an active shift surviving redeploy, subsequent clock-out, concurrent/retried actions, role access and login recovery.
3. Keep schema compatible with both versions; introduce structures before dependent code and delay destructive cleanup until rollback is unnecessary.
4. Obtain owner approval and the quiet window; confirm staff have finished and no shift is about to begin.
5. Deploy the tested release, check sign-in and agreed smoke tests, monitor errors. Revert code if needed; do not overwrite newer clock data with an old backup blindly.

No downtime guarantee/current price is established here. `plan: free` is a config fact, not proof of the live purchase. Verify provider limits, costs and actual account settings before decisions. References: [Render deploys](https://render.com/docs/deploys), [free limits](https://render.com/docs/free), [health checks](https://render.com/docs/health-checks), [preview environments](https://render.com/docs/preview-environments).

## Operations and troubleshooting

### Startup, login or missing data

- Public `/health` checks API/profile connectivity. On 2026-10-01 it returned 200 and `database: connected`; this was a point-in-time observation, not a monitoring guarantee.
- Inspect failed endpoint/status and server request ID. A `/v1/me` 500 can prevent UI loading without implying data deletion.
- Check schema errors/deployed commit before changing passwords, roles or records. Preserve the tutorial fallback from `4b897eb`.
- Verify API URL, CORS origins, OAuth redirects, invitation status and required variables. Never reveal secrets while checking configuration.
- Do not mutate production clock records to test availability. Use staging or an explicitly agreed test account/workflow.

### Interrupted clock action

Check whether the entry was created/closed before retrying. A lost HTTP response does not establish rollback. Saved timestamps and audit history are the evidence. Do not globally reset or delete active entries as a fix; only authorized, verified corrections should change recorded time.

### Email, photos and live updates

- Gmail API over HTTPS is preferred; SMTP depends on host network rules. An invitation can be created even if email fails; inspect the result before duplicating it. Check sender/OAuth configuration/token lifetime with the provider.
- Cloudinary signed upload/completion handles photos. Google metadata URLs can be conditionally persisted once if no custom photo exists; routine all-user Auth sweeps were removed.
- Chat messages are durable rows; SSE subscribers are process-local. Restart/reconnect interrupts delivery, and multiple API instances need shared event delivery before promising cross-instance notifications.
- Browser presence sends every 90 seconds in visible tabs. The API batches presence writes every five minutes; browser online threshold is four minutes. This mismatch can make online dots inaccurate. It is separate from duration tracking and is noted, not repaired here.

### Load, caches and logs

Current code uses bounded (500-entry) promise-coalescing caches, hashed token keys, 5-second profiles, 30-second GoTrue fallback results, 15-minute unfiltered department/project data, and 10-minute JWKS. Review invalidation when changing writes/roles. Memory caches/revocations/rate limits/SSE state are not shared or durable.

Production Morgan skips responses below 400; warnings/errors remain. This reduces Render logs, not Supabase ingestion directly. Full-history entry loading remains deliberate until every consumer has correct paged/aggregate replacements.

For ingestion complaints, compare matching before/after periods in Usage and Logs Explorer, grouped by service/path and bytes where available. CSV message length and request counts are not billable-byte measurements. Do not disable checkpoint, lock-wait or autovacuum diagnostics without evidence/approval. [Supabase ingestion guidance](https://supabase.com/docs/guides/platform/manage-your-usage/logs-ingest) and [logging configuration](https://supabase.com/docs/guides/database/postgres/postgres-log-config) describe provider controls. Old optional tuning commands were never verified as applied.

## Historical audits and decisions

September 2026 findings are context, not current infrastructure measurements or permission for new work.

- **Log export:** prior analysis of a supplied 1,000-row CSV covered 2026-09-29 12:58:59–17:31:58. It recorded 946 Edge/API rows and 54 checkpoint rows. Profiles: 418 (341 reads, 77 PATCHes); Auth validation: 304; time entries: 39; Auth admin users: 33; remarks: 24; other REST: 124. Profiles plus Auth were 76.3% of Edge/API rows. Peak minute: 294 requests; peak second: 44. HTTP outcomes: 942 successes (200), three 401, one 206; checkpoint status normal. These are retained historical findings; the external CSV was not reprocessed during consolidation.
- **Billing limit:** about 138 KB of displayed CSV event text did not establish the reported roughly 1 GB billed ingestion. Sampling, metadata and other windows could account for differences. Comparable before/after billing evidence remains outstanding.
- **Load reductions:** session coalescing, short auth/profile caches, no routine all-user avatar listing, conditional avatar persistence, joined own-remarks filtering, longer heartbeat interval, error-only production request logs. Later source also has local JWT verification, reference caching and presence batching. Earlier “GoTrue on every request”/“write on every heartbeat” descriptions are superseded.
- **Rejected shortcut:** first-page-only entry loading was reverted because reports/totals/search need complete history. Do not reintroduce it without redesigning consumers.
- **Hosting/cost:** prior estimates for 30–100 users favored retaining the stack and checking always-on availability before vendor migration. Old dollar figures/plan guesses are not current quotes. Billing, backups, capacity and live plans are unverified.
- **Provider independence:** `/v1` is already a useful data boundary. Coupling remains in Supabase Auth/JWT/OAuth sessions, PostgREST builders, `auth.users` foreign keys/triggers/lifecycle functions, and Supabase grant roles. No decoupling effort is complete.
- **If migration is separately authorized:** baseline/backup and contract tests first; preserve API responses/PostgreSQL transactions; test a data adapter; rehearse export/restore; retain one authoritative writable database at cutover; address Auth replacement last. Identity migration is riskier than changing the API host. Preserve IDs/rollback compatibility. Old estimates were rough planning, not commitments.
- **No rebuild justified:** onboarding was repaired within the existing engine. Evidence did not require frontend rebuild, Supabase/Auth replacement, moving clocks out of SQL, Redis/queues or dual writable databases.

## Known gaps and next work

Observations/planned work, not authorization to change production:

1. Verify actual hosting settings, live commit, frontend host, Supabase migrations and restorable backups. Production migration 0025 remains unknown.
2. Establish isolated staging and a tested fresh bootstrap; resolve retired-table migration dependencies.
3. Update staging concurrency tests for no-break clocks; test redeploy/interrupted-response recovery with staging accounts.
4. Add release/test/schema-compatibility gates. Public health proves only profile connectivity.
5. Review graceful shutdown and uncertain clock response reconciliation; no durable offline clock queue exists.
6. Review five-minute presence batching versus four-minute online display; keep separate from clock correctness.
7. Measure traffic/data before pagination changes; confirm log savings with matching billing evidence.
8. Before multi-instance scaling, review SSE delivery, revocation, cache invalidation and rate limits.
9. Recheck mobile/sidebar tutorials and genuine hosted OAuth/database behavior before claiming live verification.

## Documentation provenance

This guide consolidates the former root README/tutorial guide, backend tutorial-test guide, migration-order guide, deployment/cost audit, log-reduction report, Supabase decoupling audit and log-export analysis. Conflicting assertions were reconciled against code. Detailed earlier wording is recoverable from Git history.

The consolidation crawled **177 project-owned files** before edits: source, configuration, SQL, tests, eight Markdown files and binary asset/deliverable inventory. `.git`, `node_modules` and generated `dist` were excluded from the source crawl. Images/presentations were inventoried, not treated as current architecture evidence. Application code, SQL, data, hosting settings and dependencies were not changed by this consolidation.

Keep repository-owned documentation in this README. Do not delete third-party package README/license files to enforce this convention. A new chat does not automatically remember prior conversations: record lasting decisions and verified limitations here, and direct the next chat to read this file first.
