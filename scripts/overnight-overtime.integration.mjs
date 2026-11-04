// Real overtime calculations and ACL checks in a fresh, disposable local cluster.
// Does not load application schema, dotenv, connection URLs, or old migrations.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';

const bin = process.env.ACE_TEST_PG_BIN;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
function run(name, args, input) {
  const executable = bin ? path.join(bin, `${name}${process.platform === 'win32' ? '.exe' : ''}`) : name;
  // A background server must not inherit Node's pipes through pg_ctl on Windows.
  const result = spawnSync(executable, args, { input, env, encoding: 'utf8', windowsHide: true, timeout: 60_000,
    ...(name === 'pg_ctl' ? { stdio: 'ignore' } : {}) });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return (result.stdout || '').trim();
}

test('overnight overtime uses Manila shift dates and retains server-only access', { timeout: 120_000 }, async t => {
  const parent = await realpath(tmpdir());
  const temporary = await mkdtemp(path.join(parent, 'ace-f01-'));
  const data = path.join(temporary, 'data');
  let started = false;
  try {
    run('initdb', ['-D', data, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--no-locale']);
    const listener = net.createServer();
    await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
    const port = listener.address().port;
    await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
    try {
      run('pg_ctl', ['-D', data, '-l', path.join(temporary, 'postgres.log'), '-w', '-t', '30', 'start', '-o', `-h 127.0.0.1 -p ${port}`]);
      started = true;
    } catch (error) {
      throw new Error(`${error.message}\n${await readFile(path.join(temporary, 'postgres.log'), 'utf8').catch(() => '')}`);
    }
    const sql = source => run('psql', [
      '-X', '--no-password', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres',
      '--set=ON_ERROR_STOP=1', '--quiet', '--tuples-only', '--no-align', '--file=-'
    ], source);
    sql(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create table public.time_entries (id uuid primary key, clock_in_at timestamptz, clock_out_at timestamptz, deleted_at timestamptz, schedule_type text, scheduled_start_time time, scheduled_end_time time, overtime_approved_seconds integer default 0, overtime_approved_by_user_id uuid, overtime_approved_at timestamptz);
      create table public.audit_logs (user_id uuid, action text, entity_type text, entity_id uuid, description text);
      create function public.approve_entry_overtime(uuid, uuid)
        returns public.time_entries language sql security definer
        as 'select null::public.time_entries';
      grant execute on function public.approve_entry_overtime(uuid, uuid) to anon, authenticated;
    `);
    const privilege = role => sql(`select has_function_privilege('${role}', 'public.approve_entry_overtime(uuid,uuid)', 'EXECUTE');`);
    const publicExecute = () => sql(`select count(*) from pg_proc p,
      lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid='public.approve_entry_overtime(uuid,uuid)'::regprocedure
        and a.grantee=0 and a.privilege_type='EXECUTE';`);
    assert.equal(publicExecute(), '1', 'Fixture must start with the PUBLIC execute grant');
    sql(await readFile(new URL('../supabase/migrations/0031_overnight_overtime.sql', import.meta.url), 'utf8'));
    const cases = [
      ['17:00','02:00','2026-11-05 16:00+08','2026-11-06 03:00+08',3600],
      ['17:00','02:00','2026-11-05 17:00+08','2026-11-06 02:00+08',0],
      ['17:00','02:00','2026-11-05 17:00+08','2026-11-06 01:00+08',0],
      ['17:00','02:00','2026-11-06 01:00+08','2026-11-06 03:00+08',3600],
      ['17:00','02:00','2026-11-06 02:00+08','2026-11-06 03:00+08',3600],
      ['09:00','18:00','2026-11-05 08:00+08','2026-11-05 19:00+08',3600],
      ['09:00','18:00','2026-11-05 19:00+08','2026-11-05 20:00+08',3600],
      ['22:00','06:00','2026-12-31 22:00+08','2027-01-01 07:30+08',5400]
    ];
    for (const [start,end,clockIn,clockOut,expected] of cases) {
      const id='00000000-0000-4000-8000-000000000001';
      sql(`truncate public.time_entries, public.audit_logs;
        insert into public.time_entries(id,schedule_type,scheduled_start_time,scheduled_end_time,clock_in_at,clock_out_at) values ('${id}','FIXED','${start}','${end}','${clockIn}','${clockOut}');`);
      assert.equal(sql(`select (public.approve_entry_overtime('${id}','00000000-0000-4000-8000-000000000002')).overtime_approved_seconds;`),String(expected));
      assert.equal(sql('select count(*) from public.audit_logs;'),'1');
    }
    assert.equal(privilege('anon'), 'f');
    t.diagnostic('anon: EXECUTE denied');
    assert.equal(privilege('authenticated'), 'f');
    t.diagnostic('authenticated: EXECUTE denied');
    assert.equal(privilege('service_role'), 't');
    t.diagnostic('service_role: EXECUTE allowed');
    // PUBLIC is a pseudo-role, not a role name accepted by has_function_privilege.
    assert.equal(publicExecute(), '0');
    t.diagnostic('PUBLIC: EXECUTE denied (ACL grantee 0 absent)');
  } finally {
    if (started) run('pg_ctl', ['-D', data, '-w', '-t', '30', 'stop', '-m', 'immediate']);
    const resolved = await realpath(temporary);
    assert.equal(path.dirname(resolved), parent);
    assert.ok(path.basename(resolved).startsWith('ace-f01-'));
    await rm(resolved, { recursive: true, force: true });
  }
});
