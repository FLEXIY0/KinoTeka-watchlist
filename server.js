const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const https = require('https');
const http = require('http');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
// По умолчанию слушаем только localhost, чтобы API не было доступно из сети.
// Для доступа с других устройств: HOST=0.0.0.0 npm start
const HOST = process.env.HOST || '127.0.0.1';

const FILMS_DIR = path.join(__dirname, 'films_and_serials');
const CATEGORIES_DIR = path.join(__dirname, 'ALL_CATEGORIES');
const CATEGORIES_FILE = path.join(CATEGORIES_DIR, 'categories.json');
const SETTINGS_FILE = path.join(__dirname, 'settings.json');

// Middleware
app.use(express.json({ limit: '10mb' }));
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

const uploadBanner = multer({ storage: bannerStorage });
const uploadPreview = multer({ storage: previewStorage });

// Получить следующий доступный ID
async function getNextId() {
    await ensureDir(FILMS_DIR);
    const files = await fs.readdir(FILMS_DIR);
    const ids = files
        .filter(f => !isNaN(f))
        .map(f => parseInt(f))
        .filter(n => !isNaN(n));
    return ids.length > 0 ? Math.max(...ids) + 1 : 1;
}

// API: Получить все карточки
app.get('/api/films', async (req, res) => {
    try {
        await ensureDir(FILMS_DIR);
        const files = await fs.readdir(FILMS_DIR);
        const filmIds = files.filter(f => !isNaN(f));
        
        const films = await Promise.all(
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
        
        res.json(films);
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
        return files.map(f => path.relative(__dirname, path.join(dir, f)));
    } catch {
        return [];
    }
}

// API: Создать новую карточку
app.post('/api/films', async (req, res) => {
    try {
        const id = await getNextId();
        const filmDir = path.join(FILMS_DIR, id.toString());
        
        // Создать структуру папок
        await ensureDir(filmDir);
        await ensureDir(path.join(filmDir, 'banner'));
        await ensureDir(path.join(filmDir, 'preview', 'preview1'));
        await ensureDir(path.join(filmDir, 'preview', 'preview2'));
        await ensureDir(path.join(filmDir, 'preview', 'preview3'));
        
        // Создать базовый data.json
        const initialData = {
            title: req.body.title || `Фильм ${id}`,
            rating: req.body.rating || 0,
            year: req.body.year || '',
            country: req.body.country || '',
            director: req.body.director || '',
            cast: req.body.cast || '',
            mainCategory: req.body.mainCategory || '',
            subCategories: req.body.subCategories || [],
            filmDescription: req.body.filmDescription || '',
            personalReview: req.body.personalReview || '',
            contentType: req.body.contentType || '',
            watchStatus: req.body.watchStatus || '',
            lastEpisode: req.body.lastEpisode || '',
            createdAt: new Date().toISOString()
        };
        
        await fs.writeFile(
            path.join(filmDir, 'data.json'),
            JSON.stringify(initialData, null, 2)
        );
        
        // Создать HTML файл
        const htmlContent = await generateFilmHTML(id, initialData);
        await fs.writeFile(path.join(filmDir, 'index.html'), htmlContent);
        
        res.json({ id, ...initialData });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Обновить карточку
app.put('/api/films/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const filmDir = path.join(FILMS_DIR, id);
        const dataPath = path.join(filmDir, 'data.json');
        
        // Читаем существующие данные
        let existingData = {};
        try {
            const data = await fs.readFile(dataPath, 'utf8');
            existingData = JSON.parse(data);
        } catch {}
        
        // Объединяем с новыми данными
        const updatedData = {
            ...existingData,
            ...req.body,
            updatedAt: new Date().toISOString()
        };
        
        await fs.writeFile(dataPath, JSON.stringify(updatedData, null, 2));
        
        res.json({ id, ...updatedData });
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
        const filePath = path.relative(__dirname, req.file.path);
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
        const filePath = path.relative(__dirname, req.file.path);
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
                console.log(`Redirect ${response.statusCode}: ${url} -> ${nextUrl}`);
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
                console.log(`Downloaded ${chunks.length} chunks, total size: ${buffer.length} bytes`);
                resolve(buffer);
            });
            response.on('error', reject);
        });

        request.setTimeout(15000, () => request.destroy(new Error('Download timeout')));
        request.on('error', reject);
    });
}

// API: Скачать изображение из URL и сохранить локально
app.post('/api/films/:id/download-image', async (req, res) => {
    const { id } = req.params;
    try {
        const { url, type, index } = req.body; // type: 'banner' или 'preview', index: 1,2,3 для превью
        
        if (!url) {
            console.error('❌ URL не указан');
            return res.status(400).json({ error: 'URL is required', success: false });
        }
        
        console.log(`📥 [Film ${id}] Скачивание ${type}${index ? ` ${index}` : ''} из: ${url}`);
        
        // Скачиваем изображение
        const imageBuffer = await downloadImage(url);
        console.log(`✅ [Film ${id}] Изображение скачано, размер: ${imageBuffer.length} bytes`);
        
        // Определяем путь для сохранения
        let uploadPath, filename;
        if (type === 'banner') {
            uploadPath = path.join(FILMS_DIR, id, 'banner');
            filename = 'banner.webp';
        } else if (type === 'preview' && index) {
            uploadPath = path.join(FILMS_DIR, id, 'preview', `preview${index}`);
            filename = 'preview.webp';
        } else {
            console.error('❌ Неверный тип или индекс:', { type, index });
            return res.status(400).json({ error: 'Invalid type or index', success: false });
        }
        
        console.log(`📁 [Film ${id}] Создание директории: ${uploadPath}`);
        
        // Создаем директорию если не существует
        await ensureDir(uploadPath);
        
        // Очищаем старые файлы
        await clearDirectory(uploadPath);
        
        // Сохраняем файл
        const filePath = path.join(uploadPath, filename);
        await fs.writeFile(filePath, imageBuffer);
        
        const relativePath = path.relative(__dirname, filePath);
        console.log(`💾 [Film ${id}] Изображение сохранено: ${relativePath}`);
        
        res.json({ path: relativePath, success: true });
    } catch (error) {
        console.error(`❌ [Film ${id}] Ошибка скачивания изображения:`, error.message);
        console.error('Stack:', error.stack);
        res.status(500).json({ error: error.message, success: false });
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

// Генерация HTML для карточки фильма
async function generateFilmHTML(id, data) {
    return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${data.title}</title>
</head>
<body>
    <h1>${data.title}</h1>
    <p>Рейтинг: ${data.rating}/10</p>
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
    await fs.writeFile(CATEGORIES_FILE, JSON.stringify(categories, null, 2));
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
        await fs.writeFile(SETTINGS_FILE, JSON.stringify(updated, null, 2));
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
    console.error('❌ Ошибка запроса:', err.message);
    res.status(500).json({ error: err.message, success: false });
});

// Запуск сервера
async function start() {
    await ensureDir(FILMS_DIR);
    await ensureDir(CATEGORIES_DIR);

    const server = app.listen(PORT, HOST, () => {
        console.log(`Сервер запущен на http://localhost:${PORT}`);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`❌ Порт ${PORT} уже занят. Возможно, сервер уже запущен.`);
        } else {
            console.error('❌ Ошибка сервера:', err.message);
        }
        process.exit(1);
    });
}

start();

