// Real local PostgreSQL tests. No hosted URLs/keys are read; temporary schemas
// isolate all test rows from the local Google preview and any other application.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';
const c=dotenv.parse(await fs.readFile(new URL('../.env.local-test',import.meta.url)));
if(c.PGHOST!=='127.0.0.1'||c.PGDATABASE!=='ace_green_local'||c.PGPORT!=='5432') throw Error('Only the verified local database is allowed');
const pool=new pg.Pool({host:'127.0.0.1',port:5432,database:'ace_green_local',user:c.PGUSER,password:c.PGPASSWORD,ssl:false,max:5,connectionTimeoutMillis:3000});
const schema='ace_check_'+randomBytes(8).toString('hex'), auth=schema+'_auth';
const rewrite=s=>s.replaceAll('public.',schema+'.').replaceAll('auth.',auth+'.');
const query=(s,args)=>pool.query(rewrite(s),args);
let passed=0;
const check=async(name,work)=>{await work();passed++;console.log('PASS '+name);};
try {
 await pool.query(`create schema ${schema}; create schema ${auth}`);
 await query(`
 create type public.user_role as enum('ADMIN','USER');
 create type public.user_status as enum('ACTIVE','PENDING','DENIED');
 create table auth.users(id uuid primary key,banned_until timestamptz);
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
 create table public.profiles(id uuid primary key,email text,role public.user_role,status public.user_status,
 department_id uuid,permanently_deleted_at timestamptz,last_logout_at timestamptz);
 create table public.invitations(id uuid primary key default gen_random_uuid(),invited_by_user_id uuid references public.profiles,
 email text,role public.user_role,department_id uuid,status text default 'PENDING',invited_at timestamptz default now(),
 expires_at timestamptz default now()+interval '7 days',accepted_at timestamptz);
 create unique index pending_email on public.invitations(email) where status='PENDING';
 create table public.audit_logs(id uuid default gen_random_uuid(),user_id uuid references public.profiles,
 action text,entity_type text,entity_id uuid,description text,request_id uuid);
 `);
 const a=randomUUID(),b=randomUUID(),employee=randomUUID(),session=randomUUID();
 for(const [id,email,role] of [[a,'a@example.test','ADMIN'],[b,'b@example.test','ADMIN'],[employee,'employee@example.test','USER']]) {
   await query('insert into auth.users(id) values($1)',[id]);
   await query("insert into public.profiles(id,email,role,status) values($1,$2,$3,'ACTIVE')",[id,email,role]);
 }
 await query('insert into auth.sessions(id,user_id) values($1,$2)',[session,employee]);
 // The fixture tests real functions/triggers. Privilege statements are retained,
 // mapped to transaction-created NOLOGIN roles and rolled back with setup if it fails.
 const roles=['anon','authenticated','service_role'];
 const setup=await pool.connect();
 try {
  await setup.query('begin');
  for(const role of roles) await setup.query(`create role ${schema}_${role} nologin`);
  let sql=rewrite(await fs.readFile(new URL('../supabase/migrations/0026_backend_reliability.sql',import.meta.url),'utf8'));
  sql=sql.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');
  for(const role of roles) sql=sql.replace(new RegExp('\\b'+role+'\\b','g'),schema+'_'+role);
  await setup.query(sql);
  await setup.query(`grant usage on schema ${schema} to ${schema}_anon, ${schema}_authenticated, ${schema}_service_role`);
  await setup.query('commit');
 } catch(e) {await setup.query('rollback');throw e;} finally {setup.release();}
 await check('concurrent removal of the last two administrators permits only one',async()=>{
   const results=await Promise.allSettled([a,b].map(id=>query("update public.profiles set role='USER' where id=$1",[id])));
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
   assert.equal(results.find(r=>r.status==='rejected').reason.message,'LAST_ACTIVE_ADMIN');
   assert.equal((await query("select count(*)::int as n from public.profiles where role='ADMIN' and status='ACTIVE'")).rows[0].n,1);
 });
 await query("update public.profiles set role='ADMIN' where id=$1",[a]);
 await query("update public.profiles set role='USER' where id=$1",[b]);
 await check('delete and soft-delete also preserve the last administrator',async()=>{
   await assert.rejects(()=>query('delete from public.profiles where id=$1',[a]),/LAST_ACTIVE_ADMIN/);
   await assert.rejects(()=>query('update public.profiles set permanently_deleted_at=now() where id=$1',[a]),/LAST_ACTIVE_ADMIN/);
 });
 const invite=(email,role='USER')=>query('select * from public.ace_invite_with_audit($1,$2,$3,null,$4,$5)',[a,email,role,'head@example.test',randomUUID()]);
 await check('simultaneous invitations create exactly one invitation and audit',async()=>{
   const results=await Promise.allSettled([invite('new@example.test'),invite('new@example.test')]);
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
   assert.equal(results.find(r=>r.status==='rejected').reason.message,'INVITATION_EXISTS');
   assert.equal((await query("select count(*)::int as n from public.audit_logs where action='PREAUTHORIZE_GOOGLE_ACCOUNT'")).rows[0].n,1);
 });
 await check('invitation rolls back profile and invitation when audit fails',async()=>{
   await query("alter table public.audit_logs add constraint injected_failure check (action <> 'PREAUTHORIZE_GOOGLE_ACCOUNT') not valid");
   await assert.rejects(()=>invite('employee@example.test','ADMIN'));
   assert.equal((await query('select role from public.profiles where id=$1',[employee])).rows[0].role,'USER');
   assert.equal((await query("select count(*)::int as n from public.invitations where email='employee@example.test'")).rows[0].n,0);
   await query('alter table public.audit_logs drop constraint injected_failure');
 });
 await check('re-invitation restores profile and Auth together',async()=>{
   await query("update public.profiles set status='DENIED' where id=$1",[employee]);
   await query("update auth.users set banned_until=now()+interval '1 year' where id=$1",[employee]);
   const result=await invite('employee@example.test');assert.equal(result.rows[0].status,'ACCEPTED');
   assert.equal((await query('select banned_until from auth.users where id=$1',[employee])).rows[0].banned_until,null);
 });
 const read=()=>query('select (public.ace_session_profile($1,$2)).*',[employee,session]);
 await check('session revocation persists across separate DB connections',async()=>{
   assert.equal((await read()).rows[0].id,employee);
   await query('select public.ace_end_session($1,$2,$3)',[employee,session,randomUUID()]);
   const independent = new pg.Client({host:'127.0.0.1',port:5432,database:'ace_green_local',user:c.PGUSER,password:c.PGPASSWORD,ssl:false});
   try { await independent.connect(); assert.equal((await independent.query(rewrite('select (public.ace_session_profile($1,$2)).id'),[employee,session])).rows[0].id,null); }
   finally {await independent.end();}
   await query('select public.ace_end_session($1,$2,$3)',[employee,session,randomUUID()]);
   assert.equal((await query("select count(*)::int as n from public.audit_logs where action='LOGOUT'")).rows[0].n,1);
 });
 await check('revocation and logout audit roll back together',async()=>{
   const fresh=randomUUID();await query('insert into auth.sessions(id,user_id) values($1,$2)',[fresh,employee]);
   await query("alter table public.audit_logs add constraint injected_failure check (action <> 'LOGOUT') not valid");
   await assert.rejects(()=>query('select public.ace_end_session($1,$2,$3)',[employee,fresh,randomUUID()]));
   assert.equal((await query('select (public.ace_session_profile($1,$2)).id',[employee,fresh])).rows[0].id,employee);
   await query('alter table public.audit_logs drop constraint injected_failure');
 });
 await check('session ownership and expiry are enforced',async()=>{
   const fresh=randomUUID();await query("insert into auth.sessions values($1,$2,now()-interval '1 second')",[fresh,employee]);
   assert.equal((await query('select (public.ace_session_profile($1,$2)).id',[employee,fresh])).rows[0].id,null);
   assert.equal((await query('select (public.ace_session_profile($1,$2)).id',[a,session])).rows[0].id,null);
 });
 await check('anonymous role cannot execute privileged RPCs',async()=>{
   const conn=await pool.connect();try {
     await conn.query('begin');await conn.query(`set local role ${schema}_anon`);
     await assert.rejects(()=>conn.query(rewrite('select public.ace_end_session(null,null,null)')),/permission denied for function/);
   } finally {await conn.query('rollback');conn.release();}
 });
 await check('counter matches actual administrators after rolled-back changes',async()=>{
   const actual=(await query("select count(*)::int as n from public.profiles where role='ADMIN' and status='ACTIVE' and permanently_deleted_at is null")).rows[0].n;
   assert.equal((await query('select active_count from public.ace_admin_invariant')).rows[0].active_count,actual);
 });
 await check('head account protection is enforced inside the invitation transaction',async()=>{
   await assert.rejects(()=>query('select * from public.ace_invite_with_audit($1,$2,$3,null,$4,$5)',[a,'employee@example.test','ADMIN','employee@example.test',randomUUID()]),/HEAD_ADMIN_PROTECTED/);
 });
 console.log(`${passed} real PostgreSQL reliability checks passed. No live database contacted.`);
} finally {
 // Names originate only from the fixed prefix plus random hex above.
 await pool.query(`drop schema if exists ${schema} cascade; drop schema if exists ${auth} cascade`);
 for(const role of ['anon','authenticated','service_role']) {
  await pool.query(`drop role if exists ${schema}_${role}`);
 }
 await pool.end();
}
