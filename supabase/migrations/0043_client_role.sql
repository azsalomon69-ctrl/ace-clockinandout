-- STAGING ONLY. Run separately and finish this query before running 0044.
-- PostgreSQL requires the enum value to commit before it can be used.
alter type public.user_role add value if not exists 'CLIENT';
