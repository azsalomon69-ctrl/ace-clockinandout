import assert from 'node:assert/strict';
import test from 'node:test';
import { tutorialBackend } from './helpers/tutorial-backend.mjs';

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
