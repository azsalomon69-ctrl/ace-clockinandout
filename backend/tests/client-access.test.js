import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { clientFilters, safeSpreadsheetText, registerClientRoutes } from '../server/client-access.js';
const actor='00000000-0000-4000-8000-000000000402',project='00000000-0000-4000-8000-000000000411';
const filter={from:'2026-11-01',to:'2026-11-30'};
function harness(result={items:[],total:0},error=null){const handlers=new Map(),calls=[];const authenticate=()=>{},adminOnly=()=>{};
 registerClientRoutes({get:(path,...args)=>handlers.set('GET '+path,args),post:(path,...args)=>handlers.set('POST '+path,args),put:(path,...args)=>handlers.set('PUT '+path,args)},{authenticate,adminOnly,fail:(res,code,error)=>res.status(code).json({error}),audit:async(...args)=>calls.push({audit:args}),db:{rpc:async(name,args)=>{calls.push({name,args});return {data:result,error};}}});
 const invoke=async(path,body={})=>{const res={code:200,headers:{},status(code){this.code=code;return this;},json(body){this.body=body;return this;},set(key,value){this.headers[key]=value;return this;},attachment(name){this.file=name;return this;},type(type){this.mime=type;return this;},send(body){this.body=body;return this;},end(){return this;}};await handlers.get(path).at(-1)({body,profile:{id:actor,role:'CLIENT'},params:{id:actor},requestId:'request'},res,e=>{throw e;});return res;};return {handlers,calls,invoke,adminOnly,authenticate};}
test('client filters reject malformed dates, forged IDs and unbounded queries',()=>{
 for(const bad of [{...filter,from:'2026-02-30'},{...filter,to:'2028-01-01'},{...filter,projectIds:['bad']},{...filter,page:1.5},{...filter,status:'DELETED'},{...filter,projectIds:'all'}])assert.equal(clientFilters(bad),null);
 assert.deepEqual(clientFilters({...filter,projectIds:[project,project]}).p_projects,[project]);
 assert.equal(clientFilters(filter,true).p_size,10000);
});
test('client read always uses authenticated actor and does not trust caller identity or page size',async()=>{
 const h=harness();const r=await h.invoke('POST /v1/client/attendance/search',{...filter,p_actor:'admin',userId:'other',pageSize:100000});
 assert.equal(r.code,200);assert.equal(h.calls[0].args.p_actor,actor);assert.equal(h.calls[0].args.p_size,25);assert.equal(r.headers['Cache-Control'],'no-store');
 assert.equal(h.handlers.get('GET /v1/admin/client-access')[1],h.adminOnly);
 assert.equal(h.handlers.get('PUT /v1/admin/client-access/:id')[1],h.adminOnly);
});
test('revoked or forged project access blocks searches and exports without revealing DB details',async()=>{
 for(const path of ['POST /v1/client/attendance/search','POST /v1/client/attendance/export']){
 const h=harness(null,{message:'PROJECT_ACCESS_DENIED'});const r=await h.invoke(path,{...filter,format:'CSV'});assert.equal(r.code,403);assert.ok(!r.body.error.includes('PROJECT_ACCESS_DENIED'));
 }
});
test('exports are freshly authorized and generate real Excel and safe CSV',async()=>{
 const data={total:1,items:[{employee_name:'=HYPERLINK("bad")',project_name:'Project A',clock_in_at:'2026-11-01T00:00:00Z',clock_out_at:'2026-11-01T01:00:00Z',worked_seconds:3600,activities:[{description:'@payload',duration_seconds:3600,ended_at:'2026-11-01T01:00:00Z'}]}]};
 for(const format of ['CSV','XLSX']){const h=harness(data);const res=await h.invoke('POST /v1/client/attendance/export',{...filter,format});assert.equal(h.calls[0].name,'client_attendance');assert.equal(h.calls[0].args.p_actor,actor);assert.ok(h.calls.some(c=>c.audit));
 if(format==='CSV')assert.ok(res.body.includes("'=HYPERLINK"));else{const book=XLSX.read(res.body,{type:'buffer'});const rows=XLSX.utils.sheet_to_json(book.Sheets.Attendance,{header:1});assert.equal(rows[1][0],"'=HYPERLINK(\"bad\")");assert.equal(rows[1][4],3600);assert.ok(!book.Sheets.Attendance.A2.f);}}
 assert.equal(safeSpreadsheetText('\t=1+1'),"'\t=1+1");
});
test('oversized exports are explicitly blocked instead of silently truncated',async()=>{
 const h=harness({items:[],total:10001});assert.equal((await h.invoke('POST /v1/client/attendance/export',{...filter,format:'CSV'})).code,422);assert.ok(!h.calls.some(c=>c.audit));
});
test('client legacy route allowlist denies mutation and unrelated API access',()=>{
 const s=readFileSync(new URL('../server/index.js',import.meta.url),'utf8');const start=s.indexOf("  if (req.profile.role === 'CLIENT' && ![");const end=s.indexOf('  return next();',start);const code=s.slice(start,end)+'\nnext();';
 for(const [method,path,allow]of [['GET','/v1/me',true],['POST','/v1/client/attendance/export',true],['GET','/v1/users',false],['GET','/v1/projects',false],['GET','/v1/time-entries',false],['POST','/v1/time-entries/clock-in',false],['POST','/v1/time-entries/manual',false],['PATCH','/v1/me',false],['POST','/v1/invitations',false]]){
 let allowed=false,status;vm.runInNewContext('(function(){'+code+'})();',{req:{profile:{role:'CLIENT'},method,path},res:{},next:()=>{allowed=true;},fail:(_r,s)=>{status=s;}});assert.equal(allowed,allow,method+path);if(!allow)assert.equal(status,403);
 }
});
