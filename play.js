// Свой плеер для CDNVideoHub: обычный <video> с MP4 с CDN VK — без рекламы,
// с выбором озвучки, серии и качества, продолжением с места и точным
// прогрессом в общей истории (её видят строка «продолжить» и коллекция).
//
// Открывается внутри виджета на странице просмотра (watch.html) как ещё один
// плеер в списке. Ссылки на видео привязаны к IP — браузер запрашивает их сам.

(function () {
    const API = 'https://plapi.cdnvideohub.com/api/v1/player/sv/';
    const QUALITIES = [
        ['mpeg4kUrl', '4K'],
        ['mpeg2kUrl', '2K'],
        ['mpegQhdUrl', '1440p'],
        ['mpegFullHdUrl', '1080p'],
        ['mpegHighUrl', '720p'],
        ['mpegMediumUrl', '480p'],
        ['mpegLowUrl', '360p'],
        ['mpegLowestUrl', '240p']
    ];

    const params = new URLSearchParams(location.search);
    const kpId = params.get('kp');
    const video = document.getElementById('video');
    const message = document.getElementById('message');
    const selVoice = document.getElementById('voice');
    const selSeason = document.getElementById('season');
    const selEpisode = document.getElementById('episode');
    const selQuality = document.getElementById('quality');

    let items = [];
    let serial = false;
    let info = { title: '', year: '' };
    let current = null; // { season, episode, voice, vkId }
    let sources = {};
    let lastSent = 0;
    let notifiedParent = false;

    function show(text) {
        message.textContent = text;
        message.hidden = !text;
    }

    function voiceOf(item) {
        return item.voiceStudio || item.voiceType || 'Озвучка';
    }

    function option(select, value, label, selected) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        if (selected) opt.selected = true;
        select.append(opt);
    }

    function storage(key, value) {
        try {
            if (value === undefined) return localStorage.getItem(key);
            localStorage.setItem(key, value);
        } catch {}
        return null;
    }

    // Сообщить странице просмотра, что этот плеер работает (или нет) — для рейтинга
    function tellParent(key) {
        try {
            window.parent.postMessage({ key, player: 'CDNVideoHub' }, location.origin);
        } catch {}
    }

    // ─── Выбор серии / озвучки / качества ──────────────────────────────────

    function episodesOf(season) {
        return [...new Set(items.filter((i) => i.season === season).map((i) => i.episode))].sort((a, b) => a - b);
    }

    function pick(season, episode, voice) {
        const pool = serial ? items.filter((i) => i.season === season && i.episode === episode) : items;
        return pool.find((i) => voiceOf(i) === voice) || pool[0] || null;
    }

    function renderSelectors() {
        const pool = serial ? items.filter((i) => i.season === current.season && i.episode === current.episode) : items;

        selVoice.replaceChildren();
        [...new Set(pool.map(voiceOf))].forEach((v) => option(selVoice, v, v, v === current.voice));

        selSeason.hidden = selEpisode.hidden = !serial;
        if (serial) {
            selSeason.replaceChildren();
            [...new Set(items.map((i) => i.season))].sort((a, b) => a - b)
                .forEach((s) => option(selSeason, s, `Сезон ${s}`, s === current.season));
            selEpisode.replaceChildren();
            episodesOf(current.season).forEach((e) => option(selEpisode, e, `Серия ${e}`, e === current.episode));
        }
    }

    function renderQualities() {
        const preferred = storage('kt_cvh_quality') || 'mpegFullHdUrl';
        const available = QUALITIES.filter(([key]) => sources[key]);
        // Предпочтённое качество, а если его нет — ближайшее ниже
        const prefIndex = QUALITIES.findIndex(([key]) => key === preferred);
        const chosen = available.find(([key]) => QUALITIES.findIndex(([k]) => k === key) >= prefIndex) || available[0];

        selQuality.replaceChildren();
        available.forEach(([key, label]) => option(selQuality, key, label, chosen && key === chosen[0]));
        return chosen ? sources[chosen[0]] : sources.hlsUrl;
    }

    async function load(item, startAt) {
        current = { season: item.season || 0, episode: item.episode || 0, voice: voiceOf(item), vkId: item.vkId };
        storage('kt_cvh_voice', current.voice);
        renderSelectors();
        show('Загрузка…');

        try {
            const res = await fetch(API + 'video/' + encodeURIComponent(item.vkId));
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            sources = (await res.json()).sources || {};
        } catch (error) {
            show('Этот источник не открылся. Выберите другой плеер в списке справа.');
            tellParent('kt_player_failed');
            return;
        }

        const url = renderQualities();
        if (!url) {
            show('Для этой озвучки нет видео. Попробуйте другую или другой плеер.');
            return;
        }

        video.src = url;
        if (startAt) {
            video.addEventListener('loadedmetadata', () => { video.currentTime = startAt; }, { once: true });
        }
        video.play().catch(() => {});
    }

    selVoice.addEventListener('change', () => load(pick(current.season, current.episode, selVoice.value), video.currentTime));
    selSeason.addEventListener('change', () => {
        const season = Number(selSeason.value);
        load(pick(season, episodesOf(season)[0], current.voice), 0);
    });
    selEpisode.addEventListener('change', () => load(pick(current.season, Number(selEpisode.value), current.voice), 0));
    selQuality.addEventListener('change', () => {
        storage('kt_cvh_quality', selQuality.value);
        const time = video.currentTime;
        video.src = sources[selQuality.value];
        video.addEventListener('loadedmetadata', () => { video.currentTime = time; }, { once: true });
        video.play().catch(() => {});
    });

    // ─── Прогресс ──────────────────────────────────────────────────────────

    function sendProgress(force, finished) {
        if (!current || !video.duration) return;
        const now = Date.now();
        if (!force && now - lastSent < 15000) return;
        lastSent = now;

        fetch('/api/watch/progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            keepalive: true,
            body: JSON.stringify({
                kpId,
                title: info.title,
                year: info.year,
                serial,
                season: current.season,
                episode: current.episode,
                timePos: Math.floor(finished ? video.duration : video.currentTime),
                duration: Math.floor(video.duration),
                player: 'CDNVideoHub'
            })
        }).catch(() => {});
    }

    video.addEventListener('playing', () => {
        show('');
        if (!notifiedParent) {
            notifiedParent = true;
            tellParent('kt_progress');
        }
    });
    video.addEventListener('timeupdate', () => {
        if (video.currentTime > 5) sendProgress(false);
    });
    video.addEventListener('pause', () => sendProgress(true));
    video.addEventListener('error', () => {
        show('Видео не загрузилось. Попробуйте другое качество или другой плеер.');
        tellParent('kt_player_failed');
    });
    window.addEventListener('pagehide', () => sendProgress(true));

    // Серия закончилась — отмечаем и включаем следующую
    video.addEventListener('ended', () => {
        sendProgress(true, true);
        if (!serial) return;
        const episodes = episodesOf(current.season);
        const next = episodes[episodes.indexOf(current.episode) + 1];
        if (next) {
            load(pick(current.season, next, current.voice), 0);
        } else {
            const seasons = [...new Set(items.map((i) => i.season))].sort((a, b) => a - b);
            const nextSeason = seasons[seasons.indexOf(current.season) + 1];
            if (nextSeason) load(pick(nextSeason, episodesOf(nextSeason)[0], current.voice), 0);
        }
    });

    // Панель прячется, пока смотрят, и появляется при движении мыши
    let idleTimer;
    function wake() {
        document.body.classList.remove('idle');
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            if (!video.paused) document.body.classList.add('idle');
        }, 2500);
    }
    document.addEventListener('mousemove', wake);
    video.addEventListener('pause', wake);
    wake();

    // ─── Старт ─────────────────────────────────────────────────────────────

    async function init() {
        if (!kpId || !/^\d+$/.test(kpId)) {
            show('Не указан фильм');
            return;
        }

        const [playlist, infoRes, historyRes] = await Promise.all([
            fetch(API + 'playlist?pub=12&aggr=kp&id=' + kpId).then((r) => r.json()).catch(() => null),
            fetch('/api/watch/info/' + kpId).then((r) => (r.ok ? r.json() : null)).catch(() => null),
            fetch('/api/ktw/history').then((r) => (r.ok ? r.json() : null)).catch(() => null)
        ]);

        if (infoRes) info = infoRes;
        items = ((playlist && playlist.items) || []).filter((i) => i.vkId);
        if (!items.length) {
            show('В CDNVideoHub этого фильма нет. Выберите другой плеер в списке справа.');
            tellParent('kt_player_failed');
            return;
        }
        serial = Boolean(playlist.isSerial) || items.some((i) => i.season);

        // С какого места начать: серия из ссылки или истории, секунда — из истории
        const saved = historyRes && (historyRes.items || []).find((i) => String(i.kpId) === kpId);
        let season = Number(params.get('s')) || (saved && saved.season) || 0;
        let episode = Number(params.get('e')) || (saved && saved.episode) || 0;
        if (serial && !items.some((i) => i.season === season && i.episode === episode)) {
            season = Math.min(...items.map((i) => i.season));
            episode = episodesOf(season)[0];
        }

        const voice = params.get('voice') || storage('kt_cvh_voice') || '';
        const item = pick(season, episode, voice);

        let startAt = 0;
        if (saved && !saved.finished && saved.timePos > 10 && saved.percentage < 95 &&
            (!serial || (saved.season === item.season && saved.episode === item.episode))) {
            startAt = saved.timePos;
        }

        load(item, startAt);
    }

    init();
})();
