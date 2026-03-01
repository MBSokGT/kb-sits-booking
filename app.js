/* ═══════════════════════════════════════════════════════
   SECURITY UTILS
═══════════════════════════════════════════════════════ */
function escapeHtml(text) {
  if (!text) return '';
  const map = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":"&#039;" };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

function escapeCSV(value) {
  if (!value) return '';
  const escaped = String(value).replace(/"/g, '""');
  return /[,"\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

// Разрешаем только hex-цвета (#rgb / #rrggbb / #rrggbbaa) — больше ничего в style-атрибуты
function safeCssColor(color, fallback = '#059669') {
  return /^#[0-9a-fA-F]{3,8}$/.test(String(color)) ? color : fallback;
}

// Разрешаем только data:image/ URL для планов этажей — блокируем javascript: и любые внешние URL
function safeImageUrl(url) {
  if (!url) return null;
  return String(url).startsWith('data:image/') ? url : null;
}

/* ═══════════════════════════════════════════════════════
   DATA LAYER  (localStorage — swap to fetch() later)
═══════════════════════════════════════════════════════ */
// Declared here so DB._push can safely reference it during seed (avoids TDZ)
let currentUser = null;

const DB = {
  get(k, def){ 
    try{ 
      const item = localStorage.getItem('ws_'+k);
      return item ? JSON.parse(item) : def;
    } catch(e) { 
      console.warn('localStorage error:', e);
      return def;
    } 
  },
  set(k,v){ 
    try {
      localStorage.setItem('ws_'+k, JSON.stringify(v));
    } catch(e) {
      console.error('localStorage full or disabled:', e);
      alert('⚠️ Хранилище браузера переполнено или отключено. Данные не сохранены.');
    }
    // Async push to D1 (skip auth keys; fire-and-forget)
    if (k !== 'session' && k !== 'users') DB._push(k, v);
  },
  _push(k, v) {
    if (!currentUser) return; // don't push before login
    fetch('/api/kv/' + encodeURIComponent(k), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: v })
    }).catch(() => {}); // silently ignore when offline
  },
  uid(){ return Date.now() + Math.random().toString(36).slice(2,7) }
};

/* ── Initial seed ─────────────────────────────────────────────────────────── */
// Users are managed server-side via D1 — no local seed needed.
// Populated from /api/users on login via syncFromD1().
if (!DB.get('coworkings', null)) {
  DB.set('coworkings', [{ id:'c1', name:'Главный коворкинг' }]);
}
if (!DB.get('floors', null)) {
  const cid = 'c1';
  const fid = 'f1';
  DB.set('floors', [{ id: fid, coworkingId: cid, name: 'Этаж 4', imageUrl: null, imageType: null, sortOrder: 1 }]);
  DB.set('spaces', [
    { id:'s1', floorId:fid, label:'Кабинет 401',  seats:3, x:3,  y:3,  w:22, h:18, color:'#3b82f6' },
    { id:'s2', floorId:fid, label:'Кабинет 402',  seats:4, x:3,  y:25, w:22, h:18, color:'#3b82f6' },
    { id:'s3', floorId:fid, label:'HR / T&D',     seats:2, x:3,  y:47, w:22, h:16, color:'#8b5cf6' },
    { id:'s4', floorId:fid, label:'Переговорная', seats:8, x:3,  y:67, w:22, h:22, color:'#f59e0b' },
    { id:'s5', floorId:fid, label:'Опен-спейс A', seats:6, x:30, y:3,  w:22, h:22, color:'#059669' },
    { id:'s6', floorId:fid, label:'Опен-спейс B', seats:6, x:30, y:29, w:22, h:22, color:'#059669' },
    { id:'s7', floorId:fid, label:'Опен-спейс C', seats:6, x:30, y:55, w:22, h:22, color:'#059669' },
    { id:'s8', floorId:fid, label:'Тихая зона',   seats:8, x:58, y:3,  w:39, h:87, color:'#6366f1' },
  ]);
}
if (!DB.get('bookings', null)) DB.set('bookings', []);
if (!DB.get('departments', null)) {
  const dnames = ['Закупка и логистика','Маркетинг','HR','Экспортное развитие',
                  'Антелава','Программисты','Контроль качества','Офис менеджеры'];
  DB.set('departments', dnames.map(name => ({ id: DB.uid(), name, headUserId: null, memberIds: [] })));
}

/* ── CRUD helpers ─────────────────────────────────────────────────────────── */
const getCoworkings = ()  => {
  const data = DB.get('coworkings', null);
  return Array.isArray(data) ? data : [];
};
const getUsers    = ()  => {
  const data = DB.get('users', null);
  return Array.isArray(data) ? data : [];
};
const getFloors   = ()  => {
  const data = DB.get('floors', null);
  return Array.isArray(data) ? data : [];
};
const getSpaces   = ()  => {
  const data = DB.get('spaces', null);
  return Array.isArray(data) ? data : [];
};
const getBookings = ()  => {
  const data = DB.get('bookings', null);
  return Array.isArray(data) ? data : [];
};
const saveCoworkings = v => { if (Array.isArray(v)) DB.set('coworkings', v); };
const saveUsers    = v  => { if (Array.isArray(v)) DB.set('users', v); };
const saveFloors   = v  => { if (Array.isArray(v)) DB.set('floors', v); };
const saveSpaces   = v  => { if (Array.isArray(v)) DB.set('spaces', v); };
const saveBookings    = v  => { if (Array.isArray(v)) DB.set('bookings', v); };
const getDepartments  = () => { const d = DB.get('departments', null); return Array.isArray(d) ? d : []; };
const saveDepartments = v  => { if (Array.isArray(v)) DB.set('departments', v); };

function ensureDataIntegrity() {
  let coworkings = getCoworkings();
  if (!coworkings.length) {
    coworkings = [{ id: DB.uid(), name: 'Главный коворкинг' }];
    saveCoworkings(coworkings);
  }

  const coworkingIds = new Set(coworkings.map(c => c.id));
  let floors = getFloors();
  let floorsChanged = false;
  floors = floors.map(f => {
    const next = { ...f };
    if (!next.coworkingId || !coworkingIds.has(next.coworkingId)) {
      next.coworkingId = coworkings[0].id;
      floorsChanged = true;
    }
    if (next.imageUrl && !next.imageType) {
      next.imageType = next.imageUrl.startsWith('data:application/pdf') ? 'pdf' : 'image';
      floorsChanged = true;
    }
    return next;
  });
  if (floorsChanged) saveFloors(floors);
}

function purgeExpired() {
  // Optimize: Only purge every 5 minutes max
  const now = Date.now();
  if (now - lastPurgeTime < 5 * 60 * 1000) return;
  lastPurgeTime = now;
  
  const timeNow = fmtDate(new Date()) + ' ' + p2(new Date().getHours()) + ':' + p2(new Date().getMinutes());
  saveBookings(getBookings().filter(b => b.expiresAt > timeNow));
}

function startPurgeTimer() {
  // Auto-purge expired bookings every 30 minutes
  if (purgeTimer) clearInterval(purgeTimer);
  purgeTimer = setInterval(() => {
    purgeExpired();
  }, 30 * 60 * 1000);
}

function stopPurgeTimer() {
  if (purgeTimer) { clearInterval(purgeTimer); purgeTimer = null; }
}

function startSessionCheck() {
  // Check session every minute, logout if > 60 mins inactive
  if (sessionCheckTimer) clearInterval(sessionCheckTimer);
  // Remove previous listener if any (prevent accumulation on re-login)
  if (_sessionActivityHandler) {
    document.removeEventListener('click',   _sessionActivityHandler);
    document.removeEventListener('keydown', _sessionActivityHandler);
  }
  let lastActivityTime = Date.now();
  _sessionActivityHandler = () => { lastActivityTime = Date.now(); };
  document.addEventListener('click',   _sessionActivityHandler);
  document.addEventListener('keydown', _sessionActivityHandler);

  sessionCheckTimer = setInterval(() => {
    const inactiveTime = (Date.now() - lastActivityTime) / 1000 / 60; // minutes
    if (inactiveTime > 60 && currentUser) {
      doLogout();
      authErr('Сессия истекла из-за неактивности');
    }
  }, 60 * 1000); // Check every minute
}

function stopSessionCheck() {
  if (sessionCheckTimer) { clearInterval(sessionCheckTimer); sessionCheckTimer = null; }
  if (_sessionActivityHandler) {
    document.removeEventListener('click',   _sessionActivityHandler);
    document.removeEventListener('keydown', _sessionActivityHandler);
    _sessionActivityHandler = null;
  }
}

/* ═══════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════ */
// currentUser declared above DB to avoid Temporal Dead Zone in DB._push
let selCoworkingId = null;
let selFloorId    = null;
let selDates      = [];        // array of 'YYYY-MM-DD'
let calViewYear   = 0;
let calViewMonth  = 0;
let calMode       = 'month';   // 'month' | 'year'
let calAnchorDate = null;
let includeWeekends = false;
let workingSaturdays = [];  // array of 'YYYY-MM-DD' (kept for D1 sync compat; logic now uses saturdayMode)
let saturdayMode = false;   // true = all Saturdays are bookable
let slotId        = 'full';
let customFrom    = '09:00';
let customTo      = '18:00';
let displayMode   = 'map';     // 'map' | 'list'
let currentView   = 'map';
let expiryTimer   = null;
let bookingForUserId = null;

// Editor state
let editorCoworkingId = null;
let editorFloorId   = null;
let editorSpaces    = [];
let editorDrawing   = false;
let editorDrawStart = null;
let editorNewZone   = { label:'', seats:1, color:'#059669' };
let lastPurgeTime   = 0;
let purgeTimer      = null;
let sessionCheckTimer = null;
let _sessionActivityHandler = null;  // single ref so we can removeEventListener

const SLOTS = [
  { id:'morning',   label:'Утро',       from:'09:00', to:'13:00' },
  { id:'afternoon', label:'День',       from:'13:00', to:'17:00' },
  { id:'evening',   label:'Вечер',      from:'17:00', to:'21:00' },
  { id:'full',      label:'Весь день',  from:'09:00', to:'21:00' },
  { id:'custom',    label:'Своё время', from:'09:00', to:'18:00' },
];
const COLORS = ['#059669'];
const MONTHS  = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const MONTHS_S= ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];

/* ═══════════════════════════════════════════════════════
   UTILS
═══════════════════════════════════════════════════════ */
function p2(n) { return String(n).padStart(2,'0'); }
function fmtDate(d) { return `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`; }
function fmtHuman(ds) {
  const d = new Date(ds+'T12:00:00');
  return `${d.getDate()} ${MONTHS_S[d.getMonth()]}`;
}
function slotLabel(s) {
  if (s.id === 'custom') return `${customFrom}–${customTo}`;
  return `${s.from}–${s.to}`;
}
function currentSlot() { return SLOTS.find(s => s.id === slotId); }
function slotFrom() { return slotId === 'custom' ? customFrom : currentSlot().from; }
function slotTo()   { return slotId === 'custom' ? customTo   : currentSlot().to;   }
function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function timesOverlap(aFrom, aTo, bFrom, bTo) {
  return timeToMinutes(aFrom) < timeToMinutes(bTo) &&
         timeToMinutes(bFrom) < timeToMinutes(aTo);
}
function findBookingForSpace(spaceId, date, from, to) {
  return getBookings().find(b =>
    b.spaceId === spaceId &&
    b.date === date &&
    timesOverlap(from, to, b.slotFrom, b.slotTo)
  );
}

function userInitials(name) {
  return name.split(' ').map(p=>p[0]).join('').slice(0,2).toUpperCase();
}

/* toast */
let _toastTimer;
function toast(msg, cls='', icon='✓') {
  const el = document.getElementById('toast');
  el.className = 'toast show ' + cls;
  document.getElementById('toast-msg').textContent  = msg;
  document.getElementById('toast-icon').textContent = icon;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

/* ═══════════════════════════════════════════════════════
   AUTH
═══════════════════════════════════════════════════════ */
function authErr(msg) {
  const el = document.getElementById('auth-err');
  el.textContent = msg; el.style.display = 'block';
}

function resetDemoData() {
  if (!confirm('Сбросить все локальные данные? Данные будут перезагружены из облака при следующем входе.')) return;
  ['coworkings','floors','spaces','bookings','departments','session'].forEach(k => localStorage.removeItem('ws_' + k));
  location.reload();
}

async function doLogin() {
  const email = document.getElementById('l-email').value.trim().toLowerCase();
  const pass  = document.getElementById('l-pass').value;
  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass })
    });
    const data = await r.json();
    if (!r.ok) return authErr(data.error || 'Неверный email или пароль');
    onAuth(data.user);
  } catch(e) {
    // Fallback to localStorage when API unavailable (local dev / offline)
    const user = getUsers().find(u => u.email === email && (u.password === pass || u.password_hash === pass));
    if (!user) return authErr('Неверный email или пароль');
    onAuth(user);
  }
}

async function onAuth(user) {
  currentUser = user;
  // Store full user object (without password) so session survives page reload
  const { password, password_hash, ...safeUser } = user;
  DB.set('session', safeUser);
  document.getElementById('auth-screen').style.display = 'none';
  const _appEl = document.getElementById('app');
  _appEl.style.display = 'flex';
  _appEl.dataset.view = 'map';
  applyUserUI();
  try {
    await initApp();
  } catch (error) {
    console.error('Ошибка инициализации:', error);
    // Продолжаем работу с localStorage
  }
  startExpiryWatcher();
}

function doLogout() {
  currentUser = null;
  DB.set('session', null);
  stopExpiryWatcher();
  stopPurgeTimer();
  stopSessionCheck();
  // Очищаем состояние
  selCoworkingId = null;
  selFloorId = null;
  selDates = [];
  bookingForUserId = null;
  displayMode = 'map';
  currentView = 'map';
  editorCoworkingId = null;
  editorFloorId = null;
  editorSpaces = [];
  // Сброс настроек календаря (чтобы следующий пользователь не видел чужие)
  includeWeekends = false;
  workingSaturdays = [];
  saturdayMode = false;
  calMode = 'month';
  const _logoutToday = new Date();
  calViewYear  = _logoutToday.getFullYear();
  calViewMonth = _logoutToday.getMonth();
  calAnchorDate = null;
  slotId = 'full';
  customFrom = '09:00';
  customTo   = '18:00';
  // Сброс UI попапа календаря
  const _satInp = document.getElementById('opt-saturday');
  if (_satInp) _satInp.checked = false;
  const _wkInp = document.getElementById('opt-weekends');
  if (_wkInp) _wkInp.checked = false;
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('auth-err').style.display = 'none';
  // Clear auth form
  document.getElementById('l-email').value = '';
  document.getElementById('l-pass').value = '';
}

function applyUserUI() {
  const u = currentUser;
  document.getElementById('user-avatar').textContent    = userInitials(u.name);
  document.getElementById('user-name-lbl').textContent  = u.name;
  const rp = document.getElementById('role-pill');
  const labels = { user:'Сотрудник', manager:'Руководитель', admin:'Администратор' };
  rp.textContent = labels[u.role] || u.role;
  rp.className   = 'role-pill rp-' + u.role;
  document.querySelectorAll('.manager-only').forEach(el =>
    el.style.display = (u.role==='manager'||u.role==='admin') ? '' : 'none');
  document.querySelectorAll('.admin-only').forEach(el =>
    el.style.display = u.role==='admin' ? '' : 'none');
}

/* ═══════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════ */
/* ── D1 cloud sync ────────────────────────────────────────────────────────── */
async function syncFromD1() {
  try {
    // 1. Fetch users (no passwords) → populate localStorage cache for admin UI
    const ur = await fetch('/api/users');
    if (ur.ok) {
      const ud = await ur.json();
      if (Array.isArray(ud.users)) {
        localStorage.setItem('ws_users', JSON.stringify(ud.users));
      }
    }
    // 2. Sync all KV buckets
    const keys = ['coworkings', 'floors', 'spaces', 'bookings', 'workingSaturdays', 'departments'];
    await Promise.all(keys.map(async k => {
      const r = await fetch('/api/kv/' + encodeURIComponent(k));
      if (!r.ok) return;
      const d = await r.json();
      if (d.value !== null && d.value !== undefined) {
        // D1 has data → overwrite localStorage (truth comes from server)
        localStorage.setItem('ws_' + k, JSON.stringify(d.value));
      } else {
        // D1 empty → push current localStorage value so other devices get it
        const local = DB.get(k, null);
        if (local) DB._push(k, local);
      }
    }));
  } catch(e) {
    console.warn('D1 sync skipped (offline or local dev):', e.message);
  }
}

async function initApp() {
  // Sync from D1 first (overwrites localStorage with server truth)
  await syncFromD1();

  // Initialize optional Supabase adapter
  try {
    if (window.dataAdapter && window.dataAdapter.init) {
      await dataAdapter.init();
    }
  } catch (error) {
    console.warn('Supabase adapter unavailable, using localStorage only:', error);
  }
  
  ensureDataIntegrity();
  purgeExpired();
  startPurgeTimer();
  startSessionCheck();
  
  const today = new Date();
  calViewYear  = today.getFullYear();
  calViewMonth = today.getMonth();
  calMode      = 'month';
  selDates     = [fmtDate(today)];
  calAnchorDate = selDates[0];
  bookingForUserId = currentUser?.id || null;

  const coworkings = getCoworkings();
  if (!selCoworkingId && coworkings.length) selCoworkingId = coworkings[0].id;
  const floors = getFloorsByCoworking(selCoworkingId);
  if (!selFloorId || !floors.some(f=>f.id===selFloorId)) selFloorId = floors[0]?.id || null;

  renderCalendar();
  renderSlots();
  renderCoworkings();
  renderFloors();
  renderStats();
  renderMiniBookings();
  renderMapView();
}

function refreshActiveViewAfterExpiry() {
  renderStats();
  renderMiniBookings();
  if (currentView === 'map')        renderMapView();
  if (currentView === 'mybookings') renderMyBookingsView();
  if (currentView === 'team')       renderTeamView();
  if (currentView === 'admin')      renderAdminView();
}

function startExpiryWatcher() {
  stopExpiryWatcher();
  expiryTimer = setInterval(() => {
    const before = getBookings().length;
    purgeExpired();
    if (!currentUser) return;
    const after = getBookings().length;
    if (after !== before) refreshActiveViewAfterExpiry();
  }, 30000);
}

function stopExpiryWatcher() {
  if (!expiryTimer) return;
  clearInterval(expiryTimer);
  expiryTimer = null;
}

/* ═══════════════════════════════════════════════════════
   CALENDAR
═══════════════════════════════════════════════════════ */
function calMove(d) {
  if (calMode === 'year') {
    calViewYear += d;
    renderCalendar();
    return;
  }
  calViewMonth += d;
  if (calViewMonth < 0)  { calViewMonth = 11; calViewYear--; }
  if (calViewMonth > 11) { calViewMonth = 0;  calViewYear++; }
  renderCalendar();
}

function toggleCalendarMode() {
  calMode = calMode === 'year' ? 'month' : 'year';
  renderCalendar();
}

function toggleWeekendSelection(checked) {
  includeWeekends = !!checked;
  renderCalendar();
}

function toggleSaturdayMode(checked) {
  saturdayMode = checked;
  if (!checked) workingSaturdays = [];
  renderCalendar();
}

function toggleWorkingSaturday(ds) {
  if (workingSaturdays.includes(ds)) {
    workingSaturdays = workingSaturdays.filter(x => x !== ds);
  } else {
    workingSaturdays = [...workingSaturdays, ds].sort();
  }
  renderSatPicker();
  renderCalendar();
}

function renderSatPicker() {
  const picker = document.getElementById('sat-picker');
  if (!picker) return;
  const today = new Date();
  const sats = [];
  const cur = new Date(today);
  // Advance to the next Saturday (or today if Saturday)
  const daysUntilSat = (6 - cur.getDay() + 7) % 7 || 7;
  cur.setDate(cur.getDate() + daysUntilSat);
  for (let i = 0; i < 12; i++) {
    sats.push(fmtDate(new Date(cur)));
    cur.setDate(cur.getDate() + 7);
  }
  picker.innerHTML = sats.map(ds => {
    const sel = workingSaturdays.includes(ds);
    const d = new Date(ds + 'T12:00:00');
    const label = `${d.getDate()} ${MONTHS_S[d.getMonth()]}`;
    return `<button class="sat-chip${sel ? ' active' : ''}" onclick="toggleWorkingSaturday('${ds}')">${label}</button>`;
  }).join('');
}

function isPastDate(ds) {
  return ds < fmtDate(new Date());
}

function isDateSelectable(ds) {
  if (isPastDate(ds)) return false;
  const dow = new Date(ds + 'T12:00:00').getDay();
  if (dow === 0) return includeWeekends;  // Sunday
  if (dow === 6) return includeWeekends || saturdayMode;  // Saturday
  return true;
}

function isRangeDayAllowed(dateObj) {
  const dow = dateObj.getDay();
  if (includeWeekends) return true;
  if (dow === 0) return false;
  if (dow === 6) return saturdayMode;
  return true;
}

function calDayClick(ds, evt) {
  if (!isDateSelectable(ds)) return;

  // Shift+click: quickly add a long range from anchor date.
  if (evt?.shiftKey && selDates.length) {
    const anchor = calAnchorDate || selDates[selDates.length - 1];
    const ranged = buildDateRange(anchor, ds);
    selDates = [...new Set([...selDates, ...ranged])].sort();
  } else if (selDates.includes(ds)) {
    selDates = selDates.filter(x => x !== ds);
    if (!selDates.length) selDates = [ds];
  } else {
    selDates = [...selDates, ds].sort();
  }
  calAnchorDate = ds;

  renderCalendar();
  renderStats();
  renderMiniBookings();
  if (currentView === 'map') renderMapView();
  updateRangeHint();
}

function buildDateRange(start, end) {
  const dates = [];
  let from = new Date(start + 'T12:00:00');
  let to = new Date(end + 'T12:00:00');
  if (from > to) [from, to] = [to, from];

  const cur = new Date(from);
  while (cur <= to) {
    if (isRangeDayAllowed(cur)) dates.push(fmtDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates.length ? dates : [end];
}

function updateRangeHint() {
  const el = document.getElementById('cal-range-hint');
  const today = fmtDate(new Date());
  const todayLabel = `Сегодня: ${fmtHuman(today)}`;
  const todayLink = `<a href="#" onclick="jumpToTodayDate();return false;" style="font-weight:600;color:var(--status-mine);text-decoration:none">${todayLabel}</a>`;
  const modeHint = calMode === 'year' ? 'Годовой режим' : 'Месячный режим';
  const daysHint = includeWeekends
    ? 'включены сб и вс'
    : saturdayMode
    ? 'включены рабочие субботы'
    : 'только пн-пт';

  if (selDates.length > 1) {
    el.innerHTML = `${selDates.length} дней · ${daysHint} · ${todayLink}`;
  } else {
    el.innerHTML = selDates.length
      ? `${fmtHuman(selDates[0])} · ${daysHint} · ${todayLink}`
      : `${daysHint} · ${todayLink}`;
  }
  updateCalTrigger();
}

function jumpToTodayDate() {
  const today = new Date();
  const ds = fmtDate(today);
  selDates = [ds];
  calViewYear = today.getFullYear();
  calViewMonth = today.getMonth();
  calAnchorDate = ds;
  renderCalendar();
  renderStats();
  renderMiniBookings();
  if (currentView === 'map') renderMapView();
}

function resetSelectedRange() {
  const today = new Date();
  const ds = fmtDate(today);
  selDates = [ds];
  calAnchorDate = ds;
  calViewYear = today.getFullYear();
  calViewMonth = today.getMonth();
  renderCalendar();
  renderStats();
  renderMiniBookings();
  if (currentView === 'map') renderMapView();
}

function openCalendar() {
  document.getElementById('cal-overlay').classList.add('active');
  document.getElementById('cal-popup').classList.add('active');
  document.addEventListener('keydown', _calEscHandler);
}

function closeCalendar() {
  document.getElementById('cal-overlay').classList.remove('active');
  document.getElementById('cal-popup').classList.remove('active');
  document.removeEventListener('keydown', _calEscHandler);
}

function _calEscHandler(e) {
  if (e.key === 'Escape') closeCalendar();
}

function updateCalTrigger() {
  const el = document.getElementById('cal-trigger-text');
  if (!el) return;
  if (!selDates.length) { el.textContent = 'Выбрать даты…'; return; }
  if (selDates.length === 1) { el.textContent = fmtHuman(selDates[0]); return; }
  el.textContent = `${fmtHuman(selDates[0])} — ${fmtHuman(selDates[selDates.length-1])} · ${selDates.length} дн.`;
}

function renderYearCalendar(grid, todayDs, bookings) {
  let html = '<div class="cal-year-grid">';
  for (let m = 0; m < 12; m++) {
    html += `<div class="cal-year-month"><div class="cal-year-title">${MONTHS[m]} ${calViewYear}</div>`;
    html += `<div class="cal-year-week">${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d=>`<span>${d}</span>`).join('')}</div>`;
    html += `<div class="cal-mini-grid">`;

    const first = new Date(calViewYear, m, 1);
    let startDow = first.getDay();
    if (startDow === 0) startDow = 7;
    for (let i = 1; i < startDow; i++) html += `<div class="cal-mini-day cal-mini-empty"></div>`;

    const daysInMonth = new Date(calViewYear, m + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${calViewYear}-${p2(m + 1)}-${p2(d)}`;
      const date = new Date(ds + 'T12:00:00');
      const dow = date.getDay();
      const isPast = ds < todayDs;
      const isToday = ds === todayDs;
      const isWeekend = dow === 0 || dow === 6;
      const isSelected = selDates.includes(ds);
      const hasMine = bookings.some(b => b.date === ds);

      const isWorkingSat = dow === 6 && workingSaturdays.includes(ds);
      let cls = 'cal-mini-day';
      if (isPast) cls += ' cal-past';
      if (isWeekend && !includeWeekends && !isWorkingSat) cls += ' cal-other';
      if (isWorkingSat) cls += ' cal-working-sat';
      if (isToday) cls += ' cal-today';
      if (isSelected) cls += ' cal-selected';
      if (hasMine) cls += ' cal-has-booking';

      const clickable = isDateSelectable(ds);
      html += `<div class="${cls}" ${clickable ? `onclick="calDayClick('${ds}', event)"` : ''}>${d}</div>`;
    }

    html += '</div></div>';
  }
  html += '</div>';
  grid.innerHTML = html;
}

function renderCalendar() {
  const grid    = document.getElementById('cal-grid');
  const todayDs = fmtDate(new Date());
  const bookings = getBookings().filter(b => b.userId === currentUser.id);
  const modeBtn = document.getElementById('cal-mode-btn');
  const weekendsInp = document.getElementById('opt-weekends');
  const satInp = document.getElementById('opt-saturday');
  const popup = document.getElementById('cal-popup');

  if (modeBtn) modeBtn.textContent = calMode === 'year' ? 'Месяц' : 'Год';
  if (weekendsInp) weekendsInp.checked = includeWeekends;
  if (satInp) satInp.disabled = includeWeekends;
  const satToggle = document.getElementById('cal-toggle-saturday');
  if (satToggle) satToggle.classList.toggle('disabled', includeWeekends);
  if (popup) popup.classList.toggle('year-mode', calMode === 'year');

  if (calMode === 'year') {
    grid.classList.add('cal-grid-year');
    document.getElementById('cal-month-lbl').textContent = `Год ${calViewYear}`;
    renderYearCalendar(grid, todayDs, bookings);
    updateRangeHint();
    return;
  }

  grid.classList.remove('cal-grid-year');

  document.getElementById('cal-month-lbl').textContent = `${MONTHS[calViewMonth]} ${calViewYear}`;

  // DOW headers
  let html = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d => `<div class="cal-dow">${d}</div>`).join('');

  // First day of month
  const first = new Date(calViewYear, calViewMonth, 1);
  let startDow = first.getDay(); // 0=Sun
  if (startDow === 0) startDow = 7;
  // Fill blanks
  for (let i = 1; i < startDow; i++) {
    html += `<div class="cal-day cal-other"></div>`;
  }

  const daysInMonth = new Date(calViewYear, calViewMonth+1, 0).getDate();

  for (let d = 1; d <= daysInMonth; d++) {
    const ds   = `${calViewYear}-${p2(calViewMonth+1)}-${p2(d)}`;
    const date = new Date(ds + 'T12:00:00');
    const dow  = date.getDay();
    const isPast    = ds < todayDs;
    const isToday   = ds === todayDs;
    const isWeekend = dow === 0 || dow === 6;
    const isSelected = selDates.includes(ds);
    const hasMine   = bookings.some(b => b.date === ds);

    const isWorkingSat = dow === 6 && workingSaturdays.includes(ds);
    let cls = 'cal-day';
    if (isPast)      cls += ' cal-past';
    if (isWeekend && !includeWeekends && !isWorkingSat && !isPast) cls += ' cal-other';
    if (isWorkingSat && !isPast) cls += ' cal-working-sat';
    if (isToday)     cls += ' cal-today';
    if (isSelected)  cls += ' cal-selected';
    if (hasMine)     cls += ' cal-has-booking';

    const clickable = isDateSelectable(ds);
    html += `<div class="${cls}" ${clickable?`onclick="calDayClick('${ds}', event)"`:''}>
      ${d}</div>`;
  }
  grid.innerHTML = html;
  updateRangeHint();
}

/* ═══════════════════════════════════════════════════════
   SLOTS
═══════════════════════════════════════════════════════ */
function renderSlots() {
  const el = document.getElementById('slot-list');
  el.innerHTML = SLOTS.map(s => {
    const active = s.id === slotId;
    const dotColor = active ? 'rgba(255,255,255,.8)' : s.id==='full' ? '#059669' : s.id==='morning' ? '#f59e0b' : s.id==='afternoon' ? '#3b82f6' : s.id==='evening' ? '#8b5cf6' : '#64748b';
    return `<div class="slot-item ${active?'active':''}" onclick="selectSlot('${s.id}')">
      <div class="slot-dot" style="background:${dotColor}"></div>
      <div><div class="slot-name">${s.label}</div>
        <div class="slot-sub">${s.id==='custom'?`${customFrom}–${customTo}`:slotLabel(s)}</div>
      </div>
    </div>`;
  }).join('');
  document.getElementById('custom-time-picker').style.display = slotId === 'custom' ? '' : 'none';
}

function selectSlot(id) {
  slotId = id;
  renderSlots();
  renderStats();
  if (currentView === 'map') renderMapView();
  updateSlotBadge();
}

function applyCustomTime() {
  const f = document.getElementById('ct-from').value;
  const t = document.getElementById('ct-to').value;
  if (!f || !t) return toast('Укажите оба времени', 't-red', '✕');
  if (f >= t) return toast('Время конца должно быть позже времени начала', 't-red', '✕');
  const fMin = timeToMinutes(f);
  const tMin = timeToMinutes(t);
  if (tMin - fMin < 30) return toast('Минимальная длительность 30 минут', 't-red', '✕');
  customFrom = f; customTo = t;
  renderSlots();
  renderStats();
  if (currentView === 'map') renderMapView();
  updateSlotBadge();
}

function updateSlotBadge() {
  const s = currentSlot();
  document.getElementById('slot-badge-lbl').textContent = `${s.label}: ${slotLabel(s)}`;
}

/* ═══════════════════════════════════════════════════════
   COWORKINGS
═══════════════════════════════════════════════════════ */
function getFloorsByCoworking(coworkingId) {
  const floors = getFloors();
  return floors.filter(f => f.coworkingId === coworkingId);
}

function renderCoworkings() {
  const el = document.getElementById('coworking-list');
  if (!el) return;
  const coworkings = getCoworkings();
  if (!coworkings.length) {
    el.innerHTML = `<div style="font-size:12px;color:var(--ink4)">Нет коворкингов</div>`;
    return;
  }
  if (!selCoworkingId || !coworkings.some(c=>c.id===selCoworkingId)) {
    selCoworkingId = coworkings[0].id;
  }
  el.innerHTML = coworkings.map(c =>
    `<button class="floor-btn ${c.id===selCoworkingId?'active':''}" onclick="selectCoworking('${c.id}')">${escapeHtml(c.name)}</button>`
  ).join('');
}

function selectCoworking(id) {
  selCoworkingId = id;
  const floors = getFloorsByCoworking(id);
  if (!floors.some(f=>f.id===selFloorId)) selFloorId = floors[0]?.id || null;
  selDates = [fmtDate(new Date())];
  renderCoworkings();
  renderFloors();
  renderCalendar();
  renderStats();
  if (currentView === 'map') renderMapView();
}

/* ═══════════════════════════════════════════════════════
   FLOORS
═══════════════════════════════════════════════════════ */
function renderFloors() {
  const el = document.getElementById('floor-list');
  const floors = getFloorsByCoworking(selCoworkingId);
  if (!floors.length) {
    el.innerHTML = `<div style="font-size:12px;color:var(--ink4)">Нет этажей</div>`;
    return;
  }
  if (!floors.some(f=>f.id===selFloorId)) selFloorId = floors[0].id;
  el.innerHTML = floors.map(f =>
    `<button class="floor-btn ${f.id===selFloorId?'active':''}" onclick="selectFloor('${f.id}')">
      <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" style="opacity:.5">
        <path d="M3 4h14v2H3zm0 5h14v2H3zm0 5h14v2H3z"/>
      </svg>${escapeHtml(f.name)}</button>`
  ).join('');
}

function selectFloor(id) {
  selFloorId = id;
  renderFloors();
  renderStats();
  if (currentView === 'map') renderMapView();
}

/* ═══════════════════════════════════════════════════════
   STATS
═══════════════════════════════════════════════════════ */
function renderStats() {
  if (!selFloorId) {
    document.getElementById('s-free').textContent = '0';
    document.getElementById('s-mine').textContent = '0';
    document.getElementById('s-busy').textContent = '0';
    return;
  }
  const spaces   = getSpaces().filter(s => s.floorId === selFloorId);
  let free=0, mine=0, busy=0;
  // Use first selected date for stats
  const date = selDates[0] || fmtDate(new Date());
  const from = slotFrom(), to = slotTo();

  spaces.forEach(sp => {
    const bk = findBookingForSpace(sp.id, date, from, to);
    if (!bk) free++;
    else if (bk.userId === currentUser.id) mine++;
    else busy++;
  });
  document.getElementById('s-free').textContent = free;
  document.getElementById('s-mine').textContent = mine;
  document.getElementById('s-busy').textContent = busy;
}

/* ═══════════════════════════════════════════════════════
   MINI BOOKINGS (sidebar)
═══════════════════════════════════════════════════════ */
function renderMiniBookings() {
  const el    = document.getElementById('mini-bk-list');
  const mine  = getBookings().filter(b => b.userId === currentUser.id);
  if (!mine.length) {
    el.innerHTML = `<div style="font-size:12px;color:var(--ink4);text-align:center;padding:1rem;
      border:1px dashed var(--line);border-radius:var(--radius)">Нет активных бронирований</div>`;
    return;
  }
  const spaces = getSpaces(); const floors = getFloors();
  el.innerHTML = mine.sort((a,b)=>a.date.localeCompare(b.date)).map(b => {
    const sp = spaces.find(s=>s.id===b.spaceId);
    return `<div class="mini-booking">
      <div class="mb-label">${escapeHtml(sp?.label||'?')}</div>
      <div class="mb-meta">${fmtHuman(b.date)} · ${b.slotFrom}–${b.slotTo}</div>
      <button class="mb-del" onclick="cancelBooking('${b.id}')">✕</button>
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════
   MAP VIEW
═══════════════════════════════════════════════════════ */
function renderMapView() {
  purgeExpired();
  const floor  = getFloors().find(f=>f.id===selFloorId);
  if (!floor) {
    document.getElementById('map-title').textContent = 'Нет этажей';
    document.getElementById('map-sub').textContent = 'Добавьте этаж в админке';
    document.getElementById('map-area').innerHTML = `<div class="empty" style="padding:2rem">
      <p>Для выбранного коворкинга пока нет этажей</p>
    </div>`;
    document.getElementById('list-area').innerHTML = '';
    return;
  }
  const spaces = getSpaces().filter(s=>s.floorId===selFloorId);
  const date   = selDates[0] || fmtDate(new Date());
  const from   = slotFrom(), to = slotTo();

  document.getElementById('map-title').textContent = floor?.name || 'Этаж';
  document.getElementById('map-sub').textContent   = `${selDates.length>1?selDates.length+' дней · ':fmtHuman(date)+' · '}${spaces.length} пространств`;
  updateSlotBadge();

  if (displayMode === 'list') { renderListView(spaces, date, from, to); return; }
  const mapArea  = document.getElementById('map-area');

  // Build SVG map
  const W=760, H=520;
  let zones = '';
  spaces.forEach(sp => {
    // Проверяем занятость по ВСЕМ выбранным датам (не только первой)
    const checkDates = selDates.length > 0 ? selDates : [date];
    let isMine = false, isBusy = false, busyBk = null;
    for (const d of checkDates) {
      const bk = findBookingForSpace(sp.id, d, from, to);
      if (!bk) continue;
      if (bk.userId === currentUser.id) { isMine = true; }
      else { isBusy = true; if (!busyBk) busyBk = bk; }
    }
    // Занято чужим — красное; только моё — синее; свободно везде — зелёное
    const fill   = isBusy ? '#ef4444' : isMine ? '#1d4ed8' : '#059669';
    const opacity = 0.82;
    // coords are % → scale to SVG px
    const x = sp.x/100*W, y = sp.y/100*H, w = sp.w/100*W, h = sp.h/100*H;
    const lines = sp.label.split(' ');
    const cy    = y + h/2;

    let textHtml = '';
    if (lines.length <= 2) {
      textHtml = lines.map((l,i) => `<text x="${x+w/2}" y="${cy + (i-(lines.length-1)/2)*14}"
        text-anchor="middle" dominant-baseline="middle" fill="white"
        font-family="DM Sans,sans-serif" font-size="11.5" font-weight="700">${escapeHtml(l)}</text>`).join('');
    } else {
      textHtml = `<text x="${x+w/2}" y="${cy}" text-anchor="middle" dominant-baseline="middle"
        fill="white" font-family="DM Sans,sans-serif" font-size="11" font-weight="700">${escapeHtml(sp.label)}</text>`;
    }
    // seats badge
    const seatsHtml = `<rect x="${x+w-22}" y="${y+4}" width="18" height="13" rx="6" fill="rgba(0,0,0,.25)"/>
      <text x="${x+w-13}" y="${y+14}" text-anchor="middle" fill="rgba(255,255,255,.9)"
        font-family="DM Mono,monospace" font-size="8" font-weight="500">${sp.seats}</text>`;
    // Подпись: при нескольких датах показываем «Занято» без имени (у разных дней могут быть разные люди)
    const whoHtml = isBusy
      ? `<text x="${x+w/2}" y="${y+h-7}" text-anchor="middle" fill="rgba(255,255,255,.75)"
          font-family="DM Sans,sans-serif" font-size="9">${checkDates.length > 1 ? 'Занято' : escapeHtml(busyBk.userName)}</text>`
      : isMine
      ? `<text x="${x+w/2}" y="${y+h-7}" text-anchor="middle" fill="rgba(255,255,255,.75)"
          font-family="DM Sans,sans-serif" font-size="9">Моё</text>`
      : '';

    zones += `<g class="zone-svg" style="cursor:pointer" onclick="spaceClick('${sp.id}')">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5"
        fill="${fill}" fill-opacity="${opacity}" stroke="rgba(255,255,255,.4)" stroke-width="1.5"/>
      ${seatsHtml}${textHtml}${whoHtml}
    </g>`;
  });

  // Floor image or grid pattern
  const bgPattern = safeImageUrl(floor?.imageUrl)
    ? `<image href="${safeImageUrl(floor.imageUrl)}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid meet"/>`
    : `<defs><pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
        <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#e2e8f0" stroke-width="0.8"/>
       </pattern></defs>
       <rect width="${W}" height="${H}" fill="white"/>
       <rect width="${W}" height="${H}" fill="url(#grid)"/>`;

  mapArea.innerHTML = `<div style="position:relative">
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
      style="display:block;box-shadow:var(--shadow-lg);border-radius:4px;overflow:hidden">
      ${bgPattern}${zones}
    </svg>
  </div>`;
}

function renderListView(spaces, date, from, to) {
  const la = document.getElementById('list-area');
  const types = { 'Кабинет':'🚪', 'Переговорная':'👥', 'Опен-спейс':'💻', 'Тихая зона':'🤫', 'зона':'📍' };

  la.innerHTML = `<table class="spaces-table">
    <thead><tr>
      <th>Пространство</th><th>Мест</th><th>Статус</th><th>Кто занял</th><th></th>
    </tr></thead>
    <tbody>${spaces.map(sp => {
      const bk    = findBookingForSpace(sp.id, date, from, to);
      const isMine = bk?.userId === currentUser.id;
      const isBusy = bk && !isMine;
      const icon = Object.entries(types).find(([k]) => sp.label.includes(k))?.[1] || '📍';
      return `<tr>
        <td><strong>${icon} ${escapeHtml(sp.label)}</strong></td>
        <td>${sp.seats}</td>
        <td>${!bk
          ? `<span class="status-dot"><span class="dot dot-free"></span>Свободно</span>`
          : isMine
          ? `<span class="status-dot"><span class="dot dot-mine"></span>Моё</span>`
          : `<span class="status-dot"><span class="dot dot-busy"></span>Занято</span>`}</td>
        <td>${bk ? escapeHtml(bk.userName) : '—'}</td>
        <td>${!bk
          ? `<button class="btn btn-primary btn-sm" onclick="spaceClick('${sp.id}')">Забронировать</button>`
          : canCancelBooking(bk)
          ? `<button class="btn btn-danger btn-sm" onclick="cancelBooking('${bk.id}')">Отменить</button>`
          : ''}</td>
      </tr>`;
  }).join('')}</tbody></table>`;
}

function getAllowedBookingTargets() {
  if (!currentUser) return [];
  if (currentUser.role === 'admin') {
    return getUsers().slice().sort((a,b)=>a.name.localeCompare(b.name,'ru'));
  }
  if (currentUser.role === 'manager') {
    // Managers can ONLY book for users in their own department (security fix)
    const deptUsers = getUsers().filter(u =>
      u.department === currentUser.department &&
      u.id !== currentUser.id &&
      u.role === 'user' // Cannot book for other roles
    );
    return [currentUser, ...deptUsers];
  }
  return [currentUser];
}

function canBookForUser(userId) {
  return getAllowedBookingTargets().some(u => u.id === userId);
}

function hasUserTimeConflict(bookings, userId, date, from, to) {
  return bookings.find(b =>
    b.userId === userId &&
    b.date === date &&
    timesOverlap(from, to, b.slotFrom, b.slotTo)
  );
}

function canCancelBooking(booking) {
  if (!currentUser || !booking) return false;
  if (currentUser.role === 'admin') return true;
  if (currentUser.role === 'user') return booking.userId === currentUser.id;
  if (currentUser.role === 'manager') {
    const owner = getUsers().find(u => u.id === booking.userId);
    if (!owner) return false;
    if (owner.id === currentUser.id) return true;
    return owner.role === 'user' && owner.department === currentUser.department;
  }
  return false;
}

/* ═══════════════════════════════════════════════════════
   SPACE CLICK → MODAL
═══════════════════════════════════════════════════════ */
function spaceClick(spaceId) {
  const sp      = getSpaces().find(s=>s.id===spaceId);
  if (!sp) { toast('Помещение не найдено', 't-red', '✕'); return; }
  const floor   = getFloors().find(f=>f.id===sp.floorId);
  if (!floor) { toast('Этаж не найден', 't-red', '✕'); return; }
  const date    = selDates[0] || fmtDate(new Date());
  const from    = slotFrom(), to = slotTo();
  const bk      = findBookingForSpace(spaceId, date, from, to);
  const isMine  = bk?.userId === currentUser.id;
  const isBusy  = bk && !isMine;
  const canCancelBusy = isBusy && canCancelBooking(bk);
  const targets = getAllowedBookingTargets();
  if (!bookingForUserId || !targets.some(u=>u.id===bookingForUserId)) {
    bookingForUserId = currentUser.id;
  }

  const titleEl = document.getElementById('modal-title');
  const bodyEl  = document.getElementById('modal-body');
  const footEl  = document.getElementById('modal-foot');

  titleEl.textContent = isMine
    ? 'Отменить бронирование'
    : isBusy
    ? (canCancelBusy ? 'Занято (можно отменить)' : 'Место занято')
    : 'Забронировать место';

  // Date pills
  const datePills = selDates.length > 1
    ? `<div style="margin-bottom:1rem">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--ink4);margin-bottom:6px">Даты (${selDates.length})</div>
       <div class="date-pills">${selDates.map(d=>`<span class="date-pill">${fmtHuman(d)}</span>`).join('')}</div>
       </div>`
    : '';
  const targetPicker = !isBusy && targets.length > 1
    ? `<div style="margin-bottom:1rem">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--ink4);margin-bottom:6px">
          Бронировать за
        </div>
        <select class="role-sel" id="book-for-user" onchange="bookingForUserId=this.value" style="width:100%">
          ${targets.map(u=>`<option value="${u.id}" ${u.id===bookingForUserId?'selected':''}>${escapeHtml(u.name)}${u.id===currentUser.id?' (я)':''}</option>`).join('')}
        </select>
       </div>`
    : '';

  bodyEl.innerHTML = `
    ${datePills}
    ${targetPicker}
    <div class="modal-info-grid">
      <div class="mig-item"><div class="mig-l">Место</div><div class="mig-v">${escapeHtml(sp.label)}</div></div>
      <div class="mig-item"><div class="mig-l">Мест</div><div class="mig-v">${sp.seats}</div></div>
      <div class="mig-item"><div class="mig-l">Этаж</div><div class="mig-v">${escapeHtml(floor.name)}</div></div>
      <div class="mig-item"><div class="mig-l">Время</div><div class="mig-v">${from}–${to}</div></div>
    </div>
    ${isBusy ? `<div style="padding:.75rem;background:var(--amber-l);border:1px solid rgba(217,119,6,.25);
      border-radius:var(--radius);font-size:13px;color:var(--amber)">
      Занято: <strong>${escapeHtml(bk.userName)}</strong>
      ${canCancelBusy ? `<div style="margin-top:4px;font-size:12px;color:var(--ink3)">У вас есть право отменить эту бронь</div>` : ''}
    </div>` : ''}`;

  if (isBusy) {
    footEl.innerHTML = canCancelBusy
      ? `<button class="btn btn-ghost" onclick="closeModal()">Закрыть</button>
         <button class="btn btn-danger" onclick="cancelBooking('${bk.id}');closeModal()">Отменить бронь</button>`
      : `<button class="btn btn-ghost" onclick="closeModal()">Закрыть</button>`;
  } else if (isMine) {
    footEl.innerHTML = `
      <button class="btn btn-ghost" onclick="closeModal()">Отмена</button>
      <button class="btn btn-danger" onclick="cancelBooking('${bk.id}');closeModal()">Отменить бронирование</button>`;
  } else {
    footEl.innerHTML = `
      <button class="btn btn-ghost" onclick="closeModal()">Отмена</button>
      <button class="btn btn-primary" onclick="bookSpace('${spaceId}')">
        Забронировать${selDates.length>1?' ('+selDates.length+' дней)':''}
      </button>`;
  }

  document.getElementById('modal-overlay').classList.add('open');
}

function bookSpace(spaceId) {
  const sp   = getSpaces().find(s=>s.id===spaceId);
  if (!sp) { toast('Помещение не найдено', 't-red', '✕'); return; }
  const from = slotFrom(), to = slotTo();
  const bookings = getBookings();
  const targetId = document.getElementById('book-for-user')?.value || bookingForUserId || currentUser.id;
  if (!canBookForUser(targetId)) {
    toast('Нельзя бронировать за выбранного сотрудника', 't-red', '✕');
    return;
  }
  const targetUser = getUsers().find(u=>u.id===targetId) || currentUser;
  bookingForUserId = targetUser.id;
  let created = 0, skippedBusy = 0, skippedUser = 0, skippedDailyLimit = 0;
  const bookedInBatchByDate = new Set();

  selDates.forEach(date => {
    // Double-check availability right before adding (race condition prevention)
    const freshBookings = getBookings();
    const exists = freshBookings.find(b =>
      b.spaceId === spaceId &&
      b.date === date &&
      timesOverlap(from, to, b.slotFrom, b.slotTo)
    );
    if (exists) { skippedBusy++; return; }

    if (targetUser.role === 'user') {
      const alreadyBookedThisDay =
        bookedInBatchByDate.has(date) ||
        freshBookings.some(b => b.userId === targetUser.id && b.date === date);
      if (alreadyBookedThisDay) { skippedDailyLimit++; return; }
    }

    if (hasUserTimeConflict(freshBookings, targetUser.id, date, from, to)) { skippedUser++; return; }
    freshBookings.push({
      id:       DB.uid(),
      userId:   targetUser.id,
      userName: targetUser.name,
      spaceId,
      spaceName: sp.label,
      date, slotFrom: from, slotTo: to,
      expiresAt: `${date} ${to}`,
      createdAt: new Date().toISOString()
    });
    bookings.push(freshBookings[freshBookings.length-1]);
    bookedInBatchByDate.add(date);
    created++;
  });
  saveBookings(bookings);
  closeModal();

  const parts = [];
  if (skippedBusy) parts.push(`занято: ${skippedBusy}`);
  if (skippedDailyLimit) parts.push(`лимит 1 место в день: ${skippedDailyLimit}`);
  if (skippedUser) parts.push(`конфликт у сотрудника: ${skippedUser}`);
  const who = targetUser.id === currentUser.id ? '' : ` для ${targetUser.name}`;
  const msg = parts.length
    ? `Забронировано${who}: ${created} дн., пропущено (${parts.join(', ')})`
    : `Забронировано${who}: ${created} ${created===1?'день':'дней'}`;
  toast(msg, 't-green', '✓');

  renderCalendar(); 
  renderStats(); 
  renderMiniBookings();
  if (currentView === 'map') renderMapView();
}

function refreshView() {
  // Utility to refresh current view without full page reload
  if (currentView === 'map') renderMapView();
  if (currentView === 'list') renderListView(getVisibleSpaces(), selDates[0], slotFrom(), slotTo());
  if (currentView === 'mybookings') renderMyBookingsView();
  if (currentView === 'team') renderTeamView();
  renderStats();
  renderMiniBookings();
}

function cancelBooking(id) {
  const bookings = getBookings();
  const bk = bookings.find(b=>b.id===id);
  if (!bk) return;
  if (!canCancelBooking(bk)) return toast('Недостаточно прав для отмены', 't-red', '✕');
  saveBookings(bookings.filter(b=>b.id!==id));
  toast('Бронирование отменено', '', '✓');
  renderCalendar(); renderStats(); renderMiniBookings();
  if (currentView === 'map') renderMapView();
  if (currentView === 'team') renderTeamView();
  if (currentView === 'admin') renderAdminView();
  if (currentView === 'cabinet') renderCabinetView();
}

/* ═══════════════════════════════════════════════════════
   VIEW SWITCHING
═══════════════════════════════════════════════════════ */
function switchView(view, btn) {
  currentView = view;

  // Sync both topbar tabs and mobile bottom nav
  document.querySelectorAll('.tnav,.mnav[data-view]').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  // Also sync the counterpart button (topbar vs bottom nav)
  document.querySelectorAll(`.tnav[onclick*="'${view}'"],.mnav[data-view="${view}"]`).forEach(b=>b.classList.add('active'));

  // Mark app with current view so CSS can hide sidebar on non-map views
  document.getElementById('app').dataset.view = view;

  // Show/hide filter button in bottom nav (only relevant on map view)
  const filterBtn = document.getElementById('mnav-filter-btn');
  if (filterBtn) filterBtn.classList.toggle('hidden', view !== 'map');

  // Close drawer if open
  closeFilterDrawer();

  ['view-map','view-mybookings','view-team','view-admin','view-cabinet'].forEach(id=>{
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display  = 'none';
    el.style.flexFlow = '';
  });

  if (view === 'map') {
    const el = document.getElementById('view-map');
    el.style.display  = 'flex';
    el.style.flexFlow = 'column';
    renderMapView();
  }
  if (view === 'mybookings') { document.getElementById('view-mybookings').style.display = 'flex'; renderMyBookingsView(); }
  if (view === 'team')       { document.getElementById('view-team').style.display = 'flex';       renderTeamView(); }
  if (view === 'admin')      { document.getElementById('view-admin').style.display = 'flex';      renderAdminView(); }
  if (view === 'cabinet')    { document.getElementById('view-cabinet').style.display = 'flex';    renderCabinetView(); }
}

function openFilterDrawer() {
  const sidebar  = document.querySelector('.sidebar');
  const overlay  = document.getElementById('drawer-overlay');
  if (!sidebar || !overlay) return;
  sidebar.classList.add('open');
  overlay.style.display = 'block';
  requestAnimationFrame(()=>overlay.classList.add('open'));
}

function closeFilterDrawer() {
  const sidebar  = document.querySelector('.sidebar');
  const overlay  = document.getElementById('drawer-overlay');
  if (!sidebar || !overlay) return;
  sidebar.classList.remove('open');
  overlay.classList.remove('open');
  setTimeout(()=>{ if (!overlay.classList.contains('open')) overlay.style.display='none'; }, 260);
}

function setDisplay(mode, btn) {
  displayMode = mode;
  document.querySelectorAll('.toggle-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('map-area').style.display  = mode==='map'  ? 'flex' : 'none';
  document.getElementById('list-area').style.display = mode==='list' ? 'block': 'none';
  renderMapView();
}

/* ═══════════════════════════════════════════════════════
   MY BOOKINGS VIEW
═══════════════════════════════════════════════════════ */
function renderMyBookingsView() {
  purgeExpired();
  const el     = document.getElementById('view-mybookings');
  const mine   = getBookings().filter(b=>b.userId===currentUser.id)
                              .sort((a,b)=>a.date.localeCompare(b.date));
  const spaces = getSpaces(); const floors = getFloors();

  el.innerHTML = `<div class="view-area">
    <div>
      <div class="view-head">Мои бронирования</div>
      <div class="view-sub">${mine.length} активных</div>
    </div>
    ${!mine.length ? `<div class="empty">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
      </svg><p>Нет активных бронирований</p></div>` :
    `<div class="card"><div style="padding:0"><table class="data-table">
      <thead><tr><th>Место</th><th>Этаж</th><th>Дата</th><th>Время</th><th>Истекает</th><th></th></tr></thead>
      <tbody>${mine.map(b=>{
        const sp = spaces.find(s=>s.id===b.spaceId);
        const fl = floors.find(f=>f.id===sp?.floorId);
        return `<tr>
          <td><strong>${escapeHtml(sp?.label||'?')}</strong></td>
          <td>${escapeHtml(fl?.name||'?')}</td>
          <td>${fmtHuman(b.date)}</td>
          <td style="font-family:'DM Mono',monospace;font-size:12px">${b.slotFrom}–${b.slotTo}</td>
          <td style="font-size:12px;color:var(--ink3)">${b.expiresAt}</td>
          <td><button class="btn btn-danger btn-sm" onclick="cancelBooking('${b.id}');renderMyBookingsView()">Отменить</button></td>
        </tr>`;
      }).join('')}
      </tbody></table></div></div>`}
  </div>`;
}

/* ═══════════════════════════════════════════════════════
   CABINET VIEW (personal account)
═══════════════════════════════════════════════════════ */
function renderCabinetView() {
  purgeExpired();
  const el = document.getElementById('view-cabinet');
  if (!el) return;
  const me = currentUser;
  const spaces = getSpaces(); const floors = getFloors();
  const myBks = getBookings().filter(b => b.userId === me.id)
                              .sort((a, b) => a.date.localeCompare(b.date));
  const isManager = me.role === 'manager' || me.role === 'admin';
  const team = isManager
    ? getUsers().filter(u => u.department === me.department && u.id !== me.id && u.role === 'user')
    : [];
  const teamBks = isManager
    ? getBookings().filter(b => team.some(u => u.id === b.userId))
                   .sort((a, b) => a.date.localeCompare(b.date))
    : [];
  const roleLabels = { user: 'Сотрудник', manager: 'Руководитель', admin: 'Администратор' };

  el.innerHTML = `<div class="view-area">

    <!-- Profile card -->
    <div class="card" style="padding:1.5rem;display:flex;align-items:center;gap:1.25rem">
      <div style="width:56px;height:56px;border-radius:50%;background:var(--blue);color:white;
        display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;flex-shrink:0">
        ${escapeHtml(userInitials(me.name))}
      </div>
      <div>
        <div style="font-size:20px;font-weight:700;color:var(--ink)">${escapeHtml(me.name)}</div>
        <div style="font-size:13px;color:var(--ink3);margin-top:4px">
          ${escapeHtml(me.department || '—')} · ${roleLabels[me.role] || me.role}
        </div>
        <div style="font-size:12px;color:var(--ink4);margin-top:2px">${escapeHtml(me.email)}</div>
      </div>
    </div>

    ${isManager ? `
    <!-- Department bookings -->
    <div class="card">
      <div class="card-head">Отдел: ${escapeHtml(me.department)} · ${team.length} сотрудников</div>
      <div style="padding:0"><table class="data-table">
        <thead><tr><th>Сотрудник</th><th>Место</th><th>Дата</th><th>Время</th><th></th></tr></thead>
        <tbody>${!teamBks.length
          ? `<tr><td colspan="5" style="text-align:center;color:var(--ink4);padding:2rem">Нет активных бронирований</td></tr>`
          : teamBks.map(b => {
              const sp = spaces.find(s => s.id === b.spaceId);
              const fl = floors.find(f => f.id === sp?.floorId);
              return `<tr>
                <td><strong>${escapeHtml(b.userName)}</strong></td>
                <td>${escapeHtml(sp?.label || '?')}</td>
                <td>${fmtHuman(b.date)}</td>
                <td style="font-family:'DM Mono',monospace;font-size:12px">${b.slotFrom}–${b.slotTo}</td>
                <td><button class="btn btn-danger btn-sm"
                  onclick="cancelBooking('${b.id}')">Отменить</button></td>
              </tr>`;
            }).join('')}
        </tbody>
      </table></div>
    </div>` : ''}

    <!-- My bookings -->
    <div class="card">
      <div class="card-head">Мои бронирования</div>
      <div style="padding:0">
        ${!myBks.length
          ? `<div style="text-align:center;color:var(--ink4);padding:2rem;font-size:13px">Нет активных бронирований</div>`
          : `<table class="data-table">
              <thead><tr><th>Место</th><th>Этаж</th><th>Дата</th><th>Время</th><th></th></tr></thead>
              <tbody>${myBks.map(b => {
                const sp = spaces.find(s => s.id === b.spaceId);
                const fl = floors.find(f => f.id === sp?.floorId);
                return `<tr>
                  <td><strong>${escapeHtml(sp?.label || '?')}</strong></td>
                  <td>${escapeHtml(fl?.name || '?')}</td>
                  <td>${fmtHuman(b.date)}</td>
                  <td style="font-family:'DM Mono',monospace;font-size:12px">${b.slotFrom}–${b.slotTo}</td>
                  <td><button class="btn btn-danger btn-sm"
                    onclick="cancelBooking('${b.id}')">Отменить</button></td>
                </tr>`;
              }).join('')}</tbody>
            </table>`}
      </div>
    </div>

    <!-- Change password -->
    <div class="card">
      <div class="card-head">Изменить пароль</div>
      <div style="padding:1.25rem;display:flex;flex-direction:column;gap:.75rem;max-width:360px">
        <div class="field">
          <label>Текущий пароль</label>
          <input type="password" id="cp-old" autocomplete="current-password">
        </div>
        <div class="field">
          <label>Новый пароль <span style="color:var(--ink3);font-size:11px">(мин. 6 символов)</span></label>
          <input type="password" id="cp-new" autocomplete="new-password">
        </div>
        <div class="field">
          <label>Повторите новый пароль</label>
          <input type="password" id="cp-confirm" autocomplete="new-password">
        </div>
        <div id="cp-err" style="color:var(--red);font-size:13px;display:none"></div>
        <button class="btn btn-primary" style="align-self:flex-start" onclick="doChangePassword()">Сохранить пароль</button>
      </div>
    </div>

    <!-- Logout at the very bottom -->
    <div>
      <button class="btn btn-danger" style="width:100%;padding:.75rem"
        onclick="doLogout()">Выйти из аккаунта</button>
    </div>

  </div>`;

  // Enter on last password field
  const cpConfirm = document.getElementById('cp-confirm');
  if (cpConfirm) cpConfirm.addEventListener('keydown', e => { if(e.key==='Enter') doChangePassword(); });
}

/* ═══════════════════════════════════════════════════════
   TEAM VIEW (manager)
═══════════════════════════════════════════════════════ */
function renderTeamView() {
  purgeExpired();
  const el   = document.getElementById('view-team');
  const me   = currentUser;
  const team = getUsers().filter(u=>u.department===me.department && u.id!==me.id && u.role==='user');
  const bks  = getBookings().filter(b => team.some(u=>u.id===b.userId))
                             .sort((a,b)=>a.date.localeCompare(b.date));
  const spaces = getSpaces(); const floors = getFloors();

  el.innerHTML = `<div class="view-area">
    <div>
      <div class="view-head">Отдел: ${escapeHtml(me.department)}</div>
      <div class="view-sub">${team.length} сотрудников · ${bks.length} активных бронирований</div>
    </div>
    <div class="metrics">
      <div class="metric mt-blue"><div class="metric-n" style="color:var(--blue)">${team.length}</div><div class="metric-l">Сотрудников</div></div>
      <div class="metric mt-green"><div class="metric-n" style="color:var(--green)">${bks.length}</div><div class="metric-l">Бронирований</div></div>
    </div>
    <div class="card"><div class="card-head">Бронирования отдела</div>
    <div style="padding:0"><table class="data-table">
      <thead><tr><th>Сотрудник</th><th>Место</th><th>Дата</th><th>Время</th><th></th></tr></thead>
      <tbody>${!bks.length ? `<tr><td colspan="5" style="text-align:center;color:var(--ink4);padding:2rem">Нет бронирований</td></tr>` :
        bks.map(b=>{
          const sp=spaces.find(s=>s.id===b.spaceId); const fl=floors.find(f=>f.id===sp?.floorId);
          return `<tr>
            <td><strong>${escapeHtml(b.userName)}</strong></td>
            <td>${escapeHtml(sp?.label||'?')}</td>
            <td>${fmtHuman(b.date)}</td>
            <td style="font-family:'DM Mono',monospace;font-size:12px">${b.slotFrom}–${b.slotTo}</td>
            <td><button class="btn btn-danger btn-sm" onclick="cancelBooking('${b.id}');renderTeamView()">Отменить</button></td>
          </tr>`;
        }).join('')}
      </tbody></table></div></div>
  </div>`;
}

/* ═══════════════════════════════════════════════════════
   DEPARTMENTS MANAGEMENT
═══════════════════════════════════════════════════════ */
function renderAdminDepartments(el) {
  const depts = getDepartments();
  const users  = getUsers();
  el.innerHTML = `
    <div style="padding:1.25rem 0 .5rem;display:flex;align-items:center;gap:.75rem">
      <button class="btn btn-primary" onclick="addDepartment()">+ Добавить отдел</button>
    </div>
    <div id="dept-list" style="display:flex;flex-direction:column;gap:1rem;padding-bottom:2rem">
      ${depts.length ? depts.map(d => buildDeptCard(d, users)).join('') : '<p style="color:var(--ink3)">Нет отделов</p>'}
    </div>`;
}

function buildDeptCard(dept, users) {
  const head    = users.find(u => u.id === dept.headUserId);
  const members = (dept.memberIds || []).map(id => users.find(u => u.id === id)).filter(Boolean);
  const nonMembers = users.filter(u => !(dept.memberIds || []).includes(u.id));
  return `
  <div class="dept-card" id="dept-${dept.id}">
    <div class="dept-card-head">
      <div class="dept-name-area">
        <span class="dept-name">${escapeHtml(dept.name)}</span>
        <button class="icon-btn" title="Переименовать" onclick="editDeptName('${dept.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
      </div>
      <button class="btn btn-ghost btn-sm" style="color:var(--red);font-size:12px" onclick="deleteDepartment('${dept.id}')">Удалить</button>
    </div>
    <div class="dept-meta">
      <label class="dept-label">Руководитель</label>
      <select class="dept-select" onchange="setDeptHead('${dept.id}',this.value)">
        <option value="">— не назначен —</option>
        ${users.map(u=>`<option value="${u.id}"${u.id===dept.headUserId?' selected':''}>${escapeHtml(u.name)}</option>`).join('')}
      </select>
    </div>
    <div class="dept-members">
      <label class="dept-label">Сотрудники (${members.length})</label>
      <div class="dept-member-list">
        ${members.map(u=>`
          <span class="dept-member-chip">
            ${escapeHtml(u.name)}
            <button onclick="removeMemberFromDept('${dept.id}','${u.id}')" title="Убрать">×</button>
          </span>`).join('')}
      </div>
      ${nonMembers.length ? `
        <div class="dept-add-row">
          <select id="dept-add-sel-${dept.id}" class="dept-select">
            <option value="">Добавить сотрудника…</option>
            ${nonMembers.map(u=>`<option value="${u.id}">${escapeHtml(u.name)}</option>`).join('')}
          </select>
          <button class="btn btn-ghost btn-sm" onclick="addMemberToDept('${dept.id}')">Добавить</button>
        </div>` : ''}
    </div>
  </div>`;
}

function addDepartment() {
  document.getElementById('modal-title').textContent = 'Новый отдел';
  document.getElementById('modal-body').innerHTML = `
    <div class="field">
      <label>Название</label>
      <input type="text" id="new-dept-name" placeholder="Например: Финансы">
    </div>`;
  document.getElementById('modal-foot').innerHTML = `
    <button class="btn btn-ghost" onclick="closeModal()">Отмена</button>
    <button class="btn btn-primary" onclick="createDepartment()">Создать</button>`;
  document.getElementById('modal-overlay').classList.add('open');
  requestAnimationFrame(() => { const i = document.getElementById('new-dept-name'); if(i) i.focus(); });
}

function createDepartment() {
  const name = document.getElementById('new-dept-name').value.trim();
  if (!name) return toast('Введите название', 't-red', '✕');
  const depts = getDepartments();
  depts.push({ id: DB.uid(), name, headUserId: null, memberIds: [] });
  saveDepartments(depts);
  closeModal();
  _refreshDeptTab();
  toast('Отдел создан', '', '✓');
}

function editDeptName(deptId) {
  const depts = getDepartments();
  const dept  = depts.find(d => d.id === deptId);
  if (!dept) return;
  document.getElementById('modal-title').textContent = 'Переименовать отдел';
  document.getElementById('modal-body').innerHTML = `
    <div class="field">
      <label>Название</label>
      <input type="text" id="edit-dept-name" value="${escapeHtml(dept.name)}">
    </div>`;
  document.getElementById('modal-foot').innerHTML = `
    <button class="btn btn-ghost" onclick="closeModal()">Отмена</button>
    <button class="btn btn-primary" onclick="saveDeptName('${deptId}')">Сохранить</button>`;
  document.getElementById('modal-overlay').classList.add('open');
  requestAnimationFrame(() => { const i = document.getElementById('edit-dept-name'); if(i){i.focus();i.select();} });
}

function saveDeptName(deptId) {
  const name = document.getElementById('edit-dept-name').value.trim();
  if (!name) return toast('Введите название', 't-red', '✕');
  const depts = getDepartments();
  const dept  = depts.find(d => d.id === deptId);
  if (!dept) return;
  dept.name = name;
  saveDepartments(depts);
  closeModal();
  _refreshDeptTab();
}

function deleteDepartment(deptId) {
  const depts = getDepartments();
  const dept  = depts.find(d => d.id === deptId);
  if (!dept || !confirm(`Удалить отдел «${dept.name}»?`)) return;
  saveDepartments(depts.filter(d => d.id !== deptId));
  _refreshDeptTab();
  toast('Отдел удалён', '', '✓');
}

function setDeptHead(deptId, userId) {
  const depts = getDepartments();
  const dept  = depts.find(d => d.id === deptId);
  if (!dept) return;
  dept.headUserId = userId || null;
  saveDepartments(depts);
  toast('Руководитель обновлён', '', '✓');
}

function addMemberToDept(deptId) {
  const sel    = document.getElementById('dept-add-sel-' + deptId);
  const userId = sel ? sel.value : '';
  if (!userId) return;
  const depts = getDepartments();
  const dept  = depts.find(d => d.id === deptId);
  if (!dept) return;
  if (!dept.memberIds) dept.memberIds = [];
  if (!dept.memberIds.includes(userId)) dept.memberIds.push(userId);
  saveDepartments(depts);
  _refreshDeptTab();
}

function removeMemberFromDept(deptId, userId) {
  const depts = getDepartments();
  const dept  = depts.find(d => d.id === deptId);
  if (!dept) return;
  dept.memberIds = (dept.memberIds || []).filter(id => id !== userId);
  if (dept.headUserId === userId) dept.headUserId = null;
  saveDepartments(depts);
  _refreshDeptTab();
}

function _refreshDeptTab() {
  const content = document.getElementById('admin-tab-content');
  if (content) renderAdminDepartments(content);
}

/* ═══════════════════════════════════════════════════════
   PROFILE / CHANGE PASSWORD
═══════════════════════════════════════════════════════ */
function showChangePasswordModal() {
  document.getElementById('modal-title').textContent = 'Изменить пароль';
  document.getElementById('modal-body').innerHTML = `
    <div class="field">
      <label>Текущий пароль</label>
      <input type="password" id="cp-old" autocomplete="current-password">
    </div>
    <div class="field">
      <label>Новый пароль <span style="color:var(--ink3);font-size:11px">(мин. 6 символов)</span></label>
      <input type="password" id="cp-new" autocomplete="new-password">
    </div>
    <div class="field">
      <label>Повторите новый пароль</label>
      <input type="password" id="cp-confirm" autocomplete="new-password">
    </div>
    <div id="cp-err" style="color:var(--red);font-size:13px;display:none"></div>`;
  document.getElementById('modal-foot').innerHTML = `
    <button class="btn btn-ghost" onclick="closeModal()">Отмена</button>
    <button class="btn btn-primary" onclick="doChangePassword()">Сохранить</button>`;
  document.getElementById('modal-overlay').classList.add('open');
  requestAnimationFrame(() => { const i = document.getElementById('cp-old'); if(i) i.focus(); });
  // Allow Enter on last field
  document.getElementById('cp-confirm').addEventListener('keydown', e => { if(e.key==='Enter') doChangePassword(); });
}

async function doChangePassword() {
  const oldPwd  = document.getElementById('cp-old').value;
  const newPwd  = document.getElementById('cp-new').value;
  const confirm = document.getElementById('cp-confirm').value;
  const errEl   = document.getElementById('cp-err');
  const showErr = msg => { errEl.textContent = msg; errEl.style.display = 'block'; };

  if (!oldPwd || !newPwd) return showErr('Заполните все поля');
  if (newPwd.length < 6)  return showErr('Новый пароль минимум 6 символов');
  if (newPwd !== confirm)  return showErr('Пароли не совпадают');

  try {
    const r = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: currentUser.email, oldPassword: oldPwd, newPassword: newPwd })
    });
    const data = await r.json();
    if (!r.ok) return showErr(data.error || 'Ошибка');
    // Close modal if open; otherwise we're in the cabinet view — just clear the fields
    const overlay = document.getElementById('modal-overlay');
    if (overlay && overlay.classList.contains('open')) {
      closeModal();
    } else {
      const o = document.getElementById('cp-old'); if(o) o.value='';
      const n = document.getElementById('cp-new'); if(n) n.value='';
      const c = document.getElementById('cp-confirm'); if(c) c.value='';
      const e = document.getElementById('cp-err'); if(e) e.style.display='none';
    }
    toast('Пароль изменён', '', '✓');
  } catch(e) {
    showErr('Нет соединения с сервером');
  }
}

/* ═══════════════════════════════════════════════════════
   FORGOT / RESET PASSWORD
═══════════════════════════════════════════════════════ */
function showForgotPasswordModal() {
  _fpRenderStep1();
  document.getElementById('modal-overlay').classList.add('open');
  requestAnimationFrame(() => { const i = document.getElementById('fp-email'); if(i) i.focus(); });
}

function _fpRenderStep1(prefillEmail) {
  document.getElementById('modal-title').textContent = 'Восстановление пароля';
  document.getElementById('modal-body').innerHTML = `
    <p style="font-size:13px;color:var(--ink2);margin-bottom:1.1rem;line-height:1.5">
      Введите email вашего аккаунта — получите код для сброса пароля.
    </p>
    <div class="field">
      <label>Email</label>
      <input type="email" id="fp-email" placeholder="you@company.ru" autocomplete="email"
             value="${prefillEmail || ''}"
             onkeydown="if(event.key==='Enter') doForgotPassword()">
    </div>
    <div id="fp-err" style="color:var(--red);font-size:13px;display:none"></div>`;
  document.getElementById('modal-foot').innerHTML = `
    <button class="btn btn-ghost" onclick="closeModal()">Отмена</button>
    <button class="btn btn-primary" onclick="doForgotPassword()">Получить код →</button>`;
}

function _fpRenderStep2(email, token) {
  document.getElementById('modal-title').textContent = 'Сброс пароля';
  document.getElementById('modal-body').innerHTML = `
    <div style="background:var(--blue-l);border:1px solid rgba(59,130,246,.25);border-radius:10px;
                padding:.85rem 1rem;margin-bottom:1.1rem">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
                  color:var(--blue);margin-bottom:.35rem">Ваш код сброса</div>
      <div style="font-size:22px;font-weight:800;letter-spacing:4px;color:var(--ink);
                  font-family:var(--mono)">${token}</div>
      <div style="font-size:11px;color:var(--ink3);margin-top:.3rem">действителен 1 час</div>
    </div>
    <div class="field">
      <label>Новый пароль <span style="color:var(--ink3);font-size:11px">(мин. 6 символов)</span></label>
      <input type="password" id="fp-new" autocomplete="new-password" placeholder="••••••••">
    </div>
    <div class="field">
      <label>Повторите пароль</label>
      <input type="password" id="fp-confirm" autocomplete="new-password" placeholder="••••••••"
             onkeydown="if(event.key==='Enter') doResetPassword('${email}','${token}')">
    </div>
    <div id="fp-err2" style="color:var(--red);font-size:13px;display:none"></div>`;
  document.getElementById('modal-foot').innerHTML = `
    <button class="btn btn-ghost" onclick="_fpRenderStep1('${email}')">← Назад</button>
    <button class="btn btn-primary" onclick="doResetPassword('${email}','${token}')">Сменить пароль</button>`;
  requestAnimationFrame(() => { const i = document.getElementById('fp-new'); if(i) i.focus(); });
}

async function doForgotPassword() {
  const email  = (document.getElementById('fp-email')?.value || '').trim();
  const errEl  = document.getElementById('fp-err');
  const showE  = msg => { errEl.textContent = msg; errEl.style.display = 'block'; };
  if (!email) return showE('Введите email');
  const btn = document.querySelector('#modal-foot .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Загрузка…'; }
  try {
    const r = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await r.json();
    if (!r.ok) { if(btn){btn.disabled=false;btn.textContent='Получить код →';} return showE(data.error || 'Ошибка'); }
    _fpRenderStep2(email, data.token);
  } catch(e) {
    if(btn){btn.disabled=false;btn.textContent='Получить код →';}
    showE('Нет соединения с сервером');
  }
}

async function doResetPassword(email, token) {
  const newPwd  = document.getElementById('fp-new')?.value || '';
  const confirm = document.getElementById('fp-confirm')?.value || '';
  const errEl   = document.getElementById('fp-err2');
  const showE   = msg => { errEl.textContent = msg; errEl.style.display = 'block'; };
  if (!newPwd)             return showE('Введите новый пароль');
  if (newPwd.length < 6)  return showE('Пароль минимум 6 символов');
  if (newPwd !== confirm)  return showE('Пароли не совпадают');
  const btn = document.querySelector('#modal-foot .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Сохранение…'; }
  try {
    const r = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, token, newPassword: newPwd })
    });
    const data = await r.json();
    if (!r.ok) { if(btn){btn.disabled=false;btn.textContent='Сменить пароль';} return showE(data.error || 'Ошибка'); }
    closeModal();
    toast('Пароль изменён — войдите с новым паролем', '', '✓');
  } catch(e) {
    if(btn){btn.disabled=false;btn.textContent='Сменить пароль';}
    showE('Нет соединения с сервером');
  }
}

/* ═══════════════════════════════════════════════════════
   ADMIN VIEW
═══════════════════════════════════════════════════════ */
function renderAdminView() {
  const el = document.getElementById('view-admin');
  el.innerHTML = `<div class="view-area">
    <div><div class="view-head">Администрирование</div></div>
    <div class="floor-tabs" id="admin-tabs">
      <button class="floor-tab-btn" onclick="adminTab('users',this)">Пользователи</button>
      <button class="floor-tab-btn active" onclick="adminTab('floors',this)">Коворкинги и планировки</button>
      <button class="floor-tab-btn" onclick="adminTab('bookings',this)">Все брони</button>
      <button class="floor-tab-btn" onclick="adminTab('departments',this)">Департаменты</button>
    </div>
    <div id="admin-tab-content"></div>
  </div>`;
  adminTab('floors', document.querySelector('#admin-tabs .floor-tab-btn:nth-child(2)'));
}

function adminTab(tab, btn) {
  document.querySelectorAll('#admin-tabs .floor-tab-btn').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const el = document.getElementById('admin-tab-content');
  if (tab === 'users')       renderAdminUsers(el);
  if (tab === 'floors')      renderAdminFloors(el);
  if (tab === 'bookings')    renderAdminBookings(el);
  if (tab === 'departments') renderAdminDepartments(el);
}

/* ── Admin: Users ─────────────────────────────────────────────────────────── */
function renderAdminUsers(el) {
  const users = getUsers();
  const bks   = getBookings();
  const roles = { user:'Сотрудник', manager:'Руководитель', admin:'Администратор' };

  el.innerHTML = `<div class="metrics" style="margin-bottom:1.25rem">
    <div class="metric mt-blue"><div class="metric-n" style="color:var(--blue)">${users.length}</div><div class="metric-l">Пользователей</div></div>
    <div class="metric mt-amber"><div class="metric-n" style="color:var(--amber)">${users.filter(u=>u.role==='manager').length}</div><div class="metric-l">Руководителей</div></div>
    <div class="metric mt-purple"><div class="metric-n" style="color:var(--purple)">${users.filter(u=>u.role==='admin').length}</div><div class="metric-l">Администраторов</div></div>
    <div class="metric mt-green"><div class="metric-n" style="color:var(--green)">${bks.length}</div><div class="metric-l">Активных бронирований</div></div>
  </div>
  <div class="card"><div class="card-head">Пользователи</div>
  <div style="padding:0"><table class="data-table">
    <thead><tr><th>ФИО</th><th>Email</th><th>Отдел</th><th>Бронирований</th><th>Роль</th><th></th></tr></thead>
    <tbody>${users.map(u => {
      const cnt = bks.filter(b=>b.userId===u.id).length;
      const isSelf = u.id === currentUser.id;
      return `<tr>
        <td><strong>${escapeHtml(u.name)}</strong></td>
        <td style="color:var(--ink3)">${escapeHtml(u.email)}</td>
        <td>${escapeHtml(u.department||'—')}</td>
        <td><span class="badge badge-blue">${cnt}</span></td>
        <td>${isSelf
          ? `<span class="badge badge-amber">Вы</span>`
          : `<select class="role-sel" onchange="setUserRole('${u.id}',this.value)">
              ${['user','manager','admin'].map(r=>`<option value="${r}" ${u.role===r?'selected':''}>${roles[r]}</option>`).join('')}
             </select>`}</td>
        <td>${isSelf ? '' : `<button class="btn btn-danger btn-xs" data-uid="${u.id}" data-name="${escapeHtml(u.name)}" onclick="deleteUser(this.dataset.uid, this.dataset.name)">Удалить</button>`}</td>
      </tr>`;
    }).join('')}
    </tbody></table></div></div>`;
}

function setUserRole(uid, role) {
  if (!['user', 'manager', 'admin'].includes(role)) return;  // недопустимое значение
  const users = getUsers();
  const u = users.find(u=>u.id===uid);
  if (!u) return;
  u.role = role;
  saveUsers(users);
  toast(`Роль обновлена: ${escapeHtml(u.name)}`, 't-green', '✓');
}

function deleteUser(uid, name) {
  if (!confirm(`Удалить ${escapeHtml(name)}? Все брони будут удалены.`)) return;
  saveUsers(getUsers().filter(u=>u.id!==uid));
  saveBookings(getBookings().filter(b=>b.userId!==uid));
  toast(`${escapeHtml(name)} удалён`, '', '✓');
  renderAdminView();
}

/* ── Admin: All bookings ──────────────────────────────────────────────────── */
function renderAdminBookings(el) {
  purgeExpired();
  const bks    = getBookings().sort((a,b)=>a.date.localeCompare(b.date));
  const spaces = getSpaces();
  const floors = getFloors();
  const totalSpaces = spaces.length;
  const today = new Date();
  const todayDs = fmtDate(today);

  const weekStart = new Date(today);
  weekStart.setHours(0, 0, 0, 0);
  const dow = weekStart.getDay();
  const shift = dow === 0 ? 6 : dow - 1; // Monday-based week
  weekStart.setDate(weekStart.getDate() - shift);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const prevWeekStart = new Date(weekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  const prevWeekEnd = new Date(weekStart);
  prevWeekEnd.setDate(prevWeekEnd.getDate() - 1);

  const weekStartDs = fmtDate(weekStart);
  const weekEndDs = fmtDate(weekEnd);
  const prevWeekStartDs = fmtDate(prevWeekStart);
  const prevWeekEndDs = fmtDate(prevWeekEnd);

  const thisWeekCount = bks.filter(b => b.date >= weekStartDs && b.date <= weekEndDs).length;
  const prevWeekCount = bks.filter(b => b.date >= prevWeekStartDs && b.date <= prevWeekEndDs).length;
  const weekDelta = thisWeekCount - prevWeekCount;
  const weekDeltaSign = weekDelta > 0 ? '+' : '';
  const weekDeltaPct = prevWeekCount > 0 ? Math.round((weekDelta / prevWeekCount) * 100) : (thisWeekCount > 0 ? 100 : 0);
  const weekTrendColor = weekDelta > 0 ? 'var(--green)' : weekDelta < 0 ? 'var(--red)' : 'var(--ink3)';

  const todayBookings = bks.filter(b => b.date === todayDs);
  const todayUniqueSpaces = new Set(todayBookings.map(b => b.spaceId)).size;
  const todayLoadPct = totalSpaces ? Math.round((todayUniqueSpaces / totalSpaces) * 100) : 0;

  const dailyRows = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const ds = fmtDate(d);
    const dayBookings = bks.filter(b => b.date === ds);
    const dayUniqueSpaces = new Set(dayBookings.map(b => b.spaceId)).size;
    const loadPct = totalSpaces ? Math.round((dayUniqueSpaces / totalSpaces) * 100) : 0;
    dailyRows.push({ ds, dayBookings, dayUniqueSpaces, loadPct });
  }

  el.innerHTML = `
    <div class="metrics" style="margin-bottom:1.25rem">
      <div class="metric mt-blue">
        <div class="metric-n" style="color:var(--blue)">${bks.length}</div>
        <div class="metric-l">Всего бронирований</div>
      </div>
      <div class="metric mt-green">
        <div class="metric-n" style="color:${weekTrendColor}">${weekDeltaSign}${weekDelta}</div>
        <div class="metric-l">Изменение за неделю (${weekDeltaSign}${weekDeltaPct}%)</div>
      </div>
      <div class="metric mt-purple">
        <div class="metric-n" style="color:var(--purple)">${totalSpaces}</div>
        <div class="metric-l">Всего рабочих пространств</div>
      </div>
      <div class="metric mt-amber">
        <div class="metric-n" style="color:var(--amber)">${todayLoadPct}%</div>
        <div class="metric-l">Загрузка сегодня (${todayUniqueSpaces}/${totalSpaces || 0})</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">Загрузка по дням (14 дней)</div>
      <div style="padding:0">
        <table class="data-table">
          <thead><tr><th>Дата</th><th>Бронирований</th><th>Занято пространств</th><th>Загрузка</th></tr></thead>
          <tbody>${dailyRows.map(r => `
            <tr>
              <td>${fmtHuman(r.ds)}</td>
              <td>${r.dayBookings.length}</td>
              <td>${r.dayUniqueSpaces}/${totalSpaces || 0}</td>
              <td>
                <div style="display:flex;align-items:center;gap:8px;min-width:180px">
                  <div style="flex:1;height:8px;background:var(--paper);border-radius:999px;overflow:hidden">
                    <div style="height:100%;width:${r.loadPct}%;background:var(--status-mine)"></div>
                  </div>
                  <span style="font-size:11px;color:var(--ink3);min-width:34px">${r.loadPct}%</span>
                </div>
              </td>
            </tr>
          `).join('')}</tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-head">Все бронирования (${bks.length})
        <button class="btn btn-ghost btn-sm" onclick="exportCSV()">⬇ CSV</button>
      </div>
      <div style="padding:0"><table class="data-table">
        <thead><tr><th>Место</th><th>Сотрудник</th><th>Отдел</th><th>Дата</th><th>Время</th><th>Истекает</th><th></th></tr></thead>
        <tbody>${!bks.length ? `<tr><td colspan="7" style="text-align:center;color:var(--ink4);padding:2rem">Нет бронирований</td></tr>` :
          bks.map(b=>{
            const sp=spaces.find(s=>s.id===b.spaceId); const fl=floors.find(f=>f.id===sp?.floorId);
            return `<tr>
              <td><strong>${escapeHtml(sp?.label||'?')}</strong><br><span style="font-size:11px;color:var(--ink3)">${escapeHtml(fl?.name||'?')}</span></td>
              <td>${escapeHtml(b.userName)}</td>
              <td style="font-size:12px;color:var(--ink3)">${b.userId===currentUser.id?'<span class="badge badge-blue">Вы</span>':escapeHtml(getUsers().find(u=>u.id===b.userId)?.department||'—')}</td>
              <td>${fmtHuman(b.date)}</td>
              <td style="font-family:'DM Mono',monospace;font-size:12px">${b.slotFrom}–${b.slotTo}</td>
              <td style="font-size:11px;color:var(--ink3)">${b.expiresAt}</td>
              <td><button class="btn btn-danger btn-xs" onclick="adminCancelBk('${b.id}')">Отменить</button></td>
            </tr>`;
          }).join('')}
        </tbody></table></div>
    </div>`;
}

function adminCancelBk(id) {
  const bk = getBookings().find(b=>b.id===id);
  if (!bk) return;
  if (!canCancelBooking(bk)) return toast('Недостаточно прав для отмены', 't-red', '✕');
  saveBookings(getBookings().filter(b=>b.id!==id));
  toast('Бронирование отменено', '', '✓');
  renderStats(); renderMiniBookings(); renderAdminView();
}

function exportCSV() {
  const bks = getBookings(); const spaces = getSpaces(); const floors = getFloors();
  const rows = [['Место','Этаж','Сотрудник','Дата','Слот от','Слот до','Истекает']];
  bks.forEach(b => {
    const sp=spaces.find(s=>s.id===b.spaceId); const fl=floors.find(f=>f.id===sp?.floorId);
    rows.push([escapeCSV(sp?.label||'?'), escapeCSV(fl?.name||'?'), escapeCSV(b.userName), escapeCSV(b.date), escapeCSV(b.slotFrom), escapeCSV(b.slotTo), escapeCSV(b.expiresAt)]);
  });
  const csv = rows.map(r=>r.join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csv);
  a.download = 'bookings.csv'; a.click();
}

/* ═══════════════════════════════════════════════════════
   ADMIN: FLOOR EDITOR
═══════════════════════════════════════════════════════ */
function renderAdminFloors(el) {
  if (!el) return;
  const coworkings = getCoworkings();
  if (!editorCoworkingId || !coworkings.some(c=>c.id===editorCoworkingId)) {
    editorCoworkingId = coworkings[0]?.id || null;
  }
  const floors = getFloorsByCoworking(editorCoworkingId);
  if (!editorFloorId || !floors.some(f=>f.id===editorFloorId)) {
    editorFloorId = floors[0]?.id || null;
  }

  el.innerHTML = `
    <div style="margin-bottom:1rem;display:flex;gap:.75rem">
      <button class="btn btn-primary" onclick="showAddCoworkingModal()">➕ Добавить коворкинг</button>
      <button class="btn btn-primary" onclick="showAddFloorModal()">➕ Добавить этаж</button>
    </div>
    <div style="margin-bottom:.875rem;display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
      <div class="floor-tabs" id="editor-coworking-tabs" style="margin-bottom:0">
        ${coworkings.map(c=>`<button class="floor-tab-btn ${c.id===editorCoworkingId?'active':''}"
          onclick="selectEditorCoworking('${c.id}',this)">${escapeHtml(c.name)}</button>`).join('')}
      </div>
      ${editorCoworkingId ? `<button class="btn btn-danger btn-sm" onclick="deleteCoworking('${editorCoworkingId}')">🗑 Удалить коворкинг</button>` : ''}
    </div>
    <div style="margin-bottom:.875rem;display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
      <div class="floor-tabs" id="editor-floor-tabs" style="margin-bottom:0">
        ${floors.length
          ? floors.map(f=>`<button class="floor-tab-btn ${f.id===editorFloorId?'active':''}"
              onclick="selectEditorFloor('${f.id}',this)">${escapeHtml(f.name)}</button>`).join('')
          : `<span style="font-size:12px;color:var(--ink4);padding:6px 10px">Нет этажей</span>`}
      </div>
      ${editorFloorId ? `<button class="btn btn-danger btn-sm" onclick="deleteFloor('${editorFloorId}')">🗑 Удалить этаж</button>` : ''}
    </div>
    <div class="editor-wrap" style="padding:0">
      <div class="editor-layout" id="editor-layout"></div>
    </div>`;

  renderEditorForFloor();
}

function refreshAdminFloorsIfOpen() {
  renderAdminFloors(document.getElementById('admin-tab-content'));
}

function selectEditorCoworking(id, btn) {
  editorCoworkingId = id;
  editorFloorId = getFloorsByCoworking(id)[0]?.id || null;
  document.querySelectorAll('#editor-coworking-tabs .floor-tab-btn').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  refreshAdminFloorsIfOpen();
}

function createCoworkingWithFloor(coworkingName, floorName='Этаж 1') {
  const name = coworkingName?.trim();
  if (!name) return null;
  const firstFloorName = floorName?.trim() || 'Этаж 1';

  const coworkings = getCoworkings();
  const item = { id: DB.uid(), name };
  coworkings.push(item);
  saveCoworkings(coworkings);

  const floors = getFloors();
  const newF = {
    id: DB.uid(),
    coworkingId: item.id,
    name: firstFloorName,
    imageUrl: null,
    imageType: null,
    sortOrder: floors.length + 1
  };
  floors.push(newF);
  saveFloors(floors);

  editorCoworkingId = item.id;
  editorFloorId = newF.id;
  selCoworkingId = item.id;
  selFloorId = newF.id;

  renderCoworkings();
  renderFloors();
  renderStats();
  renderMiniBookings();
  if (currentView === 'map') renderMapView();

  return { item, floor: newF };
}

function showAddCoworkingModal() {
  document.getElementById('modal-title').textContent = 'Добавить коворкинг';
  document.getElementById('modal-body').innerHTML = `
    <div class="field"><label>Название коворкинга</label>
      <input type="text" id="new-coworking-name" placeholder="Например: Главный офис">
    </div>
    <div class="field"><label>Название этажа</label>
      <input type="text" id="new-floor-name" placeholder="Например: Этаж 1" value="Этаж 1">
    </div>`;
  document.getElementById('modal-foot').innerHTML = `
    <button class="btn btn-ghost" onclick="closeModal()">Отмена</button>
    <button class="btn btn-primary" onclick="createCoworkingFromModal()">Создать</button>`;
  document.getElementById('modal-overlay').classList.add('open');
}

function showAddFloorModal() {
  if (!editorCoworkingId) return toast('Сначала выберите коворкинг', 't-red', '✕');
  const existingFloors = getFloorsByCoworking(editorCoworkingId);
  const existingNames  = new Set(existingFloors.map(f => f.name.trim().toLowerCase()));

  // First available from Этаж 1-4, or Этаж N
  function nextUniqueName() {
    for (let i = 1; i <= 4; i++) {
      const candidate = 'Этаж ' + i;
      if (!existingNames.has(candidate.toLowerCase())) return candidate;
    }
    let n = existingFloors.length + 1;
    while (existingNames.has(('Этаж ' + n).toLowerCase())) n++;
    return 'Этаж ' + n;
  }
  const defaultName = nextUniqueName();

  const chips = [1,2,3,4].map(n => {
    const label = 'Этаж ' + n;
    const taken = existingNames.has(label.toLowerCase());
    const active = label === defaultName;
    return `<button type="button" class="floor-pick-chip${active?' active':''}${taken?' disabled':''}"
      ${taken ? 'disabled title="Уже существует"' : `onclick="floorChipPick('${label}')"`}>${label}</button>`;
  }).join('');

  document.getElementById('modal-title').textContent = 'Добавить этаж';
  document.getElementById('modal-body').innerHTML = `
    <div class="field" style="margin-bottom:.5rem"><label>Быстрый выбор</label>
      <div class="floor-pick-chips">${chips}</div>
    </div>
    <div class="field"><label>Название</label>
      <input type="text" id="new-floor-name" placeholder="Например: Этаж 5" value="${escapeHtml(defaultName)}">
    </div>`;
  document.getElementById('modal-foot').innerHTML = `
    <button class="btn btn-ghost" onclick="closeModal()">Отмена</button>
    <button class="btn btn-primary" onclick="createFloorFromModal()">Создать</button>`;
  document.getElementById('modal-overlay').classList.add('open');
  requestAnimationFrame(() => {
    const inp = document.getElementById('new-floor-name');
    if (inp) { inp.focus(); inp.select(); }
  });
}

function floorChipPick(label) {
  const inp = document.getElementById('new-floor-name');
  if (!inp) return;
  inp.value = label;
  document.querySelectorAll('.floor-pick-chip').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  inp.focus();
}

function createCoworkingFromModal() {
  const name = document.getElementById('new-coworking-name').value.trim();
  const floorName = document.getElementById('new-floor-name').value.trim();
  if (!name) return toast('Введите название коворкинга', 't-red', '✕');
  const created = createCoworkingWithFloor(name, floorName || 'Этаж 1');
  if (!created) return;
  closeModal();
  toast(`Коворкинг "${created.item.name}" создан`, 't-green', '✓');
  refreshAdminFloorsIfOpen();
}

function createFloorFromModal() {
  const name = document.getElementById('new-floor-name').value.trim();
  if (!name) return toast('Введите название этажа', 't-red', '✕');
  addFloorWithName(name);
  closeModal();
}

function addCoworking() {
  const name = prompt('Название коворкинга:');
  if (!name?.trim()) return;
  const floorName = prompt('Название этажа:', 'Этаж 1');
  if (floorName === null) return;
  const created = createCoworkingWithFloor(name, floorName);
  if (!created) return;
  toast(`Коворкинг "${created.item.name}" создан`, 't-green', '✓');
  refreshAdminFloorsIfOpen();
}

function openAddCoworkingFlow(btn) {
  if (currentUser?.role !== 'admin') {
    toast('Доступно только администратору', 't-red', '✕');
    return;
  }
  const name = prompt('Название коворкинга:');
  if (!name?.trim()) return;
  const floorName = prompt('Название этажа для плана:', 'Этаж 1');
  if (floorName === null) return;

  const created = createCoworkingWithFloor(name, floorName);
  if (!created) return;

  const adminBtn = document.getElementById('nav-admin-btn');
  switchView('admin', adminBtn || btn || null);
  refreshAdminFloorsIfOpen();
  toast(`Создано: ${created.item.name} / ${created.floor.name}`, 't-green', '✓');
}

function renameCoworking(id, name) {
  if (!name?.trim()) return;
  const coworkings = getCoworkings();
  const cw = coworkings.find(c=>c.id===id);
  if (!cw) return;
  cw.name = name.trim();
  saveCoworkings(coworkings);
  renderCoworkings();
  refreshAdminFloorsIfOpen();
}

function deleteCoworking(id) {
  const coworkings = getCoworkings();
  if (coworkings.length <= 1) {
    toast('Нельзя удалить последний коворкинг', 't-red', '✕');
    return;
  }
  const cw = coworkings.find(c=>c.id===id);
  if (!cw) return;
  if (!confirm(`Удалить коворкинг "${cw.name}" со всеми этажами и бронированиями?`)) return;

  const floorIds = getFloors().filter(f=>f.coworkingId===id).map(f=>f.id);
  const spaceIds = getSpaces().filter(s=>floorIds.includes(s.floorId)).map(s=>s.id);

  saveCoworkings(coworkings.filter(c=>c.id!==id));
  saveFloors(getFloors().filter(f=>f.coworkingId!==id));
  saveSpaces(getSpaces().filter(s=>!floorIds.includes(s.floorId)));
  saveBookings(getBookings().filter(b=>!spaceIds.includes(b.spaceId)));

  const nextCoworking = getCoworkings()[0];
  editorCoworkingId = nextCoworking?.id || null;
  editorFloorId = getFloorsByCoworking(editorCoworkingId)[0]?.id || null;
  if (selCoworkingId === id) {
    selCoworkingId = editorCoworkingId;
    selFloorId = editorFloorId;
  }
  renderCoworkings();
  renderFloors();
  renderStats();
  renderMiniBookings();
  if (currentView === 'map') renderMapView();
  refreshAdminFloorsIfOpen();
}

function selectEditorFloor(id, btn) {
  editorFloorId = id;
  document.querySelectorAll('#editor-floor-tabs .floor-tab-btn').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderEditorForFloor();
}

function addFloorWithName(name) {
  if (!editorCoworkingId || !name?.trim()) return;
  _addFloor(name.trim());
}

function addFloor() {
  if (!editorCoworkingId) return;
  const name = document.getElementById('new-floor-name')?.value.trim() || prompt('Название этажа:');
  if (!name) return;
  _addFloor(name);
}

function _addFloor(name) {
  const floors = getFloors();
  const newF = {
    id: DB.uid(),
    coworkingId: editorCoworkingId,
    name: name.trim(),
    imageUrl: null,
    imageType: null,
    sortOrder: floors.length + 1
  };
  floors.push(newF);
  saveFloors(floors);
  editorFloorId = newF.id;
  if (!selCoworkingId) selCoworkingId = editorCoworkingId;
  if (selCoworkingId === editorCoworkingId && !selFloorId) selFloorId = newF.id;
  renderFloors();
  renderStats();
  if (currentView === 'map') renderMapView();
  refreshAdminFloorsIfOpen();
}

function renderEditorForFloor() {
  const floor  = getFloors().find(f=>f.id===editorFloorId);
  const layout = document.getElementById('editor-layout');
  if (!layout) return;
  if (!floor) {
    layout.innerHTML = `<div class="empty" style="grid-column:1/-1;padding:2rem">
      <p>Создайте этаж для этого коворкинга</p>
    </div>`;
    return;
  }
  editorSpaces = getSpaces().filter(s=>s.floorId===editorFloorId).map(s=>({...s}));

  layout.innerHTML = `
    <!-- CANVAS CARD -->
    <div class="editor-canvas-card">
      <div class="editor-toolbar">
        <span style="font-size:12px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.7px">
          ${escapeHtml(floor.name)}
        </span>
        <div style="margin-left:auto;display:flex;gap:.5rem;align-items:center">
          <label class="btn btn-ghost btn-sm" style="cursor:pointer">
            📎 Загрузить план (JPG/PNG/PDF)
            <input type="file" accept=".jpg,.jpeg,.png,.pdf,.webp" style="display:none" onchange="uploadFloorImage(event,'${floor.id}')">
          </label>
          ${floor.imageUrl ? `<button class="btn btn-danger btn-sm" onclick="removeFloorImage('${floor.id}')">✕ Удалить план</button>` : ''}
          <span style="font-size:11px;color:var(--ink4)">Рисуй поверх — создаёт зону</span>
        </div>
      </div>
      <div class="editor-canvas-body" id="editor-canvas"
        onmousedown="editorMouseDown(event)"
        onmousemove="editorMouseMove(event)"
        onmouseup="editorMouseUp(event)">
        ${floor.imageUrl
          ? `<img src="${floor.imageUrl}" id="floor-img" style="width:100%;height:auto;display:block;pointer-events:none">`
          : `<div class="no-image">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
                <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                <path d="M21 15l-5-5L5 21"/>
              </svg>
              <div style="font-size:14px;font-weight:600;color:var(--ink3)">Загрузите план этажа</div>
              <div style="font-size:12px;color:var(--ink4)">или рисуйте зоны на пустом холсте</div>
             </div>`}
        <div id="editor-zones"></div>
        <div id="editor-drawing" class="drawing-rect" style="display:none"></div>
      </div>
    </div>

    <!-- PANEL -->
    <div class="editor-panel" id="editor-panel">
      <div class="panel-card">
        <div class="panel-title">Новая зона</div>
        <div class="panel-field">
          <label>Название</label>
          <input type="text" id="ez-label" placeholder="Кабинет 401" value="${editorNewZone.label}"
            oninput="editorNewZone.label=this.value">
        </div>
        <div class="panel-field">
          <label>Мест</label>
          <input type="number" id="ez-seats" min="1" max="50" value="${editorNewZone.seats}"
            oninput="editorNewZone.seats=parseInt(this.value)||1">
        </div>
        <div class="hint">Нарисуй прямоугольник мышью на плане чтобы создать зону. Каждая зона будет кликабельной.</div>
      </div>

      <div class="panel-card">
        <div class="panel-title" style="display:flex;align-items:center;justify-content:space-between">
          Зоны (${editorSpaces.length})
          <button class="btn btn-primary btn-sm" onclick="saveEditorSpaces()">💾 Сохранить</button>
        </div>
        <div id="editor-zones-list" style="display:flex;flex-direction:column;gap:5px;max-height:300px;overflow-y:auto">
          ${editorSpaces.length ? editorSpaces.map(sp=>`
            <div style="display:flex;align-items:center;gap:8px;padding:7px 8px;border:1px solid var(--line);
              border-radius:6px;font-size:12px">
              <div style="width:10px;height:10px;border-radius:2px;background:${safeCssColor(sp.color)};flex-shrink:0"></div>
              <span style="flex:1;font-weight:600">${escapeHtml(sp.label)}</span>
              <span style="color:var(--ink4)">${sp.seats} мест</span>
              <button class="btn btn-danger btn-xs" onclick="deleteEditorZone('${sp.id}')">✕</button>
            </div>`).join('') :
            `<div style="font-size:12px;color:var(--ink4);text-align:center;padding:.75rem">Нет зон</div>`}
        </div>
      </div>

      <div class="panel-card">
        <div class="panel-title">Настройки этажа</div>
        <div class="panel-field">
          <label>Название</label>
          <input type="text" id="floor-name-inp" value="${floor.name}"
            onblur="renameFloor('${floor.id}',this.value)">
        </div>
        <button class="btn btn-danger btn-sm" onclick="deleteFloor('${floor.id}')">Удалить этаж</button>
      </div>

      <div class="panel-card">
        <div class="panel-title">Настройки коворкинга</div>
        <div class="panel-field">
          <label>Название</label>
          <input type="text" id="coworking-name-inp" value="${getCoworkings().find(c=>c.id===floor.coworkingId)?.name || ''}"
            onblur="renameCoworking('${floor.coworkingId}',this.value)">
        </div>
        <button class="btn btn-danger btn-sm" onclick="deleteCoworking('${floor.coworkingId}')">Удалить коворкинг</button>
      </div>
    </div>`;

  renderEditorZones();
}

function renderEditorZones() {
  const canvas  = document.getElementById('editor-canvas');
  const zonesEl = document.getElementById('editor-zones');
  if (!zonesEl || !canvas) return;
  const CW = canvas.offsetWidth || 800;
  const CH = document.getElementById('floor-img')?.offsetHeight || canvas.offsetHeight || 480;

  zonesEl.innerHTML = editorSpaces.map(sp => {
    const x = sp.x/100*CW, y = sp.y/100*CH, w = sp.w/100*CW, h = sp.h/100*CH;
    return `<div class="zone-rect" data-id="${sp.id}"
      style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:${safeCssColor(sp.color)}">
      <div class="zone-label">${escapeHtml(sp.label)}<br><span style="font-size:9px;opacity:.8">${sp.seats} мест</span></div>
      <button class="zone-del" onclick="deleteEditorZone('${sp.id}')">✕</button>
    </div>`;
  }).join('');
}

/* ── Drawing ──────────────────────────────────────────────────────────────── */
let _drawRect = null;
function editorMouseDown(e) {
  if (e.target.classList.contains('zone-del')) return;
  if (e.target.classList.contains('zone-rect')) return;
  const canvas = document.getElementById('editor-canvas');
  const rect   = canvas.getBoundingClientRect();
  editorDrawing  = true;
  editorDrawStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  const dr = document.getElementById('editor-drawing');
  dr.style.display = 'block';
  dr.style.left = editorDrawStart.x + 'px';
  dr.style.top  = editorDrawStart.y + 'px';
  dr.style.width = '0'; dr.style.height = '0';
}

function editorMouseMove(e) {
  if (!editorDrawing) return;
  const canvas = document.getElementById('editor-canvas');
  const rect   = canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
  const x = Math.min(cx, editorDrawStart.x), y = Math.min(cy, editorDrawStart.y);
  const w = Math.abs(cx - editorDrawStart.x), h = Math.abs(cy - editorDrawStart.y);
  const dr = document.getElementById('editor-drawing');
  dr.style.left = x+'px'; dr.style.top = y+'px';
  dr.style.width = w+'px'; dr.style.height = h+'px';
}

function editorMouseUp(e) {
  if (!editorDrawing) return;
  editorDrawing = false;
  const dr = document.getElementById('editor-drawing');
  dr.style.display = 'none';

  const canvas = document.getElementById('editor-canvas');
  const rect   = canvas.getBoundingClientRect();
  const CW = canvas.offsetWidth, CH = document.getElementById('floor-img')?.offsetHeight || canvas.offsetHeight;

  const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
  const px = Math.min(cx, editorDrawStart.x), py = Math.min(cy, editorDrawStart.y);
  const pw = Math.abs(cx - editorDrawStart.x), ph = Math.abs(cy - editorDrawStart.y);

  if (pw < 20 || ph < 20) return;

  document.getElementById('modal-title').textContent = 'Новая зона';
  document.getElementById('modal-body').innerHTML = `
    <div class="field"><label>Название зоны</label>
      <input type="text" id="zone-name-input" placeholder="Например: Кабинет 401">
    </div>`;
  document.getElementById('modal-foot').innerHTML = `
    <button class="btn btn-ghost" onclick="closeModal()">Отмена</button>
    <button class="btn btn-primary" onclick="createZoneFromModal(${px},${py},${pw},${ph},${CW},${CH})">Создать</button>`;
  document.getElementById('modal-overlay').classList.add('open');
}

function createZoneFromModal(px,py,pw,ph,CW,CH) {
  const label = document.getElementById('zone-name-input').value.trim() || 'Зона';
  closeModal();
  document.getElementById('ez-label').value = '';
  editorNewZone.label = '';

  const newSp = {
    id:      DB.uid(),
    floorId: editorFloorId,
    label,
    seats:   editorNewZone.seats || 1,
    x:       Math.round(px/CW*100*100)/100,
    y:       Math.round(py/CH*100*100)/100,
    w:       Math.round(pw/CW*100*100)/100,
    h:       Math.round(ph/CH*100*100)/100,
    color:   editorNewZone.color || '#059669'
  };
  editorSpaces.push(newSp);
  renderEditorZones();
  updateEditorZonesList();
  toast(`Зона "${label}" добавлена — не забудь сохранить`, 't-green', '✓');
}

function pickColor(c) {
  editorNewZone.color = c;
  document.querySelectorAll('.color-swatches .swatch').forEach(el => {
    el.classList.toggle('active', el.style.background === c || el.style.backgroundColor === c);
  });
}

function deleteEditorZone(id) {
  editorSpaces = editorSpaces.filter(s=>s.id!==id);
  renderEditorZones();
  updateEditorZonesList();
}

function updateEditorZonesList() {
  const el = document.getElementById('editor-zones-list');
  if (!el) return;
  const title = el.closest('.panel-card')?.querySelector('.panel-title');
  if (title) title.childNodes[0].textContent = `Зоны (${editorSpaces.length})`;
  el.innerHTML = editorSpaces.length ? editorSpaces.map(sp=>`
    <div style="display:flex;align-items:center;gap:8px;padding:7px 8px;border:1px solid var(--line);
      border-radius:6px;font-size:12px">
      <div style="width:10px;height:10px;border-radius:2px;background:${safeCssColor(sp.color)};flex-shrink:0"></div>
      <span style="flex:1;font-weight:600">${escapeHtml(sp.label)}</span>
      <span style="color:var(--ink4)">${sp.seats} мест</span>
      <button class="btn btn-danger btn-xs" onclick="deleteEditorZone('${sp.id}')">✕</button>
    </div>`).join('') :
    `<div style="font-size:12px;color:var(--ink4);text-align:center;padding:.75rem">Нет зон</div>`;
}

function saveEditorSpaces() {
  const allSpaces   = getSpaces().filter(s=>s.floorId!==editorFloorId);
  const finalSpaces = [...allSpaces, ...editorSpaces];
  saveSpaces(finalSpaces);
  // Refresh floors/spaces in main view
  if (!selFloorId) selFloorId = editorFloorId;
  renderFloors(); renderStats(); renderMiniBookings();
  toast('Планировка сохранена ✓', 't-green', '✓');
}

function uploadFloorImage(e, floorId) {
  const file = e.target.files[0];
  if (!file) return;
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

  if (isPdf) {
    toast('Конвертирую PDF…', '', '⏳');
    const url = URL.createObjectURL(file);
    pdfjsLib.getDocument(url).promise
      .then(pdf => pdf.getPage(1))
      .then(page => {
        const vp = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width;
        canvas.height = vp.height;
        return page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
          .then(() => {
            URL.revokeObjectURL(url);
            _applyFloorImage(floorId, canvas.toDataURL('image/jpeg', 0.85));
          });
      })
      .catch(err => {
        URL.revokeObjectURL(url);
        toast('Ошибка PDF: ' + err.message, 't-red', '✕');
      });
    return;
  }

  const reader = new FileReader();
  reader.onload = evt => _applyFloorImage(floorId, evt.target.result);
  reader.readAsDataURL(file);
}

function _applyFloorImage(floorId, dataUrl) {
  const floors = getFloors();
  const fl = floors.find(f => f.id === floorId);
  if (!fl) return;
  fl.imageUrl = dataUrl;
  fl.imageType = 'image';
  saveFloors(floors);
  if (currentView === 'map') renderMapView();
  refreshAdminFloorsIfOpen();
  toast('План загружен ✓', 't-green', '✓');
}

function removeFloorImage(floorId) {
  const floors = getFloors();
  const fl = floors.find(f=>f.id===floorId);
  if (fl) {
    fl.imageUrl = null;
    fl.imageType = null;
    saveFloors(floors);
  }
  if (currentView === 'map') renderMapView();
  refreshAdminFloorsIfOpen();
}

function renameFloor(id, name) {
  if (!name.trim()) return;
  const floors = getFloors();
  const fl = floors.find(f=>f.id===id);
  if (fl) { fl.name = name.trim(); saveFloors(floors); }
  renderFloors();
  if (currentView === 'map') renderMapView();
}

function deleteFloor(id) {
  if (!confirm('Удалить этаж и все его зоны?')) return;
  const removedSpaceIds = getSpaces().filter(s=>s.floorId===id).map(s=>s.id);
  saveFloors(getFloors().filter(f=>f.id!==id));
  saveSpaces(getSpaces().filter(s=>s.floorId!==id));
  saveBookings(getBookings().filter(b => !removedSpaceIds.includes(b.spaceId)));

  const floors = getFloorsByCoworking(editorCoworkingId);
  editorFloorId = floors[0]?.id || null;
  if (selCoworkingId === editorCoworkingId && !floors.find(f=>f.id===selFloorId)) {
    selFloorId = floors[0]?.id || null;
  }
  renderFloors();
  renderCoworkings();
  renderStats();
  renderMiniBookings();
  if (currentView === 'map') renderMapView();
  refreshAdminFloorsIfOpen();
}

/* ═══════════════════════════════════════════════════════
   MODAL HELPERS
═══════════════════════════════════════════════════════ */
function closeModal() { document.getElementById('modal-overlay').classList.remove('open'); }
function overlayClick(e) { if (e.target === document.getElementById('modal-overlay')) closeModal(); }

/* ═══════════════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════════════ */
/* ── Sidebar resize ───────────────────────────────────────────────────────── */
function initSidebarResize() {
  const handle  = document.getElementById('sidebar-resizer');
  const sidebar = document.querySelector('.sidebar');
  if (!handle || !sidebar) return;

  // Restore saved width
  const saved = localStorage.getItem('ws_sidebar_w');
  if (saved) sidebar.style.width = saved + 'px';

  let dragging = false, startX = 0, startW = 0;

  handle.addEventListener('mousedown', e => {
    dragging = true;
    startX   = e.clientX;
    startW   = sidebar.getBoundingClientRect().width;
    handle.classList.add('dragging');
    document.body.style.cursor     = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const w = Math.min(520, Math.max(200, startW + (e.clientX - startX)));
    sidebar.style.width = w + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor     = '';
    document.body.style.userSelect = '';
    const w = parseInt(sidebar.style.width);
    if (w) localStorage.setItem('ws_sidebar_w', w);
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  initSidebarResize();
  // Enter key
  document.getElementById('l-pass').addEventListener('keydown', e => e.key==='Enter' && doLogin());

  // Restore session (new format: full user object; legacy: user ID string)
  const sessionData = DB.get('session', null);
  if (sessionData) {
    const u = (typeof sessionData === 'object' && sessionData.id)
      ? sessionData                                    // new format
      : getUsers().find(u => u.id === sessionData);   // legacy format
    if (u && u.id) { await onAuth(u); return; }
  }
});


/* ═══════════════════════════════════════════════════════
   REAL-TIME UPDATES (Supabase)
═══════════════════════════════════════════════════════ */

// Подписка на real-time обновления
window.addEventListener('bookingUpdated', (event) => {
  console.log('🔄 Real-time: изменение в бронированиях', event.detail);
  
  // Обновляем UI
  if (currentView === 'map') renderMapView();
  if (currentView === 'mybookings') renderMyBookingsView();
  if (currentView === 'team') renderTeamView();
  if (currentView === 'admin') renderAdminView();
  renderStats();
  renderMiniBookings();
});

window.addEventListener('zoneUpdated', (event) => {
  console.log('🔄 Real-time: изменение в зонах', event.detail);
  
  // Обновляем карту
  if (currentView === 'map') renderMapView();
  renderStats();
});

// ═══════════════════════════════════════════════════════════════
// REALTIME SYNC
// ═══════════════════════════════════════════════════════════════
// Update specific components instead of full page reload
window.addEventListener('realtimeBooking', () => {
  renderStats();
  renderMiniBookings();
  if (currentView === 'map') renderMapView();
});
window.addEventListener('realtimeZone', () => {
  renderMapView();
});
window.addEventListener('realtimeFloor', () => {
  renderFloors();
  if (currentView === 'map') renderMapView();
});
