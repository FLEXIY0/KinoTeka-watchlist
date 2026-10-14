const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');
const kinopoisk = require('./lib/kinopoisk');
const { createKtwSync } = require('./lib/ktw-sync');
const { matchCategories } = require('./lib/categories');
const ktwHistory = require('./ktw/lib/history');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
// По умолчанию слушаем только localhost, чтобы API не было доступно из сети.
// Для доступа с других устройств: HOST=0.0.0.0 npm start
const HOST = process.env.HOST || '127.0.0.1';

// Папка с данными пользователя. По умолчанию — папка приложения,
// но её можно вынести отдельно: KINOTEKA_DATA_DIR=D:\\Kinoteka npm start
const DATA_DIR = path.resolve(process.env.KINOTEKA_DATA_DIR || __dirname);
const FILMS_DIR = path.join(DATA_DIR, 'films_and_serials');
const CATEGORIES_DIR = path.join(DATA_DIR, 'ALL_CATEGORIES');
const CATEGORIES_FILE = path.join(CATEGORIES_DIR, 'categories.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp'];
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20 МБ

// Middleware

// API доступно только по адресу localhost: сервер умеет сохранять ключ и
// запускать ktw, и чужой сайт не должен дотянуться до него через подмену DNS.
// Если сервер открыт в сеть (HOST=0.0.0.0), проверка отключается.
app.use('/api', (req, res, next) => {
    if (HOST !== '127.0.0.1' && HOST !== 'localhost') return next();
    const hostname = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    if (['localhost', '127.0.0.1', '::1'].includes(hostname)) return next();
    res.status(403).json({ error: 'Forbidden host', success: false });
});

app.use(express.json({ limit: '10mb' }));
app.use('/films_and_serials', express.static(FILMS_DIR)); // Картинки фильмов из папки данных
app.use(express.static(__dirname)); // Обслуживание статических файлов (не зависит от текущей папки)

// ID карточки — только число, иначе через ../ можно добраться до любой папки на диске
app.param('id', (req, res, next, id) => {
    if (!/^\d+$/.test(id)) {
        return res.status(400).json({ error: 'Invalid film id', success: false });
    }
    next();
});

app.param('previewNumber', (req, res, next, previewNumber) => {
    if (!['1', '2', '3'].includes(previewNumber)) {
        return res.status(400).json({ error: 'Invalid preview number', success: false });
    }
    next();
});

// Создание директории для фильмов если её нет
async function ensureDir(dir) {
    try {
        await fs.access(dir);
    } catch {
        await fs.mkdir(dir, { recursive: true });
    }
}

// Путь к файлу для браузера: относительно папки данных и всегда через "/"
function toPublicPath(filePath) {
    return path.relative(DATA_DIR, filePath).split(path.sep).join('/');
}

// Запись JSON через временный файл: если процесс упадёт посреди записи,
// старый файл останется целым, а не превратится в обрезанный JSON
async function writeJsonAtomic(file, data) {
    const tmp = `${file}.${process.pid}.tmp`;
    const json = JSON.stringify(data, null, 2);
    await fs.writeFile(tmp, json);
    try {
        await fs.rename(tmp, file);
    } catch (error) {
        // На Windows антивирус или индексатор иногда держат файл и rename падает
        if (error.code !== 'EPERM' && error.code !== 'EACCES' && error.code !== 'EBUSY') throw error;
        await fs.writeFile(file, json);
        await fs.unlink(tmp).catch(() => {});
    }
}

// Простая очередь: операции, переданные сюда, выполняются строго по одной.
// Нужна, чтобы два одновременных запроса не получили один и тот же ID
// и не перезаписали изменения друг друга.
let writeQueue = Promise.resolve();
function serialized(fn) {
    const run = writeQueue.then(fn, fn);
    writeQueue = run.catch(() => {});
    return run;
}

// Вспомогательная функция для удаления всех файлов в папке
async function clearDirectory(dir) {
    try {
        const files = await fs.readdir(dir);
        await Promise.all(files.map(file => fs.unlink(path.join(dir, file))));
    } catch (error) {
        // Папка не существует или пуста
    }
}

// Настройка multer для загрузки баннера
const bannerStorage = multer.diskStorage({
    destination: async (req, file, cb) => {
        try {
            const { id } = req.params;
            const uploadPath = path.join(FILMS_DIR, id, 'banner');
            await ensureDir(uploadPath);
            // Удаляем старые файлы
            await clearDirectory(uploadPath);
            cb(null, uploadPath);
        } catch (error) {
            cb(error);
        }
    },
    filename: (req, file, cb) => {
        // Используем фиксированное имя с оригинальным расширением
        cb(null, 'banner' + path.extname(file.originalname));
    }
});

// Настройка multer для загрузки превью
const previewStorage = multer.diskStorage({
    destination: async (req, file, cb) => {
        try {
            const { id, previewNumber } = req.params;
            const uploadPath = path.join(FILMS_DIR, id, 'preview', `preview${previewNumber}`);
            await ensureDir(uploadPath);
            // Удаляем старые файлы в этой подпапке
            await clearDirectory(uploadPath);
            cb(null, uploadPath);
        } catch (error) {
            cb(error);
        }
    },
    filename: (req, file, cb) => {
        // Используем фиксированное имя с оригинальным расширением
        cb(null, 'preview' + path.extname(file.originalname));
    }
});

// Принимаем только картинки: иначе можно было бы загрузить, например, .html,
// и он открывался бы с того же адреса, что и само приложение
function imageFileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.mimetype.startsWith('image/') && IMAGE_EXTENSIONS.includes(ext)) {
        cb(null, true);
    } else {
        const error = new Error('Можно загружать только изображения');
        error.status = 400;
        cb(error);
    }
}

const uploadOptions = { fileFilter: imageFileFilter, limits: { fileSize: MAX_IMAGE_SIZE } };
const uploadBanner = multer({ storage: bannerStorage, ...uploadOptions });
const uploadPreview = multer({ storage: previewStorage, ...uploadOptions });

// Получить следующий доступный ID
async function getNextId() {
    await ensureDir(FILMS_DIR);
    const files = await fs.readdir(FILMS_DIR);
    const ids = files
        .filter(f => /^\d+$/.test(f))
        .map(f => parseInt(f, 10))
        .filter(n => !isNaN(n));
    return ids.length > 0 ? Math.max(...ids) + 1 : 1;
}

// Все карточки коллекции
async function listFilms() {
    await ensureDir(FILMS_DIR);
    const files = await fs.readdir(FILMS_DIR);
    const filmIds = files.filter(f => /^\d+$/.test(f));

    return Promise.all(
        filmIds.map(async (id) => {
            try {
                const dataPath = path.join(FILMS_DIR, id, 'data.json');
                const data = await fs.readFile(dataPath, 'utf8');
                return { id, ...JSON.parse(data) };
            } catch {
                return { id, title: `Фильм ${id}`, rating: 0 };
            }
        })
    );
}

// API: Получить все карточки
app.get('/api/films', async (req, res) => {
    try {
        res.json(await listFilms());
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Получить конкретную карточку
app.get('/api/films/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const filmDir = path.join(FILMS_DIR, id);
        const dataPath = path.join(filmDir, 'data.json');
        
        const data = await fs.readFile(dataPath, 'utf8');
        const filmData = JSON.parse(data);
        
        // Получить пути к файлам
        const banner = await getFiles(path.join(filmDir, 'banner'));
        const preview1 = await getFiles(path.join(filmDir, 'preview', 'preview1'));
        const preview2 = await getFiles(path.join(filmDir, 'preview', 'preview2'));
        const preview3 = await getFiles(path.join(filmDir, 'preview', 'preview3'));
        
        res.json({
            id,
            ...filmData,
            banner: banner[0] || null,
            preview1: preview1[0] || null,
            preview2: preview2[0] || null,
            preview3: preview3[0] || null
        });
    } catch (error) {
        res.status(404).json({ error: 'Film not found' });
    }
});

// Вспомогательная функция для получения файлов
async function getFiles(dir) {
    try {
        const files = await fs.readdir(dir);
        return files.map(f => toPublicPath(path.join(dir, f)));
    } catch {
        return [];
    }
}

// Создать карточку. Известные поля получают значения по умолчанию,
// дополнительные (рейтинги, ссылки, kinopoiskId...) сохраняются как есть.
async function createFilm(fields = {}) {
    // ID выбирается и папка создаётся атомарно относительно других запросов
    const id = await serialized(async () => {
        const nextId = await getNextId();
        await fs.mkdir(path.join(FILMS_DIR, nextId.toString()));
        return nextId;
    });
    const filmDir = path.join(FILMS_DIR, id.toString());
    
    // Создать структуру папок
    await ensureDir(path.join(filmDir, 'banner'));
    await ensureDir(path.join(filmDir, 'preview', 'preview1'));
    await ensureDir(path.join(filmDir, 'preview', 'preview2'));
    await ensureDir(path.join(filmDir, 'preview', 'preview3'));
    
    // Создать базовый data.json
    const initialData = {
        ...fields,
        title: fields.title || `Фильм ${id}`,
        rating: fields.rating || 0,
        year: fields.year || '',
        country: fields.country || '',
        director: fields.director || '',
        cast: fields.cast || '',
        mainCategory: fields.mainCategory || '',
        subCategories: fields.subCategories || [],
        filmDescription: fields.filmDescription || '',
        personalReview: fields.personalReview || '',
        contentType: fields.contentType || '',
        watchStatus: fields.watchStatus || '',
        lastEpisode: fields.lastEpisode || '',
        createdAt: new Date().toISOString()
    };
    delete initialData.id;
    
    await writeJsonAtomic(path.join(filmDir, 'data.json'), initialData);
    
    // Создать HTML файл
    const htmlContent = await generateFilmHTML(id, initialData);
    await fs.writeFile(path.join(filmDir, 'index.html'), htmlContent);
    
    return { id, ...initialData };
}

// API: Создать новую карточку
app.post('/api/films', async (req, res) => {
    try {
        res.json(await createFilm(req.body));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Обновить карточку (слить поля). Возвращает null, если карточки нет.
async function updateFilm(id, patch) {
    id = String(id);
    const filmDir = path.join(FILMS_DIR, id);
    const dataPath = path.join(filmDir, 'data.json');

    try {
        await fs.access(filmDir);
    } catch {
        return null;
    }

    const updatedData = await serialized(async () => {
        // Читаем существующие данные
        let existingData = {};
        try {
            const data = await fs.readFile(dataPath, 'utf8');
            existingData = JSON.parse(data);
        } catch {}

        // Объединяем с новыми данными
        const merged = {
            ...existingData,
            ...patch,
            updatedAt: new Date().toISOString()
        };
        delete merged.id;

        await writeJsonAtomic(dataPath, merged);
        return merged;
    });

    return { id, ...updatedData };
}

// API: Обновить карточку
app.put('/api/films/:id', async (req, res) => {
    try {
        const film = await updateFilm(req.params.id, req.body);
        if (!film) {
            return res.status(404).json({ error: 'Film not found' });
        }
        res.json(film);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Загрузить баннер
app.post('/api/films/:id/upload/banner', uploadBanner.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'File is required', success: false });
        }
        const filePath = toPublicPath(req.file.path);
        res.json({ path: filePath, success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Загрузить превью (с номером: 1, 2, 3)
app.post('/api/films/:id/upload/preview/:previewNumber', uploadPreview.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'File is required', success: false });
        }
        const filePath = toPublicPath(req.file.path);
        res.json({ path: filePath, success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Функция для скачивания изображения из URL (с поддержкой редиректов)
function downloadImage(url, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        if (redirectCount > 5) {
            reject(new Error('Too many redirects'));
            return;
        }

        let parsed;
        try {
            parsed = new URL(url);
        } catch {
            reject(new Error(`Invalid URL: ${url}`));
            return;
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            reject(new Error(`Unsupported protocol: ${parsed.protocol}`));
            return;
        }

        const protocol = parsed.protocol === 'https:' ? https : http;

        const request = protocol.get(parsed, { headers: { 'User-Agent': 'Mozilla/5.0 KinoTeka' } }, (response) => {
            // Обработка редиректов (Location может быть относительным)
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                response.resume();
                const nextUrl = new URL(response.headers.location, parsed).toString();
                return downloadImage(nextUrl, redirectCount + 1)
                    .then(resolve)
                    .catch(reject);
            }

            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`Failed to download image: ${response.statusCode}`));
                return;
            }

            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => {
                const buffer = Buffer.concat(chunks);
                resolve(buffer);
            });
            response.on('error', reject);
        });

        request.setTimeout(15000, () => request.destroy(new Error('Download timeout')));
        request.on('error', reject);
    });
}

// Скачать картинку по ссылке в папку карточки (баннер или превью 1–3).
// Возвращает путь для браузера.
async function saveRemoteImage(id, type, index, url) {
    let uploadPath, baseName;
    if (type === 'banner') {
        uploadPath = path.join(FILMS_DIR, String(id), 'banner');
        baseName = 'banner';
    } else if (type === 'preview' && ['1', '2', '3'].includes(String(index))) {
        uploadPath = path.join(FILMS_DIR, String(id), 'preview', `preview${index}`);
        baseName = 'preview';
    } else {
        const error = new Error('Invalid type or index');
        error.status = 400;
        throw error;
    }

    const imageBuffer = await downloadImage(url);

    // Расширение берём из ссылки, если оно похоже на картинку
    let ext = '.webp';
    try {
        const fromUrl = path.extname(new URL(url).pathname).toLowerCase();
        if (IMAGE_EXTENSIONS.includes(fromUrl)) ext = fromUrl;
    } catch {}

    await ensureDir(uploadPath);
    await clearDirectory(uploadPath);
    const filePath = path.join(uploadPath, baseName + ext);
    await fs.writeFile(filePath, imageBuffer);
    return toPublicPath(filePath);
}

// API: Скачать изображение из URL и сохранить локально
app.post('/api/films/:id/download-image', async (req, res) => {
    const { id } = req.params;
    try {
        const { url, type, index } = req.body; // type: 'banner' или 'preview', index: 1,2,3 для превью

        if (!url) {
            return res.status(400).json({ error: 'URL is required', success: false });
        }

        console.log(`📥 [Film ${id}] Скачивание ${type}${index ? ` ${index}` : ''} из: ${url}`);
        const relativePath = await saveRemoteImage(id, type, index, url);
        console.log(`💾 [Film ${id}] Изображение сохранено: ${relativePath}`);

        res.json({ path: relativePath, success: true });
    } catch (error) {
        console.error(`❌ [Film ${id}] Ошибка скачивания изображения:`, error.message);
        res.status(error.status || 500).json({ error: error.message, success: false });
    }
});

// API: Удалить карточку
app.delete('/api/films/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const filmDir = path.join(FILMS_DIR, id);
        
        await fs.rm(filmDir, { recursive: true, force: true });
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Генерация HTML для карточки фильма
async function generateFilmHTML(id, data) {
    const title = escapeHtml(data.title);
    const rating = escapeHtml(data.rating);
    return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
</head>
<body>
    <h1>${title}</h1>
    <p>Рейтинг: ${rating}/10</p>
    <a href="../../edit-film.html?id=${id}">Открыть карточку</a>
    <br>
    <a href="../../index.html">На главную</a>
</body>
</html>`;
}

// === КАТЕГОРИИ ===

// Получить все категории
async function getAllCategories() {
    try {
        await ensureDir(CATEGORIES_DIR);
        const data = await fs.readFile(CATEGORIES_FILE, 'utf8');
        return JSON.parse(data);
    } catch {
        return [];
    }
}

// Сохранить категории
async function saveCategories(categories) {
    await ensureDir(CATEGORIES_DIR);
    await writeJsonAtomic(CATEGORIES_FILE, categories);
}

// API: Получить все категории
app.get('/api/categories', async (req, res) => {
    try {
        const categories = await getAllCategories();
        res.json(categories);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Добавить категорию
app.post('/api/categories', async (req, res) => {
    try {
        const { name, background, icon } = req.body;
        
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Название категории обязательно' });
        }
        
        const categories = await getAllCategories();
        const trimmedName = name.trim();
        
        // Проверка на дубликат (учитываем оба формата)
        const isDuplicate = categories.some(c => {
            const catName = typeof c === 'string' ? c : c.name;
            return catName.toLowerCase() === trimmedName.toLowerCase();
        });
        
        if (isDuplicate) {
            return res.status(409).json({ error: 'Категория уже существует' });
        }
        
        // Создаем объект категории (новый формат)
        const newCategory = {
            name: trimmedName,
            background: background || null,
            icon: icon || null
        };
        
        categories.push(newCategory);
        await saveCategories(categories);
        
        res.json({ success: true, category: newCategory, categories });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Подобрать категории коллекции под жанры (для страницы карточки)
app.post('/api/categories/match', async (req, res) => {
    try {
        const genres = Array.isArray(req.body && req.body.genres) ? req.body.genres.map(String) : [];
        res.json(matchCategories(genres, await getAllCategories()));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Обновить категорию
app.put('/api/categories/:name', async (req, res) => {
    try {
        const { name } = req.params;
        const decodedName = decodeURIComponent(name);
        const { background, icon } = req.body;
        
        const categories = await getAllCategories();
        
        // Находим и обновляем категорию
        const updatedCategories = categories.map(cat => {
            const catName = typeof cat === 'string' ? cat : cat.name;
            if (catName === decodedName) {
                // Обновляем категорию
                return {
                    name: catName,
                    background: background || null,
                    icon: icon || null
                };
            }
            return cat;
        });
        
        await saveCategories(updatedCategories);
        
        const updatedCategory = updatedCategories.find(c => {
            const catName = typeof c === 'string' ? c : c.name;
            return catName === decodedName;
        });
        
        res.json({ success: true, category: updatedCategory, categories: updatedCategories });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Удалить категорию
app.delete('/api/categories/:name', async (req, res) => {
    try {
        const { name } = req.params;
        const decodedName = decodeURIComponent(name);
        const categories = await getAllCategories();
        
        // Фильтруем с учетом обоих форматов (строки и объекты)
        const filtered = categories.filter(c => {
            const catName = typeof c === 'string' ? c : c.name;
            return catName !== decodedName;
        });
        
        await saveCategories(filtered);
        
        res.json({ success: true, categories: filtered });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// === КИНОПОИСК ===

function sendKinopoiskError(res, error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message, code: error.code || 'error', keySite: kinopoisk.KEY_SITE });
}

// Есть ли ключ (сам ключ браузеру не отдаём)
app.get('/api/kinopoisk/key', (req, res) => {
    res.json({ hasKey: Boolean(kinopoisk.getKey()), keySite: kinopoisk.KEY_SITE });
});

// Сохранить ключ: проверяется настоящим запросом к Кинопоиску
app.post('/api/kinopoisk/key', async (req, res) => {
    try {
        await kinopoisk.setKey(req.body && req.body.key);
        res.json({ success: true, hasKey: true });
    } catch (error) {
        sendKinopoiskError(res, error);
    }
});

// Поиск; к результатам добавляется id карточки, если фильм уже в коллекции
app.get('/api/kinopoisk/search', async (req, res) => {
    const query = String(req.query.q || '').trim();
    if (query.length < 2) return res.json({ results: [] });
    try {
        const [results, films] = await Promise.all([kinopoisk.search(query), listFilms()]);
        const byKpId = new Map(films.map((f) => [kinopoisk.kpIdOf(f), f]));
        res.json({
            results: results.map((r) => {
                const film = byKpId.get(String(r.kpId));
                return { ...r, filmId: film ? film.id : null, watchStatus: film ? film.watchStatus || '' : null };
            })
        });
    } catch (error) {
        sendKinopoiskError(res, error);
    }
});

// Сырые запросы для страницы редактирования (белый список путей)
app.get('/api/kinopoisk/raw/*', async (req, res) => {
    try {
        const query = req.originalUrl.split('?')[1];
        res.json(await kinopoisk.raw(req.params[0] + (query ? `?${query}` : '')));
    } catch (error) {
        sendKinopoiskError(res, error);
    }
});

async function findFilmByKpId(kpId) {
    const films = await listFilms();
    return films.find((f) => kinopoisk.kpIdOf(f) === String(kpId)) || null;
}

// Импорт карточки с Кинопоиска: все поля + постер и кадры локально.
// Повторный импорт того же фильма возвращает существующую карточку.
const importsInFlight = new Map();
function importFromKinopoisk(kpId, extra = {}, { light = false } = {}) {
    const key = String(kpId);
    if (importsInFlight.has(key)) return importsInFlight.get(key);

    const job = (async () => {
        const existing = await findFilmByKpId(key);
        if (existing) return { film: existing, created: false };

        const card = await kinopoisk.getFilmCard(key, { light });

        // Категории — из жанров, только среди уже существующих
        const categoryFields = {};
        if (!extra.mainCategory) {
            const matched = matchCategories(card.film.genres, await getAllCategories());
            if (matched.mainCategory) Object.assign(categoryFields, matched);
        }

        const film = await createFilm({ ...card.film, ...categoryFields, ...extra });

        const images = {};
        if (card.posterUrl) {
            images.bannerUrl = await saveRemoteImage(film.id, 'banner', null, card.posterUrl).catch(() => null);
        }
        const previews = await Promise.all(
            [0, 1, 2].map((i) => card.stillUrls[i]
                ? saveRemoteImage(film.id, 'preview', i + 1, card.stillUrls[i]).catch(() => null)
                : null)
        );
        images.previewUrls = previews;

        return { film: await updateFilm(film.id, images), created: true };
    })().finally(() => importsInFlight.delete(key));

    importsInFlight.set(key, job);
    return job;
}

app.post('/api/kinopoisk/import', async (req, res) => {
    const kpId = String((req.body && req.body.kpId) || '');
    if (!/^\d+$/.test(kpId)) {
        return res.status(400).json({ error: 'kpId is required', success: false });
    }
    const allowedStatus = ['watched', 'watching', 'in-progress'];
    const extra = {};
    if (allowedStatus.includes(req.body.watchStatus)) extra.watchStatus = req.body.watchStatus;

    try {
        const result = await importFromKinopoisk(kpId, extra);
        res.json({ success: true, ...result });
    } catch (error) {
        sendKinopoiskError(res, error);
    }
});

// === KTW (просмотр в терминале) ===

// Через общую точку входа: она же находит mpv на Windows
const KTW_SCRIPT = path.join(__dirname, 'scripts', 'kinoteka.js');

// Открыть ktw в новом окне терминала
function launchKtwWindow(args) {
    const node = process.execPath;
    const opts = { detached: true, stdio: 'ignore', cwd: __dirname };

    if (process.platform === 'win32') {
        // start открывает новое окно консоли (или Windows Terminal, если он по умолчанию)
        const cmdLine = `start "KinoTeka Watch" "${node}" "${KTW_SCRIPT}" ${args.join(' ')}`;
        spawn('cmd.exe', ['/d', '/s', '/c', `"${cmdLine}"`], { ...opts, windowsVerbatimArguments: true }).unref();
        return true;
    }

    const shellCmd = [node, KTW_SCRIPT, ...args].map((a) => `'${String(a).replace(/'/g, "'\\''")}'`).join(' ');
    if (process.platform === 'darwin') {
        const script = `tell application "Terminal" to do script "${shellCmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
        spawn('osascript', ['-e', script, '-e', 'tell application "Terminal" to activate'], opts).unref();
        return true;
    }

    // Linux: первый найденный эмулятор терминала
    const terminals = [
        ['x-terminal-emulator', ['-e', 'sh', '-c', shellCmd]],
        ['gnome-terminal', ['--', 'sh', '-c', shellCmd]],
        ['konsole', ['-e', 'sh', '-c', shellCmd]],
        ['xfce4-terminal', ['-x', 'sh', '-c', shellCmd]],
        ['xterm', ['-e', 'sh', '-c', shellCmd]]
    ];
    const pathDirs = String(process.env.PATH || '').split(path.delimiter);
    for (const [bin, binArgs] of terminals) {
        if (pathDirs.some((dir) => require('fs').existsSync(path.join(dir, bin)))) {
            spawn(bin, binArgs, opts).unref();
            return true;
        }
    }
    return false;
}

app.post('/api/ktw/watch', (req, res) => {
    const kpId = String((req.body && req.body.kpId) || '');
    if (!/^\d+$/.test(kpId)) {
        return res.status(400).json({ error: 'kpId is required', success: false });
    }
    // Продолжить с места: серия и сохранённая секунда из истории ktw
    const args = ['watch', kpId];
    const { season, episode, resume } = req.body;
    if (season !== undefined || episode !== undefined) {
        if (!/^\d+$/.test(String(season)) || !/^\d+$/.test(String(episode))) {
            return res.status(400).json({ error: 'Invalid season/episode', success: false });
        }
        args.push('-s', String(season), '-e', String(episode));
    }
    if (resume === true) args.push('--resume');

    if (process.env.KINOTEKA_NO_LAUNCH === '1') {
        return res.json({ success: true, launched: false, dryRun: true, args });
    }
    try {
        const launched = launchKtwWindow(args);
        if (!launched) {
            return res.status(501).json({ error: 'Не нашёл терминал. Запустите вручную: ktw ' + kpId, success: false });
        }
        res.json({ success: true, launched: true });
    } catch (error) {
        res.status(500).json({ error: error.message, success: false });
    }
});

// Синхронизация истории ktw с коллекцией
const ktwSync = createKtwSync({
    dataDir: DATA_DIR,
    listFilms,
    createFilm,
    updateFilm,
    importFromKinopoisk,
    saveRemoteImage,
    log: (message) => console.log(message)
});

// «Недавно открывали в ktw» — временный список, не попадающий в коллекцию
app.get('/api/ktw/recent', async (req, res) => {
    try {
        res.json({ items: await ktwSync.getRecent() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Последние просмотры в ktw — для строки «продолжить» на главной
app.get('/api/ktw/history', async (req, res) => {
    try {
        res.json({ items: await ktwSync.getHistory(6) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/ktw/recent/:kpId', async (req, res) => {
    if (!/^\d+$/.test(req.params.kpId)) {
        return res.status(400).json({ error: 'Invalid id', success: false });
    }
    try {
        await ktwSync.dismissRecent(req.params.kpId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Синхронизировать сейчас (сервер и сам следит за историей ktw)
app.post('/api/ktw/sync', async (req, res) => {
    const result = await ktwSync.syncNow();
    res.status(result && result.error ? 500 : 200).json({ success: !(result && result.error), ...result });
});

// === ПРОСМОТР В БРАУЗЕРЕ (watch.html) ===

// Список плееров для виджета kinobox идёт через сервер: api.kinobox.tv отвечает
// не отовсюду, поэтому перебираем зеркала (своё из настроек ktw — первым)
const ktwConfig = require('./ktw/lib/config');
const KINOBOX_MIRRORS = ['https://fbphdplay.top/api/players', 'https://api.kinobox.tv/api/players'];
const kinoboxCache = new Map();

// Виджет строит адрес от корня сайта: baseUrl + /api/players
app.get('/api/players', async (req, res) => {
    const query = req.originalUrl.split('?')[1] || '';
    if (!/^[\w=&%.-]*$/.test(query)) {
        return res.status(400).json({ error: 'Invalid query' });
    }

    const cached = kinoboxCache.get(query);
    if (cached && Date.now() - cached.at < 10 * 60 * 1000) return res.json(cached.data);

    const configured = ktwConfig.resolveKinoboxApi();
    const mirrors = configured ? [configured, ...KINOBOX_MIRRORS.filter((m) => m !== configured)] : KINOBOX_MIRRORS;
    let lastError = 'нет ответа';

    for (const mirror of mirrors) {
        try {
            const response = await fetch(`${mirror}${mirror.includes('?') ? '&' : '?'}${query}`, {
                headers: { Referer: 'https://kinobox.tv/', Origin: 'https://kinobox.tv' },
                signal: AbortSignal.timeout(10000)
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (data && Array.isArray(data.data) && data.data.length) {
                kinoboxCache.set(query, { at: Date.now(), data });
                return res.json(data);
            }
            lastError = 'пустой список плееров';
        } catch (error) {
            lastError = error.message;
        }
    }
    res.status(502).json({ error: { title: `Плееры не получены: ${lastError}` } });
});

// Что показать в шапке страницы просмотра: из коллекции, истории ktw или Кинопоиска
app.get('/api/watch/info/:kpId', async (req, res) => {
    const kpId = req.params.kpId;
    if (!/^\d+$/.test(kpId)) {
        return res.status(400).json({ error: 'Invalid id', success: false });
    }
    try {
        const info = { kpId, title: '', year: '', serial: false, poster: '', filmId: null, hasHistory: false };

        const film = await findFilmByKpId(kpId);
        if (film) {
            Object.assign(info, {
                title: film.title,
                year: film.year || '',
                serial: film.contentType === 'series',
                poster: film.bannerUrl ? '/' + film.bannerUrl : '',
                filmId: film.id
            });
        }

        const watched = ktwHistory.read().items.find((i) => String(i.filmId) === kpId);
        info.hasHistory = Boolean(watched && (watched.timePos > 0 || watched.watched));
        const fromHistory = watched || ktwHistory.readOpened().find((i) => String(i.filmId) === kpId);
        if (fromHistory && !info.title) {
            Object.assign(info, {
                title: fromHistory.title || '',
                year: fromHistory.year || '',
                serial: Boolean(fromHistory.serial),
                poster: fromHistory.poster || ''
            });
        }

        if (!info.title && kinopoisk.getKey()) {
            try {
                const details = await kinopoisk.raw(`api/v2.2/films/${kpId}`);
                Object.assign(info, {
                    title: details.nameRu || details.nameOriginal || details.nameEn || '',
                    year: details.year ? String(details.year) : '',
                    serial: Boolean(details.serial) || ['TV_SERIES', 'MINI_SERIES', 'TV_SHOW'].includes(details.type),
                    poster: details.posterUrlPreview || details.posterUrl || ''
                });
            } catch {}
        }

        res.json(info);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Прогресс из веб-плеера пишется в общую историю ktw: оттуда его берут
// строка «продолжить» и синхронизация с коллекцией
app.post('/api/watch/progress', (req, res) => {
    const b = req.body || {};
    const kpId = String(b.kpId || '');
    const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
    const season = num(b.season);
    const episode = num(b.episode);
    const timePos = num(b.timePos);
    const duration = num(b.duration);

    if (!/^\d+$/.test(kpId) || ![season, episode, timePos, duration].every((n) => Number.isFinite(n) && n >= 0)) {
        return res.status(400).json({ error: 'Invalid progress', success: false });
    }

    ktwHistory.saveProgress({
        filmId: kpId,
        title: String(b.title || '').slice(0, 300),
        year: String(b.year || '').slice(0, 10),
        poster: String(b.poster || '').slice(0, 1000),
        serial: Boolean(b.serial),
        season: season || null,
        episode: episode || null,
        timePos,
        duration,
        player: 'web' + (b.player ? ':' + String(b.player).slice(0, 40) : '')
    });
    res.json({ success: true });
});

// === НАСТРОЙКИ ТЕМЫ ===

app.get('/api/settings', async (req, res) => {
    try {
        const data = await fs.readFile(SETTINGS_FILE, 'utf8');
        res.json(JSON.parse(data));
    } catch {
        res.status(404).json({ error: 'Settings not found' });
    }
});

app.post('/api/settings', async (req, res) => {
    try {
        let existing = {};
        try {
            existing = JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf8'));
        } catch {}
        const updated = { ...existing, ...req.body };
        await writeJsonAtomic(SETTINGS_FILE, updated);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Маршрут для главной страницы
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Старый адрес главной страницы (index1.html переименован в index.html)
app.get('/index1.html', (req, res) => {
    res.redirect(301, '/index.html');
});

// Обработчик ошибок (например, от multer), чтобы сервер отвечал JSON, а не падал
app.use((err, req, res, next) => {
    // Ошибки multer (например, слишком большой файл) и наши с полем status — это ошибки клиента
    const status = err.status || (err instanceof multer.MulterError ? 400 : 500);
    console.error('❌ Ошибка запроса:', err.message);
    res.status(status).json({ error: err.message, success: false });
});

// Запуск сервера
async function start(port = PORT, host = HOST) {
    await ensureDir(FILMS_DIR);
    await ensureDir(CATEGORIES_DIR);

    if (process.env.KINOTEKA_NO_SYNC !== '1') {
        ktwSync.start();
    }

    const server = app.listen(port, host, () => {
        console.log(`Сервер запущен на http://localhost:${server.address().port}`);
        if (DATA_DIR !== __dirname) {
            console.log(`Папка данных: ${DATA_DIR}`);
        }
    });

    server.on('close', () => ktwSync.stop());

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`❌ Порт ${PORT} уже занят. Возможно, сервер уже запущен.`);
        } else {
            console.error('❌ Ошибка сервера:', err.message);
        }
        process.exit(1);
    });

    return server;
}

// При `node server.js` запускаем сервер; при require (в тестах) — только экспортируем
if (require.main === module) {
    start();
}

module.exports = { app, start, listFilms, createFilm, updateFilm, importFromKinopoisk, ktwSync };

