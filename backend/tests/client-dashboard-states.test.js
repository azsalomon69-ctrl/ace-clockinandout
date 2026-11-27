import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {setImmediate} from 'node:timers/promises';
const source=readFileSync(new URL('../../frontend/js/client-dashboard.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../../frontend/client-dashboard.html',import.meta.url),'utf8');
const settle=async()=>{for(let n=0;n<8;n++)await setImmediate();};
function harness({projects=[],data={items:[],total:0,employees:0,active:0,worked_seconds:0},failure,wait,preferences,legacyTheme,systemDark=false}={}){
 const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],{hidden:false,disabled:false,value:'',textContent:'',innerHTML:'',handlers:{},setAttribute(){},replaceChildren(){this.innerHTML='';},close(){this.open=false;},showModal(){this.open=true;},hidePopover(){this.open=false;},showPopover(){this.open=true;},matches(){return false;},focus(){this.focused=true;},classList:{toggle(){}},addEventListener(type,fn){this.handlers[type]=fn;},click(){return this.handlers.click?.();}}]));
 elements.get('clientWorkspace').hidden=true;
 const calls=[];const state={projects,data,failure};const storage=new Map();if(preferences)storage.set('ace_appearance_preferences',JSON.stringify(preferences));if(legacyTheme)storage.set('ace_client_appearance',legacyTheme);const root={dataset:{}};
 const context=vm.createContext({document:{addEventListener(){},documentElement:root,hidden:false,getElementById:id=>elements.get(id),querySelectorAll:()=>[]},window:{matchMedia:()=>({matches:systemDark,addEventListener(){}}),ACEAuth:{request:async(url,options)=>{calls.push(url);if(url==='/v1/me')return {profile:{role:'CLIENT',status:'ACTIVE',full_name:'Example Client',email:'client@example.test'}};if(wait)await wait;if(state.failure)throw state.failure;return url==='/v1/client/projects'?state.projects:state.data;}},setInterval(){},addEventListener(){},location:{replace(){}}},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},sessionStorage:{}});
 vm.runInContext(source,context);return {elements,calls,state,storage,root};
}
test('no assigned projects shows a real empty state and never requests attendance',async()=>{
 const h=harness();await settle();assert.equal(h.elements.get('clientStateTitle').textContent,'No employees to display');assert.equal(h.elements.get('clientStateHelp').hidden,false);assert.equal(h.elements.get('clientWorkspace').hidden,true);assert.equal(h.elements.get('clientStateAction').hidden,false);assert.ok(!h.calls.includes('/v1/client/attendance/search'));assert.equal(h.elements.get('clientCsv').disabled,true);
});
test('no active shifts and empty history have separate messages and useful actions',async()=>{
 const h=harness({projects:[{id:'a',name:'Project A',is_active:true}]});await settle();assert.equal(h.elements.get('clientEmptyTitle').textContent,'No shifts to display');assert.equal(h.elements.get('clientEmptyAction').textContent,'View history');assert.equal(h.elements.get('clientTableScroll').hidden,true);assert.equal(h.elements.get('clientCsv').disabled,true);
 h.elements.get('clientEmptyAction').click();await settle();assert.equal(h.elements.get('clientEmptyTitle').textContent,'No time entries');assert.equal(h.elements.get('clientEmptyAction').textContent,'Reset filters');
});
test('failed requests show retry state and retry can recover without a reload',async()=>{
 const h=harness({failure:new Error('network')});await settle();assert.equal(h.elements.get('clientStateTitle').textContent,'Attendance unavailable');assert.equal(h.elements.get('clientWorkspace').hidden,true);h.state.failure=null;h.elements.get('clientStateAction').click();await settle();assert.equal(h.elements.get('clientStateTitle').textContent,'No employees to display');
});
test('revoking access clears prior records and disables exports',async()=>{
 const h=harness({projects:[{id:'a',name:'Project A',is_active:true}],data:{items:[{id:'entry',employee_name:'Employee',project_name:'Project A',clock_in_at:'2026-11-27T00:00Z',clock_out_at:null,worked_seconds:60,activities:[]}],total:1,employees:1,active:1,worked_seconds:60}});await settle();assert.ok(h.elements.get('clientRows').innerHTML.includes('Employee'));assert.equal(h.elements.get('clientCsv').disabled,false);h.state.projects=[];h.elements.get('clientRefresh').click();await settle();assert.equal(h.elements.get('clientRows').innerHTML,'');assert.equal(h.elements.get('clientCsv').disabled,true);assert.equal(h.elements.get('clientWorkspace').hidden,true);
});
test('loading does not show false zero statistics or enable exports',async()=>{
 let release;const wait=new Promise(r=>release=r);const h=harness({wait});await settle();assert.equal(h.elements.get('clientState').hidden,true);assert.equal(h.elements.get('clientWorkspace').hidden,false);assert.equal(h.elements.get('clientWorkspace').inert,true);assert.ok(h.elements.get('clientRows').innerHTML.includes('client-skeleton-table-row'));assert.equal(h.elements.get('clientEmployees').textContent,'—');assert.equal(h.elements.get('clientCsv').disabled,true);release();await settle();
});

test('account details and access help work without requiring employee access',async()=>{
 const h=harness();await settle();assert.equal(h.elements.get('clientProfileName').textContent,'Example Client');assert.equal(h.elements.get('clientProfileEmail').textContent,'client@example.test');assert.equal(h.elements.get('clientAvatar').textContent,'EC');
 h.elements.get('clientAccountDetails').click();assert.equal(h.elements.get('clientAccountDialog').open,true);h.elements.get('clientCloseAccount').click();assert.equal(h.elements.get('clientAccountDialog').open,false);assert.equal(h.elements.get('clientAccountButton').focused,true);
 h.elements.get('clientAccountHelp').click();assert.equal(h.elements.get('clientHelpDialog').open,true);
});
test('appearance selection applies locally without changing permissions or requesting extra data',async()=>{
 const h=harness();await settle();const before=h.calls.length;h.elements.get('clientAppearance').value='dark';h.elements.get('clientAppearance').handlers.change();assert.equal(h.calls.length,before);assert.equal(h.elements.get('clientWorkspace').hidden,true);
});

test('client uses the app appearance preference and updates it without losing other settings',async()=>{
 const h=harness({preferences:{theme:'dark',fontSize:'large',compact:true},legacyTheme:'light'});await settle();assert.equal(h.root.dataset.theme,'dark');assert.equal(h.elements.get('clientAppearance').value,'dark');h.elements.get('clientAppearance').value='light';h.elements.get('clientAppearance').handlers.change();assert.deepEqual(JSON.parse(h.storage.get('ace_appearance_preferences')),{theme:'light',fontSize:'large',compact:true});assert.equal(h.root.dataset.theme,'light');
});
test('client resolves system mode through the app data-theme attribute and migrates old preferences',async()=>{
 const system=harness({preferences:{theme:'system'},systemDark:true});await settle();assert.equal(system.root.dataset.themePreference,'system');assert.equal(system.root.dataset.theme,'dark');
 const legacy=harness({legacyTheme:'dark'});await settle();assert.equal(legacy.root.dataset.theme,'dark');assert.equal(JSON.parse(legacy.storage.get('ace_appearance_preferences')).theme,'dark');assert.equal(legacy.storage.has('ace_client_appearance'),false);
});

test('date shortcuts use Philippine calendar dates and allow custom dates',async()=>{
 const h=harness();await settle();const period=h.elements.get('clientPeriod'),from=h.elements.get('clientFrom'),to=h.elements.get('clientTo');
 const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 period.value='today';period.handlers.change();assert.equal(from.value,today);assert.equal(to.value,today);
 period.value='last-month';period.handlers.change();assert.equal(from.value.slice(8),'01');assert.ok(to.value<today);assert.ok(from.value<=to.value);
 from.handlers.change();assert.equal(period.value,'custom');
});
test('employee totals render server aggregates rather than summing the current page',async()=>{
 const h=harness({projects:[{id:'p',name:'Support',is_active:true}],data:{items:[{user_id:'u',employee_name:'Alex Reyes',project_names:['Support','Operations'],shifts:50,active:1,worked_seconds:180000}],total:1,shifts:50,employees:1,active:1,worked_seconds:180000,employee_options:[{id:'u',name:'Alex Reyes'}]}});await settle();
 h.elements.get('clientHistory').click();await settle();h.elements.get('clientView').value='employees';h.elements.get('clientView').handlers.change();await settle();
 assert.equal(h.elements.get('clientShifts').textContent,50);assert.ok(h.elements.get('clientRows').innerHTML.includes('50h 0m'));assert.ok(h.elements.get('clientTableHead').innerHTML.includes('Shifts'));
});

test('attendance never registers background polling or focus refreshes',()=>{
 assert.ok(!source.includes('window.setInterval('));assert.ok(!source.includes("window.addEventListener('focus'"));assert.ok(!html.includes('Updates every 60 seconds'));
});

test('planning link appears only for View & plan and disappears after downgrade',async()=>{
 const h=harness({projects:[{id:'a',name:'Support',access_level:'VIEW_PLAN'}]});await settle();assert.equal(h.elements.get('clientPlanShifts').hidden,false);
 h.state.projects=[{id:'a',name:'Support',access_level:'VIEW'}];h.elements.get('clientRefresh').click();await settle();assert.equal(h.elements.get('clientPlanShifts').hidden,true);
});

test('live planning totals and missing clock-ins are rendered without false active rows',async()=>{const h=harness({projects:[{id:'p',name:'Support'}],data:{items:[{id:'planned',user_id:'u',employee_name:'Alex',project_name:'Support',clock_in_at:null,clock_out_at:null,planned_start_at:'2026-11-27T00:00Z',planned_end_at:'2026-11-27T08:00Z',attendance_status:'NO_SHOW',worked_seconds:0,activities:[]}],total:1,employees:4,active:2,not_arrived:3,late:1,finished_today:5,worked_seconds:3600}});await settle();assert.equal(h.elements.get('clientEmployees').textContent,2);assert.equal(h.elements.get('clientShifts').textContent,3);assert.equal(h.elements.get('clientWorked').textContent,1);assert.equal(h.elements.get('clientActive').textContent,5);assert.ok(h.elements.get('clientRows').innerHTML.includes('No-show'));assert.ok(!h.elements.get('clientRows').innerHTML.includes('In progress'));assert.ok(h.elements.get('clientRows').innerHTML.includes('data-label="Planned"'));});
