// Akio <3: Project source maintained by Akio Zaki Salomon.
const deletedEntryEscape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const deletedEntryDuration = value => Math.floor((value || 0) / 3600) + 'h ' + Math.floor(((value || 0) % 3600) / 60) + 'm';
let deletedEntriesPage = 1; let deletedEntriesPageSize = 25;
async function loadDeletedTimeEntries() {
  const body = document.getElementById('deletedTimeEntriesTable');
  try {
    const response = await window.ACEAuth.request('/v1/time-entries?removed=true&page=' + deletedEntriesPage + '&pageSize=' + deletedEntriesPageSize); const entries = response.items || response; const total = response.total ?? entries.length;
    body.innerHTML = entries.length ? entries.map(entry => '<tr><td>' + deletedEntryEscape(entry.profiles?.full_name || entry.profiles?.email || 'Unknown') + '</td><td>' + deletedEntryEscape(entry.projects?.name || 'No project') + '</td><td>' + new Date(entry.clock_in_at).toLocaleString() + '</td><td>' + deletedEntryDuration(entry.duration_seconds) + '</td><td><button class="btn btn-sm btn-outline restore-entry" data-id="' + entry.id + '" type="button">Restore</button> <button class="btn btn-sm btn-danger permanent-delete-entry" data-id="' + entry.id + '" type="button">Delete permanently</button></td></tr>').join('') : '<tr class="table-empty-row"><td colspan="5"><div class="empty-state empty-state-compact"><h3>No deleted time entries</h3><p>Time entries moved to Deleted will appear here.</p></div></td></tr>';
    body.querySelectorAll('.restore-entry').forEach(button => button.addEventListener('click', async () => {
      try { await window.ACEAuth.request('/v1/time-entries/' + button.dataset.id + '/restore', { method: 'PATCH' }); showToast('Time entry restored.', 'success'); loadDeletedTimeEntries(); }
      catch (error) { showToast(error.message || 'Could not restore time entry.', 'error'); }
    }));
    body.querySelectorAll('.permanent-delete-entry').forEach(button => button.addEventListener('click', async () => {
      if (!await window.ACEUI.confirm({ title: 'Delete time entry?', message: 'This permanently removes the time entry and cannot be restored.', confirmLabel: 'Delete permanently', danger: true })) return;
      try { await window.ACEAuth.request('/v1/time-entries/' + button.dataset.id + '/permanent', { method: 'DELETE' }); showToast('Time entry permanently deleted.', 'success'); loadDeletedTimeEntries(); }
      catch (error) { showToast(error.message || 'Could not permanently delete time entry.', 'error'); }
    }));
    let pager = document.getElementById('deletedEntriesPagination'); if (!pager) { pager = document.createElement('div'); pager.id = 'deletedEntriesPagination'; pager.className = 'admin-pagination'; body.closest('.table-responsive').insertAdjacentElement('afterend', pager); }
    const pages = Math.max(1, Math.ceil(total / deletedEntriesPageSize)); pager.innerHTML = total > deletedEntriesPageSize ? '<span>Showing ' + ((deletedEntriesPage - 1) * deletedEntriesPageSize + 1) + '–' + Math.min(deletedEntriesPage * deletedEntriesPageSize, total) + ' of ' + total + '</span><div class="pagination"><select class="form-select"><option value="25"' + (deletedEntriesPageSize === 25 ? ' selected' : '') + '>25</option><option value="50"' + (deletedEntriesPageSize === 50 ? ' selected' : '') + '>50</option><option value="100"' + (deletedEntriesPageSize === 100 ? ' selected' : '') + '>100</option></select><button data-page="' + (deletedEntriesPage - 1) + '" ' + (deletedEntriesPage === 1 ? 'disabled' : '') + '>‹</button><button data-page="' + (deletedEntriesPage + 1) + '" ' + (deletedEntriesPage === pages ? 'disabled' : '') + '>›</button></div>' : '';
    pager.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => { deletedEntriesPage = Number(button.dataset.page); loadDeletedTimeEntries(); })); pager.querySelector('select')?.addEventListener('change', event => { deletedEntriesPageSize = Number(event.target.value); deletedEntriesPage = 1; loadDeletedTimeEntries(); });
  } catch (error) { showToast(error.message || 'Could not load deleted time entries.', 'error'); }
}
window.mountDeletedTimeEntries = loadDeletedTimeEntries;
window.addEventListener('ace:live-data', event => { if (!event.detail?.background && document.getElementById('deletedTimeEntriesTable')) void loadDeletedTimeEntries(); });
document.addEventListener('DOMContentLoaded', window.mountDeletedTimeEntries);
