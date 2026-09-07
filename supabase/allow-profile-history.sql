-- Run this once in Supabase SQL Editor when Google sign-in reports:
-- duplicate key value violates unique constraint "profiles_email_key".
--
-- It preserves all historical profiles and work records. Supabase Auth user
-- IDs remain unique; only the legacy one-profile-per-email restriction is
-- removed so a person whose prior login was permanently removed can sign in
-- again with Google and receive a new active profile.

alter table public.profiles drop constraint if exists profiles_email_key;
