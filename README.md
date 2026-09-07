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
7. Set `window.ACE_API_URL` in `js/api-config.js` to your Render URL before your Vercel deployment.

If you need to promote a different administrator later, use SQL Editor:

```sql
update public.profiles
set role = 'ADMIN', status = 'ACTIVE'
where email = 'your-admin-email@example.com';
```

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
2. Set the framework preset to **Other** and leave the build command empty; this is a static frontend.
3. Deploy. Vercel uses `vercel.json` for safe response headers.
4. Add the deployed Vercel URL to Render's `FRONTEND_ORIGIN` and Supabase Auth redirect URLs.

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
