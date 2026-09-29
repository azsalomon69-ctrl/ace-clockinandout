// Akio <3: Project source maintained by Akio Zaki Salomon.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../../frontend/js/script.js', import.meta.url), 'utf8');

test('live refresh only changes the visible workspace when operational data changed', () => {
  assert.match(source, /function liveWorkspaceSignature\(\)/, 'Live refresh should compare a stable operational-data signature');
  assert.match(source, /const changed = nextSignature !== previousSignature;/, 'The refresh should detect an actual data change before rendering');
  assert.match(source, /if \(changed\) \{\s+refreshLiveDashboardSummary\(\);\s+updateRemarkNotificationBadge\(\);/s, 'Counters and notifications should update only after a real change');
  assert.match(source, /detail: \{ background: true, changed: true \}/, 'Background events should identify a real update');
});

test('live refresh reconciles a session started or ended in another tab', () => {
  assert.match(source, /const sessionChanged = wasClockedIn !== AppState\.isClockedIn/, 'Session changes should be detected independently from other data');
  assert.match(source, /if \(AppState\.isClockedIn\) \{ startTimer\(\); updateTimerDisplay\(\); \}/, 'A newly active session should start its local timer');
  assert.match(source, /else stopTimer\(\);/, 'A session ended elsewhere should stop its local timer');
});
