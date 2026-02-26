#!/bin/bash

echo "🚀 Деплой КБ Ситс на Vercel"
echo ""

# Проверка Vercel CLI
if ! command -v vercel &> /dev/null; then
    echo "❌ Vercel CLI не установлен"
    echo "Установите: npm i -g vercel"
    exit 1
fi

# Проверка config.js
if grep -q "ваш-проект.supabase.co" config.js; then
    echo "⚠️  ВНИМАНИЕ: Обновите config.js с вашими Supabase ключами!"
    echo ""
    echo "1. Откройте https://supabase.com/dashboard"
    echo "2. Settings → API"
    echo "3. Скопируйте URL и anon key в config.js"
    echo ""
    read -p "Продолжить деплой? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Деплой
echo ""
echo "📦 Запуск деплоя..."
vercel --prod

echo ""
echo "✅ Готово!"
