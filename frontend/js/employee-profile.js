// Akio <3: Project source maintained by Akio Zaki Salomon.
(() => {
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const duration = seconds => { const value = Math.max(0, Number(seconds) || 0); return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`; };
  const clockTime = value => value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Active';
  const dateValue = value => { const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 10); };
  const openExportModal = onSelect => {
    let modal = document.getElementById('employeeProfileExportModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'employeeProfileExportModal';
      modal.className = 'modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.innerHTML = '<div class="modal-content"><div class="modal-header"><h3 class="modal-title">Save employee report as</h3><button class="modal-close" type="button" aria-label="Close">×</button></div><div class="modal-body"><p class="modal-description">This report will use the date filter selected in Clock-in history.</p><div class="form-actions"><button class="btn btn-outline employee-report-format" type="button" data-format="XLSX">Save Excel</button><button class="btn btn-primary employee-report-format" type="button" data-format="PDF">Save PDF</button></div></div></div>';
      document.body.appendChild(modal);
      modal.querySelector('.modal-close').addEventListener('click', () => closeModal(modal.id));
      modal.addEventListener('click', event => { if (event.target === modal) closeModal(modal.id); });
    }
    modal.querySelectorAll('.employee-report-format').forEach(button => { button.onclick = () => { closeModal(modal.id); onSelect(button.dataset.format); }; });
    openModal(modal.id);
  };
  const render = async () => {
    const root = document.getElementById('employeeProfileContent');
    const id = new URLSearchParams(window.location.search).get('user');
    if (!id) { root.innerHTML = '<p class="empty-state">Choose an employee from the Users page.</p>'; return; }
    try {
      const me = await window.ACEAuth.request('/v1/me');
      if (me.profile.role !== 'ADMIN') { window.location.replace('/user-dashboard'); return; }
      const [users, entries, projects, departments] = await Promise.all([
        window.ACEAuth.request('/v1/users'), window.ACEAuth.request('/v1/time-entries'),
        window.ACEAuth.request('/v1/projects'), window.ACEAuth.request('/v1/departments')
      ]);
      const person = users.find(item => item.id === id);
      if (!person) throw new Error('Employee was not found.');
      if (person.role !== 'USER') throw new Error('Employee profiles are available for employee accounts only.');
      const sessions = entries.filter(entry => entry.user_id === id).sort((a, b) => new Date(b.clock_in_at) - new Date(a.clock_in_at));
      const completed = sessions.filter(entry => entry.clock_out_at);
      const activeSession = sessions.find(entry => !entry.clock_out_at);
      const worked = completed.reduce((sum, entry) => sum + Number(entry.duration_seconds || 0), 0);
      const average = completed.length ? Math.round(worked / completed.length) : 0;
      const department = departments.find(item => item.id === person.department_id)?.name || 'Unassigned';
      const projectTotals = new Map();
      completed.forEach(entry => { const name = projects.find(project => project.id === entry.project_id)?.name || 'Unassigned'; projectTotals.set(name, (projectTotals.get(name) || 0) + Number(entry.duration_seconds || 0)); });
      const topProjects = [...projectTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const maxProject = Math.max(1, ...topProjects.map(([, seconds]) => seconds));
      const daily = Array.from({ length: 7 }, (_, offset) => { const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() - (6 - offset)); const seconds = completed.filter(entry => new Date(entry.clock_in_at).toDateString() === day.toDateString()).reduce((sum, entry) => sum + Number(entry.duration_seconds || 0), 0); return { label: day.toLocaleDateString([], { weekday: 'short' }), seconds }; });
      const maxDaily = Math.max(1, ...daily.map(item => item.seconds));
      const initial = (person.full_name || person.email || 'E').trim().slice(0, 1).toUpperCase();
      root.innerHTML = `<header class="employee-profile-header"><div class="employee-profile-actions"><a class="btn btn-outline" href="users.html">← Users</a>${activeSession ? `<button class="btn btn-danger" id="employeeProfileStopClock" type="button">Stop active clock-in</button>` : ''}<a class="btn btn-outline" href="users.html?manage=${encodeURIComponent(person.id)}">Manage assignments</a><button class="btn btn-primary" id="employeeProfileGenerateReport" type="button">Generate report</button></div><div class="employee-profile-identity"><span class="employee-profile-avatar">${person.profile_picture_url ? `<img src="${esc(person.profile_picture_url)}" alt="">` : esc(initial)}</span><div><p class="admin-section-kicker">EMPLOYEE PROFILE</p><h1>${esc(person.full_name || 'Unnamed employee')}</h1><p>${esc(person.email)} · ${esc(person.role === 'ADMIN' ? 'Administrator' : 'Employee')} · ${esc(department)}${activeSession ? ' · Currently clocked in' : ''}</p></div></div></header><section class="employee-profile-stats"><article><span>Total worked</span><strong>${duration(worked)}</strong><small>Completed sessions</small></article><article><span>Time entries</span><strong>${sessions.length}</strong><small>${sessions.filter(entry => !entry.clock_out_at).length} active</small></article><article><span>Average session</span><strong>${duration(average)}</strong><small>Across completed entries</small></article></section><section class="employee-profile-grid"><article class="employee-profile-card"><div class="employee-profile-card-head"><div><span>WEEKLY ACTIVITY</span><h2>Worked time</h2></div><small>Last 7 days</small></div><div class="employee-profile-chart">${daily.map(item => `<div><b>${duration(item.seconds)}</b><i><em style="height:${Math.max(4, Math.round(item.seconds / maxDaily * 100))}%"></em></i><span>${esc(item.label)}</span></div>`).join('')}</div></article><article class="employee-profile-card"><div class="employee-profile-card-head"><div><span>PROJECT ALLOCATION</span><h2>Hours by project</h2></div></div><div class="employee-profile-projects">${topProjects.length ? topProjects.map(([name, seconds]) => `<div><span>${esc(name)}</span><i><em style="width:${Math.max(4, Math.round(seconds / maxProject * 100))}%"></em></i><strong>${duration(seconds)}</strong></div>`).join('') : '<p class="analytics-empty">No completed project time yet.</p>'}</div></article></section><section class="table-container employee-profile-entries"><div class="table-header employee-history-header"><div><h2>Clock-in history</h2><span id="employeeHistoryCount"></span></div><label class="employee-history-filter">Period<select class="form-select" id="employeeHistoryPeriod"><option value="month">This month</option><option value="week">This week</option><option value="custom">Custom date range</option></select></label></div><div class="employee-history-dates" id="employeeHistoryDates" hidden><label>From<input class="form-input" id="employeeHistoryFrom" type="date"></label><label>To<input class="form-input" id="employeeHistoryTo" type="date"></label></div><div class="table-responsive"><table class="table"><thead><tr><th>Clock in</th><th>Clock out</th><th>Project</th><th>Worked</th><th>Status</th></tr></thead><tbody id="employeeHistoryRows"></tbody></table></div></section>`;
      const historyRows = document.getElementById('employeeHistoryRows');
      const historyCount = document.getElementById('employeeHistoryCount');
      const historyPeriod = document.getElementById('employeeHistoryPeriod');
      const historyDates = document.getElementById('employeeHistoryDates');
      const historyFrom = document.getElementById('employeeHistoryFrom');
      const historyTo = document.getElementById('employeeHistoryTo');
      const renderHistory = () => {
        const now = new Date(); now.setHours(0, 0, 0, 0);
        const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay());
        const filtered = sessions.filter(entry => {
          const entryDate = new Date(entry.clock_in_at); entryDate.setHours(0, 0, 0, 0);
          if (historyPeriod.value === 'month') return entryDate.getFullYear() === now.getFullYear() && entryDate.getMonth() === now.getMonth();
          if (historyPeriod.value === 'week') return entryDate >= startOfWeek && entryDate <= now;
          if (historyFrom.value && entryDate < new Date(`${historyFrom.value}T00:00:00`)) return false;
          if (historyTo.value && entryDate > new Date(`${historyTo.value}T00:00:00`)) return false;
          return true;
        });
        historyCount.textContent = `${filtered.length} record${filtered.length === 1 ? '' : 's'}`;
        historyRows.innerHTML = filtered.length ? filtered.map(entry => `<tr><td>${clockTime(entry.clock_in_at)}</td><td>${clockTime(entry.clock_out_at)}</td><td>${esc(projects.find(project => project.id === entry.project_id)?.name || 'Unassigned')}</td><td>${entry.duration_seconds ? duration(entry.duration_seconds) : 'Active'}</td><td><span class="badge ${entry.clock_out_at ? 'badge-success' : 'badge-warning'}">${entry.clock_out_at ? 'Completed' : 'Active'}</span>${entry.stopped_by?.full_name || entry.stopped_by?.email ? `<small class="entry-admin-stop">Stopped by ${esc(entry.stopped_by?.full_name || entry.stopped_by?.email)} · ${clockTime(entry.stopped_by_at || entry.clock_out_at)}</small>` : ''}</td></tr>`).join('') : '<tr class="table-empty-row"><td colspan="5"><div class="empty-state empty-state-compact"><h3>No clock-ins in this period</h3><p>Try a wider date range or check back after this employee starts a shift.</p></div></td></tr>';
      };
      historyPeriod.addEventListener('change', () => { historyDates.hidden = historyPeriod.value !== 'custom'; renderHistory(); });
      historyFrom.addEventListener('change', renderHistory); historyTo.addEventListener('change', renderHistory); renderHistory();
      document.getElementById('employeeProfileStopClock')?.addEventListener('click', async () => {
        const approved = await window.ACEUI.confirm({ title: 'Stop this active clock-in?', message: `${person.full_name || person.email} will be clocked out now and shown that you stopped the shift.`, confirmLabel: 'Stop clock-in', danger: true });
        if (!approved) return;
        try {
          await window.ACEAuth.request(`/v1/time-entries/${activeSession.id}/admin-stop`, { method: 'POST' });
          showToast('Employee clock-in stopped.', 'success');
          window.setTimeout(() => window.location.reload(), 350);
        } catch (error) { showToast(error.message || 'Could not stop this clock-in.', 'error'); }
      });
      document.getElementById('employeeProfileGenerateReport').addEventListener('click', () => {
        const now = new Date(); now.setHours(0, 0, 0, 0);
        let start = new Date(now); let end = new Date(now); let reportType = 'MONTHLY';
        if (historyPeriod.value === 'month') start.setDate(1);
        else if (historyPeriod.value === 'week') { start.setDate(now.getDate() - now.getDay()); reportType = 'WEEKLY'; }
        else {
          if (!historyFrom.value || !historyTo.value || historyFrom.value > historyTo.value) { showToast('Choose a valid custom start and end date first.', 'warning'); return; }
          start = new Date(`${historyFrom.value}T00:00:00`); end = new Date(`${historyTo.value}T00:00:00`); reportType = 'CUSTOM';
        }
        openExportModal(async format => {
          try {
            await window.ACEReportActions.generate({ userId: id, dateFrom: dateValue(start), dateTo: dateValue(end), reportType, filters: { userId: id }, format });
          } catch (error) { showToast(error.message || 'Could not generate this employee report.', 'error'); }
        });
      });
    } catch (error) { root.innerHTML = `<p class="empty-state">${esc(error.message || 'Unable to load this employee profile.')}</p>`; }
  };
  window.mountEmployeeProfile = render;
  document.addEventListener('DOMContentLoaded', window.mountEmployeeProfile);
})();
