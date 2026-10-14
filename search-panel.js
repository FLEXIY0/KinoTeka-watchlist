// Выезжающий сверху поиск по Кинопоиску.
//
// Без ключа строка поиска служит для его ввода: Enter открывает сайт, где
// ключ выдают, а вставленный ключ проверяется и сохраняется на сервере —
// после этого строка становится обычным поиском. Найденное можно добавить в
// коллекцию (карточка заполняется сама) или сразу открыть в ktw.

(function () {
    const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const state = {
        hasKey: false,
        keySite: 'https://kinopoiskapiunofficial.tech/',
        query: '',
        results: [],
        recent: [],
        active: -1,
        requestId: 0
    };

    // ─── Разметка ──────────────────────────────────────────────────────────

    const trigger = el('div', { className: 'kp-search-trigger' });
    const panel = el('div', { className: 'kp-search', role: 'search' });
    const box = el('div', { className: 'kp-search-box' });
    const row = el('div', { className: 'kp-search-row' });
    const icon = el('span', { className: 'material-symbols-outlined', textContent: 'search' });
    const input = el('input', {
        className: 'kp-search-input',
        type: 'text',
        autocomplete: 'off',
        spellcheck: false
    });
    const hint = el('div', { className: 'kp-search-hint' });
    const results = el('div', { className: 'kp-results' });

    row.append(icon, input);
    box.append(row, hint, results);
    panel.append(box);
    document.body.prepend(trigger, panel);

    function el(tag, props) {
        const node = document.createElement(tag);
        Object.assign(node, props || {});
        return node;
    }

    // ─── Открытие и закрытие ───────────────────────────────────────────────

    function open() {
        panel.classList.add('open');
    }

    let dismissedAt = 0;

    function close() {
        panel.classList.remove('open');
        if (focusInside()) document.activeElement.blur();
    }

    // Esc прячет панель, даже если мышь над ней (иначе её держит :hover)
    function dismiss() {
        close();
        panel.classList.add('dismissed');
        dismissedAt = Date.now();
    }

    // Панель открывается наведением на верхний край и закрывается, когда мышь
    // уходит; пока идёт поиск (в строке есть текст), она остаётся на месте
    function focusInside() {
        return panel.contains(document.activeElement);
    }

    function openAndFocus() {
        // Сразу после Esc панель уезжает из-под мыши — это не повод открыть её снова
        if (panel.classList.contains('dismissed')) {
            if (Date.now() - dismissedAt < 400) return;
            panel.classList.remove('dismissed');
        }
        open();
        if (!focusInside()) input.focus({ preventScroll: true });
    }

    input.addEventListener('focus', open);
    trigger.addEventListener('mouseenter', openAndFocus);
    panel.addEventListener('mouseenter', openAndFocus);
    // Панель держится открытой без мыши, только если в строке что-то набрано
    function engaged() {
        return focusInside() && input.value.trim() !== '';
    }

    panel.addEventListener('mouseleave', (e) => {
        if (!engaged() && e.relatedTarget !== trigger) close();
    });
    trigger.addEventListener('mouseleave', (e) => {
        if (!engaged() && !panel.contains(e.relatedTarget)) close();
    });
    panel.addEventListener('focusout', () => {
        setTimeout(() => {
            if (!focusInside() && !panel.matches(':hover')) close();
        }, 150);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && (panel.classList.contains('open') || panel.matches(':hover'))) {
            dismiss();
            return;
        }
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
        if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
            e.preventDefault();
            panel.classList.remove('dismissed');
            open();
            input.focus();
        }
    });

    // ─── Состояние ключа ───────────────────────────────────────────────────

    function setHint(text, kind, link) {
        hint.className = 'kp-search-hint' + (kind ? ' ' + kind : '');
        hint.textContent = text;
        if (link) {
            hint.append(' ');
            hint.append(el('a', { href: link, target: '_blank', rel: 'noopener noreferrer', textContent: link.replace(/^https?:\/\//, '').replace(/\/$/, '') }));
        }
    }

    function applyMode() {
        if (state.hasKey) {
            icon.textContent = 'search';
            input.placeholder = 'Поиск фильмов и сериалов на Кинопоиске…';
            setHint('Enter — первый результат в список · ↑↓ выбор · Esc закрыть');
        } else {
            icon.textContent = 'key';
            input.placeholder = 'Вставьте сюда ключ Кинопоиска (Enter — получить ключ)';
            setHint('Для поиска нужен бесплатный ключ. Нажмите Enter, чтобы открыть сайт, скопируйте ключ и вставьте его сюда:', '', state.keySite);
        }
    }

    async function loadKeyStatus() {
        try {
            const status = await (await fetch('/api/kinopoisk/key')).json();
            state.hasKey = status.hasKey;
            state.keySite = status.keySite || state.keySite;

            // Ключ, который раньше вводили на странице карточки, переносим на сервер
            const oldKey = !state.hasKey && localStorage.getItem('kinopoiskApiKey');
            if (oldKey && KEY_PATTERN.test(oldKey)) {
                await saveKey(oldKey, true);
                return;
            }
        } catch {
            // Сервер недоступен — оставляем режим ввода ключа
        }
        applyMode();
        if (state.hasKey) loadRecent();
    }

    async function saveKey(key, silent) {
        if (!silent) setHint('Проверяю ключ…');
        try {
            const res = await fetch('/api/kinopoisk/key', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key })
            });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error || 'Ключ не подошёл');

            localStorage.removeItem('kinopoiskApiKey');
            state.hasKey = true;
            input.value = '';
            applyMode();
            setHint('Ключ сохранён — теперь это поиск. Он же используется в ktw.', 'success');
            loadRecent();
        } catch (error) {
            if (silent) {
                applyMode();
                return;
            }
            setHint(error.message + '. Ключ можно взять здесь:', 'error', state.keySite);
        }
    }

    // ─── Поиск ─────────────────────────────────────────────────────────────

    let debounce;
    input.addEventListener('input', () => {
        const value = input.value.trim();

        if (!state.hasKey) {
            if (KEY_PATTERN.test(value)) saveKey(value);
            return;
        }

        // Вставили ключ при уже сохранённом — обновляем его
        if (KEY_PATTERN.test(value)) {
            saveKey(value);
            return;
        }

        clearTimeout(debounce);
        debounce = setTimeout(() => runSearch(value), 350);
    });

    input.addEventListener('keydown', (e) => {
        if (!state.hasKey) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const value = input.value.trim();
                if (KEY_PATTERN.test(value)) saveKey(value);
                else window.open(state.keySite, '_blank', 'noopener');
            }
            return;
        }

        const cards = results.querySelectorAll('.kp-card');
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!cards.length) return;
            const delta = e.key === 'ArrowDown' ? 1 : -1;
            state.active = (state.active + delta + cards.length) % cards.length;
            highlight(cards);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const card = cards[state.active >= 0 ? state.active : 0];
            if (card) card.querySelector('[data-action="add"]').click();
        }
    });

    function highlight(cards) {
        cards.forEach((c, i) => c.classList.toggle('active', i === state.active));
        if (cards[state.active]) cards[state.active].scrollIntoView({ block: 'nearest' });
    }

    async function runSearch(query) {
        state.query = query;
        state.active = -1;
        const id = ++state.requestId;

        if (query.length < 2) {
            renderRecent();
            return;
        }

        setHint('Ищу…');
        try {
            const res = await fetch('/api/kinopoisk/search?q=' + encodeURIComponent(query));
            const body = await res.json();
            if (id !== state.requestId) return; // пришёл ответ на устаревший запрос

            if (!res.ok) {
                if (body.code === 'no-key' || body.code === 'bad-key') {
                    state.hasKey = false;
                    applyMode();
                    setHint(body.error + '. Вставьте новый ключ:', 'error', body.keySite || state.keySite);
                } else {
                    setHint(body.error || 'Ошибка поиска', 'error');
                }
                results.replaceChildren();
                return;
            }

            state.results = body.results;
            applyMode();
            if (!body.results.length) setHint('Ничего не нашлось');
            renderCards(body.results);
        } catch {
            if (id === state.requestId) setHint('Сервер КиноТеки не отвечает', 'error');
        }
    }

    // ─── Недавно открытые в ktw (временные) ────────────────────────────────

    async function loadRecent() {
        try {
            const res = await fetch('/api/ktw/recent');
            if (!res.ok) return;
            state.recent = (await res.json()).items || [];
            if (!input.value.trim()) renderRecent();
        } catch {}
    }

    function renderRecent() {
        results.replaceChildren();
        if (!state.recent.length) return;
        results.append(el('div', { className: 'kp-section-title', textContent: 'Недавно открывали в ktw' }));
        renderCards(state.recent, true);
    }

    // ─── Карточки ──────────────────────────────────────────────────────────

    function ratingClass(rating) {
        const value = parseFloat(rating);
        if (!value) return '';
        if (value >= 7) return 'high';
        if (value >= 5) return 'mid';
        return 'low';
    }

    function renderCards(items, append) {
        if (!append) results.replaceChildren();

        for (const item of items) {
            const card = el('div', { className: 'kp-card' });

            const poster = el('div', { className: 'kp-card-poster' });
            if (item.poster) poster.style.backgroundImage = `url("${String(item.poster).replace(/"/g, '%22')}")`;
            else poster.append(el('span', { className: 'material-symbols-outlined', textContent: 'movie' }));

            const body = el('div', { className: 'kp-card-body' });
            body.append(el('div', { className: 'kp-card-title', textContent: item.title }));

            const meta = [item.year, item.type === 'series' ? 'сериал' : 'фильм']
                .concat((item.genres || []).slice(0, 3))
                .concat((item.countries || []).slice(0, 1))
                .filter(Boolean)
                .join(' · ');
            body.append(el('div', { className: 'kp-card-meta', textContent: meta }));

            if (item.description) {
                body.append(el('div', { className: 'kp-card-desc', textContent: item.description }));
            }

            const bottom = el('div', { className: 'kp-card-bottom' });
            if (item.rating) {
                bottom.append(el('span', { className: 'kp-rating ' + ratingClass(item.rating), textContent: 'КП ' + item.rating, title: 'Рейтинг Кинопоиска' }));
            }

            const actions = el('div', { className: 'kp-card-actions' });
            actions.append(addButton(item), watchButton(item), ktwButton(item));
            if (append) actions.append(dismissButton(item, card));
            bottom.append(actions);
            body.append(bottom);

            card.append(poster, body);
            results.append(card);
        }
    }

    function button(iconName, text) {
        const btn = el('button', { className: 'kp-btn', type: 'button' });
        btn.append(el('span', { className: 'material-symbols-outlined', textContent: iconName }), document.createTextNode(text));
        return btn;
    }

    function setButton(btn, iconName, text) {
        btn.replaceChildren(el('span', { className: 'material-symbols-outlined', textContent: iconName }), document.createTextNode(text));
    }

    function addButton(item) {
        if (item.filmId) {
            const link = el('a', { className: 'kp-btn', href: 'edit-film.html?id=' + encodeURIComponent(item.filmId) });
            link.dataset.action = 'add';
            link.append(el('span', { className: 'material-symbols-outlined', textContent: 'check' }), document.createTextNode('В списке'));
            return link;
        }

        const btn = button('add', 'В список');
        btn.dataset.action = 'add';
        btn.title = 'Добавить в коллекцию — карточка заполнится с Кинопоиска';
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            setButton(btn, 'hourglass_top', 'Добавляю…');
            try {
                const res = await fetch('/api/kinopoisk/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ kpId: item.kpId, watchStatus: 'watching' })
                });
                const body = await res.json();
                if (!res.ok) throw new Error(body.error || 'Не удалось добавить');

                item.filmId = body.film.id;
                const link = addButton(item);
                btn.replaceWith(link);
                setHint(body.created ? `«${item.title}» добавлен в коллекцию` : `«${item.title}» уже был в коллекции`, 'success');
            } catch (error) {
                btn.disabled = false;
                setButton(btn, 'add', 'В список');
                setHint(error.message, 'error');
            }
        });
        return btn;
    }

    // Убрать из «недавно открывали» (временный список)
    function dismissButton(item, card) {
        const btn = button('close', '');
        btn.title = 'Убрать из недавно открытых';
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            try {
                await fetch('/api/ktw/recent/' + encodeURIComponent(item.kpId), { method: 'DELETE' });
                state.recent = state.recent.filter((r) => r.kpId !== item.kpId);
                card.remove();
                if (!state.recent.length) results.replaceChildren();
            } catch {
                btn.disabled = false;
            }
        });
        return btn;
    }

    // «Смотреть» — плееры балансеров прямо в браузере
    function watchButton(item) {
        const link = el('a', { className: 'kp-btn', href: 'watch.html?kp=' + encodeURIComponent(item.kpId) });
        link.title = 'Смотреть в браузере';
        link.append(el('span', { className: 'material-symbols-outlined', textContent: 'play_arrow' }), document.createTextNode('Смотреть'));
        return link;
    }

    // Маленькая кнопка ktw — плеер в терминале (mpv, без рекламы)
    function ktwButton(item) {
        const btn = button('terminal', '');
        btn.title = 'Открыть в ktw (терминал, mpv)';
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            try {
                const res = await fetch('/api/ktw/watch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ kpId: item.kpId })
                });
                const body = await res.json();
                if (!res.ok) throw new Error(body.error || 'Не удалось запустить ktw');
                setHint(`Открываю «${item.title}» в ktw…`, 'success');
            } catch (error) {
                setHint(error.message, 'error');
            } finally {
                setTimeout(() => { btn.disabled = false; }, 1500);
            }
        });
        return btn;
    }

    applyMode();
    loadKeyStatus();
})();
