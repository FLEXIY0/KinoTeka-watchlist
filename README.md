


  
# Менеджер коллекции фильмов и сериалов


<img src="/assets/images/title_logo.png" width="1000"/>

<div align="center">

[English](docs/README_EN.md) | **Русский**


[![Telegram](https://img.shields.io/badge/Telegram-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white)](https://t.me/droopi_co) [![License](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey?style=for-the-badge)](docs\LICENSE)
</div>

## Демонстрация

<div align="center">

![Demo](/assets/images/demo.gif)

*Основной функционал приложения*

</div>



## Описание

  

Коллекция фильмов и сериалов с рейтингами, категориями и темами оформления — и встроенный плеер **ktw**, который смотрит фильмы прямо из терминала через mpv.

**Основные функции:**

- Управление фильмами и категориями, 10-балльная оценка
- **Поиск по Кинопоиску** — наведите на верхний край главной страницы (или нажмите `/`): карточка с постером, описанием и рейтингом, кнопка «В список» заполняет карточку целиком, «Смотреть» открывает фильм в ktw
- **Плеер ktw** — поиск и просмотр с онлайн-балансеров в mpv, история и продолжение просмотра ([подробнее](ktw/README.md))
- **Связка с ktw**: сериал, у которого посмотрена хотя бы одна серия, и начатые фильмы сами появляются в коллекции; то, что только открывали, — во временном списке «Недавно открывали»
- Один ключ Кинопоиска на всё: вставьте его в поиск, и он же будет работать в ktw
- Гибкая система тем, экспорт/импорт данных и категорий


  

---

  

## Установка и запуск

  

### Windows — одной командой

Откройте **PowerShell** (Win+X → «Терминал» или «Windows PowerShell»), вставьте и нажмите Enter:

```powershell
irm https://raw.githubusercontent.com/FLEXIY0/KinoTeka-watchlist/main/install.ps1 | iex
```

Команда один раз скачает портативный Node.js (без прав администратора), приложение, плеер mpv и запустит КиноТеку — она откроется в браузере на `http://localhost:3000`.

Дальше длинную команду вставлять не нужно — в любом терминале просто:

```
ktw              коллекция (откроется в браузере)
ktw матрица      сразу смотреть в плеере ktw
ktw watch        плеер ktw: поиск и история просмотров
ktw update       обновиться
```

В окне коллекции: **O** — открыть в браузере, **W** — плеер ktw в этом же окне, **R** — перезапустить, **Q** — выход.

Всё лежит в `%LOCALAPPDATA%\KinoTeka`, ваши фильмы — в `%LOCALAPPDATA%\KinoTeka\data` и при обновлении не затрагиваются. Ключ Кинопоиска и история ktw — в `%USERPROFILE%\.config\ktw`.

### Из исходников (Windows / Linux / macOS)

Нужен [Node.js](https://nodejs.org/) 20 или новее.

```bash
git clone https://github.com/FLEXIY0/KinoTeka-watchlist.git
cd KinoTeka-watchlist
npm install
npm run app      # сервер + интерфейс в терминале + браузер
# или просто сервер: npm start
```

  

---


## Технологии

  

Node.js • Express • Vanilla JavaScript • CSS Variables

  

---

## Roadmap

- [ ] Добавление английского языка (English version)
- [ ] Добавление новых источников подгрузки (TMDB, IMDb, другие базы)
- [ ] Адаптация под мобильные устройства
- [ ] Публикация веб-версии (hosting)
- [ ] Новая страница с интеллектуальным поиском рекомендаций

---

  

## Лицензия

  

**CC BY-NC-SA 4.0** (Creative Commons Attribution-NonCommercial-ShareAlike)

- ✓ Можно копировать и модифицировать
- ✓ Можно создавать форки
- ✗ Нельзя использовать в коммерческих целях
- ✗ Продажа разрешена только правообладателю

Для коммерческого использования свяжитесь с автором.

Подробнее: [LICENSE](docs\LICENSE)

  

  

<div align="center">


  

---

## Star History

<a href="https://www.star-history.com/#FLEXIY0/KinoTeka-watchlist&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=FLEXIY0/KinoTeka-watchlist&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=FLEXIY0/KinoTeka-watchlist&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=FLEXIY0/KinoTeka-watchlist&type=date&legend=top-left" />
 </picture>
</a><div align="center">
---

## Поддержать проект

<div align="center">

**donations:**

<img src="/assets/images/crypto_qr.jpg" alt="Crypto QR" width="200"/>

```
BTC: 1HjxBMDShSb6xeLKSQHwpCeh1yg6j2h8gu
ETH (ERC20): 0xb75c84cf2e189f9be3870a3f8d5e051dab9f8b75
USDT (TON): UQBKOgHmj3jEfj4ff7mzL3MlR13CvJH8vD9u-T4i2PcpkpZa
```

**Contact:** [@flexiy1](https://t.me/flexiy1)

*Ваша поддержка помогает развивать проект*

</div>

---

**Сделано любителем кино для любителей кино**

  

</div>
