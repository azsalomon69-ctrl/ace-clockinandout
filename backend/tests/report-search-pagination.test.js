import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../frontend/js/script.js', import.meta.url), 'utf8');
function harness(loaded) {
  const row = id => ({ ReportId: id, ReportType: id, TotalRecords: 1 });
  const state = { reports: loaded ? [row('first'), row('second')] : [], reportsLoaded: loaded, reportPageItems: [], users: [] };
  const list = { innerHTML: '', dataset: {}, querySelectorAll: () => [] };
  let response = { items: [row('first')], total: 2 };
  const context = vm.createContext({
    AppState: state, URLSearchParams, location: { search: '' },
    document: { getElementById: id => id === 'reportsList' ? list : null },
    window: { ACEAuth: { request: async () => response } },
    reportRecord: x => x, formatReportType: x => x, reportDate: () => '', escapeHtml: x => x,
    formatAppDateTime: () => '', emptyState: () => 'No reports', showToast() {}
  });
  vm.runInContext(source.slice(source.indexOf('let reportsPage ='), source.indexOf('function loadUserSettings()')), context);
  return { state, list, row, load: context.loadReportsList, setResponse: value => { response = value; } };
}

test('report pagination preserves full search results while displaying only the requested page', async () => {
  const app = harness(true);
  await app.load();
  assert.deepEqual(Array.from(app.state.reports, r => r.ReportId), ['first', 'second']);
  assert.equal(app.state.reportsLoaded, true);
  assert.ok(app.list.innerHTML.includes('data-report-id="first"'));
  assert.ok(!app.list.innerHTML.includes('data-report-id="second"'));
  app.setResponse({ items: [app.row('second')], total: 2 });
  await app.load();
  assert.deepEqual(Array.from(app.state.reports, r => r.ReportId), ['first', 'second']);
  assert.ok(!app.list.innerHTML.includes('data-report-id="first"'));
  assert.ok(app.list.innerHTML.includes('data-report-id="second"'));
});

test('partial pages remain incomplete for search and refresh existing action records without duplicates', async () => {
  const app = harness(false);
  await app.load();
  assert.equal(app.state.reportsLoaded, false);
  app.setResponse({ items: [{ ...app.row('first'), TotalRecords: 12 }], total: 2 });
  await app.load();
  assert.equal(app.state.reports.length, 1);
  assert.equal(app.state.reports[0].TotalRecords, 12);
  app.setResponse({ items: [], total: 0 });
  await app.load();
  assert.equal(app.list.innerHTML.includes('No reports'), true);
  assert.equal(app.state.reportPageItems.length, 0);
});
