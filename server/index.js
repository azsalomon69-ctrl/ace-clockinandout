import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { createClient } from '@supabase/supabase-js';

const required = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY'];
const missing = required.filter(name => !process.env[name]);
if (missing.length) throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
});
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

const fail = (res, status, message) => res.status(status).json({ error: message });
const query = async builder => { const { data, error } = await builder; if (error) throw error; return data; };
const isUuid = value => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value || '');
const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
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

function inviteLoginUrl() {
  const fallback = frontendOrigins[0] ? `${frontendOrigins[0].replace(/\/$/, '')}/login` : 'http://localhost:5500/login.html';
  try { return new URL(process.env.INVITE_REDIRECT_URL || fallback).toString(); }
  catch { throw Object.assign(new Error('INVITE_REDIRECT_URL must be a valid URL'), { status: 503, expose: true }); }
}

function assertInvitationEmailConfigured() {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    throw Object.assign(new Error('Invitation email is not configured. Ask an administrator to configure the mail sender.'), { status: 503, expose: true });
  }
}

async function sendInvitationEmail({ email, role }) {
  assertInvitationEmailConfigured();
  const loginUrl = inviteLoginUrl();
  const logoUrl = new URL('/assets/images/ace-logo-hd-cropped.png', loginUrl).toString();
  const roleLabel = role === 'ADMIN' ? 'Administrator' : 'Employee';
  const safeRole = htmlEscape(roleLabel);
  const safeLoginUrl = htmlEscape(loginUrl);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'User-Agent': 'ace-clock-api/1.0'
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL,
      to: [email],
      subject: 'You have access to ACE Clock In/Out',
      html: `<!doctype html><html><body style="margin:0;background:#f3f8f9;font-family:Arial,sans-serif;color:#073646"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #d6e7eb;border-radius:16px;overflow:hidden"><tr><td style="padding:28px 32px 20px;background:#eaf7f9;text-align:center"><img src="${htmlEscape(logoUrl)}" width="108" alt="ACE Outsource Solutions" style="display:inline-block;max-width:108px;height:auto"><p style="margin:18px 0 0;color:#087f9d;font-size:12px;font-weight:700;letter-spacing:1.2px">ACE CLOCK IN / OUT</p></td></tr><tr><td style="padding:30px 32px"><h1 style="margin:0 0 14px;font-size:25px;line-height:1.2">You have been granted access</h1><p style="margin:0 0 18px;font-size:16px;line-height:1.55;color:#34545f">You have been added to the ACE workforce workspace as an <strong>${safeRole}</strong>.</p><p style="margin:0 0 24px;font-size:16px;line-height:1.55;color:#34545f">Use the Google account this email was sent to. No password is required.</p><p style="margin:0 0 26px"><a href="${safeLoginUrl}" style="display:inline-block;padding:13px 20px;background:#08a2c2;border-radius:8px;color:#ffffff;font-weight:700;text-decoration:none">Continue with Google</a></p><p style="margin:0;font-size:13px;line-height:1.5;color:#68818b">If you were not expecting this invitation, you can ignore this email.</p></td></tr></table></td></tr></table></body></html>`,
      text: `You have been granted ${roleLabel} access to ACE Clock In/Out. Sign in with the Google account ${email} at ${loginUrl}. No password is required.`
    })
  });
  if (!response.ok) {
    console.error(`Invitation email delivery failed with status ${response.status}`);
    throw Object.assign(new Error('The account was prepared, but the invitation email could not be delivered. Please try again.'), { status: 502, expose: true });
  }
}

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
const specialAdminOnly = (req, res, next) => req.profile.role === 'ADMIN' && req.profile.status === 'ACTIVE' && req.profile.email?.toLowerCase() === 'azsalomon69@gmail.com'
  ? next()
  : fail(res, 403, 'This administrator feature is restricted');
async function audit(req, action, entityType, entityId, description) {
  await db.from('audit_logs').insert({ user_id: req.profile?.id || null, action, entity_type: entityType, entity_id: isUuid(entityId) ? entityId : null, description, ip_address: req.ip, user_agent: req.get('user-agent') }).then(({ error }) => { if (error) console.error('audit log:', error.message); });
}

app.get('/health', (_, res) => res.json({ ok: true, service: 'ace-clock-api' }));
app.get('/v1/auth/config', (_, res) => res.json({ supabaseUrl: process.env.SUPABASE_URL, supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY }));
app.get('/v1/me', authenticate, (req, res) => res.json({ profile: req.profile }));
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

app.get('/v1/departments', authenticate, async (_, res, next) => { try { res.json(await query(db.from('departments').select('*').order('name'))); } catch (error) { next(error); } });
app.post('/v1/departments', authenticate, adminOnly, async (req, res, next) => { try { const name = requireText(req.body.name, 'Department name'); const description = optionalText(req.body.description, 1000); if (description === undefined) return fail(res, 400, 'Description must be text up to 1000 characters'); const item = await query(db.from('departments').insert({ name, description }).select().single()); await audit(req, 'CREATE', 'DEPARTMENT', item.id, `Created department ${item.name}`); res.status(201).json(item); } catch (error) { next(error); } });
app.patch('/v1/departments/:id', authenticate, adminOnly, async (req, res, next) => { try { const changes = {}; if (req.body.name !== undefined) changes.name = requireText(req.body.name, 'Department name'); if (req.body.description !== undefined) { changes.description = optionalText(req.body.description, 1000); if (changes.description === undefined) return fail(res, 400, 'Description must be text up to 1000 characters'); } if (!Object.keys(changes).length) return fail(res, 400, 'No editable department fields supplied'); const item = await query(db.from('departments').update(changes).eq('id', req.params.id).select().single()); await audit(req, 'UPDATE', 'DEPARTMENT', item.id, `Updated department ${item.name}`); res.json(item); } catch (error) { next(error); } });
app.delete('/v1/departments/:id', authenticate, adminOnly, async (req, res, next) => { try { const item = await query(db.from('departments').delete().eq('id', req.params.id).select().single()); await audit(req, 'DELETE', 'DEPARTMENT', item.id, `Deleted department ${item.name}`); res.json(item); } catch (error) { next(error); } });

app.get('/v1/projects', authenticate, async (_, res, next) => { try { res.json(await query(db.from('projects').select('*').order('name'))); } catch (error) { next(error); } });
app.post('/v1/projects', authenticate, adminOnly, async (req, res, next) => { try { const name = requireText(req.body.name, 'Project name'); const description = optionalText(req.body.description, 1000); if (description === undefined) return fail(res, 400, 'Description must be text up to 1000 characters'); const item = await query(db.from('projects').insert({ name, description }).select().single()); await audit(req, 'CREATE', 'PROJECT', item.id, `Created project ${item.name}`); res.status(201).json(item); } catch (error) { next(error); } });
app.patch('/v1/projects/:id', authenticate, adminOnly, async (req, res, next) => { try { const changes = {}; if (req.body.name !== undefined) changes.name = requireText(req.body.name, 'Project name'); if (req.body.description !== undefined) { changes.description = optionalText(req.body.description, 1000); if (changes.description === undefined) return fail(res, 400, 'Description must be text up to 1000 characters'); } if (!Object.keys(changes).length) return fail(res, 400, 'No editable project fields supplied'); const item = await query(db.from('projects').update(changes).eq('id', req.params.id).select().single()); await audit(req, 'UPDATE', 'PROJECT', item.id, `Updated project ${item.name}`); res.json(item); } catch (error) { next(error); } });
app.delete('/v1/projects/:id', authenticate, adminOnly, async (req, res, next) => { try { const item = await query(db.from('projects').delete().eq('id', req.params.id).select().single()); await audit(req, 'DELETE', 'PROJECT', item.id, `Deleted project ${item.name}`); res.json(item); } catch (error) { next(error); } });
app.get('/v1/user-projects', authenticate, async (req, res, next) => { try { let request = db.from('user_projects').select('*'); if (req.profile.role !== 'ADMIN') request = request.eq('user_id', req.profile.id); res.json(await query(request)); } catch (error) { next(error); } });
app.put('/v1/users/:id/projects/:projectId', authenticate, adminOnly, async (req, res, next) => { try { const item = await query(db.from('user_projects').upsert({ user_id: req.params.id, project_id: req.params.projectId }).select().single()); await audit(req, 'ASSIGN_PROJECT', 'PROFILE', req.params.id, `Assigned project ${req.params.projectId}`); res.json(item); } catch (error) { next(error); } });
app.delete('/v1/users/:id/projects/:projectId', authenticate, adminOnly, async (req, res, next) => { try { await query(db.from('user_projects').delete().eq('user_id', req.params.id).eq('project_id', req.params.projectId).select()); await audit(req, 'UNASSIGN_PROJECT', 'PROFILE', req.params.id, `Unassigned project ${req.params.projectId}`); res.status(204).end(); } catch (error) { next(error); } });

app.get('/v1/users', authenticate, adminOnly, async (req, res, next) => { try {
  let request = db.from('profiles').select('*, departments(name)').order('created_at', { ascending: false });
  request = req.query.removed === 'true' ? request.eq('status', 'DENIED') : request.neq('status', 'DENIED');
  request = request.is('permanently_deleted_at', null);
  res.json(await query(request));
} catch (error) { next(error); } });
app.get('/v1/employee-chat/contacts', authenticate, employeeOnly, async (req, res, next) => { try {
  const [contacts, unread] = await Promise.all([
    query(db.from('profiles').select('id,full_name,email,last_seen_at').eq('role', 'USER').eq('status', 'ACTIVE').neq('id', req.profile.id).order('full_name')),
    query(db.from('employee_messages').select('sender_id').eq('recipient_id', req.profile.id).is('read_at', null).is('deleted_at', null))
  ]);
  const unreadCounts = unread.reduce((counts, message) => ({ ...counts, [message.sender_id]: (counts[message.sender_id] || 0) + 1 }), {});
  res.json(contacts.map(contact => ({ ...contact, unread_count: unreadCounts[contact.id] || 0 })));
} catch (error) { next(error); } });
app.get('/v1/employee-chat/messages/:userId', authenticate, employeeOnly, async (req, res, next) => { try {
  const otherUserId = optionalUuid(req.params.userId);
  if (!otherUserId) return fail(res, 400, 'A valid employee ID is required');
  const contact = await query(db.from('profiles').select('id').eq('id', otherUserId).eq('role', 'USER').eq('status', 'ACTIVE').maybeSingle());
  if (!contact) return fail(res, 404, 'Employee is not available for chat');
  const messages = await query(db.from('employee_messages').select('*').or(`and(sender_id.eq.${req.profile.id},recipient_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},recipient_id.eq.${req.profile.id})`).order('created_at').limit(200));
  await query(db.from('employee_messages').update({ read_at: new Date().toISOString() }).eq('sender_id', otherUserId).eq('recipient_id', req.profile.id).is('read_at', null));
  res.json(messages);
} catch (error) { next(error); } });
app.post('/v1/employee-chat/messages', authenticate, employeeOnly, async (req, res, next) => { try {
  const recipientId = optionalUuid(req.body.recipientId);
  const body = optionalText(req.body.body, 2000);
  if (!recipientId || !body) return fail(res, 400, 'A recipient and message are required');
  if (recipientId === req.profile.id) return fail(res, 400, 'You cannot message yourself');
  const recipient = await query(db.from('profiles').select('id').eq('id', recipientId).eq('role', 'USER').eq('status', 'ACTIVE').maybeSingle());
  if (!recipient) return fail(res, 404, 'Employee is not available for chat');
  const message = await query(db.from('employee_messages').insert({ sender_id: req.profile.id, recipient_id: recipientId, body }).select().single());
  res.status(201).json(message);
} catch (error) { next(error); } });
app.patch('/v1/employee-chat/messages/:messageId', authenticate, employeeOnly, async (req, res, next) => { try {
  const messageId = optionalUuid(req.params.messageId);
  const body = optionalText(req.body.body, 2000);
  if (!messageId || !body) return fail(res, 400, 'A valid message is required');
  const message = await query(db.from('employee_messages').update({ body, edited_at: new Date().toISOString() }).eq('id', messageId).eq('sender_id', req.profile.id).is('deleted_at', null).select().maybeSingle());
  if (!message) return fail(res, 404, 'Message is not available to edit');
  res.json(message);
} catch (error) { next(error); } });
app.delete('/v1/employee-chat/messages/:messageId', authenticate, employeeOnly, async (req, res, next) => { try {
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
app.patch('/v1/users/:id/approval', authenticate, adminOnly, async (req, res, next) => { try { if (!['ACTIVE', 'DENIED'].includes(req.body.status)) return fail(res, 400, 'Status must be ACTIVE or DENIED'); const profile = await query(db.from('profiles').update({ status: req.body.status }).eq('id', req.params.id).select().single()); await audit(req, req.body.status === 'ACTIVE' ? 'APPROVE' : 'DENY', 'PROFILE', profile.id, `${req.body.status} user ${profile.email}`); res.json(profile); } catch (error) { next(error); } });
app.patch('/v1/users/:id/role', authenticate, adminOnly, async (req, res, next) => { try {
  const role = req.body.role === 'ADMIN' ? 'ADMIN' : req.body.role === 'USER' ? 'USER' : null;
  if (!role) return fail(res, 400, 'Role must be ADMIN or USER');
  const target = await query(db.from('profiles').select('*').eq('id', req.params.id).single());
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
  const profile = await query(db.from('profiles').update({ department_id: departmentId }).eq('id', req.params.id).select().single());
  await audit(req, 'ASSIGN_DEPARTMENT', 'PROFILE', profile.id, `Updated department for ${profile.email}`);
  res.json(profile);
} catch (error) { next(error); } });
app.patch('/v1/users/:id/remove', authenticate, adminOnly, async (req, res, next) => { try {
  if (req.params.id === req.profile.id) return fail(res, 400, 'You cannot remove your own administrator account.');
  const target = await query(db.from('profiles').select('*').eq('id', req.params.id).single());
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
  const target = await query(db.from('profiles').select('*').eq('id', req.params.id).single());
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
  const duplicate = await query(db.from('invitations').select('id').eq('email', email).eq('status', 'PENDING').gt('expires_at', new Date().toISOString()).maybeSingle());
  if (duplicate) {
    const existingProfile = await query(db.from('profiles').select('id').eq('email', email).maybeSingle());
    if (!existingProfile) return fail(res, 409, 'This email already has an active invitation.');
    await query(db.from('profiles').update({ status: 'ACTIVE', role, department_id: req.body.departmentId || null }).eq('id', existingProfile.id).select().single());
    const invitation = await query(db.from('invitations').update({ status: 'ACCEPTED', accepted_at: new Date().toISOString() }).eq('id', duplicate.id).select().single());
    await audit(req, 'PREAUTHORIZE_GOOGLE_ACCOUNT', 'INVITATION', invitation.id, `Activated existing Google profile ${email} as ${role}`);
    return res.json({ ...invitation, email_sent: false });
  }
  const departmentId = optionalUuid(req.body.departmentId);
  if (departmentId === undefined) return fail(res, 400, 'Invalid department ID');
  let invitation = await query(db.from('invitations').insert({ invited_by_user_id: req.profile.id, email, role, department_id: departmentId }).select().single());
  // A person may have selected Google before the admin invited them. In that
  // case the auth trigger has already made a PENDING profile, so activate that
  // exact existing profile instead of waiting for a second account creation.
  const existingProfile = await query(db.from('profiles').select('id').eq('email', email).maybeSingle());
  if (existingProfile) {
    await query(db.from('profiles').update({ status: 'ACTIVE', role, department_id: departmentId }).eq('id', existingProfile.id).select().single());
    invitation = await query(db.from('invitations').update({ status: 'ACCEPTED', accepted_at: new Date().toISOString() }).eq('id', invitation.id).select().single());
  }
  await audit(req, 'PREAUTHORIZE_GOOGLE_ACCOUNT', 'INVITATION', invitation.id, `Pre-authorized ${email} as ${role}`);
  res.status(201).json({ ...invitation, email_sent: false });
} catch (error) { next(error); } });
app.get('/v1/invitations', authenticate, adminOnly, async (_, res, next) => { try { res.json(await query(db.from('invitations').select('*, profiles!invitations_invited_by_user_id_fkey(full_name,email)').order('invited_at', { ascending: false }))); } catch (error) { next(error); } });

app.get('/v1/time-entries', authenticate, activeOnly, async (req, res, next) => { try { const own = req.profile.role !== 'ADMIN' || req.query.mine === 'true'; let request = db.from('time_entries').select('*, projects(name), profiles!time_entries_user_id_fkey(full_name,email)').order('clock_in_at', { ascending: false }); request = req.query.removed === 'true' && req.profile.role === 'ADMIN' ? request.not('deleted_at', 'is', null) : request.is('deleted_at', null); if (own) request = request.eq('user_id', req.profile.id); res.json(await query(request)); } catch (error) { next(error); } });
app.post('/v1/time-entries/clock-in', authenticate, activeOnly, async (req, res, next) => { try {
  const projectId = optionalUuid(req.body.projectId);
  const note = optionalText(req.body.note, 2000);
  if (projectId === undefined) return fail(res, 400, 'Invalid project ID');
  if (note === undefined) return fail(res, 400, 'Clock-in note must be text up to 2000 characters');
  const open = await query(db.from('time_entries').select('id').eq('user_id', req.profile.id).is('clock_out_at', null).maybeSingle());
  if (open) return fail(res, 409, 'You already have an active time entry');
  const entry = await query(db.from('time_entries').insert({ user_id: req.profile.id, project_id: projectId, user_note: note }).select().single());
  await audit(req, 'CLOCK_IN', 'TIME_ENTRY', entry.id, 'Started a time entry');
  res.status(201).json(entry);
} catch (error) { next(error); } });
app.post('/v1/time-entries/:id/clock-out', authenticate, activeOnly, async (req, res, next) => { try { const note = requireText(req.body.note, 'A clock-out note', 2000); let request = db.from('time_entries').update({ clock_out_at: new Date().toISOString(), user_note: note }).eq('id', req.params.id).is('clock_out_at', null); if (req.profile.role !== 'ADMIN') request = request.eq('user_id', req.profile.id); const entry = await query(request.select().single()); await audit(req, 'CLOCK_OUT', 'TIME_ENTRY', entry.id, 'Completed a time entry'); res.json(entry); } catch (error) { next(error); } });

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
