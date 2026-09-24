// Akio <3: Project source maintained by Akio Zaki Salomon.
const deletedEscape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
let deletedUsersPage = 1; let deletedUsersPageSize = 25;
async function loadDeletedUsers() {
  const body = document.getElementById('deletedUsersTable');
  try {
    const response = await window.ACEAuth.request('/v1/users?removed=true&page=' + deletedUsersPage + '&pageSize=' + deletedUsersPageSize); const users = response.items || response; const total = response.total ?? users.length;
    body.innerHTML = users.length ? users.map(user => '<tr><td>' + deletedEscape(user.full_name || 'Unnamed user') + '</td><td>' + deletedEscape(user.email) + '</td><td>' + (user.role === 'ADMIN' ? 'Admin' : 'Employee') + '</td><td><div class="action-group"><button class="btn btn-sm btn-outline restore-user" data-id="' + user.id + '" type="button">Restore access</button><button class="btn btn-sm btn-danger permanent-delete-user" data-id="' + user.id + '" type="button">Delete Google login</button></div></td></tr>').join('') : '<tr class="table-empty-row"><td colspan="4"><div class="empty-state empty-state-compact"><h3>No archived users</h3><p>Archived accounts will appear here until they are restored or permanently removed.</p></div></td></tr>';
    body.querySelectorAll('.restore-user').forEach(button => button.addEventListener('click', async () => {
      try { await window.ACEAuth.request('/v1/users/' + button.dataset.id + '/restore', { method: 'PATCH' }); showToast('User restored.', 'success'); loadDeletedUsers(); }
      catch (error) { showToast(error.message || 'Could not restore user.', 'error'); }
    }));
    body.querySelectorAll('.permanent-delete-user').forEach(button => button.addEventListener('click', async () => {
      if (!await window.ACEUI.confirm({ title: 'Delete Google login?', message: 'Their time entries, remarks, reports, and audit history will be kept. This cannot be undone.', confirmLabel: 'Delete login', danger: true })) return;
      try { await window.ACEAuth.request('/v1/users/' + button.dataset.id + '/permanent', { method: 'DELETE' }); showToast('Google login removed; company records were kept.', 'success'); loadDeletedUsers(); }
      catch (error) { showToast(error.message || 'Could not permanently delete this user.', 'error'); }
    }));
    let pager = document.getElementById('deletedUsersPagination'); if (!pager) { pager = document.createElement('div'); pager.id = 'deletedUsersPagination'; pager.className = 'admin-pagination'; body.closest('.table-responsive').insertAdjacentElement('afterend', pager); }
    const pages = Math.max(1, Math.ceil(total / deletedUsersPageSize)); pager.innerHTML = total > deletedUsersPageSize ? '<span>Showing ' + ((deletedUsersPage - 1) * deletedUsersPageSize + 1) + '–' + Math.min(deletedUsersPage * deletedUsersPageSize, total) + ' of ' + total + '</span><div class="pagination"><select class="form-select"><option value="25"' + (deletedUsersPageSize === 25 ? ' selected' : '') + '>25</option><option value="50"' + (deletedUsersPageSize === 50 ? ' selected' : '') + '>50</option><option value="100"' + (deletedUsersPageSize === 100 ? ' selected' : '') + '>100</option></select><button data-page="' + (deletedUsersPage - 1) + '" ' + (deletedUsersPage === 1 ? 'disabled' : '') + '>‹</button><button data-page="' + (deletedUsersPage + 1) + '" ' + (deletedUsersPage === pages ? 'disabled' : '') + '>›</button></div>' : '';
    pager.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => { deletedUsersPage = Number(button.dataset.page); loadDeletedUsers(); })); pager.querySelector('select')?.addEventListener('change', event => { deletedUsersPageSize = Number(event.target.value); deletedUsersPage = 1; loadDeletedUsers(); });
  } catch (error) { showToast(error.message || 'Could not load deleted users.', 'error'); }
}
window.mountDeletedUsers = loadDeletedUsers;
window.addEventListener('ace:live-data', event => { if (!event.detail?.background && document.getElementById('deletedUsersTable')) void loadDeletedUsers(); });
document.addEventListener('DOMContentLoaded', window.mountDeletedUsers);
