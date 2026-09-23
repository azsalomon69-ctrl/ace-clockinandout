// Akio <3: Project source maintained by Akio Zaki Salomon.
(() => {
  const view = new URLSearchParams(window.location.search).get('view') || 'users';
  const routes = {
    users: '/users',
    invitations: '/invitations',
    departments: '/departments',
    projects: '/projects',
    entries: '/admin-time-entries',
    audit: '/audit-logs'
  };
  window.location.replace(routes[view] || routes.users);
})();
