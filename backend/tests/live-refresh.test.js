// Akio <3: Project source maintained by Akio Zaki Salomon.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../../frontend/js/script.js', import.meta.url), 'utf8');
const chatLogSource = readFileSync(new URL('../../frontend/js/chat-log.js', import.meta.url), 'utf8');

test('workspace, chat, and notifications have no live refresh subscriptions', () => {
  assert.doesNotMatch(source, /function refreshLiveWorkspaceData\(/, 'Pages must not repeatedly reload full workspace data');
  assert.doesNotMatch(source, /startLiveDataRefresh\(/, 'Pages must not start a global live-data poller');
  assert.doesNotMatch(source, /startChatStream|ace:live-notification|startChatPresenceRefresh|remarkNotificationInterval/);
  assert.doesNotMatch(chatLogSource, /setInterval\(loadChatLog, 10000\)/, 'The audit chat log must not poll every 10 seconds');
});
