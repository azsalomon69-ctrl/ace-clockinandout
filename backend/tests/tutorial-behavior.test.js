import assert from 'node:assert/strict';
import test from 'node:test';
import { tutorialBackend } from './helpers/tutorial-backend.mjs';

for (const role of ['USER', 'ADMIN']) for (const code of ['PGRST205', '42P01', '42501']) {
  test(`Startup ${role}: unavailable tutorial storage (${code}) cannot block the profile`, async () => {
    const backend = tutorialBackend({ role, status: 'COMPLETED', tutorialError: { code, message: 'Tutorial table unavailable' } });
    const before = structuredClone(backend.tables);
    const result = await backend.request('GET', '/v1/me');
    assert.equal(result.code, 200);
    assert.equal(result.body.profile.id, 'fixture-user');
    assert.equal(result.body.profile.role, role);
    assert.equal(result.body.profile.status, 'ACTIVE');
    assert.equal(result.body.profile.tutorial_status, 'COMPLETED');
    assert.deepEqual(backend.tables, before, 'Startup must not write or migrate data');
  });
}

for (const role of ['USER', 'ADMIN']) test(`B5 ${role}: immediate profile read observes saved tutorial step`, async () => {
  const backend = tutorialBackend({ role, status: 'IN_PROGRESS', step: 1 });
  await backend.request('GET', '/v1/me');
  const saved = await backend.request('PATCH', '/v1/me/tutorial', { status: 'IN_PROGRESS', step: 2, version: role === 'USER' ? 9 : 18 });
  assert.equal(saved.code, 200);
  assert.equal(saved.body.profile.tutorial_step, 2);
  const read = await backend.request('GET', '/v1/me');
  assert.equal(read.body.profile.tutorial_step, 2, 'GET must return step 2 immediately after PATCH, not cached step 1');
});

test('B4: promotion starts ADMIN independently and preserves completed USER progress', async () => {
  const backend = tutorialBackend({ cache: false });
  await backend.request('PATCH', '/v1/me/tutorial', { status: 'COMPLETED', step: 10, version: 10 });
  backend.promote('ADMIN');
  assert.equal((await backend.request('GET', '/v1/me')).body.profile.tutorial_status, 'NOT_STARTED', 'ADMIN must not inherit USER completion');
  await backend.request('PATCH', '/v1/me/tutorial', { status: 'SKIPPED', step: 0, version: 19, role: 'USER' });
  backend.promote('USER');
  const employee = (await backend.request('GET', '/v1/me')).body.profile;
  assert.equal(employee.tutorial_status, 'COMPLETED', 'ADMIN skip must not overwrite USER completion');
  assert.equal(employee.tutorial_step, 10);
  backend.promote('ADMIN');
  assert.equal((await backend.request('GET', '/v1/me')).body.profile.tutorial_status, 'SKIPPED');
});

test('D3: role timestamps, reset, and legacy snapshot stay independent', async () => {
  const backend = tutorialBackend();
  const legacy = structuredClone(backend.tables.profiles[0]);
  const write = (status, step = 0) => backend.request('PATCH', '/v1/me/tutorial', { status, step, version: 10 });
  const started = (await write('IN_PROGRESS')).body.profile.tutorial_started_at;
  assert.ok(started);
  assert.equal((await write('IN_PROGRESS', 1)).body.profile.tutorial_started_at, started);
  const completed = (await write('COMPLETED', 10)).body.profile;
  backend.promote('ADMIN');
  const fresh = (await backend.request('GET', '/v1/me')).body.profile;
  assert.equal(fresh.tutorial_status, 'NOT_STARTED');
  assert.equal(fresh.tutorial_started_at, null);
  assert.equal(fresh.tutorial_completed_at, null);
  await write('SKIPPED');
  const reset = (await write('NOT_STARTED')).body.profile;
  assert.equal(reset.tutorial_skipped_at, null);
  backend.promote('USER');
  const restored = (await backend.request('GET', '/v1/me')).body.profile;
  assert.equal(restored.tutorial_completed_at, completed.tutorial_completed_at);
  assert.equal(restored.tutorial_started_at, started);
  assert.deepEqual(backend.tables.profiles[0], legacy);
});
