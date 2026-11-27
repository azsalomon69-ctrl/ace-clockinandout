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
// Shared time picker. Original input types, form names, ISO values and validation stay authoritative.
(() => {
    const controls = new Map();
    let active = null, popup, serial = 0;
    const pad = value => String(value).padStart(2, '0');
    const format = value => {
        if (!value) return 'Select time';
        const [hour, minute] = value.split(':').map(Number);
        return `${pad(hour % 12 || 12)}:${pad(minute)} ${hour < 12 ? 'AM' : 'PM'}`;
    };
    const labelFor = input => (input.labels?.[0]?.textContent || input.closest('.form-group')?.querySelector('label')?.textContent || input.name || 'Time').trim();
    const clockIcon = '<img src="assets/icons/clock.svg" width="16" height="16" alt="">';
    function refresh(control) {
        const {input, trigger, date} = control;
        const value = input.value;
        control.time = value ? value.split('T').pop() : '';
        if (date) {
            date.value = value ? value.split('T')[0] : '';
            date.min = input.min.split('T')[0]; date.max = input.max.split('T')[0];
            date.disabled = input.disabled || input.readOnly;
            date.required = input.required;
            control.calendar?.refresh();
            if(date.nextElementSibling?.classList.contains('client-date-trigger')) date.nextElementSibling.disabled = input.disabled || input.readOnly;
        }
        trigger.firstElementChild.textContent = format(control.time);
        trigger.setAttribute('aria-label', control.label + ': ' + format(control.time));
        trigger.disabled = input.disabled || input.readOnly;
    }
    function close(restoreFocus = false) {
        if (!popup) return;
        if (popup.isConnected && popup.matches(':popover-open')) popup.hidePopover();
        if (active) { active.trigger.setAttribute('aria-expanded', 'false'); if (restoreFocus) active.trigger.focus(); }
    }
    function position() {
        if (!active || !popup.matches(':popover-open')) return;
        const rect = active.trigger.getBoundingClientRect();
        const width = Math.min(292, innerWidth - 24);
        popup.style.width = width + 'px';
        popup.style.maxHeight = Math.max(120, innerHeight - 24) + 'px';
        const height = Math.min(popup.scrollHeight, innerHeight - 24);
        popup.style.left = Math.max(12, Math.min(rect.left, innerWidth - width - 12)) + 'px';
        popup.style.top = (rect.bottom + height + 8 <= innerHeight - 12 ? rect.bottom + 8 : Math.max(12, rect.top - height - 8)) + 'px';
    }
    function setupPopup() {
        if (popup) return;
        popup = document.createElement('div');
        popup.id = 'aceTimePicker'; popup.className = 'ace-time-picker';
        popup.setAttribute('popover', 'auto'); popup.setAttribute('role', 'dialog');
        popup.setAttribute('aria-label', 'Choose time');
        popup.innerHTML = '<header><div><small data-time-label></small><strong data-time-preview></strong></div><button type="button" class="ace-time-close" aria-label="Close time picker"><img src="assets/icons/x.svg" width="16" height="16" alt=""></button></header><div class="ace-time-fields"><label>Hour<input type="number" inputmode="numeric" min="1" max="12" step="1" data-time-hour aria-label="Hour"></label><span aria-hidden="true">:</span><label>Minute<input type="number" inputmode="numeric" min="0" max="59" step="1" data-time-minute aria-label="Minute"></label><div class="ace-time-period" role="group" aria-label="AM or PM"><button type="button" data-time-period="AM">AM</button><button type="button" data-time-period="PM">PM</button></div></div><div class="ace-time-quick" role="group" aria-label="Quick minute selection"><span>Minutes</span><button type="button" data-time-quick="0">:00</button><button type="button" data-time-quick="15">:15</button><button type="button" data-time-quick="30">:30</button><button type="button" data-time-quick="45">:45</button></div><p class="ace-time-error" role="alert" hidden></p><footer><button type="button" data-time-clear>Clear</button><button type="button" data-time-apply>Done</button></footer>';
        popup.querySelector('.ace-time-close').onclick = () => close(true);
        popup.querySelector('[data-time-clear]').onclick = () => {
            if (!active || active.input.required) return;
            active.input.value = ''; refresh(active); emit(active.input); close(true);
        };
        popup.querySelector('[data-time-apply]').onclick = apply;
        popup.addEventListener('click', event => {
            const period = event.target.closest('[data-time-period]');
            if (period) popup.dataset.period = period.dataset.timePeriod;
            const minute = event.target.closest('[data-time-quick]');
            if (minute) popup.querySelector('[data-time-minute]').value = pad(minute.dataset.timeQuick);
            if (period || minute) preview();
        });
        popup.addEventListener('input', preview);
        popup.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
            if (event.key === 'Enter') { event.preventDefault(); apply(); }
        });
        popup.addEventListener('toggle', () => { if (active) active.trigger.setAttribute('aria-expanded', String(popup.matches(':popover-open'))); });
    }
    function selectedTime() {
        const hour = Number(popup.querySelector('[data-time-hour]').value);
        const minute = Number(popup.querySelector('[data-time-minute]').value);
        if (!Number.isInteger(hour) || hour < 1 || hour > 12 || !Number.isInteger(minute) || minute < 0 || minute > 59 || popup.querySelector('[data-time-minute]').value === '') return null;
        return pad(hour % 12 + (popup.dataset.period === 'PM' ? 12 : 0)) + ':' + pad(minute);
    }
    function preview() {
        const value = selectedTime();
        popup.querySelector('[data-time-preview]').textContent = value ? format(value) : 'Choose time';
        popup.querySelectorAll('[data-time-period]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.timePeriod === popup.dataset.period)));
        popup.querySelectorAll('[data-time-quick]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.timeQuick) === Number(popup.querySelector('[data-time-minute]').value))));
        popup.querySelector('.ace-time-error').hidden = true;
    }
    function emit(input) { input.dispatchEvent(new Event('input', {bubbles:true})); input.dispatchEvent(new Event('change', {bubbles:true})); }
    function apply() {
        if (!active?.input.isConnected) return close();
        const value = selectedTime(), error = popup.querySelector('.ace-time-error');
        const fail = message => { error.textContent = message; error.hidden = false; position(); };
        if (!value) return fail('Enter an hour from 1 to 12 and minutes from 00 to 59.');
        if (active.date && !active.date.value) return fail('Choose a date before setting the time.');
        const previous = active.input.value;
        active.input.value = active.date ? active.date.value + 'T' + value : value;
        if (!active.input.validity.valid) {
            const message = active.input.validationMessage;
            active.input.value = previous;
            return fail(message || 'Choose a time within the allowed range.');
        }
        refresh(active); emit(active.input); close(true);
    }
    function open(control) {
        setupPopup(); close(); active = control; refresh(control);
        const host = control.input.closest('dialog') || document.body;
        host.appendChild(popup);
        const value = control.time || '09:00', [hour, minute] = value.split(':').map(Number);
        popup.querySelector('[data-time-label]').textContent = control.label;
        popup.querySelector('[data-time-hour]').value = pad(hour % 12 || 12);
        popup.querySelector('[data-time-minute]').value = pad(minute);
        popup.dataset.period = hour < 12 ? 'AM' : 'PM';
        popup.querySelector('[data-time-clear]').hidden = control.input.required;
        preview(); popup.showPopover(); control.trigger.setAttribute('aria-expanded', 'true'); position();
        const field = popup.querySelector('[data-time-hour]'); field.focus(); field.select();
    }
    function mount(input) {
        if (controls.has(input)) return;
        const control = {input, label:labelFor(input)};
        const trigger = document.createElement('button');
        trigger.type = 'button'; trigger.className = 'ace-time-trigger';
        trigger.innerHTML = '<span></span>' + clockIcon;
        trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-controls', 'aceTimePicker'); trigger.setAttribute('aria-expanded', 'false');
        control.trigger = trigger;
        input.classList.add('ace-time-native'); input.tabIndex = -1; input.setAttribute('aria-hidden','true');
        if (input.type === 'datetime-local') {
            const group = document.createElement('div'); group.className = 'ace-datetime-control';
            const date = document.createElement('input'); date.type = 'date'; date.className = 'form-input';
            date.id = 'aceTimeDate-' + ++serial; date.dataset.calendarLabel = control.label + ' date';
            date.setAttribute('aria-label', control.label + ' date');
            control.date = date; group.append(date, trigger); input.after(group);
            date.addEventListener('invalid', event => {event.preventDefault();(date.nextElementSibling?.classList.contains('client-date-trigger')?date.nextElementSibling:date).focus();});
            date.addEventListener('change', () => {
                const time = control.time || '09:00';
                input.value = date.value ? date.value + 'T' + time : '';
                refresh(control); emit(input);
            });
        } else input.after(trigger);
        controls.set(input, control); refresh(control);
        trigger.onclick = () => active === control && popup?.matches(':popover-open') ? close(true) : open(control);
        input.addEventListener('change', () => refresh(control));
        input.addEventListener('focus', () => (control.date?.nextElementSibling?.classList.contains('client-date-trigger') ? control.date.nextElementSibling : trigger).focus());
        input.addEventListener('invalid', event => { event.preventDefault(); if (control.date && !control.date.value) { (control.date.nextElementSibling?.classList.contains('client-date-trigger') ? control.date.nextElementSibling : control.date).focus(); } else open(control); });
    }
    function init(root = document) {
        root.querySelectorAll?.('input[type="time"],input[type="datetime-local"]').forEach(mount);
        for (const [input, control] of controls) {
            if (!input.isConnected) { if (active === control) { close(); active = null; popup?.remove(); } controls.delete(input); continue; }
            if (control.date && !control.calendar && window.ACECalendar) control.calendar = window.ACECalendar.mount(control.date);
        }
    }
    function boot() {
        init();
        new MutationObserver(records => {
            for (const record of records) {
                if (record.type === 'attributes' && controls.has(record.target)) refresh(controls.get(record.target));
                for (const node of record.addedNodes) if (node instanceof Element) { if (node.matches('input[type="time"],input[type="datetime-local"]')) mount(node); init(node); }
            }
            for (const [input, control] of controls) if (!input.isConnected) { if (active === control) { close(); active = null; popup?.remove(); } controls.delete(input); }
        }).observe(document.body, {subtree:true,childList:true,attributes:true,attributeFilter:['disabled','readonly','min','max','required','value']});
        document.addEventListener('reset', () => setTimeout(() => controls.forEach(refresh), 0), true);
        document.addEventListener('close', event => { if(active && event.target.contains?.(active.input)) close(); }, true);
        window.addEventListener('resize', position);
        document.addEventListener('scroll', event => { if (!popup?.contains(event.target)) position(); }, true);
    }
    window.ACETimeControls = {init, close, format};
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true}); else boot();
})();
