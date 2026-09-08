-- Run once in Supabase SQL Editor before deploying the separate final-note field.
-- Existing clock-in notes are kept unchanged. New notes are limited to 50 characters.
begin;

alter table public.time_entries add column if not exists final_note text;
alter table public.time_entries drop constraint if exists time_entries_user_note_length;
alter table public.time_entries drop constraint if exists time_entries_final_note_length;
alter table public.time_entries
  add constraint time_entries_user_note_length check (user_note is null or char_length(user_note) <= 50) not valid,
  add constraint time_entries_final_note_length check (final_note is null or char_length(final_note) <= 50) not valid;

commit;
