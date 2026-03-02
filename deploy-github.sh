#!/bin/bash

echo "📦 КБ Ситс - Деплой на GitHub"
echo "=============================="
echo ""

# Проверка git
if ! command -v git &> /dev/null; then
    echo "❌ Git не установлен"
    exit 1
fi

echo "✅ Git установлен"
echo ""

# Инициализация репозитория
if [ ! -d .git ]; then
    echo "🔧 Инициализация git репозитория..."
    git init
    echo "✅ Репозиторий инициализирован"
else
    echo "✅ Git репозиторий уже существует"
fi

echo ""
echo "📝 Добавление файлов..."
git add .

echo ""
echo "💾 Создание коммита..."
git commit -m "Initial commit: КБ Ситс - система бронирования мест" || echo "⚠️  Нет изменений для коммита"

echo ""
echo "🌿 Переименование ветки в main..."
git branch -M main

echo ""
echo "🔗 Теперь создайте репозиторий на GitHub:"
echo "   1. Откройте https://github.com/new"
echo "   2. Название: kb-sits-booking"
echo "   3. Описание: Система бронирования мест в коворкинге"
echo "   4. Public или Private - на ваш выбор"
echo "   5. НЕ добавляйте README, .gitignore или license"
echo "   6. Нажмите 'Create repository'"
echo ""
read -p "Нажмите Enter после создания репозитория на GitHub..."

echo ""
read -p "Введите ваш GitHub username: " github_user

if [ -z "$github_user" ]; then
    echo "❌ Username не может быть пустым"
    exit 1
fi

echo ""
echo "🔗 Добавление remote origin..."
git remote remove origin 2>/dev/null
git remote add origin "https://github.com/$github_user/kb-sits-booking.git"

echo ""
echo "🚀 Отправка на GitHub..."
git push -u origin main

echo ""
echo "✅ Деплой на GitHub завершён!"
echo ""
echo "🌐 Ваш репозиторий:"
echo "   https://github.com/$github_user/kb-sits-booking"
echo ""
echo "🔗 Подключите к Cloudflare Pages:"
echo "   1. https://dash.cloudflare.com → Pages"
echo "   2. Create a project → Connect to Git"
echo "   3. Выберите репозиторий kb-sits-booking"
echo "   4. Framework preset: None"
echo "   5. Build command: (пусто)"
echo "   6. Build output directory: /"
echo "   7. Save and Deploy"
