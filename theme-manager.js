/**
 * Theme Manager - Управление темами для всех страниц
 */

class ThemeManager {
    constructor() {
        this.API_URL = '/api';
        this.defaultTheme = {
            backgroundColor: '#141414',
            backgroundType: 'solid', // solid, gradient, image
            gradientColor1: '#141414',
            gradientColor2: '#2a2a2a',
            gradientAngle: 135,
            gradientPosition1: 0,
            gradientPosition2: 100,
            backgroundImage: null,
            primaryColor: '#212121',
            secondaryColor: '#2a2a2a',
            accentColor: '#3e3e3e',
            hoverColor: '#323232',
            activeColor: '#4e4e4e',
            buttonColor: '#3e3e3e',
            buttonHover: '#4e4e4e',
            buttonTextColor: '#9E9E9E',
            buttonTextHover: '#ffffff',
            textPrimary: '#B8B8B8',
            textSecondary: '#9E9E9E',
            textTertiary: '#848484',
            textMuted: '#6e6e6e',
            textHover: '#ffffff',
            borderColor: '#3e3e3e',
            borderHover: '#4e4e4e',
            starEmpty: '#3e3e3e',
            starFilled: '#ffcc80',
            fontFamily: 'Nunito, sans-serif',
            fontSize: '16px'
        };
        
        // Готовые пресеты тем
        this.presets = {
            dark: {
                name: 'Темная',
                icon: '🌙',
                theme: {
                    backgroundColor: '#141414',
                    primaryColor: '#212121',
                    secondaryColor: '#2a2a2a',
                    accentColor: '#3e3e3e',
                    hoverColor: '#323232',
                    activeColor: '#4e4e4e',
                    buttonColor: '#3e3e3e',
                    buttonHover: '#4e4e4e',
                    buttonTextColor: '#9E9E9E',
                    buttonTextHover: '#ffffff',
                    textPrimary: '#B8B8B8',
                    textSecondary: '#9E9E9E',
                    textTertiary: '#848484',
                    textMuted: '#6e6e6e',
                    textHover: '#ffffff',
                    borderColor: '#3e3e3e',
                    borderHover: '#4e4e4e'
                }
            },
            light: {
                name: 'Светлая',
                icon: '☀️',
                theme: {
                    backgroundColor: '#f5f5f5',
                    primaryColor: '#ffffff',
                    secondaryColor: '#f0f0f0',
                    accentColor: '#e0e0e0',
                    hoverColor: '#e8e8e8',
                    activeColor: '#d0d0d0',
                    buttonColor: '#e0e0e0',
                    buttonHover: '#d0d0d0',
                    buttonTextColor: '#424242',
                    buttonTextHover: '#000000',
                    textPrimary: '#212121',
                    textSecondary: '#424242',
                    textTertiary: '#616161',
                    textMuted: '#9e9e9e',
                    textHover: '#000000',
                    borderColor: '#d0d0d0',
                    borderHover: '#b0b0b0'
                }
            },
            blue: {
                name: 'Синяя',
                icon: '💙',
                theme: {
                    backgroundColor: '#0d1117',
                    primaryColor: '#161b22',
                    secondaryColor: '#1f2937',
                    accentColor: '#374151',
                    hoverColor: '#4b5563',
                    activeColor: '#6b7280',
                    buttonColor: '#374151',
                    buttonHover: '#6b7280',
                    buttonTextColor: '#8b949e',
                    buttonTextHover: '#e8ecf5',
                    textPrimary: '#c9d1d9',
                    textSecondary: '#8b949e',
                    textTertiary: '#6e7681',
                    textMuted: '#484f58',
                    textHover: '#e8ecf5',
                    borderColor: '#374151',
                    borderHover: '#6b7280'
                }
            },
            purple: {
                name: 'Фиолетовая',
                icon: '💜',
                theme: {
                    backgroundColor: '#1a0d2e',
                    primaryColor: '#271447',
                    secondaryColor: '#3d2463',
                    accentColor: '#503a73',
                    hoverColor: '#634e83',
                    activeColor: '#766293',
                    buttonColor: '#503a73',
                    buttonHover: '#766293',
                    buttonTextColor: '#b8a7d9',
                    buttonTextHover: '#e8d9ff',
                    textPrimary: '#d4c5f9',
                    textSecondary: '#b8a7d9',
                    textTertiary: '#9580b8',
                    textMuted: '#725a97',
                    textHover: '#e8d9ff',
                    borderColor: '#503a73',
                    borderHover: '#766293'
                }
            },
            green: {
                name: 'Зеленая',
                icon: '💚',
                theme: {
                    backgroundColor: '#0d1f12',
                    primaryColor: '#1a2f23',
                    secondaryColor: '#1e3a29',
                    accentColor: '#2d5a3d',
                    hoverColor: '#3a6f4d',
                    activeColor: '#47845d',
                    buttonColor: '#2d5a3d',
                    buttonHover: '#47845d',
                    buttonTextColor: '#9ed4b3',
                    buttonTextHover: '#ddf5e5',
                    textPrimary: '#c4e8d1',
                    textSecondary: '#9ed4b3',
                    textTertiary: '#7ab896',
                    textMuted: '#5a9c79',
                    textHover: '#ddf5e5',
                    borderColor: '#2d5a3d',
                    borderHover: '#47845d'
                }
            },
            coffee: {
                name: 'Кофейная',
                icon: '☕',
                theme: {
                    backgroundColor: '#1c1410',
                    primaryColor: '#2b1f1a',
                    secondaryColor: '#3d2b23',
                    accentColor: '#4e3829',
                    hoverColor: '#5a4230',
                    activeColor: '#6b4e39',
                    buttonColor: '#4e3829',
                    buttonHover: '#6b4e39',
                    buttonTextColor: '#b8a89c',
                    buttonTextHover: '#e8d9cd',
                    textPrimary: '#d4c5b9',
                    textSecondary: '#b8a89c',
                    textTertiary: '#9c8b7f',
                    textMuted: '#7f6e62',
                    textHover: '#e8d9cd',
                    borderColor: '#4e3829',
                    borderHover: '#6b4e39'
                }
            },
            ocean: {
                name: 'Океан',
                icon: '🌊',
                theme: {
                    backgroundColor: '#0a1929',
                    primaryColor: '#132f4c',
                    secondaryColor: '#1e4976',
                    accentColor: '#2e5984',
                    hoverColor: '#3d6a94',
                    activeColor: '#4d7ba4',
                    buttonColor: '#2e5984',
                    buttonHover: '#4d7ba4',
                    buttonTextColor: '#8ac7e8',
                    buttonTextHover: '#d1f0ff',
                    textPrimary: '#b2e3ff',
                    textSecondary: '#8ac7e8',
                    textTertiary: '#66acd5',
                    textMuted: '#4a8fb8',
                    textHover: '#d1f0ff',
                    borderColor: '#2e5984',
                    borderHover: '#4d7ba4'
                }
            },
            sunset: {
                name: 'Закат',
                icon: '🌅',
                theme: {
                    backgroundColor: '#1a0f0a',
                    primaryColor: '#2d1810',
                    secondaryColor: '#482818',
                    accentColor: '#633820',
                    hoverColor: '#7d4528',
                    activeColor: '#975230',
                    buttonColor: '#633820',
                    buttonHover: '#975230',
                    buttonTextColor: '#ffb89d',
                    buttonTextHover: '#ffe8d9',
                    textPrimary: '#ffd4b8',
                    textSecondary: '#ffb89d',
                    textTertiary: '#ff9d82',
                    textMuted: '#d97b5f',
                    textHover: '#ffe8d9',
                    borderColor: '#633820',
                    borderHover: '#975230'
                }
            },
            forest: {
                name: 'Лес',
                icon: '🌲',
                theme: {
                    backgroundColor: '#0d1410',
                    primaryColor: '#1a281f',
                    secondaryColor: '#243b2e',
                    accentColor: '#2f4f3d',
                    hoverColor: '#3a614c',
                    activeColor: '#45735b',
                    buttonColor: '#2f4f3d',
                    buttonHover: '#45735b',
                    buttonTextColor: '#a5d4b8',
                    buttonTextHover: '#e0f5e8',
                    textPrimary: '#c5e8d1',
                    textSecondary: '#a5d4b8',
                    textTertiary: '#85c09f',
                    textMuted: '#65a786',
                    textHover: '#e0f5e8',
                    borderColor: '#2f4f3d',
                    borderHover: '#45735b'
                }
            },
            night: {
                name: 'Ночь',
                icon: '🌃',
                theme: {
                    backgroundColor: '#0a0e1a',
                    primaryColor: '#141829',
                    secondaryColor: '#1e2538',
                    accentColor: '#2a3347',
                    hoverColor: '#364156',
                    activeColor: '#425065',
                    buttonColor: '#2a3347',
                    buttonHover: '#425065',
                    buttonTextColor: '#c5cde0',
                    buttonTextHover: '#f5f7fc',
                    textPrimary: '#e8ecf5',
                    textSecondary: '#c5cde0',
                    textTertiary: '#a3aec8',
                    textMuted: '#8192b0',
                    textHover: '#f5f7fc',
                    borderColor: '#2a3347',
                    borderHover: '#425065'
                }
            },
            rose: {
                name: 'Роза',
                icon: '🌹',
                theme: {
                    backgroundColor: '#1f0d14',
                    primaryColor: '#2e1521',
                    secondaryColor: '#45202f',
                    accentColor: '#5c2b3d',
                    hoverColor: '#73364b',
                    activeColor: '#8a4159',
                    buttonColor: '#5c2b3d',
                    buttonHover: '#8a4159',
                    buttonTextColor: '#e8a8c5',
                    buttonTextHover: '#ffd9e8',
                    textPrimary: '#f5c5d9',
                    textSecondary: '#e8a8c5',
                    textTertiary: '#d98bb1',
                    textMuted: '#c66e9d',
                    textHover: '#ffd9e8',
                    borderColor: '#5c2b3d',
                    borderHover: '#8a4159'
                }
            },
            gold: {
                name: 'Золото',
                icon: '⭐',
                theme: {
                    backgroundColor: '#1a1510',
                    primaryColor: '#2b2418',
                    secondaryColor: '#3d3320',
                    accentColor: '#4f4228',
                    hoverColor: '#615130',
                    activeColor: '#736038',
                    buttonColor: '#4f4228',
                    buttonHover: '#736038',
                    buttonTextColor: '#e8d8a8',
                    buttonTextHover: '#fff5d9',
                    textPrimary: '#f5e8c5',
                    textSecondary: '#e8d8a8',
                    textTertiary: '#d9c88b',
                    textMuted: '#c6b86e',
                    textHover: '#fff5d9',
                    borderColor: '#4f4228',
                    borderHover: '#736038'
                }
            },
            arctic: {
                name: 'Арктика',
                icon: '🧊',
                theme: {
                    backgroundColor: '#0d1418',
                    primaryColor: '#15232b',
                    secondaryColor: '#1d333e',
                    accentColor: '#254351',
                    hoverColor: '#2d5364',
                    activeColor: '#356377',
                    buttonColor: '#254351',
                    buttonHover: '#356377',
                    buttonTextColor: '#b8dff5',
                    buttonTextHover: '#e8f7ff',
                    textPrimary: '#d9f0ff',
                    textSecondary: '#b8dff5',
                    textTertiary: '#97ceeb',
                    textMuted: '#76bde1',
                    textHover: '#e8f7ff',
                    borderColor: '#254351',
                    borderHover: '#356377'
                }
            },
            cherry: {
                name: 'Вишня',
                icon: '🍒',
                theme: {
                    backgroundColor: '#1a0a0d',
                    primaryColor: '#2d1418',
                    secondaryColor: '#421f25',
                    accentColor: '#572a32',
                    hoverColor: '#6c353f',
                    activeColor: '#81404c',
                    buttonColor: '#572a32',
                    buttonHover: '#81404c',
                    buttonTextColor: '#ffa8bf',
                    buttonTextHover: '#ffdce5',
                    textPrimary: '#ffc5d4',
                    textSecondary: '#ffa8bf',
                    textTertiary: '#ff8baa',
                    textMuted: '#e66e8f',
                    textHover: '#ffdce5',
                    borderColor: '#572a32',
                    borderHover: '#81404c'
                }
            }
        };
        
        this.currentTheme = null;
        this.customThemes = []; // Локальные темы пользователя
        this.init();
    }

    async init() {
        // Загрузка настроек из localStorage или с сервера
        await this.loadSettings();
        // Загрузка пользовательских тем
        this.loadCustomThemes();
        // Применение темы
        this.applyTheme();
        // Инициализация UI
        this.initUI();
        
        // Обновляем градиент превью если нужно
        setTimeout(() => {
            if (this.currentTheme.backgroundType === 'gradient') {
                this.updateGradientPreview();
            }
            
            // Обновляем превью звездочек
            const starEmptyPreview = document.getElementById('preview-starEmpty');
            const starFilledPreview = document.getElementById('preview-starFilled');
            if (starEmptyPreview) starEmptyPreview.style.color = this.currentTheme.starEmpty || '#3e3e3e';
            if (starFilledPreview) starFilledPreview.style.color = this.currentTheme.starFilled || '#ffcc80';
        }, 100);
    }

    loadCustomThemes() {
        const saved = localStorage.getItem('customThemes');
        if (saved) {
            try {
                this.customThemes = JSON.parse(saved);
            } catch (e) {
                this.customThemes = [];
            }
        }
    }

    saveCustomThemes() {
        localStorage.setItem('customThemes', JSON.stringify(this.customThemes));
    }

    async loadSettings() {
        try {
            // Пробуем загрузить из localStorage
            const localSettings = localStorage.getItem('themeSettings');
            if (localSettings) {
                this.currentTheme = JSON.parse(localSettings);
                return;
            }

            // Если нет в localStorage, загружаем с сервера
            const response = await fetch(`${this.API_URL}/settings`);
            if (response.ok) {
                const data = await response.json();
                this.currentTheme = data.theme || this.defaultTheme;
            } else {
                this.currentTheme = this.defaultTheme;
            }
        } catch (error) {
            console.warn('Ошибка загрузки настроек, используем дефолтную тему:', error);
            this.currentTheme = this.defaultTheme;
        }
    }

    async saveSettings() {
        try {
            // Сохраняем в localStorage
            localStorage.setItem('themeSettings', JSON.stringify(this.currentTheme));

            // Сохраняем на сервер
            const response = await fetch(`${this.API_URL}/settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ theme: this.currentTheme })
            });

            if (!response.ok) {
                console.warn('Не удалось сохранить настройки на сервер');
            }
        } catch (error) {
            console.error('Ошибка сохранения настроек:', error);
        }
    }

    applyTheme() {
        const root = document.documentElement;
        const body = document.body;
        
        // Применяем фон в зависимости от типа
        const bgType = this.currentTheme.backgroundType || 'solid';
        
        if (bgType === 'gradient') {
            const angle = this.currentTheme.gradientAngle || 135;
            const color1 = this.currentTheme.gradientColor1 || this.currentTheme.backgroundColor;
            const color2 = this.currentTheme.gradientColor2 || this.currentTheme.primaryColor;
            const pos1 = this.currentTheme.gradientPosition1 || 0;
            const pos2 = this.currentTheme.gradientPosition2 || 100;
            body.style.background = `linear-gradient(${angle}deg, ${color1} ${pos1}%, ${color2} ${pos2}%)`;
            body.style.backgroundAttachment = 'fixed';
            root.style.setProperty('--bg-primary', color1);
        } else if (bgType === 'image' && this.currentTheme.backgroundImage) {
            body.style.background = `url(${this.currentTheme.backgroundImage})`;
            body.style.backgroundSize = 'cover';
            body.style.backgroundPosition = 'center';
            body.style.backgroundAttachment = 'fixed';
            root.style.setProperty('--bg-primary', this.currentTheme.backgroundColor);
        } else {
            body.style.background = this.currentTheme.backgroundColor;
            root.style.setProperty('--bg-primary', this.currentTheme.backgroundColor);
        }
        
        // Применяем CSS переменные (с поддержкой новых и старых форматов)
        root.style.setProperty('--bg-secondary', this.currentTheme.primaryColor);
        root.style.setProperty('--bg-tertiary', this.currentTheme.secondaryColor);
        root.style.setProperty('--bg-accent', this.currentTheme.accentColor);
        root.style.setProperty('--bg-hover', this.currentTheme.hoverColor || this.currentTheme.accentColor);
        root.style.setProperty('--bg-active', this.currentTheme.activeColor || this.currentTheme.accentColor);
        root.style.setProperty('--button-bg', this.currentTheme.buttonColor || this.currentTheme.accentColor);
        root.style.setProperty('--button-bg-hover', this.currentTheme.buttonHover || this.currentTheme.hoverColor || this.currentTheme.accentColor);
        root.style.setProperty('--button-text', this.currentTheme.buttonTextColor || this.currentTheme.textSecondary);
        root.style.setProperty('--button-text-hover', this.currentTheme.buttonTextHover || this.currentTheme.textHover || this.currentTheme.textPrimary);
        root.style.setProperty('--text-primary', this.currentTheme.textPrimary);
        root.style.setProperty('--text-secondary', this.currentTheme.textSecondary);
        root.style.setProperty('--text-tertiary', this.currentTheme.textTertiary);
        root.style.setProperty('--text-muted', this.currentTheme.textMuted);
        root.style.setProperty('--text-hover', this.currentTheme.textHover || this.currentTheme.textPrimary);
        root.style.setProperty('--border-color', this.currentTheme.borderColor || this.currentTheme.accentColor);
        root.style.setProperty('--border-hover', this.currentTheme.borderHover || this.currentTheme.accentColor);
        root.style.setProperty('--star-empty', this.currentTheme.starEmpty || '#3e3e3e');
        root.style.setProperty('--star-filled', this.currentTheme.starFilled || '#ffcc80');
        
        // Шрифты
        if (this.currentTheme.fontFamily) {
            body.style.fontFamily = this.currentTheme.fontFamily;
        }
        if (this.currentTheme.fontSize) {
            body.style.fontSize = this.currentTheme.fontSize;
        }
    }

    updateTheme(property, value) {
        this.currentTheme[property] = value;
        this.applyTheme();
    }

    resetTheme() {
        this.currentTheme = { ...this.defaultTheme };
        this.applyTheme();
        this.saveSettings();
    }

    initUI() {
        // Создаем кнопку настроек
        const settingsButton = document.createElement('div');
        settingsButton.className = 'theme-settings-button';
        settingsButton.innerHTML = '<span class="material-symbols-outlined">palette</span>';
        settingsButton.onclick = () => this.toggleSettingsPanel();
        document.body.appendChild(settingsButton);

        // Создаем панель настроек
        this.createSettingsPanel();
    }

    createSettingsPanel() {
        const panel = document.createElement('div');
        panel.className = 'theme-settings-panel';
        panel.id = 'themeSettingsPanel';
        
        // Генерируем HTML для готовых пресетов
        const presetsHTML = Object.keys(this.presets).map(key => {
            const preset = this.presets[key];
            return `
                <div class="theme-preset-card" onclick="themeManager.applyPreset('${key}')">
                    <div class="theme-preset-preview" style="background: ${preset.theme.backgroundColor}">
                        <div class="theme-preset-layers">
                            <div style="background: ${preset.theme.primaryColor}"></div>
                            <div style="background: ${preset.theme.secondaryColor}"></div>
                            <div style="background: ${preset.theme.accentColor}"></div>
                        </div>
                        <div class="theme-preset-texts">
                            <span style="color: ${preset.theme.textPrimary}">Aa</span>
                            <span style="color: ${preset.theme.textSecondary}">Aa</span>
                        </div>
                    </div>
                    <div class="theme-preset-info">
                        <span class="theme-preset-icon">${preset.icon}</span>
                        <span class="theme-preset-name">${preset.name}</span>
                    </div>
                </div>
            `;
        }).join('');

        // Генерируем HTML для пользовательских тем
        const customThemesHTML = this.customThemes.map((theme, index) => {
            return `
                <div class="theme-preset-card custom-theme">
                    <div class="theme-preset-preview" style="background: ${theme.backgroundColor}" onclick="themeManager.applyCustomTheme(${index})">
                        <div class="theme-preset-layers">
                            <div style="background: ${theme.primaryColor}"></div>
                            <div style="background: ${theme.secondaryColor}"></div>
                            <div style="background: ${theme.accentColor}"></div>
                        </div>
                        <div class="theme-preset-texts">
                            <span style="color: ${theme.textPrimary}">Aa</span>
                            <span style="color: ${theme.textSecondary}">Aa</span>
                        </div>
                    </div>
                    <div class="theme-preset-info">
                        <span class="theme-preset-icon">💾</span>
                        <span class="theme-preset-name">${theme.name || 'Тема ' + (index + 1)}</span>
                        <button class="theme-delete-btn" onclick="event.stopPropagation(); themeManager.deleteCustomTheme(${index})" title="Удалить">×</button>
                    </div>
                </div>
            `;
        }).join('');
        
        panel.innerHTML = `
            <div class="theme-settings-container">
                <div class="theme-settings-header">
                    <h3>🎨 Настройка темы</h3>
                    <button class="theme-settings-close" onclick="themeManager.toggleSettingsPanel()">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>
                <div class="theme-settings-content">
                    <!-- Готовые темы -->
                    <div class="theme-settings-section">
                        <h4>Готовые темы</h4>
                        <div class="theme-presets-grid">
                            ${presetsHTML}
                        </div>
                    </div>

                    <!-- Пользовательские темы -->
                    ${this.customThemes.length > 0 ? `
                    <div class="theme-settings-section">
                        <h4>Мои темы</h4>
                        <div class="theme-presets-grid">
                            ${customThemesHTML}
                        </div>
                    </div>
                    ` : ''}

                    <!-- Настройка фона -->
                    <div class="theme-settings-section">
                        <h4>Фон страницы</h4>
                        
                        <div class="background-type-selector">
                            <label class="bg-type-option">
                                <input type="radio" name="backgroundType" value="solid" ${(this.currentTheme.backgroundType || 'solid') === 'solid' ? 'checked' : ''} onchange="themeManager.changeBackgroundType('solid')">
                                <span>Сплошной цвет</span>
                            </label>
                            <label class="bg-type-option">
                                <input type="radio" name="backgroundType" value="gradient" ${this.currentTheme.backgroundType === 'gradient' ? 'checked' : ''} onchange="themeManager.changeBackgroundType('gradient')">
                                <span>Градиент</span>
                            </label>
                            <label class="bg-type-option">
                                <input type="radio" name="backgroundType" value="image" ${this.currentTheme.backgroundType === 'image' ? 'checked' : ''} onchange="themeManager.changeBackgroundType('image')">
                                <span>Изображение</span>
                            </label>
                        </div>

                        <!-- Сплошной цвет -->
                        <div class="bg-option-panel" id="solidPanel" style="display: ${(this.currentTheme.backgroundType || 'solid') === 'solid' ? 'block' : 'none'}">
                            <div class="theme-color-item-v2">
                                <div class="theme-color-preview-wrapper">
                                    <div class="theme-color-preview" id="preview-bgSolid" style="background: ${this.currentTheme.backgroundColor}"></div>
                                </div>
                                <div class="theme-color-info">
                                    <label>Цвет фона</label>
                                </div>
                                <input type="color" id="bgSolidColor" value="${this.currentTheme.backgroundColor}" oninput="themeManager.updateBackgroundColor(this.value)" />
                            </div>
                        </div>

                        <!-- Градиент -->
                        <div class="bg-option-panel" id="gradientPanel" style="display: ${this.currentTheme.backgroundType === 'gradient' ? 'block' : 'none'}">
                            <div class="gradient-controls">
                                <div class="theme-color-item-v2">
                                    <div class="theme-color-preview-wrapper">
                                        <div class="theme-color-preview" id="preview-gradient1" style="background: ${this.currentTheme.gradientColor1 || this.currentTheme.backgroundColor}"></div>
                                    </div>
                                    <div class="theme-color-info">
                                        <label>Цвет 1</label>
                                    </div>
                                    <input type="color" id="gradientColor1" value="${this.currentTheme.gradientColor1 || this.currentTheme.backgroundColor}" oninput="themeManager.updateGradient()" />
                                </div>
                                <div class="theme-color-item-v2">
                                    <div class="theme-color-preview-wrapper">
                                        <div class="theme-color-preview" id="preview-gradient2" style="background: ${this.currentTheme.gradientColor2 || this.currentTheme.primaryColor}"></div>
                                    </div>
                                    <div class="theme-color-info">
                                        <label>Цвет 2</label>
                                    </div>
                                    <input type="color" id="gradientColor2" value="${this.currentTheme.gradientColor2 || this.currentTheme.primaryColor}" oninput="themeManager.updateGradient()" />
                                </div>
                                <div class="gradient-angle-control">
                                    <label>Угол: <span id="angleValue">${this.currentTheme.gradientAngle || 135}</span>°</label>
                                    <input type="range" id="gradientAngle" min="0" max="360" value="${this.currentTheme.gradientAngle || 135}" oninput="themeManager.updateGradientAngle(this.value)" />
                                </div>
                                <div class="gradient-angle-control">
                                    <label>Позиция цвета 1: <span id="position1Value">${this.currentTheme.gradientPosition1 || 0}</span>%</label>
                                    <input type="range" id="gradientPosition1" min="0" max="100" value="${this.currentTheme.gradientPosition1 || 0}" oninput="themeManager.updateGradientPosition(1, this.value)" />
                                </div>
                                <div class="gradient-angle-control">
                                    <label>Позиция цвета 2: <span id="position2Value">${this.currentTheme.gradientPosition2 || 100}</span>%</label>
                                    <input type="range" id="gradientPosition2" min="0" max="100" value="${this.currentTheme.gradientPosition2 || 100}" oninput="themeManager.updateGradientPosition(2, this.value)" />
                                </div>
                                <div class="gradient-preview" id="gradientPreview"></div>
                            </div>
                        </div>

                        <!-- Изображение -->
                        <div class="bg-option-panel" id="imagePanel" style="display: ${this.currentTheme.backgroundType === 'image' ? 'block' : 'none'}">
                            <div class="image-upload-control">
                                <input type="file" id="bgImageInput" accept="image/*" style="display: none" onchange="themeManager.handleImageUpload(event)">
                                <button class="theme-action-btn" onclick="document.getElementById('bgImageInput').click()">
                                    <span class="material-symbols-outlined">upload_file</span>
                                    <span>Загрузить изображение</span>
                                </button>
                                ${this.currentTheme.backgroundImage ? `
                                    <div class="bg-image-preview" style="background-image: url(${this.currentTheme.backgroundImage})"></div>
                                    <button class="theme-action-btn theme-action-btn-danger" onclick="themeManager.removeBackgroundImage()">
                                        <span class="material-symbols-outlined">delete</span>
                                        <span>Удалить</span>
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                    </div>

                    <!-- Цвета с превью -->
                    <div class="theme-settings-section">
                        <h4>Настройка цветов</h4>
                        
                        <div class="theme-color-group">
                            <div class="theme-color-group-title">Фоны</div>
                            
                            <div class="theme-color-item-v2">
                                <div class="theme-color-preview-wrapper">
                                    <div class="theme-color-preview" id="preview-backgroundColor">
                                        <div class="theme-preview-page">Страница</div>
                                    </div>
                                </div>
                                <div class="theme-color-info">
                                    <label>Основной фон</label>
                                    <span class="theme-color-hint">Цвет всей страницы</span>
                                </div>
                                <input type="color" id="backgroundColor" value="${this.currentTheme.backgroundColor}" />
                            </div>

                            <div class="theme-color-item-v2">
                                <div class="theme-color-preview-wrapper">
                                    <div class="theme-color-preview" id="preview-primaryColor">
                                        <div class="theme-preview-card">Карточка</div>
                                    </div>
                                </div>
                                <div class="theme-color-info">
                                    <label>Карточки</label>
                                    <span class="theme-color-hint">Цвет блоков и секций</span>
                                </div>
                                <input type="color" id="primaryColor" value="${this.currentTheme.primaryColor}" />
                            </div>

                            <div class="theme-color-item-v2">
                                <div class="theme-color-preview-wrapper">
                                    <div class="theme-color-preview" id="preview-secondaryColor">
                                        <div class="theme-preview-input">Поле ввода</div>
                                    </div>
                                </div>
                                <div class="theme-color-info">
                                    <label>Поля ввода</label>
                                    <span class="theme-color-hint">Цвет текстовых полей</span>
                                </div>
                                <input type="color" id="secondaryColor" value="${this.currentTheme.secondaryColor}" />
                            </div>

                            <div class="theme-color-item-v2">
                                <div class="theme-color-preview-wrapper">
                                    <div class="theme-color-preview" id="preview-accentColor">
                                        <div class="theme-preview-button">Кнопка</div>
                                    </div>
                                </div>
                                <div class="theme-color-info">
                                    <label>Акцент</label>
                                    <span class="theme-color-hint">Кнопки и элементы</span>
                                </div>
                                <input type="color" id="accentColor" value="${this.currentTheme.accentColor}" />
                            </div>
                        </div>

                        <div class="theme-color-group">
                            <div class="theme-color-group-title">Текст</div>
                            
                            <div class="theme-color-item-v2">
                                <div class="theme-color-preview-wrapper">
                                    <div class="theme-color-text-preview" id="preview-textPrimary">Аа</div>
                                </div>
                                <div class="theme-color-info">
                                    <label>Яркий</label>
                                    <span class="theme-color-hint">Заголовки, важный текст</span>
                                </div>
                                <input type="color" id="textPrimary" value="${this.currentTheme.textPrimary}" />
                            </div>

                            <div class="theme-color-item-v2">
                                <div class="theme-color-preview-wrapper">
                                    <div class="theme-color-text-preview" id="preview-textSecondary">Аа</div>
                                </div>
                                <div class="theme-color-info">
                                    <label>Обычный</label>
                                    <span class="theme-color-hint">Основной текст</span>
                                </div>
                                <input type="color" id="textSecondary" value="${this.currentTheme.textSecondary}" />
                            </div>

                            <div class="theme-color-item-v2">
                                <div class="theme-color-preview-wrapper">
                                    <div class="theme-color-text-preview" id="preview-textTertiary">Аа</div>
                                </div>
                                <div class="theme-color-info">
                                    <label>Средний</label>
                                    <span class="theme-color-hint">Подписи, метки</span>
                                </div>
                                <input type="color" id="textTertiary" value="${this.currentTheme.textTertiary}" />
                            </div>

                            <div class="theme-color-item-v2">
                                <div class="theme-color-preview-wrapper">
                                    <div class="theme-color-text-preview" id="preview-textMuted">Аа</div>
                                </div>
                                <div class="theme-color-info">
                                    <label>Тусклый</label>
                                    <span class="theme-color-hint">Второстепенная информация</span>
                                </div>
                                <input type="color" id="textMuted" value="${this.currentTheme.textMuted}" />
                            </div>
                        </div>

                        <div class="theme-color-group">
                            <div class="theme-color-group-title">Интерактивные элементы</div>
                            
                            <div class="theme-color-item-v2">
                                <div class="theme-color-preview-wrapper">
                                    <div class="theme-color-preview" id="preview-buttonColor" style="padding: 8px;">
                                        <div class="theme-preview-button">Кнопка</div>
                                    </div>
                                </div>
                                <div class="theme-color-info">
                                    <label>Кнопка фон</label>
                                    <span class="theme-color-hint">Цвет фона кнопок</span>
                                </div>
                                <input type="color" id="buttonColor" value="${this.currentTheme.buttonColor || this.currentTheme.accentColor}" />
                            </div>

                            <div class="theme-color-item-v2">
                                <div class="theme-color-preview-wrapper">
                                    <div class="theme-color-preview" id="preview-buttonHover" style="padding: 8px;">
                                        <div class="theme-preview-button theme-preview-button-hover">При наведении</div>
                                    </div>
                                </div>
                                <div class="theme-color-info">
                                    <label>Hover кнопки</label>
                                    <span class="theme-color-hint">Цвет при наведении на кнопку</span>
                                </div>
                                <input type="color" id="buttonHover" value="${this.currentTheme.buttonHover || this.currentTheme.hoverColor || this.currentTheme.accentColor}" />
                            </div>

                            <div class="theme-color-item-v2">
                                <div class="theme-color-preview-wrapper">
                                    <div class="theme-color-text-preview" id="preview-buttonTextColor">Аа</div>
                                </div>
                                <div class="theme-color-info">
                                    <label>Текст кнопки</label>
                                    <span class="theme-color-hint">Цвет текста на кнопках</span>
                                </div>
                                <input type="color" id="buttonTextColor" value="${this.currentTheme.buttonTextColor || this.currentTheme.textSecondary}" />
                            </div>

                            <div class="theme-color-item-v2">
                                <div class="theme-color-preview-wrapper">
                                    <div class="theme-color-text-preview" id="preview-buttonTextHover">Аа</div>
                                </div>
                                <div class="theme-color-info">
                                    <label>Текст hover</label>
                                    <span class="theme-color-hint">Цвет текста при наведении</span>
                                </div>
                                <input type="color" id="buttonTextHover" value="${this.currentTheme.buttonTextHover || this.currentTheme.textHover || this.currentTheme.textPrimary}" />
                            </div>
                        </div>

                        <div class="theme-color-group">
                            <div class="theme-color-group-title">Обводка и границы</div>
                            
                            <div class="theme-color-item-v2">
                                <div class="theme-color-preview-wrapper">
                                    <div class="theme-color-preview" id="preview-borderColor" style="border: 2px solid ${this.currentTheme.borderColor || '#3e3e3e'}; padding: 8px;">
                                        <div style="color: var(--text-primary); font-size: 12px;">Обводка</div>
                                    </div>
                                </div>
                                <div class="theme-color-info">
                                    <label>Цвет обводки</label>
                                    <span class="theme-color-hint">Рамки карточек и элементов</span>
                                </div>
                                <input type="color" id="borderColor" value="${this.currentTheme.borderColor || '#3e3e3e'}" oninput="themeManager.updateBorderColor('borderColor', this.value)" />
                            </div>

                            <div class="theme-color-item-v2">
                                <div class="theme-color-preview-wrapper">
                                    <div class="theme-color-preview" id="preview-borderHover" style="border: 2px solid ${this.currentTheme.borderHover || '#4e4e4e'}; padding: 8px;">
                                        <div style="color: var(--text-primary); font-size: 12px;">При наведении</div>
                                    </div>
                                </div>
                                <div class="theme-color-info">
                                    <label>Hover обводки</label>
                                    <span class="theme-color-hint">Цвет рамки при наведении</span>
                                </div>
                                <input type="color" id="borderHover" value="${this.currentTheme.borderHover || '#4e4e4e'}" oninput="themeManager.updateBorderColor('borderHover', this.value)" />
                            </div>
                        </div>

                        <div class="theme-color-group">
                            <div class="theme-color-group-title">Рейтинг</div>
                            
                            <div class="theme-color-item-v2">
                                <div class="theme-color-preview-wrapper">
                                    <div class="star-preview" id="preview-starEmpty">★</div>
                                </div>
                                <div class="theme-color-info">
                                    <label>Пустая звезда</label>
                                    <span class="theme-color-hint">Цвет незаполненных звезд</span>
                                </div>
                                <input type="color" id="starEmpty" value="${this.currentTheme.starEmpty || '#3e3e3e'}" oninput="themeManager.updateStarColor('starEmpty', this.value)" />
                            </div>

                            <div class="theme-color-item-v2">
                                <div class="theme-color-preview-wrapper">
                                    <div class="star-preview" id="preview-starFilled">★</div>
                                </div>
                                <div class="theme-color-info">
                                    <label>Заполненная звезда</label>
                                    <span class="theme-color-hint">Цвет заполненных звезд</span>
                                </div>
                                <input type="color" id="starFilled" value="${this.currentTheme.starFilled || '#ffcc80'}" oninput="themeManager.updateStarColor('starFilled', this.value)" />
                            </div>
                        </div>

                        <div class="theme-color-group">
                            <div class="theme-color-group-title">Шрифты</div>
                            
                            <div class="font-control">
                                <label>Семейство шрифта</label>
                                <select id="fontFamily" onchange="themeManager.updateFont('fontFamily', this.value)">
                                    <optgroup label="Рекомендуемые">
                                        <option value="Nunito, sans-serif" ${(this.currentTheme.fontFamily || 'Nunito, sans-serif') === 'Nunito, sans-serif' ? 'selected' : ''}>Nunito</option>
                                        <option value="Inter, sans-serif" ${this.currentTheme.fontFamily === 'Inter, sans-serif' ? 'selected' : ''}>Inter</option>
                                        <option value="Quicksand, sans-serif" ${this.currentTheme.fontFamily === 'Quicksand, sans-serif' ? 'selected' : ''}>Quicksand</option>
                                        <option value="Roboto, sans-serif" ${this.currentTheme.fontFamily === 'Roboto, sans-serif' ? 'selected' : ''}>Roboto</option>
                                        <option value="Open Sans, sans-serif" ${this.currentTheme.fontFamily === 'Open Sans, sans-serif' ? 'selected' : ''}>Open Sans</option>
                                        <option value="Lato, sans-serif" ${this.currentTheme.fontFamily === 'Lato, sans-serif' ? 'selected' : ''}>Lato</option>
                                        <option value="Poppins, sans-serif" ${this.currentTheme.fontFamily === 'Poppins, sans-serif' ? 'selected' : ''}>Poppins</option>
                                        <option value="Montserrat, sans-serif" ${this.currentTheme.fontFamily === 'Montserrat, sans-serif' ? 'selected' : ''}>Montserrat</option>
                                        <option value="Source Sans Pro, sans-serif" ${this.currentTheme.fontFamily === 'Source Sans Pro, sans-serif' ? 'selected' : ''}>Source Sans Pro</option>
                                    </optgroup>
                                    <optgroup label="Системные">
                                        <option value="Arial, sans-serif" ${this.currentTheme.fontFamily === 'Arial, sans-serif' ? 'selected' : ''}>Arial</option>
                                        <option value="Helvetica, sans-serif" ${this.currentTheme.fontFamily === 'Helvetica, sans-serif' ? 'selected' : ''}>Helvetica</option>
                                        <option value="Verdana, sans-serif" ${this.currentTheme.fontFamily === 'Verdana, sans-serif' ? 'selected' : ''}>Verdana</option>
                                        <option value="Georgia, serif" ${this.currentTheme.fontFamily === 'Georgia, serif' ? 'selected' : ''}>Georgia</option>
                                        <option value="Times New Roman, serif" ${this.currentTheme.fontFamily === 'Times New Roman, serif' ? 'selected' : ''}>Times New Roman</option>
                                        <option value="Courier New, monospace" ${this.currentTheme.fontFamily === 'Courier New, monospace' ? 'selected' : ''}>Courier New (моноширинный)</option>
                                    </optgroup>
                                </select>
                            </div>

                            <div class="font-control">
                                <label>Размер шрифта: <span id="fontSizeValue">${this.currentTheme.fontSize || '16px'}</span></label>
                                <input type="range" id="fontSize" min="12" max="24" value="${parseInt(this.currentTheme.fontSize) || 16}" oninput="themeManager.updateFontSize(this.value)" />
                            </div>
                        </div>
                    </div>
                    <!-- Импорт/Экспорт -->
                    <div class="theme-settings-section">
                        <h4>Импорт / Экспорт</h4>
                        <div class="theme-import-export">
                            <input type="file" id="themeFileInput" accept=".json" style="display: none" onchange="themeManager.importThemeFromFile(event)">
                            <button class="theme-action-btn" onclick="document.getElementById('themeFileInput').click()" title="Импортировать тему из локального JSON файла">
                                <span class="material-symbols-outlined">upload_file</span>
                                <span>Загрузить файл</span>
                            </button>
                            <button class="theme-action-btn" onclick="themeManager.importThemeFromURL()" title="Импортировать тему из GitHub или другого URL">
                                <span class="material-symbols-outlined">download</span>
                                <span>Импорт из URL</span>
                            </button>
                            <button class="theme-action-btn" onclick="themeManager.exportTheme()" title="Экспортировать текущую тему в JSON файл">
                                <span class="material-symbols-outlined">save</span>
                                <span>Экспорт темы</span>
                            </button>
                            <button class="theme-action-btn" onclick="themeManager.saveCurrentAsCustom()" title="Сохранить текущую тему в мои темы">
                                <span class="material-symbols-outlined">bookmark_add</span>
                                <span>Сохранить как...</span>
                            </button>
                        </div>
                        <div class="theme-import-hint">
                            💡 Загрузите локальный JSON файл, импортируйте из GitHub или сохраните текущую тему
                        </div>
                    </div>
                </div>
                <div class="theme-settings-footer">
                    <button class="theme-btn theme-btn-secondary" onclick="themeManager.resetTheme()">
                        🔄 Сбросить
                    </button>
                    <button class="theme-btn theme-btn-primary" onclick="themeManager.saveTheme()">
                        💾 Сохранить
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        // Добавляем обработчики для color picker'ов
        this.attachColorPickerListeners();

        // Закрытие по клику вне панели
        panel.addEventListener('click', (e) => {
            if (e.target === panel) {
                this.toggleSettingsPanel();
            }
        });
    }

    attachColorPickerListeners() {
        const colorInputs = {
            backgroundColor: 'backgroundColor',
            primaryColor: 'primaryColor',
            secondaryColor: 'secondaryColor',
            accentColor: 'accentColor',
            buttonColor: 'buttonColor',
            buttonHover: 'buttonHover',
            buttonTextColor: 'buttonTextColor',
            buttonTextHover: 'buttonTextHover',
            borderColor: 'borderColor',
            borderHover: 'borderHover',
            textPrimary: 'textPrimary',
            textSecondary: 'textSecondary',
            textTertiary: 'textTertiary',
            textMuted: 'textMuted'
        };

        Object.keys(colorInputs).forEach(inputId => {
            const input = document.getElementById(inputId);
            if (input) {
                input.addEventListener('input', (e) => {
                    this.updateTheme(colorInputs[inputId], e.target.value);
                    this.updatePreview(inputId, e.target.value);
                });
            }
        });
    }

    updatePreview(inputId, color) {
        const preview = document.getElementById(`preview-${inputId}`);
        if (preview) {
            if (inputId.includes('text') || inputId === 'buttonTextColor' || inputId === 'buttonTextHover') {
                preview.style.color = color;
            } else if (inputId === 'buttonColor') {
                const button = preview.querySelector('.theme-preview-button');
                if (button) button.style.background = color;
            } else if (inputId === 'buttonHover') {
                const button = preview.querySelector('.theme-preview-button-hover');
                if (button) button.style.background = color;
            } else if (inputId === 'borderColor' || inputId === 'borderHover') {
                preview.style.borderColor = color;
            } else {
                preview.style.background = color;
            }
        }
    }

    applyPreset(presetKey) {
        const preset = this.presets[presetKey];
        if (!preset) return;

        // Применяем тему из пресета
        this.currentTheme = { ...preset.theme };
        this.applyTheme();

        // Обновляем значения в color picker'ах
        Object.keys(preset.theme).forEach(key => {
            const input = document.getElementById(key);
            if (input) {
                input.value = preset.theme[key];
                this.updatePreview(key, preset.theme[key]);
            }
        });

        this.showNotification(`Тема "${preset.name}" применена! Не забудьте сохранить.`, 'success');
    }

    toggleSettingsPanel() {
        const panel = document.getElementById('themeSettingsPanel');
        if (panel) {
            panel.classList.toggle('active');
        }
    }

    async saveTheme() {
        await this.saveSettings();
        this.showNotification('Тема сохранена!');
        this.toggleSettingsPanel();
    }

    async importThemeFromURL() {
        const url = prompt('Введите URL JSON файла темы (например, GitHub raw URL):');
        if (!url) return;

        try {
            this.showNotification('Загрузка темы...', 'info');
            
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error('Не удалось загрузить тему');
            }

            const importData = await response.json();
            
            // Определяем формат (новый с категориями или старый)
            const themeData = importData.theme || importData;
            const categories = importData.categories || [];
            
            // Валидация темы
            if (!this.validateTheme(themeData)) {
                throw new Error('Неверный формат темы');
            }

            // Применяем тему
            this.currentTheme = { ...themeData };
            this.applyTheme();

            // Обновляем значения в UI
            Object.keys(themeData).forEach(key => {
                const input = document.getElementById(key);
                if (input) {
                    input.value = themeData[key];
                    this.updatePreview(key, themeData[key]);
                }
            });

            // Восстанавливаем категории, если они есть
            if (categories.length > 0) {
                await this.restoreCategories(categories);
                this.showNotification(`Тема импортирована! (${categories.length} категорий восстановлено)`, 'success');
            } else {
                this.showNotification('Тема успешно импортирована! Не забудьте сохранить.', 'success');
            }
        } catch (error) {
            console.error('Ошибка импорта темы:', error);
            this.showNotification(`Ошибка импорта: ${error.message}`, 'error');
        }
    }

    validateTheme(theme) {
        const requiredFields = [
            'backgroundColor', 'primaryColor', 'secondaryColor', 'accentColor',
            'textPrimary', 'textSecondary', 'textTertiary', 'textMuted'
        ];

        for (const field of requiredFields) {
            if (!theme[field] || !/^#[0-9A-Fa-f]{6}$/i.test(theme[field])) {
                return false;
            }
        }

        return true;
    }

    async exportTheme() {
        try {
            this.showNotification('Подготовка темы к экспорту...', 'info');
            
            // Загружаем категории с сервера
            const categories = await this.getCategoriesForExport();
            
            // Создаем объект для экспорта с темой и категориями
            const exportData = {
                theme: this.currentTheme,
                categories: categories,
                metadata: {
                    exportDate: new Date().toISOString(),
                    version: '1.0'
                }
            };
            
            const themeJSON = JSON.stringify(exportData, null, 2);
            const blob = new Blob([themeJSON], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'my-theme.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            this.showNotification(`Тема экспортирована! (${categories.length} категорий)`, 'success');
        } catch (error) {
            console.error('Ошибка экспорта темы:', error);
            this.showNotification('Ошибка экспорта темы', 'error');
        }
    }

    async getCategoriesForExport() {
        try {
            const response = await fetch(`${this.API_URL}/categories`);
            if (!response.ok) {
                throw new Error('Ошибка загрузки категорий');
            }
            const categories = await response.json();
            
            // Фильтруем только категории с иконками или фонами
            return categories.filter(cat => {
                if (typeof cat === 'string') return false;
                return cat.background || cat.icon;
            });
        } catch (error) {
            console.error('Ошибка загрузки категорий:', error);
            return [];
        }
    }

    async restoreCategories(categories) {
        try {
            this.showNotification(`Восстановление категорий (${categories.length})...`, 'info');
            
            let successCount = 0;
            let errorCount = 0;
            
            for (const category of categories) {
                try {
                    // Проверяем, существует ли категория
                    const existingCategories = await fetch(`${this.API_URL}/categories`).then(r => r.json());
                    const exists = existingCategories.some(cat => {
                        const name = typeof cat === 'string' ? cat : cat.name;
                        return name === category.name;
                    });
                    
                    if (exists) {
                        // Обновляем существующую категорию
                        const response = await fetch(`${this.API_URL}/categories/${encodeURIComponent(category.name)}`, {
                            method: 'PUT',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                name: category.name,
                                background: category.background,
                                icon: category.icon
                            })
                        });
                        
                        if (response.ok) {
                            successCount++;
                        } else {
                            errorCount++;
                        }
                    } else {
                        // Создаем новую категорию
                        const response = await fetch(`${this.API_URL}/categories`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                name: category.name,
                                background: category.background,
                                icon: category.icon
                            })
                        });
                        
                        if (response.ok) {
                            successCount++;
                        } else {
                            errorCount++;
                        }
                    }
                } catch (error) {
                    console.error(`Ошибка восстановления категории ${category.name}:`, error);
                    errorCount++;
                }
            }
            
            if (errorCount > 0) {
                this.showNotification(`Восстановлено: ${successCount}, ошибок: ${errorCount}`, 'warning');
            }
            
            // Обновляем страницу, если мы на странице категорий
            if (typeof renderCategories === 'function') {
                await renderCategories();
            }
            
        } catch (error) {
            console.error('Ошибка восстановления категорий:', error);
            this.showNotification('Ошибка восстановления категорий', 'error');
        }
    }

    showNotification(message, type = 'success') {
        // Ищем существующую нотификацию или создаем новую
        let notification = document.getElementById('themeNotification');
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'themeNotification';
            notification.className = 'theme-notification';
            document.body.appendChild(notification);
        }

        // Цвет уведомления в зависимости от типа
        const colors = {
            success: '#4caf50',
            warning: '#ff9800',
            error: '#f44336',
            info: '#2196f3'
        };

        notification.style.background = colors[type] || colors.success;
        notification.textContent = message;
        notification.classList.add('show');

        setTimeout(() => {
            notification.classList.remove('show');
        }, 3000);
    }

    changeBackgroundType(type) {
        this.currentTheme.backgroundType = type;
        
        document.getElementById('solidPanel').style.display = type === 'solid' ? 'block' : 'none';
        document.getElementById('gradientPanel').style.display = type === 'gradient' ? 'block' : 'none';
        document.getElementById('imagePanel').style.display = type === 'image' ? 'block' : 'none';
        
        this.applyTheme();
    }

    updateBackgroundColor(color) {
        this.currentTheme.backgroundColor = color;
        document.getElementById('preview-bgSolid').style.background = color;
        this.applyTheme();
    }

    updateGradient() {
        const color1 = document.getElementById('gradientColor1').value;
        const color2 = document.getElementById('gradientColor2').value;
        
        this.currentTheme.gradientColor1 = color1;
        this.currentTheme.gradientColor2 = color2;
        
        document.getElementById('preview-gradient1').style.background = color1;
        document.getElementById('preview-gradient2').style.background = color2;
        
        this.updateGradientPreview();
        this.applyTheme();
    }

    updateGradientAngle(angle) {
        this.currentTheme.gradientAngle = angle;
        document.getElementById('angleValue').textContent = angle;
        this.updateGradientPreview();
        this.applyTheme();
    }

    updateGradientPosition(colorNumber, position) {
        this.currentTheme[`gradientPosition${colorNumber}`] = position;
        document.getElementById(`position${colorNumber}Value`).textContent = position;
        this.updateGradientPreview();
        this.applyTheme();
    }

    updateGradientPreview() {
        const preview = document.getElementById('gradientPreview');
        if (preview) {
            const angle = this.currentTheme.gradientAngle || 135;
            const color1 = this.currentTheme.gradientColor1 || this.currentTheme.backgroundColor;
            const color2 = this.currentTheme.gradientColor2 || this.currentTheme.primaryColor;
            const pos1 = this.currentTheme.gradientPosition1 || 0;
            const pos2 = this.currentTheme.gradientPosition2 || 100;
            preview.style.background = `linear-gradient(${angle}deg, ${color1} ${pos1}%, ${color2} ${pos2}%)`;
        }
    }

    handleImageUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            this.showNotification('Пожалуйста, выберите изображение', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            this.currentTheme.backgroundImage = e.target.result;
            this.applyTheme();
            
            const panel = document.getElementById('themeSettingsPanel');
            if (panel) {
                const imagePanel = document.getElementById('imagePanel');
                const uploadControl = imagePanel.querySelector('.image-upload-control');
                
                if (!document.querySelector('.bg-image-preview')) {
                    const preview = document.createElement('div');
                    preview.className = 'bg-image-preview';
                    preview.style.backgroundImage = `url(${e.target.result})`;
                    
                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'theme-action-btn theme-action-btn-danger';
                    deleteBtn.onclick = () => this.removeBackgroundImage();
                    deleteBtn.innerHTML = `
                        <span class="material-symbols-outlined">delete</span>
                        <span>Удалить</span>
                    `;
                    
                    uploadControl.appendChild(preview);
                    uploadControl.appendChild(deleteBtn);
                }
            }
            
            this.showNotification('Изображение загружено!', 'success');
        };
        reader.readAsDataURL(file);
    }

    removeBackgroundImage() {
        this.currentTheme.backgroundImage = null;
        this.applyTheme();
        
        const preview = document.querySelector('.bg-image-preview');
        const deleteBtn = document.querySelector('.theme-action-btn-danger');
        
        if (preview) preview.remove();
        if (deleteBtn) deleteBtn.remove();
        
        this.showNotification('Изображение удалено', 'info');
    }

    updateStarColor(type, color) {
        this.currentTheme[type] = color;
        const preview = document.getElementById(`preview-${type}`);
        if (preview) {
            preview.style.color = color;
        }
        this.applyTheme();
    }

    updateBorderColor(type, color) {
        this.currentTheme[type] = color;
        const preview = document.getElementById(`preview-${type}`);
        if (preview) {
            preview.style.borderColor = color;
        }
        this.applyTheme();
        this.showNotification(`Цвет обводки обновлён: ${color}`, 'success');
    }

    updateFont(property, value) {
        this.currentTheme[property] = value;
        this.applyTheme();
    }

    updateFontSize(size) {
        this.currentTheme.fontSize = size + 'px';
        document.getElementById('fontSizeValue').textContent = size + 'px';
        this.applyTheme();
    }

    async importThemeFromFile(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const importData = JSON.parse(e.target.result);
                
                // Определяем формат (новый с категориями или старый)
                const themeData = importData.theme || importData;
                const categories = importData.categories || [];
                
                if (!this.validateTheme(themeData)) {
                    throw new Error('Некорректный формат темы');
                }

                // Применяем тему
                this.currentTheme = { ...themeData };
                this.applyTheme();

                // Обновляем UI
                Object.keys(themeData).forEach(key => {
                    const input = document.getElementById(key);
                    if (input) {
                        input.value = themeData[key];
                        this.updatePreview(key, themeData[key]);
                    }
                });

                // Восстанавливаем категории, если они есть
                if (categories.length > 0) {
                    await this.restoreCategories(categories);
                    this.showNotification(`Тема загружена! (${categories.length} категорий восстановлено)`, 'success');
                } else {
                    this.showNotification('Тема загружена! Не забудьте сохранить.', 'success');
                }
            } catch (error) {
                console.error('Ошибка загрузки темы:', error);
                this.showNotification(`Ошибка: ${error.message}`, 'error');
            }
        };
        reader.readAsText(file);
    }

    saveCurrentAsCustom() {
        const name = prompt('Введите название темы:');
        if (!name) return;

        const customTheme = { ...this.currentTheme, name };
        this.customThemes.push(customTheme);
        this.saveCustomThemes();
        
        // Обновляем панель
        const panel = document.getElementById('themeSettingsPanel');
        if (panel) {
            panel.remove();
            this.createSettingsPanel();
        }
        
        this.showNotification(`Тема "${name}" сохранена!`, 'success');
    }

    applyCustomTheme(index) {
        const theme = this.customThemes[index];
        if (!theme) return;

        this.currentTheme = { ...theme };
        this.applyTheme();

        // Обновляем значения в UI
        Object.keys(theme).forEach(key => {
            const input = document.getElementById(key);
            if (input) {
                input.value = theme[key];
                this.updatePreview(key, theme[key]);
            }
        });

        this.showNotification(`Тема "${theme.name}" применена! Не забудьте сохранить.`, 'success');
    }

    deleteCustomTheme(index) {
        const theme = this.customThemes[index];
        if (!theme) return;

        if (confirm(`Удалить тему "${theme.name}"?`)) {
            this.customThemes.splice(index, 1);
            this.saveCustomThemes();
            
            // Обновляем панель
            const panel = document.getElementById('themeSettingsPanel');
            if (panel) {
                panel.remove();
                this.createSettingsPanel();
            }
            
            this.showNotification('Тема удалена', 'info');
        }
    }
}

// Инициализация при загрузке страницы
let themeManager;
document.addEventListener('DOMContentLoaded', () => {
    themeManager = new ThemeManager();
});

