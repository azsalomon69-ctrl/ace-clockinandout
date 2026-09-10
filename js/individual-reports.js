document.addEventListener('DOMContentLoaded', async () => {
  const me = await window.ACEAuth.request('/v1/me');
  if (me.profile.role !== 'ADMIN') return location.replace('user-dashboard.html');
  const users = (await window.ACEAuth.request('/v1/users')).filter(user => user.role === 'USER' && user.status === 'ACTIVE');
  const input = document.getElementById('individualEmployee'); const month = document.getElementById('individualMonth'); const rows = document.getElementById('individualReportRows');
  month.value = new Date().toISOString().slice(0, 7);
  const employeeName = user => user.full_name || user.email;
  const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  document.getElementById('individualEmployeeOptions').innerHTML = users.map(user => `<option value="${escapeHtml(employeeName(user))}"></option>`).join('');
  const run = (employee, format) => { const [year, mon] = month.value.split('-').map(Number); window.ACEReportActions.preview({ dateFrom: `${year}-${String(mon).padStart(2, '0')}-01`, dateTo: new Date(year, mon, 0).toISOString().slice(0, 10), filters: { userId: employee.id }, format }); };
  document.getElementById('individualReportForm').addEventListener('submit', event => {
    event.preventDefault(); const selected = input.value ? users.filter(user => employeeName(user) === input.value) : users;
    if (!selected.length) return showToast('Choose an employee from the search list or clear it to generate all employee reports.', 'warning');
    const label = new Date(`${month.value}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    document.getElementById('individualReportCount').textContent = `${selected.length} report${selected.length === 1 ? '' : 's'}`;
    rows.innerHTML = selected.map((employee, index) => `<tr><td><a class="admin-employee-profile-link" href="employee-profile.html?user=${encodeURIComponent(employee.id)}">${escapeHtml(employeeName(employee))}</a></td><td>${label}</td><td><button class="btn btn-sm btn-outline" data-format="VIEW" data-row="${index}">View PDF</button><button class="btn btn-sm btn-primary" data-format="PDF" data-row="${index}">Save PDF</button><button class="btn btn-sm btn-outline" data-format="XLSX" data-row="${index}">Save Excel</button></td></tr>`).join('');
    rows.querySelectorAll('[data-format]').forEach(button => button.addEventListener('click', () => run(selected[Number(button.dataset.row)], button.dataset.format)));
    showToast(`${selected.length} individual report${selected.length === 1 ? '' : 's'} ready.`, 'success');
  });
});
