// ═══════════════════════════════════════════════════════════════
// Supabase Data Adapter - ТОЛЬКО Supabase, БЕЗ localStorage
// ═══════════════════════════════════════════════════════════════

class SupabaseDataAdapter {
  constructor() {
    this.client = null;
    this.currentUser = null;
  }

  async init() {
    if (typeof supabaseClient === 'undefined') {
      throw new Error('Supabase client не найден');
    }
    
    await supabaseClient.init();
    this.client = supabaseClient.client;
    
    // Получаем текущего пользователя
    const { data: { session } } = await this.client.auth.getSession();
    if (session) {
      this.currentUser = session.user;
    }
    
    // Автоматическая подписка на изменения
    this.setupRealtimeSync();
    
    console.log('✅ Supabase подключен + Realtime активен');
    return true;
  }

  setupRealtimeSync() {
    // Подписка на бронирования
    this.client
      .channel('all-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, (payload) => {
        console.log('🔄 Bookings:', payload);
        window.dispatchEvent(new CustomEvent('realtimeBooking', { detail: payload }));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'zones' }, (payload) => {
        console.log('🔄 Zones:', payload);
        window.dispatchEvent(new CustomEvent('realtimeZone', { detail: payload }));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'floors' }, (payload) => {
        console.log('🔄 Floors:', payload);
        window.dispatchEvent(new CustomEvent('realtimeFloor', { detail: payload }));
      })
      .subscribe((status) => {
        console.log('📡 Realtime status:', status);
      });
  }

  // ═══════════════════════════════════════════════════════════════
  // AUTH
  // ═══════════════════════════════════════════════════════════════
  
  async login(email, password) {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this.currentUser = data.user;
    return data.user;
  }

  async register(email, password, fullName, department) {
    const { data, error } = await this.client.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, department }
      }
    });
    if (error) throw error;
    return data.user;
  }

  async logout() {
    const { error } = await this.client.auth.signOut();
    if (error) throw error;
    this.currentUser = null;
  }

  // ═══════════════════════════════════════════════════════════════
  // USERS
  // ═══════════════════════════════════════════════════════════════
  
  async getUsers() {
    const { data, error } = await this.client.from('users').select('*');
    if (error) throw error;
    return data;
  }

  async getCurrentUser() {
    if (!this.currentUser) return null;
    const { data, error } = await this.client
      .from('users')
      .select('*')
      .eq('id', this.currentUser.id)
      .single();
    if (error) throw error;
    return data;
  }

  // ═══════════════════════════════════════════════════════════════
  // DEPARTMENTS
  // ═══════════════════════════════════════════════════════════════
  
  async getDepartments() {
    const { data, error } = await this.client.from('departments').select('*');
    if (error) throw error;
    return data;
  }

  // ═══════════════════════════════════════════════════════════════
  // FLOORS
  // ═══════════════════════════════════════════════════════════════
  
  async getFloors() {
    const { data, error } = await this.client
      .from('floors')
      .select('*')
      .order('floor_number');
    if (error) throw error;
    return data;
  }

  async createFloor(floor) {
    const { data, error } = await this.client
      .from('floors')
      .insert([{
        name: floor.name,
        floor_number: floor.floor_number,
        image_url: floor.image_url,
        image_data: floor.image_data,
        created_by: this.currentUser?.id
      }])
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async updateFloor(id, updates) {
    const { data, error } = await this.client
      .from('floors')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async deleteFloor(id) {
    const { error } = await this.client.from('floors').delete().eq('id', id);
    if (error) throw error;
  }

  // ═══════════════════════════════════════════════════════════════
  // ZONES
  // ═══════════════════════════════════════════════════════════════
  
  async getZones(floorId) {
    const query = this.client.from('zones').select('*');
    if (floorId) query.eq('floor_id', floorId);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  async createZone(zone) {
    const { data, error } = await this.client
      .from('zones')
      .insert([zone])
      .select()
      .single();
    if (error) throw error;
    
    // Создаем места для зоны
    const seats = [];
    for (let i = 1; i <= zone.seats_count; i++) {
      seats.push({ zone_id: data.id, seat_number: i });
    }
    await this.client.from('seats').insert(seats);
    
    return data;
  }

  async updateZone(id, updates) {
    const { data, error } = await this.client
      .from('zones')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async deleteZone(id) {
    const { error } = await this.client.from('zones').delete().eq('id', id);
    if (error) throw error;
  }

  // ═══════════════════════════════════════════════════════════════
  // SEATS
  // ═══════════════════════════════════════════════════════════════
  
  async getSeats(zoneId) {
    const query = this.client.from('seats').select('*');
    if (zoneId) query.eq('zone_id', zoneId);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  // ═══════════════════════════════════════════════════════════════
  // BOOKINGS
  // ═══════════════════════════════════════════════════════════════
  
  async getBookings(filters = {}) {
    let query = this.client
      .from('bookings')
      .select(`
        *,
        seat:seats(*),
        user:users(full_name, email),
        booked_by_user:users!bookings_booked_by_fkey(full_name, email)
      `)
      .order('created_at', { ascending: false });

    if (filters.userId) query = query.eq('user_id', filters.userId);
    if (filters.date) query = query.eq('booking_date', filters.date);
    if (filters.status) query = query.eq('status', filters.status);

    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  async createBooking(booking) {
    const { data, error } = await this.client
      .from('bookings')
      .insert([{
        seat_id: booking.seat_id,
        user_id: booking.user_id || this.currentUser?.id,
        booked_by: this.currentUser?.id,
        booking_date: booking.booking_date,
        time_slot: booking.time_slot,
        start_time: booking.start_time,
        end_time: booking.end_time
      }])
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async cancelBooking(id) {
    const { data, error } = await this.client
      .from('bookings')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // ═══════════════════════════════════════════════════════════════
  // REALTIME
  // ═══════════════════════════════════════════════════════════════
  
  subscribeToBookings(callback) {
    return this.client
      .channel('bookings-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, callback)
      .subscribe();
  }

  subscribeToZones(callback) {
    return this.client
      .channel('zones-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'zones' }, callback)
      .subscribe();
  }

  subscribeToFloors(callback) {
    return this.client
      .channel('floors-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'floors' }, callback)
      .subscribe();
  }

  unsubscribe(channel) {
    this.client.removeChannel(channel);
  }
}

// Глобальный экземпляр
window.dataAdapter = new SupabaseDataAdapter();
