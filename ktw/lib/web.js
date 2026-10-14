'use strict';

// Переход из ktw в браузер: когда балансер не отдал поток, тот же фильм
// открывается на странице просмотра КиноТеки (плееры балансеров через kinobox).
// Если сервер КиноТеки не запущен, запускаем его в фоне.

var spawn = require('child_process').spawn;
var exec = require('child_process').exec;
var http = require('http');
var path = require('path');

var ROOT = path.resolve(__dirname, '..', '..');
var SERVER = path.join(ROOT, 'server.js');
var FIRST_PORT = Number(process.env.PORT) || 3000;

// Отвечает ли на порту КиноТека
function probe(port) {
    return new Promise(function (resolve) {
        var req = http.get({ host: '127.0.0.1', port: port, path: '/api/films', timeout: 800 }, function (res) {
            var body = '';
            res.setEncoding('utf8');
            res.on('data', function (chunk) { body += chunk; });
            res.on('end', function () {
                try {
                    resolve(res.statusCode === 200 && Array.isArray(JSON.parse(body)));
                } catch (err) {
                    resolve(false);
                }
            });
        });
        req.on('timeout', function () { req.destroy(); });
        req.on('error', function () { resolve(false); });
    });
}

function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function findServer() {
    for (var port = FIRST_PORT; port < FIRST_PORT + 10; port++) {
        if (await probe(port)) return port;
    }
    return null;
}

// Сервер в фоне: переживает выход из ktw, как если бы его запустили через ktw
async function ensureServer() {
    var port = await findServer();
    if (port) return port;

    var child = spawn(process.execPath, [SERVER], {
        cwd: ROOT,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: Object.assign({}, process.env, { PORT: String(FIRST_PORT) })
    });
    child.unref();

    for (var i = 0; i < 40; i++) {
        await sleep(250);
        if (await probe(FIRST_PORT)) return FIRST_PORT;
    }
    throw new Error('сервер КиноТеки не запустился');
}

function openUrl(url) {
    if (process.platform === 'win32') {
        exec('start "" "' + url + '"');
    } else if (process.platform === 'darwin') {
        spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
        spawn('xdg-open', [url], { detached: true, stdio: 'ignore' })
            .on('error', function () {})
            .unref();
    }
}

// Открыть фильм в браузере; возвращает адрес страницы
async function openWatchPage(filmId, season, episode) {
    var port = await ensureServer();
    var url = 'http://localhost:' + port + '/watch.html?kp=' + encodeURIComponent(filmId);
    if (season && episode) url += '&s=' + Number(season) + '&e=' + Number(episode);
    openUrl(url);
    return url;
}

module.exports = {
    openWatchPage: openWatchPage,
    findServer: findServer
};
