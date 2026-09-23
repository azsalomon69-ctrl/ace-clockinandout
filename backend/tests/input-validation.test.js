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
