import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../../frontend/js/script.js', import.meta.url), 'utf8');
const loaders = source.slice(source.indexOf('async function loadAllTimeEntries'), source.indexOf('async function refreshUserProjectAssignments'));
const activePath = '/v1/time-entries?mine=true&status=ACTIVE&page=1&pageSize=1';
const open = { id: 'shift', user_id: 'employee', clock_in_at: '2026-11-09T01:00:00Z', clock_out_at: null };

function harness(requestEntries, pathname = '/user-dashboard') {
  const calls = [];
  const state = { timeEntries: [], employeeHistoryStatus: 'ready' };
  const context = vm.createContext({
    AppState: state, URLSearchParams, CustomEvent: class {},
    localStorage: { setItem() {} },
    window: { location: { pathname }, dispatchEvent() {}, ACEAuth: { request: async path => {
      calls.push(path);
      if (path === '/v1/me') return { profile: { id: 'employee', role: 'USER' } };
      if (path.startsWith('/v1/time-entries?')) return requestEntries(path);
      return [];
    } } },
    document: { querySelector: () => null },
    profileRecord: raw => ({ UserId: raw.id, Role: raw.role }),
    timeEntryRecord: raw => ({ TimeEntryId: raw.id, UserId: raw.user_id, ClockInAt: raw.clock_in_at, ClockOutAt: raw.clock_out_at }),
    departmentRecord: x => x, projectRecord: x => x, adminRemarkRecord: x => x,
    startTimer() {}, pause: async () => {}, console: { warn() {} }
  });
  vm.runInContext(loaders, context);
  return { context, state, calls };
}

test('dashboard startup verifies the open shift without requesting history', async () => {
  const app = harness(path => {
    assert.equal(path, activePath);
    return { items: [open], total: 1 };
  });
  await app.context.loadDatabase();
  assert.equal(app.state.currentSession.TimeEntryId, 'shift');
  assert.equal(app.state.isClockedIn, true);
  assert.equal(app.state.employeeHistoryStatus, 'pending');
});

test('an invalid active-shift response never unlocks the dashboard', async () => {
  const app = harness(() => ({}));
  await assert.rejects(app.context.loadDatabase(), /Could not verify your current clock-in/);
  assert.equal(app.state.isClockedIn, undefined);
});

test('deferred history retries the failing page and preserves a clock-out saved during the request', async () => {
  let release, secondPageAttempts = 0;
  const pageOne = new Promise(resolve => { release = resolve; });
  const app = harness(async path => {
    if (path === activePath) return { items: [open], total: 1 };
    if (path.includes('page=1&')) return pageOne;
    if (++secondPageAttempts === 1) throw Object.assign(new Error('Temporary failure'), { status: 503 });
    return { items: [{ ...open, id: 'older' }], total: 2 };
  });
  await app.context.loadDatabase();
  const loading = app.context.loadEmployeeHistory();
  const saved = { ...app.state.currentSession, ClockOutAt: '2026-11-09T09:00:00Z' };
  app.state.timeEntries = [saved];
  app.state.currentSession = null;
  app.state.isClockedIn = false;
  release({ items: [open], total: 2 });
  await loading;
  assert.equal(app.calls.filter(path => path.includes('page=1&pageSize=100')).length, 1);
  assert.equal(secondPageAttempts, 2);
  assert.equal(app.state.timeEntries.find(entry => entry.TimeEntryId === 'shift'), saved);
  assert.equal(app.state.currentSession, null);
  assert.equal(app.state.employeeHistoryStatus, 'ready');
});

test('a history failure leaves the verified clock state usable and can be retried', async () => {
  let fail = true;
  const app = harness(path => {
    if (path !== activePath && fail) throw Object.assign(new Error('Unavailable'), { status: 503 });
    return { items: [open], total: 1 };
  });
  await app.context.loadDatabase();
  await app.context.loadEmployeeHistory();
  assert.equal(app.state.employeeHistoryStatus, 'error');
  assert.equal(app.state.isClockedIn, true);
  fail = false;
  await app.context.loadEmployeeHistory();
  assert.equal(app.state.employeeHistoryStatus, 'ready');
});
