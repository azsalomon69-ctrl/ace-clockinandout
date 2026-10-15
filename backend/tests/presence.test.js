// Akio <3: Project source maintained by Akio Zaki Salomon.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { countActiveEmployeeClockIns, flushPresenceBatch, isPresenceOnline, presenceFlushIntervalMs, presenceWindowMs, queuePresenceForActiveSession } from '../server/presence.js';

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

test('sign-out ends online presence without clocking out, and a later heartbeat restores it', () => {
  const signedOutAt = Date.parse('2026-10-16T02:00:00.000Z');
  const priorHeartbeat = new Date(signedOutAt - 30_000).toISOString();
  assert.equal(isPresenceOnline(priorHeartbeat, new Date(signedOutAt).toISOString(), signedOutAt + 1_000), false);
  const laterHeartbeat = new Date(signedOutAt + 60_000).toISOString();
  assert.equal(isPresenceOnline(laterHeartbeat, new Date(signedOutAt).toISOString(), signedOutAt + 61_000), true);

  const logoutRoute = serverSource.match(/app\.post\('\/v1\/auth\/session-end',[\s\S]*?\}\);/)?.[0] || '';
  assert.match(logoutRoute, /revokeToken\(req\.authTokenCacheKey\)/);
  assert.match(logoutRoute, /sessionSecurity\.end\(req\.profile\.id, req\.authSessionId, req\.requestId\)/);
  assert.doesNotMatch(logoutRoute, /queuePresence|flushPresence|clock_out_at|clockOut/i, 'logout does not enqueue an artificial heartbeat or mutate a time entry');
  assert.match(migrationSource, /profile\.last_logout_at is null or incoming\.last_seen_at > profile\.last_logout_at/i, 'a queued pre-logout batch cannot revive online status');
  assert.match(migrationSource, /for key share/i, 'presence flush serializes against the sign-out session-row lock');
  assert.match(migrationSource, /public\.ace_revoked_sessions as revoked/i, 'a batch for a durably revoked token session cannot restore presence');
  assert.match(migrationSource, /grant execute on function public\.ace_flush_presence\(jsonb\) to service_role/i);
  assert.match(migrationSource, /revoke all on function public\.ace_flush_presence\(jsonb\) from public, anon, authenticated/i);
});

test('heartbeat paused in asynchronous authentication is rejected after sign-out completes', async () => {
  const pending = new Map();
  const revokedTokens = new Set();
  const tokenKey = 'session-before-logout';
  const heartbeatAt = Date.parse('2026-10-16T02:00:00.000Z');
  const logoutAt = heartbeatAt + 5_000;
  let finishAuthentication;
  const authentication = new Promise(resolve => { finishAuthentication = resolve; });

  // Model the request timestamp being captured before authenticate() yields.
  const heartbeat = authentication.then(() => queuePresenceForActiveSession(pending, {
    userId: 'employee-a',
    sessionId: 'session-before-logout',
    tokenKey,
    heartbeatAt,
    isTokenRevoked: key => revokedTokens.has(key)
  }));

  // session-end revokes synchronously before awaiting its profile update.
  revokedTokens.add(tokenKey);
  finishAuthentication();

  assert.equal(await heartbeat, false, 'the post-auth queue guard observes sign-out revocation');
  assert.equal(pending.has('employee-a'), false, 'the pre-logout request is never queued after logout');
  assert.equal(isPresenceOnline(new Date(heartbeatAt).toISOString(), new Date(logoutAt).toISOString(), logoutAt + 1), false);
});

test('durable sign-out fences a heartbeat completing on another API instance', async () => {
  const pending = new Map();
  const revokedSessions = new Set();
  const tokenKey = 'token-validated-on-instance-b';
  const sessionId = 'session-revoked-on-instance-a';
  const heartbeatAt = Date.parse('2026-10-16T02:05:00.000Z');
  const logoutAt = heartbeatAt + 5_000;
  let finishAuthentication;
  const authentication = new Promise(resolve => { finishAuthentication = resolve; });

  // Instance B has no entry in its local revoked-token cache.
  const heartbeat = authentication.then(() => queuePresenceForActiveSession(pending, {
    userId: 'employee-a', sessionId, tokenKey, heartbeatAt, isTokenRevoked: () => false
  }));
  // Instance A's existing ace_end_session RPC commits the shared revocation.
  revokedSessions.add(sessionId);
  finishAuthentication();
  assert.equal(await heartbeat, true, 'the stale instance-local cache cannot be authoritative by itself');

  let persisted = false;
  await flushPresenceBatch(pending, undefined, async ([row]) => {
    if (!revokedSessions.has(row.session_id)) persisted = true;
    return persisted ? 1 : 0;
  });
  assert.equal(persisted, false, 'the batched RPC rejects the durably revoked session');
  assert.equal(isPresenceOnline(new Date(heartbeatAt).toISOString(), new Date(logoutAt).toISOString(), logoutAt + 1), false);
});

test('a heartbeat queued before sign-out still loses to the later logout timestamp, and a new session restores presence', async () => {
  const pending = new Map();
  const revokedTokens = new Set();
  const priorToken = 'prior-session';
  const heartbeatAt = Date.parse('2026-10-16T02:10:00.000Z');
  const logoutAt = heartbeatAt + 1_000;
  const isTokenRevoked = key => revokedTokens.has(key);

  assert.equal(queuePresenceForActiveSession(pending, {
    userId: 'employee-a', sessionId: priorToken, tokenKey: priorToken, heartbeatAt, isTokenRevoked
  }), true);
  revokedTokens.add(priorToken);

  let persisted = null;
  await flushPresenceBatch(pending, undefined, async ([row]) => {
    // Model the RPC's timestamp guard and durable session-revocation check.
    if (Date.parse(row.last_seen_at) > logoutAt && !revokedTokens.has(row.session_id)) persisted = row.last_seen_at;
    return persisted ? 1 : 0;
  });
  assert.equal(persisted, null, 'a queued request timestamped before logout cannot revive presence');
  assert.equal(isPresenceOnline(new Date(heartbeatAt).toISOString(), new Date(logoutAt).toISOString(), logoutAt + 1), false);

  const laterSessionAt = logoutAt + 10_000;
  assert.equal(queuePresenceForActiveSession(pending, {
    userId: 'employee-a', sessionId: 'new-session-id', tokenKey: 'new-session', heartbeatAt: laterSessionAt, isTokenRevoked
  }), true, 'a new token is not blocked by the prior token revocation');
  let restoredAt;
  await flushPresenceBatch(pending, undefined, async ([row]) => { assert.equal(row.session_id, 'new-session-id'); restoredAt = row.last_seen_at; return 1; });
  assert.equal(isPresenceOnline(restoredAt, new Date(logoutAt).toISOString(), laterSessionAt + 1), true);
});

test('newer heartbeat queued during a flush is retained; failures keep the pending batch for retry', async () => {
  const pending = new Map([['employee-a', { heartbeatAt: 1000, sessionId: 'session-a' }]]);
  let releaseWrite;
  const inFlight = flushPresenceBatch(pending, undefined, () => new Promise(resolve => { releaseWrite = resolve; }));
  pending.set('employee-a', { heartbeatAt: 2000, sessionId: 'session-a' });
  releaseWrite(1);
  await inFlight;
  assert.equal(pending.get('employee-a').heartbeatAt, 2000);

  await assert.rejects(flushPresenceBatch(pending, undefined, async () => { throw new Error('temporary database failure'); }), /temporary database failure/);
  assert.equal(pending.get('employee-a').heartbeatAt, 2000, 'a failed batch is available to the existing timer retry');
});

test('active clock-in count is based on open employee records regardless of presence', async () => {
  const filters = [];
  const rows = [
    { role: 'USER', deleted_at: null, clock_out_at: null, last_seen_at: '2020-01-01T00:00:00.000Z' },
    { role: 'USER', deleted_at: null, clock_out_at: '2026-10-15T17:00:00.000Z', last_seen_at: null },
    { role: 'ADMIN', deleted_at: null, clock_out_at: null, last_seen_at: null }
  ];
  const request = {
    select(columns, options) { filters.push(['select', columns, options]); return this; },
    eq(...args) { filters.push(['eq', ...args]); return this; },
    is(...args) { filters.push(['is', ...args]); return this; },
    then(resolve, reject) {
      const count = rows.filter(row => row.role === 'USER' && row.deleted_at === null && row.clock_out_at === null).length;
      return Promise.resolve({ count, error: null }).then(resolve, reject);
    }
  };
  const db = { from: table => { assert.equal(table, 'time_entries'); return request; } };
  assert.equal(await countActiveEmployeeClockIns(db), 1, 'the offline employee with an open entry remains in the count');
  assert.deepEqual(filters, [
    ['select', 'id,profiles!time_entries_user_id_fkey!inner(role)', { count: 'exact', head: true }],
    ['eq', 'profiles.role', 'USER'],
    ['is', 'deleted_at', null],
    ['is', 'clock_out_at', null]
  ]);
  assert.doesNotMatch(JSON.stringify(filters), /last_seen|presence/i, 'offline status does not filter clocked-in employees');
  await assert.rejects(countActiveEmployeeClockIns({ from: () => ({
    select() { return this; }, eq() { return this; }, is() { return this; },
    then(resolve) { return Promise.resolve({ count: null, error: new Error('query failed') }).then(resolve); }
  }) }), /query failed/);
});

test('admin dashboard count refreshes on mount, once a minute while visible, and on resume', async () => {
  const calls = [];
  const intervals = new Map();
  const listeners = new Map();
  let visible = true;
  const element = { textContent: '2' };
  const context = {
    AppState: { adminClockInCountInterval: null, adminClockInCountVisibilityHandler: null, adminClockInCountRequest: null },
    document: {
      get visibilityState() { return visible ? 'visible' : 'hidden'; },
      getElementById: id => id === 'clockedInUsers' ? element : null,
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: name => listeners.delete(name)
    },
    window: {
      ACEAuth: { request: url => { calls.push(url); return Promise.resolve({ count: calls.length + 2 }); } },
      setInterval: (callback, delay) => { intervals.set(1, { callback, delay }); return 1; },
      clearInterval: id => intervals.delete(id)
    },
    console: { warn() {} }
  };
  const dashboardFunctions = `${getFunction(frontendSource, 'refreshAdminClockInCount')}\n${getFunction(frontendSource, 'startAdminClockInCountRefresh')}`;
  const start = vm.runInNewContext(`${dashboardFunctions}\n[refreshAdminClockInCount, startAdminClockInCountRefresh]`, context);
  const [refresh, startRefresh] = start;
  startRefresh();
  const initialRequest = refresh();
  assert.equal(calls.length, 1, 'dashboard mount performs a fresh count request');
  await initialRequest;
  assert.equal(element.textContent, '3');
  assert.equal(intervals.get(1).delay, 60 * 1000);

  visible = false;
  listeners.get('visibilitychange')();
  assert.equal(calls.length, 1, 'backgrounded dashboard does not make count requests');
  visible = true;
  listeners.get('visibilitychange')();
  await context.AppState.adminClockInCountRequest;
  assert.equal(calls.length, 2, 'resuming refreshes immediately');
  assert.equal(element.textContent, '4');

  visible = false;
  intervals.get(1).callback();
  assert.equal(calls.length, 2, 'timer skips a hidden dashboard');
  visible = true;
  intervals.get(1).callback();
  await context.AppState.adminClockInCountRequest;
  assert.equal(calls.length, 3, 'the modest foreground interval refreshes the count');
});

test('dashboard count endpoint remains admin-only and does not change clock rules', () => {
  assert.match(serverSource, /app\.get\('\/v1\/admin-dashboard\/active-clock-in-count', authenticate, adminOnly/);
  assert.match(serverSource, /countActiveEmployeeClockIns\(db\)/);
  const dashboardLoader = getFunction(frontendSource, 'loadAdminDashboard');
  assert.match(dashboardLoader, /startAdminClockInCountRefresh\(\)/);
  assert.match(dashboardLoader, /refreshAdminClockInCount\(\)/);
  assert.match(serverSource, /app\.post\('\/v1\/auth\/heartbeat', capturePresenceRequestTime, authenticate, activeOnly/);
  assert.match(serverSource, /queuePresenceForActiveSession\(pendingPresence, \{/);
  assert.match(serverSource, /heartbeatAt: req\.presenceHeartbeatAt/);
  assert.match(serverSource, /tokenKey: req\.authTokenCacheKey/);
  assert.match(serverSource, /sessionId: req\.authSessionId/);
  assert.match(serverSource, /req\.authSessionId = authorized\.sessionId/);
  assert.match(serverSource, /isTokenRevoked\s*=\s*tokenKey\s*=>\s*revokedTokenCache\.get\(tokenKey\)\s*>\s*Date\.now\(\)/);
  assert.match(serverSource, /flushPresenceBatch\(pendingPresence, userIds, rows => query\(db\.rpc\('ace_flush_presence'/);
  assert.match(serverSource, /setInterval\(\(\) => \{\s*flushPresence\(\)\.catch/);
  assert.match(serverSource, /const \{ last_logout_at: lastLogoutAt, \.\.\.publicContact \} = contact/);
});
