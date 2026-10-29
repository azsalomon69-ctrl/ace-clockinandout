import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../frontend/js/schedule-flex.js', import.meta.url), 'utf8');
function fixture({ schedules = [], employees = [] } = {}) {
  const nodes = new Map();
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', hidden: false, disabled: false, dataset: {}, listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; }, querySelector() { return element('createButton'); }, querySelectorAll() { return []; }, closest() { return { insertAdjacentElement() {} }; }, insertAdjacentHTML(_, html) { this.innerHTML += html; }, focus() { this.focused = true; }, reset() {}, scrollIntoView() {} });
    return nodes.get(id);
  };
  const days = [1, 2, 3, 4, 5, 6, 0].map(day => ({ ...element('day' + day), value: String(day), checked: day > 0 && day < 6 }));
  Object.entries({ scheduleType: 'FIXED', scheduleStart: '09:00', scheduleEnd: '18:00', scheduleHours: '9', scheduleMinutes: '0' }).forEach(([id, value]) => { element(id).value = value; });
  const calls = [];
  const window = { ACEWaitForVerifiedProfile: async () => ({ Role: 'ADMIN' }), ACEAuth: { request: async (url, options) => {
    calls.push({ url, options });
    if (url === '/v1/me') return { profile: { role: 'ADMIN' } };
    if (url === '/v1/users') return employees;
    if (options?.method === 'POST') return { id: 'new-schedule', name: 'Night shift', is_active: true };
    if (url.startsWith('/v1/schedules')) return { items: schedules, total: schedules.length };
    return {};
  } }, showToast() {}, addEventListener() {} };
  const document = { body: { dataset: {} }, getElementById: element, querySelector: () => element('assignButton'), querySelectorAll: query => query.includes('scheduleWorkday') ? days : [], addEventListener() {} };
  vm.runInNewContext(source, { window, document, location: { replace() { throw new Error('Unexpected redirect'); } } });
  return { window, element, calls, days };
}
test('empty setup explains why assignment is unavailable', async () => {
  const app = fixture({ employees: [{ id: 'person', full_name: 'Alex', email: 'alex@example.com', role: 'USER', status: 'ACTIVE' }] });
  await app.window.mountScheduleFlex();
  assert.equal(app.element('assignButton').disabled, true);
  assert.match(app.element('scheduleAssignmentStatus').textContent, /step 1/);
});
test('preview changes from fixed times to flextime and reflects selected workdays', async () => {
  const app = fixture(); await app.window.mountScheduleFlex();
  assert.match(app.element('schedulePreview').textContent, /09:00–18:00.*9h.*Mon, Tue, Wed, Thu, Fri/);
  app.element('scheduleType').value = 'FLEX'; app.days[0].checked = false;
  app.element('scheduleForm').listeners.change();
  assert.match(app.element('schedulePreview').textContent, /Flexible start and end times/);
  assert.doesNotMatch(app.element('schedulePreview').textContent, /Mon/);
});
test('saving carries the created schedule into assignment even outside the current list page', async () => {
  const app = fixture({ employees: [{ id: 'person', full_name: 'Alex', email: 'alex@example.com', role: 'USER', status: 'ACTIVE' }] });
  await app.window.mountScheduleFlex(); app.element('scheduleName').value = 'Night shift';
  await app.element('scheduleForm').listeners.submit({ preventDefault() {}, target: app.element('scheduleForm') });
  assert.equal(app.element('scheduleAssignment').value, 'new-schedule');
  assert.equal(app.element('assignButton').disabled, false);
  assert.equal(app.element('scheduleEmployee').focused, true);
  assert.match(app.element('scheduleAssignmentStatus').textContent, /Night shift is saved and selected/);
  const payload = JSON.parse(app.calls.find(call => call.options?.method === 'POST').options.body);
  assert.equal(payload.dailyElapsedMinutes, 540);
  assert.deepEqual(payload.workdays, [1, 2, 3, 4, 5]);
});

test('as-needed flextime saves without recurring workdays and restores fixed validation', async () => {
  const app = fixture(); await app.window.mountScheduleFlex();
  app.days.forEach(day => { day.checked = false; });
  app.element('scheduleType').value = 'AS_NEEDED';
  app.element('scheduleType').listeners.change();
  assert.equal(app.element('scheduleWorkdays').hidden, true);
  assert.equal(app.element('createButton').disabled, false);
  assert.match(app.element('schedulePreview').textContent, /only when worked/);
  await app.element('scheduleForm').listeners.submit({ preventDefault() {}, target: app.element('scheduleForm') });
  const payload = JSON.parse(app.calls.find(call => call.options?.method === 'POST').options.body);
  assert.equal(payload.scheduleType, 'AS_NEEDED');
  assert.deepEqual(payload.workdays, []);
  app.element('scheduleType').value = 'FIXED';
  app.element('scheduleType').listeners.change();
  assert.equal(app.element('scheduleWorkdays').hidden, false);
  assert.equal(app.element('createButton').disabled, true);
});

test('as-needed schedules never require attendance on a recurring weekday', () => {
  const dashboard = readFileSync(new URL('../../frontend/js/script.js', import.meta.url), 'utf8');
  const helper = dashboard.slice(dashboard.indexOf('const defaultScheduleWeekdays'), dashboard.indexOf('// Native select popups'));
  const context = vm.createContext({});
  vm.runInContext(helper + '\nglobalThis.check = isScheduledToday;', context);
  for (let day = 0; day < 7; day++) {
    assert.equal(context.check({ schedule_type: 'AS_NEEDED', scheduled_weekdays: [] }, { getDay: () => day }), false);
    assert.equal(context.check({ schedule_type: 'FLEX', scheduled_weekdays: [1, 2, 3, 4, 5] }, { getDay: () => day }), day > 0 && day < 6);
  }
});
