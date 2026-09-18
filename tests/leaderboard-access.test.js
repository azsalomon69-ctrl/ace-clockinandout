import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const server = await readFile(new URL('../server/index.js', import.meta.url), 'utf8');

test('active employees can receive only the scoped leaderboard response', () => {
  const route = server.match(/app\.get\('\/v1\/time-leaderboard',[\s\S]*?\n}\s*catch \(error\) \{ next\(error\); \} \}\);/);
  assert.ok(route, 'time leaderboard route must exist');
  assert.match(route[0], /authenticate, activeOnly/, 'active employees must be allowed to request their rank');
  assert.match(route[0], /leaders: ranked\.slice\(0, 10\)\.map\(person => \(\{ full_name: person\.full_name, tracked_seconds: person\.tracked_seconds \}\)\)/, 'employee leaders must expose only name and hours');
  assert.match(route[0], /my_hours: ranked\.find\(person => person\.id === req\.profile\.id\)\?\.tracked_seconds \|\| 0/, 'response must include the caller\'s hours');
  assert.doesNotMatch(route[0], /profile_picture_url/, 'employee leaderboard response must not expose profile media');
});
