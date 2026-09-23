-- Akio <3: Database script maintained by Akio Zaki Salomon.
-- Run once in Supabase SQL Editor for Cloudinary-hosted profile photos.
alter table public.profiles add column if not exists profile_picture_url text;
alter table public.profiles add column if not exists profile_picture_public_id text;
