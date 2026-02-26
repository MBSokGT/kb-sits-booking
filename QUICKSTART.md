# 🎯 План действий: Интеграция Supabase в КБ Ситс

## 📋 Обзор

Вы получили полный набор файлов для интеграции Supabase в систему бронирования КБ Ситс:

### Созданные файлы:

1. **supabase-schema.sql** - SQL схема базы данных
2. **config.js** - Конфигурация подключения
3. **supabase-api.js** - JavaScript API для работы с БД
4. **migration.js** - Скрипт миграции из localStorage
5. **docker-compose.yml** - Запуск Supabase через Docker
6. **kong.yml** - Конфигурация API Gateway
7. **SUPABASE_SETUP.md** - Подробная инструкция по настройке
8. **INTEGRATION_GUIDE.md** - Руководство по интеграции в код

---

## 🚀 Быстрый старт (5 шагов)

### Шаг 1: Запустите Supabase

```bash
cd "/Users/admin/Desktop/ КБ Ситс"
docker-compose up -d
```

Проверьте, что всё запустилось:
- Studio UI: http://localhost:3000
- API: http://localhost:54321

### Шаг 2: Примените SQL схему

Откройте http://localhost:3000 → SQL Editor → вставьте содержимое `supabase-schema.sql` → Run

Или через командную строку:
```bash
psql postgresql://postgres:postgres@localhost:54322/postgres -f supabase-schema.sql
```

### Шаг 3: Настройте config.js

1. Откройте http://localhost:3000
2. Settings → API
3. Скопируйте `anon public` ключ
4. Вставьте в `config.js`:

```javascript
const SUPABASE_CONFIG = {
  url: 'http://localhost:54321',
  anonKey: 'ВСТАВЬТЕ_СЮДА_ВАШ_КЛЮЧ'
};
```

### Шаг 4: Подключите скрипты в index.html

Добавьте перед закрывающим `</body>`:

```html
<!-- Supabase -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="config.js"></script>
<script src="supabase-api.js"></script>
<script src="migration.js"></script>

<!-- Ваш код -->
<script src="app.js"></script>
```

### Шаг 5: Мигрируйте данные (если есть)

Откройте консоль браузера (F12):

```javascript
// 1. Создайте бэкап
const migration = new DataMigration(api);
migration.createBackup();

// 2. Запустите миграцию
await migration.runFullMigration();

// 3. Очистите localStorage
localStorage.clear();
```

---

## 📊 Структура базы данных

```
departments (отделы)
  ├── users (пользователи)
  
floors (этажи)
  ├── zones (зоны)
      ├── seats (места)
          ├── bookings (бронирования)
```

### Таблицы:

- **departments** - Отделы компании
- **users** - Пользователи (employee/manager/admin)
- **floors** - Этажи офиса
- **zones** - Зоны на этажах с координатами
- **seats** - Места в зонах
- **bookings** - Бронирования мест

---

## 🔄 Замена localStorage на Supabase

### Было:
```javascript
const users = JSON.parse(localStorage.getItem('users') || '[]');
```

### Стало:
```javascript
const users = await api.getUsers();
```

### Основные методы API:

**Авторизация:**
- `api.login(email, password)`
- `api.register(email, password, fullName, departmentId, role)`
- `api.logout()`
- `api.getCurrentUser()`

**Этажи:**
- `api.getFloors()`
- `api.createFloor(name, floorNumber, imageData)`
- `api.updateFloor(floorId, updates)`
- `api.deleteFloor(floorId)`

**Зоны:**
- `api.getZonesByFloor(floorId)`
- `api.createZone(floorId, name, color, seatsCount, coordinates)`
- `api.updateZone(zoneId, updates)`
- `api.deleteZone(zoneId)`

**Бронирования:**
- `api.getBookings(filters)`
- `api.createBooking(seatId, userId, date, timeSlot, startTime, endTime)`
- `api.cancelBooking(bookingId)`
- `api.getAvailableSeats(date, timeSlot)`

**Статистика:**
- `api.getBookingStatistics()`
- `api.getBookingsByDateRange(startDate, endDate)`

---

## 🔒 Безопасность (RLS)

Row Level Security автоматически настроен:

- **Сотрудники**: видят всех, бронируют только себе
- **Руководители**: бронируют для своего отдела
- **Администраторы**: полный доступ

---

## 🔴 Real-time обновления

```javascript
// Подписка на изменения бронирований
const subscription = api.subscribeToBookings((payload) => {
  console.log('Новое бронирование:', payload);
  refreshUI();
});

// Отписка
api.unsubscribe(subscription);
```

---

## ✅ Чек-лист интеграции

- [ ] Docker Supabase запущен
- [ ] SQL схема применена
- [ ] config.js настроен
- [ ] Скрипты подключены в index.html
- [ ] Данные мигрированы
- [ ] localStorage заменён на api.*
- [ ] Обработка ошибок добавлена
- [ ] Real-time подписки настроены
- [ ] Тестирование пройдено

---

## 🧪 Тестирование

```javascript
// В консоли браузера (F12):

// 1. Проверка подключения
const { data } = await api.client.from('departments').select('*');
console.log('Подключение:', data);

// 2. Тест авторизации
const user = await api.login('admin@demo.ru', 'admin123');
console.log('Пользователь:', user);

// 3. Тест получения данных
const floors = await api.getFloors();
console.log('Этажи:', floors);
```

---

## 📚 Документация

- **SUPABASE_SETUP.md** - Детальная настройка Supabase
- **INTEGRATION_GUIDE.md** - Примеры интеграции в код
- **supabase-schema.sql** - Комментарии в SQL схеме

---

## 🆘 Частые проблемы

**Supabase не запускается:**
```bash
docker-compose down -v
docker-compose up -d
```

**Ошибка CORS:**
- Проверьте URL: должен быть `http://localhost:54321`

**Данные не сохраняются:**
- Проверьте, что пользователь авторизован
- Проверьте политики RLS в Studio

**Ошибка "anon key invalid":**
- Скопируйте ключ из Studio → Settings → API
- Вставьте в config.js

---

## 📞 Следующие шаги

1. ✅ Запустите Supabase
2. ✅ Примените SQL схему
3. ✅ Настройте config.js
4. ⏳ Начните замену localStorage в app.js
5. ⏳ Добавьте обработку ошибок
6. ⏳ Настройте real-time обновления
7. ⏳ Протестируйте все функции

---

## 💡 Полезные команды

```bash
# Запуск
docker-compose up -d

# Остановка
docker-compose down

# Логи
docker-compose logs -f

# Перезапуск с очисткой
docker-compose down -v && docker-compose up -d

# Бэкап БД
docker exec kb_sits_db pg_dump -U postgres postgres > backup.sql

# Восстановление
docker exec -i kb_sits_db psql -U postgres postgres < backup.sql
```

---

## 🎉 Готово!

Теперь у вас есть:
- ✅ Полноценная PostgreSQL база данных
- ✅ REST API для работы с данными
- ✅ Row Level Security для безопасности
- ✅ Real-time обновления
- ✅ Готовая миграция из localStorage
- ✅ Удобный API для JavaScript

**Начните с Шага 1 и следуйте инструкциям!** 🚀
