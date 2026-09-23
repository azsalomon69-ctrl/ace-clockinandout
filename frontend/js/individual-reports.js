const mountIndividualReports = async () => {
  const me = await window.ACEAuth.request('/v1/me');
  if (me.profile.role !== 'ADMIN') return location.replace('/user-dashboard');
  let users = (await window.ACEAuth.request('/v1/users')).filter(user => user.role === 'USER' && user.status === 'ACTIVE');
  const input = document.getElementById('individualEmployee'); const month = document.getElementById('individualMonth'); const rows = document.getElementById('individualReportRows'); const selection = document.getElementById('individualReportSelection'); const submitButton = document.querySelector('#individualReportForm button[type="submit"]');
  month.value = new Date().toISOString().slice(0, 7);
  month.max = month.value;
  const employeeName = user => user.full_name || user.email;
  const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  document.getElementById('individualEmployeeOptions').innerHTML = users.map(user => `<option value="${escapeHtml(employeeName(user))}"></option>`).join('');
  const updateSelection = () => {
    if (!users.length) {
      selection.textContent = 'No active employees yet. Invite an employee before preparing reports.';
      selection.classList.remove('is-invalid');
      rows.innerHTML = '<tr class="table-empty-row"><td colspan="3"><div class="empty-state empty-state-compact"><h3>No active employees yet</h3><p>Invite an employee before preparing individual reports.</p></div></td></tr>';
      input.disabled = true;
      submitButton.disabled = true;
      return;
    }
    const selected = input.value ? users.filter(user => employeeName(user) === input.value) : users;
    selection.textContent = input.value && !selected.length
      ? 'Choose a name from the employee list, or clear this field for all employees.'
      : `${selected.length} active employee${selected.length === 1 ? '' : 's'} will be included.`;
    selection.classList.toggle('is-invalid', Boolean(input.value && !selected.length));
    input.disabled = false;
    submitButton.disabled = false;
  };
  input.addEventListener('input', updateSelection); updateSelection();
  const refreshEmployees = async () => {
    users = (await window.ACEAuth.request('/v1/users')).filter(user => user.role === 'USER' && user.status === 'ACTIVE');
    document.getElementById('individualEmployeeOptions').innerHTML = users.map(user => `<option value="${escapeHtml(employeeName(user))}"></option>`).join('');
    updateSelection();
  };
  window.refreshIndividualReportEmployees = refreshEmployees;
  if (!document.body.dataset.individualReportsLiveBound) {
    document.body.dataset.individualReportsLiveBound = 'true';
    window.addEventListener('ace:live-data', () => { if (!document.querySelector('form:focus-within')) void window.refreshIndividualReportEmployees?.().catch(() => {}); });
  }
  const run = (employee, format) => {
    const [year, mon] = month.value.split('-').map(Number);
    const lastDay = new Date(year, mon, 0).getDate();
    window.ACEReportActions.preview({ dateFrom: `${month.value}-01`, dateTo: `${month.value}-${String(lastDay).padStart(2, '0')}`, filters: { userId: employee.id }, format });
  };
  document.getElementById('individualReportForm').addEventListener('submit', event => {
    event.preventDefault(); const selected = input.value ? users.filter(user => employeeName(user) === input.value) : users;
    if (!selected.length) { updateSelection(); input.focus(); return showToast('Choose an employee from the search list or clear it to prepare reports for everyone.', 'warning'); }
    const label = new Date(`${month.value}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    document.getElementById('individualReportCount').textContent = `${selected.length} report${selected.length === 1 ? '' : 's'}`;
    rows.innerHTML = selected.map((employee, index) => `<tr><td><a class="admin-employee-profile-link" href="employee-profile.html?user=${encodeURIComponent(employee.id)}">${escapeHtml(employeeName(employee))}</a></td><td>${label}</td><td><button class="btn btn-sm btn-outline" data-format="VIEW" data-row="${index}">Preview</button><button class="btn btn-sm btn-primary" data-format="PDF" data-row="${index}">Save as PDF</button><button class="btn btn-sm btn-outline" data-format="XLSX" data-row="${index}">Save Excel</button></td></tr>`).join('');
    rows.querySelectorAll('[data-format]').forEach(button => button.addEventListener('click', () => run(selected[Number(button.dataset.row)], button.dataset.format)));
    showToast(`${selected.length} individual report${selected.length === 1 ? '' : 's'} ready.`, 'success');
  });
};
window.mountIndividualReports = mountIndividualReports;
document.addEventListener('DOMContentLoaded', window.mountIndividualReports);
