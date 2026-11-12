import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const routes = source.slice(source.indexOf('function queuedClockEnabled('), source.indexOf("app.post('/v1/time-entries/clock-in',"));
const path = '/v1/time-entries/clock-sync/receipts/:id';
const owner = 'employee-a';
const id = 'action-id';

function harness(env = {}, original, reviews = []) {
  const handlers = new Map();
  const selectors = [];
  const register = method => (path, ...middleware) => handlers.set(method + path, middleware);
  const context = vm.createContext({
    process: { env }, app: { get: register('GET'), post: register('POST') },
    authenticate() {}, employeeOnly() {}, adminOnly() {},
    fail: (res, code, error) => res.status(code).json({ error }),
    query: async value => value,
    db: { from(table) {
      const filters = [];
      selectors.push({ table, filters });
      return {
        select() { return this; },
        eq(key, value) { filters.push([key, value]); return this; },
        maybeSingle() { return original; },
        then(resolve) { resolve(reviews); }
      };
    } }
  });
  vm.runInContext(routes, context);
  const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
  return { handlers, context, selectors, response };
}

test('queued clocking is dark by default and requires a pilot account when enabled', () => {
  const h = harness();
  const req = { profile: { id: owner } };
  const res = h.response();
  h.context.queuedClockEnabled(req, res, () => assert.fail('Clock queue enabled by default'));
  assert.equal(res.code, 404);
  h.context.queuedClockPilot(req, res, () => assert.fail('Unlisted employee allowed'));
  assert.equal(res.code, 404);
  const enabled = harness({ ACE_QUEUED_CLOCK_ENABLED: 'true', ACE_QUEUED_CLOCK_PILOT_USER_IDS: ' other, employee-a ' });
  let calls = 0;
  enabled.context.queuedClockEnabled(req, res, () => { calls++; });
  enabled.context.queuedClockPilot(req, res, () => { calls++; });
  assert.equal(calls, 2);
  assert.equal(enabled.handlers.get('POST/v1/queued-clock-reviews/:id/decision')[2], enabled.context.adminOnly);
});

test('employee outcome reads are owner-scoped and keep the original result separate', async () => {
  const original = { state: 'needs_review', code: 'CLOCK_EVIDENCE_UNAVAILABLE' };
  const h = harness({}, { response: original, tapped_at: '2026-11-10T09:00:00Z', received_at: '2026-11-10T09:20:00Z' }, [
    { code: original.code, decision: 'accepted', accepted_entry: { id: 'shift', user_id: owner }, decision_reason: 'Verified' },
    { code: 'ACTION_PAYLOAD_MISMATCH', bucket: 'integrity', decision: 'rejected', decision_reason: 'Changed' }
  ]);
  const handler = h.handlers.get('GET' + path).at(-1);
  const req = { profile: { id: owner }, params: { id }, query: {} };
  const regular = h.response();
  await handler(req, regular, error => { throw error; });
  assert.equal(regular.body.outcome.state, 'confirmed');
  assert.equal(regular.body.outcome.reason, 'Verified');
  assert.equal(regular.body.outcome.acceptedLate, true);
  const mismatch = h.response();
  await handler({ ...req, query: { mismatch: '1' } }, mismatch, error => { throw error; });
  assert.equal(mismatch.body.outcome.state, 'rejected');
  assert.equal(mismatch.body.outcome.reason, 'Changed');
  assert.equal(original.state, 'needs_review');
  for (const select of h.selectors) assert.deepEqual(select.filters, [['user_id', owner], ['action_id', id]]);
});

test('all-employee rollout bypasses only the pilot list', () => {
  const h = harness({ ACE_QUEUED_CLOCK_ALL_ACTIVE_EMPLOYEES: 'true' });
  const req = { profile: { id: 'new-employee' } };
  let admitted = false;
  h.context.queuedClockPilot(req, h.response(), () => { admitted = true; });
  assert.equal(admitted, true);
  const response = h.response();
  h.context.queuedClockEnabled(req, response, () => assert.fail('All-employee rollout enabled the feature'));
  assert.equal(response.code, 404);
  for (const route of ['POST/v1/time-entries/clock-sync/anchor', 'POST/v1/time-entries/clock-sync',
    'GET/v1/time-entries/clock-sync/receipts/:id']) {
    const chain = h.handlers.get(route);
    assert.equal(chain[1], h.context.authenticate);
    assert.equal(chain[2], h.context.employeeOnly);
    assert.equal(chain[3], h.context.queuedClockPilot);
  }
});
