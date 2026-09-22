# Editing the built-in tutorial

Tutorial copy lives in `js/onboarding-config.js`. The file has one object for
employees (`USER`) and one for administrators (`ADMIN`). Each object has a
`version` and a `steps` array.

Each step requires `page`, `target`, `title`, and `body`:

```js
{ page: 'user-dashboard.html', target: '#employeeStatusPanel', title: 'Your workday starts here', body: 'Use this panel to clock in, take a break, and clock out.' }
```

Use a stable element ID as `target`. When a target is intentionally unavailable,
the tour warns in the browser console and presents a centered step instead of
failing. To make a rewritten tutorial appear again automatically, increase that
role's `version`. To re-offer the current version to selected people, use the
SQL documented in `supabase/MIGRATION_ORDER.md`.
