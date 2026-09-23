(() => {
  const escape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&gt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const name = person => person?.full_name || person?.email || 'Unknown employee';
  const dateTime = value => value ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)) : '—';
  async function loadChatLog() {
    const list = document.getElementById('chatLogList');
    if (!list) return;
    list.innerHTML = '<p class="chat-log-empty">Loading employee chat history…</p>';
    try {
      const messages = await window.ACEAuth.request('/v1/admin/chat-log');
      list.innerHTML = messages.length ? messages.map(message => `<article class="chat-log-entry"><div class="chat-log-entry-head"><strong>${escape(name(message.sender))}</strong><span>to</span><strong>${escape(name(message.recipient))}</strong><time>${dateTime(message.created_at)}</time></div><p>${escape(message.body)}</p>${message.deleted_at ? '<small>Deleted in employee chat</small>' : message.edited_at ? '<small>Edited</small>' : ''}</article>`).join('') : '<p class="chat-log-empty">No employee messages yet.</p>';
    } catch (error) { list.innerHTML = `<p class="chat-log-empty">${escape(error.message || 'Unable to load the chat log.')}</p>`; }
  }
  let refreshTimer;
  window.mountChatLog = () => {
    if (refreshTimer) window.clearInterval(refreshTimer);
    loadChatLog();
    document.getElementById('refreshChatLog')?.addEventListener('click', loadChatLog, { once: true });
    refreshTimer = window.setInterval(loadChatLog, 10000);
  };
  window.addEventListener('pagehide', () => window.clearInterval(refreshTimer));
  document.addEventListener('DOMContentLoaded', window.mountChatLog);
})();
