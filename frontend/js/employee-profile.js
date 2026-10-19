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
    const previousPeriod = document.getElementById('employeeHistoryPeriod')?.value;
    const previousFrom = document.getElementById('employeeHistoryFrom')?.value;
    const previousTo = document.getElementById('employeeHistoryTo')?.value;
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
      const remarksByEntry = new Map();
      // Scope feedback to this employee and keep request URLs bounded.
      for (let offset = 0; offset < sessions.length; offset += 100) {
        const ids = sessions.slice(offset, offset + 100).map(entry => entry.id);
        const remarks = await window.ACEAuth.request('/v1/admin-remarks?timeEntryIds=' + encodeURIComponent(ids.join(',')));
        remarks.forEach(remark => {
          const list = remarksByEntry.get(remark.time_entry_id) || [];
          list.push({ id: remark.id, text: remark.remark, admin: remark.profiles?.full_name || remark.profiles?.email || 'Administrator', createdAt: remark.created_at, seenAt: remark.seen_at });
          remarksByEntry.set(remark.time_entry_id, list);
        });
      }
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
      root.innerHTML = `<nav class="entry-breadcrumb" aria-label="Breadcrumb"><a href="users.html">Users</a><span aria-hidden="true">/</span><span>Employee profile</span></nav><header class="employee-profile-header"><div class="employee-profile-identity"><span class="employee-profile-avatar">${person.profile_picture_url ? `<img src="${esc(person.profile_picture_url)}" alt="">` : esc(initial)}</span><div><p class="admin-section-kicker">EMPLOYEE PROFILE</p><h1>${esc(person.full_name || 'Unnamed employee')}</h1><p class="profile-email">${esc(person.email)}</p><div class="profile-identity-meta"><span>${esc(person.role === 'ADMIN' ? 'Administrator' : 'Employee')}</span><span>${esc(department)}</span></div></div></div><div class="employee-profile-actions"><a class="btn btn-outline" href="users.html?manage=${encodeURIComponent(person.id)}" aria-label="Manage employee department, projects and schedule">Manage employee</a><a class="btn btn-outline" href="#employeeHistoryTitle">View history</a></div></header>${activeSession ? `<section class="profile-active-session" aria-label="Active session"><span class="profile-session-icon" aria-hidden="true">◷</span><div><strong>Currently clocked in</strong><p>Started ${clockTime(activeSession.clock_in_at)} · ${esc(projects.find(project => project.id === activeSession.project_id)?.name || 'Unassigned project')}</p></div><div class="profile-session-actions"><a class="btn btn-outline btn-sm" href="time-entry-details.html?entry=${encodeURIComponent(activeSession.id)}">View session</a><button class="btn btn-danger btn-sm" id="employeeProfileStopClock" type="button">Stop clock-in</button></div></section>` : ''}<section class="employee-profile-stats"><article><span>Total worked</span><strong>${duration(worked)}</strong><small>All completed sessions</small></article><article><span>Time entries</span><strong>${sessions.length}</strong><small>${sessions.filter(entry => !entry.clock_out_at).length} active</small></article><article><span>Average session</span><strong>${duration(average)}</strong><small>All completed sessions</small></article></section><section class="employee-profile-grid"><article class="employee-profile-card"><div class="employee-profile-card-head"><div><span>WEEKLY ACTIVITY</span><h2>Daily worked time</h2></div><small>Last 7 days</small></div><div class="employee-profile-chart">${daily.map(item => `<div><b>${duration(item.seconds)}</b><i><em style="height:${Math.max(0, Math.round(item.seconds / maxDaily * 100))}%"></em></i><span>${esc(item.label)}</span></div>`).join('')}</div></article><article class="employee-profile-card"><div class="employee-profile-card-head"><div><span>PROJECT ALLOCATION</span><h2>Hours by project</h2></div><small>All time · Top 4</small></div><div class="employee-profile-projects">${topProjects.length ? topProjects.map(([name, seconds]) => `<div><span>${esc(name)}</span><i><em style="width:${Math.max(0, Math.round(seconds / maxProject * 100))}%"></em></i><strong>${duration(seconds)}</strong></div>`).join('') : '<p class="analytics-empty">No completed project time yet.</p>'}</div></article></section><section class="table-container employee-profile-entries"><div class="table-header employee-history-header"><div><h2 id="employeeHistoryTitle" tabindex="-1">Clock-in history</h2><span id="employeeHistoryCount"></span></div><div class="profile-history-tools"><label class="employee-history-filter">Period<select class="form-select" id="employeeHistoryPeriod"><option value="month">This month</option><option value="week">This week</option><option value="custom">Custom date range</option><option value="all">All time</option></select></label><button class="btn btn-primary" id="employeeProfileGenerateReport" type="button">Generate report</button></div></div><div class="employee-history-dates" id="employeeHistoryDates" hidden><label>From<input class="form-input" id="employeeHistoryFrom" type="date"></label><label>To<input class="form-input" id="employeeHistoryTo" type="date"></label></div><div class="table-responsive"><table class="table" aria-label="Employee clock-in history"><thead><tr><th scope="col">Project</th><th scope="col">Clock in</th><th scope="col">Clock out</th><th scope="col">Worked</th><th scope="col">Approved overtime</th><th scope="col">Remarks</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead><tbody id="employeeHistoryRows"></tbody></table></div></section>`;
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
          if (historyPeriod.value === 'all') return true;
          if (historyPeriod.value === 'month') return entryDate.getFullYear() === now.getFullYear() && entryDate.getMonth() === now.getMonth();
          if (historyPeriod.value === 'week') return entryDate >= startOfWeek && entryDate <= now;
          if (historyFrom.value && entryDate < new Date(`${historyFrom.value}T00:00:00`)) return false;
          if (historyTo.value && entryDate > new Date(`${historyTo.value}T00:00:00`)) return false;
          return true;
        });
        historyCount.textContent = `${filtered.length} record${filtered.length === 1 ? '' : 's'}`;
        historyRows.innerHTML = filtered.length ? filtered.map(entry => {
          const remarks = remarksByEntry.get(entry.id) || [];
          const canApprove = entry.clock_out_at && entry.schedule_type === 'FIXED' && entry.scheduled_end_time && !entry.overtime_approved_at;
          return `<tr><td>${esc(projects.find(project => project.id === entry.project_id)?.name || 'Unassigned')}</td><td><a class="profile-entry-link" href="time-entry-details.html?entry=${encodeURIComponent(entry.id)}">${clockTime(entry.clock_in_at)}</a></td><td>${clockTime(entry.clock_out_at)}</td><td>${entry.clock_out_at ? duration(entry.duration_seconds) : 'Active'}</td><td>${entry.overtime_approved_seconds ? duration(entry.overtime_approved_seconds) : '—'}</td><td class="employee-history-remarks">${remarks.length ? remarks.map(remark => `<article><strong>${esc(remark.admin)}</strong><p>${esc(remark.text)}</p><small>${remark.seenAt ? 'Seen by employee' : 'Not seen yet'}</small></article>`).join('') : '—'}</td><td><span class="badge ${entry.clock_out_at ? 'badge-success' : 'badge-warning'}">${entry.clock_out_at ? 'Completed' : 'Active'}</span>${entry.stopped_by?.full_name || entry.stopped_by?.email ? `<small class="entry-admin-stop">Stopped by ${esc(entry.stopped_by?.full_name || entry.stopped_by?.email)} · ${clockTime(entry.stopped_by_at || entry.clock_out_at)}</small>` : ''}</td><td><select class="form-select employee-history-action" data-entry-id="${esc(entry.id)}" aria-label="Actions for clock-in ${esc(clockTime(entry.clock_in_at))}"><option value="">Actions</option><option value="details">View details</option><option value="remarks">${remarks.length ? 'Open feedback' : 'Add remark'}</option><option value="correct">Correct time</option>${canApprove ? '<option value="approve">Approve overtime</option>' : ''}${!entry.clock_out_at ? '<option value="stop">Stop clock-in</option>' : ''}</select></td></tr>`;
        }).join('') : '<tr class="table-empty-row"><td colspan="8"><div class="empty-state empty-state-compact"><h3>No clock-ins in this period</h3><p>Try a wider date range or check back after this employee starts a shift.</p></div></td></tr>';
        window.applyTableLabels?.(historyRows.closest('table'));

      };
      if (previousPeriod) historyPeriod.value = previousPeriod;
      if (previousFrom) historyFrom.value = previousFrom;
      if (previousTo) historyTo.value = previousTo;
      historyDates.hidden = historyPeriod.value !== 'custom';
      historyRows.addEventListener('change', async event => {
        const control = event.target.closest('.employee-history-action');
        if (!control) return;
        const entry = sessions.find(item => item.id === control.dataset.entryId);
        const selected = control.value; control.value = '';
        if (!entry || !selected) return;
        const record = { id: entry.id, clockInAt: entry.clock_in_at, clockOutAt: entry.clock_out_at, remarks: remarksByEntry.get(entry.id) || [], cells: [person.full_name || person.email, projects.find(project => project.id === entry.project_id)?.name || 'Unassigned', clockTime(entry.clock_in_at)] };
        if (selected === 'details') { window.location.assign('time-entry-details.html?entry=' + encodeURIComponent(entry.id)); return; }
        if (selected === 'remarks') { openEntryFeedback(record, render); return; }
        if (selected === 'correct') { editEntryTime(record, render); return; }
        const stop = selected === 'stop';
        if (!['stop', 'approve'].includes(selected)) return;
        if (!await window.ACEUI.confirm({ title: stop ? 'Stop this active clock-in?' : 'Approve overtime?', message: stop ? `${person.full_name || person.email} will be clocked out now.` : 'Only time after the scheduled end will be approved as overtime.', confirmLabel: stop ? 'Stop clock-in' : 'Approve', danger: stop })) return;
        control.disabled = true;
        try {
          await window.ACEAuth.request('/v1/time-entries/' + entry.id + (stop ? '/admin-stop' : '/overtime/approve'), { method: 'POST' });
          showToast(stop ? 'Employee clock-in stopped.' : 'Overtime approved.', 'success');
          await render();
        } catch (error) { showToast(error.message || 'Could not update this entry.', 'error'); control.disabled = false; }
      });
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
        else if (historyPeriod.value === 'all') {
          start = sessions.length ? new Date(Math.min(...sessions.map(entry => new Date(entry.clock_in_at).getTime()))) : now; reportType = 'CUSTOM';
        } else {
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
