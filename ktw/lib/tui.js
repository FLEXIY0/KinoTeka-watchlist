'use strict';

// Движок полноэкранного интерфейса: альтернативный буфер, очередь клавиш,
// поддержка мыши (SGR mouse mode, скролл, клики), отрисовка кадра и типовые виджеты.

var readline = require('readline');
var ansi = require('./ansi');

var style = ansi.style;
var glyph = ansi.glyph;

var active = false;
var pendingKeys = [];
var waiters = [];
var resizeHandler = null;
var lastFrame = null;

function write(text) {
    process.stdout.write(text);
}

function size() {
    return {
        cols: process.stdout.columns || 80,
        rows: process.stdout.rows || 24
    };
}

function dispatchEvent(event) {
    if (waiters.length > 0) waiters.shift()(event);
    else pendingKeys.push(event);
}

function onKeypress(str, key) {
    key = key || {};

    // Разбор SGR последовательностей мыши: \x1b[<btn;col;row;M или m
    if (str && str.indexOf('\x1b[<') >= 0) {
        var mouseRegex = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
        var match;
        var handledMouse = false;

        while ((match = mouseRegex.exec(str)) !== null) {
            handledMouse = true;
            var btn = parseInt(match[1], 10);
            var col = parseInt(match[2], 10);
            var row = parseInt(match[3], 10);
            var isPress = match[4] === 'M';

            // Колёсико мыши вверх
            if (btn === 64) {
                dispatchEvent({ name: 'up', mouse: true });
            }
            // Колёсико мыши вниз
            else if (btn === 65) {
                dispatchEvent({ name: 'down', mouse: true });
            }
            // Левый клик мыши
            else if (btn === 0 && isPress) {
                dispatchEvent({ name: 'return', mouse: true, col: col, row: row });
            }
            // Правый клик мыши — возврат назад (Esc)
            else if (btn === 2 && isPress) {
                dispatchEvent({ name: 'escape', mouse: true, col: col, row: row });
            }
        }

        if (handledMouse) return;
    }

    var event = {
        name: key.name || '',
        ctrl: !!key.ctrl,
        shift: !!key.shift,
        meta: !!key.meta,
        sequence: key.sequence || '',
        str: str || ''
    };

    // Точное распознавание Ctrl+H (в терминале ASCII 8 '\x08' или '\b')
    if (str === '\x08' || str === '\b' || (event.ctrl && (event.name === 'h' || event.name === 'backspace'))) {
        event.name = 'h';
        event.ctrl = true;
    } else if (str === '\x7f' || event.name === 'backspace') {
        event.name = 'backspace';
        event.ctrl = false;
    }

    // Ctrl+C прерывает работу в любой момент
    if (event.ctrl && event.name === 'c') {
        exit();
        process.exit(130);
    }

    dispatchEvent(event);
}

function onResize() {
    if (resizeHandler) resizeHandler();
    else if (lastFrame) paint(lastFrame);
}

function redraw() {
    if (waiters.length > 0) {
        var w = waiters.shift();
        w({ name: 'redraw' });
    } else if (lastFrame) {
        paint(lastFrame);
    }
}

function enter() {
    if (active) return;
    active = true;

    // Альтернативный буфер + скрытый курсор + включение мыши (1000h, 1006h) + очистка
    write('\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h\x1b[2J');

    readline.emitKeypressEvents(process.stdin, { escapeCodeTimeout: 60 });
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    process.stdin.on('keypress', onKeypress);
    process.stdout.on('resize', onResize);
}

function exit() {
    if (!active) return;
    active = false;

    // Отключение мыши + возврат курсора + возврат буфера
    write('\x1b[?1006l\x1b[?1000l\x1b[?25h\x1b[?1049l');

    process.stdin.removeListener('keypress', onKeypress);
    process.stdout.removeListener('resize', onResize);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
}

// Следующая клавиша / событие мыши; timeoutMs позволяет параллельно ждать таймер
function readKey(timeoutMs) {
    if (pendingKeys.length > 0) return Promise.resolve(pendingKeys.shift());

    return new Promise(function (resolve) {
        var done = false;
        var timer = null;

        var waiter = function (event) {
            if (done) return;
            done = true;
            if (timer) clearTimeout(timer);
            resolve(event);
        };

        waiters.push(waiter);

        if (timeoutMs) {
            timer = setTimeout(function () {
                if (done) return;
                done = true;
                var index = waiters.indexOf(waiter);
                if (index >= 0) waiters.splice(index, 1);
                resolve(null);
            }, timeoutMs);
        }
    });
}

// Отрисовка кадра: блок строк по центру экрана с атомарным фрейм-синком
function paint(lines) {
    if (!lines) return;
    lastFrame = lines;

    var screen = size();
    var blockWidth = 0;

    for (var i = 0; i < lines.length; i++) {
        blockWidth = Math.max(blockWidth, ansi.visibleWidth(lines[i]));
    }

    var left = Math.max(0, Math.floor((screen.cols - blockWidth) / 2));
    var top = Math.max(0, Math.floor((screen.rows - lines.length) / 2));
    var indent = ansi.repeat(' ', left);
    var out = [];

    for (var row = 0; row < screen.rows; row++) {
        var content = row >= top && row < top + lines.length ? indent + lines[row - top] : '';
        out.push('\x1b[2K' + content);
    }

    // \x1b[?2026h = начало синхронизированного вывода (без мерцания и задержек)
    // \x1b[?2026l = конец синхронизированного вывода
    write('\x1b[?2026h\x1b[H' + out.join('\r\n') + '\x1b[?2026l');
}

// Рамка вокруг готовых строк содержимого
function box(title, contentLines, width, footer) {
    var inner = width - 2;
    var lines = [];
    var head;

    if (title) {
        var caption = ansi.truncate(title, Math.max(4, inner - 4));
        var used = ansi.visibleWidth(caption) + 3;
        head = style.border(glyph.tl + glyph.h + ' ') + style.bold(caption) + ' ' +
            style.border(ansi.repeat(glyph.h, Math.max(0, inner - used)) + glyph.tr);
    } else {
        head = style.border(glyph.tl + ansi.repeat(glyph.h, inner) + glyph.tr);
    }

    lines.push(head);

    for (var i = 0; i < contentLines.length; i++) {
        lines.push(style.border(glyph.v) + ansi.pad(contentLines[i], inner) + style.border(glyph.v));
    }

    lines.push(style.border(glyph.bl + ansi.repeat(glyph.h, inner) + glyph.br));

    if (footer) {
        var centered = Math.max(0, Math.floor((width - ansi.visibleWidth(footer)) / 2));
        lines.push('');
        lines.push(ansi.repeat(' ', centered) + footer);
    }

    return lines;
}

// Список с прокруткой. items: [{ label, hint, badge }]
function list(items, selected, maxVisible, width) {
    var lines = [];

    if (items.length === 0) return lines;

    var visible = Math.min(maxVisible, items.length);
    var offset = 0;

    if (items.length > visible) {
        offset = Math.max(0, Math.min(selected - Math.floor(visible / 2), items.length - visible));
    }

    for (var i = offset; i < offset + visible; i++) {
        var item = items[i];
        var isActive = i === selected;
        var marker = isActive ? style.accent(glyph.arrow + ' ') : '  ';

        var hint = item.hint || '';
        var labelWidth = width - 4 - (hint ? ansi.visibleWidth(hint) + 2 : 0);
        var label = ansi.truncate(item.label, Math.max(4, labelWidth));

        var body = isActive ? style.accent(style.bold(label)) : label;
        var gap = width - 4 - ansi.visibleWidth(label) - ansi.visibleWidth(hint);

        lines.push('  ' + marker + body + ansi.repeat(' ', Math.max(1, gap)) + style.muted(hint));
    }

    if (items.length > visible) {
        var above = offset;
        var below = items.length - offset - visible;
        var note = (above > 0 ? glyph.up + above + ' ' : '') + (below > 0 ? glyph.down + below : '');
        lines.push('  ' + style.muted(ansi.truncate('  ' + (selected + 1) + '/' + items.length + '  ' + note, width - 4)));
    }

    return lines;
}

// Поле ввода с мигающим курсором-блоком
function field(label, value, focused) {
    var caret = focused ? style.accent(glyph.caret) : ' ';
    return style.muted(label) + '  ' + style.bold(value) + caret;
}

// Обработка клавиш редактирования строки
function editText(value, event) {
    if (event.mouse) return null;

    if (event.name === 'backspace') {
        return Array.from(value).slice(0, -1).join('');
    }

    if (event.ctrl && event.name === 'u') return '';

    if (event.ctrl && event.name === 'w') {
        return value.replace(/\s*\S+\s*$/, '');
    }

    if (event.str && !event.ctrl && !event.meta && event.str >= ' ' && event.str !== '\x7f') {
        return value + event.str;
    }

    return null;
}

// Анимация ожидания
async function withSpinner(promise, renderFrame) {
    var frames = ansi.ascii
        ? ['|', '/', '-', '\\']
        : ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    var index = 0;
    var finished = false;

    var timer = setInterval(function () {
        if (finished) return;
        paint(renderFrame(frames[index++ % frames.length]));
    }, 90);

    paint(renderFrame(frames[0]));

    try {
        return await promise;
    } finally {
        finished = true;
        clearInterval(timer);
    }
}

module.exports = {
    enter: enter,
    exit: exit,
    size: size,
    paint: paint,
    readKey: readKey,
    box: box,
    list: list,
    field: field,
    editText: editText,
    withSpinner: withSpinner,
    redraw: redraw,
    setResizeHandler: function (handler) { resizeHandler = handler; }
};
