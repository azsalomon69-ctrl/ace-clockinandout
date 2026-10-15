-- Persist each user's actual heartbeat time in one secure batch RPC.
begin;

create or replace function public.ace_flush_presence(p_presence jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  updated_count integer;
  session_to_lock record;
begin
  if pg_catalog.jsonb_typeof(p_presence) <> 'array' then
    raise exception 'PRESENCE_BATCH_MUST_BE_ARRAY' using errcode = '22023';
  end if;

  -- Sign-out takes FOR UPDATE on auth.sessions in ace_end_session. Taking
  -- KEY SHARE here serializes the batch against that transaction: whichever
  -- operation gets the session lock first commits first, so a pre-logout
  -- heartbeat cannot be written after sign-out has committed.
  for session_to_lock in
    select distinct incoming.session_id
    from pg_catalog.jsonb_to_recordset(p_presence) as incoming(user_id uuid, session_id uuid, last_seen_at timestamptz)
    where incoming.user_id is not null and incoming.session_id is not null and incoming.last_seen_at is not null
    order by incoming.session_id
  loop
    perform 1 from auth.sessions as session_row
    where session_row.id = session_to_lock.session_id
    for key share;
  end loop;

  with incoming as (
    select user_id, session_id, last_seen_at
    from pg_catalog.jsonb_to_recordset(p_presence) as row_data(user_id uuid, session_id uuid, last_seen_at timestamptz)
    where user_id is not null and session_id is not null and last_seen_at is not null
  )
  update public.profiles as profile
  set last_seen_at = incoming.last_seen_at
  from incoming
  where profile.id = incoming.user_id
    and profile.status = 'ACTIVE'
    and profile.permanently_deleted_at is null
    and (profile.last_seen_at is null or profile.last_seen_at < incoming.last_seen_at)
    and (profile.last_logout_at is null or incoming.last_seen_at > profile.last_logout_at)
    and exists (
      select 1 from auth.sessions as session_row
      where session_row.id = incoming.session_id
        and session_row.user_id = profile.id
        and (session_row.not_after is null or session_row.not_after > pg_catalog.now())
    )
    and not exists (
      select 1 from public.ace_revoked_sessions as revoked
      where revoked.session_id = incoming.session_id
    );

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.ace_flush_presence(jsonb) from public, anon, authenticated;
grant execute on function public.ace_flush_presence(jsonb) to service_role;

-- The isolated debug API uses the same RPC against its own schema when present.
do $$
begin
  if pg_catalog.to_regnamespace('ace_debug') is not null then
    execute $create_debug$
      create or replace function ace_debug.ace_flush_presence(p_presence jsonb)
      returns integer
      language plpgsql
      volatile
      security definer
      set search_path = ''
      as $body$
      declare updated_count integer; session_to_lock record;
      begin
        if pg_catalog.jsonb_typeof(p_presence) <> 'array' then
          raise exception 'PRESENCE_BATCH_MUST_BE_ARRAY' using errcode = '22023';
        end if;
        for session_to_lock in
          select distinct incoming.session_id
          from pg_catalog.jsonb_to_recordset(p_presence) as incoming(user_id uuid, session_id uuid, last_seen_at timestamptz)
          where incoming.user_id is not null and incoming.session_id is not null and incoming.last_seen_at is not null
          order by incoming.session_id
        loop
          perform 1 from auth.sessions as session_row
          where session_row.id = session_to_lock.session_id
          for key share;
        end loop;
        with incoming as (
          select user_id, session_id, last_seen_at
          from pg_catalog.jsonb_to_recordset(p_presence) as row_data(user_id uuid, session_id uuid, last_seen_at timestamptz)
          where user_id is not null and session_id is not null and last_seen_at is not null
        )
        update ace_debug.profiles as profile
        set last_seen_at = incoming.last_seen_at
        from incoming
        where profile.id = incoming.user_id
          and profile.status = 'ACTIVE'
          and profile.permanently_deleted_at is null
          and (profile.last_seen_at is null or profile.last_seen_at < incoming.last_seen_at)
          and (profile.last_logout_at is null or incoming.last_seen_at > profile.last_logout_at)
          and exists (
            select 1 from auth.sessions as session_row
            where session_row.id = incoming.session_id
              and session_row.user_id = profile.id
              and (session_row.not_after is null or session_row.not_after > pg_catalog.now())
          )
          and not exists (
            select 1 from ace_debug.ace_revoked_sessions as revoked
            where revoked.session_id = incoming.session_id
          );
        get diagnostics updated_count = row_count;
        return updated_count;
      end;
      $body$
    $create_debug$;
    execute 'revoke all on function ace_debug.ace_flush_presence(jsonb) from public, anon, authenticated';
    execute 'grant execute on function ace_debug.ace_flush_presence(jsonb) to service_role';
  end if;
end;
$$;

commit;
