// ═══════════════════════════════════════════════════════════════
// Скрипт миграции данных из localStorage в Supabase
// ═══════════════════════════════════════════════════════════════

class DataMigration {
  constructor(supabaseAPI) {
    this.api = supabaseAPI;
  }

  // Получить данные из localStorage
  getLocalStorageData() {
    return {
      users: JSON.parse(localStorage.getItem('users') || '[]'),
      floors: JSON.parse(localStorage.getItem('floors') || '[]'),
      zones: JSON.parse(localStorage.getItem('zones') || '[]'),
      bookings: JSON.parse(localStorage.getItem('bookings') || '[]'),
      departments: this.extractDepartments()
    };
  }

  // Извлечь уникальные отделы из пользователей
  extractDepartments() {
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const departments = new Set();
    users.forEach(user => {
      if (user.department) departments.add(user.department);
    });
    return Array.from(departments).map(name => ({ name }));
  }

  // Мигрировать отделы
  async migrateDepartments(localDepartments) {
    console.log('📦 Миграция отделов...');
    const departmentMap = new Map();

    for (const dept of localDepartments) {
      try {
        const created = await this.api.createDepartment(dept.name);
        departmentMap.set(dept.name, created.id);
        console.log(`✅ Отдел "${dept.name}" создан`);
      } catch (error) {
        console.error(`❌ Ошибка создания отдела "${dept.name}":`, error);
      }
    }

    return departmentMap;
  }

  // Мигрировать пользователей
  async migrateUsers(localUsers, departmentMap) {
    console.log('👥 Миграция пользователей...');
    const userMap = new Map();

    for (const user of localUsers) {
      try {
        const departmentId = departmentMap.get(user.department);
        const created = await this.api.register(
          user.email,
          user.password, // В реальности нужно хешировать!
          user.fullName,
          departmentId,
          user.role
        );
        userMap.set(user.id, created.id);
        console.log(`✅ Пользователь "${user.email}" создан`);
      } catch (error) {
        console.error(`❌ Ошибка создания пользователя "${user.email}":`, error);
      }
    }

    return userMap;
  }

  // Мигрировать этажи
  async migrateFloors(localFloors) {
    console.log('🏢 Миграция этажей...');
    const floorMap = new Map();

    for (const floor of localFloors) {
      try {
        const created = await this.api.createFloor(
          floor.name,
          floor.floorNumber,
          floor.imageData
        );
        floorMap.set(floor.id, created.id);
        console.log(`✅ Этаж "${floor.name}" создан`);
      } catch (error) {
        console.error(`❌ Ошибка создания этажа "${floor.name}":`, error);
      }
    }

    return floorMap;
  }

  // Мигрировать зоны
  async migrateZones(localZones, floorMap) {
    console.log('🗺️ Миграция зон...');
    const zoneMap = new Map();

    for (const zone of localZones) {
      try {
        const newFloorId = floorMap.get(zone.floorId);
        if (!newFloorId) {
          console.warn(`⚠️ Этаж для зоны "${zone.name}" не найден`);
          continue;
        }

        const created = await this.api.createZone(
          newFloorId,
          zone.name,
          zone.color,
          zone.seatsCount,
          zone.coordinates
        );
        zoneMap.set(zone.id, created.id);
        console.log(`✅ Зона "${zone.name}" создана`);
      } catch (error) {
        console.error(`❌ Ошибка создания зоны "${zone.name}":`, error);
      }
    }

    return zoneMap;
  }

  // Мигрировать бронирования
  async migrateBookings(localBookings, userMap, zoneMap) {
    console.log('📅 Миграция бронирований...');
    let successCount = 0;
    let errorCount = 0;

    for (const booking of localBookings) {
      try {
        const newUserId = userMap.get(booking.userId);
        const newZoneId = zoneMap.get(booking.zoneId);

        if (!newUserId || !newZoneId) {
          console.warn(`⚠️ Пропуск бронирования: пользователь или зона не найдены`);
          errorCount++;
          continue;
        }

        // Получаем первое доступное место в зоне
        const seats = await this.api.getSeatsByZone(newZoneId);
        if (seats.length === 0) {
          console.warn(`⚠️ Нет мест в зоне для бронирования`);
          errorCount++;
          continue;
        }

        await this.api.createBooking(
          seats[0].id, // Берём первое место
          newUserId,
          booking.date,
          booking.timeSlot || 'full_day',
          booking.startTime,
          booking.endTime
        );

        successCount++;
      } catch (error) {
        console.error(`❌ Ошибка создания бронирования:`, error);
        errorCount++;
      }
    }

    console.log(`✅ Успешно: ${successCount}, ❌ Ошибок: ${errorCount}`);
  }

  // Запустить полную миграцию
  async runFullMigration() {
    console.log('🚀 Начало миграции данных из localStorage в Supabase...\n');

    try {
      // 1. Получаем данные из localStorage
      const localData = this.getLocalStorageData();
      console.log('📊 Данные из localStorage:', {
        departments: localData.departments.length,
        users: localData.users.length,
        floors: localData.floors.length,
        zones: localData.zones.length,
        bookings: localData.bookings.length
      });
      console.log('\n');

      // 2. Мигрируем отделы
      const departmentMap = await this.migrateDepartments(localData.departments);
      console.log('\n');

      // 3. Мигрируем пользователей
      const userMap = await this.migrateUsers(localData.users, departmentMap);
      console.log('\n');

      // 4. Мигрируем этажи
      const floorMap = await this.migrateFloors(localData.floors);
      console.log('\n');

      // 5. Мигрируем зоны
      const zoneMap = await this.migrateZones(localData.zones, floorMap);
      console.log('\n');

      // 6. Мигрируем бронирования
      await this.migrateBookings(localData.bookings, userMap, zoneMap);
      console.log('\n');

      console.log('✅ Миграция завершена успешно!');
      console.log('💡 Теперь можно очистить localStorage: localStorage.clear()');

    } catch (error) {
      console.error('❌ Критическая ошибка миграции:', error);
    }
  }

  // Создать бэкап localStorage перед миграцией
  createBackup() {
    const backup = {
      timestamp: new Date().toISOString(),
      data: this.getLocalStorageData()
    };
    
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kb-sits-backup-${Date.now()}.json`;
    a.click();
    
    console.log('💾 Бэкап создан и скачан');
  }
}

// ═══════════════════════════════════════════════════════════════
// Использование:
// ═══════════════════════════════════════════════════════════════
// 
// 1. Откройте консоль браузера (F12)
// 2. Создайте бэкап:
//    const migration = new DataMigration(api);
//    migration.createBackup();
//
// 3. Запустите миграцию:
//    migration.runFullMigration();
//
// 4. После успешной миграции очистите localStorage:
//    localStorage.clear();
//
// ═══════════════════════════════════════════════════════════════
