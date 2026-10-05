import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createSessionSecurity } from '../server/session-security.js';
const user='10000000-0000-4000-8000-000000000001';
const session='20000000-0000-4000-8000-000000000001';
const token=claims=>jwt.sign({sub:user,session_id:session,exp:Math.floor(Date.now()/1000)+300,...claims},'fixture-only');
test('durable session revocation is shared across API instances and restart',async()=>{
 const revoked=new Set();
 const db={async rpc(name,args){if(name==='ace_end_session'){revoked.add(args.p_session_id);return {error:null};}return {data:revoked.has(args.p_session_id)?null:{id:user,role:'USER'}};}};
 const a=createSessionSecurity(db), b=createSessionSecurity(db), t=token();
 assert.equal((await b.authorizeVerifiedToken(t,user)).profile.id,user);
 await a.end(user,session,null);
 await assert.rejects(()=>b.authorizeVerifiedToken(t,user),/Invalid or expired/);
 await assert.rejects(()=>createSessionSecurity(db).authorizeVerifiedToken(t,user),/Invalid or expired/);
});
test('session store failure fails closed with a retryable 503, not a logout',async()=>{
 const guard=createSessionSecurity({rpc:async()=>({error:{code:'offline'}})});
 await assert.rejects(()=>guard.authorizeVerifiedToken(token(),user),e=>e.status===503);
 await assert.rejects(()=>guard.end(user,session,null),e=>e.status===503);
});
test('missing sessions, expired tokens and mismatched identities are rejected',async()=>{
 let reads=0;const guard=createSessionSecurity({rpc:async()=>{reads++;return {data:null};}});
 for(const claims of [{session_id:undefined},{sub:session},{exp:1}]) await assert.rejects(()=>guard.authorizeVerifiedToken(token(claims),user));
 assert.equal(reads,0);
 await assert.rejects(()=>guard.authorizeVerifiedToken(token(),user));assert.equal(reads,1);
});
test('authorization fetches current role on every request',async()=>{
 let role='ADMIN';const guard=createSessionSecurity({rpc:async()=>({data:{id:user,role}})});
 assert.equal((await guard.authorizeVerifiedToken(token(),user)).profile.role,'ADMIN');
 role='USER';assert.equal((await guard.authorizeVerifiedToken(token(),user)).profile.role,'USER');
});
