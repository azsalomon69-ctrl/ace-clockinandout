window.ACEAuth = (() => {
    let clientPromise;
    let refreshPromise;
    const sessionExpiredMessage = 'Your session expired. Please sign in again.';
    const apiUrl = () => String(window.ACE_API_URL || '').replace(/\/$/, '');
    async function client() {
        if (!clientPromise) {
            clientPromise = fetch(`${apiUrl()}/v1/auth/config`).then(async response => {
                if (!response.ok) throw new Error('Authentication service is not configured.');
                const config = await response.json();
                return window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
                    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
                });
            });
        }
        return clientPromise;
    }
    async function expireSession(auth) {
        await auth.auth.signOut().catch(() => {});
        localStorage.removeItem('ace_current_user');
        localStorage.removeItem('ace_current_session');
        sessionStorage.setItem('ace_login_notice', sessionExpiredMessage);
        window.location.replace('login.html');
        const error = new Error(sessionExpiredMessage);
        error.status = 401;
        throw error;
    }
    async function request(path, options = {}) {
        const auth = await client();
        const { data: { session } } = await auth.auth.getSession();
        const send = accessToken => fetch(`${apiUrl()}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) } });
        let response = await send(session?.access_token);
        if (response.status === 401) {
            refreshPromise ||= auth.auth.refreshSession().finally(() => { refreshPromise = null; });
            const { data, error } = await refreshPromise;
            if (error || !data.session?.access_token) return expireSession(auth);
            response = await send(data.session.access_token);
            if (response.status === 401) return expireSession(auth);
        }
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(body.error || 'Request failed');
            error.status = response.status;
            throw error;
        }
        return body;
    }
    return { client, request };
})();
