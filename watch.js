// Просмотр в браузере: плееры балансеров через виджет kinobox — так же, как
// на сайте KinoTeka-Watch. Работает там, где ktw не смог вытащить поток.
//
// Прогресс: Kodik сам сообщает странице время и серию (postMessage) — их
// пишем в общую историю ktw. Остальные плееры такого не умеют, поэтому для
// них фиксируем только «начал смотреть», если страница открыта больше минуты.

(function () {
    const params = new URLSearchParams(location.search);
    const kpId = params.get('kp');
    const player = document.getElementById('player');
    const titleEl = document.getElementById('title');
    const statusEl = document.getElementById('status');

    const info = { kpId, title: '', year: '', serial: false, poster: '', hasHistory: false };
    const progress = { season: Number(params.get('s')) || 0, episode: Number(params.get('e')) || 0, timePos: 0, duration: 0, player: '' };
    let lastSent = 0;
    let gotRealProgress = false;

    function setStatus(text) {
        statusEl.textContent = text || '';
    }

    if (!kpId || !/^\d+$/.test(kpId)) {
        titleEl.textContent = 'Не указан фильм';
        return;
    }

    // ─── Шапка ─────────────────────────────────────────────────────────────

    function renderTitle() {
        titleEl.textContent = info.title || `Фильм ${kpId}`;
        document.title = `${info.title || 'Просмотр'} — KINOTEKA`;
        const hints = [];
        if (info.year) hints.push(info.year);
        // Куда смотреть дальше: kinobox не умеет открыть нужную серию сам
        if (progress.season && progress.episode) hints.push(`вы остановились на С${progress.season}:Э${progress.episode}`);
        if (hints.length) {
            const small = document.createElement('small');
            small.textContent = hints.join(' · ');
            titleEl.append(small);
        }
    }

    fetch('/api/watch/info/' + kpId)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
            if (data) Object.assign(info, data);
            renderTitle();
        })
        .catch(renderTitle);

    document.getElementById('back').addEventListener('click', (e) => {
        if (history.length > 1) {
            e.preventDefault();
            history.back();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') document.getElementById('back').click();
    });

    document.getElementById('ktw').addEventListener('click', async () => {
        const body = { kpId, resume: true };
        if (progress.season && progress.episode) {
            body.season = progress.season;
            body.episode = progress.episode;
        }
        try {
            const res = await fetch('/api/ktw/watch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const result = await res.json();
            setStatus(res.ok ? 'Открываю в ktw…' : result.error);
        } catch {
            setStatus('Сервер КиноТеки не отвечает');
        }
        setTimeout(setStatus, 4000);
    });

    // ─── Плеер ─────────────────────────────────────────────────────────────

    const savedPlayerKey = 'kt_last_player_' + kpId;

    function startPlayer() {
        player.replaceChildren();
        if (typeof kinobox === 'undefined') {
            setStatus('Не загрузился виджет плееров (kinobox). Проверьте интернет или откройте в ktw.');
            return;
        }
        // Список плееров — через сервер КиноТеки, он перебирает зеркала kinobox
        kinobox(player, { baseUrl: location.origin + '/', search: { kinopoisk: kpId } });
        rememberPlayerChoice();
    }

    // ─── Какой плеер выбран: память и живой рейтинг ────────────────────────
    //
    // Порядок пунктов меню виджета совпадает со списком /api/players (сервер
    // отдаёт его из кэша), поэтому по номеру пункта знаем тип плеера.
    // Запоминаем тип (а не номер — порядок меняется вместе с рейтингом) и
    // сообщаем серверу: быстро ушли с плеера — плохо, смотрели — хорошо.

    let playerTypes = [];
    const rating = { type: null, since: 0, reported: new Set() };

    function feedback(type, ok) {
        if (!type || rating.reported.has(type)) return;
        rating.reported.add(type);
        fetch('/api/players/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, ok })
        }).catch(() => {});
    }

    function selectPlayer(type) {
        if (!type || type === rating.type) return;
        // Ушли меньше чем через 25 секунд — этот плеер, видимо, не заработал
        if (rating.type && Date.now() - rating.since < 25000) feedback(rating.type, false);
        rating.type = type;
        rating.since = Date.now();
        progress.player = type;
        try { localStorage.setItem(savedPlayerKey, type); } catch {}
    }

    // Три минуты на одном плеере — значит, смотрят
    setInterval(() => {
        if (rating.type && !document.hidden && Date.now() - rating.since > 180000) feedback(rating.type, true);
    }, 15000);

    function rememberPlayerChoice() {
        let restored = false;
        const typesReady = fetch('/api/players?kinopoisk=' + kpId)
            .then((r) => (r.ok ? r.json() : { data: [] }))
            .then((d) => { playerTypes = (d.data || []).map((p) => p.type); })
            .catch(() => {});

        const observer = new MutationObserver(async () => {
            const items = Array.from(player.querySelectorAll('li')).filter((li) => li.offsetWidth > 0);
            if (!items.length || restored) return;
            restored = true;
            await typesReady;

            items.forEach((item, index) => {
                item.addEventListener('click', () => selectPlayer(playerTypes[index]));
            });

            let saved = null;
            try { saved = localStorage.getItem(savedPlayerKey); } catch {}
            const idx = saved ? playerTypes.indexOf(saved) : -1;
            if (idx > 0 && idx < items.length) {
                setTimeout(() => items[idx].click(), 300);
            } else {
                selectPlayer(playerTypes[0]); // виджет сам открывает первый плеер
            }
        });
        observer.observe(player, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 15000);
    }

    document.getElementById('reload').addEventListener('click', startPlayer);
    startPlayer();

    // ─── Прогресс ──────────────────────────────────────────────────────────

    function payload() {
        return JSON.stringify({
            kpId,
            title: info.title,
            year: info.year,
            poster: info.poster && !info.poster.startsWith('/') ? info.poster : '',
            serial: info.serial || Boolean(progress.season),
            season: progress.season,
            episode: progress.episode,
            timePos: Math.floor(progress.timePos),
            duration: Math.floor(progress.duration),
            player: progress.player
        });
    }

    function sendProgress(force) {
        const now = Date.now();
        if (!force && now - lastSent < 15000) return;
        lastSent = now;
        fetch('/api/watch/progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload(),
            keepalive: true
        }).catch(() => {});
    }

    // События Kodik: время, длительность, текущая серия
    window.addEventListener('message', (event) => {
        const data = event.data;
        if (!data || typeof data !== 'object' || typeof data.key !== 'string') return;

        // Свой плеер (play.html) сообщает, заработал он или нет
        if (data.key === 'kt_progress') {
            gotRealProgress = true;
            feedback(data.player, true);
            return;
        }
        if (data.key === 'kt_player_failed') {
            feedback(data.player, false);
            return;
        }

        if (data.key === 'kodik_player_time_update' && Number.isFinite(Number(data.value))) {
            progress.timePos = Number(data.value);
            gotRealProgress = true;
            if (progress.timePos > 0) feedback('Kodik', true);
            if (progress.timePos > 0) sendProgress(false);
        } else if (data.key === 'kodik_player_duration_update' && Number.isFinite(Number(data.value))) {
            progress.duration = Number(data.value);
        } else if (data.key === 'kodik_player_current_episode' && data.value) {
            const season = Number(data.value.season);
            const episode = Number(data.value.episode);
            if (season && episode && (season !== progress.season || episode !== progress.episode)) {
                progress.season = season;
                progress.episode = episode;
                progress.timePos = 0;
                gotRealProgress = true;
            }
        }
    });

    // Плееры без событий: открыт больше минуты — считаем, что начали смотреть
    setTimeout(() => {
        // Если позиция уже есть в истории (например, из ktw), не затираем её
        if (gotRealProgress || document.hidden || info.hasHistory) return;
        progress.timePos = Math.max(progress.timePos, 1);
        sendProgress(true);
    }, 60000);

    window.addEventListener('pagehide', () => {
        if (gotRealProgress && progress.timePos > 0) sendProgress(true);
    });
})();
