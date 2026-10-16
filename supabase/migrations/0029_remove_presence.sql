-- Deploy the API without presence tracking before applying this migration.
-- Retire only presence data; login/logout auditing and session revocation remain.
begin;
drop function if exists public.ace_flush_presence(jsonb);
alter table public.profiles drop column if exists last_seen_at;
do $$
begin
  if pg_catalog.to_regnamespace('ace_debug') is not null then
    execute 'drop function if exists ace_debug.ace_flush_presence(jsonb)';
    execute 'alter table ace_debug.profiles drop column if exists last_seen_at';
  end if;
end;
$$;
commit;
