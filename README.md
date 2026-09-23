# ACE Clock In/Out

ACE Clock In/Out is a role-based time-tracking workspace for administrators and employees. It has a static frontend, a Node.js API, and Supabase for authentication and data.

## What the project currently includes

- Secure employee clock-in/clock-out, breaks, time-entry notes, and remarks.
- Administrator tools for users, invitations, access requests, departments, projects, schedules, reports, audit history, deleted records, and employee chat logs.
- Role-specific onboarding tutorials: 20 steps for administrators and 4 steps for employees.
- A role-specific **Need help** center with searchable FAQ answers, so users can find one task without restarting an entire tutorial.
- Profile photos through Cloudinary when its environment variables are configured.
- Invitation delivery through Gmail API when configured, with Gmail SMTP as a fallback. Access is still created if delivery fails, and the UI shows a clear delivery warning.
- Production-friendly frontend builds with minified, hashed assets.

## Architecture

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Frontend | Static HTML, CSS, and browser JavaScript | Dashboard, role-specific navigation, tutorial, help center, forms, reports, and responsive UI |
| API | Node.js, Express | Authentication-aware API, validation, invitations, mail delivery, reporting, audit/security rules |
| Data and auth | Supabase | Auth users, profiles, clock records, projects, departments, schedules, and app data |
| Media | Cloudinary | Optional uploaded profile photos |
| Hosting | Render | Static Site for the built frontend and Web Service for the API |

## Project structure

```text
frontend/             Static pages, browser JavaScript, styles, images, icons, and headers
backend/
  server/              Express API entry point
  tests/               Automated API, onboarding, and frontend-contract tests
scripts/               Build, security, database, and maintenance tools
supabase/              Database schema, migrations, and upgrade scripts
deliverables/          Final presentation files kept for handoff
dist/                  Generated production frontend (ignored by Git)
```

The root keeps only shared configuration, documentation, package files, and deployment settings. The temporary Codex presentation/finalizer work folders are intentionally not part of the project.

## Requirements

- Node.js 20 or later
- A Supabase project with the migrations in `supabase/MIGRATION_ORDER.md` applied
- A Supabase secret/service key for the API (never expose it in the frontend)

Optional integrations:

- Cloudinary for profile photos
- Gmail API or Gmail SMTP for invitation email delivery

## Local setup

1. Install dependencies:

   ```bash
   npm ci
   ```

2. Copy `.env.example` to `.env` and provide the required values:

   ```env
   PORT=3000
   NODE_ENV=development
   FRONTEND_ORIGIN=http://localhost:5500

   SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   SUPABASE_SECRET_KEY=sb_secret_...
   SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   HEAD_ADMIN_EMAIL=admin@example.com
   ```

3. Apply the database migrations in the documented order:

   ```bash
   npm run db:verify
   ```

4. Start the API:

   ```bash
   npm run dev
   ```

5. Serve the project folder with a local static server, such as VS Code Live Server. The frontend needs the API available at `http://localhost:3000` unless `ACE_API_URL` is supplied when building.

## Frontend build and preview

The production frontend is generated into `dist/`; it is intentionally not committed.

```bash
set ACE_API_URL=https://your-api.onrender.com
npm run build
npm run preview:build
```

The build validates the API URL, minifies JavaScript and CSS, fingerprints assets for cache-safe deploys, copies static files, and writes the generated page references. A production build must use the real API URL.

## Tests and verification

```bash
npm test
npm run test:security
npm run test:security:integration
npm run test:concurrency
npm run db:verify
```

`npm test` is the normal local test suite. The security and concurrency commands are additional checks for deployments where the relevant Supabase configuration is available.

## Render deployment

### API Web Service

The API service is defined by `render.yaml`.

- Build command: `npm install`
- Start command: `npm start`
- Health check: `/health`
- Environment: Node 20+

Set the required Supabase values, `HEAD_ADMIN_EMAIL`, and `FRONTEND_ORIGIN` to the exact deployed frontend origin. Configure Cloudinary and email variables only when those features are needed.

### Frontend Static Site

The frontend Static Site is configured in the Render dashboard rather than `render.yaml`.

- Build command: `npm ci && npm run build`
- Publish directory: `dist`
- Environment variable: `ACE_API_URL=https://your-api.onrender.com`

Do not point `ACE_API_URL` to the frontend URL. It must be the public URL of the Node API service.

## Invitation email setup

The server tries Gmail API first when all Gmail API values are present. If Gmail API is unavailable, it can fall back to SMTP.

### Recommended: Gmail API

```env
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...
GMAIL_FROM=company@example.com
```

Use a Google Cloud OAuth client and a refresh token authorized for Gmail sending. On a Google OAuth app left in testing mode, refresh-token access can expire; publish the consent screen when the account and business policy allow it.

### SMTP fallback

```env
SMTP_USER=company@gmail.com
SMTP_APP_PASSWORD=the16characterapppasswordwithoutspaces
SMTP_FROM=company@gmail.com
SMTP_PORT=587
```

For Gmail, create an App Password after enabling two-step verification. Use port `587` with TLS. Render commonly cannot reach Gmail on port `465`, so port `587` is the intended fallback configuration.

Never commit an app password, OAuth secret, refresh token, Supabase secret key, or Cloudinary secret.

## Tutorial and help center

- The tutorial persists each user’s progress in their profile and resumes after navigation or refresh.
- Cross-page tutorial steps ask the user to use the actual sidebar; they continue automatically after the requested page is opened.
- The tutorial adapts when the sidebar is collapsed or expanded and points to the relevant visible control.
- **Need help** is available from the top bar for administrators and employees. It provides searchable, role-specific answers for one-off questions.

See `ONBOARDING.md` for authoring and reset details.

## Database changes

See `supabase/MIGRATION_ORDER.md` before creating a new Supabase project, upgrading an existing database, or re-offering the tutorial.

## Security notes

- Keep API credentials only in API environment variables.
- The browser uses only the Supabase publishable key and the API public URL.
- CORS is restricted through `FRONTEND_ORIGIN` in production.
- Sensitive endpoints are rate-limited, authenticated, and validated by the API.
- Use the managed delete/archive screens rather than manually removing authentication records.
