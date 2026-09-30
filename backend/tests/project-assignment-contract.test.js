import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../supabase/migrations/0022_project_assignment_contract.sql', import.meta.url), 'utf8');
const verify = readFileSync(new URL('../../scripts/verify-database-contract.js', import.meta.url), 'utf8');

test('project assignments require an active employee and active project', () => {
  const route = server.slice(server.indexOf("app.put('/v1/users/:id/projects/:projectId'"), server.indexOf("app.delete('/v1/users/:id/projects/:projectId'"));
  assert.match(route, /target\.role !== 'USER' \|\| target\.status !== 'ACTIVE'/);
  assert.match(route, /\.eq\('is_active', true\)/);
  assert.match(route, /onConflict: 'user_id,project_id'/);
});

test('project assignment schema is repaired and verified during deployment', () => {
  assert.match(migration, /create table if not exists public\.user_projects/i);
  assert.match(migration, /primary key \(user_id, project_id\)/i);
  assert.match(migration, /delete from public\.user_projects duplicate/i);
  assert.match(verify, /project assignments table/);
});
