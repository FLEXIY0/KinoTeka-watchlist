#!/usr/bin/env node
'use strict';

// ktw — терминальный клиент KinoTeka Watch.
// Повторяет цепочку сайта: поиск на Кинопоиске -> список плееров Kinobox ->
// извлечение прямого потока -> воспроизведение в mpv.
//
// По умолчанию запускается полноэкранный интерфейс (lib/app.js).
// Флаги --json/--no-mpv/--iframe и запуск без терминала уводят в простой
// построчный режим, пригодный для скриптов и пайпов.

var path = require('path');
var execFileSync = require('child_process').execFileSync;
var fs = require('fs');

var api = require('./lib/api');
var ui = require('./lib/ui');
var stream = require('./lib/stream');
var mpv = require('./lib/mpv');
var config = require('./lib/config');
var poster = require('./lib/poster');
var history = require('./lib/history');

var HELP = [
    '',
    ui.color.bold('ktw') + ' — смотреть фильмы из KinoTeka Watch в mpv',
    '',
    ui.color.bold('Использование:'),
    '  ktw                       полноэкранный интерфейс с историей',
    '  ktw <запрос>              сразу с этим запросом в поле поиска',
    '  ktw <id кинопоиска>       открыть фильм по id',
    '  ktw <ссылка на кинопоиск> открыть фильм по ссылке',
    '',
    ui.color.bold('Опции:'),
    '  -p, --player <тип>   взять плеер по имени (collaps, alloha, kodik, …)',
    '  -t, --translation <имя>  взять озвучку по части названия (lostfilm, goblin, …)',
    '  -q, --quality <n>    качество: 1080, 720, 480, max, min',
    '  -s, --season <n>     номер сезона',
    '  -e, --episode <n>    номер серии',
    '      --resume         продолжить просмотр с сохранённой секунды',
    '      --history        показать историю просмотров',
    '      --stand, --themes интерактивный стенд выбора стиля и ANSI арта',
    '      --ram, --bench   замер реального потребления памяти KTW + mpv в МБ',
    '      --doctor         проверить, что именно не работает, и подсказать чем лечить',
    '      --iframe         не искать поток, просто показать ссылку на плеер',
    '      --no-mpv         найти поток, но не запускать mpv',
    '      --json           вывести результат в JSON (для скриптов)',
    '      --plain          построчный режим без полноэкранного интерфейса',
    '      --timeout <мс>   сколько ждать поток, по умолчанию 40000',
    '      --key <ключ>     ключ API Кинопоиска',
    '      --settings       открыть меню тонких настроек',
    '  -h, --help           эта справка',
    '  -V, --version        какая версия и откуда запускается',
    '  -u, --update         проверить и установить последнее обновление KTW',
    '      --clean          очистить кэш и показать состояние установки',
    '',
    ui.color.bold('Управление в интерфейсе:'),
    '  ↑/↓ — выбор, Enter — дальше, Esc — назад, Ctrl+S — настройки, Ctrl+H — история, Ctrl+K — ключ',
    '',
    ui.color.bold('Примеры:'),
    '  ktw',
    '  ktw --stand',
    '  ktw матрица',
    '  ktw "во все тяжкие" -s 1 -e 3 --resume',
    '  ktw 301 --player collaps --no-mpv',
    '  ktw матрица -- --fs --hwdec=auto-safe',
    ''
].join('\n');

// Какая версия исходников запущена
function version() {
    var info = require('./lib/install-info');
    var v = info.installedVersion();

    if (!v) return 'версия неизвестна\n' + info.ROOT;
    return v.commit + (v.date ? ' ' + v.date : '') + '  (' + (v.kind === 'git' ? v.branch : 'установщик') + ')\n' + info.ROOT;
}

// Очистка кэшей и отчёт о состоянии установки
function clean() {
    var info = require('./lib/install-info');

    ui.info('');
    ui.info(ui.color.bold('Установка'));
    ui.info('  ' + version().split('\n').join('\n  '));

    if (info.isGit()) {
        info.git(['fetch', '--quiet', 'origin']);
        var behind = info.git(['rev-list', '--count', 'HEAD..@{upstream}']);
        if (behind && behind !== '0') {
            ui.info('  ' + ui.color.yellow('отстаёт от origin на ' + behind + ' коммит(ов)'));
            ui.info('  ' + ui.color.dim('обновить: ' + info.updateHint()));
        } else if (behind === '0') {
            ui.info('  ' + ui.color.green('свежая версия'));
        }
    } else {
        ui.info('  ' + ui.color.dim('обновить: ' + info.updateHint()));
    }

    ui.info('');
    ui.info(ui.color.bold('Очистка'));

    var removed = poster.clearCache();
    ui.info('  ' + (removed ? '✓ обложки: ' + removed : '✗ обложки удалить не вышло'));

    var cache = require('./lib/cache');
    var cacheStats = cache.stats();
    var cacheDir = cache.clear();
    ui.info('  ' + (cacheDir
        ? '✓ кеш ответов API: ' + cacheStats.entries + ' записей, ' + Math.round(cacheStats.bytes / 1024) + ' КБ'
        : '✗ кеш ответов API удалить не вышло'));

    ui.info('  ' + ui.color.dim('браузер не используется — временных профилей не бывает'));
    ui.info('');

    return 0;
}

// Печать истории в терминал
function printHistory() {
    var items = history.getRecent(30);
    if (items.length === 0) {
        ui.info('История просмотров пуста.');
        return 0;
    }

    ui.info(ui.color.bold('\nИстория просмотров:'));
    items.forEach(function (item, idx) {
        var label = (idx + 1) + '. ' + item.title + (item.year ? ' (' + item.year + ')' : '');
        if (item.season && item.episode) label += ' · S' + item.season + 'E' + item.episode;
        var progress = item.timePos > 0 && item.duration > 0
            ? history.formatTime(item.timePos) + ' / ' + history.formatTime(item.duration) + ' (' + item.percentage + '%)'
            : (item.watched ? '✓ Просмотрено' : '');
        ui.info('  ' + ui.color.green(label) + (progress ? ' — ' + ui.color.dim(progress) : ''));
    });
    ui.info('');
    return 0;
}

// Разбор аргументов командной строки
function parseArgs(argv) {
    var options = {
        query: [],
        player: null,
        translation: null,
        quality: null,
        season: null,
        episode: null,
        resume: false,
        history: false,
        stand: false,
        direct: false,
        iframe: false,
        noMpv: false,
        json: false,
        plain: false,
        doctor: false,
        doctorBrief: false,
        timeout: 40000,
        key: null,
        settings: false,
        ram: false,
        help: false,
        version: false,
        clean: false,
        unknown: [],
        mpvArgs: []
    };

    for (var i = 0; i < argv.length; i++) {
        var arg = argv[i];

        if (arg === '--') {
            options.mpvArgs = argv.slice(i + 1);
            break;
        }

        if (arg === '-h' || arg === '--help') options.help = true;
        else if (arg === '-V' || arg === '--version') options.version = true;
        else if (arg === '-u' || arg === '--update' || arg === '--upgrade') options.update = true;
        else if (arg === '--clean') options.clean = true;
        else if (arg === '--history') options.history = true;
        else if (arg === '--stand' || arg === '--themes') options.stand = true;
        else if (arg === '--ram' || arg === '--memory' || arg === '--bench') options.ram = true;
        else if (arg === '--resume') options.resume = true;
        else if (arg === '--settings') options.settings = true;
        else if (arg === '-p' || arg === '--player') options.player = argv[++i];
        else if (arg === '-t' || arg === '--translation') options.translation = argv[++i];
        else if (arg === '-q' || arg === '--quality') options.quality = argv[++i];
        else if (arg === '-s' || arg === '--season') options.season = argv[++i];
        else if (arg === '-e' || arg === '--episode') options.episode = argv[++i];
        else if (arg === '--doctor') options.doctor = true;
        else if (arg === '--doctor-brief') { options.doctor = true; options.doctorBrief = true; }
        else if (arg === '--direct') options.direct = true;
        else if (arg === '--iframe') options.iframe = true;
        else if (arg === '--no-mpv') options.noMpv = true;
        else if (arg === '--json') options.json = true;
        else if (arg === '--plain') options.plain = true;
        else if (arg === '--headful') options.headful = true; // оставлен, чтобы старые команды не падали
        else if (arg === '--timeout') options.timeout = parseInt(argv[++i], 10) || 40000;
        else if (arg === '--key') options.key = argv[++i];
        else if (arg.length > 1 && arg[0] === '-') options.unknown.push(arg);
        else options.query.push(arg);
    }

    options.query = options.query.join(' ').trim();

    return options;
}

// Выбор фильма в построчном режиме
async function pickFilm(options, apiKey) {
    var directId = api.parseFilmId(options.query);
    if (directId) {
        return { id: directId, title: 'Кинопоиск #' + directId, year: '' };
    }

    var query = options.query;
    if (!query) {
        query = await ui.prompt('Что смотрим?');
        if (!query) return null;
    }

    if (!apiKey) {
        return { id: null, title: query, year: '', keyless: true };
    }

    var searchSpinner = ui.spinner('Ищу «' + query + '»');
    var films;

    try {
        films = await api.searchFilms(query, apiKey);
    } finally {
        searchSpinner.stop();
    }

    if (films.length === 0) {
        ui.error('Ничего не найдено по запросу «' + query + '»');
        return null;
    }

    var items = films.map(function (film) {
        var meta = [film.year, film.type, film.rating ? '★ ' + film.rating : ''].filter(Boolean);
        return { label: film.title, hint: meta.join(' · ') };
    });

    var index = await ui.select('Найдено ' + films.length + ':', items);
    return index < 0 ? null : films[index];
}

// Выбор плеера в построчном режиме
async function pickPlayer(film, options) {
    var playersSpinner = ui.spinner('Загружаю плееры');
    var players;

    try {
        players = film.id
            ? await api.getPlayers(film.id)
            : await api.getPlayersByTitle(film.title);
    } finally {
        playersSpinner.stop();
    }

    if (players.length === 0) {
        ui.error('Для этого фильма нет доступных плееров');
        return null;
    }

    var userConfig = config.read();
    var wantedPlayer = options.player || userConfig.preferredPlayer;

    if (wantedPlayer) {
        var wanted = wantedPlayer.toLowerCase();
        var match = players.filter(function (player) {
            return player.source.toLowerCase().indexOf(wanted) === 0;
        })[0];

        if (match) return match;

        if (options.player) {
            ui.error('Плеер «' + options.player + '» недоступен. Есть: ' +
                players.map(function (p) { return p.source; }).join(', '));
            return null;
        }
    }

    var items = players.map(function (player) {
        var directMark = player.direct ? ' ⚡' : '';
        return {
            label: player.source + directMark,
            hint: player.translations.length + ' озв. · ' + player.quality
        };
    });

    var index = await ui.select('Плееры для «' + film.title + '»:', items);
    return index < 0 ? null : players[index];
}

// Выбор озвучки в построчном режиме
async function pickTranslation(player, options) {
    var variants = player.translations || [];
    if (variants.length === 0) return null;

    var userConfig = config.read();
    var wantedTranslation = options.translation || userConfig.preferredTranslation;

    if (wantedTranslation) {
        var wanted = wantedTranslation.toLowerCase();
        var match = variants.filter(function (item) {
            return item.name.toLowerCase().indexOf(wanted) >= 0;
        })[0];

        if (match) return match;

        if (options.translation) {
            ui.error('Озвучка «' + options.translation + '» не найдена. Есть: ' +
                variants.map(function (item) { return item.name; }).join(', '));
            return undefined;
        }
    }

    if (variants.length === 1 || !process.stdin.isTTY) return variants[0];

    var items = variants.map(function (item) {
        return { label: item.name, hint: item.quality };
    });

    var index = await ui.select('Озвучки ' + player.source + ':', items);
    return index < 0 ? undefined : variants[index];
}

// Построчный режим для скриптов и терминалов без интерактива
async function runPlain(options) {
    var apiKey = config.resolveApiKey(options.key);
    var userConfig = config.read();

    var film = await pickFilm(options, apiKey);
    if (!film) return 1;

    var player = await pickPlayer(film, options);
    if (!player) return 1;

    var translation = await pickTranslation(player, options);
    if (translation === undefined) return 1;

    var source = translation && translation.iframeUrl ? translation.iframeUrl : player.iframeUrl;
    var iframeUrl = api.withEpisode(source, options.season, options.episode);

    if (options.iframe) {
        if (options.json) {
            process.stdout.write(JSON.stringify({
                film: film, player: player, translation: translation, iframeUrl: iframeUrl
            }, null, 2) + '\n');
        } else {
            ui.info(ui.color.green('▸ ') + player.source +
                (translation ? ' · ' + translation.name : ''));
            process.stdout.write(iframeUrl + '\n');
        }
        return 0;
    }

    var streamSpinner = ui.spinner('Достаю поток из ' + player.source + (player.direct ? ' ⚡' : ''));
    var found;

    try {
        found = await stream.resolveStream(iframeUrl, {
            season: options.season,
            episode: options.episode,
            translation: translation ? translation.name : '',
            timeout: options.timeout || userConfig.timeout,
            onProgress: function (message) { streamSpinner.update(message); }
        });
    } catch (err) {
        streamSpinner.stop();
        ui.error('Плеер ' + player.source + ' не отдал поток: ' + err.message);

        (err.reasons || []).forEach(function (reason) {
            if (reason.message !== err.message) ui.info(ui.color.dim('  · ' + reason.message));
        });

        ui.info(ui.color.dim('  Ссылка на плеер: ' + iframeUrl));
        ui.info(ui.color.dim('  Что именно сломалось — покажет ktw --doctor'));
        return 1;
    } finally {
        streamSpinner.stop();
    }

    if (!found) {
        ui.error('Поток не найден за ' + Math.round((options.timeout || userConfig.timeout) / 1000) + ' с.');
        ui.info(ui.color.dim('  Попробуй другой плеер (например, collaps ⚡).'));
        ui.info(ui.color.dim('  Ссылка на плеер: ' + iframeUrl));
        return 1;
    }

    if (found.suspicious) {
        ui.error('Поймался только рекламный ролик — сам фильм плеер ' + player.source + ' не отдал.');
        ui.info(ui.color.dim('  Попробуй другой балансер: --player collaps'));
    }

    var variants = await stream.readVariants(found);
    var wantedQuality = options.quality || userConfig.preferredQuality;

    if (variants.length > 0) {
        var variant = wantedQuality
            ? stream.pickVariant(variants, wantedQuality)
            : variants[0];

        if (!variant) {
            ui.error('Качество «' + wantedQuality + '» недоступно. Есть: ' +
                variants.map(function (item) { return item.label; }).join(', '));
            return 1;
        }

        found = stream.applyVariant(found, variant);
        found.variants = variants.map(function (item) { return item.label; });
    } else if (variants.reason) {
        ui.info(ui.color.dim('  Список качеств недоступен — ' + variants.reason));
    }

    // Номер озвучки: сперва по дорожкам мастер-плейлиста, затем по конфигу
    // балансера, и только потом — русская дорожка по умолчанию
    found.audioId = stream.resolveAudioId(found, translation ? translation.name : '');

    if (options.resume && film.id) {
        var savedProg = history.getProgress(film.id, options.season, options.episode);
        if (savedProg && savedProg.timePos > 0) {
            found.startTime = savedProg.timePos;
        }
    }

    found.filmInfo = film;
    found.season = options.season;
    found.episode = options.episode;
    found.player = player.source;
    found.translation = translation ? translation.name : '';

    var title = film.title + (film.year ? ' (' + film.year + ')' : '') +
        (options.season ? ' · S' + options.season + 'E' + options.episode : '') +
        (translation && translation.name ? ' · ' + translation.name : '') +
        (found.label ? ' · ' + found.label : '');

    if (options.json) {
        process.stdout.write(JSON.stringify({
            film: film,
            player: player,
            translation: translation,
            stream: found,
            command: mpv.buildCommand(found, title, options.mpvArgs)
        }, null, 2) + '\n');
        return 0;
    }

    var directBadge = found.direct ? ui.color.green(' [прямой ⚡]') : '';
    ui.info(ui.color.green('▸ ') + title + ' · ' + player.source + directBadge +
        (translation ? ' · ' + translation.name : '') + ' · ' + player.quality);

    if (options.noMpv) {
        process.stdout.write(found.url + '\n');
        ui.info(ui.color.dim('  Referer: ' + found.referer));
        ui.info(ui.color.dim('  ' + mpv.buildCommand(found, title, options.mpvArgs)));
        return 0;
    }

    try {
        var result = await mpv.play(found, title, options.mpvArgs);
        return result.code;
    } catch (err) {
        ui.error(err.message);
        ui.info(ui.color.dim('  ' + mpv.buildCommand(found, title, options.mpvArgs)));
        return 1;
    }
}

function wantsTui(options) {
    if (options.plain || options.json || options.iframe || options.noMpv || options.history) return false;
    return process.stdin.isTTY && process.stdout.isTTY;
}

// Полный отчёт доктора (ktw --doctor) или только проблемы (--doctor-brief)
async function runDoctor(brief) {
    var doctor = require('./lib/doctor');
    var result = await doctor.run(brief ? 'brief' : 'full');
    var text = doctor.render(result, { brief: brief });

    if (text) {
        ui.info('');
        ui.info(text);
        ui.info('');
    }

    return result.ok ? 0 : 1;
}

// Быстрая локальная проверка при каждом запуске: молчит, пока всё на месте.
// Смысл — не гадать «почему ничего не работает», когда нет mpv или ключа.
async function warnIfBroken() {
    try {
        var doctor = require('./lib/doctor');
        var result = await doctor.run('quick');

        if (result.failed.length === 0) return;

        ui.info('');
        ui.info(doctor.render(result, { brief: true }));
        ui.info(ui.color.dim('  Подробный разбор: ktw --doctor'));
        ui.info('');
    } catch (err) {
        // Доктор не должен мешать запуску
    }
}

async function main() {
    var options = parseArgs(process.argv.slice(2));

    if (options.help) {
        ui.info(HELP);
        return 0;
    }

    if (options.version) {
        ui.info(version());
        return 0;
    }

    if (options.update) {
        return await require('./lib/update').runUpdate();
    }

    if (options.clean) {
        return clean();
    }

    if (options.doctor) {
        return await runDoctor(options.doctorBrief);
    }

    if (options.history) {
        return printHistory();
    }

    if (options.stand) {
        return await require('./lib/stand').runStand();
    }

    if (options.ram) {
        var sysinfo = require('./lib/sysinfo');
        var stats = sysinfo.getMemoryStats();
        ui.info('');
        ui.info(ui.color.bold('📊 Замер потребления оперативной памяти (RAM):'));
        ui.info('  • KTW (Node.js TUI процесс): ' + ui.color.cyan(stats.ktw + ' МБ') + ui.color.dim(' (Heap: ' + stats.heap + ' МБ)'));
        ui.info('  • Видеоплеер mpv:           ' + ui.color.yellow(stats.mpv + ' МБ') + ui.color.dim(stats.mpvActive ? ' (активен сейчас)' : ' (базовый замер)'));
        if (stats.terminal > 0) {
            ui.info('  • Терминал / Shell (TTY):   ' + ui.color.dim(stats.terminal + ' МБ'));
        }
        ui.info('  ' + ui.color.dim('─────────────────────────────────────────────'));
        ui.info('  ' + ui.color.bold('Всего используется:         ') + ui.color.green(stats.total + ' МБ'));
        ui.info('');
        return 0;
    }

    if (options.unknown.length > 0) {
        ui.error('Неизвестный флаг: ' + options.unknown.join(', '));
        ui.info(ui.color.dim('  Список флагов: ktw --help'));
        ui.info(ui.color.dim('  Если флаг должен существовать — обнови: ktw --clean'));
        return 1;
    }

    await warnIfBroken();

    try {
        if (wantsTui(options)) {
            return await require('./lib/app').run(options);
        }

        return await runPlain(options);
    } catch (err) {
        ui.error(err.message);
        return 1;
    }
}

main().then(async function (code) {
    await stream.shutdown();
    process.exit(code);
});
