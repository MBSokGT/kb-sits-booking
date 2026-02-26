// Синхронный мост между app.js и Supabase
const SupabaseBridge = {
  cache: { floors: [], zones: [], bookings: [], users: [], departments: [] },
  
  async init() {
    await dataAdapter.init();
    await this.loadAll();
    this.setupSync();
    console.log('✅ Bridge готов');
  },
  
  async loadAll() {
    this.cache.floors = await dataAdapter.getFloors() || [];
    this.cache.zones = await dataAdapter.getZones() || [];
    this.cache.bookings = await dataAdapter.getBookings() || [];
    this.cache.users = await dataAdapter.getUsers() || [];
    this.cache.departments = await dataAdapter.getDepartments() || [];
  },
  
  setupSync() {
    window.addEventListener('realtimeFloor', () => this.loadAll().then(() => location.reload()));
    window.addEventListener('realtimeZone', () => this.loadAll().then(() => location.reload()));
    window.addEventListener('realtimeBooking', () => this.loadAll().then(() => location.reload()));
  }
};

window.DB = {
  get: (key, def) => SupabaseBridge.cache[key] || def,
  set: async (key, value) => {
    SupabaseBridge.cache[key] = value;
    if (key === 'floors') await dataAdapter.createFloor?.(value[value.length-1]);
    if (key === 'zones') await dataAdapter.createZone?.(value[value.length-1]);
    if (key === 'bookings') await dataAdapter.createBooking?.(value[value.length-1]);
  },
  uid: () => crypto.randomUUID?.() || Date.now() + Math.random().toString(36).slice(2)
};

SupabaseBridge.init();
