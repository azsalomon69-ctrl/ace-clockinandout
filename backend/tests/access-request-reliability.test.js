import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../supabase/migrations/0013_access_request_atomic_audit.sql', import.meta.url), 'utf8');

test('access-request submission relies on a transactional database audit trigger', () => {
  assert.match(migration, /create trigger access_requests_audit[\s\S]*after insert or update on public\.access_requests/i);
  assert.match(migration, /v_action := 'REQUEST_ACCESS'[\s\S]*insert into public\.audit_logs/i);
  const route = server.slice(server.indexOf("app.post('/v1/access-requests'"), server.indexOf("app.get('/v1/access-requests'"));
  assert.doesNotMatch(route, /await audit\(/, 'the API must not create a separate best-effort audit write');
});

test('access-request approval changes account state through the atomic RPC', () => {
  const route = server.slice(server.indexOf("app.patch('/v1/access-requests/:id'"), server.indexOf("app.get('/v1/departments'"));
  assert.match(route, /db\.rpc\('review_access_request'/);
  assert.doesNotMatch(route, /from\('profiles'\)\.update/, 'profile state belongs inside the review transaction');
  assert.match(migration, /update public\.profiles[\s\S]*update public\.access_requests[\s\S]*return v_request/i);
});

test('concurrent pending access requests are serialized at the database boundary', () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /ACCESS_REQUEST_ALREADY_PENDING/);
});
