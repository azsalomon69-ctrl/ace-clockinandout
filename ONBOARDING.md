# Built-in tutorial and help center

The workspace has two separate support experiences:

- The **tutorial** teaches the first-time workflow in a guided sequence and remembers progress for each user.
- **Need help** provides searchable, role-specific answers for a single task. Users should use it when they do not need to repeat the entire tutorial.

## Current tutorial versions

| Role | Version | Steps | Purpose |
| --- | ---: | ---: | --- |
| Employee (`USER`) | 3 | 4 | Starting a shift, time entries, current status, and settings |
| Administrator (`ADMIN`) | 4 | 20 | Dashboard, people/access workflows, work setup, reporting, administration, and settings |

## Source files

- `frontend/js/onboarding-config.js` defines the role-specific steps, headings, copy, routes, selectors, and version numbers.
- `frontend/js/onboarding.js` renders the popover, stores progress through the API, follows route changes, and adapts the tutorial to the live sidebar state.
- `frontend/js/script.js` owns the shared shell, sidebar controls, and the Need help center.

## How navigation steps behave

The tutorial does not silently send someone to another page. When a step requires another page, it tells the user what to open and waits for that navigation. Once the correct page is reached, it continues automatically.

Tutorial guidance is based on the current interface state:

- When the sidebar is collapsed, the popover points to the real sidebar expand arrow and tells the user to open it.
- When it is expanded, the popover points to the actual destination in the sidebar.
- Admin tutorials account for the **People** and **Work** sidebar groups being collapsed or expanded.
- Employee tutorials use the employee sidebar structure, which has direct Work links rather than the admin’s People/Work dropdown groups.
- If a user closes the sidebar while a navigation step is active, the tutorial re-checks the state and changes its target back to the visible expand arrow.

The popover must point at a real, clickable interface element whenever one is available. Do not add a duplicate “open sidebar” action inside the tutorial card.

## Restarting a tutorial

Restart is available from the profile menu. It resets the signed-in user to the first step for their role and then guides them back to the appropriate dashboard through the live sidebar. It does not force a page change behind the user’s back.

## Editing the tutorial

1. Update the appropriate role’s steps in `frontend/js/onboarding-config.js`.
2. Keep instructions specific to what a user can actually see and click.
3. Use a concrete selector only for a control that exists on every relevant screen state. Cross-page steps should use the navigation guidance flow instead.
4. If users who already completed the changed tutorial should receive it again, increase that role’s version number.
5. Test at desktop and mobile widths, with the sidebar both open and closed. For admin routes, also test the People and Work groups both collapsed and expanded.
6. Run `npm test` before deployment.

Changing a tutorial’s wording without changing behavior does not require a version increase. Change the version only when users need to see the new or corrected steps.

## Tutorial state in Supabase

The `profiles` table stores:

- `tutorial_status` — for example `NOT_STARTED`, `IN_PROGRESS`, `COMPLETED`, or `SKIPPED`
- `tutorial_step` — zero-based position in the current role’s tour
- `tutorial_version` — version of the tour last assigned to that user
- `tutorial_started_at`, `tutorial_completed_at`, and `tutorial_skipped_at`

Use the reset SQL in `supabase/MIGRATION_ORDER.md` to re-offer a tour to selected users or an entire role.

## Need help center

Need help is opened from the top bar and is available to both roles. It contains separate employee and administrator answers, plus search that filters by question, answer, and keywords.

When adding or correcting an answer:

1. Verify the workflow in the current UI first; do not infer a route or button name.
2. State the exact role, sidebar group, page, and button where that matters.
3. Explain any prerequisite, such as an employee needing an assigned project before it appears at clock-in.
4. Keep the answer focused on the task; it should not tell the user to restart the tutorial unless a full walkthrough is genuinely needed.
5. Test the search using words a real user is likely to type.

The help center is intentionally client-side and does not save a user’s search text or FAQ activity.
