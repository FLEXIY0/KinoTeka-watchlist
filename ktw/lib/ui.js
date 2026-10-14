'use strict';

// Минимальный интерактивный интерфейс без зависимостей:
// список со стрелками, ввод строки и спиннер. Всё рисуется в stderr,
// чтобы stdout оставался чистым для --json и пайпов.

var readline = require('readline');

var useColor = process.stderr.isTTY && !process.env.NO_COLOR;

function paint(code, text) {
    return useColor ? '\x1b[' + code + 'm' + text + '\x1b[0m' : text;
}

var color = {
    bold: function (t) { return paint('1', t); },
    dim: function (t) { return paint('2', t); },
    cyan: function (t) { return paint('36', t); },
    green: function (t) { return paint('32', t); },
    yellow: function (t) { return paint('33', t); },
    red: function (t) { return paint('31', t); }
};

function write(text) {
    process.stderr.write(text);
}

function info(text) {
    write(text + '\n');
}

function error(text) {
    write(color.red('✗ ') + text + '\n');
}

// Ввод строки (обычный readline)
function prompt(question) {
    return new Promise(function (resolve) {
        var rl = readline.createInterface({ input: process.stdin, output: process.stderr });
        rl.question(color.cyan('› ') + question + ' ', function (answer) {
            rl.close();
            resolve(answer.trim());
        });
    });
}

// Интерактивный выбор из списка.
// items: [{ label, hint }]. Возвращает индекс или -1 при отмене.
function select(title, items) {
    if (items.length === 0) return Promise.resolve(-1);

    // Без TTY интерактив невозможен — просто печатаем список и берём первый пункт
    if (!process.stdin.isTTY) {
        info(color.bold(title));
        items.forEach(function (item, i) {
            info('  ' + (i + 1) + '. ' + item.label);
        });
        return Promise.resolve(0);
    }

    return new Promise(function (resolve) {
        var current = 0;
        var drawnLines = 0;

        function render() {
            if (drawnLines > 0) {
                write('\x1b[' + drawnLines + 'A');
            }

            var lines = [color.bold(title)];

            items.forEach(function (item, i) {
                var active = i === current;
                var marker = active ? color.cyan('❯ ') : '  ';
                var label = active ? color.cyan(item.label) : item.label;
                var hint = item.hint ? ' ' + color.dim(item.hint) : '';
                lines.push(marker + label + hint);
            });

            lines.push(color.dim('  ↑/↓ — выбор, Enter — открыть, q — выход'));

            write(lines.map(function (line) { return '\x1b[2K' + line; }).join('\n') + '\n');
            drawnLines = lines.length;
        }

        function cleanup() {
            process.stdin.removeListener('keypress', onKey);
            if (process.stdin.isTTY) process.stdin.setRawMode(false);
            process.stdin.pause();
        }

        function onKey(str, key) {
            if (!key) return;

            if (key.name === 'up' || key.name === 'k') {
                current = (current - 1 + items.length) % items.length;
                render();
            } else if (key.name === 'down' || key.name === 'j') {
                current = (current + 1) % items.length;
                render();
            } else if (key.name === 'return') {
                cleanup();
                resolve(current);
            } else if (key.name === 'escape' || key.name === 'q' || (key.ctrl && key.name === 'c')) {
                cleanup();
                resolve(-1);
            } else if (str && /^[1-9]$/.test(str) && Number(str) <= items.length) {
                current = Number(str) - 1;
                render();
                cleanup();
                resolve(current);
            }
        }

        readline.emitKeypressEvents(process.stdin, { escapeCodeTimeout: 60 });
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('keypress', onKey);

        render();
    });
}

// Спиннер на время долгой операции
function spinner(text) {
    if (!process.stderr.isTTY) {
        info(color.dim(text + '…'));

        // Без терминала анимации нет, но интерфейс должен совпадать
        return {
            update: function (nextText) {
                if (nextText) info(color.dim('  ' + nextText));
            },
            stop: function () { }
        };
    }

    var frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    var i = 0;

    var timer = setInterval(function () {
        write('\r\x1b[2K' + color.cyan(frames[i++ % frames.length]) + ' ' + text);
    }, 80);

    return {
        // Текст можно менять на ходу: «жму play», «пропустил рекламу»…
        update: function (nextText) {
            if (nextText) text = nextText;
        },
        stop: function (finalText) {
            clearInterval(timer);
            write('\r\x1b[2K');
            if (finalText) info(finalText);
        }
    };
}

module.exports = {
    color: color,
    info: info,
    error: error,
    prompt: prompt,
    select: select,
    spinner: spinner
};
