(() => {
    const root = document.getElementById('clockReviewWorkspace');
    if (!root) return;
    const get = id => document.getElementById(id);
    const request = (path = '', options) => window.ACEAuth.request('/v1/queued-clock-reviews' + path, options);
    const esc = escapeHtml;
    const when = value => value ? new Date(value).toLocaleString('en-PH', {
        timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'medium'
    }) : 'Unavailable';
    const labels = {
        CLOCK_EVIDENCE_UNAVAILABLE: 'Clock evidence was unavailable for this delayed tap',
        TAP_IN_FUTURE: 'Tap time was too far in the future',
        TAP_TOO_OLD: 'Tap arrived after the four-hour limit',
        DEVICE_CLOCK_MISMATCH: 'Estimated device clock error exceeded five minutes',
        SHIFT_NOT_OPEN: 'The requested shift was closed, removed, or unavailable',
        TAP_BEFORE_CLOCK_IN: 'The clock-out was before the recorded clock-in',
        SHIFT_OVERLAP: 'The tap would overlap an existing shift',
        PROJECT_UNAVAILABLE: 'The employee’s project assignment could not be verified',
        ACTION_PAYLOAD_MISMATCH: 'The same action ID was used with different content',
        REPORTED_ACTION_MISSING: 'An employee reported a tap with no matching receipt'
    };
    const actionLabel = type => type === 'clock_in' ? 'Clock-in' : 'Clock-out';
    let page = 1;
    let listVersion = 0;
    let detailVersion = 0;
    let selected;

    async function load() {
        const version = ++listVersion;
        const notice = get('clockReviewNotice');
        notice.textContent = 'Loading clock reviews…';
        get('clockReviewList').replaceChildren();
        get('clockReviewPagination').hidden = true;
        try {
            const params = new URLSearchParams({
                bucket: get('clockReviewBucket').value,
                resolved: get('clockReviewStatus').value === 'resolved',
                page
            });
            const result = await request('?' + params);
            if (version !== listVersion) return;
            if (page > 1 && !result.items.length) { page -= 1; return load(); }
            notice.textContent = result.items.length ? result.total + (result.total === 1 ? ' case' : ' cases') : 'No ' + (get('clockReviewStatus').value === 'resolved' ? 'resolved' : 'open') + ' cases for this review type.';
            const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
            get('clockReviewPage').textContent = 'Page ' + page + ' of ' + pages;
            get('clockReviewPagination').hidden = pages <= 1;
            get('clockReviewPrevious').disabled = page <= 1;
            get('clockReviewNext').disabled = page >= pages;
            get('clockReviewList').innerHTML = result.items.map(review => `
                <li><button type="button" class="btn btn-outline" data-review="${esc(review.id)}">
                    <strong>${esc(review.employee?.full_name || review.employee?.email || review.user_id)}</strong>
                    <span>${esc(labels[review.code] || review.code)}</span><small>${esc(when(review.opened_at))}</small>
                </button></li>`).join('');
        } catch (error) {
            if (version !== listVersion) return;
            notice.textContent = error.status === 404 ? 'Clock sync review is currently disabled.' : error.message;
            if (error.status === 404) {
                get('clockReviewMissing').hidden = true;
                get('clockReviewMetrics').hidden = true;
            }
        }
    }

    function evidenceRows(values) {
        return '<dl class="clock-review-evidence">' + values.map(([name, value]) =>
            '<div><dt>' + esc(name) + '</dt><dd>' + esc(value ?? 'Unavailable') + '</dd></div>').join('') + '</dl>';
    }

    async function open(id, focus = false) {
        selected = id;
        const version = ++detailVersion;
        const panel = get('clockReviewDetail');
        panel.hidden = false;
        panel.innerHTML = '<h2 id="clockReviewDetailTitle" tabindex="-1">Review details</h2><p role="status">Loading evidence…</p>';
        try {
            const { review, receipt, shift, matchingReceipt } = await request('/' + id);
            if (version !== detailVersion) return;
            const payload = receipt?.payload || review.evidence;
            const canAccept = !review.decision && receipt && review.code !== 'ACTION_PAYLOAD_MISMATCH' &&
                (payload.type !== 'clock_out' || (shift && !shift.clock_out_at && !shift.deleted_at &&
                    Date.parse(shift.clock_in_at) <= Date.parse(receipt.tapped_at))) &&
                (payload.type !== 'clock_in' || !shift);
            const employee = review.employee?.full_name || review.employee?.email || review.user_id;
            const outcome = review.decision === 'accepted' ? 'Accepted' : review.decision === 'rejected' ? 'Declined' : 'Needs a decision';
            const reason = shift?.stopped_by_at && review.code === 'SHIFT_NOT_OPEN'
                ? 'An administrator already closed this shift.' : labels[review.code] || review.code;
            panel.innerHTML = `<header class="clock-review-case-heading">
                <div><h2 id="clockReviewDetailTitle" tabindex="-1">${esc(employee)}</h2>
                <p>${esc(reason)}</p></div><span class="clock-review-outcome">${outcome}</span>
            </header>
            <div class="clock-review-comparison">
                <section><h3>Employee’s request</h3>${evidenceRows([
                    [actionLabel(payload.type) + ' time (Manila)', when(receipt?.tapped_at || payload.reportedAt)],
                    ...(payload.note || payload.detail ? [['Note', payload.note || payload.detail]] : [])
                ])}</section>
                <section><h3>Recorded shift</h3>${shift ? evidenceRows([
                    ['Clock-in (Manila)', when(shift.clock_in_at)],
                    ['Clock-out (Manila)', shift.clock_out_at ? when(shift.clock_out_at) : 'Still open'],
                    ...(shift.deleted_at ? [['Status', 'Removed']] : []),
                    ...(shift.final_note ? [['Recorded note', shift.final_note]] : [])
                ]) + '<a href="/time-entry-details?entry=' + encodeURIComponent(shift.id) + '">Open recorded shift</a>'
                    : '<p>No matching shift found.</p>'}</section>
            </div>
            <details class="clock-review-technical"><summary>Technical details</summary>${evidenceRows([
                ['Account', review.employee?.email || review.user_id],
                ['First received (Manila)', when(receipt?.received_at)],
                ['Sync delay', receipt ? Math.round((Date.parse(receipt.received_at) - Date.parse(receipt.tapped_at)) / 1000) + ' seconds' : null],
                ['Estimated clock error', receipt?.clock_error_ms == null ? null : Number(receipt.clock_error_ms) / 1000 + ' seconds'],
                ['Device', receipt?.device_category],
                ['Action ID', review.action_id || payload.reportedActionId],
                ['Shift reference', payload.entryId || payload.clockInActionId],
                ['Requested project ID', payload.projectId]
            ])}${review.evidence.attempt ? '<pre>' + esc(JSON.stringify({
                original: receipt?.payload, changed: review.evidence.attempt, changedDevice: review.evidence.device
            }, null, 2)) + '</pre>' : ''}</details>`;
            if (matchingReceipt) panel.insertAdjacentHTML('beforeend', '<p>A receipt is now available for this report. Action ID <strong>' +
                esc(matchingReceipt.action_id) + '</strong> · Received ' + esc(when(matchingReceipt.received_at)) + '</p>');
            if (review.decision) {
                panel.insertAdjacentHTML('beforeend', evidenceRows([
                    ['Decision', review.decision === 'accepted' ? 'Accepted' : 'Rejected'],
                    ['Reviewer', review.reviewer?.full_name || review.reviewer?.email || review.decided_by],
                    ['Decision time (Manila)', when(review.decided_at)], ['Decision reason', review.decision_reason]
                ]));
            } else {
                panel.insertAdjacentHTML('beforeend', `<form class="clock-review-decision">
                    ${canAccept ? '<p>Accept applies the original tap time after ACE rechecks the shift.</p>' :
                        '<p>This request cannot be applied to the current shift. To change the recorded time, open the recorded shift and use Correct time.</p>'}
                    <label>Decision reason <textarea class="form-textarea" name="reason" required maxlength="1000"></textarea></label>
                    <p role="status"></p>
                    <div class="clock-review-filters">${canAccept ? '<button type="submit" class="btn btn-primary" value="accepted">Accept original tap</button>' : ''}
                    <button type="submit" class="btn btn-outline" value="rejected">Reject request</button></div>
                </form>`);
                panel.querySelector('form').addEventListener('submit', async event => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    await submit(form, '/' + id + '/decision', {
                        decision: event.submitter?.value, reason: form.elements.reason.value
                    }, async () => { await Promise.all([load(), open(id, true)]); });
                });
            }
            if (focus) get('clockReviewDetailTitle').focus();
        } catch (error) {
            if (version === detailVersion) {
                const notice = panel.querySelector('[role=status]');
                if (notice) notice.textContent = error.message;
                else showToast(error.message || 'Could not display the review.', 'error');
            }
        }
    }

    async function submit(form, path, body, onSuccess) {
        const buttons = form.querySelectorAll('button');
        buttons.forEach(button => { button.disabled = true; });
        const notice = form.querySelector('[role=status]');
        notice.textContent = 'Saving…';
        try {
            const saved = await request(path, { method: 'POST', body: JSON.stringify(body) });
            notice.textContent = 'Saved.';
            await onSuccess(saved);
        } catch (error) { notice.textContent = error.message; }
        finally { buttons.forEach(button => { button.disabled = false; }); }
    }

    async function metrics() {
        const notice = get('clockMetricNotice');
        notice.textContent = 'Loading weekly reporting…';
        try {
            const rows = await request('/metrics');
            get('clockMetricRows').innerHTML = rows.map(row => '<tr>' +
                [row.week_manila, row.delayed_10_to_30, row.accepted, row.percentage == null ? '—' : row.percentage + '%']
                    .map(cell => '<td>' + esc(cell) + '</td>').join('') + '</tr>').join('');
            const completed = rows.slice(1, 3);
            notice.textContent = completed.length === 2 && completed.every(row =>
                Number(row.delayed_10_to_30) * 10 > Number(row.accepted))
                ? 'Both completed weeks exceeded 10%. Review the standard sync window.' : '';
        } catch (error) { notice.textContent = error.message; }
    }

    window.addEventListener('ace:app-ready', () => {
        if (AppState.currentUser?.Role !== 'ADMIN') return;
        const missing = get('clockReviewMissingForm');
        for (const user of AppState.users.filter(user => user.Role === 'USER')) {
            missing.elements.userId.add(new Option(user.FullName || user.Email, user.UserId));
        }
        const reset = () => {
            page = 1;
            detailVersion += 1;
            selected = null;
            get('clockReviewDetail').hidden = true;
            void load();
        };
        get('clockReviewBucket').addEventListener('change', reset);
        get('clockReviewStatus').addEventListener('change', reset);
        get('clockReviewPrevious').onclick = () => { page -= 1; void load(); };
        get('clockReviewNext').onclick = () => { page += 1; void load(); };
        get('clockReviewList').onclick = event => {
            const button = event.target.closest('[data-review]');
            if (button) void open(button.dataset.review, true);
        };
        get('refreshClockReviews').onclick = () => {
            void load();
            if (selected) void open(selected);
            if (get('clockReviewMetrics').open) void metrics();
        };
        get('clockReviewMetrics').addEventListener('toggle', event => { if (event.currentTarget.open) void metrics(); });
        missing.addEventListener('submit', event => {
            event.preventDefault();
            const body = Object.fromEntries(new FormData(missing));
            body.reportedAt += '+08:00';
            void submit(missing, '/missing', body, async saved => {
                missing.reset();
                get('clockReviewBucket').value = 'missing';
                get('clockReviewStatus').value = 'open';
                page = 1;
                await Promise.all([load(), open(saved.id, true)]);
            });
        });
        void load();
    }, { once: true });
})();
