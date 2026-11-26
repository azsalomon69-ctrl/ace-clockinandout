import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {setImmediate} from 'node:timers/promises';
const source=readFileSync(new URL('../../frontend/js/client-dashboard.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../../frontend/client-dashboard.html',import.meta.url),'utf8');
const settle=async()=>{for(let n=0;n<8;n++)await setImmediate();};
function harness({projects=[],data={items:[],total:0,employees:0,active:0,worked_seconds:0},failure,wait}={}){
 const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],{hidden:false,disabled:false,value:'',textContent:'',innerHTML:'',handlers:{},setAttribute(){},replaceChildren(){this.innerHTML='';},close(){},showModal(){},classList:{toggle(){}},addEventListener(type,fn){this.handlers[type]=fn;},click(){return this.handlers.click?.();}}]));
 elements.get('clientWorkspace').hidden=true;
 const calls=[];const state={projects,data,failure};
 const context=vm.createContext({document:{hidden:false,getElementById:id=>elements.get(id),querySelectorAll:()=>[]},window:{ACEAuth:{request:async(url,options)=>{calls.push(url);if(url==='/v1/me')return {profile:{role:'CLIENT',status:'ACTIVE',full_name:'Client'}};if(wait)await wait;if(state.failure)throw state.failure;return url==='/v1/client/projects'?state.projects:state.data;}},setInterval(){},addEventListener(){},location:{replace(){}}},localStorage:{},sessionStorage:{}});
 vm.runInContext(source,context);return {elements,calls,state};
}
test('no assigned projects shows a real empty state and never requests attendance',async()=>{
 const h=harness();await settle();assert.equal(h.elements.get('clientStateTitle').textContent,'No projects assigned');assert.equal(h.elements.get('clientStateHelp').hidden,false);assert.equal(h.elements.get('clientWorkspace').hidden,true);assert.equal(h.elements.get('clientStateAction').hidden,false);assert.ok(!h.calls.includes('/v1/client/attendance/search'));assert.equal(h.elements.get('clientCsv').disabled,true);
});
test('no active shifts and empty history have separate messages and useful actions',async()=>{
 const h=harness({projects:[{id:'a',name:'Project A',is_active:true}]});await settle();assert.equal(h.elements.get('clientEmptyTitle').textContent,'No employees clocked in');assert.equal(h.elements.get('clientEmptyAction').textContent,'View history');assert.equal(h.elements.get('clientTableScroll').hidden,true);assert.equal(h.elements.get('clientCsv').disabled,true);
 h.elements.get('clientEmptyAction').click();await settle();assert.equal(h.elements.get('clientEmptyTitle').textContent,'No time entries');assert.equal(h.elements.get('clientEmptyAction').textContent,'Reset filters');
});
test('failed requests show retry state and retry can recover without a reload',async()=>{
 const h=harness({failure:new Error('network')});await settle();assert.equal(h.elements.get('clientStateTitle').textContent,'Attendance unavailable');assert.equal(h.elements.get('clientWorkspace').hidden,true);h.state.failure=null;h.elements.get('clientStateAction').click();await settle();assert.equal(h.elements.get('clientStateTitle').textContent,'No projects assigned');
});
test('revoking access clears prior records and disables exports',async()=>{
 const h=harness({projects:[{id:'a',name:'Project A',is_active:true}],data:{items:[{id:'entry',employee_name:'Employee',project_name:'Project A',clock_in_at:'2026-11-27T00:00Z',clock_out_at:null,worked_seconds:60,activities:[]}],total:1,employees:1,active:1,worked_seconds:60}});await settle();assert.ok(h.elements.get('clientRows').innerHTML.includes('Employee'));assert.equal(h.elements.get('clientCsv').disabled,false);h.state.projects=[];h.elements.get('clientRefresh').click();await settle();assert.equal(h.elements.get('clientRows').innerHTML,'');assert.equal(h.elements.get('clientCsv').disabled,true);assert.equal(h.elements.get('clientWorkspace').hidden,true);
});
test('loading does not show false zero statistics or enable exports',async()=>{
 let release;const wait=new Promise(r=>release=r);const h=harness({wait});await settle();assert.equal(h.elements.get('clientStateTitle').textContent,'Loading attendance');assert.equal(h.elements.get('clientEmployees').textContent,'—');assert.equal(h.elements.get('clientCsv').disabled,true);release();await settle();
});
