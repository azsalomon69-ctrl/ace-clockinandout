// Akio <3: Project source maintained by Akio Zaki Salomon.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSingleFlight } from '../server/single-flight.js';

test('single-flight shares concurrent work but never caches completed authorization', async () => {
  const run = createSingleFlight();
  let release;
  let calls = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const first = run('token', async () => { calls += 1; return pending; });
  const second = run('token', async () => { calls += 1; return 'duplicate'; });
  await Promise.resolve();
  assert.equal(calls, 1);
  release('verified');
  assert.deepEqual(await Promise.all([first, second]), ['verified', 'verified']);
  assert.equal(await run('token', async () => { calls += 1; return 'rechecked'; }), 'rechecked');
  assert.equal(calls, 2);
});

test('single-flight releases failed work so a later request can retry', async () => {
  const run = createSingleFlight();
  await assert.rejects(run('token', async () => { throw new Error('temporary failure'); }), /temporary failure/);
  assert.equal(await run('token', async () => 'recovered'), 'recovered');
});
