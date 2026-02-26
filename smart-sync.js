// Умный прокси-слой для автоматической синхронизации с Supabase
class SmartSyncAdapter {
  constructor() {
    this.client = null;
    this.useSupabase = false;
    this.syncQueue = [];
    this.syncing = false;
  }

  async init() {
    try {
      if (typeof supabaseClient !== 'undefined') {
        await supabaseClient.init();
        this.client = supabaseClient.client;
        this.useSupabase = true;
        this.setupRealtimeSync();
        await this.loadFromSupabase();
        console.log('📡 Режим: Supabase (полная синхронизация)');
        return true;
      }
    } catch (error) {
      console.warn('⚠️ Supabase недоступен:', error);
      this.useSupabase = false;
    }
    return false;
  }

  // Загрузка всех данных из Supabase в localStorage
  async loadFromSupabase() {
    if (!this.useSupabase) return;
    
    try {
      // Users
      const { data: users } = await this.client.from('app_users').select('*');
      if (users) localStorage.setItem('ws_users', JSON.stringify(users.map(u => ({
        id: u.id, email: u.email, password: u.password, name: u.name, department: u.department, role: u.role
      }))));

      // Coworkings
      const { data: coworkings } = await this.client.from('app_coworkings').select('*');
      if (coworkings) localStorage.setItem('ws_coworkings', JSON.stringify(coworkings));

      // Floors
      const { data: floors } = await this.client.from('app_floors').select('*');
      if (floors) localStorage.setItem('ws_floors', JSON.stringify(floors.map(f => ({
        id: f.id, coworkingId: f.coworking_id, name: f.name, imageUrl: f.image_url, imageType: f.image_type, sortOrder: f.sort_order
      }))));

      // Spaces
      const { data: spaces } = await this.client.from('app_spaces').select('*');
      if (spaces) localStorage.setItem('ws_spaces', JSON.stringify(spaces.map(s => ({
        id: s.id, floorId: s.floor_id, label: s.label, seats: s.seats, x: s.x, y: s.y, w: s.w, h: s.h, color: s.color
      }))));

      // Bookings
      const { data: bookings } = await this.client.from('app_bookings').select('*');
      if (bookings) localStorage.setItem('ws_bookings', JSON.stringify(bookings.map(b => ({
        id: b.id, userId: b.user_id, userName: b.user_name, spaceId: b.space_id, spaceName: b.space_name, 
        date: b.date, slotFrom: b.slot_from, slotTo: b.slot_to, expiresAt: b.expires_at
      }))));

      console.log('✅ Данные загружены из Supabase');
    } catch (error) {
      console.error('Ошибка загрузки из Supabase:', error);
    }
  }

  // Real-time синхронизация
  setupRealtimeSync() {
    if (!this.useSupabase) return;
    
    this.client
      .channel('sync-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_bookings' }, () => {
        this.loadFromSupabase();
        window.location.reload(); // Простое решение - перезагрузка
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_spaces' }, () => {
        this.loadFromSupabase();
        window.location.reload();
      })
      .subscribe();
  }

  // Перехват localStorage.setItem
  async syncToSupabase(key, value) {
    if (!this.useSupabase) return;
    
    try {
      const data = JSON.parse(value);
      
      if (key === 'ws_users') {
        await this.client.from('app_users').delete().neq('id', '');
        await this.client.from('app_users').insert(data.map(u => ({
          id: u.id, email: u.email, password: u.password, name: u.name, department: u.department, role: u.role
        })));
      }
      
      if (key === 'ws_coworkings') {
        await this.client.from('app_coworkings').delete().neq('id', '');
        await this.client.from('app_coworkings').insert(data);
      }
      
      if (key === 'ws_floors') {
        await this.client.from('app_floors').delete().neq('id', '');
        await this.client.from('app_floors').insert(data.map(f => ({
          id: f.id, coworking_id: f.coworkingId, name: f.name, image_url: f.imageUrl, 
          image_type: f.imageType, sort_order: f.sortOrder || 0
        })));
      }
      
      if (key === 'ws_spaces') {
        await this.client.from('app_spaces').delete().neq('id', '');
        await this.client.from('app_spaces').insert(data.map(s => ({
          id: s.id, floor_id: s.floorId, label: s.label, seats: s.seats, 
          x: s.x, y: s.y, w: s.w, h: s.h, color: s.color
        })));
      }
      
      if (key === 'ws_bookings') {
        await this.client.from('app_bookings').delete().neq('id', '');
        await this.client.from('app_bookings').insert(data.map(b => ({
          id: b.id, user_id: b.userId, user_name: b.userName, space_id: b.spaceId, 
          space_name: b.spaceName, date: b.date, slot_from: b.slotFrom, 
          slot_to: b.slotTo, expires_at: b.expiresAt
        })));
      }
    } catch (error) {
      console.error('Ошибка синхронизации с Supabase:', error);
    }
  }
}

const smartSync = new SmartSyncAdapter();

// Перехватываем localStorage.setItem
const originalSetItem = localStorage.setItem;
localStorage.setItem = function(key, value) {
  originalSetItem.call(localStorage, key, value);
  if (key.startsWith('ws_')) {
    smartSync.syncToSupabase(key, value);
  }
};

// Инициализация при загрузке
window.addEventListener('DOMContentLoaded', async () => {
  await smartSync.init();
});
