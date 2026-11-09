import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const frontend = fs.readFileSync(new URL('../../frontend/js/script.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(frontend.slice(frontend.indexOf('function workspaceHelpEntries('), frontend.indexOf('function findSearchSuggestions(')) + frontend.slice(frontend.indexOf('function matchWorkspaceHelp('), frontend.indexOf('function mountWorkspaceHelp(')), context);
for (const [question, admin, expected] of [
  ['how to invite staff', true, 'How do I invite someone?'],
  ['how to invte an employee', true, 'How do I invite someone?'],
  ['I forgot to clock out', false, 'I forgot to clock out'],
  ['cannot clock in', false, 'Why can I not clock in?'],
  ['how do i change my password', false, 'How do I change my password or security settings?'],
  ['how do i approve overtime', true, 'How do I approve overtime?'],
  ['my project is missing', false, 'Why is a project missing?'],
  ['how do I export my report', true, 'How do I create a report?'],
  ['what is the weather', false, undefined],
  ['project', true, undefined],
  ['approve overtime', false, undefined],
  ['why is my salary unpaid', true, undefined]
  , ['why can’t I approve overtime', true, undefined]
]) test(`Help matching: ${question} (${admin ? 'admin' : 'employee'})`, () => {
  assert.equal(context.matchWorkspaceHelp(question, context.workspaceHelpEntries(admin))?.[0], expected);
});

const backend = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
function harness({ head = false, mailFails = false, saveFails = false } = {}) {
  const handlers = {}, calls = [];
  const builder = { insert(value) { calls.push(value); return this; }, select() { return this; }, single() { return this; }, order() { return this; }, limit() { return this; } };
  const env = vm.createContext({
    app: { post: (path, ...chain) => { handlers.post = chain.at(-1); }, get: (path, ...chain) => { handlers.get = chain.at(-1); } },
    authenticate() {}, activeOnly() {}, adminOnly() {}, helpRequestLimiter() {},
    optionalText: value => typeof value === 'string' && value.trim().length <= 1000 ? value.trim() : null,
    fail: (res, status, error) => res.status(status).json({ error }),
    db: { from: () => builder }, query: async () => { if (saveFails) throw Error('database unavailable'); return { id: 'saved' }; },
    gmailConfigured: false, mailTransport: { async sendMail() { if (mailFails) throw Error('mail unavailable'); } },
    headAdminEmail: 'head@example.test', smtpUser: '', process: { env: {} }, console: { warn() {} },
    isHeadAdmin: () => head, pageParams: () => ({ paged: false }), pagedResult: async () => [{ id: 'saved' }]
  });
  vm.runInContext(backend.slice(backend.indexOf("app.post('/v1/help-requests'"), backend.indexOf('const protectHeadAdmin')), env);
  const req = { profile: { id: 'user', email: 'user@example.test', full_name: 'User' }, body: { question: 'Where is my missing project?' }, query: {} };
  const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  return { handlers, calls, req, res };
}
test('Non-head administrators cannot read inquiries', async () => {
  const h = harness(); await h.handlers.get(h.req, h.res, error => { throw error; }); assert.equal(h.res.code, 403);
});
test('Head administrator can read inquiries', async () => {
  const h = harness({ head: true }); await h.handlers.get(h.req, h.res, error => { throw error; }); assert.equal(h.res.body[0].id, 'saved');
});
test('Inquiry survives a notification email failure', async () => {
  const h = harness({ mailFails: true }); await h.handlers.post(h.req, h.res, error => { throw error; });
  assert.equal(h.res.code, 201); assert.equal(h.calls[0].sender_email, h.req.profile.email); assert.equal(h.calls[0].question, h.req.body.question);
});
test('Database failure is not reported as successful delivery', async () => {
  const h = harness({ saveFails: true }); let failure;
  await h.handlers.post(h.req, h.res, error => { failure = error; }); assert.ok(failure); assert.equal(h.res.body, undefined);
});
test('Empty and oversized inquiries are rejected', async () => {
  for (const question of ['', 'a'.repeat(1001)]) { const h = harness(); h.req.body.question = question; await h.handlers.post(h.req, h.res, error => { throw error; }); assert.equal(h.res.code, 400); assert.equal(h.calls.length, 0); }
});
