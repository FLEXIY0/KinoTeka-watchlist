// Тесты API. Запуск: npm test
// Данные пишутся во временную папку, реальная коллекция не затрагивается.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kinoteka-test-'));
process.env.KINOTEKA_DATA_DIR = dataDir;

const { start } = require('../server');

let server;
let base;

before(async () => {
    server = await start(0, '127.0.0.1');
    await new Promise((resolve) => server.listening ? resolve() : server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

function api(method, url, body) {
    return fetch(base + url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined
    });
}

test('главная страница открывается, старый index1.html перенаправляется', async () => {
    const home = await fetch(base + '/');
    assert.equal(home.status, 200);

    const old = await fetch(base + '/index1.html', { redirect: 'manual' });
    assert.equal(old.status, 301);
    assert.equal(old.headers.get('location'), '/index.html');
});

test('создание, чтение, обновление и удаление фильма', async () => {
    const created = await (await api('POST', '/api/films', { title: 'Сталкер', rating: 9 })).json();
    assert.ok(created.id);
    assert.equal(created.title, 'Сталкер');

    const updated = await (await api('PUT', `/api/films/${created.id}`, { year: '1979' })).json();
    assert.equal(updated.year, '1979');
    assert.equal(updated.title, 'Сталкер');

    const film = await (await api('GET', `/api/films/${created.id}`)).json();
    assert.equal(film.year, '1979');

    const list = await (await api('GET', '/api/films')).json();
    assert.ok(list.some((f) => String(f.id) === String(created.id)));

    assert.equal((await api('DELETE', `/api/films/${created.id}`)).status, 200);
    assert.equal((await api('GET', `/api/films/${created.id}`)).status, 404);
});

test('одновременное создание фильмов даёт разные ID', async () => {
    const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => api('POST', '/api/films', { title: `Фильм ${i}` }).then((r) => r.json()))
    );
    const ids = new Set(results.map((r) => r.id));
    assert.equal(ids.size, 10);
});

test('обновление несуществующего фильма возвращает 404 и не создаёт папку', async () => {
    const res = await api('PUT', '/api/films/999999', { title: 'x' });
    assert.equal(res.status, 404);
    assert.equal(fs.existsSync(path.join(dataDir, 'films_and_serials', '999999')), false);
});

test('ID вида ../ отклоняется и ничего не удаляет', async () => {
    const victim = fs.mkdtempSync(path.join(dataDir, 'victim-'));
    const target = encodeURIComponent(`../${path.basename(victim)}`);

    const res = await fetch(`${base}/api/films/${target}`, { method: 'DELETE' });
    assert.equal(res.status, 400);
    assert.ok(fs.existsSync(victim));
});

test('ошибка скачивания картинки не роняет сервер', async () => {
    const created = await (await api('POST', '/api/films', { title: 'Картинка' })).json();

    const bad = await api('POST', `/api/films/${created.id}/download-image`, {
        url: 'http://127.0.0.1:1/nope.png',
        type: 'banner'
    });
    assert.equal(bad.status, 500);

    const fileUrl = await api('POST', `/api/films/${created.id}/download-image`, {
        url: 'file:///etc/passwd',
        type: 'banner'
    });
    assert.equal(fileUrl.status, 500);

    assert.equal((await api('GET', '/api/films')).status, 200);
});

test('скачивание картинки идёт по относительному редиректу', async () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    const imageServer = http.createServer((req, res) => {
        if (req.url === '/start') {
            res.writeHead(302, { Location: '/image.png' });
            return res.end();
        }
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(png);
    });
    await new Promise((resolve) => imageServer.listen(0, '127.0.0.1', resolve));

    try {
        const created = await (await api('POST', '/api/films', { title: 'Редирект' })).json();
        const res = await api('POST', `/api/films/${created.id}/download-image`, {
            url: `http://127.0.0.1:${imageServer.address().port}/start`,
            type: 'banner'
        });
        const body = await res.json();
        assert.equal(res.status, 200, body.error);
        assert.equal(body.path, `films_and_serials/${created.id}/banner/banner.webp`);

        const served = await fetch(`${base}/${body.path}`);
        assert.equal(served.status, 200);
        assert.deepEqual(Buffer.from(await served.arrayBuffer()), png);
    } finally {
        imageServer.close();
    }
});

test('загрузка принимает только картинки', async () => {
    const created = await (await api('POST', '/api/films', { title: 'Загрузка' })).json();

    const htmlForm = new FormData();
    htmlForm.append('file', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'evil.html');
    const rejected = await fetch(`${base}/api/films/${created.id}/upload/banner`, { method: 'POST', body: htmlForm });
    assert.equal(rejected.status, 400);

    const imageForm = new FormData();
    imageForm.append('file', new Blob([Buffer.from('89504e47', 'hex')], { type: 'image/png' }), 'poster.png');
    const accepted = await fetch(`${base}/api/films/${created.id}/upload/preview/2`, { method: 'POST', body: imageForm });
    const body = await accepted.json();
    assert.equal(accepted.status, 200, body.error);
    assert.equal(body.path, `films_and_serials/${created.id}/preview/preview2/preview.png`);

    const badPreview = await fetch(`${base}/api/films/${created.id}/upload/preview/7`, { method: 'POST', body: imageForm });
    assert.equal(badPreview.status, 400);
});

test('категории: добавление, дубликат, удаление', async () => {
    const added = await api('POST', '/api/categories', { name: 'Фантастика' });
    assert.equal(added.status, 200);

    const duplicate = await api('POST', '/api/categories', { name: 'фантастика' });
    assert.equal(duplicate.status, 409);

    const removed = await (await api('DELETE', `/api/categories/${encodeURIComponent('Фантастика')}`)).json();
    assert.equal(removed.categories.length, 0);
});

test('настройки темы сохраняются и читаются', async () => {
    assert.equal((await api('POST', '/api/settings', { theme: { accentColor: '#ff0000' } })).status, 200);
    const settings = await (await api('GET', '/api/settings')).json();
    assert.equal(settings.theme.accentColor, '#ff0000');
});
