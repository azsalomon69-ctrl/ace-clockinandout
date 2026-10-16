# Remove the retired test workspace

1. In Render, open the service named `ace-clock-debug-workspace` and verify its URL is `ace-clock-debug-workspace.onrender.com`. Delete this service through its Settings page. Keep the production API and `aceclock.onrender.com` frontend. If a separate test static site exists, remove only that test site too.
2. If the service is Blueprint-managed, remove its definition from the linked branch's `render.yaml` and sync that Blueprint before deleting the service. Removing YAML alone does not delete the service; leaving it defined can recreate it on sync. Do not introduce a Blueprint for a dashboard-managed service.
3. Remove test-only environment variables from any retained service or shared environment group: `ACE_DEBUG_MODE`, `SUPABASE_DB_SCHEMA` when set to `ace_debug`, and `ACE_ADMIN_WORKSPACE_URL`. Keep production Supabase keys and the production `ACE_API_URL` / `FRONTEND_ORIGIN`. Remove only test origins from allowlists.
4. In Supabase, open Project Settings > Data API. Remove `ace_debug` from Exposed schemas and from Extra search path if listed; save. Keep `public` and other production schemas. Do this BEFORE dropping the schema to avoid breaking the API schema cache.
5. Export any test records you still want. In SQL Editor run `supabase/remove-test-workspace.sql`. This permanently removes the test schema; CASCADE removes dependent objects as well. If custom production objects were made dependent on test objects, review them before running it.
6. In Authentication > URL Configuration, remove only redirects pointing to the retired test URL. Keep the production Site URL and redirects. Do not delete the shared administrator Auth user: the workspace used the same login as production.
7. Confirm the SQL returns `test_workspace_removed = true`, the test Render service is gone, and production login and clock-in pages still work.

The missing production `public.ace_revoked_sessions` table is a separate issue. Dropping the test schema does not create or repair production session-security objects.

Sources:
- https://render.com/docs/infrastructure-as-code#deleting-resources
- https://supabase.com/docs/guides/troubleshooting/postgrest-error-pgrst002-could-not-query-the-database-for-the-schema-cache-c396e9
