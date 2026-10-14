'use strict';

// Работа с внешними API: поиск фильмов (Кинопоиск) и список плееров (Kinobox).
// Ровно те же эндпоинты, что использует сайт:
//   - script-search.js  -> kinopoiskapiunofficial.tech
//   - kinobox.js        -> api.kinobox.tv/api/players

var extractors = require('./extractors');
var config = require('./config');
var http = require('./http');
var cache = require('./cache');

var KINOPOISK_SEARCH = 'https://kinopoiskapiunofficial.tech/api/v2.1/films/search-by-keyword';
var KINOPOISK_FILMS = 'https://kinopoiskapiunofficial.tech/api/v2.2/films';

// Зеркала списка плееров. Первым идёт то, которое использует сам сайт:
// api.kinobox.tv отвечает не отовсюду, а fbphdplay.top отдаёт тот же JSON.
// Своё зеркало можно подставить через KTW_KINOBOX_API или в настройках TUI.
var KINOBOX_MIRRORS = [
    'https://fbphdplay.top/api/players',
    'https://api.kinobox.tv/api/players'
];

// Браузерный UA
var USER_AGENT = extractors.USER_AGENT || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// GET с таймаутом и разбором JSON. Сетевой слой общий с экстракторами и
// доктором: одна и та же поломка должна называться одинаково везде.
async function fetchJson(url, headers, timeoutMs) {
    var res = await http.request(url, {
        headers: headers || {},
        accept: 'application/json',
        timeout: timeoutMs || 15000
    });

    if (!res.ok) {
        var reason = 'HTTP ' + res.status;

        if (res.status === 401 || res.status === 403) {
            reason = 'ключ API не принят (' + res.status + ')';
        } else if (res.status === 402 || res.status === 429) {
            reason = 'исчерпан лимит запросов к API (' + res.status + ')';
        }

        var httpError = new Error(reason + ' — ' + http.hostOf(url));
        httpError.status = res.status;
        throw httpError;
    }

    try {
        return JSON.parse(res.body);
    } catch (err) {
        throw new Error(http.hostOf(url) + ': ответ не разобрался как JSON');
    }
}

// Поиск фильмов по названию
async function searchFilms(query, apiKey) {
    if (!apiKey) {
        throw new Error('Нет ключа Кинопоиска. Задай KINOPOISK_API_KEY или введи по Ctrl+K / в Настройках');
    }

    var url = KINOPOISK_SEARCH + '?keyword=' + encodeURIComponent(query);

    return await cache.through('search', query, async function () {
        var data = await fetchJson(url, { 'X-API-KEY': apiKey });
        var films = data && data.films ? data.films : [];

        return films.map(function (film) {
        var isSerial = film.type === 'TV_SERIES' || film.type === 'MINI_SERIES';

        return {
            id: film.filmId,
            title: film.nameRu || film.nameEn || film.nameOriginal || 'Без названия',
            original: film.nameEn || film.nameOriginal || '',
            year: film.year || '',
            type: isSerial ? 'сериал' : 'фильм',
            serial: isSerial,
            rating: film.rating && film.rating !== 'null' ? film.rating : '',
            description: film.description || '',
            poster: film.posterUrlPreview || film.posterUrl || '',
            genres: (film.genres || []).map(function (genre) { return genre.genre; }),
                countries: (film.countries || []).map(function (country) { return country.country; })
            };
        });
    });
}

// Карточка фильма по id
async function getFilm(kinopoiskId, apiKey) {
    if (!apiKey) {
        throw new Error('Нет ключа Кинопоиска. Задай KINOPOISK_API_KEY или введи по Ctrl+K / в Настройках');
    }

    return await cache.through('film', kinopoiskId, async function () {
        var data = await fetchJson(KINOPOISK_FILMS + '/' + kinopoiskId, { 'X-API-KEY': apiKey });
        var isSerial = data.serial || data.type === 'TV_SERIES' || data.type === 'MINI_SERIES';

        return {
        id: data.kinopoiskId || kinopoiskId,
        title: data.nameRu || data.nameEn || data.nameOriginal || 'Без названия',
        original: data.nameOriginal || data.nameEn || '',
        year: data.year || '',
        type: isSerial ? 'сериал' : 'фильм',
        serial: isSerial,
        rating: data.ratingKinopoisk || '',
        description: data.description || data.shortDescription || '',
        poster: data.posterUrlPreview || data.posterUrl || '',
        length: data.filmLength || null,
        genres: (data.genres || []).map(function (genre) { return genre.genre; }),
            countries: (data.countries || []).map(function (country) { return country.country; })
        };
    });
}

// Сезоны и серии
async function getSeasons(kinopoiskId, apiKey) {
    return await cache.through('seasons', kinopoiskId, async function () {
        var data = await fetchJson(KINOPOISK_FILMS + '/' + kinopoiskId + '/seasons', { 'X-API-KEY': apiKey });
        var items = data && data.items ? data.items : [];

        return items.map(function (season) {
            return {
                number: season.number,
                episodes: (season.episodes || []).map(function (episode) {
                    return {
                        number: episode.episodeNumber,
                        title: episode.nameRu || episode.nameEn || '',
                        date: episode.releaseDate || ''
                    };
                })
            };
        });
    });
}

// Разбор ответа Kinobox
function normalizePlayers(list) {
    var players = list
        .filter(function (item) { return item && item.iframeUrl; })
        .map(function (item) {
            var seen = {};
            var translations = (item.translations || [])
                .filter(function (translation) { return translation && translation.name; })
                .map(function (translation) {
                    return {
                        id: translation.id !== undefined ? translation.id : null,
                        name: translation.name,
                        quality: translation.quality || '',
                        iframeUrl: normalizeUrl(translation.iframeUrl || item.iframeUrl)
                    };
                })
                .filter(function (translation) {
                    var key = translation.name + '|' + translation.iframeUrl;
                    if (seen[key]) return false;
                    seen[key] = true;
                    return true;
                });

            var quality = translations.map(function (translation) { return translation.quality; })
                .filter(Boolean)[0] || '-';

            var directFast = extractors.isDirectSupported(item.type, item.iframeUrl);

            return {
                source: item.type || 'unknown',
                translation: translations.length > 0 ? translations[0].name : 'Не указано',
                quality: quality,
                translations: translations,
                iframeUrl: normalizeUrl(item.iframeUrl),
                direct: directFast
            };
        });

function getPlayerPriority(item) {
    var s = (item.source || '').toLowerCase();
    if (s.indexOf('collaps') >= 0) return 100;
    if (s.indexOf('kodik') >= 0) return 80;
    if (s.indexOf('alloha') >= 0) return 60;
    if (s.indexOf('veoveo') >= 0) return 50;
    if (item.direct) return 40;
    return 10;
}

// Прямые и самые функциональные плееры (Collaps, Kodik) ставим первыми
players.sort(function (a, b) {
    return getPlayerPriority(b) - getPlayerPriority(a);
});

    return players;
}

// Список доступных плееров
async function requestPlayers(param, value) {
    var configuredMirror = config.resolveKinoboxApi();
    var mirrors = configuredMirror
        ? [configuredMirror].concat(KINOBOX_MIRRORS.filter(function (m) { return m !== configuredMirror; }))
        : KINOBOX_MIRRORS.slice();

    var lastError = null;

    for (var i = 0; i < mirrors.length; i++) {
        var mirrorBase = mirrors[i];
        var url = mirrorBase + (mirrorBase.indexOf('?') >= 0 ? '&' : '?') + param + '=' + encodeURIComponent(value);

        try {
            var data = await fetchJson(url, {
                'Referer': 'https://kinobox.tv/',
                'Origin': 'https://kinobox.tv'
            });

            if (data && data.error) {
                throw new Error(data.error.title || 'Kinobox вернул ошибку');
            }

            var players = normalizePlayers(data && data.data ? data.data : []);
            if (players.length > 0) return players;

            lastError = new Error('пустой список плееров');
        } catch (err) {
            lastError = err;
        }
    }

    throw new Error('Плееры не получены: ' + (lastError ? lastError.message : 'нет ответа'));
}

// ---------- Прямые API-запросы к балансерам (адаптировано из Lampa online_mod.js) ----------
//
// Kinobox иногда не отдаёт все доступные плееры. Прямые запросы к API балансеров
// по KP ID — резервный (и часто основной) источник, не зависящий от Kinobox.
// Адреса взяты из рабочего плагина nb557/online_mod.js (567K+, >25 балансеров).

var DIRECT_COLLAPS_MIRRORS = [
    'https://api.kinogram.best/embed/kp/',
    'https://api.ortified.ws/embed/kp/'
];

var CDNVIDEOHUB_API = 'https://plapi.cdnvideohub.com/api/v1/player/sv/playlist?pub=12&aggr=kp&id=';

// Прямые запросы к балансерам по KP ID. Возвращает массив player-объектов
// (формат как у normalizePlayers): source, translation, iframeUrl, direct.
async function getPlayersDirectApi(kinopoiskId) {
    var directPlayers = [];

    // 1. Collaps через kinogram.best / ortified.ws — прямой embed по KP ID
    for (var i = 0; i < DIRECT_COLLAPS_MIRRORS.length; i++) {
        try {
            var collapsUrl = DIRECT_COLLAPS_MIRRORS[i] + kinopoiskId;
            var collapsRes = await http.request(collapsUrl, {
                referer: 'https://kinobox.tv/',
                timeout: 8000
            });

            if (collapsRes.ok && collapsRes.body.length > 1000) {
                directPlayers.push({
                    source: 'Collaps',
                    translation: 'Мультиозвучка',
                    quality: 'HLS',
                    translations: [],
                    iframeUrl: collapsUrl,
                    direct: true,
                    fromDirect: true
                });
                break; // Один рабочий Collaps достаточно
            }
        } catch (e) {}
    }

    // 2. CDNVideoHub — JSON API с озвучками
    try {
        var cvhRes = await http.request(CDNVIDEOHUB_API + kinopoiskId, {
            accept: 'application/json',
            timeout: 6000
        });

        if (cvhRes.ok && cvhRes.body.length > 10) {
            var cvhData = null;
            try { cvhData = JSON.parse(cvhRes.body); } catch (e) {}

            if (cvhData && cvhData.items && cvhData.items.length > 0) {
                var cvhTranslations = cvhData.items.map(function (item) {
                    return {
                        id: item.cvhId,
                        name: item.voiceStudio || item.voiceType || 'Неизвестно',
                        quality: '',
                        iframeUrl: 'https://plapi.cdnvideohub.com/api/v1/player/sv/' + item.cvhId
                    };
                });

                directPlayers.push({
                    source: 'CDNVideoHub',
                    translation: cvhTranslations[0].name,
                    quality: '-',
                    translations: cvhTranslations,
                    iframeUrl: 'https://plapi.cdnvideohub.com/api/v1/player/sv/' + cvhData.items[0].cvhId,
                    direct: false,
                    fromDirect: true
                });
            }
        }
    } catch (e) {}

    return directPlayers;
}

// Ссылки на iframe живут недолго, поэтому кеш здесь короткий — четверть часа.
// Этого хватает, чтобы переход «серия → назад → другая серия» не ходил в сеть.
function getPlayers(kinopoiskId) {
    return cache.through('players', 'kp:' + kinopoiskId, async function () {
        // Запускаем Kinobox и прямые API параллельно — быстрее и надёжнее
        var kinoboxPromise = requestPlayers('kinopoisk', kinopoiskId).catch(function () { return []; });
        var directPromise = getPlayersDirectApi(kinopoiskId).catch(function () { return []; });

        var results = await Promise.all([kinoboxPromise, directPromise]);
        var kinoboxPlayers = results[0];
        var directPlayers = results[1];

        // Собираем прямые API источники в словарь для быстрого поиска
        var directBySource = {};
        directPlayers.forEach(function (dp) {
            directBySource[(dp.source || '').toLowerCase()] = dp;
        });

        // Проходим Kinobox-плееры: если для того же балансера есть прямой API
        // с другим URL (рабочим зеркалом) — **заменяем**, а не дублируем.
        // Пример: Kinobox даёт Collaps → ortified.ws (422), а прямой API →
        // kinogram.best (200, HLS) — ставим kinogram.best вместо мёртвого.
        var usedDirectSources = {};
        var merged = kinoboxPlayers.map(function (kp) {
            var src = (kp.source || '').toLowerCase();
            var directAlt = directBySource[src];

            if (directAlt && directAlt.iframeUrl !== kp.iframeUrl) {
                usedDirectSources[src] = true;
                return directAlt; // рабочее зеркало вместо мёртвого
            }

            return kp;
        });

        // Добавляем прямые API, которых нет в Kinobox (CDNVideoHub и т.д.)
        directPlayers.forEach(function (dp) {
            var dpSrc = (dp.source || '').toLowerCase();
            if (!usedDirectSources[dpSrc] && !kinoboxPlayers.some(function (kp) {
                return (kp.source || '').toLowerCase() === dpSrc;
            })) {
                merged.push(dp);
            }
        });

        if (merged.length === 0) {
            throw new Error('Плееры не получены ни из Kinobox, ни из прямых API');
        }

        return merged;
    });
}

function getPlayersByTitle(title) {
    return cache.through('players', 'title:' + title, function () {
        return requestPlayers('title', title);
    });
}

function parseFilmId(query) {
    if (/^\d+$/.test(String(query || '').trim())) return String(query).trim();

    var match = String(query || '').match(/kinopoisk\.[a-z]+\/(?:film|series)\/(\d+)/i);
    return match ? match[1] : null;
}

function normalizeUrl(url) {
    if (url.indexOf('//') === 0) return 'https:' + url;
    return url;
}

function withEpisode(iframeUrl, season, episode) {
    if (!season && !episode) return iframeUrl;

    var url = new URL(iframeUrl);
    if (season) url.searchParams.set('season', String(season));
    if (episode) url.searchParams.set('episode', String(episode));

    return url.toString();
}

module.exports = {
    USER_AGENT: USER_AGENT,
    searchFilms: searchFilms,
    parseFilmId: parseFilmId,
    getFilm: getFilm,
    getSeasons: getSeasons,
    getPlayers: getPlayers,
    getPlayersByTitle: getPlayersByTitle,
    getPlayersDirectApi: getPlayersDirectApi,
    withEpisode: withEpisode
};
