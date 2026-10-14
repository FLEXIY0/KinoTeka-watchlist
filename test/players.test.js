// Тесты списка плееров для страницы просмотра: уровни страховки и живой рейтинг.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kinoteka-players-'));
process.env.KINOTEKA_QUIET = '1';
process.env.KINOTEKA_DATA_DIR = path.join(tmp, 'data');
process.env.XDG_CONFIG_HOME = path.join(tmp, 'config');
process.env.KINOPOISK_API_KEY = '';
process.env.KINOTEKA_NO_SYNC = '1';
fs.mkdirSync(process.env.KINOTEKA_DATA_DIR, { recursive: true });

// Что сейчас отвечают фальшивые источники
const fake = { kinobox: 'ok', kinoboxPlayers: [], cvhItems: [], collaps: true, titleQueries: [] };

const sources = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
    };
    if (url.pathname === '/kinobox') {
        if (url.searchParams.get('title')) {
            fake.titleQueries.push(url.searchParams.get('title'));
            return json(200, { data: [{ type: 'Collaps', iframeUrl: 'https://collaps/by-title' }] });
        }
        if (fake.kinobox === 'down') return json(500, {});
        return json(200, { data: fake.kinoboxPlayers });
    }
    if (url.pathname === '/cvh') return json(200, { items: fake.cvhItems });
    if (url.pathname.startsWith('/collaps/')) {
        if (!fake.collaps) return json(404, {});
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end('<html>' + 'x'.repeat(2000) + '</html>');
    }
    json(404, {});
});

let server;
let base;

before(async () => {
    await new Promise((resolve) => sources.listen(0, '127.0.0.1', resolve));
    const src = `http://127.0.0.1:${sources.address().port}`;
    process.env.KINOTEKA_KINOBOX_MIRRORS = `${src}/kinobox`;
    process.env.KINOTEKA_CVH_PLAYLIST = `${src}/cvh?id=`;
    process.env.KINOTEKA_COLLAPS_MIRRORS = `${src}/collaps/`;

    const { start } = require('../server');
    server = await start(0, '127.0.0.1');
    await new Promise((resolve) => server.listening ? resolve() : server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
    server.close();
    sources.close();
    fs.rmSync(tmp, { recursive: true, force: true });
});

let nextId = 1000;
beforeEach(() => {
    Object.assign(fake, { kinobox: 'ok', kinoboxPlayers: [], cvhItems: [], collaps: true, titleQueries: [] });
});

// Каждый тест — новый id, чтобы не мешал кэш списков
async function playersFor(id = nextId++) {
    const res = await fetch(`${base}/api/players?kinopoisk=${id}`);
    return { status: res.status, body: await res.json() };
}

const types = (body) => body.data.map((p) => p.type);

test('kinobox + свой плеер CDNVideoHub: Collaps, CDNVideoHub, Kodik … Alloha последним', async () => {
    fake.kinoboxPlayers = [{ type: 'Alloha', iframeUrl: 'a' }, { type: 'Turbo', iframeUrl: 't' }, { type: 'Kodik', iframeUrl: 'k' }, { type: 'Collaps', iframeUrl: 'c' }];
    fake.cvhItems = [{ vkId: '1', voiceStudio: 'Гоблин' }, { vkId: '2', voiceType: 'Дубляж' }, { vkId: '3', voiceStudio: 'Гоблин' }];

    const id = nextId++;
    const { body } = await playersFor(id);
    assert.deepEqual(types(body), ['Collaps', 'CDNVideoHub', 'CDNVideoHub', 'Kodik', 'Turbo', 'Alloha']);

    // Каждая озвучка CDNVideoHub — свой пункт меню
    const [goblin, dub] = body.data.slice(1, 3);
    assert.equal(goblin.iframeUrl, `${base}/play.html?kp=${id}&voice=%D0%93%D0%BE%D0%B1%D0%BB%D0%B8%D0%BD`);
    assert.deepEqual([goblin.voice, dub.voice], ['Гоблин', 'Дубляж']);
    assert.deepEqual(goblin.translations.map((t) => t.name), ['Гоблин · CDNVideoHub']);
});

test('озвучки kinobox-плееров — отдельные пункты меню, порядок плееров сохраняется', async () => {
    fake.kinoboxPlayers = [
        { type: 'Alloha', iframeUrl: 'a', translations: [
            { name: 'LostFilm', quality: 'WEB-DL', iframeUrl: 'a?t=1' },
            { name: 'TVShows', quality: 'WEB-DL', iframeUrl: 'a?t=2' }
        ] },
        { type: 'Collaps', iframeUrl: 'c', translations: [{ name: 'Пифагор', iframeUrl: 'c?t=1' }, { name: 'Без ссылки' }] },
        { type: 'Turbo', iframeUrl: 't', translations: [{ name: null, iframeUrl: 't' }] }
    ];
    const { body } = await playersFor();
    assert.deepEqual(body.data.map((p) => [p.type, p.iframeUrl, p.voice]), [
        ['Collaps', 'c?t=1', 'Пифагор'],
        ['Turbo', 't', undefined],
        ['Alloha', 'a?t=1', 'LostFilm'],
        ['Alloha', 'a?t=2', 'TVShows']
    ]);
    assert.equal(body.data[2].translations[0].quality, 'WEB-DL');
});

test('kinobox не дал Collaps — добавляется прямой Collaps', async () => {
    fake.kinoboxPlayers = [{ type: 'Alloha', iframeUrl: 'a' }];
    const { body } = await playersFor();
    assert.deepEqual(types(body), ['Collaps', 'Alloha']);
    assert.match(body.data[0].iframeUrl, /\/collaps\/\d+$/);
});

test('kinobox лежит — список собирается из прямых источников', async () => {
    fake.kinobox = 'down';
    fake.cvhItems = [{ vkId: '9', voiceType: 'Дубляж' }];
    const { status, body } = await playersFor();
    assert.equal(status, 200);
    assert.deepEqual(types(body), ['Collaps', 'CDNVideoHub']);
});

test('по id ничего нет — ищем по названию', async () => {
    fake.kinoboxPlayers = [];
    fake.collaps = false;
    const film = await (await fetch(`${base}/api/films`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Редкий фильм', kinopoiskId: '777777' })
    })).json();
    assert.ok(film.id);

    const { status, body } = await playersFor(777777);
    assert.equal(status, 200);
    assert.deepEqual(fake.titleQueries, ['Редкий фильм']);
    assert.equal(body.data[0].iframeUrl, 'https://collaps/by-title');
});

test('ничего нигде нет — понятная ошибка, а не пустой виджет', async () => {
    fake.collaps = false;
    const { status, body } = await playersFor();
    assert.equal(status, 502);
    assert.match(body.error.title, /не найдены/);
});

test('живой рейтинг: плеер, с которого уходят, опускается, а рабочий поднимается', async () => {
    fake.kinoboxPlayers = [{ type: 'Kodik', iframeUrl: 'k' }, { type: 'Collaps', iframeUrl: 'c' }];
    const send = (type, ok) => fetch(`${base}/api/players/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, ok })
    });

    const id = nextId++;
    assert.deepEqual(types((await playersFor(id)).body), ['Collaps', 'Kodik']);

    for (let i = 0; i < 3; i++) await send('Collaps', false);
    assert.deepEqual(types((await playersFor(id)).body), ['Kodik', 'Collaps']);

    for (let i = 0; i < 4; i++) await send('Collaps', true);
    assert.deepEqual(types((await playersFor(id)).body), ['Collaps', 'Kodik']);
});
