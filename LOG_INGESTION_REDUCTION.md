# Supabase log-ingestion reduction

Date: 2026-09-30. Code changes in this document are complete and tested. Supabase Dashboard/CLI actions are intentionally not run because this checkout has no live credentials.

## Result

The high-volume application traffic has been reduced without changing the public `/v1/...` API contract or clock-in/out implementation. The clock-in and clock-out RPC routes were not modified.

The most important correction to the original diagnosis: this checkout's browser source does not call `supabase.auth.getUser()`. It calls `getSession()`. The repeated `/auth/v1/user` and current-profile reads are primarily created by the Express `authenticate` middleware, which previously did a GoTrue `getUser(token)` and a `profiles` select for every parallel protected request. The new short-lived, coalescing cache targets that actual behavior.

## Follow-up review: corrections and evidence

### Presence is internally consistent

The shipped setting is **90 seconds** between visible-tab heartbeats and a **four-minute** online window. This is the requested balance: half the old heartbeat traffic without a user blinking offline between normal heartbeats. All three online calculations use the same `presenceWindowMs` constant.

### Test files: no tests were deleted or weakened

The final output of both requested commands is empty:

```text
git diff --stat -- backend/tests

git diff -- backend/tests/leaderboard-access.test.js backend/tests/time-entry-reporting-audit.test.js
```

Both test-file edits made in the earlier iteration were reverted after the time-entry review. Consequently there is no per-test deletion justification: **there are no deleted test cases and no changed test assertions.** The current checkout's full Node suite reports 103 generated tests, exactly as it did before the code-only changes in this working tree. The reported “114 to 103” difference is not attributable to this diff; `git diff --name-only -- backend/tests` is empty.

### Time-entry consumers: pagination was not shipped

The first-page-only experiment would have been incorrect, so it was reverted. These consumers require full history today and continue to receive it:

| Consumer | Status |
|---|---|
| Dashboard weekly hours/chart/current active entry/recent activity | **Works correctly:** full array retained. |
| Admin dashboard employee totals, clocked-in count, today count, recent-entry pagination | **Works correctly:** full array retained. |
| Employee time-entry table, lifetime total, entry count, average duration, filters, detail modal | **Works correctly:** full array retained. |
| Admin entry detail deep link and remarks context | **Works correctly:** full array retained. |
| Global workspace search | **Works correctly:** searches full locally loaded history. |
| Notification/remarks entry context | **Works correctly:** full entry map retained. |
| Generated report preview, Excel/PDF export, report totals | **Works correctly:** filters full array. |
| Project-detail tracked time | **Works correctly:** aggregates full array. |

The proper follow-up is not another hidden default. It is a deliberate pagination/aggregate design in which report/export/project/detail views fetch their own server-authoritative data. That work was not included because it would otherwise change correctness silently.

### Avatar decision

Google avatars are now persisted once rather than discarded. On an authenticated request, if `profile_picture_url` and the Cloudinary public ID are absent, the server obtains the authenticated user's Google metadata URL, validates it as HTTPS and bounded length, then performs a conditional update only if the column remains null. A promise-aware per-profile cache coalesces concurrent first requests. This preserves the profile-photo feature while eliminating every-screen `auth.admin.listUsers` sweeps.

### Cache and logout verification

* **Token cache key:** SHA-256 base64url digest of the bearer token. Raw bearer tokens are not stored as cache keys.
* **Maximum size:** each in-process cache is capped at 500 entries. Expired entries are pruned before insertion; the oldest remaining entry is evicted at capacity. Invalid-token promises remove themselves on failure.
* **Logout:** the normal browser flow calls `POST /v1/auth/session-end` before GoTrue sign-out. The server immediately evicts the hashed token and profile cache entries and adds the token hash to a bounded one-hour in-process revocation map, so that token cannot receive a cached or newly validated API response from that instance during the window.
* **Limit of this guarantee:** if the browser cannot reach `/v1/auth/session-end`, or the Render instance restarts/scales, an in-memory revocation record cannot be durable/global. GoTrue access-token revocation semantics then apply. This is not a new regression and cannot be made globally durable without shared state; the normal successful logout path is immediately evicted.
* **Frontend `getUser` grep:** `rg -n "getUser" frontend/` returned no matches.

### The 1 GB question: the supplied export proves a request-volume problem, not the billed byte total

`C:\Users\azsal\Downloads\supabase_logs (1).csv` contains 1,000 rows from 2026-09-29 12:58:59 to 17:31:58 (about 4 hours 33 minutes). It is dominated by Edge/API request logs (946 rows, 94.6%), not Postgres logs (54 rows, 5.4%). The top two paths are `/rest/v1/profiles` (418 rows) and `/auth/v1/user` (304 rows): together 722 rows, or 76.3% of the Edge/API rows. One 60-second burst at 12:59 contains 294 requests, including 116 profile requests and 95 Auth user validations; its busiest second contains 44 requests. This directly validates a burst/duplicate-call problem.

It still does **not** establish what created the approximately 1 GB billed ingestion total. The CSV is capped at 1,000 rows and its `event_message` values total only about 138 KB of text, not the platform's actual ingested-byte accounting. It may omit the billed spike, structured metadata, or a larger volume outside this window. Treat this patch as **evidence-backed request-volume hygiene, not a confirmed one-gigabyte fix**, until the following manual evidence is collected:

1. Dashboard → project → **Usage** / billing usage: record the log-ingestion graph at hourly granularity and determine whether the increase is a spike or a steady slope.
2. Dashboard → project → **Logs Explorer**: choose the exact spike hour (or a representative steady-state hour), group/filter by service—API Gateway, Auth, Postgres, Realtime, Storage, Edge Functions—and export/count the top three by bytes, not only lines.
3. In the top service, filter its largest request/path/message field, save three representative rows, and compare them with this code's known paths.
4. Deploy this patch only after capturing a baseline; repeat the same one-hour sample after deployment. If Auth/API Gateway remains large, the cache reduction is working only as hygiene and the sampled producer becomes the next target.

The defensible answer is: **duplicate Auth/profile requests are the dominant producer in this exported window and the patch targets them, but the cause of the full 1 GB billing total remains unproven.**

## Files changed

| File | Change |
|---|---|
| `frontend/js/supabase-auth.js` | Caches the current browser session in memory, shares concurrent session reads, updates it on Supabase Auth state changes/refresh, and clears it on forced expiry. |
| `frontend/js/script.js` | Reuses `ACEAuth.session()` and changes visible-tab presence to a 90-second heartbeat with a consistent four-minute online window. |
| `backend/server/index.js` | Coalesces and briefly caches GoTrue token validation (30 seconds) and profile lookup (5 seconds), with hashed bounded keys; persists a Google avatar once; removes Auth Admin all-user avatar sweep; replaces non-admin remarks ID-list filtering with a server-side joined filter; suppresses successful production Morgan request logs; removes startup success log. |

## What changed, in practical terms

### Auth and profile request collapse

`backend/server/index.js` now keeps a promise-aware cache keyed by bearer token for GoTrue validation (30 seconds) and by profile ID for the profile lookup (5 seconds). If an app initialization starts 6 protected requests concurrently, they now share one `/auth/v1/user` request and one `profiles` read instead of independently generating 6 of each.

This does not trust an unsigned browser claim: the first request still calls Supabase GoTrue. The short TTL is deliberately conservative so user status/role changes propagate quickly. Authentication failure evicts its cache entry immediately.

On the browser, `ACEAuth.session()` coalesces parallel `getSession()` calls and retains the current session until Supabase reports a session change or an explicit refresh succeeds. It does not add `getUser()` calls.

### Avatar enrichment

The API no longer calls `auth.admin.listUsers({ page: 1, perPage: 1000 })` for `/v1/users`, chat contacts, or leaderboard. That request was only a display fallback for an absent avatar URL, not authorization. Instead, on the first authenticated request for a profile that has no Cloudinary URL or public ID, the server validates the HTTPS Google avatar URL supplied by the authenticated GoTrue user and writes it once with a conditional `profile_picture_url is null` update. Concurrent requests share that persistence promise. Cloudinary uploads remain preferred because a stored custom image prevents this fallback.

### Remarks query

For non-admin users, `/v1/admin-remarks` now uses the `admin_remarks → time_entries` relationship and filters `time_entries.user_id` server-side. It no longer first retrieves all own entry IDs and places them in `time_entry_id=in.(...)` on the next PostgREST URL. The public endpoint and response remain the same.

### Presence and time-entry load

Presence is refreshed every 90 seconds while the tab is visible, rather than every 45 seconds. The chat online window is now four minutes everywhere it is calculated. That cuts heartbeat writes by 50% while allowing multiple missed heartbeats before a user appears offline. This does not affect authentication, clock state, or time-entry correctness.

The attempted “first page only” time-entry change was deliberately reverted. A full source review found that reports/exports, lifetime totals, project tracked time, historical search, and entry-detail links consume the complete `AppState.timeEntries` array. Serving only 50 records would have silently made several of those features incorrect. Proper pagination remains a follow-up design task requiring page-specific data sources or server-side aggregate/export endpoints.

### Logging

Morgan now skips production responses below HTTP 400. Errors and warnings remain logged. This reduces **Render log** volume only; it does not directly reduce Supabase log ingestion. Repeated cold-start progress `console.info` messages remain because they only occur during service recovery, not normal success paths.

## Expected impact, ranked

These are engineering estimates from the exported-log patterns and source behavior, not a replacement for a post-deploy Supabase usage measurement.

| Rank | Change | Expected reduction |
|---:|---|---|
| 1 | Backend auth/profile coalescing | For each parallel page-load burst of 4-6 protected requests: roughly **75-83% fewer** duplicate `/auth/v1/user` and current-profile requests. This directly targets the largest reported source. |
| 2 | 90-second presence heartbeat | **50% fewer** heartbeat requests/profile writes: 40/hour rather than 80/hour per visible tab. |
| 3 | Remove Auth Admin full user listing | **100% removal** of `auth/v1/admin/users?page=1&per_page=1000` from normal users, contacts, and leaderboard loads. Large payload/log lines disappear. |
| 4 | Joined remarks filter | **Eliminates the giant ID-list URL** and its preliminary IDs query for non-admin requests. It reduces log bytes sharply for that route; row-query cost depends on indexes/data shape. |
| 5 | Persist Google avatar once | Replaces repeated Admin API payloads and parallel avatar PATCHes with at most one conditional profile write per profile lacking a stored photo. |
| 6 | Morgan error-only production logging | Major reduction in Render request-log noise; **zero direct reduction** in Supabase ingestion. |
| — | Time-entry pagination | **Not shipped.** It was reverted because it caused correctness regressions in full-history consumers. |

Postgres checkpoint pairs are expected to be low-volume relative to repeated API/Auth URLs. They are not the cause of approximately 1 GB of ingestion in four hours; do not make them the first target.

## Manual Supabase actions

### First: inspect before changing anything

1. Open the target project in the [Supabase Dashboard](https://supabase.com/dashboard).
2. Open **SQL Editor** in the left navigation, select **New query**, and run this read-only query:

```sql
select
  name,
  setting,
  unit,
  context,
  reset_val,
  case
    when sourcefile = '/etc/postgresql-custom/custom-overrides.conf' then 'CLI/API override'
    else 'platform or role default'
  end as configuration_source
from pg_settings
where name in (
  'log_min_messages',
  'log_statement',
  'log_checkpoints',
  'log_connections',
  'log_disconnections',
  'log_duration',
  'log_min_duration_statement',
  'log_lock_waits',
  'log_autovacuum_min_duration',
  'cron.log_statement'
)
order by name;

select rolname, rolconfig
from pg_roles
where rolname in ('postgres', 'anon', 'authenticated', 'service_role');
```

3. Open **Logs** / **Logs Explorer** in the left navigation and filter by the relevant service (Auth, API Gateway, Postgres). Compare bytes/counts before and after deployment. The billing/usage surface differs by dashboard version; do not assume the SQL log settings explain Auth/API Gateway ingestion.

### SQL changes: optional and not the main fix

Run these only in **Dashboard → Project → SQL Editor → New query**, after recording the current output above:

```sql
-- Optional: excludes WARNING/NOTICE/LOG messages for new postgres-role sessions.
-- This may hide useful operational warnings. It does not reduce Auth/API Gateway logs.
alter role postgres set log_min_messages = 'error';

-- Optional: stops postgres-role statement-class logging.
-- Supabase's documented default is already 'ddl', so this may produce no material saving.
alter role postgres set log_statement = 'none';
```

Verify role overrides in a new SQL Editor tab:

```sql
select rolname, rolconfig
from pg_roles
where rolname = 'postgres';
```

Rollback:

```sql
alter role postgres reset log_min_messages;
alter role postgres reset log_statement;
```

Do **not** run these merely because they were requested: they only affect sessions using the configured role and do not turn off the high-volume Auth/API logs caused by duplicate HTTPS requests. Supabase documents `log_min_messages` default as `warning` and `log_statement` default as `ddl`; neither is evidence of a one-gigabyte ingestion problem by itself. [Supabase Postgres log configuration](https://supabase.com/docs/guides/database/postgres/postgres-log-config)

### `log_checkpoints`, connections, and other platform configuration

There is no documented point-and-click Dashboard page for these settings and they are not changeable with `ALTER ROLE`. Supabase documents them as **Management API + CLI** settings. They are platform-managed at SQL level, not necessarily unavailable on Free: the documentation states Owner/Administrator organization permission is required and does not specify a Free-plan exclusion. Confirm eligibility in your dashboard/CLI; do not guess.

If you choose to use the CLI manually, first obtain the project ref from the dashboard project URL/settings and create a personal access token at **Dashboard → avatar menu → Account → Access Tokens**. Then, on your own machine:

```bash
supabase login
supabase postgres-config update \
  --project-ref YOUR_PROJECT_REF \
  --experimental \
  --config log_checkpoints=false,log_connections=false,log_disconnections=false
```

This command is **optional**. My recommendation:

* `log_checkpoints=false`: allowed by documented CLI/API configuration, but **do not change it first**. Checkpoint pairs every 5-15 minutes are low-volume and useful for diagnosing disk/WAL pressure.
* `log_connections=false` and `log_disconnections=false`: verify first. Supabase says new projects default both to false. If your exported logs prove either is true and you do not have a compliance/audit requirement, turn it off. Connection lifecycle logging has no benefit for this app's normal operation.
* `log_statement=none`: SQL-configurable as shown above, but first check whether it is already `ddl`; likely little/no gain for normal REST traffic.
* `log_duration=false`, `log_min_duration_statement=-1`, `log_lock_waits=true`, `log_autovacuum_min_duration=10min`, `cron.log_statement=true`: inspect before changing. Do not suppress lock waits or autovacuum evidence merely to save logs. Only consider disabling `cron.log_statement` if you use `pg_cron` and logs prove it noisy; this repository does not demonstrate that it does.
* Search the database functions for `RAISE NOTICE`/`RAISE LOG` before tuning global logging. No such source was found in this repository's SQL, but the live schema could differ.

Supabase's current log-ingestion guidance specifically says to turn off connection/disconnection logs if unneeded, but says checkpoint-related settings are generally low-volume and should usually be left alone. [Supabase log-ingest guidance](https://supabase.com/docs/guides/platform/manage-your-usage/logs-ingest) Connection logging defaults off for new projects; verify rather than assuming. [Supabase connection logging](https://supabase.com/docs/guides/platform/postgres-connection-logging)

To inspect/remove a CLI/API override later:

```bash
supabase postgres-config delete \
  --project-ref YOUR_PROJECT_REF \
  --experimental \
  --config log_checkpoints,log_connections,log_disconnections
```

## Verification results

* `npm test`: **103 passed, 0 failed**. `git diff --stat -- backend/tests` is empty: no test files are changed and no tests were deleted or weakened.
* `npm run test:security`: **passed**.
* Production frontend build: **passed** with a non-secret placeholder `ACE_API_URL=https://api.example.test`; the build correctly requires a public API URL and no production credential was used.
* No live Supabase test was run. After deployment, use the Dashboard Logs Explorer to verify request counts/bytes over a comparable test session, then compare log-ingestion usage over at least several hours.

## Deliberately not changed

* **Clock-in/out implementation:** untouched. The existing transactional database RPCs remain exactly as they were.
* **Database/Auth provider/Render hosting:** untouched, per request.
* **RLS or database log settings:** not changed without credentials and not altered as a blind response to API/Auth request volume.
* **Cross-instance SSE and rate-limit state:** unrelated to Supabase log ingestion at current scale.
* **A new cache service, Redis, queue, or frontend rewrite:** unnecessary. The in-process coalescing caches are adequate for collapsing concurrent requests on this single Render instance; they are intentionally short-lived and reversible.
