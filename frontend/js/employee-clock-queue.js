// Employee clock outbox. One IndexedDB record per API origin and account lets
// every tab validate a tap and reserve its pending slot in the same transaction.
window.ACEClockQueue = (() => {
    const syncPath = '/v1/time-entries/clock-sync';
    const canCapture = record => (record?.snapshot?.leaseUntil || 0) > Date.now();
    const pending = action => action.state === 'pending';
    const signInAgain = 'Sign back in to sync your saved clock actions.';
    const unavailable = 'Clock sync is unavailable. Saved taps stay on this device.';
    let database;
    let account;
    let current;
    let listener;
    let anchor;
    let retryTimer;
    let failures = 0;
    let draining = false;
    let reviewRequested = false;
    let paused = '';
    let connected = false;
    let channel;

    const open = () => database ||= new Promise((resolve, reject) => {
        const request = indexedDB.open('ace_employee_clock', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('accounts');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    }).catch(error => {
        database = null;
        throw error;
    });

    async function access(owner, change) {
        const db = await open();
        const origin = String(window.ACE_API_URL || '').replace(/\/$/, '');
        const key = JSON.stringify([origin, owner]);
        return new Promise((resolve, reject) => {
            const tx = change ? db.transaction('accounts', 'readwrite', { durability: 'strict' }) : db.transaction('accounts', 'readonly');
            const store = tx.objectStore('accounts');
            const read = store.get(key);
            let result;
            let failure;
            read.onsuccess = () => {
                result = read.result || { snapshot: null, actions: [], revision: 0 };
                if (!change) return;
                try {
                    if (change(result)) {
                        result.revision += 1;
                        store.put(result, key);
                    }
                } catch (error) {
                    failure = error;
                    tx.abort();
                }
            };
            tx.oncomplete = () => resolve(result);
            tx.onabort = () => reject(failure || tx.error || new Error('Clock storage transaction aborted.'));
        });
    }

    function view(record) {
        const unresolved = record.actions.filter(action => !['confirmed', 'rejected', 'dismissed'].includes(action.state));
        const clockOut = unresolved.find(action => action.payload.type === 'clock_out');
        const clockIn = unresolved.find(action => action.payload.type === 'clock_in') ||
            record.actions.find(action => action.state === 'rejected' && action.payload.actionId === clockOut?.payload.clockInActionId);
        const shift = record.snapshot?.shift || (clockIn && clockIn.state !== 'not_submitted' && clockIn.state !== 'rejected' && {
            id: null, clockInActionId: clockIn.payload.actionId,
            startedAt: clockIn.payload.tappedAt, projectId: clockIn.payload.projectId
        });
        return { shift: clockOut ? null : (shift || null), clockIn, clockOut, receipt: unresolved.at(-1) || record.actions.at(-1) };
    }

    function publish(record, owner) {
        if (account !== owner || (record && current && record.revision < current.revision)) return;
        current = record;
        listener?.(record && { ...view(record), snapshot: record.snapshot, paused, connected, accepting: canCapture(record), needsSignIn: paused === signInAgain });
    }

    function publishChange(record, owner) {
        publish(record, owner);
        channel?.postMessage(owner);
    }

    function clearAccount() {
        account = current = anchor = null;
        paused = '';
        reviewRequested = false;
        connected = false;
        failures = 0;
        window.clearTimeout(retryTimer);
        listener?.(null);
    }

    async function reload() {
        const owner = account;
        if (!owner) return;
        const session = await window.ACEAuth.cachedAuthSession();
        if (owner !== account) return;
        if (session?.user?.id !== owner) {
            clearAccount();
            return;
        }
        publish(await access(owner), owner);
    }

    function setup(onChange) {
        listener = onChange;
        if (window.BroadcastChannel) {
            channel = new BroadcastChannel('ace_employee_clock');
            channel.onmessage = event => { if (event.data === account) void resume(); };
        }
        for (const event of ['focus', 'online']) window.addEventListener(event, () => void resume(true));
        window.addEventListener('ace:auth-account', event => {
            if (account && event.detail !== account) clearAccount();
        });
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) void resume(true);
        });
    }

    async function restore() {
        const session = await window.ACEAuth.cachedAuthSession();
        const owner = session?.user?.id;
        if (!owner || !session.access_token || !Number.isFinite(session.expires_at) || session.expires_at <= Date.now() / 1000) return false;
        const record = await access(owner);
        if (!record.snapshot || (!canCapture(record) && !record.actions.some(action =>
            action.state === 'pending' || action.state === 'needs_review')) ||
            (await window.ACEAuth.cachedAuthSession())?.user?.id !== owner) return false;
        account = owner;
        reviewRequested = true;
        publish(record, owner);
        schedule(0);
        return true;
    }

    async function sample(owner) {
        const started = performance.now();
        const response = await window.ACEAuth.authorizedFetch(syncPath + '/anchor', {
            method: 'POST', expectedUserId: owner, timeoutMs: 10000
        });
        if (!response.ok) return response.status;
        const body = await window.ACEAuth.responseBody(response);
        const now = performance.now();
        if (!body.anchorId || !Number.isFinite(Date.parse(body.serverAt))) return false;
        return { id: body.anchorId, serverAt: Date.parse(body.serverAt), leaseUntil: Date.now() + 1000 * Math.min(86400, Math.max(0, Number(body.queueLeaseSeconds) || 0)), monotonic: now, offset: Date.now() - now, usable: now - started < 4000 };
    }

    async function sampleWhenReady(owner) {
        for (const delay of [0, 1000, 3000]) {
            if (delay) await new Promise(resolve => window.setTimeout(resolve, delay));
            if ((await window.ACEAuth.cachedAuthSession())?.user?.id !== owner) return 401;
            try {
                const result = await sample(owner);
                if (!Number.isInteger(result) || (result < 500 && result !== 429)) return result;
                if (delay === 3000) return result;
            } catch (error) {
                if (error.status && error.status < 500 && error.status !== 429) return error.status;
                if (delay === 3000) throw error;
            }
        }
    }

    async function verified(owner, readSnapshot) {
        const baseline = await access(owner);
        const evidence = await sampleWhenReady(owner);
        if (evidence === 423 && account === owner) {
            const snapshot = await readSnapshot();
            const record = await access(owner, stored => {
                stored.snapshot = { ...snapshot, leaseUntil: 0 };
                return true;
            });
            connected = true;
            anchor = null;
            publishChange(record, owner);
            schedule(0);
            return 423;
        }
        if (!evidence?.id) {
            if (account === owner && evidence === 404) {
                paused = unavailable;
                publish(current, owner);
            }
            return evidence || 502;
        }
        const snapshot = await readSnapshot();
        const session = await window.ACEAuth.cachedAuthSession();
        if (session?.user?.id !== owner) return 401;
        const record = await access(owner, stored => {
            if (stored.revision !== baseline.revision && stored.snapshot) return false;
            stored.snapshot = { ...snapshot, leaseUntil: evidence.leaseUntil };
            return true;
        });
        account = owner;
        reviewRequested = true;
        connected = true;
        paused = '';
        anchor = evidence.usable ? evidence : null;
        publishChange(record, owner);
        schedule(0);
        return canCapture(record) ? 201 : 502;
    }

    let heartbeat = performance.now();
    let heartbeatWall = Date.now();
    window.setInterval(() => {
        const now = performance.now();
        const wall = Date.now();
        if (now - heartbeat > 10000 || Math.abs((wall - heartbeatWall) - (now - heartbeat)) > 2000) anchor = null;
        heartbeat = now;
        heartbeatWall = wall;
    }, 2000);

    async function save(type, input, shift) {
        const owner = account;
        if (!canCapture(current) && owner && !paused) throw new Error('New queued taps are paused. Try again when ACE connects.');
        if (!owner || paused) throw new Error(paused || 'Sign back in to continue.');
        const wall = Date.now();
        const now = performance.now();
        const payload = { type, actionId: crypto.randomUUID(), tappedAt: new Date(wall).toISOString() };
        const elapsed = anchor && Math.round(now - anchor.monotonic);
        if (anchor && elapsed >= 0 && elapsed <= 900000 && now - heartbeat < 10000 &&
            Math.abs((wall - heartbeatWall) - (now - heartbeat)) <= 2000 &&
            Math.abs(wall - now - anchor.offset) <= 2000) {
            payload.anchorId = anchor.id;
            payload.anchorElapsedMs = elapsed;
        }
        if (type === 'clock_in') payload.projectId = input || null;
        else {
            if (!shift) throw new Error('Open the clock-out form again.');
            payload.note = input.trim();
            if (!payload.note || Array.from(payload.note).length > 50 || payload.note.includes(String.fromCharCode(0))) {
                throw new Error('Enter a clock-out note of 1–50 characters.');
            }
            if (shift.id) payload.entryId = shift.id;
            else payload.clockInActionId = shift.clockInActionId;
        }
        const session = await window.ACEAuth.cachedAuthSession();
        if (account !== owner || session?.user?.id !== owner) throw new Error('Sign back in to continue.');
        let duplicate = false;
        const record = await access(owner, stored => {
            if (!canCapture(stored)) throw new Error('New queued taps are paused.');
            const live = view(stored);
            const reference = action => action.payload.entryId || action.payload.clockInActionId;
            const serverEntry = id => stored.actions.find(action => action.payload.actionId === id)?.entryId || id;
            const existing = type === 'clock_in' ? live.clockIn : stored.actions.find(action =>
                action.payload.type === type && serverEntry(reference(action)) === serverEntry(shift.id || shift.clockInActionId));
            if (existing) {
                duplicate = true;
                return false;
            }
            const sameShift = live.shift && serverEntry(live.shift.id || live.shift.clockInActionId) ===
                serverEntry(shift?.id || shift?.clockInActionId);
            if (type === 'clock_in' ? Boolean(live.shift || live.clockOut) : !sameShift) {
                throw new Error('The shift changed. Check the clock card and try again.');
            }
            stored.actions = stored.actions.filter(action => action.state !== 'confirmed' ||
                action.payload.actionId === payload.clockInActionId || action.entryId === stored.snapshot?.shift?.id);
            stored.actions.push({ payload, state: 'pending', retryAfter: 0 });
            return true;
        });
        publishChange(record, owner);
        schedule(0);
        return duplicate;
    }

    function schedule(delay) {
        if (!account || paused) return;
        window.clearTimeout(retryTimer);
        retryTimer = window.setTimeout(() => void drain(), delay);
    }

    async function resume(refreshAnchor = false) {
        if (refreshAnchor) reviewRequested = true;
        try {
            await reload();
            if (refreshAnchor && connected && account && !paused && (!anchor || performance.now() - anchor.monotonic > 300000)) {
                const owner = account;
                void sample(owner).then(async evidence => {
                    if (account !== owner || (!evidence?.id && evidence !== 423)) return;
                    anchor = evidence?.usable ? evidence : null;
                    const record = await access(owner, stored => {
                        stored.snapshot.leaseUntil = evidence.leaseUntil || 0;
                        return true;
                    });
                    publishChange(record, owner);
                }).catch(() => {});
            }
            schedule(0);
        } catch { schedule(5000); }
    }

    async function drain() {
        if (!account || paused || draining) return;
        draining = true;
        const owner = account;
        const checked = new Set();
        try {
            let record = await access(owner);
            while (owner === account && !paused) {
                const review = record.actions.find(action => action.state === 'needs_review' &&
                    !checked.has(action.payload.actionId) && (reviewRequested || action.retryAfter <= Date.now()));
                if (!review) reviewRequested = false;
                const next = review || record.actions.find(pending);
                if (!next) break;
                const dependency = next.payload.clockInActionId;
                if (!review && dependency && !record.actions.some(action =>
                    action.payload.actionId === dependency && action.state === 'confirmed' && action.entryId)) break;
                const wait = review ? 0 : next.retryAfter - Date.now();
                if (wait > 0) {
                    schedule(Math.min(wait, 120000));
                    break;
                }
                const path = review ? syncPath + '/receipts/' + next.payload.actionId +
                    (next.code === 'ACTION_PAYLOAD_MISMATCH' ? '?mismatch=1' : '') : syncPath;
                const response = await window.ACEAuth.authorizedFetch(path, review
                    ? { expectedUserId: owner }
                    : { expectedUserId: owner, method: 'POST', body: JSON.stringify(next.payload) });
                if (response.status === 401 || response.status === 403 || response.status === 404) {
                    paused = response.status === 401 ? signInAgain : unavailable;
                    publish(record, owner);
                    break;
                }
                if (response.status === 429 || response.status >= 500) throw new Error('Clock sync is temporarily unavailable.');
                const result = await window.ACEAuth.responseBody(response);
                if (review) checked.add(next.payload.actionId);
                const body = review ? result.outcome : result;
                if (!body) throw new Error('Missing clock receipt.');
                if (owner !== account) break;
                record = await access(owner, stored => {
                    const action = stored.actions.find(item => item.payload.actionId === next.payload.actionId);
                    if (!action || action.state !== next.state || action.retryAfter !== next.retryAfter) return false;
                    if (response.ok && body.state === 'confirmed' && body.entry?.id && body.entry.user_id === owner) {
                        action.state = 'confirmed';
                        action.entryId = body.entry.id;
                        action.entry = body.entry;
                        action.acceptedLate = body.acceptedLate;
                        action.reason = body.reason;
                        if (action.payload.type === 'clock_in') {
                            stored.snapshot.shift = { id: body.entry.id, startedAt: body.entry.clock_in_at, projectId: body.entry.project_id };
                        } else if (stored.snapshot.shift?.id === body.entry.id) stored.snapshot.shift = null;
                    } else if (response.status === 425) {
                        const serverNow = anchor && Math.abs(Date.now() - performance.now() - anchor.offset) <= 2000
                            ? anchor.serverAt + performance.now() - anchor.monotonic : NaN;
                        const estimate = Date.parse(body.retryAt) - serverNow;
                        action.retryAfter = Date.now() + (body.code === 'TAP_NOT_YET_VALID'
                            ? Math.min(120000, Math.max(5000, Number.isFinite(estimate) ? estimate : 15000)) : 30000);
                    } else if ((review || response.status === 409) && body.state === 'needs_review') {
                        action.state = 'needs_review';
                        action.bucket = body.bucket;
                        action.code = body.code;
                        action.retryAfter = Date.now() + 60000;
                    } else if (review && response.ok && body.state === 'rejected') {
                        action.state = 'rejected';
                        action.code = body.code;
                        action.reason = body.reason;
                    } else if (response.status === 400) {
                        action.state = 'not_submitted';
                        action.code = body.code;
                    } else throw new Error('Unrecognized clock sync response.');
                    return true;
                });
                failures = 0;
                publishChange(record, owner);
            }
        } catch (error) {
            if (owner !== account) return;
            if (error.status === 401 || error.status === 403) {
                paused = error.status === 401 ? signInAgain : unavailable;
                publish(current, owner);
            } else {
                failures += 1;
                schedule(Math.min(60000, 1500 * 2 ** Math.min(failures, 6)));
            }
        } finally {
            draining = false;
            if (owner !== account) schedule(0);
        }
    }

    async function dismissBlockedClockOut() {
        const owner = account;
        const session = await window.ACEAuth.cachedAuthSession();
        if (!owner || owner !== account || session?.user?.id !== owner) throw new Error('Sign back in to continue.');
        const record = await access(owner, stored => {
            const { clockIn, clockOut } = view(stored);
            if (clockIn?.state !== 'rejected' || clockOut?.state !== 'pending' ||
                clockOut.payload.clockInActionId !== clockIn.payload.actionId) return false;
            clockOut.state = 'dismissed';
            clockOut.reason = 'The clock-in was rejected. This clock-out was never sent.';
            return true;
        });
        publishChange(record, owner);
    }

    async function refreshShift(shift) {
        const owner = account;
        if (!owner) return;
        const record = await access(owner, stored => {
            if (stored.actions.some(action => action.state === 'pending' || action.state === 'needs_review')) return false;
            stored.snapshot.shift = shift;
            return true;
        });
        publishChange(record, owner);
    }

    return { setup, restore, verified, save, refreshShift, dismissBlockedClockOut, checkReceipt: () => resume(true), clear: clearAccount, refresh: () => publish(current, account) };
})();
