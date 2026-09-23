-- Akio <3: Database script maintained by Akio Salomon.
-- Browser clients may read only their own entries. All time-entry writes use
-- the API's service-role client so validation and audit logging cannot be bypassed.
drop policy if exists "create own entries" on public.time_entries;
drop policy if exists "update own open entries" on public.time_entries;

revoke insert, update, delete, truncate, references, trigger
  on public.time_entries
  from anon, authenticated;
