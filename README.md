# ACE Clock In/Out

Time tracking web app with a static frontend for Vercel, a Node.js API for Render, and Supabase for authentication and Postgres.

## Architecture

- **Vercel:** the HTML/CSS/JS frontend in this repository.
- **Render:** `server/index.js`, the protected Node.js/Express API.
- **Supabase:** Auth, Postgres database, invitations, and Row Level Security.

The database model is in [supabase/schema.sql](supabase/schema.sql). It implements the supplied flow diagram: profiles/users, invitations, approvals, departments, projects, user-project assignments, time entries, remarks, audit logs, reports, and report exports.

## Local setup

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env` and enter your Supabase project URL, publishable key, and **secret key**.
3. In Supabase SQL Editor, run `supabase/schema.sql` once. For an existing project created from an earlier version, run `supabase/current-production-upgrade.sql` once afterward. If Google sign-in shows “Database error saving new user”, run `supabase/auth-profile-trigger-fix.sql` once to repair the Auth profile trigger.
4. Run `npm install` and then `npm run dev`.
5. Serve the frontend files with a local static server. Configure `FRONTEND_ORIGIN` with that server's address.

## Supabase setup

1. Create a new Supabase project.
2. Run `supabase/schema.sql` in SQL Editor. If the project already existed before this version, run `supabase/current-production-upgrade.sql` afterward instead of re-running the base schema.
3. Under **Authentication → Providers**, enable Google if Google sign-in is required.
4. Add your Vercel production URL and local development URL under **Authentication → URL Configuration**.
5. Copy the Project URL, publishable key, and a server-only `sb_secret_...` key into Render. Do not put the secret key in Vercel or any browser JavaScript.
6. Run `npm run seed:admin` locally once after SQL setup. It creates only `ace@admin.com` and delegates password hashing to Supabase Auth. Set its password through `INITIAL_ADMIN_PASSWORD` in `.env`.
7. Set `ACE_API_URL` or `ACE_API_URL_FALLBACK` before building the frontend. The build generates the browser's `window.ACE_API_URL` configuration; do not create or edit `js/api-config.js` manually.

If you need to promote a different administrator later, use SQL Editor:

```sql
update public.profiles
set role = 'ADMIN', status = 'ACTIVE'
where email = 'your-admin-email@example.com';
```

## Staging security integration tests

The automated integration suite is deliberately separate from normal development and production credentials. Create a dedicated staging Supabase project plus isolated `ADMIN` and `USER` accounts, then copy `.env.test.example` to `.env.test` in the repository root (the same folder as `package.json`) and fill in the values there. `.env.test` is explicitly ignored by Git and is loaded automatically by the test command.

Run:

```bash
npm run test:security:integration
```

The suite uses real HTTP requests to verify that unauthenticated requests receive `401`, a real USER receives `403` for admin reads and mutations, and a real ADMIN succeeds for normal admin reads. It also verifies forged client role claims, invalid bearer tokens, inactive-account denial when an optional inactive fixture is supplied, and optional resource-ID mutation attempts. It never prints access tokens, passwords, cookies, or secrets.

By default it performs only safe reads plus denied-request checks. Set `ACE_TEST_RUN_MUTATIONS=true` only for an isolated staging environment with the supplied fixture IDs; that mode creates a test remark and briefly assigns then removes a test project assignment.

## GitHub

Create an empty GitHub repository, then run these commands from this folder:

```bash
git init
git add .
git commit -m "Build ACE Clock In/Out API foundation"
git branch -M main
git remote add origin https://github.com/YOUR-ACCOUNT/YOUR-REPOSITORY.git
git push -u origin main
```

Do not commit `.env` or Supabase secret keys.

## Deploy the API to Render

1. In Render, choose **New → Blueprint** and select the GitHub repository. Render will find `render.yaml`.
2. Add the required environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_SECRET_KEY`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `FRONTEND_ORIGIN` — your Vercel URL, for example `https://ace-clock.vercel.app`
3. Deploy, then confirm `https://YOUR-RENDER-SERVICE.onrender.com/health` returns `{ "ok": true }`.

## Deploy the frontend to Vercel

1. In Vercel, import the same GitHub repository.
2. Set the framework preset to **Other** and set the build command to `npm run build`. Vercel deploys the generated `dist` directory configured in `vercel.json`, not the readable source HTML, CSS, or JavaScript files.
3. In **Project Settings → Environment Variables**, set both values for each deployment environment:
   - `ACE_API_URL` — the primary HTTPS API base URL for that environment.
   - `ACE_API_URL_FALLBACK` — the current production API base URL, used only when `ACE_API_URL` is unset.
   The build uses `ACE_API_URL` first, then `ACE_API_URL_FALLBACK`; it fails clearly if neither exists. The CSP API origin remains hardcoded in `vercel.json`; if the API host changes, update both the Vercel environment variables and that `connect-src` origin.
4. Deploy. The production build minifies HTML, CSS, and JavaScript; uses hashed frontend asset filenames; and deliberately creates no source maps.
5. Add the deployed Vercel URL to Render's `FRONTEND_ORIGIN` and Supabase Auth redirect URLs.

## Local browser dependencies

The production build bundles the exact Supabase UMD dependency (`@supabase/supabase-js` `2.112.4`) and Excel export dependency (`xlsx` `0.18.5`) as hashed `/assets/js/` files. Browser authentication and Excel exports therefore do not depend on jsDelivr or another third-party runtime script host.

`script-src` currently allows `'unsafe-inline'` because the HTML uses inline event handlers (such as `onclick`). A future task should migrate these to `addEventListener` and then remove `'unsafe-inline'`.

## Schedule compliance specification

This section defines the schedule-compliance rules for the planned implementation. All scheduled-time comparisons use the `Asia/Manila` timezone.

### Definitions

- `duration_seconds` is the existing net-work duration: elapsed clock time minus recorded `break_seconds`.
- `elapsed_seconds = duration_seconds + break_seconds`.
- `target_seconds = daily_elapsed_minutes * 60`.
- All resulting seconds values are non-negative integers.

### Fixed schedules

For a `FIXED` schedule, `scheduled_start` is the schedule's start time on the entry's clock-in date in `Asia/Manila`.

- **Late:** `late_seconds = max(0, clock_in_at - scheduled_start)`. Late is strict: there is no grace period. Any clock-in after the scheduled start is late.
- **Undertime:** `undertime_seconds = max(0, target_seconds - elapsed_seconds)`.
- **Overtime / Above target:** `overtime_seconds = max(0, elapsed_seconds - target_seconds)`. It is informational only; it has no payroll, approval, or disciplinary meaning.
- **Break overage:** `break_overage_seconds = max(0, break_seconds - (break_limit_minutes * 60))`. It is an informational administrator indicator only. It is not included in undertime and does not dock worked time.

### Flextime schedules

For a `FLEX` schedule, there is no late classification because it has no scheduled start time.

- **Late:** not applicable; `late_seconds` is `null`.
- **Undertime:** `undertime_seconds = max(0, target_seconds - elapsed_seconds)`.
- **Overtime / Above target:** `overtime_seconds = max(0, elapsed_seconds - target_seconds)`. It is informational only; it has no payroll, approval, or disciplinary meaning.
- **Break overage:** `break_overage_seconds = max(0, break_seconds - (break_limit_minutes * 60))`. It is informational only and remains separate from undertime.

### Break-inclusive target example

The daily target is elapsed time, including breaks. For a nine-hour schedule with a one-hour break allowance, an employee who records eight hours of net work and one hour of break has nine elapsed hours:

```text
duration_seconds = 8 hours
break_seconds    = 1 hour
elapsed_seconds  = 9 hours
target_seconds   = 9 hours
undertime_seconds = 0
```

That employee is on target. The break is only flagged when it exceeds the configured break limit.

### No schedule assigned

An entry with no assigned schedule has the classification `NOT_APPLICABLE`. Its `late_seconds`, `undertime_seconds`, `overtime_seconds`, and `break_overage_seconds` are all `null`. It produces no employee penalty and no administrator alert.

## API routes

All `/v1/*` routes require a Supabase user access token in `Authorization: Bearer <token>`.

- `GET /v1/me`
- `POST /v1/access-requests`
- `GET|POST|PATCH /v1/departments`
- `GET|POST|PATCH /v1/projects`
- `GET /v1/users`, `PATCH /v1/users/:id/approval`
- `POST /v1/invitations`
- `GET /v1/time-entries`, `POST /v1/time-entries/clock-in`, `POST /v1/time-entries/:id/clock-out`
- `POST /v1/time-entries/:id/remarks`
- `GET|POST /v1/reports`, `POST /v1/reports/:id/exports`
- `GET /v1/audit-logs`

`database.json` and the frontend preview accounts have been removed. Login now uses Supabase Auth, and Request Access posts a real pending request to Supabase through the API.
