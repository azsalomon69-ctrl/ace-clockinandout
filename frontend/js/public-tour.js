const tourTrack = document.getElementById('publicTourTrack');
const tourLinks = [...document.querySelectorAll('[data-tour-link]')];
const tourPanels = [...tourTrack.children];

function selectTourPanel(panel) {
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
        tourTrack.scrollTo({
            left: panel.offsetLeft,
            behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
        });
        history.replaceState(null, '', link.hash);
    });
});

tourTrack.addEventListener('scroll', () => {
    const offset = tourTrack.scrollLeft;
    const current = tourPanels.reduce((closest, panel) =>
        Math.abs(panel.offsetLeft - offset) < Math.abs(closest.offsetLeft - offset) ? panel : closest
    );
    if (!tourLinks.some(link => link.hash === '#' + current.id && link.getAttribute('aria-current') === 'true')) {
        selectTourPanel(current);
    }
}, { passive: true });

const linkedPanel = tourPanels.find(panel => '#' + panel.id === location.hash);
if (linkedPanel) {
    requestAnimationFrame(() => {
        tourTrack.scrollLeft = linkedPanel.offsetLeft;
        selectTourPanel(linkedPanel);
    });
}
