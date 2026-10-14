'use strict';

// Модуль локализации (RU / EN) для KTW.

var DICT = {
    ru: {
        search_title: 'ktw',
        search_field: 'Поиск',
        searching: 'поиск…',
        continue_watching: 'Продолжить просмотр:',
        watched: 'просмотрено',
        empty_history: 'История просмотров пуста.',
        empty_history_sub: 'Здесь будут появляться просмотренные фильмы и серии с карточками и возможностью сброса.',
        settings_title: 'Тонкая настройка KTW',
        settings_sub: 'Параметры сохраняются в ~/.config/ktw/config.json',
        lang_label: 'Язык (Language)',
        theme_label: 'Тема оформления',
        stand_label: 'Стенд стилей и ANSI арта',
        stand_btn: '▶ Открыть живой стенд',
        player_label: 'Плеер по умолчанию',
        translation_label: 'Любимая озвучка',
        quality_label: 'Качество по умолчанию',
        mode_label: 'Режим извлечения',
        mode_hybrid: 'Гибридный [прямой + браузер]',
        mode_direct: 'Только прямой парсинг [без браузера]',
        fullscreen_label: 'MPV на весь экран',
        hwdec_label: 'MPV декодирование',
        mirror_label: 'Зеркало Kinobox API',
        key_label: 'Ключ Кинопоиска',
        key_not_set: 'Не задан (Ctrl+K)',
        history_title: 'Галерея истории',
        last_watched: 'Последняя серия',
        episodes_watched: 'Серий просмотрено',
        progress: 'Прогресс',
        audio_track: 'Озвучка',
        quality: 'Качество',
        player: 'Плеер',
        direct: '[прямой]',
        seasons: 'Сезоны',
        episodes: 'Серии',
        players: 'Плееры',
        translations: 'Озвучки',
        next_episode: 'Следующая серия',
        autoplay_in: 'Автозапуск через',
        resuming: 'Возобновление',
        resume_from: 'Продолжить с',
        start_over: 'Начать с начала',
        reset_serial: 'Сбросить прогресс сериала',
        reset_done: 'Прогресс сериала сброшен',
        delete_from_history: 'Удалить из истории',
        no_players: 'Для этого фильма нет доступных плееров',
        resolving: 'Достаю поток',
        checking_quality: 'проверяю качества…',
        sec: 'с.',
        min: 'мин',
        key_nav: 'выбор',
        key_enter: 'открыть',
        key_play: 'смотреть',
        key_settings: 'настройки',
        key_history: 'история',
        key_reset: 'r сбросить',
        key_delete: 'd удалить',
        key_back: 'назад',
        key_exit: 'выход',
        donate_label: 'Поддержать автора (Donatty)',
        donate_val: 'donatty.com/nedoedal [Enter]'
    },
    en: {
        search_title: 'ktw',
        search_field: 'Search',
        searching: 'searching…',
        continue_watching: 'Continue watching:',
        watched: 'watched',
        empty_history: 'Watch history is empty.',
        empty_history_sub: 'Watched movies and TV shows will appear here with cards and reset options.',
        settings_title: 'KTW Settings',
        settings_sub: 'Preferences are saved to ~/.config/ktw/config.json',
        lang_label: 'Language',
        theme_label: 'Color Theme',
        stand_label: 'Theme & ANSI Showcase',
        stand_btn: '▶ Open interactive stand',
        player_label: 'Preferred Player',
        translation_label: 'Preferred Audio',
        quality_label: 'Preferred Quality',
        mode_label: 'Extraction Mode',
        mode_hybrid: 'Hybrid [direct + browser]',
        mode_direct: 'Direct parsing only [no browser]',
        fullscreen_label: 'MPV Fullscreen',
        hwdec_label: 'MPV Hardware Decoding',
        mirror_label: 'Kinobox API Mirror',
        key_label: 'Kinopoisk API Key',
        key_not_set: 'Not set (Ctrl+K)',
        history_title: 'History Gallery',
        last_watched: 'Last watched',
        episodes_watched: 'Episodes watched',
        progress: 'Progress',
        audio_track: 'Audio',
        quality: 'Quality',
        player: 'Player',
        direct: '[direct]',
        seasons: 'Seasons',
        episodes: 'Episodes',
        players: 'Players',
        translations: 'Audio tracks',
        next_episode: 'Next Episode',
        autoplay_in: 'Auto-play in',
        resuming: 'Resume',
        resume_from: 'Resume from',
        start_over: 'Start over',
        reset_serial: 'Reset series progress',
        reset_done: 'Series progress reset',
        delete_from_history: 'Delete from history',
        no_players: 'No stream providers available for this title',
        resolving: 'Extracting stream',
        checking_quality: 'checking stream quality…',
        sec: 's',
        min: 'min',
        key_nav: 'navigate',
        key_enter: 'open',
        key_play: 'play',
        key_settings: 'settings',
        key_history: 'history',
        key_reset: 'r reset',
        key_delete: 'd delete',
        key_back: 'back',
        key_exit: 'exit',
        donate_label: 'Support author (Donatty)',
        donate_val: 'donatty.com/nedoedal [Enter]'
    }
};

function getLang() {
    try {
        var config = require('./config');
        return config.read().lang || 'ru';
    } catch (e) {
        return 'ru';
    }
}

function t(key, lang) {
    var l = lang || getLang();
    var dict = DICT[l] || DICT.ru;
    return dict[key] || DICT.ru[key] || key;
}

module.exports = {
    DICT: DICT,
    getLang: getLang,
    t: t
};
