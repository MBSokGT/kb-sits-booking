# 🚀 Быстрый старт деплоя

## Вариант 1: Автоматический деплой (рекомендуется)

Откройте терминал и выполните:

```bash
cd "/Users/admin/Desktop/ КБ Ситс"
./deploy.sh
```

Скрипт автоматически:
1. Проверит установку wrangler
2. Авторизует вас в Cloudflare (откроет браузер)
3. Задеплоит проект

---

## Вариант 2: Ручной деплой

### Шаг 1: Установите wrangler
```bash
npm install -g wrangler
```

### Шаг 2: Авторизуйтесь
```bash
wrangler login
```
Откроется браузер для авторизации в Cloudflare.

### Шаг 3: Деплой
```bash
cd "/Users/admin/Desktop/ КБ Ситс"
wrangler pages deploy . --project-name=kb-sits
```

---

## После деплоя

Ваш сайт будет доступен по адресу:
**https://kb-sits.pages.dev**

### Настройка кастомного домена
1. Зайдите на https://dash.cloudflare.com
2. Pages → kb-sits → Custom domains
3. Добавьте ваш домен

### Настройка переменных окружения (опционально)
```bash
# Email уведомления через Resend
wrangler pages secret put RESEND_API_KEY --project-name=kb-sits
wrangler pages secret put EMAIL_FROM --project-name=kb-sits
wrangler pages secret put APP_BASE_URL --project-name=kb-sits
```

---

## Обновление сайта

После внесения изменений:
```bash
cd "/Users/admin/Desktop/ КБ Ситс"
wrangler pages deploy . --project-name=kb-sits
```

Или просто:
```bash
./deploy.sh
```

---

## Проблемы?

### "wrangler: command not found"
```bash
npm install -g wrangler
```

### "Not authenticated"
```bash
wrangler login
```

### Проверка логов
```bash
wrangler pages deployment tail --project-name=kb-sits
```

---

**Готово! Запустите `./deploy.sh` для деплоя** 🎉
