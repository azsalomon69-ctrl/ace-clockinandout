(() => {
  const request = (...args) => window.ACEAuth.request(...args);
  const toast = (message, type = 'success') => window.showToast ? window.showToast(message, type) : alert(message);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  let schedules = [];
  const load = async () => {
    const [items, users] = await Promise.all([request('/v1/schedules'), request('/v1/users')]); schedules = items;
    const employees = users.filter(user => user.role === 'USER' && user.status === 'ACTIVE');
    document.getElementById('scheduleEmployee').innerHTML = employees.map(user => `<option value="${user.id}">${escapeHtml(user.full_name || user.email)}</option>`).join('');
    document.getElementById('scheduleAssignment').innerHTML = schedules.filter(item => item.is_active).map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
    document.getElementById('scheduleRows').innerHTML = schedules.length ? schedules.map(item => `<tr><td>${escapeHtml(item.name)}</td><td>${item.schedule_type === 'FLEX' ? 'Flextime' : `${escapeHtml(item.start_time?.slice(0,5) || '—')}–${escapeHtml(item.end_time?.slice(0,5) || '—')}`}</td><td>${item.daily_elapsed_minutes / 60}h</td><td>${item.break_limit_minutes}m</td><td>${item.user_schedule_assignments?.length || 0}</td><td><button class="btn btn-sm btn-danger delete-schedule" data-id="${item.id}" data-assigned="${item.user_schedule_assignments?.length || 0}" type="button">Delete</button></td></tr>`).join('') : '<tr><td colspan="6">No schedules yet.</td></tr>';
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
    const type = document.getElementById('scheduleType'); const toggle = () => document.querySelectorAll('.fixed-time').forEach(node => node.hidden = type.value === 'FLEX'); type.addEventListener('change', toggle); toggle();
    document.getElementById('scheduleForm').addEventListener('submit', async event => { event.preventDefault(); try { await request('/v1/schedules', { method: 'POST', body: JSON.stringify({ name: document.getElementById('scheduleName').value, scheduleType: type.value, startTime: document.getElementById('scheduleStart').value, endTime: document.getElementById('scheduleEnd').value, dailyElapsedMinutes: Number(document.getElementById('scheduleHours').value) * 60, breakLimitMinutes: Number(document.getElementById('scheduleBreak').value) }) }); toast('Schedule created.'); event.target.reset(); await load(); } catch (error) { toast(error.message || 'Could not create schedule.', 'error'); } });
    document.getElementById('assignmentForm').addEventListener('submit', async event => { event.preventDefault(); try { await request(`/v1/users/${document.getElementById('scheduleEmployee').value}/schedule`, { method: 'PUT', body: JSON.stringify({ scheduleId: document.getElementById('scheduleAssignment').value }) }); toast('Schedule assigned.'); await load(); } catch (error) { toast(error.message || 'Could not assign schedule.', 'error'); } });
  };
  window.mountScheduleFlex = mount;
  document.addEventListener('DOMContentLoaded', window.mountScheduleFlex);
})();
