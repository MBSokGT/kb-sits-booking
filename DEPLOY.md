# Деплой на GitHub Pages

## Быстрый деплой

```bash
# 1. Убедитесь что все изменения закоммичены
git add -A
git commit -m "Готово к деплою"
git push

# 2. Создайте ветку gh-pages
git checkout -b gh-pages
git push origin gh-pages

# 3. Включите GitHub Pages
# Перейдите: Settings → Pages → Source: gh-pages → Save
```

## Настройка Supabase для production

1. Создайте проект на https://supabase.com
2. Скопируйте URL и anon key
3. Обновите `config.js`:

```javascript
const SUPABASE_CONFIG = {
  url: 'https://your-project.supabase.co',
  anonKey: 'your-anon-key'
};
```

4. Примените схему БД:
   - Откройте SQL Editor в Supabase
   - Скопируйте содержимое `supabase-schema.sql`
   - Выполните

## Автоматический деплой

Создайте `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Deploy
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: .
```

Теперь при каждом push в main будет автоматический деплой!
