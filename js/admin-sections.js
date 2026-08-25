const ADMIN_SECTION_DATA = {
  users: { title: 'Users', description: 'Approve access, assign roles, and maintain employee records.', action: 'Invite user', actionIcon: 'user-plus', stats: [['7', 'Team members', 'users'], ['5', 'Active users', 'check'], ['1', 'Pending review', 'circle-alert']], columns: ['Name', 'Email', 'Role', 'Department', 'Status', 'Action'], rows: [['ACE Administrator', 'admin@ace.com', 'Admin', 'Unassigned', 'Active', 'Manage'], ['ACE Employee', 'employee@ace.com', 'Employee', 'Unassigned', 'Active', 'Manage'], ['John Doe', 'john.doe@example.com', 'Employee', 'Engineering', 'Active', 'Manage'], ['Bob Wilson', 'bob.wilson@example.com', 'Employee', 'Unassigned', 'Pending', 'Review']] },
  invitations: { title: 'Invitations', description: 'Invite employees and track every invitation through acceptance or expiry.', action: 'Send invitation', actionIcon: 'mail', stats: [['3', 'Pending', 'timer'], ['12', 'Accepted', 'check'], ['1', 'Expires today', 'circle-alert']], columns: ['Email', 'Invited by', 'Sent', 'Expires', 'Status', 'Action'], rows: [['maria@ace.com', 'ACE Administrator', 'Today', 'Aug 31', 'Pending', 'Resend'], ['ben@ace.com', 'ACE Administrator', 'Aug 22', 'Aug 29', 'Pending', 'Cancel'], ['sam@ace.com', 'ACE Administrator', 'Aug 19', 'Aug 26', 'Accepted', 'View']] },
  departments: { title: 'Departments', description: 'Organize employees by department. Assignments remain optional.', action: 'Add department', actionIcon: 'building', stats: [['4', 'Active departments', 'building'], ['5', 'Assigned employees', 'users'], ['2', 'Unassigned', 'circle-alert']], columns: ['Department', 'Description', 'Members', 'Created', 'Status', 'Action'], rows: [['Engineering', 'Product and platform delivery', '2', 'Jan 1, 2024', 'Active', 'Edit'], ['Human Resources', 'People operations', '1', 'Jan 1, 2024', 'Active', 'Edit'], ['Operations', 'Client support and delivery', '2', 'Jan 2, 2024', 'Active', 'Edit']] },
  projects: { title: 'Projects', description: 'Manage projects available for optional time-entry assignment.', action: 'Add project', actionIcon: 'folder', stats: [['5', 'Active projects', 'folder'], ['6', 'Employee assignments', 'users'], ['1', 'Unassigned employee', 'circle-alert']], columns: ['Project', 'Description', 'Assigned people', 'Created', 'Status', 'Action'], rows: [['ACE Platform', 'Core time tracking platform', '3', 'Jan 1, 2024', 'Active', 'Edit'], ['Client Success', 'Client support workflow', '2', 'Jan 2, 2024', 'Active', 'Edit'], ['Internal Operations', 'Internal business work', '1', 'Jan 3, 2024', 'Active', 'Edit']] },
  entries: { title: 'Time entries', description: 'Review company clocking activity and add internal administrator remarks.', action: 'Export entries', actionIcon: 'download', stats: [['42h 30m', 'Logged this week', 'timer'], ['5', 'Clocked in today', 'check'], ['3', 'Open entries', 'circle-alert']], columns: ['Employee', 'Project', 'Clock in', 'Clock out', 'Duration', 'Action'], rows: [['ACE Employee', 'Unassigned', 'Aug 24, 8:04 AM', '—', 'Running', 'Add remark'], ['John Doe', 'ACE Platform', 'Aug 23, 8:31 AM', 'Aug 23, 5:12 PM', '8h 41m', 'View'], ['Alice Brown', 'Client Success', 'Aug 23, 8:12 AM', 'Aug 23, 5:03 PM', '8h 51m', 'View']] },
  audit: { title: 'Audit log', description: 'Review the append-only record of important actions across the system.', stats: [['86', 'Events this week', 'brick-wall-shield'], ['14', 'Sign-ins', 'key-round'], ['3', 'Reports exported', 'download']], columns: ['When', 'Actor', 'Action', 'Entity', 'Description', 'Record'], rows: [['Aug 24, 8:04 AM', 'ACE Employee', 'CLOCK_IN', 'Time entry', 'Started a new time entry', '#104'], ['Aug 24, 8:01 AM', 'ACE Administrator', 'LOGIN', 'User', 'Signed in successfully', '#6'], ['Aug 23, 5:12 PM', 'John Doe', 'CLOCK_OUT', 'Time entry', 'Completed time entry', '#103']] }
};

function iconMarkup(name, className = 'ui-icon') { return `<img class="${className}" src="assets/icons/${name}.svg" alt="" aria-hidden="true">`; }

function statusMarkup(value) {
  const normalized = String(value).toLowerCase();
  if (!['active', 'pending', 'accepted', 'running', 'completed'].includes(normalized)) return value;
  const variant = ['active', 'accepted', 'completed'].includes(normalized) ? 'success' : 'warning';
  return `<span class="badge badge-${variant}">${value}</span>`;
}

function actionMarkup(label, rowIndex, viewKey) {
  if (viewKey === 'audit') return `<span class="record-reference">${label}</span>`;
  const icon = /view|manage|review/i.test(label) ? 'eye' : /remark|edit/i.test(label) ? 'square-pen' : /cancel/i.test(label) ? 'x' : 'mail';
  const style = /cancel/i.test(label) ? 'btn-danger' : 'btn-outline';
  return `<button class="btn btn-sm ${style} admin-row-action" type="button" data-row="${rowIndex}">${iconMarkup(icon)}${label}</button>`;
}

function buildAdminModal(view, mode, row = null) {
  let modal = document.getElementById('adminActionModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'adminActionModal'; modal.className = 'modal';
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'adminActionModalTitle');
    modal.innerHTML = `<div class="modal-content"><div class="modal-header"><h3 class="modal-title" id="adminActionModalTitle"></h3><button class="modal-close" type="button" aria-label="Close">${iconMarkup('x')}</button></div><div class="modal-body"></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector('.modal-close').addEventListener('click', () => closeModal('adminActionModal'));
    modal.addEventListener('click', event => { if (event.target === modal) closeModal('adminActionModal'); });
  }
  const isPrimary = mode === 'primary';
  const viewKey = document.body.dataset.adminView;
  const actionLabel = row?.[row.length - 1] || view.action;
  const isViewOnly = !isPrimary && /^view$/i.test(actionLabel);
  const isRemark = !isPrimary && /remark/i.test(actionLabel);
  const isConfirmation = !isPrimary && /resend|cancel/i.test(actionLabel);
  modal.querySelector('.modal-title').textContent = isPrimary ? view.action : `${actionLabel} ${view.title.toLowerCase()}`;
  const fieldConfig = {
    users: [['Email address', 'email', 'employee@ace.com'], ['Role', 'select', 'Employee'], ['Department (optional)', 'select', 'Unassigned']],
    invitations: [['Work email', 'email', 'name@ace.com'], ['Department (optional)', 'select', 'Unassigned'], ['Message (optional)', 'textarea', 'Add a short welcome message']],
    departments: [['Department name', 'text', 'e.g. Client Services'], ['Description', 'textarea', 'What does this department handle?']],
    projects: [['Project name', 'text', 'e.g. Customer Portal'], ['Description', 'textarea', 'Describe the project scope']],
    entries: [['Export format', 'select', 'CSV'], ['Date range', 'text', 'This month']],
    audit: [['Export format', 'select', 'CSV'], ['Date range', 'text', 'Last 30 days']]
  };
  const fields = isRemark ? [['Administrator remark', 'textarea', 'Add a clear internal remark for this time entry']]
    : (isViewOnly || isConfirmation) ? [] : fieldConfig[viewKey] || [];
  const rowSummary = row ? `<div class="detail-summary"><strong>${row[0]}</strong><p>${row.slice(1, -1).join(' · ')}</p></div>` : '';
  if (isViewOnly) {
    modal.querySelector('.modal-body').innerHTML = `${rowSummary}<div class="form-actions"><button class="btn btn-primary admin-modal-cancel" type="button">${iconMarkup('check')}Done</button></div>`;
    modal.querySelector('.admin-modal-cancel').addEventListener('click', () => closeModal('adminActionModal'));
    openModal('adminActionModal');
    return;
  }
  const submitLabel = isConfirmation ? actionLabel : isRemark ? 'Add remark' : isPrimary ? view.action : 'Save changes';
  modal.querySelector('.modal-body').innerHTML = `${rowSummary}<form id="adminActionForm">${fields.map(([label, type, placeholder], index) => {
    const id = `adminField${index}`;
    if (type === 'textarea') return `<div class="form-group"><label class="form-label" for="${id}">${label}</label><textarea class="form-textarea" id="${id}" placeholder="${placeholder}"></textarea></div>`;
    if (type === 'select') return `<div class="form-group"><label class="form-label" for="${id}">${label}</label><select class="form-select" id="${id}"><option>${placeholder}</option><option>Engineering</option><option>Operations</option></select></div>`;
    return `<div class="form-group"><label class="form-label" for="${id}">${label}</label><input class="form-input" id="${id}" type="${type}" placeholder="${placeholder}" required></div>`;
  }).join('')}<div class="form-actions"><button class="btn ${/cancel/i.test(submitLabel) ? 'btn-danger' : 'btn-primary'}" type="submit">${iconMarkup(isPrimary ? view.actionIcon : isRemark ? 'message-circle-more' : 'check')}${submitLabel}</button><button class="btn btn-outline admin-modal-cancel" type="button">${iconMarkup('x')}Cancel</button></div></form>`;
  modal.querySelector('.admin-modal-cancel').addEventListener('click', () => closeModal('adminActionModal'));
  modal.querySelector('form').addEventListener('submit', event => { event.preventDefault(); closeModal('adminActionModal'); showToast(`${submitLabel} completed in the frontend prototype.`, 'success'); });
  openModal('adminActionModal');
}

function renderAdminSection() {
  const view = ADMIN_SECTION_DATA[document.body.dataset.adminView];
  if (!view) return;
  document.title = `${view.title} · ACE Outsource Solutions`;
  document.getElementById('sectionTitle').textContent = view.title;
  document.getElementById('sectionDescription').textContent = view.description;
  const actionButton = document.getElementById('sectionAction');
  actionButton.hidden = !view.action;
  if (view.action) actionButton.innerHTML = `${iconMarkup(view.actionIcon)}${view.action}`;
  document.getElementById('sectionStats').innerHTML = view.stats.map(([number, label, icon]) => `<div class="stat-card"><div class="stat-icon">${iconMarkup(icon)}</div><div class="stat-info"><div class="stat-number">${number}</div><div class="stat-label">${label}</div></div></div>`).join('');
  document.getElementById('sectionTableTitle').textContent = view.title;
  document.getElementById('sectionTableHead').innerHTML = `<tr>${view.columns.map(column => `<th>${column}</th>`).join('')}</tr>`;
  const tableBody = document.getElementById('sectionTableBody');
  const tableContainer = tableBody.closest('.table-container');
  const search = document.getElementById('sectionSearch');
  search.insertAdjacentHTML('beforebegin', `<span class="result-count" id="sectionResultCount">${view.rows.length} records</span>`);
  search.parentElement.classList.add('admin-table-toolbar');
  tableContainer.insertAdjacentHTML('beforeend', `<div class="admin-pagination"><span class="result-count">Showing 1–${view.rows.length} of ${view.rows.length}</span><div class="pagination"><button type="button" disabled aria-label="Previous page">‹</button><button class="active" type="button">1</button><button type="button" disabled aria-label="Next page">›</button></div></div>`);
  tableBody.innerHTML = Array.from({ length: 4 }, () => `<tr>${view.columns.map(() => '<td><div class="skeleton skeleton-line"></div></td>').join('')}</tr>`).join('');
  window.setTimeout(() => {
    const viewKey = document.body.dataset.adminView;
    tableBody.innerHTML = view.rows.map((row, rowIndex) => `<tr>${row.map((cell, index) => `<td>${index === row.length - 1 ? actionMarkup(cell, rowIndex, viewKey) : statusMarkup(cell)}</td>`).join('')}</tr>`).join('');
    tableBody.querySelectorAll('.admin-row-action').forEach(button => button.addEventListener('click', () => buildAdminModal(view, 'row', view.rows[Number(button.dataset.row)])));
  }, 380);
  actionButton.addEventListener('click', () => {
    if (!view.action) return;
    if (/export/i.test(view.action)) { showToast(`${view.title} export prepared. File generation will connect to MongoDB in the backend phase.`, 'success'); return; }
    buildAdminModal(view, 'primary');
  });
  search.addEventListener('input', event => {
    const term = event.target.value.trim().toLowerCase(); let visible = 0;
    tableBody.querySelectorAll('tr').forEach(row => { row.hidden = !row.textContent.toLowerCase().includes(term); if (!row.hidden) visible += 1; });
    document.getElementById('sectionResultCount').textContent = `${visible} record${visible === 1 ? '' : 's'}`;
  });
}

document.addEventListener('DOMContentLoaded', renderAdminSection);
