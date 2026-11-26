import test from 'node:test';
import assert from 'node:assert/strict';
import {projectPayload,projectAvailable} from '../server/project-lifecycle.js';
test('project fields validate real dates, type, lifecycle, color and department',()=>{
 const result=projectPayload({name:' Campaign A ',type:'CAMPAIGN',status:'PAUSED',start_date:'2026-11-01',end_date:'2026-12-01',color:'#357bb8',department_id:null},true);assert.equal(result.changes.name,'Campaign A');assert.equal(result.changes.type,'CAMPAIGN');
 for(const body of [null,[],{status:null},{start_date:null},{start_date:'2026-02-30'},{end_date:'tomorrow'},{type:'OTHER'},{status:'DISABLED'},{color:'red;bad'},{department_id:'x'},{start_date:'2026-12-01',end_date:'2026-11-01'}])assert.ok(projectPayload(body).error,JSON.stringify(body));
 assert.ok(projectPayload({name:'x'.repeat(161)}).error);assert.ok(projectPayload({}).error);assert.equal(projectPayload({is_active:true}).changes,undefined);
});
test('availability respects active status and inclusive Philippine calendar dates',()=>{
 const p={status:'ACTIVE',start_date:'2026-11-01',end_date:'2026-11-27'};assert.equal(projectAvailable(p,'2026-11-27'),true);assert.equal(projectAvailable(p,'2026-11-28'),false);assert.equal(projectAvailable(p,'2026-10-31'),false);for(const status of ['PAUSED','ARCHIVED'])assert.equal(projectAvailable({...p,status},'2026-11-27'),false);assert.equal(projectAvailable({is_active:false},'2026-11-27'),false);
});
