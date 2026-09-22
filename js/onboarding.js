window.ACETutorial = (() => {
    const stateKey = userId => `ace_tutorial_fallback_${userId}`;
    const readyEvent = 'ace:app-ready';
    const targetTimeout = 1800;
    let profile;
    let roleConfig;
    let overlay;
    let active = false;
    let firstFocus;
    let placementCleanup;
    let placementFrame;
    let focusCleanup;
    let currentStepIndex;

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
    const isMobile = () => window.matchMedia('(max-width: 768px)').matches;
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
    // Use an immediate reveal so the card is measured only after the target reaches its final position.
    const scrollBehavior = () => 'auto';
    function clearPlacementListeners() {
        if (placementFrame) cancelAnimationFrame(placementFrame);
        placementFrame = null;
        placementCleanup?.();
        placementCleanup = null;
    }
    function clearFocusContainment() {
        focusCleanup?.();
        focusCleanup = null;
    }
    function containFocus() {
        clearFocusContainment();
        const onFocusIn = event => {
            const card = overlay?.querySelector('.ace-tutorial-card');
            if (!card || card.contains(event.target)) return;
            const control = card.querySelector('button:not([disabled])');
            control?.focus();
        };
        document.addEventListener('focusin', onFocusIn);
        focusCleanup = () => document.removeEventListener('focusin', onFocusIn);
    }
    function close() {
        active = false;
        clearPlacementListeners();
        clearFocusContainment();
        document.body.classList.remove('ace-tutorial-welcome-open');
        overlay?.remove(); overlay = null;
        document.querySelectorAll('.ace-tutorial-target').forEach(element => element.classList.remove('ace-tutorial-target'));
        firstFocus?.focus?.();
    }
    function trap(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            if (overlay?.querySelector('.ace-tutorial-welcome')) finish('SKIPPED');
            else if (overlay?.dataset.exitConfirmation === 'true') showStep(currentStepIndex);
            else confirmExit();
            return;
        }
        if (event.key !== 'Tab' || !overlay) return;
        const nodes = [...overlay.querySelectorAll('button:not([disabled])')];
        if (!nodes.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    function makeOverlay(content, label, { welcome = false } = {}) {
        close(); active = true; firstFocus = document.activeElement;
        if (welcome) document.body.classList.add('ace-tutorial-welcome-open');
        overlay = document.createElement('section');
        overlay.className = 'ace-tutorial-overlay';
        overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', label);
        overlay.innerHTML = `<div class="ace-tutorial-scrim"></div><div class="ace-tutorial-live" aria-live="polite" aria-atomic="true"></div>${content}`;
        overlay.addEventListener('keydown', trap);
        document.body.append(overlay);
        containFocus();
        return overlay;
    }
    function welcome() {
        const ui = makeOverlay(`<div class="ace-tutorial-card ace-tutorial-welcome"><p class="ace-tutorial-eyebrow">WELCOME</p><h2>Take a quick tour?</h2><p>We can show you the main tools in your ACE workspace. It only takes a moment.</p><div class="ace-tutorial-actions"><button class="btn btn-secondary" type="button" data-tutorial-skip>Skip tutorial</button><button class="btn btn-primary" type="button" data-tutorial-start>Start tutorial</button></div></div>`, 'Welcome to ACE', { welcome: true });
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
    async function revealTarget(target, mobile) {
        const rect = target.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const isVisible = rect.bottom > 0 && rect.top < viewportHeight;
        const needsReveal = !isVisible || (mobile && (rect.top < 72 || rect.bottom > viewportHeight * .48));
        if (!needsReveal) return;
        // Reveal every step's target once. Desktop centers it so the anchored card can fit;
        // mobile places it in the upper half to leave room for the bottom sheet.
        target.scrollIntoView({ behavior: scrollBehavior(), block: mobile ? 'start' : 'center', inline: 'nearest' });
        await nextFrame();
        if (mobile) {
            const afterScroll = target.getBoundingClientRect();
            const desiredTop = Math.max(72, Math.min(viewportHeight * .18, 150));
            window.scrollBy({ top: afterScroll.top - desiredTop, behavior: scrollBehavior() });
            await nextFrame();
        }
    }
    function centerCard(card, target, reason) {
        target?.classList.remove('ace-tutorial-target');
        card.classList.add('is-centered');
        card.style.removeProperty('left');
        card.style.removeProperty('top');
        card.style.removeProperty('bottom');
        if (reason && card.dataset.anchorFallback !== reason) console.warn(`[onboarding] ${reason}`);
        if (reason) card.dataset.anchorFallback = reason;
    }
    async function positionStep(target, card, { reveal = false } = {}) {
        if (!target || !overlay || !active) return;
        const mobile = isMobile();
        if (reveal) await revealTarget(target, mobile);
        if (!overlay || !active) return;
        card.classList.remove('is-centered');
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        let targetRect = target.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        const requiredHeight = cardRect.height + 48;
        if (targetRect.height > viewportHeight - requiredHeight) {
            centerCard(card, target, 'target too large to anchor');
            return;
        }
        delete card.dataset.anchorFallback;
        target.classList.add('ace-tutorial-target');
        if (mobile) {
            const sheetTop = cardRect.top;
            if (targetRect.bottom + 12 > sheetTop) {
                window.scrollBy({ top: targetRect.bottom + 12 - sheetTop, behavior: scrollBehavior() });
                await nextFrame();
                targetRect = target.getBoundingClientRect();
            }
            const updatedSheetTop = card.getBoundingClientRect().top;
            if (targetRect.bottom + 12 > updatedSheetTop) centerCard(card, target, 'target too large to anchor');
            return;
        }
        const gap = 6;
        const margin = 12;
        const width = cardRect.width;
        const height = cardRect.height;
        const candidates = [
            { top: targetRect.top - height - gap, left: targetRect.left + (targetRect.width - width) / 2 },
            { top: targetRect.bottom + gap, left: targetRect.left + (targetRect.width - width) / 2 },
            { top: targetRect.top + (targetRect.height - height) / 2, left: targetRect.right + gap },
            { top: targetRect.top + (targetRect.height - height) / 2, left: targetRect.left - width - gap }
        ];
        const candidate = candidates.find(position => position.top >= margin && position.left >= margin && position.top + height <= viewportHeight - margin && position.left + width <= viewportWidth - margin) || candidates[0];
        card.style.left = `${Math.max(margin, Math.min(candidate.left, viewportWidth - width - margin))}px`;
        card.style.top = `${Math.max(margin, Math.min(candidate.top, viewportHeight - height - margin))}px`;
        card.style.removeProperty('bottom');
    }
    function watchPlacement(target, card) {
        clearPlacementListeners();
        const update = () => {
            if (placementFrame) return;
            placementFrame = requestAnimationFrame(() => {
                placementFrame = null;
                positionStep(target, card);
            });
        };
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        placementCleanup = () => {
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update, true);
        };
    }
    function confirmExit() {
        const ui = overlay;
        const card = ui?.querySelector('.ace-tutorial-card');
        if (!ui || !card) return;
        ui.dataset.exitConfirmation = 'true';
        card.classList.add('ace-tutorial-exit-confirmation');
        card.innerHTML = `<p class="ace-tutorial-progress">Tutorial paused</p><h2>Leave tutorial?</h2><p>You can restart it anytime from your account menu.</p><div class="ace-tutorial-actions ace-tutorial-confirm-actions"><button class="btn btn-secondary" type="button" data-tutorial-keep>Keep going</button><button class="btn btn-primary" type="button" data-tutorial-leave>Leave tutorial</button></div>`;
        card.querySelector('[data-tutorial-keep]').addEventListener('click', () => showStep(currentStepIndex));
        card.querySelector('[data-tutorial-leave]').addEventListener('click', () => finish('SKIPPED'));
        card.querySelector('[data-tutorial-keep]').focus();
    }
    async function showStep(stepIndex) {
        const step = roleConfig.steps[stepIndex];
        if (!step) return finish('COMPLETED');
        currentStepIndex = stepIndex;
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
        if (target) {
            const card = ui.querySelector('.ace-tutorial-card');
            await positionStep(target, card, { reveal: true });
            if (overlay === ui && active) watchPlacement(target, card);
        }
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
