// Akio <3: Project source maintained by Akio Zaki Salomon.
import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
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
  allowedHeaders: ['Authorization', 'Content-Type'],
  maxAge: 600
}));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
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
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
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
const sendInvitationEmail = async ({ email, role, invitedBy }) => {
  if (!gmailConfigured && !mailTransport) return false;
  const recipient = htmlEscape(email);
  const inviter = htmlEscape(invitedBy || 'an ACE administrator');
  const roleName = role === 'ADMIN' ? 'Administrator' : 'Employee';
  const loginUrl = `${applicationUrl}/login`;
  const message = {
    from: process.env.GMAIL_FROM?.trim() || process.env.SMTP_FROM || smtpUser,
    to: email,
    subject: 'You are invited to ACE Clock In/Out',
    text: `Hello,\n\n${invitedBy || 'An ACE administrator'} invited you to ACE Clock In/Out as an ${roleName}.\n\nStart here: ${loginUrl}\n\nGetting started:\n1. Sign in with the exact Google email that received this invitation.\n2. Complete your profile settings.\n3. Clock in when you start work.\n4. Clock out when your shift is complete.\n\nACE Outsource Solutions`,
    html: `<main style="max-width:620px;margin:0 auto;padding:32px 24px;font-family:Arial,sans-serif;color:#073b4c;background:#f4fbfc"><section style="overflow:hidden;background:#fff;border:1px solid #cfe7eb;border-radius:18px"><header style="padding:28px 30px;background:#073b4c;color:#fff"><p style="margin:0 0 8px;font-size:12px;font-weight:bold;letter-spacing:1.2px">ACE OUTSOURCE SOLUTIONS</p><h1 style="margin:0;font-size:26px">You’re invited</h1></header><div style="padding:30px"><p style="margin-top:0;font-size:16px">Hello,</p><p><strong>${inviter}</strong> invited <strong>${recipient}</strong> to ACE Clock In/Out as an <strong>${roleName}</strong>.</p><p style="margin:24px 0"><a href="${loginUrl}" style="display:inline-block;padding:13px 20px;color:#fff;background:#08a2c2;border-radius:8px;font-weight:bold;text-decoration:none">Sign in to ACE Clock</a></p><h2 style="margin:28px 0 12px;font-size:18px">Get started in four steps</h2><ol style="padding-left:22px;line-height:1.7"><li>Sign in with the exact Google email that received this invitation.</li><li>Open <strong>Profile &amp; settings</strong> and complete your account details.</li><li>Choose <strong>Clock In</strong> when you begin work.</li><li>Choose <strong>Clock Out</strong> after your shift, then review your time entries.</li></ol><p style="margin:28px 0 0;color:#587680;font-size:13px">If you cannot sign in, make sure you are using the same Google account this invitation was sent to.</p></div></section></main>`
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
  const candidates = [
    user?.user_metadata?.avatar_url,
    user?.user_metadata?.picture,
    ...((user?.identities || []).flatMap(identity => [identity.identity_data?.avatar_url, identity.identity_data?.picture]))
  ];
  return candidates.find(value => {
    if (typeof value !== 'string' || value.length > 2048) return false;
    try { return new URL(value).protocol === 'https:'; } catch { return false; }
  }) || null;
};
// A custom Cloudinary photo is always preferred. Google metadata is used only
// as a display fallback, so older accounts do not degrade to an initial while
// their provider already has a picture available.
const applyGoogleAvatarFallback = (profiles, authUsers = []) => {
  const googleAvatarById = new Map(authUsers.map(user => [user.id, googleAvatarUrl(user)]));
  return profiles.map(profile => ({
    ...profile,
    profile_picture_url: profile.profile_picture_url || googleAvatarById.get(profile.id) || null
  }));
};
const listAuthUsersForAvatars = async () => {
  const result = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  // Avatar enrichment must never take down a normal people list if Supabase
  // Auth is temporarily unavailable.
  return result.error ? [] : result.data.users;
};

async function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return fail(res, 401, 'Missing bearer token');
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) return fail(res, 401, 'Invalid or expired session');
  try {
    req.profile = await query(db.from('profiles').select('*').eq('id', user.id).is('permanently_deleted_at', null).single());
    // Backfill an older Google account that was created before avatar metadata
    // was stored. A Cloudinary upload always wins and is never overwritten.
    const googleAvatar = googleAvatarUrl(user);
    if (!req.profile.profile_picture_url && !req.profile.profile_picture_public_id && googleAvatar) {
      const { data, error: avatarError } = await db.from('profiles')
        .update({ profile_picture_url: googleAvatar })
        .eq('id', req.profile.id)
        .is('profile_picture_url', null)
        .select()
        .maybeSingle();
      if (!avatarError && data) req.profile = data;
    }
    req.authUser = user;
    next();
  } catch { return fail(res, 403, 'User profile is not available'); }
}
const adminOnly = (req, res, next) => req.profile.role === 'ADMIN' && req.profile.status === 'ACTIVE'
  ? next()
  : fail(res, 403, 'Active administrator access required');
const activeOnly = (req, res, next) => req.profile.status === 'ACTIVE' ? next() : fail(res, 403, req.profile.status === 'DENIED'
  ? 'Your access request was denied. Contact an administrator if you believe this is a mistake.'
  : 'Your account is awaiting approval');
const employeeOnly = (req, res, next) => req.profile.role === 'USER' && req.profile.status === 'ACTIVE'
  ? next()
  : fail(res, 403, 'Employee access is required');
const canChatWith = (profile, contact) => profile.role === 'ADMIN' || contact.role === 'ADMIN';
const headAdminEmail = process.env.HEAD_ADMIN_EMAIL?.trim().toLowerCase();
if (!headAdminEmail) throw new Error('HEAD_ADMIN_EMAIL is required');
const specialAdminOnly = (req, res, next) => req.profile.role === 'ADMIN' && req.profile.status === 'ACTIVE' && req.profile.email?.toLowerCase() === headAdminEmail
  ? next()
  : fail(res, 403, 'This administrator feature is restricted');
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
  await db.from('audit_logs').insert({ user_id: req.profile?.id || null, action, entity_type: entityType, entity_id: isUuid(entityId) ? entityId : null, description, ip_address: req.ip, user_agent: req.get('user-agent') }).then(({ error }) => { if (error) console.error('audit log:', error.message); });
}
function clockingDevice(req) {
  const userAgent = req.get('user-agent') || '';
  return /Android|iPhone|iPad|iPod|Mobile|Windows Phone|IEMobile|Opera Mini/i.test(userAgent) ? 'mobile' : 'pc web';
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
app.get('/v1/me', authenticate, (req, res) => res.json({
  profile: { ...req.profile, is_head_admin: isHeadAdmin(req) }
}));
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
  const changes = {
    tutorial_status: status,
    tutorial_step: step,
    tutorial_version: version,
    ...(status === 'NOT_STARTED' ? { tutorial_started_at: null, tutorial_completed_at: null, tutorial_skipped_at: null } : {}),
    ...(status === 'IN_PROGRESS' ? { tutorial_started_at: req.profile.tutorial_started_at || now } : {}),
    ...(status === 'COMPLETED' ? { tutorial_completed_at: now } : {}),
    ...(status === 'SKIPPED' ? { tutorial_skipped_at: now } : {})
  };
  const profile = await query(db.from('profiles').update(changes).eq('id', req.profile.id).select().single());
  res.json({ profile: { ...profile, is_head_admin: isHeadAdmin(req) } });
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
  await query(db.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', req.profile.id).select().single());
  res.status(204).end();
} catch (error) { next(error); } });
app.post('/v1/auth/session-end', authenticate, async (req, res, next) => { try {
  await query(db.from('profiles').update({ last_logout_at: new Date().toISOString() }).eq('id', req.profile.id).select().single());
  await audit(req, 'LOGOUT', 'PROFILE', req.profile.id, 'Signed out successfully');
  res.status(204).end();
} catch (error) { next(error); } });
app.post('/v1/access-requests', sensitiveActionLimiter, authenticate, async (req, res, next) => { try {
  if (req.profile.status === 'DENIED') return fail(res, 403, 'Your access request was denied. Contact an administrator if you believe this is a mistake.');
  const email = req.profile.email.trim().toLowerCase();
  if (!isAllowedCompanyEmail(email)) return fail(res, 403, 'Use an approved company email address to request access.');
  const now = new Date();
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const [active, profileRecent, ipRecent] = await Promise.all([
    query(db.from('access_requests').select('id, expires_at').eq('profile_id', req.profile.id).eq('status', 'PENDING').gt('expires_at', now.toISOString()).maybeSingle()),
    query(db.from('access_requests').select('id').eq('profile_id', req.profile.id).gte('created_at', tenMinutesAgo)),
    query(db.from('access_requests').select('id').eq('request_ip', req.ip).gte('created_at', tenMinutesAgo))
  ]);
  if (active) return fail(res, 409, 'You already have a request awaiting review.');
  if (profileRecent.length >= 2 || ipRecent.length >= 5) return fail(res, 429, 'Too many access requests. Please wait 10 minutes before trying again.');
  const requestedDepartment = optionalText(req.body.department, 160);
  const message = optionalText(req.body.message, 1000);
  if (requestedDepartment === undefined || message === undefined) return fail(res, 400, 'Request text exceeds the allowed length');
  const requestValues = {
    profile_id: req.profile.id, email, full_name: req.profile.full_name || req.authUser.user_metadata?.full_name || '',
    requested_department: requestedDepartment, message,
    requested_role: 'USER', request_ip: req.ip, expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
  };
  // The schema retains one row per email. Re-open an expired pending request
  // rather than letting that historical row prevent the person from asking again.
  const expired = await query(db.from('access_requests').select('id').eq('profile_id', req.profile.id).eq('status', 'PENDING').lte('expires_at', now.toISOString()).maybeSingle());
  const request = expired
    ? await query(db.from('access_requests').update(requestValues).eq('id', expired.id).select().single())
    : await query(db.from('access_requests').insert(requestValues).select().single());
  await audit(req, 'REQUEST_ACCESS', 'ACCESS_REQUEST', request.id, 'Requested account approval');
  res.status(201).json({ request });
} catch (error) { next(error); } });
app.get('/v1/access-requests', authenticate, adminOnly, async (_, res, next) => { try {
  const requests = await query(db.from('access_requests').select('*, profiles!access_requests_profile_id_fkey(email,full_name)').order('created_at', { ascending: false }).limit(200));
  const now = Date.now();
  res.json(requests.map(request => ({ ...request, state: request.status === 'PENDING' && new Date(request.expires_at).getTime() <= now ? 'EXPIRED' : request.status })));
} catch (error) { next(error); } });
app.patch('/v1/access-requests/:id', sensitiveActionLimiter, authenticate, adminOnly, async (req, res, next) => { try {
  const decision = req.body.decision;
  const role = req.body.role === 'ADMIN' ? 'ADMIN' : 'USER';
  if (!['APPROVE', 'DENY'].includes(decision)) return fail(res, 400, 'Decision must be APPROVE or DENY');
  const request = await query(db.from('access_requests').select('*').eq('id', req.params.id).single());
  if (request.status !== 'PENDING') return fail(res, 409, 'This request has already been reviewed.');
  if (new Date(request.expires_at).getTime() <= Date.now()) return fail(res, 410, 'This request has expired and cannot be reviewed.');
  if (!request.profile_id) return fail(res, 409, 'This legacy request is not linked to a Google account.');
  const status = decision === 'APPROVE' ? 'ACTIVE' : 'DENIED';
  const departmentId = optionalUuid(req.body.department_id);
  if (departmentId === undefined) return fail(res, 400, 'Invalid department ID');
  if (departmentId) {
    const department = await query(db.from('departments').select('id').eq('id', departmentId).eq('is_active', true).maybeSingle());
    if (!department) return fail(res, 400, 'Department not found or inactive');
  }
  const target = await query(db.from('profiles').select('id,email,role,status').eq('id', request.profile_id).single());
  const profileChanges = decision === 'APPROVE' ? { status, role } : { status };
  if (!await guardProfileLifecycle(req, res, target, profileChanges, { operation: 'access-approval' })) return;
  if (decision === 'APPROVE') {
    await query(db.from('profiles').update({ status, role, department_id: departmentId }).eq('id', request.profile_id).select().single());
  } else {
    await query(db.from('profiles').update({ status }).eq('id', request.profile_id).select().single());
  }
  const reviewed = await query(db.from('access_requests').update({ status, reviewed_at: new Date().toISOString(), reviewed_by_user_id: req.profile.id }).eq('id', request.id).select().single());
  await audit(req, decision === 'APPROVE' ? 'APPROVE_ACCESS_REQUEST' : 'DENY_ACCESS_REQUEST', 'ACCESS_REQUEST', request.id, `${decision === 'APPROVE' ? 'Approved' : 'Denied'} ${request.email}`);
  res.json(reviewed);
} catch (error) { next(error); } });

app.get('/v1/departments', authenticate, activeOnly, async (_, res, next) => { try { res.json(await query(db.from('departments').select('*').order('name'))); } catch (error) { next(error); } });
app.post('/v1/departments', authenticate, adminOnly, async (req, res, next) => { try { const name = requireText(req.body.name, 'Department name'); const description = optionalText(req.body.description, 1000); if (description === undefined) return fail(res, 400, 'Description must be text up to 1000 characters'); const item = await query(db.from('departments').insert({ name, description }).select().single()); await audit(req, 'CREATE', 'DEPARTMENT', item.id, `Created department ${item.name}`); res.status(201).json(item); } catch (error) { next(error); } });
app.patch('/v1/departments/:id', authenticate, adminOnly, async (req, res, next) => { try { const changes = {}; if (req.body.name !== undefined) changes.name = requireText(req.body.name, 'Department name'); if (req.body.description !== undefined) { changes.description = optionalText(req.body.description, 1000); if (changes.description === undefined) return fail(res, 400, 'Description must be text up to 1000 characters'); } if (!Object.keys(changes).length) return fail(res, 400, 'No editable department fields supplied'); const item = await query(db.from('departments').update(changes).eq('id', req.params.id).select().single()); await audit(req, 'UPDATE', 'DEPARTMENT', item.id, `Updated department ${item.name}`); res.json(item); } catch (error) { next(error); } });
app.delete('/v1/departments/:id', authenticate, adminOnly, async (req, res, next) => { try { const item = await query(db.from('departments').delete().eq('id', req.params.id).select().single()); await audit(req, 'DELETE', 'DEPARTMENT', item.id, `Deleted department ${item.name}`); res.json(item); } catch (error) { next(error); } });

app.get('/v1/projects', authenticate, activeOnly, async (_, res, next) => { try { res.json(await query(db.from('projects').select('*').order('name'))); } catch (error) { next(error); } });
app.post('/v1/projects', authenticate, adminOnly, async (req, res, next) => { try { const name = requireText(req.body.name, 'Project name'); const description = optionalText(req.body.description, 1000); if (description === undefined) return fail(res, 400, 'Description must be text up to 1000 characters'); const item = await query(db.from('projects').insert({ name, description }).select().single()); await audit(req, 'CREATE', 'PROJECT', item.id, `Created project ${item.name}`); res.status(201).json(item); } catch (error) { next(error); } });
app.patch('/v1/projects/:id', authenticate, adminOnly, async (req, res, next) => { try { const changes = {}; if (req.body.name !== undefined) changes.name = requireText(req.body.name, 'Project name'); if (req.body.description !== undefined) { changes.description = optionalText(req.body.description, 1000); if (changes.description === undefined) return fail(res, 400, 'Description must be text up to 1000 characters'); } if (!Object.keys(changes).length) return fail(res, 400, 'No editable project fields supplied'); const item = await query(db.from('projects').update(changes).eq('id', req.params.id).select().single()); await audit(req, 'UPDATE', 'PROJECT', item.id, `Updated project ${item.name}`); res.json(item); } catch (error) { next(error); } });
app.delete('/v1/projects/:id', authenticate, adminOnly, async (req, res, next) => { try { const item = await query(db.from('projects').delete().eq('id', req.params.id).select().single()); await audit(req, 'DELETE', 'PROJECT', item.id, `Deleted project ${item.name}`); res.json(item); } catch (error) { next(error); } });
app.get('/v1/schedules', authenticate, adminOnly, async (req, res, next) => { try { res.json(await query(db.from('work_schedules').select('*, user_schedule_assignments(user_id)').order('name'))); } catch (error) { next(error); } });
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
app.put('/v1/users/:id/projects/:projectId', authenticate, adminOnly, async (req, res, next) => { try { const target = await query(db.from('profiles').select('id,email').eq('id', req.params.id).single()); if (!protectHeadAdmin(req, res, target)) return; const item = await query(db.from('user_projects').upsert({ user_id: req.params.id, project_id: req.params.projectId }).select().single()); await audit(req, 'ASSIGN_PROJECT', 'PROFILE', req.params.id, `Assigned project ${req.params.projectId}`); res.json(item); } catch (error) { next(error); } });
app.delete('/v1/users/:id/projects/:projectId', authenticate, adminOnly, async (req, res, next) => { try { const target = await query(db.from('profiles').select('id,email').eq('id', req.params.id).single()); if (!protectHeadAdmin(req, res, target)) return; await query(db.from('user_projects').delete().eq('user_id', req.params.id).eq('project_id', req.params.projectId).select()); await audit(req, 'UNASSIGN_PROJECT', 'PROFILE', req.params.id, `Unassigned project ${req.params.projectId}`); res.status(204).end(); } catch (error) { next(error); } });

app.get('/v1/users', authenticate, adminOnly, async (req, res, next) => { try {
  let request = db.from('profiles').select('*, departments(name)').order('created_at', { ascending: false });
  request = req.query.removed === 'true' ? request.eq('status', 'DENIED') : request.neq('status', 'DENIED');
  request = request.is('permanently_deleted_at', null);
  const [profiles, authUsers] = await Promise.all([
    query(request),
    listAuthUsersForAvatars()
  ]);
  // Older Google profiles may predate avatar persistence. Use their trusted
  // Supabase Auth metadata as a read-time fallback without overwriting an
  // employee's own uploaded profile picture.
  res.json(applyGoogleAvatarFallback(profiles, authUsers).map(profile => ({
    ...profile,
    is_head_admin: profile.email?.toLowerCase() === headAdminEmail
  })));
} catch (error) { next(error); } });
app.get('/v1/employee-chat/contacts', authenticate, activeOnly, async (req, res, next) => { try {
  let contactRequest = db.from('profiles').select('id,full_name,email,role,last_seen_at,profile_picture_url').eq('status', 'ACTIVE').is('permanently_deleted_at', null).neq('id', req.profile.id).order('full_name');
  if (req.profile.role !== 'ADMIN') contactRequest = contactRequest.eq('role', 'ADMIN');
  const [contacts, unread, pendingAccessRequests, authUsers] = await Promise.all([
    query(contactRequest),
    query(db.from('employee_messages').select('sender_id,body,created_at').eq('recipient_id', req.profile.id).is('read_at', null).is('deleted_at', null).order('created_at', { ascending: false })),
    req.profile.role === 'ADMIN'
      ? db.from('access_requests').select('id', { count: 'exact', head: true }).eq('status', 'PENDING').gt('expires_at', new Date().toISOString())
      : Promise.resolve({ count: 0, error: null }),
    listAuthUsersForAvatars()
  ]);
  if (pendingAccessRequests.error) throw pendingAccessRequests.error;
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
    contacts: applyGoogleAvatarFallback(contacts, authUsers).map(contact => ({
      ...contact,
      unread_count: unreadByContact[contact.id]?.count || 0,
      last_unread_message: unreadByContact[contact.id]?.latest?.body || null,
      last_unread_at: unreadByContact[contact.id]?.latest?.created_at || null
    })),
    pending_access_request_count: pendingAccessRequests.count || 0
  });
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
  const message = await query(db.from('employee_messages').insert({ sender_id: req.profile.id, recipient_id: recipientId, body }).select().single());
  res.status(201).json(message);
} catch (error) { next(error); } });
app.patch('/v1/employee-chat/messages/:messageId', authenticate, activeOnly, async (req, res, next) => { try {
  const messageId = optionalUuid(req.params.messageId);
  const body = optionalText(req.body.body, 2000);
  if (!messageId || !body) return fail(res, 400, 'A valid message is required');
  const message = await query(db.from('employee_messages').update({ body, edited_at: new Date().toISOString() }).eq('id', messageId).eq('sender_id', req.profile.id).is('deleted_at', null).select().maybeSingle());
  if (!message) return fail(res, 404, 'Message is not available to edit');
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
app.get('/v1/admin/chat-log', authenticate, specialAdminOnly, async (_, res, next) => { try {
  const [messages, profiles] = await Promise.all([
    query(db.from('employee_messages').select('id,sender_id,recipient_id,body,created_at,edited_at,deleted_at,read_at').order('created_at', { ascending: false }).limit(500)),
    query(db.from('profiles').select('id,full_name,email'))
  ]);
  const people = new Map(profiles.map(profile => [profile.id, profile]));
  res.json(messages.map(message => ({ ...message, sender: people.get(message.sender_id) || null, recipient: people.get(message.recipient_id) || null })));
} catch (error) { next(error); } });
app.patch('/v1/users/:id/approval', authenticate, adminOnly, async (req, res, next) => { try {
  if (!['ACTIVE', 'DENIED'].includes(req.body.status)) return fail(res, 400, 'Status must be ACTIVE or DENIED');
  const target = await query(db.from('profiles').select('id,email,role,status').eq('id', req.params.id).single());
  if (!await guardProfileLifecycle(req, res, target, { status: req.body.status }, { operation: 'approval' })) return;
  const profile = await query(db.from('profiles').update({ status: req.body.status }).eq('id', req.params.id).select().single());
  await audit(req, req.body.status === 'ACTIVE' ? 'APPROVE' : 'DENY', 'PROFILE', profile.id, `${req.body.status} user ${profile.email}`);
  res.json(profile);
} catch (error) { next(error); } });
app.patch('/v1/users/:id/role', authenticate, adminOnly, async (req, res, next) => { try {
  const role = req.body.role === 'ADMIN' ? 'ADMIN' : req.body.role === 'USER' ? 'USER' : null;
  if (!role) return fail(res, 400, 'Role must be ADMIN or USER');
  const target = await query(db.from('profiles').select('*').eq('id', req.params.id).single());
  if (!await guardProfileLifecycle(req, res, target, { role }, { operation: 'role' })) return;
  const profile = await query(db.from('profiles').update({ role }).eq('id', target.id).select().single());
  await audit(req, 'CHANGE_ROLE', 'PROFILE', profile.id, `Changed ${profile.email} role to ${role}`);
  res.json(profile);
} catch (error) { next(error); } });
app.patch('/v1/users/:id/department', authenticate, adminOnly, async (req, res, next) => { try {
  const departmentId = optionalUuid(req.body.departmentId);
  if (departmentId === undefined) return fail(res, 400, 'Invalid department ID');
  const target = await query(db.from('profiles').select('id,email').eq('id', req.params.id).single());
  if (!protectHeadAdmin(req, res, target)) return;
  const profile = await query(db.from('profiles').update({ department_id: departmentId }).eq('id', req.params.id).select().single());
  await audit(req, 'ASSIGN_DEPARTMENT', 'PROFILE', profile.id, `Updated department for ${profile.email}`);
  res.json(profile);
} catch (error) { next(error); } });
app.patch('/v1/users/:id/remove', authenticate, adminOnly, async (req, res, next) => { try {
  const target = await query(db.from('profiles').select('*').eq('id', req.params.id).is('permanently_deleted_at', null).single());
  if (!await guardProfileLifecycle(req, res, target, { status: 'DENIED' }, { operation: 'archive' })) return;
  const { error: banError } = await db.auth.admin.updateUserById(target.id, { ban_duration: '876000h' });
  if (banError) return fail(res, 502, 'The account was not archived because sign-in could not be disabled.');
  const profile = await query(db.from('profiles').update({ status: 'DENIED' }).eq('id', target.id).select().single());
  await audit(req, 'ARCHIVE_USER', 'PROFILE', profile.id, `Archived user ${profile.email}`);
  res.json(profile);
} catch (error) { next(error); } });
app.patch('/v1/users/:id/restore', authenticate, adminOnly, async (req, res, next) => { try {
  const target = await query(db.from('profiles').select('*').eq('id', req.params.id).is('permanently_deleted_at', null).single());
  if (!await guardProfileLifecycle(req, res, target, { status: 'ACTIVE' }, { operation: 'restore' })) return;
  const { error: unbanError } = await db.auth.admin.updateUserById(target.id, { ban_duration: 'none' });
  if (unbanError) return fail(res, 502, 'The account could not be restored because sign-in could not be enabled.');
  const profile = await query(db.from('profiles').update({ status: 'ACTIVE' }).eq('id', target.id).select().single());
  await audit(req, 'RESTORE_USER', 'PROFILE', profile.id, `Restored user ${profile.email}`);
  res.json(profile);
} catch (error) { next(error); } });
app.delete('/v1/users/:id/permanent', authenticate, adminOnly, async (req, res, next) => { try {
  if (req.params.id === req.profile.id) return fail(res, 400, 'You cannot permanently delete your own administrator account.');
  const target = await query(db.from('profiles').select('*').eq('id', req.params.id).is('permanently_deleted_at', null).single());
  if (!protectHeadAdmin(req, res, target)) return;
  if (target.status !== 'DENIED') return fail(res, 409, 'Only archived users can be permanently deleted.');
  await query(db.rpc('permanently_remove_archived_login', { target_user_id: target.id }));
  await audit(req, 'PERMANENT_DELETE_USER', 'PROFILE', target.id, `Permanently deleted archived user ${target.email}`);
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
app.get('/v1/invitations', authenticate, adminOnly, async (_, res, next) => { try { res.json(await query(db.from('invitations').select('*, profiles!invitations_invited_by_user_id_fkey(full_name,email)').order('invited_at', { ascending: false }))); } catch (error) { next(error); } });

app.get('/v1/time-entries', authenticate, activeOnly, async (req, res, next) => { try { const own = req.profile.role !== 'ADMIN' || req.query.mine === 'true'; let request = db.from('time_entries').select('*, projects(name), profiles!time_entries_user_id_fkey(full_name,email,role), stopped_by:profiles!time_entries_stopped_by_user_id_fkey(full_name,email)').order('clock_in_at', { ascending: false }); request = req.query.removed === 'true' && req.profile.role === 'ADMIN' ? request.not('deleted_at', 'is', null) : request.is('deleted_at', null); if (own) request = request.eq('user_id', req.profile.id); res.json(await query(request)); } catch (error) { next(error); } });
app.get('/v1/time-leaderboard', authenticate, adminOnly, async (req, res, next) => { try {
  const [people, entries, authUsers] = await Promise.all([
    query(db.from('profiles').select('id,full_name,profile_picture_url,role').eq('role', 'USER').eq('status', 'ACTIVE').is('permanently_deleted_at', null)),
    query(db.from('time_entries').select('user_id,duration_seconds').is('deleted_at', null).not('duration_seconds', 'is', null)),
    listAuthUsersForAvatars()
  ]);
  const totals = entries.reduce((result, entry) => {
    result[entry.user_id] = (result[entry.user_id] || 0) + Number(entry.duration_seconds || 0);
    return result;
  }, {});
  const ranked = applyGoogleAvatarFallback(people, authUsers).map(person => ({ ...person, tracked_seconds: totals[person.id] || 0 })).sort((a, b) => b.tracked_seconds - a.tracked_seconds || (a.full_name || '').localeCompare(b.full_name || ''));
  const ownIndex = ranked.findIndex(person => person.id === req.profile.id);
  res.json({ leaders: ranked.slice(0, 10), my_rank: ownIndex === -1 ? null : ownIndex + 1, total_people: ranked.length });
} catch (error) { next(error); } });
app.get('/v1/admin-remarks', authenticate, activeOnly, async (req, res, next) => { try {
  let visibleEntryIds = null;
  if (req.profile.role !== 'ADMIN') {
    const entries = await query(db.from('time_entries').select('id').eq('user_id', req.profile.id).is('deleted_at', null));
    visibleEntryIds = entries.map(entry => entry.id);
    if (!visibleEntryIds.length) return res.json([]);
  }
  let request = db.from('admin_remarks').select('*, profiles!admin_remarks_admin_user_id_fkey(full_name,email)').order('created_at', { ascending: false });
  if (visibleEntryIds) request = request.in('time_entry_id', visibleEntryIds);
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
  const entry = await query(db.from('time_entries').insert({ user_id: req.profile.id, project_id: projectId, ...scheduleSnapshot }).select().single());
  const device = clockingDevice(req);
  await audit(req, `CLOCK_IN (${device})`, 'TIME_ENTRY', entry.id, `Started a time entry from ${device}`);
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

app.post('/v1/time-entries/:id/remarks', authenticate, adminOnly, async (req, res, next) => { try { const remarkText = requireText(req.body.remark, 'Remark', 2000); const remark = await query(db.from('admin_remarks').insert({ time_entry_id: req.params.id, admin_user_id: req.profile.id, remark: remarkText }).select().single()); await audit(req, 'ADD_REMARK', 'TIME_ENTRY', req.params.id, 'Added administrator remark'); res.status(201).json(remark); } catch (error) { next(error); } });
app.delete('/v1/time-entries/:id', authenticate, adminOnly, async (req, res, next) => { try {
  const entry = await query(db.from('time_entries').update({ deleted_at: new Date().toISOString(), deleted_by_user_id: req.profile.id }).eq('id', req.params.id).is('deleted_at', null).not('clock_out_at', 'is', null).select().maybeSingle());
  if (!entry) {
    const current = await query(db.from('time_entries').select('id,clock_out_at').eq('id', req.params.id).is('deleted_at', null).maybeSingle());
    if (current?.clock_out_at === null) return fail(res, 409, 'Cannot delete an open shift. Clock the employee out first.');
    return fail(res, 404, 'Time entry is unavailable');
  }
  await audit(req, 'DELETE', 'TIME_ENTRY', entry.id, 'Moved time entry to deleted data');
  res.json(entry);
} catch (error) { next(error); } });
app.patch('/v1/time-entries/:id/restore', authenticate, adminOnly, async (req, res, next) => { try { const entry = await query(db.from('time_entries').update({ deleted_at: null, deleted_by_user_id: null }).eq('id', req.params.id).not('deleted_at', 'is', null).select().single()); await audit(req, 'RESTORE', 'TIME_ENTRY', entry.id, 'Restored time entry'); res.json(entry); } catch (error) { next(error); } });
app.delete('/v1/time-entries/:id/permanent', authenticate, adminOnly, async (req, res, next) => { try {
  const entry = await query(db.from('time_entries').delete().eq('id', req.params.id).not('deleted_at', 'is', null).select().single());
  await audit(req, 'PERMANENT_DELETE', 'TIME_ENTRY', entry.id, 'Permanently deleted archived time entry');
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
app.get('/v1/reports', authenticate, adminOnly, async (_, res, next) => { try { res.json(await query(db.from('reports').select('*, profiles!reports_created_by_user_id_fkey(full_name), report_exports(*)').order('generated_at', { ascending: false }))); } catch (error) { next(error); } });
app.post('/v1/reports/:id/exports', authenticate, adminOnly, async (req, res, next) => { try { const fileName = requireText(req.body.fileName, 'File name', 255); const fileType = req.body.fileType || 'PDF'; const fileUrl = optionalText(req.body.fileUrl, 2048); if (!['CSV', 'XLSX', 'PDF'].includes(fileType) || fileUrl === undefined) return fail(res, 400, 'Invalid export details'); const item = await query(db.from('report_exports').insert({ report_id: req.params.id, exported_by_user_id: req.profile.id, file_name: fileName, file_type: fileType, file_url: fileUrl }).select().single()); await audit(req, 'EXPORT_REPORT', 'REPORT', req.params.id, `Exported ${fileType} report`); res.status(201).json(item); } catch (error) { next(error); } });
app.delete('/v1/reports/:id', authenticate, adminOnly, async (req, res, next) => { try {
  const report = await query(db.from('reports').delete().eq('id', req.params.id).select().single());
  await audit(req, 'DELETE_REPORT', 'REPORT', report.id, `Deleted generated ${report.report_type} report`);
  res.json(report);
} catch (error) { next(error); } });
app.get('/v1/audit-logs', authenticate, adminOnly, async (_, res, next) => { try { res.json(await query(db.from('audit_logs').select('*, profiles(full_name,email)').order('created_at', { ascending: false }).limit(250))); } catch (error) { next(error); } });

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
app.listen(process.env.PORT || 3000, () => console.log(`ACE API listening on ${process.env.PORT || 3000}`));
