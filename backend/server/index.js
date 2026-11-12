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
import { countActiveEmployeeClockIns } from './clock-in-count.js';
import { createSessionSecurity } from './session-security.js';

const required = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY'];
const missing = required.filter(name => !process.env[name]);
if (missing.length) throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
});

const sessionSecurity = createSessionSecurity(db);
const cloudinaryConfigured = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'].every(key => Boolean(process.env[key]));
if (cloudinaryConfigured) cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET, secure: true });
const app = express();
const authUserCache = new Map();
const profileCache = new Map();
const avatarPersistenceCache = new Map();
const revokedTokenCache = new Map();
const referenceDataCache = new Map();
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

const isTokenRevoked = tokenKey => revokedTokenCache.get(tokenKey) > Date.now();
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

const sendWithGmailApi = async ({ from, to, replyTo, subject, text, html }) => {
  const accessToken = await getGmailAccessToken();
  // RFC 2822 message encoded as base64url, as required by Gmail's send API.
  // Values originate from validated email addresses and fixed application text.
  const raw = [
    `From: ${emailHeader(from)}`,
    `To: ${emailHeader(to)}`,
    ...(replyTo ? [`Reply-To: ${emailHeader(replyTo)}`] : []),
    `Subject: ${emailHeader(subject)}`,
    'MIME-Version: 1.0',
    ...(html ? [
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
      '--ace-clock-invitation--'
    ] : [
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(text, 'utf8').toString('base64').match(/.{1,76}/g).join('\r\n')
    ]),
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

class InvalidSessionError extends Error {}
const invalidSessionCodes = new Set(['bad_jwt', 'invalid_jwt', 'session_not_found', 'session_expired', 'user_not_found', 'user_banned']);
const getFreshUserFromGoTrue = async token => {
  const { data, error } = await db.auth.getUser(token);
  if (error) {
    if (invalidSessionCodes.has(error.code) || error.name === 'AuthSessionMissingError' ||
        (!error.code && (error.status === 401 || error.status === 403))) {
      throw new InvalidSessionError('Invalid or expired session');
    }
    throw error;
  }
  if (!data?.user) throw new Error('Authentication response did not include a user');
  return data.user;
};

const getUserFromGoTrue = (token, tokenKey) =>
  cached(authUserCache, tokenKey, 30_000, () => getFreshUserFromGoTrue(token));
const respondToAuthFailure = (req, res, error) => {
  if (error instanceof InvalidSessionError) return fail(res, 401, error.message);
  console.warn('Authentication dependency unavailable', { requestId: req.requestId });
  return fail(res, 503, 'ACE could not verify your account right now. Please try again.');
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
    req.profile = await cached(profileCache, user.id, 5_000, () => query(db.from('profiles').select('*').eq('id', user.id).is('permanently_deleted_at', null).maybeSingle()));
    if (!req.profile) return fail(res, 403, 'User profile is not available');
    req.profile = await persistGoogleAvatar(req.profile, user);
    req.authUser = user;
    req.authToken = token;
    req.authTokenCacheKey = tokenKey;
    req.authSessionId = jwt.decode(token)?.session_id;
  } catch (error) { return respondToAuthFailure(req, res, error); }
  return next();
}

const adminOnly = async (req, res, next) => {
  if (req.profile.role !== 'ADMIN' || req.profile.status !== 'ACTIVE') return fail(res, 403, 'Active administrator access required');
  try {
    // Administrator requests deliberately obtain fresh GoTrue metadata. Normal
    // employee requests use local verification and avoid this Auth log line.
    req.authUser = await getFreshUserFromGoTrue(req.authToken);
  } catch (error) { return respondToAuthFailure(req, res, error); }
  return next();
};

const activeOnly = (req, res, next) => req.profile.status === 'ACTIVE' ? next() : fail(res, 403, req.profile.status === 'DENIED'
  ? 'Your account is inactive. Contact an administrator if you believe this is a mistake.'
  : 'Your account is not active. Contact your administrator or HR representative for an invitation.');
const employeeOnly = (req, res, next) => req.profile.role === 'USER' && req.profile.status === 'ACTIVE'
  ? next()
  : fail(res, 403, 'Employee access is required');
const headAdminEmail = process.env.HEAD_ADMIN_EMAIL?.trim().toLowerCase();
if (!headAdminEmail) throw new Error('HEAD_ADMIN_EMAIL is required');
const isHeadAdmin = req => req.profile.email?.toLowerCase() === headAdminEmail;

const helpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  keyGenerator: req => req.profile.id,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'You have sent several help questions. Wait a few minutes before sending another.' }
});

app.post('/v1/help-requests', authenticate, activeOnly, helpRequestLimiter, async (req, res, next) => {
  const question = optionalText(req.body?.question, 1000);
  if (!question) return fail(res, 400, 'Enter a question up to 1,000 characters.');
  try {
    // Saving is the delivery guarantee. Mail is an optional notification.
    const inquiry = await query(db.from('help_inquiries').insert({
      user_id: req.profile.id, sender_name: req.profile.full_name || '',
      sender_email: req.profile.email, question
    }).select('id').single());
    if (gmailConfigured || mailTransport) {
      const message = { from: process.env.GMAIL_FROM?.trim() || process.env.SMTP_FROM || smtpUser,
        to: headAdminEmail, replyTo: req.profile.email, subject: 'ACE Help question',
        text: 'Question from ' + (req.profile.full_name || req.profile.email) + ' (' + req.profile.email + '):\n\n' + question + '\n\nReview it in Administration → Chatbot Inquiry.' };
      try { if (gmailConfigured) await sendWithGmailApi(message); else await mailTransport.sendMail(message); }
      catch (error) { console.warn('ACE Help notification failed; inquiry saved', { requestId: req.requestId, code: error.code }); }
    }
    res.status(201).json({ id: inquiry.id });
  } catch (error) { next(error); }
});

app.get('/v1/help-requests', authenticate, adminOnly, async (req, res, next) => {
  if (!isHeadAdmin(req)) return fail(res, 403, 'Head administrator access required.');
  try {
    const paging = pageParams(req);
    let request = db.from('help_inquiries').select('*', paging.paged ? { count: 'exact' } : undefined).order('created_at', { ascending: false });
    if (req.query.q) {
      const search = String(req.query.q).slice(0, 200).replace(/[%_,().\"\\]/g, ' ');
      request = request.or('question.ilike.%' + search + '%,sender_email.ilike.%' + search + '%,sender_name.ilike.%' + search + '%');
    }
    if (!paging.paged) request = request.limit(100);
    res.json(await pagedResult(request, paging));
  } catch (error) { next(error); }
});

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
  res.set('Cache-Control', 'no-store');
  try {
    // Check database access without counting rows. Leave headroom for Render's
    // five-second deadline, including time to send the HTTP response.
    const { error } = await db.from('profiles').select('id', { head: true }).limit(1)
      .abortSignal(AbortSignal.timeout(3500));
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
  const profile = { ...req.profile, is_head_admin: isHeadAdmin(req),
    queued_clock_reviews_enabled: req.profile.role === 'ADMIN' && process.env.ACE_QUEUED_CLOCK_ENABLED === 'true' };
  let progress;
  try {
    progress = await query(db.from('profile_tutorial_progress').select('tutorial_status,tutorial_step,tutorial_version,tutorial_started_at,tutorial_completed_at,tutorial_skipped_at').eq('profile_id', req.profile.id).eq('role', req.profile.role).maybeSingle());
  } catch (error) {
    console.warn('[onboarding] Tutorial progress unavailable; returning legacy profile', { code: error.code });
    return res.json({ profile });
  }
  res.json({ profile: { ...profile, ...(progress || {
    tutorial_status: 'NOT_STARTED', tutorial_step: 0, tutorial_version: 1,
    tutorial_started_at: null, tutorial_completed_at: null, tutorial_skipped_at: null
  }) } });
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
  const sessionStartedAt = new Date().toISOString();
  await query(db.from('profiles').update({ last_login_at: sessionStartedAt }).eq('id', req.profile.id).select().single());
  await audit(req, 'LOGIN', 'PROFILE', req.profile.id, 'Signed in successfully');
  res.status(204).end();
} catch (error) { next(error); } });

app.post('/v1/auth/session-end', authenticate, async (req, res, next) => { try {
  if (!isUuid(req.authSessionId)) return fail(res, 401, 'Invalid or expired session');
  authUserCache.delete(req.authTokenCacheKey);
  profileCache.delete(req.profile.id);
  revokeToken(req.authTokenCacheKey);
  // Revoke the session without changing the employee's time-entry state.
  await sessionSecurity.end(req.profile.id, req.authSessionId, req.requestId);
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
  const name = requireText(req.body.name, 'Schedule name', 80); const scheduleType = ['FIXED', 'FLEX', 'AS_NEEDED'].includes(req.body.scheduleType) ? req.body.scheduleType : null;
  const startTime = req.body.startTime || null; const endTime = req.body.endTime || null; const dailyElapsedMinutes = Number(req.body.dailyElapsedMinutes || 540);
  const requestedWorkdays = scheduleType === 'AS_NEEDED' ? [] : req.body.workdays === undefined ? [1, 2, 3, 4, 5] : req.body.workdays;
  const workdays = Array.isArray(requestedWorkdays) ? [...new Set(requestedWorkdays.map(Number))].sort((a, b) => a - b) : null;
  if (!scheduleType || !Array.isArray(workdays) || (scheduleType !== 'AS_NEEDED' && !workdays.length) || workdays.some(day => !Number.isInteger(day) || day < 0 || day > 6) || !Number.isInteger(dailyElapsedMinutes) || dailyElapsedMinutes < 60 || dailyElapsedMinutes > 1440 || (scheduleType === 'FIXED' && (!isTime(startTime) || !isTime(endTime)))) return fail(res, 400, 'Provide valid schedule details and at least one workday');
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

app.get('/v1/admin-dashboard/active-clock-in-count', authenticate, adminOnly, async (req, res, next) => { try {
  res.json({ count: await countActiveEmployeeClockIns(db) });
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
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const role = req.body.role === 'ADMIN' ? 'ADMIN' : 'USER';
  if (!email || email.length > 254 || !emailPattern.test(email)) return fail(res, 400, 'A valid email is required');
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

const listTimeEntries = async (req, res, next) => { try {
  const listingKeys = ['page', 'pageSize', 'mine', 'removed', 'userId', 'projectId', 'status', 'remarks'];
  if (req.method === 'GET' && Object.keys(req.query).some(key => !listingKeys.includes(key))) {
    return fail(res, 400, 'Search now requires POST. Please refresh this page and try again.');
  }
  const filters = req.method === 'POST' ? (req.body || {}) : req.query;
  const search = req.method === 'POST' ? (req.body || {}) : {};
  const own = req.profile.role !== 'ADMIN' || filters.mine === 'true'; const page = Math.max(1, Number.parseInt(filters.page, 10) || 1); const pageSize = Math.min(100, Math.max(1, Number.parseInt(filters.pageSize, 10) || 25)); const paged = filters.page !== undefined;
  let request = db.from('time_entries').select('*, projects(name), profiles!time_entries_user_id_fkey(full_name,email,role,profile_picture_url), stopped_by:profiles!time_entries_stopped_by_user_id_fkey(full_name,email)', paged ? { count: 'exact' } : undefined).order('clock_in_at', { ascending: false });
  request = filters.removed === 'true' && req.profile.role === 'ADMIN' ? request.not('deleted_at', 'is', null) : request.is('deleted_at', null);
  if (own) request = request.eq('user_id', req.profile.id);
  if (filters.userId) request = request.eq('user_id', filters.userId);
  if (filters.projectId) request = request.eq('project_id', filters.projectId);
  if (filters.status === 'ACTIVE') request = request.is('clock_out_at', null);
  if (filters.status === 'COMPLETED') request = request.not('clock_out_at', 'is', null);
  const matchingIds = async (table, field, value) => {
    const term = String(value || '').trim().replace(/[,()]/g, ' '); if (!term) return null;
    const records = await query(db.from(table).select('id').ilike(field, `%${term}%`)); return records.map(record => record.id);
  };
  if (search.employee) { const ids = await matchingIds('profiles', 'full_name', search.employee); if (!ids?.length) return res.json(paged ? { items: [], total: 0, page, pageSize } : []); request = request.in('user_id', ids); }
  if (search.project) { const ids = await matchingIds('projects', 'name', search.project); if (!ids?.length) return res.json(paged ? { items: [], total: 0, page, pageSize } : []); request = request.in('project_id', ids); }
  if (filters.remarks === 'with' || filters.remarks === 'without') {
    const remarks = await query(db.from('admin_remarks').select('time_entry_id'));
    const ids = [...new Set(remarks.map(remark => remark.time_entry_id))];
    if (filters.remarks === 'with') { if (!ids.length) return res.json(paged ? { items: [], total: 0, page, pageSize } : []); request = request.in('id', ids); }
    else if (ids.length) request = request.not('id', 'in', `(${ids.join(',')})`);
  }
  if (search.q) {
    const term = String(search.q).trim().replace(/[,()]/g, ' ');
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
} catch (error) { next(error); } };
// GET serves listing controls only; private text searches are accepted in POST bodies.
app.get('/v1/time-entries', authenticate, activeOnly, listTimeEntries);
app.post('/v1/time-entries/search', authenticate, activeOnly, listTimeEntries);
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

// Enable only after the employee outbox and administrator review workflow ship.
function queuedClockEnabled(req, res, next) {
  if (process.env.ACE_QUEUED_CLOCK_ENABLED !== 'true') return fail(res, 404, 'Queued clock actions are unavailable');
  return next();
}

function queuedClockPayload(body) {
  if (!isUuid(body?.actionId) || !['clock_in', 'clock_out'].includes(body.type)) return null;
  const { actionId, type, tappedAt, anchorElapsedMs } = body;
  if (typeof tappedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(tappedAt)
      || tappedAt.startsWith('0000') || !Number.isFinite(Date.parse(tappedAt))
      || new Date(tappedAt).toISOString() !== tappedAt) return null;
  const projectId = optionalUuid(body.projectId);
  const entryId = optionalUuid(body.entryId);
  const clockInActionId = optionalUuid(body.clockInActionId);
  const anchorId = optionalUuid(body.anchorId);
  if ([projectId, entryId, clockInActionId, anchorId].includes(undefined)) return null;
  if (anchorId ? (!Number.isInteger(anchorElapsedMs) || anchorElapsedMs < 0 || anchorElapsedMs > 900_000)
    : anchorElapsedMs != null) return null;
  const note = optionalText(body.note, 50);
  if (type === 'clock_out' && (!note || note.includes('\0') || projectId || Boolean(entryId) === Boolean(clockInActionId))) return null;
  if (type === 'clock_in' && (entryId || clockInActionId || body.note != null)) return null;
  if (clockInActionId?.toLowerCase() === actionId.toLowerCase()) return null;
  return { actionId: actionId.toLowerCase(), payload: { type, tappedAt,
    projectId: projectId?.toLowerCase() ?? null, entryId: entryId?.toLowerCase() ?? null,
    clockInActionId: clockInActionId?.toLowerCase() ?? null, note,
    anchorId: anchorId?.toLowerCase() ?? null, anchorElapsedMs: anchorElapsedMs ?? null } };
}

function queuedClockPilot(req, res, next) {
  if (process.env.ACE_QUEUED_CLOCK_ALL_ACTIVE_EMPLOYEES === 'true') return next();
  const users = String(process.env.ACE_QUEUED_CLOCK_PILOT_USER_IDS || '').toLowerCase().split(',').map(value => value.trim());
  if (!users.includes(req.profile.id.toLowerCase())) return fail(res, 404, 'Queued clock actions are unavailable');
  return next();
}

app.post('/v1/time-entries/clock-sync/anchor', queuedClockEnabled, authenticate, employeeOnly, queuedClockPilot, async (req, res, next) => {
  try {
    if (process.env.ACE_QUEUED_CLOCK_PAUSED === 'true') return fail(res, 423, 'New queued taps are paused');
    if (!isUuid(req.authSessionId)) return fail(res, 401, 'Invalid or expired session');
    try {
      await sessionSecurity.authorizeVerifiedToken(req.authToken, req.profile.id);
    } catch (error) {
      if (error.status === 503) throw error;
      return fail(res, 401, 'Invalid or expired session');
    }
    const anchor = await query(db.from('clock_sync_anchors')
      .insert({ user_id: req.profile.id, session_id: req.authSessionId }).select('id,server_at').single());
    res.status(201).json({ anchorId: anchor.id, serverAt: anchor.server_at, queueLeaseSeconds: 86400 });
  } catch (error) { next(error); }
});

app.post('/v1/time-entries/clock-sync', queuedClockEnabled, authenticate, employeeOnly, queuedClockPilot, async (req, res, next) => {
  try {
    const receivedAt = new Date().toISOString();
    if (!isUuid(req.authSessionId)) return fail(res, 401, 'Invalid or expired session');
    const action = queuedClockPayload(req.body);
    if (!action) return fail(res, 400, 'Invalid queued clock action');
    const result = await query(db.rpc('sync_queued_clock_action', {
      p_user_id: req.profile.id, p_session_id: req.authSessionId, p_action_id: action.actionId,
      p_payload: action.payload, p_received_at: receivedAt, p_ip_address: req.ip,
      p_user_agent: req.get('user-agent'), p_request_id: req.requestId
    }));
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
});

app.get('/v1/time-entries/clock-sync/receipts/:id', queuedClockEnabled, authenticate, employeeOnly, queuedClockPilot, async (req, res, next) => {
  try {
    const owner = req.profile.id;
    const [receipt, reviews] = await Promise.all([
      query(db.from('queued_clock_actions').select('response,status_code,tapped_at,received_at').eq('user_id', owner).eq('action_id', req.params.id).maybeSingle()),
      query(db.from('queued_clock_reviews').select('code,decision,decision_reason,decided_at,accepted_entry,bucket').eq('user_id', owner).eq('action_id', req.params.id))
    ]);
    if (!receipt) return fail(res, 404, 'No matching clock action received');
    const mismatch = req.query.mismatch === '1';
    const review = reviews.find(item => mismatch ? item.code === 'ACTION_PAYLOAD_MISMATCH' : item.code !== 'ACTION_PAYLOAD_MISMATCH');
    if (mismatch && !review) return fail(res, 404, 'No matching clock review received');
    const original = mismatch
      ? { state: 'needs_review', code: review.code, bucket: review.bucket }
      : receipt.response;
    const outcome = !review?.decision ? original : {
      state: review.decision === 'accepted' ? 'confirmed' : 'rejected',
      code: review.code, reason: review.decision_reason, decidedAt: review.decided_at,
      entry: review.accepted_entry,
      acceptedLate: Date.parse(receipt.received_at) - Date.parse(receipt.tapped_at) > 600000
    };
    res.json({ outcome });
  } catch (error) { next(error); }
});

const queuedReviewSelect = '*, employee:profiles!queued_clock_reviews_user_id_fkey(full_name,email), reviewer:profiles!queued_clock_reviews_decided_by_fkey(full_name,email)';
const queuedReceiptFields = 'user_id,action_id,payload,tapped_at,received_at,clock_error_ms,device_category,status_code,response';

app.get('/v1/queued-clock-reviews', queuedClockEnabled, authenticate, adminOnly, async (req, res, next) => {
  try {
    const paging = { ...pageParams(req), paged: true };
    const bucket = req.query.bucket || 'timing';
    if (!['timing', 'integrity', 'missing'].includes(bucket)) return fail(res, 400, 'Unknown review bucket');
    let request = db.from('queued_clock_reviews').select(queuedReviewSelect, { count: 'exact' }).eq('bucket', bucket)
      .order('opened_at', { ascending: false }).order('id');
    request = req.query.resolved === 'true' ? request.not('decision', 'is', null) : request.is('decision', null);
    res.json(await pagedResult(request, paging));
  } catch (error) { next(error); }
});

app.get('/v1/queued-clock-reviews/metrics', queuedClockEnabled, authenticate, adminOnly, async (_req, res, next) => {
  try { res.json(await query(db.rpc('queued_clock_weekly_metrics'))); }
  catch (error) { next(error); }
});

app.get('/v1/queued-clock-reviews/:id', queuedClockEnabled, authenticate, adminOnly, async (req, res, next) => {
  try {
    const review = await query(db.from('queued_clock_reviews').select(queuedReviewSelect).eq('id', req.params.id).maybeSingle());
    if (!review) return fail(res, 404, 'Review was not found');
    const getReceipt = id => query(db.from('queued_clock_actions').select(queuedReceiptFields)
      .eq('user_id', review.user_id).eq('action_id', id).maybeSingle());
    const receipt = review.action_id ? await getReceipt(review.action_id) : null;
    const payload = receipt?.payload;
    let entryId = review.accepted_entry?.id || payload?.entryId || receipt?.response?.entry?.id;
    if (!entryId && payload?.clockInActionId) {
      const [dependency, accepted] = await Promise.all([
        getReceipt(payload.clockInActionId),
        query(db.from('queued_clock_reviews').select('accepted_entry').eq('user_id', review.user_id)
          .eq('action_id', payload.clockInActionId).eq('decision', 'accepted').maybeSingle())
      ]);
      entryId = dependency?.response?.entry?.id || accepted?.accepted_entry?.id;
    }
    let shift = null;
    const shifts = () => db.from('time_entries').select('id,clock_in_at,clock_out_at,deleted_at,final_note,stopped_by_at').eq('user_id', review.user_id);
    if (entryId) shift = await query(shifts().eq('id', entryId).maybeSingle());
    else if (payload?.type === 'clock_in') {
      shift = await query(shifts().is('deleted_at', null).or(`clock_out_at.is.null,clock_out_at.gt.${receipt.tapped_at}`)
        .order('clock_in_at', { ascending: false }).limit(1).maybeSingle());
    }
    let matchingReceipt = null;
    if (review.bucket === 'missing') {
      const { reportedAt, reportedActionId, type } = review.evidence;
      const request = db.from('queued_clock_actions').select('action_id,tapped_at,received_at').eq('user_id', review.user_id);
      if (reportedActionId) matchingReceipt = await query(request.eq('action_id', reportedActionId).maybeSingle());
      else {
        const reported = Date.parse(reportedAt);
        matchingReceipt = await query(request.eq('payload->>type', type)
          .gte('tapped_at', new Date(reported - 900000).toISOString()).lte('tapped_at', new Date(reported + 900000).toISOString())
          .order('received_at').limit(1).maybeSingle());
      }
    }
    res.json({ review, receipt, shift, matchingReceipt });
  } catch (error) { next(error); }
});

app.post('/v1/queued-clock-reviews/missing', queuedClockEnabled, authenticate, adminOnly, async (req, res, next) => {
  try {
    const { userId, type, reportedAt } = req.body;
    const actionId = optionalUuid(req.body.actionId);
    const detail = requireText(req.body.detail, 'Report details', 1000);
    if (!isUuid(userId) || actionId === undefined || !['clock_in', 'clock_out'].includes(type) ||
        !isTimestamp(reportedAt) || !/(Z|[+-]\d\d:\d\d)$/.test(reportedAt)) return fail(res, 400, 'Supply an employee, action and report time');
    const result = await query(db.rpc('open_missing_clock_review', {
      p_actor: req.profile.id, p_user: userId, p_type: type, p_reported_at: reportedAt,
      p_detail: detail, p_action_id: actionId, p_request_id: req.requestId
    }));
    if (result.error) return fail(res, result.status, result.error);
    res.status(result.status).json(result.review);
  } catch (error) { next(error); }
});

app.post('/v1/queued-clock-reviews/:id/decision', queuedClockEnabled, authenticate, adminOnly, async (req, res, next) => {
  try {
    const { decision } = req.body;
    const reason = requireText(req.body.reason, 'Decision reason', 1000);
    if (!['accepted', 'rejected'].includes(decision)) return fail(res, 400, 'Choose Accept or Reject');
    const result = await query(db.rpc('resolve_queued_clock_review', {
      p_actor: req.profile.id, p_id: req.params.id, p_decision: decision, p_reason: reason, p_request_id: req.requestId
    }));
    if (result.error) return fail(res, result.status, result.error);
    res.status(result.status).json(result.review);
  } catch (error) { next(error); }
});

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
