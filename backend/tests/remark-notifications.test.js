// Akio <3: Project source maintained by Akio Zaki Salomon.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shellSource = readFileSync(new URL('../../frontend/js/script.js', import.meta.url), 'utf8');
const adminSectionsSource = readFileSync(new URL('../../frontend/js/admin-sections.js', import.meta.url), 'utf8');
const upgradeSource = readFileSync(new URL('../../supabase/current-production-upgrade.sql', import.meta.url), 'utf8');
const migrationSource = readFileSync(new URL('../../supabase/migrations/0019_admin_remark_notifications.sql', import.meta.url), 'utf8');

test('administrator remarks have durable unread state in both production upgrade paths', () => {
  assert.match(upgradeSource, /alter table public\.admin_remarks add column if not exists seen_at timestamptz/i);
  assert.match(upgradeSource, /admin_remarks_unseen_idx/i);
  assert.doesNotMatch(upgradeSource, /update public\.admin_remarks set seen_at/i, 'The repeatable production upgrade must not mark newly unread feedback as read');
  assert.match(migrationSource, /update public\.admin_remarks\s+set seen_at = created_at\s+where seen_at is null/i, 'The one-time migration should acknowledge historical feedback only');
});

test('both employee and administrator bells surface unread administrator feedback', () => {
  assert.match(shellSource, /const unreadRemarks = AppState\.adminRemarks\.filter\(remark => !remark\.SeenAt\)/);
  assert.match(shellSource, /Feedback from \$\{remark\.AdminName/, 'Employees should see the administrator who left feedback');
  assert.match(shellSource, /Feedback awaiting review/, 'Administrators should see feedback that has not been acknowledged');
  assert.match(shellSource, /remarks\.html\?remark=\$\{encodeURIComponent\(remark\.RemarkId\)\}/, 'Employee bell items should open the specific feedback item');
  assert.match(shellSource, /function startRemarkNotifications\(\) \{\s+if \(AppState\.remarkNotificationInterval\) return;/, 'Remark polling should run for both active roles');
  assert.match(adminSectionsSource, /requestedRemarks === 'with' \|\| requestedRemarks === 'without'/, 'Administrator bell items should open the matching feedback filter');
});
