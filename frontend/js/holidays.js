window.addEventListener('ace:app-ready', () => {
    const grid = document.getElementById('holidayGrid');
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Manila', dateStyle: 'short' }).format(new Date());
    const currentMonth = new Date(today.slice(0, 7) + '-01');
    let month = currentMonth;
    const monthLabel = new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', month: 'long', year: 'numeric' });
    const dateLabel = new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', dateStyle: 'full' });
    const get = id => document.getElementById(id);
    const labels = { regular: 'Regular holiday', special_non_working: 'Special non-working', special_working: 'Special working', other_non_working: 'Other non-working' };
    const yearInput = get('holidayYear');
    const filter = get('holidayClassification');
    const scope = get('holidayScope');
    const search = get('holidaySearch');
    const details = get('holidayDetails');
    const status = get('holidayStatus');
    const isAdmin = window.AppState.currentUser?.Role === 'ADMIN';
    let records = [];
    let loadedYear;
    let request = 0;
    let loadMessage = '';
    let yearly = false;
    let management = false;
    const selection = new Set();
    const verification = get('holidayVerification');
    const dayDistance = date => Math.round((Date.parse(date) - Date.parse(today)) / 86400000);
    const countdown = date => dayDistance(date) === 0 ? 'Today' : `In ${dayDistance(date)} ${dayDistance(date) === 1 ? 'day' : 'days'}`;

    for (const [value, label] of Object.entries(labels)) {
        filter.add(new Option(label, value));
        get('holidayEditorForm').elements.classification.add(new Option(label, value));
    }

    const kind = row => row.verification_status === 'pending' ? 'pending'
        : row.geographic_scope !== 'national' ? 'local' : row.classification;
    const matches = row => (!filter.value || row.classification === filter.value)
        && (!scope.value || (scope.value === 'national') === (row.geographic_scope === 'national'))
        && row.holiday_name.toLowerCase().includes(search.value.trim().toLowerCase());
    const appliesToOffice = row => {
        const location = row.location.trim().toLowerCase();
        return row.geographic_scope === 'national'
            || row.geographic_scope === 'city' && location === 'santa rosa, laguna'
            || row.geographic_scope === 'province' && location === 'laguna';
    };

    function text(tag, value) {
        const node = document.createElement(tag);
        node.textContent = value;
        return node;
    }

    function badge(label, tone) {
        const node = text('span', label);
        node.className = 'holiday-badge';
        node.dataset.kind = tone;
        return node;
    }

    function showDetails(date, rows) {
        get('holidayDetailsTitle').textContent = dateLabel.format(new Date(date));
        details.querySelector('ul').replaceChildren(...rows.map(row => {
            const item = document.createElement('li');
            item.append(text('h3', row.holiday_name), badge(labels[row.classification], row.classification),
                text('p', (row.location || 'Nationwide') + ' · ' + (row.archived_at ? 'Archived' : row.verification_status === 'pending' ? 'Pending verification' : 'Verified')));
            if (row.description) item.append(text('p', row.description));
            if (row.source_url.startsWith('https://')) {
                const link = text('a', [row.source_name || 'Official source', row.proclamation_number].filter(Boolean).join(' · '));
                link.href = row.source_url;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                item.append(link);
            }
            if (isAdmin) {
                item.append(text('small', 'Added ' + dateLabel.format(new Date(row.created_at)) + ' · Updated ' + dateLabel.format(new Date(row.updated_at))));
                item.append(actionButton('Edit', row, () => { details.close(); openEditor(row); }),
                    actionButton(row.archived_at ? 'Restore' : 'Archive', row, () => {
                        details.close();
                        void bulk(row.archived_at ? 'restore' : 'archive', [row.id]);
                    }));
            }
            return item;
        }));
        details.showModal();
    }

    function agenda(id, rows) {
        get(id).replaceChildren(...rows.map(row => {
            const item = document.createElement('li');
            const button = text('button', row.holiday_name);
            button.type = 'button';
            button.dataset.kind = kind(row);
            button.addEventListener('click', () => showDetails(row.holiday_date, [row]));
            button.append(badge(labels[row.classification], row.classification),
                text('small', dateLabel.format(new Date(row.holiday_date)) + (row.location ? ' · ' + row.location : '')));
            if (id === 'holidayUpcoming') button.append(text('small', countdown(row.holiday_date)));
            item.append(button);
            return item;
        }));
    }

    function render() {
        const key = month.toISOString().slice(0, 7);
        get('holidayCalendarTitle').textContent = yearly ? String(month.getUTCFullYear()) : monthLabel.format(month);
        const year = month.getUTCFullYear();
        const index = month.getUTCMonth();
        const offset = month.getUTCDay();
        const days = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
        const matching = records.filter(matches);
        const filtered = matching.filter(row => !row.archived_at && appliesToOffice(row));
        const adminRows = matching.filter(row => verification.value === 'archived' ? row.archived_at
            : !row.archived_at && (!verification.value || row.verification_status === verification.value));
        const holidays = filtered.filter(row => row.holiday_date.startsWith(key));
        get('holidayAgendaTitle').textContent = `Holidays this month (${holidays.length})`;
        status.textContent = loadMessage || holidays.length ? '' : 'No matching holidays this month.';
        const upcoming = filtered.filter(row => row.holiday_date >= today).slice(0, 5);
        agenda('holidayList', holidays);
        agenda('holidayUpcoming', upcoming);
        if (!upcoming.length && !loadMessage) get('holidayUpcoming').append(text('li', 'No matching upcoming dates in this year.'));
        renderStats(management ? adminRows : filtered, management ? null : upcoming[0]);
        get('holidayLoadStatus').textContent = loadMessage;
        get('holidayStats').classList.toggle('is-loading', loadMessage === 'Loading holiday dates…');
        if (management) { renderAdmin(adminRows); return; }
        grid.closest('table').hidden = yearly;
        get('holidayYearGrid').hidden = !yearly;
        if (yearly) {
            get('holidayYearGrid').replaceChildren(...Array.from({ length: 12 }, (_, i) => {
                const start = new Date(Date.UTC(year, i, 1));
                const prefix = start.toISOString().slice(0, 7);
                const dates = filtered.filter(row => row.holiday_date.startsWith(prefix));
                const count = dates.length;
                const button = text('button', new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', month: 'long' }).format(start));
                button.type = 'button';
                button.append(text('small', `${count} ${count === 1 ? 'holiday' : 'holidays'}`));
                const mini = document.createElement('span');
                mini.className = 'holiday-mini-grid';
                mini.setAttribute('aria-hidden', 'true');
                for (let day = 1 - start.getUTCDay(); day <= new Date(Date.UTC(year, i + 1, 0)).getUTCDate(); day++) {
                    const cell = text('span', day > 0 ? day : '');
                    const marker = dates.find(row => Number(row.holiday_date.slice(-2)) === day);
                    if (marker) cell.dataset.kind = kind(marker);
                    mini.append(cell);
                }
                button.append(mini);
                button.onclick = () => { month = start; setYearView(false); };
                return button;
            }));
            return;
        }
        grid.replaceChildren();
        for (let cell = 0; cell < Math.ceil((days + offset) / 7) * 7; cell++) {
            const row = cell % 7 === 0 ? grid.insertRow() : grid.lastElementChild;
            const tile = row.insertCell();
            const day = cell - offset + 1;
            if (day < 1 || day > days) {
                tile.className = 'holiday-grid-empty';
                tile.append(text('span', new Date(Date.UTC(year, index, day)).getUTCDate()));
                continue;
            }
            const date = key + '-' + String(day).padStart(2, '0');
            const number = document.createElement('time');
            number.dateTime = date;
            number.textContent = day;
            if (date === today) number.setAttribute('aria-current', 'date');
            tile.append(number);
            const entries = holidays.filter(entry => entry.holiday_date === date);
            if (entries.length) {
                tile.classList.add('holiday-grid-marked');
                const button = text('button', entries[0].holiday_name);
                button.append(text('small', entries.length > 1 ? '+' + (entries.length - 1) + ' more'
                    : entries[0].verification_status === 'pending' ? 'Pending' : entries[0].location ? 'Local' : labels[entries[0].classification]));
                button.type = 'button';
                button.className = 'holiday-grid-label';
                button.dataset.kind = kind(entries[0]);
                button.setAttribute('aria-label', dateLabel.format(new Date(date)) + ': ' + entries.map(row => row.holiday_name).join(', '));
                button.addEventListener('click', () => {
                    tile.classList.add('is-selected');
                    details.addEventListener('close', () => tile.classList.remove('is-selected'), { once: true });
                    showDetails(date, entries);
                });
                tile.append(button);
            }
        }
    }

    function moveMonth(step) {
        const next = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + step * (yearly ? 12 : 1), 1));
        if (next.getUTCFullYear() < 2000 || next.getUTCFullYear() > 2099) return;
        month = next;
        void load();
    }

    function setYearView(value) {
        yearly = value;
        const control = get('holidayView');
        control.textContent = yearly ? 'Month view' : 'Year view';
        control.setAttribute('aria-pressed', String(yearly));
        get('holidayPrevious').setAttribute('aria-label', yearly ? 'Previous year' : 'Previous month');
        get('holidayFollowing').setAttribute('aria-label', yearly ? 'Next year' : 'Next month');
        render();
    }

    function renderStats(rows, upcoming) {
        const stats = [['Total holidays', rows.length, '']];
        for (const key of ['regular', 'special_non_working', 'special_working']) {
            stats.push([labels[key], rows.filter(row => row.classification === key).length, key]);
        }
        if (management) {
            stats.push(['Local holidays', rows.filter(row => row.geographic_scope !== 'national').length, 'local']);
            stats.push(['Pending verification', rows.filter(row => row.verification_status === 'pending').length, 'pending']);
        } else if (upcoming) stats.push(['Next holiday · ' + countdown(upcoming.holiday_date), upcoming.holiday_name, kind(upcoming)]);
        get('holidayStats').replaceChildren(...stats.map(([label, count, tone]) => {
            const item = document.createElement('div');
            item.dataset.kind = tone;
            item.append(text('dt', label), text('dd', loadMessage ? '—' : count));
            return item;
        }));
    }

    async function load(force = false) {
        const id = ++request;
        const year = month.getUTCFullYear();
        yearInput.value = year;
        if (!force && year === loadedYear) return render();
        records = [];
        loadedYear = undefined;
        loadMessage = 'Loading holiday dates…';
        render();
        try {
            const rows = await window.ACEAuth.request('/v1/holidays/ph/' + year);
            if (id !== request) return;
            records = rows;
            loadedYear = year;
            loadMessage = '';
        } catch {
            if (id !== request) return;
            loadMessage = 'Holiday dates are temporarily unavailable.';
        }
        render();
    }

    const editor = get('holidayEditor');
    const form = get('holidayEditorForm');
    const managementStatus = get('holidayManagementStatus');
    let editing;
    let managing = false;
    const fields = [...form.elements].filter(control => control.name).map(control => control.name);

    function openEditor(row) {
        editing = row?.id;
        form.reset();
        form.elements.holiday_date.value = month.toISOString().slice(0, 10);
        for (const field of fields) {
            if (row) form.elements[field].value = row[field];
        }
        get('holidayEditorStatus').textContent = '';
        updateLocation();
        editor.showModal();
    }

    async function mutate(path, method, body, output, success) {
        if (managing) return false;
        managing = true;
        output.textContent = 'Saving changes…';
        try {
            await window.ACEAuth.request('/v1/holidays/ph' + path, { method, body: JSON.stringify(body) });
            selection.clear();
            await load(true);
            managementStatus.textContent = success;
            showToast(success, 'success');
            return true;
        } catch (error) {
            output.textContent = error.message || 'Changes could not be saved.';
            return false;
        } finally {
            managing = false;
        }
    }

    let visibleRows = [];

    function actionButton(label, row, click) {
        const button = text('button', label);
        button.type = 'button';
        button.className = 'btn btn-secondary';
        button.setAttribute('aria-label', label + ' ' + row.holiday_name);
        button.onclick = click;
        return button;
    }

    async function bulk(action, ids) {
        if (!ids.length) return;
        const verb = action[0].toUpperCase() + action.slice(1);
        if (!await window.ACEUI.confirm({
            title: verb + ' holidays?',
            message: action === 'verify' ? 'Each pending record needs an official source.'
                : ids.length + ' records will be ' + (action === 'archive' ? 'hidden from' : 'returned to') + ' the calendar.',
            confirmLabel: verb
        })) return;
        await mutate('/bulk', 'POST', { action, ids }, managementStatus, 'Holiday records updated.');
    }

    function updateSelection() {
        const all = get('holidaySelectAll');
        all.checked = visibleRows.length > 0 && visibleRows.every(row => selection.has(row.id));
        all.indeterminate = !all.checked && selection.size > 0;
        all.disabled = !visibleRows.length;
        get('holidayBulk').hidden = !selection.size;
        get('holidaySelectedCount').textContent = selection.size + ' selected';
        get('holidayExport').textContent = selection.size ? 'Export selected' : 'Export Excel';
        for (const button of get('holidayBulk').querySelectorAll('button')) {
            button.hidden = verification.value === 'archived'
                ? button.dataset.holidayBulk !== 'restore' : button.dataset.holidayBulk === 'restore';
        }
    }

    function renderAdmin(rows) {
        visibleRows = get('holidaySort').value === 'name'
            ? [...rows].sort((a, b) => a.holiday_name.localeCompare(b.holiday_name)) : rows;
        const visibleIds = new Set(rows.map(row => row.id));
        for (const id of selection) if (!visibleIds.has(id)) selection.delete(id);
        get('holidayAdminEmpty').textContent = !loadMessage && !rows.length ? 'No holiday records match these filters.' : '';
        get('holidayAdminList').replaceChildren(...visibleRows.map(row => {
            const item = document.createElement('tr');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = selection.has(row.id);
            checkbox.setAttribute('aria-label', 'Select ' + row.holiday_name);
            checkbox.onchange = () => {
                if (checkbox.checked) selection.add(row.id);
                else selection.delete(row.id);
                updateSelection();
            };
            item.insertCell().append(checkbox);
            item.insertCell().textContent = dateLabel.format(new Date(row.holiday_date));
            const title = item.insertCell();
            title.append(text('strong', row.holiday_name));
            if (row.description) title.append(text('small', row.description));
            item.insertCell().append(badge(labels[row.classification], row.classification));
            item.insertCell().textContent = row.location || 'Nationwide';
            item.insertCell().append(badge(row.archived_at ? 'Archived' : row.verification_status === 'pending' ? 'Pending' : 'Verified',
                row.archived_at || row.verification_status === 'pending' ? 'pending' : 'verified'));
            const source = item.insertCell();
            if (row.source_url.startsWith('https://')) {
                const link = text('a', row.proclamation_number || row.source_name || 'Official source');
                link.href = row.source_url;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                source.append(link);
            } else source.textContent = '—';
            const actions = document.createElement('div');
            actions.className = 'holiday-controls';
            actions.append(actionButton('View', row, () => showDetails(row.holiday_date, [row])),
                actionButton('Edit', row, () => openEditor(row)), actionButton('Delete', row, async () => {
                    if (await window.ACEUI.confirm({ title: 'Delete holiday permanently?', message: row.holiday_name + ' cannot be recovered after deletion.', confirmLabel: 'Delete', danger: true })) {
                        await mutate('/' + row.id, 'DELETE', undefined, managementStatus, 'Holiday deleted.');
                    }
                }));
            item.insertCell().append(actions);
            [...item.cells].forEach((cell, index) => {
                cell.dataset.label = ['', 'Date', 'Holiday', 'Classification', 'Coverage', 'Verification', 'Source', 'Actions'][index];
            });
            return item;
        }));
        updateSelection();
    }

    function updateLocation() {
        const scope = form.elements.geographic_scope;
        const local = scope.value !== 'national';
        const label = get('holidayLocationField');
        label.hidden = !local;
        label.querySelector('span').textContent = scope.selectedOptions[0].textContent + ' (required)';
        form.elements.location.required = local;
        form.elements.location.disabled = !local;
        const verified = form.elements.verification_status.value === 'verified';
        form.elements.source_name.required = verified;
        form.elements.source_url.required = verified;
    }

    function initializeManagement() {
        get('holidayTabs').hidden = false;
        function showManagement(value) {
            management = value;
            get('holidayManagement').hidden = !value;
            get('holidayBrowsePanel').hidden = value;
            get('holidayVerificationField').hidden = !value;
            get('holidayScopeField').hidden = !value;
            scope.value = '';
            get('holidayManage').setAttribute('aria-pressed', String(value));
            get('holidayBrowse').setAttribute('aria-pressed', String(!value));
            get('holidayPageTitle').textContent = value ? 'Manage Holidays' : 'Santa Rosa Holiday Calendar';
            render();
        }
        get('holidayBrowse').onclick = () => showManagement(false);
        get('holidayManage').onclick = () => showManagement(true);
        get('holidaySort').onchange = render;
        verification.onchange = render;
        get('holidayImportButton').onclick = () => get('holidayImport').click();
        get('holidaySelectAll').onchange = event => {
            selection.clear();
            if (event.target.checked) for (const row of visibleRows) selection.add(row.id);
            renderAdmin(visibleRows);
        };
        for (const button of get('holidayBulk').querySelectorAll('button')) {
            button.onclick = () => bulk(button.dataset.holidayBulk, [...selection]);
        }
        form.elements.geographic_scope.onchange = updateLocation;
        form.elements.verification_status.onchange = updateLocation;
        get('holidayAdd').onclick = () => openEditor();
        get('holidayCancel').onclick = () => editor.close();
        form.addEventListener('submit', async event => {
            event.preventDefault();
            const values = Object.fromEntries(new FormData(form));
            if (await mutate(editing ? '/' + editing : '', editing ? 'PATCH' : 'POST', values,
                get('holidayEditorStatus'), 'Holiday saved.')) editor.close();
        });
        get('holidayExport').onclick = () => {
            if (!window.XLSX) { managementStatus.textContent = 'The spreadsheet tools are unavailable.'; return; }
            const rows = visibleRows.filter(row => !selection.size || selection.has(row.id)).map(row => Object.fromEntries(fields.map(field => [field, row[field]])));
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows, { header: fields }), 'Holidays');
            XLSX.writeFile(workbook, 'ace-holidays-' + month.getUTCFullYear() + '.xlsx');
        };
        get('holidayImport').addEventListener('change', async event => {
            const file = event.target.files[0];
            event.target.value = '';
            if (!file) return;
            try {
                if (!window.XLSX || file.size > 2 * 1024 * 1024) throw new Error('Choose a CSV or Excel file under 2 MB.');
                const workbook = XLSX.read(await file.arrayBuffer(), { raw: true });
                const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
                if (!rows.length || rows.length > 200) throw new Error('Import between 1 and 200 rows using the export column names.');
                const values = rows.map(row => Object.fromEntries(fields.map(field => {
                    const value = row[field];
                    if (field === 'holiday_date' && typeof value === 'number') {
                        return [field, XLSX.SSF.format('yyyy-mm-dd', value, { date1904: !!workbook.Workbook?.WBProps?.date1904 })];
                    }
                    return [field, String(value ?? '')];
                })));
                if (await window.ACEUI.confirm({ title: 'Import holidays?', message: `Add ${rows.length} records from this spreadsheet?`, confirmLabel: 'Import' })) {
                    await mutate('', 'POST', values, managementStatus, 'Holiday records imported.');
                }
            } catch (error) {
                managementStatus.textContent = error.message || 'The spreadsheet could not be read.';
            }
        });
    }

    document.getElementById('holidayPrevious').addEventListener('click', () => moveMonth(-1));
    document.getElementById('holidayFollowing').addEventListener('click', () => moveMonth(1));
    document.getElementById('holidayToday').addEventListener('click', () => {
        month = currentMonth;
        void load();
    });
    yearInput.addEventListener('change', () => {
        if (!yearInput.value || !yearInput.checkValidity()) return;
        month = new Date(Date.UTC(Number(yearInput.value), month.getUTCMonth(), 1));
        void load();
    });
    filter.addEventListener('change', render);
    scope.addEventListener('change', render);
    search.addEventListener('input', render);
    const filterToggle = get('holidayFilterToggle');
    filterToggle.addEventListener('click', () => {
        const expanded = filterToggle.getAttribute('aria-expanded') === 'true';
        filterToggle.setAttribute('aria-expanded', String(!expanded));
    });
    get('holidayView').onclick = () => setYearView(!yearly);
    get('holidayReset').onclick = () => {
        for (const control of [filter, scope, verification, search]) control.value = '';
        month = currentMonth;
        void load();
    };
    if (isAdmin) initializeManagement();
    void load();
}, { once: true });
