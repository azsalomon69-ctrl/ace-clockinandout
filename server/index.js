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
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    // Browser requests must come from an explicitly configured frontend. A
    // request without an Origin header is a non-browser/server request.
    if (!origin || frontendOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed'));
  }
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
app.use('/v1/access-requests', sensitiveActionLimiter);
app.use('/v1/invitations', sensitiveActionLimiter);

const smtpUser = process.env.SMTP_USER?.trim();
// Google displays app passwords in grouped blocks. Whitespace is not part of
// the password, so accepting either the grouped or ungrouped form prevents a
// common Render configuration mistake.
const smtpAppPassword = process.env.SMTP_APP_PASSWORD?.replace(/\s/g, '');
const smtpConfigured = Boolean(smtpUser && smtpAppPassword);
const mailTransport = smtpConfigured ? nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: { user: smtpUser, pass: smtpAppPassword }
}) : null;
const applicationUrl = (frontendOrigins[0] || 'https://ace-clock.vercel.app').replace(/\/$/, '');
const sendInvitationEmail = async ({ email, role, invitedBy }) => {
  if (!mailTransport) return false;
  const recipient = htmlEscape(email);
  const inviter = htmlEscape(invitedBy || 'an ACE administrator');
  const roleName = role === 'ADMIN' ? 'Administrator' : 'Employee';
  const loginUrl = `${applicationUrl}/login`;
  await mailTransport.sendMail({
    from: process.env.SMTP_FROM || smtpUser,
    to: email,
    subject: 'You are invited to ACE Clock In/Out',
    text: `Hello,\n\n${invitedBy || 'An ACE administrator'} invited you to ACE Clock In/Out as an ${roleName}.\n\nStart here: ${loginUrl}\n\nGetting started:\n1. Sign in with the exact Google email that received this invitation.\n2. Complete your profile settings.\n3. Clock in when you start work.\n4. Start and end breaks from your dashboard.\n5. Clock out when your shift is complete.\n\nACE Outsource Solutions`,
    html: `<main style="max-width:620px;margin:0 auto;padding:32px 24px;font-family:Arial,sans-serif;color:#073b4c;background:#f4fbfc"><section style="overflow:hidden;background:#fff;border:1px solid #cfe7eb;border-radius:18px"><header style="padding:28px 30px;background:#073b4c;color:#fff"><p style="margin:0 0 8px;font-size:12px;font-weight:bold;letter-spacing:1.2px">ACE OUTSOURCE SOLUTIONS</p><h1 style="margin:0;font-size:26px">You’re invited</h1></header><div style="padding:30px"><p style="margin-top:0;font-size:16px">Hello,</p><p><strong>${inviter}</strong> invited <strong>${recipient}</strong> to ACE Clock In/Out as an <strong>${roleName}</strong>.</p><p style="margin:24px 0"><a href="${loginUrl}" style="display:inline-block;padding:13px 20px;color:#fff;background:#08a2c2;border-radius:8px;font-weight:bold;text-decoration:none">Sign in to ACE Clock</a></p><h2 style="margin:28px 0 12px;font-size:18px">Get started in five steps</h2><ol style="padding-left:22px;line-height:1.7"><li>Sign in with the exact Google email that received this invitation.</li><li>Open <strong>Profile &amp; settings</strong> and complete your account details.</li><li>Choose <strong>Clock In</strong> when you begin work.</li><li>Use <strong>Start Break</strong> and <strong>End Break</strong> to record break time.</li><li>Choose <strong>Clock Out</strong> after your shift, then review your time entries.</li></ol><p style="margin:28px 0 0;color:#587680;font-size:13px">If you cannot sign in, make sure you are using the same Google account this invitation was sent to.</p></div></section></main>`
  });
  return true;
};
const invitationMailIssue = error => {
  if (!smtpConfigured) return 'Email delivery is not configured on Render.';
  if (error?.code === 'EAUTH') return 'Gmail rejected the sender sign-in. Check SMTP_USER and SMTP_APP_PASSWORD in Render.';
  if (error?.code === 'EENVELOPE') return 'Gmail rejected SMTP_FROM. Use the same Gmail address as SMTP_USER.';
  if (['ECONNECTION', 'ETIMEDOUT', 'ENOTFOUND'].includes(error?.code)) return 'Render could not reach Gmail. Check the Render service logs.';
  return 'The email service could not send this invitation. Check the Render service logs.';
};

const fail = (res, status, message) => res.status(status).json({ error: message });
const query = async builder => { const { data, error } = await builder; if (error) throw error; return data; };
const isUuid = value => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value || '');
const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
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

async function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return fail(res, 401, 'Missing bearer token');
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) return fail(res, 401, 'Invalid or expired session');
  try {
    req.profile = await query(db.from('profiles').select('*').eq('id', user.id).single());
    req.authUser = user;
    next();
  } catch { return fail(res, 403, 'User profile is not available'); }
}
const adminOnly = (req, res, next) => req.profile.role === 'ADMIN' && req.profile.status === 'ACTIVE'
  ? next()
  : fail(res, 403, 'Active administrator access required');
const activeOnly = (req, res, next) => req.profile.status === 'ACTIVE' ? next() : fail(res, 403, 'Your account is awaiting approval');
const employeeOnly = (req, res, next) => req.profile.role === 'USER' && req.profile.status === 'ACTIVE'
  ? next()
  : fail(res, 403, 'Employee access is required');
const canChatWith = (profile, contact) => profile.role === 'ADMIN' || contact.role === 'ADMIN';
const specialAdminOnly = (req, res, next) => req.profile.role === 'ADMIN' && req.profile.status === 'ACTIVE' && req.profile.email?.toLowerCase() === 'azsalomon69@gmail.com'
  ? next()
  : fail(res, 403, 'This administrator feature is restricted');
const isHeadAdmin = req => req.profile.email?.toLowerCase() === 'azsalomon69@gmail.com';
const protectHeadAdmin = (req, res, target) => {
  if (target.email?.toLowerCase() !== 'azsalomon69@gmail.com' || isHeadAdmin(req)) return true;
  fail(res, 403, 'Only the head administrator can change this administrator account.');
  return false;
};
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
app.get('/v1/me', authenticate, (req, res) => res.json({ profile: req.profile }));
app.patch('/v1/me', authenticate, activeOnly, async (req, res, next) => { try {
  const fullName = requireText(req.body.fullName, 'Full name', 160);
  const profile = await query(db.from('profiles').update({ full_name: fullName }).eq('id', req.profile.id).select().single());
  await audit(req, 'UPDATE_PROFILE', 'PROFILE', profile.id, 'Updated profile name');
  res.json({ profile });
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
app.post('/v1/access-requests', authenticate, async (req, res, next) => { try {
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
  const request = await query(db.from('access_requests').insert({
    profile_id: req.profile.id, email, full_name: req.profile.full_name || req.authUser.user_metadata?.full_name || '',
    requested_department: requestedDepartment, message,
    requested_role: 'USER', request_ip: req.ip, expires_at: new Date(now.getTime() + 2 * 60 * 1000).toISOString()
  }).select().single());
  await audit(req, 'REQUEST_ACCESS', 'ACCESS_REQUEST', request.id, 'Requested account approval');
  res.status(201).json({ request });
} catch (error) { next(error); } });
app.get('/v1/access-requests', authenticate, adminOnly, async (_, res, next) => { try {
  const requests = await query(db.from('access_requests').select('*, profiles!access_requests_profile_id_fkey(email,full_name)').order('created_at', { ascending: false }).limit(200));
  const now = Date.now();
  res.json(requests.map(request => ({ ...request, state: request.status === 'PENDING' && new Date(request.expires_at).getTime() <= now ? 'EXPIRED' : request.status })));
} catch (error) { next(error); } });
app.patch('/v1/access-requests/:id', authenticate, adminOnly, async (req, res, next) => { try {
  const decision = req.body.decision;
  const role = req.body.role === 'ADMIN' ? 'ADMIN' : 'USER';
  if (!['APPROVE', 'DENY'].includes(decision)) return fail(res, 400, 'Decision must be APPROVE or DENY');
  const request = await query(db.from('access_requests').select('*').eq('id', req.params.id).single());
  if (request.status !== 'PENDING') return fail(res, 409, 'This request has already been reviewed.');
  if (new Date(request.expires_at).getTime() <= Date.now()) return fail(res, 410, 'This request expired after two minutes.');
  if (!request.profile_id) return fail(res, 409, 'This legacy request is not linked to a Google account.');
  const status = decision === 'APPROVE' ? 'ACTIVE' : 'DENIED';
  const departmentId = optionalUuid(req.body.departmentId);
  if (departmentId === undefined) return fail(res, 400, 'Invalid department ID');
  if (decision === 'APPROVE') await query(db.from('profiles').update({ status, role, department_id: departmentId }).eq('id', request.profile_id).select().single());
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
  const startTime = req.body.startTime || null; const endTime = req.body.endTime || null; const dailyElapsedMinutes = Number(req.body.dailyElapsedMinutes || 540); const breakLimitMinutes = Number(req.body.breakLimitMinutes || 60);
  if (!scheduleType || !Number.isInteger(dailyElapsedMinutes) || dailyElapsedMinutes < 60 || dailyElapsedMinutes > 1440 || !Number.isInteger(breakLimitMinutes) || breakLimitMinutes < 0 || breakLimitMinutes > 360 || (scheduleType === 'FIXED' && (!isTime(startTime) || !isTime(endTime)))) return fail(res, 400, 'Provide valid schedule details');
  const item = await query(db.from('work_schedules').insert({ name, schedule_type: scheduleType, start_time: scheduleType === 'FIXED' ? startTime : null, end_time: scheduleType === 'FIXED' ? endTime : null, daily_elapsed_minutes: dailyElapsedMinutes, break_limit_minutes: breakLimitMinutes, created_by_user_id: req.profile.id }).select().single());
  await audit(req, 'CREATE_SCHEDULE', 'SCHEDULE', item.id, `Created ${scheduleType.toLowerCase()} schedule ${name}`); res.status(201).json(item);
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
  res.json(await query(request));
} catch (error) { next(error); } });
app.get('/v1/employee-chat/contacts', authenticate, activeOnly, async (req, res, next) => { try {
  let contactRequest = db.from('profiles').select('id,full_name,email,role,last_seen_at,profile_picture_url').eq('status', 'ACTIVE').is('permanently_deleted_at', null).neq('id', req.profile.id).order('full_name');
  if (req.profile.role !== 'ADMIN') contactRequest = contactRequest.eq('role', 'ADMIN');
  const [contacts, unread] = await Promise.all([
    query(contactRequest),
    query(db.from('employee_messages').select('sender_id').eq('recipient_id', req.profile.id).is('read_at', null).is('deleted_at', null))
  ]);
  const allowedContactIds = new Set(contacts.map(contact => contact.id));
  const unreadCounts = unread.reduce((counts, message) => {
    if (allowedContactIds.has(message.sender_id)) counts[message.sender_id] = (counts[message.sender_id] || 0) + 1;
    return counts;
  }, {});
  res.json(contacts.map(contact => ({ ...contact, unread_count: unreadCounts[contact.id] || 0 })));
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
app.patch('/v1/users/:id/approval', authenticate, adminOnly, async (req, res, next) => { try { if (!['ACTIVE', 'DENIED'].includes(req.body.status)) return fail(res, 400, 'Status must be ACTIVE or DENIED'); const target = await query(db.from('profiles').select('id,email').eq('id', req.params.id).single()); if (!protectHeadAdmin(req, res, target)) return; const profile = await query(db.from('profiles').update({ status: req.body.status }).eq('id', req.params.id).select().single()); await audit(req, req.body.status === 'ACTIVE' ? 'APPROVE' : 'DENY', 'PROFILE', profile.id, `${req.body.status} user ${profile.email}`); res.json(profile); } catch (error) { next(error); } });
app.patch('/v1/users/:id/role', authenticate, adminOnly, async (req, res, next) => { try {
  const role = req.body.role === 'ADMIN' ? 'ADMIN' : req.body.role === 'USER' ? 'USER' : null;
  if (!role) return fail(res, 400, 'Role must be ADMIN or USER');
  const target = await query(db.from('profiles').select('*').eq('id', req.params.id).single());
  if (!protectHeadAdmin(req, res, target)) return;
  if (target.role === 'ADMIN' && role === 'USER' && target.status === 'ACTIVE') {
    const admins = await query(db.from('profiles').select('id').eq('role', 'ADMIN').eq('status', 'ACTIVE'));
    if (admins.length <= 1) return fail(res, 400, 'At least one active administrator must remain.');
  }
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
  if (req.params.id === req.profile.id) return fail(res, 400, 'You cannot remove your own administrator account.');
  const target = await query(db.from('profiles').select('*').eq('id', req.params.id).is('permanently_deleted_at', null).single());
  if (!protectHeadAdmin(req, res, target)) return;
  if (target.status === 'DENIED') return fail(res, 409, 'This user has already been removed.');
  if (target.role === 'ADMIN') {
    const admins = await query(db.from('profiles').select('id').eq('role', 'ADMIN').eq('status', 'ACTIVE'));
    if (admins.length <= 1) return fail(res, 400, 'At least one active administrator must remain.');
  }
  const { error: banError } = await db.auth.admin.updateUserById(target.id, { ban_duration: '876000h' });
  if (banError) return fail(res, 502, 'The account was not archived because sign-in could not be disabled.');
  const profile = await query(db.from('profiles').update({ status: 'DENIED' }).eq('id', target.id).select().single());
  await audit(req, 'ARCHIVE_USER', 'PROFILE', profile.id, `Archived user ${profile.email}`);
  res.json(profile);
} catch (error) { next(error); } });
app.patch('/v1/users/:id/restore', authenticate, adminOnly, async (req, res, next) => { try {
  const target = await query(db.from('profiles').select('*').eq('id', req.params.id).is('permanently_deleted_at', null).single());
  if (!protectHeadAdmin(req, res, target)) return;
  if (target.status !== 'DENIED') return fail(res, 409, 'Only removed users can be restored.');
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
app.post('/v1/invitations', authenticate, adminOnly, async (req, res, next) => { try {
  const email = req.body.email?.trim().toLowerCase();
  const role = req.body.role === 'ADMIN' ? 'ADMIN' : 'USER';
  if (!email || !emailPattern.test(email) || email.length > 254) return fail(res, 400, 'A valid email is required');
  if (!isAllowedCompanyEmail(email)) return fail(res, 400, 'Use an approved company email address.');
  const now = new Date().toISOString();
  const duplicate = await query(db.from('invitations').select('id').eq('email', email).eq('status', 'PENDING').gt('expires_at', now).maybeSingle());
  if (duplicate) {
    const existingProfile = await query(db.from('profiles').select('id').eq('email', email).is('permanently_deleted_at', null).maybeSingle());
    if (!existingProfile) return fail(res, 409, 'This email already has an active invitation.');
    await query(db.from('profiles').update({ status: 'ACTIVE', role, department_id: req.body.departmentId || null }).eq('id', existingProfile.id).select().single());
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
  const departmentId = optionalUuid(req.body.departmentId);
  if (departmentId === undefined) return fail(res, 400, 'Invalid department ID');
  let invitation = await query(db.from('invitations').insert({ invited_by_user_id: req.profile.id, email, role, department_id: departmentId }).select().single());
  // A person may have selected Google before the admin invited them. In that
  // case the auth trigger has already made a PENDING profile, so activate that
  // exact existing profile instead of waiting for a second account creation.
  const existingProfile = await query(db.from('profiles').select('id').eq('email', email).is('permanently_deleted_at', null).maybeSingle());
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
app.delete('/v1/invitations/:id', authenticate, adminOnly, async (req, res, next) => { try {
  const invitation = await query(db.from('invitations').select('*').eq('id', req.params.id).maybeSingle());
  if (!invitation) return fail(res, 404, 'Invitation not found.');
  if (invitation.status !== 'PENDING') return fail(res, 409, 'Only pending invitations can be cancelled.');
  await query(db.from('invitations').delete().eq('id', invitation.id).select().single());
  await audit(req, 'CANCEL_INVITATION', 'INVITATION', invitation.id, `Cancelled invitation for ${invitation.email}`);
  res.status(204).end();
} catch (error) { next(error); } });
app.get('/v1/invitations', authenticate, adminOnly, async (_, res, next) => { try { res.json(await query(db.from('invitations').select('*, profiles!invitations_invited_by_user_id_fkey(full_name,email)').order('invited_at', { ascending: false }))); } catch (error) { next(error); } });

app.get('/v1/time-entries', authenticate, activeOnly, async (req, res, next) => { try { const own = req.profile.role !== 'ADMIN' || req.query.mine === 'true'; let request = db.from('time_entries').select('*, projects(name), profiles!time_entries_user_id_fkey(full_name,email), stopped_by:profiles!time_entries_stopped_by_user_id_fkey(full_name,email)').order('clock_in_at', { ascending: false }); request = req.query.removed === 'true' && req.profile.role === 'ADMIN' ? request.not('deleted_at', 'is', null) : request.is('deleted_at', null); if (own) request = request.eq('user_id', req.profile.id); res.json(await query(request)); } catch (error) { next(error); } });
app.get('/v1/time-leaderboard', authenticate, activeOnly, async (req, res, next) => { try {
  const [people, entries] = await Promise.all([
    query(db.from('profiles').select('id,full_name,profile_picture_url,role').eq('status', 'ACTIVE').is('permanently_deleted_at', null)),
    query(db.from('time_entries').select('user_id,duration_seconds').is('deleted_at', null).not('duration_seconds', 'is', null))
  ]);
  const totals = entries.reduce((result, entry) => ({ ...result, [entry.user_id]: (result[entry.user_id] || 0) + Number(entry.duration_seconds || 0) }), {});
  const ranked = people.map(person => ({ ...person, tracked_seconds: totals[person.id] || 0 })).sort((a, b) => b.tracked_seconds - a.tracked_seconds || a.full_name.localeCompare(b.full_name));
  res.json({ leaders: ranked.slice(0, 5), my_rank: Math.max(1, ranked.findIndex(person => person.id === req.profile.id) + 1), total_people: ranked.length });
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
  const note = optionalText(req.body.note, 50);
  if (projectId === undefined) return fail(res, 400, 'Invalid project ID');
  if (note === undefined) return fail(res, 400, 'Clock-in note must be text up to 50 characters');
  const open = await query(db.from('time_entries').select('id').eq('user_id', req.profile.id).is('clock_out_at', null).maybeSingle());
  if (open) return fail(res, 409, 'You already have an active time entry');
  const entry = await query(db.from('time_entries').insert({ user_id: req.profile.id, project_id: projectId, user_note: note }).select().single());
  const device = clockingDevice(req);
  await audit(req, `CLOCK_IN (${device})`, 'TIME_ENTRY', entry.id, `Started a time entry from ${device}`);
  res.status(201).json(entry);
} catch (error) { next(error); } });
app.post('/v1/time-entries/:id/break/start', authenticate, activeOnly, async (req, res, next) => { try {
  let request = db.from('time_entries').update({ break_started_at: new Date().toISOString() }).eq('id', req.params.id).is('clock_out_at', null).is('break_started_at', null);
  if (req.profile.role !== 'ADMIN') request = request.eq('user_id', req.profile.id);
  const entry = await query(request.select().maybeSingle());
  if (!entry) return fail(res, 409, 'This break cannot be started because the shift is not active');
  await audit(req, 'BREAK_START', 'TIME_ENTRY', entry.id, 'Started a work break');
  res.json(entry);
} catch (error) { next(error); } });
app.post('/v1/time-entries/:id/break/end', authenticate, activeOnly, async (req, res, next) => { try {
  let request = db.from('time_entries').select('id,user_id,break_started_at,break_seconds').eq('id', req.params.id).is('clock_out_at', null).not('break_started_at', 'is', null);
  if (req.profile.role !== 'ADMIN') request = request.eq('user_id', req.profile.id);
  const current = await query(request.maybeSingle());
  if (!current) return fail(res, 409, 'There is no active break to end for this shift');
  const additionalSeconds = Math.max(0, Math.floor((Date.now() - new Date(current.break_started_at).getTime()) / 1000));
  const entry = await query(db.from('time_entries').update({ break_started_at: null, break_seconds: (current.break_seconds || 0) + additionalSeconds }).eq('id', current.id).select().single());
  await audit(req, 'BREAK_END', 'TIME_ENTRY', entry.id, `Ended a work break (${additionalSeconds} seconds)`);
  res.json(entry);
} catch (error) { next(error); } });
app.post('/v1/time-entries/:id/clock-out', authenticate, activeOnly, async (req, res, next) => { try {
  const note = requireText(req.body.note, 'A clock-out note', 50);
  let currentRequest = db.from('time_entries').select('id,user_id,break_started_at,break_seconds').eq('id', req.params.id).is('clock_out_at', null);
  if (req.profile.role !== 'ADMIN') currentRequest = currentRequest.eq('user_id', req.profile.id);
  const current = await query(currentRequest.maybeSingle());
  if (!current) return fail(res, 409, 'This shift is already clocked out or unavailable');
  const breakSeconds = (current.break_seconds || 0) + (current.break_started_at ? Math.max(0, Math.floor((Date.now() - new Date(current.break_started_at).getTime()) / 1000)) : 0);
  const entry = await query(db.from('time_entries').update({ clock_out_at: new Date().toISOString(), final_note: note, break_started_at: null, break_seconds: breakSeconds }).eq('id', current.id).select().single());
  const device = clockingDevice(req); await audit(req, `CLOCK_OUT (${device})`, 'TIME_ENTRY', entry.id, `Completed a time entry from ${device}`); res.json(entry);
} catch (error) { next(error); } });
app.post('/v1/time-entries/:id/admin-stop', authenticate, adminOnly, async (req, res, next) => { try {
  const current = await query(db.from('time_entries').select('id,user_id,break_started_at,break_seconds, profiles!time_entries_user_id_fkey(role,full_name,email)').eq('id', req.params.id).is('clock_out_at', null).is('deleted_at', null).maybeSingle());
  if (!current) return fail(res, 409, 'This shift is already stopped or unavailable');
  if (current.profiles?.role !== 'USER') return fail(res, 403, 'Only employee shifts can be stopped by an administrator');
  const stoppedAt = new Date().toISOString();
  const breakSeconds = (current.break_seconds || 0) + (current.break_started_at ? Math.max(0, Math.floor((Date.now() - new Date(current.break_started_at).getTime()) / 1000)) : 0);
  const entry = await query(db.from('time_entries').update({ clock_out_at: stoppedAt, break_started_at: null, break_seconds: breakSeconds, stopped_by_user_id: req.profile.id, stopped_by_at: stoppedAt }).eq('id', current.id).is('clock_out_at', null).select().maybeSingle());
  if (!entry) return fail(res, 409, 'This shift was stopped by someone else');
  await audit(req, 'ADMIN_STOP_CLOCK', 'TIME_ENTRY', entry.id, `Stopped ${current.profiles?.full_name || current.profiles?.email || 'an employee'}'s active shift`);
  res.json(entry);
} catch (error) { next(error); } });
app.patch('/v1/time-entries/:id/admin-time', authenticate, adminOnly, async (req, res, next) => { try {
  const { clockInAt, clockOutAt } = req.body;
  if (!isTimestamp(clockInAt) || !isTimestamp(clockOutAt)) return fail(res, 400, 'A valid clock-in and clock-out date and time are required');
  const clockIn = new Date(clockInAt);
  const clockOut = new Date(clockOutAt);
  if (clockOut < clockIn) return fail(res, 400, 'Clock-out cannot be earlier than clock-in');
  const current = await query(db.from('time_entries').select('id,user_id,break_started_at,break_seconds,profiles!time_entries_user_id_fkey(role,full_name,email)').eq('id', req.params.id).is('deleted_at', null).maybeSingle());
  if (!current) return fail(res, 404, 'Time entry is unavailable');
  if (current.profiles?.role !== 'USER') return fail(res, 403, 'Only employee time entries can be corrected by an administrator');
  const breakSeconds = (current.break_seconds || 0) + (current.break_started_at ? Math.max(0, Math.floor((clockOut.getTime() - new Date(current.break_started_at).getTime()) / 1000)) : 0);
  const entry = await query(db.from('time_entries').update({ clock_in_at: clockIn.toISOString(), clock_out_at: clockOut.toISOString(), break_started_at: null, break_seconds: breakSeconds }).eq('id', current.id).select().single());
  await audit(req, 'ADMIN_CORRECT_TIME', 'TIME_ENTRY', entry.id, `Corrected ${current.profiles?.full_name || current.profiles?.email || 'an employee'}'s clock-in and clock-out times`);
  res.json(entry);
} catch (error) { next(error); } });

app.post('/v1/time-entries/:id/remarks', authenticate, adminOnly, async (req, res, next) => { try { const remarkText = requireText(req.body.remark, 'Remark', 2000); const remark = await query(db.from('admin_remarks').insert({ time_entry_id: req.params.id, admin_user_id: req.profile.id, remark: remarkText }).select().single()); await audit(req, 'ADD_REMARK', 'TIME_ENTRY', req.params.id, 'Added administrator remark'); res.status(201).json(remark); } catch (error) { next(error); } });
app.delete('/v1/time-entries/:id', authenticate, adminOnly, async (req, res, next) => { try { const entry = await query(db.from('time_entries').update({ deleted_at: new Date().toISOString(), deleted_by_user_id: req.profile.id }).eq('id', req.params.id).is('deleted_at', null).select().single()); await audit(req, 'DELETE', 'TIME_ENTRY', entry.id, 'Moved time entry to deleted data'); res.json(entry); } catch (error) { next(error); } });
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
  let entries = db.from('time_entries').select('id', { count: 'exact', head: true }).gte('clock_in_at', `${dateFrom}T00:00:00Z`).lte('clock_in_at', `${dateTo}T23:59:59Z`);
  if (projectId) entries = entries.eq('project_id', projectId);
  if (userId) entries = entries.eq('user_id', userId);
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
  console.error(error);
  if (error?.status && error.expose) return fail(res, error.status, error.message);
  if (error?.code === '23505') return fail(res, 409, 'A record with that value already exists');
  if (error?.code === '23503') return fail(res, 409, 'This record is connected to company history and must remain archived');
  fail(res, 500, 'Unexpected server error');
});
app.listen(process.env.PORT || 3000, () => console.log(`ACE API listening on ${process.env.PORT || 3000}`));
