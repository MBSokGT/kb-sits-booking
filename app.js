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

function sameId(a, b) {
  return String(a ?? '').trim() === String(b ?? '').trim();
}

function isCurrentUserId(id) {
  return !!currentUser && sameId(id, currentUser.id);
}

function isMineBooking(booking) {
  return !!booking && isCurrentUserId(booking.userId);
}

function getStatusColors() {
  const root = getComputedStyle(document.documentElement);
  return {
    free: root.getPropertyValue('--status-free').trim() || '#059669',
    mine: root.getPropertyValue('--status-mine').trim() || '#1d4ed8',
    busy: root.getPropertyValue('--status-busy').trim() || '#ef4444',
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const floorImageMetaCache = new Map();

function getFloorImageRatio(floor, onReady) {
  const url = safeImageUrl(floor?.imageUrl);
  if (!url) return null;
  const cached = floorImageMetaCache.get(url);
  if (cached?.ratio) return cached.ratio;

  const img = new Image();
  img.onload = () => {
    const ratio = img.naturalWidth && img.naturalHeight
      ? img.naturalWidth / img.naturalHeight
      : null;
    floorImageMetaCache.set(url, { ratio: ratio || 760 / 520 });
    if (typeof onReady === 'function') onReady();
  };
  img.onerror = () => {
    floorImageMetaCache.set(url, { ratio: 760 / 520 });
    if (typeof onReady === 'function') onReady();
  };
  img.src = url;
  return null;
}

/* ═══════════════════════════════════════════════════════
   DATA LAYER  (localStorage — swap to fetch() later)
═══════════════════════════════════════════════════════ */
// Declared here so DB._push can safely reference it during seed (avoids TDZ)
let currentUser = null;
const suppressPushKeys = new Set();
let apiToken = '';
let serverRevs = {};

function getServerRev(key) {
  const rev = Number(serverRevs[key]);
  return Number.isInteger(rev) && rev > 0 ? rev : null;
}

function setServerRev(key, rev) {
  const clean = Number(rev);
  if (!Number.isInteger(clean) || clean < 1) return;
  serverRevs[key] = clean;
}

function clearServerRevs() {
  serverRevs = {};
}

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
    // Async push to server KV (skip auth/session/users and bookings: bookings use dedicated API)
    if (k !== 'session' && k !== 'users' && k !== 'bookings') {
      if (suppressPushKeys.has(k)) {
        suppressPushKeys.delete(k);
      } else {
        DB._push(k, v);
      }
    }
  },
  _push(k, v) {
    if (!currentUser) return; // don't push before login/auth
    const payload = { value: v };
    const rev = getServerRev(k);
    if (rev) payload.rev = rev;
    apiFetch('/api/kv/' + encodeURIComponent(k), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(async r => {
      if (r.status === 401) requireRelogin();
      if (r.status === 409) {
        // Someone else updated shared config first; pull latest state.
        await syncFromServer().catch(() => {});
        return;
      }
      const data = await r.json().catch(() => null);
      if (!r.ok) {
        if (currentUser?.role === 'admin') {
          toast(data?.error || 'Не удалось сохранить изменения на сервере', 't-red', '✕');
        }
        return;
      }
      if (Number.isInteger(Number(data?.rev))) setServerRev(k, Number(data.rev));
    }).catch(() => {}); // silently ignore when offline
  },
  uid(){ return Date.now() + Math.random().toString(36).slice(2,7) }
};

/* ── Initial seed ─────────────────────────────────────────────────────────── */
// Users are managed server-side — no local seed needed.
// Populated from /api/users on login via syncFromServer().
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
if (!DB.get('departments', null)) DB.set('departments', []);

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
const saveUsers    = v  => {
  if (!Array.isArray(v)) return;
  DB.set('users', v);
  syncCurrentUserProfile(v);
};
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
  // Keep booking history for 2 years, then remove old records.
  // Optimize: only run every 5 minutes max.
  const nowUtcMs = Date.now();
  if (nowUtcMs - lastPurgeTime < 5 * 60 * 1000) return;
  lastPurgeTime = nowUtcMs;

  const retentionMs = 2 * 365 * 24 * 60 * 60 * 1000;
  saveBookings(getBookings().filter(b => {
    const endMs = bookingEndUtcMs(b);
    return Number.isFinite(endMs) && (nowUtcMs - endMs) <= retentionMs;
  }));
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
let workingSaturdays = [];  // array of 'YYYY-MM-DD' (персональные настройки пользователя)
let saturdayMode = false;   // true = all Saturdays are bookable
let slotId        = 'full';
let customFrom    = '10:00';
let customTo      = '18:00';
let displayMode   = 'map';     // 'map' | 'list'
let mapZoom       = parseFloat(localStorage.getItem('mapZoom'))    || 1.0;  // map zoom: 0.5..2.0
let editorZoom    = parseFloat(localStorage.getItem('editorZoom')) || 1.0;  // admin editor zoom
let currentView   = 'map';
let adminActiveTab = 'floors';
let expiryTimer   = null;
let bookingForUserId = null;
let bookingUserSearch = '';
let calendarSinglePick = false;
let selectedMyBookingIds = new Set();
let adminUserSearch = '';
let adminUserSort = 'lastLogin';
let adminStatsPeriod = 30;
let teamViewPeriod   = 'active'; // 'active' | '30' | 'all'
let teamViewTab      = 'bookings'; // 'bookings' | 'stats'
let teamViewSearch   = ''; // filter by employee name
let myBookingsTab    = 'active'; // 'active' | 'history'
let adminStatsDept = '';
const deptMemberSearch = {};

// Editor state
let editorCoworkingId = null;
let editorFloorId   = null;
let editorSpaces    = [];
let editorDrawing   = false;
let editorDrag = null;
let editorDrawStart = null;
let editorNewZone   = { label:'', seats:1, color:'#059669' };
let editorSelectedZoneId = null;
let editorClipboardZone = null;
let lastPurgeTime   = 0;
let purgeTimer      = null;
let sessionCheckTimer = null;
let cloudSyncTimer = null;
let cloudSyncFullTimer = null;
let _sessionActivityHandler = null;  // single ref so we can removeEventListener

const SLOTS = [
  { id:'full',      label:'Весь день',  from:'10:00', to:'18:00' },
  { id:'custom',    label:'Своё время', from:'10:00', to:'18:00' },
];
const COLORS = ['#059669'];
const MONTHS  = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const MONTHS_S= ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];

function calendarPrefsStorageKey() {
  const uid = currentUser?.id ? String(currentUser.id).trim() : 'guest';
  return `ws_calendar_prefs_${uid}`;
}

function loadCalendarPrefs() {
  includeWeekends = false;
  saturdayMode = false;
  workingSaturdays = [];
  if (!currentUser) return;

  try {
    const raw = localStorage.getItem(calendarPrefsStorageKey());
    if (!raw) return;
    const parsed = JSON.parse(raw);
    includeWeekends = !!parsed?.includeWeekends;
    saturdayMode = !!parsed?.saturdayMode;
    workingSaturdays = Array.isArray(parsed?.workingSaturdays)
      ? Array.from(new Set(parsed.workingSaturdays.map(d => String(d).trim()).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)))).sort()
      : [];
  } catch {
    includeWeekends = false;
    saturdayMode = false;
    workingSaturdays = [];
  }
}

function saveCalendarPrefs() {
  if (!currentUser) return;
  try {
    localStorage.setItem(calendarPrefsStorageKey(), JSON.stringify({
      includeWeekends: !!includeWeekends,
      saturdayMode: !!saturdayMode,
      workingSaturdays: Array.from(new Set(workingSaturdays)).sort(),
    }));
  } catch {}
}

/* ═══════════════════════════════════════════════════════
   UTILS
═══════════════════════════════════════════════════════ */
function p2(n) { return String(n).padStart(2,'0'); }
function pluralRu(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
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
function parseMskDateTimeToUtcMs(dateStr, timeStr) {
  if (!dateStr || !timeStr) return NaN;
  const dm = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const tm = String(timeStr).match(/^(\d{2}):(\d{2})$/);
  if (!dm || !tm) return NaN;

  const y = Number(dm[1]);
  const mo = Number(dm[2]);
  const d = Number(dm[3]);
  const h = Number(tm[1]);
  const mi = Number(tm[2]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d) ||
      !Number.isFinite(h) || !Number.isFinite(mi)) {
    return NaN;
  }

  // Moscow is UTC+3 without DST
  return Date.UTC(y, mo - 1, d, h - 3, mi, 0, 0);
}
function bookingEndUtcMs(b) {
  if (!b) return NaN;
  if (typeof b.expiresAt === 'string') {
    const m = b.expiresAt.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
    if (m) {
      const t = parseMskDateTimeToUtcMs(m[1], m[2]);
      if (Number.isFinite(t)) return t;
    }
  }
  if (b.date && b.slotTo) {
    const t = parseMskDateTimeToUtcMs(b.date, b.slotTo);
    if (Number.isFinite(t)) return t;
  }
  return NaN;
}
function getActiveBookings(source = getBookings(), nowUtcMs = Date.now()) {
  if (!Array.isArray(source)) return [];
  return source.filter(b => {
    if (b?.status === 'cancelled') return false;
    const endMs = bookingEndUtcMs(b);
    return Number.isFinite(endMs) && endMs > nowUtcMs;
  });
}
function findBookingForSpace(spaceId, date, from, to) {
  return getActiveBookings().find(b =>
    b.spaceId === spaceId &&
    b.date === date &&
    timesOverlap(from, to, b.slotFrom, b.slotTo)
  );
}

function userInitials(name) {
  return name.split(' ').map(p=>p[0]).join('').slice(0,2).toUpperCase();
}
// "Тест Сотрудник Отчество" → "Тест С."
function shortName(name) {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return parts[0] + ' ' + parts[1][0] + '.';
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

async function apiFetch(url, options = {}, authRequired = true) {
  const headers = { ...(options.headers || {}) };
  if (authRequired && apiToken) {
    headers.Authorization = `Bearer ${apiToken}`;
  }
  return fetch(url, { ...options, headers, credentials: 'same-origin' });
}

function requireRelogin(msg = 'Сессия истекла. Войдите снова.') {
  doLogout(true);
  authErr(msg);
}

function resetDemoData() {
  if (!confirm('Сбросить все локальные данные? Данные будут перезагружены из облака при следующем входе.')) return;
  ['coworkings','floors','spaces','bookings','departments','session'].forEach(k => localStorage.removeItem('ws_' + k));
  location.reload();
}

async function doLogin() {
  const login = document.getElementById('l-email').value.trim();
  const pass  = document.getElementById('l-pass').value;

  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email: login, login, password: pass })
    });
    const data = await r.json();
    if (!r.ok) { return authErr(data.error || 'Неверный логин или пароль'); }
    if (!data?.user) return authErr('Ошибка авторизации');
    await onAuth(data.user, data.token || '');
  } catch(e) {
    authErr('Нет соединения с сервером');
  }
}

async function onAuth(user, token = '') {
  apiToken = token || '';
  clearServerRevs();
  currentUser = { ...user };
  delete currentUser._token;
  // Store full user object (without password) so session survives page reload
  const { password, password_hash, ...safeUser } = currentUser;
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
    requireRelogin('Не удалось загрузить данные. Войдите снова.');
    return;
  }
  startExpiryWatcher();
  startCloudSync();
}

function doLogout(skipServerLogout = false) {
  apiToken = '';
  clearServerRevs();
  if (!skipServerLogout) {
    fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
    }).catch(() => {});
  }
  currentUser = null;
  DB.set('session', null);
  stopExpiryWatcher();
  stopCloudSync();
  stopPurgeTimer();
  stopSessionCheck();
  // Очищаем состояние
  selCoworkingId = null;
  selFloorId = null;
  selDates = [];
  bookingForUserId = null;
  displayMode = 'map';
  currentView = 'map';
  try { localStorage.removeItem('lastView'); } catch(e) {}
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
  customFrom = '10:00';
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
    el.style.display = (u.role==='manager'||u.role==='admin') ? 'block' : 'none');
  document.querySelectorAll('.admin-only').forEach(el =>
    el.style.display = u.role==='admin' ? 'block' : 'none');
}

function syncCurrentUserProfile(users) {
  if (!currentUser || !Array.isArray(users)) return;
  const fresh = users.find(u => sameId(u.id, currentUser.id));
  if (!fresh) return;
  currentUser = { ...currentUser, ...fresh };
  const { password, password_hash, ...safeUser } = currentUser;
  DB.set('session', safeUser);
  applyUserUI();
}

/* ═══════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════ */
/* ── Server sync ───────────────────────────────────────────────────────────── */
async function syncFromServer({ bookingsOnly = false } = {}) {
  if (!currentUser) return false;
  try {
    if (bookingsOnly) {
      return fetchBookingsFromApi();
    }

    let unauthorized = false;
    // 1. Fetch users (no passwords) → populate localStorage cache for admin UI
    const ur = await apiFetch('/api/users');
    if (ur.status === 401) { requireRelogin(); return false; }
    if (ur.ok) {
      const ud = await ur.json();
      if (Array.isArray(ud.users)) {
        saveUsers(ud.users);
      }
    }

    // 2. Sync shared KV buckets (without bookings: bookings are in dedicated API)
    const keys = ['coworkings', 'floors', 'spaces', 'departments'];
    const pendingPush = {};

    await Promise.all(keys.map(async k => {
      const r = await apiFetch('/api/kv/' + encodeURIComponent(k));
      if (r.status === 401) { unauthorized = true; return; }
      if (!r.ok) return;
      const d = await r.json();
      if (Number.isInteger(Number(d?.rev))) setServerRev(k, Number(d.rev));
      if (d.value !== null && d.value !== undefined) {
        // Server has data → overwrite localStorage (truth comes from server)
        localStorage.setItem('ws_' + k, JSON.stringify(d.value));
      } else {
        // Server bucket empty → collect for ordered push (spaces depend on floors)
        const local = DB.get(k, null);
        if (local) pendingPush[k] = local;
      }
    }));

    if (unauthorized) {
      requireRelogin();
      return false;
    }
    // Push empty-server keys in dependency order: coworkings → floors → spaces
    // (parallel Promise.all would race and spaces could arrive before floors exist)
    for (const k of ['coworkings', 'floors', 'spaces', 'departments']) {
      if (pendingPush[k]) await pushDomainKey(k, pendingPush[k]);
    }
    return fetchBookingsFromApi();
  } catch(e) {
    console.warn('Server sync skipped (offline or local dev):', e.message);
    return false;
  }
}

async function pushDomainKey(key, value) {
  if (!currentUser) return false;
  const payload = { value };
  const rev = getServerRev(key);
  if (rev) payload.rev = rev;
  try {
    const r = await apiFetch('/api/kv/' + encodeURIComponent(key), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (r.status === 401) {
      requireRelogin();
      return false;
    }
    const data = await r.json().catch(() => ({}));
    if (r.status === 409) {
      await syncFromServer().catch(() => {});
      if (currentView === 'admin') renderAdminView(adminActiveTab);
      toast('Конфликт обновления. Данные перезагружены — повторите сохранение.', 't-amber', '!');
      return false;
    }
    if (!r.ok) {
      toast(data.error || 'Не удалось сохранить изменения на сервере', 't-red', '✕');
      return false;
    }
    if (Number.isInteger(Number(data?.rev))) setServerRev(key, Number(data.rev));
    return true;
  } catch (e) {
    return false;
  }
}

async function fetchBookingsFromApi() {
  if (!currentUser) return false;
  const r = await apiFetch('/api/bookings');
  if (r.status === 401) { requireRelogin(); return false; }
  if (!r.ok) return false;
  const d = await r.json();
  const bookings = Array.isArray(d.bookings) ? d.bookings : [];
  localStorage.setItem('ws_bookings', JSON.stringify(bookings));
  return true;
}

async function syncBookingsFromServer() {
  if (!currentUser) return false;
  const before = JSON.stringify(getBookings());
  const ok = await fetchBookingsFromApi();
  if (!ok) return false;
  const after = JSON.stringify(getBookings());
  if (before !== after) refreshActiveViewAfterExpiry();
  return true;
}

async function replaceBookingsAsAdmin(nextBookings) {
  if (currentUser?.role !== 'admin') {
    saveBookings(nextBookings);
    return true;
  }
  const r = await apiFetch('/api/bookings/replace-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookings: nextBookings }),
  });
  if (r.status === 401) {
    requireRelogin();
    return false;
  }
  const data = await r.json();
  if (!r.ok) {
    toast(data.error || 'Не удалось обновить бронирования', 't-red', '✕');
    return false;
  }
  saveBookings(Array.isArray(data.bookings) ? data.bookings : []);
  return true;
}

function startCloudSync() {
  stopCloudSync();
  syncBookingsFromServer();
  cloudSyncTimer = setInterval(() => {
    if (!currentUser) return;
    syncBookingsFromServer();
  }, 10000);
  cloudSyncFullTimer = setInterval(() => {
    if (!currentUser) return;
    syncFromServer().then(synced => {
      if (synced) refreshView();
    }).catch(() => {});
  }, 60000);
}

function stopCloudSync() {
  if (cloudSyncTimer) {
    clearInterval(cloudSyncTimer);
    cloudSyncTimer = null;
  }
  if (cloudSyncFullTimer) {
    clearInterval(cloudSyncFullTimer);
    cloudSyncFullTimer = null;
  }
}

async function initApp() {
  // Sync from server first (overwrites localStorage with server truth)
  const synced = await syncFromServer();
  if (!synced && !currentUser) throw new Error('Server sync failed');
  
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
  loadCalendarPrefs();

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

  // Restore last visited tab, but only if the user is allowed to see it
  const allowed = new Set(['map', 'mybookings', 'team', 'admin', 'cabinet']);
  if (currentUser?.role === 'user')    { allowed.delete('team'); allowed.delete('admin'); }
  if (currentUser?.role === 'manager') { allowed.delete('admin'); }
  const savedView = localStorage.getItem('lastView');
  const startView = savedView && allowed.has(savedView) ? savedView : 'map';
  const savedAdminTab = localStorage.getItem('adminActiveTab');
  if (savedAdminTab) adminActiveTab = savedAdminTab;
  switchView(startView);
}

function refreshActiveViewAfterExpiry() {
  renderStats();
  renderMiniBookings();
  if (currentView === 'map')        renderMapView();
  if (currentView === 'mybookings') renderMyBookingsView();
  if (currentView === 'team')       renderTeamView();
  if (currentView === 'admin')      renderAdminView();
  if (currentView === 'cabinet')    renderCabinetView();
}

function startExpiryWatcher() {
  stopExpiryWatcher();
  let lastActiveSignature = getActiveBookings(getBookings()).map(b => b.id).sort().join('|');
  expiryTimer = setInterval(() => {
    purgeExpired();
    if (!currentUser) return;
    const nextSignature = getActiveBookings(getBookings()).map(b => b.id).sort().join('|');
    if (nextSignature !== lastActiveSignature) {
      lastActiveSignature = nextSignature;
      refreshActiveViewAfterExpiry();
    }
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
  saveCalendarPrefs();
  renderCalendar();
}

function toggleSaturdayMode(checked) {
  saturdayMode = checked;
  if (!checked) workingSaturdays = [];
  saveCalendarPrefs();
  renderCalendar();
}

function toggleWeekdayPicker() {
  const panel = document.getElementById('cal-weekday-panel');
  const arrow = document.getElementById('cal-wd-arrow');
  if (!panel) return;
  const open = panel.style.display === 'none';
  panel.style.display = open ? '' : 'none';
  if (arrow) arrow.classList.toggle('open', open);
}

function applyWeekdayPick() {
  const panel = document.getElementById('cal-weekday-panel');
  if (!panel) return;
  const days = new Set();
  panel.querySelectorAll('input[type=checkbox]:checked').forEach(cb => days.add(Number(cb.value)));
  if (!days.size) return;

  const monthCount = parseInt(document.getElementById('cal-wd-months')?.value || '1', 10);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // end = last day of (current month + monthCount - 1)
  const end = new Date(today.getFullYear(), today.getMonth() + monthCount, 0);

  const toAdd = [];
  const cur = new Date(today);
  while (cur <= end) {
    const dow = cur.getDay();
    if (days.has(dow)) {
      const ds = fmtDate(new Date(cur));
      if (!isPastDate(ds) && !selDates.includes(ds)) toAdd.push(ds);
    }
    cur.setDate(cur.getDate() + 1);
  }
  selDates = Array.from(new Set([...selDates, ...toAdd])).sort();
  renderCalendar();
}

function toggleWorkingSaturday(ds) {
  if (workingSaturdays.includes(ds)) {
    workingSaturdays = workingSaturdays.filter(x => x !== ds);
  } else {
    workingSaturdays = [...workingSaturdays, ds].sort();
  }
  saveCalendarPrefs();
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
  if (dow === 6) return includeWeekends || saturdayMode || workingSaturdays.includes(ds);  // Saturday
  return true;
}

function isRangeDayAllowed(dateObj) {
  const dow = dateObj.getDay();
  const ds = fmtDate(new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()));
  if (includeWeekends) return true;
  if (dow === 0) return false;
  if (dow === 6) return saturdayMode || workingSaturdays.includes(ds);
  return true;
}

function calDayClick(ds, evt) {
  if (!isDateSelectable(ds)) return;

  if (calendarSinglePick) {
    selDates = [ds];
    calAnchorDate = ds;
    renderCalendar();
    renderStats();
    renderMiniBookings();
    if (currentView === 'map') renderMapView();
    updateRangeHint();
    closeCalendar();
    return;
  }

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
  const satHint = workingSaturdays.length ? `, выбрано сб: ${workingSaturdays.length}` : '';
  const daysHint = includeWeekends
    ? 'включены сб и вс'
    : saturdayMode
    ? `включены все субботы${satHint}`
    : workingSaturdays.length
    ? `выбраны рабочие субботы (${workingSaturdays.length})`
    : 'только пн-пт';

  if (selDates.length > 1) {
    el.innerHTML = `${selDates.length} дней · ${daysHint} · ${todayLink}`;
  } else {
    el.innerHTML = selDates.length
      ? `${fmtHuman(selDates[0])} · ${daysHint} · ${todayLink}`
      : `${daysHint} · ${todayLink}`;
  }
  updateCalTrigger();
  updateBookingModalSummary();
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

function shiftSelectedDate(deltaDays) {
  const base = selDates[0] || fmtDate(new Date());
  const d = new Date(base + 'T12:00:00');
  d.setDate(d.getDate() + Number(deltaDays || 0));
  const ds = fmtDate(d);
  selDates = [ds];
  calAnchorDate = ds;
  calViewYear = d.getFullYear();
  calViewMonth = d.getMonth();
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

function openCalendar(singlePick = false) {
  calendarSinglePick = !!singlePick;
  const titleEl = document.getElementById('cal-popup-title');
  const hintEl = document.getElementById('cal-hint-box');
  if (titleEl) titleEl.textContent = calendarSinglePick ? 'Выбор дня' : 'Выбор дат';
  if (hintEl) hintEl.style.display = calendarSinglePick ? 'none' : '';
  renderCalendar();
  document.getElementById('cal-overlay').classList.add('active');
  document.getElementById('cal-popup').classList.add('active');
  renderCalendarSlotControls();
  document.addEventListener('keydown', _calEscHandler);
}

function openCalendarForMapDate() {
  const base = selDates[0] || fmtDate(new Date());
  const d = new Date(base + 'T12:00:00');
  calViewYear = d.getFullYear();
  calViewMonth = d.getMonth();
  renderCalendar();
  openCalendar(true);
}

function closeCalendar() {
  document.getElementById('cal-overlay').classList.remove('active');
  document.getElementById('cal-popup').classList.remove('active');
  calendarSinglePick = false;
  document.removeEventListener('keydown', _calEscHandler);
  // If booking modal is open, refresh date/time summary and footer button
  const modalOpen = document.getElementById('modal-overlay')?.classList.contains('open');
  if (modalOpen) {
    updateBookingModalSummary();
    // Update the "Забронировать (N дней)" button text if present
    const footEl = document.getElementById('modal-foot');
    if (footEl) {
      const bookBtn = footEl.querySelector('[onclick^="bookSpace"]');
      if (bookBtn) {
        const m = bookBtn.getAttribute('onclick').match(/bookSpace\('([^']+)'\)/);
        if (m) bookBtn.textContent = `Забронировать${selDates.length > 1 ? ' (' + selDates.length + ' дней)' : ''}`;
      }
    }
    renderStats();
  }
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
  const bookings = getActiveBookings(getBookings()).filter(b => isMineBooking(b));
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
  if (!el) return;
  el.innerHTML = SLOTS.map(s => {
    const active = s.id === slotId;
    const dotColor = active ? 'rgba(255,255,255,.8)' : s.id==='full' ? '#059669' : '#64748b';
    return `<div class="slot-item ${active?'active':''}" onclick="selectSlot('${s.id}')">
      <div class="slot-dot" style="background:${dotColor}"></div>
      <div><div class="slot-name">${s.label}</div>
        <div class="slot-sub">${s.id==='custom'?`${customFrom}–${customTo}`:slotLabel(s)}</div>
      </div>
    </div>`;
  }).join('');
  const ctp = document.getElementById('custom-time-picker');
  if (ctp) ctp.style.display = slotId === 'custom' ? '' : 'none';
}

function renderCalendarSlotControls() {
  const sel = document.getElementById('cal-slot-select');
  if (!sel) return;
  sel.value = slotId;
  const customWrap = document.getElementById('cal-slot-custom');
  if (customWrap) customWrap.style.display = slotId === 'custom' ? '' : 'none';
  const fromEl = document.getElementById('cal-ct-from');
  const toEl = document.getElementById('cal-ct-to');
  if (fromEl) fromEl.value = customFrom;
  if (toEl) toEl.value = customTo;
}

function onCalendarSlotSelect(id) {
  selectSlot(id);
  renderCalendarSlotControls();
}

function applyCalendarCustomTime() {
  const f = document.getElementById('cal-ct-from')?.value || '';
  const t = document.getElementById('cal-ct-to')?.value || '';
  if (!f || !t) return toast('Укажите оба времени', 't-red', '✕');
  if (f >= t) return toast('Время конца должно быть позже времени начала', 't-red', '✕');
  const fMin = timeToMinutes(f);
  const tMin = timeToMinutes(t);
  if (tMin - fMin < 30) return toast('Минимальная длительность 30 минут', 't-red', '✕');
  customFrom = f;
  customTo = t;
  slotId = 'custom';
  renderSlots();
  renderCalendarSlotControls();
  renderStats();
  if (currentView === 'map') renderMapView();
  updateSlotBadge();
}

function selectSlot(id) {
  slotId = id;
  renderSlots();
  renderCalendarSlotControls();
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
  renderCalendarSlotControls();
  renderStats();
  if (currentView === 'map') renderMapView();
  updateSlotBadge();
}

function updateSlotBadge() {
  const s = currentSlot();
  document.getElementById('slot-badge-lbl').textContent = `${s.label}: ${slotLabel(s)}`;
  updateBookingModalSummary();
}

function updateBookingModalSummary() {
  const datesEl = document.getElementById('booking-dates-summary');
  const timeEl = document.getElementById('booking-time-summary');
  if (!datesEl || !timeEl) return;
  if (!selDates.length) {
    datesEl.textContent = 'Даты не выбраны';
  } else if (selDates.length === 1) {
    datesEl.textContent = fmtHuman(selDates[0]);
  } else {
    datesEl.textContent = `${fmtHuman(selDates[0])} — ${fmtHuman(selDates[selDates.length - 1])} · ${selDates.length} дн.`;
  }
  timeEl.textContent = `${slotFrom()}–${slotTo()}`;
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
    else if (isMineBooking(bk)) mine++;
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
  const mine  = getActiveBookings(getBookings()).filter(b => isMineBooking(b));
  if (!mine.length) {
    el.innerHTML = `<div style="font-size:12px;color:var(--ink4);text-align:center;padding:1rem;
      border:1px dashed var(--line);border-radius:var(--radius)">Нет активных бронирований</div>`;
    return;
  }
  const spaces = getSpaces(); const floors = getFloors();
  el.innerHTML = mine.sort((a,b)=>a.date.localeCompare(b.date)).map(b => {
    const sp = spaces.find(s=>s.id===b.spaceId);
    return `<div class="mini-booking">
      <div class="mb-label">${escapeHtml(sp?.label || b.spaceName || '?')}</div>
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
  const dayLabelEl = document.getElementById('map-day-label');
  if (dayLabelEl) dayLabelEl.textContent = fmtHuman(date);
  updateSlotBadge();

  if (displayMode === 'list') { renderListView(spaces, date, from, to); return; }
  const mapArea  = document.getElementById('map-area');
  if (!mapArea) return;
  updateMapZoomLabel();
  const fallbackRatio = 760 / 520;
  const ratio = getFloorImageRatio(floor, () => { if (currentView === 'map') renderMapView(); }) || fallbackRatio;
  const areaW = mapArea?.clientWidth || 760;
  const areaH = mapArea?.clientHeight || 520;
  const pad = 32;
  const maxW = Math.max(280, areaW - pad);
  const maxH = Math.max(220, areaH - pad);
  let W = maxW;
  let H = Math.round(W / ratio);
  if (H > maxH) {
    H = maxH;
    W = Math.round(H * ratio);
  }
  if (!Number.isFinite(W) || !Number.isFinite(H) || W <= 0 || H <= 0) {
    W = 760;
    H = 520;
  }

  // Build SVG map
  const statusColors = getStatusColors();
  let zones = '';
  spaces.forEach(sp => {
    // Проверяем занятость по ВСЕМ выбранным датам (не только первой)
    const checkDates = selDates.length > 0 ? selDates : [date];
    let isMine = false, isBusy = false, busyBk = null;
    for (const d of checkDates) {
      const bk = findBookingForSpace(sp.id, d, from, to);
      if (!bk) continue;
      if (isMineBooking(bk)) { isMine = true; }
      else { isBusy = true; if (!busyBk) busyBk = bk; }
    }
    // Занято чужим — красное; только моё — синее; свободно везде — зелёное.
    // Цвета берём из тех же CSS-переменных, что и у индикаторов под названием этажа.
    const fill   = isBusy ? statusColors.busy : isMine ? statusColors.mine : statusColors.free;
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
          font-family="DM Sans,sans-serif" font-size="9">${checkDates.length > 1 ? 'Занято' : escapeHtml(shortName(busyBk.userName))}</text>`
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

  const svgW = Math.round(W * mapZoom), svgH = Math.round(H * mapZoom);
  mapArea.innerHTML = `
    <div class="map-scroll">
      <div class="map-canvas-wrap">
        <svg width="${svgW}" height="${svgH}" viewBox="0 0 ${W} ${H}" aria-label="План этажа">
          ${bgPattern}${zones}
        </svg>
      </div>
    </div>`;
}

function changeMapZoom(delta) {
  mapZoom = Math.min(2.0, Math.max(0.5, Math.round((mapZoom + delta) * 100) / 100));
  localStorage.setItem('mapZoom', mapZoom);
  updateMapZoomLabel();
  renderMapView();
}
function resetMapZoom() {
  mapZoom = 1.0;
  localStorage.setItem('mapZoom', mapZoom);
  updateMapZoomLabel();
  renderMapView();
}

function updateMapZoomLabel() {
  const lbl = document.getElementById('map-zoom-label');
  if (lbl) lbl.textContent = `${Math.round(mapZoom * 100)}%`;
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
      const isMine = isMineBooking(bk);
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
    return getUsers().filter(u => !u.blocked).slice().sort((a,b)=>a.name.localeCompare(b.name,'ru'));
  }
  if (currentUser.role === 'manager') {
    // Managers can ONLY book for users in their own department (security fix)
    const deptUsers = getUsers().filter(u =>
      !u.blocked &&
      u.department === currentUser.department &&
      !isCurrentUserId(u.id) &&
      u.role === 'user' // Cannot book for other roles
    );
    return [currentUser, ...deptUsers];
  }
  return [currentUser];
}

function canBookForUser(userId) {
  return getAllowedBookingTargets().some(u => sameId(u.id, userId));
}

function hasUserTimeConflict(bookings, userId, date, from, to) {
  return getActiveBookings(bookings).find(b =>
    b.userId === userId &&
    b.date === date &&
    timesOverlap(from, to, b.slotFrom, b.slotTo)
  );
}

function canCancelBooking(booking) {
  if (!currentUser || !booking) return false;
  if (booking.status === 'cancelled') return false;
  const endMs = bookingEndUtcMs(booking);
  if (!Number.isFinite(endMs) || endMs <= Date.now()) return false;
  if (currentUser.role === 'admin') return true;
  if (currentUser.role === 'user') return isMineBooking(booking);
  if (currentUser.role === 'manager') {
    const owner = getUsers().find(u => u.id === booking.userId);
    if (!owner) return false;
    if (isCurrentUserId(owner.id)) return true;
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
  const isMine  = isMineBooking(bk);
  const isBusy  = bk && !isMine;
  const canCancelBusy = isBusy && canCancelBooking(bk);
  const targets = getAllowedBookingTargets();
  // Always default to self when modal opens to avoid accidental booking for another user.
  bookingForUserId = currentUser.id;
  bookingUserSearch = '';
  if (!bookingForUserId || !targets.some(u=>sameId(u.id, bookingForUserId))) {
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
  const canPickTarget = !isBusy && (currentUser.role === 'admin' || currentUser.role === 'manager') && targets.length > 1;
  const filteredTargets = bookingUserSearch
    ? targets.filter(u => `${u.name} ${u.email} ${u.department || ''}`.toLowerCase().includes(bookingUserSearch))
    : targets;
  const targetPicker = canPickTarget
    ? `<div style="margin-bottom:1rem">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--ink4);margin-bottom:6px">
          Бронировать за
        </div>
        <input type="text" class="role-sel" placeholder="Поиск сотрудника..." value="${escapeHtml(bookingUserSearch)}"
          oninput="setBookingUserSearch(this.value)" style="width:100%;margin-bottom:6px">
        <select class="role-sel" id="book-for-user" onchange="bookingForUserId=this.value" style="width:100%">
          ${filteredTargets.length
            ? filteredTargets.map(u=>`<option value="${u.id}" ${sameId(u.id, bookingForUserId)?'selected':''}>${escapeHtml(u.name)}${isCurrentUserId(u.id)?' (я)':''}</option>`).join('')
            : `<option value="">Ничего не найдено</option>`}
        </select>
       </div>`
    : '';
  const dateTimePicker = !isBusy
    ? `<div class="modal-pick">
        <div class="modal-pick-row">
          <div class="modal-pick-label">Даты и время</div>
          <button class="btn btn-ghost btn-sm" onclick="openCalendar()">Выбрать</button>
        </div>
        <div class="modal-pick-value" id="booking-dates-summary"></div>
        <div class="modal-pick-value" id="booking-time-summary"></div>
      </div>`
    : '';

  bodyEl.innerHTML = `
    ${datePills}
    ${targetPicker}
    ${dateTimePicker}
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
  updateBookingModalSummary();
}

async function bookSpace(spaceId) {
  const sp   = getSpaces().find(s=>s.id===spaceId);
  if (!sp) { toast('Помещение не найдено', 't-red', '✕'); return; }
  const from = slotFrom(), to = slotTo();
  const targetId = document.getElementById('book-for-user')?.value || bookingForUserId || currentUser.id;
  if (!canBookForUser(targetId)) {
    toast('Нельзя бронировать за выбранного сотрудника', 't-red', '✕');
    return;
  }
  const targetUser = getUsers().find(u=>u.id===targetId) || currentUser;
  bookingForUserId = targetUser.id;

  const r = await apiFetch('/api/bookings/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      spaceId,
      dates: selDates,
      slotFrom: from,
      slotTo: to,
      targetUserId: targetId,
    }),
  });
  if (r.status === 401) return requireRelogin();
  const data = await r.json();
  if (!r.ok) {
    const errMsg = data.error || 'Ошибка бронирования';
    const errLower = errMsg.toLowerCase();
    if (errLower.includes('не найдено') || errLower.includes('удалено')) {
      await syncFromServer().catch(() => {});
      renderStats();
      renderMiniBookings();
      if (currentView === 'map') renderMapView();
      return toast('Карта обновлена. Место было изменено или удалено — выберите снова.', 't-amber', '!');
    }
    return toast(errMsg, 't-red', '✕');
  }

  saveBookings(Array.isArray(data.bookings) ? data.bookings : []);
  closeModal();
  // Reset date selection so the next booking starts fresh from today
  selDates = [fmtDate(new Date())];
  calAnchorDate = selDates[0];

  const created = Number(data.created || 0);
  const skippedBusy = Number(data.skippedBusy || 0);
  const skippedDailyLimit = Number(data.skippedDailyLimit || 0);
  const skippedUser = Number(data.skippedUser || 0);
  const skippedPast = Number(data.skippedPast || 0);
  const skippedBusyDates = Array.isArray(data.skippedBusyDates) ? data.skippedBusyDates : [];
  const skippedPastDates = Array.isArray(data.skippedPastDates) ? data.skippedPastDates : [];
  const skippedDailyLimitDates = Array.isArray(data.skippedDailyLimitDates) ? data.skippedDailyLimitDates : [];
  const skippedUserConflictDates = Array.isArray(data.skippedUserConflictDates) ? data.skippedUserConflictDates : [];
  const previewDates = (dates) => {
    if (!dates.length) return '';
    const shown = dates.slice(0, 3).map(fmtHuman).join(', ');
    return dates.length > 3 ? `${shown} и ещё ${dates.length - 3}` : shown;
  };
  const parts = [];
  if (skippedBusy) parts.push(`занято: ${skippedBusy}${skippedBusyDates.length ? ` (${previewDates(skippedBusyDates)})` : ''}`);
  if (skippedDailyLimit) parts.push(`лимит 1 место в день: ${skippedDailyLimit}${skippedDailyLimitDates.length ? ` (${previewDates(skippedDailyLimitDates)})` : ''}`);
  if (skippedUser) parts.push(`конфликт у сотрудника: ${skippedUser}${skippedUserConflictDates.length ? ` (${previewDates(skippedUserConflictDates)})` : ''}`);
  if (skippedPast) parts.push(`время уже прошло: ${skippedPast}${skippedPastDates.length ? ` (${previewDates(skippedPastDates)})` : ''}`);
  const who = isCurrentUserId(targetUser.id) ? '' : ` для ${targetUser.name}`;
  if (created === 0) {
    if (skippedBusyDates.length) {
      return toast(`Стол недоступен: ${previewDates(skippedBusyDates)}. Выберите другое место.`, 't-amber', '!');
    }
    const reason = parts.length ? ` (${parts.join(', ')})` : '';
    return toast(`Бронь не создана${reason}`, 't-amber', '!');
  }
  const msg = parts.length
    ? `Забронировано${who}: ${created} дн., пропущено (${parts.join(', ')})`
    : `Забронировано${who}: ${created} ${created===1?'день':'дней'}`;
  toast(msg, 't-green', '✓');

  // Reset dates to today after successful booking
  selDates = [fmtDate(new Date())];
  calAnchorDate = selDates[0];

  closeModal();
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

async function cancelBooking(id) {
  const bk = getBookings().find(b=>b.id===id);
  if (!bk) return;
  if (!canCancelBooking(bk)) return toast('Недостаточно прав для отмены', 't-red', '✕');

  const r = await apiFetch('/api/bookings/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (r.status === 401) return requireRelogin();
  const data = await r.json();
  if (!r.ok) return toast(data.error || 'Ошибка отмены', 't-red', '✕');

  saveBookings(Array.isArray(data.bookings) ? data.bookings : []);
  selectedMyBookingIds.delete(id);
  toast('Бронирование отменено', '', '✓');
  renderCalendar(); renderStats(); renderMiniBookings();
  if (currentView === 'map') renderMapView();
  if (currentView === 'mybookings') renderMyBookingsView();
  if (currentView === 'team') renderTeamView();
  if (currentView === 'admin') renderAdminView();
  if (currentView === 'cabinet') renderCabinetView();
}

function toggleMyBookingSelection(id, checked) {
  if (checked) selectedMyBookingIds.add(id);
  else selectedMyBookingIds.delete(id);
  if (currentView === 'mybookings') renderMyBookingsView();
}

function toggleMyBookingsSelectAll(checked) {
  const mine = getActiveBookings(getBookings()).filter(b => isMineBooking(b) && canCancelBooking(b));
  const ids = new Set(mine.map(b => b.id));
  if (checked) {
    ids.forEach(id => selectedMyBookingIds.add(id));
  } else {
    ids.forEach(id => selectedMyBookingIds.delete(id));
  }
  if (currentView === 'mybookings') renderMyBookingsView();
}

async function cancelSelectedMyBookings() {
  const ids = [...selectedMyBookingIds];
  if (!ids.length) return toast('Не выбраны бронирования для отмены', 't-amber', '!');
  const n = ids.length;
  const word = pluralRu(n, 'бронирование', 'бронирования', 'бронирований');
  confirmAction(`Отменить ${n} ${word}?`, () => _doCancelSelected(ids));
}

async function _doCancelSelected(ids) {

  let cancelled = 0;
  let failed = 0;
  for (const id of ids) {
    const bk = getBookings().find(b => b.id === id);
    if (!bk || !canCancelBooking(bk)) {
      selectedMyBookingIds.delete(id);
      failed++;
      continue;
    }
    const r = await apiFetch('/api/bookings/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (r.status === 401) return requireRelogin();
    const data = await r.json();
    if (!r.ok) {
      failed++;
      continue;
    }
    if (Array.isArray(data.bookings)) saveBookings(data.bookings);
    selectedMyBookingIds.delete(id);
    cancelled++;
  }

  if (cancelled > 0) {
    toast(
      failed > 0 ? `Отменено: ${cancelled}, ошибок: ${failed}` : `Отменено бронирований: ${cancelled}`,
      failed > 0 ? 't-amber' : 't-green',
      failed > 0 ? '!' : '✓'
    );
  } else {
    toast('Не удалось отменить выбранные бронирования', 't-red', '✕');
  }

  renderCalendar();
  renderStats();
  renderMiniBookings();
  if (currentView === 'map') renderMapView();
  if (currentView === 'mybookings') renderMyBookingsView();
  if (currentView === 'team') renderTeamView();
  if (currentView === 'admin') renderAdminView();
  if (currentView === 'cabinet') renderCabinetView();
}

/* ═══════════════════════════════════════════════════════
   VIEW SWITCHING
═══════════════════════════════════════════════════════ */
function switchView(view, btn) {
  // Access control
  if (view === 'admin' && currentUser?.role === 'manager') view = 'team';
  if ((view === 'admin' || view === 'team') && currentUser?.role === 'user') view = 'map';
  currentView = view;
  try { localStorage.setItem('lastView', view); } catch(e) {}

  document.querySelectorAll('.tnav').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.querySelectorAll(`.tnav[onclick*="'${view}'"]`).forEach(b=>b.classList.add('active'));

  // Mark app with current view so CSS can hide sidebar on non-map views
  document.getElementById('app').dataset.view = view;


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
function setMyBookingsTab(t) { myBookingsTab = t; renderMyBookingsView(); }

function renderMyBookingsView() {
  purgeExpired();
  const el     = document.getElementById('view-mybookings');
  const allMine = getBookings().filter(b=>isMineBooking(b));
  const mine   = getActiveBookings(allMine).sort((a,b)=>a.date.localeCompare(b.date));
  const history = allMine
    .filter(b => b.status === 'cancelled' || !getActiveBookings([b]).length)
    .sort((a,b) => b.date.localeCompare(a.date))
    .slice(0, 50);
  const spaces = getSpaces(); const floors = getFloors();

  const isHistory = myBookingsTab === 'history';
  const shown = isHistory ? history : mine;

  const cancelableIds = new Set(mine.filter(b => canCancelBooking(b)).map(b => b.id));
  selectedMyBookingIds = new Set([...selectedMyBookingIds].filter(id => cancelableIds.has(id)));
  const selectedCount = [...selectedMyBookingIds].filter(id => cancelableIds.has(id)).length;
  const allSelected = cancelableIds.size > 0 && selectedCount === cancelableIds.size;

  const subText = isHistory
    ? `${history.length} ${pluralRu(history.length,'запись','записи','записей')}`
    : `${mine.length} ${pluralRu(mine.length,'активное','активных','активных')}`;

  el.innerHTML = `<div class="view-area">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <div>
        <div class="view-head">Мои бронирования</div>
        <div class="view-sub">${subText}</div>
      </div>
      <div class="floor-tabs" style="margin:0">
        <button class="floor-tab-btn${!isHistory?' active':''}" onclick="setMyBookingsTab('active')">Активные</button>
        <button class="floor-tab-btn${isHistory?' active':''}" onclick="setMyBookingsTab('history')">История</button>
      </div>
    </div>
    ${!shown.length ? `<div class="empty">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
      </svg><p>${isHistory ? 'Нет истории бронирований' : 'Нет активных бронирований'}</p></div>` :
    `<div class="card">
      ${!isHistory ? `<div style="padding:10px 14px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink2);font-weight:600;cursor:pointer">
          <input type="checkbox" ${allSelected ? 'checked' : ''} ${cancelableIds.size ? '' : 'disabled'}
            onchange="toggleMyBookingsSelectAll(this.checked)">
          Выбрать все
        </label>
        <button class="btn btn-danger btn-sm" onclick="cancelSelectedMyBookings()"
          ${selectedCount ? '' : 'disabled'}
          style="${selectedCount ? '' : 'opacity:.45;pointer-events:none'}">
          Отменить выбранные (${selectedCount})
        </button>
      </div>` : ''}
      <div style="padding:0"><table class="data-table">
      <thead><tr>${!isHistory ? '<th style="width:36px"></th>' : ''}<th>Место</th><th>Этаж</th><th>Дата</th><th>Время</th>${!isHistory?'<th>Истекает</th>':'<th>Статус</th>'}<th></th></tr></thead>
      <tbody>${shown.map(b=>{
        const sp = spaces.find(s=>s.id===b.spaceId);
        const fl = floors.find(f=>f.id===sp?.floorId);
        const canCancel = !isHistory && canCancelBooking(b);
        const checked = selectedMyBookingIds.has(b.id) ? 'checked' : '';
        const statusCell = isHistory
          ? (b.status === 'cancelled' ? '<span style="color:var(--red);font-size:12px">Отменено</span>' : '<span style="color:var(--ink4);font-size:12px">Истекло</span>')
          : b.expiresAt;
        return `<tr>
          ${!isHistory ? `<td style="text-align:center">${canCancel ? `<input type="checkbox" ${checked} onchange="toggleMyBookingSelection('${b.id}', this.checked)">` : ''}</td>` : ''}
          <td><strong>${escapeHtml(sp?.label || b.spaceName || '?')}</strong></td>
          <td>${escapeHtml(fl?.name||'?')}</td>
          <td>${fmtHuman(b.date)}</td>
          <td style="font-family:'DM Mono',monospace;font-size:12px">${b.slotFrom}–${b.slotTo}</td>
          <td style="font-size:12px;color:var(--ink3)">${statusCell}</td>
          <td>${canCancel ? `<button class="btn btn-danger btn-sm" onclick="cancelBooking('${b.id}')">Отменить</button>` : '<span style="color:var(--ink4)">—</span>'}</td>
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
  const activeBookings = getActiveBookings(getBookings());
  const myBks = activeBookings.filter(b => sameId(b.userId, me.id))
                              .sort((a, b) => a.date.localeCompare(b.date));
  const isManager = me.role === 'manager' || me.role === 'admin';
  const team = isManager
    ? getUsers().filter(u => u.department === me.department && !sameId(u.id, me.id) && u.role === 'user')
    : [];
  const teamBks = isManager
    ? activeBookings.filter(b => team.some(u => u.id === b.userId))
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
      <div class="card-head">Отдел: ${escapeHtml(me.department)} · ${team.length} ${pluralRu(team.length,'сотрудник','сотрудника','сотрудников')}</div>
      <div style="padding:0"><table class="data-table">
        <thead><tr><th>Сотрудник</th><th>Место</th><th>Дата</th><th>Время</th><th></th></tr></thead>
        <tbody>${!teamBks.length
          ? `<tr><td colspan="5" style="text-align:center;color:var(--ink4);padding:2rem">Нет активных бронирований</td></tr>`
          : teamBks.map(b => {
              const sp = spaces.find(s => s.id === b.spaceId);
              const fl = floors.find(f => f.id === sp?.floorId);
              return `<tr>
                <td><strong>${escapeHtml(b.userName)}</strong></td>
                <td>${escapeHtml(sp?.label || b.spaceName || '?')}</td>
                <td>${fmtHuman(b.date)}</td>
                <td style="font-family:'DM Mono',monospace;font-size:12px">${b.slotFrom}–${b.slotTo}</td>
                <td>${canCancelBooking(b) ? `<button class="btn btn-danger btn-sm" onclick="cancelBooking('${b.id}')">Отменить</button>` : '<span style="color:var(--ink4)">—</span>'}</td>
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
                  <td><strong>${escapeHtml(sp?.label || b.spaceName || '?')}</strong></td>
                  <td>${escapeHtml(fl?.name || '?')}</td>
                  <td>${fmtHuman(b.date)}</td>
                  <td style="font-family:'DM Mono',monospace;font-size:12px">${b.slotFrom}–${b.slotTo}</td>
                  <td>${canCancelBooking(b) ? `<button class="btn btn-danger btn-sm" onclick="cancelBooking('${b.id}')">Отменить</button>` : '<span style="color:var(--ink4)">—</span>'}</td>
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
      <button class="btn btn-danger" onclick="doLogout()">Выйти из аккаунта</button>
    </div>

  </div>`;

  // Enter on last password field
  const cpConfirm = document.getElementById('cp-confirm');
  if (cpConfirm) cpConfirm.addEventListener('keydown', e => { if(e.key==='Enter') doChangePassword(); });
}

/* ═══════════════════════════════════════════════════════
   TEAM VIEW (manager)
═══════════════════════════════════════════════════════ */
function setTeamViewPeriod(v) { teamViewPeriod = v; renderTeamView(); }
function setTeamViewTab(v) { teamViewTab = v; renderTeamView(); }
function setTeamViewSearch(v) { teamViewSearch = String(v||'').trim().toLowerCase(); renderTeamView(); }

function renderTeamView() {
  purgeExpired();
  const el   = document.getElementById('view-team');
  const me   = currentUser;
  const team = getUsers().filter(u=>u.department===me.department && !sameId(u.id, me.id) && u.role==='user');
  const spaces = getSpaces(); const floors = getFloors();
  const allBks = getBookings().filter(b => b.status !== 'cancelled' && team.some(u=>sameId(u.id, b.userId)));
  const today = fmtDate(new Date());

  let bks;
  if (teamViewPeriod === '30') {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = fmtDate(cutoff);
    bks = allBks.filter(b => b.date >= cutoffStr && b.date <= today);
  } else if (teamViewPeriod === 'all') {
    bks = allBks;
  } else {
    bks = getActiveBookings(allBks);
  }
  bks = bks.sort((a,b)=>a.date.localeCompare(b.date));

  // Apply employee search filter
  const filteredBks = teamViewSearch
    ? bks.filter(b => b.userName.toLowerCase().includes(teamViewSearch))
    : bks;

  const staffWord = pluralRu(team.length, 'сотрудник', 'сотрудника', 'сотрудников');
  const bkWord    = pluralRu(filteredBks.length, 'бронирование', 'бронирования', 'бронирований');
  const periodLabels = { active: 'Активные', '30': 'За 30 дней', all: 'Все' };

  el.innerHTML = `<div class="view-area">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <div>
        <div class="view-head">Отдел: ${escapeHtml(me.department)}</div>
        <div class="view-sub">${team.length} ${staffWord}</div>
      </div>
      <div class="floor-tabs" style="margin:0">
        <button class="floor-tab-btn${teamViewTab==='bookings'?' active':''}" onclick="setTeamViewTab('bookings')">Бронирования</button>
        <button class="floor-tab-btn${teamViewTab==='stats'?' active':''}" onclick="setTeamViewTab('stats')">Статистика</button>
      </div>
    </div>
    <div id="team-tab-content"></div>
  </div>`;

  const content = el.querySelector('#team-tab-content');
  if (teamViewTab === 'stats') {
    renderAdminStats(content, me.department || '');
  } else {
    content.innerHTML = `
    <div class="metrics">
      <div class="metric mt-blue"><div class="metric-n" style="color:var(--blue)">${team.length}</div><div class="metric-l">${staffWord.charAt(0).toUpperCase()+staffWord.slice(1)}</div></div>
      <div class="metric mt-green"><div class="metric-n" style="color:var(--green)">${filteredBks.length}</div><div class="metric-l">${bkWord.charAt(0).toUpperCase()+bkWord.slice(1)}</div></div>
    </div>
    <div class="card">
      <div class="card-head" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <span>Бронирования отдела</span>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <input type="text" class="role-sel" placeholder="Поиск по сотруднику..."
            value="${escapeHtml(teamViewSearch)}"
            oninput="setTeamViewSearch(this.value)"
            style="min-width:180px;font-size:13px">
          <div class="floor-tabs" style="margin:0;gap:4px">
            ${['active','30','all'].map(v=>`<button class="floor-tab-btn${teamViewPeriod===v?' active':''}" onclick="setTeamViewPeriod('${v}')">${periodLabels[v]}</button>`).join('')}
          </div>
        </div>
      </div>
      <div style="padding:0"><table class="data-table">
        <thead><tr><th>Сотрудник</th><th>Место</th><th>Дата</th><th>Время</th><th></th></tr></thead>
        <tbody>${!filteredBks.length ? `<tr><td colspan="5" style="text-align:center;color:var(--ink4);padding:2rem">${teamViewSearch ? 'Ничего не найдено' : 'Нет бронирований'}</td></tr>` :
          filteredBks.map(b=>{
            const sp=spaces.find(s=>s.id===b.spaceId);
            return `<tr>
              <td><strong>${escapeHtml(b.userName)}</strong></td>
              <td>${escapeHtml(sp?.label || b.spaceName || '?')}</td>
              <td>${fmtHuman(b.date)}</td>
              <td style="font-family:'DM Mono',monospace;font-size:12px">${b.slotFrom}–${b.slotTo}</td>
              <td>${canCancelBooking(b) ? `<button class="btn btn-danger btn-sm" onclick="cancelBooking('${b.id}')">Отменить</button>` : '<span style="color:var(--ink4)">—</span>'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>
    </div>`;
  }
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
  // Members = users whose LDAP department matches, plus any manually-added memberIds
  const ldapMemberIds = new Set(users.filter(u => u.department === dept.name).map(u => u.id));
  const manualMemberIds = new Set((dept.memberIds || []).filter(id => !ldapMemberIds.has(id)));
  const allMemberIds = new Set([...ldapMemberIds, ...manualMemberIds]);
  const members = [...allMemberIds].map(id => users.find(u => u.id === id)).filter(Boolean);
  const nonMembers = users.filter(u => !allMemberIds.has(u.id));
  const search = getDeptMemberSearch(dept.id);
  const filteredNonMembers = search
    ? nonMembers.filter(u => `${u.name} ${u.email} ${u.department || ''}`.toLowerCase().includes(search))
    : nonMembers;
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
      <label class="dept-label" for="dept-head-${dept.id}">Руководитель</label>
      <select id="dept-head-${dept.id}" class="dept-select" onchange="setDeptHead('${dept.id}',this.value)">
        <option value="">— не назначен —</option>
        ${users.filter(u=>u.role==='manager'||u.role==='admin').map(u=>`<option value="${u.id}"${u.id===dept.headUserId?' selected':''}>${escapeHtml(u.name)}</option>`).join('')}
      </select>
    </div>
    <div class="dept-members">
      <span class="dept-label">Сотрудники (${members.length})</span>
      <div class="dept-member-list">
        ${members.map(u=>`
          <span class="dept-member-chip">
            ${escapeHtml(u.name)}
            ${manualMemberIds.has(u.id) ? `<button onclick="removeMemberFromDept('${dept.id}','${u.id}')" title="Убрать">×</button>` : ''}
          </span>`).join('')}
      </div>
      ${nonMembers.length ? `
        <div class="dept-add-row" style="position:relative">
          <input type="text" id="dept-search-${dept.id}" name="dept-search-${dept.id}"
            aria-label="Поиск сотрудника в отделе ${escapeHtml(dept.name)}"
            class="dept-search" placeholder="Поиск сотрудника..."
            value="${escapeHtml(deptMemberSearch[dept.id] || '')}"
            oninput="setDeptMemberSearch('${dept.id}',this.value)"
            onfocus="showDeptDropdown('${dept.id}')"
            onblur="hideDeptDropdown('${dept.id}')"
            autocomplete="off">
          ${filteredNonMembers.length ? `
          <div id="dept-drop-${dept.id}" class="dept-dropdown" style="display:none">
            ${filteredNonMembers.map(u=>`
              <div class="dept-drop-item" onmousedown="addMemberToDeptById('${dept.id}','${u.id}')">${escapeHtml(u.name)}${u.department?`<span style="font-size:11px;color:var(--ink4);margin-left:4px">${escapeHtml(u.department)}</span>`:''}</div>
            `).join('')}
          </div>` : ''}
        </div>` : ''}
    </div>
  </div>`;
}

function addDepartment() {
  document.getElementById('modal-title').textContent = 'Новый отдел';
  document.getElementById('modal-body').innerHTML = `
    <div class="field">
      <label for="new-dept-name">Название</label>
      <input type="text" id="new-dept-name" name="new-dept-name" placeholder="Например: Финансы" autocomplete="off">
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
      <label for="edit-dept-name">Название</label>
      <input type="text" id="edit-dept-name" name="edit-dept-name" value="${escapeHtml(dept.name)}" autocomplete="off">
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
  if (!dept) return;
  confirmAction(`Удалить отдел «${escapeHtml(dept.name)}»?`, () => {
    saveDepartments(getDepartments().filter(d => d.id !== deptId));
    _refreshDeptTab();
    toast('Отдел удалён', '', '✓');
  });
}

function setDeptHead(deptId, userId) {
  const depts = getDepartments();
  const dept  = depts.find(d => d.id === deptId);
  if (!dept) return;
  dept.headUserId = userId || null;
  saveDepartments(depts);
  toast('Руководитель обновлён', '', '✓');
}

function addMemberToDeptById(deptId, userId) {
  if (!userId) return;
  const depts = getDepartments();
  const dept  = depts.find(d => d.id === deptId);
  if (!dept) return;
  if (!dept.memberIds) dept.memberIds = [];
  if (!dept.memberIds.includes(userId)) dept.memberIds.push(userId);
  deptMemberSearch[deptId] = '';
  saveDepartments(depts);
  _refreshDeptTab();
}

function showDeptDropdown(deptId) {
  const el = document.getElementById('dept-drop-' + deptId);
  if (el) el.style.display = 'block';
}
function hideDeptDropdown(deptId) {
  // small delay so onmousedown fires before blur
  setTimeout(() => {
    const el = document.getElementById('dept-drop-' + deptId);
    if (el) el.style.display = 'none';
  }, 150);
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
    const r = await apiFetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: currentUser.email, oldPassword: oldPwd, newPassword: newPwd })
    });
    if (r.status === 401) {
      requireRelogin();
      return;
    }
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
  authErr('Восстановление пароля по email отключено. Обратитесь к администратору.');
}

/* ═══════════════════════════════════════════════════════
   ADMIN STATS
═══════════════════════════════════════════════════════ */
function setAdminStatsPeriod(v) { adminStatsPeriod = Number(v); renderAdminTabContent('stats'); }
function setAdminStatsDept(v)   { adminStatsDept = v; renderAdminTabContent('stats'); }

function renderAdminStats(el, forceDept = null) {
  const allUsers    = getUsers();
  const allBookings = getBookings().filter(b => b.status !== 'cancelled');
  const depts       = getDepartments();
  const isManager   = currentUser?.role === 'manager';
  const lockDept    = forceDept !== null;

  // Dept filter
  const deptName = lockDept ? forceDept : (isManager ? (currentUser.department || '') : adminStatsDept);
  const deptUsers = deptName
    ? allUsers.filter(u => u.department === deptName)
    : allUsers;
  const deptUserIds = new Set(deptUsers.map(u => u.id));

  // Period filter
  const periodDays = adminStatsPeriod || 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - periodDays);
  const cutoffStr = fmtDate(cutoff);
  const todayStr  = fmtDate(new Date());

  const bks = allBookings.filter(b =>
    b.date >= cutoffStr && b.date <= todayStr && deptUserIds.has(b.userId)
  );

  // Unique attendees
  const attendeeIds = new Set(bks.map(b => b.userId));
  const totalStaff  = deptUsers.length;
  const attendees   = attendeeIds.size;

  // By weekday (0=Mon..4=Fri)
  const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const byDay = [0,0,0,0,0,0,0];
  bks.forEach(b => {
    const d = new Date(b.date + 'T12:00:00');
    byDay[d.getDay() === 0 ? 6 : d.getDay() - 1]++;
  });
  const maxDay = Math.max(...byDay, 1);

  // By space
  const spaceCount = {};
  bks.forEach(b => {
    const k = b.spaceName || b.spaceId || '?';
    spaceCount[k] = (spaceCount[k] || 0) + 1;
  });
  const topSpaces = Object.entries(spaceCount)
    .sort((a,b) => b[1]-a[1]).slice(0, 5);

  // Per employee
  const empCount = {};
  bks.forEach(b => { empCount[b.userId] = (empCount[b.userId] || 0) + 1; });
  const empRows = deptUsers.map(u => ({
    name: u.name, dept: u.department || '',
    count: empCount[u.id] || 0,
    lastDate: bks.filter(b=>b.userId===u.id).map(b=>b.date).sort().at(-1) || '—'
  })).sort((a,b) => b.count - a.count);

  // Daily activity (last periodDays)
  const dailyCounts = {};
  bks.forEach(b => { dailyCounts[b.date] = (dailyCounts[b.date] || 0) + 1; });
  const topDate = Object.entries(dailyCounts).sort((a,b)=>b[1]-a[1])[0];

  const deptSelector = (!isManager && !lockDept) ? `
    <select class="role-sel" onchange="setAdminStatsDept(this.value)" style="min-width:180px">
      <option value="" ${!adminStatsDept?'selected':''}>Все отделы</option>
      ${[...new Set(allUsers.map(u=>u.department).filter(Boolean))].sort()
        .map(d=>`<option value="${escapeHtml(d)}" ${adminStatsDept===d?'selected':''}>${escapeHtml(d)}</option>`).join('')}
    </select>` : `<strong>${escapeHtml(deptName || 'Все отделы')}</strong>`;

  el.innerHTML = `
  <div style="padding:1rem 0">
    <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;margin-bottom:1.25rem">
      ${deptSelector}
      <select class="role-sel" onchange="setAdminStatsPeriod(this.value)" style="min-width:160px">
        <option value="30" ${adminStatsPeriod===30?'selected':''}>За 30 дней</option>
        <option value="90" ${adminStatsPeriod===90?'selected':''}>За 90 дней</option>
        <option value="180" ${adminStatsPeriod===180?'selected':''}>За 180 дней</option>
      </select>
    </div>

    <div class="metrics" style="margin-bottom:1.5rem">
      <div class="metric mt-blue"><div class="metric-n" style="color:var(--blue)">${attendees}<span style="font-size:14px;font-weight:500;color:var(--ink3)">/${totalStaff}</span></div><div class="metric-l">Посетили за период</div></div>
      <div class="metric mt-green"><div class="metric-n" style="color:var(--green)">${bks.length}</div><div class="metric-l">Бронирований</div></div>
      <div class="metric mt-purple"><div class="metric-n" style="color:var(--purple)">${totalStaff > 0 ? Math.round(attendees/totalStaff*100) : 0}%</div><div class="metric-l">Посещаемость</div></div>
    </div>

    <div style="margin-bottom:1rem">
      <div class="card" style="padding:1.25rem">
        <div class="card-head" style="padding:0 0 1rem">По дням недели</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${byDay.map((cnt, i) => `
            <div style="display:flex;align-items:center;gap:8px">
              <span style="width:22px;font-size:12px;font-weight:600;color:var(--ink3)">${dayNames[i]}</span>
              <div style="flex:1;height:18px;background:var(--bg2);border-radius:4px;overflow:hidden">
                <div style="height:100%;width:${Math.round(cnt/maxDay*100)}%;background:var(--blue);border-radius:4px;transition:width .3s"></div>
              </div>
              <span style="width:28px;text-align:right;font-size:12px;color:var(--ink3)">${cnt}</span>
            </div>`).join('')}
        </div>
      </div>
    </div>

    <div class="card" style="padding:0">
      <div class="card-head">Посещаемость сотрудников</div>
      <div style="padding:0"><table class="data-table">
        <thead><tr><th>Сотрудник</th>${!deptName?'<th>Отдел</th>':''}<th>Визитов</th><th>Последний визит</th></tr></thead>
        <tbody>${empRows.map(r => `<tr>
          <td><strong>${escapeHtml(r.name)}</strong></td>
          ${!deptName?`<td style="color:var(--ink3)">${escapeHtml(r.dept)}</td>`:''}
          <td><span class="badge ${r.count > 0 ? 'badge-blue' : ''}" style="${r.count===0?'color:var(--ink4)':''}">${r.count}</span></td>
          <td style="font-size:12px;color:var(--ink3)">${r.lastDate !== '—' ? fmtHuman(r.lastDate) : '—'}</td>
        </tr>`).join('')}
        </tbody>
      </table></div>
    </div>
  </div>`;
}

/* ═══════════════════════════════════════════════════════
   ADMIN VIEW
═══════════════════════════════════════════════════════ */
function renderAdminView(activeTab = adminActiveTab) {
  const isManager = currentUser?.role === 'manager';
  const allowedTabs = new Set(['users', 'floors', 'bookings', 'departments', 'stats']);
  if (isManager) allowedTabs.delete('users'); // managers don't see all users
  adminActiveTab = allowedTabs.has(activeTab) ? activeTab : (isManager ? 'stats' : 'floors');
  const el = document.getElementById('view-admin');
  el.innerHTML = `<div class="view-area">
    <div><div class="view-head">Администрирование</div></div>
    <div class="floor-tabs" id="admin-tabs">
      ${!isManager ? `<button class="floor-tab-btn ${adminActiveTab==='users'?'active':''}" data-admin-tab="users" onclick="adminTab('users',this)">Пользователи</button>` : ''}
      ${!isManager ? `<button class="floor-tab-btn ${adminActiveTab==='floors'?'active':''}" data-admin-tab="floors" onclick="adminTab('floors',this)">Коворкинги и планировки</button>` : ''}
      ${!isManager ? `<button class="floor-tab-btn ${adminActiveTab==='bookings'?'active':''}" data-admin-tab="bookings" onclick="adminTab('bookings',this)">Все брони</button>` : ''}
      ${!isManager ? `<button class="floor-tab-btn ${adminActiveTab==='departments'?'active':''}" data-admin-tab="departments" onclick="adminTab('departments',this)">Департаменты</button>` : ''}
      <button class="floor-tab-btn ${adminActiveTab==='stats'?'active':''}" data-admin-tab="stats" onclick="adminTab('stats',this)">Статистика отдела</button>
    </div>
    <div id="admin-tab-content"></div>
  </div>`;
  renderAdminTabContent(adminActiveTab);
}

function renderAdminTabContent(tab) {
  const el = document.getElementById('admin-tab-content');
  if (!el) return;
  if (tab === 'users')       { renderAdminUsers(el); return; }
  if (tab === 'floors')      { renderAdminFloors(el); return; }
  if (tab === 'bookings')    { renderAdminBookings(el); return; }
  if (tab === 'departments') { renderAdminDepartments(el); return; }
  if (tab === 'stats')       { renderAdminStats(el); return; }
}

function adminTab(tab, btn) {
  adminActiveTab = tab;
  try { localStorage.setItem('adminActiveTab', tab); } catch(e) {}
  document.querySelectorAll('#admin-tabs .floor-tab-btn').forEach(b=>b.classList.remove('active'));
  const activeBtn = btn || document.querySelector(`#admin-tabs [data-admin-tab="${tab}"]`);
  if (activeBtn) activeBtn.classList.add('active');
  renderAdminTabContent(tab);
}

function setAdminUserSearch(value) {
  adminUserSearch = String(value || '').trim();
  if (currentView === 'admin') renderAdminView('users');
}

function setAdminUserSort(value) {
  const next = String(value || '').trim();
  adminUserSort = next || 'lastLogin';
  if (currentView === 'admin') renderAdminView('users');
}

function setBookingUserSearch(value) {
  bookingUserSearch = String(value || '').trim().toLowerCase();
  renderBookingTargetOptions();
}

function renderBookingTargetOptions() {
  const sel = document.getElementById('book-for-user');
  if (!sel) return;
  const targets = getAllowedBookingTargets();
  const filtered = bookingUserSearch
    ? targets.filter(u => `${u.name} ${u.email} ${u.department || ''}`.toLowerCase().includes(bookingUserSearch))
    : targets;
  const currentId = bookingForUserId || currentUser?.id || '';
  if (!filtered.length) {
    sel.innerHTML = `<option value="">Ничего не найдено</option>`;
    return;
  }
  const selectedId = filtered.some(u => sameId(u.id, currentId)) ? currentId : filtered[0].id;
  bookingForUserId = selectedId;
  sel.innerHTML = filtered.map(u => `<option value="${u.id}" ${sameId(u.id, selectedId)?'selected':''}>
    ${escapeHtml(u.name)}${isCurrentUserId(u.id)?' (я)':''}</option>`).join('');
}

function setDeptMemberSearch(deptId, value) {
  deptMemberSearch[deptId] = String(value || '');
  const q = value.trim().toLowerCase();
  const drop = document.getElementById('dept-drop-' + deptId);
  if (!drop) return;
  drop.querySelectorAll('.dept-drop-item').forEach(item => {
    item.style.display = !q || item.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

function getDeptMemberSearch(deptId) {
  return String(deptMemberSearch[deptId] || '').trim().toLowerCase();
}

/* ── Admin: Users ─────────────────────────────────────────────────────────── */
function renderAdminUsers(el) {
  const users = getUsers();
  const bks   = getActiveBookings(getBookings());
  const roles = { user:'Сотрудник', manager:'Руководитель', admin:'Администратор' };
  const search = adminUserSearch.trim().toLowerCase();
  const filtered = search
    ? users.filter(u => `${u.name} ${u.email} ${u.department || ''}`.toLowerCase().includes(search))
    : users;
  const toLoginTs = (v) => {
    if (!v) return 0;
    const s = String(v);
    const iso = s.includes('T') ? s : `${s.replace(' ', 'T')}Z`;
    const ts = Date.parse(iso);
    return Number.isFinite(ts) ? ts : 0;
  };
  const bkCountById = {};
  bks.forEach(b => { bkCountById[b.userId] = (bkCountById[b.userId] || 0) + 1; });
  const sorted = filtered.slice().sort((a, b) => {
    if (adminUserSort === 'name') {
      return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
    }
    if (adminUserSort === 'department') {
      const ad = String(a.department || '');
      const bd = String(b.department || '');
      const depCmp = ad.localeCompare(bd, 'ru');
      if (depCmp !== 0) return depCmp;
      return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
    }
    if (adminUserSort === 'bookings') {
      return (bkCountById[b.id] || 0) - (bkCountById[a.id] || 0);
    }
    const at = toLoginTs(a.lastLogin || a.last_login);
    const bt = toLoginTs(b.lastLogin || b.last_login);
    if (at !== bt) return bt - at;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
  });

  el.innerHTML = `<div style="margin-bottom:1rem;display:flex;justify-content:space-between;gap:.75rem;align-items:center;flex-wrap:wrap">
    <div style="display:flex;gap:.5rem;align-items:center">
      <input type="text" class="role-sel" placeholder="Поиск сотрудника..." value="${escapeHtml(adminUserSearch)}"
        oninput="setAdminUserSearch(this.value)" style="min-width:220px">
      <span style="font-size:12px;color:var(--ink4)">Найдено: ${filtered.length}</span>
    </div>
    <button class="btn btn-primary" onclick="showAddUserModal()">+ Добавить аккаунт</button>
  </div>
  <div class="metrics" style="margin-bottom:1.25rem">
    <div class="metric mt-blue"><div class="metric-n" style="color:var(--blue)">${users.length}</div><div class="metric-l">Пользователей</div></div>
    <div class="metric mt-amber"><div class="metric-n" style="color:var(--amber)">${users.filter(u=>u.role==='manager').length}</div><div class="metric-l">Руководителей</div></div>
    <div class="metric mt-purple"><div class="metric-n" style="color:var(--purple)">${users.filter(u=>u.role==='admin').length}</div><div class="metric-l">Администраторов</div></div>
    <div class="metric mt-green"><div class="metric-n" style="color:var(--green)">${bks.length}</div><div class="metric-l">Активных бронирований</div></div>
  </div>
  <div class="card"><div class="card-head">Пользователи</div>
  <div style="padding:0"><table class="data-table">
    <thead><tr>
      <th><button class="sort-col-btn ${adminUserSort==='name'?'active':''}" onclick="setAdminUserSort('name')">ФИО ${adminUserSort==='name'?'↑':''}</button></th>
      <th><button class="sort-col-btn" onclick="setAdminUserSort('name')">Email</button></th>
      <th><button class="sort-col-btn ${adminUserSort==='department'?'active':''}" onclick="setAdminUserSort('department')">Отдел ${adminUserSort==='department'?'↑':''}</button></th>
      <th><button class="sort-col-btn ${adminUserSort==='bookings'?'active':''}" onclick="setAdminUserSort('bookings')">Брони ${adminUserSort==='bookings'?'↑':''}</button></th>
      <th>Роль</th><th>Статус</th><th></th>
    </tr></thead>
    <tbody>${sorted.map(u => {
      const cnt = bks.filter(b=>sameId(b.userId, u.id)).length;
      const isSelf = isCurrentUserId(u.id);
      return `<tr>
        <td><strong>${escapeHtml(u.name)}</strong></td>
        <td style="color:var(--ink3)">${escapeHtml(u.email)}</td>
        <td><input type="text" class="role-sel" value="${escapeHtml(u.department||'')}"
          onblur="updateUserDept('${u.id}',this.value)" placeholder="Отдел" style="min-width:100px"></td>
        <td><span class="badge badge-blue">${cnt}</span></td>
        <td>${isSelf
          ? `<span class="badge badge-amber">Вы</span>`
          : `<select class="role-sel" onchange="setUserRole('${u.id}',this.value)">
              ${['user','manager','admin'].map(r=>`<option value="${r}" ${u.role===r?'selected':''}>${roles[r]}</option>`).join('')}
             </select>`}</td>
        <td>
          ${u.blocked
            ? `<span class="badge badge-red">Заблокирован</span>`
            : `<span class="badge badge-green">Активен</span>`}
        </td>
        <td style="white-space:nowrap">
          <button class="btn btn-ghost btn-xs" data-uid="${u.id}" onclick="showEditUserModal(this.dataset.uid)">✏️ Редактировать</button>
          ${isSelf ? '' : `<button class="btn ${u.blocked ? 'btn-ghost' : 'btn-danger'} btn-xs" data-uid="${u.id}" onclick="toggleUserBlock(this.dataset.uid, ${u.blocked ? 0 : 1})">
            ${u.blocked ? 'Разблокировать' : 'Заблокировать'}</button>`}
          ${isSelf ? '' : `<button class="btn btn-danger btn-xs" data-uid="${u.id}" data-name="${escapeHtml(u.name)}" onclick="deleteUser(this.dataset.uid, this.dataset.name)">Удалить</button>`}
        </td>
      </tr>`;
    }).join('')}
    </tbody></table></div></div>`;
}

function showEditUserModal(uid) {
  const users = getUsers();
  const u = users.find(u=>u.id===uid);
  if (!u) return;
  
  document.getElementById('modal-title').textContent = `Редактировать: ${escapeHtml(u.name)}`;
  document.getElementById('modal-body').innerHTML = `
    <div class="field"><label>ФИО</label>
      <input type="text" id="edit-user-name" value="${escapeHtml(u.name)}" maxlength="100">
    </div>
    <div class="field"><label>Email</label>
      <input type="email" id="edit-user-email" value="${escapeHtml(u.email)}" maxlength="100">
    </div>
    <div class="field"><label>Отдел</label>
      <input type="text" id="edit-user-dept" value="${escapeHtml(u.department||'')}" maxlength="100">
    </div>`;
  document.getElementById('modal-foot').innerHTML = `
    <button class="btn btn-ghost" id="edit-cancel-btn">Отмена</button>
    <button class="btn btn-primary" id="edit-save-btn">Сохранить</button>`;
  
  document.getElementById('edit-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('edit-save-btn').addEventListener('click', async () => {
    const name = document.getElementById('edit-user-name').value.trim();
    const email = document.getElementById('edit-user-email').value.trim().toLowerCase();
    const dept = document.getElementById('edit-user-dept').value.trim();
    
    if (!name || !email) { toast('Заполните обязательные поля', 't-red', '✕'); return; }
    
    const emailExists = users.find(x => x.id !== u.id && x.email === email);
    if (emailExists) { toast('Email уже используется', 't-red', '✕'); return; }

    try {
      const r = await apiFetch('/api/users/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: u.id, name, email, department: dept }),
      });
      if (r.status === 401) return requireRelogin();
      const data = await r.json();
      if (!r.ok) {
        toast(data.error || 'Не удалось обновить пользователя', 't-red', '✕');
        return;
      }
      if (Array.isArray(data.users)) saveUsers(data.users);
      closeModal();
      if (currentView === 'admin') renderAdminView();
      toast(`Пользователь обновлён: ${name}`, 't-green', '✓');
    } catch {
      toast('Нет соединения с сервером', 't-red', '✕');
    }
  });
  
  document.getElementById('modal-overlay').classList.add('open');
}

async function updateUserDept(uid, dept) {
  const users = getUsers();
  const u = users.find(u=>u.id===uid);
  if (!u) return;
  const nextDept = dept.trim();
  if (!nextDept) {
    toast('Укажите отдел', 't-red', '✕');
    if (currentView === 'admin') renderAdminView();
    return;
  }
  if (nextDept === String(u.department || '').trim()) return;

  try {
    const r = await apiFetch('/api/users/department', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: uid, department: nextDept }),
    });
    if (r.status === 401) return requireRelogin();
    const data = await r.json();
    if (!r.ok) {
      toast(data.error || 'Не удалось обновить отдел', 't-red', '✕');
      if (currentView === 'admin') renderAdminView();
      return;
    }
    if (Array.isArray(data.users)) saveUsers(data.users);
    if (currentView === 'admin') renderAdminView();
    toast(`Отдел обновлён: ${u.name}`, 't-green', '✓');
  } catch {
    toast('Нет соединения с сервером', 't-red', '✕');
    if (currentView === 'admin') renderAdminView();
  }
}

function showPasswordModal(uid) {
  const users = getUsers();
  const u = users.find(u=>u.id===uid);
  if (!u) return;
  
  document.getElementById('modal-title').textContent = `Пароль: ${escapeHtml(u.name)}`;
  if (u.isLdap) {
    document.getElementById('modal-body').innerHTML = `
      <div style="padding:.85rem;background:var(--amber-l);border:1px solid rgba(217,119,6,.25);border-radius:var(--radius);font-size:13px;color:var(--amber)">
        Для доменного аккаунта пароль меняется в Active Directory.
      </div>`;
    document.getElementById('modal-foot').innerHTML = `
      <button class="btn btn-primary" id="pwd-close-btn">Закрыть</button>`;
    document.getElementById('pwd-close-btn').addEventListener('click', closeModal);
    document.getElementById('modal-overlay').classList.add('open');
    return;
  }

  document.getElementById('modal-body').innerHTML = `
    <div class="field"><label>Новый пароль</label>
      <input type="password" id="new-password-input" placeholder="Минимум 6 символов" maxlength="50">
    </div>
    <div style="font-size:12px;color:var(--ink4)">Текущий пароль не отображается. Будет выполнен безопасный сброс.</div>`;
  document.getElementById('modal-foot').innerHTML = `
    <button class="btn btn-ghost" id="pwd-cancel-btn">Отмена</button>
    <button class="btn btn-primary" id="pwd-save-btn">Сохранить</button>`;
  
  document.getElementById('pwd-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('pwd-save-btn').addEventListener('click', async () => {
    const newPwd = document.getElementById('new-password-input').value.trim();
    if (!newPwd) { closeModal(); return; }
    if (newPwd.length < 6) { toast('Минимум 6 символов', 't-red', '✕'); return; }

    try {
      const r = await apiFetch('/api/users/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: uid, newPassword: newPwd }),
      });
      if (r.status === 401) return requireRelogin();
      const data = await r.json();
      if (!r.ok) {
        toast(data.error || 'Не удалось обновить пароль', 't-red', '✕');
        return;
      }
      if (Array.isArray(data.users)) saveUsers(data.users);
      closeModal();
      if (currentView === 'admin') renderAdminView();
      toast(`Пароль обновлён для ${u.name}`, 't-green', '✓');
    } catch {
      toast('Нет соединения с сервером', 't-red', '✕');
    }
  });
  
  document.getElementById('modal-overlay').classList.add('open');
}

function showAddUserModal() {
  document.getElementById('modal-title').textContent = 'Новый аккаунт';
  document.getElementById('modal-body').innerHTML = `
    <div class="field"><label>ФИО</label><input type="text" id="au-name" placeholder="Иванов Иван Иванович"></div>
    <div class="field"><label>Отдел</label><input type="text" id="au-dept" placeholder="Отдел"></div>
    <div class="field"><label>Email</label><input type="email" id="au-email" placeholder="name@company.ru"></div>
    <div class="field"><label>Пароль (мин. 6)</label><input type="password" id="au-pass" placeholder="••••••••"></div>
    <div class="field"><label>Роль</label>
      <select id="au-role" class="role-sel">
        <option value="user">Сотрудник</option>
        <option value="manager">Руководитель</option>
        <option value="admin">Администратор</option>
      </select>
    </div>
    <div id="au-err" style="display:none;color:var(--red);font-size:13px"></div>`;
  document.getElementById('modal-foot').innerHTML = `
    <button class="btn btn-ghost" onclick="closeModal()">Отмена</button>
    <button class="btn btn-primary" onclick="createAdminUser()">Создать</button>`;
  document.getElementById('modal-overlay').classList.add('open');
}

async function createAdminUser() {
  const name = document.getElementById('au-name')?.value.trim() || '';
  const department = document.getElementById('au-dept')?.value.trim() || '';
  const email = (document.getElementById('au-email')?.value || '').trim().toLowerCase();
  const password = document.getElementById('au-pass')?.value || '';
  const role = document.getElementById('au-role')?.value || 'user';
  const err = document.getElementById('au-err');
  const showErr = (msg) => { if (err) { err.textContent = msg; err.style.display = 'block'; } };
  if (!name || !department || !email || !password) return showErr('Заполните все поля');
  if (password.length < 6) return showErr('Пароль минимум 6 символов');

  const r = await apiFetch('/api/users/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, department, email, password, role }),
  });
  if (r.status === 401) return requireRelogin();
  const data = await r.json();
  if (!r.ok) return showErr(data.error || 'Не удалось создать аккаунт');
  if (Array.isArray(data.users)) saveUsers(data.users);
  closeModal();
  toast('Аккаунт создан', 't-green', '✓');
  if (currentView === 'admin') renderAdminView();
}

async function setUserRole(uid, role) {
  if (!['user', 'manager', 'admin'].includes(role)) return;
  const r = await apiFetch('/api/users/role', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: uid, role }),
  });
  if (r.status === 401) return requireRelogin();
  const data = await r.json();
  if (!r.ok) {
    toast(data.error || 'Не удалось обновить роль', 't-red', '✕');
    if (currentView === 'admin') renderAdminView();
    return;
  }
  if (Array.isArray(data.users)) saveUsers(data.users);
  toast('Роль обновлена', 't-green', '✓');
  if (currentView === 'admin') renderAdminView();
}

async function toggleUserBlock(uid, nextBlocked) {
  const user = getUsers().find(u => u.id === uid);
  if (!user) return;
  if (isCurrentUserId(user.id)) {
    toast('Нельзя заблокировать себя', 't-red', '✕');
    return;
  }
  const action = Number(nextBlocked) === 1 ? 'Заблокировать' : 'Разблокировать';
  if (!confirm(`${action} ${user.name}?`)) return;

  const r = await apiFetch('/api/users/block', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: uid, blocked: Number(nextBlocked) === 1 }),
  });
  if (r.status === 401) return requireRelogin();
  const data = await r.json();
  if (!r.ok) {
    toast(data.error || 'Не удалось обновить статус', 't-red', '✕');
    if (currentView === 'admin') renderAdminView('users');
    return;
  }
  if (Array.isArray(data.users)) saveUsers(data.users);
  toast(Number(nextBlocked) === 1 ? 'Пользователь заблокирован' : 'Пользователь разблокирован', 't-green', '✓');
  if (currentView === 'admin') renderAdminView('users');
}

async function deleteUser(uid, name) {
  if (!confirm(`Удалить ${escapeHtml(name)}? Все брони будут удалены.`)) return;
  const r = await apiFetch('/api/users/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: uid }),
  });
  if (r.status === 401) return requireRelogin();
  const data = await r.json();
  if (!r.ok) return toast(data.error || 'Не удалось удалить пользователя', 't-red', '✕');
  if (Array.isArray(data.users)) saveUsers(data.users);
  if (Array.isArray(data.bookings)) saveBookings(data.bookings);
  toast(`${escapeHtml(name)} удалён`, '', '✓');
  renderAdminView();
}

/* ── Admin: All bookings ──────────────────────────────────────────────────── */
function renderAdminBookings(el) {
  purgeExpired();
  const bksAll = getBookings().sort((a,b)=>a.date.localeCompare(b.date));
  const bks    = getActiveBookings(bksAll);
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
              <td><strong>${escapeHtml(sp?.label || b.spaceName || '?')}</strong><br><span style="font-size:11px;color:var(--ink3)">${escapeHtml(fl?.name||'?')}</span></td>
              <td>${escapeHtml(b.userName)}</td>
              <td style="font-size:12px;color:var(--ink3)">${isMineBooking(b)?'<span class="badge badge-blue">Вы</span>':escapeHtml(getUsers().find(u=>u.id===b.userId)?.department||'—')}</td>
              <td>${fmtHuman(b.date)}</td>
              <td style="font-family:'DM Mono',monospace;font-size:12px">${b.slotFrom}–${b.slotTo}</td>
              <td style="font-size:11px;color:var(--ink3)">${b.expiresAt}</td>
              <td>${canCancelBooking(b) ? `<button class="btn btn-danger btn-xs" onclick="adminCancelBk('${b.id}')">Отменить</button>` : '<span style="color:var(--ink4)">—</span>'}</td>
            </tr>`;
          }).join('')}
        </tbody></table></div>
    </div>`;
}

async function adminCancelBk(id) {
  await cancelBooking(id);
  if (currentView === 'admin') renderAdminView();
}

function exportCSV() {
  const bks = getBookings(); const spaces = getSpaces(); const floors = getFloors();
  const rows = [['Место','Этаж','Сотрудник','Дата','Слот от','Слот до','Истекает']];
  bks.forEach(b => {
    const sp=spaces.find(s=>s.id===b.spaceId); const fl=floors.find(f=>f.id===sp?.floorId);
    rows.push([escapeCSV(sp?.label || b.spaceName || '?'), escapeCSV(fl?.name||'?'), escapeCSV(b.userName), escapeCSV(b.date), escapeCSV(b.slotFrom), escapeCSV(b.slotTo), escapeCSV(b.expiresAt)]);
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
  confirmAction(`Вы уверены, что хотите удалить коворкинг «${escapeHtml(cw.name)}» со всеми этажами и бронированиями?`, async () => {
    const floorIds = getFloors().filter(f=>f.coworkingId===id).map(f=>f.id);
    const spaceIds = getSpaces().filter(s=>floorIds.includes(s.floorId)).map(s=>s.id);

    saveCoworkings(coworkings.filter(c=>c.id!==id));
    saveFloors(getFloors().filter(f=>f.coworkingId!==id));
    saveSpaces(getSpaces().filter(s=>!floorIds.includes(s.floorId)));
    const ok = await replaceBookingsAsAdmin(getBookings().filter(b=>!spaceIds.includes(b.spaceId)));
    if (!ok) return;

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
  });
}

function selectEditorFloor(id, btn) {
  editorFloorId = id;
  editorZoom = 1.0;
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

function changeEditorZoom(delta) {
  editorZoom = Math.min(2.0, Math.max(0.25, Math.round((editorZoom + delta) * 100) / 100));
  localStorage.setItem('editorZoom', editorZoom);
  renderEditorForFloor();
}
function resetEditorZoom() {
  editorZoom = 1.0;
  localStorage.setItem('editorZoom', editorZoom);
  renderEditorForFloor();
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
          <button class="btn btn-ghost btn-sm" onclick="resetEditorZoom()" title="Сбросить масштаб" style="font-size:11px">↺</button>
          <button class="btn btn-ghost btn-sm" onclick="changeEditorZoom(-0.25)" title="Уменьшить" style="font-size:16px;padding:2px 8px;line-height:1">−</button>
          <span style="font-size:12px;color:var(--ink3);min-width:36px;text-align:center">${Math.round(editorZoom*100)}%</span>
          <button class="btn btn-ghost btn-sm" onclick="changeEditorZoom(0.25)" title="Увеличить" style="font-size:16px;padding:2px 8px;line-height:1">+</button>
          <div style="width:1px;height:18px;background:var(--line)"></div>
          <label class="btn btn-ghost btn-sm" style="cursor:pointer">
            📎 Загрузить план (JPG/PNG/PDF)
            <input type="file" accept=".jpg,.jpeg,.png,.pdf,.webp" style="display:none" onchange="uploadFloorImage(event,'${floor.id}')">
          </label>
          ${floor.imageUrl ? `<button class="btn btn-danger btn-sm" onclick="removeFloorImage('${floor.id}')">✕ Удалить план</button>` : ''}
          <span style="font-size:11px;color:var(--ink4)">Рисуй поверх — создаёт зону</span>
        </div>
      </div>
      <div style="overflow:auto;flex:1">
      <div class="editor-canvas-body" id="editor-canvas"
        style="transform:scale(${editorZoom});transform-origin:top left;${editorZoom !== 1 ? `width:${Math.round(100/editorZoom)}%;` : ''}"
        onmousedown="editorMouseDown(event)"
        onmousemove="editorMouseMove(event)"
        onmouseup="editorMouseUp(event)">
        ${floor.imageUrl
          ? `<img src="${floor.imageUrl}" id="floor-img" style="width:100%;height:auto;display:block;pointer-events:none" onload="renderEditorZones()">`
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
    </div>

    <!-- PANEL -->
    <div class="editor-panel" id="editor-panel">
      <div class="panel-card">
        <div class="panel-title">Новая зона</div>
        <div class="panel-field">
          <label>Название</label>
          <input type="text" id="ez-label" placeholder="Кабинет 401" value="${escapeHtml(editorNewZone.label)}"
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
              <button class="btn btn-ghost btn-xs" onclick="renameEditorZone('${sp.id}')" title="Переименовать">✏️</button>
              <button class="btn btn-ghost btn-xs" onclick="duplicateEditorZone('${sp.id}')" title="Копировать">⧉</button>
              <button class="btn btn-danger btn-xs" onclick="deleteEditorZone('${sp.id}')" title="Удалить">✕</button>
            </div>`).join('') :
            `<div style="font-size:12px;color:var(--ink4);text-align:center;padding:.75rem">Нет зон</div>`}
        </div>
      </div>

      <div class="panel-card">
        <div class="panel-title">Настройки этажа</div>
        <div class="panel-field">
          <label>Название</label>
          <input type="text" id="floor-name-inp" value="${escapeHtml(floor.name)}"
            onblur="renameFloor('${floor.id}',this.value)">
        </div>
        <button class="btn btn-danger btn-sm" onclick="deleteFloor('${floor.id}')">Удалить этаж</button>
      </div>

      <div class="panel-card">
        <div class="panel-title">Настройки коворкинга</div>
        <div class="panel-field">
          <label>Название</label>
          <input type="text" id="coworking-name-inp" value="${escapeHtml(getCoworkings().find(c=>c.id===floor.coworkingId)?.name || '')}"
            onblur="renameCoworking('${floor.coworkingId}',this.value)">
        </div>
        <button class="btn btn-danger btn-sm" onclick="deleteCoworking('${floor.coworkingId}')">Удалить коворкинг</button>
      </div>
    </div>`;

  renderEditorZones();
  updateEditorZonesList();
}

function renderEditorZones() {
  const canvas  = document.getElementById('editor-canvas');
  const zonesEl = document.getElementById('editor-zones');
  if (!zonesEl || !canvas) return;
  const CW = canvas.offsetWidth || 800;
  const CH = document.getElementById('floor-img')?.offsetHeight || canvas.offsetHeight || 480;

  zonesEl.innerHTML = editorSpaces.map(sp => {
    const x = sp.x/100*CW, y = sp.y/100*CH, w = sp.w/100*CW, h = sp.h/100*CH;
    return `<div class="zone-rect${sp.id === editorSelectedZoneId ? ' selected' : ''}" data-id="${sp.id}" onmousedown="editorZoneMouseDown(event,'${sp.id}')"
      style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:${safeCssColor(sp.color)}">
      <div class="zone-label">${escapeHtml(sp.label)}<br><span style="font-size:9px;opacity:.8">${sp.seats} мест</span></div>
      <button class="zone-del" onclick="deleteEditorZone('${sp.id}')">✕</button>
    </div>`;
  }).join('');
}

/* ── Drawing ──────────────────────────────────────────────────────────────── */
let _drawRect = null;
function editorMouseDown(e) {
  if (editorDrag) return;
  if (e.target.classList.contains('zone-del')) return;
  if (e.target.classList.contains('zone-rect') || e.target.closest?.('.zone-rect')) return;
  clearEditorSelection();
  const canvas = document.getElementById('editor-canvas');
  const rect   = canvas.getBoundingClientRect();
  editorDrawing  = true;
  editorDrawStart = { x: (e.clientX - rect.left) / editorZoom, y: (e.clientY - rect.top) / editorZoom };
  const dr = document.getElementById('editor-drawing');
  dr.style.display = 'block';
  dr.style.left = editorDrawStart.x + 'px';
  dr.style.top  = editorDrawStart.y + 'px';
  dr.style.width = '0'; dr.style.height = '0';
}

function editorMouseMove(e) {
  if (editorDrag) {
    const canvas = document.getElementById('editor-canvas');
    if (!canvas) return;
    const rect   = canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / editorZoom;
    const cy = (e.clientY - rect.top) / editorZoom;
    const sp = editorSpaces.find(s => s.id === editorDrag.id);
    if (!sp) return;
    const dxPct = (cx - editorDrag.startX) / editorDrag.cw * 100;
    const dyPct = (cy - editorDrag.startY) / editorDrag.ch * 100;
    sp.x = clamp(editorDrag.origX + dxPct, 0, 100 - sp.w);
    sp.y = clamp(editorDrag.origY + dyPct, 0, 100 - sp.h);
    const el = document.querySelector(`.zone-rect[data-id="${sp.id}"]`);
    if (el) {
      const CW = canvas.offsetWidth || 800;
      const CH = document.getElementById('floor-img')?.offsetHeight || canvas.offsetHeight || 480;
      const x = sp.x / 100 * CW;
      const y = sp.y / 100 * CH;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    }
    return;
  }
  if (!editorDrawing) return;
  const canvas = document.getElementById('editor-canvas');
  const rect   = canvas.getBoundingClientRect();
  const cx = (e.clientX - rect.left) / editorZoom, cy = (e.clientY - rect.top) / editorZoom;
  const x = Math.min(cx, editorDrawStart.x), y = Math.min(cy, editorDrawStart.y);
  const w = Math.abs(cx - editorDrawStart.x), h = Math.abs(cy - editorDrawStart.y);
  const dr = document.getElementById('editor-drawing');
  dr.style.left = x+'px'; dr.style.top = y+'px';
  dr.style.width = w+'px'; dr.style.height = h+'px';
}

function editorMouseUp(e) {
  if (editorDrag) {
    editorDrag = null;
    return;
  }
  if (!editorDrawing) return;
  editorDrawing = false;
  const dr = document.getElementById('editor-drawing');
  dr.style.display = 'none';

  const canvas = document.getElementById('editor-canvas');
  const rect   = canvas.getBoundingClientRect();
  const CW = canvas.offsetWidth, CH = document.getElementById('floor-img')?.offsetHeight || canvas.offsetHeight;

  const cx = (e.clientX - rect.left) / editorZoom, cy = (e.clientY - rect.top) / editorZoom;
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
  selectEditorZone(newSp.id);
  toast(`Зона "${label}" добавлена — не забудь сохранить`, 't-green', '✓');
}

function selectEditorZone(zoneId) {
  editorSelectedZoneId = zoneId || null;
  document.querySelectorAll('.zone-rect.selected').forEach(el => el.classList.remove('selected'));
  if (!zoneId) return;
  const el = document.querySelector(`.zone-rect[data-id="${zoneId}"]`);
  if (el) el.classList.add('selected');
}

function clearEditorSelection() {
  editorSelectedZoneId = null;
  document.querySelectorAll('.zone-rect.selected').forEach(el => el.classList.remove('selected'));
}

function editorZoneMouseDown(e, zoneId) {
  e.preventDefault();
  e.stopPropagation();
  selectEditorZone(zoneId);
  const canvas = document.getElementById('editor-canvas');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const sp = editorSpaces.find(s => s.id === zoneId);
  if (!sp) return;
  editorDrag = {
    id: zoneId,
    startX: (e.clientX - rect.left) / editorZoom,
    startY: (e.clientY - rect.top) / editorZoom,
    origX: sp.x,
    origY: sp.y,
    cw: canvas.offsetWidth || 800,
    ch: document.getElementById('floor-img')?.offsetHeight || canvas.offsetHeight || 480,
  };
}

function renameEditorZone(id) {
  const sp = editorSpaces.find(s => s.id === id);
  if (!sp) return;
  document.getElementById('modal-title').textContent = 'Переименовать зону';
  document.getElementById('modal-body').innerHTML = `
    <div class="field"><label>Название зоны</label>
      <input type="text" id="zone-rename-input" value="${escapeHtml(sp.label)}">
    </div>`;
  document.getElementById('modal-foot').innerHTML = `
    <button class="btn btn-ghost" onclick="closeModal()">Отмена</button>
    <button class="btn btn-primary" onclick="saveEditorZoneName('${sp.id}')">Сохранить</button>`;
  document.getElementById('modal-overlay').classList.add('open');
  requestAnimationFrame(() => {
    const i = document.getElementById('zone-rename-input');
    if (i) { i.focus(); i.select(); }
  });
}

function saveEditorZoneName(id) {
  const sp = editorSpaces.find(s => s.id === id);
  if (!sp) return;
  const name = document.getElementById('zone-rename-input')?.value.trim();
  if (!name) return toast('Введите название', 't-red', '✕');
  sp.label = name;
  closeModal();
  renderEditorZones();
  updateEditorZonesList();
  toast('Зона переименована — не забудь сохранить', 't-green', '✓');
}

function duplicateEditorZone(id) {
  const sp = editorSpaces.find(s => s.id === id);
  if (!sp) return;
  const offset = 2;
  const copy = {
    ...sp,
    id: DB.uid(),
    label: `${sp.label} (копия)`,
    x: clamp(sp.x + offset, 0, 100 - sp.w),
    y: clamp(sp.y + offset, 0, 100 - sp.h),
  };
  editorSpaces.push(copy);
  renderEditorZones();
  updateEditorZonesList();
  selectEditorZone(copy.id);
  toast('Зона скопирована — не забудь сохранить', 't-green', '✓');
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
      <button class="btn btn-ghost btn-xs" onclick="renameEditorZone('${sp.id}')" title="Переименовать">✏️</button>
      <button class="btn btn-ghost btn-xs" onclick="duplicateEditorZone('${sp.id}')" title="Копировать">⧉</button>
      <button class="btn btn-danger btn-xs" onclick="deleteEditorZone('${sp.id}')" title="Удалить">✕</button>
    </div>`).join('') :
    `<div style="font-size:12px;color:var(--ink4);text-align:center;padding:.75rem">Нет зон</div>`;
}

async function saveEditorSpaces() {
  const allSpaces   = getSpaces().filter(s=>s.floorId!==editorFloorId);
  const finalSpaces = [...allSpaces, ...editorSpaces];
  const floorIds = new Set(getFloors().map(f => f.id));
  const cleanedSpaces = finalSpaces.filter(s => floorIds.has(s.floorId));
  if (cleanedSpaces.length !== finalSpaces.length) {
    toast('Некоторые зоны относились к удалённым этажам и были убраны', 't-amber', '!');
  }
  const okCoworkings = await pushDomainKey('coworkings', getCoworkings());
  if (!okCoworkings) return;
  const okFloors = await pushDomainKey('floors', getFloors());
  if (!okFloors) return;
  suppressPushKeys.add('spaces');
  saveSpaces(cleanedSpaces);
  const ok = await pushDomainKey('spaces', cleanedSpaces);
  if (!ok) return;
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
  const fl = getFloors().find(f=>f.id===id);
  const floorName = fl?.name || 'этаж';
  confirmAction(`Вы уверены, что хотите удалить этаж «${escapeHtml(floorName)}» и все его зоны?`, async () => {
    const removedSpaceIds = getSpaces().filter(s=>s.floorId===id).map(s=>s.id);
    saveFloors(getFloors().filter(f=>f.id!==id));
    saveSpaces(getSpaces().filter(s=>s.floorId!==id));
    const ok = await replaceBookingsAsAdmin(getBookings().filter(b => !removedSpaceIds.includes(b.spaceId)));
    if (!ok) return;

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
  });
}

/* ═══════════════════════════════════════════════════════
   MODAL HELPERS
═══════════════════════════════════════════════════════ */
function closeModal() { document.getElementById('modal-overlay').classList.remove('open'); }
function overlayClick(e) { if (e.target === document.getElementById('modal-overlay')) closeModal(); }

function confirmAction(message, onConfirm) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:var(--white);border-radius:var(--radius-lg);padding:1.5rem;max-width:400px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="font-size:15px;font-weight:600;color:var(--ink);margin-bottom:1.25rem">${message}</div>
      <div style="display:flex;gap:.75rem;justify-content:flex-end">
        <button class="btn btn-ghost" id="_conf-no">Нет</button>
        <button class="btn btn-danger" id="_conf-yes">Да</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const cleanup = () => document.body.removeChild(overlay);
  overlay.querySelector('#_conf-yes').addEventListener('click', () => { cleanup(); onConfirm(); });
  overlay.querySelector('#_conf-no').addEventListener('click', cleanup);
  overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(); });
}

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
    if (currentView === 'map' && displayMode === 'map') renderMapView();
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  initSidebarResize();
  document.addEventListener('keydown', handleEditorHotkeys);
  // Enter key
  document.getElementById('l-pass')?.addEventListener('keydown', e => e.key==='Enter' && doLogin());

  // Restore user shell; actual auth validity is checked by API cookie on first sync.
  const sessionData = DB.get('session', null);
  if (sessionData && typeof sessionData === 'object' && sessionData.id) {
    await onAuth(sessionData, '');
    return;
  }
  if (sessionData) {
    DB.set('session', null); // drop legacy/invalid sessions
  }
});

function handleEditorHotkeys(e) {
  if (currentView !== 'admin' || adminActiveTab !== 'floors') return;
  if (!editorFloorId) return;
  const target = e.target;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

  const key = String(e.key || '').toLowerCase();
  const combo = (e.ctrlKey || e.metaKey) && !e.shiftKey;
  if (!combo) return;

  if (key === 'c') {
    if (!editorSelectedZoneId) {
      toast('Выберите зону для копирования', 't-amber', '!');
      return;
    }
    const sp = editorSpaces.find(s => s.id === editorSelectedZoneId);
    if (!sp) return;
    editorClipboardZone = { ...sp };
    toast('Зона скопирована', 't-green', '✓');
    e.preventDefault();
  }

  if (key === 'v') {
    if (!editorClipboardZone) {
      toast('Скопируйте зону (Cmd/Ctrl+C)', 't-amber', '!');
      return;
    }
    const offset = 2;
    const copy = {
      ...editorClipboardZone,
      id: DB.uid(),
      label: `${editorClipboardZone.label} (копия)`,
      x: clamp(editorClipboardZone.x + offset, 0, 100 - editorClipboardZone.w),
      y: clamp(editorClipboardZone.y + offset, 0, 100 - editorClipboardZone.h),
    };
    editorSpaces.push(copy);
    renderEditorZones();
    updateEditorZonesList();
    selectEditorZone(copy.id);
    toast('Зона вставлена — не забудь сохранить', 't-green', '✓');
    e.preventDefault();
  }
}


/* ═══════════════════════════════════════════════════════
   REAL-TIME UPDATES
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
