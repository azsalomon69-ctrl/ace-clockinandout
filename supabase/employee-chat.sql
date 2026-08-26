-- Run once in the Supabase SQL Editor before deploying employee chat.
create table if not exists public.employee_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  read_at timestamptz,
  constraint employee_messages_no_self_chat check (sender_id <> recipient_id)
);

create index if not exists employee_messages_conversation_idx
  on public.employee_messages (sender_id, recipient_id, created_at);
create index if not exists employee_messages_recipient_unread_idx
  on public.employee_messages (recipient_id, read_at) where read_at is null;

alter table public.employee_messages enable row level security;
alter table public.employee_messages add column if not exists edited_at timestamptz;
alter table public.employee_messages add column if not exists deleted_at timestamptz;
-- The Render API uses the server-only key and verifies both participants.
-- No browser-to-table policies are created, so messages remain private.
