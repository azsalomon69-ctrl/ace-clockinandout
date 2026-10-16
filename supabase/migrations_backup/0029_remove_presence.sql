-- Deploy the API without presence tracking before applying this migration.
-- Retire only presence data; login/logout auditing and session revocation remain.
begin;
drop function if exists public.ace_flush_presence(jsonb);
alter table public.profiles drop column if exists last_seen_at;
commit;
