#!/usr/bin/env node
/**
 * Команда ktw — единая точка входа КиноТеки.
 *
 *   ktw                  коллекция: сервер + интерфейс в терминале + браузер
 *   ktw watch            плеер ktw (поиск, история просмотров)
 *   ktw <запрос|id> ...  плеер ktw сразу с фильмом (все флаги ktw работают)
 *   ktw update           обновить КиноТеку
 *   ktw help             справка
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const KTW = path.join(ROOT, 'ktw', 'ktw.js');
const LAUNCHER = path.join(__dirname, 'app_launcher.js');
// Откуда брать установщик (переопределяется в CI, чтобы проверить именно этот коммит)
const RAW = process.env.KINOTEKA_RAW_BASE || 'https://raw.githubusercontent.com/FLEXIY0/KinoTeka-watchlist/main/';
const INSTALL_CMD = `irm ${RAW}install.ps1 | iex`;
// Сначала скачиваем целиком, потом запускаем: при обрыве связи `curl | sh` молча
// выполнил бы пустой скрипт. curl есть не везде — на минимальных системах wget
const INSTALL_CMD_UNIX = `s=$(curl -fsSL '${RAW}install.sh' 2>/dev/null || wget -qO- '${RAW}install.sh' 2>/dev/null)
if [ -z "$s" ]; then echo 'Нет связи с GitHub — обновиться не удалось' >&2; exit 1; fi
printf '%s\n' "$s" | sh`;

const args = process.argv.slice(2);
const first = (args[0] || '').toLowerCase();

// Установлено через install.ps1 / install.sh (без git) — обновляемся им же
function isInstallerSetup() {
    return fs.existsSync(path.join(ROOT, '.kinoteka-version')) && !fs.existsSync(path.join(ROOT, '.git'));
}

// На Windows mpv после установки через winget/scoop не всегда сразу в PATH
// (особенно в уже открытом окне). Ищем его в типичных местах и добавляем.
// winget ставит «портативные» пакеты в папку пользователя, а из окна
// администратора — в Program Files, поэтому смотрим оба места.
function findMpvDir() {
    const local = process.env.LOCALAPPDATA || '';
    const programFiles = [process.env.ProgramFiles || 'C:\\Program Files', process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'];
    const wingetRoots = [path.join(local, 'Microsoft', 'WinGet'), ...programFiles.map((p) => path.join(p, 'WinGet'))];

    const candidates = [
        ...wingetRoots.map((root) => path.join(root, 'Links')),
        path.join(process.env.USERPROFILE || '', 'scoop', 'shims'),
        path.join(process.env.ProgramData || 'C:\\ProgramData', 'chocolatey', 'bin'),
        ...programFiles.map((p) => path.join(p, 'mpv')),
        ...programFiles.map((p) => path.join(p, 'MPV Player'))
    ];

    // Папка пакета winget и вложенные в неё (архив может распаковаться в подпапку)
    for (const root of wingetRoots) {
        const packages = path.join(root, 'Packages');
        let names = [];
        try { names = fs.readdirSync(packages); } catch {}
        for (const name of names) {
            if (!name.toLowerCase().startsWith('shinchiro.mpv')) continue;
            const pkg = path.join(packages, name);
            candidates.push(pkg);
            try {
                for (const sub of fs.readdirSync(pkg, { withFileTypes: true })) {
                    if (sub.isDirectory()) candidates.push(path.join(pkg, sub.name));
                }
            } catch {}
        }
    }

    return candidates.find((dir) => dir && fs.existsSync(path.join(dir, 'mpv.exe'))) || null;
}

function ensureMpvOnPath() {
    if (process.platform !== 'win32') return;
    const dirs = String(process.env.PATH || '').split(path.delimiter);
    if (dirs.some((dir) => dir && fs.existsSync(path.join(dir, 'mpv.exe')))) return;

    // Папка, которую нашёл установщик (в том числе по записи winget в реестре)
    let remembered = null;
    try {
        remembered = fs.readFileSync(path.join(ROOT, '..', 'mpv-path.txt'), 'utf8').replace(/^\uFEFF/, '').trim();
    } catch {}
    if (remembered && !fs.existsSync(path.join(remembered, 'mpv.exe'))) remembered = null;

    const found = remembered || findMpvDir();
    if (found) process.env.PATH = found + path.delimiter + process.env.PATH;
}

function runModule(file, moduleArgs) {
    process.argv = [process.argv[0], file, ...moduleArgs];
    require(file);
}

function installerUpdate() {
    console.log('Обновляю КиноТеку…');
    // Запускаем из папки установки, а не приложения: папку приложения установщик заменяет
    const home = path.join(ROOT, '..');
    const [cmd, cmdArgs] = process.platform === 'win32'
        ? ['powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', INSTALL_CMD]]
        : ['sh', ['-c', INSTALL_CMD_UNIX]];
    const result = spawnSync(cmd, cmdArgs, {
        stdio: 'inherit',
        cwd: home,
        env: { ...process.env, KINOTEKA_NO_START: '1', KINOTEKA_HOME: process.env.KINOTEKA_HOME || home }
    });
    process.exit(result.status === null ? 1 : result.status);
}

function help() {
    console.log([
        'КиноТека — коллекция фильмов и плеер ktw',
        '',
        '  ktw                  открыть коллекцию (сервер, браузер, интерфейс в терминале)',
        '  ktw watch            плеер ktw: поиск и история просмотров',
        '  ktw <название|id>    сразу открыть фильм в плеере, например: ktw матрица',
        '  ktw update           обновить КиноТеку (фильмы и история сохраняются)',
        '',
        'Флаги плеера: ktw watch --help'
    ].join('\n'));
}

ensureMpvOnPath();

if (!args.length || ['list', 'app', 'список'].includes(first)) {
    runModule(LAUNCHER, args.slice(1));
} else if (['help', '--help', '-h', 'помощь'].includes(first)) {
    help();
} else if (['update', '--update', '-u', 'обновить'].includes(first) && isInstallerSetup()) {
    installerUpdate();
} else if (['update', 'обновить'].includes(first)) {
    runModule(KTW, ['--update']);
} else if (['watch', 'смотреть', 'w'].includes(first)) {
    runModule(KTW, args.slice(1));
} else {
    runModule(KTW, args);
}
