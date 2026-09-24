// Akio <3: Project source maintained by Akio Zaki Salomon.
(() => {
  const request = (...args) => window.ACEAuth.request(...args);
  const toast = (message, type = 'success') => window.showToast ? window.showToast(message, type) : alert(message);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const formatTargetMinutes = value => { const total = Math.max(0, Number(value) || 0); const hours = Math.floor(total / 60); const minutes = total % 60; return `${hours}h${minutes ? ` ${minutes}m` : ''}`; };
  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const workdayLabel = days => (Array.isArray(days) && days.length ? [...days].sort((a, b) => a - b).map(day => weekdayNames[day]).join(', ') : 'Mon–Fri');
  let schedules = [];
  let allUsers = [];
  let selectedScheduleId = null;
  let schedulePage = 1; let schedulePageSize = 25; let scheduleTotal = 0;
  let employeeOptions = new Map();
  const assignedPeople = schedule => (schedule.user_schedule_assignments || []).map(assignment => allUsers.find(user => user.id === assignment.user_id) || { id: assignment.user_id, full_name: 'Unknown employee', email: 'Employee record unavailable', status: 'UNKNOWN' });
  const renderAssignments = () => {
    const panel = document.getElementById('scheduleAssignmentsPanel');
    const schedule = schedules.find(item => item.id === selectedScheduleId);
    if (!panel || !schedule) { panel && (panel.hidden = true); return; }
    const people = assignedPeople(schedule);
    panel.hidden = false;
    panel.innerHTML = `<div class="schedule-assignments-heading"><div><p class="admin-section-kicker">SCHEDULE ASSIGNMENTS</p><h2>${escapeHtml(schedule.name)}</h2><p>${people.length ? `${people.length} employee${people.length === 1 ? '' : 's'} currently follows this ${schedule.schedule_type === 'FLEX' ? 'flextime rule' : 'schedule'}.` : 'No employees are assigned to this schedule. It can be deleted.'}</p></div><button class="btn btn-outline btn-sm" type="button" data-close-assignments>Close</button></div><div class="schedule-assignment-list">${people.length ? people.map(person => `<article class="schedule-assignment-person"><div><strong>${escapeHtml(person.full_name || person.email)}</strong><span>${escapeHtml(person.email || '')}${person.status && person.status !== 'ACTIVE' ? ` · ${escapeHtml(String(person.status).toLowerCase())}` : ''}</span></div><button class="btn btn-sm btn-outline" type="button" data-unassign-user="${person.id}" data-schedule-id="${schedule.id}">Remove assignment</button></article>`).join('') : '<p class="schedule-assignment-empty">Assign an employee above when this schedule is ready to use.</p>'}</div>`;
    panel.querySelector('[data-close-assignments]')?.addEventListener('click', () => { selectedScheduleId = null; renderAssignments(); });
    panel.querySelectorAll('[data-unassign-user]').forEach(button => button.addEventListener('click', async () => {
      const person = allUsers.find(user => user.id === button.dataset.unassignUser);
      if (!await window.ACEUI.confirm({ title: 'Remove schedule assignment?', message: `Remove ${person?.full_name || person?.email || 'this employee'} from ${schedule.name}?`, confirmLabel: 'Remove', danger: true })) return;
      button.disabled = true; button.textContent = 'Removing…';
      try { await request(`/v1/users/${button.dataset.unassignUser}/schedule`, { method: 'PUT', body: JSON.stringify({ scheduleId: null }) }); toast('Schedule assignment removed.'); await load(); }
      catch (error) { button.disabled = false; button.textContent = 'Remove assignment'; toast(error.message || 'Could not remove the assignment.', 'error'); }
    }));
  };
  const load = async () => {
    const [scheduleResponse, users] = await Promise.all([request('/v1/schedules?page=' + schedulePage + '&pageSize=' + schedulePageSize), request('/v1/users')]); schedules = scheduleResponse.items || scheduleResponse; scheduleTotal = scheduleResponse.total ?? schedules.length; allUsers = users;
    const employees = allUsers.filter(user => user.role === 'USER' && user.status === 'ACTIVE');
    const employeeInput = document.getElementById('scheduleEmployee'); const employeeList = document.getElementById('scheduleEmployeeOptions'); const assignmentSelect = document.getElementById('scheduleAssignment'); const assignButton = document.querySelector('#assignmentForm button[type="submit"]');
    employeeOptions = new Map(employees.map(user => [`${user.full_name || user.email} — ${user.email}`, user.id]));
    employeeInput.value = '';
    employeeList.innerHTML = employees.map(user => `<option value="${escapeHtml(user.full_name || user.email)} — ${escapeHtml(user.email)}"></option>`).join('');
    const activeSchedules = schedules.filter(item => item.is_active);
    assignmentSelect.innerHTML = activeSchedules.length ? `<option value="" selected disabled>Select schedule</option>${activeSchedules.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('')}` : '<option value="">Create a schedule first</option>';
    employeeInput.disabled = !employees.length; employeeInput.placeholder = employees.length ? 'Search employees by name or email' : 'No active employees available'; assignmentSelect.disabled = !activeSchedules.length; assignButton.disabled = !employees.length || !activeSchedules.length;
    document.getElementById('scheduleRows').innerHTML = schedules.length ? schedules.map(item => { const count = item.user_schedule_assignments?.length || 0; return `<tr><td>${escapeHtml(item.name)}</td><td>${item.schedule_type === 'FLEX' ? 'Flextime' : `${escapeHtml(item.start_time?.slice(0,5) || '—')}–${escapeHtml(item.end_time?.slice(0,5) || '—')}`}</td><td>${workdayLabel(item.scheduled_weekdays)}</td><td>${formatTargetMinutes(item.daily_elapsed_minutes)}</td><td><button class="schedule-assignment-count" type="button" data-view-assignees="${item.id}">${count ? `View ${count} employee${count === 1 ? '' : 's'}` : 'No employees'}</button></td><td><div class="schedule-row-actions"><button class="btn btn-sm btn-outline" data-view-assignees="${item.id}" type="button">View employees</button><button class="btn btn-sm btn-danger delete-schedule" data-id="${item.id}" data-assigned="${count}" type="button">Delete</button></div></td></tr>`; }).join('') : '<tr class="table-empty-row"><td colspan="6"><div class="empty-state empty-state-compact"><h3>No schedules yet</h3><p>Create a schedule before assigning employees to it.</p></div></td></tr>';
    document.querySelectorAll('[data-view-assignees]').forEach(button => button.addEventListener('click', () => { selectedScheduleId = button.dataset.viewAssignees; renderAssignments(); document.getElementById('scheduleAssignmentsPanel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }));
    document.querySelectorAll('.delete-schedule').forEach(button => button.addEventListener('click', async () => {
      const assigned = Number(button.dataset.assigned);
      if (assigned > 0) {
        selectedScheduleId = button.dataset.id; renderAssignments(); document.getElementById('scheduleAssignmentsPanel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        toast(`Remove the ${assigned} assignment${assigned === 1 ? '' : 's'} before deleting this schedule.`, 'warning');
        return;
      }
      if (!await window.ACEUI.confirm({ title: 'Delete schedule?', message: 'Delete this schedule? This cannot be undone.', confirmLabel: 'Delete', danger: true })) return;
      button.disabled = true; button.textContent = 'Deleting…';
      try { await request(`/v1/schedules/${button.dataset.id}`, { method: 'DELETE' }); if (selectedScheduleId === button.dataset.id) selectedScheduleId = null; toast('Schedule deleted.'); await load(); }
      catch (error) { button.disabled = false; button.textContent = 'Delete'; if (error.status === 409) { selectedScheduleId = button.dataset.id; await load(); renderAssignments(); } toast(error.message || 'Could not delete schedule.', 'error'); }
    }));
    let pager = document.getElementById('schedulePagination'); if (!pager) { pager = document.createElement('div'); pager.id = 'schedulePagination'; pager.className = 'admin-pagination'; document.getElementById('scheduleRows').closest('.table-responsive').insertAdjacentElement('afterend', pager); }
    const pages = Math.max(1, Math.ceil(scheduleTotal / schedulePageSize)); pager.innerHTML = scheduleTotal > schedulePageSize ? '<span>Showing ' + ((schedulePage - 1) * schedulePageSize + 1) + '–' + Math.min(schedulePage * schedulePageSize, scheduleTotal) + ' of ' + scheduleTotal + '</span><div class="pagination"><select class="form-select"><option value="25"' + (schedulePageSize === 25 ? ' selected' : '') + '>25</option><option value="50"' + (schedulePageSize === 50 ? ' selected' : '') + '>50</option><option value="100"' + (schedulePageSize === 100 ? ' selected' : '') + '>100</option></select><button data-page="' + (schedulePage - 1) + '" ' + (schedulePage === 1 ? 'disabled' : '') + '>‹</button><button data-page="' + (schedulePage + 1) + '" ' + (schedulePage === pages ? 'disabled' : '') + '>›</button></div>' : '';
    pager.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => { schedulePage = Number(button.dataset.page); load(); })); pager.querySelector('select')?.addEventListener('change', event => { schedulePageSize = Number(event.target.value); schedulePage = 1; load(); });
    renderAssignments();
  };
  const mount = async () => { try { const me = await request('/v1/me'); if (me.profile.role !== 'ADMIN') return location.replace('/user-dashboard'); await load(); } catch { location.replace('/login'); }
    const type = document.getElementById('scheduleType'); const typeHelp = document.getElementById('scheduleTypeHelp'); const scheduleForm = document.getElementById('scheduleForm'); const workdayInputs = [...document.querySelectorAll('input[name="scheduleWorkday"]')]; const workdayError = document.getElementById('scheduleWorkdayError'); const createButton = scheduleForm.querySelector('button[type="submit"]');
    const toggle = () => { const flexible = type.value === 'FLEX'; document.querySelectorAll('.fixed-time').forEach(node => node.hidden = flexible); typeHelp.textContent = flexible ? 'No late clock-in warning. Only selected workdays are tracked.' : 'Employees clock in at set times on selected workdays.'; };
    const validateWorkdays = () => { const valid = workdayInputs.some(input => input.checked); workdayError.hidden = valid; createButton.disabled = !valid; return valid; };
    type.addEventListener('change', toggle); workdayInputs.forEach(input => input.addEventListener('change', validateWorkdays)); toggle(); validateWorkdays();
    scheduleForm.addEventListener('submit', async event => { event.preventDefault(); if (!validateWorkdays()) { workdayInputs[0].focus(); return; } const hours = Number(document.getElementById('scheduleHours').value); const minutes = Number(document.getElementById('scheduleMinutes').value); const dailyElapsedMinutes = hours * 60 + minutes; if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 24 || minutes < 0 || minutes > 59 || dailyElapsedMinutes < 60 || dailyElapsedMinutes > 1440) { toast('Enter a daily target between 1 hour and 24 hours.', 'warning'); return; } try { const workdays = workdayInputs.filter(input => input.checked).map(input => Number(input.value)); await request('/v1/schedules', { method: 'POST', body: JSON.stringify({ name: document.getElementById('scheduleName').value, scheduleType: type.value, startTime: document.getElementById('scheduleStart').value, endTime: document.getElementById('scheduleEnd').value, dailyElapsedMinutes, workdays }) }); toast('Schedule created.'); event.target.reset(); document.getElementById('scheduleHours').value = '9'; document.getElementById('scheduleMinutes').value = '0'; toggle(); validateWorkdays(); await load(); } catch (error) { toast(error.message || 'Could not create schedule.', 'error'); } });
    document.getElementById('assignmentForm').addEventListener('submit', async event => { event.preventDefault(); const employeeInput = document.getElementById('scheduleEmployee'); const employeeId = employeeOptions.get(employeeInput.value); if (!employeeId) { toast('Choose an employee from the search results.', 'warning'); employeeInput.focus(); return; } try { await request(`/v1/users/${employeeId}/schedule`, { method: 'PUT', body: JSON.stringify({ scheduleId: document.getElementById('scheduleAssignment').value }) }); toast('Schedule assigned.'); await load(); } catch (error) { toast(error.message || 'Could not assign schedule.', 'error'); } });
    window.refreshScheduleFlex = load;
    if (!document.body.dataset.scheduleLiveBound) {
      document.body.dataset.scheduleLiveBound = 'true';
      window.addEventListener('ace:live-data', () => { if (!document.querySelector('form:focus-within')) void window.refreshScheduleFlex?.().catch(() => {}); });
    }
  };
  window.mountScheduleFlex = mount;
  document.addEventListener('DOMContentLoaded', window.mountScheduleFlex);
})();
