// Akio <3: Project source maintained by Akio Zaki Salomon.
window.ACEAuth = (() => {
    let clientPromise;
    let refreshPromise;
    let sessionPromise;
    let cachedSession;
    const sessionExpiredMessage = 'Your session expired. Please sign in again.';
    const apiUrl = () => String(window.ACE_API_URL || '').replace(/\/$/, '');
    async function googleClient() {
        const storageKey = 'ace_green_session';
        const verifierKey = 'ace_green_login_verifier';
        const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        let listener;
        const read = () => {
            try {
                const value = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
                return value?.expires_at > Date.now() / 1000 ? value : null;
            } catch { return null; }
        };
        const fragment = new URLSearchParams(window.location.hash.slice(1));
        if (fragment.has('ace_code') || fragment.has('ace_error')) {
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
            const errors = { invitation_required: 'You need an administrator invitation to access this workspace.',
                account_inactive: 'Your account is inactive. Contact your administrator.',
                email_changed: 'Your Google email changed. Contact your administrator.',
                identity_link_required: 'This account needs an administrator to link its Google identity.' };
            if (fragment.has('ace_error')) {
                sessionStorage.setItem('ace_login_notice', errors[fragment.get('ace_error')] || 'Google sign-in could not be completed. Please try again.');
                sessionStorage.removeItem(verifierKey);
            } else {
                const verifier = sessionStorage.getItem(verifierKey);
                sessionStorage.removeItem(verifierKey);
                try {
                    const response = await fetch(`${apiUrl()}/v1/auth/google/exchange`, { method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ code: fragment.get('ace_code'), verifier }) });
                    const body = await response.json();
                    if (!response.ok || !body.session) throw new Error('Google sign-in expired. Please try again.');
                    sessionStorage.setItem(storageKey, JSON.stringify(body.session));
                } catch {
                    sessionStorage.removeItem(storageKey);
                    sessionStorage.setItem('ace_login_notice', 'Google sign-in could not be completed. Please try again.');
                }
            }
        }
        return { auth: {
            onAuthStateChange(callback) { listener = callback; },
            async getSession() { return { data: { session: read() }, error: null }; },
            // Sessions are stored server-side; there is no Google refresh token in
            // the browser. A revoked/expired session requires a new sign-in.
            async refreshSession() { return { data: { session: null }, error: new Error(sessionExpiredMessage) }; },
            async signInWithOAuth() {
                const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
                const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
                sessionStorage.setItem(verifierKey, verifier);
                window.location.assign(`${apiUrl()}/v1/auth/google/start?challenge=${base64url(digest)}`);
                return { error: null };
            },
            async signOut() {
                const session = read();
                if (session) {
                    const response = await fetch(`${apiUrl()}/v1/auth/google/logout`, { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } });
                    if (!response.ok) return { error: new Error('Unable to end your session. Please try again.') };
                }
                sessionStorage.removeItem(storageKey);
                listener?.('SIGNED_OUT', null);
                return { error: null };
            }
        } };
    }
    async function client() {
        if (!clientPromise) {
            clientPromise = fetch(`${apiUrl()}/v1/auth/config`).then(async response => {
                if (!response.ok) throw new Error('Authentication service is not configured.');
                const config = await response.json();
                const created = config.provider === 'google' ? await googleClient() : window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
                    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
                });
                created.auth?.onAuthStateChange?.((_event, nextSession) => {
                    cachedSession = nextSession || null;
                    sessionPromise = null;
                });
                return created;
            }).catch(error => {
                clientPromise = null;
                throw error;
            });
        }
        return clientPromise;
    }
    async function expireSession(auth) {
        await auth.auth.signOut().catch(() => {});
        cachedSession = null;
        localStorage.removeItem('ace_current_user');
        localStorage.removeItem('ace_current_session');
        sessionStorage.setItem('ace_login_notice', sessionExpiredMessage);
        window.location.replace('/login');
        const error = new Error(sessionExpiredMessage);
        error.status = 401;
        throw error;
    }
    async function session(auth) {
        if (cachedSession) return cachedSession;
        sessionPromise ||= auth.auth.getSession().then(({ data }) => {
            cachedSession = data.session || null;
            return cachedSession;
        }).finally(() => { sessionPromise = null; });
        return sessionPromise;
    }
    async function authorizedFetch(path, options = {}) {
        const auth = await client();
        const activeSession = await session(auth);
        const send = accessToken => fetch(`${apiUrl()}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) } });
        let response = await send(activeSession?.access_token);
        if (response.status === 401) {
            refreshPromise ||= auth.auth.refreshSession().finally(() => { refreshPromise = null; });
            const { data, error } = await refreshPromise;
            if (error || !data.session?.access_token) return expireSession(auth);
            cachedSession = data.session;
            response = await send(data.session.access_token);
            if (response.status === 401) return expireSession(auth);
        }
        return response;
    }
    async function request(path, options = {}) {
        const response = await authorizedFetch(path, options);
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(body.error || 'Request failed');
            error.status = response.status;
            throw error;
        }
        return body;
    }
    return { client, session: async () => session(await client()), request, authorizedFetch };
})();
