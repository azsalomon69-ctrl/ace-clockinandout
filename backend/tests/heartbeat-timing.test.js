import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
test('presence tracking is removed without removing durable session revocation', () => {
 assert.doesNotMatch(server, /last_seen_at|is_online|pendingPresence|flushPresence|auth\/heartbeat/);
 assert.match(server, /sessionSecurity.end\(req.profile.id, req.authSessionId, req.requestId\)/);
 assert.match(server, /countActiveEmployeeClockIns\(db\)/);
});
