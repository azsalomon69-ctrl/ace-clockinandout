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
  const cards = (count, className = '') => `<div class="shell-skeleton-cards ${className}" style="--skeleton-card-columns:${count}">${Array.from({ length: count }, () => `<div class="shell-skeleton-card">${lines(2)}</div>`).join('')}</div>`;
  // Columns mirror each page's real table, rather than drawing five everywhere.
  const table = (count = 5, columns = 5, filters = 0) => panel(`<div class="shell-skeleton-table-toolbar"><i class="shell-skeleton-panel-title"></i><i class="shell-skeleton-control"></i></div>${filters ? `<div class="shell-skeleton-filter-row">${lines(filters, 'is-control')}</div>` : ''}<div class="shell-skeleton-table-scroll"><div class="shell-skeleton-table-grid" style="--skeleton-columns:${columns}"><div class="shell-skeleton-table-head">${lines(columns)}</div>${Array.from({ length: count }, () => `<div class="shell-skeleton-row is-table-row">${lines(columns)}</div>`).join('')}</div></div>`, 'is-table');
  const heading = `<div class="shell-skeleton-panel-heading">${lines(2)}</div>`;
  const chart = () => panel(`${heading}<div class="shell-skeleton-chart"></div>`, 'is-chart');
  const fields = count => `<div class="shell-skeleton-form-grid">${Array.from({ length: count }, () => `<div class="shell-skeleton-field">${lines(1)}<i class="shell-skeleton-control"></i></div>`).join('')}</div>`;
  let content;

  if (page === 'admin-dashboard.html') {
    content = `${intro}${panel(`<div class="shell-skeleton-quick-copy">${lines(3)}</div><div class="shell-skeleton-quick-actions">${lines(4)}</div>`, 'is-quick-actions')}${cards(3, 'is-admin-stats')}<div class="shell-skeleton-section-title">${lines(2)}</div><div class="shell-skeleton-dashboard-grid">${panel(`<div class="shell-skeleton-panel-heading">${lines(2)}</div><div class="shell-skeleton-chart"></div>`, 'is-chart')}${panel(`<div class="shell-skeleton-panel-heading">${lines(2)}</div>${rows(5)}`, 'is-allocation')}</div>${table(4, 9)}`;
  } else if (page === 'user-dashboard.html') {
    content = `${intro}${panel(lines(1), 'is-notice')}<div class="shell-skeleton-dashboard-grid is-employee-hero">${panel(`<div class="shell-skeleton-status-copy">${lines(4)}</div><div class="shell-skeleton-status-meta">${lines(3)}</div><i class="shell-skeleton-control"></i>`, 'is-clock-card')}${panel(`<div class="shell-skeleton-panel-heading">${lines(2)}</div>${lines(3)}<div class="shell-skeleton-chart"></div>`, 'is-week-card')}</div><div class="shell-skeleton-dashboard-grid is-employee-lower">${panel(`<div class="shell-skeleton-panel-heading">${lines(2)}</div>${rows(2)}<i class="shell-skeleton-control"></i>`, 'is-activity')}${panel(`<div class="shell-skeleton-panel-heading">${lines(2)}</div>${rows(1)}`, 'is-projects')}</div><div class="shell-skeleton-dashboard-grid is-employee-bottom">${panel(`<div class="shell-skeleton-panel-heading">${lines(2)}</div>${rows(3)}`, 'is-shortcuts')}${panel(`<div class="shell-skeleton-panel-heading">${lines(2)}</div><div class="shell-skeleton-empty"></div>`, 'is-remarks')}</div>`;
  } else if (page === 'time-entries.html') {
    content = `${intro}${panel(`<div class="shell-skeleton-panel-heading">${lines(1)}</div><div class="shell-skeleton-filter-row">${lines(4, 'is-control')}</div><div class="shell-skeleton-filter-actions">${lines(2, 'is-control')}</div>`, 'is-filter-panel')}${cards(3, 'is-employee-stats')}${table(5, 9)}`;
  } else if (page === 'remarks.html') {
    content = `${intro}${panel(`<div class="shell-skeleton-panel-heading">${lines(2)}</div>${rows(3)}`, 'is-remark-list')}`;
  } else if (page === 'settings.html') {
    content = `${intro}<div class="shell-skeleton-tabs">${lines(3, 'is-control')}</div>${panel(`${heading}<div class="shell-skeleton-avatar-row"><i class="shell-skeleton-avatar"></i><div>${lines(2)}<i class="shell-skeleton-control"></i></div></div>${fields(2)}<div class="shell-skeleton-filter-actions">${lines(1, 'is-control')}</div>`, 'is-settings-form')}`;
  } else if (page === 'reports.html') {
    content = `${intro}${table(5, 6)}`;
  } else if (page === 'individual-reports.html') {
    content = `${intro}<div class="shell-skeleton-individual-grid">${panel(`${heading}${fields(1)}<div class="shell-skeleton-period-options">${rows(2)}</div><i class="shell-skeleton-control"></i>`, 'is-form-panel')}${table(4, 3)}</div>`;
  } else if (page === 'schedule-flex.html') {
    content = `${intro}<div class="shell-skeleton-schedule-grid">${panel(`${heading}${fields(4)}<div class="shell-skeleton-days">${lines(7, 'is-control')}</div><i class="shell-skeleton-control"></i>`, 'is-form-panel')}${panel(`${heading}${fields(2)}<i class="shell-skeleton-control"></i>`, 'is-form-panel')}</div>${table(4, 6)}`;
  } else if (page === 'chat-log.html') {
    content = `${intro}${panel(Array.from({ length: 5 }, () => `<article class="shell-skeleton-message">${heading}${lines(2)}</article>`).join(''), 'is-chat-log')}`;
  } else if (page === 'time-entry-details.html') {
    content = `${intro}${cards(5, 'is-detail-stats')}${panel(`<div class="shell-skeleton-panel-heading">${lines(2)}</div>${rows(2)}`, 'is-detail-notes')}${panel(`<div class="shell-skeleton-panel-heading">${lines(2)}</div>${rows(3)}<div class="shell-skeleton-form-grid">${lines(2, 'is-control')}</div>`, 'is-detail-remarks')}`;
  } else if (page === 'employee-profile.html') {
    content = `<div class="shell-skeleton-filter-actions">${lines(3, 'is-control')}</div><div class="shell-skeleton-avatar-row"><i class="shell-skeleton-avatar"></i>${intro}</div>${cards(3, 'is-profile-stats')}<div class="shell-skeleton-dashboard-grid is-profile-charts">${chart()}${panel(`${heading}${rows(4)}`, 'is-allocation')}</div>${table(4, 5)}`;
  } else if (page === 'deleted-users.html' || page === 'deleted-time-entries.html') {
    content = `${intro}${table(4, page === 'deleted-users.html' ? 4 : 5)}`;
  } else if (['users.html', 'invitations.html', 'departments.html', 'projects.html', 'admin-time-entries.html', 'audit-logs.html'].includes(page)) {
    const layouts = {
      'users.html': [2, 7, 3], 'invitations.html': [3, 6, 0],
      'departments.html': [2, 5, 0], 'projects.html': [2, 5, 0],
      'admin-time-entries.html': [3, 8, 3], 'audit-logs.html': [3, 6, 0]
    };
    const [stats, columns, filters] = layouts[page];
    content = `${intro}${cards(stats, 'is-admin-stats')}${page === 'admin-time-entries.html' ? panel(`${heading}${rows(1)}`, 'is-active-entries') : ''}${table(5, columns, filters)}`;
  } else {
    content = `${intro}${table(5)}`;
  }

  shell.innerHTML = `<main class="shell-skeleton-main shell-skeleton-${page.replace(/\.html$/, '')}">${content}</main>`;
};
window.ACERenderInitialSkeletons();
