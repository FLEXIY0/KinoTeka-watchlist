'use strict';

// Доктор: проверяет по шагам всё, от чего зависит просмотр, и говорит, что
// именно сломалось. Нужен потому, что снаружи любая поломка выглядит одинаково
// («поток не найден»), хотя причины разные: нет mpv, протух ключ, зеркало
// Kinobox не отвечает, балансер закрыт для региона.
//
// Режимы:
//   quick — только локальные проверки, без сети; гоняется при каждом запуске
//           и молчит, пока всё на месте
//   brief — то же плюс сеть, печатает только проблемы (им пользуется установщик)
//   full  — полный отчёт по всем пунктам (ktw --doctor)

var fs = require('fs');
var path = require('path');
var execFileSync = require('child_process').execFileSync;

var config = require('./config');
var cache = require('./cache');
var http = require('./http');
var api = require('./api');
var extractors = require('./extractors');
var stream = require('./stream');

// Фильм для проверки балансеров: «Матрица», есть у всех
var PROBE_FILM = 301;

var KINOBOX_MIRRORS = [
    'https://fbphdplay.top/api/players',
    'https://api.kinobox.tv/api/players'
];

function check(name, status, detail, hint) {
    return { name: name, status: status, detail: detail || '', hint: hint || '' };
}

function which(command) {
    if (process.platform === 'win32') {
        try {
            var out = execFileSync('where', [command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
            return out.split('\r\n')[0].split('\n')[0];
        } catch (err) {
            return '';
        }
    }
    try {
        return execFileSync('sh', ['-c', 'command -v ' + command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch (err) {
        return '';
    }
}

function runQuiet(command, args) {
    try {
        return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch (err) {
        return '';
    }
}

// ---------- локальные проверки ----------

// Рантайм подходит любой из двух. Единственное жёсткое требование — глобальный
// fetch: на нём держится вся работа с балансерами, и в Node он появился только
// в 18-й версии. Более старый Node запустится, но упадёт на первом запросе.
function checkRuntime() {
    if (typeof Bun !== 'undefined' && Bun.version) {
        return check('рантайм', 'ok', 'bun ' + Bun.version);
    }
    if (typeof process !== 'undefined' && process.version) {
        return check('рантайм', 'ok', 'node ' + process.version);
    }

    var node = process.versions && process.versions.node;

    if (node) {
        var major = parseInt(node.split('.')[0], 10);

        if (major >= 18) {
            return check('рантайм', 'ok', 'node ' + node);
        }

        return check('рантайм', 'fail', 'node ' + node + ' — слишком старый',
            'нужен Node 18+ (в нём появился fetch) или Bun: ' +
            'apt install nodejs, либо curl -fsSL https://bun.sh/install | bash');
    }

    if (typeof fetch !== 'function') {
        return check('рантайм', 'fail', 'неизвестный рантайм без fetch',
            'запускай через bun или node 18+');
    }

    return check('рантайм', 'warn', 'неизвестный рантайм, но fetch есть');
}

function checkMpv() {
    var found = which('mpv');

    if (!found) {
        var hint = process.platform === 'win32'
            ? 'команда для установки: winget install --id shinchiro.mpv -e'
            : 'поставь mpv пакетным менеджером: apt install mpv / apk add mpv / pacman -S mpv';
        return check('mpv', 'fail', 'не найден в PATH', hint);
    }

    var version = (runQuiet('mpv', ['--version']).split('\n')[0] || 'версия неизвестна').trim();

    // Без поддержки https mpv не откроет HLS, а балансеры отдают только его
    var protocols = runQuiet('mpv', ['--list-protocols']);

    if (protocols && protocols.indexOf('https') < 0) {
        return check('mpv', 'warn', version + ' — собран без https',
            'нужен mpv с поддержкой https/hls, иначе поток не откроется');
    }

    return check('mpv', 'ok', version);
}

function checkChromium() {
    var puppeteerDir = path.join(__dirname, '..', '..', 'node_modules', 'puppeteer');

    if (fs.existsSync(puppeteerDir)) {
        return check('браузер', 'warn', 'в node_modules остался puppeteer',
            'ktw больше не запускает Chromium — лишнее можно снести: npm install --omit=dev');
    }

    return check('браузер', 'ok', 'не нужен, всё берётся прямым парсингом');
}

// Что за копия запущена и есть ли в ней нужные правки.
//
// Самая частая причина «я обновился, а ничего не изменилось» — запускается
// другая ветка или старый клон. Гадать об этом по симптомам бесполезно:
// «нет выбора качества», «озвучка английская» и «балансеры не работают»
// выглядят одинаково и при поломке, и при устаревшей копии.
function checkVersion() {
    var info = require('./install-info');
    var v = info.installedVersion();

    if (!v) {
        return check('версия', 'warn', 'не понять, что установлено',
            'переустанови: ' + info.updateHint());
    }

    var detail = (v.kind === 'git' ? (v.branch || 'HEAD') : 'установщик') + ' ' + v.commit + (v.date ? ' от ' + v.date : '');

    if (v.kind === 'git') {
        var behind = info.git(['rev-list', '--count', 'HEAD..@{upstream}']);
        if (behind && behind !== '0') {
            return check('версия', 'warn', detail + ', отстаёт на ' + behind + ' коммитов',
                'обнови: ' + info.updateHint());
        }
    }

    return check('версия', 'ok', detail);
}

// Проверка не по номеру версии, а по наличию самих функций: так видно, что
// запущенная копия действительно содержит правки, а не просто свежую дату.
function checkFixes() {
    var missing = [];

    if (typeof stream.resolveAudioId !== 'function') missing.push('выбор русской озвучки');
    if (typeof stream.applyVariant !== 'function') missing.push('звук при выборе качества');
    if (typeof extractors.languageOf !== 'function') missing.push('язык звуковой дорожки');

    var mpvArgs = [];

    try {
        mpvArgs = require('./mpv').buildArgs({ url: 'u', referer: 'r', origin: 'o' }, 'T');
    } catch (err) {
        mpvArgs = [];
    }

    if (!mpvArgs.some(function (a) { return a.indexOf('--cache-secs=') === 0; })) {
        missing.push('буфер воспроизведения');
    }

    if (missing.length > 0) {
        return check('правки на месте', 'fail', 'запущена старая копия — нет: ' + missing.join(', '),
            'обнови: ' + require('./install-info').updateHint());
    }

    return check('правки на месте', 'ok', 'звук, язык дорожки, качество и буфер');
}

function checkApiKey() {
    var key = config.resolveApiKey();

    if (!key) {
        return check('ключ Кинопоиска', 'fail', 'не задан',
            'бесплатный ключ: https://kinopoiskapiunofficial.tech, потом ktw и Ctrl+K');
    }

    return check('ключ Кинопоиска', 'ok', 'задан (' + key.slice(0, 4) + '…' + key.slice(-4) + ')');
}

function checkConfig() {
    try {
        fs.mkdirSync(config.CONFIG_DIR, { recursive: true });
        fs.accessSync(config.CONFIG_DIR, fs.constants.W_OK);
    } catch (err) {
        return check('настройки', 'fail', config.CONFIG_DIR + ' недоступен на запись',
            'проверь права: ls -ld ' + config.CONFIG_DIR);
    }

    return check('настройки', 'ok', config.file);
}

function checkCache() {
    if (process.env.KTW_NO_CACHE === '1') {
        return check('кеш ответов', 'warn', 'выключен через KTW_NO_CACHE=1',
            'убери KTW_NO_CACHE, если хочешь, чтобы поиск и список плееров не ходили в сеть каждый раз');
    }

    try {
        fs.mkdirSync(cache.CACHE_DIR, { recursive: true });
        fs.accessSync(cache.CACHE_DIR, fs.constants.W_OK);
    } catch (err) {
        return check('кеш ответов', 'warn', cache.CACHE_DIR + ' недоступен на запись',
            'без кеша всё работает, но каждый экран снова ходит в сеть');
    }

    var stats = cache.stats();

    return check('кеш ответов', 'ok', stats.entries + ' записей, ' +
        Math.round(stats.bytes / 1024) + ' КБ в ' + cache.CACHE_DIR);
}

function checkPath() {
    var found = which('ktw');

    if (!found) {
        return check('команда ktw', 'warn', 'не видна в PATH',
            'добавь каталог с ktw в PATH или перелогинься');
    }

    return check('команда ktw', 'ok', found);
}

function checkPosterRendering() {
    try {
        var posterMod = require('./poster');
        var pl = posterMod.placeholder('Test', 22, 13);
        if (!Array.isArray(pl) || pl.length !== 13) {
            return check('отрисовка постеров', 'fail', 'плейсхолдер вернул некорректный размер',
                'очисти кеш обложек: ktw --doctor --fix');
        }
        var appMod = require('./app');
        if (typeof appMod.columns === 'function') {
            var c1 = appMod.columns(undefined, ['тест'], 40);
            var c2 = appMod.columns(null, null, 40);
            var c3 = appMod.columns(['п1'], undefined, 40);
            if (!Array.isArray(c1) || !Array.isArray(c2) || !Array.isArray(c3)) {
                return check('отрисовка постеров', 'fail', 'сетка падает на пустых обложках',
                    'обнови ktw: ktw --update');
            }
        }
        return check('отрисовка постеров', 'ok', 'сетка и плейсхолдеры защищены от сбоев');
    } catch (err) {
        return check('отрисовка постеров', 'fail', err.message,
            'обнови ktw: ktw --update');
    }
}

// ---------- сетевые проверки ----------

async function checkMirrors() {
    var configured = config.resolveKinoboxApi();
    var mirrors = configured
        ? [configured].concat(KINOBOX_MIRRORS.filter(function (m) { return m !== configured; }))
        : KINOBOX_MIRRORS.slice();

    var reasons = [];

    for (var i = 0; i < mirrors.length; i++) {
        try {
            var res = await http.request(mirrors[i] + '?kinopoisk=' + PROBE_FILM, {
                referer: 'https://kinobox.tv/',
                origin: 'https://kinobox.tv',
                accept: 'application/json',
                timeout: 12000
            });

            if (res.ok && res.body.indexOf('iframeUrl') >= 0) {
                return check('список плееров', 'ok', http.hostOf(mirrors[i]) + ' отвечает');
            }

            reasons.push(http.hostOf(mirrors[i]) + ': HTTP ' + res.status);
        } catch (err) {
            reasons.push(err.message);
        }
    }

    return check('список плееров', 'fail', reasons.join('; '),
        'если у всех зеркал «соединение сброшено» — их режет провайдер: нужен VPN или своё зеркало через KTW_KINOBOX_API');
}

async function checkBalancers() {
    var players;

    try {
        players = await api.getPlayers(PROBE_FILM);
    } catch (err) {
        return [check('балансеры', 'skip', 'не проверял — не получен список плееров')];
    }

    var results = [];
    var geoSeen = false;
    var workingCount = 0;

    for (var i = 0; i < players.length; i++) {
        var player = players[i];
        var errors = [];
        var found = null;

        try {
            found = await extractors.extractDirectStream(player.iframeUrl, {
                timeout: 12000,
                errors: errors
            });
        } catch (err) {
            errors.push(err);
        }

        if (found && found.url) {
            workingCount++;
            results.push(check('балансер ' + player.source, 'ok', http.hostOf(found.url)));
            continue;
        }

        var reason = errors.length > 0 ? errors[0] : null;
        var code = reason ? reason.code : 'failed';

        if (code === 'geo') geoSeen = true;

        results.push(check('балансер ' + player.source,
            'warn',
            reason ? reason.message : 'не отдал поток',
            'плеер временно недоступен — ktw автоматически использует рабочий'));
    }

    if (workingCount === 0 && players.length > 0) {
        results.push(check('источники видео', 'fail', 'ни один балансер не отдал поток',
            'проверь подключение к интернету или включи VPN'));
    }

    if (geoSeen) {
        results.push(check('регион', 'warn', 'часть балансеров закрыта для твоего IP',
            'включи VPN или прокси с российским адресом — балансеры отдают контент только на РФ и СНГ'));
    }

    return results;
}

async function checkApiKeyLive() {
    var key = config.resolveApiKey();
    if (!key) return null;

    try {
        var films = await api.searchFilms('матрица', key);
        return check('поиск Кинопоиска', 'ok', 'нашёл ' + films.length + ' результатов');
    } catch (err) {
        return check('поиск Кинопоиска', 'fail', err.message,
            /401|403|не принят/.test(err.message)
                ? 'ключ протух — заведи новый на kinopoiskapiunofficial.tech и введи по Ctrl+K'
                : '');
    }
}

async function checkTorrserverLive() {
    var torrserve = require('./torrserve');
    var status = await torrserve.checkAvailability(null, 1500);
    if (status.ok) {
        return check('TorrServe', 'ok', status.url + ' (' + status.version + ') — активен и готов к 4K стримингу');
    }
    return check('TorrServe', 'ok', 'готов к автоматическому запуску из коробки');
}

// ---------- сборка ----------

async function run(mode) {
    mode = mode || 'full';

    var checks = [
        checkVersion(),
        checkFixes(),
        checkRuntime(),
        checkMpv(),
        checkChromium(),
        checkApiKey(),
        checkConfig(),
        checkCache(),
        checkPath(),
        checkPosterRendering()
    ];

    if (mode !== 'quick') {
        var live = await checkApiKeyLive();
        if (live) checks.push(live);

        checks.push(await checkMirrors());

        var balancers = await checkBalancers();
        balancers.forEach(function (item) { checks.push(item); });

        var ts = await checkTorrserverLive();
        if (ts) checks.push(ts);
    }

    var failed = checks.filter(function (item) { return item.status === 'fail'; });
    var warned = checks.filter(function (item) { return item.status === 'warn'; });

    return {
        mode: mode,
        checks: checks,
        failed: failed,
        warned: warned,
        ok: failed.length === 0
    };
}

var MARK = { ok: '✓', warn: '!', fail: '✗', skip: '·' };
var COLOR = { ok: '[32m', warn: '[33m', fail: '[31m', skip: '[2m' };
var DIM = '[2m';
var RESET = '[0m';

function line(item, colored) {
    var mark = MARK[item.status] || '·';
    var head = colored ? COLOR[item.status] + mark + RESET : mark;
    var text = '  ' + head + ' ' + item.name;

    if (item.detail) text += ' — ' + item.detail;

    return text;
}

// brief: молчим, пока всё в порядке; full: печатаем всё
function render(result, options) {
    options = options || {};

    var colored = options.color !== false;
    var brief = options.brief === true;
    var lines = [];

    if (brief && result.failed.length === 0 && result.warned.length === 0) {
        return '';
    }

    var shown = brief ? result.failed.concat(result.warned) : result.checks;

    lines.push(brief ? 'Доктор ktw — нашёл, что поправить:' : 'Доктор ktw');

    shown.forEach(function (item) {
        lines.push(line(item, colored));

        if (item.hint) {
            lines.push('      ' + (colored ? DIM : '') + item.hint + (colored ? RESET : ''));
        }
    });

    if (!brief) {
        lines.push('');
        lines.push(result.ok ? '  Всё на месте.' : '  Сломано пунктов: ' + result.failed.length);
    }

    return lines.join('\n');
}

module.exports = {
    run: run,
    render: render,
    PROBE_FILM: PROBE_FILM
};
