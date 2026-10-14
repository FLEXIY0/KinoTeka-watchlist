'use strict';

// Откуда установлен ktw и как его обновить.
// ktw живёт внутри KinoTeka-watchlist: на Windows его ставит install.ps1
// (без git, версия лежит в .kinoteka-version), у разработчиков — git-клон.

var fs = require('fs');
var path = require('path');
var execFileSync = require('child_process').execFileSync;

var ROOT = path.resolve(__dirname, '..', '..');
var REPO = 'FLEXIY0/KinoTeka-watchlist';
var INSTALL_CMD_WIN = 'irm https://raw.githubusercontent.com/' + REPO + '/main/install.ps1 | iex';
var CLONE_CMD = 'git clone https://github.com/' + REPO + '.git && cd KinoTeka-watchlist && npm install';

function git(args) {
    try {
        return execFileSync('git', ['-C', ROOT].concat(args), {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 20000
        }).trim();
    } catch (err) {
        return '';
    }
}

function isGit() {
    return fs.existsSync(path.join(ROOT, '.git'));
}

// Версия установки: коммит из git или из файла, который пишет install.ps1
function installedVersion() {
    if (isGit()) {
        var commit = git(['rev-parse', '--short', 'HEAD']);
        if (commit) {
            return {
                kind: 'git',
                commit: commit,
                branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
                date: git(['log', '-1', '--format=%cd', '--date=short'])
            };
        }
    }

    try {
        var sha = fs.readFileSync(path.join(ROOT, '.kinoteka-version'), 'utf8').trim();
        if (sha) return { kind: 'installer', commit: sha.slice(0, 7), branch: 'main', date: '' };
    } catch (err) {}

    return null;
}

// Подсказка, как обновиться, для текущей системы
function updateHint() {
    if (isGit()) return 'git -C ' + ROOT + ' pull && npm install';
    if (process.platform === 'win32') return 'закрой КиноТеку и вставь в PowerShell: ' + INSTALL_CMD_WIN;
    return CLONE_CMD;
}

module.exports = {
    ROOT: ROOT,
    REPO: REPO,
    INSTALL_CMD_WIN: INSTALL_CMD_WIN,
    CLONE_CMD: CLONE_CMD,
    git: git,
    isGit: isGit,
    installedVersion: installedVersion,
    updateHint: updateHint
};
