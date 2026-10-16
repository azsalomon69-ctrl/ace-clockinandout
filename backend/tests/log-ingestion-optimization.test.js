// Akio <3: Project source maintained by Akio Zaki Salomon.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../../frontend/js/script.js', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');

function getFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const openingBrace = source.indexOf('{', start);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not find the end of ${name}`);
}

test('startup fetches full time history only on pages that use it', () => {
  const plan = vm.runInNewContext(`(${getFunction('getStartupDataPlan')})`);
  const employeeSettings = plan('settings.html', 'USER');
  assert.equal(employeeSettings.entries, 'active');
  assert.equal(employeeSettings.userProjects, false);
  assert.equal(employeeSettings.schedule, false);
  assert.equal(plan('time-entries.html', 'USER').entries, 'mine');
  assert.equal(plan('admin-time-entries.html', 'ADMIN').entries, null);
  assert.equal(plan('reports.html', 'ADMIN').reports, false, 'the reports list loads one paginated slice itself');
  const adminHome = plan('admin-dashboard.html', 'ADMIN');
  assert.equal(adminHome.entries, 'all');
  assert.equal(adminHome.users, true);
  assert.equal(adminHome.userProjects, false, 'the admin dashboard does not render user project assignments');
  assert.equal(adminHome.reports, false, 'global search loads reports only when it is used');
  assert.equal(plan('reports.html', 'ADMIN').reports, false, 'the reports list loads one paginated slice itself');
});

test('admin GoTrue and JWKS refreshes share only in-flight requests', () => {
  assert.match(serverSource, /freshAuthUserInFlight\(tokenCacheKey\(token\)/);
  assert.match(serverSource, /jwksRefreshInFlight\('supabase-jwks'/);
  assert.match(serverSource, /refreshedAt > now - 30_000/);
  assert.match(serverSource, /getFreshUserFromGoTrue\(req\.authToken\)/, 'admin requests still revalidate with GoTrue');
});

test('individual report employee choices do not narrow the shared user cache', () => {
  const reportSource = readFileSync(new URL('../../frontend/js/individual-reports.js', import.meta.url), 'utf8');
  assert.match(reportSource, /const allUsers = await window\.ACEAuth\.request\('\/v1\/users'\);[\s\S]*?AppState\.users = allUsers\.map[\s\S]*?let users = allUsers\.filter\(user => user\.role === 'USER' && user\.status === 'ACTIVE'\)/);
});

test('presence heartbeats skip background tabs and coalesce quick visibility repeats', async () => {
  const functionSource = getFunction('startPresenceHeartbeat');
  let now = 100_000;
  let visibility = 'hidden';
  let intervalCallback;
  let intervalDelay;
  const listeners = new Map();
  let calls = 0;
  const requestPromises = [];
  const context = {
    AppState: {},
    Date: { now: () => now },
    document: {
      get visibilityState() { return visibility; },
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: name => listeners.delete(name)
    },
    window: { ACEAuth: { request: () => { calls += 1; return new Promise((resolve, reject) => requestPromises.push({ resolve, reject })); } }, setInterval: (callback, delay) => { intervalCallback = callback; intervalDelay = delay; return 1; }, clearInterval() {} },
    stopPresenceHeartbeat() {}
  };
  vm.runInNewContext(`(${functionSource})`, context)();
  assert.equal(calls, 0, 'initial send waits while hidden');
  assert.equal(context.AppState.presenceInterval, 1);
  assert.equal(intervalDelay, 2 * 60 * 1000);
  visibility = 'visible';
  listeners.get('visibilitychange')();
  listeners.get('visibilitychange')();
  assert.equal(calls, 1, 'quick duplicate visibility events share the active request');
  requestPromises[0].resolve();
  await Promise.resolve();
  await Promise.resolve();
  now += 10_000;
  listeners.get('visibilitychange')();
  assert.equal(calls, 1, 'a recently sent heartbeat is not repeated');
  now += 21_000;
  listeners.get('visibilitychange')();
  assert.equal(calls, 2);
  requestPromises[1].reject(new Error('temporary heartbeat failure'));
  await Promise.resolve();
  await Promise.resolve();
  now += intervalDelay;
  intervalCallback();
  assert.equal(calls, 3, 'the next scheduled heartbeat recovers after one failed request');
  requestPromises[2].resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(source.includes('setInterval(send, 2 * 60 * 1000)'), true);
});

test('remark refresh uses realtime first, a 15-minute fallback, one catch-up, and clean teardown', async () => {
  let now = 2_000_000;
  let visibility = 'visible';
  const windowListeners = new Map();
  const documentListeners = new Map();
  const intervals = new Map();
  const removedWindowListeners = [];
  let nextTimer = 1;
  let renderedRemarkList = 0;
  const pendingRequests = [];
  const context = {
    AppState: { currentUser: { Role: 'USER' }, adminRemarks: [] },
    Date: { now: () => now },
    document: {
      get visibilityState() { return visibility; },
      getElementById: id => id === 'remarksPageList' ? {} : null,
      addEventListener: (name, callback) => documentListeners.set(name, callback),
      removeEventListener: name => documentListeners.delete(name)
    },
    window: {
      ACEAuth: { request: () => new Promise((resolve, reject) => pendingRequests.push({ resolve, reject })) },
      ACERenderNotifications() {},
      addEventListener: (name, callback) => windowListeners.set(name, callback),
      removeEventListener: name => { removedWindowListeners.push(name); windowListeners.delete(name); },
      setInterval: (callback, delay) => { const id = nextTimer++; intervals.set(id, { callback, delay }); return id; },
      clearInterval: id => intervals.delete(id)
    },
    adminRemarkRecord: item => item,
    loadRemarksPage: () => { renderedRemarkList += 1; },
    updateRemarkNotificationBadge() {},
    showToast() {},
    console: { warn() {} }
  };
  const start = vm.runInNewContext(`(${getFunction('startRemarkNotifications')})`, context);
  start();
  assert.equal([...intervals.values()][0].delay, 15 * 60 * 1000);
  const dispatch = detail => windowListeners.get('ace:live-notification')({ detail });
  dispatch({ kind: 'message' });
  assert.equal(pendingRequests.length, 0, 'unrelated live events do not refresh remarks');
  dispatch({ kind: 'remarks' });
  dispatch({ kind: 'remarks' });
  assert.equal(pendingRequests.length, 1, 'overlapping live events coalesce into one active fetch');
  pendingRequests[0].resolve([{ RemarkId: 'remark-1', SeenAt: null }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(renderedRemarkList, 1, 'an employee already on the Remarks page sees the new item without navigating or reloading');
  assert.equal(pendingRequests.length, 2, 'one queued catch-up covers an event that arrived during the fetch');
  pendingRequests[1].resolve([{ RemarkId: 'remark-1', SeenAt: null }]);
  await new Promise(resolve => setImmediate(resolve));
  visibility = 'hidden';
  [...intervals.values()][0].callback();
  assert.equal(pendingRequests.length, 2, 'background fallback polls are skipped');
  visibility = 'visible';
  now += 61_000;
  documentListeners.get('visibilitychange')();
  assert.equal(pendingRequests.length, 3, 'a stale tab refreshes when it becomes visible');
  pendingRequests[2].resolve([]);
  await new Promise(resolve => setImmediate(resolve));
  windowListeners.get('pagehide')();
  assert.equal(intervals.size, 0);
  assert.equal(documentListeners.has('visibilitychange'), false);
  assert.ok(removedWindowListeners.includes('ace:live-notification'));
});
