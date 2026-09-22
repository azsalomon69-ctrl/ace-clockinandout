# Editing the built-in tutorial

Tutorial copy lives in `js/onboarding-config.js`. The file has one object for
employees (`USER`) and one for administrators (`ADMIN`). Each object has a
`version` and a `steps` array.

The current employee tour is version `2` with four steps. The administrator
tour is version `3` with twenty steps. It covers the dashboard, invitations
and access approvals, people and organization setup, schedules, time-entry
review and restoration, reporting, audit history, and administrator settings.
The employee remarks page is not part of the linear tour because it is empty
until an administrator adds a note.

Each step requires `page`, `target`, `title`, and `body`:

```js
{ page: 'user-dashboard.html', target: '#mainClockInBtn', title: 'Start your shift', body: 'Start your shift here. Clock out and breaks live in the same place.' }
```

Use a stable element ID as `target`. When a target is intentionally unavailable,
the tour warns in the browser console and presents a centered step instead of
failing. To make a rewritten tutorial appear again automatically, increase that
role's `version`. To re-offer the current version to selected people, use the
SQL documented in `supabase/MIGRATION_ORDER.md`.
