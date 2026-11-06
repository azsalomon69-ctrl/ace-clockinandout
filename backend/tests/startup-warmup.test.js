import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../../frontend/js/script.js',import.meta.url),'utf8');
const functions=source.slice(source.indexOf('function showStartupWarmupNotice()'),source.indexOf('async function loadDatabaseWhenServiceIsReady'));
function fixture(publicPage=false) {
 let delayed, notice, reloads=0;
 const nodes=new Map(); const node=id=>{if(!nodes.has(id)) nodes.set(id,{hidden:true,textContent:'',addEventListener(_,fn){this.click=fn;}});return nodes.get(id);};
 const host={setAttribute(){},prepend(value){notice=value;}};
 const document={body:host,querySelector(selector){if(selector==='.app-shell-skeleton')return publicPage?null:host;if(selector==='.shell-startup-warmup')return notice;return null;},createElement(){return {innerHTML:'',classList:{add(){}},setAttribute(){},querySelector:node,remove(){notice=null;}};}};
 const context=vm.createContext({document,window:{setTimeout(fn){delayed=fn;return 2;},clearTimeout(){delayed=null;},location:{reload(){reloads++;}}}});
 vm.runInContext(functions,context);
 return {context,node,get notice(){return notice;},showDelayed(){delayed?.();},get reloads(){return reloads;}};
}
for(const publicPage of [false,true])test('automatic loading screen has no countdown on '+(publicPage?'login':'dashboard'),()=>{
 const f=fixture(publicPage);f.context.showStartupWarmupNotice();assert.ok(f.notice);
 assert.match(f.notice.innerHTML,/You don’t need to refresh/);assert.doesNotMatch(f.notice.innerHTML,/Connecting automatically/);assert.doesNotMatch(f.notice.innerHTML,/countdown|1:00|Refresh available/);
});
test('fast connections never show the loading screen',async()=>{const f=fixture();assert.equal(await f.context.withStartupWarmup(async()=>42),42);f.showDelayed();assert.equal(f.notice,undefined);});
test('automatic recovery removes the screen without refreshing',async()=>{const f=fixture();await f.context.withStartupWarmup(async()=>{f.showDelayed();assert.ok(f.notice);});assert.equal(f.notice,null);assert.equal(f.reloads,0);});
test('exhausted connection attempts offer manual retry without an automatic reload',async()=>{
 const f=fixture();await assert.rejects(f.context.withStartupWarmup(async()=>{throw Object.assign(new Error('Unavailable'),{status:503});}));
 assert.equal(f.node('[data-startup-refresh]').hidden,false);assert.match(f.node('[data-warmup-title]').textContent,/Unable to connect/);assert.equal(f.reloads,0);
 f.node('[data-startup-refresh]').click();assert.equal(f.reloads,1);
});
test('authentication failures do not retain a reconnecting screen',async()=>{
 const f=fixture();await assert.rejects(f.context.withStartupWarmup(async()=>{f.showDelayed();throw Object.assign(new Error('Expired'),{status:401});}));assert.equal(f.notice,null);
});
const retrySource = source.slice(source.indexOf('async function loadDatabaseWhenServiceIsReady'), source.indexOf('// Initialize App'));
function retryHarness(operation, checkService) {
 let notices=0, cleared=0, now=0;
 class FakeDate extends Date { static now() { return now; } }
 const context=vm.createContext({Date:FakeDate,Promise,document:{querySelector:()=>null},console:{info(){}},loadDatabase:operation,pause:async ms=>{now+=ms;},showStartupWarmupNotice(){notices++;},clearStartupWarmupNotice(){cleared++;},window:{ACEAuth:{checkService},setTimeout(){return 1;},clearTimeout(){}}});
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
 await assert.rejects(app.run(),{status:504});assert.ok(calls>10 && calls<50);
});
test('authentication errors are not treated as a waking service',async()=>{
 let calls=0;const app=retryHarness(async()=>{calls++;throw Object.assign(new Error('Sign in required'),{status:401});});
 await assert.rejects(app.run(),{status:401});assert.equal(calls,1);assert.equal(app.notices(),0);
});

test('a server waking after the old retry limit still loads automatically',async()=>{
 let checks=0,loads=0;
 const app=retryHarness(async()=>{loads++;return true;},async()=>{checks++;if(checks<=15)throw Object.assign(new Error('Waking'),{status:503});});
 assert.equal(await app.run(),true);assert.equal(checks,16);assert.equal(loads,1);
});
test('workspace loading never starts while the service health check fails',async()=>{
 let loads=0;
 const app=retryHarness(async()=>{loads++;},async()=>{throw Object.assign(new Error('Waking'),{status:503});});
 await assert.rejects(app.run(),{status:504});assert.equal(loads,0);
});
