import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../frontend/js/employee-profile.js', import.meta.url), 'utf8');
async function setup() {
  const nodes = new Map();
  const get = id => { if (!nodes.has(id)) nodes.set(id, { value: id === 'employeeHistoryPeriod' ? 'month' : '', innerHTML: '', handlers: {}, addEventListener(event, fn) { this.handlers[event] = fn; }, closest() { return {}; } }); return nodes.get(id); };
  const calls = []; const feedback = [];
  const today = new Date().toISOString();
  const entries = [{ id: 'entry-a', user_id: 'person', clock_in_at: today, clock_out_at: today, duration_seconds: 0, overtime_approved_seconds: 3600, schedule_type: 'FIXED', scheduled_end_time: today }, { id: 'entry-b', user_id: 'person', clock_in_at: today }];
  const window = { location: { search: '?user=person', assign(url) { calls.push(url); } }, ACEWaitForVerifiedProfile: async () => ({ Role: 'ADMIN' }), ACEUI: { confirm: async () => false }, ACEAuth: { request: async path => { calls.push(path); if (path === '/v1/me') return { profile: { role: 'ADMIN' } }; if (path === '/v1/users') return [{ id: 'person', role: 'USER', full_name: 'Test Employee' }]; if (path === '/v1/time-entries') return entries; if (path.startsWith('/v1/admin-remarks?')) return [{ time_entry_id: 'entry-a', remark: '<img onerror=alert(1)>', profiles: { full_name: 'Admin' } }]; return []; } } };
  vm.runInNewContext(source, { window, document: { getElementById: get, addEventListener() {} }, URLSearchParams, Date, showToast() {}, openEntryFeedback(record, refresh) { feedback.push({ record, refresh }); }, editEntryTime() {} });
  await window.mountEmployeeProfile();
  return { nodes, calls, feedback, window };
}
test('employee history includes overtime, safe remarks and entry-specific actions', async () => {
  const f = await setup();
  const html = f.nodes.get('employeeHistoryRows').innerHTML;
  assert.match(f.nodes.get('employeeProfileContent').innerHTML, /<th>Approved overtime<\/th><th>Remarks<\/th><th>Status<\/th><th>Actions<\/th>/);
  assert.match(html, /<td>0h 0m<\/td><td>1h 0m<\/td>/);
  assert.match(html, /&lt;img onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img onerror/);
  assert.equal((html.match(/value="approve"/g) || []).length, 1);
  assert.equal((html.match(/value="stop"/g) || []).length, 1);
  assert.equal(f.calls.filter(path => path.startsWith('/v1/admin-remarks?')).length, 1);
  assert.match(f.calls.find(path => path.startsWith('/v1/admin-remarks?')), /entry-a%2Centry-b/);
});
test('feedback action selects the correct entry and retains the selected date period on refresh', async () => {
  const f = await setup();
  const control = { dataset: { entryId: 'entry-a' }, value: 'remarks' };
  await f.nodes.get('employeeHistoryRows').handlers.change({ target: { closest: () => control } });
  assert.equal(f.feedback[0].record.id, 'entry-a');
  assert.equal(f.feedback[0].record.remarks.length, 1);
  assert.equal(control.value, '');
  f.nodes.get('employeeHistoryPeriod').value = 'custom';
  f.nodes.get('employeeHistoryFrom').value = '2020-01-01';
  await f.feedback[0].refresh();
  assert.equal(f.nodes.get('employeeHistoryPeriod').value, 'custom');
  assert.equal(f.nodes.get('employeeHistoryFrom').value, '2020-01-01');
});
