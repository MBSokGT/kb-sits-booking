#!/bin/bash

echo "🚀 КБ Ситс - Деплой на Cloudflare Pages"
echo "========================================"
echo ""

# Проверка установки wrangler
if ! command -v wrangler &> /dev/null; then
    echo "❌ Wrangler не установлен. Устанавливаю..."
    npm install -g wrangler
fi

echo "✅ Wrangler установлен"
echo ""

# Проверка авторизации
echo "🔐 Проверка авторизации..."
if ! wrangler whoami &> /dev/null; then
    echo "❌ Не авторизован. Запускаю авторизацию..."
    wrangler login
else
    echo "✅ Авторизован"
fi

echo ""
echo "📦 Деплой проекта..."
wrangler pages deploy . --project-name=kb-sits

echo ""
echo "✅ Деплой завершён!"
echo ""
echo "🌐 Ваш сайт доступен по адресу:"
echo "   https://kb-sits.pages.dev"
echo ""
echo "📝 Для настройки кастомного домена:"
echo "   https://dash.cloudflare.com → Pages → kb-sits → Custom domains"
