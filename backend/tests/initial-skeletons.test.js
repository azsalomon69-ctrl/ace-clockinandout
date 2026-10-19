import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'parse5';

const frontend = new URL('../../frontend/', import.meta.url);
const source = readFileSync(new URL('js/initial-skeletons.js', frontend), 'utf8');
function render(page) {
  const shell = { innerHTML: '' };
  vm.runInNewContext(source, { window: {}, location: { pathname: '/' + page }, document: { querySelector: () => shell } });
  return shell.innerHTML;
}
function nodes(html, predicate) {
  const result = [];
  function walk(node) { if (predicate(node)) result.push(node); (node.childNodes || []).forEach(walk); }
  walk(parse(html));
  return result;
}
const hasClass = name => node => node.attrs?.find(attr => attr.name === 'class')?.value.split(/\s+/).includes(name);

test('every authenticated page renders the same placeholder for clean and HTML routes', () => {
  for (const page of readdirSync(frontend).filter(name => name.endsWith('.html'))) {
    if (!readFileSync(new URL(page, frontend), 'utf8').includes('app-shell-skeleton')) continue;
    const html = render(page);
    assert.equal(html, render(page.replace('.html', '')), page);
    assert.equal(nodes(html, node => node.tagName === 'main').length, 1, page);
    assert.doesNotMatch(html, /undefined|NaN|<script|<input|<button/);
  }
});

test('table placeholders match the actual static page table column counts', () => {
  for (const page of ['reports', 'time-entries', 'schedule-flex', 'individual-reports', 'deleted-users', 'deleted-time-entries', 'admin-dashboard']) {
    const actual = readFileSync(new URL(page + '.html', frontend), 'utf8');
    const firstHead = nodes(actual, node => node.tagName === 'thead')[0];
    const columns = firstHead.childNodes.flatMap(row => row.tagName === 'tr' ? row.childNodes : []).filter(node => node.tagName === 'th').length;
    assert.ok(columns > 0, page);
    const placeholder = nodes(render(page), hasClass('shell-skeleton-table-head'))[0];
    assert.equal(placeholder.childNodes.filter(node => node.tagName === 'i').length, columns, page);
  }
});

test('saved reports, settings, chat log, and employee profile use their real section types', () => {
  assert.equal(nodes(render('reports'), hasClass('shell-skeleton-chart')).length, 0);
  assert.equal(nodes(render('reports'), hasClass('shell-skeleton-card')).length, 0);
  assert.equal(nodes(render('settings'), hasClass('shell-skeleton-tabs')).length, 1);
  assert.equal(nodes(render('settings'), hasClass('is-settings-nav')).length, 0);
  assert.equal(nodes(render('chat-log'), hasClass('shell-skeleton-message')).length, 5);
  assert.equal(nodes(render('chat-log'), node => node.tagName === 'aside').length, 0);
  assert.equal(nodes(render('employee-profile'), hasClass('is-profile-charts')).length, 1);
  assert.equal(nodes(render('employee-profile'), hasClass('shell-skeleton-table-head')).length, 1);
  for (const page of ['users', 'departments', 'projects']) {
    assert.equal(nodes(render(page), hasClass('shell-skeleton-card')).length, 2, page);
  }
});
