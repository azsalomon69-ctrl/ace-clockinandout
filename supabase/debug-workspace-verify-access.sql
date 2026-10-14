-- Read-only pre-deployment check for the isolated employee test workspace.
-- Expected: zero public foreign keys/grants, and true for service_role checks.
with debug_tables as (
  select c.oid
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'ace_debug' and c.relkind in ('r', 'p')
), debug_functions as (
  select p.oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'ace_debug' and p.prokind in ('f', 'p')
), foreign_keys as (
  select target_ns.nspname as target_schema
  from pg_constraint fk
  join pg_class source on source.oid = fk.conrelid
  join pg_namespace source_ns on source_ns.oid = source.relnamespace
  join pg_class target on target.oid = fk.confrelid
  join pg_namespace target_ns on target_ns.oid = target.relnamespace
  where fk.contype = 'f' and source_ns.nspname = 'ace_debug'
)
select
  (select count(*) from foreign_keys where target_schema = 'public') as foreign_keys_to_production,
  (select count(*) from debug_tables t
    where has_table_privilege('anon', t.oid, 'SELECT')
       or has_table_privilege('anon', t.oid, 'INSERT')
       or has_table_privilege('anon', t.oid, 'UPDATE')
       or has_table_privilege('anon', t.oid, 'DELETE')
       or has_table_privilege('authenticated', t.oid, 'SELECT')
       or has_table_privilege('authenticated', t.oid, 'INSERT')
       or has_table_privilege('authenticated', t.oid, 'UPDATE')
       or has_table_privilege('authenticated', t.oid, 'DELETE')) as browser_role_table_grants,
  (select count(*) from debug_functions f
    where has_function_privilege('anon', f.oid, 'EXECUTE')
       or has_function_privilege('authenticated', f.oid, 'EXECUTE')) as browser_role_function_grants,
  has_table_privilege('service_role', 'ace_debug.profiles', 'SELECT') as service_role_can_read_debug_profiles,
  has_function_privilege('service_role', 'ace_debug.ace_backend_contract()', 'EXECUTE') as service_role_can_call_contract;
