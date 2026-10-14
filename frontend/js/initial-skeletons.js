// Paint the correct page-shaped placeholder before app/auth scripts begin loading.
window.ACERenderInitialSkeletons = function renderAceInitialSkeleton() {
  const shell = document.querySelector('.app-shell-skeleton');
  if (!shell) return;

  const route = (location.pathname.split('/').pop() || '').toLowerCase();
  const page = route && !route.includes('.') ? `${route}.html` : route;
  const rows = (count, className = '') => Array.from({ length: count }, () => `<div class="shell-skeleton-row ${className}"></div>`).join('');
  const lines = (count = 2, className = '') => Array.from({ length: count }, () => `<i class="shell-skeleton-line ${className}"></i>`).join('');
  const intro = `<header class="shell-skeleton-intro"><i class="shell-skeleton-kicker"></i><i class="shell-skeleton-title"></i><i class="shell-skeleton-subtitle"></i></header>`;
  const panel = (content, className = '') => `<section class="shell-skeleton-panel ${className}">${content}</section>`;
  const cards = (count, className = '') => `<div class="shell-skeleton-cards ${className}">${Array.from({ length: count }, () => `<div class="shell-skeleton-card">${lines(2)}</div>`).join('')}</div>`;
  const table = (count = 6) => panel(`<div class="shell-skeleton-table-toolbar"><i class="shell-skeleton-panel-title"></i><i class="shell-skeleton-control"></i></div><div class="shell-skeleton-table-head">${lines(5)}</div>${rows(count, 'is-table-row')}`, 'is-table');
  let content;

  if (page === 'admin-dashboard.html') {
    content = `${intro}${panel(`<div class="shell-skeleton-quick-copy">${lines(3)}</div><div class="shell-skeleton-quick-actions">${lines(4)}</div>`, 'is-quick-actions')}${cards(3, 'is-admin-stats')}<div class="shell-skeleton-section-title">${lines(2)}</div><div class="shell-skeleton-dashboard-grid">${panel(`<div class="shell-skeleton-panel-heading">${lines(2)}</div><div class="shell-skeleton-chart"></div>`, 'is-chart')}${panel(`<div class="shell-skeleton-panel-heading">${lines(2)}</div>${rows(5)}`, 'is-allocation')}</div>`;
  } else if (page === 'user-dashboard.html') {
    content = `${intro}${panel(lines(1), 'is-notice')}<div class="shell-skeleton-dashboard-grid is-employee-hero">${panel(`<div class="shell-skeleton-status-copy">${lines(4)}</div><div class="shell-skeleton-status-meta">${lines(3)}</div><i class="shell-skeleton-control"></i>`, 'is-clock-card')}${panel(`<div class="shell-skeleton-panel-heading">${lines(2)}</div>${lines(3)}<div class="shell-skeleton-chart"></div>`, 'is-week-card')}</div><div class="shell-skeleton-dashboard-grid is-employee-lower">${panel(`<div class="shell-skeleton-panel-heading">${lines(2)}</div>${rows(2)}<i class="shell-skeleton-control"></i>`, 'is-activity')}${panel(`<div class="shell-skeleton-panel-heading">${lines(2)}</div>${rows(1)}`, 'is-projects')}</div><div class="shell-skeleton-dashboard-grid is-employee-bottom">${panel(`<div class="shell-skeleton-panel-heading">${lines(2)}</div>${rows(3)}`, 'is-shortcuts')}${panel(`<div class="shell-skeleton-panel-heading">${lines(2)}</div><div class="shell-skeleton-empty"></div>`, 'is-remarks')}</div>`;
  } else if (page === 'time-entries.html') {
    content = `${intro}${panel(`<div class="shell-skeleton-panel-heading">${lines(1)}</div><div class="shell-skeleton-filter-row">${lines(4, 'is-control')}</div><div class="shell-skeleton-filter-actions">${lines(2, 'is-control')}</div>`, 'is-filter-panel')}${cards(3, 'is-employee-stats')}${table(5)}`;
  } else if (page === 'remarks.html') {
    content = `${intro}${panel(`<div class="shell-skeleton-panel-heading">${lines(2)}</div>${rows(3)}`, 'is-remark-list')}`;
  } else if (page === 'settings.html') {
    content = `${intro}<div class="shell-skeleton-settings-grid">${panel(rows(5), 'is-settings-nav')}${panel(`<div class="shell-skeleton-panel-heading">${lines(2)}</div>${rows(5)}<i class="shell-skeleton-control"></i>`, 'is-settings-form')}</div>`;
  } else if (page === 'reports.html') {
    content = `${intro}${panel(`<div class="shell-skeleton-filter-row">${lines(4, 'is-control')}</div>`, 'is-filter-panel')}${cards(3, 'is-report-stats')}<div class="shell-skeleton-dashboard-grid">${panel(`<div class="shell-skeleton-panel-heading">${lines(2)}</div><div class="shell-skeleton-chart"></div>`, 'is-chart')}${panel(`<div class="shell-skeleton-panel-heading">${lines(2)}</div>${rows(5)}`, 'is-allocation')}</div>`;
  } else if (page === 'individual-reports.html') {
    content = `${intro}${panel(`<div class="shell-skeleton-panel-heading">${lines(1)}</div><div class="shell-skeleton-form-grid">${lines(5, 'is-control')}</div><i class="shell-skeleton-control"></i>`, 'is-form-panel')}${table(4)}`;
  } else if (page === 'schedule-flex.html') {
    content = `${intro}<div class="shell-skeleton-settings-grid">${panel(`<div class="shell-skeleton-panel-heading">${lines(2)}</div><div class="shell-skeleton-form-grid">${lines(6, 'is-control')}</div><i class="shell-skeleton-control"></i>`, 'is-form-panel')}${panel(`<div class="shell-skeleton-panel-heading">${lines(2)}</div><div class="shell-skeleton-form-grid">${lines(3, 'is-control')}</div><i class="shell-skeleton-control"></i>`, 'is-form-panel')}</div>${table(4)}`;
  } else if (page === 'chat-log.html') {
    content = `${intro}${panel(`<div class="shell-skeleton-chat-layout"><aside>${rows(6)}</aside><div>${rows(7)}</div></div>`, 'is-chat')}`;
  } else if (page === 'time-entry-details.html') {
    content = `${intro}${cards(5, 'is-detail-stats')}${panel(`<div class="shell-skeleton-panel-heading">${lines(2)}</div>${rows(2)}`, 'is-detail-notes')}${panel(`<div class="shell-skeleton-panel-heading">${lines(2)}</div>${rows(3)}<div class="shell-skeleton-form-grid">${lines(2, 'is-control')}</div>`, 'is-detail-remarks')}`;
  } else if (page === 'employee-profile.html') {
    content = `${intro}${panel(`<div class="shell-skeleton-profile-heading">${lines(2)}</div>${cards(3, 'is-profile-stats')}`, 'is-profile-card')}${panel(`<div class="shell-skeleton-panel-heading">${lines(2)}</div>${rows(4)}`, 'is-profile-details')}`;
  } else if (page === 'deleted-users.html' || page === 'deleted-time-entries.html') {
    content = `${intro}${table(4)}`;
  } else if (['users.html', 'invitations.html', 'departments.html', 'projects.html', 'schedule-flex.html', 'admin-time-entries.html', 'audit-logs.html'].includes(page)) {
    content = `${intro}${cards(3, 'is-admin-stats')}${table(6)}`;
  } else {
    content = `${intro}${table(5)}`;
  }

  shell.innerHTML = `<main class="shell-skeleton-main shell-skeleton-${page.replace(/\.html$/, '')}">${content}</main>`;
};
window.ACERenderInitialSkeletons();
