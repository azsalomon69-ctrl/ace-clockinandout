(() => {
  const request = (...args) => window.ACEAuth.request(...args);
  const toast = (message, type = 'success') => window.showToast ? window.showToast(message, type) : alert(message);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const workdayLabel = days => (Array.isArray(days) && days.length ? [...days].sort((a, b) => a - b).map(day => weekdayNames[day]).join(', ') : 'Mon–Fri');
  let schedules = [];
  let allUsers = [];
  let selectedScheduleId = null;
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
    const [items, users] = await Promise.all([request('/v1/schedules'), request('/v1/users')]); schedules = items; allUsers = users;
    const employees = allUsers.filter(user => user.role === 'USER' && user.status === 'ACTIVE');
    const employeeInput = document.getElementById('scheduleEmployee'); const employeeList = document.getElementById('scheduleEmployeeOptions'); const assignmentSelect = document.getElementById('scheduleAssignment'); const assignButton = document.querySelector('#assignmentForm button[type="submit"]');
    employeeOptions = new Map(employees.map(user => [`${user.full_name || user.email} — ${user.email}`, user.id]));
    employeeInput.value = '';
    employeeList.innerHTML = employees.map(user => `<option value="${escapeHtml(user.full_name || user.email)} — ${escapeHtml(user.email)}"></option>`).join('');
    const activeSchedules = schedules.filter(item => item.is_active);
    assignmentSelect.innerHTML = activeSchedules.length ? `<option value="" selected disabled>Select schedule</option>${activeSchedules.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('')}` : '<option value="">Create a schedule first</option>';
    employeeInput.disabled = !employees.length; employeeInput.placeholder = employees.length ? 'Search employees by name or email' : 'No active employees available'; assignmentSelect.disabled = !activeSchedules.length; assignButton.disabled = !employees.length || !activeSchedules.length;
    document.getElementById('scheduleRows').innerHTML = schedules.length ? schedules.map(item => { const count = item.user_schedule_assignments?.length || 0; return `<tr><td>${escapeHtml(item.name)}</td><td>${item.schedule_type === 'FLEX' ? 'Flextime' : `${escapeHtml(item.start_time?.slice(0,5) || '—')}–${escapeHtml(item.end_time?.slice(0,5) || '—')}`}</td><td>${workdayLabel(item.scheduled_weekdays)}</td><td>${item.daily_elapsed_minutes / 60}h</td><td>${item.break_limit_minutes}m</td><td><button class="schedule-assignment-count" type="button" data-view-assignees="${item.id}">${count ? `View ${count} employee${count === 1 ? '' : 's'}` : 'No employees'}</button></td><td><div class="schedule-row-actions"><button class="btn btn-sm btn-outline" data-view-assignees="${item.id}" type="button">View employees</button><button class="btn btn-sm btn-danger delete-schedule" data-id="${item.id}" data-assigned="${count}" type="button">Delete</button></div></td></tr>`; }).join('') : '<tr><td colspan="7">No schedules yet.</td></tr>';
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
    renderAssignments();
  };
  const mount = async () => { try { const me = await request('/v1/me'); if (me.profile.role !== 'ADMIN') return location.replace('/user-dashboard'); await load(); } catch { location.replace('/login'); }
    const type = document.getElementById('scheduleType'); const typeHelp = document.getElementById('scheduleTypeHelp'); const scheduleForm = document.getElementById('scheduleForm'); const workdayInputs = [...document.querySelectorAll('input[name="scheduleWorkday"]')]; const workdayError = document.getElementById('scheduleWorkdayError'); const createButton = scheduleForm.querySelector('button[type="submit"]');
    const toggle = () => { const flexible = type.value === 'FLEX'; document.querySelectorAll('.fixed-time').forEach(node => node.hidden = flexible); typeHelp.textContent = flexible ? 'No late clock-in warning. Only selected workdays are tracked.' : 'Employees clock in at set times on selected workdays.'; };
    const validateWorkdays = () => { const valid = workdayInputs.some(input => input.checked); workdayError.hidden = valid; createButton.disabled = !valid; return valid; };
    type.addEventListener('change', toggle); workdayInputs.forEach(input => input.addEventListener('change', validateWorkdays)); toggle(); validateWorkdays();
    scheduleForm.addEventListener('submit', async event => { event.preventDefault(); if (!validateWorkdays()) { workdayInputs[0].focus(); return; } try { const workdays = workdayInputs.filter(input => input.checked).map(input => Number(input.value)); await request('/v1/schedules', { method: 'POST', body: JSON.stringify({ name: document.getElementById('scheduleName').value, scheduleType: type.value, startTime: document.getElementById('scheduleStart').value, endTime: document.getElementById('scheduleEnd').value, dailyElapsedMinutes: Number(document.getElementById('scheduleHours').value) * 60, breakLimitMinutes: Number(document.getElementById('scheduleBreak').value), workdays }) }); toast('Schedule created.'); event.target.reset(); toggle(); validateWorkdays(); await load(); } catch (error) { toast(error.message || 'Could not create schedule.', 'error'); } });
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
