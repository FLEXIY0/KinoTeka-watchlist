'use strict';

// Подмена сети для сквозного теста: ktw запускается настоящей командой, но
// вместо балансеров отвечают записанные фикстуры. Подключается через
// bun --preload, поэтому подмена встаёт до первого запроса.

var fs = require('fs');
var path = require('path');

var DIR = __dirname;

function fixture(name) {
    return fs.readFileSync(path.join(DIR, name), 'utf8');
}

var PLAYERS = JSON.stringify({
    data: [
        {
            type: 'Collaps',
            iframeUrl: 'https://api.ortified.ws/embed/movie/474',
            quality: '1080p',
            translations: []
        }
    ]
});

globalThis.fetch = async function (url) {
    var target = String(url);

    if (target.indexOf('/api/players') >= 0) return new Response(PLAYERS, { status: 200 });
    if (target.indexOf('/embed/movie/') >= 0) return new Response(fixture('collaps-movie.html'), { status: 200 });
    if (target.indexOf('master.m3u8') >= 0) return new Response(fixture('collaps-master.m3u8'), { status: 200 });

    return new Response('не подменён: ' + target, { status: 599 });
};
