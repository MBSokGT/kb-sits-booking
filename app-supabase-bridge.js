// Мост между старым app.js и новым Supabase адаптером
(async function() {
  await dataAdapter.init();
  
  // Переопределяем DB методы для работы с Supabase
  window.DB = {
    get: async (key, def) => {
      try {
        switch(key) {
          case 'floors': return await dataAdapter.getFloors() || def;
          case 'zones': return await dataAdapter.getZones() || def;
          case 'bookings': return await dataAdapter.getBookings() || def;
          case 'users': return await dataAdapter.getUsers() || def;
          case 'departments': return await dataAdapter.getDepartments() || def;
          default: return JSON.parse(localStorage.getItem('ws_' + key)) || def;
        }
      } catch(e) { console.error('DB.get error:', e); return def; }
    },
    set: async (key, value) => {
      try {
        switch(key) {
          case 'floors': return await dataAdapter.saveFloors?.(value);
          case 'zones': return await dataAdapter.saveZones?.(value);
          case 'bookings': return await dataAdapter.saveBookings?.(value);
          default: localStorage.setItem('ws_' + key, JSON.stringify(value));
        }
      } catch(e) { console.error('DB.set error:', e); }
    },
    uid: () => Date.now() + Math.random().toString(36).slice(2, 7)
  };
  
  console.log('✅ Supabase bridge активен');
})();
