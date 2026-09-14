(() => {
  const request = (...args) => window.ACEAuth.request(...args);
  const toast = (message, type = 'success') => window.showToast ? window.showToast(message, type) : alert(message);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const workdayLabel = days => (Array.isArray(days) && days.length ? [...days].sort((a, b) => a - b).map(day => weekdayNames[day]).join(', ') : 'Mon–Fri');
  let schedules = [];
  const load = async () => {
    const [items, users] = await Promise.all([request('/v1/schedules'), request('/v1/users')]); schedules = items;
    const employees = users.filter(user => user.role === 'USER' && user.status === 'ACTIVE');
    const employeeSelect = document.getElementById('scheduleEmployee'); const assignmentSelect = document.getElementById('scheduleAssignment'); const assignButton = document.querySelector('#assignmentForm button[type="submit"]');
    employeeSelect.innerHTML = employees.length ? `<option value="" selected disabled>Select employee</option>${employees.map(user => `<option value="${user.id}">${escapeHtml(user.full_name || user.email)}</option>`).join('')}` : '<option value="">No active employees available</option>';
    const activeSchedules = schedules.filter(item => item.is_active);
    assignmentSelect.innerHTML = activeSchedules.length ? `<option value="" selected disabled>Select schedule</option>${activeSchedules.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('')}` : '<option value="">Create a schedule first</option>';
    employeeSelect.disabled = !employees.length; assignmentSelect.disabled = !activeSchedules.length; assignButton.disabled = !employees.length || !activeSchedules.length;
    document.getElementById('scheduleRows').innerHTML = schedules.length ? schedules.map(item => `<tr><td>${escapeHtml(item.name)}</td><td>${item.schedule_type === 'FLEX' ? 'Flextime' : `${escapeHtml(item.start_time?.slice(0,5) || '—')}–${escapeHtml(item.end_time?.slice(0,5) || '—')}`}</td><td>${workdayLabel(item.scheduled_weekdays)}</td><td>${item.daily_elapsed_minutes / 60}h</td><td>${item.break_limit_minutes}m</td><td>${item.user_schedule_assignments?.length || 0}</td><td><button class="btn btn-sm btn-danger delete-schedule" data-id="${item.id}" data-assigned="${item.user_schedule_assignments?.length || 0}" type="button">Delete</button></td></tr>`).join('') : '<tr><td colspan="7">No schedules yet.</td></tr>';
    document.querySelectorAll('.delete-schedule').forEach(button => button.addEventListener('click', async () => {
      const assigned = Number(button.dataset.assigned);
      if (assigned > 0) {
        await window.ACEUI.confirm({ title: 'Schedule still assigned', message: `This schedule is assigned to ${assigned} employee${assigned === 1 ? '' : 's'}. Unassign them first.`, confirmLabel: 'OK' });
        return;
      }
      if (!await window.ACEUI.confirm({ title: 'Delete schedule?', message: 'Delete this schedule? This cannot be undone.', confirmLabel: 'Delete', danger: true })) return;
      try { await request(`/v1/schedules/${button.dataset.id}`, { method: 'DELETE' }); toast('Schedule deleted.'); await load(); }
      catch (error) { toast(error.message || 'Could not delete schedule.', 'error'); }
    }));
  };
  const mount = async () => { try { const me = await request('/v1/me'); if (me.profile.role !== 'ADMIN') return location.replace('user-dashboard.html'); await load(); } catch { location.replace('login.html'); }
    const type = document.getElementById('scheduleType'); const typeHelp = document.getElementById('scheduleTypeHelp'); const scheduleForm = document.getElementById('scheduleForm'); const workdayInputs = [...document.querySelectorAll('input[name="scheduleWorkday"]')]; const workdayError = document.getElementById('scheduleWorkdayError'); const createButton = scheduleForm.querySelector('button[type="submit"]');
    const toggle = () => { const flexible = type.value === 'FLEX'; document.querySelectorAll('.fixed-time').forEach(node => node.hidden = flexible); typeHelp.textContent = flexible ? 'No late clock-in warning. Only selected workdays are tracked.' : 'Employees clock in at set times on selected workdays.'; };
    const validateWorkdays = () => { const valid = workdayInputs.some(input => input.checked); workdayError.hidden = valid; createButton.disabled = !valid; return valid; };
    type.addEventListener('change', toggle); workdayInputs.forEach(input => input.addEventListener('change', validateWorkdays)); toggle(); validateWorkdays();
    scheduleForm.addEventListener('submit', async event => { event.preventDefault(); if (!validateWorkdays()) { workdayInputs[0].focus(); return; } try { const workdays = workdayInputs.filter(input => input.checked).map(input => Number(input.value)); await request('/v1/schedules', { method: 'POST', body: JSON.stringify({ name: document.getElementById('scheduleName').value, scheduleType: type.value, startTime: document.getElementById('scheduleStart').value, endTime: document.getElementById('scheduleEnd').value, dailyElapsedMinutes: Number(document.getElementById('scheduleHours').value) * 60, breakLimitMinutes: Number(document.getElementById('scheduleBreak').value), workdays }) }); toast('Schedule created.'); event.target.reset(); toggle(); validateWorkdays(); await load(); } catch (error) { toast(error.message || 'Could not create schedule.', 'error'); } });
    document.getElementById('assignmentForm').addEventListener('submit', async event => { event.preventDefault(); try { await request(`/v1/users/${document.getElementById('scheduleEmployee').value}/schedule`, { method: 'PUT', body: JSON.stringify({ scheduleId: document.getElementById('scheduleAssignment').value }) }); toast('Schedule assigned.'); await load(); } catch (error) { toast(error.message || 'Could not assign schedule.', 'error'); } });
    window.refreshScheduleFlex = load;
    if (!document.body.dataset.scheduleLiveBound) {
      document.body.dataset.scheduleLiveBound = 'true';
      window.addEventListener('ace:live-data', () => { if (!document.querySelector('form:focus-within')) void window.refreshScheduleFlex?.().catch(() => {}); });
    }
  };
  window.mountScheduleFlex = mount;
  document.addEventListener('DOMContentLoaded', window.mountScheduleFlex);
})();
