// Работа с Kinopoisk Unofficial API на стороне сервера.
//
// Ключ общий с ktw: хранится в его конфиге (~/.config/ktw/config.json),
// поэтому достаточно ввести его один раз — в поиске на главной или в ktw.
// Браузер ключ не видит: все запросы к API идут через сервер.

const ktwConfig = require('../ktw/lib/config');

// Адрес API можно подменить (используется в тестах)
function apiBase() {
    return (process.env.KINOPOISK_API_BASE || 'https://kinopoiskapiunofficial.tech').replace(/\/$/, '');
}
const KEY_SITE = 'https://kinopoiskapiunofficial.tech/';

// Пути API, которые можно запрашивать через /api/kinopoisk/raw (только чтение)
const RAW_ALLOWED = [
    /^api\/v2\.1\/films\/search-by-keyword$/,
    /^api\/v2\.1\/films\/\d+\/box_office$/,
    /^api\/v2\.2\/films\/\d+$/,
    /^api\/v2\.2\/films\/\d+\/(images|facts|seasons)$/,
    /^api\/v1\/staff$/
];

class KinopoiskError extends Error {
    constructor(message, status, code) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

function getKey() {
    return ktwConfig.resolveApiKey() || null;
}

function looksLikeKey(value) {
    // Ключи сайта — UUID вида 8-4-4-4-12
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

async function request(apiPath, key = getKey()) {
    if (!key) {
        throw new KinopoiskError('Нет ключа Кинопоиска', 401, 'no-key');
    }

    let response;
    try {
        response = await fetch(`${apiBase()}/${apiPath}`, {
            headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(15000)
        });
    } catch (error) {
        throw new KinopoiskError(`Кинопоиск недоступен: ${error.message}`, 502, 'network');
    }

    if (response.status === 401 || response.status === 403) {
        throw new KinopoiskError('Ключ Кинопоиска недействителен или исчерпан', 401, 'bad-key');
    }
    if (response.status === 402 || response.status === 429) {
        throw new KinopoiskError('Лимит запросов к Кинопоиску на сегодня исчерпан', 429, 'limit');
    }
    if (response.status === 404) {
        throw new KinopoiskError('Не найдено на Кинопоиске', 404, 'not-found');
    }
    if (!response.ok) {
        throw new KinopoiskError(`Кинопоиск ответил ${response.status}`, 502, 'upstream');
    }
    return response.json();
}

// Проверяет ключ настоящим запросом и сохраняет в общий конфиг
async function setKey(rawKey) {
    const key = String(rawKey || '').trim();
    if (!looksLikeKey(key)) {
        throw new KinopoiskError('Это не похоже на ключ: он выглядит как xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', 400, 'format');
    }
    await request('api/v2.2/films/301', key);
    ktwConfig.save({ kinopoiskApiKey: key });
    return true;
}

function isSeriesType(type) {
    return type === 'TV_SERIES' || type === 'MINI_SERIES' || type === 'TV_SHOW';
}

function cleanRating(value) {
    if (value === null || value === undefined || value === '' || value === 'null') return null;
    const str = String(value);
    return /^\d/.test(str) && !str.endsWith('%') ? str : null;
}

async function search(query) {
    const data = await request(`api/v2.1/films/search-by-keyword?keyword=${encodeURIComponent(query)}&page=1`);
    return (data.films || []).map((f) => ({
        kpId: f.filmId,
        title: f.nameRu || f.nameEn || 'Без названия',
        titleEn: f.nameEn || '',
        year: f.year && f.year !== 'null' ? String(f.year).slice(0, 4) : '',
        type: isSeriesType(f.type) ? 'series' : 'movie',
        description: f.description || '',
        genres: (f.genres || []).map((g) => g.genre),
        countries: (f.countries || []).map((c) => c.country),
        rating: cleanRating(f.rating),
        poster: f.posterUrlPreview || f.posterUrl || null
    }));
}

function formatNumber(num) {
    return Number(num).toLocaleString('ru-RU');
}

function formatBudget(amount) {
    if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)} млн`;
    if (amount >= 1000) return `$${(amount / 1000).toFixed(0)} тыс`;
    return `$${amount}`;
}

// Полные данные для карточки — те же поля, что заполняет edit-film.html
// кнопкой загрузки с Кинопоиска. Картинки возвращаются ссылками, сервер
// скачивает их к себе отдельно.
async function getFilmCard(kpId) {
    const id = Number(kpId);
    const details = await request(`api/v2.2/films/${id}`);

    // Второстепенные запросы: если какой-то не удался, карточка всё равно создаётся
    const optional = (p) => request(p).catch(() => null);
    const [staff, images, boxOffice, facts] = await Promise.all([
        optional(`api/v1/staff?filmId=${id}`),
        optional(`api/v2.2/films/${id}/images?type=STILL&page=1`),
        optional(`api/v2.1/films/${id}/box_office`),
        optional(`api/v2.2/films/${id}/facts`)
    ]);

    const people = Array.isArray(staff) ? staff : [];
    const actors = people.filter((p) => p.professionKey === 'ACTOR').slice(0, 5).map((p) => p.nameRu || p.nameEn).filter(Boolean);
    const directors = people.filter((p) => p.professionKey === 'DIRECTOR').map((p) => p.nameRu || p.nameEn).filter(Boolean);

    let duration = null;
    if (details.filmLength) {
        const h = Math.floor(details.filmLength / 60);
        const m = details.filmLength % 60;
        duration = h > 0 ? `${h}ч ${m}мин` : `${m}мин`;
    }

    let ageRating = null;
    const age = details.ratingAgeLimits && String(details.ratingAgeLimits).match(/\d+/);
    if (age) ageRating = `${age[0]}+`;

    let budget = null;
    const budgetItem = boxOffice && (boxOffice.items || []).find((i) => i.type === 'BUDGET');
    if (budgetItem && budgetItem.amount) budget = formatBudget(budgetItem.amount);

    const factsHtml = facts && facts.items
        ? facts.items.filter((i) => i.type === 'FACT').slice(0, 3).map((i) => i.text).join('<br><br>')
        : '';

    const stills = images && images.items ? images.items.slice(0, 3).map((i) => i.imageUrl || i.previewUrl).filter(Boolean) : [];

    return {
        film: {
            kinopoiskId: String(id),
            title: details.nameRu || details.nameOriginal || details.nameEn || `Фильм ${id}`,
            year: details.year ? String(details.year) : '',
            country: details.countries && details.countries.length ? details.countries[0].country : '',
            director: directors.join(', '),
            cast: actors.join(', '),
            filmDescription: details.description || details.shortDescription || '',
            contentType: isSeriesType(details.type) || details.serial ? 'series' : 'movie',
            genres: (details.genres || []).map((g) => g.genre),
            kinopoiskRating: details.ratingKinopoisk ? String(details.ratingKinopoisk) : null,
            imdbRating: details.ratingImdb ? String(details.ratingImdb) : null,
            votesCount: details.ratingKinopoiskVoteCount ? formatNumber(details.ratingKinopoiskVoteCount) : '0',
            reviewsCount: details.ratingFilmCritics ? String(details.ratingFilmCritics) : '0',
            kinopoiskUrl: `https://www.kinopoisk.ru/film/${id}/`,
            imdbUrl: details.imdbId ? `https://www.imdb.com/title/${details.imdbId}/` : null,
            duration,
            ageRating,
            slogan: details.slogan || null,
            budget,
            interestingFacts: factsHtml || null
        },
        posterUrl: details.posterUrl || details.posterUrlPreview || null,
        stillUrls: stills
    };
}

// Сырой запрос для edit-film.html: путь проверяется по белому списку
async function raw(apiPathWithQuery) {
    const [apiPath] = apiPathWithQuery.split('?');
    if (!RAW_ALLOWED.some((re) => re.test(apiPath))) {
        throw new KinopoiskError('Этот запрос к Кинопоиску не разрешён', 400, 'forbidden-path');
    }
    return request(apiPathWithQuery);
}

// ID фильма на Кинопоиске из сохранённой карточки (новые хранят kinopoiskId,
// старые — только ссылку kinopoiskUrl)
function kpIdOf(film) {
    if (film.kinopoiskId) return String(film.kinopoiskId);
    const match = film.kinopoiskUrl && String(film.kinopoiskUrl).match(/\/(?:film|series)\/(\d+)/);
    return match ? match[1] : null;
}

module.exports = {
    KEY_SITE,
    KinopoiskError,
    getKey,
    setKey,
    looksLikeKey,
    search,
    getFilmCard,
    raw,
    kpIdOf
};
