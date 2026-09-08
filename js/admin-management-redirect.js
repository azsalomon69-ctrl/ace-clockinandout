(() => {
  const view = new URLSearchParams(window.location.search).get('view') || 'users';
  const routes = {
    users: 'users.html',
    invitations: 'invitations.html',
    departments: 'departments.html',
    projects: 'projects.html',
    entries: 'admin-time-entries.html',
    audit: 'audit-logs.html'
  };
  window.location.replace(routes[view] || routes.users);
})();
