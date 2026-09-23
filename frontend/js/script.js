// Akio <3: Project source maintained by Akio Zaki Salomon.
// ============================================
// ACE Clock In/Out System - Main JavaScript
// ============================================

// Global State
const AppState = {
    currentUser: null,
    isAuthenticated: false,
    isClockedIn: false,
    currentSession: null,
    presenceInterval: null,
    presenceVisibilityHandler: null,
    onlineCountInterval: null,
    liveDataInterval: null,
    liveRefreshInFlight: false,
    clockInTime: null,
    timerInterval: null,
    remarkNotificationInterval: null,
    projects: [],
    departments: [],
    timeEntries: [],
    reports: [],
    users: [],
    invitations: [],
    auditLogs: [],
    userProjects: [],
    adminRemarks: [],
    assignedSchedule: null,
    scheduleAlertKeys: new Set(),
    recentEntriesPage: 1,
    recentEntriesPageSize: 3,
    database: null
};
window.AppState = AppState;

const profileRecord = item => ({ UserId: item.id, Email: item.email, FullName: item.full_name, ProfilePictureUrl: item.profile_picture_url, Role: item.role, Status: item.status, DepartmentId: item.department_id, LastSeenAt: item.last_seen_at, CreatedAt: item.created_at, IsHeadAdmin: Boolean(item.is_head_admin), RawTutorial: { tutorial_status: item.tutorial_status, tutorial_step: item.tutorial_step, tutorial_version: item.tutorial_version } });
// Render serves the real .html files, while these clean routes are resolved by
// the Static Site rewrite rules. Keep every internal page link canonical.
const cleanInternalRoute = value => {
    const url = new URL(value, window.location.href);
    if (url.origin !== window.location.origin || !/\.html$/i.test(url.pathname)) return value;
    url.pathname = url.pathname.replace(/\/index\.html$/i, '/').replace(/\.html$/i, '');
    return `${url.pathname}${url.search}${url.hash}`;
};
const cleanInternalPageLinks = root => root.querySelectorAll?.('a[href]').forEach(link => {
    const href = link.getAttribute('href');
    if (!href || /^(?:#|mailto:|tel:|javascript:)/i.test(href)) return;
    const cleaned = cleanInternalRoute(href);
    if (cleaned !== href) link.setAttribute('href', cleaned);
});
const enableCleanInternalPageLinks = () => {
    cleanInternalPageLinks(document);
    new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) cleanInternalPageLinks(node);
    }))).observe(document.body, { childList: true, subtree: true });
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enableCleanInternalPageLinks, { once: true });
else enableCleanInternalPageLinks();
const departmentRecord = item => ({ DepartmentId: item.id, DepartmentName: item.name, Description: item.description, IsActive: item.is_active, CreatedAt: item.created_at });
const projectRecord = item => ({ ProjectId: item.id, ProjectName: item.name, Description: item.description, IsActive: item.is_active, CreatedAt: item.created_at });
const timeEntryRecord = item => ({ TimeEntryId: item.id, UserId: item.user_id, ProjectId: item.project_id, ClockInAt: item.clock_in_at, ClockOutAt: item.clock_out_at, UserNote: item.user_note, FinalNote: item.final_note, StoppedByName: item.stopped_by?.full_name || item.stopped_by?.email || '', StoppedByAt: item.stopped_by_at, DurationSeconds: item.duration_seconds, ProjectName: item.projects?.name, UserName: item.profiles?.full_name });
const adminRemarkRecord = item => ({ RemarkId: item.id, TimeEntryId: item.time_entry_id, AdminUserId: item.admin_user_id, Remark: item.remark, CreatedAt: item.created_at, SeenAt: item.seen_at, AdminName: item.profiles?.full_name || item.profiles?.email || 'Administrator' });
const employeeTimeEntries = () => AppState.timeEntries.filter(entry => AppState.users.find(user => String(user.UserId) === String(entry.UserId))?.Role === 'USER');
const reportRecord = item => ({ ReportId: item.id, CreatedByUserId: item.created_by_user_id, ReportType: item.report_type, DateFrom: item.date_from, DateTo: item.date_to, Filters: item.filters, GeneratedAt: item.generated_at, TotalRecords: item.total_records });
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
const avatarInitials = value => {
    const words = String(value || '?').trim().split(/[\s@._-]+/).filter(Boolean);
    return (words.length > 1 ? words.slice(0, 2).map(word => word[0]) : String(words[0] || '?').slice(0, 2)).join('').toUpperCase();
};
const avatarTone = value => [...String(value || '?')].reduce((total, character) => total + character.charCodeAt(0), 0) % 5;
const avatarContent = (name, picture) => picture
    ? `<img src="${escapeHtml(picture)}" alt="">`
    : `<span class="avatar-fallback avatar-tone-${avatarTone(name)}" aria-hidden="true">${escapeHtml(avatarInitials(name))}</span>`;
const formatAppDate = value => value ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value)) : '—';
const formatAppDateTime = value => value ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)) : '—';
const formatAppTime = value => value ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)) : '—';
const formatReportType = value => String(value || '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
const reportDate = value => {
    if (!value) return '—';
    return formatAppDate(`${value}T00:00:00`);
};
const reportDateTime = value => {
    return formatAppDateTime(value);
};
const defaultScheduleWeekdays = [1, 2, 3, 4, 5];
const isScheduledToday = (schedule, date = new Date()) => {
    const weekdays = Array.isArray(schedule?.scheduled_weekdays) && schedule.scheduled_weekdays.length ? schedule.scheduled_weekdays.map(Number) : defaultScheduleWeekdays;
    return weekdays.includes(date.getDay());
};

// Native select popups differ wildly between browsers and operating systems.
// Keep the original select for its value, form behaviour and existing change
// handlers, then provide one consistent, keyboard-friendly menu above it.
let aceSelectObserver;
let aceAutocompleteObserver;
function closeAceSelectMenus(except = null) {
    document.querySelectorAll('.ace-select.is-open').forEach(control => {
        if (control === except) return;
        control.classList.remove('is-open');
        control.querySelector('.ace-select-trigger')?.setAttribute('aria-expanded', 'false');
    });
    document.querySelectorAll('.analytics-toolbar.ace-select-menu-open').forEach(toolbar => toolbar.classList.remove('ace-select-menu-open'));
    if (except?.closest('.analytics-toolbar')) except.closest('.analytics-toolbar').classList.add('ace-select-menu-open');
}

function enhanceSelectControl(select) {
    if (!(select instanceof HTMLSelectElement) || !select.classList.contains('form-select')) return;
    if (select.classList.contains('ace-native-select')) {
        select._aceSelectRefresh?.();
        return;
    }
    const control = document.createElement('div');
    control.className = 'ace-select';
    const trigger = document.createElement('button');
    trigger.className = 'ace-select-trigger';
    trigger.type = 'button';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    const menu = document.createElement('div');
    menu.className = 'ace-select-menu';
    menu.setAttribute('role', 'listbox');
    select.classList.add('ace-native-select');
    select.insertAdjacentElement('afterend', control);
    control.append(trigger, menu);

    const label = select.closest('label') || (select.id ? document.querySelector(`label[for="${CSS.escape(select.id)}"]`) : null);
    const refresh = () => {
        const selected = select.options[select.selectedIndex];
        trigger.innerHTML = `<span>${escapeHtml(selected?.textContent || 'Select an option')}</span><i aria-hidden="true"></i>`;
        trigger.disabled = select.disabled;
        const labelText = select.getAttribute('aria-label') || label?.childNodes?.[0]?.textContent?.trim() || 'Select an option';
        trigger.setAttribute('aria-label', labelText);
        menu.innerHTML = Array.from(select.options).map((option, index) => `<button class="ace-select-option${option.selected ? ' is-selected' : ''}" type="button" role="option" aria-selected="${option.selected}" data-index="${index}"${option.disabled ? ' disabled' : ''}>${escapeHtml(option.textContent)}</button>`).join('');
        menu.querySelectorAll('.ace-select-option').forEach(optionButton => optionButton.addEventListener('click', () => {
            const option = select.options[Number(optionButton.dataset.index)];
            if (!option || option.disabled) return;
            select.selectedIndex = Number(optionButton.dataset.index);
            select.dispatchEvent(new Event('change', { bubbles: true }));
            closeAceSelectMenus();
            trigger.focus();
        }));
    };
    select._aceSelectRefresh = refresh;
    refresh();
    select.addEventListener('change', refresh);
    trigger.addEventListener('click', () => {
        if (trigger.disabled) return;
        const opening = !control.classList.contains('is-open');
        closeAceSelectMenus(opening ? control : null);
        control.classList.toggle('is-open', opening);
        trigger.setAttribute('aria-expanded', String(opening));
        if (opening) menu.querySelector('.is-selected:not(:disabled), .ace-select-option:not(:disabled)')?.focus();
    });
    trigger.addEventListener('keydown', event => {
        if (event.key === 'Escape') { closeAceSelectMenus(); trigger.focus(); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (!control.classList.contains('is-open')) trigger.click();
        }
    });
}

function initializeSelectControls(root = document) {
    root.querySelectorAll?.('select.form-select:not(.ace-native-select)').forEach(enhanceSelectControl);
    if (aceSelectObserver) return;
    document.addEventListener('pointerdown', event => { if (!event.target.closest('.ace-select')) closeAceSelectMenus(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeAceSelectMenus(); });
    aceSelectObserver = new MutationObserver(records => records.forEach(record => {
        if (record.type === 'childList' && record.target instanceof HTMLSelectElement && record.target.classList.contains('ace-native-select')) record.target._aceSelectRefresh?.();
        record.addedNodes.forEach(node => {
            if (!(node instanceof Element)) return;
            if (node.matches?.('select.form-select:not(.ace-native-select)')) enhanceSelectControl(node);
            node.querySelectorAll?.('select.form-select:not(.ace-native-select)').forEach(enhanceSelectControl);
        });
    }));
    aceSelectObserver.observe(document.body, { childList: true, subtree: true });
}

// Browser datalist popups cannot be styled consistently (and some browsers use
// an opaque black system bubble). Replace the presentation layer while keeping
// the original input value and change events that the existing filters use.
function closeAceAutocompleteMenus(except = null) {
    document.querySelectorAll('.ace-autocomplete.is-open').forEach(control => {
        if (control === except) return;
        control.classList.remove('is-open');
        control.querySelector('.ace-autocomplete-input')?.setAttribute('aria-expanded', 'false');
    });
    document.querySelectorAll('.analytics-toolbar.ace-autocomplete-menu-open').forEach(toolbar => toolbar.classList.remove('ace-autocomplete-menu-open'));
    if (except?.closest('.analytics-toolbar')) except.closest('.analytics-toolbar').classList.add('ace-autocomplete-menu-open');
}

function enhanceDatalistControl(input) {
    if (!(input instanceof HTMLInputElement) || input.dataset.aceAutocompleteBound) return;
    const listId = input.getAttribute('list');
    const datalist = listId && document.getElementById(listId);
    if (!(datalist instanceof HTMLDataListElement)) return;

    input.dataset.aceAutocompleteBound = 'true';
    input.dataset.aceDatalist = listId;
    input.removeAttribute('list');
    input.classList.add('ace-autocomplete-input');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');

    const control = document.createElement('div');
    control.className = 'ace-autocomplete';
    const menu = document.createElement('div');
    const menuId = `${input.id || listId}-ace-menu`;
    menu.className = 'ace-autocomplete-menu';
    menu.id = menuId;
    menu.setAttribute('role', 'listbox');
    input.setAttribute('aria-controls', menuId);
    input.insertAdjacentElement('beforebegin', control);
    control.append(input, menu);

    let activeIndex = -1;
    const options = () => Array.from(datalist.options).map(option => option.value || option.textContent || '').filter(Boolean);
    const choose = value => {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        closeAceAutocompleteMenus();
    };
    const render = () => {
        const query = input.value.trim().toLowerCase();
        const values = options().filter(value => !query || value.toLowerCase().includes(query));
        activeIndex = values.length ? Math.min(Math.max(activeIndex, 0), values.length - 1) : -1;
        menu.innerHTML = values.length
            ? values.map((value, index) => `<button class="ace-autocomplete-option${index === activeIndex ? ' is-active' : ''}" type="button" role="option" aria-selected="${index === activeIndex}" data-value="${escapeHtml(value)}">${escapeHtml(value)}</button>`).join('')
            : '<p class="ace-autocomplete-empty">No matches</p>';
        menu.querySelectorAll('.ace-autocomplete-option').forEach(button => button.addEventListener('mousedown', event => {
            event.preventDefault(); choose(button.dataset.value || ''); input.focus();
        }));
        return values;
    };
    const open = () => {
        activeIndex = -1;
        const values = render();
        control.classList.toggle('is-open', Boolean(values.length));
        input.setAttribute('aria-expanded', String(Boolean(values.length)));
        if (values.length) closeAceAutocompleteMenus(control);
    };
    datalist._aceAutocompleteRefresh = () => { if (control.classList.contains('is-open')) open(); };
    input.addEventListener('focus', open);
    input.addEventListener('input', open);
    input.addEventListener('keydown', event => {
        const values = options().filter(value => !input.value.trim() || value.toLowerCase().includes(input.value.trim().toLowerCase()));
        if (event.key === 'Escape') { closeAceAutocompleteMenus(); return; }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!control.classList.contains('is-open')) { open(); return; }
            activeIndex = values.length ? (activeIndex + (event.key === 'ArrowDown' ? 1 : values.length - 1)) % values.length : -1;
            render();
        } else if (event.key === 'Enter' && control.classList.contains('is-open') && activeIndex >= 0) {
            event.preventDefault(); choose(values[activeIndex]);
        }
    });
}

function initializeAutocompleteControls(root = document) {
    root.querySelectorAll?.('input[list]:not([data-ace-autocomplete-bound])').forEach(enhanceDatalistControl);
    if (aceAutocompleteObserver) return;
    document.addEventListener('pointerdown', event => { if (!event.target.closest('.ace-autocomplete')) closeAceAutocompleteMenus(); });
    aceAutocompleteObserver = new MutationObserver(records => records.forEach(record => {
        if (record.type === 'childList' && record.target instanceof HTMLDataListElement) record.target._aceAutocompleteRefresh?.();
        record.addedNodes.forEach(node => {
            if (!(node instanceof Element)) return;
            if (node.matches?.('input[list]:not([data-ace-autocomplete-bound])')) enhanceDatalistControl(node);
            node.querySelectorAll?.('input[list]:not([data-ace-autocomplete-bound])').forEach(enhanceDatalistControl);
        });
    }));
    aceAutocompleteObserver.observe(document.body, { childList: true, subtree: true });
}

// Live data is supplied exclusively by the Render API and Supabase.
async function loadDatabase() {
    if (!window.ACEAuth) throw new Error('Authentication service is unavailable.');
    const { profile } = await window.ACEAuth.request('/v1/me');
    AppState.currentUser = profileRecord(profile);
    AppState.isAuthenticated = true;
    localStorage.setItem('ace_current_user', JSON.stringify(AppState.currentUser));
    // The identity is server-verified at this point. Let the persistent shell
    // appear while the remaining page data is fetched, instead of making the
    // workspace look like a full-page reload on every navigation.
    window.dispatchEvent(new CustomEvent('ace:verified-profile-ready'));
    const [departments, projects, entries, userProjects, remarks, assignedSchedule] = await Promise.all([
        window.ACEAuth.request('/v1/departments'),
        window.ACEAuth.request('/v1/projects'),
        window.ACEAuth.request(`/v1/time-entries${AppState.currentUser.Role === 'ADMIN' ? '' : '?mine=true'}`),
        window.ACEAuth.request('/v1/user-projects'),
        window.ACEAuth.request('/v1/admin-remarks'),
        window.ACEAuth.request('/v1/my-schedule')
    ]);
    AppState.departments = departments.map(departmentRecord);
    AppState.projects = projects.map(projectRecord);
    AppState.timeEntries = entries.map(timeEntryRecord);
    AppState.adminRemarks = remarks.map(adminRemarkRecord);
    AppState.assignedSchedule = assignedSchedule;
    AppState.userProjects = userProjects.map(item => ({ UserId: item.user_id, ProjectId: item.project_id, AssignedAt: item.assigned_at, IsActive: true }));
    if (AppState.currentUser.Role === 'ADMIN') {
        const [users, invitations, reports, auditLogs] = await Promise.all([
            window.ACEAuth.request('/v1/users'), window.ACEAuth.request('/v1/invitations'),
            window.ACEAuth.request('/v1/reports'), window.ACEAuth.request('/v1/audit-logs')
        ]);
        AppState.users = users.map(profileRecord);
        AppState.invitations = invitations;
        AppState.reports = reports.map(reportRecord);
        AppState.auditLogs = auditLogs;
    } else {
        AppState.users = [AppState.currentUser]; AppState.invitations = []; AppState.reports = []; AppState.auditLogs = [];
    }
    // Administrators load the whole team's entries for reporting. Only the
    // signed-in person's entry may control their timer or browser reminders.
    const active = AppState.timeEntries.find(entry =>
        !entry.ClockOutAt && entry.UserId === AppState.currentUser.UserId
    );
    AppState.currentSession = active || null;
    AppState.isClockedIn = Boolean(active);
    AppState.clockInTime = active ? new Date(active.ClockInAt) : null;
    if (active) startTimer();
    return true;
}

const pause = milliseconds => new Promise(resolve => window.setTimeout(resolve, milliseconds));
const deniedAccessRequestMessage = 'Your access request was denied. Contact an administrator if you believe this is a mistake.';

async function loadDatabaseWhenServiceIsReady() {
    // Free Render services can sleep. Keep the page skeleton visible while the
    // service wakes, and only reveal the application after a complete live load.
    const retryDelays = [1500, 2500, 4000, 6000, 8000, 10000, 10000, 10000, 10000];
    let lastError;
    for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
        try {
            return await loadDatabase();
        } catch (error) {
            lastError = error;
            const retryable = !error.status || error.status >= 500 || error.status === 429;
            if (!retryable || attempt === retryDelays.length) throw error;
            console.info(`Waiting for ACE services to wake up (attempt ${attempt + 1}).`);
            await pause(retryDelays[attempt]);
        }
    }
    throw lastError;
}

// Initialize App
async function initApp() {
    // The application shell is independent of page data. Keep it resilient so
    // a stale browser preference can never leave an empty sidebar-sized gap.
    try {
        applySuppliedIcons();
        applyStoredAppearance();
        // A previously verified profile is used only to paint the navigation
        // chrome immediately. It never authorizes data or bypasses the /v1/me
        // check below; that remains the source of truth for every refresh.
        mountCachedDashboardShell();
        renderInitialSkeletons();
    } catch (error) {
        console.warn('Recovered from a saved interface preference.', error);
        localStorage.removeItem('ace_current_user');
        localStorage.removeItem('ace_current_session');
    }
    if (isPublicRoute()) {
        await resumePublicSession();
        initializeNavigation();
        initializeModals();
        initializeForms();
        initializeSelectControls();
        initializeAutocompleteControls();
        if (document.body.dataset.openAccessRequest === 'true') {
            delete document.body.dataset.openAccessRequest;
            window.setTimeout(() => openModal('requestAccessModal'), 0);
        }
        initializeUXEnhancements();
        const loginNotice = sessionStorage.getItem('ace_login_notice');
        if (loginNotice) {
            sessionStorage.removeItem('ace_login_notice');
            window.setTimeout(() => showToast(loginNotice, 'warning'), 0);
        }
        clearInitialSkeletons();
        return;
    }

    let earlyShellMounted = false;
    const mountVerifiedShell = () => {
        if (earlyShellMounted) return;
        try { earlyShellMounted = initializeAppShell(); }
        catch (error) { console.error('Could not mount the application navigation.', error); }
    };
    window.addEventListener('ace:verified-profile-ready', mountVerifiedShell, { once: true });
    let loaded;
    try {
        loaded = await loadDatabaseWhenServiceIsReady();
    } catch (error) {
        // Static files can be requested directly, but protected page
        // content must never be mounted unless the Render API confirms a valid
        // Supabase session.  A missing, expired, or disallowed session belongs
        // on the sign-in page instead of briefly exposing a dashboard shell.
        if (error?.status === 401 || error?.status === 403) {
            sessionStorage.setItem('ace_login_notice', AppState.currentUser?.Status === 'DENIED'
                ? deniedAccessRequestMessage
                : error.message || 'Unable to load your account.');
            localStorage.removeItem('ace_current_user');
            localStorage.removeItem('ace_current_session');
            sessionStorage.removeItem('ace_login_audited');
            window.location.replace('/login');
            return;
        }
        throw error;
    }
    window.removeEventListener('ace:verified-profile-ready', mountVerifiedShell);
    if (loaded) {
        let shellMounted = earlyShellMounted;
        if (!shellMounted) {
            try { shellMounted = initializeAppShell(); }
            catch (error) { console.error('Could not mount the application navigation.', error); }
        }
        if (!shellMounted) return;
        startPresenceHeartbeat();
        initializeNavigation();
        initializeModals();
        initializeForms();
        updateUI();
        startClock();
        loadPageSpecificData();
        initializeSelectControls();
        initializeAutocompleteControls();
        initializeResponsiveTables();
        initializeUXEnhancements();
        initializeEmployeeChat();
        startRemarkNotifications();
        startLiveDataRefresh();
    }
    clearInitialSkeletons();
    requestAnimationFrame(() => {
        document.body.classList.remove('app-shell-pending');
        document.querySelector('.app-shell-skeleton')?.remove();
        if (loaded) window.dispatchEvent(new CustomEvent('ace:app-ready'));
    });
}

function mountCachedDashboardShell() {
    if (isPublicRoute() || document.body.classList.contains('has-app-shell')) return;
    try {
        const cached = JSON.parse(localStorage.getItem('ace_current_user') || 'null');
        if (!cached || cached.Status !== 'ACTIVE' || !cached.UserId || !cached.Role) return;
        AppState.currentUser = cached;
        initializeAppShell();
    } catch {
        // A damaged cache simply falls back to the protected loading state.
    }
}

// Tables stay semantic on desktop, then become labelled record cards on phones.
// This avoids clipped columns without duplicating data markup for every page.
function initializeResponsiveTables() {
    if (document.body.dataset.responsiveTablesReady === 'true') return;
    document.body.dataset.responsiveTablesReady = 'true';
    const labelCells = root => {
        root.querySelectorAll('table').forEach(table => {
            const labels = Array.from(table.querySelectorAll('thead th')).map(header => header.textContent.trim());
            if (!labels.length) return;
            table.querySelectorAll('tbody tr').forEach(row => {
                Array.from(row.children).forEach((cell, index) => {
                    if (cell.tagName === 'TD' && !cell.hasAttribute('colspan')) cell.dataset.label = labels[index] || '';
                });
            });
        });
    };
    labelCells(document);
    const observer = new MutationObserver(records => {
        records.forEach(record => record.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) labelCells(node.closest?.('table') || node);
        }));
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

function isPublicRoute() {
    const routeName = (window.location.pathname.split('/').pop() || '').toLowerCase();
    return !routeName || routeName === 'index.html' || routeName === 'login.html' || routeName === 'index' || routeName === 'login';
}

async function resumePublicSession() {
    if (!window.ACEAuth) return;
    const auth = await window.ACEAuth.client();
    const { data: { session } } = await auth.auth.getSession();
    if (!session) return;
    const { profile } = await window.ACEAuth.request('/v1/me');
    AppState.currentUser = profileRecord(profile);
    AppState.isAuthenticated = true;
    localStorage.setItem('ace_current_user', JSON.stringify(AppState.currentUser));
    if (AppState.currentUser.Status === 'ACTIVE') {
        await recordLoginOnce();
        window.location.replace(AppState.currentUser.Role === 'ADMIN' ? '/admin-dashboard' : '/user-dashboard');
    } else if (AppState.currentUser.Status === 'DENIED') {
        sessionStorage.setItem('ace_login_notice', deniedAccessRequestMessage);
    } else {
        document.body.dataset.openAccessRequest = 'true';
    }
}

async function recordLoginOnce() {
    if (sessionStorage.getItem('ace_login_audited') === 'true' || !window.ACEAuth) return;
    try {
        await window.ACEAuth.request('/v1/auth/session-start', { method: 'POST' });
        sessionStorage.setItem('ace_login_audited', 'true');
    } catch (error) {
        console.warn('Could not record login audit event.', error);
    }
}

function redirectAuthenticatedPublicRoute() {
    const routeName = (window.location.pathname.split('/').pop() || '').toLowerCase();
    const isPublicRoute = !routeName || routeName === 'index.html' || routeName === 'login.html' || routeName === 'index' || routeName === 'login';
    if (!isPublicRoute || AppState.currentUser?.Status !== 'ACTIVE') return;
    window.location.replace(AppState.currentUser.Role === 'ADMIN' ? '/admin-dashboard' : '/user-dashboard');
}

function applyStoredAppearance() {
    try {
        const appearance = JSON.parse(localStorage.getItem('ace_appearance_preferences') || '{}');
        document.documentElement.dataset.fontSize = appearance.fontSize || 'medium';
        applyTheme(appearance.theme || 'light');
        document.body.classList.toggle('compact-mode', Boolean(appearance.compact));
    } catch (error) {
        document.documentElement.dataset.fontSize = 'medium';
        applyTheme('light');
    }
}

function applyTheme(theme) {
    const resolvedTheme = theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : theme;
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.themePreference = theme;
}

const systemThemeMedia = window.matchMedia('(prefers-color-scheme: dark)');
if (systemThemeMedia.addEventListener) {
    systemThemeMedia.addEventListener('change', () => {
        if (document.documentElement.dataset.themePreference === 'system') applyTheme('system');
    });
}

function renderInitialSkeletons() {
    const shell = document.querySelector('.app-shell-skeleton');
    if (shell) {
        const page = (window.location.pathname.split('/').pop() || '').toLowerCase();
        const managementPages = ['users.html', 'deleted-users.html', 'invitations.html', 'access-requests.html', 'departments.html', 'projects.html', 'schedule-flex.html', 'admin-time-entries.html', 'deleted-time-entries.html', 'audit-logs.html'];
        const rows = count => Array.from({ length: count }, () => '<div class="shell-skeleton-row"></div>').join('');
        const header = '<div class="shell-skeleton-header"><div class="shell-skeleton-title"></div><div class="shell-skeleton-subtitle"></div></div>';
        if (page === 'admin-dashboard.html') {
            shell.innerHTML = `<main class="shell-skeleton-main shell-skeleton-dashboard">${header}<div class="shell-skeleton-stats">${'<div class="shell-skeleton-stat"></div>'.repeat(4)}</div><section class="shell-skeleton-analytics"><div class="shell-skeleton-panel shell-skeleton-filter-panel"><div class="shell-skeleton-panel-title"></div><div class="shell-skeleton-filter-row">${'<i></i>'.repeat(4)}</div></div><div class="shell-skeleton-analytics-grid"><div class="shell-skeleton-panel">${rows(4)}</div><div class="shell-skeleton-panel">${rows(4)}</div></div></section></main>`;
        } else if (page === 'user-dashboard.html') {
            shell.innerHTML = `<main class="shell-skeleton-main shell-skeleton-employee">${header}<div class="shell-skeleton-employee-grid"><section class="shell-skeleton-clock"><div class="shell-skeleton-orb"></div><div class="shell-skeleton-title"></div><div class="shell-skeleton-button"></div></section><section class="shell-skeleton-panel">${rows(4)}</section></div><section class="shell-skeleton-panel">${rows(3)}</section></main>`;
        } else if (managementPages.includes(page)) {
            shell.innerHTML = `<main class="shell-skeleton-main shell-skeleton-management">${header}<div class="shell-skeleton-stats">${'<div class="shell-skeleton-stat"></div>'.repeat(3)}</div><section class="shell-skeleton-panel shell-skeleton-table"><div class="shell-skeleton-table-head"><div class="shell-skeleton-panel-title"></div><i></i></div>${rows(6)}</section></main>`;
        } else if (page === 'reports.html') {
            shell.innerHTML = `<main class="shell-skeleton-main shell-skeleton-reports">${header}<section class="shell-skeleton-panel shell-skeleton-table"><div class="shell-skeleton-table-head"><div class="shell-skeleton-panel-title"></div><i></i></div>${rows(5)}</section></main>`;
        } else if (page === 'settings.html') {
            shell.innerHTML = `<main class="shell-skeleton-main shell-skeleton-settings">${header}<div class="shell-skeleton-settings-grid"><aside class="shell-skeleton-panel">${rows(4)}</aside><section class="shell-skeleton-panel">${rows(6)}</section></div></main>`;
        } else if (page === 'chat-log.html') {
            shell.innerHTML = `<main class="shell-skeleton-main shell-skeleton-chat">${header}<section class="shell-skeleton-panel"><div class="shell-skeleton-chat-layout"><aside>${rows(7)}</aside><div>${rows(8)}</div></div></section></main>`;
        } else if (page === 'time-entries.html') {
            shell.innerHTML = `<main class="shell-skeleton-main shell-skeleton-entries">${header}<section class="shell-skeleton-panel shell-skeleton-filter-panel"><div class="shell-skeleton-filter-row">${'<i></i>'.repeat(4)}</div></section><section class="shell-skeleton-panel shell-skeleton-table">${rows(6)}</section></main>`;
        }
    }
    const tableBody = document.querySelector('tbody[id]');
    if (tableBody && !tableBody.children.length) {
        const columns = tableBody.closest('table')?.querySelectorAll('thead th').length || 5;
        tableBody.dataset.skeleton = 'true';
        tableBody.innerHTML = Array.from({ length: 4 }, () => `<tr class="skeleton-table-row">${Array.from({ length: columns }, () => '<td><div class="skeleton skeleton-line"></div></td>').join('')}</tr>`).join('');
    }
    document.querySelectorAll('.stat-number:empty, .summary-value:empty').forEach(node => node.classList.add('skeleton'));
}

function clearInitialSkeletons() {
    document.querySelectorAll('[data-skeleton="true"]').forEach(node => {
        if (node.querySelector('.skeleton')) node.innerHTML = '';
        delete node.dataset.skeleton;
    });
    document.querySelectorAll('.skeleton').forEach(node => node.classList.remove('skeleton'));
}

function emptyState(title, message, actionLabel = '', actionHref = '') {
    const action = actionLabel ? `<a class="btn btn-primary" href="${actionHref || '#'}">${actionLabel}</a>` : '';
    return `<div class="empty-state"><div class="empty-state-icon">${suppliedIconMarkup('folder')}</div><h3>${title}</h3><p>${message}</p>${action}</div>`;
}

function initializeUXEnhancements() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-hidden', modal.classList.contains('active') ? 'false' : 'true');
        const title = modal.querySelector('.modal-title');
        if (title) {
            if (!title.id) title.id = `${modal.id || 'modal'}Title`;
            modal.setAttribute('aria-labelledby', title.id);
        }
    });
    document.querySelectorAll('.faq-question').forEach(question => {
        question.setAttribute('type', 'button');
        question.setAttribute('aria-expanded', question.classList.contains('active') ? 'true' : 'false');
    });
    document.querySelectorAll('.table-container').forEach(container => {
        if (!container.closest('.table-responsive') && container.querySelector('table')) {
            container.setAttribute('tabindex', '0');
            container.setAttribute('aria-label', 'Scrollable data table');
        }
    });
    document.querySelectorAll('.empty-state .btn[href="#"]').forEach(button => {
        button.addEventListener('click', event => {
            event.preventDefault();
            const clockButton = document.getElementById('mainClockInBtn') || document.getElementById('clockInBtn');
            clockButton?.click();
        });
    });

    // Warm internal pages before navigation so sidebar changes feel immediate.
    document.querySelectorAll('a[href$=".html"], a[href*=".html?"]').forEach(link => {
        if (link.dataset.prefetchReady) return;
        link.dataset.prefetchReady = 'true';
        const prefetch = () => {
            if (link.dataset.prefetched) return;
            link.dataset.prefetched = 'true';
            const preload = document.createElement('link');
            preload.rel = 'prefetch';
            preload.href = link.href;
            document.head.appendChild(preload);
        };
        link.addEventListener('pointerenter', prefetch, { once: true });
        link.addEventListener('touchstart', prefetch, { once: true, passive: true });
    });
}

// Authenticated pages share one long-lived shell. Internal navigation swaps
// only <main>; sidebar, top bar, chat, and their event handlers stay mounted.
function installPageFadeNavigation() {
    if (document.body.dataset.pageFadeReady === 'true') return;
    document.body.dataset.pageFadeReady = 'true';
    let navigating = false;
    const routeModules = {
        'deleted-users.js': 'mountDeletedUsers',
        'access-requests.js': 'mountAccessRequests',
        'schedule-flex.js': 'mountScheduleFlex',
        'deleted-time-entries.js': 'mountDeletedTimeEntries',
        'individual-reports.js': 'mountIndividualReports',
        'chat-log.js': 'mountChatLog',
        'employee-profile.js': 'mountEmployeeProfile'
    };

    const mountRouteModule = async documentFromRoute => {
        const source = Array.from(documentFromRoute.querySelectorAll('script[src]')).map(node => node.src)
            .find(candidate => /\.js(?:\?|$)/.test(candidate) && !/(api-config|supabase|sidebar|\/script\.js|admin-sections\.js)/.test(candidate));
        if (!source) return;
        const moduleName = new URL(source, window.location.href).pathname.split('/').pop();
        const mountName = routeModules[moduleName];
        if (!mountName) throw new Error(`Unsupported route module: ${moduleName}`);
        if (!window[mountName]) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = source; script.dataset.routeModule = moduleName;
                script.onload = resolve; script.onerror = reject;
                document.head.appendChild(script);
            });
        }
        await window[mountName]?.();
    };

    const updateShellRoute = destination => {
        const currentFile = (destination.pathname.split('/').pop() || '').toLowerCase();
        const routeFile = currentFile && !currentFile.includes('.') ? `${currentFile}.html` : currentFile;
        document.querySelectorAll('.shell-link').forEach(link => {
            const linkFile = (new URL(link.href, window.location.href).pathname.split('/').pop() || '').toLowerCase();
            const active = linkFile === routeFile;
            link.classList.toggle('active', active);
            if (active) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        });
        document.querySelectorAll('.shell-nav-group').forEach(group => {
            const hasActiveChild = Boolean(group.querySelector('.shell-link.active'));
            group.classList.toggle('has-active-route', hasActiveChild);
            const toggle = group.querySelector('.shell-nav-group-toggle');
            const items = group.querySelector('.shell-nav-group-items');
            if (hasActiveChild && toggle && items) {
                items.hidden = false;
                group.classList.add('is-open');
                toggle.setAttribute('aria-expanded', 'true');
            }
        });
        document.querySelectorAll('.employee-bottom-nav-item[href]').forEach(link => {
            const linkFile = (new URL(link.href, window.location.href).pathname.split('/').pop() || '').toLowerCase();
            const active = linkFile === currentFile;
            link.classList.toggle('is-active', active);
            if (active) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        });
        const moreButton = document.querySelector('[data-bottom-nav-more]');
        const moreIsActive = routeFile === 'settings.html';
        moreButton?.classList.toggle('is-active', moreIsActive);
        if (moreIsActive) moreButton?.setAttribute('aria-current', 'page');
        else moreButton?.removeAttribute('aria-current');
        window.ACECloseMobileNavigation?.({ restoreFocus: false });
    };

    const updateBottomNavRoute = destination => {
        const currentFile = (destination.pathname.split('/').pop() || '').toLowerCase();
        document.querySelectorAll('.employee-bottom-nav-item[href]').forEach(link => {
            const linkFile = (new URL(link.href, window.location.href).pathname.split('/').pop() || '').toLowerCase();
            const active = linkFile === currentFile;
            link.classList.toggle('is-active', active);
            if (active) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        });
        const moreButton = document.querySelector('[data-bottom-nav-more]');
        const moreIsActive = currentFile === 'settings.html';
        moreButton?.classList.toggle('is-active', moreIsActive);
        if (moreIsActive) moreButton?.setAttribute('aria-current', 'page');
        else moreButton?.removeAttribute('aria-current');
    };

    const runMountedPage = async documentFromRoute => {
        applySuppliedIcons();
        initializeNavigation();
        initializeModals();
        initializeForms();
        initializeUXEnhancements();
        initializeResponsiveTables();
        updateUI();
        startClock();
        loadPageSpecificData();
        initializeSelectControls();
        initializeAutocompleteControls();
        if (document.body.dataset.adminView) {
            if (!window.renderAdminSection) {
                const source = documentFromRoute.querySelector('script[src*="admin-sections.js"]')?.src;
                if (source) await new Promise((resolve, reject) => {
                    const script = document.createElement('script'); script.src = source; script.onload = resolve; script.onerror = reject; document.head.appendChild(script);
                });
            }
            await window.renderAdminSection?.();
        }
    };

    const navigateDashboardRoute = async (href, push = true) => {
        const destination = new URL(href, window.location.href);
        if (navigating || destination.origin !== window.location.origin || !document.body.classList.contains('has-app-shell')) {
            window.location.assign(destination.href);
            return;
        }
        navigating = true;
        const main = document.querySelector('main.main-content');
        if (!main) { window.location.assign(destination.href); return; }
        const isEmployeeNavigation = document.body.dataset.userRole === 'employee';
        updateBottomNavRoute(destination);
        main.classList.add('is-route-loading');
        main.setAttribute('aria-busy', 'true');
        try {
            const response = await fetch(destination.href, { credentials: 'same-origin' });
            if (!response.ok) throw new Error(`Could not load ${destination.pathname}`);
            const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
            const nextMain = parsed.querySelector('main.main-content');
            if (!nextMain) throw new Error('The selected dashboard page is unavailable.');
            const unsupportedModule = Array.from(parsed.querySelectorAll('script[src]')).map(node => node.src)
                .find(source => /\.js(?:\?|$)/.test(source) && !/(api-config|supabase-auth|sidebar|\/script\.js|admin-sections\.js)/.test(source) && !routeModules[new URL(source, window.location.href).pathname.split('/').pop()]);
            if (unsupportedModule) { window.location.assign(destination.href); return; }
            window.unmountAccessRequests?.();
            main.className = nextMain.className;
            main.innerHTML = nextMain.innerHTML;
            const nextView = parsed.body.dataset.adminView;
            if (nextView) document.body.dataset.adminView = nextView;
            else delete document.body.dataset.adminView;
            document.title = parsed.title || document.title;
            if (push) history.pushState({ aceDashboard: true }, '', destination.href);
            updateShellRoute(destination);
            await runMountedPage(parsed);
            await mountRouteModule(parsed);
            window.scrollTo({ top: 0, behavior: 'auto' });
            window.dispatchEvent(new CustomEvent('ace:route-ready'));
        } catch (error) {
            console.warn('Dashboard content navigation fell back to a normal page load.', error);
            if (isEmployeeNavigation) updateBottomNavRoute(new URL(window.location.href));
            window.location.assign(destination.href);
            return;
        } finally {
            main.removeAttribute('aria-busy');
            main.classList.remove('is-route-loading');
            navigating = false;
        }
    };

    window.ACEDashboardNavigate = navigateDashboardRoute;

    document.addEventListener('click', event => {
        const link = event.target.closest('a[href]');
        if (!link || navigating || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (link.target || link.hasAttribute('download')) return;

        const destination = new URL(link.href, window.location.href);
        const current = new URL(window.location.href);
        const sameDocument = destination.origin === current.origin
            && destination.pathname === current.pathname
            && destination.search === current.search;
        if (destination.origin !== current.origin || sameDocument || !document.body.classList.contains('has-app-shell')) return;

        event.preventDefault();
        void navigateDashboardRoute(destination.href);
    });

    window.addEventListener('popstate', () => {
        if (document.body.classList.contains('has-app-shell')) void navigateDashboardRoute(window.location.href, false);
    });
}

function initializeEmployeeChat() {
    if (AppState.currentUser?.Status !== 'ACTIVE' || document.getElementById('employeeChat')) return;
    const chat = document.createElement('section');
    chat.id = 'employeeChat';
    chat.className = 'employee-chat';
    const employeeChat = AppState.currentUser.Role !== 'ADMIN';
    chat.innerHTML = `<button class="employee-chat-launcher" type="button" aria-expanded="false" aria-controls="employeeChatPanel"><img class="shell-icon" src="assets/icons/message-circle-more.svg" alt="" aria-hidden="true"><span>Chat</span><b class="employee-chat-badge" hidden>0</b></button><div class="employee-chat-panel" id="employeeChatPanel" hidden><header><strong>Team chat</strong><button type="button" class="employee-chat-close" aria-label="Close chat">×</button></header><div class="employee-chat-layout"><aside><p>${employeeChat ? 'Administrators' : 'All messages'}</p><label class="employee-chat-search"><span class="sr-only">Search teammates</span><input type="search" placeholder="Search teammates" autocomplete="off"></label><div class="employee-chat-contacts"></div></aside><section class="employee-chat-thread"><div class="employee-chat-empty">Choose a teammate to start a private chat.</div></section></div></div>`;
    document.body.appendChild(chat);
    const launcher = chat.querySelector('.employee-chat-launcher');
    const panel = chat.querySelector('.employee-chat-panel');
    const contacts = chat.querySelector('.employee-chat-contacts');
    const contactSearch = chat.querySelector('.employee-chat-search input');
    const thread = chat.querySelector('.employee-chat-thread');
    const badge = chat.querySelector('.employee-chat-badge');
    let selectedId = null;
    let selectedName = '';
    let selectedOnline = false;
    let selectedPictureUrl = '';
    let contactsLoaded = false;
    let allContacts = [];
    const unreadByContact = new Map();
    const formatTime = value => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const loadMessages = async () => {
        if (!selectedId) return;
        const previousComposer = thread.querySelector('.employee-chat-compose input');
        const draft = previousComposer?.value || '';
        const restoreComposerFocus = document.activeElement === previousComposer;
        try {
            const messages = await window.ACEAuth.request(`/v1/employee-chat/messages/${selectedId}`);
            // The request can finish while the user is typing. Capture the
            // live value immediately before replacing the message list.
            const liveComposer = thread.querySelector('.employee-chat-compose input');
            const liveDraft = liveComposer?.value ?? draft;
            const keepComposerFocus = document.activeElement === liveComposer || restoreComposerFocus;
            thread.innerHTML = `<div class="employee-chat-thread-head"><button class="employee-chat-back" type="button" aria-label="Back to chats">‹</button><span class="employee-chat-avatar">${avatarContent(selectedName, selectedPictureUrl)}</span><div><strong>${escapeHtml(selectedName)}</strong><span class="employee-chat-presence${selectedOnline ? ' is-online' : ''}">${selectedOnline ? 'Online now' : 'Offline'}</span></div></div><div class="employee-chat-messages">${messages.map(message => { const mine = message.sender_id === AppState.currentUser.UserId; const deleted = Boolean(message.deleted_at); const time = `<time class="employee-chat-message-time">${formatTime(message.created_at)}</time>`; return `<div class="employee-chat-message-row${mine ? ' mine' : ''}"><div class="employee-chat-message${mine ? ' mine' : ''}${deleted ? ' deleted' : ''}"><span>${deleted ? 'This message was deleted.' : escapeHtml(message.body)}</span>${!deleted && message.edited_at ? '<em>edited</em>' : ''}</div>${mine && !deleted ? `<div class="employee-chat-actions">${time}<button type="button" data-chat-edit="${message.id}" data-chat-body="${escapeHtml(message.body)}">Edit</button><button type="button" data-chat-delete="${message.id}">Delete</button></div>` : `<div class="employee-chat-message-meta">${time}</div>`}</div>`; }).join('')}</div><form class="employee-chat-compose"><input maxlength="2000" aria-label="Message ${escapeHtml(selectedName)}" placeholder="Write a message…" required><button type="submit">Send</button></form>`;
            const messagesBox = thread.querySelector('.employee-chat-messages');
            if (messagesBox) messagesBox.scrollTop = messagesBox.scrollHeight;
            const composer = thread.querySelector('.employee-chat-compose input');
            if (composer && liveDraft) composer.value = liveDraft;
            if (composer && keepComposerFocus) composer.focus({ preventScroll: true });
            thread.querySelector('.employee-chat-back')?.addEventListener('click', () => chat.classList.remove('employee-chat-chatting'));
            thread.querySelector('form').addEventListener('submit', async event => {
                event.preventDefault();
                const input = event.currentTarget.querySelector('input');
                const body = input.value.trim();
                if (!body) return;
                input.disabled = true;
                try { await window.ACEAuth.request('/v1/employee-chat/messages', { method: 'POST', body: JSON.stringify({ recipientId: selectedId, body }) }); await loadMessages(); }
                catch (error) { showToast(error.message || 'Unable to send chat message.', 'error'); input.disabled = false; }
            });
            thread.querySelectorAll('[data-chat-edit]').forEach(button => button.addEventListener('click', async () => {
                const body = (await window.ACEUI.prompt({ title: 'Edit message', label: 'Message', value: button.dataset.chatBody, confirmLabel: 'Save changes' }))?.trim();
                if (!body) return;
                try { await window.ACEAuth.request(`/v1/employee-chat/messages/${button.dataset.chatEdit}`, { method: 'PATCH', body: JSON.stringify({ body }) }); await loadMessages(); }
                catch (error) { showToast(error.message || 'Unable to edit chat message.', 'error'); }
            }));
            thread.querySelectorAll('[data-chat-delete]').forEach(button => button.addEventListener('click', async () => {
                if (!await window.ACEUI.confirm({ title: 'Delete message?', message: 'This removes the message from the conversation for everyone.', confirmLabel: 'Delete message', danger: true })) return;
                try { await window.ACEAuth.request(`/v1/employee-chat/messages/${button.dataset.chatDelete}`, { method: 'DELETE' }); await loadMessages(); }
                catch (error) { showToast(error.message || 'Unable to delete chat message.', 'error'); }
            }));
        } catch (error) { thread.innerHTML = `<div class="employee-chat-empty">${escapeHtml(error.message || 'Unable to load this conversation.')}</div>`; }
    };
    const renderContacts = () => {
        const query = contactSearch.value.trim().toLowerCase();
        const people = allContacts.filter(person => `${person.full_name || ''} ${person.email || ''}`.toLowerCase().includes(query));
        contacts.innerHTML = people.length ? people.map(person => { const name = person.full_name || person.email; const online = Boolean(person.last_seen_at && Date.now() - new Date(person.last_seen_at).getTime() < 2 * 60 * 1000); return `<button class="employee-chat-contact${person.id === selectedId ? ' active' : ''}" data-id="${person.id}" data-name="${escapeHtml(name)}" data-picture="${escapeHtml(person.profile_picture_url || '')}" data-online="${online}" type="button"><span class="employee-chat-avatar">${avatarContent(name, person.profile_picture_url)}<i class="employee-chat-online-dot${online ? ' is-online' : ''}"></i></span><div><strong>${escapeHtml(name)}</strong><small>${online ? 'Online' : 'Offline'}</small></div>${person.unread_count ? `<b class="employee-chat-contact-badge" aria-label="New message from ${escapeHtml(name)}"></b>` : ''}</button>`; }).join('') : `<div class="employee-chat-empty">${allContacts.length ? 'No teammates match that search.' : 'No other active teammates yet.'}</div>`;
        contacts.querySelectorAll('.employee-chat-contact').forEach(button => button.addEventListener('click', () => { selectedId = button.dataset.id; selectedName = button.dataset.name; selectedPictureUrl = button.dataset.picture; selectedOnline = button.dataset.online === 'true'; chat.classList.add('employee-chat-chatting'); renderContacts(); loadMessages(); }));
    };
    const loadContacts = async () => {
        try {
            const response = await window.ACEAuth.request('/v1/employee-chat/contacts');
            const people = Array.isArray(response) ? response : response.contacts || [];
            const pendingAccessRequestCount = Number(response.pending_access_request_count) || 0;
            const totalUnread = people.reduce((total, person) => total + (person.unread_count || 0), 0);
            if (contactsLoaded) {
                people.forEach(person => {
                    const unread = person.unread_count || 0;
                    if (unread > (unreadByContact.get(person.id) || 0)) {
                        showToast(`${person.full_name || person.email} sent you a message.`, 'info');
                    }
                });
            }
            unreadByContact.clear();
            people.forEach(person => unreadByContact.set(person.id, person.unread_count || 0));
            contactsLoaded = true;
            badge.hidden = !totalUnread; badge.textContent = totalUnread > 99 ? '99+' : totalUnread;
            allContacts = people.filter(person => !employeeChat || person.role === 'ADMIN');
            window.dispatchEvent(new CustomEvent('ace:chat-unread', { detail: {
                totalUnread,
                pendingAccessRequestCount,
                conversations: allContacts.filter(person => person.unread_count).map(person => ({
                    id: person.id,
                    name: person.full_name || person.email,
                    picture: person.profile_picture_url || '',
                    unreadCount: person.unread_count,
                    preview: person.last_unread_message || 'New message',
                    createdAt: person.last_unread_at || ''
                }))
            } }));
            const selectedContact = people.find(person => person.id === selectedId);
            if (selectedContact) { selectedOnline = Boolean(selectedContact.last_seen_at && Date.now() - new Date(selectedContact.last_seen_at).getTime() < 2 * 60 * 1000); selectedPictureUrl = selectedContact.profile_picture_url || ''; }
            renderContacts();
        } catch { contacts.innerHTML = '<div class="employee-chat-empty">Chat is unavailable right now.</div>'; }
    };
    contactSearch.addEventListener('input', renderContacts);
    const openChat = open => { panel.hidden = !open; launcher.setAttribute('aria-expanded', String(open)); if (open) { chat.classList.remove('employee-chat-chatting'); loadContacts(); } };
    window.ACEEmployeeChat = {
        openConversation(contactId) {
            const person = allContacts.find(contact => String(contact.id) === String(contactId));
            if (!person) { openChat(true); return; }
            selectedId = person.id;
            selectedName = person.full_name || person.email;
            selectedPictureUrl = person.profile_picture_url || '';
            selectedOnline = Boolean(person.last_seen_at && Date.now() - new Date(person.last_seen_at).getTime() < 2 * 60 * 1000);
            panel.hidden = false;
            launcher.setAttribute('aria-expanded', 'true');
            chat.classList.add('employee-chat-chatting');
            renderContacts();
            loadMessages();
        }
    };
    launcher.addEventListener('click', () => openChat(panel.hidden));
    chat.querySelector('.employee-chat-close').addEventListener('click', () => openChat(false));
    // Fetch immediately, then keep the unread indicator fresh without a page reload.
    loadContacts();
    const poller = window.setInterval(() => { loadContacts(); if (!panel.hidden) loadMessages(); }, 4000);
    window.addEventListener('pagehide', () => window.clearInterval(poller), { once: true });
}

// Shared application shell for every authenticated page.
function initializeAppShell() {
    if (document.body.classList.contains('has-app-shell')) return true;
    const routeName = (window.location.pathname.split('/').pop() || '').toLowerCase();
    // Render rewrites clean URLs to the deployed .html files. Normalize both
    // forms before selecting the application shell.
    const file = routeName && !routeName.includes('.') ? `${routeName}.html` : routeName;
    const adminFiles = ['admin-dashboard.html', 'admin-management.html', 'employee-profile.html', 'time-entry-details.html', 'users.html', 'deleted-users.html', 'invitations.html', 'access-requests.html', 'departments.html', 'projects.html', 'schedule-flex.html', 'admin-time-entries.html', 'deleted-time-entries.html', 'reports.html', 'individual-reports.html', 'audit-logs.html', 'chat-log.html'];
    const employeeFiles = ['user-dashboard.html', 'time-entries.html', 'remarks.html', 'settings.html'];
    const isSharedSettings = file === 'settings.html';
    const isAdmin = adminFiles.includes(file) || (isSharedSettings && AppState.currentUser?.Role === 'ADMIN');
    const isEmployee = employeeFiles.includes(file) && !isAdmin;
    if (!isAdmin && !isEmployee) return true;
    if (AppState.currentUser && isAdmin && AppState.currentUser.Role !== 'ADMIN') {
        window.location.replace('/user-dashboard');
        return false;
    }
    if (AppState.currentUser && isEmployee && AppState.currentUser.Role === 'ADMIN') {
        window.location.replace('/admin-dashboard');
        return false;
    }

    const icons = { dashboard: 'layout-panel-top', users: 'users', mail: 'mail', requests: 'user-pen', building: 'building', folder: 'folder', clock: 'timer', calendar: 'calendar-days', chart: 'chart-column-big', audit: 'brick-wall-shield', download: 'download', settings: 'settings', remarks: 'message-circle-more', logout: 'log-out', chevron: 'chevron-left' };
    const icon = name => suppliedIconMarkup(icons[name], 'shell-icon');
    const isSpecialAdmin = isAdmin && AppState.currentUser?.IsHeadAdmin;
    const adminGroups = [
        ['Workspace', [['admin-dashboard.html', 'dashboard', 'Dashboard']]],
        ['People', [['users.html', 'users', 'Users'], ['deleted-users.html', 'folder', 'Archived users'], ['invitations.html', 'mail', 'Invitations'], ['access-requests.html', 'requests', 'Access requests'], ['departments.html', 'building', 'Departments']]],
        ['Work', [['projects.html', 'folder', 'Projects'], ['schedule-flex.html', 'calendar', 'Schedule & flextime'], ['admin-time-entries.html', 'clock', 'Time entries'], ['deleted-time-entries.html', 'clock', 'Deleted time entries']]],
        ['Insights', [['reports.html', 'chart', 'Reports'], ['individual-reports.html', 'chart', 'Individual reports']]],
        ['Administration', [['audit-logs.html', 'audit', 'Audit log'], ...(isSpecialAdmin ? [['chat-log.html', 'mail', 'Employee chat log']] : []), ['settings.html', 'settings', 'Settings']]]
    ];
    const employeeGroups = [
        ['Workspace', [['user-dashboard.html', 'dashboard', 'Dashboard']]],
        ['Work', [['time-entries.html', 'clock', 'My time entries'], ['remarks.html', 'remarks', 'Remarks']]],
        ['Account', [['settings.html', 'settings', 'Settings']]]
    ];
    const groups = isAdmin ? adminGroups : employeeGroups;
    const user = AppState.currentUser || { FullName: isAdmin ? 'ACE Administrator' : 'ACE Employee', Role: isAdmin ? 'ADMIN' : 'USER' };
    const initials = String(user.FullName || '').split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase();
    const unreadRemarks = !isAdmin ? AppState.adminRemarks.filter(remark => !remark.SeenAt).length : 0;
    const links = groups.map(([groupLabel, items]) => { const collapsible = isAdmin && (groupLabel === 'People' || groupLabel === 'Work'); const groupKey = `ace_sidebar_group_${groupLabel.toLowerCase().replace(/\s+/g, '-')}`; const groupId = `shell-nav-group-${groupLabel.toLowerCase().replace(/\s+/g, '-')}`; const hasActive = items.some(([href]) => file === href); const open = hasActive || localStorage.getItem(groupKey) === '1' || groupLabel === 'Workspace'; const header = collapsible ? `<button class="shell-nav-label shell-nav-group-toggle" type="button" aria-expanded="${open}" aria-controls="${groupId}" aria-label="${open ? 'Collapse' : 'Expand'} ${groupLabel}"><span>${groupLabel}</span><b aria-hidden="true">${suppliedIconMarkup('chevron-right', 'shell-nav-group-chevron')}</b></button>` : `<p class="shell-nav-label">${groupLabel}</p>`; return `<section class="shell-nav-group${hasActive ? ' has-active-route' : ''}${collapsible && open ? ' is-open' : ''}" aria-label="${groupLabel}"${collapsible ? ` data-group-key="${groupKey}" data-group-label="${groupLabel}"` : ''}>${header}<div class="shell-nav-group-items" id="${groupId}"${collapsible && !open ? ' hidden' : ''}>${items.map(([href, iconName, label]) => {
        const active = file === href || (file === 'admin-management.html' && new URLSearchParams(location.search).get('view') === href.replace('.html', '').replace('admin-time-entries', 'entries').replace('audit-logs', 'audit'));
        const remarkBadge = href === 'remarks.html' && unreadRemarks ? `<b class="shell-notification-badge" aria-label="${unreadRemarks} new administrator remark${unreadRemarks === 1 ? '' : 's'}">${unreadRemarks > 9 ? '9+' : unreadRemarks}</b>` : '';
        return `<a class="shell-link${active ? ' active' : ''}" href="${href}" title="${label}"${active ? ' aria-current="page"' : ''}>${icon(iconName)}<span class="shell-label">${label}</span>${remarkBadge}</a>`;
    }).join('')}</div></section>`; }).join('');

    document.body.classList.add('has-app-shell');
    document.body.dataset.userRole = isAdmin ? 'admin' : 'employee';
    if (isSharedSettings && isAdmin) {
        const title = document.querySelector('.settings-title');
        const subtitle = document.querySelector('.settings-subtitle');
        if (title) title.textContent = 'Administrator Settings';
        if (subtitle) subtitle.textContent = 'Manage your administrator account and workspace preferences';
    }
    const sidebar = document.createElement('aside');
    sidebar.className = 'app-sidebar';
    sidebar.id = 'appSidebar';
    sidebar.innerHTML = `<div class="shell-brand"><a href="${isAdmin ? 'admin-dashboard.html' : 'user-dashboard.html'}" aria-label="ACE Outsource Solutions"><img src="assets/images/ace-logo-hd-cropped.png" alt="ACE Outsource Solutions"></a><button class="shell-collapse" type="button" aria-label="Collapse sidebar">${icon('chevron')}</button></div><nav class="shell-nav" aria-label="${isAdmin ? 'Administrator' : 'Employee'} navigation">${links}</nav><div class="shell-account-wrap"><button class="shell-account" type="button" aria-label="Open account menu" aria-expanded="false" aria-controls="shellAccountMenu"><span class="shell-avatar">${user.ProfilePictureUrl ? `<img src="${escapeHtml(user.ProfilePictureUrl)}" alt="">` : escapeHtml(initials)}</span><span class="shell-user"><strong>${escapeHtml(user.FullName)}</strong><span>${isAdmin ? 'Administrator' : 'Employee'}</span></span>${suppliedIconMarkup('chevrons-up-down', 'shell-icon shell-account-menu-icon')}</button><div class="shell-account-menu" id="shellAccountMenu" role="menu" hidden><a href="settings.html" role="menuitem">${suppliedIconMarkup('settings', 'shell-icon')}<span>Profile &amp; settings</span></a><button type="button" role="menuitem" data-restart-tutorial>${suppliedIconMarkup('info', 'shell-icon')}<span>Restart tutorial</span></button><button type="button" role="menuitem" data-account-logout>${suppliedIconMarkup('log-out', 'shell-icon')}<span>Sign out</span></button></div></div>`;
    const overlay = document.createElement('button');
    overlay.className = 'shell-overlay'; overlay.type = 'button'; overlay.setAttribute('aria-label', 'Close navigation');
    const mobileToggle = document.createElement('button');
    mobileToggle.className = 'shell-mobile-toggle'; mobileToggle.type = 'button'; mobileToggle.setAttribute('aria-label', 'Open navigation'); mobileToggle.setAttribute('aria-expanded', 'false'); mobileToggle.setAttribute('aria-controls', 'appSidebar');
    mobileToggle.innerHTML = suppliedIconMarkup('menu', 'shell-icon');
    const topbar = document.createElement('header');
    topbar.className = 'shell-topbar';
    topbar.innerHTML = `<div class="shell-topbar-search-wrap"><label class="shell-topbar-search" for="shellGlobalSearch" title="Search workspace (Ctrl+K)">${suppliedIconMarkup('search', 'shell-icon')}<input id="shellGlobalSearch" type="search" role="combobox" aria-label="Search the workspace. Press Control K to focus." aria-keyshortcuts="Control+K Meta+K" aria-autocomplete="list" aria-expanded="false" aria-controls="shellGlobalResults" autocomplete="off" placeholder="${isAdmin ? 'Search workspace, people, projects…' : 'Search workspace, projects, help…'}"></label><div class="shell-global-results" id="shellGlobalResults" role="listbox" hidden></div></div><div class="shell-topbar-actions"><button class="shell-topbar-icon-button shell-help-button" type="button" aria-label="Open help" title="Need help?">${suppliedIconMarkup('info', 'shell-icon')}</button><div class="shell-topbar-notification-wrap"><button class="shell-topbar-icon-button" type="button" aria-label="Open notifications" aria-expanded="false" aria-controls="shellNotificationMenu">${suppliedIconMarkup('mail', 'shell-icon')}<b class="shell-topbar-badge" hidden>0</b></button><div class="shell-topbar-menu shell-notification-menu" id="shellNotificationMenu" role="menu" hidden></div></div><div class="shell-topbar-account-wrap"><button class="shell-topbar-user-button" type="button" aria-label="Open account menu" aria-expanded="false" aria-controls="shellTopbarAccountMenu"><span class="shell-avatar">${user.ProfilePictureUrl ? `<img src="${escapeHtml(user.ProfilePictureUrl)}" alt="">` : escapeHtml(initials)}</span><span class="shell-topbar-user-name">${escapeHtml(user.FullName)}</span>${suppliedIconMarkup('chevron-down', 'shell-icon')}</button><div class="shell-topbar-menu shell-topbar-account-menu" id="shellTopbarAccountMenu" role="menu" hidden><a href="settings.html" role="menuitem">${suppliedIconMarkup('settings', 'shell-icon')}<span>Profile &amp; settings</span></a><button type="button" role="menuitem" data-restart-tutorial>${suppliedIconMarkup('info', 'shell-icon')}<span>Restart tutorial</span></button><button type="button" role="menuitem" data-topbar-logout>${suppliedIconMarkup('log-out', 'shell-icon')}<span>Sign out</span></button></div></div></div>`;
    document.body.prepend(overlay); document.body.prepend(sidebar); document.body.prepend(topbar); document.body.prepend(mobileToggle);

    let employeeBottomNav = null;
    if (isEmployee) {
        document.body.classList.add('has-employee-bottom-nav');
        const bottomNavItems = [
            ['user-dashboard.html', 'layout-panel-top', 'Dashboard'],
            ['time-entries.html', 'timer', 'My time'],
            ['remarks.html', 'message-circle-more', 'Remarks']
        ];
        employeeBottomNav = document.querySelector('.employee-bottom-nav');
        if (!employeeBottomNav) {
            employeeBottomNav = document.createElement('nav');
            employeeBottomNav.className = 'employee-bottom-nav';
            employeeBottomNav.setAttribute('aria-label', 'Employee mobile navigation');
            const navLink = ([href, iconName, label]) => `<a class="employee-bottom-nav-item${file === href ? ' is-active' : ''}" href="${href}"${file === href ? ' aria-current="page"' : ''}>${suppliedIconMarkup(iconName, 'shell-icon')}<span>${label}</span></a>`;
            const moreIsActive = file === 'settings.html';
            employeeBottomNav.innerHTML = `${navLink(bottomNavItems[0])}${navLink(bottomNavItems[1])}<button class="employee-bottom-nav-clock" type="button" data-mobile-clock-action aria-label="Open time actions">${suppliedIconMarkup('timer', 'shell-icon')}</button>${navLink(bottomNavItems[2])}<button class="employee-bottom-nav-item${moreIsActive ? ' is-active' : ''}" type="button" data-bottom-nav-more aria-label="Open navigation" aria-expanded="false"${moreIsActive ? ' aria-current="page"' : ''}>${suppliedIconMarkup('menu', 'shell-icon')}<span>More</span></button>`;
            document.body.append(employeeBottomNav);
        }
        if (!employeeBottomNav.dataset.shellBound) {
            employeeBottomNav.dataset.shellBound = 'true';
            employeeBottomNav.querySelector('[data-bottom-nav-more]')?.addEventListener('click', () => setMobileNavigation(true));
            employeeBottomNav.querySelector('[data-mobile-clock-action]')?.addEventListener('click', openMobileClockActions);
        }
        updateEmployeeBottomNav();
    }

    const setCollapsed = collapsed => {
        document.body.classList.toggle('shell-collapsed', collapsed);
        const collapseButton = sidebar.querySelector('.shell-collapse');
        collapseButton.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
        collapseButton.setAttribute('aria-expanded', String(!collapsed));
        collapseButton.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
        localStorage.setItem('ace_sidebar_collapsed', collapsed ? '1' : '0');
        window.dispatchEvent(new CustomEvent('ace:sidebar-state-change', { detail: { collapsed } }));
    };
    setCollapsed(localStorage.getItem('ace_sidebar_collapsed') === '1');
    sidebar.querySelector('.shell-collapse').addEventListener('click', () => setCollapsed(!document.body.classList.contains('shell-collapsed')));
    const setGroupOpen = (group, open) => {
        const content = group.querySelector('.shell-nav-group-items');
        const button = group.querySelector('.shell-nav-group-toggle');
        if (!content || !button) return;
        content.hidden = !open;
        group.classList.toggle('is-open', open);
        button.setAttribute('aria-expanded', String(open));
        button.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} ${group.dataset.groupLabel}`);
        localStorage.setItem(group.dataset.groupKey, open ? '1' : '0');
        window.dispatchEvent(new CustomEvent('ace:sidebar-state-change', { detail: { group: group.dataset.groupLabel, open } }));
    };
    sidebar.querySelectorAll('.shell-nav-group-toggle').forEach(button => button.addEventListener('click', () => {
        const group = button.closest('.shell-nav-group');
        setGroupOpen(group, group.querySelector('.shell-nav-group-items').hidden);
    }));
    let mobileReturnFocus = null;
    const compactNavigation = window.matchMedia('(max-width: 1180px)');
    const setMobileNavigation = (open, { restoreFocus = true } = {}) => {
        if (open && !document.body.classList.contains('shell-mobile-open')) mobileReturnFocus = document.activeElement;
        document.body.classList.toggle('shell-mobile-open', open);
        sidebar.setAttribute('aria-hidden', String(!open && compactNavigation.matches));
        mobileToggle.setAttribute('aria-expanded', String(open));
        mobileToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
        employeeBottomNav?.querySelector('[data-bottom-nav-more]')?.setAttribute('aria-expanded', String(open));
        if (open) requestAnimationFrame(() => sidebar.querySelector('.shell-link.active, .shell-nav-group-toggle, .shell-link, .shell-account')?.focus());
        else if (restoreFocus && mobileReturnFocus instanceof HTMLElement && document.contains(mobileReturnFocus)) mobileReturnFocus.focus();
        window.dispatchEvent(new CustomEvent('ace:sidebar-state-change', { detail: { mobileOpen: open } }));
    };
    window.ACECloseMobileNavigation = setMobileNavigation.bind(null, false);
    setMobileNavigation(false, { restoreFocus: false });
    compactNavigation.addEventListener('change', () => sidebar.setAttribute('aria-hidden', String(!document.body.classList.contains('shell-mobile-open') && compactNavigation.matches)));
    mobileToggle.addEventListener('click', () => setMobileNavigation(!document.body.classList.contains('shell-mobile-open')));
    overlay.addEventListener('click', () => setMobileNavigation(false));
    sidebar.querySelectorAll('.shell-link').forEach(link => link.addEventListener('click', () => setMobileNavigation(false, { restoreFocus: false })));
    document.addEventListener('keydown', event => {
        if (!document.body.classList.contains('shell-mobile-open')) return;
        if (event.key === 'Escape') { event.preventDefault(); setMobileNavigation(false); return; }
        if (event.key !== 'Tab') return;
        const focusable = [...sidebar.querySelectorAll('a[href], button:not([disabled])')].filter(element => !element.closest('[hidden]'));
        if (!focusable.length) return;
        const first = focusable[0]; const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    sidebar.addEventListener('keydown', event => {
        const controls = [...sidebar.querySelectorAll('.shell-nav-group-toggle, .shell-link')].filter(element => !element.closest('[hidden]'));
        const index = controls.indexOf(document.activeElement);
        if (index < 0) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); controls[(index + (event.key === 'ArrowDown' ? 1 : controls.length - 1)) % controls.length].focus();
        } else if (event.key === 'ArrowRight' && document.activeElement.matches('.shell-nav-group-toggle')) {
            event.preventDefault(); const group = document.activeElement.closest('.shell-nav-group'); setGroupOpen(group, true); group.querySelector('.shell-link')?.focus();
        } else if (event.key === 'ArrowLeft' && document.activeElement.matches('.shell-nav-group-toggle')) {
            event.preventDefault(); setGroupOpen(document.activeElement.closest('.shell-nav-group'), false);
        }
    });
    let touchStartX = null;
    document.addEventListener('touchstart', event => { touchStartX = event.touches[0]?.clientX ?? null; }, { passive: true });
    document.addEventListener('touchend', event => {
        if (touchStartX === null) return;
        const deltaX = (event.changedTouches[0]?.clientX ?? touchStartX) - touchStartX;
        const isOpen = document.body.classList.contains('shell-mobile-open');
        if (!isOpen && touchStartX <= 24 && deltaX >= 64) setMobileNavigation(true);
        if (isOpen && touchStartX <= sidebar.getBoundingClientRect().right && deltaX <= -64) setMobileNavigation(false);
        touchStartX = null;
    }, { passive: true });
    const accountButton = sidebar.querySelector('.shell-account');
    const accountMenu = sidebar.querySelector('.shell-account-menu');
    const setAccountMenu = open => {
        accountButton.setAttribute('aria-expanded', String(open));
        accountButton.setAttribute('aria-label', open ? 'Close account menu' : 'Open account menu');
        accountMenu.hidden = !open;
        window.dispatchEvent(new CustomEvent('ace:sidebar-state-change', { detail: { accountOpen: open } }));
    };
    accountButton.addEventListener('click', () => setAccountMenu(accountMenu.hidden));
    sidebar.querySelector('[data-account-logout]').addEventListener('click', handleLogout);
    topbar.querySelector('[data-topbar-logout]').addEventListener('click', handleLogout);
    [...document.querySelectorAll('[data-restart-tutorial]')].forEach(button => button.addEventListener('click', () => window.ACETutorial?.restart()));

    const topbarAccountButton = topbar.querySelector('.shell-topbar-user-button');
    const topbarAccountMenu = topbar.querySelector('.shell-topbar-account-menu');
    const notificationButton = topbar.querySelector('.shell-topbar-notification-wrap .shell-topbar-icon-button');
    const notificationMenu = topbar.querySelector('.shell-notification-menu');
    const notificationBadge = topbar.querySelector('.shell-topbar-badge');
    let unreadMessages = 0;
    let unreadConversations = [];
    let pendingAccessRequestCount = 0;
    const setTopbarMenu = (button, menu, open) => {
        button.setAttribute('aria-expanded', String(open));
        menu.hidden = !open;
    };
    const renderNotifications = () => {
        const unreadRemarksCount = isAdmin ? 0 : AppState.adminRemarks.filter(remark => !remark.SeenAt).length;
        const total = unreadMessages + unreadRemarksCount + pendingAccessRequestCount;
        notificationBadge.hidden = !total;
        notificationBadge.textContent = total > 99 ? '99+' : total;
        const notices = [];
        if (pendingAccessRequestCount) notices.push(`<a href="access-requests.html" role="menuitem"><strong>${pendingAccessRequestCount} pending access request${pendingAccessRequestCount === 1 ? '' : 's'}</strong><span>Review employee access requests</span></a>`);
        if (unreadMessages) {
            notices.push(...unreadConversations.map(conversation => {
                const preview = String(conversation.preview || 'New message').replace(/\s+/g, ' ').trim();
                const shortPreview = preview.length > 90 ? `${preview.slice(0, 89)}…` : preview;
                const count = conversation.unreadCount > 1 ? `<b>${conversation.unreadCount}</b>` : '';
                return `<button class="shell-message-notice" type="button" role="menuitem" data-open-chat="${escapeHtml(conversation.id)}"><span class="shell-message-notice-avatar">${avatarContent(conversation.name, conversation.picture)}</span><span class="shell-message-notice-copy"><strong>${escapeHtml(conversation.name || 'Teammate')}</strong><small>${escapeHtml(shortPreview)}</small></span>${count}</button>`;
            }));
        }
        if (unreadRemarksCount) notices.push(`<a href="remarks.html" role="menuitem"><strong>${unreadRemarksCount} new remark${unreadRemarksCount === 1 ? '' : 's'}</strong><span>Review administrator feedback</span></a>`);
        notificationMenu.innerHTML = `<p class="shell-topbar-menu-title">Notifications</p>${notices.length ? notices.join('') : '<p class="shell-topbar-empty">You’re all caught up.</p>'}`;
        notificationMenu.querySelectorAll('[data-open-chat]').forEach(button => button.addEventListener('click', () => {
            setTopbarMenu(notificationButton, notificationMenu, false);
            const contactId = button.dataset.openChat;
            if (contactId) window.ACEEmployeeChat?.openConversation(contactId);
            else document.querySelector('.employee-chat-launcher')?.click();
        }));
    };
    renderNotifications();
    window.addEventListener('ace:chat-unread', event => {
        unreadMessages = Number(event.detail?.totalUnread) || 0;
        unreadConversations = Array.isArray(event.detail?.conversations) ? event.detail.conversations : [];
        pendingAccessRequestCount = Number(event.detail?.pendingAccessRequestCount) || 0;
        renderNotifications();
    });
    topbarAccountButton.addEventListener('click', () => {
        setTopbarMenu(notificationButton, notificationMenu, false);
        setTopbarMenu(topbarAccountButton, topbarAccountMenu, topbarAccountMenu.hidden);
    });
    notificationButton.addEventListener('click', () => {
        setTopbarMenu(topbarAccountButton, topbarAccountMenu, false);
        setTopbarMenu(notificationButton, notificationMenu, notificationMenu.hidden);
    });
    topbar.querySelector('.shell-help-button').addEventListener('click', () => openWorkspaceHelp(isAdmin));

    const searchInput = topbar.querySelector('#shellGlobalSearch');
    const searchResults = topbar.querySelector('.shell-global-results');
    const workspaceSearchItems = isAdmin ? [
        ['Dashboard', 'Workspace', 'admin-dashboard.html', 'dashboard home overview'],
        ['Invite user', 'People · Invite a team member', 'invitations.html', 'invite employee administrator email access'],
        ['Users', 'People · Manage accounts', 'users.html', 'people employees staff manage accounts'],
        ['Access requests', 'People · Approve or deny access', 'access-requests.html', 'requests approve deny pending'],
        ['Departments', 'People · Organize your team', 'departments.html', 'department team organization'],
        ['Projects', 'Work · Create and manage projects', 'projects.html', 'project assignment assign'],
        ['Schedule & flextime', 'Work · Create or assign schedules', 'schedule-flex.html', 'schedule flextime workdays'],
        ['Time entries', 'Work · Review and correct time', 'admin-time-entries.html', 'time clock clock out correct entry'],
        ['Deleted time entries', 'Work · Restore deleted records', 'deleted-time-entries.html', 'deleted restore time entries'],
        ['Reports', 'Insights · Reports and exports', 'reports.html', 'report export analytics'],
        ['Individual reports', 'Insights · Employee reports', 'individual-reports.html', 'individual employee report'],
        ['Audit log', 'Administration · Review changes', 'audit-logs.html', 'audit history activity'],
        ['Settings', 'Administration · Profile, security, appearance', 'settings.html', 'settings profile security appearance']
    ] : [
        ['Dashboard', 'Workspace · Clock in and clock out', 'user-dashboard.html', 'home start shift clock in clock out'],
        ['My time entries', 'Work · Review your shifts', 'time-entries.html', 'time entries history shifts filters'],
        ['Remarks', 'Work · Read administrator feedback', 'remarks.html', 'remarks feedback admin note'],
        ['Profile & settings', 'Account · Profile, security, appearance', 'settings.html', 'settings profile password security appearance']
    ];
    const quickActionItems = isAdmin ? [
        { label: 'Invite user', detail: 'Quick action · Open the invitation form', href: 'invitations.html', quickAction: 'invite-user', keywords: 'invite employee administrator access add person' },
        { label: 'Generate report', detail: 'Quick action · Choose a report format', href: 'admin-dashboard.html', quickAction: 'generate-report', keywords: 'generate report export pdf excel analytics' },
        { label: 'Add project', detail: 'Quick action · Open the project form', href: 'projects.html', quickAction: 'add-project', keywords: 'add create project work' }
    ] : [
        AppState.isClockedIn
            ? { label: 'Clock out', detail: 'Quick action · Open clock-out confirmation', href: 'user-dashboard.html', quickAction: 'clock-out', keywords: 'clock out end shift finish work' }
            : { label: 'Clock in', detail: 'Quick action · Open clock-in form', href: 'user-dashboard.html', quickAction: 'clock-in', keywords: 'clock in start shift begin work' }
    ];
    const naturalLanguageActions = isAdmin ? [
        { label: 'Correct a missed clock-out', detail: 'Natural-language action · Show active entries that need review', href: 'admin-time-entries.html', quickAction: 'correct-missing-clock-out', keywords: 'employee forgot missed clock out clock-out active shift correction', phrases: [['forgot', 'clock', 'out'], ['missed', 'clock', 'out'], ['employee', 'clock', 'out']], icon: 'timer' },
        { label: 'Review access requests', detail: 'Natural-language action · Open pending access requests', href: 'access-requests.html', keywords: 'approve access request pending sign in', phrases: [['approve', 'access'], ['approve', 'request'], ['pending', 'access']], icon: 'user-pen' },
        { label: 'Invite a new employee', detail: 'Natural-language action · Open the invitation form', href: 'invitations.html', quickAction: 'invite-user', keywords: 'add invite new employee staff person', phrases: [['add', 'employee'], ['new', 'employee'], ['invite', 'employee']], icon: 'user-plus' },
        { label: 'Create a project', detail: 'Natural-language action · Open the project form', href: 'projects.html', quickAction: 'add-project', keywords: 'create add new project', phrases: [['create', 'project'], ['new', 'project']], icon: 'folder' }
    ] : [
        { label: 'Get help with a missed clock-out', detail: 'Natural-language action · Learn what to do next', action: 'help', keywords: 'forgot missed clock out clock-out correction', phrases: [['forgot', 'clock', 'out'], ['missed', 'clock', 'out']], icon: 'info' },
        AppState.isClockedIn
            ? { label: 'Clock out', detail: 'Natural-language action · Open clock-out confirmation', href: 'user-dashboard.html', quickAction: 'clock-out', keywords: 'end finish shift work clock out', phrases: [['end', 'shift'], ['finish', 'work']], icon: 'timer' }
            : { label: 'Clock in', detail: 'Natural-language action · Open clock-in form', href: 'user-dashboard.html', quickAction: 'clock-in', keywords: 'start begin shift work clock in', phrases: [['start', 'shift'], ['begin', 'work']], icon: 'timer' }
    ];
    // Keep search convenience local to this browser and separate by signed-in
    // account and role, so a different person using this device does not see
    // someone else's recent page names or search terms.
    // We deliberately retain page names and submitted search terms only; no
    // entry, report, or employee record data is copied into local storage.
    const searchHistoryPrefix = `ace_workspace_search_v1_${isAdmin ? 'admin' : 'employee'}_${encodeURIComponent(AppState.currentUser?.UserId || 'unknown')}`;
    const recentPagesKey = `${searchHistoryPrefix}_pages`;
    const recentQueriesKey = `${searchHistoryPrefix}_queries`;
    const readSearchHistory = key => {
        try {
            const value = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(value) ? value : [];
        } catch { return []; }
    };
    const writeSearchHistory = (key, value) => localStorage.setItem(key, JSON.stringify(value.slice(0, 5)));
    const rememberPage = () => {
        const current = workspaceSearchItems.find(item => item[2] === file);
        if (!current) return;
        const page = { label: current[0], detail: current[1], href: current[2], keywords: current[3] };
        writeSearchHistory(recentPagesKey, [page, ...readSearchHistory(recentPagesKey).filter(item => item.href !== page.href)]);
    };
    const rememberQuery = value => {
        const query = String(value || '').trim().replace(/\s+/g, ' ');
        if (query.length < 2) return;
        writeSearchHistory(recentQueriesKey, [query, ...readSearchHistory(recentQueriesKey).filter(item => String(item).toLowerCase() !== query.toLowerCase())]);
    };
    rememberPage();
    let visibleSearchResults = [];
    let activeSearchIndex = -1;
    const closeSearchResults = () => {
        searchResults.hidden = true;
        searchInput.setAttribute('aria-expanded', 'false');
        searchInput.removeAttribute('aria-activedescendant');
        activeSearchIndex = -1;
    };
    const openSearchResult = result => {
        if (!result) return;
        if (result.action === 'search') {
            searchInput.value = result.query || '';
            renderSearchResults({ showSuggestions: true });
            return;
        }
        rememberQuery(searchInput.value);
        if (result.action === 'help') {
            closeSearchResults();
            openWorkspaceHelp(isAdmin, result.helpQuery || searchInput.value.trim(), result.helpQuestion || '');
            return;
        }
        if (result.quickAction) sessionStorage.setItem('ace_workspace_quick_action', result.quickAction);
        window.location.assign(result.href);
    };
    const timeEntrySearchResult = entry => {
        const person = AppState.users.find(userItem => String(userItem.UserId) === String(entry.UserId)) || AppState.currentUser;
        const project = AppState.projects.find(projectItem => String(projectItem.ProjectId) === String(entry.ProjectId));
        const personName = person?.FullName || 'Employee';
        const projectName = project?.ProjectName || entry.ProjectName || 'No project';
        const status = entry.ClockOutAt ? 'Completed' : 'Active';
        const clockIn = new Date(entry.ClockInAt);
        const dateTerms = Number.isNaN(clockIn.getTime()) ? '' : [
            clockIn.toISOString().slice(0, 10),
            formatAppDate(entry.ClockInAt),
            clockIn.toLocaleDateString('en-GB'),
            clockIn.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        ].join(' ');
        return {
            label: isAdmin ? `${personName} · ${projectName}` : `Time entry · ${projectName}`,
            detail: `Time entry · ${formatAppDate(entry.ClockInAt)} · ${status}`,
            keywords: `${personName} ${person?.Email || ''} ${projectName} ${status} ${dateTerms} ${entry.FinalNote || ''}`,
            href: isAdmin
                ? `time-entry-details.html?entry=${encodeURIComponent(entry.TimeEntryId)}`
                : `time-entries.html#timeEntry-${encodeURIComponent(entry.TimeEntryId)}`,
            icon: 'timer'
        };
    };
    const reportSearchResult = report => {
        const filters = report.Filters || {};
        const creator = AppState.users.find(userItem => String(userItem.UserId) === String(report.CreatedByUserId));
        const project = AppState.projects.find(projectItem => String(projectItem.ProjectId) === String(filters.projectId));
        const department = AppState.departments.find(departmentItem => String(departmentItem.DepartmentId) === String(filters.departmentId));
        const employee = AppState.users.find(userItem => String(userItem.UserId) === String(filters.userId));
        const filterTerms = [project?.ProjectName, department?.DepartmentName, employee?.FullName].filter(Boolean).join(' ');
        return {
            label: `${formatReportType(report.ReportType)} report`,
            detail: `Saved report · ${reportDate(report.DateFrom)} to ${reportDate(report.DateTo)} · ${report.TotalRecords} record${report.TotalRecords === 1 ? '' : 's'}`,
            keywords: `${report.ReportType || ''} ${report.DateFrom || ''} ${report.DateTo || ''} ${formatAppDateTime(report.GeneratedAt)} ${creator?.FullName || ''} ${filterTerms}`,
            href: `reports.html?report=${encodeURIComponent(report.ReportId)}`,
            icon: 'chart-column-big'
        };
    };
    const setActiveSearchResult = index => {
        const options = [...searchResults.querySelectorAll('[data-search-result]')];
        if (!options.length) return;
        activeSearchIndex = (index + options.length) % options.length;
        options.forEach((option, optionIndex) => {
            const selected = optionIndex === activeSearchIndex;
            option.classList.toggle('is-active', selected);
            option.setAttribute('aria-selected', String(selected));
        });
        const active = options[activeSearchIndex];
        searchInput.setAttribute('aria-activedescendant', active.id);
        active.scrollIntoView({ block: 'nearest' });
    };
    const renderSearchResults = ({ showSuggestions = false } = {}) => {
        const rawQuery = searchInput.value.trim();
        const query = rawQuery.toLowerCase();
        const highlightSearchText = value => {
            const source = String(value || '');
            if (!query) return escapeHtml(source);
            const terms = [rawQuery, ...rawQuery.split(/[^a-z0-9]+/i)]
                .map(term => term.trim())
                .filter(term => term.length > 1)
                .filter((term, index, list) => list.findIndex(candidate => candidate.toLowerCase() === term.toLowerCase()) === index)
                .sort((left, right) => right.length - left.length);
            if (!terms.length) return escapeHtml(source);
            const expression = new RegExp(`(${terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
            let cursor = 0;
            return source.replace(expression, (match, _group, offset) => {
                const before = escapeHtml(source.slice(cursor, offset));
                cursor = offset + match.length;
                return `${before}<mark class="shell-search-highlight">${escapeHtml(match)}</mark>`;
            }) + escapeHtml(source.slice(cursor));
        };
        const matches = (item, value) => `${item.label || ''} ${item.detail || ''} ${item.keywords || ''}`.toLowerCase().includes(value);
        const matchesNaturalPhrase = action => {
            const words = query.replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);
            return action.phrases?.some(phrase => phrase.every(word => words.includes(word)));
        };
        const results = [];
        if (!query && showSuggestions) {
            quickActionItems.forEach(action => results.push({ ...action, icon: 'search' }));
            readSearchHistory(recentPagesKey).forEach(page => {
                if (page?.label && page?.href) results.push({ ...page, detail: `Recent page · ${page.detail || 'Workspace'}`, icon: 'timer' });
            });
            readSearchHistory(recentQueriesKey).forEach(previousQuery => {
                if (typeof previousQuery === 'string' && previousQuery) results.push({ label: `Search again: “${previousQuery}”`, detail: 'Recent search on this device', action: 'search', query: previousQuery, icon: 'search' });
            });
            const suggested = isAdmin ? ['Dashboard', 'Invite user', 'Users', 'Time entries'] : ['Dashboard', 'My time entries', 'Remarks', 'Profile & settings'];
            suggested.forEach(label => {
                const item = workspaceSearchItems.find(candidate => candidate[0] === label);
                if (item && !results.some(result => result.href === item[2])) results.push({ label: item[0], detail: item[1], href: item[2], keywords: item[3], icon: 'search' });
            });
        } else if (query) {
            naturalLanguageActions.filter(matchesNaturalPhrase).forEach(action => results.push({ ...action, icon: action.icon || 'search' }));
            quickActionItems.filter(action => matches(action, query)).forEach(action => results.push({ ...action, icon: 'search' }));
            const helpMatches = workspaceHelpEntries(isAdmin)
                .filter(entry => workspaceHelpEntryMatches(entry, query))
                .slice(0, 3);
            helpMatches.forEach(([question, answer]) => results.push({
                label: question,
                detail: `Help · ${answer.length > 96 ? `${answer.slice(0, 95).trim()}…` : answer}`,
                action: 'help',
                helpQuery: question,
                helpQuestion: question,
                keywords: `${question} ${answer}`,
                icon: 'info'
            }));
            // Put real work records first: someone searching a person, date,
            // project, or status is usually trying to reach that exact entry.
            AppState.timeEntries.map(timeEntrySearchResult).filter(entry => matches(entry, query)).slice(0, 4).forEach(entry => results.push(entry));
            if (isAdmin) AppState.reports.map(reportSearchResult).filter(report => matches(report, query)).slice(0, 4).forEach(report => results.push(report));
            if (isAdmin) AppState.users.filter(person => `${person.FullName || ''} ${person.Email || ''}`.toLowerCase().includes(query)).slice(0, 4).forEach(person => results.push({ label: person.FullName || person.Email, detail: person.Role === 'ADMIN' ? 'Person · Administrator' : 'Person · Employee', href: person.Role === 'USER' ? `employee-profile.html?user=${encodeURIComponent(person.UserId)}` : 'users.html', picture: person.ProfilePictureUrl, icon: 'users' }));
            AppState.projects.filter(project => project.IsActive !== false && `${project.ProjectName || ''} ${project.Description || ''}`.toLowerCase().includes(query)).slice(0, 4).forEach(project => results.push({ label: project.ProjectName, detail: 'Project', href: isAdmin ? 'projects.html' : 'time-entries.html', icon: 'folder' }));
            workspaceSearchItems.filter(item => matches({ label: item[0], detail: item[1], keywords: item[3] }, query)).slice(0, 4).forEach(item => results.push({ label: item[0], detail: item[1], href: item[2], keywords: item[3], icon: 'search' }));
            if (!helpMatches.length) results.push({ label: `Search Need help for “${rawQuery}”`, detail: 'Search all Help answers instead of restarting the tutorial', action: 'help', icon: 'info' });
        }
        visibleSearchResults = results.slice(0, 8);
        if (!visibleSearchResults.length) { closeSearchResults(); searchResults.innerHTML = ''; return; }
        const heading = query ? 'Search results' : 'Recent & quick access';
        searchResults.innerHTML = `<p class="shell-search-results-heading">${heading}<span>${query ? '↑↓ to move · Enter to open' : 'Stored only in this browser'}</span></p>${visibleSearchResults.map((result, index) => `<button class="shell-global-result" id="shellSearchResult${index}" type="button" role="option" aria-selected="false" data-search-result="${index}"><span class="shell-search-result-avatar">${result.picture ? `<img src="${escapeHtml(result.picture)}" alt="">` : suppliedIconMarkup(result.icon || 'search', 'shell-icon')}</span><span><strong>${highlightSearchText(result.label)}</strong><small>${highlightSearchText(result.detail)}</small></span></button>`).join('')}`;
        searchResults.hidden = false;
        searchInput.setAttribute('aria-expanded', 'true');
        searchResults.querySelectorAll('[data-search-result]').forEach(button => button.addEventListener('click', () => openSearchResult(visibleSearchResults[Number(button.dataset.searchResult)])));
        activeSearchIndex = -1;
    };
    searchInput.addEventListener('focus', () => renderSearchResults({ showSuggestions: true }));
    searchInput.addEventListener('input', () => renderSearchResults({ showSuggestions: true }));
    searchInput.addEventListener('keydown', event => {
        if (event.key === 'Escape') { searchInput.value = ''; closeSearchResults(); searchInput.blur(); return; }
        if (event.key === 'ArrowDown') { event.preventDefault(); if (searchResults.hidden) renderSearchResults({ showSuggestions: true }); setActiveSearchResult(activeSearchIndex + 1); return; }
        if (event.key === 'ArrowUp') { event.preventDefault(); if (searchResults.hidden) renderSearchResults({ showSuggestions: true }); setActiveSearchResult(activeSearchIndex - 1); return; }
        if (event.key === 'Enter' && activeSearchIndex >= 0) { event.preventDefault(); openSearchResult(visibleSearchResults[activeSearchIndex]); }
    });
    document.addEventListener('keydown', event => {
        if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            searchInput.focus();
            searchInput.select();
            renderSearchResults({ showSuggestions: true });
        }
    });
    document.addEventListener('click', event => {
        if (!sidebar.contains(event.target)) setAccountMenu(false);
        if (!topbar.contains(event.target)) {
            setTopbarMenu(topbarAccountButton, topbarAccountMenu, false);
            setTopbarMenu(notificationButton, notificationMenu, false);
            closeSearchResults();
        }
    });
    return true;
}

function updateEmployeeBottomNav() {
    const button = document.querySelector('[data-mobile-clock-action]');
    if (!button) return;
    button.setAttribute('aria-label', 'Open time actions');
    button.innerHTML = suppliedIconMarkup('timer', 'shell-icon');
}

function ensureMobileClockActionsModal() {
    let modal = document.getElementById('mobileClockActionsModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'mobileClockActionsModal';
    modal.className = 'modal mobile-clock-action-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `<div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="mobileClockActionsTitle"><div class="modal-header"><div><p class="mobile-clock-action-status"></p><h3 class="modal-title" id="mobileClockActionsTitle">What would you like to do?</h3></div><button class="modal-close" type="button" aria-label="Close">${suppliedIconMarkup('x')}</button></div><div class="modal-body"><div class="mobile-clock-action-list"></div><button class="btn btn-outline mobile-clock-action-cancel" type="button">Cancel</button></div></div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll('.modal-close, .mobile-clock-action-cancel').forEach(button => button.addEventListener('click', () => closeModal(modal.id)));
    modal.addEventListener('click', event => { if (event.target === modal) closeModal(modal.id); });
    return modal;
}

function openMobileClockActions() {
    const modal = ensureMobileClockActionsModal();
    const status = modal.querySelector('.mobile-clock-action-status');
    const actions = modal.querySelector('.mobile-clock-action-list');
    const clockInTime = AppState.clockInTime instanceof Date ? AppState.clockInTime : new Date(AppState.currentSession?.ClockInAt);
    const actionButton = (action, label) => `<button class="mobile-clock-action" type="button" data-mobile-clock-choice="${action}">${suppliedIconMarkup('timer', 'shell-icon')}<span>${label}</span></button>`;

    if (!AppState.isClockedIn) {
        status.textContent = 'You are currently clocked out.';
        actions.innerHTML = actionButton('clock-in', 'Clock In');
    } else {
        const time = Number.isNaN(clockInTime.getTime()) ? '' : ` since ${clockInTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
        status.textContent = `Clocked in${time}.`;
        actions.innerHTML = actionButton('clock-out', 'Clock Out');
    }
    actions.querySelectorAll('[data-mobile-clock-choice]').forEach(button => button.addEventListener('click', event => {
        closeModal(modal.id);
        if (button.dataset.mobileClockChoice === 'clock-in') openClockInModal();
        else if (button.dataset.mobileClockChoice === 'clock-out') openClockOutModal();
    }));
    openModal(modal.id);
}

function suppliedIconMarkup(name, className = 'ui-icon') {
    return `<img class="${className}" src="assets/icons/${name}.svg" alt="" aria-hidden="true">`;
}

function workspaceHelpEntries(isAdmin) {
    return isAdmin ? [
        ['How do I use the sidebar?', 'Use the arrow on the sidebar edge to collapse or expand it. On a phone, use the menu button in the top bar. Open People or Work to reveal their page links.'],
        ['How do I invite someone?', 'Use Invite user on the dashboard, enter the work email, choose the role, and send the invitation. The person can be granted access even if their invitation email has a delivery issue.'],
        ['Where do I see or cancel an invitation?', 'Open People → Invitations, find the email, select View, then choose Cancel invitation. The current workspace does not provide a resend button; create a new invitation if the old one is cancelled or expires.'],
        ['How do I approve access?', 'Open People → Access requests, review the person and requested role, then choose Approve or Deny.'],
        ['Why is someone pending or denied?', 'Open People → Users or People → Access requests to review their status. Pending users need approval; denied users cannot sign in until their status is changed by an administrator.'],
        ['How do I manage users?', 'Open People → Users and choose Manage on the person’s row. The Manage form lets you update their role, department, project, and schedule. Employee profiles also link directly to that person’s department, projects, and schedule controls.'],
        ['How do I find an employee?', 'Use the top search box to find an employee or project quickly, or open People → Users and use that page’s filters.'],
        ['How do I archive or restore a user?', 'Open People → Users and use Manage to archive an account. To restore it later, open People → Archived users and choose Restore.'],
        ['How do I create or edit a department?', 'Open People → Departments and choose Add department. To update an existing one, choose Edit on its row. Add one or more employees there and optionally choose a schedule to apply to those selected employees.'],
        ['How do I create or edit a project?', 'Open Work → Projects and choose Add project. Enter the name and description, then save. Edit an existing project to update its details or add employees directly. Use Delete only when the project should be removed.'],
        ['How do I assign a person to a project?', 'Open Work → Projects, choose Edit on the project, then use Add employee. You can optionally apply a schedule to those selected employees at the same time. You can also use People → Users → Manage → Project assignment.'],
        ['How do I create and assign a schedule?', 'Open Work → Schedule & flextime. First complete the Create schedule form: name, type, workdays, and daily hours. Then use the separate Assign employee section: choose an active employee from its search results, choose the schedule, and select Assign schedule.'],
        ['What is the difference between fixed and flextime?', 'A fixed schedule has expected start and end times. Flextime tracks the required daily elapsed time without a fixed start time.'],
        ['How do I view or correct time entries?', 'Open Work → Time entries and use the Search time entries box to locate a person, project, or record. On the row, select Correct time, enter the correct clock-in and clock-out values, then choose Save corrected time.'],
        ['How do I handle an employee who forgot to clock out?', 'Open Work → Time entries, search for the employee or active entry, select Correct time, enter the verified clock-out time, then choose Save corrected time. Use this only after confirming the time with the employee.'],
        ['What are Time-entry alerts?', 'The administrator dashboard shows Time-entry alerts only when action may be needed: an entry has been open for more than 16 hours, or an administrator stopped a shift. Open the linked entry, verify the facts with the employee, and correct the time only if it is inaccurate.'],
        ['How do I approve overtime?', 'Open Work → Time entries. For a completed employee entry on a fixed schedule, choose Approve overtime. ACE calculates only the time after the scheduled shift end and records the approving administrator and timestamp. The Approved overtime column shows the approved duration.'],
        ['Why is approved overtime blank?', 'Approved overtime is blank until an administrator approves it. Approval is available only for completed entries with a fixed schedule and a scheduled end time. Flextime and unscheduled entries do not have automatic overtime approval.'],
        ['How do I use page controls in admin lists?', 'Most administration lists use 25 rows per page by default. Choose 25, 50, or 100 rows, then use Previous, Next, or a page number. Search and filters reset to page 1 and search all matching records, not only the visible page.'],
        ['Where are deleted time entries?', 'Open Work → Deleted time entries. Select Restore to return a record to active history. Delete permanently cannot be undone, so use it only when the record must be removed for good.'],
        ['How do I add a remark to a time entry?', 'Open Work → Time entries, search for the entry, then choose Add remark on its row. Write the internal administrator remark and save it. The employee can read the related feedback in Work → Remarks.'],
        ['How do I filter the dashboard analytics?', 'Use the Period, Project, Department, and Employee filters in the Team performance overview. The cards, chart, and leaderboard update to match the selection.'],
        ['How do I generate a report?', 'Use Generate report on the dashboard, choose the date range and any available employee, department, or project filters, then preview or export the result. Insights → Reports is where you can work with the reporting tools and exports.'],
        ['Where do I find one employee’s report?', 'Open Insights → Individual reports. Choose This month for the current month through today, or Custom date range for specific dates. Optionally choose an active employee, then select Prepare reports. Use Preview, Save as PDF, or Save Excel on the prepared row. Leave the employee blank to prepare reports for every active employee.'],
        ['Where is the audit history?', 'Open Administration → Audit log. It records important administrative actions so you can review what changed and when.'],
        ['Where can I review exports?', 'Open Administration → Audit log and search for export activity. It records the administrator, time, format, and selected date range for Time Entries exports and saved reports alongside other important administrator actions.'],
        ['Where is the employee chat log?', 'Head administrators can open Administration → Employee chat log. This page is intentionally unavailable to regular administrators.'],
        ['How do I update my own account or appearance?', 'Open Administration → Settings, then use Profile, Security, or Appearance. You can also select Settings from the Account section of the sidebar.'],
        ['How do I restart the tutorial?', 'Open your account menu and choose Restart tutorial. It starts from the dashboard and adapts to whether the sidebar is open or closed.'],
        ['How do I get help without restarting the tutorial?', 'Use this Need help panel. Search a task such as invite, project, report, clock out, archive, or schedule, then open the matching answer.']
    ] : [
        ['How do I use the sidebar?', 'Use the arrow on the sidebar edge to collapse or expand it. On a phone, use the menu button in the top bar. The Work section contains My time entries and Remarks.'],
        ['How do I clock in?', 'Open Dashboard and choose Clock in. Select a project when one is available, then confirm.'],
        ['How do I clock out?', 'Open Dashboard and choose Clock out. Review the session details, add the required clock-out note, and confirm the action.'],
        ['What should I write in the clock-out note?', 'Enter a short, accurate note about the completed shift. The note is required at clock-out and is visible in your time-entry details and company reports. Do not add a new note at clock-in.'],
        ['Does ACE track breaks?', 'No. ACE records the full elapsed time from clock-in to clock-out. There are no Start Break or End Break controls.'],
        ['Why can I not clock in?', 'Check whether you already have an active session and whether your account has access. A project is optional, so you can choose No project when appropriate. If the problem continues, contact an administrator.'],
        ['Why can I not clock out?', 'Make sure you have an active work session, then use Clock out on the dashboard.'],
        ['How do I choose a project when clocking in?', 'In the Clock in form, select one of your assigned projects, or leave it as No project if your work does not need one. If a needed project is missing, ask an administrator to assign it through your user record.'],
        ['Where are my previous shifts?', 'Open Work → My time entries. Use the date, project, and status filters, then select View to inspect a record.'],
        ['How do I filter my time entries?', 'Open Work → My time entries, set a date range, project, or status, then choose Apply filters. Choose Clear filters to start again.'],
        ['How do I move through my time entries?', 'Use the page controls below the list to move through older entries. Filters apply before the list is paged, so the results shown match your selected date, project, and status.'],
        ['Can I edit or delete my own time entry?', 'Do not change time records yourself after a mistake. Open the record to review it, then ask an administrator to correct it so the history remains accurate.'],
        ['Why does my entry show an administrator remark?', 'An administrator added feedback to that time entry. Open Work → Remarks to read it and check the related entry details.'],
        ['Where are administrator remarks?', 'Open Work → Remarks to read feedback connected to your time entries.'],
        ['What does my schedule mean?', 'If an administrator assigned you a schedule, Dashboard shows it. Fixed schedules show expected start and end times; flextime shows the required daily time.'],
        ['Why am I marked late?', 'For a fixed schedule, the system compares your clock-in time with the scheduled start time. Contact an administrator if the schedule or recorded time is incorrect.'],
        ['How do I update my profile?', 'Open the sidebar account menu and choose Profile & settings. Use the Profile tab to update the available information and save changes.'],
        ['How do I change my password or security settings?', 'Open Profile & settings, select Security, make the change, and save. Use a password you do not reuse elsewhere.'],
        ['How do I change dark mode or appearance?', 'Open Profile & settings and choose Appearance. Select your preferred theme or display options, then save.'],
        ['Where are notifications?', 'Use the envelope icon in the top bar. It shows relevant updates and messages; open it again to close the notification panel.'],
        ['How do I search for a project?', 'Use the search box in the top bar to find an assigned project. Choose a result to open the appropriate workspace.'],
        ['Why is a project missing?', 'Only projects assigned to you appear in your project list and Clock in form. Ask an administrator to assign the project through People → Users → Manage.'],
        ['How do I request access or fix a denied account?', 'From the sign-in or access screen, submit an access request if that option is shown. If your request was denied or you cannot sign in, contact an administrator; they can review it in People → Access requests or your user record.'],
        ['How do I sign out?', 'Open your account menu and choose Sign out. Always clock out of your work session first if you have finished for the day.'],
        ['How do I restart the tutorial?', 'Open your account menu and choose Restart tutorial. It starts from the dashboard and guides you through the main employee workflow.'],
        ['Do I need to restart the tutorial?', 'No. Search this Need help panel for one task at a time. Restart the tutorial only when you want the full walkthrough again.']
    ];
}

function workspaceHelpEntryMatches(entry, query) {
    const needle = String(query || '').toLowerCase().trim();
    if (!needle) return true;
    const haystack = entry.join(' ').toLowerCase();
    if (haystack.includes(needle)) return true;
    const words = needle.replace(/[^a-z0-9]+/g, ' ').split(' ').filter(word => word.length > 1);
    return words.length > 0 && words.every(word => haystack.includes(word));
}

function openWorkspaceHelp(isAdmin, initialQuery = '', openQuestion = '') {
    const entries = workspaceHelpEntries(isAdmin);
    let requestedQuestion = openQuestion;
    let modal = document.getElementById('workspaceHelpModal');
    if (!modal) { modal = document.createElement('div'); modal.id = 'workspaceHelpModal'; modal.className = 'modal workspace-help-modal'; document.body.append(modal); }
    modal.innerHTML = `<div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="workspaceHelpTitle"><div class="modal-header"><div><p class="eyebrow">NEED HELP?</p><h3 class="modal-title" id="workspaceHelpTitle">${isAdmin ? 'Administrator help' : 'Employee help'}</h3></div><button class="modal-close" type="button" aria-label="Close">${suppliedIconMarkup('x')}</button></div><div class="modal-body"><label class="workspace-help-search">${suppliedIconMarkup('search')}<input type="search" placeholder="Search help, e.g. clock out or invite"></label><p class="workspace-help-count"></p><div class="workspace-help-list"></div></div></div>`;
    const input = modal.querySelector('input');
    const count = modal.querySelector('.workspace-help-count');
    const list = modal.querySelector('.workspace-help-list');
    const renderResults = query => {
        const matches = entries.filter(item => workspaceHelpEntryMatches(item, query));
        count.textContent = matches.length ? `${matches.length} answer${matches.length === 1 ? '' : 's'}` : 'No matching answers';
        list.innerHTML = matches.map(([q, a]) => {
            const open = requestedQuestion === q;
            return `<article class="faq-item"><button class="faq-question${open ? ' active' : ''}" type="button" aria-expanded="${open}">${escapeHtml(q)}</button><div class="faq-answer"><p>${escapeHtml(a)}</p></div></article>`;
        }).join('') || '<p class="workspace-help-empty">Try another word.</p>';
        list.querySelectorAll('.faq-question').forEach(button => button.addEventListener('click', () => {
            const open = button.getAttribute('aria-expanded') === 'true';
            button.setAttribute('aria-expanded', String(!open));
            button.classList.toggle('active', !open);
        }));
        requestedQuestion = '';
    };
    modal.querySelector('.modal-close').onclick = () => closeModal(modal.id);
    modal.onclick = event => { if (event.target === modal) closeModal(modal.id); };
    input.addEventListener('input', () => renderResults(input.value));
    input.value = initialQuery;
    renderResults(initialQuery);
    openModal(modal.id);
    requestAnimationFrame(() => input.focus());
}

function applySuppliedIcons() {
    const buttonIcons = {
        heroLoginBtn: 'log-in', googleLoginBtn: 'log-in',
        generateReportBtn: 'file-text', inviteUserBtn: 'user-plus', manageDepartmentsBtn: 'building', manageProjectsBtn: 'folder',
        mainClockInBtn: 'timer', mainClockOutBtn: 'log-out', clockInBtn: 'timer', clockOutBtn: 'log-out', sessionClockOutBtn: 'log-out',
        applyFiltersBtn: 'funnel', clearFiltersBtn: 'eraser', exportCsvBtn: 'download', exportXlsxBtn: 'download', exportPdfBtn: 'download',
        viewAllEntriesBtn: 'eye'
    };
    const inferIcon = text => {
        const value = String(text || '').toLowerCase();
        if (value.includes('sign in') || value.includes('log in') || value.includes('login')) return 'log-in';
        if (value.includes('clock out')) return 'log-out';
        if (value.includes('secure') || value.includes('security') || value.includes('permission')) return 'shield';
        if (value.includes('responsive') || value.includes('mobile') || value.includes('device')) return 'smartphone';
        if (value.includes('team management')) return 'users';
        if (value.includes('remark') || value.includes('message') || value.includes('note')) return 'message-circle-more';
        if (value.includes('@')) return 'mail';
        if (value.includes('phone') || /\(\d{3}\)\s*\d{3}/.test(value)) return 'phone';
        if (value.includes('password') || value.includes('key')) return 'key-round';
        if (value.includes('email') || value.includes('mail') || value.includes('invitation')) return 'mail';
        if (value.includes('department') || value.includes('office')) return 'building';
        if (value.includes('project') || value.includes('folder')) return 'folder';
        if (value.includes('audit')) return 'brick-wall-shield';
        if (value.includes('report') || value.includes('analytic') || value.includes('chart') || value.includes('month')) return 'chart-column-big';
        if (value.includes('calendar') || value.includes('date') || value.includes('week')) return 'calendar-days';
        if (value.includes('clock') || value.includes('time') || value.includes('hour') || value.includes('duration') || value.includes('entries')) return 'timer';
        if (value.includes('invite') || value.includes('add user')) return 'user-plus';
        if (value.includes('user') || value.includes('profile') || value.includes('account') || value.includes('active')) return 'users';
        if (value.includes('setting') || value.includes('preference') || value.includes('appearance')) return 'settings';
        if (value.includes('filter')) return 'funnel';
        if (value.includes('search')) return 'search';
        if (value.includes('download') || value.includes('export')) return 'download';
        if (value.includes('print')) return 'printer';
        if (value.includes('edit') || value.includes('change')) return 'square-pen';
        if (value.includes('delete') || value.includes('remove')) return 'trash';
        if (value.includes('close') || value.includes('cancel')) return 'x';
        if (value.includes('view') || value.includes('show')) return 'eye';
        if (value.includes('warning') || value.includes('error') || value.includes('deny') || value.includes('pending')) return 'triangle-alert';
        if (value.includes('success') || value.includes('approve')) return 'check';
        if (value.includes('dashboard') || value.includes('overview')) return 'layout-panel-top';
        return 'info';
    };
    document.querySelectorAll('svg').forEach(svg => {
        const owner = svg.closest('button, a, .stat-card, .summary-card, .feature-card, .step-card, .info-feature, .modal-header, .input-group, .settings-tab, .profile-avatar') || svg.parentElement;
        const button = svg.closest('button');
        const inputGroup = svg.closest('.input-group');
        const input = inputGroup?.querySelector('input');
        let name = button && buttonIcons[button.id];
        if (!name && button?.classList.contains('password-toggle')) name = 'eye';
        if (!name && svg.closest('.modal-close')) name = 'x';
        if (!name && !button && input) name = input.type === 'password' || input.id.toLowerCase().includes('password') ? 'key-round' : 'mail';
        if (!name && svg.closest('.login-icon')) name = 'log-in';
        if (!name && svg.closest('.avatar-preview')) name = 'users';
        if (!name) name = inferIcon(owner?.textContent || owner?.getAttribute?.('aria-label'));
        const replacement = document.createElement('img');
        replacement.className = 'ui-icon';
        if (svg.classList.contains('nav-logo')) replacement.classList.add('nav-logo');
        replacement.src = `assets/icons/${name}.svg`;
        replacement.alt = '';
        replacement.setAttribute('aria-hidden', 'true');
        svg.replaceWith(replacement);
    });

    // Keep action buttons consistent across every legacy page. Only genuine
    // actions receive icons; tabs, pagination, disclosure controls and icon-only
    // buttons retain their purpose-built treatment.
    document.querySelectorAll('.btn').forEach(button => {
        if (button.querySelector('img, svg') || button.matches('.btn-google, .password-toggle, .modal-close, .toast-close')) return;
        const name = buttonIcons[button.id] || inferIcon(button.textContent || button.getAttribute('aria-label'));
        if (!name || name === 'info' && !/learn|help|details/i.test(button.textContent || '')) return;
        button.insertAdjacentHTML('afterbegin', suppliedIconMarkup(name));
    });
}

// Navigation
function initializeNavigation() {
    // Logout buttons
    document.querySelectorAll('#logoutBtn').forEach(btn => {
        btn.addEventListener('click', handleLogout);
    });

    // Help buttons
    document.querySelectorAll('#navHelpBtn, #footerHelpLink').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            openModal('helpModal');
        });
    });

    // Login buttons
    document.querySelectorAll('#navLoginBtn, #heroLoginBtn, #footerLoginLink').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            window.location.href = '/login';
        });
    });

    const heroLearnMoreBtn = document.getElementById('heroLearnMoreBtn');
    if (heroLearnMoreBtn) {
        heroLearnMoreBtn.addEventListener('click', () => {
            document.querySelector('.features-section').scrollIntoView({ behavior: 'smooth' });
        });
    }

    // Sidebar navigation
    document.querySelectorAll('.sidebar-link').forEach(link => {
        link.addEventListener('click', function() {
            document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
            this.classList.add('active');
        });
    });
}

// Modals
function initializeModals() {
    // Normalise the older static dialogs as well as the newer generated ones.
    // This gives screen-reader users a title and keeps the page semantics
    // consistent no matter which workflow opened the dialog.
    document.querySelectorAll('.modal').forEach((modal, index) => {
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        if (!modal.hasAttribute('aria-hidden')) modal.setAttribute('aria-hidden', 'true');
        const title = modal.querySelector('.modal-title');
        if (title) {
            if (!title.id) title.id = `aceModalTitle${index + 1}`;
            modal.setAttribute('aria-labelledby', title.id);
        }
    });
    document.querySelectorAll('.modal-close').forEach(button => {
        if (!button.getAttribute('aria-label')) button.setAttribute('aria-label', 'Close dialog');
    });
    // Close modal buttons
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', function() {
            const modal = this.closest('.modal');
            closeModal(modal.id);
        });
    });

    // Close modal when clicking outside
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal(modal.id);
            }
        });
    });

    // Close modal with Escape key
    document.addEventListener('keydown', (e) => {
        const activeModal = document.querySelector('.modal.active');
        if (e.key === 'Tab' && activeModal) {
            const focusable = [...activeModal.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
                .filter(element => !element.hidden && getComputedStyle(element).visibility !== 'hidden');
            if (focusable.length) {
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            }
        }
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal.active').forEach(modal => {
                closeModal(modal.id);
            });
        }
    });

    // Request access
    const requestAccessLink = document.getElementById('requestAccessLink');
    if (requestAccessLink) {
        requestAccessLink.addEventListener('click', (e) => {
            e.preventDefault();
            if (AppState.currentUser?.Status === 'DENIED') {
                showToast(deniedAccessRequestMessage, 'warning');
                return;
            }
            beginGoogleAccessRequest();
        });
    }

    // Invite user
    const inviteUserBtn = document.getElementById('inviteUserBtn');
    if (inviteUserBtn) {
        inviteUserBtn.addEventListener('click', () => {
            openModal('inviteUserModal');
            populateDepartmentSelect('inviteDepartment');
        });
    }

    // Generate report
    const generateReportBtn = document.getElementById('generateReportBtn');
    if (generateReportBtn) {
        generateReportBtn.addEventListener('click', () => {
            if (document.getElementById('dashboardRange')) {
                openAnalyticsExportModal();
                return;
            }
            openModal('generateReportModal');
            const reportMonth = document.getElementById('reportMonth');
            if (reportMonth) {
                const currentMonth = new Date().toISOString().slice(0, 7);
                reportMonth.max = currentMonth;
                if (!reportMonth.value) reportMonth.value = currentMonth;
            }
            populateDepartmentSelect('reportDepartment');
            populateProjectSelect('reportProject');
            populateUserSelect('reportUser');
        });
    }

    // Clock in buttons
    const clockInBtn = document.getElementById('mainClockInBtn');
    if (clockInBtn) clockInBtn.addEventListener('click', openClockInModal);

    const clockInBtnAlt = document.getElementById('clockInBtn');
    if (clockInBtnAlt) clockInBtnAlt.addEventListener('click', openClockInModal);

    // Clock out buttons
    const clockOutBtn = document.getElementById('mainClockOutBtn');
    if (clockOutBtn) clockOutBtn.addEventListener('click', openClockOutModal);

    const sessionClockOutBtn = document.getElementById('sessionClockOutBtn');
    if (sessionClockOutBtn) sessionClockOutBtn.addEventListener('click', openClockOutModal);


    initializeHomePreview();

    // Dashboard and legacy footer shortcuts must behave like their matching
    // sidebar destinations instead of looking clickable without doing anything.
    const routeButtons = {
        manageDepartmentsBtn: 'departments.html',
        manageProjectsBtn: 'projects.html',
        footerUsersLink: 'users.html',
        footerReportsLink: 'reports.html',
        footerAuditLogsLink: 'audit-logs.html'
    };
    Object.entries(routeButtons).forEach(([id, href]) => {
        const control = document.getElementById(id);
        if (!control) return;
        control.addEventListener('click', event => {
            event.preventDefault();
            if (window.ACEDashboardNavigate && document.body.classList.contains('has-app-shell')) window.ACEDashboardNavigate(href);
            else window.location.href = cleanInternalRoute(href);
        });
    });

    const clockOutBtnAlt = document.getElementById('clockOutBtn');
    if (clockOutBtnAlt) clockOutBtnAlt.addEventListener('click', openClockOutModal);

    // Settings tabs
    const settingsTabs = document.querySelectorAll('.settings-tab');
    settingsTabs.forEach(tab => {
        tab.addEventListener('click', function() {
            const tabId = this.id;
            document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            
            document.querySelectorAll('.settings-section').forEach(section => {
                section.style.display = 'none';
            });
            
            const sectionMap = {
                'profileTab': 'profileSettings',
                'securityTab': 'securitySettings',
                'appearanceTab': 'appearanceSettings'
            };
            
            const targetSection = document.getElementById(sectionMap[tabId]);
            if (targetSection) {
                targetSection.style.display = 'block';
            }
        });
    });

    // FAQ toggles
    document.querySelectorAll('.faq-question').forEach(question => {
        question.addEventListener('click', function() {
            this.classList.toggle('active');
            this.setAttribute('aria-expanded', this.classList.contains('active') ? 'true' : 'false');
            const answer = this.nextElementSibling;
            if (answer.style.display === 'block') {
                answer.style.display = 'none';
            } else {
                answer.style.display = 'block';
            }
        });
    });
}

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal._trigger = document.activeElement;
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');
        const focusTarget = modal.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button');
        window.setTimeout(() => focusTarget?.focus(), 30);
    }

}

function initializeHomePreview() {
    const button = document.getElementById('homePreviewClockButton');
    if (!button || button.dataset.bound) return;
    button.dataset.bound = 'true';
    button.addEventListener('click', () => {
        window.location.assign('/login');
    });
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
        if (!document.querySelector('.modal.active')) document.body.classList.remove('modal-open');
        modal._trigger?.focus?.();
    }
}

// Shared application dialogs replace browser-native confirm and prompt windows.
// They are promise-based so every destructive action gets the same accessible UI.
function ensureAceDialog() {
    let modal = document.getElementById('aceActionDialog');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'aceActionDialog';
    modal.className = 'modal ace-action-dialog';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = '<div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="aceActionDialogTitle"><div class="modal-header"><h3 class="modal-title" id="aceActionDialogTitle"></h3><button class="modal-close" type="button" aria-label="Close">×</button></div><div class="modal-body"><p class="modal-description"></p><div class="form-group ace-action-dialog-input" hidden><label class="form-label" for="aceActionDialogInput"></label><input class="form-input" id="aceActionDialogInput" maxlength="2000"></div></div><div class="modal-footer"><button class="btn btn-outline ace-action-cancel" type="button">Cancel</button><button class="btn btn-primary ace-action-confirm" type="button">Confirm</button></div></div>';
    document.body.appendChild(modal);
    return modal;
}

function showAceDialog(options = {}) {
    return new Promise(resolve => {
        const modal = ensureAceDialog();
        const title = modal.querySelector('.modal-title');
        const description = modal.querySelector('.modal-description');
        const inputWrap = modal.querySelector('.ace-action-dialog-input');
        const inputLabel = inputWrap.querySelector('label');
        const input = inputWrap.querySelector('input');
        const confirmButton = modal.querySelector('.ace-action-confirm');
        const cancelButton = modal.querySelector('.ace-action-cancel');
        const closeButton = modal.querySelector('.modal-close');
        const hasInput = Boolean(options.input);
        title.textContent = options.title || 'Please confirm';
        description.textContent = options.message || '';
        description.hidden = !options.message;
        inputWrap.hidden = !hasInput;
        inputLabel.textContent = options.label || 'Value';
        input.value = options.value || '';
        input.placeholder = options.placeholder || '';
        confirmButton.textContent = options.confirmLabel || 'Confirm';
        confirmButton.className = 'btn ' + (options.danger ? 'btn-danger' : 'btn-primary') + ' ace-action-confirm';
        const finish = value => {
            modal.removeEventListener('click', onBackdrop);
            closeButton.onclick = null; cancelButton.onclick = null; confirmButton.onclick = null;
            input.onkeydown = null; modal.onkeydown = null;
            closeModal('aceActionDialog');
            resolve(value);
        };
        const onBackdrop = event => { if (event.target === modal) finish(null); };
        modal.addEventListener('click', onBackdrop);
        closeButton.onclick = () => finish(null);
        cancelButton.onclick = () => finish(null);
        confirmButton.onclick = () => finish(hasInput ? input.value : true);
        input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); finish(input.value); } };
        modal.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); finish(null); } };
        openModal('aceActionDialog');
    });
}

window.ACEUI = {
    confirm: options => showAceDialog(options),
    prompt: options => showAceDialog({ ...options, input: true })
};

// Forms
function initializeForms() {
    // Google login
    const googleLoginBtn = document.getElementById('googleLoginBtn');
    if (googleLoginBtn) {
        googleLoginBtn.addEventListener('click', handleGoogleLogin);
    }

    // Request access form
    const requestAccessForm = document.getElementById('requestAccessForm');
    if (requestAccessForm) {
        requestAccessForm.addEventListener('submit', handleRequestAccess);
    }

    // Invite user form
    const inviteUserForm = document.getElementById('inviteUserForm');
    if (inviteUserForm) {
        inviteUserForm.addEventListener('submit', handleInviteUser);
    }

    // Generate report form
    const generateReportForm = document.getElementById('generateReportForm');
    if (generateReportForm) {
        generateReportForm.addEventListener('submit', handleGenerateReport);
    }

    // Clock in form
    const clockInForm = document.getElementById('clockInForm');
    if (clockInForm) {
        clockInForm.addEventListener('submit', handleClockIn);
    }
    // Clock out form
    const clockOutForm = document.getElementById('clockOutForm');
    if (clockOutForm) {
        clockOutForm.addEventListener('submit', handleClockOut);
    }

    // Profile form
    const profileForm = document.getElementById('profileForm');
    if (profileForm) {
        profileForm.addEventListener('submit', handleProfileUpdate);
    }
    const profilePhoto = document.getElementById('profilePhoto');
    const profilePhotoFeedback = document.getElementById('profilePhotoFeedback');
    if (profilePhoto && profilePhotoFeedback) {
        profilePhoto.addEventListener('change', () => {
            const file = profilePhoto.files?.[0];
            if (!file) { profilePhotoFeedback.textContent = ''; profilePhotoFeedback.className = 'profile-photo-feedback'; return; }
            const isSupported = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
            const isWithinLimit = file.size <= 5 * 1024 * 1024;
            if (!isSupported) {
                profilePhoto.value = '';
                profilePhotoFeedback.textContent = 'Choose an image only: JPG, PNG, or WebP. Videos are not supported.';
                profilePhotoFeedback.className = 'profile-photo-feedback is-error';
            } else if (!isWithinLimit) {
                profilePhoto.value = '';
                profilePhotoFeedback.textContent = `This file is ${(file.size / 1024 / 1024).toFixed(1)} MB. Choose an image under 5 MB.`;
                profilePhotoFeedback.className = 'profile-photo-feedback is-error';
            } else {
                profilePhotoFeedback.textContent = `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB — ready to upload.`;
                profilePhotoFeedback.className = 'profile-photo-feedback is-success';
            }
        });
    }

    // Appearance form
    const appearanceForm = document.getElementById('appearanceForm');
    if (appearanceForm) {
        appearanceForm.addEventListener('submit', handleAppearanceUpdate);
    }

    // Filter buttons
    const applyFiltersBtn = document.getElementById('applyFiltersBtn');
    if (applyFiltersBtn) {
        applyFiltersBtn.addEventListener('click', applyFilters);
    }

    const clearFiltersBtn = document.getElementById('clearFiltersBtn');
    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener('click', clearFilters);
    }

    // View all entries
    const viewAllEntriesBtn = document.getElementById('viewAllEntriesBtn');
    if (viewAllEntriesBtn) {
        viewAllEntriesBtn.addEventListener('click', () => {
        if (window.ACEDashboardNavigate && document.body.classList.contains('has-app-shell')) window.ACEDashboardNavigate('/time-entries');
        else window.location.href = '/time-entries';
        });
    }

    initializeSecondaryActions();
}

function initializeSecondaryActions() {
    document.getElementById('cancelProfileBtn')?.addEventListener('click', () => {
        loadUserSettings();
        showToast('Unsaved profile changes discarded.', 'info');
    });

    const exportButtons = {
        exportCsvBtn: 'CSV',
        exportXlsxBtn: 'XLSX',
        exportPdfBtn: 'PDF'
    };
    Object.entries(exportButtons).forEach(([id, type]) => {
        document.getElementById(id)?.addEventListener('click', () => exportReport(null, type));
    });
}

// Auth Handlers
async function handleGoogleLogin(event) {
    event?.preventDefault();
    showSpinner();
    try {
        if (!window.ACEAuth) throw new Error('Authentication service is unavailable.');
        const auth = await window.ACEAuth.client();
        const { error } = await auth.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/login`, queryParams: { prompt: 'select_account' } } });
        if (error) throw error;
    } catch (error) {
        hideSpinner();
        showToast(error.message || 'Unable to start Google sign-in', 'error');
    }
}

function handleLogout() {
    let modal = document.getElementById('logoutConfirmModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'logoutConfirmModal';
        modal.className = 'modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'logoutConfirmTitle');
        modal.innerHTML = `<div class="modal-content logout-confirm-card"><div class="modal-header"><h3 class="modal-title" id="logoutConfirmTitle">Confirm logout</h3><button class="modal-close" type="button" aria-label="Close">${suppliedIconMarkup('x')}</button></div><div class="modal-body"><div class="logout-confirm-icon">${suppliedIconMarkup('log-out')}</div><h4>Leave your ACE workspace?</h4><p>You will need to sign in again to access your time records and company tools.</p><div class="form-actions"><button class="btn btn-outline logout-cancel" type="button">${suppliedIconMarkup('x')}Stay signed in</button><button class="btn btn-primary logout-confirm" type="button">${suppliedIconMarkup('log-out')}Log out</button></div></div></div>`;
        document.body.appendChild(modal);
        modal.querySelectorAll('.modal-close, .logout-cancel').forEach(button => button.addEventListener('click', () => closeModal('logoutConfirmModal')));
        modal.addEventListener('click', event => { if (event.target === modal) closeModal('logoutConfirmModal'); });
        modal.querySelector('.logout-confirm').addEventListener('click', performLogout);
    }
    openModal('logoutConfirmModal');
}

async function performLogout() {
    closeModal('logoutConfirmModal');
    try {
        if (window.ACEAuth) {
            await window.ACEAuth.request('/v1/auth/session-end', { method: 'POST' }).catch(() => {});
            const auth = await window.ACEAuth.client();
            const { error } = await auth.auth.signOut();
            if (error) throw error;
        }
    } catch (error) {
        showToast(error.message || 'Unable to sign out of the authentication service', 'error');
        return;
    }
    AppState.currentUser = null;
    stopPresenceHeartbeat();
    if (AppState.onlineCountInterval) window.clearInterval(AppState.onlineCountInterval);
    AppState.onlineCountInterval = null;
    stopLiveDataRefresh();
    AppState.isAuthenticated = false;
    AppState.isClockedIn = false;
    
    localStorage.removeItem('ace_current_user');
    localStorage.removeItem('ace_current_session');
    sessionStorage.removeItem('ace_login_audited');
    
    showToast('Logged out successfully', 'success');
    
    setTimeout(() => {
        window.location.href = '/login';
    }, 450);
}

function startPresenceHeartbeat() {
    stopPresenceHeartbeat();
    const send = () => {
        if (document.visibilityState !== 'visible' || !window.ACEAuth) return;
        window.ACEAuth.request('/v1/auth/heartbeat', { method: 'POST' }).catch(() => {});
    };
    send();
    AppState.presenceInterval = window.setInterval(send, 45 * 1000);
    AppState.presenceVisibilityHandler = send;
    document.addEventListener('visibilitychange', AppState.presenceVisibilityHandler);
}

function stopPresenceHeartbeat() {
    if (AppState.presenceInterval) window.clearInterval(AppState.presenceInterval);
    if (AppState.presenceVisibilityHandler) document.removeEventListener('visibilitychange', AppState.presenceVisibilityHandler);
    AppState.presenceInterval = null;
    AppState.presenceVisibilityHandler = null;
}

// Presence only tells us that a browser is open. Operational information needs
// a separate, quiet refresh so admins see new clock-ins and clock-outs,
// people coming online, and new remarks without reloading the workspace.
async function refreshLiveWorkspaceData() {
    if (AppState.liveRefreshInFlight || document.visibilityState !== 'visible' || !window.ACEAuth || !AppState.currentUser) return;
    if (document.querySelector('.modal.active, input:focus, textarea:focus, select:focus')) return;
    AppState.liveRefreshInFlight = true;
    try {
        const admin = AppState.currentUser.Role === 'ADMIN';
        const requests = [
            window.ACEAuth.request(`/v1/time-entries${admin ? '' : '?mine=true'}`),
            window.ACEAuth.request('/v1/admin-remarks'),
            window.ACEAuth.request('/v1/my-schedule'),
            window.ACEAuth.request('/v1/user-projects')
        ];
        if (admin) requests.push(
            window.ACEAuth.request('/v1/users'),
            window.ACEAuth.request('/v1/departments'),
            window.ACEAuth.request('/v1/projects'),
            window.ACEAuth.request('/v1/reports')
        );
        const results = await Promise.all(requests);
        AppState.timeEntries = results[0].map(timeEntryRecord);
        AppState.adminRemarks = results[1].map(adminRemarkRecord);
        AppState.assignedSchedule = results[2];
        AppState.userProjects = results[3].map(item => ({ UserId: item.user_id, ProjectId: item.project_id, AssignedAt: item.assigned_at, IsActive: true }));
        if (admin) {
            AppState.users = results[4].map(profileRecord);
            AppState.departments = results[5].map(departmentRecord);
            AppState.projects = results[6].map(projectRecord);
            AppState.reports = results[7].map(reportRecord);
        }
        const active = AppState.timeEntries.find(entry => !entry.ClockOutAt && entry.UserId === AppState.currentUser.UserId);
        AppState.currentSession = active || null;
        AppState.isClockedIn = Boolean(active);
        AppState.clockInTime = active ? new Date(active.ClockInAt) : null;
        updateUI();
        loadPageSpecificData();
        window.dispatchEvent(new CustomEvent('ace:live-data'));
    } catch (error) {
        // Do not interrupt someone working with a transient status toast. The
        // next scheduled pass recovers when a sleeping service wakes up.
        console.warn('Could not refresh live workspace data.', error);
    } finally {
        AppState.liveRefreshInFlight = false;
    }
}

function startLiveDataRefresh() {
    stopLiveDataRefresh();
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') void refreshLiveWorkspaceData(); };
    AppState.liveDataInterval = window.setInterval(() => void refreshLiveWorkspaceData(), 20000);
    AppState.liveRefreshVisibilityHandler = refreshWhenVisible;
    document.addEventListener('visibilitychange', refreshWhenVisible);
}

function stopLiveDataRefresh() {
    if (AppState.liveDataInterval) window.clearInterval(AppState.liveDataInterval);
    if (AppState.liveRefreshVisibilityHandler) document.removeEventListener('visibilitychange', AppState.liveRefreshVisibilityHandler);
    AppState.liveDataInterval = null;
    AppState.liveRefreshVisibilityHandler = null;
    AppState.liveRefreshInFlight = false;
}

async function beginGoogleAccessRequest() {
    try {
        if (!window.ACEAuth) throw new Error('Request service is unavailable.');
        const auth = await window.ACEAuth.client();
        const { error } = await auth.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/login?requestAccess=1`, queryParams: { prompt: 'select_account' } } });
        if (error) throw error;
    } catch (error) { showToast(error.message || 'Unable to start Google sign-in.', 'error'); }
}

async function handleRequestAccess(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton?.disabled) return;
    const originalLabel = submitButton?.innerHTML;
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.setAttribute('aria-busy', 'true');
        submitButton.textContent = 'Submitting request…';
    }
    try {
        if (!window.ACEAuth) throw new Error('Request service is unavailable.');
        await window.ACEAuth.request('/v1/access-requests', { method: 'POST', body: JSON.stringify({ department: document.getElementById('requestDepartment').value.trim(), message: document.getElementById('requestMessage').value.trim() }) });
        closeModal('requestAccessModal');
        form.reset();
        showToast('Access request submitted. An administrator has 24 hours to review it.', 'success');
    } catch (error) {
        showToast(error.message || 'Unable to submit access request.', 'error');
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.removeAttribute('aria-busy');
            submitButton.innerHTML = originalLabel;
        }
    }
}

function openClockInModal() {
    openModal('clockInModal');
    populateProjectSelect('clockInProject');
}

function openClockOutModal() {
    showClockOutSummary();
    openModal('clockOutModal');
}

// Clock In/Out Handlers
async function handleClockIn(e) {
    e.preventDefault();
    const submitButton = e.currentTarget.querySelector('button[type="submit"]');
    if (submitButton?.disabled) return;
    const projectId = document.getElementById('clockInProject')?.value;
    try {
        setActionBusy(submitButton, true, 'Clocking in…');
        const entry = await window.ACEAuth.request('/v1/time-entries/clock-in', { method: 'POST', body: JSON.stringify({ projectId: projectId || null }) });
        AppState.currentSession = timeEntryRecord(entry);
        AppState.timeEntries.unshift(AppState.currentSession);
        AppState.isClockedIn = true; AppState.clockInTime = new Date(AppState.currentSession.ClockInAt);
        closeModal('clockInModal'); startTimer(); updateUI(); loadPageSpecificData();
        showToast('Clocked in successfully', 'success');
    } catch (error) { showToast(error.message || 'Unable to clock in', 'error'); }
    finally { setActionBusy(submitButton, false); }
}

async function handleClockOut(e) {
    e.preventDefault();
    const submitButton = e.currentTarget.querySelector('button[type="submit"]');
    if (submitButton?.disabled) return;
    const note = document.getElementById('clockOutNote')?.value;
    if (!AppState.currentSession) return;
    try {
        setActionBusy(submitButton, true, 'Clocking out…');
        const entry = await window.ACEAuth.request(`/v1/time-entries/${AppState.currentSession.TimeEntryId}/clock-out`, { method: 'POST', body: JSON.stringify({ note: note || '' }) });
        const saved = timeEntryRecord(entry);
        AppState.timeEntries = AppState.timeEntries.map(item => item.TimeEntryId === saved.TimeEntryId ? saved : item);
        AppState.isClockedIn = false; AppState.currentSession = null; AppState.clockInTime = null;
        stopTimer(); closeModal('clockOutModal'); updateUI(); loadPageSpecificData();
        showToast('Clocked out successfully', 'success');
    } catch (error) { showToast(error.message || 'Unable to clock out', 'error'); }
    finally { setActionBusy(submitButton, false); }
}


function setActionBusy(button, busy, label = '') {
    if (!button) return;
    if (busy) { button.dataset.label = button.textContent.trim(); button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = label; }
    else { button.disabled = false; button.removeAttribute('aria-busy'); if (button.dataset.label) button.textContent = button.dataset.label; }
}

function startTimer() {
    if (AppState.timerInterval) {
        clearInterval(AppState.timerInterval);
    }
    
    AppState.timerInterval = setInterval(() => {
        updateTimerDisplay();
    }, 1000);
}

function stopTimer() {
    if (AppState.timerInterval) {
        clearInterval(AppState.timerInterval);
        AppState.timerInterval = null;
    }
}

function updateTimerDisplay() {
    if (!AppState.isClockedIn || !AppState.clockInTime) return;
    
    const now = new Date();
    const duration = Math.max(0, Math.floor((now - AppState.clockInTime) / 1000));
    const hours = Math.floor(duration / 3600);
    const minutes = Math.floor((duration % 3600) / 60);
    const seconds = duration % 60;
    
    const timeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    
    const timerElements = document.querySelectorAll('#sessionTimer, #currentDuration');
    timerElements.forEach(el => {
        if (el) el.textContent = timeString;
    });
}

function showClockOutSummary() {
    if (!AppState.currentSession) return;
    
    const clockInTime = new Date(AppState.currentSession.ClockInAt);
    const now = new Date();
    const duration = Math.max(0, Math.floor((now - clockInTime) / 1000));
    const hours = Math.floor(duration / 3600);
    const minutes = Math.floor((duration % 3600) / 60);
    const seconds = duration % 60;
    
    const timeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    
    const clockOutInTime = document.getElementById('clockOutInTime');
    const clockOutDuration = document.getElementById('clockOutDuration');
    const clockOutProject = document.getElementById('clockOutProject');
    
    if (clockOutInTime) {
        clockOutInTime.textContent = clockInTime.toLocaleTimeString();
    }
    if (clockOutDuration) {
        clockOutDuration.textContent = timeString;
    }
    if (clockOutProject && AppState.currentSession.ProjectId) {
        const project = AppState.projects.find(p => p.ProjectId === AppState.currentSession.ProjectId);
        clockOutProject.textContent = project ? project.ProjectName : 'None';
    }
}

// Admin Handlers
async function handleInviteUser(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    // Prevent a slow mail/database response from being mistaken for a failed
    // click, and make the in-progress state obvious to the administrator.
    if (submitButton?.disabled) return;

    const email = document.getElementById('inviteEmail').value.trim().toLowerCase();
    const departmentId = document.getElementById('inviteDepartment')?.value;
    const role = document.getElementById('inviteRole')?.value;
    const originalLabel = submitButton?.innerHTML;
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.setAttribute('aria-busy', 'true');
        submitButton.textContent = 'Sending invitation…';
    }

    try {
        const invitation = await window.ACEAuth.request('/v1/invitations', { method: 'POST', body: JSON.stringify({ email, departmentId: departmentId || null, role: role || 'USER' }) });
        if (Array.isArray(AppState.invitations)) AppState.invitations.unshift(invitation);
        closeModal('inviteUserModal');
        form.reset();
        const emailMessage = invitation.email_sent
            ? `${email} now has access and the onboarding email was sent.`
            : `${email} now has access. The onboarding email was not delivered: ${invitation.email_issue || 'check the email service settings.'}`;
        // Access is granted before the optional email is sent, so a delivery
        // issue must not make a successful invitation look like it failed.
        showToast(emailMessage, 'success');
    } catch (error) {
        showToast(error.message || 'Unable to grant access to this account.', 'error');
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.removeAttribute('aria-busy');
            submitButton.innerHTML = originalLabel;
        }
    }
}

async function handleGenerateReport(e) {
    e.preventDefault();
    
    const reportType = document.getElementById('reportType').value;
    const reportMonth = document.getElementById('reportMonth')?.value;
    const currentMonth = new Date().toISOString().slice(0, 7);
    if (!reportMonth || reportMonth > currentMonth) {
        showToast('Choose the current month or an earlier reporting month.', 'warning');
        document.getElementById('reportMonth')?.focus();
        return;
    }
    const [reportYear, reportMonthIndex] = (reportMonth || '').split('-').map(Number);
    const lastDay = reportYear && reportMonthIndex ? new Date(reportYear, reportMonthIndex, 0).getDate() : null;
    const dateFrom = reportMonth ? `${reportMonth}-01` : document.getElementById('dateFrom')?.value;
    const dateTo = reportMonth ? `${reportMonth}-${String(lastDay).padStart(2, '0')}` : document.getElementById('dateTo')?.value;
    const departmentId = document.getElementById('reportDepartment')?.value;
    const projectId = document.getElementById('reportProject')?.value;
    const userId = document.getElementById('reportUser')?.value;
    const exportFormat = document.getElementById('reportExportFormat')?.value === 'XLSX' ? 'XLSX' : 'PDF';
    
    const previewFilters = {
        departmentId: departmentId || null,
        projectId: projectId || null,
        userId: userId || null
    };
    try {
        const saved = await window.ACEAuth.request('/v1/reports', { method: 'POST', body: JSON.stringify({ reportType, dateFrom, dateTo, filters: previewFilters }) });
        const report = reportRecord(saved);
        AppState.reports.unshift(report);
        closeModal('generateReportModal'); document.getElementById('generateReportForm').reset();
        showToast('Report generated from Supabase data.', 'success');
        if (window.location.href.includes('reports.html')) loadReportsList();
        renderGeneratedReport(report);
        if (exportFormat === 'XLSX') window.setTimeout(() => exportExcelReport(report.ReportId), 80);
        else window.setTimeout(printGeneratedReport, 80);
    } catch (error) { showToast(error.message || 'Unable to generate report', 'error'); }
}

function filterEntriesForReport(report) {
    const from = report.DateFrom ? new Date(`${report.DateFrom}T00:00:00+08:00`).getTime() : -Infinity;
    const to = report.DateTo ? new Date(`${report.DateTo}T23:59:59.999+08:00`).getTime() : Infinity;
    const filters = report.Filters || {};
    const matchesId = (expected, actual) => !expected || String(expected) === String(actual);
    return AppState.timeEntries.filter(entry => {
        const time = new Date(entry.ClockInAt).getTime();
        const user = AppState.users.find(item => item.UserId === entry.UserId);
        return time >= from && time <= to &&
            matchesId(filters.projectId, entry.ProjectId) &&
            matchesId(filters.userId, entry.UserId) &&
            matchesId(filters.departmentId, user?.DepartmentId) &&
            (!filters.status || (filters.status === 'COMPLETED' ? Boolean(entry.ClockOutAt) : !entry.ClockOutAt));
    });
}

if (typeof window !== 'undefined') window.filterEntriesForReport = filterEntriesForReport;

function ensureGeneratedReportModal() {
    let modal = document.getElementById('generatedReportModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'generatedReportModal';
    modal.className = 'modal generated-report-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'generatedReportModalTitle');
    modal.innerHTML = `<div class="modal-content"><div class="modal-header"><div><p class="eyebrow">REPORT PREVIEW</p><h3 class="modal-title" id="generatedReportModalTitle">Time tracking report</h3></div><button class="modal-close" type="button" aria-label="Close">${suppliedIconMarkup('x')}</button></div><div class="modal-body"><article class="printable-report" id="printableReport"></article><div class="report-preview-actions"><button class="btn btn-outline report-preview-close" type="button">${suppliedIconMarkup('x')}Close</button><button class="btn btn-outline" id="exportGeneratedReportExcelBtn" type="button">${suppliedIconMarkup('download')}Save Excel</button><button class="btn btn-primary" id="printGeneratedReportBtn" type="button">${suppliedIconMarkup('printer')}Save as PDF</button></div></div></div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll('.modal-close, .report-preview-close').forEach(button => button.addEventListener('click', () => closeModal('generatedReportModal')));
    modal.addEventListener('click', event => { if (event.target === modal) closeModal('generatedReportModal'); });
    modal.querySelector('#printGeneratedReportBtn').addEventListener('click', printGeneratedReport);
    modal.querySelector('#exportGeneratedReportExcelBtn').addEventListener('click', () => exportExcelReport(modal._report || modal.dataset.reportId || null));
    return modal;
}

function printGeneratedReport() {
    const report = document.getElementById('printableReport');
    if (!report || document.body.classList.contains('printing-report')) return;

    const originalParent = report.parentNode;
    const originalNextSibling = report.nextSibling;
    const restoreReport = () => {
        if (originalNextSibling?.parentNode === originalParent) originalParent.insertBefore(report, originalNextSibling);
        else originalParent.appendChild(report);
        document.body.classList.remove('printing-report');
    };

    document.body.appendChild(report);
    document.body.classList.add('printing-report');
    window.addEventListener('afterprint', restoreReport, { once: true });
    window.setTimeout(() => window.print(), 50);
}

function renderGeneratedReport(report, options = {}) {
    const modal = ensureGeneratedReportModal();
    modal.dataset.reportId = report.ReportId || '';
    modal._report = report;
    const reportElement = modal.querySelector('#printableReport');
    const entries = filterEntriesForReport(report);
    const totalSeconds = entries.reduce((sum, entry) => sum + Number(entry.DurationSeconds || 0), 0);
    reportElement.innerHTML = `<section class="print-report-table"><h2>Time entry details</h2><p><strong>Total worked:</strong> ${formatDuration(totalSeconds)}</p><table><thead><tr><th>Employee</th><th>Project</th><th>Clock in</th><th>Clock out</th><th>Worked</th><th>Clock-out note</th><th>Status</th></tr></thead><tbody>${entries.length ? entries.map(entry => { const user = AppState.users.find(item => item.UserId === entry.UserId); const project = entry.ProjectName || AppState.projects.find(item => item.ProjectId === entry.ProjectId)?.ProjectName || 'Unassigned'; return `<tr><td>${escapeHtml(user?.FullName || 'Unknown')}</td><td>${escapeHtml(project)}</td><td>${reportDateTime(entry.ClockInAt)}</td><td>${entry.ClockOutAt ? reportDateTime(entry.ClockOutAt) : 'Active'}</td><td>${entry.DurationSeconds ? formatDuration(entry.DurationSeconds) : 'Active'}</td><td>${escapeHtml(entry.FinalNote || '—')}</td><td>${entry.ClockOutAt ? 'Completed' : 'Active'}</td></tr>`; }).join('') : '<tr><td colspan="7">No entries match this report.</td></tr>'}</tbody></table></section>`;
    if (!options.printOnly) openModal('generatedReportModal');
}

// Settings Handlers
async function handleProfileUpdate(e) {
    e.preventDefault();
    const fullName = document.getElementById('fullName')?.value.trim();
    if (!fullName || !AppState.currentUser) return;
    const submitButton = document.querySelector('#profileForm button[type="submit"]');
    try {
        setActionBusy(submitButton, true, 'Saving…');
        const photo = document.getElementById('profilePhoto')?.files?.[0];
        if (photo) {
            const upload = await window.ACEAuth.request('/v1/me/avatar-upload', { method: 'POST', body: JSON.stringify({ contentType: photo.type, contentLength: photo.size }) });
            const uploadBody = new FormData();
            uploadBody.append('file', photo); uploadBody.append('api_key', upload.apiKey); uploadBody.append('timestamp', upload.timestamp); uploadBody.append('signature', upload.signature); uploadBody.append('public_id', upload.publicId);
            const uploadResponse = await fetch(upload.uploadUrl, { method: 'POST', body: uploadBody });
            if (!uploadResponse.ok) throw new Error('Could not upload your profile photo');
            const completed = await window.ACEAuth.request('/v1/me/avatar-complete', { method: 'POST', body: JSON.stringify({ publicId: upload.publicId }) });
            AppState.currentUser = profileRecord(completed.profile);
        }
        const { profile } = await window.ACEAuth.request('/v1/me', { method: 'PATCH', body: JSON.stringify({ fullName }) });
        AppState.currentUser = profileRecord(profile);
        localStorage.setItem('ace_current_user', JSON.stringify(AppState.currentUser));
        document.querySelectorAll('#userName, .shell-user strong').forEach(node => { node.textContent = fullName; });
        showToast('Profile updated successfully', 'success');
    } catch (error) {
        showToast(error.message || 'Could not update your profile.', 'error');
    } finally {
        setActionBusy(submitButton, false);
    }
}

function handleAppearanceUpdate(e) {
    e.preventDefault();
    const theme = document.querySelector('input[name="theme"]:checked')?.value || 'light';
    const fontSize = document.getElementById('fontSize')?.value || 'medium';
    const compact = Boolean(document.getElementById('compactMode')?.checked);
    localStorage.setItem('ace_appearance_preferences', JSON.stringify({ theme, fontSize, compact }));
    document.documentElement.dataset.fontSize = fontSize;
    applyTheme(theme);
    document.body.classList.toggle('compact-mode', compact);
    showToast('Appearance settings saved', 'success');
}

// UI Updates
function updateUI() {
    updateEmployeeBottomNav();
    // Update user name
    const userNameElements = document.querySelectorAll('#userName');
    userNameElements.forEach(el => {
        if (el && AppState.currentUser) {
            el.textContent = AppState.currentUser.FullName;
        }
    });
    
    // Update clock status
    const clockStatus = document.getElementById('clockStatus');
    if (clockStatus) {
        const statusDot = clockStatus.querySelector('.status-dot');
        const statusText = clockStatus.querySelector('.status-text');
        
        if (AppState.isClockedIn) {
            statusDot?.classList.add('active');
            if (statusText) statusText.textContent = 'Working now';
        } else {
            statusDot?.classList.remove('active');
            if (statusText) statusText.textContent = 'Clocked out';
        }
    }

    const statusPanel = document.getElementById('employeeStatusPanel');
    const shiftTitle = document.getElementById('currentShiftTitle');
    const shiftDescription = document.getElementById('currentShiftDescription');
    const sessionLabel = document.getElementById('employeeSessionLabel');
    const sessionTime = document.getElementById('sessionStateTime');
    const sessionDetailTime = document.getElementById('clockedInAt');
    const sessionFacts = document.getElementById('employeeSessionFacts');
    const sessionStarted = document.getElementById('sessionStartedAt');
    const sessionProject = document.getElementById('sessionProjectName');
    if (statusPanel) statusPanel.dataset.state = AppState.isClockedIn ? 'active' : 'idle';
    if (AppState.isClockedIn && AppState.clockInTime) {
        if (shiftTitle) shiftTitle.textContent = 'Your shift is in progress.';
        if (shiftDescription) shiftDescription.textContent = 'Your live session is running. Clock out when you have finished your work.';
        if (sessionLabel) sessionLabel.textContent = 'Clocked in at';
        if (sessionTime) sessionTime.textContent = AppState.clockInTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        if (sessionDetailTime) sessionDetailTime.textContent = 'Active work session';
        if (sessionFacts) sessionFacts.hidden = false;
        if (sessionStarted) sessionStarted.textContent = AppState.clockInTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        if (sessionProject) {
            const project = AppState.projects.find(item => item.ProjectId === AppState.currentSession?.ProjectId);
            sessionProject.textContent = project?.ProjectName || 'No project';
        }
    } else {
        if (shiftTitle) shiftTitle.textContent = 'Ready when you are.';
        if (shiftDescription) shiftDescription.textContent = 'Start a work session when you are ready to begin tracking time.';
        if (sessionLabel) sessionLabel.textContent = 'Current local time';
        if (sessionTime) sessionTime.textContent = 'No active session';
        if (sessionDetailTime) sessionDetailTime.textContent = 'No active session';
        if (sessionFacts) sessionFacts.hidden = true;
    }
    
    // Update clock buttons
    const clockInBtn = document.getElementById('mainClockInBtn');
    const clockOutBtn = document.getElementById('mainClockOutBtn');
    const clockInBtnAlt = document.getElementById('clockInBtn');
    const clockOutBtnAlt = document.getElementById('clockOutBtn');
    
    if (AppState.isClockedIn) {
        if (clockInBtn) clockInBtn.style.display = 'none';
        if (clockOutBtn) clockOutBtn.style.display = 'inline-flex';
        if (clockInBtnAlt) clockInBtnAlt.style.display = 'none';
        if (clockOutBtnAlt) clockOutBtnAlt.style.display = 'inline-flex';
    } else {
        if (clockInBtn) clockInBtn.style.display = 'inline-flex';
        if (clockOutBtn) clockOutBtn.style.display = 'none';
        if (clockInBtnAlt) clockInBtnAlt.style.display = 'inline-flex';
        if (clockOutBtnAlt) clockOutBtnAlt.style.display = 'none';
    }
    
    // Update current session card
    const currentSessionCard = document.getElementById('currentSessionCard');
    if (currentSessionCard) {
        if (AppState.isClockedIn) {
            currentSessionCard.style.display = 'block';
            const sessionClockInTime = document.getElementById('sessionClockInTime');
            const sessionProject = document.getElementById('sessionProject');
            
            if (sessionClockInTime && AppState.clockInTime) {
                sessionClockInTime.textContent = AppState.clockInTime.toLocaleTimeString();
            }
            if (sessionProject && AppState.currentSession?.ProjectId) {
                const project = AppState.projects.find(p => p.ProjectId === AppState.currentSession.ProjectId);
                sessionProject.textContent = project ? project.ProjectName : 'None';
            }
        } else {
            currentSessionCard.style.display = 'none';
        }
    }
    
}

// Clock
function startClock() {
    updateClock();
    setInterval(updateClock, 1000);
}

function updateClock() {
    const now = new Date();
    const timeString = now.toLocaleTimeString();
    const schedule = AppState.assignedSchedule;
    if (schedule?.schedule_type === 'FIXED' && isScheduledToday(schedule, now) && !AppState.isClockedIn && schedule.start_time) {
        const [hours, minutes] = String(schedule.start_time).slice(0, 5).split(':').map(Number); const start = new Date(); start.setHours(hours, minutes, 0, 0);
        const key = `late-${now.toDateString()}`;
        if (now > start && !AppState.scheduleAlertKeys.has(key)) { AppState.scheduleAlertKeys.add(key); showToast(`You are late for ${schedule.name}. Your scheduled start was ${start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`, 'warning'); }
    }
    
    const clockTimeElements = document.querySelectorAll('#clockTime');
    clockTimeElements.forEach(el => {
        if (el) el.textContent = timeString;
    });

    const homePreviewTime = document.getElementById('homePreviewTime');
    if (homePreviewTime) {
        homePreviewTime.textContent = now.toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
    }
    const workDurationLabel = document.getElementById('workDurationLabel');
    if (workDurationLabel) workDurationLabel.textContent = 'Worked';
    
    // Update date
    const currentDateElement = document.getElementById('currentDate');
    if (currentDateElement) {
        currentDateElement.textContent = now.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    const homePreviewDate = document.getElementById('homePreviewDate');
    if (homePreviewDate) {
        homePreviewDate.textContent = now.toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric'
        });
    }
}

// Page Specific Data
function loadPageSpecificData() {
    const routeName = (window.location.pathname.split('/').pop() || '').toLowerCase();
    const page = routeName && !routeName.includes('.') ? `${routeName}.html` : routeName;
    // User Dashboard
    if (page === 'user-dashboard.html') {
        loadUserDashboard();
    }
    
    // Admin Dashboard
    if (page === 'admin-dashboard.html') {
        loadAdminDashboard();
        loadTimeLeaderboard('adminLeaderboard', 'adminLeaderboardRank');
    }

    if (page === 'time-entry-details.html') {
        loadAdminTimeEntryDetails();
    }
    
    // Time Entries
    if (page === 'time-entries.html') {
        loadTimeEntries();
    }

    if (page === 'remarks.html') {
        loadRemarksPage();
        void markRemarksRead();
    }
    
    // Reports
    if (page === 'reports.html') {
        loadReportsList();
    }
    
    // Settings
    if (page === 'settings.html') {
        loadUserSettings();
    }
    runPendingWorkspaceQuickAction(page);
}

function runPendingWorkspaceQuickAction(page) {
    const action = sessionStorage.getItem('ace_workspace_quick_action');
    if (!action) return;
    if (action === 'generate-report' && page === 'admin-dashboard.html') {
        sessionStorage.removeItem('ace_workspace_quick_action');
        requestAnimationFrame(() => document.getElementById('generateReportBtn')?.click());
    }
    if ((action === 'clock-in' || action === 'clock-out') && page === 'user-dashboard.html') {
        sessionStorage.removeItem('ace_workspace_quick_action');
        requestAnimationFrame(() => {
            if (action === 'clock-in' && !AppState.isClockedIn) openClockInModal();
            else if (action === 'clock-out' && AppState.isClockedIn) openClockOutModal();
            else showToast(action === 'clock-in' ? 'You are already clocked in.' : 'You are not currently clocked in.', 'info');
        });
    }
}

function loadAdminTimeEntryDetails() {
    const root = document.getElementById('timeEntryDetailsContent');
    if (!root) return;
    const entryId = new URLSearchParams(window.location.search).get('entry');
    const entry = AppState.timeEntries.find(item => String(item.TimeEntryId) === String(entryId));
    if (!entry) {
        root.innerHTML = `<section class="time-entry-detail-empty"><h1>Time entry not found</h1><p>This entry may have been removed or you may not have access to it.</p><a class="btn btn-primary" href="admin-dashboard.html">Back to dashboard</a></section>`;
        return;
    }
    const user = AppState.users.find(item => String(item.UserId) === String(entry.UserId));
    const project = AppState.projects.find(item => String(item.ProjectId) === String(entry.ProjectId));
    const remarks = AppState.adminRemarks.filter(item => String(item.TimeEntryId) === String(entry.TimeEntryId));
    const worked = entry.DurationSeconds ? formatDuration(entry.DurationSeconds) : entry.ClockOutAt ? '—' : 'Active';
    const dateTime = value => value ? new Date(value).toLocaleString() : '—';
    root.innerHTML = `<header class="time-entry-detail-header"><div><a class="time-entry-detail-back" href="admin-dashboard.html">← Back to dashboard</a><p class="admin-section-kicker">TIME ENTRY</p><h1>${escapeHtml(user?.FullName || entry.UserName || 'Employee')}’s work session</h1><p>${dateTime(entry.ClockInAt)}</p></div><span class="badge ${entry.ClockOutAt ? 'badge-success' : 'badge-warning'}">${entry.ClockOutAt ? 'Completed' : 'Active'}</span></header>
        <section class="time-entry-detail-grid" aria-label="Time entry summary"><article><span>Clock in</span><strong>${dateTime(entry.ClockInAt)}</strong></article><article><span>Clock out</span><strong>${dateTime(entry.ClockOutAt)}</strong></article><article><span>Worked time</span><strong>${worked}</strong></article><article><span>Project</span><strong>${escapeHtml(project?.ProjectName || entry.ProjectName || 'Unassigned')}</strong></article><article><span>Entry status</span><strong>${entry.ClockOutAt ? 'Completed' : 'Currently active'}</strong></article></section>
        <section class="time-entry-detail-notes"><article><h2>Clock-out note</h2><p>${escapeHtml(entry.FinalNote || 'No clock-out note was added.')}</p></article>${entry.UserNote ? `<article><h2>Legacy clock-in note</h2><p>${escapeHtml(entry.UserNote)}</p></article>` : ''}</section>
        ${entry.StoppedByName ? `<section class="time-entry-stopped"><h2>Stopped by an administrator</h2><p>${escapeHtml(entry.StoppedByName)} stopped this session on ${dateTime(entry.StoppedByAt || entry.ClockOutAt)}.</p></section>` : ''}
        <section class="time-entry-detail-remarks"><div><p class="admin-section-kicker">ADMINISTRATOR NOTES</p><h2>Remarks</h2></div>${remarks.length ? `<div class="time-entry-remark-list">${remarks.map(remark => `<article><strong>${escapeHtml(remark.AdminName)}</strong><p>${escapeHtml(remark.Remark)}</p><small>${dateTime(remark.CreatedAt)}</small></article>`).join('')}</div>` : '<p class="time-entry-no-remarks">No administrator remarks were added to this entry.</p>'}</section>`;
}

function loadUserDashboard() {
    const schedule = AppState.assignedSchedule;
    const existingNotice = document.getElementById('employeeScheduleNotice');
    if (schedule && !existingNotice) {
        const notice = document.createElement('section'); notice.id = 'employeeScheduleNotice'; notice.className = 'employee-schedule-notice';
        const now = new Date(); const active = AppState.currentSession;
        let message = ''; let isLate = false;
        if (!isScheduledToday(schedule, now)) {
            message = `${schedule.name}: no work is scheduled today.`;
        } else if (schedule.schedule_type === 'FLEX' && active) {
            const finish = new Date(new Date(active.ClockInAt).getTime() + Number(schedule.daily_elapsed_minutes || 540) * 60000);
            message = `Flextime: expected finish ${finish.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`;
        } else if (schedule.schedule_type === 'FIXED') {
            const [hours, minutes] = String(schedule.start_time).slice(0, 5).split(':').map(Number); const start = new Date(); start.setHours(hours, minutes, 0, 0);
            isLate = !active && now > start;
            message = isLate ? `You are late for ${schedule.name}. Scheduled start: ${start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : `${schedule.name}: ${String(schedule.start_time).slice(0, 5)}–${String(schedule.end_time).slice(0, 5)}.`;
        } else if (schedule.schedule_type === 'FLEX') message = `${schedule.name}: clock in for ${Math.floor(Number(schedule.daily_elapsed_minutes || 540) / 60)} hours total.`;
        notice.classList.toggle('is-late', isLate);
        notice.textContent = message; document.querySelector('.user-dashboard .employee-dashboard-intro')?.insertAdjacentElement('afterend', notice);
    }
    const userEntriesForStats = AppState.timeEntries.filter(te => te.UserId === AppState.currentUser?.UserId && te.DurationSeconds);
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const secondsFor = predicate => userEntriesForStats.filter(predicate).reduce((total, entry) => total + Number(entry.DurationSeconds || 0), 0);
    const todaySeconds = secondsFor(entry => new Date(entry.ClockInAt).toDateString() === now.toDateString());
    const weekSeconds = secondsFor(entry => new Date(entry.ClockInAt) >= startOfWeek);
    const monthSeconds = secondsFor(entry => {
        const date = new Date(entry.ClockInAt);
        return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    });
    const dashboardStats = {
        todayHours: formatDuration(todaySeconds),
        weekHours: formatDuration(weekSeconds),
        monthHours: formatDuration(monthSeconds)
    };
    Object.entries(dashboardStats).forEach(([id, value]) => {
        const node = document.getElementById(id);
        if (node) node.textContent = value;
    });

    // Populate user projects
    const myProjects = document.getElementById('myProjects');
    if (myProjects) {
        const userProjects = AppState.userProjects.filter(up => up.UserId === AppState.currentUser?.UserId);
        const projects = userProjects.map(up => AppState.projects.find(p => p.ProjectId === up.ProjectId)).filter(Boolean);
        
        myProjects.innerHTML = projects.length ? projects.map(project => `
            <button class="project-card project-card-action" type="button" data-project-id="${project.ProjectId}" aria-label="View ${escapeHtml(project.ProjectName)} details">
                <h3>${escapeHtml(project.ProjectName)}</h3>
                <p>${escapeHtml(project.Description || 'No description')}</p>
            </button>
        `).join('') : emptyState('No projects assigned', 'Project assignment is optional. Your administrator can add you to a project when needed.');
        myProjects.querySelectorAll('.project-card-action').forEach(card => {
            card.addEventListener('click', () => viewProject(card.dataset.projectId));
        });
    }
    
    // Populate recent activity
    const recentActivity = document.getElementById('recentActivity');
    if (recentActivity) {
        const userEntries = AppState.timeEntries.filter(te => te.UserId === AppState.currentUser?.UserId).slice(0, 5);
        
        recentActivity.innerHTML = userEntries.length ? `<ol class="employee-activity-list">${userEntries.map(entry => {
            const clockIn = new Date(entry.ClockInAt);
            const clockOut = entry.ClockOutAt ? new Date(entry.ClockOutAt) : null;
            const duration = entry.DurationSeconds ? formatDuration(entry.DurationSeconds) : 'Active';
            
            return `
                <li class="activity-item">
                    <div class="activity-date">
                        <strong>${clockIn.toLocaleDateString()}</strong>
                    </div>
                    <div class="activity-time">
                        ${clockIn.toLocaleTimeString()} - ${clockOut ? clockOut.toLocaleTimeString() : 'Now'}
                    </div>
                    <div class="activity-duration">
                        ${duration}
                        ${entry.StoppedByName ? `<small>Stopped by ${escapeHtml(entry.StoppedByName)}</small>` : ''}
                    </div>
                </li>
            `;
        }).join('')}</ol>` : emptyState('No sessions yet', 'Clock in when you are ready to begin your first tracked work session.', 'Clock in', '#');
    }

    const dashboardRemarks = document.getElementById('dashboardRemarks');
    if (dashboardRemarks) {
        const entryById = new Map(AppState.timeEntries.map(entry => [entry.TimeEntryId, entry]));
        const remarks = AppState.adminRemarks.slice(0, 5);
        dashboardRemarks.innerHTML = remarks.length ? remarks.map(remark => {
            const entry = entryById.get(remark.TimeEntryId);
            const session = entry ? new Date(entry.ClockInAt).toLocaleDateString() : 'Time entry';
            return `<article class="remark-item"><strong>${escapeHtml(remark.AdminName)}</strong><p>${escapeHtml(remark.Remark)}</p><small>${escapeHtml(session)} · ${new Date(remark.CreatedAt).toLocaleString()}</small></article>`;
        }).join('') : emptyState('No administrator notes yet', 'Notes from your administrator will appear here.');
    }
}

async function loadTimeLeaderboard(listId, rankId) {
    const list = document.getElementById(listId);
    const rank = document.getElementById(rankId);
    if (!list || !window.ACEAuth) return;
    try {
        const data = await window.ACEAuth.request('/v1/time-leaderboard');
        if (rank) rank.textContent = AppState.currentUser?.Role === 'ADMIN' ? 'Top ten by completed worked time.' : `Your team rank: #${data.my_rank} of ${data.total_people}`;
        list.innerHTML = data.leaders.length ? data.leaders.map((person, index) => {
            const initials = (person.full_name || '?').split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase();
            const isMe = person.id === AppState.currentUser?.UserId;
            const name = `<strong>${escapeHtml(person.full_name || 'Team member')}${isMe ? ' <small>You</small>' : ''}</strong>`;
            const profileName = listId === 'adminLeaderboard' && person.role === 'USER' ? `<a class="time-leaderboard-profile-link" href="employee-profile.html?user=${encodeURIComponent(person.id)}" aria-label="View ${escapeHtml(person.full_name || 'employee')} profile">${name}</a>` : name;
            return `<li class="time-leaderboard-row${isMe ? ' is-current-user' : ''}"><b class="time-leaderboard-rank">${index + 1}</b><span class="time-leaderboard-avatar">${person.profile_picture_url ? `<img src="${escapeHtml(person.profile_picture_url)}" alt="">` : escapeHtml(initials)}</span>${profileName}<span>${formatDuration(person.tracked_seconds)}</span></li>`;
        }).join('') : '<li class="time-leaderboard-empty">No completed work sessions yet.</li>';
    } catch {
        if (rank) rank.textContent = 'Leaderboard is unavailable right now.';
        list.innerHTML = '<li class="time-leaderboard-empty">Unable to load rankings.</li>';
    }
}

function analyticsDateValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function analyticsDateFromValue(value) {
    return value ? new Date(`${value}T00:00:00`) : null;
}

function renderAnalyticsRangeCalendars() {
    const mount = document.getElementById('analyticsCalendars');
    const from = document.getElementById('analyticsDateFrom');
    const to = document.getElementById('analyticsDateTo');
    const summary = document.getElementById('analyticsDateRangeSummary');
    if (!mount || !from || !to) return;
    const start = analyticsDateFromValue(from.value);
    const end = analyticsDateFromValue(to.value);
    const current = new Date();
    const startMonth = new Date(Number(mount.dataset.startYear || current.getFullYear()), Number(mount.dataset.startMonth || current.getMonth()), 1);
    const endMonth = new Date(Number(mount.dataset.endYear || startMonth.getFullYear()), Number(mount.dataset.endMonth || startMonth.getMonth() + 1), 1);
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const calendar = (month, endpoint) => {
        const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
        const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);
        const cells = Array.from({ length: monthStart.getDay() + monthEnd.getDate() }, (_, index) => {
            if (index < monthStart.getDay()) return '<span class="analytics-calendar-blank" aria-hidden="true"></span>';
            const date = new Date(month.getFullYear(), month.getMonth(), index - monthStart.getDay() + 1);
            const value = analyticsDateValue(date);
            const selectedStart = start && value === from.value;
            const selectedEnd = end && value === to.value;
            const inRange = start && end && date > start && date < end;
            const classes = ['analytics-calendar-day'];
            if (selectedStart || selectedEnd) classes.push('is-selected');
            if (inRange) classes.push('is-in-range');
            return `<button class="${classes.join(' ')}" type="button" data-date="${value}" aria-pressed="${selectedStart || selectedEnd}">${date.getDate()}</button>`;
        }).join('');
        const title = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        return `<section class="analytics-calendar-month" aria-label="${title}"><div class="analytics-calendar-month-header"><button class="analytics-calendar-nav" type="button" data-calendar-endpoint="${endpoint}" data-calendar-step="-1" aria-label="Previous month for ${endpoint === 'start' ? 'start' : 'end'} date">‹</button><h3>${title}</h3><button class="analytics-calendar-nav" type="button" data-calendar-endpoint="${endpoint}" data-calendar-step="1" aria-label="Next month for ${endpoint === 'start' ? 'start' : 'end'} date">›</button></div><div class="analytics-calendar-weekdays">${weekdays.map(day => `<span>${day}</span>`).join('')}</div><div class="analytics-calendar-days">${cells}</div></section>`;
    };
    mount.innerHTML = calendar(startMonth, 'start') + calendar(endMonth, 'end');
    mount.querySelectorAll('[data-calendar-endpoint]').forEach(button => button.addEventListener('click', () => {
        const endpoint = button.dataset.calendarEndpoint;
        const shown = endpoint === 'start' ? startMonth : endMonth;
        const next = new Date(shown.getFullYear(), shown.getMonth() + Number(button.dataset.calendarStep), 1);
        mount.dataset[`${endpoint}Year`] = String(next.getFullYear());
        mount.dataset[`${endpoint}Month`] = String(next.getMonth());
        renderAnalyticsRangeCalendars();
    }));
    mount.querySelectorAll('.analytics-calendar-day').forEach(button => button.addEventListener('click', () => {
        const picked = button.dataset.date;
        if (!from.value || (from.value && to.value) || picked < from.value) {
            from.value = picked;
            to.value = '';
        } else {
            to.value = picked;
        }
        if (summary) summary.textContent = from.value && to.value ? `${from.value} — ${to.value}` : `Start: ${from.value}; choose an end date`;
        renderAnalyticsRangeCalendars();
        if (from.value && to.value) renderAdminAnalytics(Number(document.getElementById('dashboardRange')?.value || 7));
    }));
    if (summary) summary.textContent = from.value && to.value ? `${from.value} — ${to.value}` : from.value ? `Start: ${from.value}; choose an end date` : 'Choose a start and end date';
}

function initializeAnalyticsRangePicker() {
    const mount = document.getElementById('analyticsCalendars');
    if (!mount || mount.dataset.bound) return;
    mount.dataset.bound = 'true';
    const current = new Date();
    mount.dataset.startYear = String(current.getFullYear());
    mount.dataset.startMonth = String(current.getMonth());
    const followingMonth = new Date(current.getFullYear(), current.getMonth() + 1, 1);
    mount.dataset.endYear = String(followingMonth.getFullYear());
    mount.dataset.endMonth = String(followingMonth.getMonth());
    renderAnalyticsRangeCalendars();
}

function getAdminAnalyticsFilters(fallbackDays = 7) {
    const range = document.getElementById('dashboardRange');
    const dateFromInput = document.getElementById('analyticsDateFrom');
    const dateToInput = document.getElementById('analyticsDateTo');
    const selectedRange = range?.value || String(fallbackDays);
    // "This week" and "This month" always mean the current calendar period.
    // Do not anchor them to the newest historical record: doing so can make
    // a quiet current month appear to contain entries from a previous month.
    const periodEnd = new Date();
    periodEnd.setHours(23, 59, 59, 999);
    const periodStart = new Date(periodEnd);
    let days = Number(selectedRange) || fallbackDays;

    if (selectedRange === 'week') {
        const weekday = periodEnd.getDay() || 7;
        periodStart.setDate(periodEnd.getDate() - weekday + 1);
        periodStart.setHours(0, 0, 0, 0);
        days = Math.max(1, Math.round((periodEnd - periodStart) / 86400000) + 1);
    } else if (selectedRange === 'month') {
        periodStart.setDate(1);
        periodStart.setHours(0, 0, 0, 0);
        days = Math.max(1, Math.round((periodEnd - periodStart) / 86400000) + 1);
    } else if (selectedRange === 'custom' && dateFromInput?.value && dateToInput?.value) {
        const customStart = new Date(`${dateFromInput.value}T00:00:00`);
        const customEnd = new Date(`${dateToInput.value}T23:59:59.999`);
        if (customEnd >= customStart) {
            periodStart.setTime(customStart.getTime());
            periodEnd.setTime(customEnd.getTime());
            days = Math.max(1, Math.round((periodEnd - periodStart) / 86400000) + 1);
        }
    } else {
        periodStart.setDate(periodEnd.getDate() - days + 1);
        periodStart.setHours(0, 0, 0, 0);
    }
    return { periodStart, periodEnd, days };
}

function toAnalyticsDateValue(date) {
    const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return offsetDate.toISOString().slice(0, 10);
}

function getAnalyticsEmployeeId() {
    const value = document.getElementById('analyticsEmployee')?.value.trim() || '';
    if (!value) return 0;
    const byId = AppState.users.find(user => String(user.UserId) === value);
    const byName = AppState.users.find(user => user.FullName.toLowerCase() === value.toLowerCase());
    return byId?.UserId || byName?.UserId || '';
}

function getAnalyticsProjectId() {
    const value = document.getElementById('analyticsProject')?.value.trim() || '';
    if (!value) return '';
    const project = AppState.projects.find(item => String(item.ProjectId) === value || item.ProjectName.toLowerCase() === value.toLowerCase());
    return project?.ProjectId || '';
}

function getAnalyticsDepartmentId() {
    const value = document.getElementById('analyticsDepartment')?.value.trim() || '';
    if (!value) return '';
    const department = AppState.departments.find(item => String(item.DepartmentId) === value || item.DepartmentName.toLowerCase() === value.toLowerCase());
    return department?.DepartmentId || '';
}

function ensureAnalyticsExportModal() {
    let modal = document.getElementById('analyticsExportModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'analyticsExportModal';
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'analyticsExportModalTitle');
    modal.innerHTML = `<div class="modal-content"><div class="modal-header"><h3 class="modal-title" id="analyticsExportModalTitle">Save report as</h3><button class="modal-close" type="button" aria-label="Close">${suppliedIconMarkup('x')}</button></div><div class="modal-body"><p class="modal-description">Choose the format for the report using the filters currently shown on your dashboard.</p><div class="form-actions"><button class="btn btn-outline analytics-export-choice" type="button" data-format="XLSX">${suppliedIconMarkup('download')}Excel workbook</button><button class="btn btn-primary analytics-export-choice" type="button" data-format="PDF">${suppliedIconMarkup('printer')}PDF</button></div></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector('.modal-close').addEventListener('click', () => closeModal('analyticsExportModal'));
    modal.addEventListener('click', event => { if (event.target === modal) closeModal('analyticsExportModal'); });
    modal.querySelectorAll('.analytics-export-choice').forEach(button => button.addEventListener('click', () => {
        closeModal('analyticsExportModal');
        generateAdminAnalyticsReport(button.dataset.format);
    }));
    return modal;
}
function openAnalyticsExportModal() {
    openModal(ensureAnalyticsExportModal().id);
}
async function generateAdminAnalyticsReport(exportFormat = 'PDF') {
    const range = document.getElementById('dashboardRange');
    const from = document.getElementById('analyticsDateFrom')?.value;
    const to = document.getElementById('analyticsDateTo')?.value;
    if (range?.value === 'custom' && (!from || !to || to < from)) {
        showToast('Choose a valid start and end date before generating the report.', 'warning');
        return;
    }
    const filters = getAdminAnalyticsFilters();
    try {
        const saved = await window.ACEAuth.request('/v1/reports', { method: 'POST', body: JSON.stringify({ reportType: 'TEAM_PERFORMANCE', dateFrom: toAnalyticsDateValue(filters.periodStart), dateTo: toAnalyticsDateValue(filters.periodEnd), filters: { departmentId: getAnalyticsDepartmentId() || null, projectId: getAnalyticsProjectId() || null, userId: getAnalyticsEmployeeId() || null } }) });
        const report = reportRecord(saved);
        AppState.reports.unshift(report);
        if (exportFormat === 'XLSX') {
            exportExcelReport(report.ReportId);
            return;
        }
        renderGeneratedReport(report, { printOnly: true });
        showToast('Your A4 report is ready. Choose “Save as PDF” in the print dialog.', 'success');
        window.setTimeout(printGeneratedReport, 250);
    } catch (error) { showToast(error.message || 'Unable to generate report', 'error'); }
}

function renderAdminAnalytics(days = 7) {
    const hoursChart = document.getElementById('hoursChart');
    const projectChart = document.getElementById('projectAllocationChart');
    if (!hoursChart || !projectChart) return;
    initializeAnalyticsRangePicker();

    const projectFilter = document.getElementById('analyticsProject');
    const departmentFilter = document.getElementById('analyticsDepartment');
    const employeeFilter = document.getElementById('analyticsEmployee');
    if (projectFilter && !projectFilter.dataset.bound) {
        const projectOptions = document.getElementById('analyticsProjectOptions');
        AppState.projects.filter(project => project.IsActive).forEach(project => {
            const option = document.createElement('option');
            option.value = project.ProjectName;
            projectOptions?.appendChild(option);
        });
        projectFilter.dataset.bound = 'true';
        projectFilter.addEventListener('input', () => renderAdminAnalytics(days));
    }
    if (departmentFilter && !departmentFilter.dataset.bound) {
        const departmentOptions = document.getElementById('analyticsDepartmentOptions');
        AppState.departments.forEach(department => {
            const option = document.createElement('option');
            option.value = department.DepartmentName;
            departmentOptions?.appendChild(option);
        });
        departmentFilter.dataset.bound = 'true';
        departmentFilter.addEventListener('input', () => renderAdminAnalytics(days));
    }
    if (employeeFilter && !employeeFilter.dataset.bound) {
        const employeeOptions = document.getElementById('analyticsEmployeeOptions');
        AppState.users.filter(user => user.Role === 'USER').forEach(user => {
            const option = document.createElement('option');
            option.value = user.FullName;
            employeeOptions?.appendChild(option);
        });
        employeeFilter.dataset.bound = 'true';
        employeeFilter.addEventListener('input', () => renderAdminAnalytics(days));
    }
    const selectedProjectId = getAnalyticsProjectId();
    const selectedDepartmentId = getAnalyticsDepartmentId();
    const selectedEmployeeId = getAnalyticsEmployeeId();
    const completed = employeeTimeEntries().filter(entry => Number(entry.DurationSeconds) > 0);
    const { periodStart, periodEnd, days: selectedDays } = getAdminAnalyticsFilters(days);
    const inPeriod = completed.filter(entry => {
        const time = new Date(entry.ClockInAt).getTime();
        const user = AppState.users.find(item => String(item.UserId) === String(entry.UserId));
        return time >= periodStart.getTime() && time <= periodEnd.getTime() &&
            (!selectedProjectId || String(entry.ProjectId) === String(selectedProjectId)) &&
            (!selectedDepartmentId || String(user?.DepartmentId) === String(selectedDepartmentId)) &&
            (!selectedEmployeeId || String(entry.UserId) === String(selectedEmployeeId));
    });

    const bucketCount = selectedDays <= 14 ? selectedDays : 10;
    const bucketDays = Math.ceil(selectedDays / bucketCount);
    const buckets = Array.from({ length: bucketCount }, (_, index) => {
        const start = new Date(periodStart);
        start.setDate(periodStart.getDate() + index * bucketDays);
        const end = new Date(start);
        end.setDate(start.getDate() + bucketDays);
        const seconds = inPeriod.filter(entry => {
            const time = new Date(entry.ClockInAt).getTime();
            return time >= start.getTime() && time < end.getTime();
        }).reduce((sum, entry) => sum + Number(entry.DurationSeconds || 0), 0);
        return { start, seconds };
    }).filter(bucket => bucket.start <= periodEnd);
    const maxSeconds = Math.max(...buckets.map(bucket => bucket.seconds), 1);
    const totalSeconds = inPeriod.reduce((sum, entry) => sum + Number(entry.DurationSeconds || 0), 0);
    document.getElementById('analyticsTotalHours').textContent = formatDuration(totalSeconds);
    document.getElementById('analyticsAverage').textContent = `${formatDuration(Math.round(totalSeconds / Math.max(selectedDays, 1)))} average/day`;
    const selectedProject = AppState.projects.find(project => String(project.ProjectId) === String(selectedProjectId));
    const selectedDepartment = AppState.departments.find(department => String(department.DepartmentId) === String(selectedDepartmentId));
    const selectedEmployee = AppState.users.find(user => String(user.UserId) === String(selectedEmployeeId));
    const analyticsDetail = document.getElementById('analyticsDetail');
    if (analyticsDetail) analyticsDetail.textContent = [selectedProject?.ProjectName, selectedDepartment?.DepartmentName, selectedEmployee?.FullName].filter(Boolean).join(' · ') || 'Across all projects, departments, and employees';
    hoursChart.setAttribute('aria-label', `Tracked hours from ${toAnalyticsDateValue(periodStart)} to ${toAnalyticsDateValue(periodEnd)}: ${formatDuration(totalSeconds)}`);
    hoursChart.innerHTML = inPeriod.length ? buckets.map(bucket => {
        const height = bucket.seconds ? Math.max(5, Math.round(bucket.seconds / maxSeconds * 100)) : 2;
        const label = selectedDays <= 7
            ? bucket.start.toLocaleDateString('en-US', { weekday: 'short' })
            : bucket.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const bucketEnd = new Date(Math.min(new Date(bucket.start).setDate(bucket.start.getDate() + bucketDays - 1), periodEnd.getTime()));
        const periodLabel = bucket.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) === bucketEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            ? bucket.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : `${bucket.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${bucketEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        const detail = `${periodLabel}: ${formatDuration(bucket.seconds)} tracked`;
        return `<div class="chart-column analytics-tooltip" tabindex="0" role="listitem" aria-label="${detail}" data-tooltip="${detail}"><div class="chart-column-track"><div class="chart-column-bar" style="height:${height}%"></div></div><span class="chart-column-label">${label}</span><span class="chart-column-value">${formatDuration(bucket.seconds)}</span></div>`;
    }).join('') : '<div class="analytics-empty">No tracked hours match these filters yet.</div>';

    const projectTotals = new Map();
    inPeriod.forEach(entry => {
        const project = entry.ProjectId ? AppState.projects.find(item => item.ProjectId === entry.ProjectId) : null;
        const name = project?.ProjectName || 'Unassigned';
        projectTotals.set(name, (projectTotals.get(name) || 0) + Number(entry.DurationSeconds || 0));
    });
    const projects = [...projectTotals.entries()].sort((a, b) => b[1] - a[1]);
    const largestProject = Math.max(...projects.map(([, seconds]) => seconds), 1);
    projectChart.innerHTML = projects.length ? projects.map(([name, seconds]) => {
        const share = totalSeconds ? Math.round(seconds / totalSeconds * 100) : 0;
        const detail = `${name}: ${formatDuration(seconds)} tracked (${share}% of selected time)`;
        return `<div class="allocation-row analytics-tooltip" tabindex="0" role="listitem" aria-label="${escapeHtml(detail)}" data-tooltip="${escapeHtml(detail)}"><span class="allocation-name">${escapeHtml(name)}</span><div class="allocation-track" aria-hidden="true"><div class="allocation-fill" style="width:${Math.max(4, Math.round(seconds / largestProject * 100))}%"></div></div><span class="allocation-hours">${formatDuration(seconds)}</span></div>`;
    }).join('') : '<div class="analytics-empty">No tracked project hours in this period.</div>';

    const range = document.getElementById('dashboardRange');
    if (range && !range.dataset.bound) {
        range.dataset.bound = 'true';
        range.addEventListener('change', () => {
            const custom = range.value === 'custom';
            document.getElementById('analyticsDateRange')?.classList.toggle('is-visible', custom);
            if (custom) renderAnalyticsRangeCalendars();
            renderAdminAnalytics(days);
        });
    }
    const dateFrom = document.getElementById('analyticsDateFrom');
    const dateTo = document.getElementById('analyticsDateTo');
    [dateFrom, dateTo].forEach(input => {
        if (input && !input.dataset.bound) {
            input.dataset.bound = 'true';
            input.addEventListener('change', () => {
                if (dateFrom.value && dateTo.value && dateTo.value >= dateFrom.value) {
                    range.value = 'custom';
                    document.getElementById('analyticsDateRange')?.classList.add('is-visible');
                    renderAdminAnalytics(days);
                }
            });
        }
    });
}

async function loadReviewAlerts() {
    const section = document.getElementById('reviewAlertsSection'); const list = document.getElementById('reviewAlertsList');
    if (!section || !list || AppState.currentUser?.Role !== 'ADMIN') return;
    try {
        const response = await window.ACEAuth.request('/v1/time-entry-review'); const alerts = response.items || [];
        section.hidden = !alerts.length;
        list.innerHTML = alerts.map(alert => {
            const isMissedClockOut = alert.type === 'MISSED_CLOCK_OUT';
            const iconName = isMissedClockOut ? 'circle-alert' : 'user-pen';
            return `<article class="review-alert-card review-alert-card--${isMissedClockOut ? 'warning' : 'info'}">
                <span class="review-alert-icon">${suppliedIconMarkup(iconName)}</span>
                <div class="review-alert-copy"><p class="review-alert-type">Needs attention</p><h3>${escapeHtml(alert.label)}</h3><p>${escapeHtml(alert.detail)}</p><time datetime="${escapeHtml(alert.occurredAt)}">${new Date(alert.occurredAt).toLocaleString()}</time></div>
                <a class="btn btn-sm btn-outline review-alert-action" href="time-entry-details.html?entry=${encodeURIComponent(alert.id)}">Review entry</a>
            </article>`;
        }).join('');
    } catch (error) { section.hidden = true; console.warn('Could not load time-entry review alerts.', error); }
}

function loadAdminDashboard() {
    // Update stats
    const clockedInUsers = document.getElementById('clockedInUsers');
    if (clockedInUsers) clockedInUsers.textContent = employeeTimeEntries().filter(entry => !entry.ClockOutAt).length;
    
    updateOnlineUserCount();
    startOnlineUserCountRefresh();
    void loadReviewAlerts();
    
    const todayEntries = document.getElementById('todayEntries');
    if (todayEntries) {
        const today = new Date().toDateString();
        todayEntries.textContent = employeeTimeEntries().filter(te => new Date(te.ClockInAt).toDateString() === today).length;
    }
    
    renderAdminAnalytics(Number(document.getElementById('dashboardRange')?.value || 7));
    
    // Populate recent time entries
    const recentTimeEntries = document.getElementById('recentTimeEntries');
    if (recentTimeEntries) {
        const entries = AppState.timeEntries;
        const controls = document.getElementById('recentEntriesControls');
        const pageSize = document.getElementById('recentEntriesPageSize');
        const pagination = document.getElementById('recentEntriesPagination');
        const renderRecentEntries = () => {
            const size = AppState.recentEntriesPageSize;
            const totalPages = Math.max(1, Math.ceil(entries.length / size));
            AppState.recentEntriesPage = Math.min(Math.max(1, AppState.recentEntriesPage), totalPages);
            const start = (AppState.recentEntriesPage - 1) * size;
            const pageEntries = entries.slice(start, start + size);
            recentTimeEntries.innerHTML = pageEntries.length ? pageEntries.map(entry => {
            const user = AppState.users.find(u => u.UserId === entry.UserId);
            const project = entry.ProjectId ? AppState.projects.find(p => p.ProjectId === entry.ProjectId) : null;
            const clockIn = new Date(entry.ClockInAt);
            const clockOut = entry.ClockOutAt ? new Date(entry.ClockOutAt) : null;
            const duration = entry.DurationSeconds ? formatDuration(entry.DurationSeconds) : 'Active';
            const remarks = AppState.adminRemarks.filter(remark => remark.TimeEntryId === entry.TimeEntryId);
            const userName = escapeHtml(user?.FullName || 'Unknown');
            const userLabel = user?.Role === 'USER' ? `<a class="admin-employee-profile-link" href="employee-profile.html?user=${encodeURIComponent(entry.UserId)}">${userName}</a>` : `<strong>${userName}</strong>`;
            
            return `
                <tr class="admin-recent-entry-row">
                    <td><span class="admin-entry-user"><span class="admin-entry-avatar">${user?.ProfilePictureUrl ? `<img src="${escapeHtml(user.ProfilePictureUrl)}" alt="">` : escapeHtml((user?.FullName || 'Unknown').trim().slice(0, 1).toUpperCase())}</span>${userLabel}</span></td>
                    <td>${escapeHtml(project?.ProjectName || 'None')}</td>
                    <td>${clockIn.toLocaleTimeString()}</td>
                    <td>${clockOut ? clockOut.toLocaleTimeString() : 'Active'}</td>
                    <td>${duration}</td>
                    <td>${escapeHtml(entry.FinalNote || '—')}</td>
                    <td><span class="badge ${clockOut ? 'badge-success' : 'badge-warning'}">${clockOut ? 'Completed' : 'Active'}</span>${entry.StoppedByName ? `<small class="entry-admin-stop">Stopped by ${escapeHtml(entry.StoppedByName)} · ${new Date(entry.StoppedByAt || entry.ClockOutAt).toLocaleString()}</small>` : ''}</td>
                    <td>${remarks.length ? `${remarks.length} remark${remarks.length === 1 ? '' : 's'}` : '—'}</td>
                    <td>
                        <a class="btn btn-sm btn-outline admin-recent-entry-view" href="time-entry-details.html?entry=${encodeURIComponent(entry.TimeEntryId)}">View</a>
                        <button class="btn btn-sm btn-outline admin-recent-entry-toggle" type="button" aria-expanded="false">Details</button>
                    </td>
                </tr>
            `;
        }).join('') : `<tr class="table-empty-row"><td colspan="10">${emptyState('No time entries yet', 'Completed and active sessions will appear here.')}</td></tr>`;
            if (controls) controls.hidden = entries.length <= 3;
            if (pageSize) pageSize.value = String(size);
            if (pagination) {
                const firstVisiblePage = Math.max(1, Math.min(AppState.recentEntriesPage - 1, totalPages - 2));
                const pages = Array.from({ length: Math.min(3, totalPages) }, (_, index) => firstVisiblePage + index);
                pagination.innerHTML = totalPages > 1 ? `<button type="button" data-recent-page="${AppState.recentEntriesPage - 1}" ${AppState.recentEntriesPage === 1 ? 'disabled' : ''} aria-label="Previous page">‹</button>${pages.map(page => `<button type="button" data-recent-page="${page}" class="${page === AppState.recentEntriesPage ? 'active' : ''}" aria-label="Page ${page}" aria-current="${page === AppState.recentEntriesPage ? 'page' : 'false'}">${page}</button>`).join('')}<button type="button" data-recent-page="${AppState.recentEntriesPage + 1}" ${AppState.recentEntriesPage === totalPages ? 'disabled' : ''} aria-label="Next page">›</button>` : '';
                pagination.querySelectorAll('[data-recent-page]').forEach(button => button.addEventListener('click', () => { AppState.recentEntriesPage = Number(button.dataset.recentPage); renderRecentEntries(); }));
            }
            recentTimeEntries.querySelectorAll('.admin-recent-entry-toggle').forEach(button => {
            button.addEventListener('click', () => {
                const row = button.closest('.admin-recent-entry-row');
                const expanded = row.classList.toggle('is-expanded');
                button.setAttribute('aria-expanded', String(expanded));
                button.textContent = expanded ? 'Hide details' : 'Details';
            });
            });
        };
        pageSize?.addEventListener('change', () => { AppState.recentEntriesPageSize = Number(pageSize.value); AppState.recentEntriesPage = 1; renderRecentEntries(); });
        renderRecentEntries();
    }
}

function loadTimeEntries() {
    const filterProject = document.getElementById('filterProject');
    if (filterProject) {
        const assignedIds = new Set(AppState.userProjects.filter(item => item.UserId === AppState.currentUser?.UserId && item.IsActive).map(item => item.ProjectId));
        const assignedProjects = AppState.projects.filter(project => assignedIds.has(project.ProjectId) && project.IsActive !== false);
        filterProject.innerHTML = '<option value="">All projects</option>' + assignedProjects.map(project => `<option value="${project.ProjectId}">${escapeHtml(project.ProjectName)}</option>`).join('');
    }
    const timeEntriesList = document.getElementById('timeEntriesList');
    if (timeEntriesList) {
        const entries = AppState.timeEntries.filter(te => te.UserId === AppState.currentUser?.UserId);
        
        const completed = entries.filter(entry => entry.DurationSeconds);
        const seconds = completed.reduce((total, entry) => total + Number(entry.DurationSeconds || 0), 0);
        const totalHours = document.getElementById('totalHours');
        const totalEntries = document.getElementById('totalEntries');
        const avgDuration = document.getElementById('avgDuration');
        if (totalHours) totalHours.textContent = formatDuration(seconds);
        if (totalEntries) totalEntries.textContent = entries.length;
        if (avgDuration) avgDuration.textContent = completed.length ? formatDuration(Math.round(seconds / completed.length)) : '0h 0m';

        timeEntriesList.innerHTML = entries.length ? entries.map(entry => {
            const project = entry.ProjectId ? AppState.projects.find(p => p.ProjectId === entry.ProjectId) : null;
            const clockIn = new Date(entry.ClockInAt);
            const clockOut = entry.ClockOutAt ? new Date(entry.ClockOutAt) : null;
            const duration = entry.DurationSeconds ? formatDuration(entry.DurationSeconds) : 'Active';
            const remarks = AppState.adminRemarks.filter(ar => ar.TimeEntryId === entry.TimeEntryId);
            
            return `
            <tr class="time-entry-row" id="timeEntry-${escapeHtml(entry.TimeEntryId)}" data-date="${clockIn.toISOString().slice(0, 10)}" data-project="${entry.ProjectId || ''}" data-status="${clockOut ? 'COMPLETED' : 'ACTIVE'}">
                    <td>${formatAppDate(entry.ClockInAt)}</td>
                    <td>${formatAppTime(entry.ClockInAt)}</td>
                    <td>${clockOut ? formatAppTime(entry.ClockOutAt) : 'Active'}</td>
                    <td>${duration}</td>
                    <td>${escapeHtml(project?.ProjectName || 'None')}</td>
                    <td>${escapeHtml(entry.FinalNote || 'No clock-out note')}</td>
                    <td><span class="badge ${clockOut ? 'badge-success' : 'badge-warning'}">${clockOut ? 'Completed' : 'Active'}</span></td>
                    <td>${remarks.length ? remarks.map(remark => `<div class="time-entry-remark"><strong>${escapeHtml(remark.AdminName)}</strong><br>${escapeHtml(remark.Remark)}</div>`).join('') : '—'}</td>
                    <td>
                        <button class="btn btn-sm btn-outline desktop-entry-view" data-time-entry-view="${escapeHtml(entry.TimeEntryId)}" type="button">View</button>
                        <button class="btn btn-sm btn-outline time-entry-details-toggle" type="button" aria-expanded="false">Details</button>
                    </td>
                </tr>
            `;
        }).join('') : `<tr class="table-empty-row"><td colspan="10">${emptyState('No time entries yet', 'Your tracked sessions will appear here. Start by clocking in.', 'Clock in', '#')}</td></tr>`;

        timeEntriesList.querySelectorAll('.time-entry-details-toggle').forEach(button => {
            button.addEventListener('click', () => {
                const row = button.closest('.time-entry-row');
                const expanded = row.classList.toggle('is-expanded');
                button.setAttribute('aria-expanded', String(expanded));
                button.textContent = expanded ? 'Hide details' : 'Details';
            });
        });
        // Use an explicit listener instead of an inline onclick handler. The
        // security policy correctly blocks inline script, which was preventing
        // the employee detail modal from opening.
        timeEntriesList.querySelectorAll('[data-time-entry-view]').forEach(button => {
            button.addEventListener('click', () => viewTimeEntry(button.dataset.timeEntryView));
        });
        const requestedEntryId = decodeURIComponent(location.hash.replace(/^#timeEntry-/, ''));
        const requestedRow = requestedEntryId && timeEntriesList.querySelector(`#timeEntry-${CSS.escape(requestedEntryId)}`);
        if (requestedRow && !timeEntriesList.dataset.searchTargetHandled) {
            timeEntriesList.dataset.searchTargetHandled = 'true';
            requestedRow.classList.add('search-target');
            requestAnimationFrame(() => requestedRow.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        }
    }
}

function loadRemarksPage() {
    const list = document.getElementById('remarksPageList');
    if (!list) return;
    const entryById = new Map(AppState.timeEntries.map(entry => [entry.TimeEntryId, entry]));
    const remarks = AppState.adminRemarks;
    list.innerHTML = remarks.length ? remarks.map(remark => {
        const entry = entryById.get(remark.TimeEntryId);
        const entryDate = entry ? new Date(entry.ClockInAt).toLocaleString() : 'Related time entry';
        const project = entry?.ProjectId ? AppState.projects.find(item => item.ProjectId === entry.ProjectId)?.ProjectName : null;
        return `<article class="remark-item"><strong>${escapeHtml(remark.AdminName)}</strong><p>${escapeHtml(remark.Remark)}</p><small>${escapeHtml(project || 'No project')} · Time entry: ${escapeHtml(entryDate)} · Added ${new Date(remark.CreatedAt).toLocaleString()}</small></article>`;
        }).join('') : emptyState('No administrator notes yet', 'Notes from your administrator will appear here.');
}

function updateRemarkNotificationBadge() {
    const unread = AppState.currentUser?.Role === 'ADMIN' ? 0 : AppState.adminRemarks.filter(remark => !remark.SeenAt).length;
    document.querySelectorAll('.shell-link[href="remarks.html"]').forEach(link => {
        let badge = link.querySelector('.shell-notification-badge');
        if (!unread) { badge?.remove(); return; }
        if (!badge) { badge = document.createElement('b'); badge.className = 'shell-notification-badge'; link.appendChild(badge); }
        badge.textContent = unread > 9 ? '9+' : unread;
        badge.setAttribute('aria-label', `${unread} new administrator remark${unread === 1 ? '' : 's'}`);
    });
}

async function markRemarksRead() {
    if (AppState.currentUser?.Role === 'ADMIN' || !AppState.adminRemarks.some(remark => !remark.SeenAt)) return;
    try {
        await window.ACEAuth.request('/v1/admin-remarks/mark-read', { method: 'POST' });
        const seenAt = new Date().toISOString();
        AppState.adminRemarks.forEach(remark => { if (!remark.SeenAt) remark.SeenAt = seenAt; });
        updateRemarkNotificationBadge();
    } catch (error) { console.warn('Could not mark administrator remarks as read.', error); }
}

function startRemarkNotifications() {
    if (AppState.remarkNotificationInterval || AppState.currentUser?.Role === 'ADMIN') return;
    let initialized = true;
    const refresh = async () => {
        try {
            const remarks = (await window.ACEAuth.request('/v1/admin-remarks')).map(adminRemarkRecord);
            const hadUnread = AppState.adminRemarks.some(remark => !remark.SeenAt);
            AppState.adminRemarks = remarks;
            updateRemarkNotificationBadge();
            if (!initialized && !hadUnread && remarks.some(remark => !remark.SeenAt)) showToast('An administrator added a remark to one of your time entries.', 'info');
            initialized = false;
        } catch (error) { console.warn('Could not refresh administrator remarks.', error); }
    };
    updateRemarkNotificationBadge();
    if (AppState.adminRemarks.some(remark => !remark.SeenAt)) showToast('You have new administrator remarks.', 'info');
    AppState.remarkNotificationInterval = window.setInterval(refresh, 15000);
    window.addEventListener('pagehide', () => window.clearInterval(AppState.remarkNotificationInterval), { once: true });
}

function updateOnlineUserCount() {
    const activeUsers = document.getElementById('activeUsers');
    if (!activeUsers) return;
    const onlineAfter = Date.now() - 2 * 60 * 1000;
    activeUsers.textContent = AppState.users.filter(user =>
        user.Status === 'ACTIVE' && user.LastSeenAt && new Date(user.LastSeenAt).getTime() >= onlineAfter
    ).length;
}

function startOnlineUserCountRefresh() {
    // The shared live-data loop updates the complete dashboard every 20
    // seconds, including online status. Keep this wrapper for existing calls.
    if (!AppState.liveDataInterval) startLiveDataRefresh();
}

let reportsPage = 1; const reportsPageSize = 25; let reportsTotal = 0;
async function loadReportsList() {
    const reportsList = document.getElementById('reportsList');
    if (reportsList && window.ACEAuth) {
        try { const response = await window.ACEAuth.request('/v1/reports?page=' + reportsPage + '&pageSize=' + reportsPageSize); AppState.reports = (response.items || response).map(reportRecord); reportsTotal = response.total ?? AppState.reports.length; }
        catch (error) { showToast(error.message || 'Could not load reports.', 'error'); return; }
    }
    if (reportsList) {
        reportsList.innerHTML = AppState.reports.length ? AppState.reports.map(report => {
            const user = AppState.users.find(u => u.UserId === report.CreatedByUserId);
            return `
                <tr data-type="${report.ReportType}" data-from="${report.DateFrom}" data-to="${report.DateTo}" data-user="${report.CreatedByUserId}" data-department="${report.Filters?.departmentId || ''}" data-project="${report.Filters?.projectId || ''}"${report.TotalRecords === 0 ? ' style="color: var(--ace-muted); opacity: .62"' : ''}>
                    <td>${formatReportType(report.ReportType)}</td>
                    <td>${reportDate(report.DateFrom)} to ${reportDate(report.DateTo)}</td>
                    <td>${escapeHtml(user?.FullName || 'Unknown')}</td>
                    <td>${formatAppDateTime(report.GeneratedAt)}</td>
                    <td>${report.TotalRecords}</td>
                    <td>
                        <button class="btn btn-sm btn-outline" type="button" data-report-action="export" data-report-id="${report.ReportId}" data-report-format="XLSX">Save Excel</button>
                        <button class="btn btn-sm btn-primary" type="button" data-report-action="export" data-report-id="${report.ReportId}" data-report-format="PDF">Save PDF</button>
                        <button class="btn btn-sm btn-danger" type="button" data-report-action="delete" data-report-id="${report.ReportId}">Delete</button>
                    </td>
                </tr>
            `;
        }).join('') : `<tr class="table-empty-row"><td colspan="6">${emptyState('No reports yet', 'Generate a report from the dashboard when you need to export team time.', 'Open dashboard', 'admin-dashboard.html')}</td></tr>`;
        reportsList.querySelectorAll('[data-report-action]').forEach(button => button.addEventListener('click', () => {
            const reportId = button.dataset.reportId;
            if (button.dataset.reportAction === 'export') exportReport(reportId, button.dataset.reportFormat);
            else deleteReport(reportId);
        }));
        const pager = document.getElementById('reportsPagination'); const pages = Math.max(1, Math.ceil(reportsTotal / reportsPageSize)); if (pager) { pager.innerHTML = reportsTotal > reportsPageSize ? `<span>Showing ${(reportsPage - 1) * reportsPageSize + 1}–${Math.min(reportsPage * reportsPageSize, reportsTotal)} of ${reportsTotal}</span><button type="button" data-report-page="${reportsPage - 1}" ${reportsPage === 1 ? 'disabled' : ''}>Previous</button><button type="button" data-report-page="${reportsPage + 1}" ${reportsPage === pages ? 'disabled' : ''}>Next</button>` : ''; pager.querySelectorAll('[data-report-page]').forEach(button => button.addEventListener('click', () => { reportsPage = Number(button.dataset.reportPage); loadReportsList(); })); }
        const requestedReportId = new URLSearchParams(location.search).get('report');
        if (requestedReportId && !reportsList.dataset.searchTargetHandled) {
            reportsList.dataset.searchTargetHandled = 'true';
            const requestedReport = AppState.reports.find(report => String(report.ReportId) === requestedReportId);
            if (requestedReport) requestAnimationFrame(() => viewReport(requestedReport.ReportId));
            else showToast('That saved report is no longer available.', 'warning');
        }
    }
}

function loadUserSettings() {
    if (AppState.currentUser) {
        const fullName = document.getElementById('fullName');
        
        if (fullName) fullName.value = AppState.currentUser.FullName;
    }
    try {
        const notifications = JSON.parse(localStorage.getItem('ace_notification_preferences') || '{}');
        Object.entries(notifications).forEach(([id, checked]) => {
            const input = document.getElementById(id);
            if (input) input.checked = Boolean(checked);
        });
        const appearance = JSON.parse(localStorage.getItem('ace_appearance_preferences') || '{}');
        const theme = document.querySelector(`input[name="theme"][value="${appearance.theme || 'light'}"]`);
        if (theme) theme.checked = true;
        if (appearance.fontSize && document.getElementById('fontSize')) document.getElementById('fontSize').value = appearance.fontSize;
        if (document.getElementById('compactMode')) document.getElementById('compactMode').checked = Boolean(appearance.compact);
    } catch (error) {
        console.warn('Could not restore saved settings', error);
    }
}

// Helper Functions
function populateDepartmentSelect(selectId) {
    const select = document.getElementById(selectId);
    if (select) {
        const placeholder = selectId.startsWith('filter') ? 'All departments' : 'Select department';
        select.innerHTML = `<option value="">${placeholder}</option>` +
            AppState.departments.map(d => `<option value="${d.DepartmentId}">${escapeHtml(d.DepartmentName)}</option>`).join('');
    }
}

function populateProjectSelect(selectId) {
    const select = document.getElementById(selectId);
    if (select) {
        let projects = AppState.projects.filter(project => project.IsActive !== false);
        if (AppState.currentUser?.Role === 'USER') {
            const assignedIds = new Set(AppState.userProjects.filter(item => item.UserId === AppState.currentUser.UserId && item.IsActive).map(item => item.ProjectId));
            projects = projects.filter(project => assignedIds.has(project.ProjectId));
        }
        const placeholder = selectId.startsWith('filter') ? 'All projects' : 'No project';
        select.innerHTML = `<option value="">${placeholder}</option>` + projects.map(p => `<option value="${p.ProjectId}">${escapeHtml(p.ProjectName)}</option>`).join('');
    }
}

function populateUserSelect(selectId) {
    const select = document.getElementById(selectId);
    if (select) {
        select.innerHTML = '<option value="">All Users</option>' + 
            AppState.users.map(u => `<option value="${u.UserId}">${escapeHtml(u.FullName)}</option>`).join('');
    }
}

function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
}

function applyFilters() {
    const isReports = Boolean(document.getElementById('reportsList'));
    const rows = document.querySelectorAll(isReports ? '#reportsList tr' : '#timeEntriesList tr');
    const from = document.getElementById('filterDateFrom')?.value || '';
    const to = document.getElementById('filterDateTo')?.value || '';
    const project = document.getElementById('filterProject')?.value || '';
    const status = document.getElementById('filterStatus')?.value || '';
    const type = document.getElementById('filterReportType')?.value || '';
    const user = document.getElementById('filterUser')?.value || '';
    const department = document.getElementById('filterDepartment')?.value || '';
    let visible = 0;
    rows.forEach(row => {
        const date = row.dataset.date || row.dataset.from || '';
        const matches = (!from || date >= from) && (!to || date <= to) &&
            (!project || row.dataset.project === project) && (!status || row.dataset.status === status) &&
            (!type || row.dataset.type === type) && (!user || row.dataset.user === user) &&
            (!department || row.dataset.department === department);
        row.hidden = !matches;
        if (matches) visible += 1;
    });
    showToast(`${visible} result${visible === 1 ? '' : 's'} matched the selected filters.`, 'success');
}

function formatClockDuration(seconds) {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const remainder = safeSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function clearFilters() {
    const filterInputs = document.querySelectorAll('.filters-section input, .filters-section select');
    filterInputs.forEach(input => {
        input.value = '';
    });
    showToast('Filters cleared', 'info');
    document.querySelectorAll('#reportsList tr, #timeEntriesList tr').forEach(row => { row.hidden = false; });
}

// Report and time-entry actions are attached with event listeners so the
// frontend can keep a strict script CSP without inline event handlers.
function viewTimeEntry(entryId) {
    const entry = AppState.timeEntries.find(te => te.TimeEntryId === entryId);
    if (entry) {
        let detailsModal = document.getElementById('entryDetailsModal');
        if (!detailsModal) {
            detailsModal = document.createElement('div');
            detailsModal.id = 'entryDetailsModal';
            detailsModal.className = 'modal';
            detailsModal.innerHTML = '<div class="modal-content"><div class="modal-header"><h3 class="modal-title">Time entry details</h3><button class="modal-close" type="button" aria-label="Close">' + suppliedIconMarkup('x') + '</button></div><div class="modal-body"><div id="entryDetailsContent"></div><div id="adminRemarksList"></div></div></div>';
            document.body.appendChild(detailsModal);
            detailsModal.querySelector('.modal-close').addEventListener('click', () => closeModal('entryDetailsModal'));
            detailsModal.addEventListener('click', event => { if (event.target === detailsModal) closeModal('entryDetailsModal'); });
        }
        const entryDetails = document.getElementById('entryDetailsContent');
        if (entryDetails) {
            const user = AppState.users.find(u => u.UserId === entry.UserId);
            const project = entry.ProjectId ? AppState.projects.find(p => p.ProjectId === entry.ProjectId) : null;
            
            entryDetails.innerHTML = `
                <div class="entry-info">
                    <p><strong>User:</strong> ${escapeHtml(user?.FullName || 'Unknown')}</p>
                    <p><strong>Project:</strong> ${escapeHtml(project?.ProjectName || 'None')}</p>
                    <p><strong>Clock In:</strong> ${new Date(entry.ClockInAt).toLocaleString()}</p>
                    <p><strong>Clock Out:</strong> ${entry.ClockOutAt ? new Date(entry.ClockOutAt).toLocaleString() : 'Active'}</p>
                    <p><strong>Worked:</strong> ${entry.DurationSeconds ? formatDuration(entry.DurationSeconds) : 'Active'}</p>
                    <p><strong>Clock-out note:</strong> ${escapeHtml(entry.FinalNote || 'No clock-out note')}</p>
                </div>
            `;
        }
        
        const adminRemarksList = document.getElementById('adminRemarksList');
        if (adminRemarksList) {
            const remarks = AppState.adminRemarks.filter(ar => ar.TimeEntryId === entryId);
            adminRemarksList.innerHTML = remarks.map(remark => {
                const admin = AppState.users.find(u => u.UserId === remark.AdminUserId);
                return `
                    <div class="remark-item">
                        <strong>${escapeHtml(remark.AdminName || admin?.FullName || 'Admin')}</strong>
                        <p>${escapeHtml(remark.Remark)}</p>
                        <small>${new Date(remark.CreatedAt).toLocaleString()}</small>
                    </div>
                `;
            }).join('') || '<p>No admin remarks</p>';
        }
        
        openModal('entryDetailsModal');
    }
}

function viewReport(reportId) {
    const report = AppState.reports.find(r => r.ReportId === reportId);
    if (report) renderGeneratedReport(report);
}

async function deleteReport(reportId) {
    const report = AppState.reports.find(item => item.ReportId === reportId);
    if (!report || !await window.ACEUI.confirm({ title: 'Delete generated report?', message: 'This removes the report from the ACE report library and cannot be undone.', confirmLabel: 'Delete report', danger: true })) return;
    try {
        await window.ACEAuth.request(`/v1/reports/${reportId}`, { method: 'DELETE' });
        AppState.reports = AppState.reports.filter(item => item.ReportId !== reportId);
        loadReportsList();
        showToast('Generated report deleted.', 'success');
    } catch (error) {
        showToast(error.message || 'Could not delete the generated report.', 'error');
    }
}

function loadExcelLibrary() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return Promise.reject(new Error('Excel export library did not load.'));
}
function reportWorkbookData(report) {
    const entries = filterEntriesForReport(report);
    const timeEntries = [['Employee', 'Project', 'Clock in', 'Clock out', 'Worked seconds', 'Worked time', 'Clock-out note', 'Status']];
    entries.forEach(entry => {
        const user = AppState.users.find(item => item.UserId === entry.UserId);
        const project = entry.ProjectName || AppState.projects.find(item => item.ProjectId === entry.ProjectId)?.ProjectName || 'Unassigned';
        const workedSeconds = Number(entry.DurationSeconds || 0);
        timeEntries.push([
            user?.FullName || 'Unknown', project, reportDateTime(entry.ClockInAt),
            entry.ClockOutAt ? reportDateTime(entry.ClockOutAt) : 'Active',
            workedSeconds, formatDuration(workedSeconds),
            entry.FinalNote || '', entry.ClockOutAt ? 'Completed' : 'Active'
        ]);
    });
    const totalSeconds = entries.reduce((sum, entry) => sum + Number(entry.DurationSeconds || 0), 0);
    timeEntries.push(['Total worked', '', '', '', totalSeconds, formatDuration(totalSeconds), '', '']);
    return timeEntries;
}
async function exportExcelReport(reportId) {
    const selected = reportId && typeof reportId === 'object' ? reportId : reportId ? AppState.reports.find(report => String(report.ReportId) === String(reportId)) : null;
    const report = selected || {
        ReportId: 'PREVIEW', CreatedByUserId: AppState.currentUser?.UserId || '', ReportType: 'CUSTOM',
        DateFrom: '', DateTo: '', Filters: {}, GeneratedAt: new Date().toISOString(), TotalRecords: AppState.timeEntries.length
    };
    try {
        const XLSX = await loadExcelLibrary();
        const timeEntries = reportWorkbookData(report);
        const workbook = XLSX.utils.book_new();
        const entriesSheet = XLSX.utils.aoa_to_sheet(timeEntries);
        entriesSheet['!cols'] = [{ wch: 26 }, { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 16 }, { wch: 16 }, { wch: 15 }, { wch: 16 }, { wch: 26 }, { wch: 13 }];
        XLSX.utils.book_append_sheet(workbook, entriesSheet, 'Time Entries');
        XLSX.writeFile(workbook, `ace-time-report-${String(report.ReportId).toLowerCase()}-${new Date().toISOString().slice(0, 10)}.xlsx`, { compression: true });
        showToast('Excel report downloaded.', 'success');
    } catch (error) { showToast(error.message || 'Could not create the Excel report.', 'error'); }
}
function exportReport(reportId, fileType) {
    const selected = reportId ? AppState.reports.find(report => report.ReportId === reportId) : null;
    const reports = selected ? [selected] : AppState.reports;
    if (fileType === 'PDF') {
        const entries = AppState.timeEntries.filter(entry => entry.ClockInAt);
        const timestamps = entries.map(entry => new Date(entry.ClockInAt).getTime()).filter(Number.isFinite);
        const preview = selected || {
            ReportId: 'PREVIEW',
            CreatedByUserId: AppState.currentUser?.UserId || 1,
            ReportType: 'CUSTOM',
            DateFrom: timestamps.length ? new Date(Math.min(...timestamps)).toISOString().slice(0, 10) : '',
            DateTo: timestamps.length ? new Date(Math.max(...timestamps)).toISOString().slice(0, 10) : '',
            Filters: {},
            GeneratedAt: new Date().toISOString(),
            TotalRecords: entries.length
        };
        renderGeneratedReport(preview, { printOnly: true });
        window.setTimeout(printGeneratedReport, 100);
        return;
    }
    if (fileType === 'CSV') {
        const escape = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
        const rows = [['Report ID', 'Type', 'Date From', 'Date To', 'Generated At', 'Total Records'], ...reports.map(report => [report.ReportId, report.ReportType, report.DateFrom, report.DateTo, report.GeneratedAt, report.TotalRecords])];
        const blob = new Blob([rows.map(row => row.map(escape).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `ace-report${reportId ? `-${reportId}` : 's'}-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(link.href);
        showToast('CSV export downloaded.', 'success');
        return;
    }
    if (fileType === 'XLSX') { exportExcelReport(reportId); return; }
    showToast(`${fileType} export is unavailable.`, 'warning');
}
window.ACEReportActions = {
    preview({ dateFrom, dateTo, filters = {}, format = 'VIEW' }) {
        const report = { ReportId: '', CreatedByUserId: AppState.currentUser?.UserId || '', ReportType: 'INDIVIDUAL', DateFrom: dateFrom, DateTo: dateTo, Filters: filters, GeneratedAt: new Date().toISOString(), TotalRecords: 0 };
        if (format === 'XLSX') return exportExcelReport(report);
        renderGeneratedReport(report);
        if (format === 'PDF') window.setTimeout(printGeneratedReport, 80);
        return report;
    },
    async generate({ reportType = 'CUSTOM', dateFrom, dateTo, filters = {}, format = 'PDF' }) {
        const saved = await window.ACEAuth.request('/v1/reports', { method: 'POST', body: JSON.stringify({ reportType, dateFrom, dateTo, filters }) });
        const report = reportRecord(saved);
        AppState.reports.unshift(report);
        if (format === 'XLSX') {
            await exportExcelReport(report.ReportId);
            return report;
        }
        renderGeneratedReport(report, { printOnly: true });
        showToast('Your A4 report is ready. Choose “Save as PDF” in the print dialog.', 'success');
        window.setTimeout(printGeneratedReport, 120);
        return report;
    }
};

// Toast Notifications
function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toastContainer');
    if (!toastContainer) return;

    const labels = { success: 'Success', error: 'Something went wrong', warning: 'Attention', info: 'Notice' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    toast.innerHTML = `
        <div class="toast-message"><strong>${labels[type] || labels.info}</strong><span>${escapeHtml(message)}</span></div>
        <button class="toast-close" type="button" aria-label="Dismiss notification">${suppliedIconMarkup('x')}</button>
    `;

    toastContainer.appendChild(toast);
    const dismiss = () => {
        if (!toast.isConnected) return;
        toast.classList.add('is-leaving');
        window.setTimeout(() => toast.remove(), 180);
    };
    let timer = window.setTimeout(dismiss, 5200);
    toast.querySelector('.toast-close').addEventListener('click', dismiss);
    toast.addEventListener('mouseenter', () => window.clearTimeout(timer));
    toast.addEventListener('mouseleave', () => { timer = window.setTimeout(dismiss, 1800); });
}

function viewProject(projectId) {
    const project = AppState.projects.find(item => item.ProjectId === projectId);
    const content = document.getElementById('projectDetailsContent');
    if (!project || !content) return;
    const assignment = AppState.userProjects.find(item => item.UserId === AppState.currentUser?.UserId && item.ProjectId === projectId);
    const entries = AppState.timeEntries.filter(item => item.UserId === AppState.currentUser?.UserId && item.ProjectId === projectId);
    const seconds = entries.reduce((total, entry) => total + Number(entry.DurationSeconds || 0), 0);
    content.innerHTML = `
        <p><strong>Project</strong>${escapeHtml(project.ProjectName)}</p>
        <p><strong>Status</strong>${project.IsActive ? 'Active' : 'Inactive'}</p>
        <p><strong>Assigned</strong>${assignment ? new Date(assignment.AssignedAt).toLocaleDateString() : 'Not assigned'}</p>
        <p><strong>Tracked time</strong>${formatDuration(seconds)}</p>
        <p class="detail-wide"><strong>Description</strong>${escapeHtml(project.Description || 'No description provided.')}</p>`;
    openModal('projectDetailsModal');
}

// Loading Spinner
function showSpinner() {
    const spinner = document.getElementById('loadingSpinner');
    if (spinner) spinner.style.display = 'flex';
}

function hideSpinner() {
    const spinner = document.getElementById('loadingSpinner');
    if (spinner) spinner.style.display = 'none';
}

// Start exactly once whether the script is parsed before or after DOM readiness.
// This prevents a cached navigation transition from skipping application-shell setup.
const startApp = () => {
    initApp().catch(error => {
        console.error('Application startup failed.', error);
        document.body.classList.remove('app-shell-pending');
        document.querySelector('.app-shell-skeleton')?.remove();
    });
};

installPageFadeNavigation();
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp, { once: true });
} else {
    startApp();
}
