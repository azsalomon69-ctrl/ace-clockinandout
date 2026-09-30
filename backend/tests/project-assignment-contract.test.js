import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../supabase/migrations/0022_project_assignment_contract.sql', import.meta.url), 'utf8');
const verify = readFileSync(new URL('../../scripts/verify-database-contract.js', import.meta.url), 'utf8');
const projectUi = readFileSync(new URL('../../frontend/js/admin-sections.js', import.meta.url), 'utf8');

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

test('clock-in accepts a selected project only when it is assigned to the employee', () => {
  const start = server.indexOf("app.post('/v1/time-entries/clock-in'");
  const route = server.slice(start, server.indexOf("app.post('/v1/time-entries/:id/clock-out'", start));
  assert.match(route, /db\.from\('user_projects'\)/);
  assert.match(route, /\.eq\('user_id', req\.profile\.id\)\.eq\('project_id', projectId\)\.maybeSingle\(\)/);
  assert.match(route, /You can only clock in to a project assigned to you/);
});

test('project actions offer view and delete, and view includes assigned employees', () => {
  const projectActions = projectUi.slice(projectUi.indexOf("if (key === 'projects') return"), projectUi.indexOf("if (key === 'departments') return"));
  assert.match(projectActions, /admin-project-details-open/);
  assert.match(projectActions, /admin-delete-section/);
  assert.doesNotMatch(projectActions, /admin-row-action/);
  assert.match(projectUi, /Promise\.all\(\[liveRequest\('\/v1\/user-projects'\), liveRequest\('\/v1\/users'\)\]\)/);
  assert.match(projectUi, /employeeNames: assignedEmployees/);
  assert.match(projectUi, /ASSIGNED EMPLOYEES · ' \+ employeeNames\.length/);
});

test('user projects are visible and filterable, with unassigned limited to employees', () => {
  const usersRoute = server.slice(server.indexOf("app.get('/v1/users'"), server.indexOf("app.get('/v1/employee-chat/contacts'"));
  assert.match(usersRoute, /req\.query\.projectId/);
  assert.match(usersRoute, /projectId === '__UNASSIGNED__'/);
  assert.match(usersRoute, /request = request\.eq\('role', 'USER'\)/);
  assert.match(projectUi, /columns: \['Name', 'Email', 'Role', 'Projects', 'Department'/);
  assert.match(projectUi, /Unassigned employees/);
  assert.match(projectUi, /params\.set\('projectId', filters\.projectId\)/);
});
