// Mount the shared sidebar before the rest of the application starts.
// Keeping this bootstrap separate prevents page-data failures from exposing
// the legacy HTML navigation underneath the application shell.
(() => {
    const mountSidebar = () => {
        if (document.body.classList.contains('has-app-shell')) return;
        if (typeof window.initializeAppShell !== 'function') return;
        try {
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
