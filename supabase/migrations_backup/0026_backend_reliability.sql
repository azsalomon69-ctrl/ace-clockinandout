-- Apply only after isolated tests and an approved database rollout.
-- Does not modify clock records. Deploy the matching API after this migration.
begin;
set local lock_timeout = '5s';
lock table public.profiles in share row exclusive mode;

-- A conditional UPDATE of one counter serializes competing removals without
-- relying on a stale SELECT count(*) snapshot. All profile write paths participate.
create table public.ace_admin_invariant (
 singleton boolean primary key default true check(singleton),
 active_count integer not null check(active_count >= 0)
);
insert into public.ace_admin_invariant
select true, count(*) from public.profiles
where role='ADMIN' and status='ACTIVE' and permanently_deleted_at is null;
alter table public.ace_admin_invariant enable row level security;
revoke all on public.ace_admin_invariant from public, anon, authenticated, service_role;

create function public.ace_guard_last_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
declare before_count integer := 0; after_count integer := 0; delta integer;
begin
 if TG_OP <> 'INSERT' then
   before_count := case when old.role='ADMIN' and old.status='ACTIVE' and old.permanently_deleted_at is null then 1 else 0 end;
 end if;
 if TG_OP <> 'DELETE' then
   after_count := case when new.role='ADMIN' and new.status='ACTIVE' and new.permanently_deleted_at is null then 1 else 0 end;
 end if;
 delta := after_count-before_count;
 if delta <> 0 then
   update public.ace_admin_invariant set active_count=active_count+delta
   where singleton and (delta>0 or active_count>1);
   if not found then raise exception 'LAST_ACTIVE_ADMIN' using errcode='P0001'; end if;
 end if;
 if TG_OP='DELETE' then return old; end if;
 return new;
end;
$$;
revoke all on function public.ace_guard_last_admin() from public, anon, authenticated, service_role;
create trigger ace_guard_last_admin after insert or update or delete on public.profiles
for each row execute function public.ace_guard_last_admin();

create table public.ace_revoked_sessions (
 session_id uuid primary key references auth.sessions(id) on delete cascade,
 revoked_at timestamptz not null default now()
);
alter table public.ace_revoked_sessions enable row level security;
revoke all on public.ace_revoked_sessions from public, anon, authenticated, service_role;

-- One request obtains fresh profile permissions and durable session state.
create function public.ace_session_profile(p_user_id uuid, p_session_id uuid)
returns public.profiles language sql stable security definer set search_path = '' as $$
 select p.* from public.profiles p
 join auth.sessions s on s.user_id=p.id and s.id=p_session_id
 join auth.users u on u.id=p.id
 where p.id=p_user_id and p.permanently_deleted_at is null
 and (s.not_after is null or s.not_after>now())
 and (u.banned_until is null or u.banned_until<now())
 and not exists(select 1 from public.ace_revoked_sessions r where r.session_id=s.id);
$$;

create function public.ace_end_session(p_user_id uuid, p_session_id uuid, p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 perform 1 from auth.sessions where id=p_session_id and user_id=p_user_id for update;
 if not found then return; end if;
 insert into public.ace_revoked_sessions(session_id) values(p_session_id) on conflict do nothing;
 if not found then return; end if;
 update public.profiles set last_logout_at=now() where id=p_user_id;
 insert into public.audit_logs(user_id,action,entity_type,entity_id,description,request_id)
 values(p_user_id,'LOGOUT','PROFILE',p_user_id,'Signed out successfully',p_request_id);
end;
$$;

create function public.ace_invite_with_audit(
 p_actor_user_id uuid, p_email text, p_role public.user_role,
 p_department_id uuid, p_head_admin_email text, p_request_id uuid
) returns public.invitations language plpgsql security definer set search_path = '' as $$
declare actor public.profiles; target public.profiles; invite public.invitations;
begin
 if p_email is null or p_email<>lower(btrim(p_email)) or length(p_email)>254 or p_role is null then
   raise exception 'INVALID_INVITATION' using errcode='P0001';
 end if;
 -- Concurrent invitations for one email share a transaction-scoped lock.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_email, 826));
 select * into actor from public.profiles where id=p_actor_user_id for update;
 if not found or actor.role<>'ADMIN' or actor.status<>'ACTIVE' or actor.permanently_deleted_at is not null then
   raise exception 'ACTIVE_ADMIN_REQUIRED' using errcode='P0001';
 end if;
 select * into target from public.profiles where lower(email)=p_email and permanently_deleted_at is null for update;
 if found and lower(target.email)=lower(p_head_admin_email) and lower(actor.email)<>lower(p_head_admin_email) then
   raise exception 'HEAD_ADMIN_PROTECTED' using errcode='P0001';
 end if;
 select * into invite from public.invitations where lower(email)=p_email and status='PENDING' and expires_at>now()
 order by invited_at desc limit 1 for update;
 if invite.id is not null and target.id is null then
   raise exception 'INVITATION_EXISTS' using errcode='P0001';
 end if;
 if invite.id is null then
   update public.invitations set status='EXPIRED' where lower(email)=p_email and status='PENDING' and expires_at<=now();
   insert into public.invitations(invited_by_user_id,email,role,department_id)
   values(p_actor_user_id,p_email,p_role,p_department_id) returning * into invite;
 end if;
 if target.id is not null then
   -- Re-inviting an archived account also restores its Auth ban atomically.
   update auth.users set banned_until=null where id=target.id;
   if not found then raise exception 'AUTH_ACCOUNT_NOT_FOUND' using errcode='P0001'; end if;
   update public.profiles set status='ACTIVE',role=p_role,department_id=p_department_id where id=target.id;
   update public.invitations set status='ACCEPTED',accepted_at=now(),role=p_role,department_id=p_department_id
   where id=invite.id returning * into invite;
 end if;
 insert into public.audit_logs(user_id,action,entity_type,entity_id,description,request_id)
 values(p_actor_user_id,'PREAUTHORIZE_GOOGLE_ACCOUNT','INVITATION',invite.id,
   format('Pre-authorized %s as %s',p_email,p_role),p_request_id);
 return invite;
end;
$$;

create function public.ace_backend_contract() returns integer
language sql stable security definer set search_path='' as $$ select 26; $$;
revoke all on function public.ace_session_profile(uuid,uuid), public.ace_end_session(uuid,uuid,uuid),
 public.ace_invite_with_audit(uuid,text,public.user_role,uuid,text,uuid),public.ace_backend_contract() from public,anon,authenticated;
grant execute on function public.ace_session_profile(uuid,uuid), public.ace_end_session(uuid,uuid,uuid),
 public.ace_invite_with_audit(uuid,text,public.user_role,uuid,text,uuid),public.ace_backend_contract() to service_role;
commit;
