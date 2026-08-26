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
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_ORIGIN?.split(',').map(value => value.trim()) || true }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

const fail = (res, status, message) => res.status(status).json({ error: message });
const query = async builder => { const { data, error } = await builder; if (error) throw error; return data; };
const isUuid = value => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value || '');
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
const adminOnly = (req, res, next) => req.profile.role === 'ADMIN' ? next() : fail(res, 403, 'Administrator access required');
const activeOnly = (req, res, next) => req.profile.status === 'ACTIVE' ? next() : fail(res, 403, 'Your account is awaiting approval');
async function audit(req, action, entityType, entityId, description) {
  await db.from('audit_logs').insert({ user_id: req.profile?.id || null, action, entity_type: entityType, entity_id: isUuid(entityId) ? entityId : null, description, ip_address: req.ip, user_agent: req.get('user-agent') }).then(({ error }) => { if (error) console.error('audit log:', error.message); });
}

app.get('/health', (_, res) => res.json({ ok: true, service: 'ace-clock-api' }));
app.get('/v1/auth/config', (_, res) => res.json({ supabaseUrl: process.env.SUPABASE_URL, supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY }));
app.get('/v1/me', authenticate, async (req, res, next) => { try { await audit(req, 'LOGIN', 'PROFILE', req.profile.id, 'Session validated'); res.json({ profile: req.profile }); } catch (error) { next(error); } });
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
  const request = await query(db.from('access_requests').insert({
    profile_id: req.profile.id, email, full_name: req.profile.full_name || req.authUser.user_metadata?.full_name || '',
    requested_department: req.body.department?.trim() || null, message: req.body.message?.trim() || null,
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
  if (decision === 'APPROVE') await query(db.from('profiles').update({ status, role, department_id: req.body.departmentId || null }).eq('id', request.profile_id).select().single());
  const reviewed = await query(db.from('access_requests').update({ status, reviewed_at: new Date().toISOString(), reviewed_by_user_id: req.profile.id }).eq('id', request.id).select().single());
  await audit(req, decision === 'APPROVE' ? 'APPROVE_ACCESS_REQUEST' : 'DENY_ACCESS_REQUEST', 'ACCESS_REQUEST', request.id, `${decision === 'APPROVE' ? 'Approved' : 'Denied'} ${request.email}`);
  res.json(reviewed);
} catch (error) { next(error); } });

app.get('/v1/departments', authenticate, async (_, res, next) => { try { res.json(await query(db.from('departments').select('*').order('name'))); } catch (error) { next(error); } });
app.post('/v1/departments', authenticate, adminOnly, async (req, res, next) => { try { const { name, description } = req.body; if (!name?.trim()) return fail(res, 400, 'Department name is required'); const item = await query(db.from('departments').insert({ name: name.trim(), description: description?.trim() || null }).select().single()); await audit(req, 'CREATE', 'DEPARTMENT', item.id, `Created department ${item.name}`); res.status(201).json(item); } catch (error) { next(error); } });
app.patch('/v1/departments/:id', authenticate, adminOnly, async (req, res, next) => { try { const item = await query(db.from('departments').update(req.body).eq('id', req.params.id).select().single()); await audit(req, 'UPDATE', 'DEPARTMENT', item.id, `Updated department ${item.name}`); res.json(item); } catch (error) { next(error); } });

app.get('/v1/projects', authenticate, async (_, res, next) => { try { res.json(await query(db.from('projects').select('*').order('name'))); } catch (error) { next(error); } });
app.post('/v1/projects', authenticate, adminOnly, async (req, res, next) => { try { const { name, description } = req.body; if (!name?.trim()) return fail(res, 400, 'Project name is required'); const item = await query(db.from('projects').insert({ name: name.trim(), description: description?.trim() || null }).select().single()); await audit(req, 'CREATE', 'PROJECT', item.id, `Created project ${item.name}`); res.status(201).json(item); } catch (error) { next(error); } });
app.patch('/v1/projects/:id', authenticate, adminOnly, async (req, res, next) => { try { const item = await query(db.from('projects').update(req.body).eq('id', req.params.id).select().single()); await audit(req, 'UPDATE', 'PROJECT', item.id, `Updated project ${item.name}`); res.json(item); } catch (error) { next(error); } });

app.get('/v1/users', authenticate, adminOnly, async (_, res, next) => { try { res.json(await query(db.from('profiles').select('*, departments(name)').order('created_at', { ascending: false }))); } catch (error) { next(error); } });
app.patch('/v1/users/:id/approval', authenticate, adminOnly, async (req, res, next) => { try { if (!['ACTIVE', 'DENIED'].includes(req.body.status)) return fail(res, 400, 'Status must be ACTIVE or DENIED'); const profile = await query(db.from('profiles').update({ status: req.body.status }).eq('id', req.params.id).select().single()); await audit(req, req.body.status === 'ACTIVE' ? 'APPROVE' : 'DENY', 'PROFILE', profile.id, `${req.body.status} user ${profile.email}`); res.json(profile); } catch (error) { next(error); } });
app.patch('/v1/users/:id/remove', authenticate, adminOnly, async (req, res, next) => { try {
  if (req.params.id === req.profile.id) return fail(res, 400, 'You cannot remove your own administrator account.');
  const target = await query(db.from('profiles').select('*').eq('id', req.params.id).single());
  if (target.status === 'DENIED') return fail(res, 409, 'This user has already been removed.');
  if (target.role === 'ADMIN') {
    const admins = await query(db.from('profiles').select('id').eq('role', 'ADMIN').eq('status', 'ACTIVE'));
    if (admins.length <= 1) return fail(res, 400, 'At least one active administrator must remain.');
  }
  const profile = await query(db.from('profiles').update({ status: 'DENIED' }).eq('id', target.id).select().single());
  await audit(req, 'REMOVE_USER', 'PROFILE', profile.id, `Removed user ${profile.email}`);
  res.json(profile);
} catch (error) { next(error); } });

app.post('/v1/invitations', authenticate, adminOnly, async (req, res, next) => { try {
  const email = req.body.email?.trim().toLowerCase();
  const role = req.body.role === 'ADMIN' ? 'ADMIN' : 'USER';
  if (!email) return fail(res, 400, 'Email is required');
  if (!isAllowedCompanyEmail(email)) return fail(res, 400, 'Use an approved company email address.');
  const duplicate = await query(db.from('invitations').select('id').eq('email', email).eq('status', 'PENDING').gt('expires_at', new Date().toISOString()).maybeSingle());
  if (duplicate) return fail(res, 409, 'This email already has an active invitation.');
  const invitation = await query(db.from('invitations').insert({ invited_by_user_id: req.profile.id, email, role, department_id: req.body.departmentId || null }).select().single());
  await audit(req, 'INVITE_GOOGLE_ACCOUNT', 'INVITATION', invitation.id, `Pre-authorized ${email} as ${role}`);
  res.status(201).json(invitation);
} catch (error) { next(error); } });
app.get('/v1/invitations', authenticate, adminOnly, async (_, res, next) => { try { res.json(await query(db.from('invitations').select('*, profiles!invitations_invited_by_user_id_fkey(full_name,email)').order('invited_at', { ascending: false }))); } catch (error) { next(error); } });

app.get('/v1/time-entries', authenticate, activeOnly, async (req, res, next) => { try { const own = req.profile.role !== 'ADMIN' || req.query.mine === 'true'; let request = db.from('time_entries').select('*, projects(name), profiles!time_entries_user_id_fkey(full_name,email)').order('clock_in_at', { ascending: false }); if (own) request = request.eq('user_id', req.profile.id); res.json(await query(request)); } catch (error) { next(error); } });
app.post('/v1/time-entries/clock-in', authenticate, activeOnly, async (req, res, next) => { try { const open = await query(db.from('time_entries').select('id').eq('user_id', req.profile.id).is('clock_out_at', null).maybeSingle()); if (open) return fail(res, 409, 'You already have an active time entry'); const entry = await query(db.from('time_entries').insert({ user_id: req.profile.id, project_id: req.body.projectId || null, user_note: req.body.note?.trim() || null }).select().single()); await audit(req, 'CLOCK_IN', 'TIME_ENTRY', entry.id, 'Started a time entry'); res.status(201).json(entry); } catch (error) { next(error); } });
app.post('/v1/time-entries/:id/clock-out', authenticate, activeOnly, async (req, res, next) => { try { if (!req.body.note?.trim()) return fail(res, 400, 'A clock-out note is required'); let request = db.from('time_entries').update({ clock_out_at: new Date().toISOString(), user_note: req.body.note.trim() }).eq('id', req.params.id).is('clock_out_at', null); if (req.profile.role !== 'ADMIN') request = request.eq('user_id', req.profile.id); const entry = await query(request.select().single()); await audit(req, 'CLOCK_OUT', 'TIME_ENTRY', entry.id, 'Completed a time entry'); res.json(entry); } catch (error) { next(error); } });

app.post('/v1/time-entries/:id/remarks', authenticate, adminOnly, async (req, res, next) => { try { if (!req.body.remark?.trim()) return fail(res, 400, 'Remark is required'); const remark = await query(db.from('admin_remarks').insert({ time_entry_id: req.params.id, admin_user_id: req.profile.id, remark: req.body.remark.trim() }).select().single()); await audit(req, 'ADD_REMARK', 'TIME_ENTRY', req.params.id, 'Added administrator remark'); res.status(201).json(remark); } catch (error) { next(error); } });

app.post('/v1/reports', authenticate, adminOnly, async (req, res, next) => { try { const { reportType = 'TEAM_PERFORMANCE', dateFrom, dateTo, filters = {} } = req.body; if (!dateFrom || !dateTo) return fail(res, 400, 'dateFrom and dateTo are required'); let entries = db.from('time_entries').select('id', { count: 'exact', head: true }).gte('clock_in_at', `${dateFrom}T00:00:00Z`).lte('clock_in_at', `${dateTo}T23:59:59Z`); if (filters.projectId) entries = entries.eq('project_id', filters.projectId); if (filters.userId) entries = entries.eq('user_id', filters.userId); const { count, error } = await entries; if (error) throw error; const report = await query(db.from('reports').insert({ created_by_user_id: req.profile.id, report_type: reportType, date_from: dateFrom, date_to: dateTo, filters, total_records: count || 0 }).select().single()); await audit(req, 'GENERATE_REPORT', 'REPORT', report.id, `Generated ${reportType} report`); res.status(201).json(report); } catch (error) { next(error); } });
app.get('/v1/reports', authenticate, adminOnly, async (_, res, next) => { try { res.json(await query(db.from('reports').select('*, profiles!reports_created_by_user_id_fkey(full_name), report_exports(*)').order('generated_at', { ascending: false }))); } catch (error) { next(error); } });
app.post('/v1/reports/:id/exports', authenticate, adminOnly, async (req, res, next) => { try { const { fileName, fileType = 'PDF', fileUrl = null } = req.body; if (!fileName) return fail(res, 400, 'fileName is required'); const item = await query(db.from('report_exports').insert({ report_id: req.params.id, exported_by_user_id: req.profile.id, file_name: fileName, file_type: fileType, file_url: fileUrl }).select().single()); await audit(req, 'EXPORT_REPORT', 'REPORT', req.params.id, `Exported ${fileType} report`); res.status(201).json(item); } catch (error) { next(error); } });
app.get('/v1/audit-logs', authenticate, adminOnly, async (_, res, next) => { try { res.json(await query(db.from('audit_logs').select('*, profiles(full_name,email)').order('created_at', { ascending: false }).limit(250))); } catch (error) { next(error); } });

app.use((error, _, res, __) => { console.error(error); fail(res, error.code === '23505' ? 409 : 500, error.message || 'Unexpected server error'); });
app.listen(process.env.PORT || 3000, () => console.log(`ACE API listening on ${process.env.PORT || 3000}`));
