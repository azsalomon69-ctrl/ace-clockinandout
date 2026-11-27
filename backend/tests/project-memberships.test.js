import test from 'node:test';
import assert from 'node:assert/strict';
import { membershipBatch, parseMembershipCsv, registerMembershipRoutes } from '../server/project-memberships.js';
const id='00000000-0000-4000-8000-000000000001';
test('membership batches reject duplicate IDs, invalid dates and oversized batches',()=>{
 assert.equal(membershipBatch([{employeeId:id,joinedOn:'2026-02-28'}]),true);
 assert.equal(membershipBatch([{employeeId:id,joinedOn:'2026-02-30'}]),false);
 assert.equal(membershipBatch([{employeeId:id},{employeeId:id}]),false);
 assert.equal(membershipBatch([]),false);
 assert.equal(membershipBatch(Array(201).fill({employeeId:id})),false);
});
test('CSV supports quoted names, BOM, explicit IDs and per-row dates',()=>{
 const rows=parseMembershipCsv('\ufeffemail,name,joined_on\nPerson@example.test,"Last, First",2026-01-02\nother@example.test,Other,','2026-01-03');
 assert.deepEqual(rows.map(r=>[r.email,r.joinedOn]),[['person@example.test','2026-01-02'],['other@example.test','2026-01-03']]);
 assert.equal(parseMembershipCsv('employee_id\n'+id,'2026-01-03')[0].employeeId,id);
 for(const csv of ['name\nAlex','email,email\na@example.test,b@example.test','email\ninvalid','email,joined_on\na@example.test,2026-02-30','email'])assert.throws(()=>parseMembershipCsv(csv,'2026-01-03'));
});
test('all membership endpoints require authentication and admin middleware',()=>{
 const routes=[],auth=()=>{},admin=()=>{};
 registerMembershipRoutes({get:(...args)=>routes.push(args),post:(...args)=>routes.push(args)},{db:{},authenticate:auth,adminOnly:admin,fail:()=>{}});
 assert.equal(routes.length,4);for(const route of routes){assert.equal(route[1],auth);assert.equal(route[2],admin);}
});
test('membership saves use trusted actor and preserve batch atomicity through one RPC',async()=>{
 const routes=[],calls=[];const db={rpc:async(...args)=>{calls.push(args);return {data:{changed:1,skipped:0}}}};
 registerMembershipRoutes({get:()=>{},post:(...args)=>routes.push(args)},{db,authenticate:()=>{},adminOnly:()=>{},fail:()=>assert.fail('Unexpected validation error')});
 let response;await routes[0].at(-1)({params:{id},body:{assignments:[{employeeId:id}]},profile:{id:'trusted-admin'},requestId:id},{json:r=>response=r},e=>{throw e;});
 assert.equal(calls.length,1);assert.equal(calls[0][1].p_actor,'trusted-admin');assert.equal(response.changed,1);
});
