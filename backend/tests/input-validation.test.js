// Akio <3: Project source maintained by Akio Zaki Salomon.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const validators = vm.runInNewContext(`${source.slice(source.indexOf('const isUuid ='), source.indexOf('const isTimestamp ='))}\n({ isUuid, isDate });`);

test('record IDs require canonical UUID group lengths and string input', () => {
  assert.equal(validators.isUuid('12345678-1234-1234-1234-123456789abc'), true);
  for (const value of ['12345678----------------------------', '12345678-123-12345-1234-123456789abc', ['12345678-1234-1234-1234-123456789abc'], null]) {
    assert.equal(validators.isUuid(value), false);
  }
});

test('report dates reject rolled-over days and accept real leap days', () => {
  for (const value of ['2026-02-29', '2026-02-31', '2026-04-31', '2026-13-01', ['2026-01-01'], null]) {
    assert.equal(validators.isDate(value), false);
  }
  assert.equal(validators.isDate('2024-02-29'), true);
  assert.equal(validators.isDate('2026-09-22'), true);
});

test('queued clock actions require one shift reference and a valid tap time', () => {
  const validate = vm.runInNewContext(`
    ${source.slice(source.indexOf('const isUuid ='), source.indexOf('const isDate ='))}
    ${source.slice(source.indexOf('const optionalText ='), source.indexOf('const requireText ='))}
    ${source.slice(source.indexOf('const optionalUuid ='), source.indexOf("app.param('id'"))}
    ${source.slice(source.indexOf('function queuedClockPayload('), source.indexOf("app.post('/v1/time-entries/clock-sync/anchor'"))}
    queuedClockPayload
  `);
  const actionId = '12345678-1234-1234-1234-123456789ABC';
  const entryId = '12345678-1234-1234-1234-123456789abd';
  const clockOut = { actionId, type: 'clock_out', entryId, tappedAt: '2026-11-12T00:00:00.000Z', note: ' Done ' };
  assert.equal(validate(clockOut).actionId, actionId.toLowerCase());
  assert.equal(validate(clockOut).payload.note, 'Done');
  assert.equal(validate({ ...clockOut, entryId: null, clockInActionId: entryId }).payload.clockInActionId, entryId);
  for (const invalid of [
    { entryId: null }, { clockInActionId: entryId }, { entryId: null, clockInActionId: actionId },
    { tappedAt: '2026-02-30T00:00:00.000Z' }, { tappedAt: '0000-01-01T00:00:00.000Z' },
    { note: '' }, { note: 'x'.repeat(51) }, { note: 'A\0B' },
    { anchorElapsedMs: 50 }, { anchorId: entryId, anchorElapsedMs: 900001 }
  ]) assert.equal(validate({ ...clockOut, ...invalid }), null);
});
