import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../frontend/js/script.js', import.meta.url), 'utf8');
const loader = source.slice(source.indexOf('function getStartupDataPlan('), source.indexOf('function waitForVerifiedProfile('));
function harness(scheduleRequest) {
  let calls = 0;
  const state = { currentUser: { UserId: 'employee', Role: 'USER' }, timeEntries: [], users: [], assignedSchedule: null };
  const context = vm.createContext({
    AppState: state,
    window: { ACEAuth: { request: async url => {
      if (url === '/v1/my-schedule') { calls++; return scheduleRequest(); }
      return [];
    } } },
    loadAllTimeEntries: async () => [],
    departmentRecord: x => x, projectRecord: x => x, timeEntryRecord: x => x,
    adminRemarkRecord: x => x, profileRecord: x => x, reportRecord: x => x,
    startTimer() {}, stopTimer() {}
  });
  vm.runInContext(loader, context);
  return { state, load: context.loadPlannedWorkspaceData, calls: () => calls };
}

test('employee schedule survives dashboard → settings → dashboard without another request', async () => {
  const schedule = { id: 'day-shift', schedule_type: 'FIXED', start_time: '09:00' };
  const app = harness(async () => schedule);
  await app.load('user-dashboard.html');
  assert.equal(app.state.assignedSchedule, schedule);
  await app.load('settings.html');
  await app.load('user-dashboard.html');
  assert.equal(app.state.assignedSchedule, schedule);
  assert.equal(app.calls(), 1);
});

test('a confirmed unassigned schedule remains null without repeated fetches', async () => {
  const app = harness(async () => null);
  await app.load('user-dashboard.html');
  await app.load('user-dashboard.html');
  assert.equal(app.state.assignedSchedule, null);
  assert.equal(app.state.scheduleLoaded, true);
  assert.equal(app.calls(), 1);
});

test('a failed schedule load remains retryable instead of caching an empty assignment', async () => {
  let fail = true;
  const schedule = { id: 'recovered-shift' };
  const app = harness(async () => { if (fail) throw new Error('temporarily unavailable'); return schedule; });
  await assert.rejects(app.load('user-dashboard.html'), /temporarily unavailable/);
  assert.notEqual(app.state.scheduleLoaded, true);
  fail = false;
  await app.load('user-dashboard.html');
  assert.equal(app.state.assignedSchedule, schedule);
  assert.equal(app.calls(), 2);
});
