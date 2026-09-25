import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../supabase/migrations/0014_transactional_lifecycle_audit_and_request_ids.sql', import.meta.url), 'utf8');

const route = (start, end) => server.slice(server.indexOf(start), server.indexOf(end, server.indexOf(start)));

test('lifecycle state and immutable audit evidence share a server-only RPC', () => {
  assert.match(migration, /create or replace function public\.admin_update_profile_with_audit[\s\S]*update public\.profiles[\s\S]*insert into public\.audit_logs/i);
  assert.match(migration, /revoke all on function public\.admin_update_profile_with_audit[\s\S]*grant execute[\s\S]*to service_role/i);
  for (const [start, end] of [
    ["app.patch('/v1/users/:id/approval'", "app.patch('/v1/users/:id/role'"],
    ["app.patch('/v1/users/:id/role'", "app.patch('/v1/users/:id/department'"],
    ["app.patch('/v1/users/:id/remove'", "app.patch('/v1/users/:id/restore'"],
    ["app.patch('/v1/users/:id/restore'", "app.delete('/v1/users/:id/permanent'"]
  ]) {
    const handler = route(start, end);
    assert.match(handler, start.includes('/approval') ? /db\.rpc\('change_user_status_with_audit'/ : start.includes('/role') ? /db\.rpc\('change_user_role_with_audit'/ : /db\.rpc\('admin_update_profile_with_audit'/);
    assert.doesNotMatch(handler, /await audit\(/);
  }
});

test('destructive time-entry operations use one atomic RPC and preserve permanent-delete context', () => {
  assert.match(migration, /create or replace function public\.archive_time_entry_with_audit[\s\S]*delete from public\.time_entries[\s\S]*insert into public\.audit_logs/i);
  assert.match(migration, /Permanently deleted archived time entry for user %s/);
  const handler = route("app.delete('/v1/time-entries/:id'", "app.post('/v1/reports'");
  assert.match(handler, /db\.rpc\('archive_time_entry_with_audit'/);
  assert.doesNotMatch(handler, /await audit\(/);
});

test('permanent login removal records audit before deleting the auth identity', () => {
  assert.match(migration, /update public\.profiles set permanently_deleted_at[\s\S]*insert into public\.audit_logs[\s\S]*delete from auth\.users/i);
  assert.match(migration, /Permanently deleted archived user %s/);
});

test('archive and restore update Auth ban state, profile status, and audit evidence in one RPC', () => {
  const migration = readFileSync(new URL('../../supabase/migrations/0015_atomic_archive_restore_auth_state.sql', import.meta.url), 'utf8');
  assert.match(migration, /security definer[\s\S]*set search_path = public, auth/i);
  assert.match(migration, /when 'ARCHIVE_USER'[\s\S]*update auth\.users set banned_until[\s\S]*update public\.profiles[\s\S]*insert into public\.audit_logs/i);
  assert.match(migration, /when 'RESTORE_USER'[\s\S]*update auth\.users set banned_until = null[\s\S]*update public\.profiles[\s\S]*insert into public\.audit_logs/i);
  const archiveRoute = route("app.patch('/v1/users/:id/remove'", "app.patch('/v1/users/:id/restore'");
  const restoreRoute = route("app.patch('/v1/users/:id/restore'", "app.delete('/v1/users/:id/permanent'");
  assert.doesNotMatch(archiveRoute + restoreRoute, /auth\.admin\.updateUserById/);
});

test('status changes are atomic and repeated target status does not duplicate audit evidence', () => {
  const migration = readFileSync(new URL('../../supabase/migrations/0016_idempotent_user_status_audit.sql', import.meta.url), 'utf8');
  assert.match(migration, /create or replace function public\.change_user_status_with_audit[\s\S]*update public\.profiles[\s\S]*insert into public\.audit_logs/i);
  assert.match(migration, /if v_target\.status = p_status then return v_target; end if/i);
  assert.match(migration, /revoke all on function public\.change_user_status_with_audit[\s\S]*grant execute[\s\S]*to service_role/i);
  const statusRoute = route("app.patch('/v1/users/:id/approval'", "app.patch('/v1/users/:id/role'");
  assert.match(statusRoute, /db\.rpc\('change_user_status_with_audit'/);
  assert.doesNotMatch(statusRoute, /await audit\(/);
  assert.doesNotMatch(statusRoute, /auth\.admin/);
});

test('role changes are atomic and repeated target role does not duplicate audit evidence', () => {
  const migration = readFileSync(new URL('../../supabase/migrations/0017_idempotent_user_role_audit.sql', import.meta.url), 'utf8');
  assert.match(migration, /create or replace function public\.change_user_role_with_audit[\s\S]*update public\.profiles[\s\S]*insert into public\.audit_logs/i);
  assert.match(migration, /if v_target\.role = p_role then return v_target; end if/i);
  assert.match(migration, /revoke all on function public\.change_user_role_with_audit[\s\S]*grant execute[\s\S]*to service_role/i);
  const roleRoute = route("app.patch('/v1/users/:id/role'", "app.patch('/v1/users/:id/department'");
  assert.match(roleRoute, /db\.rpc\('change_user_role_with_audit'/);
  assert.doesNotMatch(roleRoute, /await audit\(/);
});

test('request IDs are UUID-only, returned to callers, logged, and stored without credentials', () => {
  assert.match(server, /req\.requestId = isUuid\(supplied\) \? supplied\.toLowerCase\(\) : randomUUID\(\)/);
  assert.match(server, /res\.set\('X-Request-ID', req\.requestId\)/);
  assert.match(server, /request_id=:request-id/);
  assert.match(migration, /add column if not exists request_id uuid/);
  assert.match(server, /p_correlation_id: req\.requestId/);
  assert.match(server, /db\.rpc\('submit_access_request'/);
  assert.match(migration, /create (?:or replace )?function public\.submit_access_request[\s\S]*set_config\('ace\.request_id'/);
  assert.doesNotMatch(migration, /authorization|bearer|session_id/i);
});

test('time-entry export evidence is awaited and an audit failure is visible without blocking the export', () => {
  const frontend = readFileSync(new URL('../../frontend/js/admin-sections.js', import.meta.url), 'utf8');
  assert.match(frontend, /try \{ await liveRequest\('\/v1\/time-entry-exports'/);
  assert.match(frontend, /audit record could not be saved/i);
  const exportRoute = route("app.post('/v1/time-entry-exports'", "app.delete('/v1/reports/:id'");
  assert.match(exportRoute, /await query\(db\.from\('audit_logs'\)\.insert/);
  assert.doesNotMatch(exportRoute, /await audit\(/);
});
