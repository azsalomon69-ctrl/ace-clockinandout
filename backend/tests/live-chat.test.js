// Akio <3: Project source maintained by Akio Zaki Salomon.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const serverSource = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const authSource = readFileSync(new URL('../../frontend/js/supabase-auth.js', import.meta.url), 'utf8');
const shellSource = readFileSync(new URL('../../frontend/js/script.js', import.meta.url), 'utf8');

test('private chat publishes an authenticated live event to the message recipient', () => {
  assert.match(serverSource, /app\.get\('\/v1\/employee-chat\/stream', authenticate, activeOnly/, 'Live chat stream must require a signed-in active user');
  assert.match(serverSource, /chatSubscribers/, 'Live chat connections should be scoped by recipient');
  assert.match(serverSource, /publishChatEvent\(recipientId, \{ type: 'message', contactId: req\.profile\.id, messageId: message\.id \}\)/, 'Posting a message should wake its recipient immediately');
  assert.match(serverSource, /req\.on\('close'/, 'Closed stream connections should be cleaned up');
});

test('chat sends optimistically and never restores a successfully sent draft', () => {
  assert.match(authSource, /async function authorizedFetch/, 'The authenticated client should support a streaming response');
  assert.match(shellSource, /employee-chat-message-pending/, 'A sent message should appear immediately while the server confirms it');
  assert.match(shellSource, /input\.value = '';/, 'Sending should clear the composer immediately');
  assert.match(shellSource, /window\.ACEAuth\.authorizedFetch\('\/v1\/employee-chat\/stream'/, 'The client should subscribe to the authenticated live stream');
  assert.match(shellSource, /document\.visibilityState === 'visible' && !panel\.hidden/, 'The fallback must only run for a visible, open chat');
  assert.match(shellSource, /5 \* 60 \* 1000/, 'Chat polling should remain an infrequent recovery fallback');
});

test('chat typing feedback is private, temporary, and cleared when a message is sent', () => {
  assert.match(serverSource, /app\.post\('\/v1\/employee-chat\/typing', authenticate, activeOnly/, 'Typing feedback must require an active signed-in participant');
  assert.match(serverSource, /publishChatEvent\(recipientId, \{ type: 'typing', contactId: req\.profile\.id, active \}\)/, 'Typing feedback should be delivered only to the selected recipient');
  assert.match(shellSource, /employee-chat-typing/, 'The active conversation should show a typing indicator');
  assert.match(shellSource, /const typingContacts = new Map\(\)/, 'Typing state should be retained for each contact instead of being discarded outside the active thread');
  assert.match(shellSource, /Typing…/, 'The contact list should show who is typing before the recipient opens that conversation');
  assert.match(shellSource, /void publishTyping\(false\);/, 'Typing should clear on send, close, navigation, and page exit');
  assert.match(shellSource, /typingClearTimers\.set\(id, window\.setTimeout/, 'The indicator should clear if a stop event is lost');
});

test('live stream refreshes bell notifications for new remarks and access requests', () => {
  assert.match(serverSource, /publishChatEvent\(entry\.user_id, \{ type: 'notification', kind: 'remarks' \}\)/, 'A new remark should notify its employee immediately');
  assert.match(serverSource, /publishAdminChatEvent\(\{ type: 'notification', kind: 'access-request' \}\)/, 'A new access request should notify administrators immediately');
  assert.match(shellSource, /new CustomEvent\('ace:live-notification'/, 'The client should route live notification events to the bell data source');
  assert.match(shellSource, /addEventListener\('ace:live-notification', refreshFromLiveNotification\)/, 'New remarks should refresh bell content immediately');
});
