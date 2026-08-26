const deletedEscape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
async function loadDeletedUsers() {
  const body = document.getElementById('deletedUsersTable');
  try {
    const users = await window.ACEAuth.request('/v1/users?removed=true');
    body.innerHTML = users.length ? users.map(user => '<tr><td>' + deletedEscape(user.full_name || 'Unnamed user') + '</td><td>' + deletedEscape(user.email) + '</td><td>' + (user.role === 'ADMIN' ? 'Admin' : 'Employee') + '</td><td><button class="btn btn-sm btn-outline restore-user" data-id="' + user.id + '" type="button">Restore</button></td></tr>').join('') : '<tr><td colspan="4">No deleted users.</td></tr>';
    body.querySelectorAll('.restore-user').forEach(button => button.addEventListener('click', async () => {
      try { await window.ACEAuth.request('/v1/users/' + button.dataset.id + '/approval', { method: 'PATCH', body: JSON.stringify({ status: 'ACTIVE' }) }); showToast('User restored.', 'success'); loadDeletedUsers(); }
      catch (error) { showToast(error.message || 'Could not restore user.', 'error'); }
    }));
  } catch (error) { showToast(error.message || 'Could not load deleted users.', 'error'); }
}
document.addEventListener('DOMContentLoaded', loadDeletedUsers);
