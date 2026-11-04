import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../frontend/js/script.js',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('const defaultScheduleWeekdays'),source.indexOf('// Native select popups'))+source.slice(source.indexOf('function employeeScheduleMessage('),source.indexOf('function loadUserDashboard()'));
const ctx=vm.createContext({});vm.runInContext(helpers,ctx);
const schedule={name:'Night shift',schedule_type:'FIXED',start_time:'17:00:00',end_time:'02:00:00',scheduled_weekdays:[1,2,3,4,5]};
const entry={UserId:'user',ClockInAt:'2026-11-05T16:00:00+08:00',ClockOutAt:'2026-11-06T02:00:00+08:00'};
test('early clock-in is shown after clock-out without a false late warning',()=>{
 const text=ctx.employeeScheduleMessage(schedule,[entry],null,new Date('2026-11-06T02:30:00+08:00'));
 // Once the shift ends, the reminder may refer to the next shift, but never declares lateness.
 assert.doesNotMatch(text,/late/i);
 const during=ctx.employeeScheduleMessage(schedule,[entry],null,new Date('2026-11-05T19:00:00+08:00'));
 assert.match(during,/Recorded clock-in: 4:00 PM/);assert.doesNotMatch(during,/late/i);
});
test('no recorded shift is a neutral reminder, not a late verdict',()=>{
 const text=ctx.employeeScheduleMessage(schedule,[],null,new Date('2026-11-05T18:00:00+08:00'));
 assert.match(text,/No clock-in recorded/);assert.doesNotMatch(text,/late/i);
});
test('overnight active shift keeps its recorded clock-in after Manila midnight',()=>{
 const text=ctx.employeeScheduleMessage(schedule,[entry],entry,new Date('2026-11-06T01:00:00+08:00'));
 assert.match(text,/Recorded clock-in: 4:00 PM/);assert.match(text,/5:00 PM–2:00 AM/);
});
test('Manila workdays do not depend on the device timezone',()=>{
 vm.runInContext('globalThis.scheduled = isScheduledToday',ctx);
 assert.equal(ctx.scheduled(schedule,new Date('2026-11-05T17:00:00Z')),true);
 assert.equal(ctx.scheduled(schedule,new Date('2026-11-06T17:00:00Z')),false);
});
test('existing notice refreshes after clock-in and removes old late styling',()=>{
 const notice={textContent:'You are late',classList:{remove(name){assert.equal(name,'is-late');}}};
 ctx.document={querySelector:()=>({}),getElementById:()=>notice};
 ctx.AppState={assignedSchedule:schedule,currentUser:{UserId:'user'},timeEntries:[entry],currentSession:entry};
 ctx.updateEmployeeScheduleNotice(new Date('2026-11-05T18:00:00+08:00'));
 assert.match(notice.textContent,/Recorded clock-in: 4:00 PM/);assert.doesNotMatch(notice.textContent,/late/i);
});
