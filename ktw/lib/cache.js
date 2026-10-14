'use strict';

// Кеш ответов API на диске.
//
// Раньше кеша не было вовсе: каждый заход в фильм заново дёргал Кинопоиск и
// Kinobox, и на медленном канале интерфейс подвисал на каждом шаге. Кешируется
// только то, что не портится: описания и сезоны живут сутки, список плееров —
// четверть часа, потому что в ссылках на iframe лежат недолгие токены.

var fs = require('fs');
var os = require('os');
var path = require('path');
var crypto = require('crypto');

var CACHE_DIR = path.join(
    process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'),
    'ktw', 'api'
);

// Сколько живёт запись каждого вида, в миллисекундах
var TTL = {
    search: 24 * 60 * 60 * 1000,
    film: 24 * 60 * 60 * 1000,
    seasons: 24 * 60 * 60 * 1000,
    players: 15 * 60 * 1000
};

var DISABLED = process.env.KTW_NO_CACHE === '1';

function fileFor(kind, key) {
    var hash = crypto.createHash('sha1').update(String(key)).digest('hex').slice(0, 16);
    return path.join(CACHE_DIR, kind + '-' + hash + '.json');
}

function read(kind, key) {
    if (DISABLED) return null;

    var file = fileFor(kind, key);
    var ttl = TTL[kind] || 0;

    if (!ttl) return null;

    var raw;

    try {
        raw = fs.readFileSync(file, 'utf8');
    } catch (err) {
        return null;
    }

    var entry;

    try {
        entry = JSON.parse(raw);
    } catch (err) {
        // Битую запись проще выбросить, чем разбираться
        try { fs.unlinkSync(file); } catch (e) { }
        return null;
    }

    if (!entry || typeof entry.savedAt !== 'number' || Date.now() - entry.savedAt > ttl) {
        return null;
    }

    return entry.value;
}

function write(kind, key, value) {
    if (DISABLED || !TTL[kind]) return value;

    try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(fileFor(kind, key), JSON.stringify({ savedAt: Date.now(), value: value }));
    } catch (err) {
        // Кеш — ускорение, а не обязанность: не пишется, значит не пишется
    }

    return value;
}

// Взять из кеша либо сходить в сеть и запомнить.
// Пустой ответ не кешируется: иначе одна неудача залипала бы на сутки.
async function through(kind, key, load) {
    var cached = read(kind, key);

    if (cached !== null && cached !== undefined) return cached;

    var value = await load();

    if (value === null || value === undefined) return value;
    if (Array.isArray(value) && value.length === 0) return value;

    return write(kind, key, value);
}

function clear() {
    try {
        fs.rmSync(CACHE_DIR, { recursive: true, force: true });
        return CACHE_DIR;
    } catch (err) {
        return '';
    }
}

// Сколько записей и байт лежит в кеше — для ktw --clean и доктора
function stats() {
    var files = [];

    try {
        files = fs.readdirSync(CACHE_DIR);
    } catch (err) {
        return { entries: 0, bytes: 0 };
    }

    var bytes = 0;

    files.forEach(function (name) {
        try {
            bytes += fs.statSync(path.join(CACHE_DIR, name)).size;
        } catch (err) { }
    });

    return { entries: files.length, bytes: bytes };
}

module.exports = {
    CACHE_DIR: CACHE_DIR,
    TTL: TTL,
    read: read,
    write: write,
    through: through,
    clear: clear,
    stats: stats
};
