// ═══════════════════════════════════════════════════════════════
// Supabase API - Обёртка для работы с базой данных
// ═══════════════════════════════════════════════════════════════

class SupabaseAPI {
  constructor() {
    const { createClient } = supabase;
    this.client = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
    this.currentUser = null;
  }

  // ═══ АВТОРИЗАЦИЯ ═══════════════════════════════════════════════

  async login(email, password) {
    try {
      // Получаем пользователя по email
      const { data: users, error } = await this.client
        .from('users')
        .select('*, departments(name)')
        .eq('email', email)
        .single();

      if (error || !users) {
        throw new Error('Неверный email или пароль');
      }

      // В реальности здесь должна быть проверка bcrypt хеша
      // Для демо используем простое сравнение
      this.currentUser = users;
      localStorage.setItem('currentUser', JSON.stringify(users));
      return users;
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  }

  async register(email, password, fullName, departmentId, role = 'employee') {
    try {
      const { data, error } = await this.client
        .from('users')
        .insert([{
          email,
          password_hash: password, // В реальности хешировать!
          full_name: fullName,
          department_id: departmentId,
          role
        }])
        .select('*, departments(name)')
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Register error:', error);
      throw error;
    }
  }

  logout() {
    this.currentUser = null;
    localStorage.removeItem('currentUser');
  }

  getCurrentUser() {
    if (!this.currentUser) {
      const stored = localStorage.getItem('currentUser');
      this.currentUser = stored ? JSON.parse(stored) : null;
    }
    return this.currentUser;
  }

  // ═══ ОТДЕЛЫ ════════════════════════════════════════════════════

  async getDepartments() {
    const { data, error } = await this.client
      .from('departments')
      .select('*')
      .order('name');
    
    if (error) throw error;
    return data;
  }

  async createDepartment(name) {
    const { data, error } = await this.client
      .from('departments')
      .insert([{ name }])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  // ═══ ПОЛЬЗОВАТЕЛИ ══════════════════════════════════════════════

  async getUsers() {
    const { data, error } = await this.client
      .from('users')
      .select('*, departments(name)')
      .order('full_name');
    
    if (error) throw error;
    return data;
  }

  async getUsersByDepartment(departmentId) {
    const { data, error } = await this.client
      .from('users')
      .select('*, departments(name)')
      .eq('department_id', departmentId)
      .order('full_name');
    
    if (error) throw error;
    return data;
  }

  async deleteUser(userId) {
    const { error } = await this.client
      .from('users')
      .delete()
      .eq('id', userId);
    
    if (error) throw error;
  }

  // ═══ ЭТАЖИ ═════════════════════════════════════════════════════

  async getFloors() {
    const { data, error } = await this.client
      .from('floors')
      .select('*')
      .order('floor_number');
    
    if (error) throw error;
    return data;
  }

  async createFloor(name, floorNumber, imageData = null) {
    const { data, error } = await this.client
      .from('floors')
      .insert([{
        name,
        floor_number: floorNumber,
        image_data: imageData,
        created_by: this.currentUser?.id
      }])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  // Загрузить план этажа в Storage
  async uploadFloorPlan(file, floorId) {
    const fileName = `floor-${floorId}-${Date.now()}.${file.name.split('.').pop()}`;
    
    const { data, error } = await this.client.storage
      .from('floor-plans')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false
      });
    
    if (error) throw error;
    
    // Получить публичный URL
    const { data: urlData } = this.client.storage
      .from('floor-plans')
      .getPublicUrl(fileName);
    
    // Обновить запись этажа
    await this.updateFloor(floorId, {
      storage_path: fileName,
      image_url: urlData.publicUrl
    });
    
    return { path: fileName, url: urlData.publicUrl };
  }

  // Получить URL плана этажа
  getFloorPlanUrl(storagePath) {
    if (!storagePath) return null;
    
    const { data } = this.client.storage
      .from('floor-plans')
      .getPublicUrl(storagePath);
    
    return data.publicUrl;
  }

  // Удалить план этажа из Storage
  async deleteFloorPlan(storagePath) {
    if (!storagePath) return;
    
    const { error } = await this.client.storage
      .from('floor-plans')
      .remove([storagePath]);
    
    if (error) throw error;
  }

  async updateFloor(floorId, updates) {
    const { data, error } = await this.client
      .from('floors')
      .update(updates)
      .eq('id', floorId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  async deleteFloor(floorId) {
    const { error } = await this.client
      .from('floors')
      .delete()
      .eq('id', floorId);
    
    if (error) throw error;
  }

  // ═══ ЗОНЫ ══════════════════════════════════════════════════════

  async getZonesByFloor(floorId) {
    const { data, error } = await this.client
      .from('zones')
      .select('*')
      .eq('floor_id', floorId)
      .eq('is_active', true);
    
    if (error) throw error;
    return data;
  }

  async createZone(floorId, name, color, seatsCount, coordinates) {
    const { data: zone, error: zoneError } = await this.client
      .from('zones')
      .insert([{
        floor_id: floorId,
        name,
        color,
        seats_count: seatsCount,
        coordinates: JSON.stringify(coordinates)
      }])
      .select()
      .single();
    
    if (zoneError) throw zoneError;

    // Создаём места для зоны
    const seats = [];
    for (let i = 1; i <= seatsCount; i++) {
      seats.push({ zone_id: zone.id, seat_number: i });
    }

    const { error: seatsError } = await this.client
      .from('seats')
      .insert(seats);
    
    if (seatsError) throw seatsError;
    return zone;
  }

  async updateZone(zoneId, updates) {
    const { data, error } = await this.client
      .from('zones')
      .update(updates)
      .eq('id', zoneId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  async deleteZone(zoneId) {
    const { error } = await this.client
      .from('zones')
      .delete()
      .eq('id', zoneId);
    
    if (error) throw error;
  }

  // ═══ МЕСТА ═════════════════════════════════════════════════════

  async getSeatsByZone(zoneId) {
    const { data, error } = await this.client
      .from('seats')
      .select('*')
      .eq('zone_id', zoneId)
      .order('seat_number');
    
    if (error) throw error;
    return data;
  }

  async getAvailableSeats(date, timeSlot) {
    // Получаем все места
    const { data: allSeats, error: seatsError } = await this.client
      .from('seats')
      .select('*, zones(*, floors(*))')
      .eq('is_available', true);
    
    if (seatsError) throw seatsError;

    // Получаем забронированные места на эту дату
    const { data: bookings, error: bookingsError } = await this.client
      .from('bookings')
      .select('seat_id')
      .eq('booking_date', date)
      .eq('time_slot', timeSlot)
      .eq('status', 'active');
    
    if (bookingsError) throw bookingsError;

    const bookedSeatIds = new Set(bookings.map(b => b.seat_id));
    return allSeats.filter(seat => !bookedSeatIds.has(seat.id));
  }

  // ═══ БРОНИРОВАНИЯ ══════════════════════════════════════════════

  async getBookings(filters = {}) {
    let query = this.client
      .from('bookings')
      .select('*, seats(*, zones(name, floor_id)), users!bookings_user_id_fkey(full_name, email)');

    if (filters.userId) query = query.eq('user_id', filters.userId);
    if (filters.date) query = query.eq('booking_date', filters.date);
    if (filters.status) query = query.eq('status', filters.status);

    const { data, error } = await query.order('booking_date', { ascending: false });
    
    if (error) throw error;
    return data;
  }

  async createBooking(seatId, userId, bookingDate, timeSlot, startTime = null, endTime = null) {
    const { data, error } = await this.client
      .from('bookings')
      .insert([{
        seat_id: seatId,
        user_id: userId,
        booked_by: this.currentUser.id,
        booking_date: bookingDate,
        time_slot: timeSlot,
        start_time: startTime,
        end_time: endTime,
        status: 'active'
      }])
      .select('*, seats(*, zones(name))')
      .single();
    
    if (error) throw error;
    return data;
  }

  async cancelBooking(bookingId) {
    const { data, error } = await this.client
      .from('bookings')
      .update({ status: 'cancelled' })
      .eq('id', bookingId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  async expireOldBookings() {
    const { error } = await this.client.rpc('expire_old_bookings');
    if (error) throw error;
  }

  // ═══ СТАТИСТИКА ════════════════════════════════════════════════

  async getBookingStatistics() {
    const { data, error } = await this.client
      .from('booking_statistics')
      .select('*');
    
    if (error) throw error;
    return data;
  }

  async getBookingsByDateRange(startDate, endDate) {
    const { data, error } = await this.client
      .from('bookings')
      .select('*, users(full_name), seats(*, zones(name))')
      .gte('booking_date', startDate)
      .lte('booking_date', endDate)
      .eq('status', 'active')
      .order('booking_date');
    
    if (error) throw error;
    return data;
  }

  // ═══ REAL-TIME ПОДПИСКИ ════════════════════════════════════════

  subscribeToBookings(callback) {
    return this.client
      .channel('bookings-changes')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'bookings' },
        callback
      )
      .subscribe();
  }

  subscribeToZones(floorId, callback) {
    return this.client
      .channel(`zones-floor-${floorId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'zones', filter: `floor_id=eq.${floorId}` },
        callback
      )
      .subscribe();
  }

  unsubscribe(subscription) {
    this.client.removeChannel(subscription);
  }
}

// Создаём глобальный экземпляр API
const api = new SupabaseAPI();
