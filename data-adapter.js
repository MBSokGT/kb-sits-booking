// Адаптер для работы с localStorage и Supabase
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
    
    const bookingSub = this.supabase.subscribeToBookings((payload) => {
      console.log('🔄 Обновление бронирований:', payload);
      window.dispatchEvent(new CustomEvent('bookingUpdated', { detail: payload }));
    });

    const zoneSub = this.supabase.subscribeToZones((payload) => {
      console.log('🔄 Обновление зон:', payload);
      window.dispatchEvent(new CustomEvent('zoneUpdated', { detail: payload }));
    });
  }
}

const dataAdapter = new DataAdapter();
