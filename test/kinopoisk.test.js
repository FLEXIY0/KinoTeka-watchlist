// Тесты интеграции с Кинопоиском: ключ, поиск, импорт карточки.
// Вместо настоящего API поднимается локальный фальшивый сервер.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kinoteka-kp-'));
process.env.KINOTEKA_DATA_DIR = path.join(tmp, 'data');
process.env.XDG_CONFIG_HOME = path.join(tmp, 'config');
process.env.KINOPOISK_API_KEY = '';
process.env.KINOTEKA_NO_LAUNCH = '1';
fs.mkdirSync(process.env.KINOTEKA_DATA_DIR, { recursive: true });

const GOOD_KEY = '11111111-2222-3333-4444-555555555555';
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
let detailsRequests = 0;

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
    if (req.headers['x-api-key'] !== GOOD_KEY) return json(401, { message: 'bad key' });

    const base = `http://127.0.0.1:${fakeKinopoisk.address().port}`;
    let m;
    if (url.pathname === '/api/v2.1/films/search-by-keyword') {
        return json(200, {
            films: [
                { filmId: 301, nameRu: 'Матрица', nameEn: 'The Matrix', type: 'FILM', year: '1999', rating: '8.5', description: 'Хакер Нео', posterUrlPreview: `${base}/img/p301.jpg`, genres: [{ genre: 'фантастика' }], countries: [{ country: 'США' }] },
                { filmId: 404900, nameRu: 'Во все тяжкие', type: 'TV_SERIES', year: '2008', rating: '9.0', posterUrlPreview: null }
            ]
        });
    }
    if ((m = url.pathname.match(/^\/api\/v2\.2\/films\/(\d+)$/))) {
        detailsRequests++;
        if (m[1] === '999') return json(404, {});
        const serial = m[1] === '404900';
        return json(200, {
            kinopoiskId: Number(m[1]),
            nameRu: serial ? 'Во все тяжкие' : 'Матрица',
            year: serial ? 2008 : 1999,
            type: serial ? 'TV_SERIES' : 'FILM',
            serial,
            description: 'Описание',
            ratingKinopoisk: 8.5,
            ratingImdb: 8.7,
            ratingKinopoiskVoteCount: 1234567,
            filmLength: 136,
            ratingAgeLimits: 'age16',
            slogan: 'Добро пожаловать',
            imdbId: 'tt0133093',
            countries: [{ country: 'США' }],
            genres: [{ genre: 'фантастика' }, { genre: 'боевик' }],
            posterUrl: `${base}/img/poster.jpg`
        });
    }
    if (url.pathname === '/api/v1/staff') {
        return json(200, [
            { nameRu: 'Лана Вачовски', professionKey: 'DIRECTOR' },
            { nameRu: 'Киану Ривз', professionKey: 'ACTOR' },
            { nameRu: 'Кэрри-Энн Мосс', professionKey: 'ACTOR' }
        ]);
    }
    if (/\/images$/.test(url.pathname)) {
        return json(200, { items: [{ imageUrl: `${base}/img/s1.jpg` }, { imageUrl: `${base}/img/s2.jpg` }] });
    }
    if (/\/box_office$/.test(url.pathname)) {
        return json(200, { items: [{ type: 'BUDGET', amount: 63000000 }] });
    }
    if (/\/facts$/.test(url.pathname)) {
        return json(200, { items: [{ type: 'FACT', text: 'Факт 1' }, { type: 'BLOOPER', text: 'Ляп' }] });
    }
    json(404, {});
});

let server;
let base;

before(async () => {
    await new Promise((resolve) => fakeKinopoisk.listen(0, '127.0.0.1', resolve));
    process.env.KINOPOISK_API_BASE = `http://127.0.0.1:${fakeKinopoisk.address().port}`;

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

function api(method, url, body) {
    return fetch(base + url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined
    });
}

test('без ключа поиск сообщает, где его взять', async () => {
    const status = await (await api('GET', '/api/kinopoisk/key')).json();
    assert.equal(status.hasKey, false);
    assert.match(status.keySite, /kinopoiskapiunofficial/);

    const res = await api('GET', '/api/kinopoisk/search?q=матрица');
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'no-key');
});

test('ключ проверяется и сохраняется в общий конфиг с ktw', async () => {
    const badFormat = await api('POST', '/api/kinopoisk/key', { key: 'матрица' });
    assert.equal(badFormat.status, 400);

    const rejected = await api('POST', '/api/kinopoisk/key', { key: '99999999-2222-3333-4444-555555555555' });
    assert.equal(rejected.status, 401);

    const ok = await api('POST', '/api/kinopoisk/key', { key: ` ${GOOD_KEY} ` });
    assert.equal(ok.status, 200);

    const saved = JSON.parse(fs.readFileSync(path.join(process.env.XDG_CONFIG_HOME, 'ktw', 'config.json'), 'utf8'));
    assert.equal(saved.kinopoiskApiKey, GOOD_KEY);
    assert.equal((await (await api('GET', '/api/kinopoisk/key')).json()).hasKey, true);
});

test('поиск возвращает карточки с постером, описанием и рейтингом', async () => {
    const { results } = await (await api('GET', '/api/kinopoisk/search?q=матрица')).json();
    assert.equal(results.length, 2);
    assert.deepEqual(
        { kpId: results[0].kpId, title: results[0].title, year: results[0].year, type: results[0].type, rating: results[0].rating, description: results[0].description, filmId: results[0].filmId },
        { kpId: 301, title: 'Матрица', year: '1999', type: 'movie', rating: '8.5', description: 'Хакер Нео', filmId: null }
    );
    assert.equal(results[1].type, 'series');
});

test('импорт заполняет карточку целиком и скачивает картинки', async () => {
    const res = await api('POST', '/api/kinopoisk/import', { kpId: 301 });
    const body = await res.json();
    assert.equal(res.status, 200, body.error);
    assert.equal(body.created, true);

    const film = body.film;
    assert.equal(film.title, 'Матрица');
    assert.equal(film.kinopoiskId, '301');
    assert.equal(film.year, '1999');
    assert.equal(film.country, 'США');
    assert.equal(film.director, 'Лана Вачовски');
    assert.equal(film.cast, 'Киану Ривз, Кэрри-Энн Мосс');
    assert.equal(film.contentType, 'movie');
    assert.equal(film.kinopoiskRating, '8.5');
    assert.equal(film.duration, '2ч 16мин');
    assert.equal(film.ageRating, '16+');
    assert.equal(film.budget, '$63.0 млн');
    assert.equal(film.interestingFacts, 'Факт 1');
    assert.equal(film.bannerUrl, `films_and_serials/${film.id}/banner/banner.jpg`);
    assert.equal(film.previewUrls[0], `films_and_serials/${film.id}/preview/preview1/preview.jpg`);
    assert.equal(film.previewUrls[2], null);

    const poster = await fetch(`${base}/${film.bannerUrl}`);
    assert.equal(poster.status, 200);

    const { results } = await (await api('GET', '/api/kinopoisk/search?q=матрица')).json();
    assert.equal(String(results[0].filmId), String(film.id));
});

test('повторный и одновременный импорт не создают дубликатов', async () => {
    const again = await (await api('POST', '/api/kinopoisk/import', { kpId: 301 })).json();
    assert.equal(again.created, false);

    const before = detailsRequests;
    const parallel = await Promise.all([1, 2, 3].map(() => api('POST', '/api/kinopoisk/import', { kpId: 404900, watchStatus: 'in-progress' }).then((r) => r.json())));
    assert.equal(new Set(parallel.map((p) => String(p.film.id))).size, 1);
    assert.equal(detailsRequests - before, 1);
    assert.equal(parallel[0].film.contentType, 'series');
    assert.equal(parallel[0].film.watchStatus, 'in-progress');

    const films = await (await api('GET', '/api/films')).json();
    assert.equal(films.filter((f) => f.kinopoiskId === '404900').length, 1);
});

test('импорт несуществующего фильма — 404 без пустой карточки', async () => {
    const countBefore = (await (await api('GET', '/api/films')).json()).length;
    const res = await api('POST', '/api/kinopoisk/import', { kpId: 999 });
    assert.equal(res.status, 404);
    assert.equal((await (await api('GET', '/api/films')).json()).length, countBefore);
});

test('сырые запросы edit-film идут только по белому списку', async () => {
    const ok = await api('GET', '/api/kinopoisk/raw/api/v1/staff?filmId=301');
    assert.equal(ok.status, 200);

    const forbidden = await api('GET', '/api/kinopoisk/raw/api/v1/some/other');
    assert.equal(forbidden.status, 400);
});

test('запуск ktw принимает только числовой id', async () => {
    assert.equal((await api('POST', '/api/ktw/watch', { kpId: '301; rm -rf /' })).status, 400);
    const ok = await (await api('POST', '/api/ktw/watch', { kpId: 301 })).json();
    assert.equal(ok.dryRun, true);
});

test('API отвечает только на localhost', async () => {
    const res = await new Promise((resolve) => {
        http.get({ host: '127.0.0.1', port: server.address().port, path: '/api/films', headers: { Host: 'evil.example:3000' } }, resolve);
    });
    assert.equal(res.statusCode, 403);
    res.resume();
});

test('категории подбираются из жанров среди существующих, новые не создаются', async () => {
    await api('POST', '/api/categories', { name: 'Фантастика' });
    await api('POST', '/api/categories', { name: 'Боевики' });
    const before = (await (await api('GET', '/api/categories')).json()).length;

    const { film } = await (await api('POST', '/api/kinopoisk/import', { kpId: 555 })).json();
    assert.equal(film.mainCategory, 'Фантастика');
    assert.deepEqual(film.subCategories, ['Боевики']);
    assert.equal((await (await api('GET', '/api/categories')).json()).length, before);

    const match = await (await api('POST', '/api/categories/match', { genres: ['документальный', 'боевик'] })).json();
    assert.deepEqual(match, { mainCategory: 'Боевики', subCategories: [] });
});
