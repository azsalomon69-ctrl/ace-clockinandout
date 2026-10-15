import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../frontend/js/script.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('function isChatContactOnline('), source.indexOf('function initializeEmployeeChat('));

test('chat expires inactive badges and never revives a server-reported sign-out', () => {
  const context = vm.createContext({ Date });
  vm.runInContext(helpers, context);
  const person = { is_online: true, last_seen_at: new Date(0).toISOString() };
  assert.equal(context.isChatContactOnline(person, 239999), true);
  assert.equal(context.isChatContactOnline(person, 240000), false);
  assert.equal(context.isChatContactOnline({ ...person, is_online: false }, 1), false);
  assert.equal(context.isChatContactOnline({ ...person, last_seen_at: 'invalid' }, 1), false);
  assert.equal(context.isChatContactOnline(person, -1), false);
});

test('chat presence refreshes only when visible/open, resumes immediately, and cleans up', () => {
  let now = 0, visible = 'visible', open = true, callback, refreshes = 0, renders = 0, cleared = false;
  const listeners = new Map();
  const context = vm.createContext({
    Date: { now: () => now },
    document: { get visibilityState() { return visible; }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
    window: {
      setInterval(fn, delay) { assert.equal(delay, 1000); callback = fn; return 7; },
      clearInterval(id) { assert.equal(id, 7); cleared = true; },
      addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name)
    }
  });
  vm.runInContext(helpers, context);
  const stop = context.startChatPresenceRefresh({ isOpen: () => open, refresh: () => { refreshes++; }, render: () => { renders++; } });
  now = 29000; callback(); assert.equal(refreshes, 0);
  now = 30000; callback(); assert.equal(refreshes, 1);
  visible = 'hidden'; now = 60000; callback(); assert.equal(refreshes, 1);
  visible = 'visible'; listeners.get('visibilitychange')(); assert.equal(refreshes, 2);
  listeners.get('online')(); assert.equal(refreshes, 3);
  open = false; now = 90000; callback(); listeners.get('visibilitychange')(); assert.equal(refreshes, 3);
  assert.equal(renders, 4);
  stop(); assert.equal(cleared, true); assert.equal(listeners.size, 0);
});

test('contact refresh updates the conversation header without rebuilding messages or drafts', () => {
  const dot = { classList: { toggle(_name, online) { dot.online = online; } } };
  const label = { textContent: 'Online' };
  const header = { textContent: 'Online now', classList: { toggle(_name, online) { header.online = online; } } };
  const button = { dataset: { id: 'person', online: 'true' }, querySelector: selector => selector === 'small' ? label : dot };
  const context = vm.createContext({
    Date, contacts: { querySelectorAll: () => [button] },
    allContacts: [{ id: 'person', is_online: false, last_seen_at: new Date().toISOString() }],
    selectedId: 'person', selectedOnline: true, typingContacts: new Map(),
    thread: { querySelector: () => header, set innerHTML(_) { throw new Error('Must preserve message DOM and draft'); } }
  });
  vm.runInContext(helpers, context);
  const start = source.indexOf('const updateChatPresence =');
  vm.runInContext(source.slice(start, source.indexOf('const renderContacts =', start)) + '\nupdateChatPresence();', context);
  assert.equal(button.dataset.online, 'false');
  assert.equal(label.textContent, 'Offline');
  assert.equal(dot.online, false);
  assert.equal(header.textContent, 'Offline');
  assert.equal(header.online, false);
  assert.equal(context.selectedOnline, false);
  context.typingContacts.set('person', true);
  label.textContent = 'Typing…';
  vm.runInContext('updateChatPresence();', context);
  assert.equal(label.textContent, 'Typing…');
});
