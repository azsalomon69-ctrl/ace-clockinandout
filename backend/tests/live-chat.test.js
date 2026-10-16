import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const source = readFileSync(new URL('../../frontend/js/script.js', import.meta.url), 'utf8');
const chat = source.slice(source.indexOf('function initializeEmployeeChat('), source.indexOf('// Shared application shell'));
test('chat has no subscriptions, background polling, typing requests, or resume refreshes', () => {
  assert.doesNotMatch(chat, /setInterval|setTimeout|authorizedFetch|visibilitychange|addEventListener\('online'|employee-chat\/stream|employee-chat\/typing/);
  assert.match(chat, /if \(contactsLoaded\) return Promise.resolve\(\)/);
  assert.match(chat, /messagesByContact.has\(contactId\)/);
  assert.match(chat, /employee-chat-message-pending/);
  assert.match(chat, /await loadMessages\(true\)/);
});
test('notification setup renders loaded data without network calls or timers, even when repeated', () => {
  const body = source.slice(source.indexOf('function startRemarkNotifications('), source.indexOf('let reportsPage'));
  let badges = 0, menus = 0;
  const context = vm.createContext({
    updateRemarkNotificationBadge: () => badges++,
    window: { ACERenderNotifications: () => menus++, ACEAuth: { request() { throw new Error('Unexpected network request'); } }, setInterval() { throw new Error('Unexpected timer'); } }
  });
  vm.runInContext(body, context);
  context.startRemarkNotifications(); context.startRemarkNotifications();
  assert.equal(badges, 2); assert.equal(menus, 2);
});
