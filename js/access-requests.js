const requestApi = path => window.ACEAuth.request(path);
const requestEsc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
let accessRequests = [];

function requestExpiry(value) {
  const seconds = Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 1000));
  return seconds ? Math.ceil(seconds / 60) + ' min remaining' : 'Expired';
}
function requestBadge(state) {
  const type = state === 'PENDING' ? 'warning' : state === 'ACTIVE' ? 'success' : 'neutral';
  return '<span class="badge badge-' + type + '">' + requestEsc(state.toLowerCase()) + '</span>';
}
function renderAccessRequests() {
  const body = document.getElementById('accessRequestTable'); if (!body) return;
  body.innerHTML = accessRequests.length ? accessRequests.map((request, index) => '<tr><td><strong>' + requestEsc(request.profiles?.full_name || request.full_name || 'Google user') + '</strong><br><small>' + requestEsc(request.email) + '</small></td><td>' + new Date(request.created_at).toLocaleTimeString() + '</td><td>' + requestExpiry(request.expires_at) + '</td><td>' + requestBadge(request.state) + '</td><td>' + (request.state === 'PENDING' ? '<select class="form-select request-role" data-row="' + index + '"><option value="USER">Employee</option><option value="ADMIN">Admin</option></select>' : '—') + '</td><td>' + (request.state === 'PENDING' ? '<button class="btn btn-sm btn-primary review-request" data-row="' + index + '" data-decision="APPROVE" type="button">Approve</button> <button class="btn btn-sm btn-outline review-request" data-row="' + index + '" data-decision="DENY" type="button">Deny</button>' : '—') + '</td></tr>').join('') : '<tr><td colspan="6">No access requests found.</td></tr>';
  body.querySelectorAll('.review-request').forEach(button => button.addEventListener('click', () => reviewRequest(accessRequests[Number(button.dataset.row)], button.dataset.decision, body.querySelector('.request-role[data-row="' + button.dataset.row + '"]')?.value || 'USER')));
}
function reviewRequest(request, decision, role) {
  requestApi('/v1/access-requests/' + request.id, { method: 'PATCH', body: JSON.stringify({ decision, role }) })
    .then(() => { showToast(decision === 'APPROVE' ? 'Access approved.' : 'Access denied.', 'success'); loadAccessRequests(); })
    .catch(error => showToast(error.message || 'Unable to review request.', 'error'));
}
async function loadAccessRequests() {
  try { accessRequests = await requestApi('/v1/access-requests'); renderAccessRequests(); }
  catch (error) { showToast(error.message || 'Unable to load access requests.', 'error'); }
}
document.addEventListener('DOMContentLoaded', () => {
  loadAccessRequests();
  document.getElementById('accessRequestSearch')?.addEventListener('input', event => {
    const term = event.target.value.toLowerCase();
    const all = accessRequests; accessRequests = all.filter(request => [request.email, request.full_name, request.state].join(' ').toLowerCase().includes(term)); renderAccessRequests(); accessRequests = all;
  });
  window.setInterval(loadAccessRequests, 15000);
});
