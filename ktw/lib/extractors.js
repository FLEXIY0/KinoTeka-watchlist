'use strict';

// Прямые экстракторы потоков из балансеров.
//
// Браузер здесь не используется вообще: Chromium из зависимостей убран, а
// значит каждый балансер должен разбираться напрямую по HTML и его API.
// Каждый экстрактор либо возвращает объект потока, либо бросает BalancerError
// с понятной причиной (регион, протухшая ссылка, DPI провайдера) — молчаливый
// null раньше превращал любую поломку в бесполезное «поток не найден».

var http = require('./http');

var USER_AGENT = http.USER_AGENT;
var BalancerError = http.BalancerError;

// Ссылки на плейлисты внутри JS: и обычные, и с экранированными слэшами
var M3U8_RE = /https?:(?:\\?\/){2}(?:[^"'\s\\]|\\\/)+?\.(?:m3u8|mpd)(?:\?(?:[^"'\s\\]|\\\/)*)?/ig;

function unescapeUrl(url) {
    return String(url).replace(/\\\//g, '/').replace(/\\u002[fF]/g, '/').replace(/&amp;/g, '&');
}

// Разбор JS-литерала объекта из текста
function parseJsObject(code) {
    if (!code) return null;

    try {
        var clean = code.trim();

        if (clean[0] !== '{' || clean[clean.length - 1] !== '}') {
            var firstBrace = clean.indexOf('{');
            var lastBrace = clean.lastIndexOf('}');
            if (firstBrace >= 0 && lastBrace > firstBrace) {
                clean = clean.slice(firstBrace, lastBrace + 1);
            }
        }

        return new Function('return (' + clean + ');')();
    } catch (err) {
        return null;
    }
}

// Вырезать сбалансированный объект, начиная с первой «{» после позиции
function sliceBalanced(text, from) {
    var start = text.indexOf('{', from);
    if (start < 0) return null;

    var depth = 0;

    for (var i = start; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') {
            depth--;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }

    return null;
}

// Все плейлисты, встречающиеся в тексте страницы
function scanPlaylists(text) {
    var found = [];
    var seen = {};
    var match;

    M3U8_RE.lastIndex = 0;

    while ((match = M3U8_RE.exec(text)) !== null) {
        var url = unescapeUrl(match[0]);

        // Реклама и превью — не контент
        if (/(vast|vmap|vpaid|advert|\/ads?\/|preroll|midroll|postroll|trailer|preview|sprite|thumb)/i.test(url)) continue;
        if (seen[url]) continue;

        seen[url] = true;
        found.push(url);
    }

    return found;
}

function baseResult(type, url, pageUrl, extra) {
    var origin = new URL(pageUrl).origin;

    return Object.assign({
        type: type,
        url: url,
        referer: origin + '/',
        origin: origin,
        userAgent: USER_AGENT,
        audioTracks: [],
        subtitles: [],
        duration: 0,
        title: '',
        direct: true
    }, extra || {});
}

// ---------- Collaps (api.ortified.ws, apicollaps.cc, fprxnet.org) ----------

async function extractCollaps(iframeUrl, options) {
    options = options || {};

    var season = options.season ? parseInt(options.season, 10) : null;
    var episode = options.episode ? parseInt(options.episode, 10) : null;

    var candidates = [iframeUrl];
    if (/ortified\.ws|apicollaps\.cc|fprxnet\.org|collaps/i.test(iframeUrl)) {
        var kinogramUrl = iframeUrl.replace(/https?:\/\/[^\/]+/i, 'https://api.kinogram.best');
        if (kinogramUrl !== iframeUrl) candidates.push(kinogramUrl);
    }

    var res = null;
    var lastError = null;

    for (var i = 0; i < candidates.length; i++) {
        try {
            res = await http.requestOk(candidates[i], {
                referer: options.referer || 'https://kinobox.tv/',
                timeout: options.timeout || 12000
            });
            if (res && res.body && (res.body.indexOf('makePlayer') >= 0 || res.body.indexOf('data-name="mk"') >= 0 || /\.m3u8|\.mpd/.test(res.body))) {
                break;
            }
        } catch (e) {
            lastError = e;
            if (e.code === 'geo' || e.code === 'gone') break;
        }
    }

    if (!res || !res.body) {
        throw lastError || BalancerError(http.hostOf(iframeUrl) + ': в ответе нет данных плеера', 'noplaylist');
    }

    var html = res.body;
    var hlsUrl = null;
    var dashUrl = null;
    var audioTracks = [];
    var subtitles = [];
    var duration = 0;
    var title = '';
    var callMatch = html.match(/makePlayer\s*\(\s*\{/);
    var makePlayerAt = callMatch ? callMatch.index : -1;
    if (makePlayerAt < 0) {
        var mkMatch = html.match(/<script[^>]*data-name="mk"[^>]*>([\s\S]*?)<\/script>/i);
        if (mkMatch) {
            makePlayerAt = html.indexOf(mkMatch[1]);
        }
    }
    var cfg = makePlayerAt >= 0 ? parseJsObject(sliceBalanced(html, makePlayerAt)) : null;

    if (cfg) {
        if (cfg.title) title = cfg.title;

        var source = null;

        if (cfg.playlist && cfg.playlist.seasons && cfg.playlist.seasons.length > 0) {
            var targetSeason = season
                ? cfg.playlist.seasons.find(function (s) { return s.season === season; })
                : null;
            if (!targetSeason) targetSeason = cfg.playlist.seasons[0];

            if (targetSeason && targetSeason.episodes && targetSeason.episodes.length > 0) {
                source = episode
                    ? targetSeason.episodes.find(function (e) { return parseInt(e.episode, 10) === episode; })
                    : null;
                if (!source) source = targetSeason.episodes[0];
            }
        } else if (cfg.source) {
            source = cfg.source;
        }

        if (source) {
            hlsUrl = source.hls || null;
            dashUrl = source.dash || source.dasha || null;
            duration = source.duration || 0;
            if (source.title) title = source.title;

            // audio.order — это номер рендиции в мастер-плейлисте: order 0
            // соответствует index-a1.m3u8, то есть mpv --aid=1. Без этой
            // привязки выбранная озвучка не доезжала до плеера и mpv брал
            // дорожку по умолчанию — у Collaps это часто оригинал (ENG).
            if (source.audio && source.audio.names) {
                audioTracks = source.audio.names.map(function (name, idx) {
                    var order = (source.audio.order && source.audio.order[idx] !== undefined)
                        ? parseInt(source.audio.order[idx], 10)
                        : idx;

                    if (isNaN(order)) order = idx;

                    return {
                        name: name,
                        index: idx,
                        order: order,
                        audioId: order + 1,
                        lang: languageOf(name)
                    };
                });
            }

            if (Array.isArray(source.cc)) {
                subtitles = source.cc
                    .filter(function (c) { return c && c.url; })
                    .map(function (c) { return { name: c.name || 'Субтитры', url: c.url }; });
            }
        }
    }

    if (!hlsUrl && !dashUrl) {
        var scanned = scanPlaylists(html);
        if (scanned.length > 0) hlsUrl = scanned[0];
    }

    if (!hlsUrl && !dashUrl) {
        throw BalancerError(http.hostOf(iframeUrl) + ': в ответе нет ссылки на плейлист', 'noplaylist');
    }

    return baseResult('collaps', hlsUrl || dashUrl, res.url, {
        hlsUrl: hlsUrl,
        dashUrl: dashUrl,
        audioTracks: audioTracks,
        subtitles: subtitles,
        duration: duration,
        title: title
    });
}

// ---------- Veoveo / Voidboost (tazaromikaz.link) ----------
//
// Плеер — SPA на Vite: сам iframe отдаёт только конфиг, а поток берётся из
// catalog-api. Адрес базы лежит в window.ENV_BASE_URL, а ключи доступа —
// в window.REQUEST_HEADERS (DLE-API-TOKEN и Iframe-Request-Id). Тот же
// Iframe-Request-Id вшит в подписанный путь плейлиста, поэтому заголовки
// нельзя выдумывать — только брать со страницы.

function parseVeoveoConfig(html) {
    var baseMatch = html.match(/window\.ENV_BASE_URL\s*=\s*['"]([^'"]+)['"]/);
    if (!baseMatch) return null;

    var headers = {};
    var headersAt = html.indexOf('window.REQUEST_HEADERS');

    if (headersAt >= 0) {
        var literal = sliceBalanced(html, headersAt);
        var parsed = literal ? parseJsObject(literal) : null;

        if (parsed) {
            Object.keys(parsed).forEach(function (key) {
                if (typeof parsed[key] === 'string') headers[key] = parsed[key];
            });
        }
    }

    return { base: baseMatch[1], headers: headers };
}

// Из episodeVariants делаем список озвучек с готовой ссылкой
function veoveoVariants(episode) {
    return (episode.episodeVariants || [])
        .filter(function (variant) { return variant && (variant.filepath || variant.m3u8MasterFilePath); })
        .map(function (variant, idx) {
            return {
                name: variant.title || ('Дорожка ' + (idx + 1)),
                url: variant.filepath || variant.m3u8MasterFilePath,
                duration: variant.duration || 0,
                index: idx,
                lang: languageOf(variant.title || '')
            };
        });
}

async function extractVeoveo(iframeUrl, options) {
    options = options || {};

    var res = await http.requestOk(iframeUrl, {
        referer: options.referer || 'https://kinobox.tv/',
        timeout: options.timeout || 12000
    });

    var config = parseVeoveoConfig(res.body);

    if (!config) {
        throw BalancerError(http.hostOf(iframeUrl) + ': в странице плеера нет ENV_BASE_URL', 'noconfig');
    }

    var movieId = new URL(res.url).searchParams.get('movie_id') ||
        new URL(iframeUrl).searchParams.get('movie_id');

    if (!movieId) {
        throw BalancerError(http.hostOf(iframeUrl) + ': в ссылке нет movie_id', 'noid');
    }

    var origin = new URL(res.url).origin;

    var apiRes = await http.requestOk(config.base + '/catalog-api/episodes?content-id=' + encodeURIComponent(movieId), {
        referer: origin + '/',
        origin: origin,
        accept: 'application/json',
        headers: config.headers,
        timeout: options.timeout || 12000
    });

    var episodes;

    try {
        episodes = JSON.parse(apiRes.body);
    } catch (err) {
        throw BalancerError(http.hostOf(iframeUrl) + ': catalog-api вернул не JSON', 'badjson');
    }

    if (!Array.isArray(episodes) || episodes.length === 0) {
        throw BalancerError(http.hostOf(iframeUrl) + ': catalog-api не отдал ни одной серии', 'noepisodes');
    }

    var season = options.season ? parseInt(options.season, 10) : null;
    var episodeNo = options.episode ? parseInt(options.episode, 10) : null;

    var target = null;

    if (season || episodeNo) {
        target = episodes.find(function (item) {
            var seasonOk = !season || (item.season && item.season.order === season);
            var episodeOk = !episodeNo || item.order === episodeNo;
            return seasonOk && episodeOk;
        });
    }

    if (!target) target = episodes[0];

    var variants = veoveoVariants(target);

    if (variants.length === 0) {
        throw BalancerError(http.hostOf(iframeUrl) + ': у серии нет ни одной дорожки', 'notracks');
    }

    var chosen = null;

    if (options.translation) {
        var wanted = normalizeName(options.translation);
        chosen = variants.find(function (item) { return namesMatch(normalizeName(item.name), wanted); });
    }

    if (!chosen) {
        var russian = variants.filter(function (v) { return languageOf(v.name) === 'rus'; });
        chosen = russian.length > 0 ? russian[0] : variants[0];
    }

    return baseResult('veoveo', chosen.url, res.url, {
        duration: chosen.duration || 0,
        title: target.title || '',
        audioTracks: variants.map(function (item) {
            return {
                name: item.name,
                url: item.url,
                index: item.index,
                audioId: item.index + 1,
                lang: item.lang
            };
        }),
        variantTracks: variants.map(function (item) {
            return { name: item.name, url: item.url, index: item.index, lang: item.lang };
        })
    });
}

// ---------- Alloha (theatre.stravers.live) ----------

async function extractAlloha(iframeUrl, options) {
    options = options || {};

    var res = await http.requestOk(iframeUrl, {
        referer: options.referer || 'https://kinobox.tv/',
        headers: { 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Mode': 'navigate' },
        timeout: options.timeout || 12000
    });

    var html = res.body;
    var origin = new URL(res.url).origin;

    var fileListMatch = html.match(/fileList\s*=\s*JSON\.parse\s*\(\s*['"]([\s\S]*?)['"]\s*\)/);
    var tokenMatch = html.match(/token\s*:\s*['"]([a-f0-9]+)['"]/i);

    if (fileListMatch && tokenMatch) {
        var fileList = null;

        try {
            fileList = JSON.parse(fileListMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
        } catch (err) {
            fileList = null;
        }

        var activeId = fileList && fileList.active ? fileList.active.id : null;

        if (activeId) {
            var listRes = await http.request(origin + '/lists.php', {
                method: 'POST',
                referer: res.url,
                origin: origin,
                accept: 'application/json',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
                body: 'id=' + encodeURIComponent(activeId) + '&token=' + encodeURIComponent(tokenMatch[1]),
                timeout: options.timeout || 12000
            });

            if (listRes.ok) {
                var data = null;
                try { data = JSON.parse(listRes.body); } catch (err) { data = null; }

                var streamUrl = data && (data.file || data.hls || data.url);
                if (streamUrl) return baseResult('alloha', unescapeUrl(streamUrl), res.url);
            }
        }
    }

    var scanned = scanPlaylists(html);
    if (scanned.length > 0) return baseResult('alloha', scanned[0], res.url);

    throw BalancerError(http.hostOf(iframeUrl) + ': в ответе нет ссылки на плейлист', 'noplaylist');
}

// ---------- Kodik ----------
//
// Kodik отдаёт ссылки не в HTML, а из POST /ftor, и каждая ссылка закодирована
// сдвигом по алфавиту поверх base64. Сдвиг они периодически меняют, поэтому
// перебираем все 25 и берём тот, что даёт настоящий URL.

function kodikDecode(value) {
    for (var shift = 1; shift < 26; shift++) {
        var rotated = String(value).replace(/[a-zA-Z]/g, function (ch) {
            var base = ch <= 'Z' ? 65 : 97;
            return String.fromCharCode((ch.charCodeAt(0) - base + shift) % 26 + base);
        });

        var decoded = '';

        try {
            decoded = Buffer.from(rotated, 'base64').toString('utf8');
        } catch (err) {
            continue;
        }

        if (/^(https?:)?\/\/[\w.-]+\//.test(decoded)) {
            return decoded.indexOf('//') === 0 ? 'https:' + decoded : decoded;
        }
    }

    return null;
}

async function extractKodik(iframeUrl, options) {
    options = options || {};

    var res = await http.requestOk(iframeUrl, {
        referer: options.referer || 'https://kinobox.tv/',
        timeout: options.timeout || 12000
    });

    var html = res.body;
    var origin = new URL(res.url).origin;

    var paramsAt = html.indexOf('urlParams');
    var params = paramsAt >= 0 ? parseJsObject(sliceBalanced(html, paramsAt)) : null;

    if (!params) {
        var raw = html.match(/urlParams\s*=\s*'([^']+)'/);
        if (raw) {
            try { params = JSON.parse(raw[1]); } catch (err) { params = null; }
        }
    }

    var idMatch = html.match(/videoInfo\.id\s*=\s*['"]?([\w-]+)/) || html.match(/"id"\s*:\s*"?([\w-]+)"?/);
    var typeMatch = html.match(/videoInfo\.type\s*=\s*['"]([\w-]+)['"]/);
    var hashMatch = html.match(/videoInfo\.hash\s*=\s*['"]([\w-]+)['"]/);

    if (!params || !idMatch || !typeMatch || !hashMatch) {
        throw BalancerError(http.hostOf(iframeUrl) + ': не разобрал параметры плеера', 'noparams');
    }

    var form = new URLSearchParams();
    form.set('id', idMatch[1]);
    form.set('type', typeMatch[1]);
    form.set('hash', hashMatch[1]);
    form.set('d', params.d || '');
    form.set('d_sign', params.d_sign || '');
    form.set('pd', params.pd || '');
    form.set('pd_sign', params.pd_sign || '');
    form.set('ref', params.ref || '');
    form.set('ref_sign', params.ref_sign || '');
    form.set('bad_user', 'false');
    form.set('cdn_is_working', 'true');

    var apiRes = await http.requestOk(origin + '/ftor', {
        method: 'POST',
        referer: res.url,
        origin: origin,
        accept: 'application/json',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest'
        },
        body: form.toString(),
        timeout: options.timeout || 12000
    });

    var data = null;
    try { data = JSON.parse(apiRes.body); } catch (err) { data = null; }

    var links = data && data.links ? data.links : null;

    if (!links) {
        throw BalancerError(http.hostOf(iframeUrl) + ': /ftor не отдал ссылки', 'nolinks');
    }

    // Берём самое высокое качество из отданных
    var qualities = Object.keys(links).sort(function (a, b) { return parseInt(b, 10) - parseInt(a, 10); });

    for (var i = 0; i < qualities.length; i++) {
        var entry = links[qualities[i]];
        var src = Array.isArray(entry) ? (entry[0] && entry[0].src) : entry;
        var decoded = src ? kodikDecode(src) : null;

        if (decoded) return baseResult('kodik', decoded, res.url);
    }

    throw BalancerError(http.hostOf(iframeUrl) + ': не смог раскодировать ссылки /ftor', 'nodecode');
}

// ---------- Универсальный разбор (Turbo/obrut.show и всё остальное) ----------
//
// Балансеров больше, чем экстракторов, и адреса у них меняются. Общий проход
// умеет немного: найти плейлист прямо в HTML и спуститься на один вложенный
// iframe. Этого хватает для простых плееров и не мешает остальным.

async function extractGeneric(iframeUrl, options) {
    options = options || {};

    var res = await http.requestOk(iframeUrl, {
        referer: options.referer || 'https://kinobox.tv/',
        timeout: options.timeout || 10000
    });

    var scanned = scanPlaylists(res.body);
    if (scanned.length > 0) return baseResult('direct', scanned[0], res.url);

    // Плеер часто оборачивает настоящий в ещё один iframe
    if (!options.noNested) {
        var nested = res.body.match(/<iframe[^>]+src=["']([^"']+)["']/i);

        if (nested) {
            var nestedUrl = new URL(unescapeUrl(nested[1]), res.url).toString();

            if (nestedUrl !== res.url) {
                return await extractGeneric(nestedUrl, Object.assign({}, options, {
                    noNested: true,
                    referer: res.url
                }));
            }
        }
    }

    throw BalancerError(http.hostOf(iframeUrl) + ': в ответе нет ссылки на плейлист', 'noplaylist');
}

// ---------- маршрутизация ----------

var ROUTES = [
    { name: 'collaps', test: /ortified|collaps|fprxnet|interkh|kinogram/i, run: extractCollaps },
    { name: 'veoveo',  test: /tazaromikaz|voidboost|veoveo/i,     run: extractVeoveo },
    { name: 'alloha',  test: /stravers|alloha/i,                  run: extractAlloha },
    { name: 'kodik',   test: /kodik/i,                            run: extractKodik },
    { name: 'turbo',   test: /obrut|turbo/i,                      run: extractGeneric }
];

function routeFor(iframeUrl) {
    var haystack = String(iframeUrl || '');

    for (var i = 0; i < ROUTES.length; i++) {
        if (ROUTES[i].test.test(haystack)) return ROUTES[i];
    }

    return null;
}

// Универсальная точка входа. Возвращает поток или null; все причины отказа
// складываются в options.errors, чтобы вызывающий мог их показать.
async function extractDirectStream(iframeUrl, options) {
    if (!iframeUrl) return null;

    options = options || {};
    var errors = options.errors || [];

    var attempts = [];
    var route = routeFor(iframeUrl);

    if (route) attempts.push(route);

    // Общий проход как запасной — вдруг балансер сменил домен
    if (!route || route.run !== extractGeneric) {
        attempts.push({ name: 'generic', run: extractGeneric });
    }

    for (var i = 0; i < attempts.length; i++) {
        try {
            var result = await attempts[i].run(iframeUrl, options);
            if (result && result.url) return result;
        } catch (err) {
            err.balancer = attempts[i].name;
            errors.push(err);

            // Регион и протухшая ссылка не лечатся другим парсером
            if (err.code === 'geo' || err.code === 'gone') break;
        }
    }

    return null;
}

// Поддерживается ли плеер прямым экстрактором
function isDirectSupported(sourceName, iframeUrl) {
    var haystack = (sourceName || '') + ' ' + (iframeUrl || '');
    return ROUTES.some(function (route) { return route.test.test(haystack); });
}

// ---------- сопоставление названий озвучек ----------

function normalizeName(name) {
    return String(name || '')
        .toLowerCase()
        .replace(/^\s*\d+[.)]\s*/, '')      // «01. Дубляж» -> «дубляж»
        .replace(/\((?:rus|eng|ukr|ua|en|ru)\)/gi, '')
        .replace(/\bac3\b|\bdts\b|\baac\b/gi, '')
        .replace(/[^\wа-яё]+/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function namesMatch(a, b) {
    if (!a || !b) return false;
    return a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0;
}

// Язык дорожки. Атрибута LANGUAGE у балансеров нет вовсе — язык зашит в само
// название: «02. Дубляж (RUS)», «17. Оригинал (ENG)», «16. Многоголосый (UKR)».
// Раньше суффикс просто вырезался, и «Оригинал (ENG)» совпадал с русским
// «Оригинал» — так в плеер и приезжала английская дорожка.
function languageOf(name) {
    var text = String(name || '');

    if (/\((?:rus|ru)\)|\bрус\b|\bдубл|\bмногогол|\bдвухгол|\bодногол|\bзакадр/i.test(text)) return 'rus';
    if (/\b(?:lostfilm|hdrezka|rezka|fox|jaskier|newstudio|alexfilm|baibako|coldfilm|hamsterstudio|octopus|tvshows|kurazh|redheadsound|rhs|flarrow)\b/i.test(text)) return 'rus';
    if (/\((?:ukr|ua)\)|\bукр\b|\bбагатог/i.test(text)) return 'ukr';
    if (/\((?:eng|en)\)|\bengl\b|original\s*\(eng\)|оригинал\s*\(eng\)/i.test(text)) return 'eng';

    // Кириллица в названии озвучки — русская дорожка
    if (/[а-яё]/i.test(text)) return 'rus';
    if (/\beng\b|\boriginal\b/i.test(text)) return 'eng';

    return '';
}

// Русская ли дорожка. Украинская и оригинальная — нет.
function isRussian(track) {
    return languageOf(track && track.name) === 'rus';
}

module.exports = {
    USER_AGENT: USER_AGENT,
    extractDirectStream: extractDirectStream,
    isDirectSupported: isDirectSupported,
    extractCollaps: extractCollaps,
    extractKodik: extractKodik,
    extractAlloha: extractAlloha,
    extractVeoveo: extractVeoveo,
    extractGeneric: extractGeneric,
    kodikDecode: kodikDecode,
    scanPlaylists: scanPlaylists,
    parseVeoveoConfig: parseVeoveoConfig,
    normalizeName: normalizeName,
    namesMatch: namesMatch,
    languageOf: languageOf,
    isRussian: isRussian
};
