window.ACETutorial = (() => {
    const stateKey = userId => `ace_tutorial_fallback_${userId}`;
    const readyEvent = 'ace:app-ready';
    const targetTimeout = 1800;
    let profile;
    let roleConfig;
    let overlay;
    let active = false;
    let firstFocus;

    const pageName = () => {
        const part = location.pathname.split('/').pop() || '';
        return part.includes('.') ? part : `${part || (profile?.Role === 'ADMIN' ? 'admin-dashboard' : 'user-dashboard')}.html`;
    };
    const fallback = () => {
        try { return JSON.parse(localStorage.getItem(stateKey(profile.UserId)) || 'null'); } catch { return null; }
    };
    const savedState = () => fallback() || {};
    const setFallback = patch => localStorage.setItem(stateKey(profile.UserId), JSON.stringify({ ...savedState(), ...patch }));
    const removeFallback = () => localStorage.removeItem(stateKey(profile.UserId));
    const escape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
    const normalized = source => ({
        status: source?.tutorial_status || source?.status || 'NOT_STARTED',
        step: Number(source?.tutorial_step ?? source?.step ?? 0) || 0,
        version: Number(source?.tutorial_version ?? source?.version ?? roleConfig.version) || roleConfig.version
    });
    const tutorialState = () => normalized({ ...profile.RawTutorial, ...fallback() });
    const launchMode = (account, config, state) => {
        if (!account || account.Status !== 'ACTIVE' || !config) return 'NONE';
        if (state.status === 'NOT_STARTED') return 'WELCOME';
        if (state.status === 'IN_PROGRESS') return 'RESUME';
        return 'NONE';
    };

    async function persist(patch) {
        const payload = { ...patch, version: roleConfig.version };
        const apply = async () => window.ACEAuth.request('/v1/me/tutorial', { method: 'PATCH', body: JSON.stringify(payload) });
        // Store first: a tab closing mid-request may never run a rejection handler.
        setFallback(payload);
        try {
            const result = await apply().catch(async error => { await new Promise(resolve => setTimeout(resolve, 250)); return apply(); });
            profile.RawTutorial = result.profile;
            removeFallback();
            return true;
        } catch (error) {
            console.warn('[onboarding] Could not save tutorial state; using this browser until the next successful save.', error);
            return false;
        }
    }
    function close() {
        active = false;
        overlay?.remove(); overlay = null;
        document.querySelectorAll('.ace-tutorial-target').forEach(element => element.classList.remove('ace-tutorial-target'));
        firstFocus?.focus?.();
    }
    function trap(event) {
        if (event.key === 'Escape') { event.preventDefault(); finish('SKIPPED'); return; }
        if (event.key !== 'Tab' || !overlay) return;
        const nodes = [...overlay.querySelectorAll('button:not([disabled])')];
        if (!nodes.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    function makeOverlay(content, label) {
        close(); active = true; firstFocus = document.activeElement;
        overlay = document.createElement('section');
        overlay.className = 'ace-tutorial-overlay';
        overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', label);
        overlay.innerHTML = `<div class="ace-tutorial-scrim"></div><div class="ace-tutorial-live" aria-live="polite" aria-atomic="true"></div>${content}`;
        overlay.addEventListener('keydown', trap);
        document.body.append(overlay);
        return overlay;
    }
    function welcome() {
        const ui = makeOverlay(`<div class="ace-tutorial-card ace-tutorial-welcome"><p class="ace-tutorial-eyebrow">WELCOME</p><h2>Take a quick tour?</h2><p>We can show you the main tools in your ACE workspace. It only takes a moment.</p><div class="ace-tutorial-actions"><button class="btn btn-secondary" type="button" data-tutorial-skip>Skip tutorial</button><button class="btn btn-primary" type="button" data-tutorial-start>Start tutorial</button></div></div>`, 'Welcome to ACE');
        ui.querySelector('[data-tutorial-start]').addEventListener('click', () => start());
        ui.querySelector('[data-tutorial-skip]').addEventListener('click', () => finish('SKIPPED'));
        ui.querySelector('[data-tutorial-start]').focus();
    }
    async function waitForTarget(selector) {
        const immediate = document.querySelector(selector);
        if (immediate) return immediate;
        await new Promise(resolve => setTimeout(resolve, targetTimeout));
        const target = document.querySelector(selector);
        if (!target) console.warn(`[onboarding] Target not found: ${selector}`);
        return target;
    }
    async function showStep(stepIndex) {
        const step = roleConfig.steps[stepIndex];
        if (!step) return finish('COMPLETED');
        if (pageName() !== step.page) {
            await persist({ status: 'IN_PROGRESS', step: stepIndex });
            location.assign(`/${step.page.replace(/\.html$/, '')}`);
            return;
        }
        const target = await waitForTarget(step.target);
        if (!active && overlay) return;
        const targetText = target ? '' : '<p class="ace-tutorial-missing">This item is unavailable on this screen. You can continue the tour.</p>';
        const ui = makeOverlay(`<div class="ace-tutorial-card${target ? '' : ' is-centered'}"><p class="ace-tutorial-progress">Step ${stepIndex + 1} of ${roleConfig.steps.length}</p><h2>${escape(step.title)}</h2><p>${escape(step.body)}</p>${targetText}<div class="ace-tutorial-actions"><button class="btn btn-text" type="button" data-tutorial-skip>Skip</button><span><button class="btn btn-secondary" type="button" data-tutorial-back ${stepIndex === 0 ? 'disabled' : ''}>Back</button><button class="btn btn-primary" type="button" data-tutorial-next>${stepIndex === roleConfig.steps.length - 1 ? 'Finish' : 'Next'}</button></span></div></div>`, `${step.title}, step ${stepIndex + 1} of ${roleConfig.steps.length}`);
        if (target) target.classList.add('ace-tutorial-target');
        ui.querySelector('.ace-tutorial-live').textContent = `Step ${stepIndex + 1} of ${roleConfig.steps.length}: ${step.title}`;
        ui.querySelector('[data-tutorial-skip]').addEventListener('click', () => finish('SKIPPED'));
        ui.querySelector('[data-tutorial-back]').addEventListener('click', () => go(stepIndex - 1));
        ui.querySelector('[data-tutorial-next]').addEventListener('click', () => go(stepIndex + 1));
        ui.querySelector('[data-tutorial-next]').focus();
    }
    async function go(step) { await persist({ status: 'IN_PROGRESS', step }); await showStep(step); }
    async function finish(status) { await persist({ status, step: status === 'COMPLETED' ? roleConfig.steps.length : 0 }); close(); }
    async function start({ fromBeginning = false } = {}) {
        const matching = roleConfig.steps.findIndex(step => step.page === pageName());
        const index = fromBeginning ? 0 : (matching >= 0 && !roleConfig.steps[0].forcePage ? matching : 0);
        await persist({ status: 'IN_PROGRESS', step: index });
        await showStep(index);
    }
    async function initialize() {
        profile = window.AppState?.currentUser;
        roleConfig = window.ACETutorialConfig?.[profile?.Role];
        if (!profile || profile.Status !== 'ACTIVE' || !roleConfig) return;
        const local = fallback();
        if (local) await persist(local);
        const state = tutorialState();
        if (state.version !== roleConfig.version) { await persist({ status: 'NOT_STARTED', step: 0 }); welcome(); return; }
        const mode = launchMode(profile, roleConfig, state);
        if (mode === 'WELCOME') return welcome();
        if (mode === 'RESUME') return showStep(Math.min(state.step, roleConfig.steps.length - 1));
    }
    function restart() { if (!profile || profile.Status !== 'ACTIVE') return; close(); start({ fromBeginning: true }); }
    window.addEventListener(readyEvent, initialize);
    return { restart, initialize, launchMode };
})();
