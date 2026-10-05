// Akio <3: Project source maintained by Akio Zaki Salomon.
window.ACEAuth = (() => {
    let clientPromise;
    let refreshPromise;
    let sessionPromise;
    let cachedSession;
    const sessionExpiredMessage = 'Your session expired. Please sign in again.';
    const apiUrl = () => String(window.ACE_API_URL || '').replace(/\/$/, '');
    async function client() {
        if (!clientPromise) {
            clientPromise = fetch(`${apiUrl()}/v1/auth/config`).then(async response => {
                if (!response.ok) throw new Error('Authentication service is not configured.');
                const config = await response.json();
                const created = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
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
