// Supabase клиент для синхронизации данных между пользователями
class SupabaseClient {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.currentUser = null;
  }

  // Инициализация подключения
  async init() {
    try {
      this.client = supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
      this.isConnected = true;
      console.log('✅ Supabase подключен');
      return true;
    } catch (error) {
      console.error('❌ Ошибка подключения к Supabase:', error);
      return false;
    }
  }

  // Авторизация
  async signIn(email, password) {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this.currentUser = data.user;
    return data;
  }

  async signUp(email, password, fullName, departmentId) {
    const { data, error } = await this.client.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, department_id: departmentId }
      }
    });
    if (error) throw error;
    return data;
  }

  async signOut() {
    await this.client.auth.signOut();
    this.currentUser = null;
  }

  // Получение данных
  async getFloors() {
    const { data, error } = await this.client.from('floors').select('*').order('floor_number');
    if (error) throw error;
    return data;
  }

  async getZones(floorId) {
    const { data, error } = await this.client
      .from('zones')
      .select('*')
      .eq('floor_id', floorId)
      .eq('is_active', true);
    if (error) throw error;
    return data;
  }

  async getSeats(zoneId) {
    const { data, error } = await this.client
      .from('seats')
      .select('*')
      .eq('zone_id', zoneId)
      .eq('is_available', true);
    if (error) throw error;
    return data;
  }

  async getBookings(date) {
    const { data, error } = await this.client
      .from('bookings')
      .select(`
        *,
        seat:seats(*),
        user:users(full_name, email),
        booked_by_user:users!booked_by(full_name)
      `)
      .eq('booking_date', date)
      .eq('status', 'active');
    if (error) throw error;
    return data;
  }

  // Создание бронирования
  async createBooking(seatId, userId, bookedBy, bookingDate, timeSlot, startTime, endTime) {
    const { data, error } = await this.client
      .from('bookings')
      .insert({
        seat_id: seatId,
        user_id: userId,
        booked_by: bookedBy,
        booking_date: bookingDate,
        time_slot: timeSlot,
        start_time: startTime,
        end_time: endTime
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // Отмена бронирования
  async cancelBooking(bookingId) {
    const { error } = await this.client
      .from('bookings')
      .update({ status: 'cancelled' })
      .eq('id', bookingId);
    if (error) throw error;
  }

  // Подписка на изменения бронирований (реал-тайм)
  subscribeToBookings(callback) {
    return this.client
      .channel('bookings-changes')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'bookings' },
        callback
      )
      .subscribe();
  }

  // Подписка на изменения зон
  subscribeToZones(callback) {
    return this.client
      .channel('zones-changes')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'zones' },
        callback
      )
      .subscribe();
  }

  // Админ: создание зоны
  async createZone(floorId, name, color, seatsCount, coordinates) {
    const { data, error } = await this.client
      .from('zones')
      .insert({
        floor_id: floorId,
        name,
        color,
        seats_count: seatsCount,
        coordinates
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // Админ: обновление зоны
  async updateZone(zoneId, updates) {
    const { error } = await this.client
      .from('zones')
      .update(updates)
      .eq('id', zoneId);
    if (error) throw error;
  }

  // Админ: удаление зоны
  async deleteZone(zoneId) {
    const { error } = await this.client
      .from('zones')
      .delete()
      .eq('id', zoneId);
    if (error) throw error;
  }
}

// Глобальный экземпляр
const supabaseClient = new SupabaseClient();
