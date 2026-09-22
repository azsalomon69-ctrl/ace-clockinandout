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
    // The body class is the normal source of truth. The control's accessible
    // label is also checked because the sidebar can render before a retained
    // collapsed preference has been reflected on the body.
    const isDesktopSidebarCollapsed = () => !isMobile() && (
        document.body.classList.contains('shell-collapsed') ||
        document.querySelector('.shell-collapse[aria-label="Expand sidebar"]')?.getAttribute('aria-expanded') === 'false'
    );
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const scrollBehavior = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    const waitForScrollEnd = () => new Promise(resolve => {
        let quietTimer;
        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            window.removeEventListener('scroll', onScroll, true);
            clearTimeout(quietTimer);
            resolve();
        };
        const onScroll = () => {
            clearTimeout(quietTimer);
            quietTimer = setTimeout(finish, 110);
        };
        window.addEventListener('scroll', onScroll, true);
        quietTimer = setTimeout(finish, 160);
        setTimeout(finish, 900);
    });
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
        document.querySelectorAll('.shell-collapse[data-tutorial-forced-visible]').forEach(element => {
            element.style.removeProperty('display');
            element.style.removeProperty('visibility');
            element.style.removeProperty('opacity');
            element.removeAttribute('data-tutorial-forced-visible');
        });
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
    function makeOverlay(content, label, { welcome = false, navigation = false } = {}) {
        close(); active = true; firstFocus = document.activeElement;
        if (welcome) document.body.classList.add('ace-tutorial-welcome-open');
        overlay = document.createElement('section');
        overlay.className = `ace-tutorial-overlay${navigation ? ' ace-tutorial-navigation-overlay' : ''}`;
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
    async function revealTarget(target, mobile, card) {
        const rect = target.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const isVisible = rect.bottom > 0 && rect.top < viewportHeight;
        const needsReveal = !isVisible || (mobile && (rect.top < 72 || rect.bottom > viewportHeight * .48));
        if (!needsReveal) return;
        // Reveal a target once before placing the card. Waiting for smooth
        // scrolling to settle prevents the mobile sheet and the page from
        // fighting each other over several animation frames.
        target.scrollIntoView({ behavior: scrollBehavior(), block: mobile ? 'start' : 'center', inline: 'nearest' });
        await waitForScrollEnd();
        if (mobile) {
            const afterScroll = target.getBoundingClientRect();
            const sheetHeight = card?.getBoundingClientRect().height || viewportHeight * .42;
            const availableHeight = viewportHeight - sheetHeight - 28;
            const desiredTop = Math.max(72, Math.min(150, availableHeight - afterScroll.height - 12));
            const adjustment = afterScroll.top - desiredTop;
            if (Math.abs(adjustment) > 8) {
                window.scrollBy({ top: adjustment, behavior: scrollBehavior() });
                await waitForScrollEnd();
            }
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
        if (reveal) await revealTarget(target, mobile, card);
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
            const updatedSheetTop = card.getBoundingClientRect().top;
            if (targetRect.bottom + 12 > updatedSheetTop) centerCard(card, target, 'target too large to anchor');
            return;
        }
        // Leave room for the coachmark arrow and keep the taught control visible.
        const gap = 22;
        const margin = 12;
        const width = cardRect.width;
        const height = cardRect.height;
        const candidates = [
            { placement: 'above', top: targetRect.top - height - gap, left: targetRect.left + (targetRect.width - width) / 2 },
            { placement: 'below', top: targetRect.bottom + gap, left: targetRect.left + (targetRect.width - width) / 2 },
            { placement: 'right', top: targetRect.top + (targetRect.height - height) / 2, left: targetRect.right + gap },
            { placement: 'left', top: targetRect.top + (targetRect.height - height) / 2, left: targetRect.left - width - gap }
        ];
        const candidate = candidates.find(position => position.top >= margin && position.left >= margin && position.top + height <= viewportHeight - margin && position.left + width <= viewportWidth - margin) || candidates[0];
        const left = Math.max(margin, Math.min(candidate.left, viewportWidth - width - margin));
        const top = Math.max(margin, Math.min(candidate.top, viewportHeight - height - margin));
        card.dataset.placement = candidate.placement;
        card.style.left = `${left}px`;
        card.style.top = `${top}px`;
        card.style.setProperty('--ace-tutorial-arrow-x', `${Math.max(20, Math.min(targetRect.left + targetRect.width / 2 - left, width - 20))}px`);
        card.style.setProperty('--ace-tutorial-arrow-y', `${Math.max(20, Math.min(targetRect.top + targetRect.height / 2 - top, height - 20))}px`);
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
        // On mobile the card is a fixed bottom sheet. Repositioning it for
        // every scroll event creates a scroll/reposition feedback loop.
        if (!isMobile()) window.addEventListener('scroll', update, true);
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
    const navigationInstruction = step => {
        if (!step.navigation) return 'Use the sidebar to open this page. The tutorial will continue automatically when you arrive.';
        const { group, label } = step.navigation;
        const sidebar = document.getElementById('appSidebar');
        const groupElement = [...document.querySelectorAll('.shell-nav-group')].find(element => element.dataset.groupLabel === group);
        const groupClosed = Boolean(groupElement?.querySelector('.shell-nav-group-items')?.hidden);
        const parts = [];
        if (isMobile() && !document.body.classList.contains('shell-mobile-open')) parts.push('Tap Open sidebar below');
        else if (isDesktopSidebarCollapsed()) parts.push('Click the arrow on the edge of the sidebar to expand it first');
        else if (!sidebar) parts.push('Open the sidebar');
        if (groupElement && groupClosed) parts.push(`open the ${group} section`);
        else if (groupElement) parts.push(`use the already-open ${group} section`);
        else if (group === 'Account') parts.push('open your account menu at the bottom of the sidebar');
        else parts.push(`find ${group} in the sidebar`);
        parts.push(`select ${label}`);
        return `${parts.join(', then ')}. The tutorial will continue automatically when you arrive.`;
    };
    const navigationTarget = step => {
        if (!step.navigation) return null;
        const { group, label } = step.navigation;
        // An icon-only desktop sidebar hides every destination label. Teach
        // its expansion first instead of highlighting an unexplained icon.
        if (isDesktopSidebarCollapsed()) return document.querySelector('.shell-collapse');
        const groupElement = [...document.querySelectorAll('.shell-nav-group')].find(element => element.dataset.groupLabel === group);
        if (groupElement?.querySelector('.shell-nav-group-items')?.hidden) return groupElement.querySelector('.shell-nav-group-toggle');
        const normalizedLabel = label.toLowerCase();
        const link = [...document.querySelectorAll('.shell-link')].find(element => {
            const linkLabel = element.textContent.trim().toLowerCase();
            return linkLabel === normalizedLabel || linkLabel.includes(normalizedLabel) || normalizedLabel.includes(linkLabel);
        });
        if (link) return link;
        if (group === 'Account') return document.querySelector('.shell-account');
        return isMobile() ? document.querySelector('.shell-mobile-toggle') : null;
    };
    async function pauseForNavigation(stepIndex) {
        await persist({ status: 'IN_PROGRESS', step: stepIndex });
        close();
        // On phones, expose the sidebar after the guide closes so the next
        // action is exactly the navigation instruction the user was given.
        if (isMobile()) document.querySelector('.shell-mobile-toggle')?.click();
    }
    async function showNavigationStep(stepIndex, step) {
        const needsSidebarExpand = isDesktopSidebarCollapsed();
        // Read the state once so the words and the highlighted control cannot
        // disagree while the shell is restoring its saved sidebar preference.
        const target = needsSidebarExpand ? document.querySelector('.shell-collapse') : navigationTarget(step);
        const navigationActions = needsSidebarExpand
            ? `<button class="btn btn-text" type="button" data-tutorial-skip>Skip</button><button class="btn btn-secondary" type="button" data-tutorial-back ${stepIndex === 0 ? 'disabled' : ''}>Back</button>`
            : `<button class="btn btn-text" type="button" data-tutorial-skip>Skip</button><span><button class="btn btn-secondary" type="button" data-tutorial-back ${stepIndex === 0 ? 'disabled' : ''}>Back</button><button class="btn btn-primary" type="button" data-tutorial-navigate>${isMobile() ? 'Open sidebar' : 'Use sidebar'}</button></span>`;
        const ui = makeOverlay(`<div class="ace-tutorial-card${target ? '' : ' is-centered'} ace-tutorial-navigation"><p class="ace-tutorial-progress">Step ${stepIndex + 1} of ${roleConfig.steps.length}</p><h2>Go to ${escape(step.navigation?.label || step.title)}</h2><p>${escape(navigationInstruction(step))}</p><div class="ace-tutorial-actions">${navigationActions}</div></div>`, `Navigate to ${step.navigation?.label || step.title}, step ${stepIndex + 1} of ${roleConfig.steps.length}`, { navigation: Boolean(target) });
        ui.querySelector('[data-tutorial-skip]').addEventListener('click', () => finish('SKIPPED'));
        ui.querySelector('[data-tutorial-back]').addEventListener('click', () => go(stepIndex - 1));
        ui.querySelector('[data-tutorial-navigate]')?.addEventListener('click', () => pauseForNavigation(stepIndex));
        if (target) {
            target.classList.add('ace-tutorial-target');
            if (needsSidebarExpand && target.matches('.shell-collapse')) {
                target.dataset.tutorialForcedVisible = 'true';
                target.style.setProperty('display', 'grid', 'important');
                target.style.setProperty('visibility', 'visible', 'important');
                target.style.setProperty('opacity', '1', 'important');
            }
            const card = ui.querySelector('.ace-tutorial-card');
            await positionStep(target, card, { reveal: true });
            if (overlay === ui && active) watchPlacement(target, card);
            // The user can collapse the sidebar at any time. Re-evaluate the
            // current instruction after the real toggle changes state, rather
            // than leaving a coachmark aimed at a now-hidden destination.
            const refreshNavigation = () => requestAnimationFrame(() => {
                if (overlay === ui && active) showNavigationStep(stepIndex, step);
            });
            const sidebarToggle = document.querySelector('.shell-collapse');
            sidebarToggle?.addEventListener('click', refreshNavigation, { once: true });
            if (target.matches('.shell-nav-group-toggle') && target !== sidebarToggle) target.addEventListener('click', refreshNavigation, { once: true });
        }
        ui.querySelector('[data-tutorial-navigate]').focus();
    }
    async function showStep(stepIndex) {
        const step = roleConfig.steps[stepIndex];
        if (!step) return finish('COMPLETED');
        currentStepIndex = stepIndex;
        if (pageName() !== step.page) {
            await persist({ status: 'IN_PROGRESS', step: stepIndex });
            await showNavigationStep(stepIndex, step);
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
    window.addEventListener('ace:route-ready', initialize);
    return { restart, initialize, launchMode };
})();
