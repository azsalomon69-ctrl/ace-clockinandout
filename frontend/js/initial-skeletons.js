// Loading belongs inside the real page: static copy and layout never wait for data.
const aceSkeletonLine = '<span class="skeleton data-loading-line" aria-hidden="true"></span>';
const aceSkeletonShapes = {
  hoursChart: () => [26, 48, 34, 65, 45, 76, 55, 32, 51].map(height =>
    '<span class="data-loading-line" style="--loading-height:' + height + '%"></span>').join(''),
  projectAllocationChart: () => ('<div class="project-bar-row data-loading-allocation-row">' + aceSkeletonLine.repeat(3) + '</div>').repeat(2),
  employeeWeekChart: () => [35, 56, 42, 72, 51, 32, 38].map(height =>
    '<div class="employee-week-day">' + aceSkeletonLine + '<span class="employee-week-slot"><span class="employee-week-bar data-loading-line" style="--loading-height:' + height + '%"></span></span>' + aceSkeletonLine + '</div>').join(''),
  adminLeaderboard: () => ('<li class="time-leaderboard-row" aria-hidden="true"><b class="data-loading-line"></b><span class="time-leaderboard-avatar data-loading-line"></span>' + aceSkeletonLine.repeat(2) + '</li>').repeat(2),
  recentActivity: () => '<ol class="employee-activity-list">' + ('<li class="activity-item" aria-hidden="true"><div class="activity-date">' + aceSkeletonLine.repeat(2) + '</div><div class="activity-duration">' + aceSkeletonLine + '</div></li>').repeat(2) + '</ol>',
  myProjects: () => '<div class="project-card data-loading-project">' + aceSkeletonLine.repeat(2) + '</div>',
  dashboardRemarks: () => '<article class="remark-item data-loading-remark">' + aceSkeletonLine.repeat(3) + '</article>',
  remarksPageList: () => '<article class="remark-item data-loading-remark">' + aceSkeletonLine.repeat(3) + '</article>',
};

window.ACERenderLoadingRegion = function renderLoadingRegion(node) {
  const renderShape = aceSkeletonShapes[node?.id];
  if (!renderShape || node.classList.contains('is-data-loading')) return;
  node.classList.add('is-data-loading');
  node.setAttribute('aria-busy', 'true');
  node.innerHTML = renderShape();
};

window.ACEClearLoadingRegion = function clearLoadingRegion(node) {
  if (!node?.classList.contains('is-data-loading')) return;
  node.classList.remove('is-data-loading');
  node.removeAttribute('aria-busy');
  node.replaceChildren();
};
window.ACERenderInitialSkeletons = function renderAceInitialSkeleton() {
  const main = document.querySelector('main.main-content');
  if (!main || main.dataset.loadingPrepared) return;
  main.dataset.loadingPrepared = 'true';
  window.ACEPrepareAdminSection?.();
  const values = '.stat-number, .summary-value, #sectionStats dd, #totalHours, #totalEntries, #avgDuration, #userName, #weekHours, #weekEntries, #weekAverage, #analyticsDetail, #analyticsEntryTotal, #analyticsTotalHours, #analyticsAverage, #projectAllocationDetail, #sessionStateTime, #clockedInAt, #currentShiftTitle, #currentShiftDescription, #clockStatus .status-indicator';
  main.querySelectorAll(values).forEach(node => node.classList.add('data-value-pending'));
  main.querySelectorAll('tbody').forEach(body => {
    if (body.children.length || body.closest('[style*="display: none"]')) return;
    const columns = body.closest('table').querySelectorAll('thead th').length;
    if (!columns) return;
    body.innerHTML = Array.from({ length: 4 }, () => '<tr class="skeleton-table-row">' + Array.from({ length: columns }, () => '<td>' + aceSkeletonLine + '</td>').join('') + '</tr>').join('');
  });
  Object.keys(aceSkeletonShapes).forEach(id => {
    const node = main.querySelector('#' + id);
    if (!node || node.children.length) return;
    window.ACERenderLoadingRegion(node);
    if (id === 'employeeWeekChart') {
      node.hidden = false;
      main.querySelector('#employeeWeekState').hidden = true;
    }
  });
  ['employeeProfileContent', 'timeEntryDetailsContent'].forEach(id => {
    const node = document.getElementById(id);
    if (node && !node.children.length) node.innerHTML = '<p role="status">Loading ' + (id === 'employeeProfileContent' ? 'employee profile' : 'time entry') + '…</p>';
  });
  const date = document.getElementById('currentDate');
  if (date) date.textContent = new Intl.DateTimeFormat('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date());
  // No controls may mutate data before authentication and event setup finish.
  main.inert = true;
  main.setAttribute('aria-busy', 'true');
  document.body.classList.add('data-layout-ready');
};
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', window.ACERenderInitialSkeletons, { once: true });
} else window.ACERenderInitialSkeletons();
