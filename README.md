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

- `HOST` — интерфейс для bind (в проде лучше `127.0.0.1` за nginx)
- `PORT` — порт HTTP сервера
- `DB_FILE` — путь к SQLite файлу
- `BODY_LIMIT` — лимит тела запроса

Безопасность:

- `CORS_ORIGINS` — whitelist origin через запятую

Первичный админ (рекомендуется на первом старте):

- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD`
- `BOOTSTRAP_ADMIN_NAME`
- `BOOTSTRAP_ADMIN_DEPARTMENT`

Примечание:

- Email-рассылки и восстановление пароля по email отключены.
- Сброс пароля выполняется администратором в разделе пользователей.

## Прод-деплой для `booking.cb.msk` (Ubuntu 24.04)

Целевой профиль:

- Сервер: `Ubuntu 24.04`, `2 vCPU`, `4 GB RAM`, `40 GB HDD`
- Домен: `booking.cb.msk`
- Доступ: только из корпоративной сети / VPN

### 1. Установка зависимостей

```bash
sudo apt update
sudo apt install -y nginx nodejs npm git ufw
```

### 2. Развертывание приложения

```bash
sudo mkdir -p /opt/kb-sits-booking
sudo chown -R $USER:$USER /opt/kb-sits-booking
git clone https://github.com/MBSokGT/kb-sits-booking.git /opt/kb-sits-booking
cd /opt/kb-sits-booking
npm ci
cp .env.example .env
```

### 3. Настройка `.env` для внутреннего контура

Минимально проверьте значения:

```env
HOST=127.0.0.1
PORT=3000
CORS_ORIGINS=http://booking.cb.msk
# при HTTPS замените на https://booking.cb.msk
```

### 4. Systemd сервис

```bash
sudo cp deploy/systemd/kb-sits.service /etc/systemd/system/kb-sits.service
sudo systemctl daemon-reload
sudo systemctl enable kb-sits
sudo systemctl restart kb-sits
sudo systemctl status kb-sits
```

Логи:

```bash
sudo journalctl -u kb-sits -f
```

### 5. Nginx

```bash
sudo cp deploy/nginx/booking.cb.msk.conf /etc/nginx/sites-available/booking.cb.msk.conf
sudo ln -sf /etc/nginx/sites-available/booking.cb.msk.conf /etc/nginx/sites-enabled/booking.cb.msk.conf
sudo nginx -t
sudo systemctl reload nginx
```

### 6. Ограничение доступа только из корпсети/VPN

В `deploy/nginx/booking.cb.msk.conf` уже есть `allow/deny`. Обязательно замените CIDR на реальные подсети вашей компании.

Дополнительно можно ограничить входящий трафик firewall:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH

# Примеры, замените на реальные корпоративные CIDR:
sudo ufw allow from 10.0.0.0/8 to any port 80 proto tcp
sudo ufw allow from 172.16.0.0/12 to any port 80 proto tcp
sudo ufw allow from 192.168.0.0/16 to any port 80 proto tcp

sudo ufw enable
sudo ufw status verbose
```
