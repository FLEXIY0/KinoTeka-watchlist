// Тесты синхронизации истории ktw с коллекцией.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kinoteka-sync-'));
const configDir = path.join(tmp, 'config', 'ktw');
process.env.KINOTEKA_QUIET = '1';
process.env.KINOTEKA_DATA_DIR = path.join(tmp, 'data');
process.env.XDG_CONFIG_HOME = path.join(tmp, 'config');
process.env.KINOPOISK_API_KEY = '';
process.env.KINOTEKA_NO_SYNC = '1'; // синхронизацию запускаем вручную
fs.mkdirSync(process.env.KINOTEKA_DATA_DIR, { recursive: true });
fs.mkdirSync(configDir, { recursive: true });

const KEY = '11111111-2222-3333-4444-555555555555';
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const limited = new Set(); // id, на которых фальшивый Кинопоиск отвечает «лимит исчерпан»
const titles = { 301: 'Матрица', 404900: 'Во все тяжкие', 42664: 'Матрица: Перезагрузка', 777: 'Лимитный фильм', 888: 'Без ключа' };

const fakeKinopoisk = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
    };
    if (url.pathname.startsWith('/img/')) {
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        return res.end(PNG);
    }
    if (req.headers['x-api-key'] !== KEY) return json(401, {});
    const m = url.pathname.match(/^\/api\/v2\.2\/films\/(\d+)$/);
    if (m) {
        if (limited.has(m[1])) return json(429, {});
        const serial = m[1] === '404900';
        return json(200, {
            kinopoiskId: Number(m[1]),
            nameRu: titles[m[1]] || `Фильм ${m[1]}`,
            year: 2000,
            type: serial ? 'TV_SERIES' : 'FILM',
            serial,
            description: 'Описание с Кинопоиска',
            ratingKinopoisk: 8,
            posterUrl: `http://127.0.0.1:${fakeKinopoisk.address().port}/img/${m[1]}.jpg`
        });
    }
    if (url.pathname === '/api/v1/staff') return json(200, [{ nameRu: 'Режиссёр', professionKey: 'DIRECTOR' }]);
    json(404, {});
});

let server;
let base;

function writeHistory(items, watchedEpisodes = {}) {
    fs.writeFileSync(path.join(configDir, 'history.json'), JSON.stringify({ items, watchedEpisodes }));
}

function writeOpened(items) {
    fs.writeFileSync(path.join(configDir, 'opened.json'), JSON.stringify({ items }));
}

function setKey(key) {
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ kinopoiskApiKey: key }));
}

const api = (method, url, body) => fetch(base + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
});

async function sync() {
    const res = await api('POST', '/api/ktw/sync');
    const body = await res.json();
    assert.equal(res.status, 200, body.error);
    return body;
}

async function films() {
    return (await api('GET', '/api/films')).json();
}

async function byKp(kpId) {
    return (await films()).find((f) => String(f.kinopoiskId) === String(kpId) || String(f.kinopoiskUrl || '').includes(`/${kpId}/`));
}

before(async () => {
    await new Promise((resolve) => fakeKinopoisk.listen(0, '127.0.0.1', resolve));
    process.env.KINOPOISK_API_BASE = `http://127.0.0.1:${fakeKinopoisk.address().port}`;
    setKey(KEY);

    const { start } = require('../server');
    server = await start(0, '127.0.0.1');
    await new Promise((resolve) => server.listening ? resolve() : server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
    server.close();
    fakeKinopoisk.close();
    fs.rmSync(tmp, { recursive: true, force: true });
});

test('начатый сериал и досмотренный фильм попадают в коллекцию, открытый — во временные', async () => {
    const now = Date.now();
    writeHistory([
        { filmId: '404900', title: 'Во все тяжкие', serial: true, season: 2, episode: 3, timePos: 120, duration: 2700, percentage: 4, updatedAt: now },
        { filmId: '301', title: 'Матрица', serial: false, timePos: 7000, duration: 8000, percentage: 88, watched: true, userRating: 9, updatedAt: now - 1000 },
        { filmId: '42664', title: 'Матрица: Перезагрузка', serial: false, timePos: 0, duration: 0, percentage: 0, updatedAt: now - 2000 }
    ], { 404900: ['1_1', '1_2'] });
    writeOpened([{ filmId: '555', title: 'Только открыл', year: '2020', serial: false, poster: '', openedAt: now - 500 }]);

    const stats = await sync();
    assert.equal(stats.added, 2);

    const series = await byKp(404900);
    assert.equal(series.contentType, 'series');
    assert.equal(series.watchStatus, 'in-progress');
    assert.equal(series.lastEpisode, 'С2:Э3');
    assert.equal(series.filmDescription, 'Описание с Кинопоиска');
    assert.equal(series.source, 'ktw');

    const movie = await byKp(301);
    assert.equal(movie.watchStatus, 'watched');
    assert.equal(movie.rating, 9);

    assert.equal(await byKp(42664), undefined);

    const { items } = await (await api('GET', '/api/ktw/recent')).json();
    assert.deepEqual(items.map((i) => i.kpId), ['555', '42664']);
});

test('повторная синхронизация без новых событий ничего не дублирует', async () => {
    const countBefore = (await films()).length;
    const stats = await sync();
    assert.equal(stats.added, 0);
    assert.equal((await films()).length, countBefore);
});

test('новая серия обновляет «последнюю серию», статус не понижается', async () => {
    const movie = await byKp(301);
    await api('PUT', `/api/films/${movie.id}`, { personalReview: 'моя рецензия' });

    const now = Date.now() + 10000;
    writeHistory([
        { filmId: '404900', title: 'Во все тяжкие', serial: true, season: 2, episode: 4, timePos: 60, percentage: 2, updatedAt: now },
        // пересматривает уже просмотренный фильм — статус «Просмотрен» остаётся
        { filmId: '301', title: 'Матрица', serial: false, timePos: 100, percentage: 1, updatedAt: now }
    ], { 404900: ['1_1', '1_2', '2_3'] });

    await sync();
    assert.equal((await byKp(404900)).lastEpisode, 'С2:Э4');
    const after = await byKp(301);
    assert.equal(after.watchStatus, 'watched');
    assert.equal(after.personalReview, 'моя рецензия');
});

test('то, что вылетело из истории ktw, остаётся в коллекции', async () => {
    writeHistory([], {});
    await sync();
    assert.ok(await byKp(404900));
    assert.ok(await byKp(301));
});

test('при исчерпанном лимите фильм откладывается и не теряется после вылета из истории', async () => {
    limited.add('777');
    writeHistory([{ filmId: '777', title: 'Лимитный фильм', serial: false, timePos: 500, percentage: 10, updatedAt: Date.now() + 20000 }]);
    const first = await sync();
    assert.equal(first.pending, 1);
    assert.equal(await byKp(777), undefined);

    // ktw вытеснил запись, лимит восстановился
    writeHistory([]);
    limited.delete('777');
    const second = await sync();
    assert.equal(second.pending, 0);
    const film = await byKp(777);
    assert.equal(film.watchStatus, 'in-progress');
    assert.equal(film.title, 'Лимитный фильм');
});

test('без ключа создаётся короткая карточка из данных ktw', async () => {
    setKey('');
    try {
        writeHistory([{ filmId: '888', title: 'Без ключа', year: '1999', serial: false, poster: `${process.env.KINOPOISK_API_BASE}/img/888.jpg`, timePos: 10, percentage: 90, updatedAt: Date.now() + 30000 }]);
        await sync();
        const film = await byKp(888);
        assert.equal(film.title, 'Без ключа');
        assert.equal(film.year, '1999');
        assert.equal(film.watchStatus, 'watched');
        assert.equal(film.bannerUrl, `films_and_serials/${film.id}/banner/banner.jpg`);
    } finally {
        setKey(KEY);
    }
});

test('карточка, добавленная вручную со ссылкой на Кинопоиск, обновляется, а не дублируется', async () => {
    const manual = await (await api('POST', '/api/films', {
        title: 'Добавлен руками',
        kinopoiskUrl: 'https://www.kinopoisk.ru/film/1234/',
        watchStatus: 'watching'
    })).json();

    writeHistory([{ filmId: '1234', title: 'Добавлен руками', serial: false, timePos: 300, percentage: 20, updatedAt: Date.now() + 40000 }]);
    await sync();

    const list = (await films()).filter((f) => String(f.kinopoiskUrl || '').includes('/1234/') || f.kinopoiskId === '1234');
    assert.equal(list.length, 1);
    assert.equal(String(list[0].id), String(manual.id));
    assert.equal(list[0].watchStatus, 'in-progress');
});

test('временный список можно почистить, и в нём нет того, что уже в коллекции', async () => {
    const res = await api('DELETE', '/api/ktw/recent/555');
    assert.equal(res.status, 200);
    const { items } = await (await api('GET', '/api/ktw/recent')).json();
    assert.ok(!items.some((i) => i.kpId === '555'));
    assert.ok(!items.some((i) => i.kpId === '301'));
});

test('карточка, открытая в ktw, попадает во временный список', async () => {
    const history = require('../ktw/lib/history');
    history.markOpened({ id: 9999, title: 'Открыл в ktw', year: 2024, serial: true, poster: '', description: 'Описание', rating: 7.1, genres: ['драма'] });

    await sync();
    const { items } = await (await api('GET', '/api/ktw/recent')).json();
    const item = items.find((i) => i.kpId === '9999');
    assert.ok(item);
    assert.equal(item.title, 'Открыл в ktw');
    assert.equal(item.type, 'series');
    assert.equal(item.description, 'Описание');
    assert.equal(await byKp(9999), undefined);
});

test('история для строки «продолжить»: только начатое, новое сверху, со ссылкой на карточку', async () => {
    const now = Date.now() + 100000;
    writeHistory([
        { filmId: '301', title: 'Матрица', serial: false, timePos: 3600, duration: 8000, percentage: 45, updatedAt: now - 5000 },
        { filmId: '404900', title: 'Во все тяжкие', serial: true, season: 3, episode: 1, timePos: 10, percentage: 1, updatedAt: now },
        { filmId: '42664', title: 'Только открыл', serial: false, timePos: 0, percentage: 0, updatedAt: now + 1 },
        { filmId: '888', title: 'Без ключа', serial: false, timePos: 7000, duration: 7200, percentage: 97, watched: true, updatedAt: now - 9000 }
    ], { 404900: ['3_1'] });

    const { items } = await (await api('GET', '/api/ktw/history')).json();
    assert.deepEqual(items.map((i) => i.kpId), ['404900', '301', '888']);
    assert.equal(items[0].season, 3);
    assert.equal(items[0].episode, 1);
    assert.ok(items[0].filmId);
    assert.equal(items[1].finished, false);
    assert.equal(items[2].finished, true);
});

test('продолжение в ktw передаёт серию и --resume, мусор отклоняет', async () => {
    process.env.KINOTEKA_NO_LAUNCH = '1';
    const ok = await (await api('POST', '/api/ktw/watch', { kpId: 404900, season: 3, episode: 1, resume: true })).json();
    assert.deepEqual(ok.args, ['watch', '404900', '-s', '3', '-e', '1', '--resume']);

    const bad = await api('POST', '/api/ktw/watch', { kpId: 404900, season: '3 & calc', episode: 1 });
    assert.equal(bad.status, 400);
});
