# ACE Clock In/Out

ACE Clock In/Out is a role-based workforce time-tracking platform for ACE Outsource Solutions. Administrators manage people, access, projects, schedules, reports, exports, and operational history; employees clock in and out, review work history, and communicate with administrators.

It is designed as a production-minded web system rather than a single-page prototype: the browser UI, API, database, authentication service, media service, and deployment environment each have a clear job and security boundary.

## Why the infrastructure is strong

The system uses managed services for the difficult parts—identity, hosted data, TLS, deployment, and media—while application code owns business rules such as time-entry rules, administrator permissions, report generation, and onboarding guidance.

```text
Employee or administrator browser
        |
        | HTTPS + Supabase session token
        v
Render Static Site                         Supabase Auth
  - built HTML/CSS/JS                       - Google sign-in
  - browser security headers                - signed user sessions
        |                                            |
        | authenticated API request                  |
        v                                            v
Render Node/Express API  ---------------->  Supabase Postgres
  - validates token and role                  - application records
  - validates request data                    - Row Level Security
  - applies business rules                    - migrations and RPCs
  - rate limits sensitive actions
        |
        +--------------------+-----------------------+
        |                    |                       |
        v                    v                       v
  Gmail API / SMTP      Cloudinary             Audit and report data
  invitation delivery   profile images          inside Supabase
```

This separation is valuable because a frontend bug cannot automatically grant administrator privileges, the browser never receives the Supabase secret key, and database/account rules do not depend solely on what the UI chooses to display.

## What the application does

### Employee workspace

- Google-based sign-in and profile settings.
- Clock in and clock out with a required official clock-out note; full elapsed time is recorded from clock-in to clock-out.
- Project-aware time recording and assigned schedule support.
- Administrator remarks attached to relevant time entries.
- Employee/admin chat and accessible historical records.
- A guided onboarding tutorial and searchable **Need help** center.

### Administrator control center

- Invite employees or administrators and approve/deny access requests.
- Manage user status, roles, archived users, departments, projects, project assignments, and schedules.
- Review live team activity, time entries, corrections, approved overtime, remarks, reports, and individual reports.
- Receive review alerts for possible missed clock-outs and administrator-stopped shifts.
- Export time-entry data to PDF or Excel and review a dedicated export-audit history.
- Read paged audit logs and, for head administrators, employee chat logs.
- Guided onboarding and role-specific searchable help that covers the visible workspace features.

### Optional integrations

- **Gmail API** is the preferred invitation email path when configured.
- **Gmail SMTP** is a TLS fallback when Gmail API is not configured or unavailable.
- **Cloudinary** stores profile photos when its credentials are configured.

An invitation/access record is still created if email delivery fails; the administrator sees a clear warning instead of losing the underlying access action.

## Architecture

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Browser application | Static HTML, CSS, browser JavaScript | Responsive UI, dashboards, forms, tutorials, help center, local interaction state |
| API | Node.js 20 + Express | Authenticated business API, role checks, validation, reporting, invitations, audit handling, mail orchestration |
| Authentication | Supabase Auth | Google identity and signed user sessions |
| Database | Supabase Postgres | Profiles, time entries, projects, schedules, reports, messages, invitations, access requests, audit data |
| Media | Cloudinary | Optional profile photo hosting and signed uploads |
| API hosting | Render Web Service | Node process, HTTPS endpoint, environment-secret storage, health checks |
| Frontend hosting | Render Static Site | Built static assets, caching, security headers, HTTPS delivery |

## Request flow

1. A user signs in through Supabase Auth and receives a session token.
2. The frontend sends the token as `Authorization: Bearer ...` when it calls the API.
3. Express validates that token with Supabase before accepting protected work.
4. The API reads the user profile and enforces the action’s role and status rules.
5. The API validates input, executes the allowed database operation or RPC, and records relevant audit information.
6. The frontend receives only the result it needs; it never receives the Supabase secret/service key, mail secrets, or Cloudinary secret.

This is intentionally server-authoritative. Hiding a button in the UI is helpful for usability, but the API is the actual enforcement point.

## Security model

### Authentication and authorization

- Supabase validates user identity and signed sessions.
- The API checks each protected Bearer token server-side.
- Administrator-only endpoints require administrator authorization on the server.
- Active/inactive and archived-account rules are checked before actions are allowed.
- Safeguards prevent accidental removal, disabling, or demotion of the head/last active administrator.
- Supabase Row Level Security is enabled for primary application tables; direct authenticated access is limited to appropriate personal data such as a user’s own profile and time entries.

### API protections

- `helmet` sets API security headers.
- Production CORS permits only the configured `FRONTEND_ORIGIN`; an unconfigured production origin causes the API to refuse startup.
- JSON request bodies are limited to 1 MB.
- General `/v1` traffic is rate-limited to 600 requests per 15 minutes per visitor.
- Sensitive actions have a stricter 30 requests per 15 minutes limit.
- Request data is validated before records, reports, or administrative operations are created.
- Time-sensitive database operations use protected database functions where appropriate to reduce race conditions.

### Browser protections

The frontend deployment includes headers that:

- force HTTPS upgrades and set one-year HSTS;
- block embedding in another site (`X-Frame-Options: DENY` and `frame-ancestors 'none'`);
- block MIME sniffing;
- restrict camera, microphone, geolocation, payment, and USB browser permissions;
- use a Content Security Policy that loads scripts only from the application itself;
- restrict API connections to the ACE API, Supabase, and Cloudinary;
- disable automatic long-lived browser caching of pages so new releases are seen promptly.

User-supplied values rendered into the UI are escaped before being inserted into HTML, reducing cross-site-scripting risk.

### Secret handling

The following values belong only in Render environment variables or local untracked `.env` files:

- `SUPABASE_SECRET_KEY`
- Gmail client secret, refresh token, SMTP app password
- `CLOUDINARY_API_SECRET`
- initial administrator password and any testing passwords

The browser may receive the Supabase **publishable** key and public API URL. Those are designed to be public; the Supabase secret/service key is not.

Never commit secrets, paste them into issues, place them in screenshots, or put them in frontend JavaScript.

### Dependency and regression protection

- Production dependencies are checked with `npm audit`.
- The current production dependency audit reports zero known vulnerabilities after updating Morgan and moving Excel export to the official SheetJS `0.20.3` package.
- Automated regression checks ensure important routes retain administrator authorization, token validation, rate limits, production headers, and safe local frontend bundles.
- GitHub Dependabot can watch the public repository for future dependency alerts and updates.

Security is an ongoing process, not a one-time checkbox. Keep secrets private, review Dependabot alerts, apply updates deliberately, and rotate a secret immediately if it is exposed.

## Project structure

```text
frontend/                         Static source for the browser application
  css/                            Application styles and responsive rules
  js/                             API client, auth, page behavior, tutorial, help, search
  assets/                         Images, icons, fonts, and browser assets
  _headers                        Static-site security and caching headers
  *.html                          Role-specific pages
backend/
  server/index.js                 Express API entry point
  tests/                          API, onboarding, auth, and business-rule tests
scripts/                          Build, security, database verification, and setup tooling
supabase/                         Schema, migrations, RPCs, and upgrade documentation
deliverables/                     Final handoff/presentation materials
render.yaml                       Render API service definition
.env.example                      Safe environment-variable template only
dist/                             Generated production frontend; ignored by Git
```

The source is deliberately separated from generated output. `dist/` is rebuilt from `frontend/` for every deploy rather than manually edited or committed.

## Requirements

- Node.js 20 or later
- A Supabase project
- Supabase migrations applied in the order described by [`supabase/MIGRATION_ORDER.md`](supabase/MIGRATION_ORDER.md)
- A Supabase secret/service key for the API, stored privately

### Current database migration

Apply the numbered SQL migrations in [`supabase/MIGRATION_ORDER.md`](supabase/MIGRATION_ORDER.md). Existing deployments also need `supabase/migrations/0011_review_exports_and_reporting_indexes.sql`, which adds only performance indexes for paged lists, review alerts, reporting, audit history, and exports. It does not delete or modify existing records.

Optional:

- Cloudinary account for profile photos
- Gmail API OAuth configuration or Gmail SMTP app password for invitation delivery

## Local setup

1. Install exact locked dependencies:

   ```bash
   npm ci
   ```

2. Copy `.env.example` to `.env` and provide private values:

   ```env
   PORT=3000
   NODE_ENV=development
   FRONTEND_ORIGIN=http://localhost:5500

   SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   SUPABASE_SECRET_KEY=sb_secret_...
   SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   HEAD_ADMIN_EMAIL=admin@example.com
   ```

3. Confirm the configured database matches the expected contract:

   ```bash
   npm run db:verify
   ```

4. Start the API:

   ```bash
   npm run dev
   ```

5. Serve the root with a local static web server, such as VS Code Live Server. The browser uses `http://localhost:3000` by default unless a production API URL is supplied during build.

## Build pipeline

The frontend is built instead of shipped as raw source:

```bash
set ACE_API_URL=https://your-api.onrender.com
npm run build
npm run preview:build
```

The build validates the API URL, bundles required third-party browser libraries locally, minifies JavaScript/CSS/HTML, fingerprints assets with content hashes, rewrites page references, and copies static files/security headers into `dist/`.

Content-hashed assets mean a changed file receives a new filename, so a new release does not accidentally serve an old JavaScript or stylesheet file from cache.

## Testing and verification

```bash
npm test
npm run test:security
npm run test:security:integration
npm run test:concurrency
npm run db:verify
```

| Command | What it verifies |
| --- | --- |
| `npm test` | Auth recovery, permissions, tutorials, reports, head-admin safeguards, and business rules |
| `npm run test:security` | Security headers, protected administrator routes, token validation, rate limits, and no untrusted runtime bundles |
| `npm run test:security:integration` | Real staging API authorization behavior when test credentials are configured |
| `npm run test:concurrency` | Time-entry race-condition behavior against a configured test environment |
| `npm run db:verify` | Required Supabase tables, columns, functions, and configuration expectations |

Run the full local test and security checks before pushing or deploying. Run integration/concurrency checks against a safe staging/test environment, never casually against production.

## Render deployment

### API Web Service

The API service is defined in [`render.yaml`](render.yaml).

- Runtime: Node.js
- Plan configured: Render Free
- Build command: `npm install`
- Start command: `npm start`
- Health endpoint: `/health`

Set these required API variables in Render:

```text
NODE_ENV=production
SUPABASE_URL
SUPABASE_SECRET_KEY
SUPABASE_PUBLISHABLE_KEY
HEAD_ADMIN_EMAIL
FRONTEND_ORIGIN=https://your-frontend-domain
```

`FRONTEND_ORIGIN` must exactly match the real frontend origin. This is part of the CORS protection; do not use a placeholder or a free public domain if company policy requires an owned domain.

### Frontend Static Site

Configure the Render Static Site with:

```text
Build command: npm ci && npm run build
Publish directory: dist
Environment variable: ACE_API_URL=https://your-api.onrender.com
```

`ACE_API_URL` is the public URL of the **Node API service**, not the frontend website URL.

## Email delivery

The API tries Gmail API first when all Gmail API settings exist. If Gmail API is not configured or cannot send, SMTP can be used as a fallback.

### Recommended: Gmail API

```env
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...
GMAIL_FROM=company@example.com
```

Use a Google Cloud OAuth client authorized for Gmail sending. A Google OAuth consent screen left in testing mode can cause refresh-token access to expire; publish/verify the consent screen when business policy permits it.

### SMTP fallback

```env
SMTP_USER=company@gmail.com
SMTP_APP_PASSWORD=the16characterapppasswordwithoutspaces
SMTP_FROM=company@gmail.com
SMTP_PORT=587
```

For Gmail, enable two-step verification, create an App Password, and use port `587` with TLS. The server accepts the app password with or without Google’s visual spaces. Render often cannot reach Gmail port `465`, so port `587` is the intended SMTP setting.

## Tutorials and help center

- Tutorial progress is stored per user in their profile, so it can resume after navigation or refresh.
- Navigation steps teach users to use the actual sidebar rather than secretly redirecting them.
- The tutorial detects the sidebar’s expanded/collapsed state and points to the correct visible control.
- Administrators receive a 20-step role-specific guide; employees receive a focused four-step guide.
- **Need help** opens from the top bar and provides searchable, role-specific answers for one-off tasks without restarting the whole tutorial.

See [`ONBOARDING.md`](ONBOARDING.md) for authoring and reset details.

## Database changes and upgrades

Read [`supabase/MIGRATION_ORDER.md`](supabase/MIGRATION_ORDER.md) before creating a new Supabase project, upgrading an existing database, or resetting/re-offering tutorials.

Database changes should be additive and migration-based. Do not manually delete authentication users or production rows to “clean up” an issue; use the managed archive/delete flows or a reviewed migration so audit history and related records remain consistent.

## Operational checklist

Before making the repository public or deploying a major release:

- [ ] Confirm `.env` and test credential files are ignored and untracked.
- [ ] Confirm Render/Supabase contain real secrets; GitHub contains placeholders only.
- [ ] Confirm `FRONTEND_ORIGIN` and `ACE_API_URL` use the correct owned production domains.
- [ ] Run `npm test`, `npm run test:security`, and `npm run build`.
- [ ] Review Dependabot alerts and production `npm audit` output.
- [ ] Verify Supabase migrations/RLS are applied.
- [ ] Test administrator and employee flows with non-production test accounts.
- [ ] Verify invitation delivery with the chosen Gmail integration.

## License and ownership

Project source is maintained by **Akio Zaki Salomon** for ACE Outsource Solutions. Check the repository’s intended company licensing/usage policy before reusing it outside the organization.
