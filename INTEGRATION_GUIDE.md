# 🔄 Интеграция Supabase в существующий код

## Шаг 1: Подключение библиотек

Добавьте в `index.html` перед закрывающим `</body>`:

```html
<!-- Supabase -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="config.js"></script>
<script src="supabase-api.js"></script>
<script src="migration.js"></script>

<!-- Ваш основной скрипт -->
<script src="app.js"></script>
```

## Шаг 2: Замена localStorage на Supabase API

### Было (localStorage):
```javascript
// Получить пользователей
const users = JSON.parse(localStorage.getItem('users') || '[]');

// Сохранить пользователя
users.push(newUser);
localStorage.setItem('users', JSON.stringify(users));
```

### Стало (Supabase):
```javascript
// Получить пользователей
const users = await api.getUsers();

// Создать пользователя
const newUser = await api.register(email, password, fullName, departmentId, role);
```

## Шаг 3: Примеры замены основных операций

### Авторизация
```javascript
// Вход
try {
  const user = await api.login(email, password);
  console.log('Вход выполнен:', user);
} catch (error) {
  alert('Ошибка входа: ' + error.message);
}

// Выход
api.logout();

// Текущий пользователь
const currentUser = api.getCurrentUser();
```

### Работа с этажами
```javascript
// Получить все этажи
const floors = await api.getFloors();

// Создать этаж
const floor = await api.createFloor('Первый этаж', 1, imageBase64);

// Обновить этаж
await api.updateFloor(floorId, { name: 'Новое название' });

// Удалить этаж
await api.deleteFloor(floorId);
```

### Работа с зонами
```javascript
// Получить зоны этажа
const zones = await api.getZonesByFloor(floorId);

// Создать зону
const zone = await api.createZone(
  floorId,
  'Зона A',
  '#3b82f6',
  5, // количество мест
  [{x: 100, y: 100}, {x: 200, y: 100}, ...] // координаты
);

// Обновить зону
await api.updateZone(zoneId, { name: 'Новое название', color: '#10b981' });

// Удалить зону
await api.deleteZone(zoneId);
```

### Работа с бронированиями
```javascript
// Получить все бронирования
const bookings = await api.getBookings();

// Получить бронирования пользователя
const userBookings = await api.getBookings({ userId: currentUser.id });

// Получить бронирования на дату
const dateBookings = await api.getBookings({ date: '2024-01-15' });

// Создать бронирование
const booking = await api.createBooking(
  seatId,
  userId,
  '2024-01-15', // дата
  'full_day',   // временной слот
  null,         // startTime (для custom)
  null          // endTime (для custom)
);

// Отменить бронирование
await api.cancelBooking(bookingId);

// Получить доступные места
const availableSeats = await api.getAvailableSeats('2024-01-15', 'full_day');
```

### Статистика
```javascript
// Получить статистику бронирований
const stats = await api.getBookingStatistics();

// Получить бронирования за период
const rangeBookings = await api.getBookingsByDateRange('2024-01-01', '2024-01-31');
```

## Шаг 4: Real-time обновления

```javascript
// Подписаться на изменения бронирований
const bookingsSubscription = api.subscribeToBookings((payload) => {
  console.log('Изменение в бронированиях:', payload);
  // Обновить UI
  refreshBookingsUI();
});

// Подписаться на изменения зон этажа
const zonesSubscription = api.subscribeToZones(floorId, (payload) => {
  console.log('Изменение в зонах:', payload);
  // Обновить карту
  refreshMapUI();
});

// Отписаться
api.unsubscribe(bookingsSubscription);
api.unsubscribe(zonesSubscription);
```

## Шаг 5: Обработка ошибок

```javascript
try {
  const result = await api.someMethod();
  // Успех
} catch (error) {
  console.error('Ошибка:', error);
  
  // Показать пользователю
  if (error.message.includes('duplicate')) {
    alert('Такая запись уже существует');
  } else if (error.message.includes('permission')) {
    alert('Недостаточно прав');
  } else {
    alert('Произошла ошибка: ' + error.message);
  }
}
```

## Шаг 6: Проверка прав доступа

```javascript
const currentUser = api.getCurrentUser();

// Проверка роли
if (currentUser.role === 'admin') {
  // Показать админ-панель
}

if (currentUser.role === 'manager') {
  // Показать функции руководителя
}

// Проверка отдела
if (currentUser.department_id === targetUser.department_id) {
  // Разрешить действие
}
```

## Шаг 7: Миграция существующих данных

```javascript
// В консоли браузера (F12):

// 1. Создать бэкап
const migration = new DataMigration(api);
migration.createBackup();

// 2. Запустить миграцию
await migration.runFullMigration();

// 3. Проверить данные в Supabase Studio

// 4. Очистить localStorage
localStorage.clear();
```

## Шаг 8: Тестирование

```javascript
// Проверка подключения
const { data, error } = await api.client.from('departments').select('*');
console.log('Подключение:', data ? '✅ OK' : '❌ Ошибка', error);

// Проверка авторизации
const user = await api.login('admin@demo.ru', 'admin123');
console.log('Авторизация:', user);

// Проверка получения данных
const floors = await api.getFloors();
console.log('Этажи:', floors);
```

## 📝 Чек-лист интеграции

- [ ] Запущен Docker Supabase
- [ ] Применена SQL схема
- [ ] Настроен config.js с ключами
- [ ] Подключены скрипты в index.html
- [ ] Заменены вызовы localStorage на api.*
- [ ] Добавлена обработка ошибок
- [ ] Выполнена миграция данных
- [ ] Протестированы основные функции
- [ ] Настроены real-time подписки
- [ ] Проверены права доступа

## 🆘 Частые проблемы

**Ошибка CORS:**
- Проверьте, что Supabase запущен
- URL должен быть http://localhost:54321

**Ошибка авторизации:**
- Проверьте anon key в config.js
- Убедитесь, что RLS настроен правильно

**Данные не сохраняются:**
- Проверьте политики RLS
- Убедитесь, что пользователь авторизован

**Real-time не работает:**
- Проверьте, что канал подписан
- Убедитесь, что таблица имеет REPLICA IDENTITY
