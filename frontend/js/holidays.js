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

    for (const [value, label] of Object.entries(labels)) {
        filter.add(new Option(label, value));
        get('holidayEditorForm').elements.classification.add(new Option(label, value));
    }

    const kind = row => row.verification_status === 'pending' ? 'pending'
        : row.geographic_scope !== 'national' ? 'local' : row.classification;
    const matches = row => (!filter.value || row.classification === filter.value)
        && (!scope.value || (scope.value === 'national') === (row.geographic_scope === 'national'))
        && row.holiday_name.toLowerCase().includes(search.value.trim().toLowerCase());

    function text(tag, value) {
        const node = document.createElement(tag);
        node.textContent = value;
        return node;
    }

    function showDetails(date, rows) {
        get('holidayDetailsTitle').textContent = dateLabel.format(new Date(date));
        details.querySelector('ul').replaceChildren(...rows.map(row => {
            const item = document.createElement('li');
            item.append(text('strong', row.holiday_name), text('p', [
                labels[row.classification], row.location || 'Nationwide',
                row.verification_status === 'pending' ? 'Pending verification' : 'Verified'
            ].join(' · ')));
            if (row.description) item.append(text('p', row.description));
            if (row.source_url.startsWith('https://')) {
                const link = text('a', [row.source_name || 'Official source', row.proclamation_number].filter(Boolean).join(' · '));
                link.href = row.source_url;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                item.append(link);
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
            button.append(text('small', dateLabel.format(new Date(row.holiday_date)) + ' · ' + (row.location || labels[row.classification])));
            item.append(button);
            return item;
        }));
    }

    function render() {
        const key = month.toISOString().slice(0, 7);
        document.getElementById('holidayCalendarTitle').textContent = monthLabel.format(month);
        const year = month.getUTCFullYear();
        const index = month.getUTCMonth();
        const offset = month.getUTCDay();
        const days = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
        const filtered = records.filter(matches);
        const holidays = filtered.filter(row => row.holiday_date.startsWith(key));
        get('holidayAgendaTitle').textContent = `Holidays this month (${holidays.length})`;
        status.textContent = loadMessage || (holidays.length ? '' : 'No matching holidays this month.');
        const upcoming = filtered.filter(row => row.holiday_date >= today).slice(0, 5);
        agenda('holidayList', holidays);
        agenda('holidayUpcoming', upcoming);
        if (!upcoming.length) get('holidayUpcoming').append(text('li', 'No matching upcoming dates in this year.'));
        get('holidayPendingNote').hidden = year !== 2027 || records.filter(row => /^Eid/i.test(row.holiday_name) && row.verification_status === 'verified' && row.geographic_scope === 'national').length >= 2;
        if (isAdmin) renderAdmin(filtered);
        grid.replaceChildren();
        for (let cell = 0; cell < Math.ceil((days + offset) / 7) * 7; cell++) {
            const row = cell % 7 === 0 ? grid.insertRow() : grid.lastElementChild;
            const tile = row.insertCell();
            const day = cell - offset + 1;
            if (day < 1 || day > days) {
                tile.className = 'holiday-grid-empty';
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
                const button = text('button', entries[0].holiday_name + (entries.length > 1 ? ' +' + (entries.length - 1) : ''));
                button.type = 'button';
                button.className = 'holiday-grid-label';
                button.dataset.kind = kind(entries[0]);
                button.setAttribute('aria-label', dateLabel.format(new Date(date)) + ': ' + entries.map(row => row.holiday_name).join(', '));
                button.addEventListener('click', () => showDetails(date, entries));
                tile.append(button);
            }
        }
    }

    function moveMonth(step) {
        const next = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + step, 1));
        if (next.getUTCFullYear() < 2000 || next.getUTCFullYear() > 2099) return;
        month = next;
        void load();
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
        editor.showModal();
    }

    async function mutate(path, method, body, output, success) {
        if (managing) return false;
        managing = true;
        output.textContent = 'Saving changes…';
        try {
            await window.ACEAuth.request('/v1/holidays/ph' + path, { method, body: JSON.stringify(body) });
            await load(true);
            managementStatus.textContent = success;
            return true;
        } catch (error) {
            output.textContent = error.message || 'Changes could not be saved.';
            return false;
        } finally {
            managing = false;
        }
    }

    function renderAdmin(rows) {
        const list = get('holidayAdminList');
        list.replaceChildren(...rows.map(row => {
            const item = document.createElement('li');
            const title = text('span', row.holiday_name + ' · ' + row.holiday_date + ' · ' + (row.location || 'Nationwide'));
            const actions = document.createElement('div');
            const edit = text('button', 'Edit');
            const remove = text('button', 'Delete');
            actions.className = 'holiday-controls';
            for (const button of [edit, remove]) {
                button.type = 'button';
                button.className = 'btn btn-secondary';
                button.setAttribute('aria-label', button.textContent + ' ' + row.holiday_name);
            }
            edit.onclick = () => openEditor(row);
            remove.onclick = async () => {
                if (await window.ACEUI.confirm({ title: 'Delete holiday?', message: row.holiday_name + ' will be removed from the calendar.', confirmLabel: 'Delete' })) {
                    await mutate('/' + row.id, 'DELETE', undefined, managementStatus, 'Holiday deleted.');
                }
            };
            actions.append(edit, remove);
            item.append(title, actions);
            return item;
        }));
    }

    function initializeManagement() {
        get('holidayManagement').hidden = false;
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
            const rows = records.filter(matches).map(row => Object.fromEntries(fields.map(field => [field, row[field]])));
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
    if (isAdmin) initializeManagement();
    void load();
}, { once: true });
