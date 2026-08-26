window.ACEAuth = (() => {
    let clientPromise;
    const apiUrl = () => String(window.ACE_API_URL || '').replace(/\/$/, '');
    async function client() {
        if (!clientPromise) {
            clientPromise = fetch(`${apiUrl()}/v1/auth/config`).then(async response => {
                if (!response.ok) throw new Error('Authentication service is not configured.');
                const config = await response.json();
                return window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
            });
        }
        return clientPromise;
    }
    async function request(path, options = {}) {
        const auth = await client();
        const { data: { session } } = await auth.auth.getSession();
        const response = await fetch(`${apiUrl()}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}), ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) } });
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
