import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../frontend/js/admin-sections.js',import.meta.url),'utf8');
const fields=source.slice(source.indexOf('function formField('),source.indexOf('function openEntryFeedback('));
test('invitation role picker includes Client in dashboard and Users/Invitations forms',()=>{
 const html=readFileSync(new URL('../../frontend/admin-dashboard.html',import.meta.url),'utf8');assert.match(html,/<option value="CLIENT">Client<\/option>/);
 const ctx=vm.createContext({AppState:{departments:[]},esc:s=>String(s)});vm.runInContext(fields,ctx);const result=ctx.formField('Role','select','','',1);assert.match(result,/value="CLIENT"/);assert.match(result,/value="USER" selected/);
});
test('invitation department selector preserves real IDs and an optional empty selection',()=>{
 const ctx=vm.createContext({AppState:{departments:[{DepartmentId:'department-a',DepartmentName:'Support'}]},esc:s=>String(s)});vm.runInContext(fields,ctx);const result=ctx.formField('Department','select','','',2);assert.match(result,/<option value="">No department<\/option>/);assert.match(result,/<option value="department-a">Support<\/option>/);
 assert.ok(source.includes("['Role', 'select', 'USER'], ['Department', 'select', '']"));assert.ok(source.includes("departmentId: document.getElementById('adminField2').value || null"));
});
