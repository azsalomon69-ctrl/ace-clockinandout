// Shared ACE select presentation. Native values and change events remain authoritative.
(() => {
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let selectSequence = 0;
let aceSelectObserver;
function closeAceSelectMenus(except = null) {
    document.querySelectorAll('.ace-select.is-open').forEach(control => {
        if (control === except) return;
        control.classList.remove('is-open');
        control.querySelector('.ace-select-trigger')?.setAttribute('aria-expanded', 'false');
        const menu = control._aceSelectMenu;
        menu?.classList.remove('is-open');
        const placeholder = control._aceSelectMenuPlaceholder;
        if (menu && placeholder?.parentNode) placeholder.replaceWith(menu);
        control._aceSelectMenuPlaceholder = null;
        menu?.removeAttribute('style');
    });
}

function positionAceSelectMenu(control) {
    const trigger = control?.querySelector('.ace-select-trigger');
    const menu = control?._aceSelectMenu;
    if (!trigger || !menu || !control.classList.contains('is-open')) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 7;
    const edge = 8;
    const width = Math.min(Math.max(rect.width, 240), window.innerWidth - edge * 2);
    const left = Math.max(edge, Math.min(rect.left, window.innerWidth - width - edge));
    const below = Math.max(0, window.innerHeight - rect.bottom - edge - gap);
    const above = Math.max(0, rect.top - edge - gap);
    const openAbove = below < Math.min(320, menu.scrollHeight) && above > below;
    const available = openAbove ? above : below;
    const maxHeight = Math.max(80, Math.min(320, available));
    menu.style.left = `${left}px`;
    menu.style.width = `${width}px`;
    menu.style.maxHeight = `${maxHeight}px`;
    const requestedTop = openAbove ? rect.top - Math.min(menu.scrollHeight, maxHeight) - gap : rect.bottom + gap;
    menu.style.top = `${Math.max(edge, Math.min(requestedTop, window.innerHeight - maxHeight - edge))}px`;
}

function positionOpenAceSelectMenus() {
    document.querySelectorAll('.ace-select.is-open').forEach(positionAceSelectMenu);
}

function enhanceSelectControl(select) {
    if (!(select instanceof HTMLSelectElement) || !select.classList.contains('form-select')) return;
    if (select.classList.contains('ace-native-select')) {
        select._aceSelectRefresh?.();
        return;
    }
    const control = document.createElement('div');
    control.className = 'ace-select';
    const trigger = document.createElement('button');
    trigger.className = 'ace-select-trigger';
    trigger.type = 'button';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    const menu = document.createElement('div');
    menu.className = 'ace-select-menu';
    const search = document.createElement('input');
    search.type = 'search'; search.className = 'form-input ace-select-search'; search.placeholder = 'Type to search…';
    search.autocomplete = 'off'; search.setAttribute('aria-label','Search options');
    const optionsList = document.createElement('div'); optionsList.setAttribute('role','listbox');
    optionsList.id = 'ace-select-options-' + (++selectSequence);
    search.setAttribute('role','combobox'); search.setAttribute('aria-autocomplete','list'); search.setAttribute('aria-controls',optionsList.id); search.setAttribute('aria-expanded','true');
    const empty = document.createElement('p'); empty.className = 'ace-select-empty'; empty.textContent = 'No matches'; empty.hidden = true;
    menu.append(search,optionsList,empty);
    const filterOptions = () => {
        const query = search.value.trim().toLocaleLowerCase(); let visible = 0;
        optionsList.querySelectorAll('.ace-select-option').forEach(button => { button.hidden = !button.textContent.toLocaleLowerCase().includes(query); if (!button.hidden) visible++; });
        empty.hidden = visible > 0;
    };
    search.addEventListener('input',filterOptions);
    menu.addEventListener('keydown',event => {
        const choices = [...optionsList.querySelectorAll('.ace-select-option:not(:disabled)')].filter(button => !button.hidden);
        if (event.key === 'Escape') { event.preventDefault(); closeAceSelectMenus(); trigger.focus(); }
        if (event.key === 'Tab') closeAceSelectMenus();
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); const index = choices.indexOf(document.activeElement);
            choices[index < 0 ? (event.key === 'ArrowDown' ? 0 : choices.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length]?.focus();
        }
        if (event.key === 'Enter' && event.target === search) { event.preventDefault(); choices[0]?.click(); }
    });
    control._aceSelectMenu = menu;
    select.classList.add('ace-native-select');
    select.insertAdjacentElement('afterend', control);
    control.append(trigger, menu);

    const label = select.closest('label') || (select.id ? document.querySelector(`label[for="${CSS.escape(select.id)}"]`) : null);
    const refresh = () => {
        const selected = select.options[select.selectedIndex];
        trigger.innerHTML = `<span>${escapeHtml(selected?.textContent || 'Select an option')}</span><i aria-hidden="true"></i>`;
        trigger.disabled = select.disabled;
        const labelText = select.getAttribute('aria-label') || label?.childNodes?.[0]?.textContent?.trim() || 'Select an option';
        trigger.setAttribute('aria-label', labelText);
        optionsList.innerHTML = Array.from(select.options).map((option, index) => `<button class="ace-select-option${option.selected ? ' is-selected' : ''}" type="button" role="option" aria-selected="${option.selected}" data-index="${index}"${option.disabled ? ' disabled' : ''}>${escapeHtml(option.textContent)}</button>`).join('');
        filterOptions();
        menu.querySelectorAll('.ace-select-option').forEach(optionButton => optionButton.addEventListener('click', () => {
            const option = select.options[Number(optionButton.dataset.index)];
            if (!option || option.disabled) return;
            select.selectedIndex = Number(optionButton.dataset.index);
            select.dispatchEvent(new Event('change', { bubbles: true }));
            closeAceSelectMenus();
            trigger.focus();
        }));
    };
    select._aceSelectRefresh = refresh;
    refresh();
    select.addEventListener('change', refresh);
    trigger.addEventListener('click', () => {
        if (trigger.disabled) return;
        const opening = !control.classList.contains('is-open');
        closeAceSelectMenus(opening ? control : null);
        if (!opening) return;
        control.classList.add('is-open');
        menu.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
        const placeholder = document.createComment('select menu position');
        menu.before(placeholder);
        control._aceSelectMenuPlaceholder = placeholder;
        document.body.append(menu);
        positionAceSelectMenu(control);
        search.value = ''; filterOptions(); search.focus();
    });
    trigger.addEventListener('keydown', event => {
        if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); if (!control.classList.contains('is-open')) trigger.click(); search.value = event.key; filterOptions(); search.focus(); }
        if (event.key === 'Escape') { closeAceSelectMenus(); trigger.focus(); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (!control.classList.contains('is-open')) trigger.click();
        }
    });
}

function initializeSelectControls(root = document) {
    root.querySelectorAll?.('select.form-select:not(.ace-native-select)').forEach(enhanceSelectControl);
    if (aceSelectObserver) return;
    document.addEventListener('pointerdown', event => { if (!event.target.closest('.ace-select,.ace-select-menu')) closeAceSelectMenus(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeAceSelectMenus(); });
    window.addEventListener('resize', positionOpenAceSelectMenus);
    document.addEventListener('scroll', positionOpenAceSelectMenus, true);
    aceSelectObserver = new MutationObserver(records => records.forEach(record => {
        if ((record.type === 'childList' || record.type === 'attributes') && record.target instanceof HTMLSelectElement && record.target.classList.contains('ace-native-select')) record.target._aceSelectRefresh?.();
        record.addedNodes.forEach(node => {
            if (!(node instanceof Element)) return;
            if (node.matches?.('select.form-select:not(.ace-native-select)')) enhanceSelectControl(node);
            node.querySelectorAll?.('select.form-select:not(.ace-native-select)').forEach(enhanceSelectControl);
        });
    }));
    aceSelectObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
}

window.ACESelectControls = { init: initializeSelectControls, close: closeAceSelectMenus };
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>initializeSelectControls());else initializeSelectControls();
})();
