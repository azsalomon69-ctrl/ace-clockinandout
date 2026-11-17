const tourTrack = document.getElementById('publicTourTrack');
const tourLinks = [...document.querySelectorAll('[data-tour-link]')];
const tourPanels = [...tourTrack.children];
let activePanel;
let clockPreview;
let clockScrollTimer;
const clockPanel = document.getElementById('tour-clock');

function showStaticClockPreview() {
    clockPanel.querySelector('.is-device-loading')?.classList.remove('is-device-loading');
}

function loadClockPreview() {
    clockPreview ??= import('/assets/tour-devices/scene.js?v=full-page-loader')
        .then(module => module.activate())
        .catch(showStaticClockPreview);
    return clockPreview;
}

function fitTourTrack() {
    const height = activePanel.offsetHeight;
    if (height > 0) tourTrack.style.height = height + 'px';
}

function selectTourPanel(panel) {
    activePanel = panel;
    tourPanels.forEach(item => { item.inert = item !== panel; });
    fitTourTrack();
    let activeLink;
    tourLinks.forEach(link => {
        if (link.hash === '#' + panel.id) {
            activeLink = link;
            link.setAttribute('aria-current', 'true');
        } else {
            link.removeAttribute('aria-current');
        }
    });
    if (activeLink) {
        const tabs = activeLink.parentElement;
        const center = activeLink.getBoundingClientRect().left - tabs.getBoundingClientRect().left
            + tabs.scrollLeft + activeLink.offsetWidth / 2;
        tabs.scrollLeft = center - tabs.clientWidth / 2;
    }
}

tourLinks.forEach(link => {
    link.addEventListener('click', event => {
        const panel = document.getElementById(link.hash.slice(1));
        if (!panel) return;
        event.preventDefault();
        selectTourPanel(panel);
        if (panel === clockPanel) void loadClockPreview();
        tourTrack.scrollTo({
            left: panel.offsetLeft,
            behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
        });
        history.replaceState(null, '', link.hash);
    });
});

tourTrack.addEventListener('scroll', () => {
    clearTimeout(clockScrollTimer);
    const offset = tourTrack.scrollLeft;
    const current = tourPanels.reduce((closest, panel) =>
        Math.abs(panel.offsetLeft - offset) < Math.abs(closest.offsetLeft - offset) ? panel : closest
    );
    if (!tourLinks.some(link => link.hash === '#' + current.id && link.getAttribute('aria-current') === 'true')) {
        selectTourPanel(current);
    }
    if (!clockPreview && current === clockPanel) {
        clockScrollTimer = setTimeout(() => {
            if (Math.abs(tourTrack.scrollLeft - clockPanel.offsetLeft) < 2) void loadClockPreview();
        }, 160);
    }
}, { passive: true });

const linkedPanel = tourPanels.find(panel => '#' + panel.id === location.hash) || tourPanels[0];
selectTourPanel(linkedPanel);
const panelResize = new ResizeObserver(fitTourTrack);
tourPanels.forEach(panel => panelResize.observe(panel));
tourTrack.scrollLeft = linkedPanel.offsetLeft;

let tourLoadTimeout;
const tourLoadDeadline = new Promise(resolve => {
    tourLoadTimeout = setTimeout(() => {
        showStaticClockPreview();
        resolve();
    }, 15000);
});
const firstScreenshot = linkedPanel.querySelector('.public-screenshot img');
if (firstScreenshot) firstScreenshot.loading = 'eager';
const tourSetup = firstScreenshot ? firstScreenshot.decode().catch(() => {}) : loadClockPreview();
Promise.race([tourSetup, tourLoadDeadline]).finally(() => {
    clearTimeout(tourLoadTimeout);
    document.body.classList.remove('is-tour-starting');
});
