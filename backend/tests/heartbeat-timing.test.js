// Akio <3: Project source maintained by Akio Zaki Salomon.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { flushPresenceBatch, isPresenceOnline, presenceFlushIntervalMs, presenceWindowMs, queuePresenceForActiveSession } from '../server/presence.js';

const serverSource = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const frontendSource = readFileSync(new URL('../../frontend/js/script.js', import.meta.url), 'utf8');
const migrationSource = readFileSync(new URL('../../supabase/migrations/0028_presence_freshness.sql', import.meta.url), 'utf8');

function getFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const openingBrace = source.indexOf('{', start);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not find the end of ${name}`);
}

test('delayed batch flush persists each actual heartbeat timestamp in one bulk write', async () => {
  const heartbeatAt = Date.parse('2026-10-16T01:00:00.000Z');
  const pending = new Map([
    ['employee-a', { heartbeatAt, sessionId: 'session-a' }],
    ['employee-b', { heartbeatAt: heartbeatAt + 120_000, sessionId: 'session-b' }]
  ]);
  let writes = 0;
  const count = await flushPresenceBatch(pending, undefined, async rows => {
    writes += 1;
    assert.deepEqual(rows, [
      { user_id: 'employee-a', session_id: 'session-a', last_seen_at: '2026-10-16T01:00:00.000Z' },
      { user_id: 'employee-b', session_id: 'session-b', last_seen_at: '2026-10-16T01:02:00.000Z' }
    ]);
    return 2;
  });
  assert.equal(writes, 1, 'a batch remains one database request');
  assert.equal(count, 2);
  assert.equal(pending.size, 0);
});

test('a closed browser is not kept online by a later flush timestamp', async () => {
  const heartbeatAt = Date.parse('2026-10-16T01:00:00.000Z');
  const pending = new Map([['employee-a', { heartbeatAt, sessionId: 'session-a' }]]);
  let writtenHeartbeat;
  await flushPresenceBatch(pending, undefined, async ([row]) => { writtenHeartbeat = row.last_seen_at; return 1; });
  const flushAt = heartbeatAt + 5 * 60_000;
  assert.equal(Date.parse(writtenHeartbeat), heartbeatAt);
  assert.equal(isPresenceOnline(writtenHeartbeat, null, flushAt), false, 'five minutes since the browser heartbeat exceeds the four-minute online window');
});

test('independent heartbeat and flush timers stay online with offset phases and delayed delivery', async () => {
  let heartbeatIntervalMs;
  vm.runInNewContext(`(${getFunction(frontendSource, 'startPresenceHeartbeat')})`, {
    AppState: {}, Date, document: { visibilityState: 'hidden', addEventListener() {} },
    window: { setInterval(_callback, delay) { heartbeatIntervalMs = delay; return 1; } },
    stopPresenceHeartbeat() {}
  })();
  assert.equal(heartbeatIntervalMs, 120_000);
  assert.equal(presenceWindowMs - heartbeatIntervalMs - presenceFlushIntervalMs, 30_000);
  // Model every second, rather than checking only aligned minute boundaries.
  // Heartbeat timestamps remain their request times, even with delayed arrival.
  for (const deliveryDelay of [0, 10_000]) {
    for (let phase = 0; phase < presenceFlushIntervalMs; phase += 5_000) {
      const pending = new Map();
      let persisted = new Date(0).toISOString(); // Initial session-start write.
      for (let now = 0; now <= 20 * 60_000; now += 1_000) {
        if (now >= deliveryDelay && (now - deliveryDelay) % heartbeatIntervalMs === 0) {
          pending.set('employee', { heartbeatAt: now - deliveryDelay, sessionId: 'session' });
        }
        // Also allow ten seconds of delay before each scheduled flush runs.
        if (now >= phase + deliveryDelay && (now - phase - deliveryDelay) % presenceFlushIntervalMs === 0) {
          await flushPresenceBatch(pending, undefined, async ([row]) => { persisted = row.last_seen_at; return 1; });
        }
        assert.equal(isPresenceOnline(persisted, null, now), true,
          `online at ${now}ms with flush phase ${phase}ms and delay ${deliveryDelay}ms`);
      }
    }
  }
});
