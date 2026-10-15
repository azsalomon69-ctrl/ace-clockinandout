import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { countActiveEmployeeClockIns } from '../server/presence.js';

const source = readFileSync(new URL('../../frontend/js/script.js', import.meta.url), 'utf8');
function harness() {
  const pending = [], intervals = new Map(), listeners = new Map();
  const state = { element: { textContent: '—' }, visible: true };
  const context = vm.createContext({
    AppState: {}, console: { warn() {} },
    document: {
      get visibilityState() { return state.visible ? 'visible' : 'hidden'; },
      getElementById: () => state.element,
      addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: name => listeners.delete(name)
    },
    window: {
      ACEAuth: { request: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) },
      setInterval(fn, delay) { assert.equal(delay, 60000); intervals.set(1, fn); return 1; },
      clearInterval: id => intervals.delete(id)
    }
  });
  vm.runInContext(source.slice(source.indexOf('async function refreshAdminClockInCount('), source.indexOf('function loadAdminDashboard(')), context);
  // Execute the real count-rendering portion, without unrelated dashboard widgets.
  const start = source.indexOf('function loadAdminDashboard(');
  vm.runInContext(source.slice(start, source.indexOf('void loadReviewAlerts();', start)) + '}', context);
  return { state, context, pending, intervals, listeners };
}

test('clock-in count coalesces requests and preserves confirmed data on errors or malformed responses', async () => {
  const { context, state, pending } = harness();
  const first = context.refreshAdminClockInCount();
  const duplicate = context.refreshAdminClockInCount();
  assert.equal(pending.length, 1);
  pending[0].resolve({ count: 7 }); await Promise.all([first, duplicate]);
  assert.equal(state.element.textContent, '7');
  for (const value of [null, '0', -1, 1.5, undefined]) {
    const request = context.refreshAdminClockInCount();
    pending.at(-1).resolve({ count: value }); await request;
    assert.equal(state.element.textContent, '7');
  }
  const failed = context.refreshAdminClockInCount();
  pending.at(-1).reject(new Error('offline')); await failed;
  assert.equal(state.element.textContent, '7');
  const retry = context.refreshAdminClockInCount();
  pending.at(-1).resolve({ count: 0 }); await retry;
  assert.equal(state.element.textContent, '0');
});

test('late count responses cannot overwrite a newly mounted dashboard or clear its active request', async () => {
  const { context, state, pending } = harness();
  const oldElement = state.element;
  const old = context.refreshAdminClockInCount();
  state.element = { textContent: '—' };
  const newer = context.refreshAdminClockInCount();
  const newerInFlight = context.AppState.adminClockInCountRequest;
  pending[0].resolve({ count: 99 }); await old;
  assert.equal(oldElement.textContent, '—');
  assert.equal(state.element.textContent, '—');
  assert.equal(context.AppState.adminClockInCountRequest, newerInFlight);
  pending[1].resolve({ count: 3 }); await newer;
  assert.equal(state.element.textContent, '3');
});

test('dashboard redraw preserves the confirmed count; polling skips hidden tabs and stops after navigation', async () => {
  const { context, state, pending, intervals, listeners } = harness();
  context.loadAdminDashboard();
  assert.equal(state.element.textContent, '—');
  pending[0].resolve({ count: 4 }); await context.AppState.adminClockInCountRequest;
  context.loadAdminDashboard();
  assert.equal(state.element.textContent, '4');
  assert.equal(intervals.size, 1);
  pending[1].resolve({ count: 5 }); await context.AppState.adminClockInCountRequest;
  state.visible = false; intervals.get(1)();
  assert.equal(pending.length, 2);
  state.visible = true; listeners.get('visibilitychange')();
  pending[2].resolve({ count: 6 }); await context.AppState.adminClockInCountRequest;
  assert.equal(state.element.textContent, '6');
  state.element = null; intervals.get(1)();
  assert.equal(intervals.size, 0);
  assert.equal(listeners.size, 0);
});

test('missing database count is an error rather than a fabricated zero', async () => {
  const builder = { select() { return this; }, eq() { return this; }, is() { return this; },
    then(resolve) { return Promise.resolve({ count: null, error: null }).then(resolve); } };
  await assert.rejects(countActiveEmployeeClockIns({ from: () => builder }), /unavailable/);
});
