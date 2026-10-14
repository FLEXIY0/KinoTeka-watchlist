'use strict';

// Коллекция 16 тем оформления и адаптивный ANSI/ASCII генератор на 26 шрифтах.

var ansi = require('./ansi');
var figlet;
try {
    figlet = require('figlet');
} catch (e) {
    figlet = null;
}

var BUILTIN_LOGOS = {
    lineart: {
        full: [
            '┌─┐ ┬ ┌┐┌ ┌─┐ ┌┬┐ ┌─┐ ┬┌─ ┌─┐',
            '├┴┐ │ │││ │ │  │  ├┤  ├┴┐ ├─┤',
            '┴ ┴ ┴ ┘└┘ └─┘  ┴  └─┘ ┴ ┴ ┴ ┴'
        ],
        short: [
            '┌─┐ ┌┬┐ ┬ ┬',
            '├┴┐  │  │││',
            '┴ ┴  ┴  └┴┘'
        ]
    },
    monument: {
        full: [
            '██   ██  ██  ███    ██   ██████   ████████  ████████  ██   ██   █████  ',
            '██  ██   ██  ████   ██  ██    ██     ██     ██        ██  ██   ██   ██ ',
            '█████    ██  ██ ██  ██  ██    ██     ██     ██████    █████    ███████ ',
            '██  ██   ██  ██  ██ ██  ██    ██     ██     ██        ██  ██   ██   ██ ',
            '██   ██  ██  ██   ████   ██████      ██     ████████  ██   ██  ██   ██ '
        ],
        short: [
            '██   ██  ████████  ██      ██',
            '██  ██      ██     ██  ██  ██',
            '█████       ██     ██  ██  ██',
            '██  ██      ██     ██  ██  ██',
            '██   ██     ██      ███  ███ '
        ]
    },
    cyber: {
        full: [
            '╦╔═ ╦ ╔╗╔ ╔═╗ ╔╦╗ ╔═╗ ╦╔═ ╔═╗',
            '╠╩╗ ║ ║║║ ║ ║  ║  ║╣  ╠╩╗ ╠═╣',
            '╩ ╩ ╩ ╝╚╝ ╚═╝  ╩  ╚═╝ ╩ ╩ ╩ ╩'
        ],
        short: [
            '╦╔═ ╔╦╗ ╦ ╦',
            '╠╩╗  ║  ║║║',
            '╩ ╩  ╩  ╚╩╝'
        ]
    }
};

var FIGLET_FONT_MAP = {
    ansi_shadow: 'ANSI Shadow',
    slant: 'Slant',
    doom: 'Doom',
    standard: 'Standard',
    big: 'Big',
    small: 'Small',
    graffiti: 'Graffiti',
    sub_zero: 'Sub-Zero',
    speed: 'Speed',
    ghost: 'Ghost',
    larry3d: 'Larry 3D',
    ogre: 'Ogre',
    rectangles: 'Rectangles',
    delta_corps: 'Delta Corps Priest 1',
    cybermedium: 'Cybermedium',
    calvin_s: 'Calvin S',
    epic: 'Epic',
    elite: 'Elite',
    modular: 'Modular',
    '3d_ascii': '3D-ASCII',
    '3x5': '3x5',
    alligator: 'Alligator'
};

var FONT_KEYS = [
    'ansi_shadow',
    'slant',
    'doom',
    'standard',
    'big',
    'small',
    'graffiti',
    'sub_zero',
    'speed',
    'ghost',
    'larry3d',
    'ogre',
    'rectangles',
    'delta_corps',
    'cybermedium',
    'calvin_s',
    'epic',
    'elite',
    'modular',
    '3d_ascii',
    '3x5',
    'alligator',
    'lineart',
    'monument',
    'cyber',
    'off'
];

var FONT_LABELS = {
    ansi_shadow: 'ANSI Shadow (3D Блоки)',
    slant: 'Slant (Наклонный 3D)',
    doom: 'Doom (Игровой Doom)',
    standard: 'Standard (ASCII)',
    big: 'Big (Крупный жирный)',
    small: 'Small (Компактный)',
    graffiti: 'Graffiti (Стрит-арт)',
    sub_zero: 'Sub-Zero (Кибер-изометрик)',
    speed: 'Speed (Скоростной)',
    ghost: 'Ghost (Призрачный 3D)',
    larry3d: 'Larry 3D (3D Ретро)',
    ogre: 'Ogre (Готический)',
    rectangles: 'Rectangles (Блоки)',
    delta_corps: 'Delta Corps (Sci-Fi)',
    cybermedium: 'Cybermedium (Киберпанк)',
    calvin_s: 'Calvin S (Мини 3D)',
    epic: 'Epic (Эпичный)',
    elite: 'Elite (Скрипт)',
    modular: 'Modular (Модульный)',
    '3d_ascii': '3D-ASCII (Каркасный 3D)',
    '3x5': '3x5 (Микро)',
    alligator: 'Alligator (Сегментный)',
    lineart: 'Line-Art (Тонкие рамки)',
    monument: 'Monument (Монолит)',
    cyber: 'Cyber (Двойной контур)',
    off: 'Выключить (без баннера)'
};

var THEMES = {
    classic: {
        id: 'classic',
        name: 'Classic Monochrome',
        tagline: 'Строгий ч/б минимализм с янтарными акцентами #e8975f',
        logoStyle: 'ansi_shadow',
        colors: {
            accent: [255, 255, 255],       // Белый (название, поиск, логотип, заголовки)
            secondary: [215, 215, 215],   // Светло-серый
            highlight: [232, 151, 95],    // #e8975f янтарно-оранжевый
            muted: [120, 120, 120],       // Приглушенный серый
            border: [110, 110, 110],      // Рамки ч/б
            good: [232, 151, 95],         // #e8975f оранжевый (Direct ⚡ [прямой], прогресс)
            warn: [232, 151, 95],         // #e8975f оранжевый (качество 1080p, рейтинг ★)
            bad: [200, 90, 90],
            titleBg: [15, 15, 15],
            cardBg: [0, 0, 0]
        },
        glyphs: {
            tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│',
            arrow: '>', caret: '█', dot: '·', up: '^', down: 'v', star: '★'
        }
    },
    classic_bw: {
        id: 'classic_bw',
        name: 'Classic Monochrome',
        tagline: 'Строгий ч/б минимализм с янтарными акцентами #e8975f',
        logoStyle: 'ansi_shadow',
        colors: {
            accent: [255, 255, 255],       // Белый (название, поиск, логотип, заголовки)
            secondary: [215, 215, 215],   // Светло-серый
            highlight: [232, 151, 95],    // #e8975f янтарно-оранжевый
            muted: [120, 120, 120],       // Приглушенный серый
            border: [110, 110, 110],      // Рамки ч/б
            good: [232, 151, 95],         // #e8975f оранжевый (Direct ⚡ [прямой], прогресс)
            warn: [232, 151, 95],         // #e8975f оранжевый (качество 1080p, рейтинг ★)
            bad: [200, 90, 90],
            titleBg: [15, 15, 15],
            cardBg: [0, 0, 0]
        },
        glyphs: {
            tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│',
            arrow: '>', caret: '█', dot: '·', up: '^', down: 'v', star: '★'
        }
    },
    cyberpunk: {
        id: 'cyberpunk',
        name: 'Neon Cyberpunk',
        tagline: 'Электрический циан и неоновый пурпур',
        logoStyle: 'ansi_shadow',
        colors: {
            accent: [0, 240, 255],
            secondary: [255, 0, 127],
            highlight: [157, 0, 255],
            muted: [90, 105, 135],
            border: [110, 0, 200],
            good: [0, 255, 160],
            warn: [255, 215, 0],
            bad: [255, 45, 85],
            titleBg: [30, 10, 48],
            cardBg: [12, 10, 22]
        },
        glyphs: {
            tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║',
            arrow: '▶', caret: '▋', dot: '◆', up: '▲', down: '▼', star: '★'
        }
    },
    cinema: {
        id: 'cinema',
        name: 'Cinema Noir & Gold',
        tagline: 'Обсидиан и бархатное теплое золото',
        logoStyle: 'ansi_shadow',
        colors: {
            accent: [245, 185, 65],
            secondary: [255, 220, 130],
            highlight: [255, 140, 50],
            muted: [130, 125, 120],
            border: [160, 120, 45],
            good: [130, 210, 130],
            warn: [255, 190, 60],
            bad: [220, 80, 80],
            titleBg: [28, 22, 15],
            cardBg: [15, 14, 16]
        },
        glyphs: {
            tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│',
            arrow: '❯', caret: '▎', dot: '·', up: '↑', down: '↓', star: '★'
        }
    },
    matrix: {
        id: 'matrix',
        name: 'Matrix Hacker',
        tagline: 'Фосфорный монохром и изумрудная консоль',
        logoStyle: 'ansi_shadow',
        colors: {
            accent: [0, 255, 110],
            secondary: [140, 255, 180],
            highlight: [0, 200, 80],
            muted: [45, 115, 65],
            border: [0, 160, 65],
            good: [50, 255, 140],
            warn: [200, 255, 50],
            bad: [255, 70, 70],
            titleBg: [5, 22, 10],
            cardBg: [2, 12, 5]
        },
        glyphs: {
            tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│',
            arrow: '»', caret: '█', dot: '▪', up: '▲', down: '▼', star: '★'
        }
    },
    dracula: {
        id: 'dracula',
        name: 'Dracula Vampire',
        tagline: 'Фиолетовый неон, фуксия и циан',
        logoStyle: 'ansi_shadow',
        colors: {
            accent: [189, 147, 249],
            secondary: [255, 121, 198],
            highlight: [139, 233, 253],
            muted: [98, 114, 164],
            border: [110, 80, 180],
            good: [80, 250, 123],
            warn: [241, 250, 140],
            bad: [255, 85, 85],
            titleBg: [40, 42, 54],
            cardBg: [25, 26, 36]
        },
        glyphs: {
            tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│',
            arrow: '›', caret: '█', dot: '•', up: '▲', down: '▼', star: '★'
        }
    },
    tokyo: {
        id: 'tokyo',
        name: 'Tokyo Night',
        tagline: 'Глубокий индиго, лаванда и лазурь',
        logoStyle: 'ansi_shadow',
        colors: {
            accent: [122, 162, 247],
            secondary: [187, 154, 247],
            highlight: [125, 207, 255],
            muted: [86, 95, 137],
            border: [61, 89, 161],
            good: [158, 206, 106],
            warn: [224, 175, 104],
            bad: [247, 118, 142],
            titleBg: [26, 27, 38],
            cardBg: [18, 19, 28]
        },
        glyphs: {
            tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│',
            arrow: '❯', caret: '▋', dot: '·', up: '↑', down: '↓', star: '★'
        }
    },
    synthwave: {
        id: 'synthwave',
        name: 'Synthwave 84',
        tagline: 'Закатный градиент 80-х: маджента и апельсин',
        logoStyle: 'ansi_shadow',
        colors: {
            accent: [255, 75, 160],
            secondary: [254, 154, 46],
            highlight: [255, 230, 109],
            muted: [120, 80, 130],
            border: [180, 40, 120],
            good: [114, 241, 184],
            warn: [254, 218, 106],
            bad: [254, 68, 68],
            titleBg: [38, 20, 48],
            cardBg: [22, 10, 30]
        },
        glyphs: {
            tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║',
            arrow: '▶', caret: '█', dot: '◆', up: '▲', down: '▼', star: '★'
        }
    },
    nordic: {
        id: 'nordic',
        name: 'Nordic Frost',
        tagline: 'Арктический синий и белый ледник',
        logoStyle: 'ansi_shadow',
        colors: {
            accent: [136, 192, 208],
            secondary: [129, 161, 193],
            highlight: [236, 239, 244],
            muted: [94, 129, 172],
            border: [76, 86, 106],
            good: [163, 190, 140],
            warn: [235, 203, 139],
            bad: [191, 97, 106],
            titleBg: [46, 52, 64],
            cardBg: [36, 41, 51]
        },
        glyphs: {
            tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│',
            arrow: '›', caret: '▌', dot: '·', up: '↑', down: '↓', star: '★'
        }
    },
    monokai: {
        id: 'monokai',
        name: 'Monokai Pro',
        tagline: 'Сочный желтый, фуксия и зеленый нефрит',
        logoStyle: 'ansi_shadow',
        colors: {
            accent: [255, 216, 102],
            secondary: [255, 97, 136],
            highlight: [120, 220, 232],
            muted: [114, 112, 114],
            border: [147, 146, 147],
            good: [169, 220, 105],
            warn: [252, 152, 103],
            bad: [255, 97, 136],
            titleBg: [45, 42, 46],
            cardBg: [34, 31, 34]
        },
        glyphs: {
            tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│',
            arrow: '❯', caret: '█', dot: '·', up: '▲', down: '▼', star: '★'
        }
    },
    gruvbox: {
        id: 'gruvbox',
        name: 'Gruvbox Dark',
        tagline: 'Теплый ретро-терракот, охра и песок',
        logoStyle: 'ansi_shadow',
        colors: {
            accent: [250, 189, 47],
            secondary: [254, 128, 25],
            highlight: [235, 219, 178],
            muted: [146, 131, 116],
            border: [102, 92, 84],
            good: [184, 187, 38],
            warn: [250, 189, 47],
            bad: [251, 73, 52],
            titleBg: [40, 40, 40],
            cardBg: [29, 32, 33]
        },
        glyphs: {
            tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│',
            arrow: '>', caret: '▌', dot: '·', up: '^', down: 'v', star: '★'
        }
    },
    catppuccin: {
        id: 'catppuccin',
        name: 'Catppuccin Mocha',
        tagline: 'Мягкий пастельный мокко, лаванда и персик',
        logoStyle: 'ansi_shadow',
        colors: {
            accent: [203, 166, 247],
            secondary: [245, 194, 231],
            highlight: [137, 220, 235],
            muted: [108, 112, 134],
            border: [88, 91, 112],
            good: [166, 227, 161],
            warn: [249, 226, 175],
            bad: [243, 139, 168],
            titleBg: [30, 30, 46],
            cardBg: [24, 24, 37]
        },
        glyphs: {
            tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│',
            arrow: '›', caret: '█', dot: '·', up: '↑', down: '↓', star: '★'
        }
    },
    blood: {
        id: 'blood',
        name: 'Blood Moon',
        tagline: 'Кровавый рубин, алый огонь и угли',
        logoStyle: 'ansi_shadow',
        colors: {
            accent: [255, 45, 75],
            secondary: [255, 110, 50],
            highlight: [255, 200, 180],
            muted: [125, 60, 70],
            border: [160, 30, 45],
            good: [255, 150, 100],
            warn: [255, 190, 50],
            bad: [255, 20, 40],
            titleBg: [35, 10, 15],
            cardBg: [20, 5, 8]
        },
        glyphs: {
            tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│',
            arrow: '▶', caret: '█', dot: '◆', up: '▲', down: '▼', star: '★'
        }
    },
    emerald: {
        id: 'emerald',
        name: 'Emerald Jade',
        tagline: 'Глубокий хвойный нефрит и мятная свежесть',
        logoStyle: 'ansi_shadow',
        colors: {
            accent: [46, 213, 115],
            secondary: [85, 239, 196],
            highlight: [200, 255, 230],
            muted: [50, 110, 85],
            border: [30, 130, 80],
            good: [46, 213, 115],
            warn: [254, 211, 48],
            bad: [255, 71, 87],
            titleBg: [10, 32, 20],
            cardBg: [5, 18, 12]
        },
        glyphs: {
            tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│',
            arrow: '❯', caret: '▌', dot: '·', up: '↑', down: '↓', star: '★'
        }
    },
    solarized: {
        id: 'solarized',
        name: 'Solarized Dark',
        tagline: 'Глубокий морской циан и солнечный янтарь',
        logoStyle: 'ansi_shadow',
        colors: {
            accent: [42, 161, 152],
            secondary: [181, 137, 0],
            highlight: [147, 161, 161],
            muted: [88, 110, 117],
            border: [7, 54, 66],
            good: [133, 153, 0],
            warn: [181, 137, 0],
            bad: [220, 50, 47],
            titleBg: [0, 43, 54],
            cardBg: [0, 27, 34]
        },
        glyphs: {
            tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│',
            arrow: '>', caret: '█', dot: '·', up: '^', down: 'v', star: '★'
        }
    },
    sunset: {
        id: 'sunset',
        name: 'Miami Sunset',
        tagline: 'Майами: тропический коралл и пурпурные сумерки',
        logoStyle: 'ansi_shadow',
        colors: {
            accent: [255, 107, 107],
            secondary: [165, 94, 234],
            highlight: [254, 211, 48],
            muted: [120, 85, 125],
            border: [170, 70, 160],
            good: [38, 222, 129],
            warn: [254, 211, 48],
            bad: [235, 59, 90],
            titleBg: [32, 15, 38],
            cardBg: [18, 8, 22]
        },
        glyphs: {
            tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│',
            arrow: '❯', caret: '▋', dot: '·', up: '↑', down: '↓', star: '★'
        }
    },
    monument: {
        id: 'monument',
        name: 'Monument Dark',
        tagline: 'Монументальные блоки, глубокий графит',
        logoStyle: 'ansi_shadow',
        colors: {
            accent: [235, 240, 245],
            secondary: [160, 175, 190],
            highlight: [255, 255, 255],
            muted: [100, 110, 125],
            border: [70, 80, 95],
            good: [180, 220, 190],
            warn: [220, 200, 150],
            bad: [200, 110, 110],
            titleBg: [20, 24, 30],
            cardBg: [12, 15, 20]
        },
        glyphs: {
            tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│',
            arrow: '■', caret: '▌', dot: '·', up: '▲', down: '▼', star: '★'
        }
    }
};

// Генерация цветного ANSI логотипа с адаптивным масштабированием
function renderLogo(themeId, bannerStyle, maxWidth, bannerSize) {
    if (bannerStyle === 'off') {
        return [];
    }

    var theme = THEMES[themeId] || THEMES.cyberpunk;
    var styleKey = (bannerStyle && bannerStyle !== 'auto') ? bannerStyle : (theme.logoStyle || 'ansi_shadow');
    var maxW = (maxWidth && maxWidth > 20) ? (maxWidth - 2) : 80;
    var sizeMode = bannerSize || 'auto';

    var rawLines = null;

    // Вспомогательная функция для получения строк через figlet
    function getFigletRaw(text, fontKey) {
        if (!figlet) return null;
        var fontName = FIGLET_FONT_MAP[fontKey];
        if (!fontName) return null;
        try {
            var gen = figlet.textSync(text, { font: fontName });
            if (!gen) return null;
            var arr = gen.split('\n').filter(function (l) { return l.length > 0; });
            return arr.length > 0 ? arr : null;
        } catch (e) {
            return null;
        }
    }

    // 1. Если это figlet шрифт
    if (FIGLET_FONT_MAP[styleKey]) {
        if (sizeMode === 'compact') {
            rawLines = getFigletRaw('KTW', styleKey);
        } else if (sizeMode === 'mini') {
            rawLines = getFigletRaw('ktw', 'calvin_s') || getFigletRaw('ktw', 'small') || getFigletRaw('ktw', styleKey);
        } else if (sizeMode === 'full') {
            rawLines = getFigletRaw('KINOTEKA', styleKey);
        } else {
            // Режим 'auto': проверяем, помещается ли полное слово KINOTEKA
            var fullCandidate = getFigletRaw('KINOTEKA', styleKey);
            if (fullCandidate) {
                var candidateW = Math.max.apply(null, fullCandidate.map(function (l) { return l.length; }));
                if (candidateW <= maxW) {
                    rawLines = fullCandidate;
                } else {
                    rawLines = getFigletRaw('KTW', styleKey);
                }
            }
        }
    }

    // 2. Если это встроенный шрифт
    if (!rawLines && BUILTIN_LOGOS[styleKey]) {
        var bObj = BUILTIN_LOGOS[styleKey];
        if (sizeMode === 'compact' || sizeMode === 'mini') {
            rawLines = bObj.short || bObj.full;
        } else if (sizeMode === 'full') {
            rawLines = bObj.full;
        } else {
            var bFullW = Math.max.apply(null, bObj.full.map(function (l) { return l.length; }));
            rawLines = (bFullW <= maxW) ? bObj.full : (bObj.short || bObj.full);
        }
    }

    // Фоллбэк
    if (!rawLines) {
        rawLines = getFigletRaw('KTW', 'ansi_shadow') || BUILTIN_LOGOS.lineart.full;
    }

    // 3. Обрезаем строки, если они всё же превышают maxW (гарантия неломания рамок)
    var safeLines = rawLines.map(function (l) {
        return l.length > maxW ? l.slice(0, maxW) : l;
    });

    var c1 = theme.colors.accent;
    var c2 = theme.colors.secondary || theme.colors.highlight;

    // Раскрашиваем горизонтальным градиентом
    var rendered = [];
    safeLines.forEach(function (line) {
        var len = line.length;
        var coloredLine = '';
        for (var i = 0; i < len; i++) {
            var ratio = len > 1 ? (i / (len - 1)) : 0;
            var r = Math.round(c1[0] + ratio * (c2[0] - c1[0]));
            var g = Math.round(c1[1] + ratio * (c2[1] - c1[1]));
            var b = Math.round(c1[2] + ratio * (c2[2] - c1[2]));
            coloredLine += ansi.fg(r, g, b) + line[i];
        }
        coloredLine += ansi.style.reset;
        rendered.push(coloredLine);
    });

    return rendered;
}

module.exports = {
    BUILTIN_LOGOS: BUILTIN_LOGOS,
    FIGLET_FONT_MAP: FIGLET_FONT_MAP,
    FONT_KEYS: FONT_KEYS,
    FONT_LABELS: FONT_LABELS,
    THEMES: THEMES,
    renderLogo: renderLogo
};
