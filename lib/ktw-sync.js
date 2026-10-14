// Синхронизация истории ktw с коллекцией КиноТеки.
//
// Правила:
//   • сериал, у которого начата хотя бы одна серия, и начатый фильм попадают
//     в коллекцию: сериал — «В процессе просмотра» с последней серией,
//     фильм — «В процессе» или «Просмотрен» (досмотрен на 85%+);
//   • статус только повышается: то, что вы сами отметили просмотренным,
//     синхронизация обратно не откатит;
//   • то, что только открывали в ktw, в коллекцию не попадает — это
//     временный список «недавно открывали»;
//   • ktw хранит лишь 50 последних записей. Всё начатое запоминается в
//     журнале КиноТеки сразу, поэтому не теряется, даже если вылетело из
//     истории ktw раньше, чем дошло до коллекции (например, кончился лимит
//     запросов к Кинопоиску).

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

const ktwConfig = require('../ktw/lib/config');
const kinopoisk = require('./kinopoisk');

const STATUS_RANK = { '': 0, watching: 0, 'in-progress': 1, watched: 2 };
const MAX_RECENT = 50;
const IMPORTS_PER_RUN = 10;
const WATCHED_PERCENT = 85;

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return fallback;
    }
}

function episodeLabel(season, episode) {
    return season && episode ? `С${season}:Э${episode}` : '';
}

function createKtwSync(store) {
    const ledgerFile = path.join(store.dataDir, 'ktw-sync.json');
    const historyFile = () => path.join(ktwConfig.CONFIG_DIR, 'history.json');
    const openedFile = () => path.join(ktwConfig.CONFIG_DIR, 'opened.json');

    let running = null;
    let rerun = false;
    let watcher = null;
    let timer = null;
    let debounce = null;

    function readLedger() {
        const ledger = readJson(ledgerFile, {});
        return {
            films: ledger.films && typeof ledger.films === 'object' ? ledger.films : {},
            pending: ledger.pending && typeof ledger.pending === 'object' ? ledger.pending : {},
            recent: Array.isArray(ledger.recent) ? ledger.recent : []
        };
    }

    async function writeLedger(ledger) {
        const tmp = `${ledgerFile}.${process.pid}.tmp`;
        await fsp.writeFile(tmp, JSON.stringify(ledger, null, 2));
        await fsp.rename(tmp, ledgerFile).catch(async () => {
            await fsp.writeFile(ledgerFile, JSON.stringify(ledger, null, 2));
            await fsp.unlink(tmp).catch(() => {});
        });
    }

    // Что из записи истории ktw должно оказаться в коллекции
    function describe(item, watchedEpisodes) {
        const kpId = String(item.filmId);
        const episodes = watchedEpisodes[kpId] || [];
        const started = Boolean(item.watched) || item.timePos > 0 || item.percentage > 0 || episodes.length > 0;
        const finished = Boolean(item.watched) || item.percentage >= WATCHED_PERCENT;

        return {
            kpId,
            started,
            serial: Boolean(item.serial),
            title: item.title || '',
            year: item.year ? String(item.year) : '',
            poster: item.poster || '',
            status: item.serial ? 'in-progress' : (finished ? 'watched' : 'in-progress'),
            lastEpisode: item.serial ? episodeLabel(item.season, item.episode) : '',
            userRating: item.userRating ? Number(item.userRating) : 0,
            updatedAt: Number(item.updatedAt) || 0
        };
    }

    // Карточка без Кинопоиска — когда ключа нет: лучше короткая карточка, чем никакой
    async function createMinimal(entry) {
        const film = await store.createFilm({
            kinopoiskId: entry.kpId,
            kinopoiskUrl: `https://www.kinopoisk.ru/film/${entry.kpId}/`,
            title: entry.title || `Фильм ${entry.kpId}`,
            year: entry.year,
            contentType: entry.serial ? 'series' : 'movie',
            watchStatus: entry.status,
            lastEpisode: entry.lastEpisode,
            rating: entry.userRating,
            source: 'ktw'
        });
        if (entry.poster) {
            const bannerUrl = await store.saveRemoteImage(film.id, 'banner', null, entry.poster).catch(() => null);
            if (bannerUrl) return store.updateFilm(film.id, { bannerUrl });
        }
        return film;
    }

    async function addToCollection(entry) {
        const extra = {
            watchStatus: entry.status,
            lastEpisode: entry.lastEpisode,
            rating: entry.userRating,
            source: 'ktw'
        };
        try {
            const { film, created } = await store.importFromKinopoisk(entry.kpId, extra, { light: true });
            // Карточку только что добавили другим путём (например, из поиска) — дополним её
            if (!created) await updateExisting(film, entry);
            return film;
        } catch (error) {
            if (error.code === 'no-key' || error.code === 'bad-key' || error.code === 'not-found') {
                return createMinimal(entry);
            }
            throw error; // лимит или сеть — попробуем в следующий раз
        }
    }

    // Обновить уже существующую карточку: статус только вверх
    async function updateExisting(film, entry) {
        const patch = {};
        const current = film.watchStatus || '';
        const status = (STATUS_RANK[entry.status] || 0) > (STATUS_RANK[current] || 0) ? entry.status : current;

        if (status !== current) patch.watchStatus = status;
        if (entry.serial && status === 'in-progress' && entry.lastEpisode && entry.lastEpisode !== film.lastEpisode) {
            patch.lastEpisode = entry.lastEpisode;
        }
        if (entry.userRating && !Number(film.rating)) patch.rating = entry.userRating;

        if (Object.keys(patch).length) await store.updateFilm(film.id, patch);
    }

    async function runOnce() {
        const history = readJson(historyFile(), {});
        const items = Array.isArray(history.items) ? history.items : [];
        const watchedEpisodes = history.watchedEpisodes && typeof history.watchedEpisodes === 'object' ? history.watchedEpisodes : {};
        const opened = readJson(openedFile(), {});
        const openedItems = Array.isArray(opened.items) ? opened.items : [];

        const ledger = readLedger();
        const films = await store.listFilms();
        const byKpId = new Map();
        for (const film of films) {
            const kpId = kinopoisk.kpIdOf(film);
            if (kpId) byKpId.set(kpId, film);
        }

        const recentCandidates = [];
        const stats = { added: 0, updated: 0, pending: 0 };

        // 1. Новое из истории ktw сразу записываем в журнал (pending), чтобы
        //    оно пережило вылет из 50 последних записей ktw
        for (const item of items) {
            if (!item || !item.filmId) continue;
            const entry = describe(item, watchedEpisodes);

            if (!entry.started) {
                recentCandidates.push({
                    kpId: entry.kpId,
                    title: entry.title,
                    year: entry.year,
                    type: entry.serial ? 'series' : 'movie',
                    poster: entry.poster,
                    openedAt: entry.updatedAt
                });
                continue;
            }

            const seen = ledger.films[entry.kpId];
            if (seen && seen.seenUpdatedAt >= entry.updatedAt) continue;

            const queued = ledger.pending[entry.kpId];
            if (!queued || queued.updatedAt < entry.updatedAt) ledger.pending[entry.kpId] = entry;
        }

        // 2. Разбираем очередь
        let imports = 0;
        const queue = Object.values(ledger.pending).sort((a, b) => b.updatedAt - a.updatedAt);
        for (const entry of queue) {
            const existing = byKpId.get(entry.kpId);
            try {
                if (existing) {
                    await updateExisting(existing, entry);
                    ledger.films[entry.kpId] = { filmId: existing.id, seenUpdatedAt: entry.updatedAt };
                    stats.updated++;
                } else {
                    if (imports >= IMPORTS_PER_RUN) continue;
                    imports++;
                    const film = await addToCollection(entry);
                    byKpId.set(entry.kpId, film);
                    ledger.films[entry.kpId] = { filmId: film.id, seenUpdatedAt: entry.updatedAt };
                    stats.added++;
                }
                delete ledger.pending[entry.kpId];
            } catch (error) {
                if (store.log) store.log(`ktw-sync: «${entry.title}» отложен: ${error.message}`);
                if (error.code === 'limit') break;
            }
        }
        stats.pending = Object.keys(ledger.pending).length;

        // 3. «Недавно открывали» — временный список того, что не в коллекции
        for (const item of openedItems) {
            if (!item || !item.filmId) continue;
            recentCandidates.push({
                kpId: String(item.filmId),
                title: item.title || '',
                year: item.year || '',
                type: item.serial ? 'series' : 'movie',
                poster: item.poster || '',
                description: item.description || '',
                rating: item.rating || null,
                genres: item.genres || [],
                openedAt: Number(item.openedAt) || 0
            });
        }

        const recentById = new Map();
        for (const item of ledger.recent.concat(recentCandidates)) {
            const prev = recentById.get(item.kpId);
            if (!prev || item.openedAt > prev.openedAt) {
                recentById.set(item.kpId, { ...prev, ...item });
            }
        }
        ledger.recent = [...recentById.values()]
            .filter((item) => !byKpId.has(item.kpId) && !ledger.pending[item.kpId])
            .sort((a, b) => b.openedAt - a.openedAt)
            .slice(0, MAX_RECENT);

        await writeLedger(ledger);
        return stats;
    }

    // Один прогон за раз; запрос во время прогона запускает ещё один после него
    function syncNow() {
        if (running) {
            rerun = true;
            return running;
        }
        running = runOnce()
            .catch((error) => {
                if (store.log) store.log(`ktw-sync: ${error.message}`);
                return { error: error.message };
            })
            .finally(() => {
                running = null;
                if (rerun) {
                    rerun = false;
                    syncNow();
                }
            });
        return running;
    }

    async function getRecent() {
        const ledger = readLedger();
        const films = await store.listFilms();
        const inList = new Set(films.map((f) => kinopoisk.kpIdOf(f)).filter(Boolean));
        return ledger.recent
            .filter((item) => !inList.has(item.kpId))
            .map((item) => ({ ...item, filmId: null }));
    }

    async function dismissRecent(kpId) {
        const ledger = readLedger();
        ledger.recent = ledger.recent.filter((item) => item.kpId !== String(kpId));
        await writeLedger(ledger);
    }

    // Следим за файлами ktw; на случай, если fs.watch пропустит событие
    // (сетевые диски, некоторые редакторы), раз в минуту сверяемся сами
    function start({ intervalMs = 60000 } = {}) {
        try {
            fs.mkdirSync(ktwConfig.CONFIG_DIR, { recursive: true });
            watcher = fs.watch(ktwConfig.CONFIG_DIR, (event, file) => {
                if (file && !/^(history|opened)\.json$/.test(String(file))) return;
                clearTimeout(debounce);
                debounce = setTimeout(syncNow, 1000);
            });
            watcher.on('error', () => {});
            watcher.unref(); // слежка не должна держать процесс открытым
        } catch {
            watcher = null;
        }
        timer = setInterval(syncNow, intervalMs);
        timer.unref();
        return syncNow();
    }

    function stop() {
        if (watcher) watcher.close();
        clearInterval(timer);
        clearTimeout(debounce);
    }

    return { syncNow, getRecent, dismissRecent, start, stop };
}

module.exports = { createKtwSync };
