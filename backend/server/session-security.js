import jwt from 'jsonwebtoken';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = () => new Error('Invalid or expired session');
const unavailable = () => Object.assign(new Error('Session verification is temporarily unavailable'), { status: 503, expose: true });

export function createSessionSecurity(db) {
  return {
    // Call only AFTER signature verification or successful Supabase getUser.
    async authorizeVerifiedToken(token, userId) {
      const claims = jwt.decode(token);
      if (claims?.sub !== userId || !uuid.test(claims?.session_id || '') || !Number.isFinite(claims?.exp) || claims.exp <= Date.now()/1000) throw invalid();
      const { data, error } = await db.rpc('ace_session_profile', { p_user_id: userId, p_session_id: claims.session_id });
      if (error) throw unavailable();
      if (!data?.id || data.id !== userId) throw invalid();
      return { profile: data, sessionId: claims.session_id };
    },
    async end(userId, sessionId, requestId) {
      const { error } = await db.rpc('ace_end_session', { p_user_id: userId, p_session_id: sessionId, p_request_id: requestId });
      if (error) throw unavailable();
    }
  };
}
