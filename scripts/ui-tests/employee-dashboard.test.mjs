import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../frontend/js/script.js', import.meta.url), 'utf8');
const start = source.indexOf('function loadUserDashboard()');
const end = source.indexOf('async function loadTimeLeaderboard(', start);
assert.ok(start >= 0 && end > start);
const render = source.slice(start, end);

const entry = (start, end, duration, user = 'employee') => ({
  UserId: user, ClockInAt: start, ClockOutAt: end, DurationSeconds: duration
});

function weeklyDashboard(entries) {
  const now = new Date(2026, 9, 30, 9, 30);
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now.getTime()])); }
  }
  const nodes = new Map(['weekHours', 'weekEntries', 'employeeWeekChart', 'employeeWeekState']
    .map(id => [id, { classList: { toggle() {} } }]));
  const context = vm.createContext({
    Date: FixedDate,
    document: { getElementById: id => nodes.get(id) },
    window: {},
    AppState: { currentUser: { UserId: 'employee' }, timeEntries: entries },
    updateEmployeeScheduleNotice() {},
    escapeHtml: String,
    formatDuration: seconds => String(seconds)
  });
  vm.runInContext(render, context);
  context.loadUserDashboard();
  return {
    seconds: Number(nodes.get('weekHours').textContent),
    sessions: nodes.get('weekEntries').textContent,
    chart: nodes.get('employeeWeekChart').innerHTML,
    hidden: nodes.get('employeeWeekChart').hidden
  };
}

test('employee weekly summary groups overnight work by clock-in day and excludes active and prior-week sessions', () => {
  const result = weeklyDashboard([
    entry('2026-10-29T23:00:00', '2026-10-30T02:00:00', 10800),
    entry('2026-10-30T08:00:00', null, 5400),
    entry('2026-10-25T22:00:00', '2026-10-26T02:00:00', 14400),
    entry('2026-10-30T06:00:00', '2026-10-30T07:00:00', 3600, 'another-employee')
  ]);
  assert.equal(result.seconds, 10800);
  assert.equal(result.sessions, 1);
  assert.equal(result.hidden, false);
  assert.equal((result.chart.match(/role="listitem"/g) || []).length, 7);
  assert.equal((result.chart.match(/aria-current="date"/g) || []).length, 1);
  assert.match(result.chart, /employee-week-bar is-peak" style="height:100%"><\/span><\/span><small>10800<\/small>/);
});

test('employee weekly summary counts zero-duration sessions without adding hours and excludes invalid or future starts', () => {
  const result = weeklyDashboard([
    entry('2026-10-30T08:00:00', '2026-10-30T08:00:00', 0),
    entry('bad', '2026-10-30T08:00:00', 3600),
    entry('2026-10-31T08:00:00', '2026-10-31T09:00:00', 3600)
  ]);
  assert.equal(result.seconds, 0);
  assert.equal(result.sessions, 1);
  assert.equal((result.chart.match(/height:0%/g) || []).length, 7);
});
