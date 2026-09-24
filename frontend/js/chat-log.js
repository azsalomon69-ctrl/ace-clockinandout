// Akio <3: Project source maintained by Akio Zaki Salomon.
(() => {
  const escape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&gt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const name = person => person?.full_name || person?.email || 'Unknown employee';
  const dateTime = value => value ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)) : '—';
  let page = 1; const pageSize = 25;
  async function loadChatLog() {
    const list = document.getElementById('chatLogList');
    if (!list) return;
    list.innerHTML = '<p class="chat-log-empty">Loading employee chat history…</p>';
    try {
      const response = await window.ACEAuth.request('/v1/admin/chat-log?page=' + page + '&pageSize=' + pageSize); const messages = response.items || response; const total = response.total ?? messages.length;
      list.innerHTML = messages.length ? messages.map(message => { const outgoingToEmployee = message.sender?.role === 'ADMIN' && message.recipient?.role === 'USER'; const receipt = outgoingToEmployee ? `<small class="admin-chat-read-status ${message.read_at ? 'is-seen' : 'is-unseen'}"><img class="ui-icon" src="assets/icons/${message.read_at ? 'check' : 'circle-alert'}.svg" alt="" aria-hidden="true">${message.read_at ? `Seen ${dateTime(message.read_at)}` : 'Not seen yet'}</small>` : ''; const hasOriginal = Boolean(message.edited_at && message.original_body && message.original_body !== message.body); const original = hasOriginal ? `<section class="chat-log-original"><strong>Original message</strong><p>${escape(message.original_body)}</p></section>` : ''; return `<article class="chat-log-entry"><div class="chat-log-entry-head"><strong>${escape(name(message.sender))}</strong><span>to</span><strong>${escape(name(message.recipient))}</strong><time>${dateTime(message.created_at)}</time></div><p>${escape(message.body)}</p>${message.deleted_at ? '<small>Deleted in employee chat</small>' : message.edited_at ? '<small>Edited</small>' : ''}${original}${receipt}</article>`; }).join('') : '<div class="chat-log-empty"><span><img class="ui-icon" src="assets/icons/message-circle-more.svg" alt="" aria-hidden="true"></span><strong>No employee messages yet</strong><p>Private employee conversations will appear here for administrative review.</p></div>';
      const pager = document.getElementById('chatLogPagination'); const pages = Math.max(1, Math.ceil(total / pageSize)); if (pager) { pager.innerHTML = total > pageSize ? `<span>Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}</span><div class="pagination"><button data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>‹</button><button data-page="${page + 1}" ${page === pages ? 'disabled' : ''}>›</button></div>` : ''; pager.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => { page = Number(button.dataset.page); loadChatLog(); })); }
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
