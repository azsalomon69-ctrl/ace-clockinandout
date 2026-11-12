import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../../frontend/js/script.js', import.meta.url), 'utf8');
const boot = source.slice(source.indexOf('const employeeBootSnapshotKey'), source.indexOf('// Initialize App'));
const api = 'https://api.example.test';
const shift = { ClockInAt: '2026-11-11T09:00:00.000Z' };

function fixture({ owner = 'employee', savedOwner = 'employee', role = 'USER' } = {}) {
    const profile = { UserId: savedOwner, Role: role, Status: 'ACTIVE' };
    const saved = { owner: savedOwner, apiOrigin: api, savedAt: Date.now(), shift };
    const records = new Map([['ace_current_user', JSON.stringify(profile)], ['ace_employee_boot_shift', JSON.stringify(saved)]]);
    const events = new Map();
    const requests = [];
    const classes = new Set(['app-shell-pending']);
    const main = { inert: true };
    const elements = { employeeStatusPanel: { closest: () => main }, currentShiftTitle: {}, currentShiftDescription: {} };
    const context = vm.createContext({
        localStorage: { getItem: key => records.get(key) },
        window: {
            ACE_API_URL: api,
            ACEAuth: {
                async cachedAuthSession() { requests.push('local session'); return { user: { id: owner }, access_token: 'token', expires_at: Date.now() / 1000 + 3600 }; },
                checkService() { requests.push('wake Render'); return new Promise(() => {}); }
            },
            location: { replace: url => requests.push(url) },
            addEventListener: (name, fn) => events.set(name, fn),
            removeEventListener: (name) => events.delete(name)
        },
        document: { getElementById: id => elements[id], body: { classList: { add: key => classes.add(key), remove: key => classes.delete(key) } } }
    });
    vm.runInContext(boot, context);
    return { context, requests, classes, events, elements, main };
}

test('home and login share the early route to the employee dashboard while Render is unresolved', async () => {
    assert.match(source, /if \(isPublicRoute\(\)\) \{[\s\S]*?if \(await startPublicEmployeeBoot\(loginNotice\)\) return/);
    for (const pathname of ['/', '/login']) {
        const { context, requests } = fixture();
        context.window.location.pathname = pathname;
        assert.equal(await context.startPublicEmployeeBoot(null), true);
        assert.deepEqual(requests, ['local session', 'wake Render', '/user-dashboard']);
    }
});

test('dashboard shows the saved shift before Render responds and hides it on an account switch', async () => {
    const { context, classes, events, elements, main } = fixture();
    await context.showEmployeeBootPreview();
    assert.equal(classes.has('employee-boot-preview'), true);
    assert.equal(main.inert, false);
    assert.equal(elements.currentShiftTitle.textContent, 'Last verified shift was open');
    events.get('ace:auth-account')({ detail: 'employee' });
    assert.equal(classes.has('employee-boot-preview'), true);
    events.get('ace:auth-account')({ detail: 'someone-else' });
    assert.equal(classes.has('employee-boot-preview'), false);
    assert.equal(main.inert, true);
});

test('a different account, an administrator, or a login rejection does not use the fast redirect', async () => {
    for (const [options, notice] of [[{ owner: 'other' }, null], [{ role: 'ADMIN' }, null], [{}, 'Sign in again']]) {
        const { context, requests } = fixture(options);
        assert.equal(await context.startPublicEmployeeBoot(notice), false);
        assert.equal(requests.includes('/user-dashboard'), false);
    }
});
