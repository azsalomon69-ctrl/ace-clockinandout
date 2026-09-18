import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const routeStart = source.indexOf("app.get('/v1/time-leaderboard',");
const routeEnd = source.indexOf("app.get('/v1/admin-remarks'", routeStart);
const routeSource = source.slice(routeStart, routeEnd);
const people = [...Array.from({ length: 10 }, (_, index) => ({ id: `leader-${index}`, full_name: `Leader ${index}`, role: 'USER', status: 'ACTIVE', permanently_deleted_at: null })), { id: 'employee', full_name: 'Outside Top Ten', role: 'USER', status: 'ACTIVE', permanently_deleted_at: null }, { id: 'inactive', full_name: 'Inactive Person', role: 'USER', status: 'DENIED', permanently_deleted_at: null }, { id: 'archived', full_name: 'Archived Person', role: 'USER', status: 'ACTIVE', permanently_deleted_at: '2026-01-01T00:00:00.000Z' }];
const entries = people.map((person, index) => ({ user_id: person.id, duration_seconds: (people.length - index) * 3600 }));

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
  assert.deepEqual(Object.keys(body).sort(), ['top', 'you']);
  assert.deepEqual(Object.keys(body.you).sort(), ['hours', 'of', 'rank']);
  assert.equal(body.you.rank, 11, 'caller rank must use the full ranked list');
  assert.equal(body.you.hours, 3 * 3600);
  assert.equal(body.you.of, 11);
  assert.equal(body.top.length, 10);
  assert.ok(body.top.every(person => Object.keys(person).sort().join(',') === 'hours,name'), 'leaders must contain only name and hours');
  assert.ok(!body.top.some(person => ['Inactive Person', 'Archived Person'].includes(person.name)), 'inactive and archived people must not appear in the top list');
}

test('leaderboard uses the active-account gate for employees and administrators', () => {
  const employeeRoute = leaderboardHarness({ id: 'employee', role: 'USER', status: 'ACTIVE' });
  assert.ok(employeeRoute.middleware.some(item => item.name === 'activeOnly'), 'route must use the active-account gate');
  assert.ok(!employeeRoute.middleware.some(item => item.name === 'adminOnly'), 'route must not require administrator access');
});

test('leaderboard returns scoped rankings to an employee outside the top ten and an administrator', async () => {
  const employeeRoute = leaderboardHarness({ id: 'employee', role: 'USER', status: 'ACTIVE' });
  const adminRoute = leaderboardHarness({ id: 'admin', role: 'ADMIN', status: 'ACTIVE' });
  await employeeRoute.run();
  await adminRoute.run();
  assertScopedResponse(employeeRoute.res.body);
  assertScopedResponse(adminRoute.res.body);
});
