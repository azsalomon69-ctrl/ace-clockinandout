import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'parse5';
const frontend = new URL('../../frontend/', import.meta.url);
const source = readFileSync(new URL('js/initial-skeletons.js', frontend), 'utf8');
function fixture(columns = 7, populated = false) {
  const classes = new Set();
  const value = { classList: { add: name => classes.add(name) } };
  const table = { children: populated ? [{}] : [], innerHTML: populated ? '<tr><td>Existing record</td></tr>' : '', closest: selector => selector === 'table' ? { querySelectorAll: () => Array(columns).fill({}) } : null };
  const regionClasses = new Set();
  const region = { id: 'hoursChart', children: [], innerHTML: '',
    classList: { add: name => regionClasses.add(name), contains: name => regionClasses.has(name) },
    setAttribute(name, value) { this[name] = value; } };
  const main = { dataset: {}, inert: false, setAttribute() {},
    querySelector: selector => selector === '#hoursChart' ? region : null,
    querySelectorAll: selector => selector === 'tbody' ? [table] : [value] };
  const events = {};
  const document = { readyState: 'loading', body: { classList: { add() {} } }, querySelector: selector => selector === 'main.main-content' ? main : null, getElementById: id => id === 'hoursChart' ? region : null, addEventListener: (name, callback) => { events[name] = callback; } };
  const window = {};
  vm.runInNewContext(source, { document, window });
  return { main, table, classes, region, events, window };
}
test('prepares real data containers after parsing, without replacing the page layout', () => {
  const f = fixture();
  f.events.DOMContentLoaded();
  assert.equal(f.main.inert, true);
  assert.ok(f.classes.has('data-value-pending'));
  assert.equal(f.region['aria-busy'], 'true');
  assert.equal((f.region.innerHTML.match(/--loading-height:/g) || []).length, 9);
  for (const page of ['admin-dashboard', 'user-dashboard']) {
    const html = readFileSync(new URL(page + '.html', frontend), 'utf8');
    assert.match(html, /<div class="app-shell-skeleton" aria-hidden="true"><\/div>/);
    assert.doesNotMatch(html, /shell-skeleton-main/);
  }
  assert.equal(Object.hasOwn(f.main, 'innerHTML'), false);
  const before = f.table.innerHTML;
  f.window.ACERenderInitialSkeletons();
  assert.equal(f.table.innerHTML, before);
});
test('table cells follow actual page headers and preserve populated content', () => {
  function nodes(root, tag) { return [ ...(root.tagName === tag ? [root] : []), ...(root.childNodes || []).flatMap(node => nodes(node, tag)) ]; }
  for (const page of ['admin-dashboard','reports','time-entries','schedule-flex','deleted-users','deleted-time-entries']) {
    const html = parse(readFileSync(new URL(page + '.html', frontend), 'utf8'));
    const count = nodes(nodes(html, 'thead')[0], 'th').length;
    const f = fixture(count); f.events.DOMContentLoaded();
    assert.equal((f.table.innerHTML.match(/<td>/g) || []).length, count * 4, page);
  }
  const f = fixture(4, true); f.events.DOMContentLoaded();
  assert.equal(f.table.innerHTML, '<tr><td>Existing record</td></tr>');
});
test('startup cleanup keeps independently loading records animated and re-enables controls', () => {
  const script = readFileSync(new URL('js/script.js', frontend), 'utf8');
  const cleanup = script.slice(script.indexOf('function clearInitialSkeletons()'), script.indexOf('function emptyState('));
  assert.match(cleanup, /main.inert = false/);
  assert.match(cleanup, /skeleton:not\(\.data-loading-line\)/);
  assert.doesNotMatch(source, /fetch\(|setInterval\(|ACEAuth/);
  assert.doesNotMatch(source, /shell-skeleton-intro|shell-skeleton-cards|main.innerHTML/);
});
