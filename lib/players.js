// Список плееров для страницы просмотра — с несколькими уровнями страховки:
//
//   1. kinobox через зеркала (своё из настроек ktw — первым);
//   2. прямые источники в обход kinobox: CDNVideoHub (свой плеер play.html —
//      без рекламы, с точным прогрессом) и Collaps через свои зеркала;
//   3. если по id Кинопоиска ничего нет — поиск в kinobox по названию;
//   4. живой рейтинг: плееры, на которых смотрят, поднимаются, а те, с
//      которых сразу уходят, опускаются.
//
// Ответ — в формате api.kinobox.tv ({ data: [{ type, iframeUrl, translations }] }),
// его понимает виджет kinobox.

const fs = require('fs');
const path = require('path');

const ktwConfig = require('../ktw/lib/config');


// Адреса источников можно подменить через окружение (используется в тестах)
const kinoboxMirrors = () => (process.env.KINOTEKA_KINOBOX_MIRRORS
    ? process.env.KINOTEKA_KINOBOX_MIRRORS.split(',')
    : ['https://fbphdplay.top/api/players', 'https://api.kinobox.tv/api/players']);
const collapsMirrors = () => (process.env.KINOTEKA_COLLAPS_MIRRORS
    ? process.env.KINOTEKA_COLLAPS_MIRRORS.split(',')
    : ['https://api.nextembed.ws/embed/kp/', 'https://api.kinogram.best/embed/kp/', 'https://api.ortified.ws/embed/kp/']);
const cdnVideoHubPlaylist = () => process.env.KINOTEKA_CVH_PLAYLIST
    || 'https://plapi.cdnvideohub.com/api/v1/player/sv/playlist?pub=12&aggr=kp&id=';
const CACHE_MS = 10 * 60 * 1000;
const REFERER = { Referer: 'https://kinobox.tv/', Origin: 'https://kinobox.tv' };

// Базовый порядок: Collaps, свой плеер CDNVideoHub, Kodik (сообщает прогресс),
// дальше остальные; Alloha последним — работает хуже остальных
function basePriority(type) {
    const t = String(type || '').toLowerCase();
    if (t.includes('collaps')) return 100;
    if (t.includes('cdnvideohub')) return 90;
    if (t.includes('kodik')) return 80;
    if (t.includes('veoveo')) return 50;
    if (t.includes('alloha')) return 5;
    return 10;
}

function playerKey(type) {
    return String(type || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

async function fetchJson(url, headers, timeout = 10000) {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

function createPlayers({ dataDir, getTitle, log = () => {} }) {
    const statsFile = path.join(dataDir, 'players-stats.json');
    const cache = new Map();

    // ─── Живой рейтинг ─────────────────────────────────────────────────────

    function readStats() {
        try {
            const stats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
            return stats && typeof stats === 'object' ? stats : {};
        } catch {
            return {};
        }
    }

    function writeStats(stats) {
        try {
            fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
        } catch (error) {
            log(`players: рейтинг не сохранился: ${error.message}`);
        }
    }

    // Свежие отзывы весят больше: старые счётчики постепенно «остывают»
    function score(type, stats = readStats()) {
        const s = stats[playerKey(type)];
        if (!s) return 0;
        const ageDays = (Date.now() - (s.updatedAt || 0)) / 86400000;
        const weight = Math.max(0.2, 1 - ageDays / 30);
        return Math.max(-60, Math.min(40, (s.ok * 6 - s.fail * 10) * weight));
    }

    function feedback(type, ok) {
        const key = playerKey(type);
        if (!key) return;
        const stats = readStats();
        const s = stats[key] || { ok: 0, fail: 0, updatedAt: 0 };
        if (ok) s.ok = Math.min(s.ok + 1, 20);
        else s.fail = Math.min(s.fail + 1, 20);
        // Успех частично прощает прошлые неудачи и наоборот
        if (ok && s.fail > 0) s.fail -= 1;
        if (!ok && s.ok > 0) s.ok -= 1;
        s.updatedAt = Date.now();
        stats[key] = s;
        writeStats(stats);
    }

    function sortPlayers(players) {
        const stats = readStats();
        return players
            .map((p, index) => ({ p, index, rank: basePriority(p.type) + score(p.type, stats) }))
            .sort((a, b) => b.rank - a.rank || a.index - b.index)
            .map((x) => x.p);
    }

    // Каждая озвучка — отдельный пункт меню виджета: виджет показывает один
    // пункт на плеер, и выбор озвучки прятался внутри плеера. Тип остаётся
    // прежним, поэтому рейтинг и память выбора работают как раньше.
    function expandVoices(players) {
        return players.flatMap((p) => {
            const voices = (p.translations || []).filter((t) => t && t.name && t.iframeUrl);
            if (!voices.length) return [p];
            return voices.map((t) => ({
                ...p,
                iframeUrl: t.iframeUrl,
                voice: t.name,
                translations: [{ ...t, name: `${t.name} · ${p.type}` }]
            }));
        });
    }

    // ─── Источники ─────────────────────────────────────────────────────────

    async function fromKinobox(query) {
        const configured = ktwConfig.resolveKinoboxApi();
        const defaults = kinoboxMirrors();
        const mirrors = configured ? [configured, ...defaults.filter((m) => m !== configured)] : defaults;
        for (const mirror of mirrors) {
            try {
                const data = await fetchJson(`${mirror}${mirror.includes('?') ? '&' : '?'}${query}`, REFERER);
                if (data && Array.isArray(data.data) && data.data.length) return data.data;
            } catch (error) {
                log(`players: ${mirror}: ${error.message}`);
            }
        }
        return [];
    }

    // CDNVideoHub → свой плеер play.html: озвучки списком, серии выбираются в нём
    async function fromCdnVideoHub(kpId) {
        try {
            const data = await fetchJson(cdnVideoHubPlaylist() + kpId, {}, 8000);
            const items = (data.items || []).filter((i) => i.vkId);
            if (!items.length) return [];
            const voices = [...new Set(items.map((i) => i.voiceStudio || i.voiceType || 'Озвучка'))];
            const base = `/play.html?kp=${kpId}`;
            return [{
                type: 'CDNVideoHub',
                iframeUrl: base,
                translations: voices.map((voice) => ({
                    name: voice,
                    quality: 'без рекламы',
                    iframeUrl: `${base}&voice=${encodeURIComponent(voice)}`
                }))
            }];
        } catch (error) {
            log(`players: CDNVideoHub: ${error.message}`);
            return [];
        }
    }

    // Collaps напрямую — если kinobox его не дал
    async function fromCollaps(kpId) {
        for (const mirror of collapsMirrors()) {
            try {
                const response = await fetch(mirror + kpId, { headers: REFERER, signal: AbortSignal.timeout(8000) });
                const body = await response.text();
                if (response.ok && body.length > 1000) {
                    return [{ type: 'Collaps', iframeUrl: mirror + kpId, translations: [] }];
                }
            } catch {}
        }
        return [];
    }

    async function getPlayers(query) {
        const params = new URLSearchParams(query);
        const kpId = params.get('kinopoisk');
        const cached = cache.get(query);
        if (cached && Date.now() - cached.at < CACHE_MS) return { data: expandVoices(sortPlayers(cached.players)) };

        let players;
        if (kpId && /^\d+$/.test(kpId)) {
            const [kinobox, cvh] = await Promise.all([fromKinobox(query), fromCdnVideoHub(kpId)]);
            players = [...kinobox, ...cvh];

            if (!players.some((p) => /collaps/i.test(p.type))) {
                players.push(...await fromCollaps(kpId));
            }

            // У фильма в базах балансеров бывает другой id — ищем по названию
            if (!players.length && getTitle) {
                const title = await getTitle(kpId).catch(() => '');
                if (title) players = await fromKinobox(`title=${encodeURIComponent(title)}`);
            }
        } else {
            players = await fromKinobox(query);
        }

        if (players.length) cache.set(query, { at: Date.now(), players });
        return { data: expandVoices(sortPlayers(players)) };
    }

    return { getPlayers, feedback, score, basePriority };
}

module.exports = { createPlayers, basePriority, playerKey };
