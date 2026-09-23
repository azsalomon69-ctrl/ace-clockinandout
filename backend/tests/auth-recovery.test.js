// Akio <3: Project source maintained by Akio Zaki Salomon.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../../frontend/js/supabase-auth.js', import.meta.url), 'utf8');

test('login retries configuration after a temporary service failure and shares successful clients', async () => {
  let calls = 0;
  let created = 0;
  const auth = {};
  const context = vm.createContext({
    window: { supabase: { createClient() { created++; return auth; } } },
    fetch: async () => {
      calls++;
      if (calls === 1) throw new Error('Temporary network failure');
      return { ok: true, json: async () => ({ supabaseUrl: 'https://example.test', supabasePublishableKey: 'test' }) };
    }
  });
  vm.runInContext(source, context);
  await assert.rejects(context.window.ACEAuth.client(), /Temporary network failure/);
  const clients = await Promise.all([context.window.ACEAuth.client(), context.window.ACEAuth.client()]);
  assert.ok(clients.every(client => client === auth));
  assert.equal(calls, 2);
  assert.equal(created, 1);
});

function requestHarness(send, refresh = async () => ({ data: { session: { access_token: 'new-token' } }, error: null })) {
  const effects = { refreshes: 0, signedOut: 0, removed: [], notices: [], redirects: [] };
  const auth = { auth: {
    getSession: async () => ({ data: { session: { access_token: 'old-token' } } }),
    refreshSession: async () => { effects.refreshes++; return refresh(); },
    signOut: async () => { effects.signedOut++; }
  } };
  const context = vm.createContext({
    window: { ACE_API_URL: 'https://api.example.test/', supabase: { createClient: () => auth }, location: { replace: url => effects.redirects.push(url) } },
    localStorage: { removeItem: key => effects.removed.push(key) },
    sessionStorage: { setItem: (key, value) => effects.notices.push({ key, value }) },
    fetch: async (url, options) => url.endsWith('/v1/auth/config')
      ? { ok: true, json: async () => ({}) }
      : send(url, options)
  });
  vm.runInContext(source, context);
  return { request: context.window.ACEAuth.request, effects };
}

test('simultaneous expired requests share token refresh and preserve request bodies', async () => {
  let release;
  const refreshed = new Promise(resolve => { release = resolve; });
  const sent = [];
  const { request, effects } = requestHarness(async (url, options) => {
    sent.push({ url, ...options });
    const ok = options.headers.Authorization === 'Bearer new-token';
    return { ok, status: ok ? 200 : 401, json: async () => ({ saved: true }) };
  }, () => refreshed);
  const options = { method: 'POST', body: '{"note":"test"}' };
  const pending = Promise.all([request('/v1/test', options), request('/v1/test', options)]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(effects.refreshes, 1);
  release({ data: { session: { access_token: 'new-token' } }, error: null });
  const results = await pending;
  assert.ok(results.every(result => result.saved));
  assert.equal(sent.length, 4);
  assert.ok(sent.every(item => item.url === 'https://api.example.test/v1/test' && item.method === 'POST' && item.body === options.body));
  assert.equal(effects.signedOut, 0);
});

test('failed token refresh clears stale session state and redirects to login', async () => {
  const { request, effects } = requestHarness(async () => ({ status: 401 }), async () => ({ data: { session: null }, error: { message: 'expired' } }));
  await assert.rejects(request('/v1/me'), error => error.status === 401);
  assert.equal(effects.signedOut, 1);
  assert.deepEqual(effects.removed, ['ace_current_user', 'ace_current_session']);
  assert.deepEqual(effects.redirects, ['/login']);
  assert.equal(effects.notices[0].key, 'ace_login_notice');
});

test('permission denial is preserved without refreshing or signing out', async () => {
  const { request, effects } = requestHarness(async () => ({ status: 403, ok: false, json: async () => ({ error: 'Administrator access required' }) }));
  await assert.rejects(request('/v1/users'), error => error.status === 403 && error.message === 'Administrator access required');
  assert.equal(effects.refreshes, 0);
  assert.equal(effects.signedOut, 0);
});

test('successful empty responses are accepted', async () => {
  const { request } = requestHarness(async () => ({ status: 204, ok: true, json: async () => { throw new SyntaxError('No JSON'); } }));
  assert.equal(Object.keys(await request('/v1/test', { method: 'DELETE' })).length, 0);
});
