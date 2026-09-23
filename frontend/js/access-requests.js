const requestApi = (...args) => window.ACEAuth.request(...args);
const requestEsc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
let accessRequests = [];
let departments = [];
const requestDateTime = value => value ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)) : '—';
const normalizedDepartmentName = value => String(value || '').trim().toLowerCase();
const accessRequestEmpty = '<tr class="table-empty-row"><td colspan="6"><div class="empty-state empty-state-compact"><h3>No access requests yet</h3><p>Requests from new sign-ins will appear here for review.</p></div></td></tr>';

function requestExpiry(value) {
  const seconds = Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 1000));
  return seconds ? Math.ceil(seconds / 60) + ' min remaining' : 'Expired';
}
function requestBadge(state) {
  const type = state === 'PENDING' ? 'warning' : state === 'ACTIVE' ? 'success' : 'neutral';
  return '<span class="badge badge-' + type + '">' + requestEsc(state.toLowerCase()) + '</span>';
}
function matchedDepartmentId(request) {
  const requestedName = normalizedDepartmentName(request.requested_department);
  if (!requestedName) return null;
  const matches = departments.filter(department => normalizedDepartmentName(department.name) === requestedName);
  return matches.length === 1 ? matches[0].id : null;
}
function departmentSelect(request, index) {
  const selectedId = matchedDepartmentId(request);
  return '<select class="form-select request-department" data-row="' + index + '" aria-label="Department"><option value="">No department</option>' + departments.map(department => '<option value="' + requestEsc(department.id) + '"' + (department.id === selectedId ? ' selected' : '') + '>' + requestEsc(department.name) + '</option>').join('') + '</select>';
}
function renderAccessRequests() {
  const body = document.getElementById('accessRequestTable'); if (!body) return;
  body.innerHTML = accessRequests.length ? accessRequests.map((request, index) => '<tr><td><strong>' + requestEsc(request.profiles?.full_name || request.full_name || 'Google user') + '</strong><br><small>' + requestEsc(request.email) + '</small></td><td>' + requestDateTime(request.created_at) + '</td><td>' + requestExpiry(request.expires_at) + '</td><td>' + requestBadge(request.state) + '</td><td>' + (request.state === 'PENDING' ? '<select class="form-select request-role" data-row="' + index + '" aria-label="Role"><option value="USER">Employee</option><option value="ADMIN">Admin</option></select> ' + departmentSelect(request, index) : '—') + '</td><td>' + (request.state === 'PENDING' ? '<button class="btn btn-sm btn-primary review-request" data-row="' + index + '" data-decision="APPROVE" type="button">Approve</button> <button class="btn btn-sm btn-outline review-request" data-row="' + index + '" data-decision="DENY" type="button">Deny</button>' : '—') + '</td></tr>').join('') : accessRequestEmpty;
  body.querySelectorAll('.review-request').forEach(button => button.addEventListener('click', () => {
    const row = button.dataset.row;
    reviewRequest(accessRequests[Number(row)], button.dataset.decision, body.querySelector('.request-role[data-row="' + row + '"]')?.value || 'USER', body.querySelector('.request-department[data-row="' + row + '"]')?.value || null);
  }));
}
async function reviewRequest(request, decision, role, departmentId) {
  const row = document.querySelector('#accessRequestTable .review-request[data-row="' + accessRequests.indexOf(request) + '"]')?.closest('tr');
  const buttons = Array.from(row?.querySelectorAll('.review-request') || []);
  if (buttons.some(button => button.disabled)) return;
  const labels = buttons.map(button => button.innerHTML);
  buttons.forEach(button => { button.disabled = true; button.setAttribute('aria-busy', 'true'); });
  const activeButton = buttons.find(button => button.dataset.decision === decision);
  if (activeButton) activeButton.textContent = decision === 'APPROVE' ? 'Approving…' : 'Denying…';
  const payload = decision === 'APPROVE' ? { decision, role, department_id: departmentId } : { decision, role };
  try {
    await requestApi('/v1/access-requests/' + request.id, { method: 'PATCH', body: JSON.stringify(payload) });
    showToast(decision === 'APPROVE' ? 'Access approved.' : 'Access denied.', 'success');
    await loadAccessRequests();
  } catch (error) {
      if (error.status === 401) {
        showToast('Your session expired. Redirecting to login.', 'warning');
        return;
      }
      if (error.status === 404) {
        showToast('This access request is no longer available.', 'warning');
        loadAccessRequests();
        return;
      }
      if (error.status === 409) {
        showToast(error.message || 'This access request has already been reviewed.', 'warning');
        loadAccessRequests();
        return;
      }
      if (error.status === 410) {
        showToast('This request has expired and can no longer be reviewed.', 'warning');
        loadAccessRequests();
        return;
      }
      if (error.status === 429) {
        showToast('Too many requests. Try again in a moment.', 'warning');
        return;
      }
      showToast(error.message || 'Unable to review request.', 'error');
  } finally {
    buttons.forEach((button, index) => { button.disabled = false; button.removeAttribute('aria-busy'); button.innerHTML = labels[index]; });
  }
}
async function loadAccessRequests() {
  try {
    const [requests, departmentList] = await Promise.all([requestApi('/v1/access-requests'), requestApi('/v1/departments')]);
    accessRequests = requests;
    departments = departmentList.filter(department => department.is_active);
    renderAccessRequests();
  }
  catch (error) { showToast(error.message || 'Unable to load access requests.', 'error'); }
}
let accessRequestsInterval;
window.unmountAccessRequests = () => {
  if (accessRequestsInterval) window.clearInterval(accessRequestsInterval);
  accessRequestsInterval = null;
};
window.mountAccessRequests = () => {
  window.unmountAccessRequests();
  loadAccessRequests();
  document.getElementById('accessRequestSearch')?.addEventListener('input', event => {
    const term = event.target.value.toLowerCase();
    const all = accessRequests; accessRequests = all.filter(request => [request.email, request.full_name, request.state].join(' ').toLowerCase().includes(term)); renderAccessRequests(); accessRequests = all;
  });
  accessRequestsInterval = window.setInterval(loadAccessRequests, 15000);
};
document.addEventListener('DOMContentLoaded', window.mountAccessRequests);
