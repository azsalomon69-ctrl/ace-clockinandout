// Akio <3: Project source maintained by Akio Salomon.
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// .env.test is intentionally ignored by Git. Environment variables already
// supplied by secure CI secret storage continue to take precedence.
dotenv.config({ path: '.env.test', quiet: true, override: false });

const required = [
  'ACE_TEST_API_URL', 'ACE_TEST_SUPABASE_URL', 'ACE_TEST_SUPABASE_PUBLISHABLE_KEY',
  'ACE_TEST_ADMIN_EMAIL', 'ACE_TEST_ADMIN_PASSWORD',
  'ACE_TEST_USER_EMAIL', 'ACE_TEST_USER_PASSWORD'
];
const missing = required.filter(name => !process.env[name]);
if (missing.length) {
  throw new Error(`Missing staging test configuration: ${missing.join(', ')}. Copy .env.test.example; never use production credentials.`);
}

const apiUrl = process.env.ACE_TEST_API_URL.replace(/\/$/, '');
if (!/^https:\/\//.test(apiUrl) || /ace-clockinandout\.onrender\.com/i.test(apiUrl)) {
  throw new Error('ACE_TEST_API_URL must be an HTTPS staging API URL, not the production API.');
}
const testName = value => value.replace(/(password|token|secret|cookie|authorization|email)/ig, '[redacted]');
const results = [];

async function signIn(email, password) {
  const client = createClient(process.env.ACE_TEST_SUPABASE_URL, process.env.ACE_TEST_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token) throw new Error('Staging test sign-in failed. Check the dedicated test account configuration.');
  return { client, token: data.session.access_token };
}

async function request(label, path, { token, method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const payload = await response.json().catch(() => null);
  results.push({ label: testName(label), status: response.status });
  return { response, payload };
}

async function expectStatus(label, path, expected, options) {
  const { response, payload } = await request(label, path, options);
  assert.equal(response.status, expected, `${label}: expected ${expected}, received ${response.status}${payload?.error ? ` (${payload.error})` : ''}`);
  return payload;
}

const adminReadRoutes = [
  '/v1/users',
  '/v1/invitations',
  '/v1/reports',
  '/v1/audit-logs',
  '/v1/time-leaderboard',
  '/v1/schedules',
  '/v1/access-requests'
];

const admin = await signIn(process.env.ACE_TEST_ADMIN_EMAIL, process.env.ACE_TEST_ADMIN_PASSWORD);
const user = await signIn(process.env.ACE_TEST_USER_EMAIL, process.env.ACE_TEST_USER_PASSWORD);

// A fresh /v1/me call proves the supplied credentials have their intended
// server-side role; no role value from this process is trusted by the API.
const adminProfile = await expectStatus('admin identity', '/v1/me', 200, { token: admin.token });
const userProfile = await expectStatus('user identity', '/v1/me', 200, { token: user.token });
assert.equal(adminProfile.profile.role, 'ADMIN', 'ACE_TEST_ADMIN_EMAIL must belong to an ACTIVE ADMIN account.');
assert.equal(userProfile.profile.role, 'USER', 'ACE_TEST_USER_EMAIL must belong to an ACTIVE USER account.');

for (const route of adminReadRoutes) {
  await expectStatus(`unauthenticated ${route}`, route, 401);
  await expectStatus(`user denied ${route}`, route, 403, { token: user.token });
  await expectStatus(`admin allowed ${route}`, route, 200, { token: admin.token });
}

// The server cannot read a browser's localStorage. This request is the
// integration equivalent: it sends an attacker-controlled ADMIN claim/header
// with a real USER bearer token and must still be denied.
await expectStatus('forged client ADMIN role denied', '/v1/users', 403, {
  token: user.token,
  headers: { 'X-Client-Role': 'ADMIN' }
});
await expectStatus('invalid bearer token rejected', '/v1/users', 401, {
  token: 'not-a-valid-supabase-token'
});

if (process.env.ACE_TEST_INACTIVE_USER_EMAIL && process.env.ACE_TEST_INACTIVE_USER_PASSWORD) {
  const inactive = await signIn(process.env.ACE_TEST_INACTIVE_USER_EMAIL, process.env.ACE_TEST_INACTIVE_USER_PASSWORD);
  await expectStatus('inactive user denied protected data', '/v1/departments', 403, { token: inactive.token });
  await inactive.client.auth.signOut();
}

const fixtureUserId = process.env.ACE_TEST_USER_ID;
const fixtureProjectId = process.env.ACE_TEST_PROJECT_ID;
const fixtureTimeEntryId = process.env.ACE_TEST_TIME_ENTRY_ID;
if (fixtureUserId) {
  await expectStatus('user role-escalation body denied', `/v1/users/${fixtureUserId}/role`, 403, {
    token: user.token, method: 'PATCH', body: { role: 'ADMIN' }
  });
  await expectStatus('user IDOR profile mutation denied', `/v1/users/${fixtureUserId}/department`, 403, {
    token: user.token, method: 'PATCH', body: { departmentId: null }
  });
}
if (fixtureUserId && fixtureProjectId) {
  await expectStatus('user IDOR project assignment denied', `/v1/users/${fixtureUserId}/projects/${fixtureProjectId}`, 403, {
    token: user.token, method: 'PUT'
  });
}
if (fixtureTimeEntryId) {
  await expectStatus('user admin time correction denied', `/v1/time-entries/${fixtureTimeEntryId}/admin-time`, 403, {
    token: user.token, method: 'PATCH', body: { clockInAt: '2026-01-01T09:00:00.000Z', clockOutAt: '2026-01-01T10:00:00.000Z' }
  });
}

// Mutation checks are intentionally opt-in: they alter isolated staging
// fixtures and must never run against a real workforce environment.
if (process.env.ACE_TEST_RUN_MUTATIONS === 'true') {
  assert.ok(fixtureUserId, 'ACE_TEST_USER_ID is required when mutations are enabled.');
  assert.ok(fixtureProjectId, 'ACE_TEST_PROJECT_ID is required when mutations are enabled.');
  await expectStatus('admin project assignment allowed', `/v1/users/${fixtureUserId}/projects/${fixtureProjectId}`, 200, { token: admin.token, method: 'PUT' });
  await expectStatus('admin project assignment cleanup', `/v1/users/${fixtureUserId}/projects/${fixtureProjectId}`, 204, { token: admin.token, method: 'DELETE' });
  if (fixtureTimeEntryId) {
    await expectStatus('admin remark allowed', `/v1/time-entries/${fixtureTimeEntryId}/remarks`, 201, { token: admin.token, method: 'POST', body: { remark: 'Automated staging security test.' } });
  }

  // The fixture employee supplies a known department. Compare the persisted
  // count to all time entries belonging to users in that department, without
  // adding a user filter that could mask a missing department filter.
  const users = await expectStatus('admin users for department report fixture', '/v1/users', 200, { token: admin.token });
  const fixtureUser = users.find(profile => profile.id === fixtureUserId);
  assert.ok(fixtureUser?.department_id, 'ACE_TEST_USER_ID must belong to an employee assigned to a department.');
  const dateFrom = '2000-01-01';
  const dateTo = '2100-12-31';
  const [activeEntries, removedEntries] = await Promise.all([
    expectStatus('active time entries for department report fixture', '/v1/time-entries', 200, { token: admin.token }),
    expectStatus('removed time entries for department report fixture', '/v1/time-entries?removed=true', 200, { token: admin.token })
  ]);
  const departmentUserIds = new Set(users.filter(profile => profile.department_id === fixtureUser.department_id).map(profile => profile.id));
  const expectedCount = [...activeEntries, ...removedEntries].filter(entry => departmentUserIds.has(entry.user_id) && entry.clock_in_at >= `${dateFrom}T00:00:00Z` && entry.clock_in_at <= `${dateTo}T23:59:59Z`).length;
  const report = await expectStatus('department-filtered report count', '/v1/reports', 201, {
    token: admin.token,
    method: 'POST',
    body: { reportType: 'CUSTOM', dateFrom, dateTo, filters: { departmentId: fixtureUser.department_id } }
  });
  assert.equal(report.total_records, expectedCount, 'Department-filtered report total_records must equal matching time-entry count.');
  await expectStatus('department-filtered report cleanup', `/v1/reports/${report.id}`, 200, { token: admin.token, method: 'DELETE' });
}

if (process.env.ACE_TEST_HEAD_ADMIN_EMAIL && process.env.ACE_TEST_HEAD_ADMIN_PASSWORD) {
  const headAdmin = await signIn(process.env.ACE_TEST_HEAD_ADMIN_EMAIL, process.env.ACE_TEST_HEAD_ADMIN_PASSWORD);
  await expectStatus('head admin chat log allowed', '/v1/admin/chat-log', 200, { token: headAdmin.token });
} else {
  await expectStatus('ordinary admin chat log denied', '/v1/admin/chat-log', 403, { token: admin.token });
}

await Promise.allSettled([admin.client.auth.signOut(), user.client.auth.signOut()]);
console.log(`Security integration checks passed: ${results.length}. Status codes: ${results.map(result => result.status).join(', ')}.`);
