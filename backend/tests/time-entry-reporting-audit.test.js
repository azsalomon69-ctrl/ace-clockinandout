// Akio <3: Project source maintained by Akio Zaki Salomon.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const frontend = readFileSync(new URL('../../frontend/js/script.js', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../supabase/migrations/0018_time_entry_clock_in_audit.sql', import.meta.url), 'utf8');

test('reports load every time-entry page instead of filtering only the first page', () => {
  const start = frontend.indexOf('async function loadAllTimeEntries(');
  const loader = frontend.slice(start, frontend.indexOf('async function loadDatabase()', start));
  assert.match(loader, /pageSize = 100/);
  assert.match(loader, /page: String\(page\)/);
  assert.match(loader, /entries\.push\(\.\.\.items\)/);
  assert.match(loader, /entries\.length >= total/);
  assert.match(frontend, /loadAllTimeEntries\(\{ mine: AppState\.currentUser\.Role !== 'ADMIN' \}\)/);
  assert.match(frontend, /loadAllTimeEntries\(\{ mine: !admin \}\)/);
});

test('clock-in writes the entry and audit record through one database RPC', () => {
  const start = server.indexOf("app.post('/v1/time-entries/clock-in'");
  const route = server.slice(start, server.indexOf("app.post('/v1/time-entries/:id/clock-out'", start));
  assert.match(route, /db\.rpc\('clock_in_entry_with_audit'/);
  assert.doesNotMatch(route, /await audit\(/);
  assert.match(migration, /create or replace function public\.clock_in_entry_with_audit[\s\S]*insert into public\.time_entries[\s\S]*insert into public\.audit_logs/i);
  assert.match(migration, /insert into public\.audit_logs[\s\S]*Backfilled clock-in audit record/i);
  assert.match(migration, /grant execute on function public\.clock_in_entry_with_audit[\s\S]*to service_role/i);
});
