// Полный адаптер данных для localStorage и Supabase
class DataAdapter {
  constructor() {
    this.useSupabase = false;
    this.supabase = null;
  }

  async init() {
    try {
      if (typeof supabaseClient !== 'undefined') {
        await supabaseClient.init();
        this.supabase = supabaseClient;
        this.useSupabase = true;
        this.setupRealtimeSync();
        console.log('📡 Режим: Supabase (синхронизация включена)');
      }
    } catch (error) {
      console.warn('⚠️ Supabase недоступен, используется localStorage', error);
      this.useSupabase = false;
    }
  }

  setupRealtimeSync() {
    if (!this.useSupabase) return;
    
    this.supabase.subscribeToBookings((payload) => {
      console.log('🔄 Обновление бронирований:', payload);
      window.dispatchEvent(new CustomEvent('bookingUpdated', { detail: payload }));
    });

    this.supabase.subscribeToZones((payload) => {
      console.log('🔄 Обновление зон:', payload);
      window.dispatchEvent(new CustomEvent('zoneUpdated', { detail: payload }));
    });
  }

  // Утилиты
  get(k, def) { 
    try { 
      return JSON.parse(localStorage.getItem('ws_'+k)) ?? def 
    } catch { 
      return def 
    } 
  }
  
  set(k, v) { 
    localStorage.setItem('ws_'+k, JSON.stringify(v)) 
  }
  
  uid() { 
    return Date.now() + Math.random().toString(36).slice(2,7) 
  }

  // Users
  getUsers() {
    return this.get('users', []);
  }

  saveUsers(users) {
    this.set('users', users);
  }

  // Coworkings
  getCoworkings() {
    return this.get('coworkings', []);
  }

  saveCoworkings(coworkings) {
    this.set('coworkings', coworkings);
  }

  // Floors
  getFloors() {
    return this.get('floors', []);
  }

  saveFloors(floors) {
    this.set('floors', floors);
  }

  // Spaces (zones)
  getSpaces() {
    return this.get('spaces', []);
  }

  saveSpaces(spaces) {
    this.set('spaces', spaces);
  }

  // Bookings
  getBookings() {
    return this.get('bookings', []);
  }

  saveBookings(bookings) {
    this.set('bookings', bookings);
  }
}

const dataAdapter = new DataAdapter();

// Заменяем глобальный DB на dataAdapter (только если еще не определен)
if (typeof DB === 'undefined') {
  window.DB = {
    get: (k, def) => dataAdapter.get(k, def),
    set: (k, v) => dataAdapter.set(k, v),
    uid: () => dataAdapter.uid()
  };
}
