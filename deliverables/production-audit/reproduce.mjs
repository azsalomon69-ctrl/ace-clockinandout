// Diagnostic evidence only: these assertions describe current defects, not desired behavior.
// No network requests, database writes, or application source changes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const root = new URL('../../', import.meta.url);
const server = readFileSync(new URL('backend/server/index.js', root), 'utf8');
const browser = readFileSync(new URL('frontend/js/script.js', root), 'utf8');
let count = 0;
const proof = async (name, run) => { await run(); console.log(`CONFIRMED: ${name}`); count++; };

await proof('Chat returns the oldest 200 and marks undisplayed incoming messages read', async () => {
  const rows = Array.from({ length: 201 }, (_, i) => ({ id: i + 1, sender_id: 'contact', recipient_id: 'self', read_at: null }));
  let handler;
  const builder = () => ({ mode: 'select', limitValue: Infinity,
    select() { return this; }, eq() { return this; }, is() { return this; }, or() { return this; },
    maybeSingle() { this.contact = true; return this; }, order(column, options) { assert.equal(column, 'created_at'); assert.equal(options, undefined); return this; },
    limit(n) { this.limitValue = n; return this; }, update(patch) { this.mode = 'update'; this.patch = patch; return this; },
    then(resolve) { if (this.mode === 'update') rows.forEach(row => Object.assign(row, this.patch)); resolve({ data: this.contact ? { id: 'contact', role: 'ADMIN' } : rows.slice(0, this.limitValue).map(r => ({ ...r })) }); }
  });
  const start = server.indexOf("app.get('/v1/employee-chat/messages/:userId'");
  const end = server.indexOf("app.post('/v1/employee-chat/messages'", start);
  vm.runInNewContext(server.slice(start, end), {
    app: { get(_path, ...handlers) { handler = handlers.at(-1); } }, authenticate() {}, activeOnly() {},
    optionalUuid: value => value, canChatWith: () => true, db: { from: builder }, query: async b => (await b).data,
    fail: () => assert.fail('Unexpected rejection')
  });
  let returned;
  await handler({ params: { userId: 'contact' }, profile: { id: 'self' } }, { json: value => { returned = value; } }, error => { throw error; });
  assert.equal(returned.length, 200); assert.equal(returned.at(-1).id, 200); assert.ok(rows[200].read_at);
});

await proof('Two last-admin guards can both pass before either update commits', async () => {
  const helpers = server.slice(server.indexOf('const headAdminEmail ='), server.indexOf('async function audit('));
  const context = vm.createContext({ process: { env: { HEAD_ADMIN_EMAIL: 'head@example.test' } },
    db: { from: () => ({ select() { return this; }, eq() { return this; } }) },
    query: async () => [{ id: 'a' }, { id: 'b' }], fail: () => assert.fail('Unexpected rejection') });
  vm.runInContext(helpers, context);
  const profile = id => ({ id, email: `${id}@example.test`, role: 'ADMIN', status: 'ACTIVE' });
  const results = await Promise.all([
    context.guardProfileLifecycle({ profile: profile('a') }, {}, profile('b'), { role: 'USER' }, { operation: 'role' }),
    context.guardProfileLifecycle({ profile: profile('b') }, {}, profile('a'), { role: 'USER' }, { operation: 'role' })
  ]);
  assert.deepEqual(results, [true, true]);
});

await proof('ENTRY_ALREADY_CLOSED leaves the browser clocked in with no reconciliation read', async () => {
  const source = browser.slice(browser.indexOf('async function handleClockOut('), browser.indexOf('function setActionBusy('));
  const state = { currentSession: { TimeEntryId: 'entry' }, isClockedIn: true, clockInTime: new Date(), timeEntries: [] };
  let calls = 0;
  const context = vm.createContext({ AppState: state,
    window: { ACEAuth: { request: async () => { calls++; throw new Error('ENTRY_ALREADY_CLOSED'); } } },
    document: { getElementById: () => ({ value: 'finished' }) }, setActionBusy() {}, showToast() {} });
  vm.runInContext(source, context);
  await context.handleClockOut({ preventDefault() {}, currentTarget: { querySelector: () => ({ disabled: false }) } });
  assert.equal(calls, 1); assert.equal(state.isClockedIn, true); assert.equal(state.currentSession.TimeEntryId, 'entry');
});

await proof('Production asset hashes are unrecognized by dashboard navigation', () => {
  const moduleMap = { 'deleted-users.js': 'mountDeletedUsers', 'schedule-flex.js': 'mountScheduleFlex' };
  const path = '/assets/js/0123456789abcdef.js';
  assert.ok(/\.js(?:\?|$)/.test(path));
  assert.equal(/(api-config|supabase-auth|sidebar|\/script\.js|admin-sections\.js)/.test(path), false);
  assert.equal(moduleMap[path.split('/').pop()], undefined);
  assert.ok(browser.includes('if (unsupportedModule) { window.location.assign(destination.href); return; }'));
});

await proof('Overnight 22:00–06:00 approval formula counts 24 hours overtime at scheduled finish', () => {
  const sql = readFileSync(new URL('supabase/migrations/0010_overtime_approval.sql', root), 'utf8');
  assert.ok(sql.includes("::date + v_entry.scheduled_end_time"));
  const scheduledEnd = Date.parse('2026-10-05T06:00:00+08:00');
  const actualEnd = Date.parse('2026-10-06T06:00:00+08:00');
  assert.equal(Math.max(0, Math.floor((actualEnd - scheduledEnd) / 1000)), 86400);
});

await proof('Retrying avatar completion can destroy the currently selected asset', async () => {
  const start = server.indexOf("app.post('/v1/me/avatar-complete'");
  const end = server.indexOf("app.post('/v1/auth/session-start'", start);
  let handler, destroyed;
  const publicId = 'ace-profiles/user/photo';
  vm.runInNewContext(server.slice(start, end), {
    app: { post(_path, ...handlers) { handler = handlers.at(-1); } }, authenticate() {}, activeOnly() {}, cloudinaryConfigured: true,
    requireText: value => value, cloudinary: { api: { resource: async () => ({ secure_url: 'https://example.test/photo' }) }, uploader: { destroy: async id => { destroyed = id; } } },
    db: { from: () => ({ update() { return this; }, eq() { return this; }, select() { return this; }, single() { return this; } }) },
    query: async () => ({ id: 'user', profile_picture_public_id: publicId }), audit: async () => {}, fail: () => assert.fail('Unexpected rejection')
  });
  await handler({ body: { publicId }, profile: { id: 'user', profile_picture_public_id: publicId } }, { json() {} }, error => { throw error; });
  assert.equal(destroyed, publicId);
});
console.log(`${count} diagnostic reproductions passed. Mocked route checks do not establish live database state.`);
