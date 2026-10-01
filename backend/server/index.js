// Akio <3: Project source maintained by Akio Zaki Salomon.
import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { createHash, createPublicKey, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import { v2 as cloudinary } from 'cloudinary';
import nodemailer from 'nodemailer';

const required = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY'];
const missing = required.filter(name => !process.env[name]);
if (missing.length) throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
});
const cloudinaryConfigured = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'].every(key => Boolean(process.env[key]));
if (cloudinaryConfigured) cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET, secure: true });
const app = express();
const chatSubscribers = new Map();
const authUserCache = new Map();
const profileCache = new Map();
const avatarPersistenceCache = new Map();
const revokedTokenCache = new Map();
const referenceDataCache = new Map();
const pendingPresence = new Map();
let supabaseJwksCache = { keys: new Map(), expiresAt: 0, refresh: null };
const cacheMaxEntries = 500;
const referenceDataTtlMs = 15 * 60 * 1000;
const cached = (cache, key, ttlMs, loader) => {
  const now = Date.now();
  for (const [expiredKey, value] of cache) if (value.expiresAt <= now) cache.delete(expiredKey);
  const existing = cache.get(key);
  if (existing && existing.expiresAt > now) return existing.promise;
  if (cache.size >= cacheMaxEntries) cache.delete(cache.keys().next().value);
  const promise = Promise.resolve().then(loader).catch(error => { cache.delete(key); throw error; });
  cache.set(key, { promise, expiresAt: now + ttlMs });
  return promise;
};
const tokenCacheKey = token => createHash('sha256').update(token).digest('base64url');
const revokeToken = tokenKey => {
  const now = Date.now();
  for (const [expiredKey, expiresAt] of revokedTokenCache) if (expiresAt <= now) revokedTokenCache.delete(expiredKey);
  if (revokedTokenCache.size >= cacheMaxEntries) revokedTokenCache.delete(revokedTokenCache.keys().next().value);
  revokedTokenCache.set(tokenKey, now + 60 * 60 * 1000);
};
const clearReferenceData = prefix => {
  for (const key of referenceDataCache.keys()) if (key.startsWith(prefix)) referenceDataCache.delete(key);
};
const queuePresence = userId => pendingPresence.set(userId, Date.now());
const flushPresence = async userIds => {
  const ids = userIds || [...pendingPresence.keys()];
  if (!ids.length) return;
  const snapshots = new Map(ids.map(id => [id, pendingPresence.get(id)]));
  // A shared timestamp allows this to remain one PostgREST UPDATE instead of
  // one write per heartbeat. It is presence bookkeeping, never clock data.
  await query(db.from('profiles').update({ last_seen_at: new Date().toISOString() }).in('id', ids));
  for (const [id, queuedAt] of snapshots) if (pendingPresence.get(id) === queuedAt) pendingPresence.delete(id);
};
const presenceFlushTimer = setInterval(() => {
  flushPresence().catch(error => console.error('presence flush failed:', error.message));
}, 5 * 60 * 1000);
presenceFlushTimer.unref();
const publishChatEvent = (userId, detail) => {
  const subscribers = chatSubscribers.get(userId);
  if (!subscribers) return;
  const payload = `event: chat\ndata: ${JSON.stringify(detail)}\n\n`;
  subscribers.forEach(response => response.write(payload));
};
const publishAdminChatEvent = async detail => {
  // Notification delivery is an enhancement, never a reason to fail the
  // completed action that caused it. Each open administrator stream is private.
  try {
    const admins = await query(db.from('profiles').select('id').eq('role', 'ADMIN').eq('status', 'ACTIVE').is('permanently_deleted_at', null));
    admins.forEach(admin => publishChatEvent(admin.id, detail));
  } catch (error) { console.warn('Could not publish administrator notification.', error.message); }
};
const frontendOrigins = (process.env.FRONTEND_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean);
if (process.env.NODE_ENV === 'production' && !frontendOrigins.length) {
  throw new Error('FRONTEND_ORIGIN is required in production');
}
// This service is an API, not an embeddable document.  Keep the header policy
// explicit so API responses cannot be framed or interpreted as active content.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginResourcePolicy: false
}));
app.use(cors({
  origin(origin, callback) {
    // Browser requests must come from an explicitly configured frontend. A
    // request without an Origin header is a non-browser/server request.
    if (!origin || frontendOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed'));
  },
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-ID'],
  maxAge: 600
}));
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  const supplied = req.get('x-request-id');
  req.requestId = isUuid(supplied) ? supplied.toLowerCase() : randomUUID();
  res.set('X-Request-ID', req.requestId);
  next();
});
morgan.token('request-id', req => req.requestId || '-');
app.use(morgan(process.env.NODE_ENV === 'production' ? ':remote-addr :method :url :status :res[content-length] - :response-time ms request_id=:request-id' : 'dev request_id=:request-id', {
  skip: (_req, res) => process.env.NODE_ENV === 'production' && res.statusCode < 400
}));
// Render is a reverse-proxy deployment. Trusting its first proxy hop gives
// rate limiting the actual visitor address instead of the proxy address.
app.set('trust proxy', 1);
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' }
});
const sensitiveActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' }
});
app.use('/v1', apiLimiter);
app.use('/v1/auth/config', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many configuration requests. Please try again later.' }
}));

const smtpUser = process.env.SMTP_USER?.trim();
// Google displays app passwords in grouped blocks. Whitespace is not part of
// the password, so accepting either the grouped or ungrouped form prevents a
// common Render configuration mistake.
const smtpAppPassword = process.env.SMTP_APP_PASSWORD?.replace(/\s/g, '');
const smtpConfigured = Boolean(smtpUser && smtpAppPassword);
const gmailClientId = process.env.GMAIL_CLIENT_ID?.trim();
const gmailClientSecret = process.env.GMAIL_CLIENT_SECRET?.trim();
const gmailRefreshToken = process.env.GMAIL_REFRESH_TOKEN?.trim();
const gmailConfigured = Boolean(gmailClientId && gmailClientSecret && gmailRefreshToken);
// Gmail supports TLS submission on 587 as well as implicit TLS on 465. Render
// cannot reach Gmail's 465 endpoint from this service, so use 587 by default.
const configuredSmtpPort = Number.parseInt(process.env.SMTP_PORT || '587', 10);
const smtpPort = configuredSmtpPort === 465 ? 465 : 587;
const mailTransport = smtpConfigured ? nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: smtpPort,
  secure: smtpPort === 465,
  requireTLS: smtpPort === 587,
  // An unreachable SMTP service must not leave the invitation screen waiting
  // indefinitely after access has already been granted in the database.
  connectionTimeout: 8000,
  greetingTimeout: 8000,
  socketTimeout: 12000,
  // Render exposes IPv4 through an internal interface. Tell Nodemailer to
  // consider it when resolving Gmail so it does not attempt an unreachable
  // IPv6-only route first.
  allowInternalNetworkInterfaces: true,
  auth: { user: smtpUser, pass: smtpAppPassword }
}) : null;
const applicationUrl = (frontendOrigins[0] || 'https://aceclock.onrender.com').replace(/\/$/, '');
const base64Url = value => Buffer.from(value, 'utf8').toString('base64url');
const emailHeader = value => {
  const clean = String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
  // Gmail API receives the complete RFC 2822 message. Encode any non-ASCII
  // header value instead of relying on a recipient to guess its charset.
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
};
const gmailApiError = (message, status) => Object.assign(new Error(message), { code: 'EGMAILAPI', status });
const getGmailAccessToken = async () => {
  const body = new URLSearchParams({
    client_id: gmailClientId,
    client_secret: gmailClientSecret,
    refresh_token: gmailRefreshToken,
    grant_type: 'refresh_token'
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw gmailApiError(payload.error || 'Could not refresh the Gmail API authorization.', response.status);
  }
  return payload.access_token;
};
const sendWithGmailApi = async ({ from, to, subject, text, html }) => {
  const accessToken = await getGmailAccessToken();
  // RFC 2822 message encoded as base64url, as required by Gmail's send API.
  // Values originate from validated email addresses and fixed application text.
  const raw = [
    `From: ${emailHeader(from)}`,
    `To: ${emailHeader(to)}`,
    `Subject: ${emailHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="ace-clock-invitation"',
    '',
    '--ace-clock-invitation',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
    '--ace-clock-invitation',
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    html,
    '--ace-clock-invitation--',
    ''
  ].join('\r\n');
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ raw: base64Url(raw) })
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw gmailApiError(payload.error?.message || 'Gmail API did not accept the message.', response.status);
  }
};
const buildInvitationEmail = ({ email, role, invitedBy }) => {
  const recipient = htmlEscape(email);
  const inviterName = invitedBy || 'an ACE administrator';
  const inviter = htmlEscape(inviterName);
  const roleName = role === 'ADMIN' ? 'Administrator' : 'Employee';
  const roleDetails = role === 'ADMIN'
    ? 'You will be able to manage people, work records, reports, and workspace settings.'
    : 'You will be able to clock in, clock out, review your time, and stay up to date with your work.';
  const roleAccent = role === 'ADMIN' ? '#7c3aed' : '#008eaa';
  const roleTag = role === 'ADMIN' ? 'WORKSPACE ADMINISTRATOR' : 'TEAM MEMBER';
  const roleWelcome = role === 'ADMIN' ? 'Your administrator workspace is ready.' : 'Your employee workspace is ready.';
  const loginUrl = `${applicationUrl}/login`;
  const preheader = `You have been invited to ACE Clock In/Out as an ${roleName}.`;
  return {
    // Keep the visible subject deliberately plain ASCII across Gmail, Outlook,
    // and clients that display malformed UTF-8 headers literally.
    subject: `ACE Clock In Out invitation - ${roleName}`,
    text: `Hello,\n\n${inviterName} invited ${email} to ACE Clock In/Out as an ${roleName}.\n\n${roleDetails}\n\nOpen ACE Clock: ${loginUrl}\n\nBefore your first shift:\n1. Sign in with the exact Google email that received this invitation.\n2. Complete Profile & settings.\n3. Clock in when you begin work, then clock out when your shift is complete.\n\nIf you cannot sign in, make sure you are using the same Google account this invitation was sent to.\n\nACE Outsource Solutions`,
    // Table layout and inline CSS keep this dependable in Gmail and Outlook.
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${preheader}</title></head>
<body style="margin:0;padding:0;background:#f3f7f8;font-family:Arial,Helvetica,sans-serif;color:#173f4c">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f3f7f8"><tr><td align="center" style="padding:40px 16px">
    <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #dbe8eb;border-radius:18px;overflow:hidden">
      <tr><td style="height:6px;background:${roleAccent};font-size:0;line-height:0">&nbsp;</td></tr>
      <tr><td style="padding:32px 38px 28px;background:#073b4c;color:#ffffff">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td>
          <p style="margin:0 0 14px;font-size:11px;font-weight:700;letter-spacing:1.7px;color:#9de3eb">ACE OUTSOURCE SOLUTIONS</p>
          <h1 style="margin:0;font-size:31px;line-height:1.18;color:#ffffff">Welcome to<br>ACE Clock.</h1>
          <p style="margin:14px 0 0;font-size:16px;line-height:1.55;color:#d5f3f6">${roleWelcome}</p>
        </td><td align="right" valign="top" style="padding-left:20px"><span style="display:inline-block;padding:8px 10px;border-radius:20px;background:${roleAccent};font-size:10px;font-weight:700;letter-spacing:1px;color:#ffffff;white-space:nowrap">${roleTag}</span></td></tr></table>
      </td></tr>
      <tr><td style="padding:34px 38px 12px">
        <p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:#45636d">Hello,</p>
        <p style="margin:0;font-size:17px;line-height:1.6;color:#173f4c"><strong>${inviter}</strong> has invited <strong>${recipient}</strong> to ACE Clock In/Out.</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:26px 0 22px;border:1px solid #d8e9ed;border-radius:14px;background:#f7fcfd"><tr><td style="padding:20px 22px">
          <p style="margin:0 0 7px;font-size:10px;font-weight:700;letter-spacing:1.4px;color:${roleAccent}">YOUR ROLE</p>
          <p style="margin:0;font-size:21px;line-height:1.3;font-weight:700;color:#073b4c">${roleName}</p>
          <p style="margin:8px 0 0;font-size:14px;line-height:1.55;color:#52707a">${roleDetails}</p>
        </td></tr></table>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 32px"><tr><td style="border-radius:9px;background:${roleAccent}"><a href="${loginUrl}" style="display:inline-block;padding:15px 23px;border-radius:9px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none">Open ACE Clock &nbsp;&rarr;</a></td></tr></table>
      </td></tr>
      <tr><td style="padding:4px 38px 32px">
        <h2 style="margin:0 0 18px;font-size:19px;line-height:1.3;color:#073b4c">Get started in three steps</h2>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr><td valign="top" style="width:36px;padding:0 12px 15px 0"><span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;border-radius:50%;background:#e0f5f7;color:#007c94;font-size:12px;font-weight:700">1</span></td><td style="padding:3px 0 15px;font-size:15px;line-height:1.5;color:#45636d"><strong style="color:#173f4c">Use the invited Google account.</strong><br>Sign in with exactly this email address.</td></tr>
          <tr><td valign="top" style="width:36px;padding:0 12px 15px 0"><span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;border-radius:50%;background:#e0f5f7;color:#007c94;font-size:12px;font-weight:700">2</span></td><td style="padding:3px 0 15px;font-size:15px;line-height:1.5;color:#45636d"><strong style="color:#173f4c">Complete your profile.</strong><br>Add the details your team needs.</td></tr>
          <tr><td valign="top" style="width:36px;padding:0 12px 0 0"><span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;border-radius:50%;background:#e0f5f7;color:#007c94;font-size:12px;font-weight:700">3</span></td><td style="padding:3px 0 0;font-size:15px;line-height:1.5;color:#45636d"><strong style="color:#173f4c">Start with confidence.</strong><br>Clock in when your workday begins.</td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:20px 38px;background:#f7fafb;border-top:1px solid #e0ecee;font-size:12px;line-height:1.6;color:#617b84">Need help? Sign in with the invited Google account first, then contact your administrator or HR representative.</td></tr>
      <tr><td style="padding:16px 38px;background:#edf5f6;text-align:center;font-size:11px;letter-spacing:.4px;color:#6a838b">ACE OUTSOURCE SOLUTIONS &nbsp;&middot;&nbsp; TIME MADE CLEAR</td></tr>
    </table>
  </td></tr></table>
</body></html>`
  };
};
const sendInvitationEmail = async ({ email, role, invitedBy }) => {
  if (!gmailConfigured && !mailTransport) return false;
  const message = {
    from: process.env.GMAIL_FROM?.trim() || process.env.SMTP_FROM || smtpUser,
    to: email,
    ...buildInvitationEmail({ email, role, invitedBy })
  };
  if (gmailConfigured) await sendWithGmailApi(message);
  else await mailTransport.sendMail(message);
  return true;
};
const invitationMailIssue = error => {
  if (!gmailConfigured && !smtpConfigured) return 'Email delivery is not configured on Render.';
  if (error?.code === 'EGMAILAPI') {
    if (error?.message === 'invalid_grant') return 'Gmail authorization expired. Generate and save a new Gmail refresh token in Render.';
    return 'Gmail API could not send this invitation. Check the Render service logs.';
  }
  if (error?.code === 'EAUTH') return 'Gmail rejected the sender sign-in. Check SMTP_USER and SMTP_APP_PASSWORD in Render.';
  if (error?.code === 'EENVELOPE') return 'Gmail rejected SMTP_FROM. Use the same Gmail address as SMTP_USER.';
  if (['ECONNECTION', 'ETIMEDOUT', 'ENOTFOUND'].includes(error?.code)) return 'Render could not reach Gmail. Check the Render service logs.';
  return 'The email service could not send this invitation. Check the Render service logs.';
};

const fail = (res, status, message) => res.status(status).json({ error: message });
const query = async builder => { const { data, error } = await builder; if (error) throw error; return data; };
const pageParams = req => ({ page: Math.max(1, Number.parseInt(req.query.page, 10) || 1), pageSize: Math.min(100, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 25)), paged: req.query.page !== undefined });
const pagedResult = async (request, { page, pageSize, paged }) => {
  if (!paged) return query(request);
  const { data, error, count } = await request.range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw error;
  return { items: data || [], total: count || 0, page, pageSize };
};
const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const isDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const isTimestamp = value => typeof value === 'string' && value.length <= 80 && !Number.isNaN(Date.parse(value));
const isTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || '');
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const htmlEscape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const optionalText = (value, maximum = 500) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text.length <= maximum ? (text || null) : undefined;
};
const requireText = (value, field, maximum = 160) => {
  const text = optionalText(value, maximum);
  if (!text) throw Object.assign(new Error(`${field} is required and must be at most ${maximum} characters`), { status: 400, expose: true });
  return text;
};
const optionalUuid = value => value === undefined || value === null || value === '' ? null : (isUuid(value) ? value : undefined);
app.param('id', (req, res, next, id) => isUuid(id) ? next() : fail(res, 400, 'Invalid record ID'));
app.param('projectId', (req, res, next, id) => isUuid(id) ? next() : fail(res, 400, 'Invalid project ID'));
const allowedDomains = (process.env.ALLOWED_EMAIL_DOMAINS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
const isAllowedCompanyEmail = email => !allowedDomains.length || allowedDomains.some(domain => email.endsWith(`@${domain}`));
const googleAvatarUrl = user => {
  const candidates = [user?.user_metadata?.avatar_url, user?.user_metadata?.picture, ...((user?.identities || []).flatMap(identity => [identity.identity_data?.avatar_url, identity.identity_data?.picture]))];
  return candidates.find(value => {
    if (typeof value !== 'string' || value.length > 2048) return false;
    try { return new URL(value).protocol === 'https:'; } catch { return false; }
  }) || null;
};
const persistGoogleAvatar = async (profile, user) => {
  if (profile.profile_picture_url || profile.profile_picture_public_id) return profile;
  const avatarUrl = googleAvatarUrl(user);
  if (!avatarUrl) return profile;
  const persisted = await cached(avatarPersistenceCache, profile.id, 60_000, async () => {
    const { data, error } = await db.from('profiles').update({ profile_picture_url: avatarUrl })
      .eq('id', profile.id).is('profile_picture_url', null).select().maybeSingle();
    return error || !data ? profile : data;
  });
  profileCache.set(profile.id, { promise: Promise.resolve(persisted), expiresAt: Date.now() + 5_000 });
  return persisted;
};
const supabaseJwtSecret = process.env.SUPABASE_JWT_SECRET?.trim();
const supabaseJwtIssuer = `${process.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`;
const supabaseJwksUrl = `${supabaseJwtIssuer}/.well-known/jwks.json`;
const getSupabaseJwks = async forceRefresh => {
  if (!forceRefresh && supabaseJwksCache.expiresAt > Date.now()) return supabaseJwksCache.keys;
  if (!forceRefresh && supabaseJwksCache.refresh) return supabaseJwksCache.refresh;
  const refresh = (async () => {
    const response = await fetch(supabaseJwksUrl);
    if (!response.ok) throw new Error('Supabase signing keys are unavailable');
    const payload = await response.json();
    const keys = new Map((payload.keys || [])
      .filter(key => key.kid && key.kty === 'EC' && key.crv === 'P-256' && key.alg === 'ES256' && key.use === 'sig')
      .map(key => [key.kid, createPublicKey({ key, format: 'jwk' })]));
    if (!keys.size) throw new Error('Supabase signing keys are unavailable');
    supabaseJwksCache = { keys, expiresAt: Date.now() + 10 * 60 * 1000, refresh: null };
    return keys;
  })();
  supabaseJwksCache.refresh = refresh;
  try { return await refresh; } finally {
    if (supabaseJwksCache.refresh === refresh) supabaseJwksCache.refresh = null;
  }
};
const jwtUser = claims => {
  if (!claims?.sub || !isUuid(claims.sub)) throw new Error('Invalid or expired session');
  return {
    id: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : undefined,
    user_metadata: typeof claims.user_metadata === 'object' && claims.user_metadata ? claims.user_metadata : {}
  };
};
const verifySupabaseJwt = async token => {
  if (supabaseJwtSecret) return jwtUser(jwt.verify(token, supabaseJwtSecret, {
    algorithms: ['HS256'],
    audience: 'authenticated',
    issuer: supabaseJwtIssuer
  }));
  const decoded = jwt.decode(token, { complete: true });
  const kid = decoded?.header?.kid;
  if (!kid || decoded.header.alg !== 'ES256') throw new Error('Invalid or expired session');
  let key = (await getSupabaseJwks()).get(kid);
  if (!key) key = (await getSupabaseJwks(true)).get(kid);
  if (!key) throw new Error('Invalid or expired session');
  return jwtUser(jwt.verify(token, key, {
    algorithms: ['ES256'],
    audience: 'authenticated',
    issuer: supabaseJwtIssuer
  }));
};
const getUserFromGoTrue = (token, tokenKey) => cached(authUserCache, tokenKey, 30_000, async () => {
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new Error('Invalid or expired session');
  return data.user;
});
const getFreshUserFromGoTrue = async token => {
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new Error('Invalid or expired session');
  return data.user;
};
async function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return fail(res, 401, 'Missing bearer token');
  try {
    const tokenKey = tokenCacheKey(token);
    if (revokedTokenCache.get(tokenKey) > Date.now()) return fail(res, 401, 'Session has ended');
    // Verify locally against either an explicitly configured legacy HS256
    // secret or the project's current public ES256 signing keys.
    let user;
    try {
      user = await verifySupabaseJwt(token);
    } catch {
      // A stale or rotated local key must not lock out valid sessions. GoTrue
      // remains the authoritative fallback and rejects invalid/revoked tokens.
      user = await getUserFromGoTrue(token, tokenKey);
    }
    req.profile = await cached(profileCache, user.id, 5_000, () => query(db.from('profiles').select('*').eq('id', user.id).is('permanently_deleted_at', null).single()));
    req.profile = await persistGoogleAvatar(req.profile, user);
    req.authUser = user;
    req.authToken = token;
    req.authTokenCacheKey = tokenKey;
    next();
  } catch (error) { return fail(res, error.message === 'Invalid or expired session' ? 401 : 403, error.message === 'Invalid or expired session' ? error.message : 'User profile is not available'); }
}
const adminOnly = async (req, res, next) => {
  if (req.profile.role !== 'ADMIN' || req.profile.status !== 'ACTIVE') return fail(res, 403, 'Active administrator access required');
  try {
    // Administrator requests deliberately obtain fresh GoTrue metadata. Normal
    // employee requests use local verification and avoid this Auth log line.
    req.authUser = await getFreshUserFromGoTrue(req.authToken);
    return next();
  } catch { return fail(res, 401, 'Invalid or expired session'); }
};
const activeOnly = (req, res, next) => req.profile.status === 'ACTIVE' ? next() : fail(res, 403, req.profile.status === 'DENIED'
  ? 'Your account is inactive. Contact an administrator if you believe this is a mistake.'
  : 'Your account is not active. Contact your administrator or HR representative for an invitation.');
const employeeOnly = (req, res, next) => req.profile.role === 'USER' && req.profile.status === 'ACTIVE'
  ? next()
  : fail(res, 403, 'Employee access is required');
const canChatWith = (profile, contact) => profile.role === 'ADMIN' || contact.role === 'ADMIN';
const headAdminEmail = process.env.HEAD_ADMIN_EMAIL?.trim().toLowerCase();
if (!headAdminEmail) throw new Error('HEAD_ADMIN_EMAIL is required');
const specialAdminOnly = async (req, res, next) => {
  if (req.profile.role !== 'ADMIN' || req.profile.status !== 'ACTIVE' || req.profile.email?.toLowerCase() !== headAdminEmail) return fail(res, 403, 'This administrator feature is restricted');
  try {
    req.authUser = await getFreshUserFromGoTrue(req.authToken);
    return next();
  } catch { return fail(res, 401, 'Invalid or expired session'); }
};
const isHeadAdmin = req => req.profile.email?.toLowerCase() === headAdminEmail;
const protectHeadAdmin = (req, res, target) => {
  if (target.email?.toLowerCase() !== headAdminEmail || isHeadAdmin(req)) return true;
  fail(res, 403, 'Only the head administrator can change this administrator account.');
  return false;
};
async function guardProfileLifecycle(req, res, target, changes, { operation }) {
  if (['archive', 'approval'].includes(operation) && changes.status === 'DENIED' && target.id === req.profile.id) {
    fail(res, 400, 'You cannot remove your own administrator account.');
    return false;
  }
  if (!protectHeadAdmin(req, res, target)) return false;
  if (operation === 'archive' && target.status === 'DENIED') {
    fail(res, 409, 'This user has already been removed.');
    return false;
  }
  if (operation === 'restore' && target.status !== 'DENIED') {
    fail(res, 409, 'Only removed users can be restored.');
    return false;
  }
  const nextRole = changes.role ?? target.role;
  const nextStatus = changes.status ?? target.status;
  const removesActiveAdmin = target.role === 'ADMIN' && target.status === 'ACTIVE'
    && (nextRole !== 'ADMIN' || nextStatus !== 'ACTIVE');
  // Preserve archive's existing count check for pending administrators too.
  if (removesActiveAdmin || (operation === 'archive' && target.role === 'ADMIN')) {
    // This application-level count can still race with simultaneous mutations.
    // A future database-level constraint enforced transactionally is the proper fix.
    const admins = await query(db.from('profiles').select('id').eq('role', 'ADMIN').eq('status', 'ACTIVE'));
    if (admins.length <= 1) {
      fail(res, 403, 'At least one active administrator must remain.');
      return false;
    }
  }
  return true;
}
async function audit(req, action, entityType, entityId, description) {
  await db.from('audit_logs').insert({ user_id: req.profile?.id || null, action, entity_type: entityType, entity_id: isUuid(entityId) ? entityId : null, description, ip_address: req.ip, user_agent: req.get('user-agent'), request_id: req.requestId }).then(({ error }) => { if (error) console.error(`audit log request_id=${req.requestId}:`, error.message); });
}
// Render uses this endpoint to decide whether this instance can actually
// serve requests.  A process-only check hides broken Supabase credentials or
// a paused/unreachable database, then the UI fails later with opaque errors.
app.get('/health', async (_, res) => {
  try {
    const { error } = await db.from('profiles').select('id', { head: true, count: 'exact' }).limit(1);
    if (error) throw error;
    res.json({ ok: true, service: 'ace-clock-api', database: 'connected' });
  } catch (error) {
    console.error('health check database error:', error.message);
    res.status(503).json({ ok: false, service: 'ace-clock-api', database: 'unavailable' });
  }
});
app.get('/v1/auth/config', (_, res) => res.json({ supabaseUrl: process.env.SUPABASE_URL, supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY }));
// The browser needs to know which navigation and safeguards to show, but it
// must never duplicate the protected account's email or make the permission
// decision itself.  Keep the source of truth in the server environment.
app.get('/v1/me', authenticate, async (req, res, next) => { try {
  // Tutorial storage is optional for startup. During a staged migration or a
  // tutorial-table outage, return the already authenticated legacy profile.
  let progress;
  try {
    progress = await query(db.from('profile_tutorial_progress').select('tutorial_status,tutorial_step,tutorial_version,tutorial_started_at,tutorial_completed_at,tutorial_skipped_at').eq('profile_id', req.profile.id).eq('role', req.profile.role).maybeSingle());
  } catch (error) {
    console.warn('[onboarding] Tutorial progress unavailable; returning legacy profile', { code: error.code });
    return res.json({ profile: { ...req.profile, is_head_admin: isHeadAdmin(req) } });
  }
  res.json({ profile: { ...req.profile, ...(progress || {
    tutorial_status: 'NOT_STARTED', tutorial_step: 0, tutorial_version: 1,
    tutorial_started_at: null, tutorial_completed_at: null, tutorial_skipped_at: null
  }), is_head_admin: isHeadAdmin(req) } });
} catch (error) { next(error); } });
app.patch('/v1/me', authenticate, activeOnly, async (req, res, next) => { try {
  const fullName = requireText(req.body.fullName, 'Full name', 160);
  const profile = await query(db.from('profiles').update({ full_name: fullName }).eq('id', req.profile.id).select().single());
  await audit(req, 'UPDATE_PROFILE', 'PROFILE', profile.id, 'Updated profile name');
  res.json({ profile });
} catch (error) { next(error); } });
app.patch('/v1/me/tutorial', authenticate, activeOnly, async (req, res, next) => { try {
  const statuses = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED'];
  const status = req.body.status;
  const step = Number(req.body.step);
  const version = Number(req.body.version);
  if (!statuses.includes(status) || !Number.isInteger(step) || step < 0 || !Number.isInteger(version) || version < 1) {
    return fail(res, 400, 'Tutorial status, step, and version are invalid');
  }
  const now = new Date().toISOString();
  const previous = await query(db.from('profile_tutorial_progress').select('tutorial_status,tutorial_step,tutorial_version,tutorial_started_at,tutorial_completed_at,tutorial_skipped_at').eq('profile_id', req.profile.id).eq('role', req.profile.role).maybeSingle());
  const changes = {
    tutorial_started_at: previous?.tutorial_started_at || null,
    tutorial_completed_at: previous?.tutorial_completed_at || null,
    tutorial_skipped_at: previous?.tutorial_skipped_at || null,
    tutorial_status: status,
    tutorial_step: step,
    tutorial_version: version,
    ...(status === 'NOT_STARTED' ? { tutorial_started_at: null, tutorial_completed_at: null, tutorial_skipped_at: null } : {}),
    ...(status === 'IN_PROGRESS' ? { tutorial_started_at: previous?.tutorial_started_at || now } : {}),
    ...(status === 'COMPLETED' ? { tutorial_completed_at: now } : {}),
    ...(status === 'SKIPPED' ? { tutorial_skipped_at: now } : {})
  };
  const progress = await query(db.from('profile_tutorial_progress').upsert({ profile_id: req.profile.id, role: req.profile.role, ...changes }, { onConflict: 'profile_id,role' }).select('tutorial_status,tutorial_step,tutorial_version,tutorial_started_at,tutorial_completed_at,tutorial_skipped_at').single());
  // D1: the destination page must read the tutorial progress just acknowledged.
  profileCache.delete(req.profile.id);
  res.json({ profile: { ...req.profile, ...progress, is_head_admin: isHeadAdmin(req) } });
} catch (error) { next(error); } });
app.post('/v1/me/avatar-upload', authenticate, activeOnly, async (req, res, next) => { try {
  if (!cloudinaryConfigured) return fail(res, 503, 'Profile photo uploads are not configured yet');
  const contentType = String(req.body.contentType || '');
  const contentLength = Number(req.body.contentLength);
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType) || !Number.isFinite(contentLength) || contentLength < 1 || contentLength > 5 * 1024 * 1024) return fail(res, 400, 'Choose a JPG, PNG, or WebP photo under 5 MB');
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `ace-profiles/${req.profile.id}/${crypto.randomUUID()}`;
  const signature = cloudinary.utils.api_sign_request({ public_id: publicId, timestamp }, process.env.CLOUDINARY_API_SECRET);
  res.json({ uploadUrl: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`, apiKey: process.env.CLOUDINARY_API_KEY, timestamp, signature, publicId });
} catch (error) { next(error); } });
app.post('/v1/me/avatar-complete', authenticate, activeOnly, async (req, res, next) => { try {
  if (!cloudinaryConfigured) return fail(res, 503, 'Profile photo uploads are not configured yet');
  const publicId = requireText(req.body.publicId, 'Upload ID', 300);
  if (!publicId.startsWith(`ace-profiles/${req.profile.id}/`)) return fail(res, 403, 'That upload does not belong to your account');
  const asset = await cloudinary.api.resource(publicId, { resource_type: 'image' });
  const profile = await query(db.from('profiles').update({ profile_picture_url: asset.secure_url, profile_picture_public_id: publicId }).eq('id', req.profile.id).select().single());
  if (req.profile.profile_picture_public_id) await cloudinary.uploader.destroy(req.profile.profile_picture_public_id, { invalidate: true, resource_type: 'image' }).catch(() => {});
  await audit(req, 'UPDATE_PROFILE_PHOTO', 'PROFILE', profile.id, 'Updated profile photo');
  res.json({ profile });
} catch (error) { next(error); } });
app.post('/v1/auth/session-start', authenticate, async (req, res, next) => { try {
  await query(db.from('profiles').update({ last_login_at: new Date().toISOString(), last_seen_at: new Date().toISOString() }).eq('id', req.profile.id).select().single());
  await audit(req, 'LOGIN', 'PROFILE', req.profile.id, 'Signed in successfully');
  res.status(204).end();
} catch (error) { next(error); } });
app.post('/v1/auth/heartbeat', authenticate, activeOnly, async (req, res, next) => { try {
  queuePresence(req.profile.id);
  res.status(204).end();
} catch (error) { next(error); } });
app.post('/v1/auth/session-end', authenticate, async (req, res, next) => { try {
  authUserCache.delete(req.authTokenCacheKey);
  profileCache.delete(req.profile.id);
  revokeToken(req.authTokenCacheKey);
  queuePresence(req.profile.id);
  await flushPresence([req.profile.id]);
  await query(db.from('profiles').update({ last_logout_at: new Date().toISOString() }).eq('id', req.profile.id).select().single());
  await audit(req, 'LOGOUT', 'PROFILE', req.profile.id, 'Signed out successfully');
  res.status(204).end();
} catch (error) { next(error); } });
app.get('/v1/departments', authenticate, activeOnly, async (req, res, next) => { try { const paging = pageParams(req); const load = () => { let request = db.from('departments').select('*', paging.paged ? { count: 'exact' } : undefined).order('name'); if (req.query.q) request = request.or(`name.ilike.%${String(req.query.q).replace(/[,()]/g, ' ')}%,description.ilike.%${String(req.query.q).replace(/[,()]/g, ' ')}%`); return pagedResult(request, paging); }; res.json(!paging.paged && !req.query.q ? await cached(referenceDataCache, 'departments', referenceDataTtlMs, load) : await load()); } catch (error) { next(error); } });
app.post('/v1/departments', authenticate, adminOnly, async (req, res, next) => { try { const name = requireText(req.body.name, 'Department name'); const description = optionalText(req.body.description, 1000); if (description === undefined) return fail(res, 400, 'Description must be text up to 1000 characters'); const item = await query(db.from('departments').insert({ name, description }).select().single()); clearReferenceData('departments'); await audit(req, 'CREATE', 'DEPARTMENT', item.id, `Created department ${item.name}`); res.status(201).json(item); } catch (error) { next(error); } });
app.patch('/v1/departments/:id', authenticate, adminOnly, async (req, res, next) => { try { const changes = {}; if (req.body.name !== undefined) changes.name = requireText(req.body.name, 'Department name'); if (req.body.description !== undefined) { changes.description = optionalText(req.body.description, 1000); if (changes.description === undefined) return fail(res, 400, 'Description must be text up to 1000 characters'); } if (!Object.keys(changes).length) return fail(res, 400, 'No editable department fields supplied'); const item = await query(db.from('departments').update(changes).eq('id', req.params.id).select().single()); clearReferenceData('departments'); await audit(req, 'UPDATE', 'DEPARTMENT', item.id, `Updated department ${item.name}`); res.json(item); } catch (error) { next(error); } });
app.delete('/v1/departments/:id', authenticate, adminOnly, async (req, res, next) => { try { const item = await query(db.from('departments').delete().eq('id', req.params.id).select().single()); clearReferenceData('departments'); await audit(req, 'DELETE', 'DEPARTMENT', item.id, `Deleted department ${item.name}`); res.json(item); } catch (error) { next(error); } });

app.get('/v1/projects', authenticate, activeOnly, async (req, res, next) => { try { const paging = pageParams(req); const load = () => { let request = db.from('projects').select('*', paging.paged ? { count: 'exact' } : undefined).order('name'); if (req.query.q) request = request.or(`name.ilike.%${String(req.query.q).replace(/[,()]/g, ' ')}%,description.ilike.%${String(req.query.q).replace(/[,()]/g, ' ')}%`); return pagedResult(request, paging); }; res.json(!paging.paged && !req.query.q ? await cached(referenceDataCache, 'projects', referenceDataTtlMs, load) : await load()); } catch (error) { next(error); } });
app.post('/v1/projects', authenticate, adminOnly, async (req, res, next) => { try { const name = requireText(req.body.name, 'Project name'); const description = optionalText(req.body.description, 1000); if (description === undefined) return fail(res, 400, 'Description must be text up to 1000 characters'); const item = await query(db.from('projects').insert({ name, description }).select().single()); clearReferenceData('projects'); await audit(req, 'CREATE', 'PROJECT', item.id, `Created project ${item.name}`); res.status(201).json(item); } catch (error) { next(error); } });
app.patch('/v1/projects/:id', authenticate, adminOnly, async (req, res, next) => { try { const changes = {}; if (req.body.name !== undefined) changes.name = requireText(req.body.name, 'Project name'); if (req.body.description !== undefined) { changes.description = optionalText(req.body.description, 1000); if (changes.description === undefined) return fail(res, 400, 'Description must be text up to 1000 characters'); } if (!Object.keys(changes).length) return fail(res, 400, 'No editable project fields supplied'); const item = await query(db.from('projects').update(changes).eq('id', req.params.id).select().single()); clearReferenceData('projects'); await audit(req, 'UPDATE', 'PROJECT', item.id, `Updated project ${item.name}`); res.json(item); } catch (error) { next(error); } });
app.delete('/v1/projects/:id', authenticate, adminOnly, async (req, res, next) => { try { const item = await query(db.from('projects').delete().eq('id', req.params.id).select().single()); clearReferenceData('projects'); await audit(req, 'DELETE', 'PROJECT', item.id, `Deleted project ${item.name}`); res.json(item); } catch (error) { next(error); } });
app.get('/v1/schedules', authenticate, adminOnly, async (req, res, next) => { try { const paging = pageParams(req); let request = db.from('work_schedules').select('*, user_schedule_assignments(user_id)', paging.paged ? { count: 'exact' } : undefined).order('name'); if (req.query.q) request = request.ilike('name', `%${String(req.query.q).replace(/[%_,()]/g, ' ')}%`); res.json(await pagedResult(request, paging)); } catch (error) { next(error); } });
app.get('/v1/my-schedule', authenticate, activeOnly, async (req, res, next) => { try { const assignment = await query(db.from('user_schedule_assignments').select('assigned_at, work_schedules(*)').eq('user_id', req.profile.id).maybeSingle()); res.json(assignment?.work_schedules || null); } catch (error) { next(error); } });
app.post('/v1/schedules', authenticate, adminOnly, async (req, res, next) => { try {
  const name = requireText(req.body.name, 'Schedule name', 80); const scheduleType = req.body.scheduleType === 'FLEX' ? 'FLEX' : req.body.scheduleType === 'FIXED' ? 'FIXED' : null;
  const startTime = req.body.startTime || null; const endTime = req.body.endTime || null; const dailyElapsedMinutes = Number(req.body.dailyElapsedMinutes || 540);
  const requestedWorkdays = req.body.workdays === undefined ? [1, 2, 3, 4, 5] : req.body.workdays;
  const workdays = Array.isArray(requestedWorkdays) ? [...new Set(requestedWorkdays.map(Number))].sort((a, b) => a - b) : null;
  if (!scheduleType || !Array.isArray(workdays) || !workdays.length || workdays.some(day => !Number.isInteger(day) || day < 0 || day > 6) || !Number.isInteger(dailyElapsedMinutes) || dailyElapsedMinutes < 60 || dailyElapsedMinutes > 1440 || (scheduleType === 'FIXED' && (!isTime(startTime) || !isTime(endTime)))) return fail(res, 400, 'Provide valid schedule details and at least one workday');
  const item = await query(db.from('work_schedules').insert({ name, schedule_type: scheduleType, start_time: scheduleType === 'FIXED' ? startTime : null, end_time: scheduleType === 'FIXED' ? endTime : null, daily_elapsed_minutes: dailyElapsedMinutes, scheduled_weekdays: workdays, created_by_user_id: req.profile.id }).select().single());
  await audit(req, 'CREATE_SCHEDULE', 'SCHEDULE', item.id, `Created ${scheduleType.toLowerCase()} schedule ${name}`); res.status(201).json(item);
} catch (error) { next(error); } });
app.delete('/v1/schedules/:id', authenticate, adminOnly, async (req, res, next) => { try {
  const { count, error } = await db.from('user_schedule_assignments').select('user_id', { count: 'exact', head: true }).eq('schedule_id', req.params.id);
  if (error) throw error;
  if (count > 0) return fail(res, 409, `This schedule is assigned to ${count} employee${count === 1 ? '' : 's'}. Unassign them first.`);
  const schedule = await query(db.from('work_schedules').delete().eq('id', req.params.id).select('id,name').single());
  await audit(req, 'DELETE_SCHEDULE', 'SCHEDULE', schedule.id, `Deleted schedule ${schedule.name}`);
  res.json(schedule);
} catch (error) { next(error); } });
app.put('/v1/users/:id/schedule', authenticate, adminOnly, async (req, res, next) => { try {
  const scheduleId = optionalUuid(req.body.scheduleId); if (scheduleId === undefined) return fail(res, 400, 'Invalid schedule');
  const employee = await query(db.from('profiles').select('id,full_name,email,role').eq('id', req.params.id).single()); if (employee.role !== 'USER') return fail(res, 400, 'Schedules can only be assigned to employees');
  if (!scheduleId) { await query(db.from('user_schedule_assignments').delete().eq('user_id', employee.id).select()); await audit(req, 'UNASSIGN_SCHEDULE', 'PROFILE', employee.id, `Removed schedule from ${employee.full_name || employee.email}`); return res.status(204).end(); }
  const schedule = await query(db.from('work_schedules').select('id,name').eq('id', scheduleId).eq('is_active', true).single());
  const assignment = await query(db.from('user_schedule_assignments').upsert({ user_id: employee.id, schedule_id: schedule.id, assigned_by_user_id: req.profile.id, assigned_at: new Date().toISOString() }).select().single());
  await audit(req, 'ASSIGN_SCHEDULE', 'PROFILE', employee.id, `Assigned ${schedule.name} to ${employee.full_name || employee.email}`); res.json(assignment);
} catch (error) { next(error); } });
app.get('/v1/user-projects', authenticate, activeOnly, async (req, res, next) => { try { let request = db.from('user_projects').select('*'); if (req.profile.role !== 'ADMIN') request = request.eq('user_id', req.profile.id); res.json(await query(request)); } catch (error) { next(error); } });
app.put('/v1/users/:id/projects/:projectId', authenticate, adminOnly, async (req, res, next) => { try {
  const target = await query(db.from('profiles').select('id,email,full_name,role,status').eq('id', req.params.id).single());
  if (!protectHeadAdmin(req, res, target)) return;
  if (target.role !== 'USER' || target.status !== 'ACTIVE') return fail(res, 409, 'Projects can only be assigned to active employees');
  const project = await query(db.from('projects').select('id,name').eq('id', req.params.projectId).eq('is_active', true).single());
  const item = await query(db.from('user_projects')
    .upsert({ user_id: target.id, project_id: project.id }, { onConflict: 'user_id,project_id' })
    .select()
    .single());
  await audit(req, 'ASSIGN_PROJECT', 'PROFILE', target.id, `Assigned ${project.name} to ${target.full_name || target.email}`);
  res.json(item);
} catch (error) {
  // A missing composite key is a deployment/schema problem, not an opaque
  // application crash. Keep database details server-side but make remediation clear.
  if (['42P01', '42P10'].includes(error?.code)) return fail(res, 503, 'Project assignments are not configured. Apply database migration 0022 and try again.');
  next(error);
} });
app.delete('/v1/users/:id/projects/:projectId', authenticate, adminOnly, async (req, res, next) => { try { const target = await query(db.from('profiles').select('id,email').eq('id', req.params.id).single()); if (!protectHeadAdmin(req, res, target)) return; await query(db.from('user_projects').delete().eq('user_id', req.params.id).eq('project_id', req.params.projectId).select()); await audit(req, 'UNASSIGN_PROJECT', 'PROFILE', req.params.id, `Unassigned project ${req.params.projectId}`); res.status(204).end(); } catch (error) { next(error); } });

app.get('/v1/users', authenticate, adminOnly, async (req, res, next) => { try {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1); const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 25)); const paged = req.query.page !== undefined;
  let request = db.from('profiles').select('*, departments(name)', paged ? { count: 'exact' } : undefined).order('created_at', { ascending: false });
  request = req.query.removed === 'true' ? request.eq('status', 'DENIED') : request.neq('status', 'DENIED');
  request = request.is('permanently_deleted_at', null);
  if (req.query.role === 'ADMIN' || req.query.role === 'USER') request = request.eq('role', req.query.role);
  if (req.query.departmentId) request = request.eq('department_id', req.query.departmentId);
  if (req.query.projectId) {
    const projectId = String(req.query.projectId);
    if (projectId === '__UNASSIGNED__') {
      const assignments = await query(db.from('user_projects').select('user_id'));
      const assignedUserIds = [...new Set(assignments.map(assignment => assignment.user_id))];
      request = request.eq('role', 'USER');
      if (assignedUserIds.length) request = request.not('id', 'in', `(${assignedUserIds.join(',')})`);
    } else {
      if (!isUuid(projectId)) return fail(res, 400, 'Invalid project filter');
      const assignments = await query(db.from('user_projects').select('user_id').eq('project_id', projectId));
      const assignedUserIds = [...new Set(assignments.map(assignment => assignment.user_id))];
      if (!assignedUserIds.length) return res.json(paged ? { items: [], total: 0, page, pageSize } : []);
      request = request.eq('role', 'USER').in('id', assignedUserIds);
    }
  }
  if (req.query.q) {
    const term = String(req.query.q).trim().replace(/[,()]/g, ' ');
    if (term) request = request.or(`full_name.ilike.%${term}%,email.ilike.%${term}%`);
  }
  if (paged) request = request.range((page - 1) * pageSize, page * pageSize - 1);
  const profileResponse = await request;
  if (profileResponse.error) throw profileResponse.error; const profiles = profileResponse.data || []; const items = profiles.map(profile => ({
    ...profile,
    is_head_admin: profile.email?.toLowerCase() === headAdminEmail
  }));
  res.json(paged ? { items, total: profileResponse.count || 0, page, pageSize } : items);
} catch (error) { next(error); } });
app.get('/v1/employee-chat/contacts', authenticate, activeOnly, async (req, res, next) => { try {
  let contactRequest = db.from('profiles').select('id,full_name,email,role,last_seen_at,profile_picture_url').eq('status', 'ACTIVE').is('permanently_deleted_at', null).neq('id', req.profile.id).order('full_name');
  if (req.profile.role !== 'ADMIN') contactRequest = contactRequest.eq('role', 'ADMIN');
  const [contacts, unread] = await Promise.all([
    query(contactRequest),
    query(db.from('employee_messages').select('sender_id,body,created_at').eq('recipient_id', req.profile.id).is('read_at', null).is('deleted_at', null).order('created_at', { ascending: false }))
  ]);
  const allowedContactIds = new Set(contacts.map(contact => contact.id));
  const unreadByContact = unread.reduce((summary, message) => {
    if (!allowedContactIds.has(message.sender_id)) return summary;
    const item = summary[message.sender_id] || { count: 0, latest: null };
    item.count += 1;
    // Results are newest-first, so retain only the first message as a preview.
    if (!item.latest) item.latest = message;
    summary[message.sender_id] = item;
    return summary;
  }, {});
  res.json({
    contacts: contacts.map(contact => ({
      ...contact,
      unread_count: unreadByContact[contact.id]?.count || 0,
      last_unread_message: unreadByContact[contact.id]?.latest?.body || null,
      last_unread_at: unreadByContact[contact.id]?.latest?.created_at || null
    }))
  });
} catch (error) { next(error); } });
app.get('/v1/employee-chat/stream', authenticate, activeOnly, (req, res) => {
  const userId = req.profile.id;
  const subscribers = chatSubscribers.get(userId) || new Set();
  subscribers.add(res);
  chatSubscribers.set(userId, subscribers);
  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();
  res.write('event: ready\ndata: {}\n\n');
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 20_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    subscribers.delete(res);
    if (!subscribers.size) chatSubscribers.delete(userId);
  });
});
app.post('/v1/employee-chat/typing', authenticate, activeOnly, async (req, res, next) => { try {
  const recipientId = optionalUuid(req.body.recipientId);
  const active = Boolean(req.body.active);
  if (!recipientId || recipientId === req.profile.id) return fail(res, 400, 'A valid chat recipient is required');
  const recipient = await query(db.from('profiles').select('id,role').eq('id', recipientId).eq('status', 'ACTIVE').is('permanently_deleted_at', null).maybeSingle());
  if (!recipient) return fail(res, 404, 'Contact is not available for chat');
  if (!canChatWith(req.profile, recipient)) return fail(res, 403, 'Employees can only chat with administrators');
  publishChatEvent(recipientId, { type: 'typing', contactId: req.profile.id, active });
  res.status(204).end();
} catch (error) { next(error); } });
app.get('/v1/employee-chat/messages/:userId', authenticate, activeOnly, async (req, res, next) => { try {
  const otherUserId = optionalUuid(req.params.userId);
  if (!otherUserId) return fail(res, 400, 'A valid contact ID is required');
  const contact = await query(db.from('profiles').select('id,role').eq('id', otherUserId).eq('status', 'ACTIVE').is('permanently_deleted_at', null).maybeSingle());
  if (!contact) return fail(res, 404, 'Contact is not available for chat');
  if (!canChatWith(req.profile, contact)) return fail(res, 403, 'Employees can only chat with administrators');
  const messages = await query(db.from('employee_messages').select('*').or(`and(sender_id.eq.${req.profile.id},recipient_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},recipient_id.eq.${req.profile.id})`).order('created_at').limit(200));
  await query(db.from('employee_messages').update({ read_at: new Date().toISOString() }).eq('sender_id', otherUserId).eq('recipient_id', req.profile.id).is('read_at', null));
  res.json(messages);
} catch (error) { next(error); } });
app.post('/v1/employee-chat/messages', authenticate, activeOnly, async (req, res, next) => { try {
  const recipientId = optionalUuid(req.body.recipientId);
  const body = optionalText(req.body.body, 2000);
  if (!recipientId || !body) return fail(res, 400, 'A recipient and message are required');
  if (recipientId === req.profile.id) return fail(res, 400, 'You cannot message yourself');
  const recipient = await query(db.from('profiles').select('id,role').eq('id', recipientId).eq('status', 'ACTIVE').is('permanently_deleted_at', null).maybeSingle());
  if (!recipient) return fail(res, 404, 'Contact is not available for chat');
  if (!canChatWith(req.profile, recipient)) return fail(res, 403, 'Employees can only chat with administrators');
  const message = await query(db.from('employee_messages').insert({ sender_id: req.profile.id, recipient_id: recipientId, body, original_body: body }).select().single());
  publishChatEvent(recipientId, { type: 'message', contactId: req.profile.id, messageId: message.id });
  res.status(201).json(message);
} catch (error) { next(error); } });
app.patch('/v1/employee-chat/messages/:messageId', authenticate, activeOnly, async (req, res, next) => { try {
  const messageId = optionalUuid(req.params.messageId);
  const body = optionalText(req.body.body, 2000);
  if (!messageId || !body) return fail(res, 400, 'A valid message is required');
  const existing = await query(db.from('employee_messages').select('id,body,original_body').eq('id', messageId).eq('sender_id', req.profile.id).is('deleted_at', null).maybeSingle());
  if (!existing) return fail(res, 404, 'Message is not available to edit');
  const message = await query(db.from('employee_messages').update({ body, original_body: existing.original_body || existing.body, edited_at: new Date().toISOString() }).eq('id', messageId).select().single());
  res.json(message);
} catch (error) { next(error); } });
app.delete('/v1/employee-chat/messages/:messageId', authenticate, activeOnly, async (req, res, next) => { try {
  const messageId = optionalUuid(req.params.messageId);
  if (!messageId) return fail(res, 400, 'A valid message ID is required');
  // Keep the original body for the restricted administrator log. The employee
  // chat renders the deleted marker instead, so deletion hides it only there.
  const message = await query(db.from('employee_messages').update({ deleted_at: new Date().toISOString() }).eq('id', messageId).eq('sender_id', req.profile.id).is('deleted_at', null).select().maybeSingle());
  if (!message) return fail(res, 404, 'Message is not available to delete');
  res.json(message);
} catch (error) { next(error); } });
app.get('/v1/admin/chat-log', authenticate, specialAdminOnly, async (req, res, next) => { try {
  const paging = pageParams(req);
  const messageRequest = db.from('employee_messages').select('id,sender_id,recipient_id,body,original_body,created_at,edited_at,deleted_at,read_at', paging.paged ? { count: 'exact' } : undefined).order('created_at', { ascending: false });
  const [messageResult, profiles] = await Promise.all([
    paging.paged ? pagedResult(messageRequest, paging) : query(messageRequest.limit(500)),
    query(db.from('profiles').select('id,full_name,email,role'))
  ]);
  const messages = paging.paged ? messageResult.items : messageResult;
  const people = new Map(profiles.map(profile => [profile.id, profile]));
  const items = messages.map(message => ({ ...message, sender: people.get(message.sender_id) || null, recipient: people.get(message.recipient_id) || null }));
  res.json(paging.paged ? { ...messageResult, items } : items);
} catch (error) { next(error); } });
app.patch('/v1/users/:id/approval', authenticate, adminOnly, async (req, res, next) => { try {
  if (!['ACTIVE', 'DENIED'].includes(req.body.status)) return fail(res, 400, 'Status must be ACTIVE or DENIED');
  const target = await query(db.from('profiles').select('id,email,role,status').eq('id', req.params.id).single());
  if (!await guardProfileLifecycle(req, res, target, { status: req.body.status }, { operation: 'approval' })) return;
  const profile = await query(db.rpc('change_user_status_with_audit', {
    p_target_user_id: target.id, p_actor_user_id: req.profile.id,
    p_status: req.body.status, p_request_id: req.requestId
  }));
  res.json(profile);
} catch (error) { next(error); } });
app.patch('/v1/users/:id/role', authenticate, adminOnly, async (req, res, next) => { try {
  const role = req.body.role === 'ADMIN' ? 'ADMIN' : req.body.role === 'USER' ? 'USER' : null;
  if (!role) return fail(res, 400, 'Role must be ADMIN or USER');
  const target = await query(db.from('profiles').select('*').eq('id', req.params.id).single());
  if (!await guardProfileLifecycle(req, res, target, { role }, { operation: 'role' })) return;
  const profile = await query(db.rpc('change_user_role_with_audit', {
    p_target_user_id: target.id, p_actor_user_id: req.profile.id,
    p_role: role, p_request_id: req.requestId
  }));
  res.json(profile);
} catch (error) { next(error); } });
app.patch('/v1/users/:id/department', authenticate, adminOnly, async (req, res, next) => { try {
  const departmentId = optionalUuid(req.body.departmentId);
  if (departmentId === undefined) return fail(res, 400, 'Invalid department ID');
  const target = await query(db.from('profiles').select('id,email').eq('id', req.params.id).single());
  if (!protectHeadAdmin(req, res, target)) return;
  const profile = await query(db.rpc('admin_update_profile_with_audit', {
    p_target_user_id: target.id, p_actor_user_id: req.profile.id, p_operation: 'ASSIGN_DEPARTMENT',
    p_role: null, p_status: null, p_department_id: departmentId, p_request_id: req.requestId
  }));
  res.json(profile);
} catch (error) { next(error); } });
app.patch('/v1/users/:id/remove', authenticate, adminOnly, async (req, res, next) => { try {
  const target = await query(db.from('profiles').select('*').eq('id', req.params.id).is('permanently_deleted_at', null).single());
  if (!await guardProfileLifecycle(req, res, target, { status: 'DENIED' }, { operation: 'archive' })) return;
  const { data: profile, error } = await db.rpc('admin_update_profile_with_audit', {
    p_target_user_id: target.id, p_actor_user_id: req.profile.id, p_operation: 'ARCHIVE_USER',
    p_role: null, p_status: null, p_department_id: null, p_request_id: req.requestId
  });
  if (error) { if (error.code === 'P0001' && error.message === 'AUTH_ACCOUNT_NOT_FOUND') return fail(res, 502, 'The account was not archived because sign-in could not be disabled.'); throw error; }
  res.json(profile);
} catch (error) { next(error); } });
app.patch('/v1/users/:id/restore', authenticate, adminOnly, async (req, res, next) => { try {
  const target = await query(db.from('profiles').select('*').eq('id', req.params.id).is('permanently_deleted_at', null).single());
  if (!await guardProfileLifecycle(req, res, target, { status: 'ACTIVE' }, { operation: 'restore' })) return;
  const { data: profile, error } = await db.rpc('admin_update_profile_with_audit', {
    p_target_user_id: target.id, p_actor_user_id: req.profile.id, p_operation: 'RESTORE_USER',
    p_role: null, p_status: null, p_department_id: null, p_request_id: req.requestId
  });
  if (error) { if (error.code === 'P0001' && error.message === 'AUTH_ACCOUNT_NOT_FOUND') return fail(res, 502, 'The account could not be restored because sign-in could not be enabled.'); throw error; }
  res.json(profile);
} catch (error) { next(error); } });
app.delete('/v1/users/:id/permanent', authenticate, adminOnly, async (req, res, next) => { try {
  if (req.params.id === req.profile.id) return fail(res, 400, 'You cannot permanently delete your own administrator account.');
  const target = await query(db.from('profiles').select('*').eq('id', req.params.id).is('permanently_deleted_at', null).single());
  if (!protectHeadAdmin(req, res, target)) return;
  if (target.status !== 'DENIED') return fail(res, 409, 'Only archived users can be permanently deleted.');
  await query(db.rpc('permanently_remove_archived_login', {
    p_target_user_id: target.id, p_actor_user_id: req.profile.id, p_request_id: req.requestId
  }));
  res.status(204).end();
} catch (error) { next(error); } });
app.post('/v1/invitations', sensitiveActionLimiter, authenticate, adminOnly, async (req, res, next) => { try {
  const email = req.body.email?.trim().toLowerCase();
  const role = req.body.role === 'ADMIN' ? 'ADMIN' : 'USER';
  if (!email || !emailPattern.test(email) || email.length > 254) return fail(res, 400, 'A valid email is required');
  if (!isAllowedCompanyEmail(email)) return fail(res, 400, 'Use an approved company email address.');
  const departmentId = optionalUuid(req.body.departmentId);
  if (departmentId === undefined) return fail(res, 400, 'Invalid department ID');
  const now = new Date().toISOString();
  const duplicate = await query(db.from('invitations').select('id').eq('email', email).eq('status', 'PENDING').gt('expires_at', now).maybeSingle());
  const existingProfile = await query(db.from('profiles').select('id,email,role,status').eq('email', email).is('permanently_deleted_at', null).maybeSingle());
  if (existingProfile && !await guardProfileLifecycle(req, res, existingProfile, { status: 'ACTIVE', role }, { operation: 'invitation' })) return;
  if (duplicate) {
    if (!existingProfile) return fail(res, 409, 'This email already has an active invitation.');
    await query(db.from('profiles').update({ status: 'ACTIVE', role, department_id: departmentId }).eq('id', existingProfile.id).select().single());
    const invitation = await query(db.from('invitations').update({ status: 'ACCEPTED', accepted_at: new Date().toISOString() }).eq('id', duplicate.id).select().single());
    await audit(req, 'PREAUTHORIZE_GOOGLE_ACCOUNT', 'INVITATION', invitation.id, `Activated existing Google profile ${email} as ${role}`);
    let emailSent = false;
    let emailIssue = null;
    try { emailSent = await sendInvitationEmail({ email, role, invitedBy: req.profile.full_name || req.profile.email }); }
    catch (mailError) { console.error('Invitation email delivery failed:', mailError.message); emailIssue = invitationMailIssue(mailError); }
    return res.json({ ...invitation, email_sent: emailSent, email_issue: emailSent ? null : (emailIssue || invitationMailIssue()) });
  }
  // Expired invitations are historical records, not an active reservation of
  // the email. Clear their PENDING state before making a replacement.
  await query(db.from('invitations').update({ status: 'EXPIRED' }).eq('email', email).eq('status', 'PENDING').lte('expires_at', now).select('id'));
  let invitation = await query(db.from('invitations').insert({ invited_by_user_id: req.profile.id, email, role, department_id: departmentId }).select().single());
  // A person may have selected Google before the admin invited them. In that
  // case the auth trigger has already made a PENDING profile, so activate that
  // exact existing profile instead of waiting for a second account creation.
  if (existingProfile) {
    await query(db.from('profiles').update({ status: 'ACTIVE', role, department_id: departmentId }).eq('id', existingProfile.id).select().single());
    invitation = await query(db.from('invitations').update({ status: 'ACCEPTED', accepted_at: new Date().toISOString() }).eq('id', invitation.id).select().single());
  }
  await audit(req, 'PREAUTHORIZE_GOOGLE_ACCOUNT', 'INVITATION', invitation.id, `Pre-authorized ${email} as ${role}`);
  let emailSent = false;
  let emailIssue = null;
  try { emailSent = await sendInvitationEmail({ email, role, invitedBy: req.profile.full_name || req.profile.email }); }
  catch (mailError) { console.error('Invitation email delivery failed:', mailError.message); emailIssue = invitationMailIssue(mailError); }
  res.status(201).json({ ...invitation, email_sent: emailSent, email_issue: emailSent ? null : (emailIssue || invitationMailIssue()) });
} catch (error) { next(error); } });
app.delete('/v1/invitations/:id', sensitiveActionLimiter, authenticate, adminOnly, async (req, res, next) => { try {
  const invitation = await query(db.from('invitations').select('*').eq('id', req.params.id).maybeSingle());
  if (!invitation) return fail(res, 404, 'Invitation not found.');
  if (invitation.status !== 'PENDING') return fail(res, 409, 'Only pending invitations can be cancelled.');
  await query(db.from('invitations').delete().eq('id', invitation.id).select().single());
  await audit(req, 'CANCEL_INVITATION', 'INVITATION', invitation.id, `Cancelled invitation for ${invitation.email}`);
  res.status(204).end();
} catch (error) { next(error); } });
app.get('/v1/invitations', authenticate, adminOnly, async (req, res, next) => { try { const paging = pageParams(req); let request = db.from('invitations').select('*, profiles!invitations_invited_by_user_id_fkey(full_name,email)', paging.paged ? { count: 'exact' } : undefined).order('invited_at', { ascending: false }); if (req.query.q) request = request.ilike('email', `%${String(req.query.q).replace(/[%_,()]/g, ' ')}%`); res.json(await pagedResult(request, paging)); } catch (error) { next(error); } });

app.get('/v1/time-entries', authenticate, activeOnly, async (req, res, next) => { try {
  const own = req.profile.role !== 'ADMIN' || req.query.mine === 'true'; const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1); const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 25)); const paged = req.query.page !== undefined;
  let request = db.from('time_entries').select('*, projects(name), profiles!time_entries_user_id_fkey(full_name,email,role,profile_picture_url), stopped_by:profiles!time_entries_stopped_by_user_id_fkey(full_name,email)', paged ? { count: 'exact' } : undefined).order('clock_in_at', { ascending: false });
  request = req.query.removed === 'true' && req.profile.role === 'ADMIN' ? request.not('deleted_at', 'is', null) : request.is('deleted_at', null);
  if (own) request = request.eq('user_id', req.profile.id);
  if (req.query.userId) request = request.eq('user_id', req.query.userId);
  if (req.query.projectId) request = request.eq('project_id', req.query.projectId);
  if (req.query.status === 'ACTIVE') request = request.is('clock_out_at', null);
  if (req.query.status === 'COMPLETED') request = request.not('clock_out_at', 'is', null);
  const matchingIds = async (table, field, value) => {
    const term = String(value || '').trim().replace(/[,()]/g, ' '); if (!term) return null;
    const records = await query(db.from(table).select('id').ilike(field, `%${term}%`)); return records.map(record => record.id);
  };
  if (req.query.employee) { const ids = await matchingIds('profiles', 'full_name', req.query.employee); if (!ids?.length) return res.json(paged ? { items: [], total: 0, page, pageSize } : []); request = request.in('user_id', ids); }
  if (req.query.project) { const ids = await matchingIds('projects', 'name', req.query.project); if (!ids?.length) return res.json(paged ? { items: [], total: 0, page, pageSize } : []); request = request.in('project_id', ids); }
  if (req.query.remarks === 'with' || req.query.remarks === 'without') {
    const remarks = await query(db.from('admin_remarks').select('time_entry_id'));
    const ids = [...new Set(remarks.map(remark => remark.time_entry_id))];
    if (req.query.remarks === 'with') { if (!ids.length) return res.json(paged ? { items: [], total: 0, page, pageSize } : []); request = request.in('id', ids); }
    else if (ids.length) request = request.not('id', 'in', `(${ids.join(',')})`);
  }
  if (req.query.q) {
    const term = String(req.query.q).trim().replace(/[,()]/g, ' ');
    if (term) {
      const pattern = `%${term}%`;
      const [people, projects] = await Promise.all([
        query(db.from('profiles').select('id').or(`full_name.ilike.${pattern},email.ilike.${pattern}`)),
        query(db.from('projects').select('id').ilike('name', pattern))
      ]);
      const userIds = people.map(person => person.id); const projectIds = projects.map(project => project.id);
      const matches = [`final_note.ilike.${pattern}`];
      if (userIds.length) matches.push(`user_id.in.(${userIds.join(',')})`);
      if (projectIds.length) matches.push(`project_id.in.(${projectIds.join(',')})`);
      request = request.or(matches.join(','));
    }
  }
  if (!paged) return res.json(await query(request));
  const response = await request.range((page - 1) * pageSize, page * pageSize - 1); if (response.error) throw response.error;
  res.json({ items: response.data || [], total: response.count || 0, page, pageSize });
} catch (error) { next(error); } });
app.get('/v1/time-leaderboard', authenticate, adminOnly, async (req, res, next) => { try {
  const [people, entries] = await Promise.all([
    query(db.from('profiles').select('id,full_name,profile_picture_url,role').eq('role', 'USER').eq('status', 'ACTIVE').is('permanently_deleted_at', null)),
    query(db.from('time_entries').select('user_id,duration_seconds').is('deleted_at', null).not('duration_seconds', 'is', null))
  ]);
  const totals = entries.reduce((result, entry) => {
    result[entry.user_id] = (result[entry.user_id] || 0) + Number(entry.duration_seconds || 0);
    return result;
  }, {});
  const ranked = people.map(person => ({ ...person, tracked_seconds: totals[person.id] || 0 })).sort((a, b) => b.tracked_seconds - a.tracked_seconds || (a.full_name || '').localeCompare(b.full_name || ''));
  const ownIndex = ranked.findIndex(person => person.id === req.profile.id);
  res.json({ leaders: ranked.slice(0, 10), my_rank: ownIndex === -1 ? null : ownIndex + 1, total_people: ranked.length });
} catch (error) { next(error); } });
app.get('/v1/admin-remarks', authenticate, activeOnly, async (req, res, next) => { try {
  let request = db.from('admin_remarks').select('*, profiles!admin_remarks_admin_user_id_fkey(full_name,email), time_entries!inner(user_id,deleted_at)').order('created_at', { ascending: false });
  if (req.profile.role !== 'ADMIN') request = request.eq('time_entries.user_id', req.profile.id).is('time_entries.deleted_at', null);
  if (req.query.timeEntryIds && req.profile.role === 'ADMIN') {
    const ids = String(req.query.timeEntryIds).split(',').filter(isUuid);
    if (!ids.length) return res.json([]);
    request = request.in('time_entry_id', ids);
  }
  res.json(await query(request));
} catch (error) { next(error); } });
app.post('/v1/admin-remarks/mark-read', authenticate, activeOnly, async (req, res, next) => { try {
  if (req.profile.role === 'ADMIN') return res.json({ marked: 0 });
  const entries = await query(db.from('time_entries').select('id').eq('user_id', req.profile.id));
  if (!entries.length) return res.json({ marked: 0 });
  const marked = await query(db.from('admin_remarks').update({ seen_at: new Date().toISOString() }).in('time_entry_id', entries.map(entry => entry.id)).is('seen_at', null).select('id'));
  res.json({ marked: marked.length });
} catch (error) { next(error); } });
app.post('/v1/time-entries/clock-in', authenticate, activeOnly, async (req, res, next) => { try {
  const projectId = optionalUuid(req.body.projectId);
  if (projectId === undefined) return fail(res, 400, 'Invalid project ID');
  if (projectId) {
    const assignment = await query(db.from('user_projects').select('project_id')
      .eq('user_id', req.profile.id).eq('project_id', projectId).maybeSingle());
    if (!assignment) return fail(res, 403, 'You can only clock in to a project assigned to you');
  }
  const open = await query(db.from('time_entries').select('id').eq('user_id', req.profile.id).is('clock_out_at', null).maybeSingle());
  if (open) return fail(res, 409, 'You already have an active time entry');
  const assignment = await query(db.from('user_schedule_assignments').select('work_schedules(id,schedule_type,start_time,end_time,daily_elapsed_minutes,scheduled_weekdays)').eq('user_id', req.profile.id).maybeSingle());
  const schedule = assignment?.work_schedules;
  // Schedule time values are Asia/Manila wall-clock values by policy; copy
  // them as-is so later schedule edits cannot change this entry's snapshot.
  const scheduleSnapshot = schedule ? {
    schedule_id: schedule.id,
    schedule_type: schedule.schedule_type,
    scheduled_start_time: schedule.start_time,
    scheduled_end_time: schedule.end_time,
    target_seconds: schedule.daily_elapsed_minutes * 60,
    scheduled_weekdays: schedule.scheduled_weekdays
  } : {
    schedule_id: null,
    schedule_type: null,
    scheduled_start_time: null,
    scheduled_end_time: null,
    target_seconds: null,
    scheduled_weekdays: null
  };
  const { data: entry, error } = await db.rpc('clock_in_entry_with_audit', {
    p_actor_user_id: req.profile.id, p_project_id: projectId,
    p_schedule_id: scheduleSnapshot.schedule_id, p_schedule_type: scheduleSnapshot.schedule_type,
    p_scheduled_start_time: scheduleSnapshot.scheduled_start_time, p_scheduled_end_time: scheduleSnapshot.scheduled_end_time,
    p_target_seconds: scheduleSnapshot.target_seconds, p_scheduled_weekdays: scheduleSnapshot.scheduled_weekdays,
    p_ip_address: req.ip, p_user_agent: req.get('user-agent'), p_request_id: req.requestId
  });
  if (error) throw error;
  res.status(201).json(entry);
} catch (error) { next(error); } });
app.post('/v1/time-entries/:id/clock-out', authenticate, activeOnly, async (req, res, next) => { try {
  const note = requireText(req.body.note, 'A clock-out note', 50);
  const { data: entry, error } = await db.rpc('clock_out_entry', {
    p_actor_user_id: req.profile.id, p_entry_id: req.params.id, p_actor_role: req.profile.role,
    p_final_note: note, p_now: new Date().toISOString(), p_ip_address: req.ip, p_user_agent: req.get('user-agent')
  });
  if (error) {
    if (error.code === 'P0001' && error.message === 'ENTRY_ALREADY_CLOSED') return fail(res, 409, 'ENTRY_ALREADY_CLOSED');
    if (error.code === 'P0001' && error.message === 'NOT_FOUND_OR_FORBIDDEN') return fail(res, 404, 'ENTRY_NOT_FOUND');
    throw error;
  }
  res.json(entry);
} catch (error) { next(error); } });
app.post('/v1/time-entries/:id/admin-stop', authenticate, adminOnly, async (req, res, next) => { try {
  const { data: entry, error } = await db.rpc('admin_stop_entry', { p_entry_id: req.params.id, p_actor_user_id: req.profile.id });
  if (error) {
    if (error.code === 'P0001' && error.message === 'ENTRY_ALREADY_CLOSED') return fail(res, 409, 'This shift is already stopped');
    if (error.code === 'P0001' && error.message === 'ENTRY_NOT_FOUND') return fail(res, 404, 'Time entry is unavailable');
    if (error.code === 'P0001' && error.message === 'NOT_EMPLOYEE_ENTRY') return fail(res, 403, 'Only employee shifts can be stopped by an administrator');
    throw error;
  }
  res.json(entry);
} catch (error) { next(error); } });
app.patch('/v1/time-entries/:id/admin-time', authenticate, adminOnly, async (req, res, next) => { try {
  const { clockInAt, clockOutAt } = req.body;
  if (!isTimestamp(clockInAt) || !isTimestamp(clockOutAt)) return fail(res, 400, 'A valid clock-in and clock-out date and time are required');
  const clockIn = new Date(clockInAt);
  const clockOut = new Date(clockOutAt);
  if (clockOut < clockIn) return fail(res, 400, 'Clock-out cannot be earlier than clock-in');
  const { data: entry, error } = await db.rpc('admin_correct_entry', {
    p_entry_id: req.params.id, p_actor_user_id: req.profile.id,
    p_clock_in: clockIn.toISOString(), p_clock_out: clockOut.toISOString()
  });
  if (error) {
    if (error.code === 'P0001' && error.message === 'ENTRY_NOT_FOUND') return fail(res, 404, 'Time entry is unavailable');
    if (error.code === 'P0001' && error.message === 'NOT_EMPLOYEE_ENTRY') return fail(res, 403, 'Only employee time entries can be corrected by an administrator');
    throw error;
  }
  res.json(entry);
} catch (error) { next(error); } });
app.post('/v1/time-entries/:id/overtime/approve', authenticate, adminOnly, async (req, res, next) => { try {
  const { data, error } = await db.rpc('approve_entry_overtime', { p_entry_id: req.params.id, p_admin_id: req.profile.id });
  if (error) { if (error.code === 'P0001') return fail(res, 400, error.message); throw error; }
  res.json(data);
} catch (error) { next(error); } });
app.get('/v1/time-entry-review', authenticate, adminOnly, async (req, res, next) => { try {
  const overdueBefore = new Date(Date.now() - 16 * 60 * 60 * 1000).toISOString();
  const [openEntries, correctedEntries] = await Promise.all([
    query(db.from('time_entries').select('id,clock_in_at,profiles!time_entries_user_id_fkey(full_name,email)').is('deleted_at', null).is('clock_out_at', null).lt('clock_in_at', overdueBefore).order('clock_in_at')),
    query(db.from('time_entries').select('id,clock_in_at,clock_out_at,stopped_by_at,profiles!time_entries_user_id_fkey(full_name,email)').is('deleted_at', null).not('stopped_by_at', 'is', null).order('stopped_by_at', { ascending: false }).limit(25))
  ]);
  const items = [
    ...openEntries.map(entry => ({ id: entry.id, type: 'MISSED_CLOCK_OUT', label: 'Possible missed clock-out', detail: `${entry.profiles?.full_name || entry.profiles?.email || 'Employee'} has been clocked in for over 16 hours.`, occurredAt: entry.clock_in_at })),
    ...correctedEntries.map(entry => ({ id: entry.id, type: 'ADMIN_STOP', label: 'Administrator-stopped shift', detail: `${entry.profiles?.full_name || entry.profiles?.email || 'Employee'} had a shift stopped by an administrator.`, occurredAt: entry.stopped_by_at }))
  ].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
  res.json({ items, total: items.length });
} catch (error) { next(error); } });

app.post('/v1/time-entries/:id/remarks', authenticate, adminOnly, async (req, res, next) => { try {
  const remarkText = requireText(req.body.remark, 'Remark', 2000);
  const entry = await query(db.from('time_entries').select('user_id').eq('id', req.params.id).is('deleted_at', null).maybeSingle());
  if (!entry) return fail(res, 404, 'Time entry is unavailable');
  const remark = await query(db.from('admin_remarks').insert({ time_entry_id: req.params.id, admin_user_id: req.profile.id, remark: remarkText }).select().single());
  await audit(req, 'ADD_REMARK', 'TIME_ENTRY', req.params.id, 'Added administrator remark');
  publishChatEvent(entry.user_id, { type: 'notification', kind: 'remarks' });
  void publishAdminChatEvent({ type: 'notification', kind: 'remarks' });
  res.status(201).json(remark);
} catch (error) { next(error); } });
app.delete('/v1/time-entries/:id', authenticate, adminOnly, async (req, res, next) => { try {
  const { data: entry, error } = await db.rpc('archive_time_entry_with_audit', {
    p_entry_id: req.params.id, p_actor_user_id: req.profile.id, p_operation: 'DELETE', p_request_id: req.requestId
  });
  if (error) {
    if (error.code === 'P0001' && error.message === 'ENTRY_OPEN') return fail(res, 409, 'Cannot delete an open shift. Clock the employee out first.');
    if (error.code === 'P0001' && error.message === 'ENTRY_NOT_FOUND') return fail(res, 404, 'Time entry is unavailable');
    throw error;
  }
  res.json(entry);
} catch (error) { next(error); } });
app.patch('/v1/time-entries/:id/restore', authenticate, adminOnly, async (req, res, next) => { try {
  const { data: entry, error } = await db.rpc('archive_time_entry_with_audit', {
    p_entry_id: req.params.id, p_actor_user_id: req.profile.id, p_operation: 'RESTORE', p_request_id: req.requestId
  });
  if (error) { if (error.code === 'P0001' && error.message === 'ENTRY_NOT_FOUND') return fail(res, 404, 'Time entry is unavailable'); throw error; }
  res.json(entry);
} catch (error) { next(error); } });
app.delete('/v1/time-entries/:id/permanent', authenticate, adminOnly, async (req, res, next) => { try {
  const { data: entry, error } = await db.rpc('archive_time_entry_with_audit', {
    p_entry_id: req.params.id, p_actor_user_id: req.profile.id, p_operation: 'PERMANENT_DELETE', p_request_id: req.requestId
  });
  if (error) { if (error.code === 'P0001' && error.message === 'ENTRY_NOT_FOUND') return fail(res, 404, 'Time entry is unavailable'); throw error; }
  res.json(entry);
} catch (error) { next(error); } });

app.post('/v1/reports', authenticate, adminOnly, async (req, res, next) => { try {
  const { reportType = 'TEAM_PERFORMANCE', dateFrom, dateTo, filters = {} } = req.body;
  const allowedReportTypes = ['DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM', 'TEAM_PERFORMANCE'];
  if (!allowedReportTypes.includes(reportType) || !isDate(dateFrom) || !isDate(dateTo) || dateFrom > dateTo) return fail(res, 400, 'A valid report type and date range are required');
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return fail(res, 400, 'Report filters must be an object');
  const projectId = optionalUuid(filters.projectId);
  const userId = optionalUuid(filters.userId);
  const departmentId = optionalUuid(filters.departmentId);
  if ([projectId, userId, departmentId].includes(undefined)) return fail(res, 400, 'Invalid report filter ID');
  const safeFilters = { ...(projectId ? { projectId } : {}), ...(userId ? { userId } : {}), ...(departmentId ? { departmentId } : {}) };
  let entries = db.from('time_entries').select(
    departmentId ? 'id, profiles!time_entries_user_id_fkey!inner(department_id)' : 'id',
    { count: 'exact', head: true }
  ).is('deleted_at', null).gte('clock_in_at', `${dateFrom}T00:00:00+08:00`).lt('clock_in_at', new Date(new Date(`${dateTo}T00:00:00+08:00`).getTime() + 86400000).toISOString());
  if (projectId) entries = entries.eq('project_id', projectId);
  if (userId) entries = entries.eq('user_id', userId);
  if (departmentId) entries = entries.eq('profiles.department_id', departmentId);
  const { count, error } = await entries;
  if (error) throw error;
  const report = await query(db.from('reports').insert({ created_by_user_id: req.profile.id, report_type: reportType, date_from: dateFrom, date_to: dateTo, filters: safeFilters, total_records: count || 0 }).select().single());
  await audit(req, 'GENERATE_REPORT', 'REPORT', report.id, `Generated ${reportType} report`);
  res.status(201).json(report);
} catch (error) { next(error); } });
app.get('/v1/reports', authenticate, adminOnly, async (req, res, next) => { try { const paging = pageParams(req); const request = db.from('reports').select('*, profiles!reports_created_by_user_id_fkey(full_name), report_exports(*)', paging.paged ? { count: 'exact' } : undefined).order('generated_at', { ascending: false }); res.json(await pagedResult(request, paging)); } catch (error) { next(error); } });
app.post('/v1/reports/:id/exports', authenticate, adminOnly, async (req, res, next) => { try { const fileName = requireText(req.body.fileName, 'File name', 255); const fileType = req.body.fileType || 'PDF'; const fileUrl = optionalText(req.body.fileUrl, 2048); if (!['CSV', 'XLSX', 'PDF'].includes(fileType) || fileUrl === undefined) return fail(res, 400, 'Invalid export details'); const item = await query(db.from('report_exports').insert({ report_id: req.params.id, exported_by_user_id: req.profile.id, file_name: fileName, file_type: fileType, file_url: fileUrl }).select().single()); await audit(req, 'EXPORT_REPORT', 'REPORT', req.params.id, `Exported ${fileType} report`); res.status(201).json(item); } catch (error) { next(error); } });
app.post('/v1/time-entry-exports', authenticate, adminOnly, async (req, res, next) => { try {
  const format = ['PDF', 'XLSX', 'CSV'].includes(req.body.format) ? req.body.format : null;
  const { dateFrom, dateTo, filters = {} } = req.body;
  if (!format || !isDate(dateFrom) || !isDate(dateTo) || dateFrom > dateTo || !filters || typeof filters !== 'object' || Array.isArray(filters)) return fail(res, 400, 'Provide valid export details');
  const projectId = optionalUuid(filters.projectId); const userId = optionalUuid(filters.userId);
  const status = filters.status || null;
  if ([projectId, userId].includes(undefined) || ![null, 'ACTIVE', 'COMPLETED'].includes(status)) return fail(res, 400, 'Invalid export filters');
  let entries = db.from('time_entries').select('id', { count: 'exact', head: true }).is('deleted_at', null)
    .gte('clock_in_at', `${dateFrom}T00:00:00+08:00`)
    .lt('clock_in_at', new Date(new Date(`${dateTo}T00:00:00+08:00`).getTime() + 86400000).toISOString());
  if (projectId) entries = entries.eq('project_id', projectId);
  if (userId) entries = entries.eq('user_id', userId);
  if (status === 'ACTIVE') entries = entries.is('clock_out_at', null);
  if (status === 'COMPLETED') entries = entries.not('clock_out_at', 'is', null);
  const { count, error } = await entries;
  if (error) throw error;
  const safeFilters = { ...(projectId ? { projectId } : {}), ...(userId ? { userId } : {}), ...(status ? { status } : {}) };
  const report = await query(db.from('reports').insert({ created_by_user_id: req.profile.id, report_type: 'CUSTOM', date_from: dateFrom, date_to: dateTo, filters: safeFilters, total_records: count || 0 }).select().single());
  await query(db.from('report_exports').insert({ report_id: report.id, exported_by_user_id: req.profile.id, file_name: `time-entries-${dateFrom}-to-${dateTo}.${format.toLowerCase()}`, file_type: format, file_url: null }));
  await query(db.from('audit_logs').insert({ user_id: req.profile.id, action: 'EXPORT_TIME_ENTRIES', entity_type: 'REPORT', entity_id: report.id, description: `Exported ${count || 0} time entries as ${format} for ${dateFrom} to ${dateTo}`, ip_address: req.ip, user_agent: req.get('user-agent'), request_id: req.requestId }));
  res.status(201).json(report);
} catch (error) { next(error); } });
app.delete('/v1/reports/:id', authenticate, adminOnly, async (req, res, next) => { try {
  const report = await query(db.from('reports').delete().eq('id', req.params.id).select().single());
  await audit(req, 'DELETE_REPORT', 'REPORT', report.id, `Deleted generated ${report.report_type} report`);
  res.json(report);
} catch (error) { next(error); } });
app.get('/v1/audit-logs', authenticate, adminOnly, async (req, res, next) => { try { const paging = pageParams(req); let request = db.from('audit_logs').select('*, profiles(full_name,email)', paging.paged ? { count: 'exact' } : undefined).order('created_at', { ascending: false }); if (req.query.q) request = request.or(`action.ilike.%${String(req.query.q).replace(/[,()]/g, ' ')}%,description.ilike.%${String(req.query.q).replace(/[,()]/g, ' ')}%`); if (!paging.paged) request = request.limit(250); res.json(await pagedResult(request, paging)); } catch (error) { next(error); } });

app.use((error, _, res, __) => {
  // Keep diagnostics server-side. Never return database/provider details,
  // paths, or request data to a browser.
  console.error(error?.message || error);
  if (error?.message === 'Origin is not allowed') return fail(res, 403, 'Origin is not allowed');
  if (error?.type === 'entity.parse.failed') return fail(res, 400, 'Request body must contain valid JSON');
  if (error?.type === 'entity.too.large') return fail(res, 413, 'Request body is too large');
  if (error?.status && error.expose) return fail(res, error.status, error.message);
  if (error?.code === '23505') return fail(res, 409, 'A record with that value already exists');
  if (error?.code === '23503') return fail(res, 409, 'This record is connected to company history and must remain archived');
  fail(res, 500, 'Unexpected server error');
});
app.listen(process.env.PORT || 3000);
