-- Akio <3: Database script maintained by Akio Salomon.
-- Keep access-request defaults aligned with the API's 24-hour review window.
alter table public.access_requests
  alter column expires_at set default now() + interval '24 hours';
