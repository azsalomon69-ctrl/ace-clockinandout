import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../frontend/js/script.js', import.meta.url), 'utf8');
test('frontend no longer renders online status or sends presence heartbeats', () => {
 assert.doesNotMatch(source, /employee-chat-presence|employee-chat-online-dot|Online now|isChatContactOnline|startPresenceHeartbeat|auth\/heartbeat/);
 assert.doesNotMatch(source, /startAdminClockInCountRefresh|adminClockInCountInterval|adminClockInCountVisibilityHandler/);
});
