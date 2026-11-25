import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../server/index.js',import.meta.url),'utf8');
const validators=source.slice(source.indexOf('const isUuid ='),source.indexOf("app.param('id'"));
const route=source.slice(source.indexOf("app.post('/v1/time-entries/manual'"),source.indexOf("app.post('/v1/time-entries/clock-in'"));
const employee='00000000-0000-4000-8000-000000000003', actor='00000000-0000-4000-8000-000000000004';
const body=()=>({userId:employee,actionId:'00000000-0000-4000-8000-000000000005',clockInAt:'2026-01-01T00:00:00Z',clockOutAt:'2026-01-01T09:00:00Z',reason:'Forgot to clock in'});
function harness(error=null){
 const calls=[];let handlers;
 const authenticate=()=>{},adminOnly=()=>{};
 vm.runInNewContext(validators+'\n'+route,{app:{post:(_path,...args)=>{handlers=args;}},authenticate,adminOnly,
 fail:(res,status,error)=>res.status(status).json({error}),
 db:{rpc:async(name,args)=>{calls.push({name,args});return {data:{id:args.p_entry,duration_seconds:32400},error};}}});
 const invoke=async changes=>{const res={code:200,status(code){this.code=code;return this;},json(data){this.body=data;}};
 await handlers.at(-1)({body:{...body(),...changes},profile:{id:actor},ip:'127.0.0.1',requestId:'request-id',get:()=> 'test'},res,e=>{res.code=e.status||500;res.body={error:e.message};});return res;};
 return {calls,invoke,handlers,authenticate,adminOnly};
}
test('manual entry requires authenticated administrator and uses server actor and audit context',async()=>{
 const h=harness();assert.equal(h.handlers[0],h.authenticate);assert.equal(h.handlers[1],h.adminOnly);
 const res=await h.invoke({p_actor:'spoofed',projectId:null});assert.equal(res.code,201);
 assert.equal(h.calls[0].args.p_actor,actor);assert.equal(h.calls[0].args.p_employee,employee);
 assert.equal(h.calls[0].args.p_reason,'Forgot to clock in');assert.equal(h.calls[0].args.p_project,null);
 assert.equal(h.calls[0].args.p_request,'request-id');assert.equal(h.calls[0].args.p_entry,body().actionId);
});
test('manual entry rejects invalid identifiers, reversed, equal, future and missing times and blank reasons',async()=>{
 for(const invalid of [{userId:'bad'},{actionId:null},{projectId:'bad'},{clockInAt:'bad'},
 {clockOutAt:'2025-01-01T00:00:00Z'},{clockOutAt:body().clockInAt},{clockInAt:'2026-01-01T00:00:00'},{clockOutAt:'2999-01-01T00:00:00Z'},{reason:' '},{reason:'a'.repeat(501)}]){
 const h=harness();assert.equal((await h.invoke(invalid)).code,400,JSON.stringify(invalid));assert.equal(h.calls.length,0);
 }
});
test('manual entry handles overnight Philippine times without shifting duration',async()=>{
 const h=harness();assert.equal((await h.invoke({clockInAt:'2026-01-01T22:00:00+08:00',clockOutAt:'2026-01-02T07:00:00+08:00'})).code,201);
 assert.equal(h.calls[0].args.p_clock_in,'2026-01-01T14:00:00.000Z');assert.equal(h.calls[0].args.p_clock_out,'2026-01-01T23:00:00.000Z');
});
test('manual entry maps database conflicts without exposing internal errors',async()=>{
 for(const [message,status] of [['TIME_ENTRY_OVERLAP',409],['MANUAL_ENTRY_CONFLICT',409],['EMPLOYEE_NOT_FOUND',404],['PROJECT_UNAVAILABLE',400],['ADMIN_REQUIRED',403],['INVALID_MANUAL_ENTRY',400]]){
 const res=await harness({message}).invoke({});assert.equal(res.code,status);assert.ok(!res.body.error.includes(message));
 }
});
