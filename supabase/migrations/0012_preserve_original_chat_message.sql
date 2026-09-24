-- Preserve the first version of a chat message for the restricted head-admin log.
-- Existing edited messages cannot be reconstructed because their prior text was
-- not retained before this migration.
alter table public.employee_messages
  add column if not exists original_body text;
