# 🚀 Деплой на Cloudflare Pages

## ✅ Исправления применены

### 1. Администрирование → Пользователи
- ✅ Добавлено редактирование отдела (inline input)
- ✅ Добавлен просмотр текущего пароля
- ✅ Добавлена замена пароля
- ✅ Синхронизация с localStorage (готово к миграции на Supabase)

### 2. Навигация в админке
- ✅ Исправлена проблема с переключением между вкладками
- ✅ Добавлены `return` statements для предотвращения множественного рендеринга

### 3. Модальное окно
- ✅ Добавлен `overflow:hidden` для предотвращения выхода контента за границы

---

## 📦 Шаги деплоя

### Вариант 1: Через GitHub (рекомендуется)

#### 1. Создайте репозиторий на GitHub
```bash
cd "/Users/admin/Desktop/ КБ Ситс"
git init
git add .
git commit -m "Initial commit: КБ Ситс booking system"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/kb-sits-booking.git
git push -u origin main
```

#### 2. Подключите к Cloudflare Pages
1. Зайдите на https://dash.cloudflare.com
2. Pages → Create a project → Connect to Git
3. Выберите ваш репозиторий `kb-sits-booking`
4. Настройки сборки:
   - **Framework preset**: None
   - **Build command**: (оставьте пустым)
   - **Build output directory**: `/`
   - **Root directory**: `/`

#### 3. Настройте переменные окружения (опционально)
В разделе Settings → Environment variables добавьте:
```
CORS_ORIGINS=https://kb-sits.pages.dev
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_xxxxx
EMAIL_FROM=KB Sits <noreply@yourdomain.com>
APP_BASE_URL=https://kb-sits.pages.dev
```

#### 4. Deploy
- Нажмите "Save and Deploy"
- Ваш сайт будет доступен по адресу: `https://kb-sits.pages.dev`

---

### Вариант 2: Прямая загрузка (быстрый старт)

#### 1. Установите Wrangler CLI
```bash
npm install -g wrangler
```

#### 2. Авторизуйтесь
```bash
wrangler login
```

#### 3. Создайте проект
```bash
cd "/Users/admin/Desktop/ КБ Ситс"
wrangler pages project create kb-sits
```

#### 4. Деплой
```bash
wrangler pages deploy . --project-name=kb-sits
```

---

## 🗄️ Настройка Cloudflare D1 (опционально)

### 1. Создайте базу данных
```bash
wrangler d1 create kb-sits-db
```

Скопируйте `database_id` из вывода.

### 2. Создайте `wrangler.toml`
```toml
name = "kb-sits"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "kb-sits-db"
database_id = "YOUR_DATABASE_ID"
```

### 3. Примените схему
```bash
wrangler d1 execute kb-sits-db --file=d1-schema.sql --remote
```

### 4. Обновите `functions/_middleware.js`
```javascript
export async function onRequest(context) {
  context.env.DB = context.env.DB; // D1 binding
  return await context.next();
}
```

---

## 🔐 Настройка Resend для email

### 1. Зарегистрируйтесь на https://resend.com

### 2. Получите API ключ
- Dashboard → API Keys → Create API Key

### 3. Добавьте домен (опционально)
- Dashboard → Domains → Add Domain
- Добавьте DNS записи

### 4. Настройте переменные в Cloudflare Pages
```bash
wrangler pages secret put RESEND_API_KEY --project-name=kb-sits
# Введите ваш API ключ

wrangler pages secret put EMAIL_FROM --project-name=kb-sits
# Введите: KB Sits <noreply@yourdomain.com>
```

---

## 🌐 Кастомный домен

### 1. В Cloudflare Pages
- Settings → Custom domains → Set up a custom domain
- Введите ваш домен: `booking.yourcompany.com`

### 2. Добавьте DNS запись
```
Type: CNAME
Name: booking
Target: kb-sits.pages.dev
Proxy: Enabled (оранжевое облако)
```

---

## 📊 Мониторинг

### Cloudflare Analytics
- Автоматически доступна в Pages → Analytics
- Показывает посещения, запросы, ошибки

### Логи
```bash
wrangler pages deployment tail --project-name=kb-sits
```

---

## 🔄 Обновление

### Через Git
```bash
git add .
git commit -m "Update: описание изменений"
git push
```
Cloudflare автоматически задеплоит изменения.

### Прямая загрузка
```bash
wrangler pages deploy . --project-name=kb-sits
```

---

## 🐛 Отладка

### Проверка логов
```bash
wrangler pages deployment tail --project-name=kb-sits
```

### Локальная разработка
```bash
# Без D1
python3 -m http.server 8000

# С D1
wrangler pages dev . --d1 DB=YOUR_DATABASE_ID
```

### Проверка Functions
```bash
curl https://kb-sits.pages.dev/api/bookings
```

---

## 📝 Чеклист перед продакшеном

- [ ] Удалить демо-пароли из кода
- [ ] Настроить Supabase или D1
- [ ] Включить HTTPS (автоматически в Cloudflare)
- [ ] Настроить Content Security Policy
- [ ] Добавить rate limiting
- [ ] Настроить email уведомления
- [ ] Провести security audit
- [ ] Настроить бэкапы
- [ ] Добавить мониторинг ошибок (Sentry)
- [ ] Протестировать на мобильных устройствах

---

## 🆘 Поддержка

### Cloudflare
- Документация: https://developers.cloudflare.com/pages/
- Community: https://community.cloudflare.com/

### Проект
- GitHub Issues: https://github.com/YOUR_USERNAME/kb-sits-booking/issues

---

**Готово к деплою!** 🎉
