'use strict';

// Настройки ktw: постоянные предпочтения пользователя.
// Живут в ~/.config/ktw/config.json, но переменные окружения и аргументы CLI приоритетнее.

var fs = require('fs');
var os = require('os');
var path = require('path');

var CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'ktw');
var CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// Значения по умолчанию
var DEFAULTS = {
    kinopoiskApiKey: '',
    kinoboxApiUrl: '',
    preferredPlayer: '',       // 'Collaps', 'Alloha', 'Kodik', 'Veoveo' или пусто (Авто)
    preferredTranslation: '',  // 'Дублированный', 'LostFilm', 'Кубик в кубе', 'Оригинал'...
    preferredQuality: '',      // '1080', '720', 'max', 'min' или пусто
    mpvFullscreen: false,
    mpvWindowSize: 'compact',  // 'compact' (40% в углу), 'medium' (60%), 'large' (85%), 'fullscreen'
    mpvHardwareDec: 'auto-safe',
    mpvCustomArgs: [],
    directOnly: false,         // режим только прямого парсинга без запуска браузера
    posterMode: 'auto',        // 'auto', 'ascii', 'off'
    theme: 'classic',
    bannerStyle: 'ansi_shadow', // ANSI Shadow 3D блоки по умолчанию
    bannerSize: 'auto',         // 'auto', 'full', 'compact', 'mini'
    lang: 'ru',                 // 'ru', 'en'
    torrserveUrl: 'http://127.0.0.1:8090', // адрес сервера TorrServer
    timeout: 40000
};

function ensureDir() {
    try {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    } catch (e) {}
}

function read() {
    try {
        var raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        return Object.assign({}, DEFAULTS, raw);
    } catch (err) {
        return Object.assign({}, DEFAULTS);
    }
}

function save(patch) {
    var current = read();
    var updated = Object.assign({}, current, patch);
    try {
        ensureDir();
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2) + '\n', { mode: 0o600 });
    } catch (err) {
        // При ошибке прав записи просто возвращаем объект
    }

    return updated;
}

// Ключ API: аргумент -> окружение -> локальный kinopoisk-key.js -> конфиг
function resolveApiKey(explicitKey) {
    if (explicitKey) return explicitKey;
    if (process.env.KINOPOISK_API_KEY) return process.env.KINOPOISK_API_KEY;

    var localKeyFile = path.join(__dirname, '..', '..', 'kinopoisk-key.js');

    if (fs.existsSync(localKeyFile)) {
        try {
            var match = fs.readFileSync(localKeyFile, 'utf8').match(/KINOPOISK_API_KEY\s*=\s*['"]([^'"]+)['"]/);
            if (match) return match[1];
        } catch (err) { }
    }

    return read().kinopoiskApiKey || null;
}

// Зеркало Kinobox API
function resolveKinoboxApi(explicitMirror) {
    if (explicitMirror) return explicitMirror;
    if (process.env.KTW_KINOBOX_API) return process.env.KTW_KINOBOX_API;
    var conf = read().kinoboxApiUrl;
    return conf && conf.trim() ? conf.trim() : null;
}

module.exports = {
    CONFIG_DIR: CONFIG_DIR,
    file: CONFIG_FILE,
    DEFAULTS: DEFAULTS,
    ensureDir: function () { fs.mkdirSync(CONFIG_DIR, { recursive: true }); },
    read: read,
    save: save,
    resolveApiKey: resolveApiKey,
    resolveKinoboxApi: resolveKinoboxApi
};
