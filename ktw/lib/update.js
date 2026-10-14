'use strict';

// Самообновление ktw (ktw --update / -u).
// ktw входит в КиноТеку: git-клон обновляется через git pull, установка
// через install.ps1 — повторным запуском той же команды.

var execFileSync = require('child_process').execFileSync;

var ui = require('./ui');
var info = require('./install-info');

async function runUpdate() {
    var version = info.installedVersion();

    ui.info('');
    ui.info(ui.color.bold('📦 Обновление КиноТеки (ktw входит в неё)'));
    ui.info('  Каталог: ' + ui.color.dim(info.ROOT));
    ui.info('  Версия:  ' + ui.color.cyan(version ? version.commit : 'неизвестна'));

    if (!info.isGit()) {
        ui.info('');
        if (process.platform === 'win32') {
            ui.info('  Закрой КиноТеку и вставь в PowerShell ту же команду, что и при установке:');
            ui.info('  ' + ui.color.cyan(info.INSTALL_CMD_WIN));
            ui.info(ui.color.dim('  Она скачает свежую версию; фильмы и история не затрагиваются.'));
        } else {
            ui.info('  Установка не из git. Свежая версия:');
            ui.info('  ' + ui.color.cyan(info.CLONE_CMD));
        }
        ui.info('');
        return 0;
    }

    var oldCommit = version ? version.commit : '';
    var spinner = ui.spinner('Скачиваю обновления с GitHub');

    try {
        execFileSync('git', ['-C', info.ROOT, 'pull', '--ff-only'], { stdio: 'ignore', timeout: 60000 });
    } catch (err) {
        spinner.stop();
        ui.error('Не удалось обновиться через git pull: ' + err.message.split('\n')[0]);
        ui.info(ui.color.dim('  Если есть локальные правки — закоммить или убери их и повтори'));
        return 1;
    }

    spinner.update('Обновляю зависимости...');
    try {
        execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
            ['install', '--omit=dev', '--no-audit', '--no-fund'],
            { cwd: info.ROOT, stdio: 'ignore', timeout: 120000, shell: process.platform === 'win32' });
    } catch (e) {}

    spinner.stop();

    var newCommit = info.git(['rev-parse', '--short', 'HEAD']);
    ui.info('');
    if (newCommit === oldCommit) {
        ui.info('  ' + ui.color.green('✓ Уже самая свежая версия (' + newCommit + ')'));
    } else {
        ui.info(ui.color.green('  ✓ Обновлено: ') + ui.color.dim(oldCommit) + ' → ' + ui.color.bold(newCommit));
        var log = info.git(['log', '--oneline', '-n', '5', oldCommit + '..HEAD']);
        if (log) {
            ui.info('');
            ui.info(ui.color.bold('  Последние изменения:'));
            log.split('\n').forEach(function (line) {
                ui.info('    • ' + ui.color.dim(line));
            });
        }
    }
    ui.info('');
    return 0;
}

module.exports = {
    runUpdate: runUpdate
};
