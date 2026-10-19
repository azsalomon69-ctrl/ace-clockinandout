import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../frontend/js/script.js', import.meta.url), 'utf8');
const resume = source.slice(source.indexOf('async function resumePublicSession()'), source.indexOf('async function recordLoginOnce()'));

for (const page of ['index', 'login']) {
  test(`${page} loads authentication before the shared session check`, () => {
    const html = readFileSync(new URL(`../../frontend/${page}.html`, import.meta.url), 'utf8');
    const scripts = [...html.matchAll(/<script\b[^>]*src="([^"?]+)/g)].map(match => match[1]);
    const startup = scripts.indexOf('js/script.js');
    const config = scripts.indexOf('js/api-config.js');
    const sdk = scripts.indexOf('js/supabase.js');
    const auth = scripts.indexOf('js/supabase-auth.js');
    assert.ok(config >= 0 && sdk > config && auth > sdk && startup > auth);
  });
}

function harness({ role = 'USER', status = 'ACTIVE', session = true, failure } = {}) {
  const redirects = [], requests = [], saved = [], notices = [];
  let audits = 0;
  const context = vm.createContext({
    window: { ACEAuth: {
      session: async () => session ? { access_token: 'test-token' } : null,
      request: async path => { requests.push(path); if (failure) throw failure; return { profile: { role, status } }; }
    }, location: { replace: path => redirects.push(path) } },
    AppState: {}, profileRecord: profile => ({ Role: profile.role, Status: profile.status }),
    localStorage: { setItem: (key, value) => saved.push({ key, value }) },
    sessionStorage: { setItem: (key, value) => notices.push({ key, value }) },
    inactiveAccountMessage: 'Contact your administrator.',
    recordLoginOnce: async () => { audits++; }
  });
  vm.runInContext(resume, context);
  return { run: context.resumePublicSession, redirects, requests, saved, notices, audits: () => audits };
}
for (const [role, destination] of [['ADMIN', '/admin-dashboard'], ['USER', '/user-dashboard']]) {
  test(`returning ${role} is verified before redirecting to their dashboard`, async () => {
    const app = harness({ role }); await app.run();
    assert.deepEqual(app.requests, ['/v1/me']);
    assert.deepEqual(app.redirects, [destination]);
    assert.equal(app.audits(), 1);
  });
}
test('signed-out visitors stay on the public page without requesting a profile', async () => {
  const app = harness({ session: false }); await app.run();
  assert.deepEqual(app.redirects, []); assert.deepEqual(app.requests, []);
});
test('inactive accounts are not redirected to a dashboard', async () => {
  const app = harness({ status: 'DENIED' }); await app.run();
  assert.deepEqual(app.redirects, []); assert.equal(app.audits(), 0);
  assert.equal(app.notices[0].key, 'ace_login_notice');
});
test('a failed profile verification cannot redirect from cached sign-in state', async () => {
  const app = harness({ failure: new Error('Service unavailable') });
  await assert.rejects(app.run(), /Service unavailable/);
  assert.deepEqual(app.redirects, []); assert.deepEqual(app.saved, []);
});
