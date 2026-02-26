# 🚀 Шпаргалка: Supabase для КБ Ситс

## ⚡ Быстрый старт (3 минуты)

```bash
# 1. Запустить Supabase
docker-compose up -d

# 2. Открыть Studio
open http://localhost:3000

# 3. Применить SQL (в SQL Editor)
# Скопировать содержимое supabase-schema.sql → Run

# 4. Получить ключ (Settings → API)
# Скопировать anon key → вставить в config.js

# 5. Готово!
```

---

## 🔑 API Методы (самые важные)

### Авторизация
```javascript
// Вход
const user = await api.login('email@demo.ru', 'password');

// Текущий пользователь
const user = api.getCurrentUser();

// Выход
api.logout();
```

### Этажи
```javascript
// Получить все
const floors = await api.getFloors();

// Создать
const floor = await api.createFloor('Название', 1, imageBase64);

// Обновить
await api.updateFloor(floorId, { name: 'Новое название' });

// Удалить
await api.deleteFloor(floorId);
```

### Зоны
```javascript
// Получить зоны этажа
const zones = await api.getZonesByFloor(floorId);

// Создать зону
const zone = await api.createZone(
  floorId,
  'Зона A',
  '#3b82f6',
  5, // мест
  [{x:100, y:100}, ...] // координаты
);

// Обновить
await api.updateZone(zoneId, { name: 'Новое название' });

// Удалить
await api.deleteZone(zoneId);
```

### Бронирования
```javascript
// Получить все
const bookings = await api.getBookings();

// Получить мои
const my = await api.getBookings({ userId: user.id });

// Доступные места
const seats = await api.getAvailableSeats('2024-01-15', 'full_day');

// Создать бронирование
const booking = await api.createBooking(
  seatId,
  userId,
  '2024-01-15',
  'full_day'
);

// Отменить
await api.cancelBooking(bookingId);
```

### Статистика
```javascript
// Статистика бронирований
const stats = await api.getBookingStatistics();

// За период
const range = await api.getBookingsByDateRange('2024-01-01', '2024-01-31');
```

### Real-time
```javascript
// Подписаться на бронирования
const sub = api.subscribeToBookings((payload) => {
  console.log('Изменение:', payload);
  refreshUI();
});

// Отписаться
api.unsubscribe(sub);
```

---

## 🐳 Docker команды

```bash
# Запуск
docker-compose up -d

# Остановка
docker-compose down

# Остановка + удаление данных
docker-compose down -v

# Логи
docker-compose logs -f

# Перезапуск
docker-compose restart

# Статус
docker-compose ps
```

---

## 🗄️ База данных

### Подключение
```
Host: localhost
Port: 54322
User: postgres
Password: postgres
Database: postgres
```

### Таблицы
```
departments  → Отделы
users        → Пользователи
floors       → Этажи
zones        → Зоны
seats        → Места
bookings     → Бронирования
```

### Связи
```
departments (1) → (N) users
floors (1) → (N) zones → (N) seats → (N) bookings
users (1) → (N) bookings
```

---

## 🔒 Роли и права

| Роль | Права |
|------|-------|
| **employee** | Бронирует себе, видит всех |
| **manager** | Бронирует для отдела, видит отдел |
| **admin** | Полный доступ ко всему |

---

## 📝 Временные слоты

```javascript
'morning'     // Утро (08:00-12:00)
'afternoon'   // День (12:00-18:00)
'evening'     // Вечер (18:00-22:00)
'full_day'    // Весь день
'custom'      // Своё время (указать start_time, end_time)
```

---

## ⚠️ Обработка ошибок

```javascript
try {
  const result = await api.someMethod();
} catch (error) {
  if (error.message.includes('duplicate')) {
    alert('Уже существует');
  } else if (error.message.includes('permission')) {
    alert('Нет прав');
  } else {
    alert('Ошибка: ' + error.message);
  }
}
```

---

## 🔄 Миграция из localStorage

```javascript
// В консоли браузера (F12):

// 1. Создать бэкап
const migration = new DataMigration(api);
migration.createBackup();

// 2. Мигрировать
await migration.runFullMigration();

// 3. Очистить localStorage
localStorage.clear();
```

---

## 🧪 Тестирование

```javascript
// Проверка подключения
const { data } = await api.client.from('departments').select('*');
console.log('OK:', data);

// Тест авторизации
const user = await api.login('admin@demo.ru', 'admin123');
console.log('User:', user);

// Тест данных
const floors = await api.getFloors();
console.log('Floors:', floors);
```

---

## 🌐 URL-адреса

```
Studio UI:  http://localhost:3000
API:        http://localhost:54321
Database:   postgresql://postgres:postgres@localhost:54322/postgres
```

---

## 📚 Документация

| Файл | Назначение |
|------|------------|
| **QUICKSTART.md** | Быстрый старт |
| **SUPABASE_SETUP.md** | Детальная настройка |
| **INTEGRATION_GUIDE.md** | Интеграция в код |
| **DATABASE_SCHEMA.md** | Схема БД |
| **api-examples.js** | Примеры кода |

---

## 🆘 Частые проблемы

### Docker не запускается
```bash
docker-compose down -v
docker-compose up -d
```

### Ошибка CORS
Проверьте URL: `http://localhost:54321`

### Данные не сохраняются
1. Проверьте авторизацию: `api.getCurrentUser()`
2. Проверьте RLS политики в Studio

### Ошибка "anon key invalid"
1. Studio → Settings → API
2. Скопируйте anon key
3. Вставьте в config.js

---

## 💡 Полезные SQL запросы

```sql
-- Все бронирования на дату
SELECT * FROM bookings 
WHERE booking_date = '2024-01-15' 
  AND status = 'active';

-- Загруженность зон
SELECT z.name, COUNT(b.id) as bookings
FROM zones z
LEFT JOIN seats s ON z.id = s.zone_id
LEFT JOIN bookings b ON s.id = b.seat_id
WHERE b.status = 'active'
GROUP BY z.id, z.name;

-- Топ пользователей по бронированиям
SELECT u.full_name, COUNT(b.id) as total
FROM users u
LEFT JOIN bookings b ON u.id = b.user_id
GROUP BY u.id, u.full_name
ORDER BY total DESC
LIMIT 10;
```

---

## 🎯 Чек-лист

- [ ] Docker запущен
- [ ] SQL схема применена
- [ ] config.js настроен
- [ ] Скрипты подключены в index.html
- [ ] Тест подключения пройден
- [ ] localStorage заменён на api.*
- [ ] Обработка ошибок добавлена
- [ ] Real-time настроен
- [ ] Миграция выполнена
- [ ] Всё работает! 🎉

---

**Сохраните эту шпаргалку для быстрого доступа!** 📌
