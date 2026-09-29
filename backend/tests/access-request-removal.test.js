// Akio <3: Project source maintained by Akio Zaki Salomon.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../../frontend/js/script.js', import.meta.url), 'utf8');
const login = readFileSync(new URL('../../frontend/login.html', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8');
const removalMigration = readFileSync(new URL('../../supabase/migrations/0020_remove_access_request_flow.sql', import.meta.url), 'utf8');

test('workspace access is administrator-invitation-only', () => {
  assert.doesNotMatch(server, /\/v1\/access-requests/, 'The API must not expose a self-service access-request route');
  assert.doesNotMatch(shell, /access-requests\.html/, 'Navigation and notifications must not link to a retired access-request page');
  assert.doesNotMatch(login, /requestAccess/i, 'The sign-in page must not offer a self-service request form');
  assert.doesNotMatch(schema, /create table public\.access_requests/i, 'New databases must not create the retired table');
  assert.equal(existsSync(new URL('../../frontend/access-requests.html', import.meta.url)), false, 'The retired page must not be shipped');
  assert.match(removalMigration, /drop table if exists public\.access_requests/i, 'Existing databases must remove the retired table through a forward migration');
  assert.match(removalMigration, /drop function if exists public\.submit_access_request/i, 'Existing request RPCs must be removed');
  assert.match(removalMigration, /Historical audit_logs rows are retained/i, 'Historical audit evidence must remain intact');
});
