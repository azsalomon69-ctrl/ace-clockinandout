import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { parse } from 'parse5';
import { removeScripts, deduplicateAssetScripts } from '../../scripts/html-transforms.mjs';

const shell = readFileSync(new URL('../../frontend/js/script.js', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../../frontend/js/admin-sections.js', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const build = readFileSync(new URL('../../scripts/build-frontend.js', import.meta.url), 'utf8');
const fixture = readFileSync(new URL('./helpers/tutorial-fixture-server.mjs', import.meta.url), 'utf8');
const slice = (source, start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Production section exists: ${start}`);
  return source.slice(a, b);
};

function highlight(value, rawQuery) {
  const context = vm.createContext({ rawQuery, query: rawQuery.toLowerCase(), value });
  const escape = shell.split(/\r?\n/).find(line => line.startsWith('const escapeHtml ='));
  vm.runInContext(escape + '\n' + slice(shell, 'const highlightSearchText =', 'const matches =') + '\nglobalThis.result = highlightSearchText(value);', context);
  return context.result;
}

test('#7: unmatched HTML stays text and search results are not duplicated', () => {
  assert.equal(highlight('<b>before</b> Alice & after', 'Alice'), '&lt;b&gt;before&lt;/b&gt; <mark class="shell-search-highlight">Alice</mark> &amp; after');
  assert.equal(highlight('<img src=x onerror=alert(1)>', 'unmatched'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(highlight('Alice Alice', 'Alice'), '<mark class="shell-search-highlight">Alice</mark> <mark class="shell-search-highlight">Alice</mark>');
  assert.equal(highlight('a+b <x>', 'a+b'), '<mark class="shell-search-highlight">a+b</mark> &lt;x&gt;');
});

function scriptSources(html) {
  const sources = [];
  const visit = node => {
    if (node.tagName === 'script') sources.push(node.attrs.find(attribute => attribute.name === 'src')?.value || 'inline');
    (node.childNodes || []).forEach(visit);
    if (node.content) visit(node.content);
  };
  visit(parse(html));
  return sources;
}

test('#2: build deduplicates scripts with quoted greater-than attributes', () => {
  const context = vm.createContext({ deduplicateAssetScripts, withXlsxBundle: '<!doctype html><script src="assets/js/core.js"></script><script data-label=">" src="assets/js/core.js"></script><script src="assets/js/app.js"></script>' });
  const start = build.includes('const emittedScripts') ? '    const emittedScripts' : '    const deduplicatedScripts';
  vm.runInContext(slice(build, start, '    const output =') + '\nglobalThis.result = deduplicatedScripts;', context);
  assert.deepEqual(scriptSources(context.result), ['assets/js/core.js', 'assets/js/app.js']);
});

test('#9/#10: fixture removes browser-recognized scripts with unusual closing tags', () => {
  const context = vm.createContext({ removeScripts, data: '<!doctype html><body><script src="production.js"></script data-x><p>Keep me</p></body>' });
  const assignment = fixture.split(/\r?\n/).find(line => line.includes('data = data.toString()') || line.includes('data = removeScripts('));
  vm.runInContext(assignment, context);
  assert.deepEqual(scriptSources(context.data), ['/js/onboarding-config.js', '/production-fragments.js', '/js/onboarding.js', '/fixture-boot.js']);
  assert.match(context.data, /Keep me/);
});

test('#11: fixture error response does not expose the server stack', () => {
  let body;
  const context = vm.createContext({ error: new Error('private file path'), console: { error() {} }, res: { writeHead() {}, end(value) { body = value; } } });
  vm.runInContext(slice(fixture, '} catch (error) {', '\n});').replace('} catch (error) {', '{'), context);
  assert.doesNotMatch(body, /private file path|Error:|\bat\b/);
});

test('#1: oversized invitation email is rejected before regex evaluation', async () => {
  let regexCalls = 0;
  const context = vm.createContext({ emailPattern: { test() { regexCalls++; return false; } },
    res: {}, isAllowedCompanyEmail: () => true, fail: (_res, code) => code });
  const validation = slice(server.slice(server.indexOf("app.post('/v1/invitations'")), '  const email =', '  const departmentId =');
  vm.runInContext(`globalThis.validate = req => { ${validation} return 200; };`, context);
  assert.equal(context.validate({ body: { email: 'a'.repeat(10000) + '@example.com' } }), 400);
  assert.equal(regexCalls, 0);
  assert.equal(context.validate({ body: { email: {} } }), 400);
});

test('#8: saved page preferences do not retain employee searches or legacy filters', () => {
  const storage = new Map([['ace_admin_page_state_entries', JSON.stringify({ page: 2, size: 50, filters: { employee: 'Private Name', q: 'private@example.test' } })]]);
  const adminPageFilters = new Map();
  const context = vm.createContext({ key: 'entries', adminPageFilters, URLSearchParams, window: { location: { search: '' } },
    sessionStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) } });
  const fragment = slice(admin, "  const stateKey = 'ace_admin_page_state_'", '  // A live redraw');
  vm.runInContext(fragment + '\nglobalThis.loadedFilters = { ...activeFilters }; activeFilters.employee = "Another Name"; persistState();', context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.loadedFilters)), {});
  assert.deepEqual(JSON.parse(storage.get('ace_admin_page_state_entries')), { page: 2, size: 50 });
  assert.equal(adminPageFilters.get('entries').employee, 'Another Name', 'Live redraws retain filters in memory');
});

test('#5/#6: admin entry search sends names in a JSON body, never its URL', async () => {
  const calls = [];
  const context = vm.createContext({ URLSearchParams, filters: { employee: 'Private Name', project: 'Private Project', q: 'private@example.test' }, pageState: { page: 2, size: 25 },
    liveRequest: async (url, options) => { calls.push({ url, options }); return { items: [], total: 0 }; } });
  const entries = admin.slice(admin.indexOf("} else if (key === 'entries')"));
  vm.runInContext('globalThis.run = async () => {' + slice(entries, '    const params =', '    const [activeResponse]') + '};', context);
  await context.run();
  const search = calls.find(call => call.options?.method === 'POST');
  assert.ok(search, 'Search uses POST');
  assert.equal(search.url, '/v1/time-entries/search');
  assert.deepEqual(JSON.parse(search.options.body), { page: '2', pageSize: '25', q: 'private@example.test', employee: 'Private Name', project: 'Private Project' });
  assert.ok(calls.every(call => !/Private|private|employee=|project=|q=/.test(call.url)));
  calls.length = 0;
  context.filters = {};
  await context.run();
  assert.ok(calls.some(call => call.url === '/v1/time-entries?page=2&pageSize=25' && !call.options), 'Unfiltered pages retain GET compatibility');
});

test('#5/#6: POST search matches legacy GET filters, paging and employee ownership', async () => {
  const handlers = new Map();
  const operations = [];
  const authenticate = () => {}, activeOnly = () => {};
  const context = vm.createContext({ authenticate, activeOnly,
    app: Object.fromEntries(['get', 'post'].map(method => [method, (path, ...middleware) => handlers.set(method + path, middleware)])),
    query: async builder => builder.table === 'profiles' ? [{ id: 'person' }] : builder.table === 'projects' ? [{ id: 'project' }] : [{ id: 'entry' }],
    db: { from(table) {
      const builder = { table };
      for (const method of ['select', 'order', 'not', 'is', 'eq', 'in', 'or', 'ilike']) {
        builder[method] = (...args) => { operations.push([table, method, ...args]); return builder; };
      }
      builder.range = async (...args) => { operations.push([table, 'range', ...args]); return { data: [{ id: 'entry' }], count: 1 }; };
      return builder;
    } }
  });
  const start = server.includes('const listTimeEntries =') ? 'const listTimeEntries =' : "app.get('/v1/time-entries',";
  vm.runInContext(slice(server, start, "app.get('/v1/time-leaderboard'"), context);
  const post = handlers.get('post/v1/time-entries/search');
  assert.ok(post, 'POST search endpoint is registered');
  assert.equal(post[0], authenticate);
  assert.equal(post[1], activeOnly);
  const filters = { page: '2', pageSize: '10', employee: 'Name', project: 'Project', q: 'query', status: 'ACTIVE', removed: 'true' };
  const invoke = async (method, role, input) => {
    operations.length = 0; let result;
    const handler = handlers.get(method === 'post' ? 'post/v1/time-entries/search' : 'get/v1/time-entries').at(-1);
    await handler({ method: method.toUpperCase(), profile: { role, id: 'self' }, query: method === 'get' ? input : {}, body: method === 'post' ? input : {} },
      { json(value) { result = JSON.parse(JSON.stringify(value)); } }, error => { throw error; });
    return { result, operations: JSON.parse(JSON.stringify(operations)) };
  };
  for (const role of ['ADMIN', 'USER']) {
    const legacy = await invoke('get', role, filters);
    const body = await invoke('post', role, filters);
    assert.deepEqual(body, legacy);
    assert.deepEqual(body.result, { items: [{ id: 'entry' }], total: 1, page: 2, pageSize: 10 });
    assert.equal(body.operations.some(op => op[1] === 'eq' && op[2] === 'user_id' && op[3] === 'self'), role === 'USER');
  }
  assert.deepEqual((await invoke('get', 'USER', {})).result, [{ id: 'entry' }]);
});
