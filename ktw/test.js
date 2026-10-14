'use strict';

// Тесты ktw. Делятся на две части:
//
//   офлайн — гоняются всегда, на записанных ответах балансеров из ktw/fixtures.
//            Именно здесь закрыты обе поломки: звук пропадал при выборе
//            качества, а балансеры кроме Collaps молча не работали;
//   живые  — требуют доступа к сети и балансерам. Если провайдер или регион
//            их режет, тест не падает, а честно помечается пропущенным:
//            иначе непонятно, сломан код или закрыт доступ.
//
// Запуск: node ktw/test.js [--live] [--only=<подстрока>]

var fs = require('fs');
var path = require('path');

var extractors = require('./lib/extractors');
var stream = require('./lib/stream');
var http = require('./lib/http');
var config = require('./lib/config');
var mpv = require('./lib/mpv');
var history = require('./lib/history');
var doctor = require('./lib/doctor');
var api = require('./lib/api');

var passed = 0;
var failed = 0;
var skipped = 0;

var argv = process.argv.slice(2);
var wantLive = argv.indexOf('--live') >= 0;
var onlyArg = argv.find(function (a) { return a.indexOf('--only=') === 0; });
var only = onlyArg ? onlyArg.slice('--only='.length).toLowerCase() : '';

function group(title) {
    console.log('\n\x1b[36m' + title + '\x1b[0m');
}

function assert(condition, message) {
    if (condition) {
        console.log('  \x1b[32m✓\x1b[0m ' + message);
        passed++;
    } else {
        console.error('  \x1b[31m✗\x1b[0m ' + message);
        failed++;
    }
}

function skip(message, why) {
    console.log('  \x1b[2m·\x1b[0m ' + message + ' \x1b[2m(' + why + ')\x1b[0m');
    skipped++;
}

function fixture(name) {
    return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

function wanted(title) {
    return !only || title.toLowerCase().indexOf(only) >= 0;
}

// Подменяем fetch на заранее записанные ответы: тесты разбора не должны
// зависеть ни от сети, ни от того, пускает ли балансер наш регион.
function withStubbedFetch(routes, run) {
    var original = globalThis.fetch;

    globalThis.fetch = async function (url) {
        var target = String(url);
        var key = Object.keys(routes).find(function (part) { return target.indexOf(part) >= 0; });

        if (!key) return new Response('not stubbed: ' + target, { status: 599 });

        var route = routes[key];

        return new Response(route.body, { status: route.status || 200, headers: route.headers || {} });
    };

    return Promise.resolve()
        .then(run)
        .finally(function () { globalThis.fetch = original; });
}

// ---------- офлайн: разбор мастер-плейлиста и звук ----------

async function testMasterPlaylist() {
    group('Мастер-плейлист и звуковые дорожки');

    var text = fixture('master-multiaudio.m3u8');
    var variants = stream.parseMaster(text, 'https://cdn.example.com/a/b/master.m3u8?pl=TESTSIG');

    assert(variants.length === 3, 'разобраны все три качества (' + variants.length + ')');
    assert(variants[0].label === '1080p' && variants[1].label === '720p' && variants[2].label === '480p',
        'качества подписаны по ширине кадра: ' + variants.map(function (v) { return v.label; }).join(', '));

    assert(variants[0].audioGroup === 'audio1080' && variants[1].audioGroup === 'audio720',
        'каждое качество ссылается на свою группу звука');

    assert(variants[0].audioTracks.length > 0 && variants[1].audioTracks.length > 0,
        'дорожки озвучки привязаны к качеству (' + variants[0].audioTracks.length + ' шт.)');

    assert(variants[0].audioTracks.every(function (t) { return t.group === 'audio1080'; }),
        'в 1080p попали только дорожки его группы, а не все подряд');

    assert(variants[0].audioSeparate === true,
        'звук распознан как отдельные рендиции — вариант качества сам по себе немой');

    assert(variants[0].subtitles.length === 2, 'субтитры разобраны (' + variants[0].subtitles.length + ')');

    var ids = variants[0].audioTracks.map(function (t) { return t.audioId; });
    assert(ids.join(',') === '1,2,3', 'дорожки пронумерованы с единицы, как их считает mpv: ' + ids.join(','));
}

async function testNoSoundRegression() {
    group('Регрессия: пропадал звук при выборе качества');

    var text = fixture('master-multiaudio.m3u8');
    var masterUrl = 'https://cdn.example.com/a/b/master.m3u8?pl=TESTSIG';
    var variants = stream.parseMaster(text, masterUrl);
    var base = { url: masterUrl, referer: 'https://h/', origin: 'https://h', audioTracks: [], subtitles: [] };

    var hd = variants.find(function (v) { return v.label === '720p'; });
    var applied = stream.applyVariant(base, hd);

    assert(applied.url === masterUrl,
        'после выбора 720p URL остался мастер-плейлистом, а не немой видеодорожкой');
    assert(applied.url.indexOf('index-v') < 0,
        'в mpv не уходит index-v*.m3u8 — ровно этот файл и был без звука');
    assert(applied.hlsBitrate === hd.bandwidth,
        'качество задано через --hls-bitrate=' + applied.hlsBitrate);
    assert(applied.audioTracks.length === hd.audioTracks.length,
        'дорожки озвучки выбранного качества доехали до плеера');

    var args = mpv.buildArgs(applied, 'Тест');
    assert(args.indexOf('--hls-bitrate=' + hd.bandwidth) >= 0, 'mpv получает --hls-bitrate');
    assert(args[args.length - 1] === masterUrl, 'последним аргументом mpv идёт мастер-плейлист');

    // Когда звук вшит в сам вариант, подменять URL по-прежнему правильно
    var muxed = {
        label: '720p', url: 'https://cdn/v720.m3u8', bandwidth: 100,
        audioSeparate: false, audioTracks: [], subtitles: []
    };
    var appliedMuxed = stream.applyVariant(base, muxed);
    assert(appliedMuxed.url === 'https://cdn/v720.m3u8' && !appliedMuxed.hlsBitrate,
        'если звук вшит в дорожку качества, играем саму дорожку');
}

async function testAudioMatching() {
    group('Выбор озвучки по названию');

    var variants = stream.parseMaster(fixture('master-multiaudio.m3u8'), 'https://cdn/m.m3u8');
    var tracks = variants[0].audioTracks;

    var dub = stream.matchAudioTrack(tracks, 'Дубляж');
    assert(dub && dub.audioId === 2, 'озвучка «Дубляж» нашлась под номером ' + (dub && dub.audioId));

    var numbered = stream.matchAudioTrack(tracks, '01. Многоголосый. Jask');
    assert(numbered && numbered.audioId === 1, 'номер в начале названия не мешает сопоставлению');

    assert(stream.matchAudioTrack(tracks, 'Такой озвучки нет') === null,
        'несуществующая озвучка возвращает null, а не случайную дорожку');

    assert(stream.matchAudioTrack([], 'Дубляж') === null, 'пустой список дорожек не ломает выбор');
}

async function testMpvArgs() {
    group('Аргументы mpv');

    var socket = '/tmp/ktw-mpv-test.sock';
    var args = mpv.buildArgs({
        url: 'https://cdn/master.m3u8',
        referer: 'https://h/',
        origin: 'https://h',
        audioId: 3,
        audioTracks: [{}, {}, {}],
        startTime: 1450,
        subtitleUrl: 'https://cdn/subs.vtt'
    }, 'Матрица (1999)', ['--volume=80'], socket);

    assert(args.indexOf('--input-ipc-server=' + socket) >= 0, 'есть --input-ipc-server для таймкода');
    assert(args.indexOf('--start=1450') >= 0, 'есть --start=1450 для возобновления');
    assert(args.indexOf('--aid=3') >= 0, 'есть --aid=3 для звуковой дорожки');
    assert(args.some(function (a) { return a.indexOf('--sub-file=') === 0; }), 'подключены субтитры');
    assert(args.indexOf('--volume=80') >= 0, 'проброшены пользовательские аргументы');
    assert(args.some(function (a) { return a.indexOf('--autofit=') === 0; }), 'компактный размер окна из коробки');

    // Именно так и получался немой mpv: --aid на дорожку, которой нет
    var bad = mpv.buildArgs({
        url: 'u', referer: 'r', origin: 'o', audioId: 15, audioTracks: [{}, {}]
    }, 'T');
    assert(!bad.some(function (a) { return a.indexOf('--aid=') === 0; }),
        '--aid за пределами списка дорожек отбрасывается, а не отдаётся mpv');

    var external = mpv.buildArgs({ url: 'u', referer: 'r', origin: 'o', audioUrl: 'https://cdn/a.m3u8' }, 'T');
    assert(external.indexOf('--audio-file=https://cdn/a.m3u8') >= 0,
        'отдельный звук цепляется через --audio-file');

    // --cache-secs перебивает --demuxer-readahead-secs и по умолчанию равен 10 с:
    // без него буфер стоял пустым и видео замирало на каждом сегменте
    var secs = args.find(function (a) { return a.indexOf('--cache-secs=') === 0; });
    assert(!!secs && parseInt(secs.split('=')[1], 10) >= 120,
        'буфер набирается на минуты вперёд: ' + secs);
    assert(args.indexOf('--alang=rus,ru,russian') >= 0, 'русская дорожка запрошена и по языку');
}

// ---------- офлайн: балансеры ----------

async function testVeoveoOffline() {
    group('Балансер Veoveo (записанные ответы)');

    var iframeUrl = 'https://tazaromikaz.link/balancer-api/iframe?movie_id=15652&token=TEST.API.TOKEN';
    var seenHeaders = null;
    var original = globalThis.fetch;

    globalThis.fetch = async function (url, options) {
        var target = String(url);

        if (target.indexOf('/balancer-api/iframe') >= 0) {
            return new Response(fixture('veoveo-iframe.html'), { status: 200 });
        }

        if (target.indexOf('/catalog-api/episodes') >= 0) {
            seenHeaders = (options && options.headers) || {};
            return new Response(fixture('veoveo-episodes.json'), { status: 200 });
        }

        return new Response('unexpected ' + target, { status: 599 });
    };

    try {
        var errors = [];
        var found = await extractors.extractDirectStream(iframeUrl, { errors: errors });

        assert(!!found && !!found.url, 'поток извлечён без браузера' +
            (errors.length ? ' (' + errors[0].message + ')' : ''));
        assert(found && found.type === 'veoveo', 'сработал именно экстрактор Veoveo');
        assert(found && /\.m3u8/.test(found.url),
            'получена ссылка на HLS: ' + String(found && found.url).slice(0, 60));
        assert(seenHeaders && seenHeaders['DLE-API-TOKEN'] === 'TEST.API.TOKEN',
            'в catalog-api ушёл DLE-API-TOKEN со страницы плеера');
        assert(seenHeaders && seenHeaders['Iframe-Request-Id'] === 'test-request-id',
            'ушёл и Iframe-Request-Id — он вшит в подписанный путь плейлиста');
        assert(found && found.variantTracks && found.variantTracks.length > 0,
            'список дорожек балансера разобран (' + (found && found.variantTracks.length) + ')');
    } finally {
        globalThis.fetch = original;
    }
}

async function testGeoBlock() {
    group('Отказ по региону');

    var body = fixture('geo-blocked.html');

    assert(http.detectRefusal(410, body) === 'geo', 'страница «недоступно для вашего региона» распознана');
    assert(http.detectRefusal(403, '') === 'forbidden', 'HTTP 403 без текста — отказ балансера');
    assert(http.detectRefusal(200, '') === null, 'нормальный ответ не считается отказом');

    var errors = [];

    await withStubbedFetch({ 'ortified': { body: body, status: 410 } }, async function () {
        var found = await extractors.extractDirectStream('https://api.ortified.ws/embed/movie/474', { errors: errors });
        assert(found === null, 'при отказе по региону поток не выдумывается');
    });

    assert(errors.length > 0 && errors[0].code === 'geo',
        'причина отказа — регион, а не «поток не найден»');
    assert(errors.length > 0 && /регион/i.test(errors[0].message),
        'сообщение объясняет причину: ' + (errors[0] && errors[0].message));
    assert(errors.length === 1, 'после отказа по региону другие парсеры не дёргаются впустую');
}

async function testGenericExtractor() {
    group('Универсальный разбор и вложенный iframe');

    var page = '<html><body><script>var f="https:\\/\\/cdn.example.com\\/hls\\/master.m3u8?t=1";</script></body></html>';

    await withStubbedFetch({ 'obrut.show': { body: page } }, async function () {
        var found = await extractors.extractDirectStream('https://3a41cf05.obrut.show/embed/kzM/content/QDNxQzM', {});
        assert(!!found && found.url === 'https://cdn.example.com/hls/master.m3u8?t=1',
            'плейлист с экранированными слэшами разобран: ' + (found && found.url));
    });

    var outer = '<html><body><iframe src="https://inner.example.com/p"></iframe></body></html>';
    var inner = '<html><body><script>hls:"https://inner.example.com/x/master.m3u8"</script></body></html>';

    await withStubbedFetch({
        'outer.example.com': { body: outer },
        'inner.example.com': { body: inner }
    }, async function () {
        var found = await extractors.extractDirectStream('https://outer.example.com/embed', {});
        assert(!!found && found.url === 'https://inner.example.com/x/master.m3u8',
            'спуск во вложенный iframe работает');
    });

    var ads = '<html><script>src="https://ads.example.com/preroll/master.m3u8"</script></html>';
    assert(extractors.scanPlaylists(ads).length === 0, 'рекламный плейлист отбрасывается');
}

async function testKodikDecode() {
    group('Раскодирование ссылок Kodik');

    var plain = '//cloud.kodik-storage.com/useruploads/abc/720.mp4:hls:manifest.m3u8';
    var encoded = Buffer.from(plain, 'utf8').toString('base64')
        .replace(/[a-zA-Z]/g, function (ch) {
            var base = ch <= 'Z' ? 65 : 97;
            // обратный сдвиг на 13 — так их кодирует плеер
            return String.fromCharCode((ch.charCodeAt(0) - base + 13) % 26 + base);
        });

    var decoded = extractors.kodikDecode(encoded);
    assert(decoded === 'https:' + plain,
        'сдвиг подобран и ссылка раскодирована: ' + String(decoded).slice(0, 50));
    assert(extractors.kodikDecode('не-база64-совсем') === null, 'мусор не превращается в ссылку');
}

async function testRouting() {
    group('Определение балансеров');

    assert(extractors.isDirectSupported('Collaps', 'https://api.ortified.ws/embed/movie/474'), 'Collaps распознан');
    assert(extractors.isDirectSupported('Veoveo', 'https://tazaromikaz.link/balancer-api/iframe?movie_id=1'), 'Veoveo распознан');
    assert(extractors.isDirectSupported('Alloha', 'https://theatre.stravers.live/?token=1'), 'Alloha распознан');
    assert(extractors.isDirectSupported('Turbo', 'https://3a41cf05.obrut.show/embed/kzM/content/x'),
        'Turbo распознан — раньше он вообще не считался поддерживаемым');
    assert(extractors.isDirectSupported('Kodik', 'https://kodik.info/seria/1/abc/720p'), 'Kodik распознан');
    assert(!extractors.isDirectSupported('Неизвестный', 'https://example.com/embed'), 'чужой хост не помечается ⚡');
}

async function testEnglishAudioRegression() {
    group('Регрессия: из балансера приезжала английская озвучка');

    var original = globalThis.fetch;
    globalThis.fetch = async function () {
        return new Response(fixture('collaps-movie.html'), { status: 200 });
    };

    var found;

    try {
        found = await extractors.extractDirectStream('https://api.ortified.ws/embed/movie/474', {});
    } finally {
        globalThis.fetch = original;
    }

    assert(!!found && found.audioTracks.length === 3, 'дорожки Collaps разобраны');

    // order: [1, 2, 0] — у «Оригинал (ENG)» order 0, то есть дорожка номер 1.
    // Именно её mpv и брал, когда --aid не передавался вовсе.
    var english = found.audioTracks.find(function (t) { return t.lang === 'eng'; });
    assert(english && english.audioId === 1,
        'английский оригинал стоит первой дорожкой — mpv без --aid играл именно его');

    var dub = found.audioTracks.find(function (t) { return t.name === 'Дубляж'; });
    assert(dub && dub.audioId === 2, 'audio.order привязал «Дубляж» к --aid=2');

    var resolved = stream.resolveAudioId({ audioTracks: [], playerTracks: found.audioTracks }, '');
    assert(resolved === 2, 'без выбранной озвучки берётся русская дорожка, а не первая (' + resolved + ')');

    var picked = stream.resolveAudioId({ audioTracks: [], playerTracks: found.audioTracks }, 'LostFilm');
    assert(picked === 3, 'выбранная озвучка доезжает до mpv как --aid=3');

    var missing = stream.resolveAudioId({ audioTracks: [], playerTracks: found.audioTracks }, 'Такой озвучки нет');
    assert(missing === 2, 'когда название не совпало, берётся русская дорожка, а не английская');
}

async function testLanguageDetection() {
    group('Язык звуковой дорожки');

    assert(extractors.languageOf('02. Дубляж (RUS)') === 'rus', '(RUS) распознан');
    assert(extractors.languageOf('17. Оригинал (ENG)') === 'eng', '(ENG) распознан');
    assert(extractors.languageOf('16. Многоголосый. 1+1 (UKR)') === 'ukr', '(UKR) распознан');
    assert(extractors.languageOf('Дубляж') === 'rus', 'кириллица без пометки — русская дорожка');

    var variants = stream.parseMaster(fixture('master-multiaudio.m3u8'), 'https://cdn/m.m3u8');
    var tracks = variants[0].audioTracks;

    // Раньше normalizeName вырезал «(ENG)», и «Оригинал» совпадал с русским
    var eng = stream.matchAudioTrack(tracks, 'Оригинал (ENG)');
    assert(!eng || extractors.languageOf(eng.name) === 'eng',
        'английская озвучка не подменяется русской и наоборот');

    var rus = stream.matchAudioTrack(tracks, 'Дубляж');
    assert(rus && extractors.languageOf(rus.name) === 'rus', 'русская озвучка находится по названию');

    assert(extractors.isRussian({ name: '03. Многоголосый (RUS)' }) === true, 'isRussian: русская дорожка');
    assert(extractors.isRussian({ name: '17. Оригинал (ENG)' }) === false, 'isRussian: английская — нет');
    assert(extractors.isRussian({ name: '16. Многоголосый. 1+1 (UKR)' }) === false, 'isRussian: украинская — нет');
}

async function testQualityHonesty() {
    group('Регрессия: качество всегда показывалось как 1080p');

    var variants = stream.parseMaster(fixture('master-multiaudio.m3u8'), 'https://cdn/m.m3u8');

    // Раньше «1080» отдавало первый вариант всегда, даже когда 1080p нет.
    // Теперь просьба про 1080p при наличии только 480p честно даёт 480p…
    var lowOnly = variants.filter(function (v) { return v.label === '480p'; });
    var down = stream.pickVariant(lowOnly, '1080');
    assert(down && down.label === '480p',
        '1080p нет — берётся лучшее из доступного снизу (' + (down && down.label) + ')');

    // …а когда снизу нет ничего, возвращается null и показывается экран выбора,
    // вместо молчаливой подстановки первого попавшегося варианта
    var highOnly = variants.filter(function (v) { return v.label === '1080p'; });
    assert(stream.pickVariant(highOnly, '360') === null,
        'ниже запрошенного ничего нет — null, а не «что-нибудь сверху»');

    assert(stream.pickVariant(variants, 'max').label === '1080p', 'max по-прежнему берёт лучшее');

    var original = globalThis.fetch;
    globalThis.fetch = async function () { return new Response('нет доступа', { status: 403 }); };

    var empty;

    try {
        empty = await stream.readVariants({ url: 'https://cdn/master.m3u8', referer: 'https://h/' });
    } finally {
        globalThis.fetch = original;
    }

    assert(empty.length === 0, 'недоступный плейлист даёт пустой список качеств');
    assert(!!empty.reason && /403|балансер/i.test(empty.reason),
        'причина названа вслух: ' + empty.reason);
}

async function testDashFallback() {
    group('Запасной dash, когда hls закрыт');

    var master = fixture('master-multiaudio.m3u8');
    var seen = [];
    var original = globalThis.fetch;

    globalThis.fetch = async function (url) {
        seen.push(String(url));
        if (String(url).indexOf('.m3u8') >= 0) return new Response('нет', { status: 403 });
        return new Response(master, { status: 200 });
    };

    var variants;

    try {
        variants = await stream.readVariants({
            url: 'https://cdn/master.m3u8',
            dashUrl: 'https://cdn/manifest.mpd',
            referer: 'https://h/'
        });
    } finally {
        globalThis.fetch = original;
    }

    assert(seen.length === 2, 'после отказа hls запрашивается dash');
    assert(variants.length === 3, 'качества взяты из запасного манифеста');
}

async function testCache() {
    group('Кеш ответов API');

    var cache = require('./lib/cache');
    var calls = 0;

    var load = function () {
        calls++;
        return Promise.resolve([{ id: 1, title: 'Фильм' }]);
    };

    var key = 'test-' + Date.now();

    var first = await cache.through('film', key, load);
    var second = await cache.through('film', key, load);

    assert(calls === 1, 'второй запрос берётся из кеша, а не из сети');
    assert(JSON.stringify(first) === JSON.stringify(second), 'из кеша приходит тот же ответ');

    var emptyCalls = 0;
    var emptyKey = 'empty-' + Date.now();
    var loadEmpty = function () { emptyCalls++; return Promise.resolve([]); };

    await cache.through('players', emptyKey, loadEmpty);
    await cache.through('players', emptyKey, loadEmpty);
    assert(emptyCalls === 2, 'пустой ответ не кешируется — иначе одна неудача залипала бы надолго');

    // Протухшая запись не используется
    cache.write('players', key, [{ stale: true }]);
    var file = require('path').join(cache.CACHE_DIR,
        'players-' + require('crypto').createHash('sha1').update(key).digest('hex').slice(0, 16) + '.json');
    var raw = JSON.parse(require('fs').readFileSync(file, 'utf8'));
    raw.savedAt = Date.now() - cache.TTL.players - 1000;
    require('fs').writeFileSync(file, JSON.stringify(raw));

    assert(cache.read('players', key) === null, 'запись старше своего срока игнорируется');

    assert(cache.stats().entries > 0, 'кеш умеет отчитаться о размере');
}

async function testEndToEnd() {
    group('Сквозной прогон настоящей команды ktw');

    // Запускается реальный ktw, а не собранная в тесте цепочка: только так
    // ловятся ошибки проводки между ktw.js, stream.js и mpv.js. Сеть подменена
    // через bun --preload, поэтому регион и провайдер ни при чём.
    var execFileSync = require('child_process').execFileSync;

    // Тем же рантаймом, которым запущены тесты: флаг предзагрузки у bun и node
    // называется по-разному, но оба принимают наш CommonJS-заглушку.
    var isBun = typeof Bun !== 'undefined';
    var preloadFlag = isBun ? '--preload' : '--require';
    var raw;

    try {
        raw = execFileSync(process.execPath, [
            preloadFlag, path.join(__dirname, 'fixtures', 'stub-network.js'),
            path.join(__dirname, 'ktw.js'),
            '474', '--plain', '--no-mpv', '--json'
        ], {
            encoding: 'utf8',
            env: Object.assign({}, process.env, { KTW_NO_CACHE: '1' }),
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 60000
        });
    } catch (err) {
        assert(false, 'ktw отработал без падения (' + process.execPath + '): ' + err.message);
        return;
    }

    var result;

    try {
        result = JSON.parse(raw);
    } catch (err) {
        assert(false, 'ktw отдал разбираемый JSON');
        return;
    }

    var found = result.stream || {};

    assert(Array.isArray(found.variants) && found.variants.length === 2,
        'выбор качества доехал до конца: ' + JSON.stringify(found.variants));
    assert(found.variants && found.variants[0] === '1080p' && found.variants[1] === '720p',
        'качества названы по плейлисту, а не меткой из ответа Kinobox');

    // В фикстуре DEFAULT=YES стоит у «Оригинал (ENG)» — ровно как у балансера.
    // Без правки mpv молча брал бы её.
    assert(found.audioId === 2,
        'выбрана русская дорожка, хотя английская помечена DEFAULT=YES (--aid=' + found.audioId + ')');
    assert(/--aid=2/.test(result.command || ''), 'номер дорожки доехал до командной строки mpv');
    assert(/master\.m3u8/.test(found.url || ''), 'в mpv уходит мастер-плейлист, а не немая видеодорожка');
    assert(/--hls-bitrate=/.test(result.command || ''), 'качество задано через --hls-bitrate');
    assert(/--cache-secs=/.test(result.command || ''), 'буфер воспроизведения настроен');
}

// ---------- офлайн: доктор, конфиг, история ----------

async function testDoctor() {
    group('Доктор');

    var result = await doctor.run('quick');

    assert(Array.isArray(result.checks) && result.checks.length >= 5,
        'быстрая проверка прогоняет локальные пункты (' + result.checks.length + ')');

    // Рантайм подходит любой: bun или node 18+, где есть глобальный fetch
    var runtime = result.checks.find(function (c) { return c.name === 'рантайм'; });
    assert(runtime && runtime.status === 'ok' && /(bun|node)\s/.test(runtime.detail),
        'рантайм распознан: ' + (runtime && runtime.detail));

    var browser = result.checks.find(function (c) { return c.name === 'браузер'; });
    assert(!!browser, 'доктор отдельно проверяет, что браузер не нужен');

    var hintless = result.checks.filter(function (item) {
        return item.status === 'fail' && !item.hint;
    });
    assert(hintless.length === 0, 'у каждой поломки есть подсказка, чем лечить');

    var allGood = { checks: [{ name: 'x', status: 'ok', detail: '' }], failed: [], warned: [], ok: true };
    assert(doctor.render(allGood, { brief: true }) === '',
        'когда всё на месте, краткий режим молчит — установщику нечего печатать');

    var problem = { name: 'mpv', status: 'fail', detail: 'нет', hint: 'поставь mpv' };
    var broken = { checks: [problem], failed: [problem], warned: [], ok: false };
    var text = doctor.render(broken, { brief: true, color: false });

    assert(text.indexOf('mpv') >= 0 && text.indexOf('поставь mpv') >= 0,
        'краткий режим печатает поломку вместе с подсказкой');
}

async function testUpdateModule() {
    group('Модуль самообновления');

    var update = require('./lib/update');
    assert(typeof update.runUpdate === 'function', 'runUpdate экспортирован');
}

async function testConfigAndHistory() {
    group('Конфигурация и история');

    var initial = config.read();
    assert(typeof initial === 'object' && initial.mpvHardwareDec !== undefined, 'конфигурация читается');

    config.save({ preferredQuality: '1080' });
    assert(config.read().preferredQuality === '1080', 'preferredQuality сохраняется');
    config.save({ preferredQuality: initial.preferredQuality || '' });

    assert(history.formatTime(3665) === '01:01:05', 'formatTime: 3665 с -> 01:01:05');
    assert(history.formatTime(125) === '02:05', 'formatTime: 125 с -> 02:05');

    history.saveProgress({
        filmId: 999999, title: 'Тестовый Фильм', year: '2026', serial: false,
        timePos: 1200, duration: 3600, player: 'Veoveo', translation: 'Дубляж'
    });

    var saved = history.getProgress(999999);
    assert(!!saved && saved.timePos === 1200, 'прогресс фильма сохранён');
    assert(saved.percentage === 33, 'процент просмотра посчитан (33%)');

    history.saveProgress({
        filmId: 999998, title: 'Сериал', serial: true, season: 1, episode: 3,
        timePos: 2800, duration: 3000, userRating: 9
    });
    assert(history.isEpisodeWatched(999998, 1, 3) === true, 'серия помечена просмотренной');
    assert(history.isEpisodeWatched(999998, 1, 4) === false, 'непросмотренная серия — false');
    assert(history.getProgress(999998).userRating === 9, 'оценка сохранена (9/10)');

    history.setUserRating(999998, 10);
    assert(history.getProgress(999998).userRating === 10, 'setUserRating обновляет оценку до 10');

    history.toggleEpisodeWatched(999998, 1, 4);
    assert(history.isEpisodeWatched(999998, 1, 4) === true, 'toggleEpisodeWatched отмечает серию');
    history.unmarkEpisode(999998, 1, 4);
    assert(history.isEpisodeWatched(999998, 1, 4) === false, 'unmarkEpisode сбрасывает серию');

    history.resetSerial(999998);
    assert(history.getWatchedEpisodesCount(999998) === 0, 'resetSerial сбрасывает прогресс');

    history.remove(999999);
    history.remove(999998);
    assert(history.getProgress(999999) === null, 'тестовые записи удалены');

    var i18n = require('./lib/i18n');
    assert(i18n.t('search_field', 'ru') === 'Поиск' && i18n.t('search_field', 'en') === 'Search',
        'локализация работает');
}

async function testQualityPick() {
    group('Выбор качества');

    var variants = stream.parseMaster(fixture('master-multiaudio.m3u8'), 'https://cdn/m.m3u8');

    assert(stream.pickVariant(variants, '1080').label === '1080p', '1080 -> 1080p');
    assert(stream.pickVariant(variants, 'max').label === '1080p', 'max -> самое высокое');
    assert(stream.pickVariant(variants, 'min').label === '480p', 'min -> самое низкое');
    assert(stream.pickVariant(variants, '720').label === '720p', '720 -> 720p');
    assert(stream.pickVariant([], '720') === null, 'пустой список -> null');
}

async function testUpdateModule() {
    group('Модуль самообновления');
    var update = require('./lib/update');
    assert(typeof update.runUpdate === 'function', 'runUpdate экспортирован');
}

async function testSessionPersistence() {
    group('Сохранение и подхват сессии mpv');
    assert(typeof mpv.tryAttachExistingSession === 'function', 'tryAttachExistingSession экспортирован');
    assert(typeof mpv.clearSessionFile === 'function', 'clearSessionFile экспортирован');
    mpv.clearSessionFile();
    var attached = await mpv.tryAttachExistingSession();
    assert(attached === null, 'пустая сессия корректно возвращает null');
}

async function testDonattyIntegration() {
    group('Интеграция с Donatty (донаты и топ поддержки)');
    var donatty = require('./lib/donatty');

    assert(typeof donatty.fetchTopDonators === 'function', 'fetchTopDonators экспортирован');
    assert(typeof donatty.getCachedDonators === 'function', 'getCachedDonators экспортирован');
    assert(typeof donatty.formatDonatorsBanner === 'function', 'formatDonatorsBanner экспортирован');

    var emptyBanner = donatty.formatDonatorsBanner([]);
    assert(emptyBanner.indexOf('donatty.com/nedoedal') >= 0, 'formatDonatorsBanner для пустого списка возвращает ссылку');

    var sampleDonators = [
        { name: 'nedoedal', value: 10 },
        { name: 'Alex', value: 500 }
    ];
    var banner = donatty.formatDonatorsBanner(sampleDonators);
    assert(banner.indexOf('nedoedal') >= 0 && banner.indexOf('10 ₽') >= 0, 'formatDonatorsBanner форматирует топ с именами и суммами');
    assert(banner.indexOf('1.') >= 0 && banner.indexOf('2.') >= 0, 'formatDonatorsBanner содержит аккуратную нумерацию мест');
}

async function testTorrserveIntegration() {
    group('Интеграция с TorrServe');
    var torrserve = require('./lib/torrserve');
    assert(typeof torrserve.checkAvailability === 'function', 'checkAvailability экспортирован');
    assert(typeof torrserve.ensureRunning === 'function', 'ensureRunning экспортирован');
    assert(typeof torrserve.getBinaryName === 'function', 'getBinaryName экспортирован');
    assert(typeof torrserve.getBinaryPath === 'function', 'getBinaryPath экспортирован');
    assert(typeof torrserve.buildStreamUrl === 'function', 'buildStreamUrl экспортирован');
    assert(torrserve.getBinaryName().indexOf('TorrServer-') === 0, 'getBinaryName возвращает верное имя бинарника');
    var streamUrl = torrserve.buildStreamUrl('magnet:?xt=urn:btih:ABC12345', 2, 'http://127.0.0.1:8090');
    assert(streamUrl.indexOf('http://127.0.0.1:8090/stream?link=') === 0, 'buildStreamUrl строит верный URL');
    assert(streamUrl.indexOf('&index=2') >= 0, 'buildStreamUrl включает индекс файла');
}

// ---------- живые проверки ----------

async function testLive() {
    group('Живые балансеры (нужен доступ к сети и российский регион)');

    if (!wantLive) {
        skip('живые проверки', 'запусти с --live');
        return;
    }

    var players;

    try {
        players = await api.getPlayers(doctor.PROBE_FILM);
        assert(players.length > 0, 'Kinobox отдал список плееров (' + players.length + ')');
    } catch (err) {
        skip('список плееров', err.message);
        return;
    }

    for (var i = 0; i < players.length; i++) {
        var player = players[i];
        var errors = [];
        var found = null;

        try {
            found = await extractors.extractDirectStream(player.iframeUrl, { timeout: 15000, errors: errors });
        } catch (err) {
            errors.push(err);
        }

        if (found && found.url) {
            assert(true, 'балансер ' + player.source + ' отдал поток');

            var variants = await stream.readVariants(found);

            if (variants.length > 0) {
                assert(variants[0].audioTracks.length > 0 || !variants[0].audioSeparate,
                    'у ' + player.source + ' звук доступен для выбранного качества');
            }

            continue;
        }

        var reason = errors[0];

        if (reason && (reason.code === 'geo' || reason.code === 'network' || reason.code === 'timeout')) {
            skip('балансер ' + player.source, reason.message);
            continue;
        }

        assert(false, 'балансер ' + player.source + ': ' + (reason ? reason.message : 'не отдал поток'));
    }
}

async function testUiAndPosterDefensiveness() {
    group('Защита UI и постеров от сбоев (posterLines & null/undefined)');

    var app = require('./lib/app');
    var posterMod = require('./lib/poster');

    // 1. columns с undefined posterLines (регрессия: posterLines.length)
    var r1 = app.columns(undefined, ['Строка 1', 'Строка 2'], 40);
    assert(Array.isArray(r1) && r1.length === 2, 'columns(undefined, [...]) не падает и возвращает строки');

    // 2. columns с null posterLines
    var r2 = app.columns(null, ['Строка 1'], 40);
    assert(Array.isArray(r2) && r2.length === 1, 'columns(null, [...]) не падает');

    // 3. columns с null rightLines
    var r3 = app.columns(['Постер 1', 'Постер 2'], null, 40);
    assert(Array.isArray(r3) && r3.length === 2, 'columns([...], null) не падает');

    // 4. columns с null rightWidth
    var r4 = app.columns(['П1'], ['Р1'], null);
    assert(Array.isArray(r4) && r4.length === 1, 'columns с null rightWidth не падает');

    // 5. metaLine с null/undefined film
    assert(app.metaLine(null) === '', 'metaLine(null) возвращает пустую строку');
    assert(app.metaLine(undefined) === '', 'metaLine(undefined) возвращает пустую строку');
    assert(app.metaLine({}) === '', 'metaLine({}) возвращает пустую строку');

    // 6. filmHeader с null/undefined film
    var fh1 = app.filmHeader(null, 40);
    assert(Array.isArray(fh1) && fh1.length > 0, 'filmHeader(null) возвращает массив строк');

    var fh2 = app.filmHeader(undefined, null);
    assert(Array.isArray(fh2) && fh2.length > 0, 'filmHeader(undefined, null) возвращает массив строк');

    // 7. poster placeholder с null/undefined/некорректными параметрами
    var p1 = posterMod.placeholder(null, 22, 13);
    assert(Array.isArray(p1) && p1.length === 13, 'placeholder(null) возвращает 13 строк');

    var p2 = posterMod.placeholder(undefined, 0, 0);
    assert(Array.isArray(p2) && p2.length === 13, 'placeholder(undefined, 0, 0) использует дефолтные размеры');

    // 8. poster render с null/undefined url и title
    var pr1 = await posterMod.render(null, null, 22, 13);
    assert(Array.isArray(pr1) && pr1.length === 13, 'render(null, null) возвращает валидный постер-заглушку');
}

// ---------- запуск ----------

var SUITES = [
    ['Мастер-плейлист', testMasterPlaylist],
    ['Звук', testNoSoundRegression],
    ['Озвучки', testAudioMatching],
    ['mpv', testMpvArgs],
    ['Veoveo', testVeoveoOffline],
    ['Английская озвучка', testEnglishAudioRegression],
    ['Язык дорожки', testLanguageDetection],
    ['Честное качество', testQualityHonesty],
    ['Запасной dash', testDashFallback],
    ['Кеш', testCache],
    ['Сквозной прогон', testEndToEnd],
    ['Регион', testGeoBlock],
    ['Универсальный разбор', testGenericExtractor],
    ['Kodik', testKodikDecode],
    ['Маршрутизация', testRouting],
    ['Доктор', testDoctor],
    ['Конфиг', testConfigAndHistory],
    ['Качество', testQualityPick],
    ['Самообновление', testUpdateModule],
    ['Сессия mpv', testSessionPersistence],
    ['TorrServe', testTorrserveIntegration],
    ['Защита UI и постеров', testUiAndPosterDefensiveness],
    ['Donatty', testDonattyIntegration],
    ['Живые', testLive]
];

async function runTests() {
    console.log('\n\x1b[1m=== Тесты ktw ===\x1b[0m');

    for (var i = 0; i < SUITES.length; i++) {
        if (!wanted(SUITES[i][0])) continue;
        await SUITES[i][1]();
    }

    console.log('\n======================================');
    console.log('Успешно: \x1b[32m' + passed + '\x1b[0m | Ошибок: \x1b[31m' + failed +
        '\x1b[0m | Пропущено: \x1b[2m' + skipped + '\x1b[0m');
    console.log('======================================\n');

    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(function (err) {
    console.error('\nОшибка выполнения тестов:', err);
    process.exit(1);
});
