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
    AbortController,
    window: { setTimeout, clearTimeout, supabase: { createClient() { created++; return auth; } } },
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

function requestHarness(send, refresh = async () => ({ data: { session: { access_token: 'new-token' } }, error: null }), timers = { setTimeout, clearTimeout }) {
  const effects = { refreshes: 0, signedOut: 0, removed: [], notices: [], redirects: [] };
  const auth = { auth: {
    getSession: async () => ({ data: { session: { access_token: 'old-token' } } }),
    refreshSession: async () => { effects.refreshes++; return refresh(); },
    signOut: async () => { effects.signedOut++; }
  } };
  const context = vm.createContext({
    AbortController,
    window: { ACE_API_URL: 'https://api.example.test/', ...timers, supabase: { createClient: () => auth }, location: { replace: url => effects.redirects.push(url) } },
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

test('a stalled session refresh times out without signing the employee out', async()=>{
 const {request,effects}=requestHarness(async()=>({status:401}),()=>new Promise(()=>{}),{setTimeout:fn=>setTimeout(fn,0),clearTimeout});
 await assert.rejects(request('/v1/me'),error=>error.code==='ETIMEDOUT');
 assert.equal(effects.signedOut,0);assert.deepEqual(effects.removed,[]);
});
test('a 503 during token refresh preserves the existing session', async()=>{
 const {request,effects}=requestHarness(async()=>({status:401}),async()=>({data:{session:null},error:{name:'AuthRetryableFetchError',status:503}}));
 await assert.rejects(request('/v1/me'),error=>error.status===503);
 assert.equal(effects.signedOut,0);assert.deepEqual(effects.redirects,[]);
});
test('a response whose body never finishes cannot leave startup hanging', async()=>{
 const {request,effects}=requestHarness(async()=>({status:200,ok:true,json:()=>new Promise(()=>{})}),undefined,{setTimeout:fn=>setTimeout(fn,0),clearTimeout});
 await assert.rejects(request('/v1/me'),error=>error.code==='ETIMEDOUT');assert.equal(effects.signedOut,0);
});
test('configuration readiness rejects 503 and HTML responses, then recovers without creating an auth client', async()=>{
 let calls=0;
 const context=vm.createContext({AbortController,window:{setTimeout,clearTimeout,supabase:{createClient(){assert.fail('Readiness must not initialize auth');}}},fetch:async()=>{
  calls++;return calls===1?{ok:false,status:503,json:async()=>({ok:false})}:calls===2?{ok:true,status:200,json:async()=>{throw new SyntaxError();}}:{ok:true,status:200,json:async()=>({supabaseUrl:"https://example.test",supabasePublishableKey:"public-test-key"})};
 }});
 vm.runInContext(source,context);
 await assert.rejects(context.window.ACEAuth.checkService(),{status:503});
 await assert.rejects(context.window.ACEAuth.checkService(),{status:503});
 await context.window.ACEAuth.checkService();assert.equal(calls,3);
});

test('browser startup succeeds even when a client filter blocks /health', async()=>{
 const calls=[];
 const context=vm.createContext({AbortController,window:{setTimeout,clearTimeout},fetch:async url=>{
  calls.push(url);
  if(url.endsWith('/health'))throw new TypeError('net::ERR_BLOCKED_BY_CLIENT');
  assert.ok(url.endsWith('/v1/auth/config'));
  return {ok:true,status:200,json:async()=>({supabaseUrl:'https://example.test',supabasePublishableKey:'public-test-key'})};
 }});
 vm.runInContext(source,context);await context.window.ACEAuth.checkService();
 assert.deepEqual(calls,['/v1/auth/config']);
});
