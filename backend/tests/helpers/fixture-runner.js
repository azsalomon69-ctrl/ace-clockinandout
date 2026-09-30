const frame = document.getElementById('app');
const output = document.getElementById('results');
output.textContent = '';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
const doc = () => frame.contentDocument;
const win = () => frame.contentWindow;
async function wait(predicate, message, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (predicate()) return; await sleep(30); }
  throw new Error(message);
}
async function load(page) {
  const oldId = win().fixtureDocumentId;
  frame.src = '/' + page;
  await wait(() => doc()?.documentElement?.dataset.fixtureReady === 'true' && win().fixtureDocumentId !== oldId && win().location.pathname === '/' + page, `Page did not become ready: ${page}`);
}
async function setup(options, page) {
  localStorage.clear(); sessionStorage.clear();
  await post('/control', options); await load(page);
}
const title = () => doc()?.querySelector('.ace-tutorial-card h2')?.textContent;
async function click(selector) {
  const button = doc().querySelector(selector);
  assert(button, `Control missing: ${selector}; heading=${title()}`);
  button.click(); await sleep(80);
}
async function saveSettled() { await sleep(180); }
const profile = () => fetch('/v1/me').then(r => r.json()).then(r => r.profile);
async function tour(role) {
  await click('[data-tutorial-start]');
  const allowed = role === 'USER'
    ? ['Start and finish your shift', 'Review your shifts', 'Find a past shift', 'Read administrator remarks', 'Check your status', 'Review time this week', 'Use quick actions', 'Keep your profile current', 'Check your assigned schedule', 'Talk with an administrator']
    : ['Your admin dashboard', 'Use quick actions', 'Read workspace status', 'Invite a team member', 'Read the live analytics', 'Review time-entry alerts', 'Manage user accounts', 'Track and cancel invitations', 'Set up departments', 'Set up projects', 'Create schedules and flextime', 'Assign a schedule', 'Review and export time entries', 'Review active employee shifts', 'Correct, approve overtime, or remove safely', 'Restore deleted time entries', 'Restore archived users', 'Open saved reports', 'Prepare individual reports', 'Review the audit log', 'Update your administrator profile', 'Review account security', 'Choose display preferences'];
  let count = 0;
  while (count++ < 40) {
    await wait(() => !!doc()?.querySelector('[data-tutorial-next]'), `Expected next lesson; actual=${title()}`);
    assert(allowed.includes(title()), `${role} displayed wrong/unexpected lesson: ${title()}`);
    const button = doc().querySelector('[data-tutorial-next]');
    const last = button.textContent === 'Finish';
    const oldTitle = title(); const oldId = win().fixtureDocumentId;
    button.click();
    if (last) { await wait(() => !doc().querySelector('.ace-tutorial-overlay'), 'Finish did not dismiss'); await saveSettled(); return; }
    await wait(() => title() !== oldTitle || win().fixtureDocumentId !== oldId, `Next did not advance: ${oldTitle}`);
    await wait(() => doc()?.documentElement?.dataset.fixtureReady === 'true', 'New page not ready');
  }
  throw new Error('Tutorial exceeded 40 steps');
}
const tests = {
  async proof() {
    await setup({ role: 'USER', status: 'SKIPPED', cache: false }, 'settings.html');
    const field = doc().getElementById('fullName'); field.focus();
    assert(doc().activeElement === field, 'Real browser focus unavailable');
    assert(field.getBoundingClientRect().width > 0 && win().getComputedStyle(field).display !== 'none', 'Real visibility unavailable');
    win().localStorage.setItem('fixture-proof', 'survives-navigation');
    const oldId = win().fixtureDocumentId;
    await load('user-dashboard.html');
    assert(win().fixtureDocumentId !== oldId, 'No document navigation');
    assert(win().localStorage.getItem('fixture-proof') === 'survives-navigation', 'localStorage did not survive navigation');
  },
  async B1() {
    await setup({ role: 'USER' }, 'user-dashboard.html');
    assert(title() === 'Take a quick tour?', 'Employee welcome missing');
    await tour('USER');
    assert((await profile()).tutorial_status === 'COMPLETED', 'Employee completion not persisted');
    localStorage.clear(); await load('user-dashboard.html');
    assert(!doc().querySelector('.ace-tutorial-overlay'), 'Employee tutorial reappeared at second login');
  },
  async B2() {
    await setup({ role: 'ADMIN' }, 'admin-dashboard.html');
    assert(title() === 'Take a quick tour?', 'Admin welcome missing');
    await tour('ADMIN');
    assert((await profile()).tutorial_status === 'COMPLETED', 'Admin completion not persisted');
    localStorage.clear(); await load('admin-dashboard.html');
    assert(!doc().querySelector('.ace-tutorial-overlay'), 'Admin tutorial reappeared at second login');
  },
  async B3() {
    for (const role of ['USER', 'ADMIN']) {
      const page = role === 'USER' ? 'user-dashboard.html' : 'admin-dashboard.html';
      await setup({ role }, page); await click('[data-tutorial-skip]'); await saveSettled();
      assert((await profile()).tutorial_status === 'SKIPPED', `${role}: skip not persisted`);
      localStorage.clear(); await load(page);
      assert(!doc().querySelector('.ace-tutorial-overlay'), `${role}: skipped tutorial reappeared`);
    }
  },
  async B6() {
    for (const role of ['USER', 'ADMIN']) for (const outcome of ['SKIPPED', 'COMPLETED', 'IN_PROGRESS']) {
      const last = role === 'USER' ? 9 : 22;
      const step = outcome === 'COMPLETED' ? last : 1;
      const page = role === 'USER' ? (outcome === 'COMPLETED' ? 'user-dashboard.html' : 'time-entries.html') : (outcome === 'COMPLETED' ? 'settings.html' : 'admin-dashboard.html');
      await setup({ role, cache: false, status: 'IN_PROGRESS', step, offline: true }, page);
      await click(outcome === 'SKIPPED' ? '[data-tutorial-skip]' : '[data-tutorial-next]');
      await sleep(800);
      await load(page);
      if (outcome === 'IN_PROGRESS') assert(doc().querySelector('.ace-tutorial-progress')?.textContent.startsWith('Step 3 '), `${role}: offline resume lost newest step`);
      else assert(!doc().querySelector('.ace-tutorial-overlay'), `${role}: offline ${outcome} ignored on reload`);
      await post('/fault', { offline: false }); await load(page); await saveSettled();
      assert((await profile()).tutorial_status === outcome, `${role}: ${outcome} did not synchronize after recovery`);
    }
  },
  async B4() {
    await setup({ role: 'USER', cache: false }, 'user-dashboard.html');
    await tour('USER');
    assert((await profile()).tutorial_status === 'COMPLETED', 'Employee completion missing before promotion');
    await post('/promote', { role: 'ADMIN' });
    localStorage.clear(); await load('admin-dashboard.html');
    assert(title() === 'Take a quick tour?', `Admin welcome missing after employee completion/promotion; actual=${title() || 'no tutorial'}`);
    await tour('ADMIN');
    await post('/promote', { role: 'USER' });
    localStorage.clear(); await load('user-dashboard.html');
    assert(!doc().querySelector('.ace-tutorial-overlay'), 'Completed employee tutorial reappeared after role roundtrip');
  },
  async B8() {
    for (const role of ['USER', 'ADMIN']) {
      await setup({ role, cache: false, status: 'IN_PROGRESS', step: role === 'USER' ? 7 : 20 }, 'settings.html');
      await wait(() => !!doc().querySelector('[data-tutorial-next]'), 'Profile lesson missing');
      const field = doc().getElementById('fullName');
      field.focus();
      assert(doc().activeElement === field, `${role}: profile input lost real browser focus to ${doc().activeElement?.outerHTML}`);
      assert(doc().querySelector('.ace-tutorial-overlay').getAttribute('aria-modal') !== 'true', `${role}: interactive lesson still modal`);
    }
  },
  async B7() {
    for (const role of ['USER', 'ADMIN']) {
      await setup({ role, cache: false }, 'settings.html');
      await click('[data-tutorial-start]');
      const expected = role === 'USER' ? 'Start and finish your shift' : 'Your admin dashboard';
      await wait(() => title() === expected, `${role}: Start on Settings must begin with ${expected}; actual=${title()}`);
    }
  },
  async B9() {
    const failures = [];
    await setup({ role: 'USER', cache: false, clockedIn: true }, 'user-dashboard.html');
    await click('[data-tutorial-start]');
    await sleep(250);
    if (!doc().querySelector('#mainClockOutBtn.ace-tutorial-target')) failures.push('Clocked-in lesson does not highlight visible Clock Out');
    const steps = win().ACETutorialConfig.USER.steps;
    for (const expected of ['Check your assigned schedule', 'Talk with an administrator']) {
      if (!steps.some(step => step.title === expected)) failures.push(`Missing employee lesson: ${expected}`);
    }
    assert(!failures.length, failures.join('; '));
    for (const schedule of [true, false]) {
      const index = steps.findIndex(step => step.title === 'Check your assigned schedule');
      await setup({ role: 'USER', cache: false, status: 'IN_PROGRESS', step: index, schedule }, 'user-dashboard.html');
      assert(title() === 'Check your assigned schedule', 'Schedule lesson missing');
      assert(!doc().querySelector('.ace-tutorial-missing'), 'Schedule lesson unresolved');
      assert(doc().querySelector('[data-tutorial-next]'), 'Schedule lesson cannot continue');
    }
    const chatIndex = steps.findIndex(step => step.title === 'Talk with an administrator');
    await setup({ role: 'USER', cache: false, status: 'IN_PROGRESS', step: chatIndex }, 'user-dashboard.html');
    const launcher = doc().querySelector('.employee-chat-launcher');
    assert(launcher?.getBoundingClientRect().width > 0, 'Chat launcher invisible');
    assert(launcher.classList.contains('ace-tutorial-target'), 'Chat lesson does not target actual launcher');
  },
  async B10() {
    const failures = [];
    for (const scenario of [
      { page: 'users.html', step: 6, empty: true },
      { page: 'users.html', step: 6, headFirst: true },
      { page: 'admin-time-entries.html', step: 14, empty: true },
      { page: 'audit-logs.html', step: 19, empty: true }
    ]) {
      await setup({ role: 'ADMIN', cache: false, status: 'IN_PROGRESS', ...scenario }, scenario.page);
      const target = doc().querySelector('.ace-tutorial-target');
      if (doc().querySelector('.ace-tutorial-missing') || !target || target.getBoundingClientRect().width === 0) failures.push(`${scenario.page} ${scenario.headFirst ? 'head-first' : 'empty'}: no visible lesson target`);
      if (scenario.headFirst && !target?.matches('.admin-user-actions-toggle')) failures.push('Head-first users: did not choose eligible later row');
      if (!doc().querySelector('[data-tutorial-next]')) failures.push(`${scenario.page}: Next unavailable`);
    }
    assert(!failures.length, failures.join('; '));
  }
};
const selected = new URLSearchParams(location.search).get('tests')?.split(',') || ['proof', 'B1', 'B4', 'B8'];
for (const name of selected) {
  const started = Date.now();
  try {
    await tests[name]();
    const result = { test: name, status: 'PASS' }; output.textContent += JSON.stringify(result) + '\n'; await post('/results', result);
  } catch (error) {
    const result = { test: name, status: 'FAIL', error: error.message }; output.textContent += JSON.stringify(result) + '\n'; await post('/results', result);
    if (name === 'proof') break;
  }
}
output.textContent += 'RUN FINISHED\n';
