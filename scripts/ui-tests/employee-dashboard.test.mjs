import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../../frontend/js/script.js',import.meta.url),'utf8');
const helper=source.slice(source.indexOf('function employeeTodayTotals('),source.indexOf('function updateEmployeeTodaySummary('));
const context=vm.createContext({Date});vm.runInContext(helper,context);
const entry=(start,end)=>({ClockInAt:start,ClockOutAt:end});
test('today totals clip overnight work and include active work, excluding previous days',()=>{
 const result=context.employeeTodayTotals([
  entry('2026-10-29T23:00:00','2026-10-30T02:00:00'),
  entry('2026-10-30T08:00:00',null),
  entry('2026-10-29T09:00:00','2026-10-29T10:00:00'),
  entry('2026-10-29T22:00:00','2026-10-30T00:00:00'),
 ],new Date('2026-10-30T09:30:00'));
 assert.equal(result.seconds,12600);assert.equal(result.sessions,2);
});
test('zero-duration completed sessions count without adding hours; invalid or future dates do not',()=>{
 const result=context.employeeTodayTotals([entry('2026-10-30T08:00:00','2026-10-30T08:00:00'),entry('bad',null),entry('2026-10-31T08:00:00',null)],new Date('2026-10-30T09:30:00'));
 assert.equal(result.seconds,0);assert.equal(result.sessions,1);
});
