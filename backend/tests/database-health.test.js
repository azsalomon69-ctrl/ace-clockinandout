import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const route = source.slice(source.indexOf("app.get('/health'"), source.indexOf("app.get('/v1/auth/config'"));

async function health(probe) {
  let handler;
  const result = { status: 200, headers: {} };
  const builder = {
    select(columns, options) { assert.equal(columns, 'id'); assert.equal(options.head, true); assert.equal(options.count, undefined); return this; },
    limit(rows) { assert.equal(rows, 1); return this; },
    abortSignal(signal) { return probe(signal); }
  };
  const context = {
    app: { get: (_path, callback) => { handler = callback; } },
    db: { from: table => { assert.equal(table, 'profiles'); return builder; } },
    AbortSignal: { timeout(ms) {
      assert.equal(ms, 3500);
      const controller = new AbortController();
      queueMicrotask(() => controller.abort());
      return controller.signal;
    } },
    console: { error() {} }
  };
  vm.runInNewContext(route, context);
  await handler({}, {
    set(key, value) { result.headers[key] = value; },
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; }
  });
  return result;
}

test('health checks connectivity without an exact count or cached responses', async () => {
  const response = await health(async () => ({ error: null }));
  assert.equal(response.status, 200);
  assert.equal(response.body.database, 'connected');
  assert.equal(response.headers['Cache-Control'], 'no-store');
});

test('a stalled database request is aborted and reported unavailable', async () => {
  const response = await health(signal => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  assert.equal(response.status, 503);
  assert.equal(response.body.database, 'unavailable');
});

test('a database error returns 503 without leaking provider details', async () => {
  const response = await health(async () => ({ error: new Error('private upstream details') }));
  assert.equal(response.status, 503);
  assert.equal(response.body.ok, false);
  assert.doesNotMatch(JSON.stringify(response.body), /private upstream details/);
});
