const deletedEntryEscape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const deletedEntryDuration = value => Math.floor((value || 0) / 3600) + 'h ' + Math.floor(((value || 0) % 3600) / 60) + 'm';
async function loadDeletedTimeEntries() {
  const body = document.getElementById('deletedTimeEntriesTable');
  try {
    const entries = await window.ACEAuth.request('/v1/time-entries?removed=true');
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
  } catch (error) { showToast(error.message || 'Could not load deleted time entries.', 'error'); }
}
window.mountDeletedTimeEntries = loadDeletedTimeEntries;
window.addEventListener('ace:live-data', () => { if (document.getElementById('deletedTimeEntriesTable')) void loadDeletedTimeEntries(); });
document.addEventListener('DOMContentLoaded', window.mountDeletedTimeEntries);
