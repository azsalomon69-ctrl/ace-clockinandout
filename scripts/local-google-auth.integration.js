// Explicit integration test: local PostgreSQL only, simulated Google provider.
// Every test row and schema change is rolled back, including failures.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import pg from 'pg';
import express from 'express';
import { randomBytes } from 'node:crypto';
import { createGoogleAuth, challenge, hash, resolveGoogleProfile } from '../backend/server/google-auth.js';
const {parsed:c}=dotenv.config({path:new URL('../.env.green.local',import.meta.url)});
if(c.PGHOST!=='127.0.0.1'||c.PGDATABASE!=='ace_green_local'||c.PGPORT!=='5432') throw Error('Local target required');
const db=new pg.Client({host:'127.0.0.1',port:5432,database:'ace_green_local',user:c.PGUSER,password:c.PGPASSWORD,ssl:false});
await db.connect();
let server;
try {
 await db.query('begin');
 const schema='auth_test_'+randomBytes(8).toString('hex');
 await db.query(`create schema ${schema}`);
 await db.query((await fs.readFile(new URL('./local-google-auth-schema.sql',import.meta.url),'utf8')).replaceAll('public.',schema+'.'));
 const query=(sql,args)=>db.query(sql.replaceAll('public.',schema+'.'),args);
 const pool={query,connect:async()=>({query:(sql,args)=>query(sql==='begin'?'savepoint auth_work':sql==='commit'?'release savepoint auth_work':sql==='rollback'?'rollback to savepoint auth_work':sql,args),release(){}})};
 let claims, providerCalls=0;
 const google={generateAuthUrl:opts=>{claims={sub:'test-google-subject',email:'owner@gmail.com',email_verified:true,nonce:opts.nonce}; return 'https://accounts.google.com/?'+new URLSearchParams(opts);},getToken:async()=>{providerCalls++;return {tokens:{id_token:'test'}};},verifyIdToken:async()=>({getPayload:()=>claims})};
 const env={GOOGLE_CLIENT_ID:'test',GOOGLE_CLIENT_SECRET:'test',HEAD_ADMIN_EMAIL:'owner@gmail.com',GREEN_BOOTSTRAP_HEAD_ADMIN:'true',GREEN_FRONTEND_URL:'http://localhost:5500',GOOGLE_REDIRECT_URI:'http://localhost:3000/v1/auth/google/callback',NODE_ENV:'development',GOOGLE_AUTH_LOCAL_TEST:'true'};
 const auth=createGoogleAuth(pool,env,google);
 const app=express();app.use(express.json());auth.register(app,(_q,_s,n)=>n());
 app.use((_e,_q,s,_n)=>s.status(500).json({error:'test error'}));
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 const request=(path,opts={})=>fetch(base+path,{...opts,redirect:'manual'});
 const verifier=randomBytes(32).toString('base64url');
 const start=await request('/v1/auth/google/start?challenge='+challenge(verifier));
 assert.equal(start.status,302);
 assert.match(start.headers.get('set-cookie'),/HttpOnly/);
 assert.match(start.headers.get('set-cookie'),/SameSite=Lax/);
 const cookie=start.headers.get('set-cookie').split(';')[0];
 const state=new URL(start.headers.get('location')).searchParams.get('state');
 const callback='/v1/auth/google/callback?state='+state+'&code=test';
 const bad=await request(callback,{headers:{cookie:'ace_local_oauth=wrong'}});
 assert.match(bad.headers.get('location'),/ace_error/);assert.equal(providerCalls,0);
 const success=await request(callback,{headers:{cookie}});
 const code=new URLSearchParams(new URL(success.headers.get('location')).hash.slice(1)).get('ace_code');
 assert.ok(code);assert.equal(providerCalls,1);
 const replay=await request(callback,{headers:{cookie}});
 assert.match(replay.headers.get('location'),/ace_error/);assert.equal(providerCalls,1);
 const exchange=(v,origin='http://localhost:5500')=>request('/v1/auth/google/exchange',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({code,verifier:v})});
 assert.equal((await exchange(verifier,'http://evil.example')).status,403);
 assert.equal((await exchange(randomBytes(32).toString('base64url'))).status,401);
 const exchanged=await exchange(verifier);assert.equal(exchanged.status,200);
 const {session}=await exchanged.json();assert.ok(session.access_token.startsWith('aceg_'));
 assert.equal((await exchange(verifier)).status,401);
 const user=await auth.readUser(session.access_token);assert.equal(user.email,'owner@gmail.com');
 const {rows:[stored]}=await query('select token_hash from public.app_sessions');
 assert.equal(stored.token_hash,hash(session.access_token));
 assert.notEqual(stored.token_hash,session.access_token);
 await query("update public.profiles set status='DENIED' where id=$1",[user.id]);
 await assert.rejects(()=>auth.readUser(session.access_token));
 await query("update public.profiles set status='ACTIVE' where id=$1",[user.id]);
 await auth.revoke(session.access_token);await assert.rejects(()=>auth.readUser(session.access_token));
 await assert.rejects(()=>resolveGoogleProfile(pool,{sub:'stranger',email:'stranger@gmail.com',name:'Stranger'},{headAdminEmail:'owner@gmail.com'}),/invitation_required/);
 const {rows:[count]}=await query('select count(*)::int as n from public.profiles');assert.equal(count.n,1);
 console.log('PASS: local SQL, OAuth state/cookie binding, replay rejection, exchange challenge/origin, bootstrap, invitation guard, inactive-account rejection, token hashing and durable logout. Google responses were simulated.');
} finally {
 if(server) {server.closeAllConnections();await new Promise(r=>server.close(r));}
 await db.query('rollback');await db.end();
}
