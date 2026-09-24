// Akio <3: Project source maintained by Akio Zaki Salomon.
async function liveRequest(path, options = {}) {
  if (!window.ACEAuth) throw new Error('Authentication service is unavailable.');
  return window.ACEAuth.request(path, options);
}

// This is interface copy only. All records and counts are live Render/Supabase data.
const ADMIN_SECTION_CONFIG = {
  users: { title: 'Users', description: 'Approve access, assign roles, and maintain employee records.', action: 'Invite user', actionIcon: 'user-plus', columns: ['Name', 'Email', 'Role', 'Department', 'Presence', 'Last online', 'Status', 'Action'] },
  invitations: { title: 'Pre-authorized access', description: 'Invite an employee or administrator before their first sign-in.', action: 'Invite user', actionIcon: 'user-plus', columns: ['Email', 'Authorized by', 'Created', 'Expires', 'Status', 'Action'] },
  departments: { title: 'Departments', description: 'Organize employees by department. Assignments remain optional.', action: 'Add department', actionIcon: 'building', columns: ['Department', 'Description', 'Created', 'Status', 'Action'] },
  projects: { title: 'Projects', description: 'Manage projects available for optional time-entry assignment.', action: 'Add project', actionIcon: 'folder', columns: ['Project', 'Description', 'Created', 'Status', 'Action'] },
  entries: { title: 'Time entries', description: 'Review company clocking activity and internal administrator remarks.', action: 'Export entries', actionIcon: 'download', columns: ['Employee', 'Project', 'Clock in', 'Clock out', 'Worked', 'Approved overtime', 'Remarks', 'Actions'] },
  audit: { title: 'Audit log', description: 'Review the append-only record of important actions across the system.', columns: ['When', 'Actor', 'Action', 'Entity', 'Description', 'Record'] }
};
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const date = value => value ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value)) : '—';
const time = value => value ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)) : '—';
const lastOnline = (value, online) => {
  if (online) return 'Online now';
  const timestamp = new Date(value).getTime();
  if (!value || Number.isNaN(timestamp)) return 'No activity yet';
  const minutes = Math.max(1, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return `Last seen ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last seen ${hours}h ago`;
  return 'Last seen ' + date(value);
};
const humanizeEnum = value => String(value || '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
const auditAction = value => { const [action, ...suffix] = String(value || '').split(' '); return ({ CLOCK_IN: 'Clocked in', CLOCK_OUT: 'Clocked out' }[action] || humanizeEnum(action)) + (suffix.length ? ` ${suffix.join(' ')}` : ''); };
const duration = seconds => { const safe = Math.max(0, Number(seconds) || 0); return String(Math.floor(safe / 3600)).padStart(2, '0') + ':' + String(Math.floor((safe % 3600) / 60)).padStart(2, '0') + ':' + String(safe % 60).padStart(2, '0'); };
const icon = (name, className = 'ui-icon') => '<img class="' + className + '" src="assets/icons/' + name + '.svg" alt="" aria-hidden="true">';
const emptyTable = (title, message, colspan) => '<tr class="table-empty-row"><td colspan="' + colspan + '"><div class="empty-state empty-state-compact"><div class="empty-state-icon">' + icon('folder') + '</div><h3>' + esc(title) + '</h3><p>' + esc(message) + '</p></div></td></tr>';

async function applyLiveData(key, view, pageState = null, filters = {}) {
  if (key === 'users') {
    const params = new URLSearchParams();
    if (pageState) { params.set('page', pageState.page); params.set('pageSize', pageState.size); }
    if (filters.q) params.set('q', filters.q);
    if (filters.role) params.set('role', filters.role);
    if (filters.departmentId) params.set('departmentId', filters.departmentId);
    const response = await liveRequest('/v1/users' + (params.size ? '?' + params.toString() : ''));
    const items = response.items || response; view.total = response.total ?? items.length;
    const onlineAfter = Date.now() - 2 * 60 * 1000;
    view.records = items.map(item => {
      const online = item.last_seen_at && new Date(item.last_seen_at).getTime() >= onlineAfter;
      return { id: item.id, email: item.email, isHeadAdmin: Boolean(item.is_head_admin), avatarUrl: item.profile_picture_url || '', cells: [item.full_name || 'Unnamed user', item.email, item.role === 'ADMIN' ? 'Admin' : 'Employee', item.departments?.name || '—', online ? 'Online' : 'Offline', lastOnline(item.last_seen_at, online), item.status[0] + item.status.slice(1).toLowerCase(), item.status === 'PENDING' ? 'Review' : 'Manage'] };
    });
    view.stats = [[items.filter(item => item.status === 'ACTIVE' && item.last_seen_at && new Date(item.last_seen_at).getTime() >= onlineAfter).length, 'Currently online', 'users'], [items.filter(item => item.status === 'ACTIVE').length, 'Active users', 'check'], [items.filter(item => item.status === 'PENDING').length, 'Pending review', 'circle-alert']];
  } else if (key === 'invitations') {
    const params = new URLSearchParams(); if (pageState) { params.set('page', pageState.page); params.set('pageSize', pageState.size); } if (filters.q) params.set('q', filters.q);
    const response = await liveRequest('/v1/invitations' + (params.size ? '?' + params : '')); const items = response.items || response; view.total = response.total ?? items.length;
    view.records = items.map(item => ({ id: item.id, cells: [item.email, item.profiles?.full_name || item.profiles?.email || 'Administrator', date(item.invited_at), date(item.expires_at), item.status[0] + item.status.slice(1).toLowerCase(), 'View'] }));
    view.stats = [[items.filter(item => item.status === 'PENDING').length, 'Pending', 'timer'], [items.filter(item => item.status === 'ACCEPTED').length, 'Accepted', 'check'], [items.filter(item => item.status === 'PENDING' && new Date(item.expires_at).toDateString() === new Date().toDateString()).length, 'Expires today', 'circle-alert']];
  } else if (key === 'departments' || key === 'projects') {
    const params = new URLSearchParams(); if (pageState) { params.set('page', pageState.page); params.set('pageSize', pageState.size); } if (filters.q) params.set('q', filters.q);
    const response = await liveRequest('/v1/' + key + (params.size ? '?' + params : '')); const items = response.items || response; view.total = response.total ?? items.length;
    view.records = items.map(item => ({ id: item.id, cells: [item.name, item.description || '—', date(item.created_at), item.is_active ? 'Active' : 'Inactive', 'Edit'] }));
    view.stats = [[items.length, 'Total ' + key, key === 'projects' ? 'folder' : 'building'], [items.filter(item => item.is_active).length, 'Active ' + key, 'check']];
  } else if (key === 'entries') {
    const params = new URLSearchParams();
    if (pageState) { params.set('page', pageState.page); params.set('pageSize', pageState.size); }
    if (filters.q) params.set('q', filters.q);
    if (filters.status) params.set('status', filters.status);
    if (filters.employee) params.set('employee', filters.employee);
    if (filters.project) params.set('project', filters.project);
    if (filters.remarks) params.set('remarks', filters.remarks);
    const response = await liveRequest('/v1/time-entries' + (params.size ? '?' + params.toString() : ''));
    const items = response.items || response; view.total = response.total ?? items.length;
    const remarks = items.length ? await liveRequest('/v1/admin-remarks?timeEntryIds=' + encodeURIComponent(items.map(item => item.id).join(','))) : [];
    const remarksByEntry = new Map();
    remarks.forEach(remark => {
      const list = remarksByEntry.get(remark.time_entry_id) || [];
      list.push({
        id: remark.id,
        text: remark.remark,
        admin: remark.profiles?.full_name || remark.profiles?.email || 'Administrator',
        createdAt: remark.created_at,
        seenAt: remark.seen_at
      });
      remarksByEntry.set(remark.time_entry_id, list);
    });
    const now = Date.now();
    const liveWorkedSeconds = item => Math.max(0, Math.floor((now - new Date(item.clock_in_at).getTime()) / 1000));
    const total = items.reduce((sum, item) => sum + (item.duration_seconds || (!item.clock_out_at ? liveWorkedSeconds(item) : 0)), 0);
    view.records = items.map(item => { const entryRemarks = remarksByEntry.get(item.id) || []; return { id: item.id, userId: item.user_id, userRole: item.profiles?.role, clockInAt: item.clock_in_at, clockOutAt: item.clock_out_at, scheduledEndTime: item.scheduled_end_time, scheduleType: item.schedule_type, overtimeApprovedSeconds: item.overtime_approved_seconds || 0, overtimeApprovedAt: item.overtime_approved_at, remarks: entryRemarks, cells: [item.profiles?.full_name || item.profiles?.email || 'Unknown', item.projects?.name || '—', time(item.clock_in_at), time(item.clock_out_at), item.duration_seconds ? duration(item.duration_seconds) : item.clock_out_at ? '—' : duration(liveWorkedSeconds(item)), item.overtime_approved_seconds ? duration(item.overtime_approved_seconds) : '—', entryRemarks.length ? `${entryRemarks.length} remark${entryRemarks.length === 1 ? '' : 's'}` : '—', 'Add remark'] }; });
    view.stats = [[duration(total), 'Tracked time', 'timer'], [items.filter(item => !item.clock_out_at).length, 'Open entries', 'circle-alert'], [items.length, 'Time entries', 'check']];
  } else if (key === 'audit') {
    const params = new URLSearchParams(); if (pageState) { params.set('page', pageState.page); params.set('pageSize', pageState.size); } if (filters.q) params.set('q', filters.q);
    const response = await liveRequest('/v1/audit-logs' + (params.size ? '?' + params : '')); const items = response.items || response; view.total = response.total ?? items.length;
    view.records = items.map(item => ({ id: item.id, cells: [time(item.created_at), item.profiles?.full_name || item.profiles?.email || 'System', auditAction(item.action), humanizeEnum(item.entity_type), item.description || '—', '#' + item.id] }));
    view.stats = [[items.length, 'Recorded events', 'brick-wall-shield'], [items.filter(item => item.action === 'LOGIN').length, 'Sign-ins', 'key-round'], [items.filter(item => /REPORT/i.test(item.action)).length, 'Reports exported', 'download']];
  }
}

function status(value) {
  const normalized = String(value).toLowerCase();
  if (!['active', 'pending', 'accepted', 'running', 'completed', 'inactive', 'online', 'offline'].includes(normalized)) return esc(value);
  const type = ['active', 'accepted', 'completed', 'online'].includes(normalized) ? 'success' : ['inactive', 'offline'].includes(normalized) ? 'neutral' : 'warning';
  return '<span class="badge badge-' + type + '">' + esc(value) + '</span>';
}
function action(label, index, key, record) {
  if (key === 'audit') return '<button class="btn btn-sm btn-outline admin-audit-details-open" type="button" data-row="' + index + '">' + icon('eye') + 'View event</button>';
  if (key === 'entries') {
    const canApprove = record.clockOutAt && record.scheduleType === 'FIXED' && record.scheduledEndTime && !record.overtimeApprovedAt;
    return '<div class="admin-entry-action-set"><button class="btn btn-sm btn-outline admin-entry-actions-toggle" type="button" aria-expanded="false" aria-haspopup="menu">Actions ' + icon('chevron-down') + '</button><div class="admin-entry-action-menu" role="menu" hidden>' +
      (canApprove ? '<button class="admin-approve-overtime" type="button" role="menuitem" data-row="' + index + '">' + icon('check') + 'Approve overtime</button>' : '') +
      '<button class="admin-entry-details-open" type="button" role="menuitem" data-row="' + index + '">' + icon('eye') + 'View details</button>' +
      '<button class="admin-edit-entry-time" type="button" role="menuitem" data-row="' + index + '">' + icon('square-pen') + 'Correct time</button><button class="admin-entry-remarks-open" type="button" role="menuitem" data-row="' + index + '">' + icon('message-circle-more') + (record.remarks?.length ? 'Open feedback' : 'Add remark') + '</button><button class="admin-delete-entry is-danger" type="button" role="menuitem" data-row="' + index + '">' + icon('trash') + 'Move to deleted</button></div><button class="btn btn-sm btn-outline admin-mobile-details-toggle" type="button" aria-expanded="false">Details</button></div>';
  }
  if (key === 'users') {
    const canViewEmployee = record?.cells?.[2] === 'Employee';
    const headTarget = record?.isHeadAdmin;
    const canManage = !headTarget || Boolean(typeof AppState !== 'undefined' && AppState.currentUser?.IsHeadAdmin);
    if (!canViewEmployee && !canManage) return '<span class="record-reference">Head administrator</span>';
    return '<div class="admin-user-action-set"><button class="btn btn-sm btn-outline admin-user-actions-toggle" type="button" aria-expanded="false" aria-haspopup="menu">Actions ' + icon('chevron-down') + '</button><div class="admin-user-action-menu" role="menu" hidden>' +
      (canViewEmployee ? '<button class="admin-view-employee" type="button" role="menuitem" data-row="' + index + '">' + icon('eye') + 'View employee</button>' : '') +
      (canManage ? '<button class="admin-row-action" type="button" role="menuitem" data-row="' + index + '">' + icon('settings') + 'Manage account</button>' : '') +
      '</div><button class="btn btn-sm btn-outline admin-mobile-details-toggle" type="button" aria-expanded="false">Details</button></div>';
  }
  if (key === 'departments' || key === 'projects') return '<div class="table-actions">' + (key === 'projects' ? '<button class="btn btn-sm btn-outline admin-project-details-open" type="button" data-row="' + index + '">' + icon('eye') + 'View</button>' : '') + '<button class="btn btn-sm btn-outline admin-row-action" type="button" data-row="' + index + '">' + icon('square-pen') + 'Edit</button><button class="btn btn-sm btn-danger admin-delete-section" type="button" data-row="' + index + '">' + icon('trash') + 'Delete</button></div>';
  const iconName = /remove/i.test(label) ? 'trash' : /view|manage|review/i.test(label) ? 'eye' : /remark|edit/i.test(label) ? 'square-pen' : 'mail';
  const style = /remove/i.test(label) ? 'btn-danger' : 'btn-outline';
  return '<div class="table-actions"><button class="btn btn-sm ' + style + ' admin-row-action" type="button" data-row="' + index + '">' + icon(iconName) + esc(label) + '</button></div>';
}
function formField(label, type, placeholder, value, index) {
  const id = 'adminField' + index;
  if (type === 'textarea') return '<div class="form-group"><label class="form-label" for="' + id + '">' + label + '</label><textarea class="form-textarea" id="' + id + '" placeholder="' + esc(placeholder) + '">' + esc(value === '—' ? '' : value) + '</textarea></div>';
  if (type === 'user-search') {
    const users = (typeof AppState === 'undefined' ? [] : AppState.users || []).filter(user => user.Status === 'ACTIVE' && user.Role === 'USER');
    const listId = id + 'Options';
    return '<div class="form-group"><label class="form-label" for="' + id + '">' + label + '</label><div class="input-group"><input class="form-input" id="' + id + '" type="search" list="' + listId + '" placeholder="' + esc(placeholder) + '" autocomplete="off"><button class="btn btn-outline" id="' + id + 'Add" type="button">Add</button></div><datalist id="' + listId + '">' + users.map(user => '<option value="' + esc((user.FullName || user.Email) + ' — ' + user.Email) + '" data-user-id="' + esc(user.UserId) + '"></option>').join('') + '</datalist><input id="' + id + 'Selected" type="hidden" value=""><div id="' + id + 'SelectedList" aria-live="polite">No employees selected.</div></div>';
  }
  if (type === 'select') {
    const state = typeof AppState === 'undefined' ? null : AppState;
    const options = label === 'Role' ? '<option value="USER"' + (value === 'Admin' ? '' : ' selected') + '>Employee</option><option value="ADMIN"' + (value === 'Admin' ? ' selected' : '') + '>Admin</option>'
      : label === 'Department' ? '<option value="">No department</option>' + (state?.departments || []).map(item => '<option value="' + item.DepartmentId + '"' + (value === item.DepartmentName ? ' selected' : '') + '>' + esc(item.DepartmentName) + '</option>').join('')
      : label === 'Project assignment' ? '<option value="">No project change</option>' + (state?.projects || []).filter(item => item.IsActive).map(item => '<option value="' + item.ProjectId + '">' + esc(item.ProjectName) + '</option>').join('')
      : label.includes('Schedule') ? '<option value="">Leave schedule unchanged</option>'
      : '<option value="ACTIVE">Approve</option><option value="DENIED">Deny</option>';
    return '<div class="form-group"><label class="form-label" for="' + id + '">' + label + '</label><select class="form-select" id="' + id + '">' + options + '</select></div>';
  }
  return '<div class="form-group"><label class="form-label" for="' + id + '">' + label + '</label><input class="form-input" id="' + id + '" type="' + type + '" placeholder="' + esc(placeholder) + '" value="' + esc(value) + '" required></div>';
}

function openEntryFeedback(record) {
  let node = document.getElementById('adminEntryFeedbackModal');
  if (!node) {
    node = document.createElement('div');
    node.id = 'adminEntryFeedbackModal';
    node.className = 'modal';
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-modal', 'true');
    document.body.appendChild(node);
    node.addEventListener('click', event => { if (event.target === node) closeModal(node.id); });
  }
  const feedback = [...(record.remarks || [])].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const history = feedback.length
    ? feedback.map(remark => '<article class="entry-feedback-item"><header><strong>' + esc(remark.admin) + '</strong><time datetime="' + esc(remark.createdAt) + '">' + time(remark.createdAt) + '</time></header><p>' + esc(remark.text) + '</p><small class="admin-remark-read-status ' + (remark.seenAt ? 'is-seen' : 'is-unseen') + '">' + icon(remark.seenAt ? 'check' : 'circle-alert') + (remark.seenAt ? 'Seen by employee' : 'Not seen by employee yet') + '</small></article>').join('')
    : '<div class="empty-state empty-state-compact"><div class="empty-state-icon">' + icon('message-circle-more') + '</div><h3>No feedback yet</h3><p>Add the first comment for this time entry.</p></div>';
  node.innerHTML = '<div class="modal-content modal-lg"><div class="modal-header"><div><p class="admin-section-kicker">TIME ENTRY FEEDBACK</p><h3 class="modal-title">' + esc(record.cells[0]) + '</h3><p class="modal-description">' + esc(record.cells[1]) + ' · ' + esc(record.cells[2]) + '</p></div><button class="modal-close" type="button" aria-label="Close">' + icon('x') + '</button></div><div class="modal-body"><section class="entry-feedback-history" aria-label="Feedback history">' + history + '</section><form id="adminEntryFeedbackForm" class="entry-feedback-form"><div class="form-group"><label class="form-label" for="entryFeedbackText">Add a follow-up comment</label><textarea class="form-textarea" id="entryFeedbackText" maxlength="2000" required placeholder="Add clear feedback for the employee about this time entry"></textarea></div><div class="form-actions"><button class="btn btn-primary" type="submit">' + icon('message-circle-plus') + 'Post comment</button><button class="btn btn-outline admin-feedback-cancel" type="button">Cancel</button></div></form></div></div>';
  node.querySelector('.modal-close').addEventListener('click', () => closeModal(node.id));
  node.querySelector('.admin-feedback-cancel').addEventListener('click', () => closeModal(node.id));
  node.querySelector('#adminEntryFeedbackForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    const remark = node.querySelector('#entryFeedbackText').value.trim();
    if (!remark || button.disabled) return;
    button.disabled = true;
    button.textContent = 'Posting…';
    try {
      await liveRequest('/v1/time-entries/' + record.id + '/remarks', { method: 'POST', body: JSON.stringify({ remark }) });
      closeModal(node.id);
      showToast('Feedback posted. The employee will be notified.', 'success');
      renderAdminSection();
    } catch (error) {
      showToast(error.message || 'Could not post feedback.', 'error');
      button.disabled = false;
      button.innerHTML = icon('message-circle-plus') + 'Post comment';
    }
  });
  openModal(node.id);
}

function editEntryTime(record) {
  const asLocalInput = value => {
    const date = new Date(value || Date.now());
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  };
  let node = document.getElementById('adminTimeCorrectionModal');
  if (!node) {
    node = document.createElement('div'); node.id = 'adminTimeCorrectionModal'; node.className = 'modal'; node.setAttribute('role', 'dialog'); node.setAttribute('aria-modal', 'true');
    document.body.appendChild(node);
    node.addEventListener('click', event => { if (event.target === node) closeModal(node.id); });
  }
  node.innerHTML = '<div class="modal-content"><div class="modal-header"><h3 class="modal-title">Correct employee time</h3><button class="modal-close" type="button" aria-label="Close">' + icon('x') + '</button></div><div class="modal-body"><p class="modal-description">Use this only to correct an employee’s recorded time, such as a missed clock-out caused by an outage.</p><div class="detail-summary"><strong>' + esc(record.cells[0]) + '</strong><p>' + esc(record.cells[1]) + '</p></div><form id="adminTimeCorrectionForm"><div class="form-group"><label class="form-label" for="correctClockIn">Clock in</label><input class="form-input" id="correctClockIn" type="datetime-local" value="' + asLocalInput(record.clockInAt) + '" required></div><div class="form-group"><label class="form-label" for="correctClockOut">Clock out</label><input class="form-input" id="correctClockOut" type="datetime-local" value="' + asLocalInput(record.clockOutAt) + '" required></div><div class="form-actions"><button class="btn btn-primary" type="submit">' + icon('check') + 'Save corrected time</button><button class="btn btn-outline admin-time-cancel" type="button">' + icon('x') + 'Cancel</button></div></form></div></div>';
  node.querySelector('.modal-close').addEventListener('click', () => closeModal(node.id));
  node.querySelector('.admin-time-cancel').addEventListener('click', () => closeModal(node.id));
  node.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const clockInAt = new Date(node.querySelector('#correctClockIn').value);
    const clockOutAt = new Date(node.querySelector('#correctClockOut').value);
    if (Number.isNaN(clockInAt.getTime()) || Number.isNaN(clockOutAt.getTime()) || clockOutAt < clockInAt) { showToast('Clock-out must be after clock-in.', 'warning'); return; }
    try {
      await liveRequest('/v1/time-entries/' + record.id + '/admin-time', { method: 'PATCH', body: JSON.stringify({ clockInAt: clockInAt.toISOString(), clockOutAt: clockOutAt.toISOString() }) });
      closeModal(node.id); showToast('Employee time corrected.', 'success'); window.setTimeout(() => window.location.reload(), 400);
    } catch (error) { showToast(error.message || 'Could not correct this time entry.', 'error'); }
  });
  openModal(node.id);
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
  const cancelInvitation = !primary && key === 'invitations' && /^view$/i.test(label);
  const deleteRecord = !primary && (key === 'departments' || key === 'projects' || key === 'entries');
  const fields = remark ? [['Administrator remark', 'textarea', 'Add a clear internal remark for this time entry']]
    : primary && ['users', 'invitations'].includes(key) ? [['Work email', 'email', 'name@example.com'], ['Role', 'select', 'USER']]
        : (primary || edit) && key === 'departments' ? [['Department name', 'text', 'e.g. Client Services'], ['Description', 'textarea', 'What does this department handle?'], ...(edit ? [['Add employee (optional)', 'user-search', 'Search by employee name or email'], ['Schedule for selected employees (optional)', 'select', '']] : [])]
        : (primary || edit) && key === 'projects' ? [['Project name', 'text', 'e.g. Customer Portal'], ['Description', 'textarea', 'Describe the project scope'], ...(edit ? [['Add employee (optional)', 'user-search', 'Search by employee name or email'], ['Schedule for selected employees (optional)', 'select', '']] : [])]
          : manage ? [['Role', 'select', 'USER'], ['Department', 'select', ''], ['Project assignment', 'select', ''], ['Schedule assignment', 'select', '']] : review ? [['Approval', 'select', 'ACTIVE']] : [];
  node.querySelector('.modal-title').textContent = primary ? view.action : label + ' ' + view.title.toLowerCase();
  const summary = record ? '<div class="detail-summary"><strong>' + esc(record.cells[0]) + '</strong><p>' + record.cells.slice(1, -1).map(esc).join(' · ') + '</p></div>' : '';
  if (!fields.length) {
    node.querySelector('.modal-body').innerHTML = summary + (remove ? '<p class="modal-description">Archiving immediately blocks access while preserving time records and audit history.</p><div class="form-actions"><button class="btn btn-danger admin-remove-user" type="button">' + icon('folder') + 'Archive user</button><button class="btn btn-outline admin-modal-cancel" type="button">' + icon('x') + 'Cancel</button></div>' : cancelInvitation ? '<p class="modal-description">Cancelling removes this pending authorization. You can invite this email again whenever you need to.</p><div class="form-actions"><button class="btn btn-danger admin-cancel-invitation" type="button">' + icon('x') + 'Cancel invitation</button><button class="btn btn-outline admin-modal-cancel" type="button">' + icon('check') + 'Done</button></div>' : '<div class="form-actions"><button class="btn btn-primary admin-modal-cancel" type="button">' + icon('check') + 'Done</button></div>');
    node.querySelector('.admin-modal-cancel').addEventListener('click', () => closeModal('adminActionModal'));
    node.querySelector('.admin-remove-user')?.addEventListener('click', async () => {
      try {
        await liveRequest('/v1/users/' + record.id + '/remove', { method: 'PATCH' });
        closeModal('adminActionModal'); showToast('User access removed.', 'success'); window.setTimeout(() => window.location.reload(), 350);
      } catch (error) { showToast(error.message || 'Could not archive user.', 'error'); }
    });
    node.querySelector('.admin-cancel-invitation')?.addEventListener('click', async () => {
      const cancelButton = node.querySelector('.admin-cancel-invitation');
      if (cancelButton?.disabled) return;
      const originalLabel = cancelButton?.innerHTML;
      if (cancelButton) {
        cancelButton.disabled = true;
        cancelButton.setAttribute('aria-busy', 'true');
        cancelButton.textContent = 'Cancelling…';
      }
      try {
        await liveRequest('/v1/invitations/' + record.id, { method: 'DELETE' });
        closeModal('adminActionModal');
        showToast('Invitation cancelled. This email can be invited again.', 'success');
        // Preserve the success message and remove the record immediately.
        renderAdminSection().catch(error => console.error('Could not refresh invitations after cancellation.', error));
      } catch (error) {
        showToast(error.message || 'Could not cancel this invitation.', 'error');
        if (cancelButton) {
          cancelButton.disabled = false;
          cancelButton.removeAttribute('aria-busy');
          cancelButton.innerHTML = originalLabel;
        }
      }
    });
    openModal('adminActionModal'); return;
  }
  const buttonLabel = remark ? 'Add remark' : review ? 'Save decision' : manage ? 'Save role' : primary ? view.action : 'Save changes';
  node.querySelector('.modal-body').innerHTML = summary + '<form id="adminActionForm">' + fields.map((field, index) => formField(field[0], field[1], field[2], edit ? record.cells[index] : manage ? (index === 0 ? record.cells[2] : index === 1 ? record.cells[3] : '') : '', index)).join('') + '<div class="form-actions"><button class="btn btn-primary" type="submit">' + icon('check') + buttonLabel + '</button>' + (manage ? '<button class="btn btn-danger admin-remove-user" type="button">' + icon('folder') + 'Archive user</button>' : '') + (deleteRecord ? '<button class="btn btn-danger admin-delete-record" type="button">' + icon('trash') + 'Delete</button>' : '') + '<button class="btn btn-outline admin-modal-cancel" type="button">' + icon('x') + 'Cancel</button></div></form>';
  if (manage || (edit && (key === 'departments' || key === 'projects'))) {
    const scheduleSelect = document.getElementById('adminField3');
    liveRequest('/v1/schedules').then(schedules => {
      const assigned = manage ? schedules.find(schedule => (schedule.user_schedule_assignments || []).some(assignment => String(assignment.user_id) === String(record.id))) : null;
      scheduleSelect.innerHTML = '<option value="">' + (manage ? 'Leave schedule unchanged' : 'Do not change schedules') + '</option>' + (manage ? '<option value="__REMOVE__">Remove schedule</option>' : '') + schedules.filter(schedule => schedule.is_active).map(schedule => '<option value="' + esc(schedule.id) + '"' + (assigned?.id === schedule.id ? ' selected' : '') + '>' + esc(schedule.name) + '</option>').join('');
    }).catch(() => { scheduleSelect.innerHTML = '<option value="">Schedule list unavailable</option>'; });
  }
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
    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    // A slow email/database response used to leave this button active, making a
    // second click look like the first invitation had failed.
    if (submitButton?.disabled) return;
    const originalSubmitLabel = submitButton?.innerHTML;
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
      submitButton.textContent = 'Saving…';
    }
    try {
      const first = document.getElementById('adminField0').value;
      let invitation;
      if (primary && ['users', 'invitations'].includes(key)) invitation = await liveRequest('/v1/invitations', { method: 'POST', body: JSON.stringify({ email: first, role: document.getElementById('adminField1').value }) });
      else if (key === 'departments') {
        const userIds = (document.getElementById('adminField2Selected')?.value || '').split(',').filter(Boolean);
        const department = await liveRequest(edit ? '/v1/departments/' + record.id : '/v1/departments', { method: edit ? 'PATCH' : 'POST', body: JSON.stringify({ name: first, description: document.getElementById('adminField1').value }) });
        await Promise.all(userIds.map(userId => liveRequest('/v1/users/' + userId + '/department', { method: 'PATCH', body: JSON.stringify({ departmentId: department.id }) })));
        const scheduleId = document.getElementById('adminField3')?.value;
        if (scheduleId) await Promise.all(userIds.map(userId => liveRequest('/v1/users/' + userId + '/schedule', { method: 'PUT', body: JSON.stringify({ scheduleId }) })));
      }
      else if (key === 'projects') {
        const project = await liveRequest(edit ? '/v1/projects/' + record.id : '/v1/projects', { method: edit ? 'PATCH' : 'POST', body: JSON.stringify({ name: first, description: document.getElementById('adminField1').value }) });
        const userIds = (document.getElementById('adminField2Selected')?.value || '').split(',').filter(Boolean);
        await Promise.all(userIds.map(userId => liveRequest('/v1/users/' + userId + '/projects/' + project.id, { method: 'PUT' })));
        const scheduleId = document.getElementById('adminField3')?.value;
        if (scheduleId) await Promise.all(userIds.map(userId => liveRequest('/v1/users/' + userId + '/schedule', { method: 'PUT', body: JSON.stringify({ scheduleId }) })));
      }
      else if (remark) await liveRequest('/v1/time-entries/' + record.id + '/remarks', { method: 'POST', body: JSON.stringify({ remark: first }) });
      else if (manage) {
        await liveRequest('/v1/users/' + record.id + '/role', { method: 'PATCH', body: JSON.stringify({ role: first }) });
        await liveRequest('/v1/users/' + record.id + '/department', { method: 'PATCH', body: JSON.stringify({ departmentId: document.getElementById('adminField1').value || null }) });
        const projectId = document.getElementById('adminField2').value;
        if (projectId) await liveRequest('/v1/users/' + record.id + '/projects/' + projectId, { method: 'PUT' });
        const scheduleId = document.getElementById('adminField3').value;
        if (scheduleId) await liveRequest('/v1/users/' + record.id + '/schedule', { method: 'PUT', body: JSON.stringify({ scheduleId: scheduleId === '__REMOVE__' ? null : scheduleId }) });
      }
      else if (review) await liveRequest('/v1/users/' + record.id + '/approval', { method: 'PATCH', body: JSON.stringify({ status: first }) });
      closeModal('adminActionModal');
      if (invitation) {
        const message = invitation.email_sent
          ? `Invitation added for ${invitation.email}. An onboarding email was sent.`
          : `Invitation added for ${invitation.email}. Access is ready, but the onboarding email was not delivered: ${invitation.email_issue || 'check the email service settings.'}`;
        // A mail issue is useful context, but the invitation itself succeeded.
        showToast(message, 'success');
        // Keep the confirmation visible and update the records without a page
        // reload, so the newly added invitation is immediately verifiable.
        renderAdminSection().catch(error => console.error('Could not refresh invitations after creation.', error));
      } else {
        showToast('Saved to the live database.', 'success');
        window.setTimeout(() => window.location.reload(), 350);
      }
    } catch (error) {
      showToast(error.message || 'Could not save changes.', 'error');
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.removeAttribute('aria-busy');
        submitButton.innerHTML = originalSubmitLabel;
      }
    }
  });
  openModal('adminActionModal');
}
function downloadCsv(records) {
  const rows = [['Employee', 'Project', 'Clock in', 'Clock out', 'Worked'], ...records.map(record => record.cells.slice(0, 5))];
  const csv = rows.map(row => row.map(cell => '"' + String(cell).replaceAll('"', '""') + '"').join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'ace-time-entries.csv'; link.click(); URL.revokeObjectURL(url);
}
function openTimeEntryExport(records) {
  const existing = document.getElementById('timeEntryExportModal');
  existing?.remove();
  const users = [...new Map(records.map(record => [record.userId, record.cells[0]])).entries()].filter(([id]) => id);
  const projects = [...new Map(records.map(record => [record.cells[1], record.cells[1]])).keys()].filter(name => name && name !== '—');
  const today = new Date(); const from = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10); const to = today.toISOString().slice(0, 10);
  const modal = document.createElement('div');
  modal.id = 'timeEntryExportModal'; modal.className = 'modal'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'timeEntryExportTitle');
  modal.innerHTML = '<div class="modal-content"><div class="modal-header"><div><p class="eyebrow">TIME ENTRIES</p><h3 class="modal-title" id="timeEntryExportTitle">Export entries</h3></div><button class="modal-close" type="button" aria-label="Close">' + icon('x') + '</button></div><form class="modal-body" id="timeEntryExportForm"><p class="modal-description">Choose the entries to include, then save a PDF or Excel workbook.</p><div class="form-grid"><div class="form-group"><label class="form-label" for="exportDateFrom">From</label><input class="form-input" id="exportDateFrom" type="date" value="' + from + '" required></div><div class="form-group"><label class="form-label" for="exportDateTo">To</label><input class="form-input" id="exportDateTo" type="date" value="' + to + '" required></div><div class="form-group"><label class="form-label" for="exportEntryEmployee">Employee</label><select class="form-select" id="exportEntryEmployee"><option value="">All employees</option>' + users.map(([id, name]) => '<option value="' + esc(id) + '">' + esc(name) + '</option>').join('') + '</select></div><div class="form-group"><label class="form-label" for="exportEntryProject">Project</label><select class="form-select" id="exportEntryProject"><option value="">All projects</option>' + projects.map(name => { const project = (AppState.projects || []).find(item => item.ProjectName === name); return '<option value="' + esc(project?.ProjectId || '') + '">' + esc(name) + '</option>'; }).join('') + '</select></div><div class="form-group"><label class="form-label" for="exportEntryStatus">Status</label><select class="form-select" id="exportEntryStatus"><option value="">All entries</option><option value="COMPLETED">Completed</option><option value="ACTIVE">Active</option></select></div></div><p class="export-entry-summary" id="exportEntrySummary"></p><div class="form-actions"><button class="btn btn-outline" type="button" data-export-format="XLSX">' + icon('download') + 'Save Excel</button><button class="btn btn-primary" type="button" data-export-format="PDF">' + icon('printer') + 'Save as PDF</button></div></form></div>';
  document.body.appendChild(modal);
  const close = () => closeModal(modal.id); modal.querySelector('.modal-close').addEventListener('click', close); modal.addEventListener('click', event => { if (event.target === modal) close(); });
  const read = () => ({ dateFrom: modal.querySelector('#exportDateFrom').value, dateTo: modal.querySelector('#exportDateTo').value, filters: { userId: modal.querySelector('#exportEntryEmployee').value, projectId: modal.querySelector('#exportEntryProject').value, status: modal.querySelector('#exportEntryStatus').value } });
  const updateSummary = () => { const config = read(); const count = (window.filterEntriesForReport ? window.filterEntriesForReport({ DateFrom: config.dateFrom, DateTo: config.dateTo, Filters: config.filters }) : []).length; modal.querySelector('#exportEntrySummary').textContent = count + ' entr' + (count === 1 ? 'y' : 'ies') + ' will be included.'; };
  modal.querySelectorAll('input, select').forEach(input => input.addEventListener('change', updateSummary));
  modal.querySelectorAll('[data-export-format]').forEach(button => button.addEventListener('click', () => { const config = read(); if (config.dateTo < config.dateFrom) return showToast('The end date must be on or after the start date.', 'warning'); const count = (window.filterEntriesForReport ? window.filterEntriesForReport({ DateFrom: config.dateFrom, DateTo: config.dateTo, Filters: config.filters }) : []).length; void liveRequest('/v1/time-entry-exports', { method: 'POST', body: JSON.stringify({ format: button.dataset.exportFormat, dateFrom: config.dateFrom, dateTo: config.dateTo, count }) }).catch(() => {}); window.ACEReportActions.preview({ ...config, format: button.dataset.exportFormat }); close(); }));
  updateSummary(); openModal(modal.id);
}

function openAdminDetailsDrawer({ eyebrow, title, fields, href, trigger, avatarUrl = '' }) {
  let drawer = document.getElementById('adminDetailsDrawer');
  if (!drawer) {
    drawer = document.createElement('div');
    drawer.id = 'adminDetailsDrawer';
    drawer.className = 'admin-details-drawer';
    drawer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(drawer);
  }
  const close = () => {
    drawer.classList.remove('is-open'); drawer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('drawer-open'); document.removeEventListener('keydown', drawer._onKeydown);
    drawer._trigger?.focus?.();
  };
  drawer._trigger = trigger || document.activeElement;
  drawer._onKeydown = event => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
  const isEmployee = eyebrow === 'Employee';
  drawer.classList.toggle('is-employee-drawer', isEmployee);
  const identity = isEmployee ? '<div class="admin-details-drawer-identity"><span class="admin-details-drawer-avatar">' + (avatarUrl ? '<img src="' + esc(avatarUrl) + '" alt="">' : esc(String(title).trim().slice(0, 1).toUpperCase())) + '</span><div><p class="admin-section-kicker">' + esc(eyebrow) + '</p><h2 id="adminDetailsDrawerTitle">' + esc(title) + '</h2><span class="admin-details-drawer-status">' + esc(fields.find(([label]) => label === 'Account status')?.[1] || 'Active') + '</span></div></div>' : '<div><p class="admin-section-kicker">' + esc(eyebrow) + '</p><h2 id="adminDetailsDrawerTitle">' + esc(title) + '</h2></div>';
  drawer.innerHTML = '<button class="admin-details-drawer-backdrop" type="button" aria-label="Close details"></button><aside class="admin-details-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="adminDetailsDrawerTitle"><header>' + identity + '<button class="modal-close" type="button" aria-label="Close details">' + icon('x') + '</button></header><section class="admin-details-drawer-section"><p>ACCOUNT DETAILS</p><dl>' + fields.map(([label, value]) => '<div><dt>' + esc(label) + '</dt><dd' + (label === 'Presence' || label === 'Account status' ? ' class="is-status"' : '') + '>' + esc(value || '—') + '</dd></div>').join('') + '</dl></section>' + (href ? '<footer><a class="btn btn-primary admin-details-drawer-link" href="' + esc(href) + '">Open full profile</a></footer>' : '') + '</aside>';
  drawer.querySelectorAll('.modal-close,.admin-details-drawer-backdrop').forEach(button => button.addEventListener('click', close));
  drawer.classList.add('is-open'); drawer.setAttribute('aria-hidden', 'false'); document.body.classList.add('drawer-open');
  document.addEventListener('keydown', drawer._onKeydown);
  requestAnimationFrame(() => drawer.querySelector('.modal-close')?.focus());
}

function openDeletedTimeEntriesModal(trigger) {
  let modal = document.getElementById('deletedTimeEntriesModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'deletedTimeEntriesModal';
    modal.className = 'modal deleted-entries-modal';
    modal.innerHTML = '<div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="deletedEntriesTitle"><div class="modal-header"><div><p class="admin-section-kicker">TIME ENTRIES</p><h3 class="modal-title" id="deletedEntriesTitle">Deleted entries</h3><p class="modal-description">Restore an entry when it was removed by mistake, or permanently delete it when retention is no longer required.</p></div><button class="modal-close" type="button" aria-label="Close deleted entries">' + icon('x') + '</button></div><div class="modal-body"><div class="table-responsive"><table class="table"><thead><tr><th>Employee</th><th>Project</th><th>Clocked in</th><th>Worked</th><th>Actions</th></tr></thead><tbody id="deletedEntriesModalBody"><tr><td colspan="5">Loading deleted entries…</td></tr></tbody></table></div></div><div class="modal-footer"><button class="btn btn-outline deleted-entries-close" type="button">Close</button></div></div>';
    document.body.appendChild(modal);
  }
  const close = () => { closeModal(modal.id); trigger?.focus?.(); };
  modal.querySelectorAll('.modal-close,.deleted-entries-close').forEach(button => { button.onclick = close; });
  modal.onclick = event => { if (event.target === modal) close(); };
  const body = modal.querySelector('#deletedEntriesModalBody');
  const render = async () => {
    body.innerHTML = '<tr><td colspan="5"><div class="empty-state empty-state-compact"><p>Loading deleted entries…</p></div></td></tr>';
    try {
      const response = await liveRequest('/v1/time-entries?removed=true&page=1&pageSize=100');
      const entries = response.items || response;
      body.innerHTML = entries.length ? entries.map(entry => '<tr><td><strong>' + esc(entry.profiles?.full_name || entry.profiles?.email || 'Unknown') + '</strong></td><td>' + esc(entry.projects?.name || 'No project') + '</td><td>' + esc(time(entry.clock_in_at)) + '</td><td>' + esc(duration(entry.duration_seconds || 0)) + '</td><td><div class="table-actions"><button class="btn btn-sm btn-outline deleted-entry-restore" type="button" data-id="' + esc(entry.id) + '">' + icon('check') + 'Restore</button><button class="btn btn-sm btn-danger deleted-entry-permanent" type="button" data-id="' + esc(entry.id) + '">' + icon('trash') + 'Delete permanently</button></div></td></tr>').join('') : emptyTable('No deleted time entries', 'Entries moved to Deleted will appear here.', 5);
      body.querySelectorAll('.deleted-entry-restore').forEach(button => button.addEventListener('click', async () => {
        try { await liveRequest('/v1/time-entries/' + button.dataset.id + '/restore', { method: 'PATCH' }); showToast('Time entry restored.', 'success'); await render(); }
        catch (error) { showToast(error.message || 'Could not restore this time entry.', 'error'); }
      }));
      body.querySelectorAll('.deleted-entry-permanent').forEach(button => button.addEventListener('click', async () => {
        if (!await window.ACEUI.confirm({ title: 'Delete time entry permanently?', message: 'This cannot be undone.', confirmLabel: 'Delete permanently', danger: true })) return;
        try { await liveRequest('/v1/time-entries/' + button.dataset.id + '/permanent', { method: 'DELETE' }); showToast('Time entry permanently deleted.', 'success'); await render(); }
        catch (error) { showToast(error.message || 'Could not permanently delete this time entry.', 'error'); }
      }));
    } catch (error) { body.innerHTML = '<tr><td colspan="5"><div class="empty-state empty-state-compact"><h3>Could not load deleted entries</h3><p>' + esc(error.message || 'Please try again.') + '</p></div></td></tr>'; }
  };
  openModal(modal.id); void render();
}

async function renderAdminSection() {
  const key = document.body.dataset.adminView; const config = ADMIN_SECTION_CONFIG[key]; if (!config) return;
  const serverPaged = ['users', 'entries', 'invitations', 'departments', 'projects', 'audit'].includes(key);
  const stateKey = 'ace_admin_page_state_' + key;
  let savedState = {};
  try { savedState = JSON.parse(sessionStorage.getItem(stateKey) || '{}'); } catch { savedState = {}; }
  const pageState = { page: Number(savedState.page) || 1, size: Number(savedState.size) || 25 };
  const activeFilters = { ...(savedState.filters || {}) };
  const persistState = () => sessionStorage.setItem(stateKey, JSON.stringify({ page: pageState.page, size: pageState.size, filters: activeFilters }));
  // A live redraw must not stack filters or click handlers from the previous
  // pass. It only runs while no form or dialog is being edited.
  document.querySelectorAll('.admin-user-filters').forEach(node => node.remove());
  const existingAction = document.getElementById('sectionAction');
  if (existingAction?.parentNode) existingAction.parentNode.replaceChild(existingAction.cloneNode(true), existingAction);
  const existingSearch = document.getElementById('sectionSearch');
  if (existingSearch?.parentNode) existingSearch.parentNode.replaceChild(existingSearch.cloneNode(true), existingSearch);
  document.getElementById('deletedTimeEntriesButton')?.remove();
  const view = { ...config, records: [], stats: [], total: 0 };
  try { await applyLiveData(key, view, serverPaged ? pageState : null, activeFilters); } catch (error) { showToast(error.message || 'Could not load live data.', 'error'); }
  document.title = view.title + ' · ACE Outsource Solutions';
  document.getElementById('sectionTitle').textContent = view.title; document.getElementById('sectionDescription').textContent = view.description;
  const tabGroups = {
    users: [['Users', 'users.html'], ['Invitations', 'invitations.html']],
    invitations: [['Users', 'users.html'], ['Invitations', 'invitations.html']],
    projects: [['Projects', 'projects.html'], ['Schedules', 'schedule-flex.html'], ['Time entries', 'admin-time-entries.html']],
    entries: [['Projects', 'projects.html'], ['Schedules', 'schedule-flex.html'], ['Time entries', 'admin-time-entries.html']],
    departments: [['Departments', 'departments.html']],
    audit: [['Audit log', 'audit-logs.html']]
  };
  const tabs = tabGroups[key] || [];
  let tabBar = document.getElementById('adminSectionTabs');
  if (tabs.length > 1) {
    if (!tabBar) { tabBar = document.createElement('nav'); tabBar.id = 'adminSectionTabs'; tabBar.className = 'admin-section-tabs'; tabBar.setAttribute('aria-label', 'Related workspace pages'); document.querySelector('.admin-section-header').insertAdjacentElement('afterend', tabBar); }
    const activeHref = { users: 'users.html', invitations: 'invitations.html', projects: 'projects.html', entries: 'admin-time-entries.html' }[key];
    tabBar.innerHTML = tabs.map(([label, href]) => '<a href="' + href + '"' + (href === activeHref ? ' aria-current="page"' : '') + '>' + esc(label) + '</a>').join('');
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!connection?.saveData && !/2g/.test(connection?.effectiveType || '')) {
      tabs.filter(([, href]) => href !== activeHref).forEach(([, href]) => {
        if (document.head.querySelector(`link[rel="prefetch"][href$="${href}"]`)) return;
        const preload = document.createElement('link');
        preload.rel = 'prefetch';
        preload.href = href;
        document.head.appendChild(preload);
      });
    }
  } else tabBar?.remove();
  const actionButton = document.getElementById('sectionAction'); actionButton.hidden = !view.action;
  if (view.action) actionButton.innerHTML = icon(view.actionIcon) + view.action;
  if (key === 'entries') {
    const deletedButton = document.createElement('button');
    deletedButton.id = 'deletedTimeEntriesButton';
    deletedButton.className = 'btn btn-outline';
    deletedButton.type = 'button';
    deletedButton.innerHTML = icon('trash') + 'Deleted entries';
    actionButton.insertAdjacentElement('beforebegin', deletedButton);
    deletedButton.addEventListener('click', () => openDeletedTimeEntriesModal(deletedButton));
  }
  const renderStats = () => { document.getElementById('sectionStats').innerHTML = view.stats.map(item => '<div class="stat-card"><div class="stat-icon">' + icon(item[2]) + '</div><div class="stat-info"><div class="stat-number">' + esc(item[0]) + '</div><div class="stat-label">' + esc(item[1]) + '</div></div></div>').join(''); };
  renderStats();
  const tableTitle = document.getElementById('sectionTableTitle'); tableTitle.textContent = view.title;
  document.getElementById('sectionTableHead').innerHTML = '<tr>' + view.columns.map(column => '<th>' + esc(column) + '</th>').join('') + '</tr>';
  const body = document.getElementById('sectionTableBody');
  let visibleRecords = [];
  let loadPage = null;
  let pager = document.getElementById('sectionPagination');
  if (!pager) { pager = document.createElement('div'); pager.id = 'sectionPagination'; pager.className = 'admin-pagination'; body.closest('.table-responsive').insertAdjacentElement('afterend', pager); }
  const draw = records => {
    visibleRecords = records;
    const totalRecords = serverPaged ? view.total : records.length;
    const pages = Math.max(1, Math.ceil(totalRecords / pageState.size));
    pageState.page = Math.min(pageState.page, pages);
    const start = serverPaged ? (pageState.page - 1) * pageState.size : (pageState.page - 1) * pageState.size;
    const pageRecords = serverPaged ? records : records.slice(start, start + pageState.size);
    const emptyCopy = {
      users: ['No people yet', 'Invite your first employee or administrator to get started.'],
      invitations: ['No invitations yet', 'Invite someone when you are ready to add them to the workspace.'],
      departments: ['No departments yet', 'Create a department to organize your team.'],
      projects: ['No projects yet', 'Create a project before assigning work to it.'],
      entries: ['No time entries yet', 'Employee clock-ins will appear here for review.'],
      audit: ['No activity yet', 'Important workspace actions will appear here.']
    }[key] || ['Nothing here yet', 'New records will appear here.'];
    body.innerHTML = records.length ? pageRecords.map((record, rowIndex) => '<tr class="' + (key === 'entries' || key === 'users' ? 'admin-collapsible-row' : '') + '">' + record.cells.map((cell, index) => { const isEmployeeName = (key === 'users' && index === 0 && record.cells[2] === 'Employee') || (key === 'entries' && index === 0 && record.userRole === 'USER'); const nameCell = isEmployeeName ? '<a class="admin-employee-profile-link" href="employee-profile.html?user=' + encodeURIComponent(key === 'users' ? record.id : record.userId) + '">' + esc(cell) + '</a>' : '<strong>' + esc(cell) + '</strong>'; return '<td' + (key === 'entries' && index === 6 ? ' class="admin-entry-remarks"' : '') + '>' + (index === record.cells.length - 1 ? action(cell, rowIndex, key, record) : key === 'entries' && index === 6 ? (record.remarks?.length ? record.remarks.map(remark => '<article class="admin-entry-remark"><strong>' + esc(remark.admin) + '</strong><span>' + esc(remark.text) + '</span><small class="admin-remark-read-status ' + (remark.seenAt ? 'is-seen' : 'is-unseen') + '">' + icon(remark.seenAt ? 'check' : 'circle-alert') + (remark.seenAt ? 'Seen ' + time(remark.seenAt) : 'Not seen yet') + '</small></article>').join('') : '—') : key === 'users' && index === 0 ? '<span class="admin-user-identity"><span class="admin-user-avatar">' + (record.avatarUrl ? '<img src="' + esc(record.avatarUrl) + '" alt="">' : esc(String(cell).trim().slice(0, 1).toUpperCase())) + '</span>' + nameCell + '</span>' : key === 'entries' && index === 0 ? nameCell : status(cell)) + '</td>'; }).join('') + '</tr>').join('') : emptyTable(emptyCopy[0], emptyCopy[1], view.columns.length);
    const pageList = [...new Set([1, pageState.page - 1, pageState.page, pageState.page + 1, pages].filter(page => page >= 1 && page <= pages))];
    pager.innerHTML = totalRecords > pageState.size ? '<span>Showing ' + (start + 1) + '–' + Math.min(start + pageState.size, totalRecords) + ' of ' + totalRecords + '</span><div class="pagination"><label class="sr-only" for="sectionPageSize">Rows per page</label><select class="form-select" id="sectionPageSize"><option value="25"' + (pageState.size === 25 ? ' selected' : '') + '>25</option><option value="50"' + (pageState.size === 50 ? ' selected' : '') + '>50</option><option value="100"' + (pageState.size === 100 ? ' selected' : '') + '>100</option></select><button type="button" data-section-page="' + (pageState.page - 1) + '" ' + (pageState.page === 1 ? 'disabled' : '') + ' aria-label="Previous page">‹</button>' + pageList.map(page => '<button type="button" data-section-page="' + page + '" class="' + (page === pageState.page ? 'active' : '') + '" aria-current="' + (page === pageState.page ? 'page' : 'false') + '">' + page + '</button>').join('') + '<button type="button" data-section-page="' + (pageState.page + 1) + '" ' + (pageState.page === pages ? 'disabled' : '') + ' aria-label="Next page">›</button></div>' : '';
    pager.querySelectorAll('[data-section-page]').forEach(button => button.addEventListener('click', () => { pageState.page = Number(button.dataset.sectionPage); persistState(); serverPaged ? loadPage?.() : draw(visibleRecords); }));
    pager.querySelector('#sectionPageSize')?.addEventListener('change', event => { pageState.size = Number(event.target.value); pageState.page = 1; persistState(); serverPaged ? loadPage?.() : draw(visibleRecords); });
    const actionMenuFor = set => set._actionMenu || set.querySelector('.admin-entry-action-menu,.admin-user-action-menu');
    const closeActionMenu = set => {
      const menu = actionMenuFor(set);
      set.classList.remove('is-open');
      set.querySelector('.admin-entry-actions-toggle,.admin-user-actions-toggle')?.setAttribute('aria-expanded', 'false');
      if (!menu) return;
      menu.hidden = true;
      menu.classList.remove('admin-action-menu-popover');
      menu.removeAttribute('style');
      set.append(menu);
      delete set._actionMenu;
    };
    const openActionMenu = (set, button) => {
      const menu = actionMenuFor(set);
      if (!menu) return;
      set._actionMenu = menu;
      menu.hidden = false;
      menu.classList.add('admin-action-menu-popover');
      document.body.append(menu);
      const buttonRect = button.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const left = Math.max(10, Math.min(buttonRect.right - menuRect.width, window.innerWidth - menuRect.width - 10));
      const below = buttonRect.bottom + 7;
      const top = below + menuRect.height <= window.innerHeight - 10 ? below : Math.max(10, buttonRect.top - menuRect.height - 7);
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
      set.classList.add('is-open');
      button.setAttribute('aria-expanded', 'true');
    };
    const menuItems = menu => menu ? [...menu.querySelectorAll('button:not([disabled])')] : [];
    const moveMenuFocus = (menu, current, direction) => {
      const items = menuItems(menu); if (!items.length) return;
      const index = Math.max(0, items.indexOf(current));
      items[(index + direction + items.length) % items.length].focus();
    };
    const bindMenuKeyboard = (button, set) => {
      const menu = actionMenuFor(set); if (!menu) return;
      button.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (!set.classList.contains('is-open')) openActionMenu(set, button);
          const items = menuItems(menu); (event.key === 'ArrowDown' ? items[0] : items[items.length - 1])?.focus();
        } else if (event.key === 'Escape' && set.classList.contains('is-open')) {
          event.preventDefault(); closeActionMenu(set); button.focus();
        }
      });
      menu.addEventListener('keydown', event => {
        const item = event.target.closest('button');
        if (event.key === 'Escape') { event.preventDefault(); closeActionMenu(set); button.focus(); }
        else if (event.key === 'ArrowDown' && item) { event.preventDefault(); moveMenuFocus(menu, item, 1); }
        else if (event.key === 'ArrowUp' && item) { event.preventDefault(); moveMenuFocus(menu, item, -1); }
        else if (event.key === 'Home') { event.preventDefault(); menuItems(menu)[0]?.focus(); }
        else if (event.key === 'End') { event.preventDefault(); const items = menuItems(menu); items[items.length - 1]?.focus(); }
      });
    };
    const closeEntryActionMenus = except => body.querySelectorAll('.admin-entry-action-set.is-open').forEach(item => { if (item !== except) closeActionMenu(item); });
    body.querySelectorAll('.admin-entry-actions-toggle').forEach(button => button.addEventListener('click', event => {
      event.stopPropagation(); const set = button.closest('.admin-entry-action-set'); const open = !set.classList.contains('is-open'); closeEntryActionMenus(set); body.querySelectorAll('.admin-user-action-set.is-open').forEach(closeActionMenu); if (open) openActionMenu(set, button); else closeActionMenu(set);
    }));
    body.querySelectorAll('.admin-entry-actions-toggle').forEach(button => bindMenuKeyboard(button, button.closest('.admin-entry-action-set')));
    const closeUserActionMenus = except => body.querySelectorAll('.admin-user-action-set.is-open').forEach(item => { if (item !== except) closeActionMenu(item); });
    body.querySelectorAll('.admin-user-actions-toggle').forEach(button => button.addEventListener('click', event => {
      event.stopPropagation(); const set = button.closest('.admin-user-action-set'); const open = !set.classList.contains('is-open'); closeUserActionMenus(set); body.querySelectorAll('.admin-entry-action-set.is-open').forEach(closeActionMenu); if (open) openActionMenu(set, button); else closeActionMenu(set);
    }));
    body.querySelectorAll('.admin-user-actions-toggle').forEach(button => bindMenuKeyboard(button, button.closest('.admin-user-action-set')));
    if (!document.body.dataset.entryActionMenuCloseBound) {
      document.body.dataset.entryActionMenuCloseBound = 'true';
      document.addEventListener('click', event => { if (!event.target.closest('.admin-entry-action-set,.admin-user-action-set,.admin-action-menu-popover')) document.querySelectorAll('.admin-entry-action-set.is-open,.admin-user-action-set.is-open').forEach(closeActionMenu); });
      window.addEventListener('resize', () => document.querySelectorAll('.admin-entry-action-set.is-open,.admin-user-action-set.is-open').forEach(closeActionMenu));
      window.addEventListener('scroll', () => document.querySelectorAll('.admin-entry-action-set.is-open,.admin-user-action-set.is-open').forEach(closeActionMenu), true);
    }
    const dismissActionMenu = button => {
      const set = button.closest('.admin-entry-action-set,.admin-user-action-set') || [...body.querySelectorAll('.admin-entry-action-set,.admin-user-action-set')].find(item => item._actionMenu?.contains(button));
      if (set) closeActionMenu(set);
    };
    body.querySelectorAll('.admin-row-action').forEach(button => button.addEventListener('click', () => { dismissActionMenu(button); modal(view, false, pageRecords[Number(button.dataset.row)]); }));
    body.querySelectorAll('.admin-entry-remarks-open').forEach(button => button.addEventListener('click', () => { dismissActionMenu(button); openEntryFeedback(pageRecords[Number(button.dataset.row)]); }));
    body.querySelectorAll('.admin-entry-details-open').forEach(button => button.addEventListener('click', () => {
      dismissActionMenu(button);
      const record = pageRecords[Number(button.dataset.row)]; if (!record) return;
      openAdminDetailsDrawer({ eyebrow: 'Time entry', title: record.cells[0], trigger: button, href: 'time-entry-details.html?entry=' + encodeURIComponent(record.id), fields: [['Project', record.cells[1]], ['Clocked in', record.clockInAt ? time(record.clockInAt) : record.cells[2]], ['Clocked out', record.clockOutAt ? time(record.clockOutAt) : record.cells[3]], ['Worked', record.cells[4]], ['Overtime', record.cells[5]], ['Remarks', record.cells[6]]] });
    }));
    body.querySelectorAll('.admin-project-details-open').forEach(button => button.addEventListener('click', () => {
      dismissActionMenu(button);
      const record = pageRecords[Number(button.dataset.row)]; if (!record) return;
      openAdminDetailsDrawer({ eyebrow: 'Project', title: record.cells[0], trigger: button, fields: [['Description', record.cells[1]], ['Created', record.cells[2]], ['Status', record.cells[3]], ['Project ID', record.id]] });
    }));
    body.querySelectorAll('.admin-audit-details-open').forEach(button => button.addEventListener('click', () => {
      dismissActionMenu(button);
      const record = pageRecords[Number(button.dataset.row)]; if (!record) return;
      openAdminDetailsDrawer({ eyebrow: 'Audit event', title: record.cells[2], trigger: button, fields: [['When', record.cells[0]], ['Actor', record.cells[1]], ['Entity', record.cells[3]], ['Description', record.cells[4]], ['Record', record.cells[5]]] });
    }));
    body.querySelectorAll('.admin-edit-entry-time').forEach(button => button.addEventListener('click', () => { dismissActionMenu(button); editEntryTime(pageRecords[Number(button.dataset.row)]); }));
    body.querySelectorAll('.admin-approve-overtime').forEach(button => button.addEventListener('click', async () => { dismissActionMenu(button); const record = pageRecords[Number(button.dataset.row)]; if (!record || !await window.ACEUI.confirm({ title: 'Approve overtime?', message: 'Only time after the scheduled end will be approved as overtime.', confirmLabel: 'Approve overtime' })) return; try { const entry = await liveRequest('/v1/time-entries/' + record.id + '/overtime/approve', { method: 'POST' }); record.overtimeApprovedSeconds = entry.overtime_approved_seconds || 0; showToast('Overtime approved.', 'success'); renderAdminSection(); } catch (error) { showToast(error.message || 'Could not approve overtime.', 'error'); } }));
    body.querySelectorAll('.admin-view-employee').forEach(button => button.addEventListener('click', () => {
      dismissActionMenu(button);
      const record = pageRecords[Number(button.dataset.row)];
      if (!record) return;
      openAdminDetailsDrawer({ eyebrow: 'Employee', title: record.cells[0], trigger: button, avatarUrl: record.avatarUrl, href: 'employee-profile.html?user=' + encodeURIComponent(record.id), fields: [['Email', record.cells[1]], ['Role', record.cells[2]], ['Department', record.cells[3]], ['Presence', record.cells[4]], ['Last online', record.cells[5]], ['Account status', record.cells[6]]] });
    }));
    body.querySelectorAll('.admin-delete-entry').forEach(button => button.addEventListener('click', async () => {
      dismissActionMenu(button);
      const record = pageRecords[Number(button.dataset.row)];
      if (!record || !await window.ACEUI.confirm({ title: 'Move time entry to Deleted?', message: 'You can restore it later from Deleted time entries.', confirmLabel: 'Move to Deleted', danger: true })) return;
      try {
        await liveRequest('/v1/time-entries/' + record.id, { method: 'DELETE' });
        showToast('Time entry moved to Deleted time entries.', 'success');
        window.setTimeout(() => window.location.reload(), 350);
      } catch (error) {
        showToast(error.message || 'Could not delete this time entry.', 'error');
      }
    }));
    body.querySelectorAll('.admin-delete-section').forEach(button => button.addEventListener('click', async () => {
      dismissActionMenu(button);
      const record = pageRecords[Number(button.dataset.row)];
      if (!record || !await window.ACEUI.confirm({ title: `Delete ${key.slice(0, -1)}?`, message: `Delete ${record.cells[0]}? This cannot be undone.`, confirmLabel: 'Delete', danger: true })) return;
      try { await liveRequest('/v1/' + key + '/' + record.id, { method: 'DELETE' }); closeModal('adminActionModal'); showToast(`${key.slice(0, -1)} deleted.`, 'success'); window.setTimeout(() => window.location.reload(), 350); }
      catch (error) { showToast(error.message || `Could not delete ${key.slice(0, -1)}.`, 'error'); }
    }));
    body.querySelectorAll('.admin-mobile-details-toggle').forEach(button => button.addEventListener('click', () => {
      const row = button.closest('.admin-collapsible-row');
      const expanded = row?.classList.toggle('is-expanded');
      button.setAttribute('aria-expanded', String(expanded));
      button.textContent = expanded ? 'Hide details' : 'Details';
    }));
  };
  const quickAction = sessionStorage.getItem('ace_workspace_quick_action');
  const correctionFlow = key === 'entries' && quickAction === 'correct-missing-clock-out';
  const initialRecords = correctionFlow ? view.records.filter(record => !record.clockOutAt) : view.records;
  draw(initialRecords);
  const manageUserId = key === 'users' ? new URLSearchParams(window.location.search).get('manage') : null;
  if (manageUserId) {
    const target = view.records.find(record => String(record.id) === String(manageUserId));
    if (target) requestAnimationFrame(() => modal(view, false, target));
  }
  const search = document.getElementById('sectionSearch'); const count = document.getElementById('sectionResultCount') || document.createElement('span');
  count.id = 'sectionResultCount'; count.className = 'result-count'; tableTitle.append(' ', count);
  const setCount = records => { const total = serverPaged ? view.total : records.length; count.textContent = total + ' record' + (total === 1 ? '' : 's'); }; setCount(initialRecords);
  let departmentFilter = null; let roleFilter = null; let employeeFilter = null; let projectFilter = null; let remarksFilter = null;
  if (key === 'users') {
    const departments = serverPaged ? await liveRequest('/v1/departments') : [...new Set(view.records.map(record => record.cells[3]))].sort((a, b) => a.localeCompare(b));
    const filters = document.createElement('div'); filters.className = 'admin-user-filters';
    filters.innerHTML = '<label>Department<select class="form-select" id="userDepartmentFilter"><option value="">All departments</option>' + departments.map(department => '<option value="' + esc(serverPaged ? department.id : department) + '">' + esc(serverPaged ? department.name : department) + '</option>').join('') + '</select></label><label>Account type<select class="form-select" id="userRoleFilter"><option value="">All accounts</option><option value="Employee">Employees</option><option value="Admin">Administrators</option></select></label>';
    search.insertAdjacentElement('beforebegin', filters);
    departmentFilter = filters.querySelector('#userDepartmentFilter'); roleFilter = filters.querySelector('#userRoleFilter');
    departmentFilter.value = activeFilters.departmentId || ''; roleFilter.value = activeFilters.role === 'ADMIN' ? 'Admin' : activeFilters.role === 'USER' ? 'Employee' : '';
  }
  if (key === 'entries') {
    const employees = [...new Set(view.records.map(record => record.cells[0]))].sort((a, b) => a.localeCompare(b));
    const projects = [...new Set(view.records.map(record => record.cells[1]))].sort((a, b) => a.localeCompare(b));
    const filters = document.createElement('div'); filters.className = 'admin-user-filters admin-entry-filters';
    filters.innerHTML = '<label>Employee<input class="form-input" id="entryEmployeeFilter" type="search" list="entryEmployeeOptions" placeholder="All employees" autocomplete="off"><datalist id="entryEmployeeOptions">' + employees.map(employee => '<option value="' + esc(employee) + '"></option>').join('') + '</datalist></label><label>Project<input class="form-input" id="entryProjectFilter" type="search" list="entryProjectOptions" placeholder="All projects" autocomplete="off"><datalist id="entryProjectOptions">' + projects.map(project => '<option value="' + esc(project) + '"></option>').join('') + '</datalist></label><label>Remarks<select class="form-select" id="entryRemarksFilter"><option value="">All entries</option><option value="with">With remarks</option><option value="without">No remarks</option></select></label>';
    search.insertAdjacentElement('beforebegin', filters);
    employeeFilter = filters.querySelector('#entryEmployeeFilter'); projectFilter = filters.querySelector('#entryProjectFilter'); remarksFilter = filters.querySelector('#entryRemarksFilter');
    employeeFilter.value = activeFilters.employee || ''; projectFilter.value = activeFilters.project || ''; remarksFilter.value = activeFilters.remarks || '';
  }
  loadPage = async () => {
    const table = body.closest('.table-container'); table?.classList.add('is-data-refreshing'); table?.setAttribute('aria-busy', 'true');
    try {
      await applyLiveData(key, view, pageState, activeFilters);
      renderStats(); draw(view.records); setCount(view.records);
    } catch (error) { showToast(error.message || 'Could not load this page.', 'error'); }
    finally { table?.classList.remove('is-data-refreshing'); table?.removeAttribute('aria-busy'); }
  };
  const applyFilters = () => {
    if (serverPaged) {
      activeFilters.q = search.value.trim();
      activeFilters.role = roleFilter?.value === 'Admin' ? 'ADMIN' : roleFilter?.value === 'Employee' ? 'USER' : '';
      activeFilters.departmentId = departmentFilter?.value || '';
      activeFilters.employee = employeeFilter?.value.trim() || '';
      activeFilters.project = projectFilter?.value.trim() || '';
      activeFilters.remarks = remarksFilter?.value || '';
      pageState.page = 1; persistState(); void loadPage(); return;
    }
    const term = search.value.trim().toLowerCase();
    const employeeTerm = employeeFilter?.value.trim().toLowerCase() || '';
    const projectTerm = projectFilter?.value.trim().toLowerCase() || '';
    const records = view.records.filter(record => (!term || record.cells.join(' ').toLowerCase().includes(term)) && (!departmentFilter?.value || record.cells[3] === departmentFilter.value) && (!roleFilter?.value || record.cells[2] === roleFilter.value) && (!employeeTerm || record.cells[0].toLowerCase().includes(employeeTerm)) && (!projectTerm || record.cells[1].toLowerCase().includes(projectTerm)) && (!remarksFilter?.value || (remarksFilter.value === 'with' ? Boolean(record.remarks?.length) : !record.remarks?.length)));
    pageState.page = 1; persistState(); draw(records); setCount(records);
  };
  actionButton.addEventListener('click', () => /export/i.test(view.action) ? openTimeEntryExport(view.records) : modal(view, true));
  const expectedQuickAction = key === 'users' || key === 'invitations' ? 'invite-user' : key === 'projects' ? 'add-project' : '';
  if (correctionFlow) {
    sessionStorage.removeItem('ace_workspace_quick_action');
    requestAnimationFrame(() => {
      showToast(initialRecords.length
        ? `Showing ${initialRecords.length} active time entr${initialRecords.length === 1 ? 'y' : 'ies'}. Select Correct time after confirming the employee's actual clock-out time.`
        : 'There are no active time entries needing a clock-out correction.', initialRecords.length ? 'info' : 'success');
      document.getElementById('sectionTableTitle')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  if (quickAction && quickAction === expectedQuickAction) {
    sessionStorage.removeItem('ace_workspace_quick_action');
    requestAnimationFrame(() => actionButton.click());
  }
  search.value = activeFilters.q || '';
  let filterTimer = null;
  search.addEventListener('input', () => { window.clearTimeout(filterTimer); filterTimer = window.setTimeout(applyFilters, 220); });
  departmentFilter?.addEventListener('change', applyFilters); roleFilter?.addEventListener('change', applyFilters); employeeFilter?.addEventListener('input', applyFilters); projectFilter?.addEventListener('input', applyFilters); remarksFilter?.addEventListener('change', applyFilters);
}
// Also expose the renderer for the persistent dashboard shell. The normal
// document-ready path remains for a direct browser refresh.
window.renderAdminSection = renderAdminSection;
if (!window.adminSectionLiveRefreshBound) {
  window.adminSectionLiveRefreshBound = true;
  window.addEventListener('ace:live-data', event => {
    if (event.detail?.background) return;
    if (document.body.dataset.adminView && !document.querySelector('.modal.active, input:focus, textarea:focus, select:focus')) void renderAdminSection();
  });
}
document.addEventListener('DOMContentLoaded', renderAdminSection);
