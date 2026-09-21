import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const routeStart = source.indexOf("app.get('/v1/time-leaderboard',");
const routeEnd = source.indexOf("app.get('/v1/admin-remarks'", routeStart);
const routeSource = source.slice(routeStart, routeEnd);
const people = [...Array.from({ length: 10 }, (_, index) => ({ id: `leader-${index}`, full_name: `Leader ${index}`, role: 'USER', status: 'ACTIVE', permanently_deleted_at: null })), { id: 'employee', full_name: 'Outside Top Ten', role: 'USER', status: 'ACTIVE', permanently_deleted_at: null }, { id: 'inactive', full_name: 'Inactive Person', role: 'USER', status: 'DENIED', permanently_deleted_at: null }, { id: 'archived', full_name: 'Archived Person', role: 'USER', status: 'ACTIVE', permanently_deleted_at: '2026-01-01T00:00:00.000Z' }];
const entries = people.map((person, index) => ({ user_id: person.id, duration_seconds: (people.length - index) * 3600, deleted_at: null }));
entries.push({ user_id: 'employee', duration_seconds: 999999, deleted_at: '2026-01-01T00:00:00Z' });

function leaderboardHarness(profile) {
  let handler;
  let middleware;
  const builder = table => ({
    table, filters: [], select() { return this; },
    eq(field, value) { this.filters.push(row => row[field] === value); return this; },
    is(field, value) { this.filters.push(row => row[field] === value); return this; },
    not(field, _operator, value) { this.filters.push(row => row[field] !== value); return this; }
  });
  const context = vm.createContext({
    app: { get(path, ...handlers) { assert.equal(path, '/v1/time-leaderboard'); middleware = handlers.slice(0, -1); handler = handlers.at(-1); } },
    authenticate() {}, activeOnly() {}, adminOnly() {}, db: { from: builder },
    query: async request => (request.table === 'profiles' ? people : entries).filter(row => request.filters.every(filter => filter(row))),
    listAuthUsersForAvatars: async () => [], applyGoogleAvatarFallback: profiles => profiles
  });
  vm.runInContext(routeSource, context);
  const res = { json(body) { this.body = structuredClone(body); } };
  return { middleware, res, run: () => handler({ profile }, res, error => { throw error; }) };
}

function assertScopedResponse(body) {
  assert.deepEqual(Object.keys(body).sort(), ['leaders', 'my_rank', 'total_people']);
  assert.equal(body.my_rank, null, 'an administrator outside the employee ranking must not be shown as number one');
  assert.equal(body.total_people, 11);
  assert.equal(body.leaders.length, 10);
  assert.equal(body.leaders[0].tracked_seconds, 13 * 3600);
  assert.ok(!body.leaders.some(person => ['inactive', 'archived', 'employee'].includes(person.id)), 'removed entries must not boost rankings and inactive people must not appear');
}

test('leaderboard requires authentication and administrator access', () => {
  const route = leaderboardHarness({ id: 'admin', role: 'ADMIN', status: 'ACTIVE' });
  assert.deepEqual(route.middleware.map(item => item.name), ['authenticate', 'adminOnly']);
});

test('leaderboard returns the current admin response and excludes removed work', async () => {
  const adminRoute = leaderboardHarness({ id: 'admin', role: 'ADMIN', status: 'ACTIVE' });
  await adminRoute.run();
  assertScopedResponse(adminRoute.res.body);
});

test('leaderboard handles tied totals when a profile has no display name', async () => {
  people.push({ id: 'unnamed', full_name: null, role: 'USER', status: 'ACTIVE', permanently_deleted_at: null });
  people.push({ id: 'zero', full_name: 'Zero', role: 'USER', status: 'ACTIVE', permanently_deleted_at: null });
  try {
    const route = leaderboardHarness({ id: 'admin', role: 'ADMIN', status: 'ACTIVE' });
    await route.run();
    assert.equal(route.res.body.total_people, 13);
  } finally {
    people.splice(-2);
  }
});
