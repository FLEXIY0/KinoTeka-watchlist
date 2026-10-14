/**
 * Лаунчер КиноТеки: запускает сервер и открывает приложение на localhost.
 *
 * В терминале показывает простой интерфейс (TUI): статус сервера, адрес,
 * последние сообщения сервера и горячие клавиши. Если запущен не в
 * терминале (например, из CI), работает без интерфейса и просто печатает логи.
 *
 *   node scripts/app_launcher.js              — обычный запуск
 *   node scripts/app_launcher.js --no-browser — не открывать браузер автоматически
 */

const { spawn, exec } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const readline = require('readline');

const ROOT_DIR = path.join(__dirname, '..');
const SERVER_FILE = path.join(ROOT_DIR, 'server.js');
const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const PORT_ATTEMPTS = 10;
const MAX_LOG_LINES = 300;

const args = process.argv.slice(2);
const AUTO_OPEN = !args.includes('--no-browser');
const INTERACTIVE = Boolean(process.stdin.isTTY && process.stdout.isTTY);

const state = {
    status: 'starting', // starting | running | external | stopped | error
    port: DEFAULT_PORT,
    message: '',
    films: null,
    logs: [],
    child: null,
    stopping: false,
    openedOnce: false
};

// ─── Утилиты ────────────────────────────────────────────────────────────────

const appUrl = () => `http://localhost:${state.port}/`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function addLog(text) {
    for (const line of String(text).split(/\r?\n/)) {
        if (!line.trim()) continue;
        state.logs.push(line);
        if (!INTERACTIVE) console.log(line);
    }
    if (state.logs.length > MAX_LOG_LINES) {
        state.logs.splice(0, state.logs.length - MAX_LOG_LINES);
    }
    render();
}

function httpGetJson(port, urlPath, timeout = 1000) {
    return new Promise((resolve) => {
        const req = http.get({ host: '127.0.0.1', port, path: urlPath, timeout }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, json: JSON.parse(body) });
                } catch {
                    resolve({ status: res.statusCode, json: null });
                }
            });
        });
        req.on('timeout', () => req.destroy());
        req.on('error', () => resolve(null));
    });
}

// Что сейчас на порту: ничего, наша КиноТека или чужая программа
async function probePort(port) {
    const res = await httpGetJson(port, '/api/films');
    if (!res) return 'free';
    if (res.status === 200 && Array.isArray(res.json)) return 'kinoteka';
    return 'busy';
}

// ─── Браузер ────────────────────────────────────────────────────────────────

function findAppBrowser() {
    if (process.platform !== 'win32') return null;
    const candidates = [
        [process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'],
        [process.env.PROGRAMFILES, 'Google\\Chrome\\Application\\chrome.exe'],
        [process.env['PROGRAMFILES(X86)'], 'Google\\Chrome\\Application\\chrome.exe'],
        [process.env['PROGRAMFILES(X86)'], 'Microsoft\\Edge\\Application\\msedge.exe'],
        [process.env.PROGRAMFILES, 'Microsoft\\Edge\\Application\\msedge.exe']
    ];
    for (const [base, rel] of candidates) {
        if (!base) continue;
        const full = path.join(base, rel);
        if (fs.existsSync(full)) return full;
    }
    return null;
}

// asApp: отдельное окно без вкладок (Chrome/Edge на Windows), иначе обычный браузер
function openBrowser(asApp = true) {
    const url = appUrl();
    try {
        const appBrowser = asApp ? findAppBrowser() : null;
        if (appBrowser) {
            spawn(appBrowser, [`--app=${url}`, '--window-size=1400,900'], { detached: true, stdio: 'ignore' }).unref();
        } else if (process.platform === 'win32') {
            exec(`start "" "${url}"`);
        } else if (process.platform === 'darwin') {
            spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
        } else {
            spawn('xdg-open', [url], { detached: true, stdio: 'ignore' })
                .on('error', () => addLog(`Не удалось открыть браузер. Откройте вручную: ${url}`))
                .unref();
        }
        addLog(`Открываю ${url}`);
    } catch (error) {
        addLog(`Не удалось открыть браузер (${error.message}). Откройте вручную: ${url}`);
    }
}

// ─── Сервер ─────────────────────────────────────────────────────────────────

async function startServer() {
    state.status = 'starting';
    state.message = '';
    render();

    // Ищем порт: если на нём уже наша КиноТека — подключаемся к ней,
    // если чужая программа — пробуем следующий
    let port = DEFAULT_PORT;
    for (let i = 0; i < PORT_ATTEMPTS; i++, port++) {
        const probe = await probePort(port);
        if (probe === 'kinoteka') {
            state.port = port;
            state.status = 'external';
            state.message = 'Сервер уже запущен в другом окне — подключились к нему';
            addLog(`КиноТека уже работает на порту ${port}`);
            return true;
        }
        if (probe === 'free') break;
        addLog(`Порт ${port} занят другой программой, пробую ${port + 1}`);
    }
    state.port = port;

    const child = spawn(process.execPath, [SERVER_FILE], {
        cwd: ROOT_DIR,
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
    });
    state.child = child;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', addLog);
    child.stderr.on('data', addLog);

    child.on('error', (error) => {
        state.status = 'error';
        state.message = `Не удалось запустить сервер: ${error.message}`;
        addLog(state.message);
    });

    child.on('exit', (code, signal) => {
        if (state.child !== child) return;
        state.child = null;
        if (state.stopping) return;
        state.status = 'error';
        state.message = `Сервер остановился (код ${code ?? signal}). Нажмите R, чтобы перезапустить`;
        addLog(state.message);
        if (!INTERACTIVE) process.exit(1);
    });

    // Ждём, пока сервер начнёт отвечать
    for (let i = 0; i < 60; i++) {
        if (state.child !== child) return false;
        if ((await probePort(port)) === 'kinoteka') {
            state.status = 'running';
            render();
            return true;
        }
        await sleep(250);
    }

    state.status = 'error';
    state.message = 'Сервер не ответил за 15 секунд. Подробности — в логе ниже';
    render();
    return false;
}

function stopServer() {
    const child = state.child;
    if (!child) return Promise.resolve();
    state.stopping = true;
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
        }, 3000);
        child.once('exit', () => {
            clearTimeout(timer);
            state.child = null;
            state.stopping = false;
            resolve();
        });
        child.kill();
    });
}

async function restartServer() {
    if (state.status === 'external') {
        addLog('Сервер запущен в другом окне — перезапустите его там');
        return;
    }
    addLog('Перезапуск сервера…');
    await stopServer();
    await startServer();
}

async function refreshStats() {
    if (state.status !== 'running' && state.status !== 'external') return;
    const res = await httpGetJson(state.port, '/api/films');
    if (res && Array.isArray(res.json)) {
        state.films = res.json.length;
    } else if (state.status === 'external') {
        // Внешний сервер закрыли — запускаем свой
        addLog('Сервер в другом окне остановлен, запускаю свой');
        await startServer();
    }
    render();
}

// ─── Интерфейс ──────────────────────────────────────────────────────────────

const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    inverse: '\x1b[7m'
};

const STATUS_VIEW = {
    starting: [c.yellow, 'запускается…'],
    running: [c.green, 'работает'],
    external: [c.green, 'работает (в другом окне)'],
    stopped: [c.dim, 'остановлен'],
    error: [c.red, 'ошибка']
};

function fit(text, width) {
    const chars = Array.from(text);
    return chars.length > width ? chars.slice(0, Math.max(0, width - 1)).join('') + '…' : text;
}

let renderScheduled = false;
function render() {
    if (!INTERACTIVE || renderScheduled) return;
    renderScheduled = true;
    setImmediate(() => {
        renderScheduled = false;
        draw();
    });
}

function draw() {
    const width = Math.max(40, process.stdout.columns || 80);
    const height = Math.max(15, process.stdout.rows || 24);
    const line = '─'.repeat(width);
    const [color, label] = STATUS_VIEW[state.status];

    const out = [];
    out.push(`${c.inverse}${c.bold}${fit('  КИНОТЕКА — менеджер фильмов и сериалов', width).padEnd(width)}${c.reset}`);
    out.push('');
    out.push(`  Сервер:   ${color}● ${label}${c.reset}`);
    out.push(`  Адрес:    ${c.cyan}${c.bold}${appUrl()}${c.reset}`);
    out.push(`  Фильмов:  ${state.films ?? '—'}`);
    out.push(`  ${state.message ? color + fit(state.message, width - 4) + c.reset : ''}`);
    out.push(c.dim + line + c.reset);

    const footer = [
        c.dim + line + c.reset,
        `  ${c.bold}O${c.reset} открыть   ${c.bold}B${c.reset} в обычном браузере   ${c.bold}R${c.reset} перезапустить   ${c.bold}C${c.reset} очистить лог   ${c.bold}Q${c.reset} выход`
    ];

    const logHeight = height - out.length - footer.length - 1;
    const visible = state.logs.slice(-logHeight).map((l) => '  ' + fit(l, width - 3));
    while (visible.length < logHeight) visible.push('');

    const screen = [...out, ...visible, ...footer].map((l) => l + '\x1b[K').join('\n');
    process.stdout.write('\x1b[H' + screen + '\x1b[J');
}

// ─── Управление ─────────────────────────────────────────────────────────────

let quitting = false;
async function quit() {
    if (quitting) return;
    quitting = true;
    if (INTERACTIVE) {
        process.stdout.write('\x1b[2J\x1b[H\x1b[?25h\x1b[?1049l');
    }
    console.log('Остановка КиноТеки…');
    await stopServer();
    console.log('Сервер остановлен. До встречи!');
    process.exit(0);
}

// Клавиши в английской и русской раскладке (O/щ, B/и, R/к, C/с, Q/й)
const KEYS = {
    open: ['o', 'щ', 'return', 'enter'],
    browser: ['b', 'и'],
    restart: ['r', 'к'],
    clear: ['c', 'с'],
    quit: ['q', 'й', 'escape']
};

function setupKeyboard() {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('keypress', (str, key = {}) => {
        if (key.ctrl && key.name === 'c') return quit();
        const name = (key.name || str || '').toLowerCase();
        const pressed = (action) => KEYS[action].includes(name) || KEYS[action].includes((str || '').toLowerCase());

        if (pressed('quit')) quit();
        else if (pressed('open')) openBrowser(true);
        else if (pressed('browser')) openBrowser(false);
        else if (pressed('restart')) restartServer();
        else if (pressed('clear')) { state.logs = []; render(); }
    });
}

async function main() {
    if (!fs.existsSync(path.join(ROOT_DIR, 'node_modules'))) {
        console.error('Не найдена папка node_modules. Выполните `npm install` в папке приложения.');
        process.exit(1);
    }

    process.on('SIGINT', quit);
    process.on('SIGTERM', quit);
    process.on('exit', () => {
        if (state.child) state.child.kill();
    });

    if (INTERACTIVE) {
        // Отдельный экран терминала, скрытый курсор
        process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[2J');
        process.stdout.on('resize', render);
        setupKeyboard();
    } else {
        console.log('КиноТека: запуск без интерфейса (не терминал)');
    }

    render();
    const ok = await startServer();

    if (ok) {
        if (!INTERACTIVE) console.log(`КиноТека работает: ${appUrl()}`);
        if (AUTO_OPEN && !state.openedOnce) {
            state.openedOnce = true;
            openBrowser(true);
        }
    } else if (!INTERACTIVE) {
        console.error(state.message);
        process.exitCode = 1;
        await stopServer();
        return;
    }

    setInterval(refreshStats, 2000).unref();
    refreshStats();
}

main().catch((error) => {
    if (INTERACTIVE) process.stdout.write('\x1b[?25h\x1b[?1049l');
    console.error('Критическая ошибка:', error);
    process.exit(1);
});
