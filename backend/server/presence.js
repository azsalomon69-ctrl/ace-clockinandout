export const presenceWindowMs = 4 * 60 * 1000;
export const presenceFlushIntervalMs = 3 * 60 * 1000;

export function isPresenceOnline(lastSeenAt, lastLogoutAt, now = Date.now()) {
  const seenAt = Date.parse(lastSeenAt || '');
  const loggedOutAt = Date.parse(lastLogoutAt || '');
  if (!Number.isFinite(seenAt)) return false;
  if (Number.isFinite(loggedOutAt) && seenAt <= loggedOutAt) return false;
  const age = now - seenAt;
  return age >= 0 && age < presenceWindowMs;
}

// Capture request time before async authentication; the queue and revocation
// check themselves are synchronous, so same-process sign-out cannot interleave.
export function queuePresenceForActiveSession(pendingPresence, {
  userId, sessionId, tokenKey, heartbeatAt, isTokenRevoked
}) {
  if (!userId || !sessionId || !Number.isFinite(heartbeatAt) || isTokenRevoked(tokenKey)) return false;
  const queued = pendingPresence.get(userId);
  if (!queued || heartbeatAt > queued.heartbeatAt) {
    pendingPresence.set(userId, { heartbeatAt, sessionId });
  }
  return true;
}

export async function flushPresenceBatch(pendingPresence, userIds, writeBatch) {
  const ids = userIds || [...pendingPresence.keys()];
  const snapshots = new Map(ids.filter(id => pendingPresence.has(id)).map(id => [id, pendingPresence.get(id)]));
  if (!snapshots.size) return 0;
  const rows = [...snapshots].map(([user_id, presence]) => ({
    user_id,
    session_id: presence.sessionId,
    last_seen_at: new Date(presence.heartbeatAt).toISOString()
  }));
  const updated = await writeBatch(rows);
  for (const [id, value] of snapshots) {
    if (pendingPresence.get(id) === value) pendingPresence.delete(id);
  }
  return updated;
}
