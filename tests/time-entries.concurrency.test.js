import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// This test creates and closes staging-only time entries. It is intentionally
// not part of the normal test command until the separate concurrency harness
// task adds an explicit, staging-only npm script.
dotenv.config({ path: '.env.test', quiet: true, override: false });

const required = [
  'ACE_TEST_API_URL', 'ACE_TEST_SUPABASE_URL', 'ACE_TEST_SUPABASE_PUBLISHABLE_KEY',
  'ACE_TEST_ADMIN_EMAIL', 'ACE_TEST_ADMIN_PASSWORD',
  'ACE_TEST_USER_EMAIL', 'ACE_TEST_USER_PASSWORD'
];
const missing = required.filter(name => !process.env[name]);
if (missing.length) throw new Error(`Missing staging test configuration: ${missing.join(', ')}`);

const apiUrl = process.env.ACE_TEST_API_URL.replace(/\/$/, '');
if (process.env.NODE_ENV === 'production' || !/^https:\/\//.test(apiUrl) || /ace-clockinandout\.onrender\.com/i.test(apiUrl)) {
  throw new Error('Concurrency tests require a non-production HTTPS staging API.');
}
if (process.env.ACE_TEST_RUN_CONCURRENCY !== 'true') {
  throw new Error('Set ACE_TEST_RUN_CONCURRENCY=true only for an isolated staging environment.');
}

async function signIn(email, password) {
  const client = createClient(process.env.ACE_TEST_SUPABASE_URL, process.env.ACE_TEST_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token) throw new Error('Staging test sign-in failed.');
  return { client, token: data.session.access_token };
}

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { response, body: await response.json().catch(() => null) };
}

async function expectStatus(path, expected, options) {
  const result = await request(path, options);
  assert.equal(result.response.status, expected, `${path}: expected ${expected}, received ${result.response.status}`);
  return result.body;
}

async function createOpenEntry(actor) {
  return expectStatus('/v1/time-entries/clock-in', 201, { token: actor.token, method: 'POST', body: { note: 'Concurrency staging test' } });
}

async function startBreak(actor, entryId) {
  await expectStatus(`/v1/time-entries/${entryId}/break/start`, 200, { token: actor.token, method: 'POST' });
}

async function auditsFor(admin, action, entryId) {
  const audits = await expectStatus('/v1/audit-logs', 200, { token: admin.token });
  return audits.filter(audit => audit.action === action && audit.entity_id === entryId);
}

async function closeForCleanup(admin, entryId) {
  const result = await request(`/v1/time-entries/${entryId}/clock-out`, { token: admin.token, method: 'POST', body: { note: 'Concurrency test cleanup' } });
  assert.ok([200, 409].includes(result.response.status), `Cleanup clock-out failed with ${result.response.status}`);
}

const admin = await signIn(process.env.ACE_TEST_ADMIN_EMAIL, process.env.ACE_TEST_ADMIN_PASSWORD);
const employee = await signIn(process.env.ACE_TEST_USER_EMAIL, process.env.ACE_TEST_USER_PASSWORD);
const adminProfile = await expectStatus('/v1/me', 200, { token: admin.token });
const employeeProfile = await expectStatus('/v1/me', 200, { token: employee.token });
assert.equal(adminProfile.profile.role, 'ADMIN');
assert.equal(employeeProfile.profile.role, 'USER');

try {
  // Employee may close their own entry.
  const ownEntry = await createOpenEntry(employee);
  await expectStatus(`/v1/time-entries/${ownEntry.id}/clock-out`, 200, { token: employee.token, method: 'POST', body: { note: 'Employee closes own entry' } });

  // Administrator retains cross-user clock-out authority and is the audit actor.
  const adminCloseEntry = await createOpenEntry(employee);
  await expectStatus(`/v1/time-entries/${adminCloseEntry.id}/clock-out`, 200, { token: admin.token, method: 'POST', body: { note: 'Admin closes employee entry' } });
  const adminCloseAudits = await auditsFor(admin, 'CLOCK_OUT (pc web)', adminCloseEntry.id);
  assert.equal(adminCloseAudits.length, 1, 'Admin clock-out must write one audit row.');
  assert.equal(adminCloseAudits[0].user_id, adminProfile.profile.id, 'Audit row must identify the acting administrator.');

  // An employee cannot close an administrator's entry and no audit is written.
  const adminEntry = await createOpenEntry(admin);
  const forbiddenClose = await request(`/v1/time-entries/${adminEntry.id}/clock-out`, { token: employee.token, method: 'POST', body: { note: 'Forbidden attempt' } });
  assert.equal(forbiddenClose.response.status, 404);
  assert.equal(forbiddenClose.body?.error, 'ENTRY_NOT_FOUND');
  assert.equal((await auditsFor(admin, 'CLOCK_OUT (pc web)', adminEntry.id)).length, 0);
  await closeForCleanup(admin, adminEntry.id);

  // Concurrent employee/admin close requests compete for one conditional update.
  const concurrentCloseEntry = await createOpenEntry(employee);
  const closeRequests = await Promise.all([
    request(`/v1/time-entries/${concurrentCloseEntry.id}/clock-out`, { token: employee.token, method: 'POST', body: { note: 'Concurrent employee close' } }),
    request(`/v1/time-entries/${concurrentCloseEntry.id}/clock-out`, { token: admin.token, method: 'POST', body: { note: 'Concurrent admin close' } })
  ]);
  assert.equal(closeRequests.filter(result => result.response.status === 200).length, 1);
  assert.equal(closeRequests.filter(result => result.response.status === 409 && result.body?.error === 'ENTRY_ALREADY_CLOSED').length, 1);
  assert.equal((await auditsFor(admin, 'CLOCK_OUT (pc web)', concurrentCloseEntry.id)).length, 1, 'Concurrent close must write one audit row.');

  // Employee may end their own break; an admin may end an employee break.
  const ownBreakEntry = await createOpenEntry(employee);
  await startBreak(employee, ownBreakEntry.id);
  await expectStatus(`/v1/time-entries/${ownBreakEntry.id}/break/end`, 200, { token: employee.token, method: 'POST' });
  await closeForCleanup(admin, ownBreakEntry.id);

  const adminBreakEntry = await createOpenEntry(employee);
  await startBreak(employee, adminBreakEntry.id);
  await expectStatus(`/v1/time-entries/${adminBreakEntry.id}/break/end`, 200, { token: admin.token, method: 'POST' });
  const adminBreakAudits = await auditsFor(admin, 'BREAK_END', adminBreakEntry.id);
  assert.equal(adminBreakAudits.length, 1);
  assert.equal(adminBreakAudits[0].user_id, adminProfile.profile.id);
  await closeForCleanup(admin, adminBreakEntry.id);

  // Employee cannot end a break belonging to an administrator.
  const adminBreak = await createOpenEntry(admin);
  await startBreak(admin, adminBreak.id);
  const forbiddenBreak = await request(`/v1/time-entries/${adminBreak.id}/break/end`, { token: employee.token, method: 'POST' });
  assert.equal(forbiddenBreak.response.status, 404);
  assert.equal(forbiddenBreak.body?.error, 'ENTRY_NOT_FOUND');
  assert.equal((await auditsFor(admin, 'BREAK_END', adminBreak.id)).length, 0);
  await closeForCleanup(admin, adminBreak.id);

  // Concurrent break-end requests must add elapsed seconds exactly once.
  const concurrentBreakEntry = await createOpenEntry(employee);
  await startBreak(employee, concurrentBreakEntry.id);
  const breakRequests = await Promise.all([
    request(`/v1/time-entries/${concurrentBreakEntry.id}/break/end`, { token: employee.token, method: 'POST' }),
    request(`/v1/time-entries/${concurrentBreakEntry.id}/break/end`, { token: admin.token, method: 'POST' })
  ]);
  assert.equal(breakRequests.filter(result => result.response.status === 200).length, 1);
  assert.equal(breakRequests.filter(result => result.response.status === 409 && result.body?.error === 'BREAK_NOT_ACTIVE').length, 1);
  const finishedBreak = breakRequests.find(result => result.response.status === 200).body;
  assert.equal(finishedBreak.break_started_at, null);
  assert.ok(Number.isInteger(finishedBreak.break_seconds) && finishedBreak.break_seconds >= 0);
  assert.equal((await auditsFor(admin, 'BREAK_END', concurrentBreakEntry.id)).length, 1, 'Concurrent break end must write one audit row.');
  await closeForCleanup(admin, concurrentBreakEntry.id);

  console.log('Time-entry concurrency checks passed.');
} finally {
  await Promise.allSettled([admin.client.auth.signOut(), employee.client.auth.signOut()]);
}
