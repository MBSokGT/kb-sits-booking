// Адаптер для работы с localStorage и Supabase
class DataAdapter {
  constructor() {
    this.useSupabase = false;
    this.supabase = null;
    this.subscriptions = [];
  }

  // Инициализация
  async init() {
    try {
      await supabaseClient.init();
      this.supabase = supabaseClient;
      this.useSupabase = true;
      this.setupRealtimeSync();
      console.log('📡 Режим: Supabase (синхронизация включена)');
    } catch (error) {
      console.warn('⚠️ Supabase недоступен, используется localStorage');
      this.useSupabase = false;
    }
  }

  // Настройка real-time синхронизации
  setupRealtimeSync() {
    if (!this.useSupabase) return;

    // Подписка на изменения бронирований
    const bookingSub = this.supabase.subscribeToBookings((payload) => {
      console.log('🔄 Обновление бронирований:', payload);
      window.dispatchEvent(new CustomEvent('bookingUpdated', { detail: payload }));
    });

    // Подписка на изменения зон
    const zoneSub = this.supabase.subscribeToZones((payload) => {
      console.log('🔄 Обновление зон:', payload);
      window.dispatchEvent(new CustomEvent('zoneUpdated', { detail: payload }));
    });

    this.subscriptions.push(bookingSub, zoneSub);
  }

  // Авторизация
  async login(email, password) {
    if (this.useSupabase) {
      const data = await this.supabase.signIn(email, password);
      const { data: userData } = await this.supabase.client
        .from('users')
        .select('*')
        .eq('id', data.user.id)
        .single();
      return userData;
    } else {
      const users = JSON.parse(localStorage.getItem('users') || '[]');
      return users.find(u => u.email === email && u.password === password);
    }
  }

  async register(email, password, fullName, departmentId) {
    if (this.useSupabase) {
      await this.supabase.signUp(email, password, fullName, departmentId);
    } else {
      const users = JSON.parse(localStorage.getItem('users') || '[]');
      const newUser = {
        id: Date.now().toString(),
        email,
        password,
        fullName,
        departmentId,
        role: 'employee',
        createdAt: new Date().toISOString()
      };
      users.push(newUser);
      localStorage.setItem('users', JSON.stringify(users));
    }
  }

  // Получение этажей
  async getFloors() {
    if (this.useSupabase) {
      return await this.supabase.getFloors();
    } else {
      return JSON.parse(localStorage.getItem('floors') || '[]');
    }
  }

  // Получение зон
  async getZones(floorId) {
    if (this.useSupabase) {
      return await this.supabase.getZones(floorId);
    } else {
      const zones = JSON.parse(localStorage.getItem('zones') || '[]');
      return zones.filter(z => z.floorId === floorId);
    }
  }

  // Получение бронирований
  async getBookings(date) {
    if (this.useSupabase) {
      return await this.supabase.getBookings(date);
    } else {
      const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
      return bookings.filter(b => b.bookingDate === date && b.status === 'active');
    }
  }

  // Создание бронирования
  async createBooking(bookingData) {
    if (this.useSupabase) {
      return await this.supabase.createBooking(
        bookingData.seatId,
        bookingData.userId,
        bookingData.bookedBy,
        bookingData.bookingDate,
        bookingData.timeSlot,
        bookingData.startTime,
        bookingData.endTime
      );
    } else {
      const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
      const newBooking = {
        id: Date.now().toString(),
        ...bookingData,
        status: 'active',
        createdAt: new Date().toISOString()
      };
      bookings.push(newBooking);
      localStorage.setItem('bookings', JSON.stringify(bookings));
      return newBooking;
    }
  }

  // Отмена бронирования
  async cancelBooking(bookingId) {
    if (this.useSupabase) {
      await this.supabase.cancelBooking(bookingId);
    } else {
      const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
      const booking = bookings.find(b => b.id === bookingId);
      if (booking) {
        booking.status = 'cancelled';
        localStorage.setItem('bookings', JSON.stringify(bookings));
      }
    }
  }

  // Создание зоны (админ)
  async createZone(zoneData) {
    if (this.useSupabase) {
      return await this.supabase.createZone(
        zoneData.floorId,
        zoneData.name,
        zoneData.color,
        zoneData.seatsCount,
        zoneData.coordinates
      );
    } else {
      const zones = JSON.parse(localStorage.getItem('zones') || '[]');
      const newZone = {
        id: Date.now().toString(),
        ...zoneData,
        isActive: true,
        createdAt: new Date().toISOString()
      };
      zones.push(newZone);
      localStorage.setItem('zones', JSON.stringify(zones));
      return newZone;
    }
  }

  // Обновление зоны (админ)
  async updateZone(zoneId, updates) {
    if (this.useSupabase) {
      await this.supabase.updateZone(zoneId, updates);
    } else {
      const zones = JSON.parse(localStorage.getItem('zones') || '[]');
      const zone = zones.find(z => z.id === zoneId);
      if (zone) {
        Object.assign(zone, updates);
        localStorage.setItem('zones', JSON.stringify(zones));
      }
    }
  }

  // Удаление зоны (админ)
  async deleteZone(zoneId) {
    if (this.useSupabase) {
      await this.supabase.deleteZone(zoneId);
    } else {
      const zones = JSON.parse(localStorage.getItem('zones') || '[]');
      const filtered = zones.filter(z => z.id !== zoneId);
      localStorage.setItem('zones', JSON.stringify(filtered));
    }
  }

  // Очистка подписок
  cleanup() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];
  }
}

// Глобальный экземпляр
const dataAdapter = new DataAdapter();
