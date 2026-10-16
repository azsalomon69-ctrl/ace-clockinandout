import test from 'node:test';
import assert from 'node:assert/strict';
import { countActiveEmployeeClockIns } from '../server/clock-in-count.js';
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
