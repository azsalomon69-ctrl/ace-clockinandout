# ACE Clock In/Out

ACE Clock In/Out is a workforce time-tracking and management system built for ACE Outsource Solutions.

The system gives employees a simple way to clock in and out, view their time records, manage their profile, and communicate with administrators. Administrators can manage employees, schedules, projects, time entries, reports, and other workforce operations from the admin side of the application.

## Features

### Employee

- Clock in and clock out
- View current working status and time
- View personal time entries
- View assigned projects and schedules
- View admin remarks
- Manage profile and account settings
- Update profile information and photo
- Communicate with administrators
- Access employee help and onboarding
- View workforce information available to the employee

### Administrator

- View current employee activity
- Manage employees
- Invite employees
- Manage departments
- Manage projects
- Assign projects and schedules
- Manage employee schedules
- Review and manage time entries
- Handle authorized time-entry corrections
- Manage overtime-related records
- Archive and restore employee accounts
- View reports and individual employee reports
- Export data
- Review audit logs
- Manage employee remarks
- Use administrator chat and management tools
- Access administrator onboarding and help

## Technology

ACE uses a lightweight web stack built around standard web technologies and managed services.

- HTML
- CSS
- JavaScript
- Node.js
- Express
- Supabase Auth
- PostgreSQL
- Google OAuth
- Render
- Cloudinary
- Gmail API / SMTP

The general architecture is:

```text
Browser
   |
   v
Frontend
   |
   v
Node.js / Express API
   |
   +---- Supabase Auth
   |
   +---- PostgreSQL
   |
   +---- Email services
   |
   +---- Cloudinary
```

The frontend is responsible for the user interface and browser-side application behavior. The API handles authentication, authorization, application logic, and communication with the database and external services.

## Project Structure

```text
ACE-clockinandout/
│
├── backend/
│   ├── server/
│   │   └── index.js
│   └── tests/
│
├── frontend/
│   ├── css/
│   │   └── app.css
│   ├── js/
│   │   ├── script.js
│   │   ├── supabase-auth.js
│   │   ├── admin-sections.js
│   │   ├── onboarding.js
│   │   ├── onboarding-config.js
│   │   ├── schedule-flex.js
│   │   ├── individual-reports.js
│   │   ├── employee-profile.js
│   │   ├── deleted-users.js
│   │   ├── deleted-time-entries.js
│   │   ├── chat-log.js
│   │   └── sidebar.js
│   └── ...
│
├── scripts/
│   ├── build-frontend.js
│   ├── security-regression-check.js
│   ├── security-integration.staging.js
│   ├── verify-database-contract.js
│   └── seed-admin.js
│
├── supabase/
│   ├── migrations/
│   ├── schema.sql
│   └── current-production-upgrade.sql
│
├── deliverables/
│
├── .env.example
├── .env.test.example
├── .gitignore
├── package.json
├── package-lock.json
├── render.yaml
└── README.md
```

## Frontend

The frontend is built with HTML, CSS, and JavaScript.

Shared application behavior is primarily handled through JavaScript modules. The main application logic is in `frontend/js/script.js`, with additional modules for administration, authentication, onboarding, schedules, reports, employee profiles, chat, and other application areas.

Authentication-related browser functionality is handled by:

```text
frontend/js/supabase-auth.js
```

The onboarding system is handled by:

```text
frontend/js/onboarding-config.js
frontend/js/onboarding.js
```

The frontend is built into a production-ready `dist` directory through the project's build process.

## Backend

The backend is a Node.js and Express application.

The main server is:

```text
backend/server/index.js
```

The API handles the application's server-side functionality, including:

- Authentication
- Authorization
- Employee profiles
- Invitations
- Departments
- Projects
- Schedules
- Project assignments
- Time entries
- Reports
- Remarks
- Chat
- Notifications
- Audit logs
- Employee account management
- Presence

Protected operations are handled by the API rather than trusting information supplied by the browser.

## Database

ACE uses PostgreSQL through Supabase.

The database stores the application's workforce data, including:

- Employee profiles
- Time entries
- Departments
- Projects
- Schedules
- Project assignments
- Invitations
- Remarks
- Chat messages
- Notifications
- Audit records
- Tutorial progress

Important operations use database functions and transactional operations where consistency is important.

Database changes are maintained under:

```text
supabase/migrations/
```

## Authentication

ACE uses Supabase Auth for authentication and supports Google OAuth.

The application uses authenticated user information together with the user's application profile to determine access to protected features.

The main application roles are:

```text
USER
ADMIN
```

Administrator-only functionality is protected by server-side authorization.

## Time Tracking

Clocking is handled by the backend and database.

When an employee clocks in, an active time-entry record is created. When the employee clocks out, the end timestamp is recorded and the completed duration is calculated from the stored timestamps.

The timer displayed in the browser is primarily a user-interface representation of the active session. Recorded working time is based on the stored time-entry data.

This keeps time records independent from the browser remaining open continuously.

## Reports and Records

Time-entry information is used for:

- Employee history
- Dashboard statistics
- Project totals
- Administrative review
- Individual reports
- Workforce reporting
- Data exports
- Audit and correction workflows

Historical time records are retained so that previous work can continue to be reviewed and reported.

Schedule information associated with time entries is also preserved where required for historical reporting.

## Onboarding and Help

ACE includes separate onboarding experiences for employees and administrators.

The onboarding system provides guided instructions for using the application's main features.

Tutorial progress is maintained for individual users and their application role.

The application also includes searchable help for commonly used features.

Tutorial content is separated from the underlying tutorial engine, making it possible to update instructions and targets without rebuilding the entire system.

## Security

Security is handled across the application rather than relying on the frontend alone.

The system uses:

- Supabase authentication
- Server-side authorization
- PostgreSQL constraints
- Database functions
- Row-level security where applicable
- CORS controls
- Security headers
- Content Security Policy
- API rate limiting
- Input validation
- Audit logging
- Protected administrative operations

Sensitive credentials are kept outside the frontend and are not intended to be committed to the repository.

Environment files containing credentials are excluded from Git.

## Local Development

Install the project dependencies:

```bash
npm ci
```

Create a local `.env` file using `.env.example` as the configuration reference.

Start the backend in development mode:

```bash
npm run dev
```

The API uses the configured `PORT` value and defaults to port `3000`.

For a local frontend build:

```powershell
$env:ACE_API_URL = 'http://localhost:3000'
npm run build
npm run preview:build -- --listen 5500
```

The frontend origin used locally should be configured in the backend environment.

Use development or staging credentials when working locally. Production credentials should not be placed in local development files.

## Environment Configuration

The project provides:

```text
.env.example
.env.test.example
```

These files describe the configuration required for development and testing.

Configuration includes values for:

- Supabase
- Application environment
- Frontend/API URLs
- Authentication
- Invitations
- Email
- Cloudinary
- Testing

Actual credentials should be supplied through the appropriate environment configuration and should never be committed to Git.

## Testing

The project includes automated tests covering application behavior, security checks, authentication, onboarding, reporting, and other areas of the application.

Run the main test suite:

```bash
npm test
```

Run the security checks:

```bash
npm run test:security
```

Build the frontend:

```bash
npm run build
```

Additional testing and verification scripts are available under:

```text
scripts/
backend/tests/
```

Some tests require a configured test or staging environment.

## Deployment

The backend is configured for deployment through Render.

The frontend is built into the `dist` directory and can be deployed as a static site.

The deployment architecture is:

```text
User
  |
  v
Frontend
  |
  v
Render API
  |
  v
Supabase
```

The backend deployment configuration is maintained in:

```text
render.yaml
```

The exact production configuration is managed through the hosting provider and environment configuration.

## Development Notes

The repository contains application source code, database migrations, tests, build scripts, and project documentation.

Generated build files should be produced through the project's build process rather than manually edited.

Secrets and credentials should never be committed.

Changes involving authentication, permissions, employee records, time tracking, database functions, and audit behavior should be tested carefully because they affect core application functionality and workforce records.

## Documentation

This README contains the general documentation for ACE Clock In/Out, including the application's purpose, features, architecture, setup, development structure, testing, and deployment.
