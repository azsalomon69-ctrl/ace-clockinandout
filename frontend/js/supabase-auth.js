// Akio <3: Project source maintained by Akio Zaki Salomon.
window.ACEAuth = (() => {
    let configPromise;
    let clientPromise;
    let refreshPromise;
    let sessionPromise;
    let cachedSession;
    let clientConfig;
    let authSubscription;
    const configCacheKey = 'ace_public_auth_config';
    const configCacheVersion = 1;
    const sessionExpiredMessage = 'Your session expired. Please sign in again.';
    const requestTimeoutMs = 30000;
    const apiUrl = () => String(window.ACE_API_URL || '').replace(/\/$/, '');
    async function fetchWithTimeout(url, options = {}) {
        const { timeoutMs = requestTimeoutMs, ...fetchOptions } = options;
        const controller = new AbortController();
        const callerSignal = options.signal;
        const abortFromCaller = () => controller.abort();
        if (callerSignal?.aborted) controller.abort();
        else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
        const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await fetch(url, { ...fetchOptions, signal: controller.signal });
        } catch (error) {
            if (controller.signal.aborted && !callerSignal?.aborted) {
                const timeoutError = new Error('The ACE service did not respond in time.');
                timeoutError.status = 504;
                timeoutError.code = 'ETIMEDOUT';
                throw timeoutError;
            }
            throw error;
        } finally {
            window.clearTimeout(timeoutId);
            callerSignal?.removeEventListener('abort', abortFromCaller);
        }
    }
    function withTimeout(promise, message = 'Authentication took too long.') {
        let timeoutId;
        const deadline = new Promise((_, reject) => {
            timeoutId = window.setTimeout(() => {
                const error = new Error(message);
                error.status = 504;
                error.code = 'ETIMEDOUT';
                reject(error);
            }, requestTimeoutMs);
        });
        return Promise.race([promise, deadline]).finally(() => window.clearTimeout(timeoutId));
    }
    function getConfig() {
        configPromise ||= fetchConfig().catch(error => {
            configPromise = null;
            throw error;
        });
        return configPromise;
    }
    function cachedConfig() {
        try {
            const saved = JSON.parse(localStorage.getItem(configCacheKey));
            if (saved?.version === configCacheVersion && saved.apiOrigin === apiUrl() &&
                Number.isFinite(saved.refreshedAt) && typeof saved.supabaseUrl === 'string' && saved.supabaseUrl &&
                typeof saved.supabasePublishableKey === 'string' && saved.supabasePublishableKey) return saved;
        } catch { /* Storage can be unavailable. */ }
        return null;
    }
    function resetClient() {
        authSubscription?.unsubscribe?.();
        authSubscription = null;
        void clientPromise?.then(previous => previous.auth.stopAutoRefresh?.()).catch(() => {});
        clientPromise = sessionPromise = refreshPromise = null;
        cachedSession = null;
    }
    async function client(bootstrapConfig) {
        if (!clientPromise) {
            clientPromise = (bootstrapConfig ? Promise.resolve(bootstrapConfig) : getConfig()).then(config => {
                clientConfig = config;
                const created = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
                    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
                });
                authSubscription = created.auth?.onAuthStateChange?.((_event, nextSession) => {
                    cachedSession = nextSession || null;
                    sessionPromise = null;
                    window.dispatchEvent(new CustomEvent('ace:auth-account', { detail: nextSession?.user?.id || null }));
                })?.data?.subscription;
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
        sessionPromise ||= withTimeout(auth.auth.getSession()).then(({ data }) => {
            cachedSession = data.session || null;
            return cachedSession;
        }).finally(() => { sessionPromise = null; });
        return sessionPromise;
    }
    async function authorizedFetch(path, options = {}) {
        const { expectedUserId, ...requestOptions } = options;
        const auth = await client();
        const activeSession = expectedUserId ? await currentSession(auth) : await session(auth);
        const requireExpectedAccount = active => {
            if (expectedUserId && (active?.user?.id !== expectedUserId || !active.access_token)) {
                const error = new Error(sessionExpiredMessage);
                error.status = 401;
                throw error;
            }
        };
        const send = active => {
            requireExpectedAccount(active);
            const accessToken = active?.access_token;
            return fetchWithTimeout(`${apiUrl()}${path}`, { ...requestOptions, headers: { 'Content-Type': 'application/json', ...(requestOptions.headers || {}), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) } });
        };
        let response = await send(activeSession);
        if (response.status === 401) {
            if (expectedUserId) requireExpectedAccount(await currentSession(auth));
            refreshPromise ||= withTimeout(auth.auth.refreshSession(), 'Session refresh took too long. Please try again.').finally(() => { refreshPromise = null; });
            const { data, error } = await refreshPromise;
            if (error && (error.name === 'AuthRetryableFetchError' || error.status >= 500 || error.status === 429)) throw error;
            if (error || !data.session?.access_token) {
                if (expectedUserId) return response;
                return expireSession(auth);
            }
            cachedSession = data.session;
            response = await send(data.session);
            if (response.status === 401 && !expectedUserId) return expireSession(auth);
        }
        return response;
    }
    const responseBody = response => withTimeout(response.json(), 'The ACE response took too long.');
    async function request(path, options = {}) {
        const response = await authorizedFetch(path, options);
        const body = response.status === 204 ? {} : await responseBody(response).catch(error => {
            if (error.code === 'ETIMEDOUT') throw error;
            return {};
        });
        if (!response.ok) {
            const error = new Error(body.error || 'Request failed');
            error.status = response.status;
            throw error;
        }
        return body;
    }
    async function fetchConfig() {
        // /health is for infrastructure monitoring. Some browser filters block
        // that path, so gate startup on the configuration the app actually uses.
        const response = await fetchWithTimeout(`${apiUrl()}/v1/auth/config`, { timeoutMs: 10000, cache: 'no-store', keepalive: true });
        const body = await withTimeout(response.json(), 'The ACE configuration response took too long.').catch(error => {
            if (error.code === 'ETIMEDOUT') throw error;
            return null;
        });
        if (!response.ok || typeof body?.supabaseUrl !== 'string' || !body.supabaseUrl || typeof body?.supabasePublishableKey !== 'string' || !body.supabasePublishableKey) {
            const error = new Error('The ACE server is not ready yet.');
            error.status = response.ok ? 503 : response.status;
            throw error;
        }
        if (clientConfig && (clientConfig.supabaseUrl !== body.supabaseUrl ||
            clientConfig.supabasePublishableKey !== body.supabasePublishableKey)) {
            resetClient();
            window.dispatchEvent(new CustomEvent('ace:auth-account', { detail: null }));
        }
        try {
            localStorage.setItem(configCacheKey, JSON.stringify({
                version: configCacheVersion, apiOrigin: apiUrl(), refreshedAt: Date.now(),
                supabaseUrl: body.supabaseUrl, supabasePublishableKey: body.supabasePublishableKey
            }));
        } catch { /* The live client can still be used. */ }
        return body;
    }
    async function checkService() { await getConfig(); }
    async function currentSession(auth) {
        const { data, error } = await withTimeout(auth.auth.getSession());
        if (error) throw error;
        return data?.session || null;
    }
    async function cachedAuthSession() {
        const config = cachedConfig();
        return config ? currentSession(await client(config)) : null;
    }
    return { client, session: async () => session(await client()), cachedAuthSession, request, authorizedFetch, responseBody, checkService };
})();
