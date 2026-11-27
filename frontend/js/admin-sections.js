// Akio <3: Project source maintained by Akio Zaki Salomon.
// Searches survive live redraws, but never a page reload or a browser session.
const adminPageFilters = new Map();
async function liveRequest(path, options = {}) {
  if (!window.ACEAuth) throw new Error('Authentication service is unavailable.');
  return window.ACEAuth.request(path, options);
}

// This is interface copy only. All records and counts are live Render/Supabase data.
const ADMIN_SECTION_CONFIG = {
  inquiries: { title: 'Chatbot Inquiry', description: 'Questions sent to you from ACE Help. Contact the sender at their work email.', columns: ['Received', 'Sender', 'Email', 'Question', 'Reply'] },
  users: { title: 'Users', description: 'Assign roles and maintain employee records.', action: 'Invite user', actionIcon: 'user-plus', columns: ['Name', 'Email', 'Role', 'Projects', 'Department', 'Status', 'Action'] },
  invitations: { title: 'Pre-authorized access', description: 'Invite an employee or administrator before their first sign-in.', action: 'Invite user', actionIcon: 'user-plus', columns: ['Email', 'Authorized by', 'Created', 'Expires', 'Status', 'Action'] },
  departments: { title: 'Departments', description: 'Organize employees by department. Assignments remain optional.', action: 'Add department', actionIcon: 'building', columns: ['Department', 'Description', 'Created', 'Status', 'Action'] },
  projects: { title: 'Projects', description: 'Manage projects available for optional time-entry assignment.', action: 'Add project', actionIcon: 'folder', columns: ['Project', 'Description', 'Created', 'Status', 'Action'] },
  entries: { title: 'Time entries', description: 'Review company clocking activity and internal administrator remarks.', action: 'Export entries', actionIcon: 'download', columns: ['Employee', 'Project', 'Clock in', 'Clock out', 'Worked', 'Approved overtime', 'Remarks', 'Actions'] },
  audit: { title: 'Audit log', description: 'Review the append-only record of important actions across the system.', columns: ['When', 'Actor', 'Action', 'Entity', 'Description', 'Record'] }
};
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const date = value => value ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value)) : '—';
const time = value => value ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)) : '—';
const humanizeEnum = value => String(value || '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
const auditAction = value => { const [action, ...suffix] = String(value || '').split(' '); return ({ CLOCK_IN: 'Clocked in', CLOCK_OUT: 'Clocked out' }[action] || humanizeEnum(action)) + (suffix.length ? ` ${suffix.join(' ')}` : ''); };
const duration = seconds => { const safe = Math.max(0, Number(seconds) || 0); return String(Math.floor(safe / 3600)).padStart(2, '0') + ':' + String(Math.floor((safe % 3600) / 60)).padStart(2, '0') + ':' + String(safe % 60).padStart(2, '0'); };
const icon = (name, className = 'ui-icon') => '<img class="' + className + '" src="assets/icons/' + name + '.svg" alt="" aria-hidden="true">';
const emptyTable = (title, message, colspan) => '<tr class="table-empty-row"><td colspan="' + colspan + '"><div class="empty-state empty-state-compact"><div class="empty-state-icon">' + icon('folder') + '</div><h3>' + esc(title) + '</h3><p>' + esc(message) + '</p></div></td></tr>';

function renderActiveEntriesPanel(records = []) {
  let panel = document.getElementById('activeEntriesPanel');
  const table = document.querySelector('.admin-section-page .table-container');
  if (!table) return;
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'activeEntriesPanel';
    panel.className = 'active-entries-panel';
    panel.tabIndex = -1;
    panel.setAttribute('aria-labelledby', 'activeEntriesTitle');
    table.insertAdjacentElement('beforebegin', panel);
    if (window.location.hash === '#activeEntriesPanel') {
      requestAnimationFrame(() => {
        panel.focus({ preventScroll: true });
        panel.scrollIntoView({ block: 'start' });
      });
    }
  }
  const employeeEntries = records.filter(record => record.userRole === 'USER');
  const adminEntries = records.length - employeeEntries.length;
  const entryCards = employeeEntries.map(record => '<article class="active-entry-card"><div class="active-entry-identity"><span class="active-entry-avatar" aria-hidden="true">' + esc(record.cells[0].trim().slice(0, 1).toUpperCase()) + (record.avatarUrl ? '<img src="' + esc(record.avatarUrl) + '" alt="" onerror="this.remove()">' : '') + '</span><div><strong>' + esc(record.cells[0]) + '</strong><span>' + (record.cells[1] === '—' ? 'No project assigned' : esc(record.cells[1])) + '</span></div></div><dl class="active-entry-meta"><div><dt>Clocked in</dt><dd>' + esc(time(record.clockInAt)) + '</dd></div><div><dt>Current time</dt><dd>' + esc(record.cells[4]) + '</dd></div></dl>' + (window.ACEActivitySummary?.(record.activities) || '') + '<div class="active-entry-actions"><button class="btn btn-sm btn-outline active-entry-remark" type="button" data-entry-id="' + esc(record.id) + '">' + icon('message-circle-more') + (record.remarks?.length ? 'Open remarks' : 'Add remark') + '</button><button class="btn btn-sm btn-danger active-entry-stop" type="button" data-entry-id="' + esc(record.id) + '">' + icon('log-out') + 'Stop clock</button></div></article>').join('');
  panel.innerHTML = '<div class="active-entries-heading"><div class="active-entries-heading-copy"><span class="active-entries-icon">' + icon('timer') + '</span><div><p class="admin-section-kicker">ACTIVE ENTRIES</p><h2 id="activeEntriesTitle">Clocked-in employees</h2><p>Review active employee shifts before stopping a clock or adding an administrator remark.</p></div></div><span class="active-entries-count">' + employeeEntries.length + ' active</span></div><div class="active-entries-list">' + (entryCards || '<div class="active-entries-empty">' + icon('check') + '<div><strong>No employees are clocked in</strong><span>New active shifts will appear here when you open or refresh Time entries.</span></div></div>') + '</div>' + (adminEntries ? '<p class="active-entries-note">' + adminEntries + ' administrator shift' + (adminEntries === 1 ? ' is' : 's are') + ' active and can be managed from the administrator account.</p>' : '');
  panel.querySelectorAll('.active-entry-remark').forEach(button => button.addEventListener('click', () => {
    const record = employeeEntries.find(item => item.id === button.dataset.entryId);
    if (record) openEntryFeedback(record);
  }));
  panel.querySelectorAll('.active-entry-stop').forEach(button => button.addEventListener('click', async () => {
    const record = employeeEntries.find(item => item.id === button.dataset.entryId);
    if (!record || !await window.ACEUI.confirm({ title: 'Stop employee clock?', message: 'This ends ' + record.cells[0] + "'s active shift now. Confirm the employee has finished before continuing.", confirmLabel: 'Stop clock', danger: true })) return;
    button.disabled = true; button.textContent = 'Stopping…';
    try {
      await liveRequest('/v1/time-entries/' + record.id + '/admin-stop', { method: 'POST' });
      showToast(record.cells[0] + "'s clock has been stopped.", 'success');
      await renderAdminSection();
    } catch (error) {
      showToast(error.message || 'Could not stop this employee clock.', 'error');
      button.disabled = false; button.innerHTML = icon('log-out') + 'Stop clock';
    }
  }));
}

async function applyLiveData(key, view, pageState = null, filters = {}) {
  if (key === 'inquiries') {
    if (!AppState.currentUser?.IsHeadAdmin) throw new Error('Head administrator access required.');
    const params = new URLSearchParams({ page: pageState?.page || 1, pageSize: pageState?.size || 25 });
    if (filters.q) params.set('q', filters.q);
    const response = await liveRequest('/v1/help-requests?' + params);
    const items = response.items || response;
    view.total = response.total ?? items.length;
    view.records = items.map(item => ({ id: item.id, email: item.sender_email, cells: [time(item.created_at), item.sender_name || 'Unnamed user', item.sender_email, item.question, 'Reply by email'] }));
    view.stats = [[view.total, 'Inquiries']];
  } else if (key === 'users') {
    const params = new URLSearchParams();
    if (pageState) { params.set('page', pageState.page); params.set('pageSize', pageState.size); }
    if (filters.q) params.set('q', filters.q);
    if (filters.role) params.set('role', filters.role);
    if (filters.departmentId) params.set('departmentId', filters.departmentId);
    if (filters.projectId) params.set('projectId', filters.projectId);
    if (filters.projectId) params.set('projectId', filters.projectId);
    const [response, assignments, projects] = await Promise.all([
      liveRequest('/v1/users' + (params.size ? '?' + params.toString() : '')),
      liveRequest('/v1/user-projects'),
      liveRequest('/v1/projects')
    ]);
    const items = response.items || response; view.total = response.total ?? items.length;
    const projectNames = new Map(projects.map(project => [String(project.id), project.name]));
    const projectsByUser = new Map();
    assignments.forEach(assignment => {
      const names = projectsByUser.get(String(assignment.user_id)) || [];
      const projectName = projectNames.get(String(assignment.project_id));
      if (projectName) names.push(projectName);
      projectsByUser.set(String(assignment.user_id), names);
    });
    view.records = items.map(item => {
      const assignedProjects = projectsByUser.get(String(item.id)) || [];
      const projectLabel = item.role === 'USER' ? (assignedProjects.join(', ') || 'Unassigned') : '—';
      return { id: item.id, email: item.email, isHeadAdmin: Boolean(item.is_head_admin), avatarUrl: item.profile_picture_url || '', cells: [item.full_name || 'Unnamed user', item.email, item.role === 'CLIENT' ? 'Client' : item.role === 'ADMIN' ? 'Admin' : 'Employee', projectLabel, item.departments?.name || '—', item.status[0] + item.status.slice(1).toLowerCase(), item.status === 'PENDING' ? 'Review' : 'Manage'] };
    });
  } else if (key === 'invitations') {
    const params = new URLSearchParams(); if (pageState) { params.set('page', pageState.page); params.set('pageSize', pageState.size); } if (filters.q) params.set('q', filters.q);
    const response = await liveRequest('/v1/invitations' + (params.size ? '?' + params : '')); const items = response.items || response; view.total = response.total ?? items.length;
    view.records = items.map(item => ({ id: item.id, cells: [item.email, item.profiles?.full_name || item.profiles?.email || 'Administrator', date(item.invited_at), date(item.expires_at), item.status[0] + item.status.slice(1).toLowerCase(), 'View'] }));
    view.stats = [[items.filter(item => item.status === 'PENDING').length, 'Pending'], [items.filter(item => item.status === 'ACCEPTED').length, 'Accepted'], [items.filter(item => item.status === 'PENDING' && new Date(item.expires_at).toDateString() === new Date().toDateString()).length, 'Expires today']];
  } else if (key === 'departments' || key === 'projects') {
    const params = new URLSearchParams(); if (pageState) { params.set('page', pageState.page); params.set('pageSize', pageState.size); } if (filters.q) params.set('q', filters.q);
    const response = await liveRequest('/v1/' + key + (params.size ? '?' + params : '')); const items = response.items || response; view.total = response.total ?? items.length;
    view.records = items.map(item => ({ id: item.id, cells: [item.name, item.description || '—', date(item.created_at), item.is_active ? 'Active' : 'Inactive', 'Edit'] }));
    if (key === 'projects') view.stats = [[items.length, 'Total projects'], [items.filter(item => item.is_active).length, 'Active projects']];
  } else if (key === 'entries') {
    const params = new URLSearchParams();
    if (pageState) { params.set('page', pageState.page); params.set('pageSize', pageState.size); }
    if (filters.q) params.set('q', filters.q);
    if (filters.status) params.set('status', filters.status);
    if (filters.employee) params.set('employee', filters.employee);
    if (filters.project) params.set('project', filters.project);
    if (filters.remarks) params.set('remarks', filters.remarks);
    // Active entries are a separate, one-time snapshot for the admin review
    // panel. This intentionally does not add page polling or realtime listeners.
    const activeRequest = liveRequest('/v1/time-entries?status=ACTIVE&page=1&pageSize=100');
    const response = filters.q || filters.employee || filters.project
      ? await liveRequest('/v1/time-entries/search', { method: 'POST', body: JSON.stringify(Object.fromEntries(params)) })
      : await liveRequest('/v1/time-entries' + (params.size ? '?' + params.toString() : ''));
    const [activeResponse] = await Promise.all([activeRequest]);
    const items = response.items || response; view.total = response.total ?? items.length;
    const activeItems = activeResponse.items || activeResponse;
    const entryIds = [...new Set([...items, ...activeItems].map(item => item.id))];
    const remarks = entryIds.length ? await liveRequest('/v1/admin-remarks?timeEntryIds=' + encodeURIComponent(entryIds.join(','))) : [];
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
    const toEntryRecord = item => { const entryRemarks = remarksByEntry.get(item.id) || []; return { activities: item.activities || [], id: item.id, userId: item.user_id, userRole: item.profiles?.role, avatarUrl: item.profiles?.profile_picture_url || '', clockInAt: item.clock_in_at, clockOutAt: item.clock_out_at, syncedLate: item.queued_clock_synced_late, scheduledEndTime: item.scheduled_end_time, scheduleType: item.schedule_type, overtimeApprovedSeconds: item.overtime_approved_seconds || 0, overtimeApprovedAt: item.overtime_approved_at, remarks: entryRemarks, cells: [item.profiles?.full_name || item.profiles?.email || 'Unknown', item.projects?.name || '—', time(item.clock_in_at), time(item.clock_out_at), item.duration_seconds ? duration(item.duration_seconds) : item.clock_out_at ? '—' : duration(liveWorkedSeconds(item)), item.overtime_approved_seconds ? duration(item.overtime_approved_seconds) : '—', entryRemarks.length ? `${entryRemarks.length} remark${entryRemarks.length === 1 ? '' : 's'}` : '—', 'Add remark'] }; };
    view.records = items.map(toEntryRecord);
    view.activeRecords = activeItems.map(toEntryRecord);
    view.stats = [[duration(total), 'Tracked time'], [view.activeRecords.length, 'Open entries'], [items.length, 'Time entries']];
  } else if (key === 'audit') {
    const params = new URLSearchParams(); if (pageState) { params.set('page', pageState.page); params.set('pageSize', pageState.size); } if (filters.q) params.set('q', filters.q);
    const response = await liveRequest('/v1/audit-logs' + (params.size ? '?' + params : '')); const items = response.items || response; view.total = response.total ?? items.length;
    view.records = items.map(item => ({ id: item.id, cells: [time(item.created_at), item.profiles?.full_name || item.profiles?.email || 'System', auditAction(item.action), humanizeEnum(item.entity_type), item.description || '—', '#' + item.id] }));
    view.stats = [[items.length, 'Recorded events'], [items.filter(item => item.action === 'LOGIN').length, 'Sign-ins'], [items.filter(item => /REPORT/i.test(item.action)).length, 'Reports exported']];
  }
}

function status(value) {
  const normalized = String(value).toLowerCase();
  if (!['active', 'pending', 'accepted', 'running', 'completed', 'inactive', 'online', 'offline'].includes(normalized)) return esc(value);
  const type = ['active', 'accepted', 'completed', 'online'].includes(normalized) ? 'success' : ['inactive', 'offline'].includes(normalized) ? 'neutral' : 'warning';
  return '<span class="badge badge-' + type + '">' + esc(value) + '</span>';
}
function action(label, index, key, record) {
  if (key === 'inquiries') return '<a class="btn btn-sm btn-outline" href="mailto:' + esc(encodeURIComponent(record.email)) + '?subject=ACE%20Help%20inquiry">Reply by email</a>';
  if (key === 'audit') return '<button class="btn btn-sm btn-outline admin-audit-details-open"' + (index === 0 ? ' id="tutorialAuditEvent"' : '') + ' type="button" data-row="' + index + '">' + icon('eye') + 'View event</button>';
  if (key === 'entries') {
    const canApprove = record.clockOutAt && record.scheduleType === 'FIXED' && record.scheduledEndTime && !record.overtimeApprovedAt;
    return '<div class="admin-entry-action-set"><button class="btn btn-sm btn-outline admin-entry-actions-toggle"' + (index === 0 ? ' id="tutorialEntryActions"' : '') + ' type="button" aria-expanded="false" aria-haspopup="menu">Actions ' + icon('chevron-down') + '</button><div class="admin-entry-action-menu" role="menu" hidden>' +
      (canApprove ? '<button class="admin-approve-overtime" type="button" role="menuitem" data-row="' + index + '">' + icon('check') + 'Approve overtime</button>' : '') +
      '<button class="admin-entry-details-open" type="button" role="menuitem" data-row="' + index + '">' + icon('eye') + 'View details</button>' +
      '<button class="admin-edit-entry-time" type="button" role="menuitem" data-row="' + index + '">' + icon('square-pen') + 'Correct time</button><button class="admin-entry-remarks-open" type="button" role="menuitem" data-row="' + index + '">' + icon('message-circle-more') + (record.remarks?.length ? 'Open feedback' : 'Add remark') + '</button><button class="admin-delete-entry is-danger" type="button" role="menuitem" data-row="' + index + '">' + icon('trash') + 'Move to deleted</button></div><button class="btn btn-sm btn-outline admin-mobile-details-toggle" type="button" aria-expanded="false">Details</button></div>';
  }
  if (key === 'users') {
    const canViewEmployee = record?.cells?.[2] === 'Employee';
    const headTarget = record?.isHeadAdmin;
    const canManage = !headTarget || Boolean(typeof AppState !== 'undefined' && AppState.currentUser?.IsHeadAdmin);
    if (!canViewEmployee && !canManage) return '<span class="record-reference">Head administrator</span>';
    return '<div class="admin-user-action-set"><button class="btn btn-sm btn-outline admin-user-actions-toggle"' + (index === 0 ? ' id="tutorialUserActions"' : '') + ' type="button" aria-expanded="false" aria-haspopup="menu">Actions ' + icon('chevron-down') + '</button><div class="admin-user-action-menu" role="menu" hidden>' +
      (canViewEmployee ? '<button class="admin-view-employee" type="button" role="menuitem" data-row="' + index + '">' + icon('eye') + 'View employee</button>' : '') +
      (canManage ? '<button class="admin-row-action" type="button" role="menuitem" data-row="' + index + '">' + icon('settings') + 'Manage account</button>' : '') +
      '</div><button class="btn btn-sm btn-outline admin-mobile-details-toggle" type="button" aria-expanded="false">Details</button></div>';
  }
  if (key === 'projects') return '<div class="table-actions"><button class="btn btn-sm btn-outline admin-project-details-open" type="button" data-row="' + index + '">' + icon('eye') + 'View</button><button class="btn btn-sm btn-danger admin-delete-section" type="button" data-row="' + index + '">' + icon('trash') + 'Delete</button></div>';
  if (key === 'departments') return '<div class="table-actions"><button class="btn btn-sm btn-outline admin-row-action" type="button" data-row="' + index + '">' + icon('square-pen') + 'Edit</button><button class="btn btn-sm btn-danger admin-delete-section" type="button" data-row="' + index + '">' + icon('trash') + 'Delete</button></div>';
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
    const options = label === 'Role' ? [['USER','Employee'],['ADMIN','Admin'],['CLIENT','Client']].map(([role,label]) => '<option value="' + role + '"' + ((value === label || (!value && role === 'USER')) ? ' selected' : '') + '>' + label + '</option>').join('')
      : label === 'Department' ? '<option value="">No department</option>' + (state?.departments || []).map(item => '<option value="' + item.DepartmentId + '"' + (value === item.DepartmentName ? ' selected' : '') + '>' + esc(item.DepartmentName) + '</option>').join('')
      : label === 'Project assignment' ? '<option value="">No project change</option>' + (state?.projects || []).filter(item => item.IsActive).map(item => '<option value="' + item.ProjectId + '">' + esc(item.ProjectName) + '</option>').join('')
      : label.includes('Schedule') ? '<option value="">Leave schedule unchanged</option>'
      : '<option value="ACTIVE">Approve</option><option value="DENIED">Deny</option>';
    return '<div class="form-group"><label class="form-label" for="' + id + '">' + label + '</label><select class="form-select" id="' + id + '">' + options + '</select></div>';
  }
  return '<div class="form-group"><label class="form-label" for="' + id + '">' + label + '</label><input class="form-input" id="' + id + '" type="' + type + '" placeholder="' + esc(placeholder) + '" value="' + esc(value) + '" required></div>';
}

function openEntryFeedback(record, onSaved = renderAdminSection) {
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
  window.ACEAcknowledgeAdminRemarks?.(feedback.map(remark => remark.id));
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
      await onSaved();
    } catch (error) {
      showToast(error.message || 'Could not post feedback.', 'error');
      button.disabled = false;
      button.innerHTML = icon('message-circle-plus') + 'Post comment';
    }
  });
  openModal(node.id);
}

function editEntryTime(record, onSaved = null) {
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
      closeModal(node.id); showToast('Employee time corrected.', 'success');
      if (onSaved) await onSaved();
      else window.setTimeout(() => window.location.reload(), 400);
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
    : primary && ['users', 'invitations'].includes(key) ? [['Work email', 'email', 'name@example.com'], ['Role', 'select', 'USER'], ['Department', 'select', '']]
        : (primary || edit) && key === 'departments' ? [['Department name', 'text', 'e.g. Client Services'], ['Description', 'textarea', 'What does this department handle?'], ...(edit ? [['Add employee (optional)', 'user-search', 'Search by employee name or email'], ['Schedule for selected employees (optional)', 'select', '']] : [])]
        : primary && key === 'projects' ? [['Project name', 'text', 'e.g. Customer Portal'], ['Description', 'textarea', 'Describe the project scope']]
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
  node.querySelector('.modal-body').innerHTML = summary + '<form id="adminActionForm">' + fields.map((field, index) => formField(field[0], field[1], field[2], edit ? record.cells[index] : manage ? (index === 0 ? record.cells[2] : index === 1 ? record.cells[4] : '') : '', index)).join('') + '<div class="form-actions"><button class="btn btn-primary" type="submit">' + icon('check') + buttonLabel + '</button>' + (manage ? '<button class="btn btn-danger admin-remove-user" type="button">' + icon('folder') + 'Archive user</button>' : '') + (deleteRecord ? '<button class="btn btn-danger admin-delete-record" type="button">' + icon('trash') + 'Delete</button>' : '') + '<button class="btn btn-outline admin-modal-cancel" type="button">' + icon('x') + 'Cancel</button></div></form>';
  if (manage) {
    const assignedProjects = (typeof AppState === 'undefined' ? [] : AppState.userProjects || [])
      .filter(assignment => String(assignment.UserId) === String(record.id))
      .map(assignment => (AppState.projects || []).find(project => String(project.ProjectId) === String(assignment.ProjectId)))
      .filter(Boolean);
    const form = node.querySelector('#adminActionForm');
    const managed=document.createElement('section');managed.className='managed-projects-summary';managed.innerHTML='<h4>Managed projects &amp; campaigns</h4><p class="form-help">Loading manager access…</p>';form.appendChild(managed);liveRequest('/v1/admin/users/'+record.id+'/managed-projects').then(rows=>{managed.innerHTML='<h4>Managed projects &amp; campaigns</h4>'+(rows.length?rows.map(r=>'<div><strong>'+esc(r.projects?.name||'Project')+'</strong><span>'+esc(r.access_level==='VIEW_PLAN'?'View & plan':'View only')+'</span></div>').join(''):'<p class="form-help">No manager access assigned.</p>');}).catch(()=>{managed.innerHTML='<h4>Managed projects &amp; campaigns</h4><p class="form-help">Manager access unavailable.</p>';});
    form.insertAdjacentHTML('beforeend', '<div class="form-group project-assignment-current"><label class="form-label">Current project assignments</label><div class="project-assignment-list">' + (assignedProjects.length ? assignedProjects.map(project => '<button class="btn btn-sm btn-outline admin-unassign-project" type="button" data-project-id="' + esc(project.ProjectId) + '">' + esc(project.ProjectName) + ' ×</button>').join(' ') : '<span class="form-help">No projects assigned.</span>') + '</div></div>');
    form.querySelectorAll('.admin-unassign-project').forEach(button => button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      try {
        await liveRequest('/v1/users/' + record.id + '/projects/' + button.dataset.projectId, { method: 'DELETE' });
        button.remove();
        if (!form.querySelector('.admin-unassign-project')) form.querySelector('.project-assignment-list').innerHTML = '<span class="form-help">No projects assigned.</span>';
        showToast('Project assignment removed.', 'success');
      } catch (error) {
        button.disabled = false;
        showToast(error.message || 'Could not remove the project assignment.', 'error');
      }
    }));
  }
  if (manage || (key === 'departments' && edit)) {
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
      selectedList.innerHTML = selectedUsers.length ? selectedUsers.map(user => '<button class="btn btn-sm btn-outline remove-selected-user" type="button" data-id="' + esc(user.id) + '">' + esc(user.name) + ' ×</button>').join(' ') : 'No employees selected.';
      selectedList.querySelectorAll('.remove-selected-user').forEach(button => button.addEventListener('click', () => {
        const index = selectedUsers.findIndex(user => user.id === button.dataset.id);
        if (index >= 0) selectedUsers.splice(index, 1);
        renderSelectedUsers();
      }));
    };
    const addSelectedUser = () => {
      const option = Array.from(document.getElementById('adminField2Options')?.options || []).find(item => item.value === search.value);
      const userId = option?.dataset.userId;
      if (!userId) { showToast('Choose an employee from the search list first.', 'warning'); return; }
      if (!selectedUsers.some(user => user.id === userId)) selectedUsers.push({ id: userId, name: option.value });
      search.value = '';
      renderSelectedUsers();
    };
    employeePicker.addEventListener('click', addSelectedUser);
    // Datalist selection is otherwise only text in the field. Add it to the
    // hidden request list as soon as an employee is selected.
    search.addEventListener('change', () => { if (search.value) addSelectedUser(); });
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
      if (primary && ['users', 'invitations'].includes(key)) invitation = await liveRequest('/v1/invitations', { method: 'POST', body: JSON.stringify({ email: first, role: document.getElementById('adminField1').value, departmentId: document.getElementById('adminField2').value || null }) });
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
        if (projectId && first === 'USER') await liveRequest('/v1/users/' + record.id + '/projects/' + projectId, { method: 'PUT' });
        const scheduleId = document.getElementById('adminField3').value;
        if (scheduleId && first === 'USER') await liveRequest('/v1/users/' + record.id + '/schedule', { method: 'PUT', body: JSON.stringify({ scheduleId: scheduleId === '__REMOVE__' ? null : scheduleId }) });
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
  const localDate = date => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const today = new Date();
  const from = localDate(new Date(today.getFullYear(), today.getMonth(), 1));
  const to = localDate(today);
  const modal = document.createElement('div');
  modal.id = 'timeEntryExportModal'; modal.className = 'modal'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'timeEntryExportTitle');
  modal.innerHTML = '<div class="modal-content"><div class="modal-header"><div><p class="eyebrow">TIME ENTRIES</p><h3 class="modal-title" id="timeEntryExportTitle">Export entries</h3></div><button class="modal-close" type="button" aria-label="Close">' + icon('x') + '</button></div><form class="modal-body" id="timeEntryExportForm"><p class="modal-description">Choose the entries to include, then save a PDF or Excel workbook.</p><div class="form-grid"><div class="form-group"><label class="form-label" for="exportDateFrom">From</label><input class="form-input" id="exportDateFrom" type="date" value="' + from + '" required></div><div class="form-group"><label class="form-label" for="exportDateTo">To</label><input class="form-input" id="exportDateTo" type="date" value="' + to + '" required></div><div class="form-group"><label class="form-label" for="exportEntryEmployee">Employee</label><select class="form-select" id="exportEntryEmployee"><option value="">All employees</option>' + users.map(([id, name]) => '<option value="' + esc(id) + '">' + esc(name) + '</option>').join('') + '</select></div><div class="form-group"><label class="form-label" for="exportEntryProject">Project</label><select class="form-select" id="exportEntryProject"><option value="">All projects</option>' + projects.map(name => { const project = (AppState.projects || []).find(item => item.ProjectName === name); return '<option value="' + esc(project?.ProjectId || '') + '">' + esc(name) + '</option>'; }).join('') + '</select></div><div class="form-group"><label class="form-label" for="exportEntryStatus">Status</label><select class="form-select" id="exportEntryStatus"><option value="">All entries</option><option value="COMPLETED">Completed</option><option value="ACTIVE">Active</option></select></div></div><p class="export-entry-summary" id="exportEntrySummary"></p><div class="form-actions"><button class="btn btn-outline" type="button" data-export-format="CSV">Save CSV</button><button class="btn btn-outline" type="button" data-export-format="XLSX">' + icon('download') + 'Save Excel</button><button class="btn btn-primary" type="button" data-export-format="PDF">' + icon('printer') + 'Save as PDF</button></div></form></div>';
  document.body.appendChild(modal);
  const close = () => closeModal(modal.id); modal.querySelector('.modal-close').addEventListener('click', close); modal.addEventListener('click', event => { if (event.target === modal) close(); });
  const read = () => ({ dateFrom: modal.querySelector('#exportDateFrom').value, dateTo: modal.querySelector('#exportDateTo').value, filters: { userId: modal.querySelector('#exportEntryEmployee').value, projectId: modal.querySelector('#exportEntryProject').value, status: modal.querySelector('#exportEntryStatus').value } });
  const updateSummary = () => { const config = read(); const count = (window.filterEntriesForReport ? window.filterEntriesForReport({ DateFrom: config.dateFrom, DateTo: config.dateTo, Filters: config.filters }) : []).length; modal.querySelector('#exportEntrySummary').textContent = count + ' entr' + (count === 1 ? 'y' : 'ies') + ' will be included.'; };
  modal.querySelectorAll('input, select').forEach(input => input.addEventListener('change', updateSummary));
  modal.querySelectorAll('[data-export-format]').forEach(button => window.ACEBindExportModes(button, async mode => { const config = read(); config.filters.exportMode = mode; if (config.dateTo < config.dateFrom) return showToast('The end date must be on or after the start date.', 'warning'); try { await liveRequest('/v1/time-entry-exports', { method: 'POST', body: JSON.stringify({ format: button.dataset.exportFormat, dateFrom: config.dateFrom, dateTo: config.dateTo, filters: config.filters }) }); showToast('Export saved to Reports and Audit log.', 'success'); } catch (error) { showToast(error.message || 'Could not save this export to Reports.', 'error'); return; } window.ACEReportActions.preview({ ...config, format: button.dataset.exportFormat }); close(); }));
  updateSummary(); openModal(modal.id);
}

function openAdminDetailsDrawer({ eyebrow, title, fields, href, trigger, avatarUrl = '', employeeNames = null, employeeListNote = '' }) {
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
  const employeeList = employeeNames === null ? '' : '<section class="admin-details-drawer-section admin-project-employees"><p>ASSIGNED EMPLOYEES · ' + employeeNames.length + '</p>' + (employeeListNote ? '<span class="admin-project-employees-note">' + esc(employeeListNote) + '</span>' : employeeNames.length ? '<ul>' + employeeNames.map(name => '<li>' + esc(name) + '</li>').join('') + '</ul>' : '<span class="admin-project-employees-note">No employees assigned.</span>') + '</section>';
  drawer.innerHTML = '<button class="admin-details-drawer-backdrop" type="button" aria-label="Close details"></button><aside class="admin-details-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="adminDetailsDrawerTitle"><header>' + identity + '<button class="modal-close" type="button" aria-label="Close details">' + icon('x') + '</button></header><section class="admin-details-drawer-section"><p>ACCOUNT DETAILS</p><dl>' + fields.map(([label, value]) => '<div><dt>' + esc(label) + '</dt><dd' + (label === 'Account status' ? ' class="is-status"' : '') + '>' + esc(value || '—') + '</dd></div>').join('') + '</dl></section>' + employeeList + (href ? '<footer><a class="btn btn-primary admin-details-drawer-link" href="' + esc(href) + '">Open full profile</a></footer>' : '') + '</aside>';
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

function renderSectionMetrics(metrics) {
  const summary = document.getElementById('sectionStats');
  if (!summary) return;
  summary.innerHTML = metrics.map(([value, label]) => '<div><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>').join('');
}

// Paint interface copy without requesting records or trusting cached data.
window.ACEPrepareAdminSection = function prepareAdminSection() {
  const key = document.body.dataset.adminView;
  const view = ADMIN_SECTION_CONFIG[key];
  if (!view) return;
  document.getElementById('sectionTitle').textContent = view.title;
  const description = document.getElementById('sectionDescription');
  if (description) description.textContent = view.description;
  document.getElementById('sectionTableTitle').textContent = view.title;
  document.getElementById('sectionTableHead').innerHTML = '<tr>' + view.columns.map(column => '<th>' + esc(column) + '</th>').join('') + '</tr>';
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
    if (!tabBar) { tabBar = document.createElement('nav'); tabBar.id = 'adminSectionTabs'; tabBar.className = 'admin-section-tabs'; tabBar.setAttribute('aria-label', 'Related workspace pages'); const toolbar = document.querySelector('.admin-page-toolbar'); if (toolbar) toolbar.prepend(tabBar); else document.querySelector('.admin-section-header').after(tabBar); }
    const activeHref = { users: 'users.html', invitations: 'invitations.html', projects: 'projects.html', entries: 'admin-time-entries.html' }[key];
    tabBar.innerHTML = tabs.map(([label, href]) => {
      const invitations = label === 'Invitations';
      return '<a class="admin-section-tab' + (invitations ? ' admin-section-tab-invitations' : '') + '" href="' + href + '"' + (href === activeHref ? ' aria-current="page"' : '') + '>'
        + (invitations ? icon('mail') + '<span>Invitations</span>' : esc(label)) + '</a>';
    }).join('');
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

  const labels = {
    invitations: ['Pending', 'Accepted', 'Expires today'],
    projects: ['Total projects', 'Active projects'],
    entries: ['Tracked time', 'Open entries', 'Time entries'], audit: ['Recorded events', 'Sign-ins', 'Reports exported']
  };
  renderSectionMetrics((labels[key] || []).map(label => ['—', label]));
  if (key === 'users' && !document.querySelector('.admin-user-filters')) {
    const filters = document.createElement('div');
    filters.className = 'admin-user-filters';
    filters.innerHTML = ['Department', 'Account type', 'Projects'].map((label, index) => '<label>' + label + '<select class="form-select" disabled><option>' + ['All departments', 'All accounts', 'All projects'][index] + '</option></select></label>').join('');
    document.getElementById('sectionSearch').insertAdjacentElement('beforebegin', filters);
  }
};

async function renderAdminSection() {
  // Wait for the verified profile on a direct page refresh; cached identity
  // may not be ready when DOMContentLoaded runs. The API remains authoritative.
  if (document.body.dataset.adminView === 'inquiries' && !AppState.isAuthenticated) return;
  if (document.body.dataset.adminView === 'inquiries' && !AppState.currentUser?.IsHeadAdmin) {
    document.querySelector('.admin-section-page').innerHTML = '<div class="empty-state"><h1>Head administrator access required</h1><p>This inbox is only available to the head administrator.</p></div>';
    return;
  }
  const key = document.body.dataset.adminView; const config = ADMIN_SECTION_CONFIG[key]; if (!config) return;
  if (key === 'projects') return window.mountProjectManagement();
  const serverPaged = ['users', 'entries', 'invitations', 'departments', 'projects', 'audit', 'inquiries'].includes(key);
  const stateKey = 'ace_admin_page_state_' + key;
  let savedState = {};
  try { savedState = JSON.parse(sessionStorage.getItem(stateKey) || '{}'); } catch { savedState = {}; }
  const pageState = { page: Number(savedState.page) || 1, size: Number(savedState.size) || 25 };
  const activeFilters = adminPageFilters.get(key) || {};
  adminPageFilters.set(key, activeFilters);
  const requestedRemarks = key === 'entries' ? new URLSearchParams(window.location.search).get('remarks') : null;
  if (requestedRemarks === 'with' || requestedRemarks === 'without') activeFilters.remarks = requestedRemarks;
  const persistState = () => {
    try { sessionStorage.setItem(stateKey, JSON.stringify({ page: pageState.page, size: pageState.size })); } catch { /* Storage may be disabled. */ }
  };
  // Remove previously saved staff searches; only pagination belongs in storage.
  persistState();
  // A live redraw must not stack filters or click handlers from the previous
  // pass. It only runs while no form or dialog is being edited.
  const existingAction = document.getElementById('sectionAction');
  if (existingAction?.parentNode) existingAction.parentNode.replaceChild(existingAction.cloneNode(true), existingAction);
  const existingSearch = document.getElementById('sectionSearch');
  if (existingSearch?.parentNode) existingSearch.parentNode.replaceChild(existingSearch.cloneNode(true), existingSearch);
  document.getElementById('deletedTimeEntriesButton')?.remove();
  document.getElementById('queuedClockReviewLink')?.remove();
  if (key === 'entries' && AppState.currentUser?.QueuedClockReviewsEnabled) {
    const link = document.createElement('a');
    link.id = 'queuedClockReviewLink';
    link.className = 'btn btn-outline';
    link.href = '/queued-clock-reviews';
    link.innerHTML = icon('timer') + 'Clock sync review';
    document.getElementById('sectionAction')?.after(link);
  }
  const view = { ...config, records: [], stats: [], total: 0 };
  try { await applyLiveData(key, view, serverPaged ? pageState : null, activeFilters); } catch (error) { showToast(error.message || 'Could not load live data.', 'error'); if (key === 'inquiries') { document.getElementById('sectionTableBody').innerHTML = emptyTable('Could not load inquiries', 'Please refresh to try again.', view.columns.length); return; } }
  document.title = view.title + ' · ACE Outsource Solutions';
  window.ACEPrepareAdminSection();
  document.querySelectorAll('.admin-user-filters').forEach(node => node.remove());
  const actionButton = document.getElementById('sectionAction');
  if (key === 'entries') {
    const deletedButton = document.createElement('button');
    deletedButton.id = 'deletedTimeEntriesButton';
    deletedButton.className = 'btn btn-outline';
    deletedButton.type = 'button';
    deletedButton.innerHTML = icon('trash') + 'Deleted entries';
    let toolbar = actionButton.closest('.time-entry-toolbar');
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.className = 'time-entry-toolbar';
      toolbar.setAttribute('role', 'group');
      toolbar.setAttribute('aria-label', 'Time entry actions');
      actionButton.before(toolbar);
    }
    const reviewLink = document.getElementById('queuedClockReviewLink');
    toolbar.append(...(reviewLink ? [reviewLink] : []), deletedButton, actionButton);
    deletedButton.addEventListener('click', () => openDeletedTimeEntriesModal(deletedButton));
  }
  renderSectionMetrics(view.stats);
  if (key === 'entries') renderActiveEntriesPanel(view.activeRecords);
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
      inquiries: ['No inquiries yet', 'Questions sent from ACE Help will appear here.'],
      users: ['No people yet', 'Invite your first employee or administrator to get started.'],
      invitations: ['No invitations yet', 'Invite someone when you are ready to add them to the workspace.'],
      departments: ['No departments yet', 'Create a department to organize your team.'],
      projects: ['No projects yet', 'Create a project before assigning work to it.'],
      entries: ['No time entries yet', 'Employee clock-ins will appear here for review.'],
      audit: ['No activity yet', 'Important workspace actions will appear here.']
    }[key] || ['Nothing here yet', 'New records will appear here.'];
    body.innerHTML = records.length ? pageRecords.map((record, rowIndex) => '<tr class="' + (key === 'entries' || key === 'users' ? 'admin-collapsible-row' : '') + '">' + record.cells.map((cell, index) => { const isEmployeeName = (key === 'users' && index === 0 && record.cells[2] === 'Employee') || (key === 'entries' && index === 0 && record.userRole === 'USER'); const nameCell = isEmployeeName ? '<a class="admin-employee-profile-link" href="employee-profile.html?user=' + encodeURIComponent(key === 'users' ? record.id : record.userId) + '">' + esc(cell) + '</a>' : '<strong>' + esc(cell) + '</strong>'; return '<td' + (key === 'entries' && index === 6 ? ' class="admin-entry-remarks"' : '') + '>' + (index === record.cells.length - 1 ? action(cell, rowIndex, key, record) : key === 'entries' && index === 6 ? (record.remarks?.length ? record.remarks.map(remark => '<article class="admin-entry-remark"><strong>' + esc(remark.admin) + '</strong><span>' + esc(remark.text) + '</span><small class="admin-remark-read-status ' + (remark.seenAt ? 'is-seen' : 'is-unseen') + '">' + icon(remark.seenAt ? 'check' : 'circle-alert') + (remark.seenAt ? 'Seen ' + time(remark.seenAt) : 'Not seen yet') + '</small></article>').join('') : '—') : key === 'users' && index === 0 ? '<span class="admin-user-identity"><span class="admin-user-avatar">' + (record.avatarUrl ? '<img src="' + esc(record.avatarUrl) + '" alt="">' : esc(String(cell).trim().slice(0, 1).toUpperCase())) + '</span>' + nameCell + '</span>' : key === 'entries' && index === 0 ? nameCell + (record.syncedLate ? '<small class="clock-sync-late-label">Confirmed · Synced late</small>' : '') : status(cell)) + (key === 'entries' && index === 1 ? window.ACEActivitySummary?.(record.activities) || '' : '') + '</td>'; }).join('') + '</tr>').join('') : emptyTable(emptyCopy[0], emptyCopy[1], view.columns.length);
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
      openAdminDetailsDrawer({ eyebrow: 'Time entry', title: record.cells[0], trigger: button, href: 'time-entry-details.html?entry=' + encodeURIComponent(record.id), fields: [['Activities', window.ACEActivityText?.({ Activities: record.activities }) || 'No activities recorded'], ['Project', record.cells[1]], ['Clocked in', record.clockInAt ? time(record.clockInAt) : record.cells[2]], ['Clocked out', record.clockOutAt ? time(record.clockOutAt) : record.cells[3]], ['Worked', record.cells[4]], ['Overtime', record.cells[5]], ['Remarks', record.cells[6]]] });
    }));
    body.querySelectorAll('.admin-project-details-open').forEach(button => button.addEventListener('click', async () => {
      dismissActionMenu(button);
      const record = pageRecords[Number(button.dataset.row)]; if (!record) return;
      let assignedEmployees = [];
      let employeeListNote = '';
      try {
        const [assignments, users] = await Promise.all([liveRequest('/v1/user-projects'), liveRequest('/v1/users')]);
        const assignedIds = new Set(assignments
          .filter(assignment => String(assignment.project_id) === String(record.id))
          .map(assignment => String(assignment.user_id)));
        assignedEmployees = users
          .filter(user => assignedIds.has(String(user.id)))
          .map(user => user.full_name || user.email)
          .filter(Boolean);
      } catch (error) {
        employeeListNote = 'Could not load assigned employees.';
        showToast(error.message || employeeListNote, 'warning');
      }
      openAdminDetailsDrawer({ eyebrow: 'Project', title: record.cells[0], trigger: button, fields: [['Description', record.cells[1]], ['Created', record.cells[2]], ['Status', record.cells[3]], ['Project ID', record.id]], employeeNames: assignedEmployees, employeeListNote });
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
      openAdminDetailsDrawer({ eyebrow: 'Employee', title: record.cells[0], trigger: button, avatarUrl: record.avatarUrl, href: 'employee-profile.html?user=' + encodeURIComponent(record.id), fields: [['Email', record.cells[1]], ['Role', record.cells[2]], ['Projects', record.cells[3]], ['Department', record.cells[4]], ['Account status', record.cells[5]]] });
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
    const [departments, projects] = serverPaged ? await Promise.all([liveRequest('/v1/departments'), liveRequest('/v1/projects')]) : [[...new Set(view.records.map(record => record.cells[4]))].sort((a, b) => a.localeCompare(b)), []];
    const filters = document.createElement('div'); filters.className = 'admin-user-filters';
    filters.innerHTML = '<label>Department<select class="form-select" id="userDepartmentFilter"><option value="">All departments</option>' + departments.map(department => '<option value="' + esc(serverPaged ? department.id : department) + '">' + esc(serverPaged ? department.name : department) + '</option>').join('') + '</select></label><label>Account type<select class="form-select" id="userRoleFilter"><option value="">All accounts</option><option value="Employee">Employees</option><option value="Admin">Administrators</option><option value="Client">Clients</option></select></label><label>Projects<select class="form-select" id="userProjectFilter"><option value="">All projects</option><option value="__UNASSIGNED__">Unassigned employees</option>' + projects.filter(project => project.is_active).map(project => '<option value="' + esc(project.id) + '">' + esc(project.name) + '</option>').join('') + '</select></label>';
    search.insertAdjacentElement('beforebegin', filters);
    departmentFilter = filters.querySelector('#userDepartmentFilter'); roleFilter = filters.querySelector('#userRoleFilter'); projectFilter = filters.querySelector('#userProjectFilter');
    departmentFilter.value = activeFilters.departmentId || ''; roleFilter.value = activeFilters.role === 'CLIENT' ? 'Client' : activeFilters.role === 'ADMIN' ? 'Admin' : activeFilters.role === 'USER' ? 'Employee' : '';
    projectFilter.value = activeFilters.projectId || '';
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
      renderSectionMetrics(view.stats); if (key === 'entries') renderActiveEntriesPanel(view.activeRecords); draw(view.records); setCount(view.records);
    } catch (error) { showToast(error.message || 'Could not load this page.', 'error'); }
    finally { table?.classList.remove('is-data-refreshing'); table?.removeAttribute('aria-busy'); }
  };
  const applyFilters = () => {
    if (serverPaged) {
      activeFilters.q = search.value.trim();
      activeFilters.role = roleFilter?.value === 'Client' ? 'CLIENT' : roleFilter?.value === 'Admin' ? 'ADMIN' : roleFilter?.value === 'Employee' ? 'USER' : '';
      activeFilters.departmentId = departmentFilter?.value || '';
      activeFilters.projectId = key === 'users' ? (projectFilter?.value || '') : '';
      activeFilters.employee = employeeFilter?.value.trim() || '';
      activeFilters.project = projectFilter?.value.trim() || '';
      activeFilters.remarks = remarksFilter?.value || '';
      pageState.page = 1; persistState(); void loadPage(); return;
    }
    const term = search.value.trim().toLowerCase();
    const employeeTerm = employeeFilter?.value.trim().toLowerCase() || '';
    const projectTerm = projectFilter?.value.trim().toLowerCase() || '';
    const records = view.records.filter(record => (!term || record.cells.join(' ').toLowerCase().includes(term)) && (!departmentFilter?.value || record.cells[4] === departmentFilter.value) && (!roleFilter?.value || record.cells[2] === roleFilter.value) && (!employeeTerm || record.cells[0].toLowerCase().includes(employeeTerm)) && (!projectTerm || record.cells[1].toLowerCase().includes(projectTerm)) && (!remarksFilter?.value || (remarksFilter.value === 'with' ? Boolean(record.remarks?.length) : !record.remarks?.length)));
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
window.addEventListener('ace:verified-profile-ready', () => {
  if (document.body.dataset.adminView === 'inquiries') void renderAdminSection();
});
document.addEventListener('DOMContentLoaded', renderAdminSection);
(() => {
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const request=(url,options)=>window.ACEAuth.request(url,options);
 const date=value=>value?new Date(value+'T00:00:00+08:00').toLocaleDateString('en-GB',{timeZone:'Asia/Manila',day:'2-digit',month:'short',year:'numeric'}):'No end date';
 let items=[],page=1,total=0,version=0;
 const notify=(text,type='success')=>window.showToast(text,type);
 async function load(){
  const current=++version,body=document.getElementById('sectionTableBody');if(!body)return;
  body.innerHTML='<tr><td colspan="6"><span class="project-list-loading">Loading projects…</span></td></tr>';
  const params=new URLSearchParams({page,pageSize:25});for(const [id,key]of [['sectionSearch','q'],['projectStatusFilter','status'],['projectTypeFilter','type']]){const value=document.getElementById(id).value;if(value)params.set(key,value);}
  try{
   const [result,counts]=await Promise.all([request('/v1/projects?'+params),request('/v1/projects/summary')]);if(current!==version)return;
   items=result.items;total=result.total;if(!items.length&&page>1&&total){page=1;return load();}
   const stats=new Map(counts.map(p=>[p.id,p]));
   document.getElementById('sectionStats').hidden=true;document.getElementById('sectionTableTitle').textContent='Projects & campaigns · '+Number(total);
   body.innerHTML=items.length?items.map((p,index)=>{const count=stats.get(p.id)||{},status=p.status||'ACTIVE',menu='project-actions-'+index,color=/^#[0-9a-f]{6}$/i.test(p.color)?p.color:'#357bb8';
    const action=(name,label,danger=false)=>'<button type="button" class="project-menu-action'+(danger?' is-danger':'')+'" data-project-action="'+name+'" data-index="'+index+'">'+label+'</button>';
    return '<tr><td data-label="Project / campaign"><div class="project-list-name"><span class="project-color" style="border-color:'+color+';color:'+color+'">'+icon(p.type==='CAMPAIGN'?'users':'folder')+'</span><div><button class="project-name-link" type="button" data-project-action="view" data-index="'+index+'">'+esc(p.name)+'</button><small>'+esc(p.description||p.client_name||'')+'</small></div></div></td><td data-label="Type"><span class="project-type-label">'+(p.type==='CAMPAIGN'?'Campaign':'Project')+'</span></td><td data-label="Dates"><div class="project-date-range"><span>'+esc(date(p.start_date))+'</span><small class="project-list-end">'+(p.end_date?'Until '+esc(date(p.end_date)):'Ongoing')+'</small></div></td><td data-label="People"><div class="project-people"><span><b>'+Number(count.employees||0)+'</b> employees</span><span><b>'+Number(count.clients||0)+'</b> managers</span><span class="project-working"><i aria-hidden="true"></i><b>'+Number(count.working_now||0)+'</b> working now</span></div></td><td data-label="Status"><span class="project-status project-status-'+esc(status.toLowerCase())+'"><i aria-hidden="true"></i>'+esc(status.toLowerCase())+'</span>'+(!p.is_available&&status==='ACTIVE'?'<small class="project-list-end">Outside dates</small>':'')+'</td><td data-label="Actions"><div class="project-row-actions"><button class="btn btn-sm btn-outline" type="button" data-project-action="edit" data-index="'+index+'">Edit</button><button class="project-more-button" type="button" popovertarget="'+menu+'" aria-label="More actions for '+esc(p.name)+'">•••</button><div class="project-row-menu" id="'+menu+'" popover="auto" role="group" aria-label="Project actions">'+action('view','View details')+action('members','Manage employees')+action('managers','Managers')+action(status==='ACTIVE'?'pause':'activate',status==='ACTIVE'?'Pause project':'Activate project')+(status==='ARCHIVED'?'':action('archive','Archive project'))+action('delete','Delete project',true)+'</div></div></td></tr>';
   }).join(''):'<tr><td colspan="6"><div class="empty-state"><h3>No projects found</h3><p>Add a project or campaign, or change your filters.</p></div></td></tr>';
   document.getElementById('projectPage').textContent='Page '+page+' of '+Math.max(1,Math.ceil(total/25));document.getElementById('projectPrevious').disabled=page<=1;document.getElementById('projectNext').disabled=page*25>=total;
  }catch(error){if(current!==version)return;body.innerHTML='<tr><td colspan="6"><div class="empty-state"><h3>Projects unavailable</h3><p>'+esc(error.message||'Try refreshing the page.')+'</p></div></td></tr>';notify(error.message||'Could not load projects','error');}
 }
 function makeModal(title){document.getElementById('projectManagementModal')?.remove();const modal=document.createElement('div');modal.id='projectManagementModal';modal.className='modal';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','projectManagementTitle');modal.innerHTML='<div class="modal-content project-management-dialog"><header class="modal-header"><h2 class="modal-title" id="projectManagementTitle">'+esc(title)+'</h2><button type="button" class="modal-close" aria-label="Close">×</button></header><div class="modal-body" id="projectManagementContent"></div></div>';document.body.appendChild(modal);modal.querySelector('.modal-close').onclick=()=>closeModal(modal.id);modal.addEventListener('click',e=>{if(e.target===modal)closeModal(modal.id);});return modal;}
 async function edit(project){
  const modal=makeModal(project?'Edit '+project.name:'Add project or campaign'),content=modal.querySelector('#projectManagementContent');let departments=[];try{departments=await request('/v1/departments');}catch{}
  const field=(label,input)=>'<label class="form-group"><span class="form-label">'+label+'</span>'+input+'</label>';
  const option=(value,label,current)=>'<option value="'+value+'"'+(value===current?' selected':'')+'>'+label+'</option>';
  content.innerHTML='<form id="projectLifecycleForm"><div class="project-form-scroll"><p class="project-editor-intro">Set the details and availability for this project or campaign.</p><div class="project-form-grid">'+field('Name','<input class="form-input" name="name" maxlength="160" required value="'+esc(project?.name||'')+'">')+field('Type','<select class="form-select" name="type">'+option('PROJECT','Project',project?.type||'PROJECT')+option('CAMPAIGN','Campaign',project?.type)+'</select>')+field('Status','<select class="form-select" name="status">'+['ACTIVE','PAUSED','ARCHIVED'].map(value=>option(value,value[0]+value.slice(1).toLowerCase(),project?.status||'ACTIVE')).join('')+'</select>')+field('Identification color','<input class="form-input project-color-input" name="color" type="color" value="'+esc(project?.color||'#357bb8')+'">')+field('Start date','<input class="form-input" name="start_date" type="date" required value="'+esc(project?.start_date||new Date(Date.now()+8*3600000).toISOString().slice(0,10))+'">')+field('End date (optional)','<input class="form-input" name="end_date" type="date" value="'+esc(project?.end_date||'')+'">')+field('Client name (optional)','<input class="form-input" name="client_name" maxlength="160" value="'+esc(project?.client_name||'')+'">')+field('Department (optional)','<select class="form-select" name="department_id"><option value="">No department</option>'+departments.map(d=>option(d.id,esc(d.name),project?.department_id)).join('')+'</select>')+'</div>'+field('Description (optional)','<textarea class="form-textarea" name="description" maxlength="1000" rows="3">'+esc(project?.description||'')+'</textarea>')+'<p class="form-help">Paused and archived projects keep their history. Employees cannot start new shifts in them or outside the project dates.</p><p class="form-error" id="projectFormError" role="alert"></p></div><div class="form-actions"><button type="button" class="btn btn-outline" data-cancel>Cancel</button><button type="submit" class="btn btn-primary">'+(project?'Save changes':'Create')+'</button></div></form>';
  content.querySelector('[data-cancel]').onclick=()=>closeModal(modal.id);openModal(modal.id);
  content.querySelector('form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,data=Object.fromEntries(new FormData(form));data.end_date||=null;data.department_id||=null;if(data.end_date&&data.end_date<data.start_date){content.querySelector('#projectFormError').textContent='End date must be on or after start date.';return;}const submit=form.querySelector('[type=submit]');submit.disabled=true;try{await request('/v1/projects'+(project?'/'+project.id:''),{method:project?'PATCH':'POST',body:JSON.stringify(data)});closeModal(modal.id);notify(project?'Project updated.':'Project created.');await load();window.dispatchEvent(new CustomEvent('ace:projects-changed'));}catch(error){content.querySelector('#projectFormError').textContent=error.message;}finally{submit.disabled=false;}};
 }
async function manageManagers(project){
 const modal=makeModal('Access · '+project.name),content=modal.querySelector('#projectManagementContent');modal.classList.add('membership-manager');
 content.innerHTML='<form id="projectLifecycleForm"><div class="project-form-scroll"><div class="project-access-tabs"><button type="button" id="managerEmployeesTab">Employees</button><button type="button" class="is-active" aria-current="page">Managers</button></div><div class="membership-section-title">'+icon('users')+'<div><h3>Project managers</h3><p>Control who can view attendance and plan shifts for this project.</p></div></div><div id="managerList" class="project-manager-list" aria-live="polite">Loading managers…</div><section class="manager-add-section"><h3>Add manager</h3><p class="membership-section-caption">Choose an existing employee or client account. An employee cannot manage the same project they work in.</p><label class="form-group"><span class="form-label">Find an account</span><input type="search" id="managerSearch" class="form-input" placeholder="Name or email" autocomplete="off"></label><div id="managerOptions" class="membership-candidates manager-options"></div><div class="membership-pager"><button type="button" id="managerPrevious" class="btn btn-sm btn-outline">Previous</button><span id="managerPage"></span><button type="button" id="managerNext" class="btn btn-sm btn-outline">Next</button></div><label class="form-group manager-level-field"><span class="form-label">Access level</span><select id="managerLevel" class="form-select"><option value="VIEW">View only</option><option value="VIEW_PLAN">View &amp; plan</option></select></label><p class="manager-access-note">Both levels can view attendance and exports. View &amp; plan also grants permission for the shift-planning tools coming in Part 5.</p></section><p id="managerError" class="form-error" role="alert"></p></div><div class="form-actions"><button type="button" id="managerClose" class="btn btn-outline">Close</button><button type="submit" id="managerAdd" class="btn btn-primary" disabled>Add manager</button></div></form>';
 const find=id=>content.querySelector('#'+id);let selected=null,optionPage=1,version=0,managers=[],busy=false;
 const refresh=async()=>{try{managers=await request('/v1/projects/'+project.id+'/managers');find('managerList').innerHTML=managers.length?managers.map(m=>'<article class="project-manager-row" data-manager="'+esc(m.user_id)+'"><div class="project-manager-person"><span class="membership-avatar" aria-hidden="true">'+esc((m.profiles?.full_name||'?').split(/\s+/).map(n=>n[0]).slice(0,2).join(''))+'</span><div><strong>'+esc(m.profiles?.full_name||'Account')+'</strong><small>'+esc(m.profiles?.email||'')+(m.profiles?.status!=='ACTIVE'?' · Inactive':'')+'</small></div></div><div class="project-manager-actions"><label><select aria-label="Access for '+esc(m.profiles?.full_name||'manager')+'" class="form-select" data-manager-level="'+esc(m.user_id)+'"><option value="VIEW"'+(m.access_level==='VIEW'?' selected':'')+'>View only</option><option value="VIEW_PLAN"'+(m.access_level==='VIEW_PLAN'?' selected':'')+'>View &amp; plan</option></select></label><button type="button" class="btn btn-sm btn-outline" data-remove-manager="'+esc(m.user_id)+'" aria-label="Remove '+esc(m.profiles?.full_name||'manager')+'">'+icon('trash')+'<span>Remove</span></button></div></article>').join(''):'<div class="manager-empty">'+icon('users')+'<strong>No managers yet</strong><p>Add an account below to share this project’s attendance.</p></div>';}catch(error){find('managerList').textContent='Managers unavailable.';find('managerError').textContent=error.message;}};
 const options=async()=>{const current=++version;try{const result=await request('/v1/projects/'+project.id+'/manager-options?'+new URLSearchParams({q:find('managerSearch').value,page:optionPage}));if(current!==version)return;find('managerOptions').innerHTML=result.items.length?result.items.map(u=>'<label><input type="radio" name="managerAccount" value="'+esc(u.id)+'"'+(selected===u.id?' checked':'')+'><span><strong>'+esc(u.full_name||u.email)+'</strong><small>'+esc(u.email)+' · '+(u.role==='CLIENT'?'Client':'Employee')+'</small></span></label>').join(''):'<p class="form-help">No active accounts match this search.</p>';find('managerPage').textContent='Page '+optionPage+' of '+Math.max(1,Math.ceil(result.total/25));find('managerPrevious').disabled=optionPage<=1;find('managerNext').disabled=optionPage*25>=result.total;find('managerNext').parentElement.hidden=result.total<=25;}catch(error){find('managerError').textContent=error.message;}};
 const save=async(userId,level)=>request('/v1/projects/'+project.id+'/managers/'+userId,{method:'PUT',body:JSON.stringify({accessLevel:level})});
 find('managerEmployeesTab').onclick=()=>manageEmployees(project);find('managerClose').onclick=()=>closeModal(modal.id);find('managerOptions').onchange=e=>{if(e.target.name==='managerAccount'){selected=e.target.value;const current=managers.find(m=>m.user_id===selected);if(current)find('managerLevel').value=current.access_level;find('managerLevel').dispatchEvent(new Event('change',{bubbles:true}));find('managerAdd').disabled=false;find('managerAdd').textContent=current?'Save access':'Add manager';}};
 let timer;find('managerSearch').oninput=()=>{selected=null;find('managerAdd').disabled=true;find('managerAdd').textContent='Add manager';clearTimeout(timer);timer=setTimeout(()=>{optionPage=1;void options();},200);};find('managerPrevious').onclick=()=>{selected=null;find('managerAdd').disabled=true;optionPage--;void options();};find('managerNext').onclick=()=>{selected=null;find('managerAdd').disabled=true;optionPage++;void options();};
 find('managerList').onchange=async e=>{const userId=e.target.dataset.managerLevel;if(!userId)return;const previous=managers.find(m=>m.user_id===userId)?.access_level;e.target.disabled=true;try{await save(userId,e.target.value);notify('Manager access updated.');await refresh();}catch(error){e.target.value=previous;find('managerError').textContent=error.message;await refresh();}finally{e.target.disabled=false;}};
 find('managerList').onclick=async e=>{const button=e.target.closest('[data-remove-manager]');if(!button)return;if(!await window.ACEUI.confirm({title:'Remove manager access?',message:'New requests will no longer include this project. Attendance records are kept.',confirmLabel:'Remove access',danger:true}))return;button.disabled=true;try{await request('/v1/projects/'+project.id+'/managers/'+button.dataset.removeManager,{method:'DELETE'});notify('Manager access removed.');await refresh();await load();}catch(error){find('managerError').textContent=error.message;button.disabled=false;}};
 find('projectLifecycleForm').onsubmit=async e=>{e.preventDefault();if(busy||!selected)return;busy=true;find('managerAdd').disabled=true;find('managerError').textContent='';try{await save(selected,find('managerLevel').value);notify('Manager access saved.');selected=null;await refresh();await options();await load();find('managerAdd').textContent='Add manager';}catch(error){find('managerError').textContent=error.message;}finally{busy=false;find('managerAdd').disabled=!selected;}};
 openModal(modal.id);await Promise.all([refresh(),options()]);
}

async function manageEmployees(project){
 const modal=makeModal('Employees · '+project.name),content=modal.querySelector('#projectManagementContent'),selected=new Map();let candidatePage=1,memberPage=1,history=false,candidates=[],csvValid=true,searchVersion=0;
 modal.classList.add('membership-manager');content.innerHTML='<form id="projectLifecycleForm"><div class="project-form-scroll"><div class="project-access-tabs"><button type="button" class="is-active" aria-current="page">Employees</button><button type="button" id="employeeManagersTab">Managers</button></div><div class="membership-section-title">'+icon('users')+'<div><h3>Assign employees</h3><p>Choose who works on this project and when they joined.</p></div></div><div class="membership-filters"><label class="form-group"><span class="form-label">Search employees</span><input id="memberSearch" class="form-input" type="search" placeholder="Name or email"></label><label class="form-group"><span class="form-label">Department</span><select id="memberDepartment" class="form-select"><option value="">All departments</option></select></label><label class="form-group"><span class="form-label">Join date</span><input id="memberJoin" type="date" class="form-input" required></label></div><div class="membership-selection-bar"><div class="membership-selection-summary"><strong id="memberSelected">0 selected</strong><button type="button" id="memberSelectPage" class="membership-text-button">Select this page</button></div><button type="button" class="btn btn-sm btn-outline" id="memberClear">'+icon('x')+'<span>Clear selection</span></button></div><div id="memberCandidates" class="membership-candidates"></div><div class="membership-pager"><button type="button" class="btn btn-sm btn-outline" id="candidatePrevious">Previous</button><span id="candidatePage"></span><button type="button" class="btn btn-sm btn-outline" id="candidateNext">Next</button></div><details class="membership-import"><summary>'+icon('file-text')+'<span><strong>Import employees</strong><small>Add multiple employees from a CSV</small></span>'+icon('chevron-down','ui-icon membership-import-chevron')+'</summary><div class="membership-import-body"><p>Use <code>email</code> or <code>employee_id</code>. Optional: <code>joined_on</code> (YYYY-MM-DD).</p><label class="membership-upload" for="membershipCsv">'+icon('file-text')+'<strong>Choose a CSV file</strong><span id="membershipFileName">Up to 200 employees · 50 KB</span></label><input type="file" id="membershipCsv" class="membership-file-input" accept=".csv,text/csv"><button type="button" class="membership-text-button" id="membershipTemplate">Download template</button><div id="membershipPreview" aria-live="polite"></div></div></details><div class="membership-history-heading"><div><h3>Memberships</h3><p class="membership-section-caption">Current assignments and previous membership dates.</p></div><div class="client-tabs"><button type="button" id="memberCurrent" class="is-active" aria-pressed="true">Current</button><button type="button" id="memberPast" aria-pressed="false">History</button></div></div><div id="membershipList"></div><div class="membership-pager"><button type="button" class="btn btn-sm btn-outline" id="memberPrevious">Previous</button><span id="memberPage"></span><button type="button" class="btn btn-sm btn-outline" id="memberNext">Next</button></div><p id="memberError" class="form-error" role="alert"></p></div><div class="form-actions"><button type="button" class="btn btn-outline" id="memberCancel">Close</button><button type="submit" class="btn btn-primary" id="memberApply" disabled>Assign selected</button></div></form>';
 const find=id=>content.querySelector('#'+id);find('employeeManagersTab').onclick=()=>manageManagers(project);find('memberJoin').value=new Date(Date.now()+8*3600000).toISOString().slice(0,10);find('memberJoin').max=find('memberJoin').value;window.ACECalendar?.mount(find('memberJoin'));
 const selection=()=>{find('memberSelected').textContent=selected.size+' selected';find('memberSelectPage').textContent=candidates.length&&candidates.every(u=>selected.has(u.id))?'Clear this page':'Select this page';find('memberApply').disabled=!selected.size||!csvValid||project.status==='ARCHIVED';};
 const drawCandidates=()=>{find('memberCandidates').innerHTML=candidates.length?candidates.map(user=>'<label><input type="checkbox" data-candidate="'+esc(user.id)+'"'+(selected.has(user.id)?' checked':'')+'><span class="membership-avatar" aria-hidden="true">'+esc((user.full_name||user.email||'?').split(/\s+/).map(n=>n[0]).slice(0,2).join('').toUpperCase())+'</span><span><strong>'+esc(user.full_name||user.email)+'</strong><small>'+esc(user.email)+'</small></span></label>').join(''):'<p class="form-help">No active employees match these filters.</p>';};
 const loadCandidates=async()=>{const version=++searchVersion;find('memberCandidates').textContent='Loading employees…';const params=new URLSearchParams({page:candidatePage,q:find('memberSearch').value,departmentId:find('memberDepartment').value});try{const result=await request('/v1/projects/'+project.id+'/employee-options?'+params);if(version!==searchVersion)return;candidates=result.items;drawCandidates();selection();find('candidatePage').textContent='Page '+candidatePage+' of '+Math.max(1,Math.ceil(result.total/25));find('candidatePrevious').disabled=candidatePage<=1;find('candidateNext').disabled=candidatePage*25>=result.total;find('candidateNext').parentElement.hidden=result.total<=25;}catch(error){find('memberCandidates').textContent='Employees unavailable.';find('memberError').textContent=error.message;}};
 const loadMembers=async()=>{find('membershipList').textContent='Loading memberships…';try{const result=await request('/v1/projects/'+project.id+'/memberships?'+new URLSearchParams({history,page:memberPage}));find('membershipList').innerHTML=result.items.length?'<table class="membership-table"><thead><tr><th>Employee</th><th>Joined</th><th>Left</th><th></th></tr></thead><tbody>'+result.items.map(m=>'<tr><td><strong>'+esc(m.profiles?.full_name||'Employee')+'</strong><small>'+esc(m.profiles?.email||'')+'</small></td><td>'+esc(new Date(m.joined_at).toLocaleDateString('en-GB',{timeZone:'Asia/Manila'}))+'</td><td>'+(m.left_at?esc(new Date(m.left_at).toLocaleDateString('en-GB',{timeZone:'Asia/Manila'})):'Current')+'</td><td>'+(!m.left_at?'<button type="button" class="btn btn-sm btn-outline" data-end-membership="'+esc(m.user_id)+'">Remove</button>':'')+'</td></tr>').join('')+'</tbody></table>':'<p class="form-help">'+(history?'No past memberships.':'No employees assigned yet.')+'</p>';find('memberPage').textContent='Page '+memberPage+' of '+Math.max(1,Math.ceil(result.total/25));find('memberPrevious').disabled=memberPage<=1;find('memberNext').disabled=memberPage*25>=result.total;find('memberNext').parentElement.hidden=result.total<=25;}catch(error){find('membershipList').textContent='Memberships unavailable.';find('memberError').textContent=error.message;}};
 find('memberSelectPage').onclick=()=>{const all=candidates.every(u=>selected.has(u.id));for(const u of candidates){if(all)selected.delete(u.id);else if(selected.size<200)selected.set(u.id,{employeeId:u.id});}drawCandidates();selection();};find('memberCandidates').onchange=e=>{const id=e.target.dataset.candidate;if(!id)return;if(e.target.checked){if(selected.size>=200){e.target.checked=false;notify('Select up to 200 employees at once.','warning');return;}selected.set(id,{employeeId:id});}else selected.delete(id);selection();};
 let timer;find('memberSearch').oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{candidatePage=1;void loadCandidates();},200);};find('memberDepartment').onchange=()=>{candidatePage=1;void loadCandidates();};find('candidatePrevious').onclick=()=>{candidatePage--;void loadCandidates();};find('candidateNext').onclick=()=>{candidatePage++;void loadCandidates();};
 find('memberClear').onclick=()=>{selected.clear();csvValid=true;find('membershipCsv').value='';find('membershipFileName').textContent='Up to 200 employees · 50 KB';find('membershipPreview').replaceChildren();drawCandidates();selection();};find('memberCancel').onclick=()=>closeModal(modal.id);
 for(const [id,value]of [['memberCurrent',false],['memberPast',true]])find(id).onclick=()=>{history=value;memberPage=1;find('memberCurrent').setAttribute('aria-pressed',String(!history));find('memberPast').setAttribute('aria-pressed',String(history));find('memberCurrent').classList.toggle('is-active',!history);find('memberPast').classList.toggle('is-active',history);void loadMembers();};find('memberPrevious').onclick=()=>{memberPage--;void loadMembers();};find('memberNext').onclick=()=>{memberPage++;void loadMembers();};
 find('membershipList').onclick=async e=>{const button=e.target.closest('[data-end-membership]');if(!button)return;if(!await window.ACEUI.confirm({title:'End employee membership?',message:'The leave time will be recorded. Attendance and membership history remain available. Existing shifts can still clock out.',confirmLabel:'Remove employee'}))return;button.disabled=true;try{await request('/v1/projects/'+project.id+'/memberships',{method:'POST',body:JSON.stringify({remove:true,assignments:[{employeeId:button.dataset.endMembership}]})});notify('Membership ended. History preserved.');await loadMembers();await load();window.dispatchEvent(new CustomEvent('ace:projects-changed'));}catch(error){find('memberError').textContent=error.message;button.disabled=false;}};
 find('membershipCsv').onchange=async e=>{const file=e.target.files[0];if(!file)return;find('membershipFileName').textContent=file.name;csvValid=false;selection();find('membershipPreview').textContent='Checking CSV…';try{if(file.size>50000)throw Error('CSV must be under 50 KB.');const result=await request('/v1/projects/'+project.id+'/employees/import-preview',{method:'POST',body:JSON.stringify({csv:await file.text(),joinedOn:find('memberJoin').value})});csvValid=result.valid;selected.clear();if(csvValid)result.items.forEach(row=>selected.set(row.employeeId,{employeeId:row.employeeId,joinedOn:row.joinedOn}));find('membershipPreview').innerHTML='<p>'+result.items.length+' rows · '+(csvValid?'Ready to assign. This replaces the previous selection.':'Fix the errors and upload again. Nothing has been saved.')+'</p><div class="membership-preview-rows">'+result.items.map(row=>'<div'+(row.error?' class="form-error"':'')+'>Row '+Number(row.row)+' · '+esc(row.name||row.email||'Unknown employee')+' · '+esc(row.error||row.joinedOn)+'</div>').join('')+'</div>';drawCandidates();}catch(error){find('membershipPreview').textContent=error.message;}selection();};
 find('membershipTemplate').onclick=()=>{const url=URL.createObjectURL(new Blob(['email,joined_on\nemployee@example.test,'+find('memberJoin').value+'\n'],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download='employee-assignments-template.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 find('projectLifecycleForm').onsubmit=async e=>{e.preventDefault();if(!selected.size||!csvValid)return;find('memberError').textContent='';find('memberApply').disabled=true;const assignments=[...selected.values()].map(row=>({...row,joinedOn:row.joinedOn||find('memberJoin').value}));try{const result=await request('/v1/projects/'+project.id+'/memberships',{method:'POST',body:JSON.stringify({assignments})});notify(result.changed+' assigned'+(result.skipped?' · '+result.skipped+' already assigned':''));selected.clear();find('membershipPreview').replaceChildren();find('membershipCsv').value='';drawCandidates();await loadMembers();await load();window.dispatchEvent(new CustomEvent('ace:projects-changed'));}catch(error){find('memberError').textContent=error.message;}selection();};
 openModal(modal.id);try{const departments=await request('/v1/departments');find('memberDepartment').innerHTML='<option value="">All departments</option>'+departments.map(d=>'<option value="'+esc(d.id)+'">'+esc(d.name)+'</option>').join('');}catch{}await Promise.all([loadCandidates(),loadMembers()]);
}

 async function view(project){const modal=makeModal(project.name),content=modal.querySelector('#projectManagementContent');content.innerHTML='<dl class="project-details">'+[['Type',project.type==='CAMPAIGN'?'Campaign':'Project'],['Status',project.status],['Dates',date(project.start_date)+' – '+date(project.end_date)],['Client',project.client_name||'—'],['Description',project.description||'—']].map(([label,value])=>'<div><dt>'+label+'</dt><dd>'+esc(value)+'</dd></div>').join('')+'</dl><h3>Assigned employees</h3><p id="projectMembers">Loading employees…</p><div class="form-actions"><button type="button" class="btn btn-outline" id="projectManageEmployees">Manage employees</button></div>';content.querySelector('#projectManageEmployees').onclick=()=>manageEmployees(project);openModal(modal.id);try{const [assignments,users]=await Promise.all([request('/v1/user-projects'),request('/v1/users')]);const ids=new Set(assignments.filter(a=>a.project_id===project.id).map(a=>a.user_id));content.querySelector('#projectMembers').textContent=users.filter(u=>ids.has(u.id)).map(u=>u.full_name||u.email).join(', ')||'No employees assigned.';}catch{content.querySelector('#projectMembers').textContent='Employee assignments unavailable.';}}
 window.mountProjectManagement=async()=>{
  document.title='Projects & campaigns · ACE Outsource Solutions';
  const root=document.querySelector('[data-admin-view="projects"] #sectionTableBody');if(!root)return;if(root.dataset.projectManagement)return load();root.dataset.projectManagement='true';
  root.closest('table').classList.add('project-management-table');
  document.getElementById('sectionTitle').textContent='Projects & campaigns';document.getElementById('sectionDescription').textContent='Manage project details, dates and availability. Paused and archived work remains in attendance history.';document.getElementById('sectionTableTitle').textContent='Projects & campaigns';document.getElementById('sectionAction').textContent='+ New project / campaign';document.getElementById('sectionAction').onclick=()=>edit(null);document.getElementById('sectionTableHead').innerHTML='<tr>'+['Project / campaign','Type','Dates','People','Status','Actions'].map(name=>'<th>'+name+'</th>').join('')+'</tr>';
  const search=document.getElementById('sectionSearch');search.placeholder='Search projects and campaigns';const filters=document.createElement('div');filters.className='project-list-filters';filters.innerHTML='<label>Status<select id="projectStatusFilter" class="form-select"><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="PAUSED">Paused</option><option value="ARCHIVED">Archived</option></select></label><label>Type<select id="projectTypeFilter" class="form-select"><option value="">All types</option><option value="PROJECT">Project</option><option value="CAMPAIGN">Campaign</option></select></label>';search.after(filters);
  const footer=document.createElement('div');footer.className='table-pagination project-list-pagination';footer.innerHTML='<button class="btn btn-sm btn-outline" id="projectPrevious" type="button">Previous</button><span id="projectPage"></span><button class="btn btn-sm btn-outline" id="projectNext" type="button">Next</button>';root.closest('.table-container').appendChild(footer);
  let timer;search.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{page=1;void load();},220);});filters.addEventListener('change',()=>{page=1;void load();});document.getElementById('projectPrevious').onclick=()=>{if(page>1){page--;void load();}};document.getElementById('projectNext').onclick=()=>{if(page*25<total){page++;void load();}};
  root.addEventListener('beforetoggle', e=>{
   const menu=e.target;if(!menu.classList.contains('project-row-menu')||e.newState!=='open')return;
   const trigger=root.querySelector('[popovertarget="'+menu.id+'"]');if(!trigger)return;const rect=trigger.getBoundingClientRect(),width=Math.min(210,innerWidth-24);menu.style.width=width+'px';menu.style.left=Math.max(12,Math.min(rect.right-width,innerWidth-width-12))+'px';menu.style.top=(rect.bottom+240<innerHeight?rect.bottom+6:Math.max(12,rect.top-240))+'px';
  },true);
  root.addEventListener('click',async e=>{const button=e.target.closest('[data-project-action]');if(!button)return;const project=items[Number(button.dataset.index)],action=button.dataset.projectAction;if(!project)return;button.closest('.project-row-menu')?.hidePopover();if(action==='managers')return manageManagers(project);if(action==='members')return manageEmployees(project);if(action==='view')return view(project);if(action==='edit')return edit(project);
   const status={pause:'PAUSED',activate:'ACTIVE',archive:'ARCHIVED'}[action];if(action==='delete'&&!await window.ACEUI.confirm({title:'Delete '+project.name+'?',message:'Projects with attendance history cannot be deleted. Archive them to retain the records.',confirmLabel:'Delete',danger:true}))return;
   button.disabled=true;try{await request('/v1/projects/'+project.id,{method:action==='delete'?'DELETE':'PATCH',...(status?{body:JSON.stringify({status})}:{})});notify(action==='delete'?'Project deleted.':'Project status updated.');await load();window.dispatchEvent(new CustomEvent('ace:projects-changed'));}catch(error){notify(error.message,'error');button.disabled=false;}
  });
  await load();
 };
})();
