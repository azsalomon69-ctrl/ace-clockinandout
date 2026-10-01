# Onboarding behavior checks

Run `node --test backend/tests/tutorial-behavior.test.js` for the actual tutorial route handlers with an in-memory Supabase storage double. Authentication supplies a verified fixture identity; it is not being tested here. The mock seeds post-migration data and does not execute migration SQL.

Run `node backend/tests/helpers/tutorial-fixture-server.mjs`, then open this URL in a real browser:

http://127.0.0.1:4179/runner?tests=proof,B1,B2,B3,B4,B4local,B6,B7,B8,B9,B10

Wait for `RUN FINISHED`. Every result must say PASS. Raw results are also available at `/results`. Run only one browser runner at a time; the server uses one fixture identity and in-memory store. Restart the server after changes to its imported helpers. No credentials or new packages are needed.

The browser runs production tutorial scripts against real page HTML/CSS, real focus, layout, navigation and localStorage. The fixture replaces authentication, API storage, navigation setup and unrelated application loading. Selected production clock, schedule, chat-launcher and row-action rendering fragments populate deterministic scenarios. This verifies tutorial behavior, not a full deployed application or live Supabase journey.

| Test | Behavior |
| --- | --- |
| proof | Real input focus, visible geometry, full document navigation and retained localStorage |
| B1/B2 | Employee/admin welcome, role-specific lessons, completion and second login |
| B3 | Skip and second login for each role |
| B4 | Employee completion, promotion, admin completion, return to employee |
| B4local | Pending employee skip stays isolated from admin across promotion and recovery |
| B5 (Node) | Immediate GET observes acknowledged PATCH progress, both roles |
| B6 | Offline skip, completion and resume survive reload and synchronize, both roles |
| B7 | Start from Settings begins with the first lesson, both roles |
| B8 | Profile field retains real browser focus while a lesson is open, both roles |
| B9 | Clocked-in target, assigned/unassigned schedule, visible chat launcher |
| B10 | Empty user/entry/audit tables and protected first user still have visible targets |

`backend/tests/onboarding.test.js` remains primarily a source/configuration contract suite. Passing it alone is not browser journey evidence.

Migration 0025 must be applied before deploying the updated API. See `supabase/MIGRATION_ORDER.md` for attribution, legacy-local-storage impact and rollback limitations. These offline tests do not validate SQL execution, database grants/RLS, real sessions or hosted deployment.
