// Строка «продолжить просмотр» под плитками главной: последнее, что смотрели
// в ktw, и при наведении — ещё несколько прошлых просмотров. Клик продолжает
// просмотр в ktw с той же серии и секунды.

(function () {
    const root = document.createElement('div');
    root.className = 'cw';
    root.hidden = true;

    // Сразу после плиток: CSS проявляет строку при наведении на них
    const tiles = document.querySelector('.container');
    if (tiles) tiles.after(root);
    else document.body.append(root);

    const status = document.createElement('div');
    status.className = 'cw-status';

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function clock(seconds) {
        const total = Math.max(0, Math.floor(seconds || 0));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        const mm = h ? String(m).padStart(2, '0') : String(m);
        return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
    }

    // «С2:Э4», «1:02:10 из 2:35:00» или «досмотрен ✓»
    function describe(item) {
        if (item.serial && item.season && item.episode) return `С${item.season}:Э${item.episode}`;
        if (item.finished) return 'досмотрен ✓';
        if (item.duration) return `${clock(item.timePos)} из ${clock(item.duration)}`;
        return '';
    }

    function progressLine(item) {
        const line = el('span', 'cw-line');
        const fill = el('i');
        fill.style.width = Math.max(2, Math.min(100, item.finished ? 100 : item.percentage || 0)) + '%';
        line.append(fill);
        return line;
    }

    async function play(item) {
        status.textContent = `Открываю «${item.title}» в ktw…`;
        const body = { kpId: item.kpId, resume: !item.finished };
        if (item.serial && item.season && item.episode) {
            body.season = item.season;
            body.episode = item.episode;
        }
        try {
            const res = await fetch('/api/ktw/watch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error || 'Не удалось запустить ktw');
        } catch (error) {
            status.textContent = error.message;
        }
        setTimeout(() => { status.textContent = ''; }, 4000);
    }

    function row(item, main) {
        const link = el('a', 'cw-row');
        link.href = '#';
        link.title = item.finished ? 'Смотреть снова в ktw' : 'Продолжить в ktw';
        link.addEventListener('click', (e) => {
            e.preventDefault();
            link.blur(); // иначе фокус держит строку видимой после ухода мыши
            play(item);
        });

        if (main) link.append(el('span', 'material-symbols-outlined', 'play_arrow'));
        link.append(el('span', 'cw-title', item.title));

        const meta = describe(item);
        if (meta) link.append(document.createTextNode(' · ' + meta));

        // Иконка карточки в коллекции появляется при наведении на строку
        if (item.filmId) {
            const card = el('span', 'material-symbols-outlined cw-card', 'open_in_new');
            card.title = 'Открыть карточку';
            card.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                window.location.href = 'edit-film.html?id=' + encodeURIComponent(item.filmId);
            });
            link.append(card);
        }

        link.append(progressLine(item));
        return link;
    }

    function render(items) {
        root.replaceChildren();
        // Главная строка — последнее недосмотренное; если всё досмотрено — просто последнее
        const current = items.find((i) => !i.finished) || items[0];
        if (!current) {
            root.hidden = true;
            return;
        }

        const more = el('div', 'cw-more');
        items.filter((i) => i !== current).forEach((i) => more.append(row(i, false)));

        root.append(row(current, true), more, status);
        root.hidden = false;
    }

    async function load() {
        try {
            const res = await fetch('/api/ktw/history');
            if (!res.ok) return;
            render((await res.json()).items || []);
        } catch {
            // Сервер недоступен — строки просто нет
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) load();
    });
    load();
})();
