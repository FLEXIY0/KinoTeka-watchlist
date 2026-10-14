'use strict';

// Экраны интерфейса и переходы между ними:
//
//   поиск (с историей) ─► фильм ─┬─► плееры ─► озвучка ─► качество ─► mpv ─► [след. серия]
//                                └─► сезоны ─► серии (с ✓) ─► плееры ─► озвучка ─► качество ─► mpv
//                                └─► настройки (Ctrl+S)
//                                └─► история (Ctrl+H)
//
// Esc всегда возвращает на шаг назад. При завершении серии сериала
// автоматически предлагается и запускается следующая (Binge-Watching).

var ansi = require('./ansi');
var tui = require('./tui');
var api = require('./api');
var poster = require('./poster');
var stream = require('./stream');
var mpv = require('./mpv');
var config = require('./config');
var history = require('./history');
var themes = require('./themes');
var i18n = require('./i18n');
var donatty = require('./donatty');

var t = i18n.t;

var style = ansi.style;
var glyph = ansi.glyph;

var POSTER_COLS = 22;
var POSTER_ROWS = 13;
var GAP = 2;

// Размеры карточки под текущий размер терминала (адаптивная растяжка)
function metrics() {
    var screen = tui.size();
    var width = Math.max(50, Math.min(screen.cols - 4, 110));
    var withPoster = screen.cols >= 66 && screen.rows >= 18;
    var rightWidth = width - 4 - (withPoster ? POSTER_COLS + GAP : 0);

    return {
        width: width,
        rightWidth: rightWidth,
        withPoster: withPoster,
        listRows: Math.max(5, Math.min(screen.rows - 10, 20))
    };
}

// Активная сессия mpv в фоновом режиме (позволяет искать другие фильмы и менять настройки на лету)
var activePlayback = {
    session: null,
    film: null,
    player: null,
    translation: null,
    season: null,
    episode: null,
    variants: [],
    stream: null
};

function getMiniPlayerBar() {
    if (!activePlayback.session || !activePlayback.session.isAlive()) return null;
    var st = activePlayback.session.getState();
    var time = history.formatTime(st.timePos) + (st.duration > 0 ? (' / ' + history.formatTime(st.duration)) : '');
    var s = activePlayback.season || (activePlayback.session.season) || (activePlayback.stream && activePlayback.stream.season);
    var e = activePlayback.episode || (activePlayback.session.episode) || (activePlayback.stream && activePlayback.stream.episode);
    var ep = (s && e) ? (' · S' + (s < 10 ? '0' : '') + s + 'E' + (e < 10 ? '0' : '') + e) : '';
    var filmTitle = (activePlayback.film && activePlayback.film.title)
        || (activePlayback.session.film && activePlayback.session.film.title)
        || 'Видео';
    var icon = st.pause ? '⏸ ' : '▶ ';
    return style.accent(icon + filmTitle + ep) + ' ' + style.good(time) +
        style.muted(' · ' + (activePlayback.player ? activePlayback.player.source : 'mpv')) +
        ' ' + style.secondary('[Ctrl+P пульт]') +
        ' ' + style.dim('[Ctrl+X стоп]');
}

function syncSettingsToLivePlayer(cfg) {
    if (!activePlayback.session || !activePlayback.session.isAlive()) return;
    try {
        if (cfg.mpvFullscreen !== undefined) {
            activePlayback.session.ipc.sendCommand(['set_property', 'fullscreen', cfg.mpvFullscreen]);
        }
        if (cfg.mpvHardwareDec !== undefined) {
            activePlayback.session.ipc.sendCommand(['set_property', 'hwdec', cfg.mpvHardwareDec]);
        }
        if (cfg.preferredQuality && activePlayback.variants && activePlayback.variants.length > 0) {
            var v = stream.pickVariant(activePlayback.variants, cfg.preferredQuality);
            if (v && v.bandwidth) {
                activePlayback.session.ipc.setBitrate(v.bandwidth);
            }
        }
        if (cfg.preferredTranslation && activePlayback.player && activePlayback.player.translations) {
            var wanted = cfg.preferredTranslation.toLowerCase();
            var tr = activePlayback.player.translations.find(function (t) {
                return t.name.toLowerCase().indexOf(wanted) >= 0;
            });
            if (tr) {
                var aid = tr.audioId || (activePlayback.player.translations.indexOf(tr) + 1);
                activePlayback.session.ipc.setAudio(aid);
            }
        }
    } catch (e) {}
}

function footer(hints) {
    return hints.map(function (h) {
        var spaceIdx = h.indexOf(' ');
        if (spaceIdx > 0) {
            var key = h.slice(0, spaceIdx);
            var label = h.slice(spaceIdx + 1);
            return style.secondary('[' + key + ']') + ' ' + style.muted(label);
        }
        return style.muted(h);
    }).join('  ');
}

// Склейка обложки и правой колонки в одну сетку
function columns(posterLines, rightLines, rightWidth) {
    var pLines = Array.isArray(posterLines) ? posterLines : [];
    var rLines = Array.isArray(rightLines) ? rightLines : [];
    var rows = Math.max(pLines.length, rLines.length);
    var lines = [];
    var w = typeof rightWidth === 'number' ? rightWidth : 40;

    for (var i = 0; i < rows; i++) {
        var left = pLines[i] !== undefined ? pLines[i] : ansi.repeat(' ', POSTER_COLS);
        var right = rLines[i] !== undefined ? rLines[i] : '';
        lines.push(' ' + left + style.reset + ansi.repeat(' ', GAP) + ansi.pad(right, w));
    }

    return lines;
}

// Строка «1999 · фантастика · 136 мин · ★ 8.5»
function metaLine(film) {
    if (!film) return '';
    var parts = [];

    if (film.year) parts.push(String(film.year));
    if (film.genres && Array.isArray(film.genres) && film.genres.length > 0) parts.push(film.genres.slice(0, 2).join(', '));
    if (film.length) parts.push(film.length + ' мин');
    if (film.rating) parts.push((ansi.ascii ? '*' : '★') + ' ' + film.rating);

    return parts.join(' ' + glyph.dot + ' ');
}

// Шапка правой колонки
function filmHeader(film, width, descriptionLines) {
    film = film || {};
    var w = typeof width === 'number' ? width : 40;
    var lines = [];
    var mini = getMiniPlayerBar();
    if (mini) {
        lines.push(mini);
        lines.push('');
    }

    lines.push(style.bold(ansi.truncate(film.title || 'Видео', w)));

    if (film.original && film.original !== film.title) {
        lines.push(style.muted(ansi.truncate(film.original, w)));
    }

    var meta = metaLine(film);
    if (meta) {
        lines.push(style.muted(ansi.truncate(meta, w)));
        lines.push('');
    }

    if (descriptionLines > 0 && film.description) {
        ansi.wrap(film.description, w, descriptionLines).forEach(function (line) {
            lines.push(style.muted(line));
        });
        lines.push('');
    }

    return lines;
}

// Экран ввода одной строки
async function inputScreen(title, label, hintLines, initial) {
    var value = initial || '';

    while (true) {
        var size = metrics();
        var content = [''];

        hintLines.forEach(function (line) {
            ansi.wrap(line, size.width - 6, 4).forEach(function (wrapped) {
                content.push('  ' + style.muted(wrapped));
            });
        });

        content.push('');
        content.push('  ' + tui.field(label, value, true));
        content.push('');

        tui.paint(tui.box(title, content, size.width,
            footer(['Enter сохранить', 'Esc отмена'])));

        var key = await tui.readKey();

        if (key.name === 'escape') return null;
        if (key.name === 'return') return value.trim();

        var edited = tui.editText(value, key);
        if (edited !== null) value = edited;
    }
}

// Экран с сообщением
async function messageScreen(title, lines, hint, timeoutMs) {
    var size = metrics();
    var content = [''];

    lines.forEach(function (line) {
        ansi.wrap(line, size.width - 6, 8).forEach(function (wrapped) {
            content.push('  ' + wrapped);
        });
    });

    content.push('');

    tui.paint(tui.box(title, content, size.width, footer([hint || 'любая клавиша — назад'])));
    await tui.readKey(timeoutMs || 0);
}

// Экран подробного замера оперативной памяти (RAM Benchmark)
async function memoryBenchmarkScreen() {
    var sysinfo = require('./sysinfo');
    while (true) {
        var size = metrics();
        var stats = sysinfo.getMemoryStats();
        var content = [
            '',
            '  ' + style.bold('Реальное потребление RAM процессами KTW:'),
            '',
            '  ' + style.bold('• KTW (' + stats.runtime + ' TUI):') + '   ' + style.accent(stats.ktw + ' МБ') + style.muted(' (Resident RSS)'),
            '    ' + style.muted('- Heap JS движка:            ' + stats.heap + ' МБ'),
            '',
            '  ' + style.bold('• Видеоплеер mpv:') + '              ' + style.warn(stats.mpv + ' МБ') + style.muted(stats.mpvActive ? ' (активен сейчас)' : ' (базовый замер)'),
            '',
            '  ' + style.bold('• Терминал / Shell (TTY):') + '    ' + style.muted((stats.terminal > 0 ? stats.terminal : '—') + ' МБ'),
            '',
            '  ' + style.muted(ansi.repeat('─', Math.max(0, size.width - 8))),
            '  ' + style.bold('Всего используется RAM:') + '       ' + style.good(stats.total + ' МБ'),
            '',
            '  ' + style.good('✓ Для сравнения: браузеры расходуют от 800 до 2500 МБ памяти'),
            ''
        ];

        tui.paint(tui.box('Замер потребления оперативной памяти', content, size.width,
            footer(['Enter обновить', 'Esc назад'])));

        var key = await tui.readKey();
        if (key.name === 'escape') {
            break;
        }
    }
}

// Экран настроек (Settings)
async function settingsScreen() {
    var cfg = config.read();
    var selected = 0;

    var langOptions = ['ru', 'en'];
    var langLabels = ['Русский (RU)', 'English (EN)'];

    var playerOptions = ['', 'Collaps', 'Alloha', 'Kodik', 'Veoveo', 'Turbo'];
    var playerLabels = ['Авто (первый доступный)', 'Collaps (прямой поток)', 'Alloha', 'Kodik', 'Veoveo', 'Turbo'];

    var qualityOptions = ['', '1080', '720', '480', 'max', 'min'];
    var qualityLabels = ['Спрашивать всегда', '1080p (FHD)', '720p (HD)', '480p (SD)', 'Максимальное (4K/FHD)', 'Минимальное (трафик)'];

    var hwdecOptions = ['auto-safe', 'no', 'nvdec', 'vaapi', 'd3d11va'];
    var hwdecLabels = ['Авто (auto-safe)', 'Выкл (no)', 'NVIDIA (nvdec)', 'Intel/AMD Linux (vaapi)', 'Windows (d3d11va)'];

    var modeOptions = [false, true];
    var modeLabels = ['Прямой парсинг', 'Прямой парсинг (без браузера)'];

    var themeOptions = Object.keys(themes.THEMES);
    var themeLabels = themeOptions.map(function (k) { return themes.THEMES[k].name; });

    var bannerOptions = themes.FONT_KEYS;
    var sizeOptions = ['auto', 'full', 'compact', 'mini'];
    var sizeLabels = ['Авто (адаптивный)', 'Полный (KINOTEKA)', 'Компактный (KTW)', 'Мини (ktw)'];

    var winSizeOptions = ['compact', 'medium', 'large', 'fullscreen'];
    var winSizeLabels = ['Компактное', 'Среднее', 'Большое', 'На весь экран'];

    while (true) {
        var size = metrics();

        var items = [
            {
                key: 'lang',
                label: t('lang_label'),
                valueText: langLabels[langOptions.indexOf(cfg.lang || 'ru')] || 'Русский (RU)'
            },
            {
                key: 'theme',
                label: t('theme_label'),
                valueText: themes.THEMES[cfg.theme || 'classic_bw'] ? themes.THEMES[cfg.theme || 'classic_bw'].name : (cfg.theme || 'Classic Monochrome')
            },
            {
                key: 'bannerStyle',
                label: 'Стиль ANSI логотипа',
                valueText: themes.FONT_LABELS[cfg.bannerStyle || 'auto'] || (cfg.bannerStyle || 'Авто')
            },
            {
                key: 'bannerSize',
                label: 'Размер логотипа',
                valueText: sizeLabels[sizeOptions.indexOf(cfg.bannerSize || 'auto')] || (cfg.bannerSize || 'Авто')
            },
            {
                key: 'openStand',
                label: t('stand_label'),
                valueText: t('stand_btn')
            },
            {
                key: 'preferredPlayer',
                label: t('player_label'),
                valueText: playerLabels[playerOptions.indexOf(cfg.preferredPlayer || '')] || (cfg.preferredPlayer || 'Авто')
            },
            {
                key: 'preferredTranslation',
                label: t('translation_label'),
                valueText: cfg.preferredTranslation ? ('«' + cfg.preferredTranslation + '»') : 'Выбирать вручную'
            },
            {
                key: 'preferredQuality',
                label: t('quality_label'),
                valueText: qualityLabels[qualityOptions.indexOf(cfg.preferredQuality || '')] || (cfg.preferredQuality || 'Спрашивать')
            },
            {
                key: 'directOnly',
                label: t('mode_label'),
                valueText: modeLabels[cfg.directOnly ? 1 : 0]
            },
            {
                key: 'mpvWindowSize',
                label: 'Размер окна mpv',
                valueText: winSizeLabels[winSizeOptions.indexOf(cfg.mpvWindowSize || (cfg.mpvFullscreen ? 'fullscreen' : 'compact'))] || 'Компактное'
            },
            {
                key: 'mpvHardwareDec',
                label: t('hwdec_label'),
                valueText: hwdecLabels[hwdecOptions.indexOf(cfg.mpvHardwareDec || 'auto-safe')] || (cfg.mpvHardwareDec || 'auto-safe')
            },
            {
                key: 'kinoboxApiUrl',
                label: t('mirror_label'),
                valueText: cfg.kinoboxApiUrl ? ansi.truncate(cfg.kinoboxApiUrl, 26) : 'По умолчанию (fbphdplay.top)'
            },
            {
                key: 'kinopoiskApiKey',
                label: t('key_label'),
                valueText: cfg.kinopoiskApiKey ? (cfg.kinopoiskApiKey.slice(0, 8) + '…' + cfg.kinopoiskApiKey.slice(-4)) : t('key_not_set')
            },
            {
                key: 'torrserveUrl',
                label: 'TorrServer URL',
                valueText: cfg.torrserveUrl || 'http://127.0.0.1:8090'
            },
            {
                key: 'memoryBenchmark',
                label: 'Замер памяти (RAM)',
                valueText: (function () {
                    var ms = require('./sysinfo').getMemoryStats();
                    return 'KTW ' + ms.ktw + ' МБ + mpv ' + ms.mpv + ' МБ' + (ms.terminal > 0 ? (' + TTY ' + ms.terminal + ' МБ') : '') + ' = ' + ms.total + ' МБ';
                })()
            },
            {
                key: 'updateKtw',
                label: 'Обновление KTW',
                valueText: 'Проверить и обновить'
            },
            {
                key: 'donate',
                label: t('donate_label') || 'Поддержать автора (Donatty)',
                valueText: t('donate_val') || 'donatty.com/nedoedal [Enter]'
            }
        ];

        if (activePlayback.session && activePlayback.session.isAlive()) {
            items.unshift({
                key: 'openController',
                label: 'Пульт плеера (HUD)',
                valueText: 'Открыть пульт [Ctrl+P]'
            });
        }

        var content = [
            '',
            '  ' + style.bold(t('settings_title')),
            '  ' + style.muted(t('settings_sub')),
            ''
        ];

        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var isActive = i === selected;
            var marker = isActive ? style.accent(glyph.arrow + ' ') : '  ';
            var line = marker + style.bold(item.label) + ': ' + style.accent(item.valueText);
            content.push('  ' + line);
        }

        content.push('');

        tui.paint(tui.box(t('settings_title'), content, size.width,
            footer([glyph.up + glyph.down + ' ' + t('key_nav'), 'Enter ' + t('key_enter'), 'Esc ' + t('key_back')])));

        var key = await tui.readKey();

        if (key.name === 'escape') break;

        if (key.name === 'up') {
            selected = (selected - 1 + items.length) % items.length;
            continue;
        }

        if (key.name === 'down') {
            selected = (selected + 1) % items.length;
            continue;
        }

        if (key.name === 'return' || key.name === 'space' || key.name === 'right' || key.name === 'left') {
            var cur = items[selected];

            if (cur.key === 'lang') {
                var curLIdx = langOptions.indexOf(cfg.lang || 'ru');
                var nextLIdx = (curLIdx + (key.name === 'left' ? -1 : 1) + langOptions.length) % langOptions.length;
                cfg.lang = langOptions[nextLIdx];
                config.save({ lang: cfg.lang });
            } else if (cur.key === 'theme' || cur.key === 'bannerStyle' || cur.key === 'bannerSize' || cur.key === 'openStand') {
                var standRes = await require('./stand').runStand();
                if (standRes) {
                    cfg.theme = standRes.theme;
                    cfg.bannerStyle = standRes.bannerStyle;
                    cfg.bannerSize = standRes.bannerSize;
                }
            } else if (cur.key === 'preferredPlayer') {
                var curPIdx = playerOptions.indexOf(cfg.preferredPlayer || '');
                var nextPIdx = (curPIdx + (key.name === 'left' ? -1 : 1) + playerOptions.length) % playerOptions.length;
                cfg.preferredPlayer = playerOptions[nextPIdx];
                config.save({ preferredPlayer: cfg.preferredPlayer });
            } else if (cur.key === 'preferredTranslation') {
                var newTr = await inputScreen(t('translation_label'), 'Озвучка', [
                    'Название студии или переводчика (например: LostFilm, Дублированный, Goblin, Кубик в кубе).',
                    'Если поле пустое — озвучка будет выбираться вручную из списка.'
                ], cfg.preferredTranslation || '');
                if (newTr !== null) {
                    cfg.preferredTranslation = newTr;
                    config.save({ preferredTranslation: newTr });
                }
            } else if (cur.key === 'preferredQuality') {
                var curQIdx = qualityOptions.indexOf(cfg.preferredQuality || '');
                var nextQIdx = (curQIdx + (key.name === 'left' ? -1 : 1) + qualityOptions.length) % qualityOptions.length;
                cfg.preferredQuality = qualityOptions[nextQIdx];
            } else if (cur.key === 'directOnly') {
                cfg.directOnly = !cfg.directOnly;
                config.save({ directOnly: cfg.directOnly });
            } else if (cur.key === 'mpvWindowSize') {
                var curWIdx = winSizeOptions.indexOf(cfg.mpvWindowSize || (cfg.mpvFullscreen ? 'fullscreen' : 'compact'));
                var nextWIdx = (curWIdx + (key.name === 'left' ? -1 : 1) + winSizeOptions.length) % winSizeOptions.length;
                cfg.mpvWindowSize = winSizeOptions[nextWIdx];
                cfg.mpvFullscreen = (cfg.mpvWindowSize === 'fullscreen');
                config.save({ mpvWindowSize: cfg.mpvWindowSize, mpvFullscreen: cfg.mpvFullscreen });
            } else if (cur.key === 'mpvFullscreen') {
                cfg.mpvFullscreen = !cfg.mpvFullscreen;
                config.save({ mpvFullscreen: cfg.mpvFullscreen });
            } else if (cur.key === 'mpvHardwareDec') {
                var curHIdx = hwdecOptions.indexOf(cfg.mpvHardwareDec || 'auto-safe');
                var nextHIdx = (curHIdx + (key.name === 'left' ? -1 : 1) + hwdecOptions.length) % hwdecOptions.length;
                cfg.mpvHardwareDec = hwdecOptions[nextHIdx];
                config.save({ mpvHardwareDec: cfg.mpvHardwareDec });
            } else if (cur.key === 'kinoboxApiUrl') {
                var newMirror = await inputScreen(t('mirror_label'), 'URL', [
                    'Базовый URL зеркала Kinobox API (например: https://fbphdplay.top/api/players).',
                    'Оставь пустым для использования стандартных зеркал.'
                ], cfg.kinoboxApiUrl || '');
                if (newMirror !== null) {
                    cfg.kinoboxApiUrl = newMirror;
                    config.save({ kinoboxApiUrl: newMirror });
                }
            } else if (cur.key === 'kinopoiskApiKey') {
                var newKey = await inputScreen(t('key_label'), 'Ключ', [
                    'Ключ с сайта kinopoiskapiunofficial.tech',
                    'Даёт поиск с подсказками, обложки, описания и серии.'
                ], cfg.kinopoiskApiKey || '');
                if (newKey !== null) {
                    cfg.kinopoiskApiKey = newKey;
                    config.save({ kinopoiskApiKey: newKey });
                }
            } else if (cur.key === 'torrserveUrl') {
                var newTsUrl = await inputScreen('Адрес TorrServer', 'URL', [
                    'Базовый адрес сервера TorrServer MatriX (например: http://127.0.0.1:8090).',
                    'Позволяет воспроизводить торренты на лету в 4K / 1080p.'
                ], cfg.torrserveUrl || 'http://127.0.0.1:8090');
                if (newTsUrl !== null) {
                    cfg.torrserveUrl = newTsUrl;
                    config.save({ torrserveUrl: newTsUrl });
                }
            } else if (cur.key === 'openController') {
                await playbackControllerScreen();
            } else if (cur.key === 'memoryBenchmark') {
                await memoryBenchmarkScreen();
            } else if (cur.key === 'updateKtw') {
                tui.exit();
                await require('./update').runUpdate();
                ui.info(ui.color.dim('  Нажми Enter для возврата в настройки...'));
                await new Promise(function (res) {
                    process.stdin.setEncoding('utf8');
                    process.stdin.resume();
                    process.stdin.once('data', function () { res(); });
                });
                tui.enter();
            } else if (cur.key === 'donate') {
                var donateUrl = 'https://donatty.com/nedoedal';
                var openCmd = process.platform === 'win32'
                    ? 'start "" "' + donateUrl + '"'
                    : (process.platform === 'darwin' ? 'open "' + donateUrl + '"' : 'xdg-open "' + donateUrl + '"');
                try {
                    require('child_process').exec(openCmd, function () {});
                } catch (e) {}

                await messageScreen('Поддержка автора (Donatty)', [
                    'Спасибо за поддержку KinoTeka Watch!',
                    '',
                    style.bold('Ссылка для доната: ') + style.accent(donateUrl),
                    style.muted('(страница открыта в твоём браузере)'),
                    '',
                    'Автор проекта: ' + style.bold('Droopi') + ' (FLEXIY0)'
                ], 'любая клавиша — назад');
            }

            syncSettingsToLivePlayer(cfg);
        }

        if ((key.ctrl && key.name === 'p') || key.name === 'f4') {
            if (activePlayback.session && activePlayback.session.isAlive()) {
                await playbackControllerScreen();
            }
        }
    }
}

// Экран истории просмотров: интерактивная карточная галерея (History Card Gallery)
async function historyScreen() {
    var selected = 0;
    var cachedPosters = {};

    while (true) {
        var size = metrics();
        var items = history.getRecent(50);

        if (items.length === 0) {
            await messageScreen(t('history_title'), [
                t('empty_history'),
                '',
                t('empty_history_sub')
            ], 'любая клавиша — назад');
            return null;
        }

        selected = Math.max(0, Math.min(selected, items.length - 1));
        var chosen = items[selected];

        var posterLines = [];
        if (size.withPoster && chosen.poster) {
            if (!cachedPosters[chosen.filmId]) {
                cachedPosters[chosen.filmId] = await poster.render(chosen.poster, chosen.title, POSTER_COLS, POSTER_ROWS).catch(function () { return []; });
            }
            posterLines = cachedPosters[chosen.filmId] || [];
        }

        var rightLines = [];
        rightLines.push(style.bold(ansi.truncate(chosen.title, size.rightWidth)));
        var typeInfo = chosen.serial ? 'Сериал' : 'Фильм';
        if (chosen.year) {
            rightLines.push(style.muted(String(chosen.year) + ' · ' + typeInfo));
        } else {
            rightLines.push(style.muted(typeInfo));
        }
        rightLines.push('');

        if (chosen.serial && chosen.season && chosen.episode) {
            var numStr = 'S' + (chosen.season < 10 ? '0' : '') + chosen.season + 'E' + (chosen.episode < 10 ? '0' : '') + chosen.episode;
            rightLines.push(style.bold('Остановились: ') + style.accent('[' + numStr + ']'));
        }

        if (chosen.timePos > 0 && chosen.duration > 0) {
            var filled = Math.min(10, Math.max(1, Math.round(chosen.percentage / 10)));
            var bar = ansi.repeat('▰', filled) + ansi.repeat('▱', 10 - filled);
            rightLines.push(style.bold('Таймкод: ') + style.good(bar + ' ' + chosen.percentage + '%'));
            rightLines.push(style.muted('  ' + history.formatTime(chosen.timePos) + ' / ' + history.formatTime(chosen.duration)));
        } else if (chosen.watched) {
            rightLines.push(style.good('✓ Полностью просмотрено'));
        }
        if (chosen.userRating) {
            rightLines.push(style.bold('Оценка: ') + style.warn('★ ' + chosen.userRating + '/10') + style.muted(' · [*] изменить'));
        } else {
            rightLines.push(style.muted('Оценка: ') + style.dim('не выставлена · [*] оценить'));
        }
        rightLines.push('');

        if (chosen.serial) {
            var watchedCount = history.getWatchedEpisodesCount(chosen.filmId);
            rightLines.push(style.bold('Просмотрено: ') + style.accent(watchedCount + ' сер.') + style.muted(' · [r] сбросить'));
        }

        if (chosen.player) {
            rightLines.push(style.muted('Плеер: ' + chosen.player + (chosen.translation ? (' · ' + chosen.translation) : '')));
        }

        var hasPoster = Array.isArray(posterLines) && posterLines.length > 0;
        var cardLines = (size.withPoster && hasPoster)
            ? columns(posterLines, rightLines, size.rightWidth)
            : rightLines.map(function (l) { return '  ' + l; });

        var content = [''];
        cardLines.forEach(function (l) { content.push(l); });
        content.push('');

        var headerTitle = t('history_title') + ' (' + (selected + 1) + '/' + items.length + ')';
        var historyHints = chosen.serial
            ? ['←/→ карточки', 'Enter ' + t('key_play'), 'e серии сезона', '* оценка', 'r ' + t('key_reset'), 'd ' + t('key_delete'), 'Esc ' + t('key_back')]
            : ['←/→ карточки', 'Enter ' + t('key_play'), '* оценка', 'r ' + t('key_reset'), 'd ' + t('key_delete'), 'Esc ' + t('key_back')];

        tui.paint(tui.box(headerTitle, content, size.width, footer(historyHints)));

        var key = await tui.readKey();

        if (key.name === 'escape') return null;

        // Хоткей 'e' / Tab — перейти сразу к выбору серий этого сезона
        if (chosen.serial && (key.name === 'e' || key.name === 'tab' || key.str === 'e' || key.str === 'E' || key.str === 'у' || key.str === 'У')) {
            return {
                id: chosen.filmId,
                title: chosen.title,
                year: chosen.year,
                poster: chosen.poster,
                serial: true,
                openSeason: chosen.season || 1,
                openEpisode: chosen.episode || 1,
                openEpisodesOnly: true
            };
        }

        if ((key.ctrl && key.name === 'p') || key.name === 'f4') {
            if (activePlayback.session && activePlayback.session.isAlive()) {
                await playbackControllerScreen(posterLines);
                continue;
            }
        }

        if (key.ctrl && (key.name === 'x' || key.name === 'q')) {
            if (activePlayback.session && activePlayback.session.isAlive()) {
                activePlayback.session.quit();
                activePlayback.session = null;
                mpv.clearSessionFile();
                continue;
            }
        }

        if (key.name === 'left' || key.name === 'up') {
            selected = (selected - 1 + items.length) % items.length;
            continue;
        }

        if (key.name === 'right' || key.name === 'down') {
            selected = (selected + 1) % items.length;
            continue;
        }

        // Выставить / изменить личную оценку фильма или сериала (* / s / 1-9 / 0)
        if (key.str === '*' || key.str === 's' || (key.str >= '0' && key.str <= '9')) {
            var directRate = (key.str >= '1' && key.str <= '9') ? Number(key.str) : (key.str === '0' ? 10 : null);
            if (directRate !== null) {
                history.setUserRating(chosen.filmId, directRate);
                continue;
            }
            var ratingItems = [
                { label: '★ 10 · Шедевр', val: 10 },
                { label: '★ 9  · Великолепно', val: 9 },
                { label: '★ 8  · Отлично', val: 8 },
                { label: '★ 7  · Хорошо', val: 7 },
                { label: '★ 6  · Неплохо', val: 6 },
                { label: '★ 5  · Средне', val: 5 },
                { label: '★ 4  · Слабо', val: 4 },
                { label: '★ 3  · Плохо', val: 3 },
                { label: '★ 2  · Ужасно', val: 2 },
                { label: '★ 1  · Кошмар', val: 1 },
                { label: '↺ Сбросить оценку', val: null }
            ];
            var pickedR = await pickerScreen(chosen, posterLines, 'Оценка: ' + chosen.title, ratingItems.map(function (r) {
                var isCur = chosen.userRating === r.val;
                return { label: (isCur ? style.good('✓ ') : '  ') + r.label };
            }), ['Enter сохранить', 'Esc отмена']);
            if (typeof pickedR === 'number' && ratingItems[pickedR]) {
                history.setUserRating(chosen.filmId, ratingItems[pickedR].val);
            }
            continue;
        }

        // Сбросить прогресс сериала / фильма или конкретных серий
        if (key.name === 'r') {
            if (chosen.serial) {
                var watchedList = history.getWatchedEpisodesList(chosen.filmId);
                var resetMenu = [
                    { label: '↺ Сбросить весь сериал', hint: 'очистить отметки всех серий и таймкод' }
                ];
                if (watchedList.length > 0) {
                    resetMenu.push({
                        label: '📋 Выбрать конкретные серии для сброса',
                        hint: watchedList.length + ' просмотрено'
                    });
                }

                var rChoice = await pickerScreen(chosen, posterLines, 'Сброс прогресса · ' + chosen.title, resetMenu,
                    ['Enter выбрать', 'Esc отмена']);

                if (rChoice === 0) {
                    history.resetSerial(chosen.filmId);
                } else if (rChoice === 1) {
                    while (true) {
                        var curWatched = history.getWatchedEpisodesList(chosen.filmId);
                        if (curWatched.length === 0) break;
                        var epItems = curWatched.map(function (epKey) {
                            var parts = epKey.split('_');
                            var sNum = Number(parts[0]);
                            var eNum = Number(parts[1]);
                            var tag = 'S' + (sNum < 10 ? '0' : '') + sNum + 'E' + (eNum < 10 ? '0' : '') + eNum;
                            return { label: '✓ ' + tag, hint: 'Enter снять отметку', s: sNum, e: eNum };
                        });
                        var pickedEpIdx = await pickerScreen(chosen, posterLines, 'Сброс серий (' + curWatched.length + ' просм.)', epItems,
                            ['Enter снять отметку', 'Esc готово']);
                        if (typeof pickedEpIdx === 'number' && epItems[pickedEpIdx]) {
                            history.unmarkEpisode(chosen.filmId, epItems[pickedEpIdx].s, epItems[pickedEpIdx].e);
                        } else {
                            break;
                        }
                    }
                }
            } else {
                history.resetSerial(chosen.filmId);
            }
            continue;
        }

        // Удалить фильм из истории
        if (key.name === 'd' || key.name === 'delete') {
            history.remove(chosen.filmId);
            delete cachedPosters[chosen.filmId];
            if (selected >= items.length - 1) selected = Math.max(0, items.length - 2);
            continue;
        }

        if (key.name === 'return' || key.name === 'space') {
            return {
                id: chosen.filmId,
                title: chosen.title,
                year: chosen.year,
                poster: chosen.poster,
                serial: chosen.serial,
                resumeSeason: chosen.season,
                resumeEpisode: chosen.episode,
                resumeTime: chosen.timePos,
                resumePlayer: chosen.player,
                resumeTranslation: chosen.translation,
                resumeQuality: chosen.quality
            };
        }
    }
}

// Экран 1 — поиск с живыми подсказками и блоком «Продолжить просмотр»
async function searchScreen(state, apiKey) {
    var query = state.query || '';
    var results = state.results || [];
    var selected = 0;
    var status = null;
    var pendingSearch = !!apiKey && query.length >= 2 && results.length === 0;

    var recentHistory = history.getRecent(4);

    donatty.fetchTopDonators().then(function (list) {
        if (list && list.length > 0) {
            tui.redraw();
        }
    });

    function render(spinnerFrame) {
        var size = metrics();
        var content = [''];

        if (query.trim().length === 0 && !spinnerFrame) {
            var cfg = config.read();
            var logoLines = themes.renderLogo(cfg.theme || 'classic_bw', cfg.bannerStyle || 'auto', size.width - 6, cfg.bannerSize || 'auto');
            logoLines.forEach(function (l) {
                var len = ansi.visibleWidth(l);
                var indent = ansi.repeat(' ', Math.max(0, Math.floor((size.width - 6 - len) / 2)));
                content.push('  ' + indent + l);
            });
            if (logoLines.length > 0) content.push('');
        }

        var mini = getMiniPlayerBar();
        if (mini) {
            content.push('  ' + mini);
            content.push('');
        }

        content.push('  ' + tui.field('Поиск', query, true));
        content.push('');

        if (spinnerFrame) {
            content.push('  ' + style.accent(spinnerFrame) + ' ' + style.muted('поиск…'));
        } else if (results.length > 0) {
            if (status) content.push('  ' + style.warn(status));
            var items = results.map(function (film) {
                var ratingStr = film.rating ? style.warn('★ ' + film.rating) : '';
                var yearStr = film.year ? String(film.year) : '';
                var typeStr = film.type ? style.muted(film.type) : '';
                var hint = [ratingStr, yearStr, typeStr].filter(Boolean).join(' ' + glyph.dot + ' ');
                return {
                    label: film.title,
                    hint: hint
                };
            });

            tui.list(items, selected, size.listRows, size.width - 4).forEach(function (line) {
                content.push(line);
            });
        } else if (query.trim().length === 0 && recentHistory.length > 0) {
            if (status) {
                content.push('  ' + style.accent(status));
                content.push('');
            }
            content.push('  ' + style.bold('Продолжить просмотр:'));
            var hItems = recentHistory.map(function (item) {
                var epTag = item.season && item.episode ? ' (S' + item.season + 'E' + item.episode + ')' : '';
                var label = item.title + epTag;
                var prog = '';
                if (item.timePos > 0 && item.duration > 0) {
                    var filled = Math.min(5, Math.max(1, Math.round(item.percentage / 20)));
                    var bar = ansi.repeat('▰', filled) + ansi.repeat('▱', 5 - filled);
                    prog = style.good(bar + ' ' + item.percentage + '%') + ' · ' + history.formatTime(item.timePos);
                } else if (item.watched) {
                    prog = style.good('✓ ' + t('watched'));
                }
                return { label: label, hint: prog };
            });
            tui.list(hItems, selected, Math.min(4, size.listRows), size.width - 4).forEach(function (line) {
                content.push(line);
            });
        } else if (!apiKey) {
            if (status) content.push('  ' + style.warn(status));
            content.push('  ' + style.muted('поиск по базе Kinobox  ·  Ctrl+K ключ  ·  Ctrl+S настройки  ·  Ctrl+H история'));
        } else {
            if (status) content.push('  ' + style.warn(status));
            content.push('  ' + style.muted('введите название и нажмите Enter  ·  Ctrl+S настройки  ·  Ctrl+H история'));
        }

        content.push('');

        var hints = (query.trim().length === 0 && recentHistory.length > 0)
            ? [glyph.up + glyph.down + ' ' + t('key_nav'), 'Enter ' + t('key_open'), 'e / → серии', 'Ctrl+S ' + t('key_settings'), 'Ctrl+H ' + t('key_history'), 'Esc ' + t('key_exit')]
            : [glyph.up + glyph.down + ' ' + t('key_nav'), 'Enter ' + t('key_open'), 'Ctrl+S ' + t('key_settings'), 'Ctrl+H ' + t('key_history'), 'Esc ' + t('key_exit')];

        var boxLines = tui.box('ktw', content, size.width, footer(hints));

        // Отображение последних донатов / топа поддержки под футером
        var donators = donatty.getCachedDonators();
        if (donators && donators.length > 0) {
            var donText = donatty.formatDonatorsBanner(donators, size.width);
            var donCenter = Math.max(0, Math.floor((size.width - ansi.visibleWidth(donText)) / 2));
            boxLines.push('');
            boxLines.push(ansi.repeat(' ', donCenter) + style.warn(donText));
        }

        return boxLines;
    }

    async function runSearch() {
        if (query.trim().length < 2) {
            status = 'слишком короткий запрос';
            results = [];
            return;
        }

        status = null;

        try {
            results = await tui.withSpinner(api.searchFilms(query.trim(), apiKey), render);
            selected = 0;
            if (results.length === 0) status = 'ничего не нашлось по запросу «' + query.trim() + '»';
        } catch (err) {
            results = [];
            status = err.message;
        }
    }

    while (true) {
        tui.paint(render());

        var key = await tui.readKey(pendingSearch ? 400 : 0);

        if (key === null) {
            pendingSearch = false;
            await runSearch();
            continue;
        }

        if (key.name === 'redraw') {
            continue;
        }

        if (key.name === 'escape') return null;

        // Ctrl+S / F1 — открыть настройки
        if ((key.ctrl && key.name === 's') || key.name === 'f1') {
            state.query = query;
            return 'settings';
        }

        // Ctrl+H / F2 / Ctrl+Y / \x08 — открыть историю
        if ((key.ctrl && key.name === 'h') || key.name === 'f2' || (key.ctrl && key.name === 'y') || key.str === '\x08' || key.str === '\b') {
            state.query = query;
            return 'history';
        }

        // Ctrl+K / F3 — вставить ключ Кинопоиска
        if ((key.ctrl && key.name === 'k') || key.name === 'f3') {
            state.query = query;
            return 'key';
        }

        // Ctrl+P / F4 — открыть интерактивный пульт плеера
        if ((key.ctrl && key.name === 'p') || key.name === 'f4') {
            if (activePlayback.session && activePlayback.session.isAlive()) {
                await playbackControllerScreen();
                recentHistory = history.getRecent(4);
                continue;
            }
        }

        // Ctrl+X — остановить воспроизведение mpv в фоне
        if (key.ctrl && (key.name === 'x' || key.name === 'q')) {
            if (activePlayback.session && activePlayback.session.isAlive()) {
                activePlayback.session.quit();
                activePlayback.session = null;
                mpv.clearSessionFile();
                status = '✓ Воспроизведение остановлено';
                recentHistory = history.getRecent(4);
                tui.paint(render());
                continue;
            }
        }

        // Хоткей перехода сразу к выбору серий для элементов «Продолжить просмотр»
        var isEpKey = key.name === 'e' || key.name === 'tab' || key.name === 'right' ||
                      key.str === 'e' || key.str === 'E' || key.str === 'у' || key.str === 'У';

        if (isEpKey && query.trim().length === 0 && recentHistory.length > 0 && selected < recentHistory.length) {
            var targetH = recentHistory[selected];
            if (targetH && (targetH.serial || targetH.season)) {
                return {
                    id: targetH.filmId,
                    title: targetH.title,
                    year: targetH.year,
                    poster: targetH.poster,
                    serial: true,
                    openSeason: targetH.season || 1,
                    openEpisode: targetH.episode || 1,
                    openEpisodesOnly: true
                };
            }
        }

        if (key.name === 'return') {
            // Если запрос пустой и выбран пункт из истории
            if (query.trim().length === 0 && recentHistory.length > 0 && selected < recentHistory.length) {
                var h = recentHistory[selected];
                return {
                    id: h.filmId,
                    title: h.title,
                    year: h.year,
                    poster: h.poster,
                    serial: h.serial,
                    resumeSeason: h.season,
                    resumeEpisode: h.episode,
                    resumeTime: h.timePos,
                    resumePlayer: h.player,
                    resumeTranslation: h.translation,
                    resumeQuality: h.quality
                };
            }

            if (!apiKey) {
                if (query.trim().length < 2) continue;
                state.query = query;
                return { id: null, title: query.trim(), keyless: true };
            }

            if (results.length > 0) {
                state.query = query;
                state.results = results;
                return results[selected];
            }

            pendingSearch = false;
            await runSearch();
            continue;
        }

        var maxItems = results.length > 0 ? results.length : (query.trim().length === 0 ? recentHistory.length : 0);

        if (key.name === 'up' && maxItems > 0) {
            selected = (selected - 1 + maxItems) % maxItems;
            continue;
        }

        if (key.name === 'down' && maxItems > 0) {
            selected = (selected + 1) % maxItems;
            continue;
        }

        var edited = tui.editText(query, key);

        if (edited !== null && edited !== query) {
            query = edited;
            status = null;
            results = [];
            selected = 0;
            pendingSearch = !!apiKey && query.trim().length >= 2;
        }
    }
}

// Универсальный экран выбора с обложкой слева
async function pickerScreen(film, posterLines, title, items, hints, descriptionLines, initialIndex, onCustomKey) {
    posterLines = Array.isArray(posterLines) ? posterLines : [];
    items = Array.isArray(items) ? items : [];
    hints = Array.isArray(hints) ? hints : [];
    var selected = initialIndex && initialIndex < items.length ? initialIndex : 0;

    while (true) {
        var size = metrics();
        var right = filmHeader(film, size.rightWidth, descriptionLines);

        right.push(style.bold(title));

        if (items.length === 0) {
            right.push(style.muted('пусто'));
        } else {
            tui.list(items, selected, size.listRows, size.rightWidth + 2).forEach(function (line) {
                right.push(line.replace(/^ {2}/, ''));
            });
        }

        var hasPoster = posterLines.length > 0;
        var content = (size.withPoster && hasPoster)
            ? columns(posterLines, right, size.rightWidth)
            : right.map(function (line) { return ' ' + ansi.pad(line, size.width - 3); });

        tui.paint(tui.box(null, [''].concat(content, ['']), size.width, footer(hints)));

        var key = await tui.readKey();

        if (onCustomKey) {
            var customRes = onCustomKey(key, selected);
            if (customRes !== undefined && customRes !== null) {
                return customRes;
            }
        }

        if (key.name === 'escape') return 'back';
        if (key.ctrl && key.name === 's') return 'settings';
        if (key.ctrl && key.name === 'h') return 'history';
        if ((key.ctrl && key.name === 'p') || key.name === 'f4') {
            if (activePlayback.session && activePlayback.session.isAlive()) {
                await playbackControllerScreen(posterLines);
                continue;
            }
        }
        if (key.ctrl && (key.name === 'x' || key.name === 'q')) {
            if (activePlayback.session && activePlayback.session.isAlive()) {
                activePlayback.session.quit();
                activePlayback.session = null;
                mpv.clearSessionFile();
                continue;
            }
        }
        if (key.name === 'return' && items.length > 0) return selected;
        if (key.name === 'up') selected = (selected - 1 + items.length) % items.length;
        if (key.name === 'down') selected = (selected + 1) % items.length;
        if (key.name === 'pageup') selected = Math.max(0, selected - size.listRows);
        if (key.name === 'pagedown') selected = Math.min(items.length - 1, selected + size.listRows);
        if (key.name === 'home') selected = 0;
        if (key.name === 'end') selected = items.length - 1;
    }
}

// Выбор качества из мастер-плейлиста
async function pickQuality(film, posterLines, found, variants, options, state, player, resumeQuality) {
    var userConfig = config.read();
    var wanted = options.quality || resumeQuality || userConfig.preferredQuality;
    var chosen = wanted ? stream.pickVariant(variants, wanted) : null;

    if (!chosen) {
        var items = variants.map(function (item) {
            return {
                label: item.label,
                hint: item.bandwidth ? Math.round(item.bandwidth / 1000) + ' кбит/с' : ''
            };
        });

        // Список пуст — значит мастер-плейлист не прочитался. Показываем
        // настоящую причину: раньше сюда подставлялась метка из ответа
        // Kinobox, и поломка выглядела как «качество 1080p» на любом фильме.
        if (items.length === 0) {
            items = [{
                label: 'как есть',
                hint: variants.reason || 'балансер отдал одну дорожку'
            }];
        }

        var preselect = 0;
        variants.forEach(function (item, index) {
            if (state.quality && item.height === state.quality) preselect = index;
        });

        var index = await pickerScreen(film, posterLines, 'Качество', items,
            [glyph.up + glyph.down + ' выбор', 'Enter смотреть', 'Esc назад'], 0, preselect);

        if (index === 'back') return null;
        if (index === 'settings') return 'settings';
        if (variants.length === 0) return found;

        chosen = variants[index];
    }

    if (!chosen) return found;

    state.quality = chosen.height;

    return stream.applyVariant(found, chosen);
}

// Интерактивный экран обратного отсчета для авто-перехода к следующей серии (Binge-Watching)
async function nextEpisodeCountdown(film, nextSeason, nextEpisode, countdownSeconds) {
    var remaining = countdownSeconds || 5;

    while (remaining > 0) {
        var size = metrics();
        var content = [
            '',
            '  ' + style.accent('✓') + ' ' + style.bold('Серия завершена!'),
            '',
            '  ' + style.bold(film.title),
            '  ' + style.accent('Следующая: Сезон ' + nextSeason + ', Серия ' + nextEpisode),
            '',
            '  ' + style.muted('Автозапуск через ' + remaining + ' сек…'),
            ''
        ];

        tui.paint(tui.box('Binge-Watching', content, size.width,
            footer(['Enter смотреть сейчас', 'Esc остановить просмотр'])));

        var key = await tui.readKey(1000);

        if (key === null) {
            remaining--;
            continue;
        }

        if (key.name === 'escape') return false;
        if (key.name === 'return' || key.name === 'space') return true;
    }

    return true;
}

// Интерактивный пульт управления mpv на лету (открывается по Ctrl+P, не закрывая плеер)
async function playbackControllerScreen(posterLines) {
    posterLines = Array.isArray(posterLines) ? posterLines : [];
    if (!activePlayback.session || !activePlayback.session.isAlive()) {
        await messageScreen('Пульт управления', [
            'Сейчас нет активного воспроизведения mpv.',
            '',
            'Запусти фильм или сериал, и пульт будет доступен по Ctrl+P в любой момент.'
        ], 'любая клавиша — назад');
        return;
    }

    var session = activePlayback.session;
    var film = activePlayback.film || { title: 'Видео' };
    var player = activePlayback.player || { source: 'mpv' };
    var season = activePlayback.season;
    var episode = activePlayback.episode;
    var variants = activePlayback.variants || [];
    var epInfo = (season && episode) ? (' · S' + (season < 10 ? '0' : '') + season + 'E' + (episode < 10 ? '0' : '') + episode) : '';

    var toast = null;
    var toastTimer = null;

    function setToast(msg) {
        toast = msg;
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toast = null; }, 3000);
    }

    var audioTracks = (activePlayback.stream && activePlayback.stream.audioTracks && activePlayback.stream.audioTracks.length > 0)
        ? activePlayback.stream.audioTracks
        : ((player && player.translations) || []);

    while (session.isAlive()) {
        var size = metrics();
        var playbackState = session.getState();

        var timePos = playbackState.timePos || 0;
        var duration = playbackState.duration || 0;
        var isPaused = playbackState.pause;
        var vol = playbackState.volume !== undefined ? Math.round(playbackState.volume) : 100;
        var spd = playbackState.speed !== undefined ? Number(playbackState.speed).toFixed(2) : '1.00';
        var isFs = playbackState.fullscreen;

        var pct = duration > 0 ? Math.min(100, Math.round((timePos / duration) * 100)) : 0;
        var barW = Math.max(10, Math.min(30, size.width - 34));
        var filled = Math.round((pct / 100) * barW);
        var progressBar = style.good(ansi.repeat('▰', filled)) + style.muted(ansi.repeat('▱', Math.max(0, barW - filled)));

        var timeStr = history.formatTime(timePos) + ' / ' + history.formatTime(duration);

        var rightLines = [];
        rightLines.push(style.bold(ansi.truncate(film.title + epInfo, size.rightWidth)));
        rightLines.push(style.muted('Плеер: ') + style.accent(player.source + (player.direct ? ' [прямой]' : '')) +
            (activePlayback.stream && activePlayback.stream.label ? (style.muted(' · Качество: ') + style.warn(activePlayback.stream.label)) : ''));
        rightLines.push('');

        var statusIcon = isPaused ? style.warn('⏸ ПАУЗА') : style.good('▶ ВОСПРОИЗВЕДЕНИЕ');
        rightLines.push(statusIcon + '  ' + style.bold(timeStr) + style.accent(' (' + pct + '%)'));
        rightLines.push(progressBar);
        rightLines.push('');

        var trName = (activePlayback.translation && activePlayback.translation.name) ? activePlayback.translation.name : 'по умолчанию';
        rightLines.push(style.bold('Озвучка:  ') + style.accent(trName));
        rightLines.push(style.bold('Громкость:') + ' ' + style.warn(vol + '%') +
            style.bold('   Скорость:') + ' ' + style.accent(spd + 'x') +
            (isFs ? style.good('   [FULLSCREEN]') : ''));
        rightLines.push('');

        if (toast) {
            rightLines.push(style.good('✓ ' + toast));
        } else {
            rightLines.push(style.muted('Горячие клавиши пульта:'));
        }

        var controlRows = [
            style.accent('[Space/P]') + ' пауза   ' + style.accent('[A]') + ' озвучка   ' + style.accent('[Q]') + ' качество   ' + style.accent('[C]') + ' субтитры',
            style.accent('[← / →]') + ' 10 сек   ' + style.accent('[↑ / ↓]') + ' громкость   ' + style.accent('[F]') + ' экран   ' + style.accent('[M]') + ' звук',
            (season ? (style.accent('[N]') + ' след. серия   ' + style.accent('[B]') + ' пред. серия   ') : '') +
            style.accent('[Esc]') + ' меню KTW   ' + style.accent('[Ctrl+X]') + ' выключить'
        ];

        controlRows.forEach(function (r) { rightLines.push('  ' + r); });

        var content = size.withPoster && posterLines && posterLines.length > 0
            ? columns(posterLines, rightLines, size.rightWidth)
            : rightLines.map(function (l) { return ' ' + ansi.pad(l, size.width - 3); });

        tui.paint(tui.box('Пульт mpv · KTW Live', [''].concat(content, ['']),
            size.width, footer(['Esc вернуться в меню (mpv играет)', 'A озвучка', 'Q качество', 'C субтитры', 'Space пауза'])));

        var key = await tui.readKey(400);

        if (!session.isAlive()) break;
        if (!key) continue;

        if (key.name === 'escape' || (key.ctrl && key.name === 'p')) {
            // Возврат в меню KTW без остановки mpv!
            break;
        }

        if (key.ctrl && (key.name === 'x' || key.name === 'q' || key.name === 'c')) {
            session.quit();
            activePlayback.session = null;
            break;
        }

        if (key.name === 'space' || (key.name === 'p' && !key.ctrl)) {
            session.ipc.togglePause();
            setToast(isPaused ? 'Воспроизведение возобновлено' : 'Воспроизведение на паузе');
        } else if (key.name === 'f' && !key.ctrl) {
            session.ipc.toggleFullscreen();
            setToast('Переключен режим экрана');
        } else if (key.name === 'm' || key.str === 'm' || key.str === 'M' || key.str === 'ь' || key.str === 'Ь') {
            session.ipc.toggleMute();
            setToast('Звук переключен (Mute)');
        } else if (key.name === 'c' || key.str === 'c' || key.str === 'C' || key.str === 'с' || key.str === 'С') {
            session.ipc.cycleSubtitle();
            setToast('Субтитры переключены');
        } else if (key.name === 'left') {
            session.ipc.seek(key.shift ? -60 : -10);
            setToast(key.shift ? 'Перемотка -60 сек' : 'Перемотка -10 сек');
        } else if (key.name === 'right') {
            session.ipc.seek(key.shift ? 60 : 10);
            setToast(key.shift ? 'Перемотка +60 сек' : 'Перемотка +10 сек');
        } else if (key.name === 'up') {
            session.ipc.changeVolume(5);
            setToast('Громкость +5%');
        } else if (key.name === 'down') {
            session.ipc.changeVolume(-5);
            setToast('Громкость -5%');
        } else if (key.str === '[' || key.str === '{') {
            session.ipc.changeSpeed(-0.1);
            setToast('Скорость -0.1x');
        } else if (key.str === ']' || key.str === '}') {
            session.ipc.changeSpeed(0.1);
            setToast('Скорость +0.1x');
        } else if (key.str === '\\' || key.str === '|') {
            session.ipc.setSpeed(1.0);
            setToast('Скорость сброшена на 1.0x');
        } else if ((key.name === 'a' || key.str === 'a' || key.str === 'A' || key.str === 'ф' || key.str === 'Ф') && audioTracks.length > 1) {
            var trItems = audioTracks.map(function (at, idx) {
                var isCur = (activePlayback.translation && at.name === activePlayback.translation.name) || (playbackState.aid === (at.audioId || (idx + 1)));
                return {
                    label: (isCur ? style.good('✓ ') : '  ') + at.name,
                    hint: at.lang ? ('[' + at.lang.toUpperCase() + ']') : ''
                };
            });
            var pickedTrIdx = await pickerScreen(film, posterLines, 'Смена озвучки на лету', trItems,
                ['Enter применить', 'Esc назад'], 0);
            if (typeof pickedTrIdx === 'number' && audioTracks[pickedTrIdx]) {
                var selectedAt = audioTracks[pickedTrIdx];
                activePlayback.translation = selectedAt;
                session.translation = selectedAt.name;
                var aidToSet = selectedAt.audioId || (pickedTrIdx + 1);
                session.ipc.setAudio(aidToSet);

                // Приоритетно сохраняем выбранную в пульте озвучку
                if (film && film.id) {
                    history.saveProgress({
                        filmId: film.id,
                        title: film.title,
                        year: film.year,
                        poster: film.poster,
                        serial: film.serial,
                        season: season,
                        episode: episode,
                        player: player.source,
                        translation: selectedAt.name,
                        quality: activePlayback.stream ? activePlayback.stream.label : '',
                        timePos: playbackState.timePos || 0,
                        duration: playbackState.duration || 0,
                        watched: playbackState.eofReached || false
                    });
                }
                setToast('Озвучка изменена: ' + selectedAt.name);
            }
        } else if ((key.name === 'q' || key.str === 'q' || key.str === 'Q' || key.str === 'й' || key.str === 'Й') && variants.length > 1) {
            var qItems = variants.map(function (v) {
                var isCur = activePlayback.stream && v.label === activePlayback.stream.label;
                return {
                    label: (isCur ? style.good('✓ ') : '  ') + v.label,
                    hint: v.bandwidth ? (Math.round(v.bandwidth / 1000) + ' кбит/с') : ''
                };
            });
            var pickedQIdx = await pickerScreen(film, posterLines, 'Смена качества на лету', qItems,
                ['Enter применить', 'Esc назад'], 0);
            if (typeof pickedQIdx === 'number' && variants[pickedQIdx]) {
                var selectedV = variants[pickedQIdx];
                if (activePlayback.stream) activePlayback.stream.label = selectedV.label;
                if (session.stream) session.stream.label = selectedV.label;
                if (selectedV.bandwidth) {
                    session.ipc.setBitrate(selectedV.bandwidth);
                }
                // Приоритетно сохраняем выбранное качество
                if (film && film.id) {
                    history.saveProgress({
                        filmId: film.id,
                        title: film.title,
                        year: film.year,
                        poster: film.poster,
                        serial: film.serial,
                        season: season,
                        episode: episode,
                        player: player.source,
                        translation: activePlayback.translation ? activePlayback.translation.name : '',
                        quality: selectedV.label,
                        timePos: playbackState.timePos || 0,
                        duration: playbackState.duration || 0,
                        watched: playbackState.eofReached || false
                    });
                }
                setToast('Качество изменено: ' + selectedV.label);
            }
        } else if (season && episode && (key.name === 'n' || key.str === 'n' || key.str === 'N' || key.str === 'т' || key.str === 'Т')) {
            // Переход к следующей серии прямо из пульта
            var nextEp = episode + 1;
            setToast('Загружаю серию S' + season + 'E' + nextEp + '…');
            try {
                var sourceUrl = (activePlayback.translation && activePlayback.translation.iframeUrl) ? activePlayback.translation.iframeUrl : player.iframeUrl;
                var nextIframe = api.withEpisode(sourceUrl, season, nextEp);
                var nextStream = await stream.resolveStream(nextIframe, {
                    season: season,
                    episode: nextEp,
                    translation: activePlayback.translation ? activePlayback.translation.name : '',
                    timeout: 8000
                });
                if (nextStream && nextStream.url) {
                    var newTitle = film.title + ' · S' + (season < 10 ? '0' : '') + season + 'E' + (nextEp < 10 ? '0' : '') + nextEp;
                    nextStream.filmInfo = film;
                    nextStream.season = season;
                    nextStream.episode = nextEp;
                    nextStream.player = player.source;
                    nextStream.translation = activePlayback.translation ? activePlayback.translation.name : '';
                    activePlayback.season = season;
                    activePlayback.episode = nextEp;
                    activePlayback.stream = nextStream;
                    session.updateStream(nextStream, newTitle);
                    session.ipc.loadFile(nextStream.url, 0, newTitle);
                    episode = nextEp;
                    epInfo = ' · S' + (season < 10 ? '0' : '') + season + 'E' + (episode < 10 ? '0' : '') + episode;
                    setToast('Включена серия E' + nextEp);
                } else {
                    setToast('Серия E' + nextEp + ' не найдена');
                }
            } catch (e) {
                setToast('Ошибка смены серии');
            }
        } else if (season && episode > 1 && (key.name === 'b' || key.str === 'b' || key.str === 'B' || key.str === 'и' || key.str === 'И')) {
            // Переход к предыдущей серии прямо из пульта
            var prevEp = episode - 1;
            setToast('Загружаю серию S' + season + 'E' + prevEp + '…');
            try {
                var prevSourceUrl = (activePlayback.translation && activePlayback.translation.iframeUrl) ? activePlayback.translation.iframeUrl : player.iframeUrl;
                var prevIframe = api.withEpisode(prevSourceUrl, season, prevEp);
                var prevStream = await stream.resolveStream(prevIframe, {
                    season: season,
                    episode: prevEp,
                    translation: activePlayback.translation ? activePlayback.translation.name : '',
                    timeout: 8000
                });
                if (prevStream && prevStream.url) {
                    var prevTitle = film.title + ' · S' + (season < 10 ? '0' : '') + season + 'E' + (prevEp < 10 ? '0' : '') + prevEp;
                    prevStream.filmInfo = film;
                    prevStream.season = season;
                    prevStream.episode = prevEp;
                    prevStream.player = player.source;
                    prevStream.translation = activePlayback.translation ? activePlayback.translation.name : '';
                    activePlayback.season = season;
                    activePlayback.episode = prevEp;
                    activePlayback.stream = prevStream;
                    session.updateStream(prevStream, prevTitle);
                    session.ipc.loadFile(prevStream.url, 0, prevTitle);
                    episode = prevEp;
                    epInfo = ' · S' + (season < 10 ? '0' : '') + season + 'E' + (episode < 10 ? '0' : '') + episode;
                    setToast('Включена серия E' + prevEp);
                } else {
                    setToast('Серия E' + prevEp + ' не найдена');
                }
            } catch (e) {
                setToast('Ошибка смены серии');
            }
        } else if (key.name === 's' || (key.ctrl && key.name === 's')) {
            await settingsScreen();
            setToast('Настройки сохранены');
        }
    }
}

// Извлечение потока и воспроизведение в mpv (фоновый режим с адаптацией на лету)
async function playStream(film, player, translation, season, episode, options, state, posterLines, startTime, resumeQuality) {
    var userConfig = config.read();

    if (player && player.isTorrserve) {
        var torrserve = require('./torrserve');
        var tsStatus;
        var progressMsg = 'запускаю TorrServer MatriX из коробки…';
        try {
            tsStatus = await tui.withSpinner(torrserve.ensureRunning(function (msg) {
                progressMsg = msg;
            }), function (frame) {
                var size = metrics();
                return tui.box(null, ['', '  ' + style.accent(frame || '•') + ' ' + style.bold(progressMsg), ''],
                    size.width, footer(['автоматический запуск из коробки']));
            });
        } catch (e) {
            await messageScreen('Ошибка запуска TorrServer', [
                e.message,
                '',
                'Проверь интернет-соединение или укажи адрес удаленного сервера в Настройках (Ctrl+S).'
            ], 'любая клавиша — назад');
            return { ok: false, back: true };
        }

        var magnet = translation && translation.magnet ? translation.magnet : null;
        if (!magnet) {
            var torrents = [];
            try {
                torrents = await tui.withSpinner(torrserve.searchTorrents(film, season, episode), function (frame) {
                    var size = metrics();
                    return tui.box(null, ['', '  ' + style.accent(frame || '•') + ' ' + style.muted('ищу торрент-раздачи в 4K / 1080p…'), ''],
                        size.width, footer(['автоматический поиск JacRed']));
                });
            } catch (e) {}

            if (torrents && torrents.length > 0) {
                var torrentItems = torrents.map(function (t) {
                    var qColor = t.quality.indexOf('4K') >= 0 ? style.accent('[' + t.quality + ']') : style.good('[' + t.quality + ']');
                    var sizeBadge = style.bold(t.size);
                    var seedsBadge = style.good(t.seeds + ' seeds');
                    var meta = [qColor, sizeBadge, seedsBadge].join(' · ');
                    var hint = t.voices ? style.warn(t.voices) : '';
                    return {
                        label: meta + ' ' + ansi.truncate(t.title, 55),
                        hint: hint
                    };
                });

                torrentItems.push({
                    label: style.muted('Ввести magnet-ссылку вручную...'),
                    hint: ''
                });

                var pickedTorrentIdx = await pickerScreen(film, posterLines, 'TorrServe · Раздачи', torrentItems,
                    [glyph.up + glyph.down + ' выбор', 'Enter смотреть в mpv', 'Esc назад'], 2);

                if (pickedTorrentIdx === 'back') return { ok: false, back: true };

                if (pickedTorrentIdx < torrents.length) {
                    magnet = torrents[pickedTorrentIdx].magnet;
                }
            }

            if (!magnet) {
                magnet = await inputScreen('TorrServe: Стриминг торрента', 'Magnet / Hash / Ссылка', [
                    'Введи magnet-ссылку или хэш торрента для «' + film.title + '»',
                    'TorrServer MatriX (' + (tsStatus.version || '143') + ') запустит прямое воспроизведение в 4K / 1080p'
                ]);
            }
        }

        if (!magnet) return { ok: false, back: true };

        var fileIndex = null;
        try {
            await torrserve.addTorrent(magnet, film.title);
            var files = await torrserve.getTorrentFiles(magnet);
            if (files && files.length > 0) {
                var videoFiles = files.filter(function (f) {
                    return /\.(mkv|mp4|avi|ts|mov|m2ts|webm)$/i.test(f.name);
                });

                if (videoFiles.length === 1) {
                    fileIndex = videoFiles[0].id;
                } else if (videoFiles.length > 1) {
                    var matched = null;
                    if (episode) {
                        var epNum = parseInt(episode, 10);
                        var sNum = season ? parseInt(season, 10) : null;
                        matched = videoFiles.find(function (f) {
                            var n = f.name.toLowerCase();
                            if (sNum && new RegExp('s0*' + sNum + '[._ -]*e0*' + epNum + '\\b', 'i').test(n)) return true;
                            if (new RegExp('\\b[es]0*' + epNum + '\\b|[^0-9]0*' + epNum + '[._ -]*(?:серия|ep|seria|episode|из|of|\\.)', 'i').test(n)) return true;
                            return false;
                        });
                    }

                    if (matched) {
                        fileIndex = matched.id;
                    } else {
                        var fileItems = videoFiles.map(function (f) {
                            var sizeMb = (f.length / (1024 * 1024)).toFixed(0) + ' MB';
                            var cleanName = f.name.split('/').pop().split('\\').pop();
                            return {
                                label: style.bold('[' + sizeMb + ']') + ' ' + ansi.truncate(cleanName, 60),
                                hint: ''
                            };
                        });

                        var chosenFileIdx = await pickerScreen(film, posterLines, 'TorrServe · Выбор серии / файла', fileItems,
                            [glyph.up + glyph.down + ' выбор', 'Enter смотреть', 'Esc назад'], 2);

                        if (chosenFileIdx === 'back') return { ok: false, back: true };
                        if (chosenFileIdx >= 0 && chosenFileIdx < videoFiles.length) {
                            fileIndex = videoFiles[chosenFileIdx].id;
                        }
                    }
                }
            }
        } catch (e) {}

        var streamUrl = torrserve.buildStreamUrl(magnet, fileIndex);
        var tsStream = {
            url: streamUrl,
            referer: '',
            origin: '',
            userAgent: 'mpv',
            label: '4K / 1080p (TorrServe)',
            audioTracks: [],
            subtitles: []
        };

        var streamTitle = film.title + (film.year ? ' (' + film.year + ')' : '') +
            (season ? ' · S' + season + 'E' + episode : '') + ' · TorrServe 4K';

        var session = mpv.startLiveSession(tsStream, streamTitle, options.mpvArgs);
        session.stream = tsStream;
        activePlayback.session = session;
        activePlayback.film = film;
        activePlayback.player = player;
        activePlayback.translation = null;
        activePlayback.season = season;
        activePlayback.episode = episode;
        activePlayback.variants = [];

        await messageScreen('Воспроизведение TorrServe', [
            style.good('✓ Торрент-поток передан в плеер:'),
            '',
            '  ' + style.bold(streamTitle),
            '  ' + style.muted('Сервер: ' + tsStatus.url + ' (' + tsStatus.version + ')'),
            '',
            'mpv играет в фоне / отдельном окне.',
            'Ты можешь дальше пользоваться поиском и меню KTW.'
        ], 'Enter или авто-переход в меню…', 900);

        return { ok: true, inBackground: true };
    }

    var source = translation && translation.iframeUrl ? translation.iframeUrl : player.iframeUrl;
    var iframeUrl = api.withEpisode(source, season, episode);
    var label = film.title + (season ? ' · S' + season + 'E' + episode : '');
    var found;

    var progress = 'проверяю прямое извлечение…';

    function render(frame) {
        var size = metrics();

        return tui.box(null, [
            '',
            '  ' + style.accent(frame || '•') + ' ' + style.bold('Достаю поток'),
            '',
            '  ' + style.muted(ansi.truncate(label, size.width - 6)),
            '  ' + style.muted(ansi.truncate('плеер ' + player.source +
                (translation ? ' · ' + translation.name : '') + ' · ' + player.quality, size.width - 6)),
            '',
            '  ' + style.muted(ansi.truncate(progress, size.width - 6)),
            ''
        ], size.width, footer(['прямой парсинг или защита от рекламы']));
    }

    try {
        found = await tui.withSpinner(stream.resolveStream(iframeUrl, {
            season: season,
            episode: episode,
            translation: translation ? translation.name : '',
            timeout: options.timeout || userConfig.timeout,
            onProgress: function (message) { progress = message; }
        }), render);
    } catch (err) {
        var lines = [err.message];

        (err.reasons || []).forEach(function (reason) {
            if (reason.message !== err.message) lines.push('· ' + reason.message);
        });

        lines.push('');
        lines.push('Проверить, что именно сломалось: ktw --doctor');

        await messageScreen('Плеер ' + player.source + ' не отдал поток', lines, 'любая клавиша — назад');
        return { ok: false };
    }

    if (!found) {
        await messageScreen('Поток не найден', [
            'Плеер ' + player.source + ' не отдал поток.',
            '',
            'Попробуй другой балансер (например, Collaps)',
            'или открой Настройки по Ctrl+S.'
        ], 'любая клавиша — к списку плееров');
        return { ok: false };
    }

    if (found.suspicious) {
        await messageScreen('Похоже, это реклама', [
            'Плеер ' + player.source + ' вернул только рекламный ролик.',
            '',
            'Надёжнее выбрать другой балансер (например, Collaps).'
        ], 'любая клавиша — продолжить');
    }

    // Загружаем мастер-плейлист
    var variants = await tui.withSpinner(stream.readVariants(found), function (frame) {
        var size = metrics();
        return tui.box(null, ['', '  ' + style.accent(frame) + ' ' + style.muted('проверяю доступные качества…'), ''],
            size.width, footer(['почти всё']));
    });

    var selectedQuality = await pickQuality(film, posterLines, found, variants, options, state, player, resumeQuality);
    if (!selectedQuality) return { ok: false, back: true };
    if (selectedQuality === 'settings') return { ok: false, settings: true };

    found = selectedQuality;

    // Номер озвучки: сперва по дорожкам мастер-плейлиста, затем по конфигу
    // балансера, и только потом — русская дорожка по умолчанию
    found.audioId = stream.resolveAudioId(found, translation ? translation.name : '');

    found.startTime = startTime || 0;
    found.filmInfo = film;
    found.season = season;
    found.episode = episode;
    found.player = player.source;
    found.translation = translation ? translation.name : '';

    var streamTitle = film.title + (film.year ? ' (' + film.year + ')' : '') +
        (season ? ' · S' + season + 'E' + episode : '') +
        (translation && translation.name ? ' · ' + translation.name : '') +
        (found.label ? ' · ' + found.label : '');

    // Если плеер mpv уже открыт — адаптируем воспроизведение на лету
    if (activePlayback.session && activePlayback.session.isAlive()) {
        try {
            activePlayback.session.ipc.loadFile(found.url, found.startTime, streamTitle);
            if (found.audioId) {
                activePlayback.session.ipc.setAudio(found.audioId);
            }
            if (activePlayback.session.updateStream) {
                activePlayback.session.updateStream(found, streamTitle);
            }
            activePlayback.film = film;
            activePlayback.player = player;
            activePlayback.translation = translation;
            activePlayback.season = season;
            activePlayback.episode = episode;
            activePlayback.variants = variants;
            activePlayback.stream = found;

            // Мгновенно обновляем запись в истории на новую серию
            history.saveProgress({
                filmId: film.id,
                title: film.title,
                year: film.year,
                poster: film.poster,
                serial: film.serial,
                season: season,
                episode: episode,
                player: player.source,
                translation: translation ? translation.name : '',
                quality: found.label,
                timePos: found.startTime || 0,
                duration: 0,
                watched: false
            });

            await messageScreen('mpv адаптирован к выбору', [
                style.good('✓ Воспроизведение переключено в открытом окне mpv:'),
                '',
                '  ' + style.bold(streamTitle),
                '  ' + style.muted('Плеер: ' + player.source + (translation ? ' · ' + translation.name : '')),
                '',
                'mpv играет в фоне / отдельном окне.',
                'Ты можешь дальше пользоваться поиском и меню KTW.'
            ], 'Enter или авто-переход в меню…', 900);

            return { ok: true, inBackground: true };
        } catch (err) {
            // Сокет недоступен, создадим новую сессию
        }
    }

    // Запуск новой сессии mpv в фоне
    try {
        var session = mpv.startLiveSession(found, streamTitle, options.mpvArgs);
        session.stream = found;
        activePlayback.session = session;
        activePlayback.film = film;
        activePlayback.player = player;
        activePlayback.translation = translation;
        activePlayback.season = season;
        activePlayback.episode = episode;
        activePlayback.variants = variants;

        // Мгновенно сохраняем выбранную серию в истории
        history.saveProgress({
            filmId: film.id,
            title: film.title,
            year: film.year,
            poster: film.poster,
            serial: film.serial,
            season: season,
            episode: episode,
            player: player.source,
            translation: translation ? translation.name : '',
            quality: found.label,
            timePos: found.startTime || 0,
            duration: 0,
            watched: false
        });

        await messageScreen('Воспроизведение запущено в mpv', [
            style.good('✓ Видео открыто в окне mpv:'),
            '',
            '  ' + style.bold(streamTitle),
            '  ' + style.muted('Плеер: ' + player.source + (translation ? ' · ' + translation.name : '')),
            '',
            'mpv играет в фоне / отдельном окне.',
            'Ты можешь продолжать искать фильмы, менять настройки и каталог в KTW.'
        ], 'Enter или авто-переход в меню…', 900);

        return { ok: true, inBackground: true };
    } catch (err) {
        await messageScreen('mpv не запустился', [
            err.message,
            '',
            'Ссылка на поток:',
            found.url
        ], 'любая клавиша — назад');
        return { ok: true, eofReached: false };
    }
}

// Экран обратного отсчета для автозапуска следующей серии (Binge-Watching)
async function nextEpisodeCountdown(film, nextSeason, nextEp, totalSeconds) {
    totalSeconds = totalSeconds || 5;
    var remaining = totalSeconds;

    while (remaining > 0) {
        var size = metrics();
        var numStr = 'S' + (nextSeason < 10 ? '0' : '') + nextSeason + 'E' + (nextEp < 10 ? '0' : '') + nextEp;
        var barFilled = Math.max(1, remaining);
        var bar = ansi.repeat('▰', barFilled) + ansi.repeat('▱', totalSeconds - barFilled);

        var content = [
            '',
            '  ' + style.bold('Следующая серия'),
            '',
            '  ' + style.accent('[' + numStr + '] ') + style.bold(film.title),
            '  ' + style.muted('Автозапуск через: ') + style.warn(remaining + ' с.'),
            '',
            '  ' + style.muted('Enter запустить сейчас · Esc отмена'),
            ''
        ];

        tui.paint(tui.box('Автопереход', content, size.width,
            footer(['Enter запуск', 'Esc отмена'])));

        var key = await tui.readKey(1000);
        if (key && (key.name === 'escape' || key.name === 'q')) {
            return false;
        }
        if (key && (key.name === 'return' || key.name === 'space')) {
            return true;
        }

        remaining--;
    }

    return true;
}

// Главный цикл приложения
async function run(options) {
    var apiKey = config.resolveApiKey(options.key);

    var state = { query: options.query || '', results: [] };
    var film = null;
    var posterLines = [];
    var seasons = [];
    var season = options.season ? Number(options.season) : null;
    var episode = options.episode ? Number(options.episode) : null;
    var players = [];
    var player = null;
    var translation = null;
    var autoUsed = false;
    var screen = options.settings ? 'settings' : 'search';
    var startTime = 0;
    var resumePlayer = null;
    var resumeTranslation = null;
    var resumeQuality = null;

    var directId = api.parseFilmId(options.query);
    if (directId) {
        film = { id: directId, title: 'Кинопоиск #' + directId };
        state.query = '';
        screen = 'load';
    }

    tui.enter();

    // Автоматически подтягиваем уже работающий mpv при перезаходе в ktw
    try {
        var existing = await mpv.tryAttachExistingSession();
        if (existing) {
            activePlayback.session = existing;
            activePlayback.film = existing.film;
            activePlayback.player = existing.player;
            activePlayback.translation = existing.translation;
            activePlayback.season = existing.season;
            activePlayback.episode = existing.episode;
            activePlayback.variants = existing.variants;
            activePlayback.stream = existing.stream;
        }
    } catch (e) {}

    try {
        while (true) {
            var userConfig = config.read();

            if (screen === 'search') {
                film = await searchScreen(state, apiKey);
                if (!film) return 0;

                if (film === 'settings') {
                    await settingsScreen();
                    apiKey = config.resolveApiKey(options.key);
                    continue;
                }

                if (film === 'history') {
                    screen = 'history';
                    continue;
                }

                if (film === 'key') {
                    screen = 'apikey';
                    continue;
                }

                // Если выбран пункт из истории с сохраненным прогрессом
                if (film.resumeTime !== undefined) {
                    startTime = film.resumeTime || 0;
                    season = film.resumeSeason || null;
                    episode = film.resumeEpisode || null;
                    resumePlayer = film.resumePlayer || null;
                    resumeTranslation = film.resumeTranslation || null;
                    resumeQuality = film.resumeQuality || null;
                } else {
                    startTime = 0;
                    resumePlayer = null;
                    resumeTranslation = null;
                    resumeQuality = null;
                }

                screen = film.keyless ? 'players' : 'load';
                players = [];
                posterLines = [];
                seasons = [];
                continue;
            }

            if (screen === 'history') {
                var chosenHistory = await historyScreen();
                if (!chosenHistory) {
                    screen = 'search';
                    continue;
                }
                film = chosenHistory;
                startTime = chosenHistory.resumeTime || 0;
                season = chosenHistory.resumeSeason || null;
                episode = chosenHistory.resumeEpisode || null;
                resumePlayer = chosenHistory.resumePlayer || null;
                resumeTranslation = chosenHistory.resumeTranslation || null;
                resumeQuality = chosenHistory.resumeQuality || null;
                screen = 'load';
                players = [];
                posterLines = [];
                seasons = [];
                continue;
            }

            if (screen === 'apikey') {
                var enteredKey = await inputScreen('Ключ Кинопоиска', 'Ключ', [
                    'Бесплатный ключ выдают на kinopoiskapiunofficial.tech —',
                    'регистрация занимает минуту.',
                    '',
                    'С ключом появятся поиск с подсказками, обложки,',
                    'описания и список сезонов с сериями.'
                ], apiKey || '');

                if (enteredKey && !/^[\x20-\x7E]+$/.test(enteredKey)) {
                    await messageScreen('Некорректный ключ', [
                        'В ключе присутствуют недопустимые символы.'
                    ], 'любая клавиша — повторить');
                    continue;
                }

                if (enteredKey) {
                    apiKey = enteredKey;
                    config.save({ kinopoiskApiKey: enteredKey });
                }

                screen = 'search';
                continue;
            }

            if (screen === 'load') {
                var size = metrics();

                try {
                    var loaded = await tui.withSpinner((async function () {
                        var details = await api.getFilm(film.id, apiKey).catch(function () { return film; });
                        var art = size.withPoster
                            ? await poster.render(details.poster, details.title, POSTER_COLS, POSTER_ROWS)
                            : [];
                        var list = details.serial ? await api.getSeasons(details.id, apiKey).catch(function () { return []; }) : [];

                        return { details: details, art: art, seasons: list };
                    })(), function (frame) {
                        return tui.box(null, ['', '  ' + style.accent(frame) + ' ' + style.muted('загружаю карточку…'), ''],
                            size.width, footer(['Esc — назад']));
                    });

                    film = Object.assign({}, film, loaded.details);
                    posterLines = loaded.art;
                    seasons = loaded.seasons;
                } catch (err) {
                    await messageScreen('Не вышло', [err.message], 'любая клавиша — назад');
                    screen = 'search';
                    continue;
                }

                // Проверяем сохраненную позицию в истории для фильмов
                if (!film.serial && !startTime && film.id) {
                    var savedProg = history.getProgress(film.id);
                    if (savedProg && savedProg.timePos > 60 && !savedProg.watched) {
                        var resumeHint = (savedProg.percentage ? savedProg.percentage + '%' : '') +
                            (savedProg.player ? ' · ' + savedProg.player : '') +
                            (savedProg.translation ? ' · ' + savedProg.translation : '');
                        var resumeChoices = [
                            { label: '▶ Продолжить с ' + history.formatTime(savedProg.timePos), hint: resumeHint },
                            { label: '↺ Начать с начала', hint: '00:00' }
                        ];
                        var rIndex = await pickerScreen(film, posterLines, 'Возобновление', resumeChoices,
                            [glyph.up + glyph.down + ' выбор', 'Enter подтвердить', 'Esc назад'], 2);
                        if (rIndex === 0) {
                            startTime = savedProg.timePos;
                            resumePlayer = savedProg.player || null;
                            resumeTranslation = savedProg.translation || null;
                            resumeQuality = savedProg.quality || null;
                        } else {
                            startTime = 0;
                            resumePlayer = null;
                            resumeTranslation = null;
                            resumeQuality = null;
                        }
                    }
                }

                if (film.openEpisodesOnly) {
                    if (film.openSeason) season = film.openSeason;
                    screen = 'episodes';
                    continue;
                }

                screen = seasons.length > 0 && !(season && episode) ? 'seasons' : 'players';
                continue;
            }

            if (screen === 'seasons') {
                var totalEpCount = seasons.reduce(function (acc, s) { return acc + (s.episodes ? s.episodes.length : 0); }, 0);
                var watchedEpCount = history.getWatchedEpisodesCount(film.id);
                var seasonItems = seasons.map(function (item) {
                    var watchedInSeason = item.episodes ? item.episodes.filter(function (e) {
                        return history.isEpisodeWatched(film.id, item.number, e.number);
                    }).length : 0;
                    var seasonStat = watchedInSeason > 0 ? (watchedInSeason + '/' + item.episodes.length + ' сер.') : (item.episodes.length + ' сер.');
                    return {
                        label: 'Сезон ' + item.number,
                        hint: seasonStat
                    };
                });

                var heading = totalEpCount > 0
                    ? ('Сезоны · ' + watchedEpCount + '/' + totalEpCount + ' сер. (' + Math.round((watchedEpCount / totalEpCount) * 100) + '%)')
                    : 'Сезоны';

                var seasonIndex = await pickerScreen(film, posterLines, heading, seasonItems,
                    [glyph.up + glyph.down + ' выбор', 'Enter дальше', 'Ctrl+S настройки', 'Esc назад'], 3);

                if (seasonIndex === 'back') {
                    screen = 'search';
                    continue;
                }

                if (seasonIndex === 'settings') {
                    await settingsScreen();
                    continue;
                }

                season = seasons[seasonIndex].number;
                screen = 'episodes';
                continue;
            }

            if (screen === 'episodes') {
                var current = seasons.filter(function (item) { return item.number === season; })[0];
                var curEpisodes = (current ? current.episodes : []);
                var epSelectedIndex = 0;
                if (film.openEpisode) {
                    var foundIdx = curEpisodes.findIndex(function (e) { return e.number === film.openEpisode; });
                    if (foundIdx >= 0) epSelectedIndex = foundIdx;
                    film.openEpisode = null;
                }
                var epAction = null;

                while (true) {
                    var episodeItems = curEpisodes.map(function (item) {
                        var isWatched = history.isEpisodeWatched(film.id, season, item.number);
                        var epProg = history.getProgress(film.id, season, item.number);
                        var mark = isWatched ? style.good('✓') : (epProg && epProg.timePos > 0 ? style.accent('▶') : ' ');
                        var numStr = 'S' + (season < 10 ? '0' : '') + season + 'E' + (item.number < 10 ? '0' : '') + item.number;
                        var titleStr = item.title ? (' ' + item.title) : '';
                        var hint = '';
                        if (isWatched) {
                            hint = style.good('✓ ' + t('watched'));
                        } else if (epProg && epProg.timePos > 0) {
                            var filled = Math.min(5, Math.max(1, Math.round(epProg.percentage / 20)));
                            var bar = ansi.repeat('▰', filled) + ansi.repeat('▱', 5 - filled);
                            hint = style.good(bar + ' ' + epProg.percentage + '%') + ' · ' + history.formatTime(epProg.timePos);
                        } else if (item.date) {
                            hint = String(item.date).slice(0, 10);
                        }
                        return {
                            label: mark + ' ' + numStr + titleStr,
                            hint: hint
                        };
                    });

                    var episodeIndex = await pickerScreen(film, posterLines, 'Сезон ' + season + ' · Серии', episodeItems,
                        [glyph.up + glyph.down + ' выбор', 'Enter смотреть', 'r / Space отметка ✓', 'Ctrl+S настройки', 'Esc назад'],
                        ['Space / r — отметить или сбросить серию'], epSelectedIndex, function (key, selected) {
                            if (key.name === 'space' || key.name === 'r' || key.name === 'd') {
                                if (curEpisodes[selected]) {
                                    history.toggleEpisodeWatched(film.id, season, curEpisodes[selected].number);
                                    epSelectedIndex = selected;
                                    return 'toggle';
                                }
                            }
                            return null;
                        });

                    if (episodeIndex === 'toggle') {
                        continue;
                    }

                    if (episodeIndex === 'back') {
                        epAction = 'back';
                        break;
                    }

                    if (episodeIndex === 'settings') {
                        epAction = 'settings';
                        break;
                    }

                    episode = curEpisodes[episodeIndex].number;
                    epAction = 'play';
                    break;
                }

                if (epAction === 'back') {
                    screen = 'seasons';
                    continue;
                }

                if (epAction === 'settings') {
                    await settingsScreen();
                    continue;
                }

                // Проверяем сохраненную позицию для этой серии
                var epProg = history.getProgress(film.id, season, episode);
                if (epProg && epProg.timePos > 60 && !epProg.watched) {
                    var epResumeHint = (epProg.percentage ? epProg.percentage + '%' : '') +
                        (epProg.player ? ' · ' + epProg.player : '') +
                        (epProg.translation ? ' · ' + epProg.translation : '');
                    var epResumeChoices = [
                        { label: '▶ Продолжить с ' + history.formatTime(epProg.timePos), hint: epResumeHint },
                        { label: '↺ Начать с начала', hint: '00:00' }
                    ];
                    var epRIndex = await pickerScreen(film, posterLines, 'Возобновление серии', epResumeChoices,
                        [glyph.up + glyph.down + ' выбор', 'Enter подтвердить', 'Esc назад'], 0);
                    if (epRIndex === 0) {
                        startTime = epProg.timePos;
                        resumePlayer = epProg.player || null;
                        resumeTranslation = epProg.translation || null;
                        resumeQuality = epProg.quality || null;
                    } else {
                        startTime = 0;
                        resumePlayer = null;
                        resumeTranslation = null;
                        resumeQuality = null;
                    }
                } else if (epProg && (epProg.player || epProg.translation)) {
                    resumePlayer = epProg.player || null;
                    resumeTranslation = epProg.translation || null;
                    resumeQuality = epProg.quality || null;
                }

                screen = 'players';
                continue;
            }

            if (screen === 'players') {
                if (players.length === 0) {
                    var playersSize = metrics();

                    var playersRequest = film.id
                        ? api.getPlayers(film.id)
                        : api.getPlayersByTitle(film.title);

                    try {
                        players = await tui.withSpinner(playersRequest, function (frame) {
                            return tui.box(null, ['', '  ' + style.accent(frame) + ' ' + style.muted('ищу доступные плееры…'), ''],
                                playersSize.width, footer(['Esc — назад']));
                        });
                    } catch (err) {
                        await messageScreen('Плееры недоступны', [err.message], 'любая клавиша — назад');
                        screen = seasons.length > 0 ? 'episodes' : 'search';
                        continue;
                    }

                    if (players.length === 0) {
                        await messageScreen('Пусто', ['Для «' + film.title + '» нет доступных плееров.'],
                            'любая клавиша — назад');
                        screen = seasons.length > 0 ? 'episodes' : 'search';
                        continue;
                    }

                    players.sort(function (a, b) {
                        var aScore = (a.direct ? 10 : 0) + (a.source === 'Veoveo' ? 5 : 0);
                        var bScore = (b.direct ? 10 : 0) + (b.source === 'Veoveo' ? 5 : 0);
                        return bScore - aScore;
                    });

                    players.push({
                        source: 'TorrServe [Торрент 4K/1080p]',
                        isTorrserve: true,
                        direct: true,
                        quality: '4K / 1080p',
                        translations: [{ name: 'Торрент-поток (4K / 1080p)' }]
                    });
                }

                var preselectedIdx = 0;
                var preferredP = options.player || resumePlayer || userConfig.preferredPlayer;
                if (preferredP) {
                    var wantedP = preferredP.toLowerCase();
                    var foundIdx = players.findIndex(function (item) {
                        return item.source.toLowerCase() === wantedP || item.source.toLowerCase().indexOf(wantedP) === 0;
                    });
                    if (foundIdx >= 0) preselectedIdx = foundIdx;
                }

                var chosenPlayer = null;
                if (options.player) {
                    var wantedCli = options.player.toLowerCase();
                    chosenPlayer = players.find(function (item) {
                        return item.source.toLowerCase() === wantedCli || item.source.toLowerCase().indexOf(wantedCli) === 0;
                    }) || null;
                }

                if (!chosenPlayer) {
                    var playerItems = players.map(function (item) {
                        var directBadge = item.direct ? style.good(' [прямой]') : '';
                        var trCount = item.translations ? (item.translations.length + ' озв.') : '';
                        var qBadge = item.quality ? style.warn(item.quality) : '';
                        return {
                            label: item.source + directBadge,
                            hint: [trCount, qBadge].filter(Boolean).join(' · ')
                        };
                    });

                    var heading = season ? 'Плееры · S' + season + 'E' + episode : 'Плееры';
                    var playerIndex = await pickerScreen(film, posterLines, heading, playerItems,
                        [glyph.up + glyph.down + ' выбор', 'Enter смотреть', 'Ctrl+S настройки', 'Esc назад'], season ? 0 : 3, preselectedIdx);

                    if (playerIndex === 'back') {
                        screen = seasons.length > 0 ? 'episodes' : 'search';
                        if (screen === 'search') {
                            film = null;
                            players = [];
                        }
                        continue;
                    }

                    if (playerIndex === 'settings') {
                        await settingsScreen();
                        continue;
                    }

                    chosenPlayer = players[playerIndex];
                }

                player = chosenPlayer;
                screen = 'translations';
                continue;
            }

            if (screen === 'translations') {
                if (player && player.isTorrserve) {
                    var tsPlayResult = await playStream(film, player, null, season, episode, options, state, posterLines, startTime, resumeQuality);
                    if (tsPlayResult && tsPlayResult.back) {
                        screen = 'players';
                        continue;
                    }
                    screen = 'search';
                    film = null;
                    players = [];
                    continue;
                }

                var variants = player.translations || [];

                // Если балансер прямой (Collaps/Veoveo/etc), достаем живой список дорожек прямо из балансера
                if (player.direct && (!variants || variants.length <= 1 || player.source.toLowerCase().indexOf('collaps') >= 0)) {
                    var probeUrl = api.withEpisode(player.iframeUrl, season, episode);
                    try {
                        var directInfo = await tui.withSpinner(stream.resolveStream(probeUrl, {
                            season: season,
                            episode: episode,
                            timeout: 8000
                        }), function (frame) {
                            var size = metrics();
                            return tui.box(null, ['', '  ' + style.accent(frame) + ' ' + style.muted('получаю список озвучек из балансера…'), ''],
                                size.width, footer(['Esc — назад']));
                        });

                        if (directInfo) {
                            if (directInfo.audioTracks && directInfo.audioTracks.length > 0) {
                                variants = directInfo.audioTracks.map(function (at) {
                                    return {
                                        name: at.name,
                                        quality: player.quality || '',
                                        iframeUrl: player.iframeUrl,
                                        audioId: at.audioId
                                    };
                                });
                            } else if (directInfo.variantTracks && directInfo.variantTracks.length > 0) {
                                variants = directInfo.variantTracks.map(function (vt) {
                                    return {
                                        name: vt.name,
                                        quality: player.quality || '',
                                        iframeUrl: vt.url
                                    };
                                });
                            }
                        }
                    } catch (e) {}
                }

                translation = null;

                var preferredTr = options.translation || resumeTranslation || (!autoUsed ? userConfig.preferredTranslation : null);
                if (preferredTr && variants.length > 0) {
                    var wantedTr = preferredTr.toLowerCase();
                    translation = variants.find(function (item) {
                        return item.name.toLowerCase() === wantedTr ||
                            item.name.toLowerCase().indexOf(wantedTr) >= 0 ||
                            wantedTr.indexOf(item.name.toLowerCase()) >= 0;
                    }) || null;
                }

                if (!translation) {
                    var translationItems = variants.map(function (item) {
                        return {
                            label: item.name,
                            hint: item.quality || ''
                        };
                    });

                    if (translationItems.length === 0) {
                        translationItems = [{
                            label: 'по умолчанию',
                            hint: 'балансер не разделяет озвучки'
                        }];
                    }

                    var translationIndex = await pickerScreen(film, posterLines,
                        'Озвучка · ' + player.source + (player.direct ? ' [прямой]' : ''), translationItems,
                        [glyph.up + glyph.down + ' выбор', 'Enter смотреть', 'Ctrl+S настройки', 'Esc назад'], 0);

                    if (translationIndex === 'back') {
                        if (preferredP) {
                            screen = seasons.length > 0 ? 'episodes' : 'search';
                            if (screen === 'search') { film = null; players = []; }
                        } else {
                            screen = 'players';
                        }
                        continue;
                    }

                    if (translationIndex === 'settings') {
                        await settingsScreen();
                        continue;
                    }

                    translation = variants[translationIndex] || null;
                }

                var playResult = await playStream(film, player, translation, season, episode, options, state, posterLines, startTime, resumeQuality);
                autoUsed = true;
                startTime = 0;

                if (playResult.settings) {
                    await settingsScreen();
                    continue;
                }

                if (playResult.back) {
                    if (preferredTr && preferredP) {
                        screen = seasons.length > 0 ? 'episodes' : 'search';
                        if (screen === 'search') { film = null; players = []; }
                    } else if (preferredTr) {
                        screen = 'players';
                    } else {
                        screen = 'translations';
                    }
                    continue;
                }

                // Режим Binge-Watching для сериалов: если серия завершена, предлагаем следующую
                if (film.serial && season && episode && playResult.eofReached && seasons.length > 0) {
                    var curSeasonObj = seasons.find(function (s) { return s.number === season; });
                    var nextEpNum = episode + 1;
                    var hasNextInCurSeason = curSeasonObj && curSeasonObj.episodes.some(function (e) { return e.number === nextEpNum; });
                    var nextSeasonNum = season;

                    if (!hasNextInCurSeason) {
                        var nextSeasonObj = seasons.find(function (s) { return s.number === season + 1; });
                        if (nextSeasonObj && nextSeasonObj.episodes.length > 0) {
                            nextSeasonNum = season + 1;
                            nextEpNum = nextSeasonObj.episodes[0].number;
                            hasNextInCurSeason = true;
                        }
                    }

                    if (hasNextInCurSeason) {
                        var autoNext = await nextEpisodeCountdown(film, nextSeasonNum, nextEpNum, 5);
                        if (autoNext) {
                            season = nextSeasonNum;
                            episode = nextEpNum;
                            screen = 'translations';
                            continue;
                        }
                    }
                }

                if (playResult.inBackground) {
                    if (film.serial && seasons.length > 0 && season) {
                        screen = 'episodes';
                    } else {
                        screen = 'search';
                        film = null;
                        seasons = [];
                        players = [];
                    }
                    continue;
                }

                screen = seasons.length > 0 ? 'episodes' : 'players';
                continue;
            }

            return 0;
        }
    } finally {
        tui.exit();
        await stream.shutdown();
    }
}

module.exports = {
    run: run,
    columns: columns,
    filmHeader: filmHeader,
    metaLine: metaLine,
    metrics: metrics
};
