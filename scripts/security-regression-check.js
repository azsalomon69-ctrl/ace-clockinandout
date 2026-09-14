import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await readFile(path.join(root, 'server', 'index.js'), 'utf8');
const frontendScript = await readFile(path.join(root, 'js', 'script.js'), 'utf8');
const schema = await readFile(path.join(root, 'supabase', 'schema.sql'), 'utf8');
const vercel = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
const htmlPages = await Promise.all((await readdir(root))
  .filter(file => file.endsWith('.html'))
  .map(file => readFile(path.join(root, file), 'utf8')));

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
assert.doesNotMatch(schema, /create policy "create own entries" on public\.time_entries/i, 'Time entries must not allow direct authenticated inserts');
assert.doesNotMatch(schema, /create policy "update own open entries" on public\.time_entries/i, 'Time entries must not allow direct authenticated updates');
const browserTimeEntryGrants = schema.split(';').filter(statement => /\bgrant\b[\s\S]*?\bon\s+public\.time_entries\b[\s\S]*?\bto\s+(?:anon|authenticated)\b/i.test(statement));
for (const grant of browserTimeEntryGrants) {
  assert.doesNotMatch(grant, /\b(insert|update|delete|truncate|references|trigger)\b/i, 'Time entries must not grant browser write privileges');
}

const headers = vercel.headers.flatMap(rule => rule.headers || []);
const header = key => headers.find(item => item.key === key)?.value || '';
assert.match(header('Content-Security-Policy'), /frame-ancestors 'none'/, 'Frontend framing must be blocked');
assert.equal(header('X-Frame-Options'), 'DENY', 'Legacy clickjacking protection must remain enabled');
assert.equal(header('X-Content-Type-Options'), 'nosniff', 'MIME sniffing must remain disabled');
assert.match(header('Strict-Transport-Security'), /max-age=/, 'HTTPS transport policy must remain enabled');
assert.doesNotMatch(header('Content-Security-Policy'), /script-src[^;]*'unsafe-inline'/, 'Scripts must not allow inline execution');
assert.doesNotMatch(header('Content-Security-Policy'), /cdn\.jsdelivr\.net/, 'The frontend must not permit jsDelivr scripts at runtime');
assert.doesNotMatch(frontendScript, /cdn\.jsdelivr\.net\/npm\/xlsx/, 'Excel exports must not load XLSX from jsDelivr at runtime');
for (const html of htmlPages) {
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'HTML must not use inline event handlers');
  assert.doesNotMatch(html, /cdn\.jsdelivr\.net/, 'HTML pages must not load scripts from jsDelivr');
  assert.doesNotMatch(html, /@supabase\/supabase-js@2/, 'HTML pages must use the local Supabase UMD bundle');
}

console.log('Security regression checks passed.');
