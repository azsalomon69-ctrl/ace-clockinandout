// ============================================
// ACE Clock In/Out System - Main JavaScript
// ============================================

// Global State
const AppState = {
    currentUser: null,
    isAuthenticated: false,
    isClockedIn: false,
    currentSession: null,
    notificationTimers: [],
    presenceInterval: null,
    presenceVisibilityHandler: null,
    clockInTime: null,
    timerInterval: null,
    projects: [],
    departments: [],
    timeEntries: [],
    reports: [],
    users: [],
    invitations: [],
    auditLogs: [],
    userProjects: [],
    adminRemarks: [],
    database: null
};

const profileRecord = item => ({ UserId: item.id, Email: item.email, FullName: item.full_name, Role: item.role, Status: item.status, DepartmentId: item.department_id, CreatedAt: item.created_at });
const departmentRecord = item => ({ DepartmentId: item.id, DepartmentName: item.name, Description: item.description, IsActive: item.is_active, CreatedAt: item.created_at });
const projectRecord = item => ({ ProjectId: item.id, ProjectName: item.name, Description: item.description, IsActive: item.is_active, CreatedAt: item.created_at });
const timeEntryRecord = item => ({ TimeEntryId: item.id, UserId: item.user_id, ProjectId: item.project_id, ClockInAt: item.clock_in_at, ClockOutAt: item.clock_out_at, PlannedEndAt: item.planned_end_at, UserNote: item.user_note, DurationSeconds: item.duration_seconds, ProjectName: item.projects?.name, UserName: item.profiles?.full_name });
const reportRecord = item => ({ ReportId: item.id, CreatedByUserId: item.created_by_user_id, ReportType: item.report_type, DateFrom: item.date_from, DateTo: item.date_to, Filters: item.filters, GeneratedAt: item.generated_at, TotalRecords: item.total_records });

// Live data is supplied exclusively by the Render API and Supabase.
async function loadDatabase() {
    if (!window.ACEAuth) throw new Error('Authentication service is unavailable.');
    const { profile } = await window.ACEAuth.request('/v1/me');
    AppState.currentUser = profileRecord(profile);
    AppState.isAuthenticated = true;
    localStorage.setItem('ace_current_user', JSON.stringify(AppState.currentUser));
    const [departments, projects, entries, userProjects] = await Promise.all([
        window.ACEAuth.request('/v1/departments'),
        window.ACEAuth.request('/v1/projects'),
        window.ACEAuth.request(`/v1/time-entries${AppState.currentUser.Role === 'ADMIN' ? '' : '?mine=true'}`),
        window.ACEAuth.request('/v1/user-projects')
    ]);
    AppState.departments = departments.map(departmentRecord);
    AppState.projects = projects.map(projectRecord);
    AppState.timeEntries = entries.map(timeEntryRecord);
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
    if (active) { startTimer(); scheduleSessionNotifications(active); }
    return true;
}

const pause = milliseconds => new Promise(resolve => window.setTimeout(resolve, milliseconds));

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
        renderInitialSkeletons();
        applyStoredAppearance();
        checkAuthState();
        redirectAuthenticatedPublicRoute();
    } catch (error) {
        console.warn('Recovered from a saved interface preference.', error);
        localStorage.removeItem('ace_current_user');
        localStorage.removeItem('ace_current_session');
    }
    try { initializeAppShell(); }
    catch (error) { console.error('Could not mount the application navigation.', error); }

    if (isPublicRoute()) {
        await resumePublicSession();
        initializeNavigation();
        initializeModals();
        initializeForms();
        if (document.body.dataset.openAccessRequest === 'true') {
            delete document.body.dataset.openAccessRequest;
            window.setTimeout(() => openModal('requestAccessModal'), 0);
        }
        initializeUXEnhancements();
        clearInitialSkeletons();
        return;
    }

    const loaded = await loadDatabaseWhenServiceIsReady();
    if (loaded) {
        startPresenceHeartbeat();
        initializeNavigation();
        initializeModals();
        initializeForms();
        updateUI();
        startClock();
        loadPageSpecificData();
        initializeUXEnhancements();
    }
    clearInitialSkeletons();
    requestAnimationFrame(() => {
        document.body.classList.remove('app-shell-pending');
        document.querySelector('.app-shell-skeleton')?.remove();
    });
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
        window.location.replace(AppState.currentUser.Role === 'ADMIN' ? 'admin-dashboard.html' : 'user-dashboard.html');
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
    window.location.replace(AppState.currentUser.Role === 'ADMIN' ? 'admin-dashboard.html' : 'user-dashboard.html');
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
        link.addEventListener('pointerenter', () => {
            if (link.dataset.prefetched) return;
            link.dataset.prefetched = 'true';
            const preload = document.createElement('link');
            preload.rel = 'prefetch';
            preload.href = link.href;
            document.head.appendChild(preload);
        }, { once: true });
    });
}

// Shared application shell for every authenticated page.
function initializeAppShell() {
    if (document.body.classList.contains('has-app-shell')) return;
    const routeName = (window.location.pathname.split('/').pop() || '').toLowerCase();
    // Vercel cleanUrls removes .html while the local static server preserves it.
    // Normalize both forms before selecting the application shell.
    const file = routeName && !routeName.includes('.') ? `${routeName}.html` : routeName;
    const adminFiles = ['admin-dashboard.html', 'admin-management.html', 'users.html', 'deleted-users.html', 'invitations.html', 'access-requests.html', 'departments.html', 'projects.html', 'admin-time-entries.html', 'deleted-time-entries.html', 'reports.html', 'audit-logs.html'];
    const employeeFiles = ['user-dashboard.html', 'time-entries.html', 'settings.html'];
    const isSharedSettings = file === 'settings.html';
    const isAdmin = adminFiles.includes(file) || (isSharedSettings && AppState.currentUser?.Role === 'ADMIN');
    const isEmployee = employeeFiles.includes(file) && !isAdmin;
    if (!isAdmin && !isEmployee) return;
    if (AppState.currentUser && isAdmin && AppState.currentUser.Role !== 'ADMIN') {
        window.location.replace('user-dashboard.html');
        return;
    }
    if (AppState.currentUser && isEmployee && AppState.currentUser.Role === 'ADMIN') {
        window.location.replace('admin-dashboard.html');
        return;
    }

    const icons = { dashboard: 'layout-panel-top', users: 'users', mail: 'mail', requests: 'user-pen', building: 'building', folder: 'folder', clock: 'timer', chart: 'chart-column-big', audit: 'brick-wall-shield', settings: 'settings', logout: 'log-out', chevron: 'chevron-left' };
    const icon = name => suppliedIconMarkup(icons[name], 'shell-icon');
    const adminGroups = [
        ['Workspace', [['admin-dashboard.html', 'dashboard', 'Dashboard']]],
        ['People', [['users.html', 'users', 'Users'], ['deleted-users.html', 'users', 'Deleted users'], ['invitations.html', 'mail', 'Invitations'], ['access-requests.html', 'requests', 'Access requests'], ['departments.html', 'building', 'Departments']]],
        ['Work', [['projects.html', 'folder', 'Projects'], ['admin-time-entries.html', 'clock', 'Time entries'], ['deleted-time-entries.html', 'clock', 'Deleted time entries']]],
        ['Insights', [['reports.html', 'chart', 'Reports']]],
        ['Administration', [['audit-logs.html', 'audit', 'Audit log'], ['settings.html', 'settings', 'Settings']]]
    ];
    const employeeGroups = [
        ['Workspace', [['user-dashboard.html', 'dashboard', 'Dashboard']]],
        ['Work', [['time-entries.html', 'clock', 'My time entries']]],
        ['Account', [['settings.html', 'settings', 'Settings']]]
    ];
    const groups = isAdmin ? adminGroups : employeeGroups;
    const user = AppState.currentUser || { FullName: isAdmin ? 'ACE Administrator' : 'ACE Employee', Role: isAdmin ? 'ADMIN' : 'USER' };
    const initials = user.FullName.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase();
    const links = groups.map(([groupLabel, items]) => `<section class="shell-nav-group" aria-label="${groupLabel}"><p class="shell-nav-label">${groupLabel}</p>${items.map(([href, iconName, label]) => {
        const active = file === href || (file === 'admin-management.html' && new URLSearchParams(location.search).get('view') === href.replace('.html', '').replace('admin-time-entries', 'entries').replace('audit-logs', 'audit'));
        return `<a class="shell-link${active ? ' active' : ''}" href="${href}" title="${label}">${icon(iconName)}<span class="shell-label">${label}</span></a>`;
    }).join('')}</section>`).join('');

    document.body.classList.add('has-app-shell');
    if (isSharedSettings && isAdmin) {
        const title = document.querySelector('.settings-title');
        const subtitle = document.querySelector('.settings-subtitle');
        if (title) title.textContent = 'Administrator Settings';
        if (subtitle) subtitle.textContent = 'Manage your administrator account and workspace preferences';
    }
    const sidebar = document.createElement('aside');
    sidebar.className = 'app-sidebar';
    sidebar.innerHTML = `<div class="shell-brand"><a href="${isAdmin ? 'admin-dashboard.html' : 'user-dashboard.html'}" aria-label="ACE Outsource Solutions"><img src="assets/images/ace-logo-hd-cropped.png" alt="ACE Outsource Solutions"></a><button class="shell-collapse" type="button" aria-label="Collapse sidebar">${icon('chevron')}</button></div><nav class="shell-nav" aria-label="${isAdmin ? 'Administrator' : 'Employee'} navigation">${links}</nav><div class="shell-account-wrap"><button class="shell-account" type="button" aria-label="Open account menu" aria-expanded="false" aria-controls="shellAccountMenu"><span class="shell-avatar">${initials}</span><span class="shell-user"><strong>${user.FullName}</strong><span>${isAdmin ? 'Administrator' : 'Employee'}</span></span>${suppliedIconMarkup('chevrons-up-down', 'shell-icon shell-account-menu-icon')}</button><div class="shell-account-menu" id="shellAccountMenu" role="menu" hidden><a href="settings.html" role="menuitem">Profile &amp; settings</a><button type="button" role="menuitem" data-account-logout>Sign out</button></div></div>`;
    const overlay = document.createElement('button');
    overlay.className = 'shell-overlay'; overlay.type = 'button'; overlay.setAttribute('aria-label', 'Close navigation');
    const mobileToggle = document.createElement('button');
    mobileToggle.className = 'shell-mobile-toggle'; mobileToggle.type = 'button'; mobileToggle.setAttribute('aria-label', 'Open navigation'); mobileToggle.setAttribute('aria-expanded', 'false');
    mobileToggle.innerHTML = suppliedIconMarkup('menu', 'shell-icon');
    document.body.prepend(overlay); document.body.prepend(sidebar); document.body.prepend(mobileToggle);

    const setCollapsed = collapsed => {
        document.body.classList.toggle('shell-collapsed', collapsed);
        sidebar.querySelector('.shell-collapse').setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
        localStorage.setItem('ace_sidebar_collapsed', collapsed ? '1' : '0');
    };
    setCollapsed(localStorage.getItem('ace_sidebar_collapsed') === '1');
    sidebar.querySelector('.shell-collapse').addEventListener('click', () => setCollapsed(!document.body.classList.contains('shell-collapsed')));
    const setMobileNavigation = open => {
        document.body.classList.toggle('shell-mobile-open', open);
        mobileToggle.setAttribute('aria-expanded', String(open));
        mobileToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    };
    mobileToggle.addEventListener('click', () => setMobileNavigation(!document.body.classList.contains('shell-mobile-open')));
    overlay.addEventListener('click', () => setMobileNavigation(false));
    const accountButton = sidebar.querySelector('.shell-account');
    const accountMenu = sidebar.querySelector('.shell-account-menu');
    const setAccountMenu = open => {
        accountButton.setAttribute('aria-expanded', String(open));
        accountButton.setAttribute('aria-label', open ? 'Close account menu' : 'Open account menu');
        accountMenu.hidden = !open;
    };
    accountButton.addEventListener('click', () => setAccountMenu(accountMenu.hidden));
    sidebar.querySelector('[data-account-logout]').addEventListener('click', handleLogout);
    document.addEventListener('click', event => {
        if (!sidebar.contains(event.target)) setAccountMenu(false);
    });
}

function suppliedIconMarkup(name, className = 'ui-icon') {
    return `<img class="${className}" src="assets/icons/${name}.svg" alt="" aria-hidden="true">`;
}

function applySuppliedIcons() {
    const buttonIcons = {
        heroLoginBtn: 'log-in', googleLoginBtn: 'log-in',
        generateReportBtn: 'file-text', inviteUserBtn: 'user-plus', manageDepartmentsBtn: 'building', manageProjectsBtn: 'folder',
        mainClockInBtn: 'timer', mainClockOutBtn: 'log-out', clockInBtn: 'timer', clockOutBtn: 'log-out', sessionClockOutBtn: 'log-out',
        applyFiltersBtn: 'funnel', clearFiltersBtn: 'eraser', exportCsvBtn: 'download', exportXlsxBtn: 'download', exportPdfBtn: 'download',
        viewAllEntriesBtn: 'eye', logoutOtherSessionsBtn: 'log-out'
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
            window.location.href = 'login.html';
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

    // Forgot password
    const forgotPasswordLink = document.getElementById('forgotPasswordLink');
    if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener('click', (e) => {
            e.preventDefault();
            closeModal('loginModal');
            openModal('forgotPasswordModal');
        });
    }

    // Request access
    const requestAccessLink = document.getElementById('requestAccessLink');
    if (requestAccessLink) {
        requestAccessLink.addEventListener('click', (e) => {
            e.preventDefault();
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
                generateAdminAnalyticsReport();
                return;
            }
            openModal('generateReportModal');
            const reportMonth = document.getElementById('reportMonth');
            if (reportMonth && !reportMonth.value) reportMonth.value = new Date().toISOString().slice(0, 7);
            populateDepartmentSelect('reportDepartment');
            populateProjectSelect('reportProject');
            populateUserSelect('reportUser');
        });
    }

    // Clock in buttons
    const clockInBtn = document.getElementById('mainClockInBtn');
    if (clockInBtn) {
        clockInBtn.addEventListener('click', () => {
            openModal('clockInModal');
            populateProjectSelect('clockInProject');
        });
    }

    const clockInBtnAlt = document.getElementById('clockInBtn');
    if (clockInBtnAlt) {
        clockInBtnAlt.addEventListener('click', () => {
            openModal('clockInModal');
            populateProjectSelect('clockInProject');
        });
    }

    // Clock out buttons
    const clockOutBtn = document.getElementById('mainClockOutBtn');
    if (clockOutBtn) {
        clockOutBtn.addEventListener('click', () => {
            showClockOutSummary();
            openModal('clockOutModal');
        });
    }

    const sessionClockOutBtn = document.getElementById('sessionClockOutBtn');
    if (sessionClockOutBtn) {
        sessionClockOutBtn.addEventListener('click', () => {
            showClockOutSummary();
            openModal('clockOutModal');
        });
    }

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
            window.location.href = href;
        });
    });

    const clockOutBtnAlt = document.getElementById('clockOutBtn');
    if (clockOutBtnAlt) {
        clockOutBtnAlt.addEventListener('click', () => {
            showClockOutSummary();
            openModal('clockOutModal');
        });
    }

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
                'notificationsTab': 'notificationSettings',
                'securityTab': 'securitySettings',
                'appearanceTab': 'appearanceSettings'
            };
            
            const targetSection = document.getElementById(sectionMap[tabId]);
            if (targetSection) {
                targetSection.style.display = 'block';
            }
        });
    });

    // Password toggles
    document.querySelectorAll('.password-toggle').forEach(btn => {
        btn.setAttribute('aria-label', 'Show password');
        btn.setAttribute('aria-pressed', 'false');
        btn.addEventListener('click', function() {
            const input = this.closest('.input-group').querySelector('input');
            const willShow = input.type === 'password';
            input.type = willShow ? 'text' : 'password';
            const icon = this.querySelector('img');
            if (icon) icon.src = `assets/icons/${willShow ? 'eye-off' : 'eye'}.svg`;
            this.setAttribute('aria-label', willShow ? 'Hide password' : 'Show password');
            this.setAttribute('aria-pressed', willShow ? 'true' : 'false');
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
        window.location.assign('login');
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

// Forms
function initializeForms() {
    // Login form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }

    // Google login
    const googleLoginBtn = document.getElementById('googleLoginBtn');
    if (googleLoginBtn) {
        googleLoginBtn.addEventListener('click', handleGoogleLogin);
    }

    // Forgot password form
    const forgotPasswordForm = document.getElementById('forgotPasswordForm');
    if (forgotPasswordForm) {
        forgotPasswordForm.addEventListener('submit', handleForgotPassword);
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
    const durationSelect = document.getElementById('clockInDuration');
    durationSelect?.addEventListener('change', () => {
        const custom = document.getElementById('clockInCustomDuration');
        if (custom) { custom.hidden = durationSelect.value !== 'custom'; custom.required = durationSelect.value === 'custom'; }
    });

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

    // Notification form
    const notificationForm = document.getElementById('notificationForm');
    if (notificationForm) {
        notificationForm.addEventListener('submit', handleNotificationUpdate);
    }

    // Security form
    const securityForm = document.getElementById('securityForm');
    if (securityForm) {
        securityForm.addEventListener('submit', handleSecurityUpdate);
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
            window.location.href = 'time-entries.html';
        });
    }

    initializeSecondaryActions();
}

function initializeSecondaryActions() {
    document.getElementById('cancelProfileBtn')?.addEventListener('click', () => {
        loadUserSettings();
        showToast('Unsaved profile changes discarded.', 'info');
    });

    document.getElementById('logoutOtherSessionsBtn')?.addEventListener('click', () => {
        showToast('Other sessions have been signed out in this frontend preview.', 'success');
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
function checkAuthState() {
    const savedUser = localStorage.getItem('ace_current_user');
    if (savedUser) {
        AppState.currentUser = JSON.parse(savedUser);
        AppState.isAuthenticated = true;
        
        // Check for active session
        const savedSession = localStorage.getItem('ace_current_session');
        if (savedSession) {
            AppState.currentSession = JSON.parse(savedSession);
            AppState.isClockedIn = true;
            AppState.clockInTime = new Date(AppState.currentSession.ClockInAt);
            startTimer();
        }
    }
}

async function handleLogin(e) {
    e.preventDefault();
    showSpinner();
    try {
        if (!window.ACEAuth) throw new Error('Authentication service is unavailable.');
        const auth = await window.ACEAuth.client();
        const { data, error } = await auth.auth.signInWithPassword({ email: document.getElementById('email').value.trim(), password: document.getElementById('password').value });
        if (error || !data.session) throw new Error(error?.message || 'Invalid email or password');
        const { profile } = await window.ACEAuth.request('/v1/me');
        if (profile.status !== 'ACTIVE') {
            await auth.auth.signOut();
            throw new Error(profile.status === 'DENIED' ? 'Your access request was not approved.' : 'Your access request is awaiting administrator approval.');
        }
        const user = { UserId: profile.id, Email: profile.email, FullName: profile.full_name, Role: profile.role, Status: profile.status, DepartmentId: profile.department_id };
        AppState.currentUser = user;
        AppState.isAuthenticated = true;
        localStorage.setItem('ace_current_user', JSON.stringify(user));
        await recordLoginOnce();
        hideSpinner();
        showToast('Login successful', 'success');
        window.location.href = user.Role === 'ADMIN' ? 'admin-dashboard.html' : 'user-dashboard.html';
    } catch (error) { hideSpinner(); showToast(error.message || 'Unable to sign in', 'error'); }
}

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
    AppState.isAuthenticated = false;
    AppState.isClockedIn = false;
    
    localStorage.removeItem('ace_current_user');
    localStorage.removeItem('ace_current_session');
    sessionStorage.removeItem('ace_login_audited');
    
    showToast('Logged out successfully', 'success');
    
    setTimeout(() => {
        window.location.href = 'login.html';
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

async function beginGoogleAccessRequest() {
    try {
        if (!window.ACEAuth) throw new Error('Request service is unavailable.');
        const auth = await window.ACEAuth.client();
        const { error } = await auth.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/login?requestAccess=1`, queryParams: { prompt: 'select_account' } } });
        if (error) throw error;
    } catch (error) { showToast(error.message || 'Unable to start Google sign-in.', 'error'); }
}

async function handleForgotPassword(e) {
    e.preventDefault();
    const email = document.getElementById('resetEmail').value.trim();
    try {
        const auth = await window.ACEAuth.client();
        const { error } = await auth.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/settings` });
        if (error) throw error;
        showToast('Password reset instructions were sent to ' + email, 'success');
        closeModal('forgotPasswordModal');
    } catch (error) {
        showToast(error.message || 'Could not send password reset instructions.', 'error');
    }
}

async function handleRequestAccess(e) {
    e.preventDefault();
    try {
        if (!window.ACEAuth) throw new Error('Request service is unavailable.');
        await window.ACEAuth.request('/v1/access-requests', { method: 'POST', body: JSON.stringify({ department: document.getElementById('requestDepartment').value.trim(), message: document.getElementById('requestMessage').value.trim() }) });
        closeModal('requestAccessModal');
        e.currentTarget.reset();
        showToast('Access request submitted. It expires in two minutes if it is not reviewed.', 'success');
    } catch (error) { showToast(error.message || 'Unable to submit access request', 'error'); }
}

// Clock In/Out Handlers
async function handleClockIn(e) {
    e.preventDefault();
    
    const projectId = document.getElementById('clockInProject')?.value;
    const note = document.getElementById('clockInNote')?.value;
    const durationChoice = document.getElementById('clockInDuration')?.value;
    const durationMinutes = durationChoice === 'custom' ? Number(document.getElementById('clockInCustomDuration')?.value || 0) : Number(durationChoice || 0);
    
    try {
        const entry = await window.ACEAuth.request('/v1/time-entries/clock-in', { method: 'POST', body: JSON.stringify({ projectId: projectId || null, note: note || null, durationMinutes }) });
        AppState.currentSession = timeEntryRecord(entry);
        AppState.timeEntries.unshift(AppState.currentSession);
        AppState.isClockedIn = true; AppState.clockInTime = new Date(AppState.currentSession.ClockInAt);
        scheduleSessionNotifications(AppState.currentSession);
        closeModal('clockInModal'); startTimer(); updateUI(); loadPageSpecificData();
        showToast('Clocked in successfully', 'success');
    } catch (error) { showToast(error.message || 'Unable to clock in', 'error'); }
}

async function handleClockOut(e) {
    e.preventDefault();
    
    const note = document.getElementById('clockOutNote')?.value;
    if (!AppState.currentSession) return;
    try {
        const entry = await window.ACEAuth.request(`/v1/time-entries/${AppState.currentSession.TimeEntryId}/clock-out`, { method: 'POST', body: JSON.stringify({ note: note || '' }) });
        const saved = timeEntryRecord(entry);
        AppState.timeEntries = AppState.timeEntries.map(item => item.TimeEntryId === saved.TimeEntryId ? saved : item);
        AppState.isClockedIn = false; AppState.currentSession = null; AppState.clockInTime = null;
        clearSessionNotifications();
        stopTimer(); closeModal('clockOutModal'); updateUI(); loadPageSpecificData();
        showToast('Clocked out successfully', 'success');
    } catch (error) { showToast(error.message || 'Unable to clock out', 'error'); }
}

async function sendWorkNotification(title, body) {
    showToast(body, 'info');
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission === 'granted') new Notification(title, { body, icon: 'assets/images/ace-logo.png' });
}

function scheduleSessionNotifications(entry) {
    clearSessionNotifications();
    // Never schedule a work reminder for another employee's entry. This is
    // especially important on admin pages, which receive all team entries.
    if (!entry?.PlannedEndAt || entry.UserId !== AppState.currentUser?.UserId) return;
    const remaining = new Date(entry.PlannedEndAt).getTime() - Date.now();
    if (remaining <= 0) return;
    const reminderDelay = remaining - 5 * 60 * 1000;
    if (reminderDelay > 0) AppState.notificationTimers.push(window.setTimeout(() => sendWorkNotification('ACE shift reminder', 'Your scheduled clock-out is in five minutes.'), reminderDelay));
    AppState.notificationTimers.push(window.setTimeout(() => sendWorkNotification('ACE clocked you out', 'Your scheduled shift has ended and was automatically clocked out.'), remaining + 5000));
}

function clearSessionNotifications() {
    AppState.notificationTimers.forEach(timer => window.clearTimeout(timer));
    AppState.notificationTimers = [];
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
    const duration = Math.floor((now - AppState.clockInTime) / 1000);
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
    const duration = Math.floor((now - clockInTime) / 1000);
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
    
    const email = document.getElementById('inviteEmail').value;
    const departmentId = document.getElementById('inviteDepartment')?.value;
    const role = document.getElementById('inviteRole')?.value;
    
    try {
        const invitation = await window.ACEAuth.request('/v1/invitations', { method: 'POST', body: JSON.stringify({ email, departmentId: departmentId || null, role: role || 'USER' }) });
        AppState.invitations.unshift(invitation); closeModal('inviteUserModal'); document.getElementById('inviteUserForm').reset();
        showToast('Google account pre-authorized for ' + email, 'success');
    } catch (error) { showToast(error.message || 'Unable to send invitation', 'error'); }
}

async function handleGenerateReport(e) {
    e.preventDefault();
    
    const reportType = document.getElementById('reportType').value;
    const reportMonth = document.getElementById('reportMonth')?.value;
    const [reportYear, reportMonthIndex] = (reportMonth || '').split('-').map(Number);
    const lastDay = reportYear && reportMonthIndex ? new Date(reportYear, reportMonthIndex, 0).getDate() : null;
    const dateFrom = reportMonth ? `${reportMonth}-01` : document.getElementById('dateFrom')?.value;
    const dateTo = reportMonth ? `${reportMonth}-${String(lastDay).padStart(2, '0')}` : document.getElementById('dateTo')?.value;
    const departmentId = document.getElementById('reportDepartment')?.value;
    const projectId = document.getElementById('reportProject')?.value;
    const userId = document.getElementById('reportUser')?.value;
    
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
    } catch (error) { showToast(error.message || 'Unable to generate report', 'error'); }
}

function filterEntriesForReport(report) {
    const from = report.DateFrom ? new Date(`${report.DateFrom}T00:00:00`).getTime() : -Infinity;
    const to = report.DateTo ? new Date(`${report.DateTo}T23:59:59.999`).getTime() : Infinity;
    const filters = report.Filters || {};
    return AppState.timeEntries.filter(entry => {
        const time = new Date(entry.ClockInAt).getTime();
        const user = AppState.users.find(item => item.UserId === entry.UserId);
        return time >= from && time <= to &&
            (!filters.projectId || Number(filters.projectId) === Number(entry.ProjectId)) &&
            (!filters.userId || Number(filters.userId) === Number(entry.UserId)) &&
            (!filters.departmentId || Number(filters.departmentId) === Number(user?.DepartmentId));
    });
}

function ensureGeneratedReportModal() {
    let modal = document.getElementById('generatedReportModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'generatedReportModal';
    modal.className = 'modal generated-report-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'generatedReportModalTitle');
    modal.innerHTML = `<div class="modal-content"><div class="modal-header"><div><p class="eyebrow">REPORT PREVIEW</p><h3 class="modal-title" id="generatedReportModalTitle">Time tracking report</h3></div><button class="modal-close" type="button" aria-label="Close">${suppliedIconMarkup('x')}</button></div><div class="modal-body"><article class="printable-report" id="printableReport"></article><div class="report-preview-actions"><button class="btn btn-outline report-preview-close" type="button">${suppliedIconMarkup('x')}Close</button><button class="btn btn-primary" id="printGeneratedReportBtn" type="button">${suppliedIconMarkup('printer')}Save as PDF</button></div></div></div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll('.modal-close, .report-preview-close').forEach(button => button.addEventListener('click', () => closeModal('generatedReportModal')));
    modal.addEventListener('click', event => { if (event.target === modal) closeModal('generatedReportModal'); });
    modal.querySelector('#printGeneratedReportBtn').addEventListener('click', printGeneratedReport);
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
    const reportElement = modal.querySelector('#printableReport');
    const entries = filterEntriesForReport(report);
    const completed = entries.filter(entry => Number(entry.DurationSeconds) > 0);
    const totalSeconds = completed.reduce((sum, entry) => sum + Number(entry.DurationSeconds || 0), 0);
    const uniqueUsers = new Set(entries.map(entry => entry.UserId)).size;
    const dailyTotals = new Map();
    const projectTotals = new Map();
    completed.forEach(entry => {
        const date = new Date(entry.ClockInAt).toISOString().slice(0, 10);
        dailyTotals.set(date, (dailyTotals.get(date) || 0) + Number(entry.DurationSeconds || 0));
        const project = entry.ProjectId ? AppState.projects.find(item => item.ProjectId === entry.ProjectId) : null;
        const projectName = project?.ProjectName || 'Unassigned';
        projectTotals.set(projectName, (projectTotals.get(projectName) || 0) + Number(entry.DurationSeconds || 0));
    });
    const daily = [...dailyTotals.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const projects = [...projectTotals.entries()].sort((a, b) => b[1] - a[1]);
    const maxDaily = Math.max(...daily.map(([, seconds]) => seconds), 1);
    const maxProject = Math.max(...projects.map(([, seconds]) => seconds), 1);
    const creator = AppState.users.find(user => user.UserId === report.CreatedByUserId) || AppState.currentUser;
    const department = AppState.departments.find(item => Number(item.DepartmentId) === Number(report.Filters?.departmentId));
    const projectFilter = AppState.projects.find(item => Number(item.ProjectId) === Number(report.Filters?.projectId));
    const userFilter = AppState.users.find(item => Number(item.UserId) === Number(report.Filters?.userId));
    const filterSummary = [department?.DepartmentName, projectFilter?.ProjectName, userFilter?.FullName].filter(Boolean).join(' · ') || 'All departments, projects, and users';
    const reportTeam = AppState.users.filter(user => user.Role === 'USER' && user.Status === 'ACTIVE' && (!report.Filters?.departmentId || Number(user.DepartmentId) === Number(report.Filters.departmentId)) && (!report.Filters?.userId || Number(user.UserId) === Number(report.Filters.userId)));
    const clockedInIds = new Set(AppState.timeEntries.filter(entry => !entry.ClockOutAt).map(entry => Number(entry.UserId)));
    const clockedIn = reportTeam.filter(user => clockedInIds.has(Number(user.UserId))).length;
    const available = Math.max(reportTeam.length - clockedIn, 0);
    const pending = AppState.users.filter(user => user.Status === 'PENDING' && (!report.Filters?.departmentId || Number(user.DepartmentId) === Number(report.Filters.departmentId))).length;
    const teamStatus = [['Clocked in', clockedIn, 'is-active'], ['Available', available, ''], ['Pending approval', pending, '']];
    const teamTotal = Math.max(clockedIn + available + pending, 1);
    const teamActivityChart = `<div class="print-team-activity"><div class="print-team-ring" style="--team-ratio:${Math.round(clockedIn / Math.max(reportTeam.length, 1) * 100)}"><strong>${clockedIn}</strong><span>clocked in</span></div><div class="print-team-status">${teamStatus.map(([label, count, active]) => `<div><span><i class="${active}"></i>${label}</span><b>${count}</b><em style="width:${Math.round(count / teamTotal * 100)}%"></em></div>`).join('')}</div></div>`;
    reportElement.innerHTML = `<header class="print-report-header"><div><span>ACE OUTSOURCE SOLUTIONS</span><h1>${report.ReportType || 'CUSTOM'} TIME REPORT</h1><p>${report.DateFrom || 'Beginning'} — ${report.DateTo || 'Today'}</p></div><img src="assets/images/ace-logo-hd-cropped.png" alt="ACE Outsource Solutions"></header><section class="print-report-meta"><div><span>Generated by</span><strong>${creator?.FullName || 'ACE Administrator'}</strong></div><div><span>Generated</span><strong>${new Date(report.GeneratedAt).toLocaleString()}</strong></div><div><span>Filters</span><strong>${filterSummary}</strong></div></section><section class="print-report-stats"><div><span>Total tracked</span><strong>${formatDuration(totalSeconds)}</strong></div><div><span>Time entries</span><strong>${entries.length}</strong></div><div><span>Team members</span><strong>${uniqueUsers}</strong></div><div><span>Average entry</span><strong>${completed.length ? formatDuration(Math.round(totalSeconds / completed.length)) : '0h 0m'}</strong></div></section><section class="print-report-charts"><div class="print-chart-panel"><h2>Tracked hours by day</h2><div class="print-daily-chart">${daily.length ? daily.map(([date, seconds]) => `<div class="print-day-column"><span class="print-day-value">${formatDuration(seconds)}</span><div class="print-day-bar" style="height:${Math.max(5, Math.round(seconds / maxDaily * 100))}%"></div><small>${new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</small></div>`).join('') : '<p class="analytics-empty">No completed entries in this range.</p>'}</div></div><div class="print-chart-panel"><h2>Hours by project</h2><div class="print-project-chart">${projects.length ? projects.map(([name, seconds]) => `<div class="print-project-row"><span>${name}</span><div><i style="width:${Math.max(4, Math.round(seconds / maxProject * 100))}%"></i></div><strong>${formatDuration(seconds)}</strong></div>`).join('') : '<p class="analytics-empty">No project activity in this range.</p>'}</div></div><div class="print-chart-panel print-team-chart"><h2>Team activity</h2>${teamActivityChart}</div></section><section class="print-report-table"><h2>Time entry details</h2><table><thead><tr><th>Employee</th><th>Project</th><th>Clock in</th><th>Clock out</th><th>Duration</th></tr></thead><tbody>${entries.length ? entries.map(entry => { const user = AppState.users.find(item => item.UserId === entry.UserId); const project = AppState.projects.find(item => item.ProjectId === entry.ProjectId); return `<tr><td>${user?.FullName || 'Unknown'}</td><td>${project?.ProjectName || 'Unassigned'}</td><td>${new Date(entry.ClockInAt).toLocaleString()}</td><td>${entry.ClockOutAt ? new Date(entry.ClockOutAt).toLocaleString() : 'Active'}</td><td>${entry.DurationSeconds ? formatDuration(entry.DurationSeconds) : 'Active'}</td></tr>`; }).join('') : '<tr><td colspan="5">No entries match this report.</td></tr>'}</tbody></table></section><footer class="print-report-footer"><span>Internal company report</span><span>Report #${report.ReportId}</span></footer>`;
    if (!options.printOnly) openModal('generatedReportModal');
}

// Settings Handlers
function handleProfileUpdate(e) {
    e.preventDefault();
    const fullName = document.getElementById('fullName')?.value.trim();
    if (fullName && AppState.currentUser) {
        AppState.currentUser.FullName = fullName;
        localStorage.setItem('ace_current_user', JSON.stringify(AppState.currentUser));
        document.querySelectorAll('#userName, .shell-user strong').forEach(node => { node.textContent = fullName; });
    }
    showToast('Profile updated successfully', 'success');
}

function handleNotificationUpdate(e) {
    e.preventDefault();
    const preferences = {};
    e.currentTarget.querySelectorAll('input[type="checkbox"]').forEach(input => { preferences[input.id] = input.checked; });
    localStorage.setItem('ace_notification_preferences', JSON.stringify(preferences));
    showToast('Notification preferences saved', 'success');
}

async function handleSecurityUpdate(e) {
    e.preventDefault();
    const current = document.getElementById('currentPassword')?.value || '';
    const next = document.getElementById('newPassword')?.value || '';
    const confirm = document.getElementById('confirmPassword')?.value || '';
    if (!next && !confirm) {
        showToast('Enter a new password to save password changes.', 'warning');
        return;
    }
    if (next !== confirm) {
        showToast('New passwords do not match.', 'error');
        return;
    }
    if (next && next.length < 6) {
        showToast('Use at least 6 characters for the new password.', 'warning');
        return;
    }
    try {
        const auth = await window.ACEAuth.client();
        const update = { password: next };
        if (current) update.current_password = current;
        const { error } = await auth.auth.updateUser(update);
        if (error) throw error;
        e.currentTarget.reset();
        showToast('Password saved. You can now sign in with your email and password.', 'success');
    } catch (error) {
        showToast(error.message || 'Could not update your password.', 'error');
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
            if (statusText) statusText.textContent = 'Clocked In';
        } else {
            statusDot?.classList.remove('active');
            if (statusText) statusText.textContent = 'Not Clocked In';
        }
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
            const sessionNote = document.getElementById('sessionNote');
            
            if (sessionClockInTime && AppState.clockInTime) {
                sessionClockInTime.textContent = AppState.clockInTime.toLocaleTimeString();
            }
            if (sessionProject && AppState.currentSession?.ProjectId) {
                const project = AppState.projects.find(p => p.ProjectId === AppState.currentSession.ProjectId);
                sessionProject.textContent = project ? project.ProjectName : 'None';
            }
            if (sessionNote && AppState.currentSession?.UserNote) {
                sessionNote.textContent = AppState.currentSession.UserNote;
            }
        } else {
            currentSessionCard.style.display = 'none';
        }
    }
    
    // Update clocked in time
    const clockedInAt = document.getElementById('clockedInAt');
    if (clockedInAt && AppState.clockInTime) {
        clockedInAt.textContent = AppState.clockInTime.toLocaleTimeString();
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
    }
    
    // Time Entries
    if (page === 'time-entries.html') {
        loadTimeEntries();
    }
    
    // Reports
    if (page === 'reports.html') {
        loadReportsList();
    }
    
    // Settings
    if (page === 'settings.html') {
        loadUserSettings();
    }
}

function loadUserDashboard() {
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
        monthHours: formatDuration(monthSeconds),
        totalEntries: userEntriesForStats.length
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
            <button class="project-card project-card-action" type="button" data-project-id="${project.ProjectId}" aria-label="View ${project.ProjectName} details">
                <h3>${project.ProjectName}</h3>
                <p>${project.Description || 'No description'}</p>
            </button>
        `).join('') : emptyState('No projects assigned', 'Project assignment is optional. Your administrator can add you to a project when needed.');
        myProjects.querySelectorAll('.project-card-action').forEach(card => {
            card.addEventListener('click', () => viewProject(Number(card.dataset.projectId)));
        });
    }
    
    // Populate recent activity
    const recentActivity = document.getElementById('recentActivity');
    if (recentActivity) {
        const userEntries = AppState.timeEntries.filter(te => te.UserId === AppState.currentUser?.UserId).slice(0, 5);
        
        recentActivity.innerHTML = userEntries.length ? userEntries.map(entry => {
            const clockIn = new Date(entry.ClockInAt);
            const clockOut = entry.ClockOutAt ? new Date(entry.ClockOutAt) : null;
            const duration = entry.DurationSeconds ? formatDuration(entry.DurationSeconds) : 'Active';
            
            return `
                <div class="activity-item">
                    <div class="activity-date">
                        <strong>${clockIn.toLocaleDateString()}</strong>
                    </div>
                    <div class="activity-time">
                        ${clockIn.toLocaleTimeString()} - ${clockOut ? clockOut.toLocaleTimeString() : 'Now'}
                    </div>
                    <div class="activity-duration">
                        ${duration}
                    </div>
                </div>
            `;
        }).join('') : emptyState('No activity yet', 'Clock in when you are ready to begin your first tracked work session.', 'Clock in', '#');
    }
    
    // Populate admin remarks
    const recentRemarks = document.getElementById('recentRemarks');
    if (recentRemarks) {
        const userEntries = AppState.timeEntries.filter(te => te.UserId === AppState.currentUser?.UserId);
        const entryIds = userEntries.map(te => te.TimeEntryId);
        const remarks = AppState.adminRemarks.filter(ar => entryIds.includes(ar.TimeEntryId)).slice(0, 5);
        
        recentRemarks.innerHTML = remarks.length ? remarks.map(remark => {
            const admin = AppState.users.find(u => u.UserId === remark.AdminUserId);
            return `
                <div class="remark-item">
                    <strong>${admin?.FullName || 'Admin'}</strong>
                    <p>${remark.Remark}</p>
                    <small>${new Date(remark.CreatedAt).toLocaleString()}</small>
                </div>
            `;
        }).join('') : emptyState('No admin remarks', 'Remarks from administrators will appear here when they add context to one of your entries.');
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
    const visibleMonth = new Date(Number(mount.dataset.year || new Date().getFullYear()), Number(mount.dataset.month || new Date().getMonth()), 1);
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const calendar = month => {
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
        return `<section class="analytics-calendar-month" aria-label="${month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}"><h3>${month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h3><div class="analytics-calendar-weekdays">${weekdays.map(day => `<span>${day}</span>`).join('')}</div><div class="analytics-calendar-days">${cells}</div></section>`;
    };
    mount.innerHTML = calendar(visibleMonth) + calendar(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1));
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
    mount.dataset.year = String(current.getFullYear());
    mount.dataset.month = String(current.getMonth());
    document.getElementById('analyticsCalendarPrevious')?.addEventListener('click', () => {
        const month = new Date(Number(mount.dataset.year), Number(mount.dataset.month) - 1, 1);
        mount.dataset.year = String(month.getFullYear()); mount.dataset.month = String(month.getMonth());
        renderAnalyticsRangeCalendars();
    });
    document.getElementById('analyticsCalendarNext')?.addEventListener('click', () => {
        const month = new Date(Number(mount.dataset.year), Number(mount.dataset.month) + 1, 1);
        mount.dataset.year = String(month.getFullYear()); mount.dataset.month = String(month.getMonth());
        renderAnalyticsRangeCalendars();
    });
    renderAnalyticsRangeCalendars();
}

function getAdminAnalyticsFilters(fallbackDays = 7) {
    const range = document.getElementById('dashboardRange');
    const dateFromInput = document.getElementById('analyticsDateFrom');
    const dateToInput = document.getElementById('analyticsDateTo');
    const selectedRange = range?.value || String(fallbackDays);
    const completed = AppState.timeEntries.filter(entry => Number(entry.DurationSeconds) > 0);
    const latestTimestamp = completed.length ? Math.max(...completed.map(entry => new Date(entry.ClockInAt).getTime())) : Date.now();
    const periodEnd = new Date(latestTimestamp);
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
    return Number(byId?.UserId || byName?.UserId || 0);
}

async function generateAdminAnalyticsReport() {
    const projectFilter = document.getElementById('analyticsProject');
    const departmentFilter = document.getElementById('analyticsDepartment');
    const range = document.getElementById('dashboardRange');
    const from = document.getElementById('analyticsDateFrom')?.value;
    const to = document.getElementById('analyticsDateTo')?.value;
    if (range?.value === 'custom' && (!from || !to || to < from)) {
        showToast('Choose a valid start and end date before generating the report.', 'warning');
        return;
    }
    const filters = getAdminAnalyticsFilters();
    try {
        const saved = await window.ACEAuth.request('/v1/reports', { method: 'POST', body: JSON.stringify({ reportType: 'TEAM_PERFORMANCE', dateFrom: toAnalyticsDateValue(filters.periodStart), dateTo: toAnalyticsDateValue(filters.periodEnd), filters: { departmentId: departmentFilter?.value || null, projectId: projectFilter?.value || null, userId: getAnalyticsEmployeeId() || null } }) });
        const report = reportRecord(saved);
        AppState.reports.unshift(report);
        renderGeneratedReport(report, { printOnly: true });
        showToast('Your A4 report is ready. Choose “Save as PDF” in the print dialog.', 'success');
        window.setTimeout(printGeneratedReport, 250);
    } catch (error) { showToast(error.message || 'Unable to generate report', 'error'); }
}

function renderAdminAnalytics(days = 7) {
    const hoursChart = document.getElementById('hoursChart');
    const projectChart = document.getElementById('projectAllocationChart');
    const teamChart = document.getElementById('teamActivityChart');
    if (!hoursChart || !projectChart || !teamChart) return;
    initializeAnalyticsRangePicker();

    const projectFilter = document.getElementById('analyticsProject');
    const departmentFilter = document.getElementById('analyticsDepartment');
    const employeeFilter = document.getElementById('analyticsEmployee');
    if (projectFilter && !projectFilter.dataset.bound) {
        AppState.projects.filter(project => project.IsActive).forEach(project => {
            const option = document.createElement('option');
            option.value = String(project.ProjectId);
            option.textContent = project.ProjectName;
            projectFilter.appendChild(option);
        });
        projectFilter.dataset.bound = 'true';
        projectFilter.addEventListener('change', () => renderAdminAnalytics(days));
    }
    if (departmentFilter && !departmentFilter.dataset.bound) {
        AppState.departments.forEach(department => {
            const option = document.createElement('option');
            option.value = String(department.DepartmentId);
            option.textContent = department.DepartmentName;
            departmentFilter.appendChild(option);
        });
        departmentFilter.dataset.bound = 'true';
        departmentFilter.addEventListener('change', () => renderAdminAnalytics(days));
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
    const selectedProjectId = Number(projectFilter?.value || 0);
    const selectedDepartmentId = Number(departmentFilter?.value || 0);
    const selectedEmployeeId = getAnalyticsEmployeeId();
    const completed = AppState.timeEntries.filter(entry => Number(entry.DurationSeconds) > 0);
    const { periodStart, periodEnd, days: selectedDays } = getAdminAnalyticsFilters(days);
    const inPeriod = completed.filter(entry => {
        const time = new Date(entry.ClockInAt).getTime();
        const user = AppState.users.find(item => Number(item.UserId) === Number(entry.UserId));
        return time >= periodStart.getTime() && time <= periodEnd.getTime() &&
            (!selectedProjectId || Number(entry.ProjectId) === selectedProjectId) &&
            (!selectedDepartmentId || Number(user?.DepartmentId) === selectedDepartmentId) &&
            (!selectedEmployeeId || Number(entry.UserId) === selectedEmployeeId);
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
    const selectedProject = AppState.projects.find(project => Number(project.ProjectId) === selectedProjectId);
    const selectedDepartment = AppState.departments.find(department => Number(department.DepartmentId) === selectedDepartmentId);
    const selectedEmployee = AppState.users.find(user => Number(user.UserId) === selectedEmployeeId);
    const analyticsDetail = document.getElementById('analyticsDetail');
    if (analyticsDetail) analyticsDetail.textContent = [selectedProject?.ProjectName, selectedDepartment?.DepartmentName, selectedEmployee?.FullName].filter(Boolean).join(' · ') || 'Across all projects, departments, and employees';
    hoursChart.setAttribute('aria-label', `Tracked hours from ${toAnalyticsDateValue(periodStart)} to ${toAnalyticsDateValue(periodEnd)}: ${formatDuration(totalSeconds)}`);
    hoursChart.innerHTML = buckets.map(bucket => {
        const height = bucket.seconds ? Math.max(5, Math.round(bucket.seconds / maxSeconds * 100)) : 2;
        const label = selectedDays <= 7
            ? bucket.start.toLocaleDateString('en-US', { weekday: 'short' })
            : bucket.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `<div class="chart-column" title="${label}: ${formatDuration(bucket.seconds)}"><div class="chart-column-track"><div class="chart-column-bar" style="height:${height}%"></div></div><span class="chart-column-label">${label}</span><span class="chart-column-value">${formatDuration(bucket.seconds)}</span></div>`;
    }).join('');

    const projectTotals = new Map();
    inPeriod.forEach(entry => {
        const project = entry.ProjectId ? AppState.projects.find(item => item.ProjectId === entry.ProjectId) : null;
        const name = project?.ProjectName || 'Unassigned';
        projectTotals.set(name, (projectTotals.get(name) || 0) + Number(entry.DurationSeconds || 0));
    });
    const projects = [...projectTotals.entries()].sort((a, b) => b[1] - a[1]);
    const largestProject = Math.max(...projects.map(([, seconds]) => seconds), 1);
    projectChart.innerHTML = projects.length ? projects.map(([name, seconds]) => `<div class="allocation-row"><span class="allocation-name" title="${name}">${name}</span><div class="allocation-track" aria-hidden="true"><div class="allocation-fill" style="width:${Math.max(4, Math.round(seconds / largestProject * 100))}%"></div></div><span class="allocation-hours">${formatDuration(seconds)}</span></div>`).join('') : '<div class="analytics-empty">No tracked project hours in this period.</div>';

    const activeTeam = AppState.users.filter(user => user.Role === 'USER' && user.Status === 'ACTIVE' && (!selectedDepartmentId || Number(user.DepartmentId) === selectedDepartmentId) && (!selectedEmployeeId || Number(user.UserId) === selectedEmployeeId));
    const clockedInIds = new Set(AppState.timeEntries.filter(entry => !entry.ClockOutAt).map(entry => entry.UserId));
    const clockedIn = activeTeam.filter(user => clockedInIds.has(user.UserId)).length;
    const available = Math.max(activeTeam.length - clockedIn, 0);
    const pending = AppState.users.filter(user => user.Status === 'PENDING').length;
    const circumference = 2 * Math.PI * 48;
    const ratio = activeTeam.length ? clockedIn / activeTeam.length : 0;
    teamChart.innerHTML = `<div class="team-ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="team-ring-track" cx="60" cy="60" r="48"></circle><circle class="team-ring-value" cx="60" cy="60" r="48" stroke-dasharray="${circumference}" stroke-dashoffset="${circumference * (1 - ratio)}"></circle></svg><div class="team-ring-label"><strong>${clockedIn}</strong><span>clocked in</span></div></div><div class="team-status-list"><div class="team-status-row"><span class="team-status-name"><i class="team-status-dot"></i>Clocked in</span><strong>${clockedIn}</strong></div><div class="team-status-row"><span class="team-status-name"><i class="team-status-dot is-muted"></i>Available</span><strong>${available}</strong></div><div class="team-status-row"><span class="team-status-name"><i class="team-status-dot is-muted"></i>Pending approval</span><strong>${pending}</strong></div></div>`;

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

function loadAdminDashboard() {
    // Update stats
    const totalUsers = document.getElementById('totalUsers');
    if (totalUsers) totalUsers.textContent = AppState.users.length;
    
    const activeUsers = document.getElementById('activeUsers');
    if (activeUsers) activeUsers.textContent = AppState.users.filter(u => u.Status === 'ACTIVE').length;
    
    const todayEntries = document.getElementById('todayEntries');
    if (todayEntries) {
        const today = new Date().toDateString();
        todayEntries.textContent = AppState.timeEntries.filter(te => new Date(te.ClockInAt).toDateString() === today).length;
    }
    
    const pendingApprovals = document.getElementById('pendingApprovals');
    if (pendingApprovals) pendingApprovals.textContent = AppState.users.filter(u => u.Status === 'PENDING').length;

    renderAdminAnalytics(Number(document.getElementById('dashboardRange')?.value || 7));
    
    // Populate recent time entries
    const recentTimeEntries = document.getElementById('recentTimeEntries');
    if (recentTimeEntries) {
        const entries = AppState.timeEntries.slice(0, 10);
        
        recentTimeEntries.innerHTML = entries.length ? entries.map(entry => {
            const user = AppState.users.find(u => u.UserId === entry.UserId);
            const project = entry.ProjectId ? AppState.projects.find(p => p.ProjectId === entry.ProjectId) : null;
            const clockIn = new Date(entry.ClockInAt);
            const clockOut = entry.ClockOutAt ? new Date(entry.ClockOutAt) : null;
            const duration = entry.DurationSeconds ? formatDuration(entry.DurationSeconds) : 'Active';
            
            return `
                <tr>
                    <td>${user?.FullName || 'Unknown'}</td>
                    <td>${project?.ProjectName || 'None'}</td>
                    <td>${clockIn.toLocaleTimeString()}</td>
                    <td>${clockOut ? clockOut.toLocaleTimeString() : 'Active'}</td>
                    <td>${duration}</td>
                    <td><span class="badge ${clockOut ? 'badge-success' : 'badge-warning'}">${clockOut ? 'Completed' : 'Active'}</span></td>
                    <td>
                        <button class="btn btn-sm btn-outline" onclick="viewTimeEntry('${entry.TimeEntryId}')">View</button>
                    </td>
                </tr>
            `;
        }).join('') : `<tr><td colspan="7">${emptyState('No time entries', 'Completed and active sessions will appear here.')}</td></tr>`;
    }
    
    // Populate pending users
    const pendingUsers = document.getElementById('pendingUsers');
    if (pendingUsers) {
        const pending = AppState.users.filter(u => u.Status === 'PENDING');
        
        pendingUsers.innerHTML = pending.length ? pending.map(user => {
            return `
                <tr>
                    <td>${user.FullName}</td>
                    <td>${user.Email}</td>
                    <td>${AppState.departments.find(d => d.DepartmentId === user.DepartmentId)?.DepartmentName || 'None'}</td>
                    <td>${new Date(user.CreatedAt).toLocaleDateString()}</td>
                    <td>
                        <button class="btn btn-sm btn-primary" onclick="approveUser(${user.UserId})">Approve</button>
                        <button class="btn btn-sm btn-danger" onclick="denyUser(${user.UserId})">Deny</button>
                    </td>
                </tr>
            `;
        }).join('') : `<tr><td colspan="5">${emptyState('All caught up', 'There are no pending user approvals right now.')}</td></tr>`;
    }
}

function loadTimeEntries() {
    const filterProject = document.getElementById('filterProject');
    if (filterProject) {
        const assignedIds = new Set(AppState.userProjects.filter(item => item.UserId === AppState.currentUser?.UserId && item.IsActive).map(item => item.ProjectId));
        const assignedProjects = AppState.projects.filter(project => assignedIds.has(project.ProjectId) && project.IsActive !== false);
        filterProject.innerHTML = '<option value="">All projects</option>' + assignedProjects.map(project => `<option value="${project.ProjectId}">${project.ProjectName}</option>`).join('');
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
                <tr data-date="${clockIn.toISOString().slice(0, 10)}" data-project="${entry.ProjectId || ''}" data-status="${clockOut ? 'COMPLETED' : 'ACTIVE'}">
                    <td>${clockIn.toLocaleDateString()}</td>
                    <td>${clockIn.toLocaleTimeString()}</td>
                    <td>${clockOut ? clockOut.toLocaleTimeString() : 'Active'}</td>
                    <td>${duration}</td>
                    <td>${project?.ProjectName || 'None'}</td>
                    <td>${entry.UserNote || 'No note'}</td>
                    <td><span class="badge ${clockOut ? 'badge-success' : 'badge-warning'}">${clockOut ? 'Completed' : 'Active'}</span></td>
                    <td>${remarks.length > 0 ? `${remarks.length} remark(s)` : 'None'}</td>
                    <td>
                        <button class="btn btn-sm btn-outline" onclick="viewTimeEntry('${entry.TimeEntryId}')">View</button>
                    </td>
                </tr>
            `;
        }).join('') : `<tr><td colspan="9">${emptyState('No time entries found', 'Your tracked sessions will appear here. Start by clocking in.', 'Clock in', '#')}</td></tr>`;
    }
}

function loadReportsList() {
    const reportsList = document.getElementById('reportsList');
    if (reportsList) {
        reportsList.innerHTML = AppState.reports.map(report => {
            const user = AppState.users.find(u => u.UserId === report.CreatedByUserId);
            return `
                <tr data-type="${report.ReportType}" data-from="${report.DateFrom}" data-to="${report.DateTo}" data-user="${report.CreatedByUserId}" data-department="${report.Filters?.departmentId || ''}" data-project="${report.Filters?.projectId || ''}">
                    <td>${report.ReportId}</td>
                    <td>${report.ReportType}</td>
                    <td>${report.DateFrom} to ${report.DateTo}</td>
                    <td>${user?.FullName || 'Unknown'}</td>
                    <td>${new Date(report.GeneratedAt).toLocaleString()}</td>
                    <td>${report.TotalRecords}</td>
                    <td>
                        <button class="btn btn-sm btn-primary" onclick="exportReport('${report.ReportId}', 'PDF')">Save PDF</button>
                        <button class="btn btn-sm btn-danger" onclick="deleteReport('${report.ReportId}')">Delete</button>
                    </td>
                </tr>
            `;
        }).join('');
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
            AppState.departments.map(d => `<option value="${d.DepartmentId}">${d.DepartmentName}</option>`).join('');
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
        select.innerHTML = `<option value="">${placeholder}</option>` + projects.map(p => `<option value="${p.ProjectId}">${p.ProjectName}</option>`).join('');
    }
}

function populateUserSelect(selectId) {
    const select = document.getElementById(selectId);
    if (select) {
        select.innerHTML = '<option value="">All Users</option>' + 
            AppState.users.map(u => `<option value="${u.UserId}">${u.FullName}</option>`).join('');
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

function clearFilters() {
    const filterInputs = document.querySelectorAll('.filters-section input, .filters-section select');
    filterInputs.forEach(input => {
        input.value = '';
    });
    showToast('Filters cleared', 'info');
    document.querySelectorAll('#reportsList tr, #timeEntriesList tr').forEach(row => { row.hidden = false; });
}

// Global functions for onclick handlers
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
                    <p><strong>User:</strong> ${user?.FullName || 'Unknown'}</p>
                    <p><strong>Project:</strong> ${project?.ProjectName || 'None'}</p>
                    <p><strong>Clock In:</strong> ${new Date(entry.ClockInAt).toLocaleString()}</p>
                    <p><strong>Clock Out:</strong> ${entry.ClockOutAt ? new Date(entry.ClockOutAt).toLocaleString() : 'Active'}</p>
                    <p><strong>Duration:</strong> ${entry.DurationSeconds ? formatDuration(entry.DurationSeconds) : 'Active'}</p>
                    <p><strong>Note:</strong> ${entry.UserNote || 'No note'}</p>
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
                        <strong>${admin?.FullName || 'Admin'}</strong>
                        <p>${remark.Remark}</p>
                        <small>${new Date(remark.CreatedAt).toLocaleString()}</small>
                    </div>
                `;
            }).join('') || '<p>No admin remarks</p>';
        }
        
        openModal('entryDetailsModal');
    }
}

async function approveUser(userId) {
    try {
        const saved = await window.ACEAuth.request(`/v1/users/${userId}/approval`, { method: 'PATCH', body: JSON.stringify({ status: 'ACTIVE' }) });
        const user = profileRecord(saved);
        AppState.users = AppState.users.map(item => item.UserId === user.UserId ? user : item);
        showToast(`${user.FullName} approved`, 'success'); loadAdminDashboard();
    } catch (error) { showToast(error.message || 'Unable to approve user', 'error'); }
}

async function denyUser(userId) {
    try {
        const saved = await window.ACEAuth.request(`/v1/users/${userId}/approval`, { method: 'PATCH', body: JSON.stringify({ status: 'DENIED' }) });
        const user = profileRecord(saved);
        AppState.users = AppState.users.map(item => item.UserId === user.UserId ? user : item);
        showToast(`${user.FullName} denied`, 'success'); loadAdminDashboard();
    } catch (error) { showToast(error.message || 'Unable to deny user', 'error'); }
}

function viewReport(reportId) {
    const report = AppState.reports.find(r => r.ReportId === reportId);
    if (report) renderGeneratedReport(report);
}

async function deleteReport(reportId) {
    const report = AppState.reports.find(item => item.ReportId === reportId);
    if (!report || !window.confirm('Delete this generated report from the ACE report library? This cannot be undone.')) return;
    try {
        await window.ACEAuth.request(`/v1/reports/${reportId}`, { method: 'DELETE' });
        AppState.reports = AppState.reports.filter(item => item.ReportId !== reportId);
        loadReportsList();
        showToast('Generated report deleted.', 'success');
    } catch (error) {
        showToast(error.message || 'Could not delete the generated report.', 'error');
    }
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
    showToast(`${fileType} export is ready in the interface and will generate the final file when the Node.js backend is connected.`, 'info');
}

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
        <div class="toast-message"><strong>${labels[type] || labels.info}</strong><span>${message}</span></div>
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
        <p><strong>Project</strong>${project.ProjectName}</p>
        <p><strong>Status</strong>${project.IsActive ? 'Active' : 'Inactive'}</p>
        <p><strong>Assigned</strong>${assignment ? new Date(assignment.AssignedAt).toLocaleDateString() : 'Not assigned'}</p>
        <p><strong>Tracked time</strong>${formatDuration(seconds)}</p>
        <p class="detail-wide"><strong>Description</strong>${project.Description || 'No description provided.'}</p>`;
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

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp, { once: true });
} else {
    startApp();
}
