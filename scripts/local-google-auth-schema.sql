-- Minimal auth test fixture, NOT a clock-app migration or production schema.
-- The local runner checks the database destination and initializes only an empty DB.
create table public.local_auth_preview_version (version integer primary key);
insert into public.local_auth_preview_version values (1);
create table public.profiles (
 id uuid primary key default gen_random_uuid(), email text not null,
 full_name text not null default '', profile_picture_url text,
 role text not null check(role in ('USER','ADMIN')),
 status text not null check(status in ('ACTIVE','PENDING','DENIED')),
 department_id uuid, permanently_deleted_at timestamptz
);
create unique index local_profile_email on public.profiles(lower(email)) where permanently_deleted_at is null;
create table public.invitations (
 id uuid primary key default gen_random_uuid(), email text not null,
 role text not null check(role in ('USER','ADMIN')), department_id uuid,
 status text not null default 'PENDING', invited_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '7 days', accepted_at timestamptz
);
create table public.google_identities (
 google_sub text primary key, profile_id uuid not null unique references public.profiles(id)
);
create table public.oauth_attempts (
 state_hash text primary key, cookie_hash text not null, nonce text not null,
 verifier text not null, client_challenge text not null, expires_at timestamptz not null
);
create table public.login_handoffs (
 code_hash text primary key, profile_id uuid not null references public.profiles(id),
 client_challenge text not null, expires_at timestamptz not null
);
create table public.app_sessions (
 token_hash text primary key, profile_id uuid not null references public.profiles(id), expires_at timestamptz not null
);
create table public.audit_logs (
 id uuid primary key default gen_random_uuid(), user_id uuid references public.profiles(id),
 action text not null, entity_type text not null, entity_id uuid, description text,
 created_at timestamptz not null default now()
);
create index local_oauth_expiry on public.oauth_attempts(expires_at);
create index local_handoff_expiry on public.login_handoffs(expires_at);
create index local_session_expiry on public.app_sessions(expires_at);
