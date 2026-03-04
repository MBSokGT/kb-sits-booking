# КБ Ситс — Node.js версия

Сервис бронирования мест в коворкинге.

## Что изменилось

- Бэкенд перенесен на обычный `Node.js + Express`.
- Хранение данных: локальный `SQLite` файл (`better-sqlite3`).
- API оставлен совместимым с текущим фронтом (`/api/auth/*`, `/api/users*`, `/api/bookings*`, `/api/kv/*`).
- `docker-compose.yml` теперь для самого приложения, без внешних зависимостей инфраструктуры.

## Быстрый старт (без Docker)

1. Установить Node.js 20+.
2. Склонировать репозиторий:

```bash
git clone https://github.com/MBSokGT/kb-sits-booking.git
cd kb-sits-booking
```

3. Установить зависимости:

```bash
npm install
```

4. Настроить переменные:

```bash
cp .env.example .env
```

5. Запустить:

```bash
npm start
```

Приложение будет доступно на `http://localhost:3000`.

## Запуск через Docker Compose

```bash
cp .env.example .env
docker compose up -d --build
docker compose logs -f
```

- Порт по умолчанию: `3000`
- Данные SQLite хранятся в volume: `kb_sits_data`

## Переменные окружения

Основные:

- `PORT` — порт HTTP сервера
- `DB_FILE` — путь к SQLite файлу
- `BODY_LIMIT` — лимит тела запроса

Безопасность:

- `CORS_ORIGINS` — whitelist origin через запятую
- `RESET_TOKEN_PEPPER` — секрет для токенов сброса пароля

Первичный админ (рекомендуется):

- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD`
- `BOOTSTRAP_ADMIN_NAME`
- `BOOTSTRAP_ADMIN_DEPARTMENT`

## Прод-деплой на Linux (systemd)

Пример unit-файла `/etc/systemd/system/kb-sits.service`:

```ini
[Unit]
Description=KB Sits Node Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/kb-sits-booking
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=3
Environment=NODE_ENV=production
EnvironmentFile=/opt/kb-sits-booking/.env
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

Команды:

```bash
sudo systemctl daemon-reload
sudo systemctl enable kb-sits
sudo systemctl start kb-sits
sudo systemctl status kb-sits
```

## Nginx reverse proxy (пример)

```nginx
server {
    listen 80;
    server_name kb.example.ru;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
