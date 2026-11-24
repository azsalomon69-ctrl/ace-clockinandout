import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../../frontend/js/script.js',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('function projectActivityText('),source.indexOf('function openProjectActivityModal('));
const workbook=source.slice(source.indexOf('function reportWorkbookData('),source.indexOf('function downloadTimeEntryCsv('));
const entry={
    UserId:'employee',ClockInAt:'2026-11-24T00:00:00Z',ClockOutAt:'2026-11-24T09:00:00Z',DurationSeconds:32400,
    Activities:[
        {project_id:'one',project_name:'Support',description:'<img src=x onerror=alert(1)>',duration_seconds:10800,started_at:'08:00',ended_at:'11:00'},
        {project_id:'two',project_name:'Operations',description:'Records',duration_seconds:7200,started_at:'11:00',ended_at:'13:00'},
        {project_id:'one',project_name:'Support',description:'Follow-ups',duration_seconds:14400,started_at:'13:00',ended_at:'17:00'}
    ]
};
function context() {
    const sandbox=vm.createContext({
        AppState:{users:[{UserId:'employee',FullName:'Alex'}],projects:[]},
        filterEntriesForReport:()=>[entry],
        reportDateTime:value=>value,formatDuration:seconds=>String(seconds),
        formatClockDuration:seconds=>String(seconds),
        escapeHtml:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    });
    vm.runInContext(helpers+'\n'+workbook,sandbox);
    return sandbox;
}
test('project breakdown keeps the nine-hour shift total counted once',()=>{
    const rows=context().reportWorkbookData({});
    assert.equal(rows.length,3);
    assert.equal(rows[1][4],32400);
    assert.equal(rows[2][4],32400);
    assert.match(rows[1][8],/Support/);
    assert.match(rows[1][8],/Operations/);
    assert.match(rows[1][8],/10800/);
    assert.match(rows[1][8],/14400/);
});
test('activity details encode employee text and preserve repeated projects',()=>{
    const markup=context().projectActivityMarkup(entry);
    assert.ok(!markup.includes('<img'));
    assert.match(markup,/&lt;img/);
    assert.equal((markup.match(/Support/g)||[]).length,2);
    assert.equal(context().projectActivityMarkup({}),'');
});

test('shift listing selects the original project relationship after final activity adds a second foreign key',()=>{
    const server=readFileSync(new URL('../server/index.js',import.meta.url),'utf8');
    assert.match(server,/projects!time_entries_project_id_fkey\(name\)/);
    assert.doesNotMatch(server,/\*, projects\(name\), profiles!time_entries_user_id_fkey/);
});

test('PDF places every recorded activity directly under its parent shift',()=>{
    const sandbox=context();
    const report={innerHTML:''};
    sandbox.ensureGeneratedReportModal=()=>({dataset:{},querySelector:()=>report});
    sandbox.openModal=()=>{};
    const begin=source.indexOf('function renderGeneratedReport(');
    vm.runInContext(source.slice(begin,source.indexOf('// Settings Handlers',begin)),sandbox);
    sandbox.renderGeneratedReport({}, {printOnly:true});
    assert.match(report.innerHTML,/class="print-activity-row"/);
    assert.match(report.innerHTML,/Follow-ups/);
    assert.match(report.innerHTML,/Records/);
    assert.equal((report.innerHTML.match(/class="print-activity-line"/g)||[]).length,3);
    assert.ok(!report.innerHTML.includes('entry-note-card'));
    assert.ok(!report.innerHTML.includes('Included within'));
    assert.ok(report.innerHTML.indexOf('Follow-ups')<report.innerHTML.indexOf('</tbody>'));
    assert.ok(!report.innerHTML.includes('<img'));
});

test('legacy unallocated labels display as No project in exports',()=>{
    const sandbox=context();
    const legacy={Activities:[{project_id:null,project_name:'Unallocated',description:'Final task',duration_seconds:60,started_at:'08:00',ended_at:'08:01'}]};
    assert.match(sandbox.projectActivityText(legacy),/No project/);
    assert.doesNotMatch(sandbox.projectActivityText(legacy),/Unallocated/);
    assert.match(sandbox.projectActivityMarkup(legacy),/No project/);
});

test('admin project analytics split activities without double counting attendance',()=>{
    const totals=context().projectActivityTotals([entry]);
    assert.equal(totals.get('Support'),25200);
    assert.equal(totals.get('Operations'),7200);
    assert.equal([...totals.values()].reduce((sum,value)=>sum+value,0),32400);
});
test('admin summaries stay compact and encode employee activity descriptions',()=>{
    const markup=context().activitySummaryMarkup(entry.Activities);
    assert.match(markup,/popovertarget=/);
    assert.match(markup,/popover="auto"/);
    assert.doesNotMatch(markup,/<details/);
    assert.match(markup,/Follow-ups/);
    assert.ok(!markup.includes('<img'));
});
