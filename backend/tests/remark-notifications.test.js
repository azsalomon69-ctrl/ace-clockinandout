// Akio <3: Project source maintained by Akio Zaki Salomon.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const shellSource = readFileSync(new URL('../../frontend/js/script.js', import.meta.url), 'utf8');
const adminSectionsSource = readFileSync(new URL('../../frontend/js/admin-sections.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../frontend/css/app.css', import.meta.url), 'utf8');
const upgradeSource = readFileSync(new URL('../../supabase/current-production-upgrade.sql', import.meta.url), 'utf8');
const migrationSource = readFileSync(new URL('../../supabase/migrations/0019_admin_remark_notifications.sql', import.meta.url), 'utf8');

test('administrator remarks have durable unread state in both production upgrade paths', () => {
  assert.match(upgradeSource, /alter table public\.admin_remarks add column if not exists seen_at timestamptz/i);
  assert.match(upgradeSource, /admin_remarks_unseen_idx/i);
  assert.doesNotMatch(upgradeSource, /update public\.admin_remarks set seen_at/i, 'The repeatable production upgrade must not mark newly unread feedback as read');
  assert.match(migrationSource, /update public\.admin_remarks\s+set seen_at = created_at\s+where seen_at is null/i, 'The one-time migration should acknowledge historical feedback only');
});

test('both employee and administrator bells surface unread administrator feedback', () => {
  assert.match(shellSource, /!remark\.SeenAt && \(!isAdmin \|\| !reviewedRemarks\.has\(String\(remark\.RemarkId\)\)\)/);
  assert.match(shellSource, /Feedback from \$\{remark\.AdminName/, 'Employees should see the administrator who left feedback');
  assert.match(shellSource, /Feedback awaiting review/, 'Administrators should see feedback that has not been acknowledged');
  assert.match(shellSource, /remarks\.html\?remark=\$\{encodeURIComponent\(remark\.RemarkId\)\}/, 'Employee bell items should open the specific feedback item');
  assert.match(adminSectionsSource, /requestedRemarks === 'with' \|\| requestedRemarks === 'without'/, 'Administrator bell items should open the matching feedback filter');
  assert.match(shellSource, /remark-notification-target/, 'A selected employee bell item should receive a dedicated remark-card target');
  assert.match(shellSource, /target\.scrollIntoView\(\{ behavior: 'smooth', block: 'center' \}\)/, 'The selected remark should scroll into view');
  assert.match(shellSource, /target\.classList\.remove\('remark-notification-target'\)/, 'The guidance highlight should clear after it has helped the employee');
  assert.match(styles, /\.remark-item\.remark-notification-target/, 'The notification target needs a visible card highlight');
});

const notificationHelpers = shellSource.slice(shellSource.indexOf('const reviewedAdminRemarks ='), shellSource.indexOf('function updateRemarkNotificationBadge()'));
function notificationHarness(storage = new Map()) {
 const state={currentUser:{Role:'ADMIN',UserId:'admin-a'},adminRemarks:[{RemarkId:'r1',SeenAt:null},{RemarkId:'r2',SeenAt:null}]};
 let renders=0;
 const ctx=vm.createContext({AppState:state,window:{ACERenderNotifications(){renders++;}},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}});
 vm.runInContext(notificationHelpers,ctx);
 return {ctx,state,storage,renders:()=>renders};
}
test('admin acknowledgement survives reload without changing employee read receipts',()=>{
 const f=notificationHarness();f.ctx.acknowledgeAdminRemarks(['r1']);
 assert.equal(f.ctx.getReviewedAdminRemarkIds().has('r1'),true);
 assert.equal(f.ctx.getReviewedAdminRemarkIds().has('r2'),false);
 assert.equal(f.state.adminRemarks[0].SeenAt,null);assert.equal(f.renders(),1);
 assert.equal(notificationHarness(f.storage).ctx.getReviewedAdminRemarkIds().has('r1'),true);
});
test('each administrator has separate notification acknowledgement',()=>{
 const f=notificationHarness();f.ctx.acknowledgeAdminRemarks(['r1']);f.state.currentUser.UserId='admin-b';
 assert.equal(f.ctx.getReviewedAdminRemarkIds().has('r1'),false);
});
test('employee acknowledgement never uses administrator notification storage',()=>{
 const f=notificationHarness();f.state.currentUser.Role='USER';f.ctx.acknowledgeAdminRemarks(['r1']);
 assert.equal(f.storage.size,0);assert.equal(f.renders(),0);
});
test('corrupt saved acknowledgement does not break the notification bell',()=>{
 const f=notificationHarness(new Map([['ace_reviewed_remarks_admin-a','invalid JSON']]));
 assert.equal(f.ctx.getReviewedAdminRemarkIds().size,0);f.ctx.acknowledgeAdminRemarks(['r1']);
 assert.equal(f.ctx.getReviewedAdminRemarkIds().has('r1'),true);
});
