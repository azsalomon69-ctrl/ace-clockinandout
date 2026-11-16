window.addEventListener('ace:app-ready', () => {
    const status = document.getElementById('holidayStatus');
    const list = document.getElementById('holidayList');
    const retry = document.getElementById('holidayRetry');
    const grid = document.getElementById('holidayGrid');
    const next = document.querySelector('.holiday-next');
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Manila', dateStyle: 'short' }).format(new Date());
    const currentMonth = new Date(today.slice(0, 7) + '-01');
    let month = currentMonth;
    const dateLabel = new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', dateStyle: 'full' });
    const monthLabel = new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', month: 'long', year: 'numeric' });
    const cache = new Map();
    let requestId = 0;

    function render(rows) {
        const key = month.toISOString().slice(0, 7);
        const holidays = rows.filter(row => row.date.startsWith(key));
        const upcoming = month.getTime() === currentMonth.getTime() && rows.find(row => row.date >= today);
        next.hidden = !upcoming;
        if (upcoming) {
            next.querySelector('h2').textContent = upcoming.name;
            const time = next.querySelector('time');
            time.dateTime = upcoming.date;
            time.textContent = dateLabel.format(new Date(upcoming.date));
        }

        const year = month.getUTCFullYear();
        const index = month.getUTCMonth();
        const offset = month.getUTCDay();
        const days = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
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
            for (const holiday of holidays.filter(item => item.date === date)) {
                const label = document.createElement('span');
                label.textContent = holiday.name;
                label.className = 'holiday-grid-label';
                tile.classList.add('holiday-grid-marked');
                tile.append(label);
            }
        }

        list.replaceChildren();
        if (holidays.length) {
            const summary = document.createElement('ul');
            for (const holiday of holidays) {
                const item = document.createElement('li');
                const name = document.createElement('strong');
                const time = document.createElement('time');
                name.textContent = holiday.name;
                time.dateTime = holiday.date;
                time.textContent = dateLabel.format(new Date(holiday.date));
                item.append(name, time);
                summary.append(item);
            }
            list.append(summary);
        }
        return holidays.length;
    }

    async function load() {
        const id = ++requestId;
        const year = String(month.getUTCFullYear());
        document.getElementById('holidayCalendarTitle').textContent = monthLabel.format(month);
        retry.hidden = true;
        render(cache.get(year) || []);
        status.textContent = 'Loading holidays…';
        try {
            if (!cache.has(year)) {
                const rows = await window.ACEAuth.request(`/v1/holidays/ph/${year}`);
                if (!Array.isArray(rows)) throw new Error('Unexpected holiday response');
                cache.set(year, rows.filter(row => row?.global === true && row.countryCode === 'PH'
                    && typeof row.name === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date)
                    && row.date.startsWith(year + '-') && Number.isFinite(Date.parse(row.date)))
                    .sort((a, b) => a.date.localeCompare(b.date)));
            }
            if (id === requestId) status.textContent = render(cache.get(year)) ? '' : 'No nationwide holidays listed this month.';
        } catch {
            if (id !== requestId) return;
            status.textContent = 'Holidays could not load. Check your connection and try again.';
            retry.hidden = false;
        }
    }

    function moveMonth(step) {
        month = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + step, 1));
        void load();
    }

    document.getElementById('holidayPrevious').addEventListener('click', () => moveMonth(-1));
    document.getElementById('holidayFollowing').addEventListener('click', () => moveMonth(1));
    document.getElementById('holidayToday').addEventListener('click', () => {
        month = currentMonth;
        void load();
    });
    retry.addEventListener('click', load);
    void load();
}, { once: true });
