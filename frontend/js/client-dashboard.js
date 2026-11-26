(() => {
    if (window.location?.pathname === '/client-dashboard.html') window.history.replaceState(null, '', '/client-dashboard' + window.location.search + window.location.hash);
    const $ = id => document.getElementById(id);
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const hours = seconds => Math.floor(Math.max(0, seconds) / 3600) + 'h ' + Math.floor(Math.max(0, seconds) % 3600 / 60) + 'm';
    const time = value => value ? new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : 'In progress';
    const displayTime = value => {
        if (!value) return '<span class="client-live"><i aria-hidden="true"></i>In progress</span>';
        const date = new Date(value);
        return '<span class="client-cell-date">' + escape(date.toLocaleDateString('en-GB', { timeZone: 'Asia/Manila', day: '2-digit', month: 'short', year: 'numeric' })) + '</span><span class="client-cell-time">' + escape(date.toLocaleTimeString('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' })) + '</span>';
    };
    const day = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    let mode = 'ACTIVE', page = 1, total = 0, rows = [], generation = 0, busy = false, hasAccess = false;

    const filters = () => ({ from: $('clientFrom').value, to: $('clientTo').value, status: mode, projectIds: $('clientProject').value ? [$('clientProject').value] : undefined, page });
    const exportEnabled = enabled => { $('clientCsv').disabled = $('clientExcel').disabled = !enabled; };
    const clear = () => {
        rows = []; total = 0;
        $('clientRows').replaceChildren();
        ['clientEmployees', 'clientShifts', 'clientActive', 'clientWorked'].forEach(id => $(id).textContent = '—');
        $('clientActivityDialog').hidePopover();
        exportEnabled(false);
    };
    function showState(kind, description) {
        $('clientWorkspace').hidden = true;
        $('clientState').hidden = false;
        $('clientState').setAttribute('aria-busy', String(kind === 'loading'));
        $('clientStateSkeleton').hidden = kind !== 'loading';
        $('clientStateHelp').hidden = kind !== 'no-access';
        $('clientStateAction').hidden = kind === 'loading';
        $('clientStateTitle').textContent = kind === 'loading' ? 'Loading attendance' : kind === 'no-access' ? 'No employees to display' : 'Attendance unavailable';
        $('clientStateDescription').textContent = description || (kind === 'loading' ? 'Checking your attendance access.' : 'Your administrator hasn’t granted access to employee attendance yet. Once access is added, their hours and activities will appear here.');
        $('clientStateAction').textContent = kind === 'no-access' ? 'Check again' : 'Try again';
        $('clientStateIcon').src = kind === 'error' ? 'assets/icons/circle-alert.svg' : 'assets/icons/users.svg';
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
        $('clientRows').innerHTML = rows.map((r, i) => '<tr><td data-label="Employee"><div class="client-person"><span class="client-person-avatar" aria-hidden="true">' + escape((r.employee_name || 'Employee').trim().split(/\s+/).map(part => Array.from(part)[0]).slice(0, 2).join('')) + '</span><strong>' + escape(r.employee_name || 'Employee') + '</strong></div></td><td data-label="Project"><span class="client-project-tag">' + escape(r.project_name) + '</span></td><td data-label="Clock in">' + displayTime(r.clock_in_at) + '</td><td data-label="Clock out">' + displayTime(r.clock_out_at) + '</td><td data-label="Worked"><span class="client-duration">' + hours(r.worked_seconds) + '</span></td><td data-label="Activities">' + (r.activities.length ? '<button class="entry-activity-trigger" type="button" data-activities="' + i + '">' + r.activities.length + ' activit' + (r.activities.length === 1 ? 'y' : 'ies') + '</button>' : '—') + '</td></tr>').join('');
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
        $('clientMessage').textContent = '';
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
            showState('error', error.status === 403 ? 'Your attendance access may have changed. Contact your administrator or try again.' : 'We couldn’t load your attendance. Check your connection and try again.');
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
    const openActivities = e => {
        const trigger = e.target.closest('[data-activities]'); if (!trigger) return;
        const record = rows[Number(trigger.dataset.activities)]; if (!record) return;
        $('clientActivityList').innerHTML = record.activities.map(a => '<div class="entry-activity-line"><span>' + escape(record.project_name || 'No project') + '</span><span>' + escape(a.description) + '</span><time>' + hours(a.ended_at ? Number(a.duration_seconds) || 0 : Math.max(0, (Date.now() - Date.parse(a.started_at)) / 1000)) + '</time></div>').join('');
        const popover = $('clientActivityDialog');
        if (!popover.matches(':popover-open')) popover.showPopover();
        const anchor = trigger.getBoundingClientRect(), width = Math.min(440, innerWidth - 24);
        popover.style.width = width + 'px';
        popover.style.left = Math.max(12, Math.min(anchor.left, innerWidth - width - 12)) + 'px';
        const height = Math.min(popover.scrollHeight, 360);
        popover.style.top = (innerHeight - anchor.bottom >= height + 20 ? anchor.bottom + 8 : Math.max(12, anchor.top - height - 8)) + 'px';
    };
    $('clientRows').addEventListener('click', openActivities);
    let activityOpenTimer, activityCloseTimer;
    $('clientRows').addEventListener('pointerover', e => { if (e.pointerType !== 'mouse' || e.buttons || !e.target.closest('[data-activities]')) return; clearTimeout(activityCloseTimer); clearTimeout(activityOpenTimer); activityOpenTimer = setTimeout(() => openActivities(e), 140); });
    const scheduleActivityClose = () => { clearTimeout(activityOpenTimer); activityCloseTimer = setTimeout(() => { if (!$('clientActivityDialog').matches(':hover') && !$('clientActivityDialog').contains(document.activeElement)) $('clientActivityDialog').hidePopover(); }, 240); };
    $('clientRows').addEventListener('pointerout', e => { if (e.pointerType === 'mouse') scheduleActivityClose(); });
    $('clientActivityDialog').addEventListener('pointerenter', () => clearTimeout(activityCloseTimer));
    $('clientActivityDialog').addEventListener('pointerleave', scheduleActivityClose);
    window.addEventListener('resize', () => $('clientActivityDialog').hidePopover());
    $('clientCloseActivities').addEventListener('click', () => $('clientActivityDialog').hidePopover());
    const accountButton = $('clientAccountButton');
    const accountMenu = $('clientAccountMenu');
    const closeAccountMenu = () => { if (accountMenu.matches(':popover-open')) accountMenu.hidePopover(); };
    accountMenu.addEventListener('beforetoggle', event => {
        const opening = event.newState === 'open';
        accountButton.setAttribute('aria-expanded', String(opening));
        if (opening) {
            const bounds = accountButton.getBoundingClientRect();
            const width = Math.min(300, window.innerWidth - 32);
            accountMenu.style.width = width + 'px';
            accountMenu.style.left = Math.max(16, Math.min(bounds.right - width, window.innerWidth - width - 16)) + 'px';
            accountMenu.style.top = bounds.bottom + 10 + 'px';
        }
    });
    accountMenu.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); closeAccountMenu(); accountButton.focus(); }
    });
    window.addEventListener('resize', closeAccountMenu);
    window.addEventListener('scroll', closeAccountMenu, { passive: true });
    $('clientAccountDetails').addEventListener('click', () => { closeAccountMenu(); $('clientAccountDialog').showModal(); });
    $('clientCloseAccount').addEventListener('click', () => { $('clientAccountDialog').close(); accountButton.focus(); });
    $('clientAccountHelp').addEventListener('click', () => { closeAccountMenu(); $('clientHelpDialog').showModal(); });
    $('clientCloseHelp').addEventListener('click', () => { $('clientHelpDialog').close(); accountButton.focus(); });
    $('clientAccountDialog').addEventListener('close', () => accountButton.focus());
    $('clientHelpDialog').addEventListener('close', () => accountButton.focus());
    const deviceTheme = window.matchMedia?.('(prefers-color-scheme: dark)');
    let appearance = 'light';
    const readAppearance = () => {
        try {
            const preferences = JSON.parse(localStorage.getItem('ace_appearance_preferences') || '{}');
            if (['light', 'dark', 'system'].includes(preferences.theme)) return preferences.theme;
            const previousClientTheme = localStorage.getItem('ace_client_appearance');
            if (['light', 'dark', 'system'].includes(previousClientTheme)) {
                localStorage.setItem('ace_appearance_preferences', JSON.stringify({ ...preferences, theme: previousClientTheme }));
                localStorage.removeItem('ace_client_appearance');
                return previousClientTheme;
            }
        } catch { /* Appearance must still work when storage is unavailable. */ }
        return 'light';
    };
    const applyAppearance = () => {
        document.documentElement.dataset.themePreference = appearance;
        document.documentElement.dataset.theme = appearance === 'system' ? (deviceTheme?.matches ? 'dark' : 'light') : appearance;
        $('clientAppearance').value = appearance;
    };
    appearance = readAppearance();
    applyAppearance();
    deviceTheme?.addEventListener('change', applyAppearance);
    window.addEventListener('storage', event => {
        if (event.key === 'ace_appearance_preferences') { appearance = readAppearance(); applyAppearance(); }
    });
    $('clientAppearance').addEventListener('change', () => {
        appearance = $('clientAppearance').value;
        applyAppearance();
        try {
            const preferences = JSON.parse(localStorage.getItem('ace_appearance_preferences') || '{}');
            localStorage.setItem('ace_appearance_preferences', JSON.stringify({ ...preferences, theme: appearance }));
        } catch { /* The selected theme still works for this session. */ }
    });
    $('clientSignOut').addEventListener('click', async () => {
        try { await window.ACEAuth.request('/v1/auth/session-end', { method: 'POST' }); await (await window.ACEAuth.client()).auth.signOut(); localStorage.removeItem('ace_current_user'); sessionStorage.removeItem('ace_login_audited'); window.location.replace('/login'); }
        catch (e) { $('clientMessage').textContent = 'Couldn’t sign out. Please try again.'; }
    });
    function updateAccountIdentity(profile) {
            const name = profile.full_name || 'Client';
            $('clientName').textContent = $('clientMenuName').textContent = $('clientProfileName').textContent = name;
            $('clientMenuEmail').textContent = $('clientProfileEmail').textContent = profile.email || 'Email not available';
            const initials = name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('').toUpperCase();
            for (const id of ['clientAvatar', 'clientProfileAvatar']) {
                const avatar = $(id); avatar.textContent = initials;
                if (!profile.profile_picture_url) continue;
                let url; try { url = new URL(profile.profile_picture_url); } catch { continue; }
                if (url.protocol !== 'https:') continue;
                const image = document.createElement('img');
                image.alt = ''; image.referrerPolicy = 'no-referrer';
                image.addEventListener('error', () => { if (image.parentNode === avatar) avatar.textContent = initials; }, { once: true });
                image.src = url.href; avatar.replaceChildren(image);
            }
            accountButton.setAttribute('aria-label', 'Account options for ' + name);
    }
    (async () => {
        try {
            const { profile } = await window.ACEAuth.request('/v1/me');
            if (profile.role !== 'CLIENT') { window.location.replace(profile.role === 'ADMIN' ? '/admin-dashboard' : '/user-dashboard'); return; }
            if (profile.status !== 'ACTIVE') { showState('error', 'Your account is not active. Contact your administrator.'); return; }
            updateAccountIdentity(profile);
            await refresh();
            window.setInterval(() => { if (!document.hidden && !busy) void refresh(); }, 60000);
            window.addEventListener('focus', async () => {
                if (!busy) void refresh();
                try { const { profile: current } = await window.ACEAuth.request('/v1/me'); if (current.role === 'CLIENT' && current.status === 'ACTIVE') updateAccountIdentity(current); } catch { /* Retain the last verified account display if offline. */ }
            });
        } catch (e) { showState('error', 'Sign in again to view employee attendance.'); }
    })();
})();
