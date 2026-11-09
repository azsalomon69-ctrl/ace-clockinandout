-- Only the backend service role can access inquiries. The API additionally
-- checks the authenticated head-admin identity before returning any rows.
create table if not exists public.help_inquiries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  sender_name text not null default '',
  sender_email text not null,
  question text not null check (char_length(btrim(question)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists help_inquiries_created_at_idx on public.help_inquiries(created_at desc);
alter table public.help_inquiries enable row level security;
revoke all on public.help_inquiries from anon, authenticated;
grant select, insert on public.help_inquiries to service_role;
