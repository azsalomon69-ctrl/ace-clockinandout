(() => {
    const $ = id => document.getElementById(id);
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const hours = seconds => Math.floor(Math.max(0, seconds) / 3600) + 'h ' + Math.floor(Math.max(0, seconds) % 3600 / 60) + 'm';
    const time = value => value ? new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : 'In progress';
    const day = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    let mode = 'ACTIVE', page = 1, total = 0, rows = [], generation = 0, busy = false, hasAccess = false;

    const filters = () => ({ from: $('clientFrom').value, to: $('clientTo').value, status: mode, projectIds: $('clientProject').value ? [$('clientProject').value] : undefined, page });
    const exportEnabled = enabled => { $('clientCsv').disabled = $('clientExcel').disabled = !enabled; };
    const clear = () => {
        rows = []; total = 0;
        $('clientRows').replaceChildren();
        ['clientEmployees', 'clientShifts', 'clientActive', 'clientWorked'].forEach(id => $(id).textContent = '—');
        $('clientActivityDialog').close();
        exportEnabled(false);
    };
    function showState(kind, description) {
        $('clientWorkspace').hidden = true;
        $('clientState').hidden = false;
        $('clientState').setAttribute('aria-busy', String(kind === 'loading'));
        $('clientStateSkeleton').hidden = kind !== 'loading';
        $('clientStateHelp').hidden = kind !== 'no-access';
        $('clientStateAction').hidden = kind === 'loading';
        $('clientStateTitle').textContent = kind === 'loading' ? 'Loading attendance' : kind === 'no-access' ? 'No projects assigned' : 'Attendance unavailable';
        $('clientStateDescription').textContent = description || (kind === 'loading' ? 'Checking your assigned projects.' : 'Ask your administrator to assign projects to your client account. You can then view their employees’ hours and activities here.');
        $('clientStateAction').textContent = kind === 'no-access' ? 'Check again' : 'Try again';
        $('clientStateIcon').src = kind === 'error' ? 'assets/icons/circle-alert.svg' : 'assets/icons/folder.svg';
    }
    function setResultsLoading(loading) {
        $('clientResults').setAttribute('aria-busy', String(loading));
        $('clientResultLoading').hidden = !loading;
        if (loading) {
            $('clientTableScroll').hidden = $('clientResultEmpty').hidden = $('clientPagination').hidden = true;
            exportEnabled(false);
        }
    }
    function renderResults(data) {
        rows = data.items; total = data.total;
        $('clientEmployees').textContent = data.employees;
        $('clientShifts').textContent = total;
        $('clientActive').textContent = data.active;
        $('clientWorked').textContent = hours(data.worked_seconds);
        $('clientRows').innerHTML = rows.map((r, i) => '<tr><td data-label="Employee"><strong>' + escape(r.employee_name || 'Employee') + '</strong></td><td data-label="Project">' + escape(r.project_name) + '</td><td data-label="Clock in">' + escape(time(r.clock_in_at)) + '</td><td data-label="Clock out">' + escape(time(r.clock_out_at)) + '</td><td data-label="Worked">' + hours(r.worked_seconds) + '</td><td data-label="Activities">' + (r.activities.length ? '<button class="client-activity-button" type="button" data-activities="' + i + '">' + r.activities.length + ' activit' + (r.activities.length === 1 ? 'y' : 'ies') + '</button>' : '—') + '</td></tr>').join('');
        $('clientTableScroll').hidden = !rows.length;
        $('clientPagination').hidden = !rows.length;
        $('clientResultEmpty').hidden = Boolean(rows.length);
        if (!rows.length) {
            $('clientEmptyTitle').textContent = mode === 'ACTIVE' ? 'No employees clocked in' : 'No time entries';
            $('clientEmptyDescription').textContent = mode === 'ACTIVE' ? 'Active shifts will appear here when employees clock in to your assigned projects.' : 'There are no entries for the selected project and dates. Try another project or date range.';
            $('clientEmptyAction').textContent = mode === 'ACTIVE' ? 'View history' : 'Reset filters';
        }
        $('clientPage').textContent = 'Page ' + page + ' of ' + Math.max(1, Math.ceil(total / 25));
        $('clientPrevious').disabled = page <= 1;
        $('clientNext').disabled = page * 25 >= total;
        exportEnabled(total > 0);
    }
    async function refresh() {
        if (mode !== 'ACTIVE' && (!$('clientFrom').value || !$('clientTo').value || $('clientTo').value < $('clientFrom').value || (Date.parse($('clientTo').value) - Date.parse($('clientFrom').value)) / 86400000 > 366)) {
            $('clientMessage').textContent = 'Choose a valid date range of up to 12 months.';
            return;
        }
        const current = ++generation;
        busy = true; $('clientRefresh').disabled = true;
        $('clientMessage').textContent = 'Updating…';
        clear();
        if (hasAccess && !$('clientWorkspace').hidden) setResultsLoading(true);
        else showState('loading');
        try {
            const projects = await window.ACEAuth.request('/v1/client/projects');
            if (current !== generation) return;
            const selected = $('clientProject').value;
            $('clientProject').innerHTML = '<option value="">All my projects</option>' + projects.map(p => '<option value="' + escape(p.id) + '">' + escape(p.name) + (p.is_active ? '' : ' · inactive') + '</option>').join('');
            if (projects.some(p => p.id === selected)) $('clientProject').value = selected;
            hasAccess = projects.length > 0;
            if (!hasAccess) { showState('no-access'); $('clientMessage').textContent = ''; return; }
            const data = await window.ACEAuth.request('/v1/client/attendance/search', { method: 'POST', body: JSON.stringify(filters()) });
            if (current !== generation) return;
            if (!data.items.length && data.total > 0 && page > 1) { page = 1; return refresh(); }
            $('clientState').hidden = true;
            $('clientWorkspace').hidden = false;
            setResultsLoading(false);
            renderResults(data);
            $('clientMessage').textContent = 'Last updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (error) {
            if (current !== generation) return;
            clear();
            showState('error', error.status === 403 ? 'Your project access may have changed. Contact your administrator or try again.' : 'We couldn’t load your attendance. Check your connection and try again.');
            $('clientMessage').textContent = '';
        } finally {
            if (current === generation) { busy = false; $('clientRefresh').disabled = false; }
        }
    }
    async function download(format) {
        if (busy || !hasAccess || total === 0) return;
        const button = $(format === 'CSV' ? 'clientCsv' : 'clientExcel');
        button.disabled = true;
        try {
            const response = await window.ACEAuth.authorizedFetch('/v1/client/attendance/export', { method: 'POST', body: JSON.stringify({ ...filters(), format }) });
            if (!response.ok) { const error = await window.ACEAuth.responseBody(response); throw Error(error.error || 'Export unavailable'); }
            const url = URL.createObjectURL(await response.blob());
            const a = document.createElement('a'); a.href = url; a.download = 'client-attendance.' + format.toLowerCase();
            document.body.appendChild(a); a.click(); a.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) {
            ++generation; busy = false; clear(); $('clientRefresh').disabled = false;
            showState('error', 'The export could not be downloaded. Refresh to check your project access and try again.');
            $('clientMessage').textContent = '';
        } finally { if (total > 0) button.disabled = false; }
    }
    $('clientFrom').value = day().slice(0, 8) + '01'; $('clientTo').value = day();
    $('clientFilters').addEventListener('submit', e => { e.preventDefault(); page = 1; void refresh(); });
    $('clientRefresh').addEventListener('click', () => void refresh());
    $('clientStateAction').addEventListener('click', () => void refresh());
    for (const [id, value] of [['clientNow', 'ACTIVE'], ['clientHistory', null]]) $(id).addEventListener('click', () => {
        mode = value; page = 1;
        for (const tab of ['clientNow', 'clientHistory']) { $(tab).classList.toggle('is-active', tab === id); $(tab).setAttribute('aria-pressed', String(tab === id)); }
        document.querySelectorAll('[data-history]').forEach(el => el.hidden = mode === 'ACTIVE');
        $('clientTableTitle').textContent = mode ? 'Working now' : 'Attendance history'; void refresh();
    });
    $('clientEmptyAction').addEventListener('click', () => {
        if (mode === 'ACTIVE') { $('clientHistory').click(); return; }
        $('clientProject').value = ''; $('clientFrom').value = day().slice(0, 8) + '01'; $('clientTo').value = day(); page = 1; void refresh();
    });
    $('clientPrevious').addEventListener('click', () => { if (page > 1) { page--; void refresh(); } });
    $('clientNext').addEventListener('click', () => { if (page * 25 < total) { page++; void refresh(); } });
    $('clientCsv').addEventListener('click', () => void download('CSV')); $('clientExcel').addEventListener('click', () => void download('XLSX'));
    $('clientRows').addEventListener('click', e => {
        const trigger = e.target.closest('[data-activities]'); if (!trigger) return;
        const record = rows[Number(trigger.dataset.activities)]; if (!record) return;
        $('clientActivityList').innerHTML = record.activities.map(a => '<article><strong>' + escape(a.description) + '</strong><span>' + hours(a.ended_at ? Number(a.duration_seconds) || 0 : Math.max(0, (Date.now() - Date.parse(a.started_at)) / 1000)) + '</span></article>').join('');
        $('clientActivityDialog').showModal();
    });
    $('clientCloseActivities').addEventListener('click', () => $('clientActivityDialog').close());
    $('clientSignOut').addEventListener('click', async () => {
        try { await window.ACEAuth.request('/v1/auth/session-end', { method: 'POST' }); await (await window.ACEAuth.client()).auth.signOut(); localStorage.removeItem('ace_current_user'); sessionStorage.removeItem('ace_login_audited'); window.location.replace('/login'); }
        catch (e) { $('clientMessage').textContent = 'Couldn’t sign out. Please try again.'; }
    });
    (async () => {
        try {
            const { profile } = await window.ACEAuth.request('/v1/me');
            if (profile.role !== 'CLIENT') { window.location.replace(profile.role === 'ADMIN' ? '/admin-dashboard' : '/user-dashboard'); return; }
            if (profile.status !== 'ACTIVE') { showState('error', 'Your account is not active. Contact your administrator.'); return; }
            $('clientName').textContent = profile.full_name || 'Client';
            await refresh();
            window.setInterval(() => { if (!document.hidden && !busy) void refresh(); }, 60000);
            window.addEventListener('focus', () => { if (!busy) void refresh(); });
        } catch (e) { showState('error', 'Sign in again to view your assigned projects.'); }
    })();
})();
