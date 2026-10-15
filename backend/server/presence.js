// Keep presence rules independent from clock records and easy to verify.
export const presenceWindowMs = 4 * 60 * 1000;
// Independent timers can leave the stored heartbeat almost one heartbeat plus
// one flush interval old. Two minutes + 90 seconds leaves 30 seconds of margin
// below the four-minute cutoff; retain one database write for the whole batch.
export const presenceFlushIntervalMs = 90 * 1000;

export function isPresenceOnline(lastSeenAt, lastLogoutAt, now = Date.now()) {
  const seenAt = Date.parse(lastSeenAt || '');
  const loggedOutAt = Date.parse(lastLogoutAt || '');
  if (!Number.isFinite(seenAt)) return false;
  if (Number.isFinite(loggedOutAt) && seenAt <= loggedOutAt) return false;
  const age = now - seenAt;
  return age >= 0 && age < presenceWindowMs;
}

// Timestamp the request before authentication performs any asynchronous work.
// The token check and queue mutation are synchronous so sign-out cannot
// interleave between them in this API process. If the heartbeat queues first,
// its earlier request timestamp still loses to the later database logout time.
export function queuePresenceForActiveSession(pendingPresence, {
  userId,
  sessionId,
  tokenKey,
  heartbeatAt,
  isTokenRevoked
}) {
  if (!userId || !sessionId || !Number.isFinite(heartbeatAt) || isTokenRevoked(tokenKey)) return false;
  const queued = pendingPresence.get(userId);
  if (!queued || heartbeatAt > queued.heartbeatAt) {
    pendingPresence.set(userId, { heartbeatAt, sessionId });
  }
  return true;
}

// Submit one timestamped row per user in a single database call. A newer
// heartbeat queued while the write is in flight remains queued for next time.
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
  for (const [id, timestamp] of snapshots) {
    if (pendingPresence.get(id) === timestamp) pendingPresence.delete(id);
  }
  return updated;
}
