-- Run manually after deleting the retired Render service and removing
-- ace_debug from Supabase Data API Exposed schemas / Extra search path.
-- Permanently deletes the test schema and its data. Keep any needed export first.
-- CASCADE also removes objects that depend on this schema: review dependencies
-- if you have added integrations outside the original isolated workspace.
-- Does not explicitly delete shared Auth users or production public tables.
begin;
drop schema if exists ace_debug cascade;
notify pgrst, 'reload schema';
commit;

-- Expected result: true.
select pg_catalog.to_regnamespace('ace_debug') is null as test_workspace_removed;
