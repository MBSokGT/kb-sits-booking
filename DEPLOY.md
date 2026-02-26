# 🚀 Деплой КБ Ситс

## Быстрый старт (5 минут)

### 1. Supabase (3 мин)

1. Создайте проект на [supabase.com](https://supabase.com)
2. SQL Editor → выполните `supabase-schema.sql`
3. Database → Replication → включите Realtime:
   - ✅ bookings
   - ✅ seats
   - ✅ zones
4. Settings → API → скопируйте:
   - Project URL
   - anon public key

### 2. Настройка (1 мин)

Обновите `config.js`:

```javascript
const SUPABASE_CONFIG = {
  url: 'https://ваш-проект.supabase.co',
  anonKey: 'ваш-anon-key'
};
```

### 3. Деплой на Vercel (1 мин)

```bash
# Через CLI
npx vercel

# Или через GitHub
git push
# Затем импортируйте на vercel.com
```

## Real-Time функционал

### Подключение в app.js

```javascript
// Инициализация
const realtimeManager = new RealtimeManager(supabase);
const bookingManager = new BookingManager(supabase);

// Подписка на изменения
realtimeManager.subscribeToBookings((payload) => {
  const { eventType, new: newRecord } = payload;
  
  if (eventType === 'INSERT') {
    showNotification('Новое бронирование');
    refreshSeatsMap();
  }
});

// Создание бронирования с проверкой конфликтов
async function bookSeat(data) {
  try {
    await bookingManager.createBooking(data);
  } catch (error) {
    alert(error.message); // "Место уже забронировано"
  }
}
```

### Очистка при выходе

```javascript
function logout() {
  realtimeManager.unsubscribeAll();
}
```

## Демо-аккаунты

```
admin@demo.ru / admin123
manager@demo.ru / pass123
user@demo.ru / pass123
```

## Готово! 🎉

Все изменения бронирований отображаются у всех пользователей в реальном времени без перезагрузки.
