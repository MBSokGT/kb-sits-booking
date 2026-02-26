# Техническое задание на развертывание системы бронирования КБ Ситс

## Описание проекта
Веб-приложение для бронирования рабочих мест в коворкинге с визуальным редактором планировки, календарем и системой ролей.

## Требования к инфраструктуре

### 1. Веб-сервер
**Что нужно:**
- Nginx или Apache
- Поддержка статических файлов (HTML/CSS/JS)
- SSL сертификат (HTTPS обязателен для WebSocket)

**Конфигурация:**
```nginx
server {
    listen 443 ssl;
    server_name coworking.company.ru;
    
    root /var/www/kb-sits;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### 2. База данных PostgreSQL 14+
**Что нужно:**
- PostgreSQL 14 или выше
- Расширения: `uuid-ossp`, `pg_notify`
- Минимум 2GB RAM, 10GB диска

**Создание БД:**
```sql
CREATE DATABASE kb_sits;
CREATE USER kb_sits_user WITH PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE kb_sits TO kb_sits_user;
```

**Импорт схемы:**
```bash
psql -U kb_sits_user -d kb_sits -f supabase-schema.sql
```

### 3. Backend API (Supabase Self-Hosted или аналог)

**Вариант А: Supabase Self-Hosted (рекомендуется)**
```bash
git clone https://github.com/supabase/supabase
cd supabase/docker
cp .env.example .env
# Настроить .env с вашими параметрами
docker-compose up -d
```

**Требования:**
- Docker + Docker Compose
- 4GB RAM минимум
- Порты: 3000 (Studio), 8000 (API), 5432 (PostgreSQL)

**Вариант Б: PostgREST + Realtime сервер**
Если не хотите Supabase, нужно развернуть:
1. PostgREST (REST API для PostgreSQL)
2. Realtime сервер (WebSocket для синхронизации)
3. Auth сервер (JWT авторизация)

### 4. Конфигурация приложения

**Файл `config.js`:**
```javascript
const SUPABASE_CONFIG = {
  url: 'https://api.coworking.company.ru',  // URL вашего API
  anonKey: 'ваш-jwt-ключ'  // JWT ключ из Supabase
};
```

### 5. Системные требования

**Минимальные:**
- CPU: 2 ядра
- RAM: 4GB
- Диск: 20GB SSD
- ОС: Ubuntu 20.04+ / Debian 11+

**Рекомендуемые:**
- CPU: 4 ядра
- RAM: 8GB
- Диск: 50GB SSD
- ОС: Ubuntu 22.04 LTS

### 6. Сетевые требования

**Открытые порты:**
- 443 (HTTPS) - веб-интерфейс
- 8000 (HTTPS) - REST API
- 5432 (внутренний) - PostgreSQL
- WebSocket (wss://) - для real-time синхронизации

**Firewall:**
```bash
ufw allow 443/tcp
ufw allow 8000/tcp
ufw enable
```

### 7. Резервное копирование

**PostgreSQL:**
```bash
# Ежедневный бэкап
0 2 * * * pg_dump -U kb_sits_user kb_sits > /backup/kb_sits_$(date +\%Y\%m\%d).sql
```

**Файлы приложения:**
```bash
# Еженедельный бэкап
0 3 * * 0 tar -czf /backup/kb_sits_files_$(date +\%Y\%m\%d).tar.gz /var/www/kb-sits
```

### 8. Мониторинг

**Что отслеживать:**
- Доступность веб-сервера (uptime)
- Нагрузка на PostgreSQL (connections, queries)
- Использование диска (логи, бэкапы)
- WebSocket соединения (real-time работает?)

**Инструменты:**
- Prometheus + Grafana
- pgAdmin для PostgreSQL
- Nginx access/error logs

### 9. Безопасность

**Обязательно:**
- SSL сертификат (Let's Encrypt)
- Firewall (ufw/iptables)
- Регулярные обновления ОС
- Сложные пароли для БД
- JWT токены с коротким TTL

**Рекомендуется:**
- Fail2ban для защиты от брутфорса
- Rate limiting на API
- CORS настройки
- Регулярный аудит логов

### 10. Демо-данные

**Тестовые аккаунты:**
```
Администратор: admin@demo.ru / admin123
Менеджер: manager@demo.ru / pass123
Сотрудник: user@demo.ru / pass123
```

**ВАЖНО:** Удалить или сменить пароли перед продакшеном!

## Инструкция по развертыванию

### Шаг 1: Подготовка сервера
```bash
apt update && apt upgrade -y
apt install -y nginx postgresql-14 docker.io docker-compose git
```

### Шаг 2: Настройка PostgreSQL
```bash
sudo -u postgres psql
CREATE DATABASE kb_sits;
CREATE USER kb_sits_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE kb_sits TO kb_sits_user;
\q
```

### Шаг 3: Развертывание Supabase
```bash
git clone https://github.com/supabase/supabase
cd supabase/docker
cp .env.example .env
nano .env  # Настроить параметры
docker-compose up -d
```

### Шаг 4: Импорт схемы БД
```bash
psql -U kb_sits_user -d kb_sits -f supabase-schema.sql
```

### Шаг 5: Деплой фронтенда
```bash
cd /var/www
git clone https://github.com/your-repo/kb-sits.git
cd kb-sits
nano config.js  # Вставить URL и ключи API
```

### Шаг 6: Настройка Nginx
```bash
nano /etc/nginx/sites-available/kb-sits
# Вставить конфигурацию
ln -s /etc/nginx/sites-available/kb-sits /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

### Шаг 7: SSL сертификат
```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d coworking.company.ru
```

### Шаг 8: Проверка
- Откройте https://coworking.company.ru
- Войдите как admin@demo.ru / admin123
- Создайте тестовое бронирование
- Откройте в другом браузере - проверьте синхронизацию

## Контакты для вопросов
- GitHub: https://github.com/MBSokGT/kb-sits-booking
- Документация: см. README.md и DEPLOY.md в репозитории

## Чек-лист готовности
- [ ] Сервер с Ubuntu 20.04+
- [ ] PostgreSQL 14+ установлен
- [ ] Supabase развернут (или PostgREST + Realtime)
- [ ] Nginx настроен
- [ ] SSL сертификат получен
- [ ] БД схема импортирована
- [ ] config.js настроен с правильными ключами
- [ ] Firewall настроен
- [ ] Бэкапы настроены
- [ ] Тестовый вход работает
- [ ] Real-time синхронизация работает
