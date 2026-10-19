import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../../frontend/js/script.js', import.meta.url), 'utf8');
const renderer = source.slice(source.indexOf('function loadAdminTimeEntryDetails()'), source.indexOf('function loadUserDashboard()'));
function render(entry, approved = false) {
  const calls = [];
  const buttons = ['stop', 'approve', 'delete', 'correct', 'remark'].map(action => ({ dataset: { entryAction: action }, addEventListener(event, handler) { this.handler = handler; } }));
  const root = { innerHTML: '', querySelectorAll: () => buttons, querySelector: () => null };
  const context = { AppState: { currentUser: { Role: 'ADMIN' }, timeEntries: [entry], users: [], projects: [], adminRemarks: [] }, document: { getElementById: () => root }, window: { location: { search: '?entry=one', reload() { calls.push('reload'); }, assign(url) { calls.push(url); } }, ACEUI: { confirm: async () => approved }, ACEAuth: { request: async (path, options) => calls.push({ path, options }) } }, URLSearchParams, escapeHtml: text => String(text).replaceAll('<', '&lt;'), formatDuration: seconds => String(seconds), suppliedIconMarkup: () => '', editEntryTime: record => calls.push(record), showToast() {} };
  vm.runInNewContext(renderer + '\nloadAdminTimeEntryDetails();', context);
  return { root, buttons, calls };
}
test('details expose appropriate actions and completed zero-duration sessions', () => {
  const active = render({ TimeEntryId: 'one', UserId: 'user', ClockInAt: '2026-10-19T08:00:00Z' });
  assert.match(active.root.innerHTML, /data-entry-action="stop"/);
  assert.doesNotMatch(active.root.innerHTML, /data-entry-action="approve"/);
  const completed = render({ TimeEntryId: 'one', UserId: 'user', ClockOutAt: '2026-10-19T09:00:00Z', DurationSeconds: 0, ScheduleType: 'FIXED', ScheduledEndTime: '18:00', OvertimeApprovedSeconds: 120 });
  assert.match(completed.root.innerHTML, /Worked time<\/span><strong>0/);
  assert.match(completed.root.innerHTML, /Approved overtime<\/dt><dd>120/);
  assert.match(completed.root.innerHTML, /data-entry-action="approve"/);
  assert.doesNotMatch(completed.root.innerHTML, /data-entry-action="stop"/);
});
test('mutating actions require confirmation and target the selected entry', async () => {
  const cancelled = render({ TimeEntryId: 'one' });
  await cancelled.buttons[0].handler();
  assert.equal(cancelled.calls.length, 0);
  const accepted = render({ TimeEntryId: 'one' }, true);
  await accepted.buttons[0].handler();
  assert.equal(accepted.calls[0].path, '/v1/time-entries/one/admin-stop');
  assert.equal(accepted.calls[0].options.method, 'POST');
  assert.equal(accepted.calls[1], 'reload');
});
