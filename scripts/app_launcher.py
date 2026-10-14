"""
Легковесный launcher для веб-приложения
Запускает Node.js сервер и открывает приложение в нативном окне
"""

import webview
import subprocess
import sys
import os
import time
import socket
import threading
import webbrowser

# Порт для сервера
PORT = 3000

def find_free_port():
    """Находит свободный порт"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        s.listen(1)
        port = s.getsockname()[1]
    return port

def is_port_in_use(port):
    """Проверяет, занят ли порт"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('localhost', port)) == 0

def start_server():
    """Запускает Node.js сервер"""
    try:
        # Получаем путь к директории приложения
        if getattr(sys, 'frozen', False):
            # Если запущено из exe
            application_path = os.path.dirname(sys.executable)
        else:
            # Если запущено из Python
            application_path = os.path.dirname(os.path.abspath(__file__))
        
        # Переходим в директорию приложения
        os.chdir(application_path)
        
        # Запускаем сервер
        server_process = subprocess.Popen(
            ['node', 'server.js'],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
        )
        
        # Ждем, пока сервер запустится
        max_attempts = 30
        for attempt in range(max_attempts):
            if is_port_in_use(PORT):
                print(f"Сервер запущен на порту {PORT}")
                return server_process
            time.sleep(0.5)
        
        print("Не удалось запустить сервер")
        return None
        
    except Exception as e:
        print(f"Ошибка при запуске сервера: {e}")
        return None

def create_window():
    """Создает окно приложения"""
    try:
        # Запускаем сервер в отдельном потоке
        server_thread = threading.Thread(target=start_server, daemon=True)
        server_thread.start()
        
        # Ждем запуска сервера
        time.sleep(2)
        
        # Создаем окно
        window = webview.create_window(
            title='Менеджер Фильмов и Сериалов',
            url=f'http://localhost:{PORT}/',
            width=1400,
            height=900,
            resizable=True,
            fullscreen=False,
            min_size=(1000, 600),
            background_color='#1a1a1a'
        )
        
        webview.start(debug=False)
        
    except Exception as e:
        print(f"Ошибка при создании окна: {e}")
        # Если webview не работает, открываем в браузере
        webbrowser.open(f'http://localhost:{PORT}/')
        input("Нажмите Enter для выхода...")

if __name__ == '__main__':
    create_window()

