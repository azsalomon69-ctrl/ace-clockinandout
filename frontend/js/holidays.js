window.addEventListener('ace:app-ready', () => {
    const year = document.getElementById('holidayYear');
    const status = document.getElementById('holidayStatus');
    const list = document.getElementById('holidayList');
    const retry = document.getElementById('holidayRetry');
    const next = document.querySelector('.holiday-next');
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Manila', dateStyle: 'short' }).format(new Date());
    const currentYear = Number(today.slice(0, 4));
    const dateLabel = new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', dateStyle: 'full' });
    const monthLabel = new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', month: 'long' });
    const cache = new Map();
    let requestId = 0;

    for (const value of [currentYear - 1, currentYear, currentYear + 1]) {
        year.add(new Option(String(value), String(value)));
    }
    year.value = String(currentYear);

    function render(rows, selectedYear) {
        const upcoming = selectedYear === String(currentYear) && rows.find(row => row.date >= today);
        if (upcoming) {
            next.querySelector('h2').textContent = upcoming.name;
            const time = next.querySelector('time');
            time.dateTime = upcoming.date;
            time.textContent = dateLabel.format(new Date(upcoming.date));
            next.hidden = false;
        }
        let month;
        let items;
        for (const holiday of rows) {
            const date = new Date(holiday.date);
            const key = holiday.date.slice(0, 7);
            if (month !== key) {
                month = key;
                const title = document.createElement('h3');
                title.textContent = monthLabel.format(date);
                items = document.createElement('ul');
                list.append(title, items);
            }
            const item = document.createElement('li');
            const name = document.createElement('strong');
            name.textContent = holiday.name;
            const time = document.createElement('time');
            time.dateTime = holiday.date;
            time.textContent = dateLabel.format(date);
            item.append(name, time);
            items.append(item);
        }
        status.textContent = rows.length ? '' : 'No nationwide holidays are available for this year.';
    }

    async function load() {
        const id = ++requestId;
        const selectedYear = year.value;
        next.hidden = true;
        retry.hidden = true;
        list.replaceChildren();
        status.textContent = 'Loading holidays…';
        try {
            if (!cache.has(selectedYear)) {
                const rows = await window.ACEAuth.request(`/v1/holidays/ph/${selectedYear}`);
                if (!Array.isArray(rows)) throw new Error('Unexpected holiday response');
                cache.set(selectedYear, rows.filter(row => row?.global === true && row.countryCode === 'PH'
                    && typeof row.name === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date)
                    && row.date.startsWith(selectedYear + '-') && Number.isFinite(Date.parse(row.date)))
                    .sort((a, b) => a.date.localeCompare(b.date)));
            }
            if (id === requestId) render(cache.get(selectedYear), selectedYear);
        } catch {
            if (id !== requestId) return;
            status.textContent = 'Holidays could not load. Check your connection and try again.';
            retry.hidden = false;
        }
    }

    year.addEventListener('change', load);
    retry.addEventListener('click', load);
    void load();
}, { once: true });
