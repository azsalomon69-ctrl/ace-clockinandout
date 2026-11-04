import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../../frontend/js/script.js',import.meta.url),'utf8');
const functions=source.slice(source.indexOf('let startupWarmupInterval'),source.indexOf('async function loadDatabaseWhenServiceIsReady'));
function fixture(inline=false) {
 let now=0, tick, delayed, notice, reloads=0;
 const nodes=new Map(); const node=id=>{if(!nodes.has(id)) nodes.set(id,{textContent:'',disabled:true,addEventListener(_,fn){this.click=fn;}});return nodes.get(id);};
 const host={setAttribute(){},prepend(value){notice=value;}};
 const document={body:host,querySelector(selector){if(selector==='.app-shell-skeleton')return inline?null:host;if(selector==='.login-body')return inline?host:null;if(selector==='.shell-startup-warmup')return notice;return null;},createElement(){return {classList:{add(){}},insertAdjacentHTML(){},setAttribute(){},querySelector:node,remove(){notice=null;}};}};
 const context=vm.createContext({document,Date:{now:()=>now},window:{setInterval(fn){tick=fn;return 1;},clearInterval(){tick=null;},setTimeout(fn){delayed=fn;return 2;},clearTimeout(){delayed=null;},location:{reload(){reloads++;}}}});
 vm.runInContext(functions,context);
 return {context,node,get notice(){return notice;},advance(ms){now+=ms;tick?.();},showDelayed(){delayed?.();},get reloads(){return reloads;}};
}
for(const inline of [false,true])test(`countdown enables refresh after 60 seconds in ${inline?'login':'dashboard'}`,()=>{
 const f=fixture(inline);f.context.showStartupWarmupNotice();assert.ok(f.notice);
 f.advance(59000);assert.equal(f.node('[data-startup-refresh]').disabled,true);assert.equal(f.node('.startup-warmup-countdown').textContent,'0:01');
 f.advance(1000);assert.equal(f.node('[data-startup-refresh]').disabled,false);assert.equal(f.node('[data-warmup-title]').textContent,'You can refresh now');assert.equal(f.reloads,0);
 f.node('[data-startup-refresh]').click();assert.equal(f.reloads,1);
});
test('countdown catches up after a background tab is throttled',()=>{const f=fixture();f.context.showStartupWarmupNotice();f.advance(90000);assert.equal(f.node('[data-startup-refresh]').disabled,false);assert.equal(f.node('.startup-warmup-countdown').textContent,'0:00');});
test('fast connections never show the notice',async()=>{const f=fixture();assert.equal(await f.context.withStartupWarmup(async()=>42),42);f.showDelayed();assert.equal(f.notice,undefined);});
test('successful recovery removes the notice and timer',async()=>{const f=fixture();await f.context.withStartupWarmup(async()=>{f.showDelayed();assert.ok(f.notice);});assert.equal(f.notice,null);});

const retrySource = source.slice(source.indexOf('async function loadDatabaseWhenServiceIsReady'), source.indexOf('// Initialize App'));
function retryHarness(operation) {
 let notices=0, cleared=0;
 const context=vm.createContext({Date,Promise,console:{info(){}},loadDatabase:operation,pause:async()=>{},showStartupWarmupNotice(){notices++;},clearStartupWarmupNotice(){cleared++;},window:{setTimeout(){return 1;},clearTimeout(){}}});
 vm.runInContext(retrySource,context);
 return {run:context.loadDatabaseWhenServiceIsReady,notices:()=>notices,cleared:()=>cleared};
}
test('503 during wake-up retries and recovers without changing the session',async()=>{
 let calls=0;
 const app=retryHarness(async()=>{calls++;if(calls<3)throw Object.assign(new Error('Service unavailable'),{status:503});return true;});
 assert.equal(await app.run(),true);assert.equal(calls,3);assert.equal(app.notices(),2);assert.equal(app.cleared(),1);
});
test('an unavailable service stops after bounded retries',async()=>{
 let calls=0;const app=retryHarness(async()=>{calls++;throw Object.assign(new Error('Service unavailable'),{status:503});});
 await assert.rejects(app.run(),{status:503});assert.equal(calls,10);
});
test('authentication errors are not treated as a waking service',async()=>{
 let calls=0;const app=retryHarness(async()=>{calls++;throw Object.assign(new Error('Sign in required'),{status:401});});
 await assert.rejects(app.run(),{status:401});assert.equal(calls,1);assert.equal(app.notices(),0);
});
