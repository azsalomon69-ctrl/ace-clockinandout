// Mount the shared sidebar before the rest of the application starts.
// Keeping this bootstrap separate prevents page-data failures from exposing
// the legacy HTML navigation underneath the application shell.
(() => {
    const mountSidebar = () => {
        if (document.body.classList.contains('has-app-shell')) return;
        if (typeof window.initializeAppShell !== 'function') return;
        try {
            // This listener runs before the main startup listener. Restore the
            // signed-in role first so /settings never defaults an admin to the
            // employee shell.
            if (!AppState.currentUser) {
                const savedUser = localStorage.getItem('ace_current_user');
                if (savedUser) AppState.currentUser = JSON.parse(savedUser);
            }
            window.initializeAppShell();
        } catch (error) {
            console.error('Could not mount the application sidebar.', error);
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mountSidebar, { once: true });
    } else {
        mountSidebar();
    }
})();
