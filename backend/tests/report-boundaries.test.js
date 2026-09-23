// Akio <3: Project source maintained by Akio Zaki Salomon.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const start = source.indexOf("app.post('/v1/reports',");
const route = source.slice(start, source.indexOf("app.get('/v1/reports',", start));
const timestamps = ['2026-09-21T15:59:59.999Z', '2026-09-21T16:00:00Z', '2026-09-22T15:59:59.999Z', '2026-09-22T16:00:00Z'];

test('saved reports count the full Manila day and exclude removed entries', async () => {
  let handler;
  const rows = timestamps.map(clock_in_at => ({ clock_in_at, deleted_at: null }));
  rows.push({ clock_in_at: timestamps[1], deleted_at: '2026-09-22T00:00:00Z' });
  const filters = [];
  let saved;
  const builder = {
    select() { return this; }, single() { return this; },
    insert(value) { saved = value; return this; },
    is(field, value) { filters.push(row => row[field] === value); return this; },
    gte(field, value) { filters.push(row => Date.parse(row[field]) >= Date.parse(value)); return this; },
    lt(field, value) { filters.push(row => Date.parse(row[field]) < Date.parse(value)); return this; },
    then(resolve) { resolve({ count: rows.filter(row => filters.every(filter => filter(row))).length, error: null }); }
  };
  vm.runInNewContext(route, {
    app: { post(_path, ...handlers) { handler = handlers.at(-1); } },
    authenticate() {}, adminOnly() {}, isDate: () => true, optionalUuid: () => null,
    db: { from: () => builder }, query: async () => ({ id: 'report', ...saved }), audit: async () => {},
    fail() { assert.fail('Valid report was rejected'); }
  });
  const res = { status(code) { assert.equal(code, 201); return this; }, json(body) { this.body = body; } };
  await handler({ body: { dateFrom: '2026-09-22', dateTo: '2026-09-22' }, profile: { id: 'admin' } }, res, error => { throw error; });
  assert.equal(res.body.total_records, 2);
});

test('report preview selects the same Manila midnight boundaries', () => {
  const frontend = readFileSync(new URL('../../frontend/js/script.js', import.meta.url), 'utf8');
  const begin = frontend.indexOf('function filterEntriesForReport(');
  const fn = frontend.slice(begin, frontend.indexOf('function ensureGeneratedReportModal(', begin));
  const context = vm.createContext({ AppState: { users: [], timeEntries: timestamps.map(ClockInAt => ({ ClockInAt })) } });
  vm.runInContext(fn, context);
  const result = context.filterEntriesForReport({ DateFrom: '2026-09-22', DateTo: '2026-09-22' });
  assert.deepEqual(Array.from(result, entry => entry.ClockInAt), timestamps.slice(1, 3));
});
