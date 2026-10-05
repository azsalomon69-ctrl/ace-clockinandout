import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

// Direct Google authentication. Used by the isolated local auth preview only;
// production index.js does not register these routes.

export const hash = value => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('base64url');
export const challenge = value => createHash('sha256').update(value).digest('base64url');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function transaction(pool, work) {
  const client = await pool.connect();
  try { await client.query('begin'); const result = await work(client); await client.query('commit'); return result; }
  catch (error) { await client.query('rollback'); throw error; }
  finally { client.release(); }
}
export function validateGoogleClaims(claims, nonce) {
  if (!claims || !equal(claims.nonce, nonce) || claims.email_verified !== true || typeof claims.sub !== 'string' || !claims.sub || typeof claims.email !== 'string' || !claims.email) {
    throw new Error('Invalid Google identity');
  }
  // Google is authoritative for Gmail and verified Workspace-domain emails.
  // Third-party email addresses need an additional email-verification flow.
  if (!claims.email.toLowerCase().endsWith('@gmail.com') && !(typeof claims.hd === 'string' && claims.hd && claims.email.toLowerCase().endsWith('@' + claims.hd.toLowerCase()))) throw new Error('Unverified email authority');
  return { sub: claims.sub, email: claims.email.toLowerCase(), name: String(claims.name || '').slice(0, 200),
    picture: typeof claims.picture === 'string' && claims.picture.startsWith('https://') ? claims.picture.slice(0, 2048) : null };
}
export async function resolveGoogleProfile(pool, identity, { headAdminEmail, bootstrapHeadAdmin = false }) {
  return transaction(pool, async client => {
    await client.query('select pg_advisory_xact_lock(572381, 2)');
    const known = await client.query(`select p.* from public.google_identities g join public.profiles p on p.id=g.profile_id where g.google_sub=$1 for update of p`, [identity.sub]);
    if (known.rows.length) {
      const profile = known.rows[0];
      if (profile.status !== 'ACTIVE' || profile.permanently_deleted_at) throw new Error('account_inactive');
      if (profile.email.toLowerCase() !== identity.email) throw new Error('email_changed');
      return profile;
    }
    const invitation = await client.query(`select * from public.invitations where lower(email)=$1 and status='PENDING' and expires_at>now() order by invited_at desc limit 1 for update`, [identity.email]);
    const existing = await client.query('select * from public.profiles where lower(email)=$1 and permanently_deleted_at is null for update', [identity.email]);
    const empty = (await client.query('select not exists(select 1 from public.profiles) as empty')).rows[0].empty;
    const bootstrap = bootstrapHeadAdmin && empty && identity.email === headAdminEmail;
    if (!bootstrap && !invitation.rows.length) throw new Error('invitation_required');
    if (existing.rows.length) throw new Error('identity_link_required');
    const invite = invitation.rows[0];
    const { rows: [profile] } = await client.query(`insert into public.profiles(email,full_name,profile_picture_url,role,status,department_id)
      values($1,$2,$3,$4,'ACTIVE',$5) returning *`, [identity.email, identity.name, identity.picture, bootstrap ? 'ADMIN' : invite.role, invite?.department_id || null]);
    await client.query('insert into public.google_identities(profile_id,google_sub) values($1,$2)', [profile.id, identity.sub]);
    if (invite) await client.query("update public.invitations set status='ACCEPTED',accepted_at=now() where id=$1", [invite.id]);
    await client.query(`insert into public.audit_logs(user_id,action,entity_type,entity_id,description) values($1,$2,'PROFILE',$1,$3)`,
      [profile.id, bootstrap ? 'BOOTSTRAP_HEAD_ADMIN' : 'ACCEPT_INVITATION', bootstrap ? 'Initialized Green head administrator' : 'Accepted invitation through Google sign-in']);
    return profile;
  });
}
export function createGoogleAuth(pool, env = process.env, oauthClient) {
  for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'GREEN_FRONTEND_URL', 'HEAD_ADMIN_EMAIL']) {
    if (!env[key]) throw new Error(`Missing ${key} for Green Google authentication`);
  }
  const frontend = new URL(env.GREEN_FRONTEND_URL);
  const redirect = new URL(env.GOOGLE_REDIRECT_URI);
  const local = env.NODE_ENV === 'development' && env.GOOGLE_AUTH_LOCAL_TEST === 'true' &&
    frontend.origin === 'http://localhost:5500' && redirect.origin === 'http://localhost:3000';
  if ((!local && (frontend.protocol !== 'https:' || redirect.protocol !== 'https:')) || frontend.username || frontend.password || redirect.username || redirect.password ||
      frontend.pathname !== '/' || frontend.search || frontend.hash || redirect.pathname !== '/v1/auth/google/callback' || redirect.search || redirect.hash) {
    throw new Error('Invalid Green authentication URLs');
  }
  // A mistaken Blue origin must fail closed before any identity writes.
  if (frontend.hostname === 'aceclock.onrender.com' || redirect.hostname === 'ace-clockinandout.onrender.com') throw new Error('Blue cannot be used for Green authentication');
  const cookieName = local ? 'ace_local_oauth' : '__Host-ace_green_oauth';
  const cookieOptions = { httpOnly: true, secure: !local, sameSite: 'lax', path: '/', maxAge: 600_000 };
  const google = oauthClient || new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirect.href);
  const headAdminEmail = env.HEAD_ADMIN_EMAIL.trim().toLowerCase();
  const readUser = async token => {
    if (!/^aceg_[A-Za-z0-9_-]{43}$/.test(token || '')) throw new Error('Invalid or expired session');
    const { rows } = await pool.query(`select p.id,p.email,p.full_name,p.profile_picture_url from public.app_sessions s
      join public.profiles p on p.id=s.profile_id where s.token_hash=$1 and s.expires_at>now() and p.status='ACTIVE' and p.permanently_deleted_at is null`, [hash(token)]);
    if (!rows.length) throw new Error('Invalid or expired session');
    return { ...rows[0], user_metadata: { full_name: rows[0].full_name, avatar_url: rows[0].profile_picture_url } };
  };
  const revoke = token => pool.query('delete from public.app_sessions where token_hash=$1', [hash(token || '')]);
  return { readUser, revoke, config: { provider: 'google' }, register(app, limiter) {
    app.get('/v1/auth/google/start', limiter, async (req, res, next) => {
      try {
        const clientChallenge = req.query.challenge;
        if (typeof clientChallenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(clientChallenge)) return res.status(400).json({ error: 'Missing sign-in challenge' });
        const state = random(), cookie = random(), nonce = random(), verifier = random();
        await transaction(pool, async client => {
          await client.query('delete from public.oauth_attempts where expires_at < now()');
          await client.query('delete from public.login_handoffs where expires_at < now()');
          await client.query('delete from public.app_sessions where expires_at < now()');
          await client.query(`insert into public.oauth_attempts(state_hash,cookie_hash,nonce,verifier,client_challenge,expires_at)
            values($1,$2,$3,$4,$5,now()+interval '10 minutes')`, [hash(state), hash(cookie), nonce, verifier, clientChallenge]);
        });
        res.set('Cache-Control', 'no-store');
        res.cookie(cookieName, cookie, cookieOptions);
        res.redirect(google.generateAuthUrl({ scope: ['openid', 'email', 'profile'], state, nonce,
          code_challenge: challenge(verifier), code_challenge_method: 'S256', prompt: 'select_account' }));
      } catch (error) { next(error); }
    });
    app.get('/v1/auth/google/callback', limiter, async (req, res) => {
      res.set('Cache-Control', 'no-store');
      res.set('Referrer-Policy', 'no-referrer');
      res.clearCookie(cookieName, { ...cookieOptions, maxAge: undefined });
      try {
        const cookie = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
        if (!cookie || typeof req.query.state !== 'string' || typeof req.query.code !== 'string' || req.query.error) throw new Error('signin_failed');
        const { rows: [attempt] } = await pool.query(`delete from public.oauth_attempts where state_hash=$1 and cookie_hash=$2 and expires_at>now() returning *`, [hash(req.query.state), hash(cookie)]);
        if (!attempt) throw new Error('signin_failed');
        const { tokens } = await google.getToken({ code: req.query.code, codeVerifier: attempt.verifier, redirect_uri: redirect.href });
        const ticket = await google.verifyIdToken({ idToken: tokens.id_token, audience: env.GOOGLE_CLIENT_ID });
        const identity = validateGoogleClaims(ticket.getPayload(), attempt.nonce);
        const profile = await resolveGoogleProfile(pool, identity, { headAdminEmail, bootstrapHeadAdmin: env.GREEN_BOOTSTRAP_HEAD_ADMIN === 'true' });
        const code = random();
        await pool.query(`insert into public.login_handoffs(code_hash,profile_id,client_challenge,expires_at) values($1,$2,$3,now()+interval '60 seconds')`, [hash(code), profile.id, attempt.client_challenge]);
        res.redirect(`${frontend.origin}/login#ace_code=${code}`);
      } catch (error) {
        const safe = ['invitation_required', 'account_inactive', 'identity_link_required', 'email_changed'].includes(error.message) ? error.message : 'signin_failed';
        console.warn(`Green Google sign-in rejected: ${safe}`);
        res.redirect(`${frontend.origin}/login#ace_error=${safe}`);
      }
    });
    app.post('/v1/auth/google/exchange', limiter, async (req, res, next) => {
      res.set('Cache-Control', 'no-store');
      if (req.get('origin') !== frontend.origin) return res.status(403).json({ error: 'Invalid sign-in origin' });
      const { code, verifier } = req.body || {};
      if (![code, verifier].every(v => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v))) return res.status(400).json({ error: 'Invalid sign-in exchange' });
      try {
        const session = await transaction(pool, async client => {
          const { rows: [handoff] } = await client.query(`delete from public.login_handoffs where code_hash=$1 and client_challenge=$2 and expires_at>now() returning *`, [hash(code), challenge(verifier)]);
          if (!handoff) return null;
          const { rows: [profile] } = await client.query("select id from public.profiles where id=$1 and status='ACTIVE' and permanently_deleted_at is null for update", [handoff.profile_id]);
          if (!profile) return null;
          const token = `aceg_${random()}`;
          const { rows: [row] } = await client.query(`insert into public.app_sessions(token_hash,profile_id,expires_at) values($1,$2,now()+interval '7 days') returning expires_at`, [hash(token), profile.id]);
          return { access_token: token, expires_at: Math.floor(new Date(row.expires_at).getTime() / 1000), user: { id: profile.id } };
        });
        if (!session) return res.status(401).json({ error: 'Sign-in expired. Please try again.' });
        res.json({ session });
      } catch (error) { next(error); }
    });
    app.post('/v1/auth/google/logout', async (req, res, next) => {
      try { await revoke(req.headers.authorization?.replace(/^Bearer\s+/i, '') || ''); res.status(204).end(); }
      catch (error) { next(error); }
    });
  } };
}
