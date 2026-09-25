// Akio <3: Project source maintained by Akio Zaki Salomon.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Exercise the actual guard and route handlers without credentials or live writes.
const source = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('const headAdminEmail ='), source.indexOf('async function audit('));
const headEmail = 'azsalomon69@gmail.com';
const messages = {
  head: 'Only the head administrator can change this administrator account.',
  last: 'At least one active administrator must remain.',
  self: 'You cannot remove your own administrator account.'
};
const profile = (id, changes = {}) => ({ id, email: `${id}@example.com`, role: 'ADMIN', status: 'ACTIVE', permanently_deleted_at: null, ...changes });
const routeCases = [
  { name: 'new invitation', method: 'post', path: '/v1/invitations', body: { role: 'USER' } },
  { name: 'pending invitation', method: 'post', path: '/v1/invitations', body: { role: 'USER' }, duplicate: true },
  { name: 'access approval', method: 'patch', path: '/v1/access-requests/:id', body: { decision: 'APPROVE', role: 'USER' } },
  { name: 'user approval', method: 'patch', path: '/v1/users/:id/approval', body: { status: 'ACTIVE' } },
  { name: 'user denial', method: 'patch', path: '/v1/users/:id/approval', body: { status: 'DENIED' } },
  { name: 'role change', method: 'patch', path: '/v1/users/:id/role', body: { role: 'USER' } },
  { name: 'archive', method: 'patch', path: '/v1/users/:id/remove', body: {} },
  { name: 'restore', method: 'patch', path: '/v1/users/:id/restore', body: {}, status: 'DENIED' }
];

function harness(route, { actor = profile('actor'), target = profile('target', { status: route.status || 'ACTIVE' }), profiles, failCount = false } = {}) {
  const state = {
    profiles: structuredClone(profiles || [actor, ...(target && target.id !== actor.id ? [target] : [])]),
    invitations: [{ id: 'invitation', email: target?.email || 'new@example.com', status: 'PENDING', expires_at: route.duplicate ? '2999-01-01T00:00:00Z' : '2000-01-01T00:00:00Z' }],
    access_requests: [{ id: 'request', profile_id: target?.id, email: target?.email, status: 'PENDING', expires_at: '2999-01-01T00:00:00Z' }]
  };
  const effects = [];
  const initial = structuredClone(state);
  const db = {
    from(table) {
      return {
        table, filters: [], mode: 'read', fields: '*',
        select(fields = '*') { this.fields = fields; return this; },
        update(patch) { this.mode = 'update'; this.patch = patch; return this; },
        insert(patch) { this.mode = 'insert'; this.patch = patch; return this; },
        eq(key, value) { this.filters.push([key, value, row => row[key] === value]); return this; },
        is(key, value) { return this.eq(key, value); },
        gt(key, value) { this.filters.push([key, value, row => row[key] > value]); return this; },
        lte(key, value) { this.filters.push([key, value, row => row[key] <= value]); return this; },
        single() { this.cardinality = 'single'; return this; },
        maybeSingle() { this.cardinality = 'maybe'; return this; }
      };
    },
    auth: { admin: { async updateUserById(id, changes) { effects.push({ kind: 'auth', id, changes }); return { error: null }; } } },
    async rpc(name, args) {
      if (name === 'change_user_role_with_audit') {
        const targetProfile = state.profiles.find(row => row.id === args.p_target_user_id);
        if (!targetProfile) return { data: null, error: { code: 'P0001', message: 'PROFILE_NOT_FOUND' } };
        if (targetProfile.role === args.p_role) return { data: { ...targetProfile }, error: null };
        effects.push({ kind: 'update', table: 'profiles' });
        Object.assign(targetProfile, { role: args.p_role });
        effects.push({ kind: 'audit', action: 'CHANGE_ROLE' });
        return { data: { ...targetProfile }, error: null };
      }
      if (name === 'change_user_status_with_audit') {
        const targetProfile = state.profiles.find(row => row.id === args.p_target_user_id);
        if (!targetProfile) return { data: null, error: { code: 'P0001', message: 'PROFILE_NOT_FOUND' } };
        if (targetProfile.status === args.p_status) return { data: { ...targetProfile }, error: null };
        effects.push({ kind: 'update', table: 'profiles' });
        Object.assign(targetProfile, { status: args.p_status });
        effects.push({ kind: 'audit', action: args.p_status === 'ACTIVE' ? 'APPROVE' : 'DENY' });
        return { data: { ...targetProfile }, error: null };
      }
      if (name === 'submit_access_request') {
        const existing = args.p_existing_request_id && state.access_requests.find(row => row.id === args.p_existing_request_id);
        const request = existing || { id: 'new-request' };
        Object.assign(request, {
          profile_id: args.p_profile_id, email: args.p_email, full_name: args.p_full_name,
          requested_department: args.p_requested_department, message: args.p_message,
          requested_role: 'USER', request_ip: args.p_request_ip, expires_at: args.p_expires_at, status: 'PENDING'
        });
        if (!existing) state.access_requests.push(request);
        effects.push({ kind: 'audit', action: 'REQUEST_ACCESS' });
        return { data: { ...request }, error: null };
      }
      if (name === 'admin_update_profile_with_audit') {
        const targetProfile = state.profiles.find(row => row.id === args.p_target_user_id);
        if (!targetProfile) return { data: null, error: { code: 'P0001', message: 'PROFILE_NOT_FOUND' } };
        const patch = args.p_operation === 'APPROVAL' ? { status: args.p_status }
          : args.p_operation === 'CHANGE_ROLE' ? { role: args.p_role }
          : args.p_operation === 'ASSIGN_DEPARTMENT' ? { department_id: args.p_department_id }
          : args.p_operation === 'ARCHIVE_USER' ? { status: 'DENIED' }
          : args.p_operation === 'RESTORE_USER' ? { status: 'ACTIVE' } : null;
        assert.ok(patch, 'lifecycle RPC receives a fixed operation');
        effects.push({ kind: 'update', table: 'profiles' });
        Object.assign(targetProfile, patch);
        effects.push({ kind: 'audit', action: args.p_operation });
        return { data: { ...targetProfile }, error: null };
      }
      assert.equal(name, 'review_access_request');
      const request = state.access_requests.find(row => row.id === args.p_request_id);
      if (!request) return { data: null, error: { code: 'P0001', message: 'ACCESS_REQUEST_NOT_FOUND' } };
      if (request.status !== 'PENDING') return { data: null, error: { code: 'P0001', message: 'ACCESS_REQUEST_ALREADY_REVIEWED' } };
      const targetProfile = state.profiles.find(row => row.id === request.profile_id);
      const status = args.p_decision === 'APPROVE' ? 'ACTIVE' : 'DENIED';
      effects.push({ kind: 'update', table: 'profiles' });
      Object.assign(targetProfile, args.p_decision === 'APPROVE'
        ? { status, role: args.p_role, department_id: args.p_department_id }
        : { status });
      effects.push({ kind: 'update', table: 'access_requests' });
      Object.assign(request, { status, reviewed_by_user_id: args.p_actor_user_id });
      // The production RPC runs the audit trigger in this same transaction.
      effects.push({ kind: 'audit', action: status === 'ACTIVE' ? 'APPROVE_ACCESS_REQUEST' : 'DENY_ACCESS_REQUEST' });
      return { data: { ...request }, error: null };
    }
  };
  async function query(builder) {
    if (builder?.then) {
      const result = await builder;
      if (result.error) throw result.error;
      return result.data;
    }
    if (failCount && builder.table === 'profiles' && builder.filters.some(([key]) => key === 'role')) throw new Error('Count unavailable');
    let rows = state[builder.table].filter(row => builder.filters.every(([, , predicate]) => predicate(row)));
    if (builder.mode !== 'read') {
      effects.push({ kind: builder.mode, table: builder.table });
      if (builder.mode === 'update') rows.forEach(row => Object.assign(row, builder.patch));
      else {
        const row = { id: 'new-invitation', status: 'PENDING', ...builder.patch };
        state[builder.table].push(row);
        rows = [row];
      }
    }
    rows = rows.map(row => builder.fields === '*' ? { ...row } : Object.fromEntries(builder.fields.split(',').map(key => [key, row[key]])));
    if (builder.cardinality === 'single') assert.equal(rows.length, 1);
    return builder.cardinality ? rows[0] || null : rows;
  }
  let handler;
  const context = vm.createContext({
    process: { env: { HEAD_ADMIN_EMAIL: headEmail } },
    app: { [route.method]: (_path, ...handlers) => { handler = handlers.at(-1); } },
    authenticate() {}, adminOnly() {}, sensitiveActionLimiter() {}, db, query,
    fail: (res, status, error) => res.status(status).json({ error }),
    optionalUuid: value => value ?? null,
    emailPattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    isAllowedCompanyEmail: () => true,
    audit: async (...args) => { effects.push({ kind: 'audit', action: args[1] }); },
    sendInvitationEmail: async () => { effects.push({ kind: 'email' }); return true; },
    invitationMailIssue: () => null
  });
  const start = source.indexOf(`app.${route.method}('${route.path}',`);
  assert.notEqual(start, -1);
  const followingRoute = source.slice(start + 1).search(/^app\./m);
  assert.notEqual(followingRoute, -1);
  vm.runInContext(helpers + '\n' + source.slice(start, start + 1 + followingRoute), context);
  const req = { profile: actor, params: { id: route.path.includes('access-requests') ? 'request' : target?.id }, body: { email: target?.email || 'new@example.com', ...route.body } };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  return { state, initial, effects, res, run: () => handler(req, res, error => { throw error; }) };
}

function assertBlocked(h, code, message) {
  assert.equal(h.res.statusCode, code);
  assert.deepEqual(JSON.parse(JSON.stringify(h.res.body)), { error: message });
  assert.deepEqual(h.effects, [], 'Blocked operation must have no writes, Auth calls, emails, or audits');
  assert.deepEqual(h.state, h.initial);
}

for (const route of routeCases) {
  test(`${route.name}: another administrator cannot change the head account`, async () => {
    const h = harness(route, { target: profile('head', { email: headEmail, status: route.status || 'ACTIVE' }) });
    await h.run();
    assertBlocked(h, 403, messages.head);
  });

  test(`${route.name}: ordinary permitted mutation still succeeds`, async () => {
    const h = harness(route, route.name === 'user approval' ? { target: profile('target', { status: 'PENDING' }) } : {});
    await h.run();
    assert.ok([200, 201].includes(h.res.statusCode));
    const target = h.state.profiles.find(row => row.id === 'target');
    const expectedStatus = route.name === 'archive' ? 'DENIED' : route.body.status || 'ACTIVE';
    assert.equal(target.status, expectedStatus);
    assert.equal(target.role, route.body.role || 'ADMIN');
    assert.equal(h.effects.filter(effect => effect.kind === 'audit').length, 1);
    assert.equal(h.effects.filter(effect => effect.kind === 'email').length, route.method === 'post' ? 1 : 0);
    assert.equal(h.effects.filter(effect => effect.kind === 'auth').length, 0, 'archive/restore Auth state is handled inside the transactional RPC');
  });
}

for (const route of routeCases.filter(item => item.body.role === 'USER' || ['user denial', 'archive'].includes(item.name))) {
  test(`${route.name}: last active administrator is protected`, async () => {
    // An actor verified earlier may no longer be active when this count runs.
    const h = harness(route, { profiles: [profile('actor', { status: 'DENIED' }), profile('target')] });
    await h.run();
    assertBlocked(h, 403, messages.last);
  });

  test(`${route.name}: failure to count administrators fails before side effects`, async () => {
    const h = harness(route, { failCount: true });
    await assert.rejects(h.run(), /Count unavailable/);
    assert.deepEqual(h.effects, []);
    assert.deepEqual(h.state, h.initial);
  });
}

for (const name of ['user denial', 'archive']) {
  for (const head of [false, true]) {
    test(`${name}: self-disable is blocked (${head ? 'head' : 'regular'} administrator)`, async () => {
      const actor = profile('actor', head ? { email: headEmail } : {});
      const h = harness(routeCases.find(route => route.name === name), { actor, target: actor, profiles: [actor, profile('other')] });
      await h.run();
      assertBlocked(h, 400, messages.self);
    });
  }
}

for (const route of routeCases.filter(item => item.body.role === 'USER')) {
  for (const otherAdmin of [false, true]) {
    test(`${route.name}: head self-demotion ${otherAdmin ? 'allowed with another admin' : 'blocked as sole admin'}`, async () => {
      const actor = profile('head', { email: headEmail });
      const h = harness(route, { actor, target: actor, profiles: [actor, ...(otherAdmin ? [profile('other')] : [])] });
      await h.run();
      if (!otherAdmin) assertBlocked(h, 403, messages.last);
      else { assert.ok([200, 201].includes(h.res.statusCode)); assert.equal(h.state.profiles[0].role, 'USER'); }
    });
  }
}

test('access denial updates the linked profile and request', async () => {
  const route = { ...routeCases.find(item => item.name === 'access approval'), body: { decision: 'DENY' } };
  const h = harness(route);
  await h.run();
  assert.equal(h.res.statusCode, 200);
  assert.equal(h.state.profiles.find(row => row.id === 'target').status, 'DENIED');
  assert.equal(h.state.access_requests[0].status, 'DENIED');
  assert.deepEqual(h.effects.map(effect => effect.kind), ['update', 'update', 'audit']);
  assert.equal(h.effects[0].table, 'profiles');
  assert.equal(h.effects[1].table, 'access_requests');
});

test('user status retry is idempotent and does not create a second audit event', async () => {
  const route = routeCases.find(item => item.name === 'user approval');
  const target = profile('target', { role: 'USER', status: 'ACTIVE' });
  const h = harness(route, { target, profiles: [profile('actor'), target] });
  await h.run();
  assert.equal(h.res.statusCode, 200);
  assert.equal(h.effects.filter(effect => effect.kind === 'update' && effect.table === 'profiles').length, 0);
  assert.equal(h.effects.filter(effect => effect.kind === 'audit').length, 0);
});

test('user role retry is idempotent and does not create a second audit event', async () => {
  const route = routeCases.find(item => item.name === 'role change');
  const target = profile('target', { role: 'USER' });
  const h = harness(route, { target, profiles: [profile('actor'), target] });
  await h.run();
  assert.equal(h.res.statusCode, 200);
  assert.equal(h.effects.filter(effect => effect.kind === 'update' && effect.table === 'profiles').length, 0);
  assert.equal(h.effects.filter(effect => effect.kind === 'audit').length, 0);
});

test('access denial cannot deny the head administrator', async () => {
  const route = { ...routeCases.find(item => item.name === 'access approval'), body: { decision: 'DENY' } };
  const h = harness(route, { target: profile('head', { email: headEmail }) });
  await h.run();
  assertBlocked(h, 403, messages.head);
});

test('denied profiles cannot submit another access request', async () => {
  const route = { name: 'access request', method: 'post', path: '/v1/access-requests', body: {} };
  const h = harness(route, { actor: profile('actor', { role: 'USER', status: 'DENIED' }) });
  await h.run();
  assertBlocked(h, 403, 'Your access request was denied. Contact an administrator if you believe this is a mistake.');
});

for (const name of ['new invitation', 'pending invitation']) {
  test(`${name}: account without a profile retains existing behavior`, async () => {
    const route = routeCases.find(item => item.name === name);
    const h = harness(route, { target: null });
    await h.run();
    if (route.duplicate) assertBlocked(h, 409, 'This email already has an active invitation.');
    else { assert.equal(h.res.statusCode, 201); assert.equal(h.state.profiles.length, 1); assert.equal(h.effects.filter(effect => effect.kind === 'email').length, 1); }
  });
}

for (const [name, status, error] of [['archive', 'DENIED', 'This user has already been removed.'], ['restore', 'ACTIVE', 'Only removed users can be restored.']]) {
  test(`${name}: existing invalid-state response is preserved`, async () => {
    const h = harness(routeCases.find(item => item.name === name), { target: profile('target', { status }) });
    await h.run();
    assertBlocked(h, 409, error);
  });
}

test('archive retains its count guard for pending administrators', async () => {
  const h = harness(routeCases.find(item => item.name === 'archive'), { target: profile('target', { status: 'PENDING' }) });
  await h.run();
  assertBlocked(h, 403, messages.last);
});

test('role change still permits demoting a pending administrator', async () => {
  const h = harness(routeCases.find(item => item.name === 'role change'), { target: profile('target', { status: 'PENDING' }) });
  await h.run();
  assert.equal(h.res.statusCode, 200);
  assert.equal(h.state.profiles[1].role, 'USER');
  assert.equal(h.state.profiles[1].status, 'PENDING');
});

for (const name of ['new invitation', 'pending invitation', 'access approval', 'user approval']) {
  test(`${name}: a pending employee can be activated`, async () => {
    const h = harness(routeCases.find(item => item.name === name), { target: profile('target', { role: 'USER', status: 'PENDING' }) });
    await h.run();
    assert.ok([200, 201].includes(h.res.statusCode));
    assert.equal(h.state.profiles[1].status, 'ACTIVE');
    assert.equal(h.state.profiles[1].role, 'USER');
  });
}

for (const name of ['new invitation', 'pending invitation', 'access approval', 'user approval', 'role change']) {
  test(`${name}: the sole head administrator can retain their own active-admin state`, async () => {
    const route = { ...routeCases.find(item => item.name === name) };
    route.body = { ...route.body, role: 'ADMIN' };
    const actor = profile('head', { email: headEmail });
    const h = harness(route, { actor, target: actor, profiles: [actor], failCount: true });
    await h.run();
    assert.ok([200, 201].includes(h.res.statusCode));
    assert.equal(h.state.profiles[0].status, 'ACTIVE');
    assert.equal(h.state.profiles[0].role, 'ADMIN');
  });
}

for (const name of ['user denial', 'archive', 'restore']) {
  test(`${name}: ordinary employee status changes do not require another administrator`, async () => {
    const route = routeCases.find(item => item.name === name);
    const h = harness(route, { target: profile('target', { role: 'USER', status: route.status || 'ACTIVE' }), failCount: true });
    await h.run();
    assert.equal(h.res.statusCode, 200);
    assert.equal(h.state.profiles[1].status, name === 'restore' ? 'ACTIVE' : 'DENIED');
  });
}

test('archiving a pending administrator remains allowed when two active administrators exist', async () => {
  const target = profile('target', { status: 'PENDING' });
  const h = harness(routeCases.find(item => item.name === 'archive'), { target, profiles: [profile('actor'), profile('other'), target] });
  await h.run();
  assert.equal(h.res.statusCode, 200);
  assert.equal(h.state.profiles[2].status, 'DENIED');
});
