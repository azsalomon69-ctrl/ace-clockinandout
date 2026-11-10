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
  , ['why can’t I approve overtime', true, 'Why is approved overtime blank?']
, ["Hello can you tell me how to add a new staff member please",true,"How do I invite someone?"]
, ["I want to start my shift",false,"How do I clock in?"]
, ["How do I finish work",false,"How do I clock out?"]
, ["clocking in is not working",false,"Why can I not clock in?"]
, ["my clock out button is disabled",false,"Why can I not clock out?"]
, ["my project is not showing",false,"Why is a project missing?"]
, ["where can i download my timesheet",true,"How do I create a report?"]
, ["Can you help me assign a project to an employee",true,"How do I assign a person to a project?"]
, ["how can I change my profile picture",false,"How do I update my profile?"]
, ["I need to reset my password",false,"How do I change my password or security settings?"]
, ["can I take a lunch break",false,"Does ACE track breaks?"]
, ["I left my timer running",false,"I forgot to clock out"]
, ["where can I see my hours worked",false,"Where are my previous shifts?"]
, ["how to use dark mode",false,"How do I change dark mode or appearance?"]
, ["how can I add a new department",true,"How do I create or edit a department?"]
, ["how can I change employee schedule",true,"How do I create and assign a schedule?"]
, ["why is overtime not showing",true,"Why is approved overtime blank?"]
, ["I need to recover a time entry",true,"Where are deleted time entries?"]
, ["how do I fix a wrong clock in time",false,"Can I edit or delete my own time entry?"]
, ["how do I fix a wrong clock in time",true,"How do I view or correct time entries?"]
, ["how do I add a remark",true,"How do I add a remark to a time entry?"]
, ["how do I delete my password",false, undefined]
, ["how do I export a recipe",true, undefined]
, ["how do I invite someone to my wedding",true, undefined]
, ["how do I delete a project",false, undefined]
, ["what is the weather forecast tomorrow",true, undefined]
]) test(`Help matching: ${question} (${admin ? 'admin' : 'employee'})`, () => {
  assert.equal(context.matchWorkspaceHelp(question, context.workspaceHelpEntries(admin))?.[0], expected);
});

test('Ambiguous project questions clarify and accept a short follow-up', () => {
  const result = context.matchWorkspaceHelp('project', context.workspaceHelpEntries(true), true);
  assert.equal(result.match, null);
  assert.equal(result.alternatives.length, 2);
  assert.equal(context.matchWorkspaceHelp('assign', result.alternatives)?.[0], 'How do I assign a person to a project?');
});

test('Administrators can ask about their own clock and password', () => {
  const entries = context.workspaceHelpEntries(true);
  assert.equal(context.matchWorkspaceHelp('start shift', entries)?.[0], 'How do I clock in?');
  assert.equal(context.matchWorkspaceHelp('change password', entries)?.[0], 'How do I change my password or security settings?');
});

const conversation = admin => context.createWorkspaceHelpConversation(context.workspaceHelpEntries(admin));

test('Project clarification resolves actions, ordinals, and longer contextual replies', () => {
  for (const [reply, action] of [
    ['create', 'create or manage a project'],
    ['the first one', 'create or manage a project'],
    ['assign', 'assign a person to a project'],
    ['the second one', 'assign a person to a project'],
    ['I want to assign it to someone', 'assign a person to a project']
  ]) {
    const ask = conversation(true);
    assert.match(ask('project').reply, /Do you mean/);
    assert.equal(ask(reply).match?.[0], `How do I ${action}?`);
  }
});

test('Rejection and repeated clarification replies never select an unrelated topic', () => {
  const ask = conversation(true);
  ask('project');
  assert.match(ask('no').reply, /What else/);
  assert.equal(ask('no').inquiry, '');
  assert.match(ask('the first one').reply, /no current list/);
  ask('project');
  assert.match(ask('the second one').match?.[0], /assign/);
  assert.equal(ask('the second one').match, null);
});

test('Explicit topic changes replace pending choices and do not attach stale context', () => {
  const ask = conversation(true);
  ask('project');
  assert.equal(ask('how do I export a report').match?.[0], 'How do I create a report?');
  assert.equal(ask('the first one').match, null);
  ask('project');
  assert.equal(ask('weather in Manila').inquiry, 'weather in Manila');
  assert.equal(ask('the second one').match, null);
});

test('Missed punches ask for direction and keep the employee’s reply', () => {
  const ask = conversation(false);
  for (const question of ['missed punch', 'I missed a punch']) {
    assert.equal(context.matchWorkspaceHelp(question, context.workspaceHelpEntries(false)), null);
    assert.match(ask(question).reply, /miss clock-in or clock-out/);
    assert.match(ask('not sure').inquiry, /Original question:/);
    assert.match(ask('clock in').reply, /when you actually started work/);
    assert.match(ask(question).reply, /miss clock-in or clock-out/);
    assert.match(ask('I missed clock out').reply, /when you actually finished work/);
  }
  ask('missed punch');
  assert.match(ask('change password').match?.[0], /password/);
  assert.equal(ask('the second one').match, null);
});

test('Vague or empty questions do not produce confident answers', () => {
  for (const admin of [false, true]) {
    const ask = conversation(admin);
    assert.equal(ask('  '), null);
    for (const input of ['record', 'project', 'time', 'weather in Manila']) {
      const result = ask(input);
      assert.equal(result.match, null, input);
      assert.ok(result.inquiry, input);
    }
  }
});

test('Clock typos and contractions resolve without expanding unrelated fuzzy matches', () => {
  const ask = conversation(false);
  for (const question of ['clock out', 'clok out', 'clcok out', 'punch out']) {
    assert.equal(ask(question).match?.[0], 'How do I clock out?');
  }
  for (const question of ['cant clock out', "can't clock out", 'can’t clock out']) {
    assert.equal(ask(question).match?.[0], 'Why can I not clock out?');
  }
  assert.equal(ask('clok in').match?.[0], 'How do I clock in?');
  assert.equal(ask('clok out of a hotel').match, null);
});

test('Looking for deleted records is distinct from changing or deleting a record', () => {
  const input = 'Where are deleted time entries?';
  assert.equal(conversation(false)(input).match, null);
  assert.equal(conversation(true)(input).match?.[0], input);
  assert.equal(conversation(false)('how do I fix a wrong clock in time').match?.[0], 'Can I edit or delete my own time entry?');
  assert.equal(conversation(true)('how do I fix a wrong clock in time').match?.[0], 'How do I view or correct time entries?');
});

test('Role catalogs retain their sizes and continue to select role-specific instructions', () => {
  assert.equal(context.workspaceHelpEntries(false).length, 27);
  assert.equal(context.workspaceHelpEntries(true).length, 36);
  const employee = conversation(false), admin = conversation(true);
  for (const [input, expected] of [
    ['invite staff', 'How do I invite someone?'],
    ['change employee schedule', 'How do I create and assign a schedule?'],
    ['assign a project to an employee', 'How do I assign a person to a project?'],
    ['download employee hours', 'How do I create a report?'],
    ['approve overtime', 'How do I approve overtime?']
  ]) {
    assert.notEqual(employee(input).match?.[0], expected);
    assert.equal(admin(input).match?.[0], expected);
  }
  assert.match(employee('change password').reply, /^Open Profile/);
  assert.match(admin('change password').reply, /^Open Administration/);
});

test('Follow-ups use the last answered topic and inquiries keep bounded context', () => {
  const ask = conversation(false);
  ask('How do I clock in?');
  assert.match(ask('What if I don’t have one?').reply, /choose No project/);
  const followup = ask('What if it is still disabled after that?');
  assert.match(followup.inquiry, /^What if it is still disabled after that\?/);
  assert.match(followup.inquiry, /Original question: How do I clock in\?/);
  assert.match(followup.inquiry, /Earlier help topic: How do I clock in\?/);
  const longQuestion = 'What if ' + 'x'.repeat(980);
  const longInquiry = ask(longQuestion).inquiry;
  assert.ok(longInquiry.startsWith(longQuestion));
  assert.ok(longInquiry.length <= 1000);
});

function inquiryConversation({ failOnce = false } = {}) {
  const calls = [];
  const env = vm.createContext({
    askHelp: conversation(false),
    window: { ACEAuth: { async request(path, options) {
      calls.push({ path, ...JSON.parse(options.body) });
      if (failOnce && calls.length === 1) throw new Error('Inquiry service unavailable');
    } } }
  });
  const askStart = frontend.indexOf('    function ask(question)');
  const askEnd = frontend.indexOf('    function open(', askStart);
  const sendStart = frontend.indexOf("    forward.addEventListener('click',async", askEnd);
  const sendEnd = frontend.indexOf("    bot.addEventListener('keydown'", sendStart);
  vm.runInContext(`
    let sending = false, pendingQuestion = '', reviewedQuestion = '', finishTyping = null;
    function updateSendButton() { sendButton.disabled = sending || Boolean(finishTyping); }
    const messages = [], scrollArea = {}, sendButton = {};
    const form = { querySelector() { return sendButton; } };
    const forward = { hidden: true, addEventListener(_, handler) { this.click = handler; } };
    function appendMessage(text) { messages.push(text); }
    function react() {}
    function placePanel() {}
    ${frontend.slice(askStart, askEnd)}
    ${frontend.slice(sendStart, sendEnd)}
    function clickSend() { return forward.click(); }
    function state() { return { latest: messages.at(-1), hidden: forward.hidden, disabled: forward.disabled }; }
  `, env);
  return { calls, ask: env.ask, click: env.clickSend, state: env.state };
}

test('Escalation previews the exact context and requires explicit confirmation', async () => {
  const chat = inquiryConversation();
  chat.ask('How do I clock in?');
  assert.equal(chat.state().hidden, true);
  chat.ask('What if it is still disabled after that?');
  assert.equal(chat.state().hidden, false);
  assert.equal(chat.calls.length, 0);
  await chat.click();
  assert.equal(chat.calls.length, 0);
  const preview = chat.state().latest;
  assert.match(preview, /Original question: How do I clock in\?/);
  await chat.click();
  assert.deepEqual(chat.calls, [{ path: '/v1/help-requests', question: preview }]);
  assert.equal(chat.state().hidden, true);
  await chat.click();
  assert.equal(chat.calls.length, 1);
});

test('A new question invalidates the reviewed draft and a failed inquiry can be retried', async () => {
  const chat = inquiryConversation({ failOnce: true });
  chat.ask('Weather in Manila');
  await chat.click();
  chat.ask('Where is my tax form?');
  await chat.click();
  assert.equal(chat.calls.length, 0);
  assert.equal(chat.state().latest, 'Where is my tax form?');
  await chat.click();
  assert.equal(chat.state().latest, 'Inquiry service unavailable');
  assert.equal(chat.state().hidden, false);
  assert.equal(chat.state().disabled, false);
  await chat.click();
  assert.deepEqual(chat.calls.map(({ question }) => question), ['Where is my tax form?', 'Where is my tax form?']);
  assert.equal(chat.state().hidden, true);
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


test('Employees receive administrator referral for restricted tasks, including after follow-ups', () => {
  for (const question of ['how to add user', 'invite staff', 'create department', 'approve overtime', 'assign a project to an employee', 'where is the audit history']) {
    const ask = conversation(false);
    ask('How do I clock in?');
    const result = ask(question);
    assert.equal(result.match, null, question);
    assert.match(result.reply, /administrators only/, question);
    assert.equal(result.inquiry, question);
    assert.doesNotMatch(ask('first one').reply, /People →|Administration →|Assign schedule/);
  }
});

test('Employee answers contain no administrator navigation paths', () => {
  for (const [, reply] of context.workspaceHelpEntries(false)) {
    assert.doesNotMatch(reply, /People →|Administration →|Insights →/);
  }
  assert.match(frontend, /mountWorkspaceHelp\(AppState\.currentUser\?\.Role === 'ADMIN'\)/);
});
