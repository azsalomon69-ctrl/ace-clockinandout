// Loading belongs inside the real page: static copy and layout never wait for data.
document.querySelector('.app-shell-skeleton')?.replaceChildren();
window.ACERenderInitialSkeletons = function renderAceInitialSkeleton() {
  const main = document.querySelector('main.main-content');
  if (!main || main.dataset.loadingPrepared) return;
  main.dataset.loadingPrepared = 'true';
  window.ACEPrepareAdminSection?.();
  const shell = document.querySelector('.app-shell-skeleton');
  if (shell) shell.replaceChildren(); // Retained only for connection/retry notices.
  const line = '<span class="skeleton skeleton-line data-loading-line" aria-hidden="true"></span>';
  const values = '.stat-number, .summary-value, #userName, #weekHours, #weekEntries, #weekAverage, #analyticsDetail, #analyticsEntryTotal, #analyticsTotalHours, #analyticsAverage, #projectAllocationDetail, #sessionStateTime, #clockedInAt, #currentShiftTitle, #currentShiftDescription, #clockStatus .status-indicator';
  main.querySelectorAll(values).forEach(node => node.classList.add('data-value-pending'));
  main.querySelectorAll('tbody').forEach(body => {
    if (body.children.length || body.closest('[style*="display: none"]')) return;
    const columns = body.closest('table').querySelectorAll('thead th').length;
    if (!columns) return;
    body.innerHTML = Array.from({ length: 4 }, () => '<tr class="skeleton-table-row">' + Array.from({ length: columns }, () => '<td>' + line + '</td>').join('') + '</tr>').join('');
  });
  const regions = {
    hoursChart: 'chart', projectAllocationChart: 'chart', employeeWeekChart: 'chart',
    adminLeaderboard: 'list', recentActivity: 'list', myProjects: 'list',
    dashboardRemarks: 'list', remarksPageList: 'list', chatLogList: 'list'
  };
  Object.entries(regions).forEach(([id, kind]) => {
    const node = document.getElementById(id);
    if (!node || node.children.length) return;
    node.innerHTML = '<div class="data-region-placeholder data-region-' + kind + '" role="status" aria-label="Loading data">' + line.repeat(kind === 'chart' ? 5 : 3) + '</div>';
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
