# ✅ Тестирование подключения Supabase

## Что уже сделано:

1. ✅ **config.js** обновлён с вашими данными:
   - URL: `http://127.0.0.1:54321`
   - Key: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

2. ✅ **index.html** обновлён:
   - Добавлено подключение Supabase JS Client
   - Добавлены скрипты: config.js, supabase-api.js, migration.js

## 🧪 Проверка подключения

### Шаг 1: Откройте приложение
```bash
open "/Users/admin/Desktop/ КБ Ситс/index.html"
```

### Шаг 2: Откройте консоль браузера (F12)

### Шаг 3: Проверьте подключение
```javascript
// Проверка, что Supabase загружен
console.log('Supabase:', typeof supabase);
console.log('Config:', SUPABASE_CONFIG);
console.log('API:', typeof api);

// Тест подключения к БД
const { data, error } = await api.client.from('departments').select('*');
console.log('Departments:', data, error);
```

### Ожидаемый результат:
```
Supabase: object
Config: {url: "http://127.0.0.1:54321", anonKey: "eyJh..."}
API: object
Departments: [{id: "...", name: "IT", created_at: "..."}, ...] null
```

## 🔴 Если есть ошибки:

### Ошибка: "supabase is not defined"
**Решение:** Проверьте, что Supabase JS загружен:
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```

### Ошибка: "Failed to fetch"
**Решение:** Проверьте, что Supabase запущен:
```bash
docker-compose ps
```

### Ошибка: "Invalid API key"
**Решение:** Проверьте ключ в config.js

## 🎯 Следующие шаги:

1. ✅ Подключение работает
2. ⏳ Протестируйте авторизацию:
```javascript
const user = await api.login('admin@demo.ru', 'admin123');
console.log('User:', user);
```

3. ⏳ Протестируйте получение данных:
```javascript
const floors = await api.getFloors();
console.log('Floors:', floors);
```

4. ⏳ Начните замену localStorage на api.* в app.js

## 📝 Полезные команды для тестирования:

```javascript
// Получить все отделы
await api.getDepartments()

// Получить всех пользователей
await api.getUsers()

// Получить этажи
await api.getFloors()

// Получить зоны этажа (замените ID)
await api.getZonesByFloor('floor-id-here')

// Получить бронирования
await api.getBookings()
```

## 🆘 Нужна помощь?

Смотрите:
- **QUICKSTART.md** - быстрый старт
- **INTEGRATION_GUIDE.md** - примеры интеграции
- **api-examples.js** - примеры кода
- **CHEATSHEET.md** - шпаргалка
