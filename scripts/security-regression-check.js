import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await readFile(path.join(root, 'server', 'index.js'), 'utf8');
const vercel = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));

const requiredAdminRoutes = [
  '/v1/users', '/v1/invitations', '/v1/reports', '/v1/audit-logs',
  '/v1/time-leaderboard', '/v1/schedules', '/v1/access-requests'
];
for (const route of requiredAdminRoutes) {
  assert.match(server, new RegExp(`app\\.(get|post|put|patch|delete)\\('${route.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}[^']*', authenticate, (adminOnly|specialAdminOnly)`), `${route} must keep server-side administrator authorization`);
}

assert.match(server, /db\.auth\.getUser\(token\)/, 'Bearer tokens must be validated by Supabase on the server');
assert.match(server, /permanently_deleted_at', null/, 'Deleted accounts must not authenticate');
assert.match(server, /req\.profile\.status === 'ACTIVE'/, 'Account status must be checked server-side');
assert.doesNotMatch(server, /update\(\{\s*\.\.\.req\.body/, 'Do not mass-assign request bodies to database records');
assert.match(server, /limit: 600/, 'API rate limiting must remain enabled');
assert.match(server, /limit: 30/, 'Sensitive-action rate limiting must remain enabled');

const headers = vercel.headers.flatMap(rule => rule.headers || []);
const header = key => headers.find(item => item.key === key)?.value || '';
assert.match(header('Content-Security-Policy'), /frame-ancestors 'none'/, 'Frontend framing must be blocked');
assert.equal(header('X-Frame-Options'), 'DENY', 'Legacy clickjacking protection must remain enabled');
assert.equal(header('X-Content-Type-Options'), 'nosniff', 'MIME sniffing must remain disabled');
assert.match(header('Strict-Transport-Security'), /max-age=/, 'HTTPS transport policy must remain enabled');

console.log('Security regression checks passed.');
