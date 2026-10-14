'use strict';

// Запуск mpv с потоком и отслеживанием прогресса через IPC сокет.
// Referer и User-Agent обязательны: CDN балансеров отдают сегменты
// только с теми же заголовками, с какими их запрашивал бы браузер.
//
// Про звук. У балансеров озвучки лежат отдельными рендициями
// (#EXT-X-MEDIA:TYPE=AUDIO), а вариант качества — это чистое видео. Поэтому
// mpv всегда получает мастер-плейлист, качество задаётся через --hls-bitrate,
// а озвучка — через --aid по номеру внутри группы. Подмена URL на вариант
// давала картинку без звука.

var spawn = require('child_process').spawn;
var net = require('net');
var fs = require('fs');
var path = require('path');
var os = require('os');
var config = require('./config');
var history = require('./history');

// Генерация пути к IPC сокету
function generateSocketPath() {
    var id = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    if (process.platform === 'win32') {
        return '\\\\.\\pipe\\ktw-mpv-' + id;
    }
    return path.join(os.tmpdir(), 'ktw-mpv-' + id + '.sock');
}

function buildArgs(stream, title, extraArgs, socketPath) {
    var userConfig = config.read();

    var args = [
        '--user-agent=' + (stream.userAgent || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'),
        '--referrer=' + stream.referer,
        '--http-header-fields=Origin: ' + stream.origin,
        '--really-quiet',
        '--msg-level=all=no',
        '--terminal=no',
        '--cache=yes',
        // --cache-secs перебивает --demuxer-readahead-secs, когда кеш включён,
        // а по умолчанию он равен 10 секундам. Из-за этого буфер в 250 МиБ
        // стоял почти пустым и на медленном канале видео постоянно замирало.
        '--cache-secs=300',
        '--demuxer-max-bytes=250MiB',
        '--demuxer-max-back-bytes=100MiB',
        '--demuxer-readahead-secs=300',
        // Сегменты HLS качаются пачкой, а не по одному
        '--stream-buffer-size=8MiB',
        // Подсказка для потоков, где язык дорожки всё-таки размечен
        '--alang=rus,ru,russian',
        '--hr-seek=yes',
        '--hr-seek-framedrop=yes',
        '--input-cursor=yes',
        '--hwdec=' + (userConfig.mpvHardwareDec || 'auto-safe'),
        '--sws-scaler=fast-bilinear',
        '--force-window=immediate',
        '--vid=auto',
        '--osc=yes',
        '--script-opts=osc-scalewindowed=1.2,osc-scalefullscreen=1.2,osc-visibility=auto'
    ];

    if (title) {
        args.push('--force-media-title=' + title);
    }

    // Привязка к IPC сокету для сохранения прогресса и отслеживания таймкода
    if (socketPath) {
        args.push('--input-ipc-server=' + socketPath);
    }

    // Возобновление с нужной секунды (--start)
    if (stream.startTime && Number(stream.startTime) > 0) {
        args.push('--start=' + Math.floor(Number(stream.startTime)));
    }

    // Качество внутри мастер-плейлиста: так звуковые группы остаются на месте
    if (stream.hlsBitrate && Number(stream.hlsBitrate) > 0) {
        args.push('--hls-bitrate=' + Math.floor(Number(stream.hlsBitrate)));
    }

    // Передача конкретной звуковой дорожки (--aid).
    // Номер обязан быть в пределах реального списка дорожек: --aid на
    // несуществующую дорожку mpv молча играет вообще без звука.
    var audioId = Number(stream.audioId);
    var trackCount = stream.audioTracks ? stream.audioTracks.length : 0;

    if (stream.audioId !== undefined && stream.audioId !== null &&
        audioId >= 1 && (trackCount === 0 || audioId <= trackCount)) {
        args.push('--aid=' + audioId);
    }

    // Звук отдельным плейлистом — когда дорожки не собраны в группу
    if (stream.audioUrl) {
        args.push('--audio-file=' + stream.audioUrl);
    }

    // Субтитры, если доступны
    if (stream.subtitleUrl) {
        args.push('--sub-file=' + stream.subtitleUrl);
    } else if (stream.subtitles && stream.subtitles.length > 0) {
        stream.subtitles.forEach(function (sub) {
            if (sub && sub.url) {
                args.push('--sub-file=' + sub.url);
            }
        });
    }

    // Настройки окна и полноэкранного режима
    if (userConfig.mpvFullscreen || userConfig.mpvWindowSize === 'fullscreen') {
        args.push('--fs');
    } else {
        var winSize = userConfig.mpvWindowSize || 'compact';
        if (winSize === 'compact') {
            // Компактный режим Picture-in-Picture в углу экрана
            args.push('--autofit=480x270');
            args.push('--geometry=96%:94%');
            args.push('--ontop');
        } else if (winSize === 'medium') {
            args.push('--autofit=800x450');
            args.push('--geometry=50%:50%');
        } else if (winSize === 'large') {
            args.push('--autofit=70%x70%');
            args.push('--geometry=50%:50%');
        }
    }

    if (userConfig.mpvHardwareDec && userConfig.mpvHardwareDec !== 'no') {
        args.push('--hwdec=' + userConfig.mpvHardwareDec);
    }
    if (userConfig.mpvCustomArgs && Array.isArray(userConfig.mpvCustomArgs)) {
        args = args.concat(userConfig.mpvCustomArgs);
    }

    if (extraArgs && extraArgs.length > 0) {
        args = args.concat(extraArgs);
    }

    args.push(stream.url);

    return args;
}

// Строка команды для копипаста (когда mpv нет или указан --no-mpv)
function buildCommand(stream, title, extraArgs) {
    var quoted = buildArgs(stream, title, extraArgs).map(function (arg) {
        return /[^\w@%+=:,./-]/.test(arg) ? "'" + arg.replace(/'/g, "'\\''") + "'" : arg;
    });

    return 'mpv ' + quoted.join(' ');
}

// Подключение к MPV IPC сокету и управление в реальном времени
function monitorIpc(socketPath, onProgress) {
    var client = null;
    var timer = null;
    var attempts = 0;
    var state = {
        timePos: 0,
        duration: 0,
        pause: false,
        volume: 100,
        speed: 1.0,
        fullscreen: false,
        aid: 1,
        sid: 0,
        eofReached: false
    };

    function sendCommand(command, reqId) {
        if (!client || client.destroyed) return;
        try {
            var msg = JSON.stringify({ command: command, request_id: reqId || 0 }) + '\n';
            client.write(msg);
        } catch (e) {}
    }

    function tryConnect() {
        if (attempts++ > 40) return;

        client = net.createConnection(socketPath, function () {
            sendCommand(['observe_property', 1, 'time-pos']);
            sendCommand(['observe_property', 2, 'duration']);
            sendCommand(['observe_property', 3, 'eof-reached']);
            sendCommand(['observe_property', 4, 'pause']);
            sendCommand(['observe_property', 5, 'volume']);
            sendCommand(['observe_property', 6, 'speed']);
            sendCommand(['observe_property', 7, 'fullscreen']);
            sendCommand(['observe_property', 8, 'aid']);
            sendCommand(['observe_property', 9, 'sid']);

            timer = setInterval(function () {
                sendCommand(['get_property', 'time-pos'], 10);
                sendCommand(['get_property', 'duration'], 11);
                sendCommand(['get_property', 'eof-reached'], 12);
                sendCommand(['get_property', 'pause'], 13);
                sendCommand(['get_property', 'volume'], 14);
                sendCommand(['get_property', 'speed'], 15);
                sendCommand(['get_property', 'fullscreen'], 16);
            }, 1000);
        });

        client.on('data', function (data) {
            var lines = data.toString().split('\n');
            lines.forEach(function (line) {
                if (!line.trim()) return;
                try {
                    var parsed = JSON.parse(line);
                    if (parsed.name === 'time-pos' && typeof parsed.data === 'number') state.timePos = parsed.data;
                    else if (parsed.name === 'duration' && typeof parsed.data === 'number') state.duration = parsed.data;
                    else if (parsed.name === 'pause' && typeof parsed.data === 'boolean') state.pause = parsed.data;
                    else if (parsed.name === 'volume' && typeof parsed.data === 'number') state.volume = parsed.data;
                    else if (parsed.name === 'speed' && typeof parsed.data === 'number') state.speed = parsed.data;
                    else if (parsed.name === 'fullscreen' && typeof parsed.data === 'boolean') state.fullscreen = parsed.data;
                    else if (parsed.name === 'aid') state.aid = parsed.data;
                    else if (parsed.name === 'sid') state.sid = parsed.data;
                    else if (parsed.name === 'eof-reached' && typeof parsed.data === 'boolean') state.eofReached = parsed.data;
                    else if (parsed.request_id === 10 && typeof parsed.data === 'number') state.timePos = parsed.data;
                    else if (parsed.request_id === 11 && typeof parsed.data === 'number') state.duration = parsed.data;
                    else if (parsed.request_id === 12 && typeof parsed.data === 'boolean') state.eofReached = parsed.data;
                    else if (parsed.request_id === 13 && typeof parsed.data === 'boolean') state.pause = parsed.data;
                    else if (parsed.request_id === 14 && typeof parsed.data === 'number') state.volume = parsed.data;
                    else if (parsed.request_id === 15 && typeof parsed.data === 'number') state.speed = parsed.data;
                    else if (parsed.request_id === 16 && typeof parsed.data === 'boolean') state.fullscreen = parsed.data;

                    if (onProgress && (state.timePos > 0 || state.duration > 0)) {
                        onProgress(state);
                    }
                } catch (e) {}
            });
        });

        client.on('error', function () {
            setTimeout(tryConnect, 100);
        });
    }

    setTimeout(tryConnect, 200);

    return {
        getState: function () { return state; },
        sendCommand: sendCommand,
        setAudio: function (audioId) { sendCommand(['set_property', 'aid', audioId]); },
        cycleAudio: function () { sendCommand(['cycle', 'aid']); },
        setBitrate: function (bitrate) { sendCommand(['set_property', 'hls-bitrate', bitrate]); },
        setSubtitle: function (subId) { sendCommand(['set_property', 'sid', subId]); },
        cycleSubtitle: function () { sendCommand(['cycle', 'sub']); },
        toggleSubtitle: function () { sendCommand(['cycle', 'sub-visibility']); },
        setPause: function (val) { sendCommand(['set_property', 'pause', val]); },
        togglePause: function () { sendCommand(['cycle', 'pause']); },
        toggleFullscreen: function () { sendCommand(['cycle', 'fullscreen']); },
        toggleMute: function () { sendCommand(['cycle', 'mute']); },
        seek: function (seconds) { sendCommand(['seek', seconds, 'relative']); },
        setVolume: function (vol) { sendCommand(['set_property', 'volume', Math.max(0, Math.min(150, vol))]); },
        changeVolume: function (delta) { sendCommand(['add', 'volume', delta]); },
        setSpeed: function (speed) { sendCommand(['set_property', 'speed', speed]); },
        changeSpeed: function (delta) { sendCommand(['add', 'speed', delta]); },
        setTitle: function (title) {
            sendCommand(['set_property', 'force-media-title', title]);
            sendCommand(['set_property', 'title', title]);
        },
        loadFile: function (url, startTime, title) {
            sendCommand(['loadfile', url, 'replace', startTime ? ('start=' + Math.floor(startTime)) : 'start=0']);
            if (title) {
                sendCommand(['set_property', 'force-media-title', title]);
                sendCommand(['set_property', 'title', title]);
            }
        },
        quit: function () { sendCommand(['quit']); },
        isClosed: function () { return !client || client.destroyed; },
        close: function () {
            if (timer) clearInterval(timer);
            if (client) {
                try { client.end(); client.destroy(); } catch (e) {}
            }
        }
    };
}

var SESSION_FILE = path.join(config.CONFIG_DIR, 'active_session.json');

function saveSessionFile(data) {
    try {
        fs.mkdirSync(config.CONFIG_DIR, { recursive: true });
        fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2) + '\n');
    } catch (e) {}
}

function clearSessionFile() {
    try {
        if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
    } catch (e) {}
}

function readSessionFile() {
    try {
        if (!fs.existsSync(SESSION_FILE)) return null;
        return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    } catch (e) {
        return null;
    }
}

// Попытка подключиться к уже работающему mpv при перезаходе в ktw
function tryAttachExistingSession(onProgressCallback) {
    return new Promise(function (resolve) {
        var data = readSessionFile();
        if (!data || !data.socketPath) return resolve(null);

        var socketPath = data.socketPath;
        var client = net.createConnection(socketPath);

        var timeout = setTimeout(function () {
            try { client.destroy(); } catch (e) {}
            clearSessionFile();
            resolve(null);
        }, 800);

        client.once('connect', function () {
            clearTimeout(timeout);
            client.destroy();

            var sessionData = Object.assign({}, data);
            function persistAttached() {
                saveSessionFile(sessionData);
            }

            var ipc = monitorIpc(socketPath, function (state) {
                if (sessionData.filmInfo) {
                    history.saveProgress({
                        filmId: sessionData.filmInfo.id,
                        title: sessionData.filmInfo.title,
                        year: sessionData.filmInfo.year,
                        poster: sessionData.filmInfo.poster,
                        serial: sessionData.filmInfo.serial,
                        season: sessionData.season,
                        episode: sessionData.episode,
                        player: sessionData.player,
                        translation: sessionData.translation,
                        quality: sessionData.stream ? sessionData.stream.label : '',
                        timePos: state.timePos,
                        duration: state.duration,
                        watched: state.eofReached || (state.duration > 0 && state.timePos / state.duration > 0.85)
                    });
                }
                if (onProgressCallback) onProgressCallback(state);
            });

            resolve({
                ipc: ipc,
                socketPath: socketPath,
                get film() { return sessionData.filmInfo; },
                set film(f) { sessionData.filmInfo = f; persistAttached(); },
                get stream() { return sessionData.stream; },
                set stream(s) { sessionData.stream = s; persistAttached(); },
                get player() { return { source: sessionData.player, direct: true }; },
                set player(p) {
                    sessionData.player = (typeof p === 'string' ? p : (p ? p.source : ''));
                    persistAttached();
                },
                get translation() { return sessionData.translation ? { name: sessionData.translation } : null; },
                set translation(t) {
                    sessionData.translation = (typeof t === 'string' ? t : (t ? t.name : ''));
                    persistAttached();
                },
                get season() { return sessionData.season; },
                set season(s) { sessionData.season = s; persistAttached(); },
                get episode() { return sessionData.episode; },
                set episode(e) { sessionData.episode = e; persistAttached(); },
                get variants() { return sessionData.variants || []; },
                set variants(v) { sessionData.variants = v || []; persistAttached(); },
                updateStream: function (newStream, newTitle) {
                    sessionData.filmInfo = newStream.filmInfo;
                    sessionData.stream = {
                        url: newStream.url,
                        label: newStream.label,
                        audioTracks: newStream.audioTracks,
                        variants: newStream.variants
                    };
                    sessionData.player = newStream.player;
                    sessionData.translation = newStream.translation;
                    sessionData.season = newStream.season;
                    sessionData.episode = newStream.episode;
                    sessionData.variants = newStream.variants || [];
                    if (newTitle) {
                        ipc.setTitle(newTitle);
                    }
                    persistAttached();
                    if (newStream.filmInfo) {
                        history.saveProgress({
                            filmId: newStream.filmInfo.id,
                            title: newStream.filmInfo.title,
                            year: newStream.filmInfo.year,
                            poster: newStream.filmInfo.poster,
                            serial: newStream.filmInfo.serial,
                            season: newStream.season,
                            episode: newStream.episode,
                            player: newStream.player,
                            translation: newStream.translation,
                            quality: newStream.label,
                            timePos: newStream.startTime || 0,
                            duration: 0,
                            watched: false
                        });
                    }
                },
                isAlive: function () {
                    var st = ipc.getState();
                    return !ipc.isClosed() && (st.duration > 0 || st.timePos > 0 || !st.eofReached);
                },
                getState: function () { return ipc.getState(); },
                quit: function () {
                    ipc.quit();
                    clearSessionFile();
                }
            });
        });

        client.on('error', function () {
            clearTimeout(timeout);
            clearSessionFile();
            resolve(null);
        });
    });
}

// Запуск сессии воспроизведения с живым IPC пультом
function startLiveSession(stream, title, extraArgs, onProgressCallback) {
    var socketPath = generateSocketPath();
    var currentStream = Object.assign({}, stream);

    function persistCurrent() {
        saveSessionFile({
            socketPath: socketPath,
            filmInfo: currentStream.filmInfo,
            stream: {
                url: currentStream.url,
                label: currentStream.label,
                audioTracks: currentStream.audioTracks,
                variants: currentStream.variants
            },
            player: currentStream.player,
            translation: currentStream.translation,
            season: currentStream.season,
            episode: currentStream.episode,
            variants: currentStream.variants || [],
            timestamp: Date.now()
        });
    }

    var ipc = monitorIpc(socketPath, function (state) {
        if (currentStream.filmInfo) {
            history.saveProgress({
                filmId: currentStream.filmInfo.id,
                title: currentStream.filmInfo.title,
                year: currentStream.filmInfo.year,
                poster: currentStream.filmInfo.poster,
                serial: currentStream.filmInfo.serial,
                season: currentStream.season,
                episode: currentStream.episode,
                player: currentStream.player,
                translation: currentStream.translation,
                quality: currentStream.label,
                timePos: state.timePos,
                duration: state.duration,
                watched: state.eofReached || (state.duration > 0 && state.timePos / state.duration > 0.85)
            });
        }
        if (onProgressCallback) onProgressCallback(state);
    });

    var args = buildArgs(stream, title, extraArgs, socketPath);
    var child = spawn('mpv', args, { stdio: ['ignore', 'ignore', 'ignore'] });
    var exited = false;
    var exitCode = null;

    persistCurrent();

    function cleanupSocket() {
        ipc.close();
        clearSessionFile();
        if (process.platform !== 'win32') {
            try { if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath); } catch (e) {}
        }
    }

    var exitPromise = new Promise(function (resolve, reject) {
        child.on('error', function (err) {
            cleanupSocket();
            if (err.code === 'ENOENT') {
                var isTermux = !!process.env.TERMUX_VERSION || fs.existsSync('/data/data/com.termux');
                if (isTermux) {
                    try {
                        var openChild = spawn('termux-open-url', [stream.url], { stdio: 'ignore' });
                        openChild.on('error', function () {
                            try {
                                spawn('am', ['start', '-a', 'android.intent.action.VIEW', '-d', stream.url, '-t', 'video/*'], { stdio: 'ignore' });
                            } catch (e) {}
                        });
                        resolve({ code: 0, timePos: 0, duration: 0, eofReached: false });
                        return;
                    } catch (e) {}
                }
                reject(new Error('mpv не найден в PATH. Установи mpv (winget install --id shinchiro.mpv -e / apt install mpv)'));
                return;
            }
            reject(err);
        });

        child.on('exit', function (code) {
            exited = true;
            exitCode = code;
            var finalState = ipc.getState();
            cleanupSocket();

            if (currentStream.filmInfo) {
                history.saveProgress({
                    filmId: currentStream.filmInfo.id,
                    title: currentStream.filmInfo.title,
                    year: currentStream.filmInfo.year,
                    poster: currentStream.filmInfo.poster,
                    serial: currentStream.filmInfo.serial,
                    season: currentStream.season,
                    episode: currentStream.episode,
                    player: currentStream.player,
                    translation: currentStream.translation,
                    quality: currentStream.label,
                    timePos: finalState.timePos,
                    duration: finalState.duration,
                    watched: finalState.eofReached || (finalState.duration > 0 && finalState.timePos / finalState.duration > 0.85)
                });
            }

            resolve({
                code: code === null ? 0 : code,
                timePos: finalState.timePos,
                duration: finalState.duration,
                eofReached: finalState.eofReached || (finalState.duration > 0 && finalState.timePos / finalState.duration > 0.85)
            });
        });
    });

    return {
        ipc: ipc,
        child: child,
        get stream() { return currentStream; },
        set stream(s) {
            currentStream = Object.assign({}, s);
            persistCurrent();
        },
        get player() { return { source: currentStream.player, direct: true }; },
        set player(p) {
            currentStream.player = (typeof p === 'string' ? p : (p ? p.source : ''));
            persistCurrent();
        },
        get translation() { return currentStream.translation ? { name: currentStream.translation } : null; },
        set translation(t) {
            currentStream.translation = (typeof t === 'string' ? t : (t ? t.name : ''));
            persistCurrent();
        },
        get season() { return currentStream.season; },
        set season(s) { currentStream.season = s; persistCurrent(); },
        get episode() { return currentStream.episode; },
        set episode(e) { currentStream.episode = e; persistCurrent(); },
        get film() { return currentStream.filmInfo; },
        set film(f) { currentStream.filmInfo = f; persistCurrent(); },
        get variants() { return currentStream.variants || []; },
        set variants(v) {
            currentStream.variants = v || [];
            persistCurrent();
        },
        updateStream: function (newStream, newTitle) {
            currentStream = Object.assign({}, newStream);
            if (newTitle) {
                ipc.setTitle(newTitle);
            }
            persistCurrent();
            if (currentStream.filmInfo) {
                history.saveProgress({
                    filmId: currentStream.filmInfo.id,
                    title: currentStream.filmInfo.title,
                    year: currentStream.filmInfo.year,
                    poster: currentStream.filmInfo.poster,
                    serial: currentStream.filmInfo.serial,
                    season: currentStream.season,
                    episode: currentStream.episode,
                    player: currentStream.player,
                    translation: currentStream.translation,
                    quality: currentStream.label,
                    timePos: currentStream.startTime || 0,
                    duration: 0,
                    watched: false
                });
            }
        },
        isAlive: function () { return !exited && child.exitCode === null; },
        getState: function () { return ipc.getState(); },
        waitExit: function () { return exitPromise; },
        quit: function () {
            ipc.quit();
            clearSessionFile();
            setTimeout(function () {
                if (!exited) {
                    try { child.kill(); } catch (e) {}
                }
            }, 800);
        }
    };
}

// Запуск mpv (блокирующий вызов для headless/скриптов)
function play(stream, title, extraArgs, onProgressCallback) {
    var session = startLiveSession(stream, title, extraArgs, onProgressCallback);
    return session.waitExit();
}

module.exports = {
    buildArgs: buildArgs,
    buildCommand: buildCommand,
    generateSocketPath: generateSocketPath,
    startLiveSession: startLiveSession,
    tryAttachExistingSession: tryAttachExistingSession,
    clearSessionFile: clearSessionFile,
    play: play
};
