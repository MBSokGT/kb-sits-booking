// Полный адаптер для работы с Supabase
class SupabaseDataAdapter {
  constructor() {
    this.client = null;
    this.useSupabase = false;
  }

  async init() {
    try {
      if (typeof supabaseClient !== 'undefined') {
        await supabaseClient.init();
        this.client = supabaseClient.client;
        this.useSupabase = true;
        this.setupRealtimeSync();
        console.log('📡 Режим: Supabase (синхронизация включена)');
        return true;
      }
    } catch (error) {
      console.warn('⚠️ Supabase недоступен, используется localStorage', error);
      this.useSupabase = false;
    }
    return false;
  }

  setupRealtimeSync() {
    if (!this.useSupabase) return;
    
    this.client
      .channel('db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_bookings' }, (payload) => {
        console.log('🔄 Обновление бронирований:', payload);
        window.dispatchEvent(new CustomEvent('bookingUpdated', { detail: payload }));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_spaces' }, (payload) => {
        console.log('🔄 Обновление пространств:', payload);
        window.dispatchEvent(new CustomEvent('spaceUpdated', { detail: payload }));
      })
      .subscribe();
  }

  // Users
  async getUsers() {
    if (!this.useSupabase) return this._localStorage('users', []);
    const { data, error } = await this.client.from('app_users').select('*');
    if (error) throw error;
    return data.map(u => ({ id: u.id, email: u.email, password: u.password, name: u.name, department: u.department, role: u.role }));
  }

  async saveUsers(users) {
    if (!this.useSupabase) return this._setLocalStorage('users', users);
    // Удаляем все и вставляем заново (упрощенно)
    await this.client.from('app_users').delete().neq('id', '');
    const { error } = await this.client.from('app_users').insert(users.map(u => ({
      id: u.id, email: u.email, password: u.password, name: u.name, department: u.department, role: u.role
    })));
    if (error) throw error;
  }

  // Coworkings
  async getCoworkings() {
    if (!this.useSupabase) return this._localStorage('coworkings', []);
    const { data, error } = await this.client.from('app_coworkings').select('*');
    if (error) throw error;
    return data;
  }

  async saveCoworkings(coworkings) {
    if (!this.useSupabase) return this._setLocalStorage('coworkings', coworkings);
    await this.client.from('app_coworkings').delete().neq('id', '');
    const { error } = await this.client.from('app_coworkings').insert(coworkings);
    if (error) throw error;
  }

  // Floors
  async getFloors() {
    if (!this.useSupabase) return this._localStorage('floors', []);
    const { data, error } = await this.client.from('app_floors').select('*').order('sort_order');
    if (error) throw error;
    return data.map(f => ({ id: f.id, coworkingId: f.coworking_id, name: f.name, imageUrl: f.image_url, imageType: f.image_type, sortOrder: f.sort_order }));
  }

  async saveFloors(floors) {
    if (!this.useSupabase) return this._setLocalStorage('floors', floors);
    await this.client.from('app_floors').delete().neq('id', '');
    const { error } = await this.client.from('app_floors').insert(floors.map(f => ({
      id: f.id, coworking_id: f.coworkingId, name: f.name, image_url: f.imageUrl, image_type: f.imageType, sort_order: f.sortOrder || 0
    })));
    if (error) throw error;
  }

  // Spaces
  async getSpaces() {
    if (!this.useSupabase) return this._localStorage('spaces', []);
    const { data, error } = await this.client.from('app_spaces').select('*');
    if (error) throw error;
    return data.map(s => ({ id: s.id, floorId: s.floor_id, label: s.label, seats: s.seats, x: s.x, y: s.y, w: s.w, h: s.h, color: s.color }));
  }

  async saveSpaces(spaces) {
    if (!this.useSupabase) return this._setLocalStorage('spaces', spaces);
    await this.client.from('app_spaces').delete().neq('id', '');
    const { error } = await this.client.from('app_spaces').insert(spaces.map(s => ({
      id: s.id, floor_id: s.floorId, label: s.label, seats: s.seats, x: s.x, y: s.y, w: s.w, h: s.h, color: s.color
    })));
    if (error) throw error;
  }

  // Bookings
  async getBookings() {
    if (!this.useSupabase) return this._localStorage('bookings', []);
    const { data, error } = await this.client.from('app_bookings').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data.map(b => ({ id: b.id, userId: b.user_id, userName: b.user_name, spaceId: b.space_id, spaceName: b.space_name, date: b.date, slotFrom: b.slot_from, slotTo: b.slot_to, expiresAt: b.expires_at }));
  }

  async saveBookings(bookings) {
    if (!this.useSupabase) return this._setLocalStorage('bookings', bookings);
    await this.client.from('app_bookings').delete().neq('id', '');
    const { error } = await this.client.from('app_bookings').insert(bookings.map(b => ({
      id: b.id, user_id: b.userId, user_name: b.userName, space_id: b.spaceId, space_name: b.spaceName, date: b.date, slot_from: b.slotFrom, slot_to: b.slotTo, expires_at: b.expiresAt
    })));
    if (error) throw error;
  }

  // Helpers
  _localStorage(key, def) {
    try {
      return JSON.parse(localStorage.getItem('ws_' + key)) ?? def;
    } catch {
      return def;
    }
  }

  _setLocalStorage(key, value) {
    localStorage.setItem('ws_' + key, JSON.stringify(value));
  }

  get(k, def) { return this._localStorage(k, def); }
  set(k, v) { this._setLocalStorage(k, v); }
  uid() { return Date.now() + Math.random().toString(36).slice(2, 7); }
}

const supabaseDataAdapter = new SupabaseDataAdapter();

// Заменяем DB
if (typeof DB === 'undefined') {
  window.DB = {
    get: (k, def) => supabaseDataAdapter.get(k, def),
    set: (k, v) => supabaseDataAdapter.set(k, v),
    uid: () => supabaseDataAdapter.uid()
  };
}

// Заменяем функции CRUD
window.getUsers = () => supabaseDataAdapter.getUsers();
window.saveUsers = (v) => supabaseDataAdapter.saveUsers(v);
window.getCoworkings = () => supabaseDataAdapter.getCoworkings();
window.saveCoworkings = (v) => supabaseDataAdapter.saveCoworkings(v);
window.getFloors = () => supabaseDataAdapter.getFloors();
window.saveFloors = (v) => supabaseDataAdapter.saveFloors(v);
window.getSpaces = () => supabaseDataAdapter.getSpaces();
window.saveSpaces = (v) => supabaseDataAdapter.saveSpaces(v);
window.getBookings = () => supabaseDataAdapter.getBookings();
window.saveBookings = (v) => supabaseDataAdapter.saveBookings(v);
