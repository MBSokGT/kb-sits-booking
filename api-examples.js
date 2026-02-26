// ═══════════════════════════════════════════════════════════════
// Примеры использования Supabase API
// ═══════════════════════════════════════════════════════════════

// ═══ 1. АВТОРИЗАЦИЯ ════════════════════════════════════════════

// Вход в систему
async function loginExample() {
  try {
    const user = await api.login('admin@demo.ru', 'admin123');
    console.log('✅ Вход выполнен:', user);
    console.log('Роль:', user.role);
    console.log('Отдел:', user.departments?.name);
  } catch (error) {
    console.error('❌ Ошибка входа:', error.message);
  }
}

// Регистрация нового пользователя
async function registerExample() {
  try {
    const departments = await api.getDepartments();
    const itDept = departments.find(d => d.name === 'IT');
    
    const newUser = await api.register(
      'newuser@demo.ru',
      'password123',
      'Новый Сотрудник',
      itDept.id,
      'employee'
    );
    console.log('✅ Пользователь создан:', newUser);
  } catch (error) {
    console.error('❌ Ошибка регистрации:', error.message);
  }
}

// Проверка текущего пользователя
function checkCurrentUser() {
  const user = api.getCurrentUser();
  if (user) {
    console.log('👤 Текущий пользователь:', user.full_name);
    console.log('📧 Email:', user.email);
    console.log('🎭 Роль:', user.role);
  } else {
    console.log('❌ Пользователь не авторизован');
  }
}

// ═══ 2. РАБОТА С ЭТАЖАМИ ═══════════════════════════════════════

// Получить все этажи
async function getFloorsExample() {
  const floors = await api.getFloors();
  console.log('🏢 Этажи:', floors);
  floors.forEach(floor => {
    console.log(`  - ${floor.name} (этаж ${floor.floor_number})`);
  });
}

// Создать новый этаж
async function createFloorExample() {
  try {
    // Загрузка изображения в base64
    const fileInput = document.querySelector('input[type="file"]');
    const file = fileInput.files[0];
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      const imageData = e.target.result;
      
      const floor = await api.createFloor(
        'Второй этаж',
        2,
        imageData
      );
      console.log('✅ Этаж создан:', floor);
    };
    
    reader.readAsDataURL(file);
  } catch (error) {
    console.error('❌ Ошибка создания этажа:', error.message);
  }
}

// Обновить этаж
async function updateFloorExample(floorId) {
  try {
    const updated = await api.updateFloor(floorId, {
      name: 'Первый этаж (обновлённый)'
    });
    console.log('✅ Этаж обновлён:', updated);
  } catch (error) {
    console.error('❌ Ошибка обновления:', error.message);
  }
}

// ═══ 3. РАБОТА С ЗОНАМИ ════════════════════════════════════════

// Получить зоны этажа
async function getZonesExample(floorId) {
  const zones = await api.getZonesByFloor(floorId);
  console.log('🗺️ Зоны этажа:', zones);
  zones.forEach(zone => {
    console.log(`  - ${zone.name}: ${zone.seats_count} мест (${zone.color})`);
  });
}

// Создать новую зону
async function createZoneExample(floorId) {
  try {
    const coordinates = [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 200 },
      { x: 100, y: 200 }
    ];
    
    const zone = await api.createZone(
      floorId,
      'Зона C',
      '#f59e0b', // оранжевый
      8, // 8 мест
      coordinates
    );
    console.log('✅ Зона создана:', zone);
    
    // Проверяем, что места тоже созданы
    const seats = await api.getSeatsByZone(zone.id);
    console.log(`✅ Создано ${seats.length} мест`);
  } catch (error) {
    console.error('❌ Ошибка создания зоны:', error.message);
  }
}

// Обновить зону
async function updateZoneExample(zoneId) {
  try {
    const updated = await api.updateZone(zoneId, {
      name: 'Зона VIP',
      color: '#8b5cf6', // фиолетовый
      seats_count: 10
    });
    console.log('✅ Зона обновлена:', updated);
  } catch (error) {
    console.error('❌ Ошибка обновления:', error.message);
  }
}

// ═══ 4. РАБОТА С БРОНИРОВАНИЯМИ ════════════════════════════════

// Получить все бронирования пользователя
async function getUserBookingsExample() {
  const user = api.getCurrentUser();
  const bookings = await api.getBookings({ userId: user.id });
  
  console.log('📅 Мои бронирования:', bookings.length);
  bookings.forEach(b => {
    console.log(`  - ${b.booking_date}: ${b.seats.zones.name}, место ${b.seats.seat_number}`);
    console.log(`    Время: ${b.time_slot}, Статус: ${b.status}`);
  });
}

// Получить доступные места на дату
async function getAvailableSeatsExample(date, timeSlot) {
  const seats = await api.getAvailableSeats(date, timeSlot);
  
  console.log(`🪑 Доступные места на ${date} (${timeSlot}):`, seats.length);
  seats.forEach(seat => {
    console.log(`  - ${seat.zones.floors.name} → ${seat.zones.name} → Место ${seat.seat_number}`);
  });
  
  return seats;
}

// Создать бронирование
async function createBookingExample() {
  try {
    const date = '2024-01-20';
    const timeSlot = 'full_day';
    
    // 1. Получаем доступные места
    const availableSeats = await api.getAvailableSeats(date, timeSlot);
    
    if (availableSeats.length === 0) {
      console.log('❌ Нет доступных мест');
      return;
    }
    
    // 2. Выбираем первое доступное место
    const seat = availableSeats[0];
    const user = api.getCurrentUser();
    
    // 3. Создаём бронирование
    const booking = await api.createBooking(
      seat.id,
      user.id,
      date,
      timeSlot
    );
    
    console.log('✅ Бронирование создано:', booking);
    console.log(`📍 Место: ${booking.seats.zones.name}, место ${booking.seats.seat_number}`);
  } catch (error) {
    console.error('❌ Ошибка бронирования:', error.message);
  }
}

// Создать бронирование с кастомным временем
async function createCustomBookingExample() {
  try {
    const availableSeats = await api.getAvailableSeats('2024-01-21', 'custom');
    const seat = availableSeats[0];
    const user = api.getCurrentUser();
    
    const booking = await api.createBooking(
      seat.id,
      user.id,
      '2024-01-21',
      'custom',
      '14:00:00', // с 14:00
      '18:00:00'  // до 18:00
    );
    
    console.log('✅ Бронирование создано:', booking);
    console.log(`⏰ Время: ${booking.start_time} - ${booking.end_time}`);
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

// Отменить бронирование
async function cancelBookingExample(bookingId) {
  try {
    const cancelled = await api.cancelBooking(bookingId);
    console.log('✅ Бронирование отменено:', cancelled);
  } catch (error) {
    console.error('❌ Ошибка отмены:', error.message);
  }
}

// Руководитель бронирует для сотрудника
async function managerBookingExample() {
  try {
    const manager = api.getCurrentUser();
    
    if (manager.role !== 'manager' && manager.role !== 'admin') {
      console.log('❌ Только руководители могут бронировать для других');
      return;
    }
    
    // Получаем сотрудников отдела
    const employees = await api.getUsersByDepartment(manager.department_id);
    const employee = employees.find(e => e.role === 'employee');
    
    if (!employee) {
      console.log('❌ Нет сотрудников в отделе');
      return;
    }
    
    // Бронируем для сотрудника
    const availableSeats = await api.getAvailableSeats('2024-01-22', 'full_day');
    const booking = await api.createBooking(
      availableSeats[0].id,
      employee.id, // для сотрудника
      '2024-01-22',
      'full_day'
    );
    
    console.log(`✅ Руководитель ${manager.full_name} забронировал место для ${employee.full_name}`);
    console.log('📅 Бронирование:', booking);
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

// ═══ 5. СТАТИСТИКА ═════════════════════════════════════════════

// Получить статистику бронирований
async function getStatisticsExample() {
  const stats = await api.getBookingStatistics();
  
  console.log('📊 Статистика бронирований:');
  stats.forEach(stat => {
    console.log(`\n👤 ${stat.full_name} (${stat.department})`);
    console.log(`   Всего: ${stat.total_bookings}`);
    console.log(`   Активных: ${stat.active_bookings}`);
    console.log(`   Истёкших: ${stat.expired_bookings}`);
  });
}

// Получить бронирования за период
async function getBookingsByRangeExample() {
  const bookings = await api.getBookingsByDateRange('2024-01-01', '2024-01-31');
  
  console.log(`📅 Бронирования за январь 2024: ${bookings.length}`);
  
  // Группируем по датам
  const byDate = {};
  bookings.forEach(b => {
    if (!byDate[b.booking_date]) byDate[b.booking_date] = [];
    byDate[b.booking_date].push(b);
  });
  
  Object.keys(byDate).sort().forEach(date => {
    console.log(`\n${date}: ${byDate[date].length} бронирований`);
    byDate[date].forEach(b => {
      console.log(`  - ${b.users.full_name}: ${b.seats.zones.name}`);
    });
  });
}

// Загруженность зон
async function getZoneOccupancyExample(floorId, date) {
  const zones = await api.getZonesByFloor(floorId);
  
  console.log(`📊 Загруженность зон на ${date}:`);
  
  for (const zone of zones) {
    const seats = await api.getSeatsByZone(zone.id);
    const bookings = await api.getBookings({ date });
    
    const bookedSeatsInZone = bookings.filter(b => 
      seats.some(s => s.id === b.seat_id)
    ).length;
    
    const occupancy = (bookedSeatsInZone / zone.seats_count * 100).toFixed(1);
    
    console.log(`\n${zone.name}:`);
    console.log(`  Всего мест: ${zone.seats_count}`);
    console.log(`  Забронировано: ${bookedSeatsInZone}`);
    console.log(`  Загруженность: ${occupancy}%`);
  }
}

// ═══ 6. REAL-TIME ОБНОВЛЕНИЯ ═══════════════════════════════════

// Подписка на изменения бронирований
function subscribeToBookingsExample() {
  const subscription = api.subscribeToBookings((payload) => {
    console.log('🔔 Изменение в бронированиях:', payload);
    
    if (payload.eventType === 'INSERT') {
      console.log('✅ Новое бронирование:', payload.new);
      // Обновить UI
      refreshBookingsUI();
    } else if (payload.eventType === 'UPDATE') {
      console.log('🔄 Обновление бронирования:', payload.new);
      // Обновить UI
      refreshBookingsUI();
    } else if (payload.eventType === 'DELETE') {
      console.log('❌ Удаление бронирования:', payload.old);
      // Обновить UI
      refreshBookingsUI();
    }
  });
  
  console.log('👂 Подписка на бронирования активна');
  
  // Отписаться через 1 минуту (для примера)
  setTimeout(() => {
    api.unsubscribe(subscription);
    console.log('🔇 Подписка отменена');
  }, 60000);
}

// Подписка на изменения зон
function subscribeToZonesExample(floorId) {
  const subscription = api.subscribeToZones(floorId, (payload) => {
    console.log('🔔 Изменение в зонах:', payload);
    
    if (payload.eventType === 'INSERT') {
      console.log('✅ Новая зона:', payload.new);
      // Перерисовать карту
      redrawFloorMap();
    } else if (payload.eventType === 'UPDATE') {
      console.log('🔄 Обновление зоны:', payload.new);
      // Обновить зону на карте
      updateZoneOnMap(payload.new);
    } else if (payload.eventType === 'DELETE') {
      console.log('❌ Удаление зоны:', payload.old);
      // Удалить зону с карты
      removeZoneFromMap(payload.old.id);
    }
  });
  
  console.log(`👂 Подписка на зоны этажа ${floorId} активна`);
  return subscription;
}

// ═══ 7. ОБРАБОТКА ОШИБОК ═══════════════════════════════════════

// Пример правильной обработки ошибок
async function errorHandlingExample() {
  try {
    const booking = await api.createBooking(
      'invalid-seat-id',
      'invalid-user-id',
      '2024-01-15',
      'full_day'
    );
  } catch (error) {
    console.error('❌ Ошибка:', error);
    
    // Разные типы ошибок
    if (error.message.includes('duplicate')) {
      alert('Это место уже забронировано на эту дату');
    } else if (error.message.includes('foreign key')) {
      alert('Место или пользователь не найдены');
    } else if (error.message.includes('permission')) {
      alert('У вас нет прав для этого действия');
    } else if (error.message.includes('violates check')) {
      alert('Неверный формат данных');
    } else {
      alert('Произошла ошибка: ' + error.message);
    }
  }
}

// ═══ 8. ПОЛЕЗНЫЕ ФУНКЦИИ ═══════════════════════════════════════

// Проверка доступности места
async function isSeatAvailable(seatId, date, timeSlot) {
  const bookings = await api.getBookings({ date });
  const isBooked = bookings.some(b => 
    b.seat_id === seatId && 
    b.time_slot === timeSlot && 
    b.status === 'active'
  );
  return !isBooked;
}

// Получить все бронирования пользователя на будущее
async function getFutureBookings(userId) {
  const allBookings = await api.getBookings({ userId });
  const today = new Date().toISOString().split('T')[0];
  
  return allBookings.filter(b => 
    b.booking_date >= today && 
    b.status === 'active'
  );
}

// Проверить лимит бронирований
async function checkBookingLimit(userId) {
  const user = api.getCurrentUser();
  const futureBookings = await getFutureBookings(userId);
  
  if (user.role === 'employee') {
    // Сотрудник: 1 место в день или 1 место на месяц
    const today = new Date().toISOString().split('T')[0];
    const todayBookings = futureBookings.filter(b => b.booking_date === today);
    
    if (todayBookings.length > 0) {
      return { allowed: false, reason: 'У вас уже есть бронирование на сегодня' };
    }
    
    if (futureBookings.length >= 30) {
      return { allowed: false, reason: 'Достигнут лимит бронирований на месяц' };
    }
  }
  
  return { allowed: true };
}

// ═══════════════════════════════════════════════════════════════
// ЗАПУСК ПРИМЕРОВ
// ═══════════════════════════════════════════════════════════════

// Раскомментируйте нужные примеры в консоли браузера:

// await loginExample();
// await getFloorsExample();
// await createBookingExample();
// await getStatisticsExample();
// subscribeToBookingsExample();
