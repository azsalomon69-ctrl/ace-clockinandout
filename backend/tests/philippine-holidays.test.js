import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const start = source.indexOf('const holidayClassifications');
const end = source.indexOf('// The browser needs to know', start);
const routes = new Map();
const authenticate = () => {};
const activeOnly = () => {};
const adminOnly = () => {};
const registered = method => (path, ...handlers) => routes.set(method + ' ' + path, handlers);
const context = vm.createContext({
    app: Object.fromEntries(['get', 'post', 'patch', 'delete'].map(method => [method, registered(method)])),
    authenticate, activeOnly, adminOnly, URL,
    isUuid: id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id),
    fail: (_res, status, message) => ({ status, message })
});

test('bulk management rejects empty, oversized, and invalid selections before touching the database', async () => {
    const handler = routes.get('post /v1/holidays/ph/bulk').at(-1);
    const id = '00000000-0000-4000-8000-000000000001';
    for (const body of [
        { action: 'archive', ids: [] },
        { action: 'restore', ids: Array(201).fill(id) },
        { action: 'verify', ids: ['bad-id'] },
        { action: 'delete', ids: [id] }
    ]) {
        const response = await handler({ body }, {}, error => { throw error; });
        assert.equal(response.status, 400);
    }
});
vm.runInContext(source.slice(start, end) + '\nthis.validate = holidayRecord;', context);

test('all holiday writes use the existing admin guard, with active-account reads', () => {
    assert.equal(routes.size, 5);
    for (const [route, handlers] of routes) {
        assert.equal(handlers[0], authenticate);
        assert.equal(handlers[1], route.startsWith('get ') ? activeOnly : adminOnly);
    }
});

test('holiday validation checks actual dates, official links, and geographic scope', () => {
    const row = {
        holiday_name: 'City anniversary', holiday_date: '2026-12-09', classification: 'special_non_working',
        geographic_scope: 'city', location: 'Science City of Muñoz', verification_status: 'verified',
        source_name: 'Proclamation', source_url: 'https://pco.gov.ph/'
    };
    assert.equal(context.validate(row)?.holiday_date, row.holiday_date);
    for (const changes of [
        { holiday_date: '2026-02-30' }, { location: '' }, { geographic_scope: 'national' },
        { source_url: 'javascript:alert(1)' }, { source_name: '' }, { classification: 'unknown' }
    ]) assert.equal(context.validate({ ...row, ...changes }), null);
    assert.ok(context.validate({ ...row, verification_status: 'pending', source_name: '', source_url: '' }));
});
