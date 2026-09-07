async function liveRequest(path, options = {}) {
  if (!window.ACEAuth) throw new Error('Authentication service is unavailable.');
  return window.ACEAuth.request(path, options);
}

// This is interface copy only. All records and counts are live Render/Supabase data.
const ADMIN_SECTION_CONFIG = {
  users: { title: 'Users', description: 'Approve access, assign roles, and maintain employee records.', action: 'Invite user', actionIcon: 'user-plus', columns: ['Name', 'Email', 'Role', 'Department', 'Presence', 'Status', 'Action'] },
  invitations: { title: 'Pre-authorized access', description: 'Authorize a Google account as an employee or administrator before its first sign-in.', action: 'Authorize account', actionIcon: 'user-plus', columns: ['Email', 'Authorized by', 'Created', 'Expires', 'Status', 'Action'] },
  departments: { title: 'Departments', description: 'Organize employees by department. Assignments remain optional.', action: 'Add department', actionIcon: 'building', columns: ['Department', 'Description', 'Created', 'Status', 'Action'] },
  projects: { title: 'Projects', description: 'Manage projects available for optional time-entry assignment.', action: 'Add project', actionIcon: 'folder', columns: ['Project', 'Description', 'Created', 'Status', 'Action'] },
  entries: { title: 'Time entries', description: 'Review company clocking activity, recorded break time, and internal administrator remarks.', action: 'Export entries', actionIcon: 'download', columns: ['Employee', 'Project', 'Clock in', 'Clock out', 'Worked', 'Break', 'Remarks', 'Action'] },
  audit: { title: 'Audit log', description: 'Review the append-only record of important actions across the system.', columns: ['When', 'Actor', 'Action', 'Entity', 'Description', 'Record'] }
};
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const date = value => value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const time = value => value ? new Date(value).toLocaleString() : '—';
const duration = seconds => { const safe = Math.max(0, Number(seconds) || 0); return String(Math.floor(safe / 3600)).padStart(2, '0') + ':' + String(Math.floor((safe % 3600) / 60)).padStart(2, '0') + ':' + String(safe % 60).padStart(2, '0'); };
const icon = (name, className = 'ui-icon') => '<img class="' + className + '" src="assets/icons/' + name + '.svg" alt="" aria-hidden="true">';

async function applyLiveData(key, view) {
  if (key === 'users') {
    const items = await liveRequest('/v1/users');
    const onlineAfter = Date.now() - 2 * 60 * 1000;
    view.records = items.map(item => {
      const online = item.last_seen_at && new Date(item.last_seen_at).getTime() >= onlineAfter;
      return { id: item.id, cells: [item.full_name || 'Unnamed user', item.email, item.role === 'ADMIN' ? 'Admin' : 'Employee', item.departments?.name || 'Unassigned', online ? 'Online' : 'Offline', item.status[0] + item.status.slice(1).toLowerCase(), item.status === 'PENDING' ? 'Review' : 'Manage'] };
    });
    view.stats = [[items.length, 'Team members', 'users'], [items.filter(item => item.status === 'ACTIVE').length, 'Active users', 'check'], [items.filter(item => item.status === 'PENDING').length, 'Pending review', 'circle-alert']];
  } else if (key === 'invitations') {
    const items = await liveRequest('/v1/invitations');
    view.records = items.map(item => ({ id: item.id, cells: [item.email, item.profiles?.full_name || item.profiles?.email || 'Administrator', date(item.invited_at), date(item.expires_at), item.status[0] + item.status.slice(1).toLowerCase(), 'View'] }));
    view.stats = [[items.filter(item => item.status === 'PENDING').length, 'Pending', 'timer'], [items.filter(item => item.status === 'ACCEPTED').length, 'Accepted', 'check'], [items.filter(item => item.status === 'PENDING' && new Date(item.expires_at).toDateString() === new Date().toDateString()).length, 'Expires today', 'circle-alert']];
  } else if (key === 'departments' || key === 'projects') {
    const items = await liveRequest('/v1/' + key);
    view.records = items.map(item => ({ id: item.id, cells: [item.name, item.description || '—', date(item.created_at), item.is_active ? 'Active' : 'Inactive', 'Edit'] }));
    view.stats = [[items.length, 'Total ' + key, key === 'projects' ? 'folder' : 'building'], [items.filter(item => item.is_active).length, 'Active ' + key, 'check']];
  } else if (key === 'entries') {
    const [items, remarks] = await Promise.all([liveRequest('/v1/time-entries'), liveRequest('/v1/admin-remarks')]);
    const remarksByEntry = new Map();
    remarks.forEach(remark => {
      const list = remarksByEntry.get(remark.time_entry_id) || [];
      list.push(remark.remark);
      remarksByEntry.set(remark.time_entry_id, list);
    });
    const now = Date.now();
    const liveWorkedSeconds = item => Math.max(0, Math.floor((now - new Date(item.clock_in_at).getTime()) / 1000) - (item.break_seconds || 0) - (item.break_started_at ? Math.max(0, Math.floor((now - new Date(item.break_started_at).getTime()) / 1000)) : 0));
    const total = items.reduce((sum, item) => sum + (item.duration_seconds || (!item.clock_out_at ? liveWorkedSeconds(item) : 0)), 0);
    view.records = items.map(item => { const activeBreakSeconds = item.break_started_at ? Math.max(0, Math.floor((now - new Date(item.break_started_at).getTime()) / 1000)) : 0; const totalBreakSeconds = (item.break_seconds || 0) + activeBreakSeconds; return { id: item.id, cells: [item.profiles?.full_name || item.profiles?.email || 'Unknown', item.projects?.name || 'Unassigned', time(item.clock_in_at), time(item.clock_out_at), item.duration_seconds ? duration(item.duration_seconds) : item.clock_out_at ? '—' : duration(liveWorkedSeconds(item)), totalBreakSeconds ? duration(totalBreakSeconds) + (item.break_started_at ? ' (active)' : '') : '00:00:00', (remarksByEntry.get(item.id) || []).join(' · ') || '—', 'Add remark'] }; });
    view.stats = [[duration(total), 'Tracked time', 'timer'], [items.filter(item => !item.clock_out_at).length, 'Open entries', 'circle-alert'], [items.length, 'Time entries', 'check']];
  } else if (key === 'audit') {
    const items = await liveRequest('/v1/audit-logs');
    view.records = items.map(item => ({ id: item.id, cells: [time(item.created_at), item.profiles?.full_name || item.profiles?.email || 'System', item.action, item.entity_type, item.description || '—', '#' + item.id] }));
    view.stats = [[items.length, 'Recorded events', 'brick-wall-shield'], [items.filter(item => item.action === 'LOGIN').length, 'Sign-ins', 'key-round'], [items.filter(item => /REPORT/i.test(item.action)).length, 'Reports exported', 'download']];
  }
}

function status(value) {
  const normalized = String(value).toLowerCase();
  if (!['active', 'pending', 'accepted', 'running', 'completed', 'inactive', 'online', 'offline'].includes(normalized)) return esc(value);
  const type = ['active', 'accepted', 'completed', 'online'].includes(normalized) ? 'success' : ['inactive', 'offline'].includes(normalized) ? 'neutral' : 'warning';
  return '<span class="badge badge-' + type + '">' + esc(value) + '</span>';
}
function action(label, index, key) {
  if (key === 'audit') return '<span class="record-reference">' + esc(label) + '</span>';
  if (key === 'entries') return '<div class="table-actions"><button class="btn btn-sm btn-outline admin-row-action" type="button" data-row="' + index + '">' + icon('square-pen') + 'Add remark</button><button class="btn btn-sm btn-danger admin-delete-entry" type="button" data-row="' + index + '">' + icon('trash') + 'Delete</button></div>';
  const iconName = /remove/i.test(label) ? 'trash' : /view|manage|review/i.test(label) ? 'eye' : /remark|edit/i.test(label) ? 'square-pen' : 'mail';
  const style = /remove/i.test(label) ? 'btn-danger' : 'btn-outline';
  return '<button class="btn btn-sm ' + style + ' admin-row-action" type="button" data-row="' + index + '">' + icon(iconName) + esc(label) + '</button>';
}
function formField(label, type, placeholder, value, index) {
  const id = 'adminField' + index;
  if (type === 'textarea') return '<div class="form-group"><label class="form-label" for="' + id + '">' + label + '</label><textarea class="form-textarea" id="' + id + '" placeholder="' + esc(placeholder) + '">' + esc(value === '—' ? '' : value) + '</textarea></div>';
  if (type === 'user-search') {
    const users = (typeof AppState === 'undefined' ? [] : AppState.users || []).filter(user => user.Status === 'ACTIVE');
    const listId = id + 'Options';
    return '<div class="form-group"><label class="form-label" for="' + id + '">' + label + '</label><div class="input-group"><input class="form-input" id="' + id + '" type="search" list="' + listId + '" placeholder="' + esc(placeholder) + '" autocomplete="off"><button class="btn btn-outline" id="' + id + 'Add" type="button">Add</button></div><datalist id="' + listId + '">' + users.map(user => '<option value="' + esc((user.FullName || user.Email) + ' — ' + user.Email) + '" data-user-id="' + esc(user.UserId) + '"></option>').join('') + '</datalist><input id="' + id + 'Selected" type="hidden" value=""><div id="' + id + 'SelectedList" aria-live="polite">No employees selected.</div></div>';
  }
  if (type === 'select') {
    const state = typeof AppState === 'undefined' ? null : AppState;
    const options = label === 'Role' ? '<option value="USER"' + (value === 'Admin' ? '' : ' selected') + '>Employee</option><option value="ADMIN"' + (value === 'Admin' ? ' selected' : '') + '>Admin</option>'
      : label === 'Department' ? '<option value="">No department</option>' + (state?.departments || []).map(item => '<option value="' + item.DepartmentId + '"' + (value === item.DepartmentName ? ' selected' : '') + '>' + esc(item.DepartmentName) + '</option>').join('')
      : label === 'Project assignment' ? '<option value="">No project change</option>' + (state?.projects || []).filter(item => item.IsActive).map(item => '<option value="' + item.ProjectId + '">' + esc(item.ProjectName) + '</option>').join('')
      : '<option value="ACTIVE">Approve</option><option value="DENIED">Deny</option>';
    return '<div class="form-group"><label class="form-label" for="' + id + '">' + label + '</label><select class="form-select" id="' + id + '">' + options + '</select></div>';
  }
  return '<div class="form-group"><label class="form-label" for="' + id + '">' + label + '</label><input class="form-input" id="' + id + '" type="' + type + '" placeholder="' + esc(placeholder) + '" value="' + esc(value) + '" required></div>';
}
function modal(view, primary, record) {
  let node = document.getElementById('adminActionModal');
  if (!node) {
    node = document.createElement('div'); node.id = 'adminActionModal'; node.className = 'modal'; node.setAttribute('role', 'dialog'); node.setAttribute('aria-modal', 'true');
    node.innerHTML = '<div class="modal-content"><div class="modal-header"><h3 class="modal-title"></h3><button class="modal-close" type="button" aria-label="Close">' + icon('x') + '</button></div><div class="modal-body"></div></div>';
    document.body.appendChild(node); node.querySelector('.modal-close').addEventListener('click', () => closeModal('adminActionModal'));
    node.addEventListener('click', event => { if (event.target === node) closeModal('adminActionModal'); });
  }
  const key = document.body.dataset.adminView;
  const label = record?.cells.at(-1) || view.action;
  const edit = !primary && ['departments', 'projects'].includes(key);
  const remark = !primary && key === 'entries';
  const review = !primary && key === 'users' && /^review$/i.test(label);
  const manage = !primary && key === 'users' && /^manage$/i.test(label);
  const remove = !primary && key === 'users' && /^remove$/i.test(label);
  const deleteRecord = !primary && (key === 'departments' || key === 'projects' || key === 'entries');
  const fields = remark ? [['Administrator remark', 'textarea', 'Add a clear internal remark for this time entry']]
    : primary && ['users', 'invitations'].includes(key) ? [['Work email', 'email', 'name@example.com'], ['Role', 'select', 'USER']]
      : (primary || edit) && key === 'departments' ? [['Department name', 'text', 'e.g. Client Services'], ['Description', 'textarea', 'What does this department handle?'], ...(edit ? [['Add employee (optional)', 'user-search', 'Search by employee name or email']] : [])]
        : (primary || edit) && key === 'projects' ? [['Project name', 'text', 'e.g. Customer Portal'], ['Description', 'textarea', 'Describe the project scope']]
          : manage ? [['Role', 'select', 'USER'], ['Department', 'select', ''], ['Project assignment', 'select', '']] : review ? [['Approval', 'select', 'ACTIVE']] : [];
  node.querySelector('.modal-title').textContent = primary ? view.action : label + ' ' + view.title.toLowerCase();
  const summary = record ? '<div class="detail-summary"><strong>' + esc(record.cells[0]) + '</strong><p>' + record.cells.slice(1, -1).map(esc).join(' · ') + '</p></div>' : '';
  if (!fields.length) {
    node.querySelector('.modal-body').innerHTML = summary + (remove ? '<p class="modal-description">Archiving immediately blocks access while preserving time records and audit history.</p><div class="form-actions"><button class="btn btn-danger admin-remove-user" type="button">' + icon('folder') + 'Archive user</button><button class="btn btn-outline admin-modal-cancel" type="button">' + icon('x') + 'Cancel</button></div>' : '<div class="form-actions"><button class="btn btn-primary admin-modal-cancel" type="button">' + icon('check') + 'Done</button></div>');
    node.querySelector('.admin-modal-cancel').addEventListener('click', () => closeModal('adminActionModal'));
    node.querySelector('.admin-remove-user')?.addEventListener('click', async () => {
      try {
        await liveRequest('/v1/users/' + record.id + '/remove', { method: 'PATCH' });
        closeModal('adminActionModal'); showToast('User access removed.', 'success'); window.setTimeout(() => window.location.reload(), 350);
      } catch (error) { showToast(error.message || 'Could not archive user.', 'error'); }
    });
    openModal('adminActionModal'); return;
  }
  const buttonLabel = remark ? 'Add remark' : review ? 'Save decision' : manage ? 'Save role' : primary ? view.action : 'Save changes';
  node.querySelector('.modal-body').innerHTML = summary + '<form id="adminActionForm">' + fields.map((field, index) => formField(field[0], field[1], field[2], edit ? record.cells[index] : manage ? (index === 0 ? record.cells[2] : index === 1 ? record.cells[3] : '') : '', index)).join('') + '<div class="form-actions"><button class="btn btn-primary" type="submit">' + icon('check') + buttonLabel + '</button>' + (manage ? '<button class="btn btn-danger admin-remove-user" type="button">' + icon('folder') + 'Archive user</button>' : '') + (deleteRecord ? '<button class="btn btn-danger admin-delete-record" type="button">' + icon('trash') + 'Delete</button>' : '') + '<button class="btn btn-outline admin-modal-cancel" type="button">' + icon('x') + 'Cancel</button></div></form>';
  const employeePicker = node.querySelector('#adminField2Add');
  if (employeePicker) {
    const search = document.getElementById('adminField2');
    const selectedInput = document.getElementById('adminField2Selected');
    const selectedList = document.getElementById('adminField2SelectedList');
    const selectedUsers = [];
    const renderSelectedUsers = () => {
      selectedInput.value = selectedUsers.map(user => user.id).join(',');
      selectedList.innerHTML = selectedUsers.length ? selectedUsers.map(user => '<button class="btn btn-sm btn-outline remove-department-user" type="button" data-id="' + esc(user.id) + '">' + esc(user.name) + ' ×</button>').join(' ') : 'No employees selected.';
      selectedList.querySelectorAll('.remove-department-user').forEach(button => button.addEventListener('click', () => {
        const index = selectedUsers.findIndex(user => user.id === button.dataset.id);
        if (index >= 0) selectedUsers.splice(index, 1);
        renderSelectedUsers();
      }));
    };
    employeePicker.addEventListener('click', () => {
      const option = Array.from(document.getElementById('adminField2Options')?.options || []).find(item => item.value === search.value);
      const userId = option?.dataset.userId;
      if (!userId) { showToast('Choose an employee from the search list first.', 'warning'); return; }
      if (!selectedUsers.some(user => user.id === userId)) selectedUsers.push({ id: userId, name: option.value });
      search.value = '';
      renderSelectedUsers();
    });
  }
  node.querySelector('.admin-modal-cancel').addEventListener('click', () => closeModal('adminActionModal'));
  node.querySelector('.admin-remove-user')?.addEventListener('click', async () => {
    try { await liveRequest('/v1/users/' + record.id + '/remove', { method: 'PATCH' }); closeModal('adminActionModal'); showToast('User moved to Archived users.', 'success'); window.setTimeout(() => window.location.reload(), 350); }
    catch (error) { showToast(error.message || 'Could not archive user.', 'error'); }
  });
  node.querySelector('.admin-delete-record')?.addEventListener('click', async () => {
    try {
      const path = key === 'entries' ? '/v1/time-entries/' + record.id : '/v1/' + key + '/' + record.id;
      await liveRequest(path, { method: 'DELETE' });
      closeModal('adminActionModal'); showToast('Record deleted.', 'success'); window.setTimeout(() => window.location.reload(), 350);
    } catch (error) { showToast(error.message || 'Could not delete record.', 'error'); }
  });
  node.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const first = document.getElementById('adminField0').value;
      if (primary && ['users', 'invitations'].includes(key)) await liveRequest('/v1/invitations', { method: 'POST', body: JSON.stringify({ email: first, role: document.getElementById('adminField1').value }) });
      else if (key === 'departments') {
        const userIds = (document.getElementById('adminField2Selected')?.value || '').split(',').filter(Boolean);
        const department = await liveRequest(edit ? '/v1/departments/' + record.id : '/v1/departments', { method: edit ? 'PATCH' : 'POST', body: JSON.stringify({ name: first, description: document.getElementById('adminField1').value }) });
        await Promise.all(userIds.map(userId => liveRequest('/v1/users/' + userId + '/department', { method: 'PATCH', body: JSON.stringify({ departmentId: department.id }) })));
      }
      else if (key === 'projects') await liveRequest(edit ? '/v1/projects/' + record.id : '/v1/projects', { method: edit ? 'PATCH' : 'POST', body: JSON.stringify({ name: first, description: document.getElementById('adminField1').value }) });
      else if (remark) await liveRequest('/v1/time-entries/' + record.id + '/remarks', { method: 'POST', body: JSON.stringify({ remark: first }) });
      else if (manage) {
        await liveRequest('/v1/users/' + record.id + '/role', { method: 'PATCH', body: JSON.stringify({ role: first }) });
        await liveRequest('/v1/users/' + record.id + '/department', { method: 'PATCH', body: JSON.stringify({ departmentId: document.getElementById('adminField1').value || null }) });
        const projectId = document.getElementById('adminField2').value;
        if (projectId) await liveRequest('/v1/users/' + record.id + '/projects/' + projectId, { method: 'PUT' });
      }
      else if (review) await liveRequest('/v1/users/' + record.id + '/approval', { method: 'PATCH', body: JSON.stringify({ status: first }) });
      closeModal('adminActionModal'); showToast('Saved to the live database.', 'success'); window.setTimeout(() => window.location.reload(), 350);
    } catch (error) { showToast(error.message || 'Could not save changes.', 'error'); }
  });
  openModal('adminActionModal');
}
function downloadCsv(records) {
  const rows = [['Employee', 'Project', 'Clock in', 'Clock out', 'Worked', 'Break'], ...records.map(record => record.cells.slice(0, 6))];
  const csv = rows.map(row => row.map(cell => '"' + String(cell).replaceAll('"', '""') + '"').join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'ace-time-entries.csv'; link.click(); URL.revokeObjectURL(url);
}
async function renderAdminSection() {
  const key = document.body.dataset.adminView; const config = ADMIN_SECTION_CONFIG[key]; if (!config) return;
  const view = { ...config, records: [], stats: [] };
  try { await applyLiveData(key, view); } catch (error) { showToast(error.message || 'Could not load live data.', 'error'); }
  document.title = view.title + ' · ACE Outsource Solutions';
  document.getElementById('sectionTitle').textContent = view.title; document.getElementById('sectionDescription').textContent = view.description;
  const actionButton = document.getElementById('sectionAction'); actionButton.hidden = !view.action;
  if (view.action) actionButton.innerHTML = icon(view.actionIcon) + view.action;
  document.getElementById('sectionStats').innerHTML = view.stats.map(item => '<div class="stat-card"><div class="stat-icon">' + icon(item[2]) + '</div><div class="stat-info"><div class="stat-number">' + esc(item[0]) + '</div><div class="stat-label">' + esc(item[1]) + '</div></div></div>').join('');
  document.getElementById('sectionTableTitle').textContent = view.title;
  document.getElementById('sectionTableHead').innerHTML = '<tr>' + view.columns.map(column => '<th>' + esc(column) + '</th>').join('') + '</tr>';
  const body = document.getElementById('sectionTableBody');
  const draw = records => {
    body.innerHTML = records.length ? records.map((record, rowIndex) => '<tr>' + record.cells.map((cell, index) => '<td>' + (index === record.cells.length - 1 ? action(cell, rowIndex, key) : status(cell)) + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="' + view.columns.length + '">No ' + view.title.toLowerCase() + ' found.</td></tr>';
    body.querySelectorAll('.admin-row-action').forEach(button => button.addEventListener('click', () => modal(view, false, records[Number(button.dataset.row)])));
    body.querySelectorAll('.admin-delete-entry').forEach(button => button.addEventListener('click', async () => {
      const record = records[Number(button.dataset.row)];
      if (!record || !window.confirm('Move this time entry to Deleted time entries? You can restore it later.')) return;
      try {
        await liveRequest('/v1/time-entries/' + record.id, { method: 'DELETE' });
        showToast('Time entry moved to Deleted time entries.', 'success');
        window.setTimeout(() => window.location.reload(), 350);
      } catch (error) {
        showToast(error.message || 'Could not delete this time entry.', 'error');
      }
    }));
  };
  draw(view.records);
  const search = document.getElementById('sectionSearch'); const count = document.getElementById('sectionResultCount') || document.createElement('span');
  count.id = 'sectionResultCount'; count.className = 'result-count'; search.insertAdjacentElement('beforebegin', count);
  const setCount = records => { count.textContent = records.length + ' record' + (records.length === 1 ? '' : 's'); }; setCount(view.records);
  actionButton.addEventListener('click', () => /export/i.test(view.action) ? downloadCsv(view.records) : modal(view, true));
  search.addEventListener('input', event => { const term = event.target.value.trim().toLowerCase(); const records = view.records.filter(record => record.cells.join(' ').toLowerCase().includes(term)); draw(records); setCount(records); });
}
document.addEventListener('DOMContentLoaded', renderAdminSection);
