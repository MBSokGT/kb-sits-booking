# 🚀 Инструкция по настройке Supabase для КБ Ситс

## Шаг 1: Запуск Supabase локально через Docker

```bash
# Клонируйте Supabase (если ещё не сделали)
git clone --depth 1 https://github.com/supabase/supabase

# Перейдите в папку с Docker
cd supabase/docker

# Запустите Supabase
docker-compose up -d
```

После запуска Supabase будет доступен:
- **Studio UI**: http://localhost:3000
- **API URL**: http://localhost:54321
- **DB URL**: postgresql://postgres:postgres@localhost:54322/postgres

## Шаг 2: Применение SQL схемы

1. Откройте Supabase Studio: http://localhost:3000
2. Перейдите в раздел **SQL Editor**
3. Скопируйте содержимое файла `supabase-schema.sql`
4. Вставьте в редактор и нажмите **Run**

Или через командную строку:

```bash
psql postgresql://postgres:postgres@localhost:54322/postgres -f supabase-schema.sql
```

## Шаг 3: Получение API ключей

1. В Supabase Studio перейдите в **Settings** → **API**
2. Скопируйте:
   - `anon` (public) key
   - `service_role` (secret) key
   - Project URL

## Шаг 4: Настройка проекта

Создайте файл `config.js` в корне проекта:

```javascript
// config.js
const SUPABASE_CONFIG = {
  url: 'http://localhost:54321',
  anonKey: 'ВАШ_ANON_KEY_ЗДЕСЬ'
};
```

## Шаг 5: Подключение Supabase JS Client

Добавьте в `index.html` перед закрывающим тегом `</body>`:

```html
<!-- Supabase JS Client -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="config.js"></script>
```

## Шаг 6: Хеширование паролей

Демо-пароли в SQL нужно заменить на реальные хеши. Используйте bcrypt:

```bash
# Установите bcrypt-cli
npm install -g bcrypt-cli

# Создайте хеши
bcrypt-cli hash admin123 10
bcrypt-cli hash pass123 10
```

Замените `$2a$10$example_hash_*` в SQL на реальные хеши.

## Шаг 7: Настройка автоматического истечения бронирований

Создайте cron job в Supabase (через pg_cron):

```sql
-- Включите расширение pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Запускайте функцию каждые 15 минут
SELECT cron.schedule(
  'expire-bookings',
  '*/15 * * * *',
  'SELECT expire_old_bookings();'
);
```

## 📊 Структура базы данных

### Таблицы:
1. **departments** - Отделы компании
2. **users** - Пользователи системы
3. **floors** - Этажи офиса
4. **zones** - Зоны на этажах
5. **seats** - Места в зонах
6. **bookings** - Бронирования

### Связи:
- users → departments (многие к одному)
- zones → floors (многие к одному)
- seats → zones (многие к одному)
- bookings → seats, users (многие к одному)

## 🔒 Безопасность (RLS)

Row Level Security настроен для всех таблиц:

- **Сотрудники**: видят всех, бронируют только для себя
- **Руководители**: бронируют для своего отдела
- **Администраторы**: полный доступ ко всему

## 🧪 Тестирование

Проверьте подключение:

```javascript
// В консоли браузера
const { createClient } = supabase;
const client = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);

// Проверка подключения
const { data, error } = await client.from('departments').select('*');
console.log(data, error);
```

## 📝 Следующие шаги

1. ✅ Применить SQL схему
2. ⏳ Создать `supabase-api.js` - обёртку для API
3. ⏳ Обновить `app.js` - заменить localStorage на Supabase
4. ⏳ Добавить real-time обновления
5. ⏳ Настроить миграцию данных из localStorage

## 🆘 Полезные команды

```bash
# Остановить Supabase
docker-compose down

# Перезапустить с очисткой данных
docker-compose down -v
docker-compose up -d

# Посмотреть логи
docker-compose logs -f

# Бэкап базы
docker exec supabase_db_kb_sits pg_dump -U postgres postgres > backup.sql

# Восстановление
docker exec -i supabase_db_kb_sits psql -U postgres postgres < backup.sql
```

## 📚 Документация

- [Supabase Docs](https://supabase.com/docs)
- [Supabase JS Client](https://supabase.com/docs/reference/javascript/introduction)
- [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
