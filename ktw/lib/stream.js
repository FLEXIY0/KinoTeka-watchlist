'use strict';

// Получение прямой ссылки на поток и разбор HLS.
//
// Браузера здесь нет: Chromium из проекта убран целиком, поэтому единственный
// путь — прямые экстракторы (extractors.js). Если балансер не разобрался,
// наверх уходит внятная причина, а не тишина.

var api = require('./api');
var extractors = require('./extractors');
var http = require('./http');

// Короче этого — почти наверняка рекламный ролик, а не серия
var MIN_CONTENT_SECONDS = 300;

// Разбор HLS: мастер-плейлист, длинная серия или короткий ролик?
function analyzeHls(text) {
    if (text.indexOf('#EXT-X-STREAM-INF') >= 0) {
        return { kind: 'master', duration: 0 };
    }

    if (text.indexOf('#EXTINF') < 0) {
        return { kind: 'unknown', duration: 0 };
    }

    var total = 0;
    var re = /#EXTINF:\s*([\d.]+)/g;
    var match;

    while ((match = re.exec(text)) !== null) {
        total += parseFloat(match[1]) || 0;
    }

    return {
        kind: 'media',
        duration: total,
        ended: text.indexOf('#EXT-X-ENDLIST') >= 0
    };
}

// Похоже ли это на настоящий контент, а не на преролл
function looksLikeContent(info) {
    if (info.kind === 'master') return true;
    if (info.kind === 'unknown') return true;
    if (info.ended && info.duration > 0 && info.duration < MIN_CONTENT_SECONDS) return false;

    return true;
}

// Собрать понятное сообщение из накопленных отказов балансеров
function describeFailure(errors) {
    if (!errors || errors.length === 0) return 'балансер не отдал поток';

    var geo = errors.find(function (err) { return err.code === 'geo'; });
    if (geo) return geo.message;

    var network = errors.find(function (err) { return err.code === 'network' || err.code === 'timeout'; });
    if (network) return network.message;

    return errors[0].message;
}

// Основная функция извлечения потока
async function resolveStream(iframeUrl, options) {
    options = options || {};

    var report = options.onProgress || function () { };
    var errors = [];

    report('разбираю плеер напрямую…');

    var found = await extractors.extractDirectStream(iframeUrl, {
        season: options.season,
        episode: options.episode,
        translation: options.translation,
        timeout: options.timeout || 15000,
        errors: errors
    });

    if (!found || !found.url) {
        var failure = new Error(describeFailure(errors));
        failure.name = 'StreamError';
        failure.reasons = errors;
        throw failure;
    }

    report('поток получен напрямую');

    return {
        url: found.url,
        referer: found.referer,
        origin: found.origin,
        userAgent: found.userAgent || api.USER_AGENT,
        audioTracks: found.audioTracks || [],
        // Дорожки из конфига балансера остаются рядом: если мастер-плейлист
        // не прочитается, номер озвучки возьмётся отсюда
        playerTracks: found.audioTracks || [],
        variantTracks: found.variantTracks || [],
        dashUrl: found.dashUrl || '',
        subtitles: found.subtitles || [],
        duration: found.duration || 0,
        title: found.title || '',
        direct: true,
        suspicious: false
    };
}

// Разбор мастер-плейлиста HLS: какие качества предлагает балансер.
//
// Причина отказа кладётся в variants.reason: пустой список без объяснения
// выглядел на экране как «качество: как есть · 1080p» — то есть поломка
// маскировалась под честный выбор, и всегда именно под 1080p, потому что
// подпись бралась из ответа Kinobox, а не из плейлиста.
async function readVariants(stream) {
    if (stream.manifest) {
        return parseMaster(stream.manifest, stream.url, stream.playerTracks || stream.audioTracks);
    }

    var sources = [stream.url];

    // У Collaps рядом с hls всегда лежит dash — пробуем его, если hls закрыт
    if (stream.dashUrl && stream.dashUrl !== stream.url) sources.push(stream.dashUrl);

    var reason = '';

    for (var i = 0; i < sources.length; i++) {
        var res;

        try {
            res = await http.request(sources[i], {
                userAgent: stream.userAgent || api.USER_AGENT,
                referer: stream.referer,
                origin: stream.origin,
                accept: 'application/vnd.apple.mpegurl,application/dash+xml,*/*',
                timeout: 15000
            });
        } catch (err) {
            reason = err.message;
            continue;
        }

        if (!res.ok) {
            var code = http.detectRefusal(res.status, res.body) || 'http';
            reason = http.refusalMessage(code, res.status, http.hostOf(sources[i]));
            continue;
        }

        var variants = parseMaster(res.body, res.url, stream.playerTracks || stream.audioTracks);

        if (variants.length > 0) return variants;

        reason = http.hostOf(sources[i]) + ': в плейлисте нет списка качеств';
    }

    var empty = [];
    empty.reason = reason;

    return empty;
}

// Разбор атрибутов строки #EXT-X-...
function attr(line, name) {
    var match = new RegExp(name + '="([^"]*)"').exec(line) || new RegExp(name + '=([^,\\s]+)').exec(line);
    return match ? match[1] : '';
}

// Разбор мастер-плейлиста в список дорожек.
function parseMaster(text, baseUrl, knownTracks) {
    if (!text || text.indexOf('#EXTM3U') < 0) return [];

    var lines = text.split(/\r?\n/);
    var audioByGroup = {};
    var subsByGroup = {};

    for (var a = 0; a < lines.length; a++) {
        var line = lines[a];

        if (line.indexOf('#EXT-X-MEDIA:') !== 0) continue;

        var mediaType = attr(line, 'TYPE');
        var group = attr(line, 'GROUP-ID');
        var uri = attr(line, 'URI');

        var rawName = attr(line, 'NAME') || '';
        var rawLang = attr(line, 'LANGUAGE') || '';

        var entry = {
            name: rawName,
            lang: rawLang,
            url: uri ? new URL(uri, baseUrl).toString() : null,
            default: /DEFAULT=YES/i.test(line),
            group: group
        };

        if (mediaType === 'AUDIO') {
            if (!audioByGroup[group]) audioByGroup[group] = [];
            var trackIndex = audioByGroup[group].length;
            entry.index = trackIndex;
            entry.audioId = trackIndex + 1;

            var fromKnown = null;
            if (knownTracks && knownTracks.length > 0) {
                fromKnown = knownTracks.find(function (t) { return t.order === trackIndex; }) || knownTracks[trackIndex];
            }

            if (fromKnown && fromKnown.name) {
                // Если у нас техническое имя (rus0, audio0 и т.д.) или пустое
                if (!entry.name || /^rus\d+|^eng\d+|^ukr\d+|^audio\d+/i.test(entry.name)) {
                    entry.name = fromKnown.name;
                }
                entry.lang = fromKnown.lang || entry.lang;
            } else if (!entry.name) {
                entry.name = 'Аудио ' + (trackIndex + 1);
            }

            if (!entry.lang) entry.lang = extractors.languageOf(entry.name);

            audioByGroup[group].push(entry);
        } else if (mediaType === 'SUBTITLES') {
            if (!subsByGroup[group]) subsByGroup[group] = [];
            entry.name = entry.name || ('Субтитры ' + (subsByGroup[group].length + 1));
            subsByGroup[group].push(entry);
        }
    }

    var variants = [];

    for (var i = 0; i < lines.length; i++) {
        if (lines[i].indexOf('#EXT-X-STREAM-INF') !== 0) continue;

        var target = '';

        for (var j = i + 1; j < lines.length; j++) {
            if (lines[j] && lines[j][0] !== '#') { target = lines[j].trim(); break; }
        }

        if (!target) continue;

        var resolution = /RESOLUTION=(\d+)x(\d+)/i.exec(lines[i]);
        var bandwidth = /BANDWIDTH=(\d+)/i.exec(lines[i]);
        var name = /NAME="([^"]+)"/i.exec(lines[i]);
        var width = resolution ? parseInt(resolution[1], 10) : 0;
        var height = resolution ? parseInt(resolution[2], 10) : 0;

        var label = name ? name[1] : '';

        if (!label) {
            if (height >= 2100 || width >= 3800) label = '4K (2160p)';
            else if (height >= 1400 || width >= 2500) label = '2K (1440p)';
            else if (height >= 1000 || width >= 1900) label = '1080p';
            else if (height >= 700 || width >= 1200) label = '720p';
            else if (height >= 450 || width >= 700) label = '480p';
            else if (height >= 300 || width >= 480) label = '360p';
            else if (height) label = height + 'p';
            else label = 'вариант ' + (variants.length + 1);
        }

        var audioGroup = attr(lines[i], 'AUDIO');
        var subGroup = attr(lines[i], 'SUBTITLES');
        var targetUrl = new URL(target, baseUrl).toString();

        if (variants.some(function (item) { return item.url === targetUrl; })) continue;

        variants.push({
            height: height,
            width: width,
            bandwidth: bandwidth ? parseInt(bandwidth[1], 10) : 0,
            label: label,
            url: targetUrl,
            masterUrl: baseUrl,
            audioGroup: audioGroup,
            // Звук лежит отдельно — значит проигрывать надо мастер, а не вариант
            audioSeparate: !!(audioGroup && audioByGroup[audioGroup]),
            audioTracks: audioGroup && audioByGroup[audioGroup] ? audioByGroup[audioGroup] : [],
            subtitles: subGroup && subsByGroup[subGroup] ? subsByGroup[subGroup] : []
        });
    }

    variants.sort(function (a, b) {
        return (b.height - a.height) || (b.bandwidth - a.bandwidth);
    });

    return variants;
}

// Выбор варианта по желаемой высоте / параметру: 1080 -> 1080p, max, min
function pickVariant(variants, wanted) {
    if (!variants || variants.length === 0) return null;
    if (!wanted) return null;

    var normalized = String(wanted).toLowerCase().replace(/p$/, '');

    if (normalized === 'max' || normalized === 'best' || normalized === '4k') return variants[0];
    if (normalized === 'min' || normalized === 'worst') return variants[variants.length - 1];

    var height = parseInt(normalized, 10);
    if (!height) return null;

    // Точное качество, а не «что-нибудь сверху»: раньше 1080 отдавало первый
    // вариант всегда, даже когда 1080p у балансера нет вовсе
    var suitable = variants.filter(function (item) {
        return item.height <= height || item.width <= Math.round(height * 16 / 9);
    });

    return suitable.length > 0 ? suitable[0] : null;
}

// Собрать поток под выбранное качество.
//
// Когда звук вынесен в отдельную группу, URL остаётся мастер-плейлистом, а
// качество задаётся через --hls-bitrate: только так mpv видит и видео, и все
// дорожки озвучки. Подмена URL на вариант — ровно то, из-за чего пропадал звук.
function applyVariant(stream, variant) {
    if (!variant) return stream;

    var next = Object.assign({}, stream, {
        label: variant.label,
        height: variant.height,
        subtitles: variant.subtitles && variant.subtitles.length > 0 ? variant.subtitles : stream.subtitles
    });

    if (variant.audioSeparate) {
        next.url = variant.masterUrl || stream.url;
        next.hlsBitrate = variant.bandwidth || 0;
        next.audioTracks = variant.audioTracks;
    } else {
        next.url = variant.url;
        next.hlsBitrate = 0;
        next.audioTracks = variant.audioTracks && variant.audioTracks.length > 0
            ? variant.audioTracks
            : stream.audioTracks;
    }

    return next;
}

// Подобрать номер звуковой дорожки под название озвучки.
//
// Язык проверяется отдельно от названия: у «Оригинал (ENG)» и русского
// «Оригинал» одинаковые названия, и без этой проверки в плеер уезжала
// английская дорожка.
function matchAudioTrack(tracks, wantedName) {
    if (!tracks || tracks.length === 0 || !wantedName) return null;

    var wanted = extractors.normalizeName(wantedName);
    var wantedLang = extractors.languageOf(wantedName);

    function sameLanguage(track) {
        var lang = extractors.languageOf(track.name);
        return !wantedLang || !lang || lang === wantedLang;
    }

    var candidates = tracks.filter(sameLanguage);

    var exact = candidates.find(function (track) {
        return extractors.normalizeName(track.name) === wanted;
    });

    if (exact) return exact;

    return candidates.find(function (track) {
        return extractors.namesMatch(extractors.normalizeName(track.name), wanted);
    }) || null;
}

// Дорожка по умолчанию, когда озвучку не выбрали или название не совпало.
//
// Просто отдать выбор mpv нельзя: DEFAULT=YES у балансеров стоит как попало, а
// в списке легко оказывается «17. Оригинал (ENG)» — именно так и получался
// английский звук на русском фильме.
function pickDefaultAudio(tracks) {
    if (!tracks || tracks.length === 0) return null;

    var russian = tracks.filter(extractors.isRussian);
    var pool = russian.length > 0 ? russian : tracks;

    return pool.find(function (track) { return track.default; }) || pool[0];
}

// Итоговый номер дорожки для mpv.
//
// Сначала дорожки самого мастер-плейлиста — их порядок и есть --aid. Если
// плейлист прочитать не вышло, берём номер из конфига балансера: у Collaps это
// audio.order, документированная привязка к index-aN.m3u8.
function resolveAudioId(found, wantedName) {
    var matched = matchAudioTrack(found.audioTracks, wantedName);

    if (matched && matched.audioId) return matched.audioId;

    var fromPlayer = matchAudioTrack(found.playerTracks, wantedName);

    if (fromPlayer && fromPlayer.audioId) return fromPlayer.audioId;

    var fallback = pickDefaultAudio(found.audioTracks) || pickDefaultAudio(found.playerTracks);

    return fallback && fallback.audioId ? fallback.audioId : null;
}

module.exports = {
    resolveStream: resolveStream,
    readVariants: readVariants,
    parseMaster: parseMaster,
    pickVariant: pickVariant,
    applyVariant: applyVariant,
    matchAudioTrack: matchAudioTrack,
    pickDefaultAudio: pickDefaultAudio,
    resolveAudioId: resolveAudioId,
    analyzeHls: analyzeHls,
    looksLikeContent: looksLikeContent,
    describeFailure: describeFailure,
    // Браузера больше нет — заглушки, чтобы старые вызовы не падали
    warmup: function () { },
    shutdown: function () { return Promise.resolve(); }
};
