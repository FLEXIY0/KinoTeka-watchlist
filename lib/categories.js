// Сопоставление жанров Кинопоиска с категориями коллекции.
//
// Новых категорий не создаём — только находим уже существующие, чтобы список
// категорий не засорялся. Совпадением считается одно и то же слово без учёта
// регистра и «ё», в том числе с другим окончанием: «боевик» → «Боевики»,
// «комедия» → «Комедии», «криминал» → «Криминальные».

const MIN_STEM = 5;

function normalize(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[^a-zа-я0-9]+/g, ' ')
        .trim();
}

function commonPrefix(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
}

function sameWord(genre, category) {
    if (genre === category) return true;
    const prefix = commonPrefix(genre, category);
    if (prefix < MIN_STEM) return false;
    // Отличаться должны только окончания: не больше 4 букв после общей основы
    return genre.length - prefix <= 4 && category.length - prefix <= 4;
}

function categoryName(category) {
    return typeof category === 'string' ? category : category && category.name;
}

// genres — жанры Кинопоиска по порядку; categories — список категорий коллекции.
// Возвращает { mainCategory, subCategories } из имён существующих категорий.
function matchCategories(genres, categories) {
    const names = (categories || []).map(categoryName).filter(Boolean);
    const matched = [];

    for (const genre of genres || []) {
        const g = normalize(genre);
        if (!g) continue;
        const found = names.find((name) => sameWord(g, normalize(name)));
        if (found && !matched.includes(found)) matched.push(found);
    }

    return { mainCategory: matched[0] || '', subCategories: matched.slice(1) };
}

module.exports = { matchCategories, normalize };
