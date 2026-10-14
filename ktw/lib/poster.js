'use strict';

// Отрисовка обложек прямо в терминале.
//
// Порядок предпочтений:
//   1. chafa      — лучшее качество, сам подстраивается под терминал
//   2. ImageMagick — переводим картинку в сырой RGB и рисуем полублоками ▀
//   3. заглушка    — рамка с первой буквой названия
//
// Результат — массив готовых строк фиксированного размера, поэтому обложка
// становится частью обычного текстового кадра и не мерцает при перерисовке.

var fs = require('fs');
var os = require('os');
var path = require('path');
var crypto = require('crypto');
var execFile = require('child_process').execFile;

var ansi = require('./ansi');

var CACHE_DIR = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'ktw', 'posters');

var memoryCache = new Map();
var toolCache = null;

function hasTool(name) {
    var dirs = (process.env.PATH || '').split(path.delimiter);

    for (var i = 0; i < dirs.length; i++) {
        try {
            fs.accessSync(path.join(dirs[i], name), fs.constants.X_OK);
            return true;
        } catch (err) {
            // Идём дальше по PATH
        }
    }

    return false;
}

// Какой рендерер доступен в системе
function detectTool() {
    if (toolCache) return toolCache;

    if (process.env.KTW_POSTER === 'off') toolCache = { name: 'none' };
    else if (hasTool('chafa')) toolCache = { name: 'chafa' };
    else if (hasTool('magick')) toolCache = { name: 'magick', bin: 'magick' };
    else if (hasTool('convert')) toolCache = { name: 'magick', bin: 'convert' };
    else toolCache = { name: 'none' };

    return toolCache;
}

function run(bin, args, options) {
    return new Promise(function (resolve, reject) {
        execFile(bin, args, options || {}, function (err, stdout) {
            if (err) reject(err);
            else resolve(stdout);
        });
    });
}

// Скачиваем постер в кэш, чтобы не дёргать сеть при каждом открытии
async function download(url) {
    var name = crypto.createHash('sha1').update(url).digest('hex');
    var file = path.join(CACHE_DIR, name);

    if (fs.existsSync(file)) return file;

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 10000);

    try {
        var res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error('HTTP ' + res.status);

        var buffer = Buffer.from(await res.arrayBuffer());
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(file, buffer);

        return file;
    } finally {
        clearTimeout(timer);
    }
}

async function renderWithChafa(file, cols, rows) {
    var args = ['--format', 'symbols', '--size', cols + 'x' + rows, '--animate', 'off', file];
    var output;

    try {
        output = await run('chafa', args, { maxBuffer: 8 * 1024 * 1024 });
    } catch (err) {
        // Старые сборки chafa не знают --animate
        output = await run('chafa', ['--format', 'symbols', '--size', cols + 'x' + rows, file], { maxBuffer: 8 * 1024 * 1024 });
    }

    return output.replace(/\n$/, '').split('\n').map(ansi.keepColorsOnly);
}

// Полублоки: верхний пиксель красим в текст, нижний — в фон
async function renderWithMagick(bin, file, cols, rows) {
    var width = cols;
    var height = rows * 2;
    var args = [file + '[0]', '-resize', width + 'x' + height + '!', '-depth', '8', 'rgb:-'];
    var raw = await run(bin, args, { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 });

    if (raw.length < width * height * 3) return null;

    var lines = [];

    for (var row = 0; row < rows; row++) {
        var line = '';

        for (var col = 0; col < width; col++) {
            var topAt = ((row * 2) * width + col) * 3;
            var bottomAt = ((row * 2 + 1) * width + col) * 3;

            line += ansi.fg(raw[topAt], raw[topAt + 1], raw[topAt + 2]) +
                ansi.bg(raw[bottomAt], raw[bottomAt + 1], raw[bottomAt + 2]) + '▀';
        }

        lines.push(line + ansi.style.reset);
    }

    return lines;
}

// Заглушка, когда картинки нет или нечем её отрисовать
function placeholder(title, cols, rows) {
    cols = typeof cols === 'number' && cols > 0 ? cols : 22;
    rows = typeof rows === 'number' && rows > 0 ? rows : 13;
    var letter = (String(title || '?').trim()[0] || '?').toUpperCase();
    var lines = [];

    for (var row = 0; row < rows; row++) {
        if (row === Math.floor(rows / 2)) {
            var left = Math.floor((cols - 1) / 2);
            lines.push(ansi.style.border(ansi.repeat(' ', left) + letter + ansi.repeat(' ', cols - left - 1)));
        } else {
            lines.push(ansi.repeat(' ', cols));
        }
    }

    return lines;
}

// Выравнивание результата ровно под размер блока
function fit(lines, cols, rows) {
    cols = typeof cols === 'number' && cols > 0 ? cols : 22;
    rows = typeof rows === 'number' && rows > 0 ? rows : 13;
    lines = Array.isArray(lines) ? lines : [];

    var result = lines.slice(0, rows).map(function (line) {
        var width = ansi.visibleWidth(line);

        if (width > cols) return line;

        var left = Math.floor((cols - width) / 2);
        return ansi.repeat(' ', left) + line + ansi.style.reset + ansi.repeat(' ', cols - width - left);
    });

    var padTop = Math.floor((rows - result.length) / 2);
    var padded = [];

    for (var i = 0; i < padTop; i++) padded.push(ansi.repeat(' ', cols));
    padded = padded.concat(result);
    while (padded.length < rows) padded.push(ansi.repeat(' ', cols));

    return padded;
}

// url -> массив строк размером cols x rows
async function render(url, title, cols, rows) {
    cols = typeof cols === 'number' && cols > 0 ? cols : 22;
    rows = typeof rows === 'number' && rows > 0 ? rows : 13;
    var key = (url || '') + ':' + cols + 'x' + rows;
    if (memoryCache.has(key)) return memoryCache.get(key);

    var tool = detectTool();
    var lines = null;

    if (url && tool.name !== 'none') {
        try {
            var file = await download(url);
            lines = tool.name === 'chafa'
                ? await renderWithChafa(file, cols, rows)
                : await renderWithMagick(tool.bin, file, cols, rows);
        } catch (err) {
            lines = null;
        }
    }

    var result = lines && lines.length > 0 ? fit(lines, cols, rows) : placeholder(title, cols, rows);
    memoryCache.set(key, result);

    return result;
}

// Удаление кэша обложек с диска
function clearCache() {
    memoryCache.clear();

    try {
        fs.rmSync(CACHE_DIR, { recursive: true, force: true });
        return CACHE_DIR;
    } catch (err) {
        return null;
    }
}

module.exports = {
    render: render,
    clearCache: clearCache,
    cacheDir: CACHE_DIR,
    placeholder: placeholder,
    available: function () { return detectTool().name !== 'none'; }
};
