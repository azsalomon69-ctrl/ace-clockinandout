import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../../scripts/verify-database-contract.js', import.meta.url), 'utf8');

test('database verifier checks the current time-entry and permanent-delete contracts', () => {
  assert.doesNotMatch(source, /end_break_entry/);
  assert.doesNotMatch(source, /break_started_at|break_seconds|break_limit_seconds/);
  assert.doesNotMatch(source, /permanently_remove_archived_login', \{ target_user_id/);
  assert.match(source, /permanently_remove_archived_login', \{ p_target_user_id: absentId, p_actor_user_id: absentId, p_request_id: absentId \}/);
});
