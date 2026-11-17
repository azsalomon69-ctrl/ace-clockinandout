// Deterministic browser boundary fixture. Serialize account read/write
// transactions and only expose a mutation once the transaction completes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../../frontend/js/employee-clock-queue.js', import.meta.url), 'utf8');

function harness() {
    const owner = 'employee-a';
    const records = new Map();
    let transaction = Promise.resolve();
    let saveFailure;
    let actionNumber = 0;
    let now = Date.parse('2026-11-12T07:00:00Z');
    let mono = 100;
    const calls = [];
    const db = {
        transaction() {
            const previous = transaction;
            let done;
            transaction = new Promise(resolve => { done = resolve; });
            let aborted = false;
            let write;
            const tx = {
                abort() { aborted = true; },
                objectStore: () => ({
                    get(key) {
                        const request = {};
                        void previous.then(() => {
                            request.result = structuredClone(records.get(key));
                            request.onsuccess();
                            if (saveFailure && write) {
                                tx.error = saveFailure;
                                saveFailure = null;
                                aborted = true;
                            }
                            if (!aborted && write) records.set(key, write);
                            if (aborted) tx.onabort();
                            else tx.oncomplete();
                            done();
                        });
                        return request;
                    },
                    put(value) { write = structuredClone(value); }
                })
            };
            return tx;
        }
    };
    const indexedDB = {
        open() {
            const request = {};
            queueMicrotask(() => {
                request.result = db;
                request.onsuccess();
            });
            return request;
        }
    };
    function tab() {
        let account = owner;
        let state;
        let server = () => response(503);
        let accepting = true;
        let anchorStatus;
        const timers = new Map();
        const events = new Map();
        let id = 0;
        const window = {
            ACE_API_URL: 'https://api.example.test',
            ACEAuth: {
                responseBody: response => response.json(),
                cachedAuthSession: async () => account && ({
                    user: { id: account }, access_token: 'token', expires_at: now / 1000 + 3600
                }),
                async authorizedFetch(path, options) {
                    assert.equal(options.expectedUserId, account);
                    if (path.endsWith('/anchor') && anchorStatus) {
                        const status = anchorStatus;
                        anchorStatus = undefined;
                        return response(status);
                    }
                    if (path.endsWith('/anchor')) return accepting
                        ? response(201, { anchorId: 'anchor', serverAt: new Date(now).toISOString(), queueLeaseSeconds: 86400 }) : response(423);
                    if (path.includes('/receipts/')) {
                        const id = path.split('/').at(-1).split('?')[0];
                        const original = calls.find(payload => payload.actionId === id);
                        assert.equal(options.body, undefined);
                        const result = server(original);
                        return response(200, { outcome: await result.json() });
                    }
                    const payload = JSON.parse(options.body);
                    calls.push(payload);
                    return server(payload);
                }
            },
            setTimeout(callback, delay) {
                timers.set(++id, { callback, delay });
                return id;
            },
            clearTimeout(timer) { timers.delete(timer); },
            setInterval(callback) { events.set('heartbeat', callback); },
            addEventListener(event, callback) { events.set(event, callback); }
        };
        const document = { hidden: false, addEventListener() {} };
        class TestDate extends Date { static now() { return now; } }
        vm.runInNewContext(source, {
            window, document, indexedDB, Date: TestDate, performance: { now: () => mono },
            crypto: { randomUUID: () => 'tap-' + ++actionNumber }
        });
        const queue = window.ACEClockQueue;
        queue.setup(value => { state = value; });
        return {
            queue, get state() { return state; },
            async tick() {
                const item = timers.entries().next().value;
                if (!item) return null;
                const [key, { callback, delay }] = item;
                timers.delete(key);
                callback();
                await setImmediate();
                return delay;
            },
            setAccount(next) { account = next; events.get('ace:auth-account')({ detail: next }); },
            setServer(fn) { server = fn; },
            pauseCapture() { accepting = false; },
            failNextAnchor(status) { anchorStatus = status; }
        };
    }
    return {
        owner, tab, calls, failSave: () => { saveFailure = new Error('QuotaExceededError'); },
        advance: (wall, monotonic = wall) => { now += wall; mono += monotonic; }
    };
}

const response = (status, body = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const snapshot = shift => async () => ({ shift, projects: [{ ProjectId: 'project', ProjectName: 'Support' }] });
const confirmed = (payload, owner) => response(payload.type === 'clock_in' ? 201 : 200, {
    state: 'confirmed',
    entry: { id: 'shift', user_id: owner, clock_in_at: payload.tappedAt, project_id: 'project' }
});

test('a verified snapshot opens the clock card on reopen for the same account only', async () => {
    const h = harness();
    const first = h.tab();
    assert.equal(await first.queue.restore(), false);
    await first.queue.verified(h.owner, snapshot({ id: 'shift', startedAt: '2026-11-12T00:00:00Z' }));
    const reopened = h.tab();
    assert.equal(await reopened.queue.restore(), true);
    assert.equal(reopened.state.connected, false);
    assert.equal(reopened.state.shift.id, 'shift');
    reopened.setAccount('employee-b');
    assert.equal(reopened.state, null);
    assert.equal(await reopened.queue.restore(), false);
    assert.equal(h.calls.length, 0);
});

test('failed local save leaves the shift and subsequent two-tab clock-out keeps the winning note', async () => {
    const h = harness();
    const first = h.tab();
    const second = h.tab();
    await first.queue.verified(h.owner, snapshot({ id: 'shift', startedAt: '2026-11-12T00:00:00Z' }));
    await second.queue.restore();
    const shift = first.state.shift;
    h.failSave();
    await assert.rejects(first.queue.save('clock_out', 'Kept in the form', shift), /QuotaExceededError/);
    assert.equal(first.state.shift.id, 'shift');
    const result = await Promise.all([
        first.queue.save('clock_out', 'Original note', shift),
        second.queue.save('clock_out', 'Second note', shift)
    ]);
    assert.deepEqual(result, [false, true]);
    assert.equal(second.state.receipt.payload.note, 'Original note');
    assert.equal(second.state.receipt.payload.actionId, first.state.receipt.payload.actionId);
});

test('a lost response is retried with the exact tap and its clock-out follows confirmation', async () => {
    const h = harness();
    const page = h.tab();
    await page.queue.verified(h.owner, snapshot(null));
    await page.queue.save('clock_in', 'project');
    await page.queue.save('clock_out', 'Finished', page.state.shift);
    const reopened = h.tab();
    await reopened.queue.restore();
    let lost = true;
    reopened.setServer(payload => {
        if (lost) {
            lost = false;
            throw new TypeError('Network response lost');
        }
        return confirmed(payload, h.owner);
    });
    await reopened.tick();
    assert.equal(h.calls.length, 1);
    assert.equal(await reopened.tick(), 3000);
    assert.deepEqual(h.calls[0], h.calls[1]);
    assert.equal(h.calls[2].clockInActionId, h.calls[0].actionId);
    assert.equal(reopened.state.receipt.state, 'confirmed');
    assert.equal(reopened.state.shift, null);
});

test('future retries preserve the payload and a clock-in in review holds its clock-out', async () => {
    const h = harness();
    const page = h.tab();
    await page.queue.verified(h.owner, snapshot(null));
    await page.queue.save('clock_in', 'project');
    await page.queue.save('clock_out', 'Finished', page.state.shift);
    const tappedAt = page.state.clockIn.payload.tappedAt;
    let future = true;
    page.setServer(() => {
        if (future) {
            future = false;
            return response(425, { code: 'TAP_NOT_YET_VALID', retryAt: tappedAt });
        }
        return response(409, { state: 'needs_review', bucket: 'timing', code: 'CLOCK_EVIDENCE_UNAVAILABLE' });
    });
    await page.tick();
    h.advance(5000);
    assert.equal(await page.tick(), 5000);
    assert.deepEqual(h.calls[0], h.calls[1]);
    assert.equal(page.state.clockIn.state, 'needs_review');
    assert.equal(page.state.clockOut.state, 'pending');
    assert.equal(h.calls.length, 2);
});

test('suspension invalidates the clock sample and a switched account cannot drain the original tap', async () => {
    const h = harness();
    const page = h.tab();
    await page.queue.verified(h.owner, snapshot(null));
    h.advance(120000, 500);
    await page.queue.save('clock_in', '');
    assert.equal(page.state.receipt.payload.anchorId, undefined);
    page.setAccount('employee-b');
    await page.tick();
    assert.equal(h.calls.length, 0);
    page.setAccount(h.owner);
    assert.equal(await page.queue.restore(), true);
    assert.equal(page.state.receipt.state, 'pending');
});

test('an approved clock-in receipt unblocks the original dependent clock-out on reopen', async () => {
    const h = harness();
    const page = h.tab();
    await page.queue.verified(h.owner, snapshot(null));
    await page.queue.save('clock_in', 'project');
    await page.queue.save('clock_out', 'Finished', page.state.shift);
    page.setServer(() => response(409, { state: 'needs_review', bucket: 'timing', code: 'CLOCK_EVIDENCE_UNAVAILABLE' }));
    await page.tick();
    assert.equal(h.calls.length, 1);
    h.advance(60000);
    const reopened = h.tab();
    await reopened.queue.restore();
    reopened.setServer(payload => confirmed(payload, h.owner));
    await reopened.tick();
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[1].clockInActionId, h.calls[0].actionId);
    assert.equal(reopened.state.receipt.state, 'confirmed');
});

test('a rejected clock-in keeps the dependent clock-out on the device', async () => {
    const h = harness();
    const page = h.tab();
    await page.queue.verified(h.owner, snapshot(null));
    await page.queue.save('clock_in', 'project');
    await page.queue.save('clock_out', 'Finished', page.state.shift);
    page.setServer(() => response(409, { state: 'needs_review', bucket: 'integrity', code: 'TAP_IN_FUTURE' }));
    await page.tick();
    h.advance(60000);
    const reopened = h.tab();
    await reopened.queue.restore();
    reopened.setServer(() => response(409, { state: 'rejected' }));
    await reopened.tick();
    assert.equal(h.calls.length, 1);
    assert.equal(reopened.state.clockIn.state, 'rejected');
    assert.equal(reopened.state.clockOut.payload.note, 'Finished');
    await reopened.queue.dismissBlockedClockOut();
    assert.equal(reopened.state.clockOut, undefined);
    assert.equal(reopened.state.receipt.state, 'dismissed');
    assert.equal(reopened.state.receipt.payload.note, 'Finished');
    await reopened.queue.save('clock_in', 'project');
    assert.equal(reopened.state.receipt.state, 'pending');
});

test('temporary service failures back off and an expired session retains the queued action', async () => {
    const h = harness();
    const page = h.tab();
    await page.queue.verified(h.owner, snapshot(null));
    await page.queue.save('clock_in', '');
    await page.tick();
    assert.equal(h.calls.length, 1);
    page.setServer(() => response(401));
    assert.equal(await page.tick(), 3000);
    assert.match(page.state.paused, /Sign back in/);
    assert.equal(page.state.receipt.state, 'pending');
    assert.equal(await page.tick(), null);
});

test('pausing new local taps keeps an existing queued action eligible to sync', async () => {
    const h = harness();
    const page = h.tab();
    await page.queue.verified(h.owner, snapshot(null));
    await page.queue.save('clock_in', 'project');
    page.pauseCapture();
    await page.queue.verified(h.owner, snapshot(null));
    assert.equal(page.state.accepting, false);
    await assert.rejects(page.queue.save('clock_out', 'Still working', page.state.shift), /queued taps are paused/);
    page.setServer(payload => confirmed(payload, h.owner));
    await page.tick();
    assert.equal(h.calls.length, 1);
    assert.equal(page.state.receipt.state, 'confirmed');
});

test('a cached confirmation does not replace a freshly loaded administrator correction', () => {
    const dashboard = readFileSync(new URL('../../frontend/js/script.js', import.meta.url), 'utf8');
    const renderer = dashboard.slice(dashboard.indexOf('function renderEmployeeClockQueue('), dashboard.indexOf('async function readEmployeeClockSnapshot('));
    const corrected = { TimeEntryId: 'shift', ClockOutAt: '2026-11-12T16:00:00Z' };
    const context = vm.createContext({
        AppState: { timeEntries: [corrected], currentUser: { UserId: 'employee-a', Role: 'USER' } },
        employeeClockState: null,
        stopTimer() {}, updateUI() {},
        document: { getElementById: () => null },
        timeEntryRecord: entry => ({ TimeEntryId: entry.id, ClockOutAt: entry.clock_out_at }),
        loadPageSpecificData: () => assert.fail('Rendering a stored receipt must not replace live report data')
    });
    vm.runInContext(renderer, context);
    const cached = {
        connected: true, shift: null,
        receipt: { state: 'confirmed', payload: { actionId: 'tap' }, entry: { id: 'shift', clock_out_at: '2026-11-12T15:00:00Z' } }
    };
    context.renderEmployeeClockQueue(cached);
    context.renderEmployeeClockQueue(cached);
    assert.equal(context.AppState.timeEntries[0], corrected);
});

test('a temporary anchor failure retries before the employee leaves the live dashboard', async () => {
    const h = harness();
    const page = h.tab();
    page.failNextAnchor(503);
    const verification = page.queue.verified(h.owner, snapshot(null));
    await setImmediate();
    assert.equal(await page.tick(), 1000);
    assert.equal(await verification, 201);
    assert.equal(page.state.accepting, true);

    const reopened = h.tab();
    assert.equal(await reopened.queue.restore(), true);
    assert.equal(reopened.state.connected, false);
    assert.equal(reopened.state.accepting, true);
});

test('an offline clock-in form uses saved project choices without a network warning', async () => {
    const dashboard = readFileSync(new URL('../../frontend/js/script.js', import.meta.url), 'utf8');
    const modal = dashboard.slice(dashboard.indexOf('function canOpenClockForm('), dashboard.indexOf('function openClockOutModal()'));
    const options = [];
    const projectSelect = { replaceChildren: (...items) => options.push(...items), disabled: false };
    const context = vm.createContext({
        employeeClockState: { accepting: true, connected: true, snapshot: { projects: [{ ProjectName: 'Support', ProjectId: 'support' }] } },
        navigator: { onLine: false },
        document: { getElementById: id => id === 'clockInProject' ? projectSelect : null },
        Option: class { constructor(text, value) { Object.assign(this, { text, value }); } },
        openModal() {},
        refreshUserProjectAssignments: () => assert.fail('Offline modal must not fetch project assignments'),
        showToast: () => assert.fail('Offline modal must not show a fetch warning')
    });
    vm.runInContext(modal, context);
    await context.openClockInModal();
    assert.deepEqual(options.map(option => option.value), ['', 'support']);
    assert.equal(projectSelect.disabled, false);
});

test('the confirmation dialog opens only when the same saved tap is confirmed', () => {
    const dashboard = readFileSync(new URL('../../frontend/js/script.js', import.meta.url), 'utf8');
    const helper = dashboard.slice(dashboard.indexOf('function showEmployeeClockConfirmation('), dashboard.indexOf('function renderEmployeeClockQueue('));
    const title = {};
    const time = {};
    let opened = 0;
    let reducedMotion = false;
    let pieces = [];
    const confetti = { replaceChildren: (...items) => { pieces = items; } };
    const dialog = {
        querySelector: selector => ({ h2: title, time, '.employee-clock-confetti': confetti })[selector],
        showModal() { opened++; }
    };
    const context = vm.createContext({
        window: { matchMedia: () => ({ matches: reducedMotion }) },
        document: { getElementById: () => dialog, createElement: () => ({ style: { setProperty() {} } }) }
    });
    vm.runInContext(helper, context);
    const entry = { clock_in_at: '2026-11-12T21:52:56.000Z', clock_out_at: '2026-11-12T21:53:28.000Z' };
    for (const [type, timestamp, label] of [
        ['clock_in', entry.clock_in_at, 'Clock-in confirmed'],
        ['clock_out', entry.clock_out_at, 'Clock-out confirmed']
    ]) {
        const pending = { state: 'pending', payload: { actionId: type, type } };
        const confirmed = { ...pending, state: 'confirmed', entry };
        const priorCount = opened;
        context.showEmployeeClockConfirmation(pending, pending);
        context.showEmployeeClockConfirmation(confirmed);
        context.showEmployeeClockConfirmation(confirmed, confirmed);
        context.showEmployeeClockConfirmation(confirmed, { ...pending, payload: { actionId: 'another-tap' } });
        assert.equal(opened, priorCount);
        context.showEmployeeClockConfirmation(confirmed, pending);
        assert.equal(opened, priorCount + 1);
        assert.equal(title.textContent, label);
        assert.equal(time.dateTime, timestamp);
        assert.match(time.textContent, /Manila time/);
        assert.equal(context.showRecordedEmployeeClockTime(type, entry), true);
        assert.equal(opened, priorCount + 2);
        assert.equal(pieces.length, 16);
    }
    reducedMotion = true;
    pieces = [];
    assert.equal(context.showRecordedEmployeeClockTime('clock_out', entry), true);
    assert.equal(pieces.length, 0);
});

test('offline clock forms explain when this browser cannot save a tap', () => {
    const dashboard = readFileSync(new URL('../../frontend/js/script.js', import.meta.url), 'utf8');
    const messages = [];
    const context = vm.createContext({
        navigator: { onLine: false }, employeeClockState: null,
        showToast: message => messages.push(message)
    });
    vm.runInContext(dashboard.slice(dashboard.indexOf('function canOpenClockForm('), dashboard.indexOf('async function openClockInModal()')), context);
    assert.equal(context.canOpenClockForm('clock out'), false);
    assert.match(messages[0], /Reconnect to the internet/);
    context.employeeClockState = { accepting: true };
    assert.equal(context.canOpenClockForm('clock out'), true);
    assert.equal(messages.length, 1);
});
