import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import jwt from 'jsonwebtoken';
import { createSessionSecurity } from '../server/session-security.js';

const userId = '10000000-0000-4000-8000-000000000001';
const sessionId = '20000000-0000-4000-8000-000000000001';
const source = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
// Run the actual middleware, with identity verification and storage doubles.
const middleware = source.slice(source.indexOf('async function authenticate('), source.indexOf('const adminOnly ='));
const token = (claims = {}) => jwt.sign({ sub: userId, session_id: sessionId, ...claims }, 'fixture-only', { expiresIn: '5m' });

function store() {
  const state = { revoked: new Set(), reads: 0, error: null, profile: { id: userId, role: 'ADMIN', status: 'ACTIVE', email: 'head@example.test' } };
  state.db = { async rpc(name, args) {
    if (name === 'ace_end_session') { state.revoked.add(args.p_session_id); return { error: null }; }
    assert.equal(name, 'ace_session_profile');
    state.reads++;
    return { error: state.error, data: state.revoked.has(args.p_session_id) ? null : { ...state.profile } };
  } };
  return state;
}

function instance(state, { fallback = false, debugWorkspace = false, avatar } = {}) {
  const security = createSessionSecurity(state.db);
  const context = vm.createContext({
    sessionSecurity: security,
    tokenCacheKey: value => value,
    isTokenRevoked: () => false, // Another instance/restart has no local revocations.
    revokedTokenCache: new Map(),
    verifySupabaseJwt: async value => {
      if (fallback) throw new Error('Signing key unavailable');
      const claims = jwt.verify(value, 'fixture-only');
      return { id: claims.sub, email: 'head@example.test' };
    },
    getUserFromGoTrue: async value => ({ id: jwt.verify(value, 'fixture-only').sub, email: 'head@example.test' }),
    debugWorkspace, headAdminEmail: 'head@example.test',
    persistGoogleAvatar: async profile => avatar || profile,
    fail: (res, status, error) => { res.status = status; res.error = error; }
  });
  vm.runInContext(middleware, context);
  return {
    security,
    async request(value = token()) {
      const req = { headers: { authorization: `Bearer ${value}` } }, res = {};
      let allowed = false;
      await context.authenticate(req, res, () => { allowed = true; });
      return { allowed, req, ...res };
    }
  };
}

for (const fallback of [false, true]) {
  test(`API middleware rejects revoked sessions across instances and restart (GoTrue fallback: ${fallback})`, async () => {
    const state = store(), a = instance(state), b = instance(state, { fallback });
    const original = token();
    assert.equal((await b.request(original)).allowed, true);
    await a.security.end(userId, sessionId, null);
    for (const server of [b, instance(state, { fallback })]) {
      const result = await server.request(original);
      assert.equal(result.allowed, false);
      assert.equal(result.status, 401);
    }
    const later = await b.request(token({ session_id: '30000000-0000-4000-8000-000000000001' }));
    assert.equal(later.allowed, true, 'a later independent session remains usable');
  });
}

test('API middleware fails closed with 503 during session-store failure and recovers', async () => {
  const state = store(), server = instance(state);
  state.error = { code: 'unavailable' };
  const failed = await server.request();
  assert.equal(failed.allowed, false);
  assert.equal(failed.status, 503);
  state.error = null;
  assert.equal((await server.request()).allowed, true);
});

test('API middleware keeps fresh role/status even when avatar cache returns an old profile', async () => {
  const state = store();
  const server = instance(state, { avatar: { ...state.profile, profile_picture_url: 'https://example.test/avatar' } });
  assert.equal((await server.request()).req.profile.role, 'ADMIN');
  state.profile.role = 'USER';
  state.profile.status = 'DENIED';
  const result = await server.request();
  assert.equal(result.req.profile.role, 'USER');
  assert.equal(result.req.profile.status, 'DENIED');
  assert.equal(result.req.authSessionId, sessionId);
  assert.equal(state.reads, 2);
});

test('debug API applies durable session checks and preserves account allowlist', async () => {
  const state = store(), server = instance(state, { debugWorkspace: true });
  assert.equal((await server.request()).allowed, true);
  state.profile.email = 'other@example.test';
  assert.equal((await server.request()).status, 403);
  state.revoked.add(sessionId);
  assert.equal((await server.request()).status, 401);
});
