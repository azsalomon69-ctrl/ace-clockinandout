import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const middleware = source.slice(source.indexOf('class InvalidSessionError'), source.indexOf('const isHeadAdmin'));
const admin = { id: 'admin', role: 'ADMIN', status: 'ACTIVE', email: 'head@example.test' };

function fixture({ user, profile, localVerificationFails = false } = {}) {
  const builder = {
    select() { return this; },
    eq() { return this; },
    is() { return this; },
    maybeSingle: profile || (async () => ({ data: admin }))
  };
  const context = vm.createContext({
    db: { auth: { getUser: user || (async () => ({ data: { user: { id: admin.id } } })) }, from: () => builder },
    console: { warn() {} },
    process: { env: { HEAD_ADMIN_EMAIL: admin.email } },
    cached: (_cache, _key, _ttl, load) => load(),
    authUserCache: new Map(),
    profileCache: new Map(),
    revokedTokenCache: new Map(),
    tokenCacheKey: () => 'fixture-token',
    verifySupabaseJwt: async () => {
      if (localVerificationFails) throw new Error('Local verification unavailable');
      return { id: admin.id };
    },
    query: async request => { const result = await request; if (result.error) throw result.error; return result.data; },
    persistGoogleAvatar: async value => value,
    jwt: { decode: () => ({ session_id: 'fixture-session' }) },
    fail: (_res, status, message) => ({ status, message })
  });
  vm.runInContext(middleware + '\nglobalThis.guards = { authenticate, adminOnly };', context);
  return (guard, overrides = {}) => context.guards[guard]({
    headers: { authorization: 'Bearer fixture' }, profile: admin, authToken: 'fixture', ...overrides
  }, {}, () => ({ status: 200 }));
}

test('a database failure with a valid token is retryable; a missing profile is forbidden', async () => {
  const failed = fixture({ profile: async () => ({ error: { code: 'PGRST000', message: 'private database details' } }) });
  const response = await failed('authenticate');
  assert.equal(response.status, 503);
  assert.doesNotMatch(response.message, /private database details/);
  assert.equal((await fixture({ profile: async () => ({ data: null }) })('authenticate')).status, 403);
});

test('authentication outages fail closed with 503 for employees and administrators', async () => {
  for (const user of [
    async () => ({ error: { status: 503, code: 'unexpected_failure' } }),
    async () => ({ error: { status: 429, code: 'over_request_rate_limit' } }),
    async () => { throw new TypeError('Connection interrupted'); }
  ]) {
    const call = fixture({ user, localVerificationFails: true });
    for (const guard of ['authenticate', 'adminOnly']) {
      assert.equal((await call(guard)).status, 503);
    }
  }
});

test('rejected tokens remain 401 and unauthorized roles remain 403', async () => {
  const call = fixture({ user: async () => ({ error: { status: 400, code: 'session_not_found' } }), localVerificationFails: true });
  for (const guard of ['authenticate', 'adminOnly']) {
    assert.equal((await call(guard)).status, 401);
  }
  assert.equal((await call('authenticate', { headers: {} })).status, 401);
  assert.equal((await call('adminOnly', { profile: { ...admin, role: 'USER' } })).status, 403);
});

test('valid users and authorized administrators still pass their guards', async () => {
  const call = fixture();
  for (const guard of ['authenticate', 'adminOnly']) {
    assert.equal((await call(guard)).status, 200);
  }
});
