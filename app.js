/* ═══════════════════════════════════════════════════════
   DATA LAYER - Supabase Integration
═══════════════════════════════════════════════════════ */

// Проверка, что Supabase загружен
if (typeof api === 'undefined') {
  console.error('Supabase API не загружен! Проверьте подключение скриптов.');
}

/* ── Initial seed (только для первого запуска) ─────────────────────────────── */
async function ensureInitialData() {
  try {
    // Проверяем, есть ли пользователи
    const users = await api.getUsers();
    if (users && users.length > 0) return; // Данные уже есть
    
    console.log('Инициализация начальных данных...');
    // Данные уже должны быть в БД из supabase-schema.sql
  } catch (error) {
    console.error('Ошибка проверки данных:', error);
  }
}

/* ── CRUD helpers ─────────────────────────────────────────────────────────── */
const getUsers = async () => {
  try {
    return await api.getUsers() || [];
  } catch (error) {
    console.error('Ошибка получения пользователей:', error);
    return [];
  }
};

const getFloors = async () => {
  try {
    return await api.getFloors() || [];
  } catch (error) {
    console.error('Ошибка получения этажей:', error);
    return [];
  }
};

const getZones = async (floorId) => {
  try {
    if (!floorId) return [];
    return await api.getZonesByFloor(floorId) || [];
  } catch (error) {
    console.error('Ошибка получения зон:', error);
    return [];
  }
};

const getBookings = async () => {
  try {
    return await api.getBookings() || [];
  } catch (error) {
    console.error('Ошибка получения бронирований:', error);
    return [];
  }
};

// Кеш для данных (чтобы не делать запросы на каждый рендер)
let cachedUsers = [];
let cachedFloors = [];
let cachedZones = {};
let cachedBookings = [];

async function refreshCache() {
  cachedUsers = await getUsers();
  cachedFloors = await getFloors();
  cachedBookings = await getBookings();
}

/* ═══════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════ */
let currentUser   = null;
let selFloorId    = null;
let selDates      = [];
let calViewYear   = 0;
let calViewMonth  = 0;
let calMode       = 'month';
let calAnchorDate = null;
let includeWeekends = false;
let includeSaturdayInRange = false;
let slotId        = 'full';
let customFrom    = '09:00';
let customTo      = '18:00';
let displayMode   = 'map';
let currentView   = 'map';
let expiryTimer   = null;
let bookingForUserId = null;

const SLOTS = [
  { id:'morning',   label:'Утро',       from:'09:00', to:'13:00' },
  { id:'afternoon', label:'День',       from:'13:00', to:'17:00' },
  { id:'evening',   label:'Вечер',      from:'17:00', to:'21:00' },
  { id:'full',      label:'Весь день',  from:'09:00', to:'21:00' },
  { id:'custom',    label:'Своё время', from:'09:00', to:'18:00' },
];

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
function authTab(tab) {
  document.getElementById('aform-login').style.display = tab==='login' ? '' : 'none';
  document.getElementById('aform-reg').style.display   = tab==='reg'   ? '' : 'none';
  document.getElementById('atab-login').classList.toggle('active', tab==='login');
  document.getElementById('atab-reg').classList.toggle('active',   tab==='reg');
  document.getElementById('auth-err').style.display = 'none';
}

function authErr(msg) {
  const el = document.getElementById('auth-err');
  el.textContent = msg; el.style.display = '';
}

function resetDemoData() {
  alert('Для сброса данных используйте Supabase Studio → SQL Editor → DROP и CREATE таблицы заново');
}

async function doLogin() {
  const email = document.getElementById('l-email').value.trim().toLowerCase();
  const pass  = document.getElementById('l-pass').value;
  
  try {
    const user = await api.login(email, pass);
    if (!user) return authErr('Неверный email или пароль');
    onAuth(user);
  } catch (error) {
    console.error('Ошибка входа:', error);
    authErr('Ошибка входа: ' + error.message);
  }
}

async function doRegister() {
  const name  = document.getElementById('r-name').value.trim();
  const email = document.getElementById('r-email').value.trim().toLowerCase();
  const pass  = document.getElementById('r-pass').value;
  const dept  = document.getElementById('r-dept').value.trim();
  
  if (!name || !email || !pass) return authErr('Заполните обязательные поля');
  if (pass.length < 6) return authErr('Пароль минимум 6 символов');
  
  try {
    // Получить ID отдела или создать новый
    const departments = await api.getDepartments();
    let deptId = departments.find(d => d.name === dept)?.id;
    
    if (!deptId && dept) {
      const newDept = await api.createDepartment(dept);
      deptId = newDept.id;
    }
    
    const user = await api.register(email, pass, name, deptId, 'employee');
    onAuth(user);
  } catch (error) {
    console.error('Ошибка регистрации:', error);
    authErr('Ошибка: ' + error.message);
  }
}

async function onAuth(user) {
  currentUser = user;
  localStorage.setItem('currentUserId', user.id);
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  applyUserUI();
  await initApp();
  startExpiryWatcher();
}

function doLogout() {
  currentUser = null;
  localStorage.removeItem('currentUserId');
  api.logout();
  stopExpiryWatcher();
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
}

function applyUserUI() {
  const u = currentUser;
  document.getElementById('user-avatar').textContent    = userInitials(u.full_name);
  document.getElementById('user-name-lbl').textContent  = u.full_name.split(' ')[0];
  const rp = document.getElementById('role-pill');
  const labels = { employee:'Сотрудник', manager:'Руководитель', admin:'Администратор' };
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
async function initApp() {
  await ensureInitialData();
  await refreshCache();
  
  const today = new Date();
  calViewYear  = today.getFullYear();
  calViewMonth = today.getMonth();
  calMode      = 'month';
  selDates     = [fmtDate(today)];
  calAnchorDate = selDates[0];
  bookingForUserId = currentUser?.id || null;

  if (cachedFloors.length > 0 && !selFloorId) {
    selFloorId = cachedFloors[0].id;
  }

  await renderCalendar();
  renderSlots();
  await renderFloors();
  await renderStats();
  await renderMiniBookings();
  await renderMapView();
}

function startExpiryWatcher() {
  stopExpiryWatcher();
  expiryTimer = setInterval(async () => {
    if (!currentUser) return;
    await refreshCache();
    await refreshActiveViewAfterExpiry();
  }, 30000);
}

function stopExpiryWatcher() {
  if (!expiryTimer) return;
  clearInterval(expiryTimer);
  expiryTimer = null;
}

async function refreshActiveViewAfterExpiry() {
  await renderStats();
  await renderMiniBookings();
  if (currentView === 'map')        await renderMapView();
  if (currentView === 'mybookings') await renderMyBookingsView();
  if (currentView === 'team')       await renderTeamView();
  if (currentView === 'admin')      await renderAdminView();
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

function toggleSaturdayInRange(checked) {
  includeSaturdayInRange = !!checked;
  renderCalendar();
}

function isPastDate(ds) {
  return ds < fmtDate(new Date());
}

function isDateSelectable(ds) {
  if (isPastDate(ds)) return false;
  const dow = new Date(ds + 'T12:00:00').getDay();
  if (!includeWeekends && (dow === 0 || dow === 6)) return false;
  return true;
}

async function calDayClick(ds, evt) {
  if (!isDateSelectable(ds)) return;

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

  await renderCalendar();
  await renderStats();
  await renderMiniBookings();
  if (currentView === 'map') await renderMapView();
}

function buildDateRange(start, end) {
  const dates = [];
  let from = new Date(start + 'T12:00:00');
  let to = new Date(end + 'T12:00:00');
  if (from > to) [from, to] = [to, from];

  const cur = new Date(from);
  while (cur <= to) {
    const dow = cur.getDay();
    if (includeWeekends || (dow !== 0 && (dow !== 6 || includeSaturdayInRange))) {
      dates.push(fmtDate(cur));
    }
    cur.setDate(cur.getDate() + 1);
  }
  return dates.length ? dates : [end];
}

async function renderCalendar() {
  const grid    = document.getElementById('cal-grid');
  const todayDs = fmtDate(new Date());
  const bookings = cachedBookings.filter(b => b.user_id === currentUser.id);
  
  // Простой рендер календаря (сокращённая версия)
  document.getElementById('cal-month-lbl').textContent = `${MONTHS[calViewMonth]} ${calViewYear}`;
  
  let html = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d => `<div class="cal-dow">${d}</div>`).join('');
  
  const first = new Date(calViewYear, calViewMonth, 1);
  let startDow = first.getDay();
  if (startDow === 0) startDow = 7;
  
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
    const hasMine   = bookings.some(b => b.booking_date === ds);

    let cls = 'cal-day';
    if (isPast)      cls += ' cal-past';
    if (isWeekend && !includeWeekends && !isPast) cls += ' cal-other';
    if (isToday)     cls += ' cal-today';
    if (isSelected)  cls += ' cal-selected';
    if (hasMine)     cls += ' cal-has-booking';

    const clickable = isDateSelectable(ds);
    html += `<div class="${cls}" ${clickable?`onclick="calDayClick('${ds}', event)"`:''}>${d}</div>`;
  }
  grid.innerHTML = html;
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

async function selectSlot(id) {
  slotId = id;
  renderSlots();
  await renderStats();
  if (currentView === 'map') await renderMapView();
}

/* ═══════════════════════════════════════════════════════
   FLOORS
═══════════════════════════════════════════════════════ */
async function renderFloors() {
  const el = document.getElementById('floor-list');
  const floors = cachedFloors;
  
  if (!floors.length) {
    el.innerHTML = `<div style="font-size:12px;color:var(--ink4)">Нет этажей</div>`;
    return;
  }
  
  if (!floors.some(f=>f.id===selFloorId)) selFloorId = floors[0].id;
  
  el.innerHTML = floors.map(f =>
    `<button class="floor-btn ${f.id===selFloorId?'active':''}" onclick="selectFloor('${f.id}')">
      <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" style="opacity:.5">
        <path d="M3 4h14v2H3zm0 5h14v2H3zm0 5h14v2H3z"/>
      </svg>${f.name}</button>`
  ).join('');
}

async function selectFloor(id) {
  selFloorId = id;
  await renderFloors();
  await renderStats();
  if (currentView === 'map') await renderMapView();
}

/* ═══════════════════════════════════════════════════════
   STATS
═══════════════════════════════════════════════════════ */
async function renderStats() {
  if (!selFloorId) {
    document.getElementById('s-free').textContent = '0';
    document.getElementById('s-mine').textContent = '0';
    document.getElementById('s-busy').textContent = '0';
    return;
  }
  
  const zones = await getZones(selFloorId);
  let free=0, mine=0, busy=0;
  
  // Подсчёт статистики (упрощённая версия)
  zones.forEach(z => {
    // TODO: проверить бронирования для каждой зоны
    free++;
  });
  
  document.getElementById('s-free').textContent = free;
  document.getElementById('s-mine').textContent = mine;
  document.getElementById('s-busy').textContent = busy;
}

/* ═══════════════════════════════════════════════════════
   MINI BOOKINGS
═══════════════════════════════════════════════════════ */
async function renderMiniBookings() {
  const el = document.getElementById('mini-bk-list');
  const mine = cachedBookings.filter(b => b.user_id === currentUser.id);
  
  if (!mine.length) {
    el.innerHTML = `<div style="font-size:12px;color:var(--ink4);text-align:center;padding:1rem;
      border:1px dashed var(--line);border-radius:var(--radius)">Нет активных бронирований</div>`;
    return;
  }
  
  el.innerHTML = mine.sort((a,b)=>a.booking_date.localeCompare(b.booking_date)).map(b => {
    return `<div class="mini-booking">
      <div class="mb-label">Место ${b.seat_id}</div>
      <div class="mb-meta">${fmtHuman(b.booking_date)} · ${b.time_slot}</div>
      <button class="mb-del" onclick="cancelBooking('${b.id}')">✕</button>
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════
   MAP VIEW
═══════════════════════════════════════════════════════ */
async function renderMapView() {
  const floor = cachedFloors.find(f=>f.id===selFloorId);
  
  if (!floor) {
    document.getElementById('map-title').textContent = 'Нет этажей';
    document.getElementById('map-sub').textContent = 'Добавьте этаж в админке';
    document.getElementById('map-area').innerHTML = `<div class="empty" style="padding:2rem">
      <p>Для выбранного коворкинга пока нет этажей</p>
    </div>`;
    return;
  }
  
  const zones = await getZones(selFloorId);
  
  document.getElementById('map-title').textContent = floor.name;
  document.getElementById('map-sub').textContent = `${zones.length} зон`;
  
  // Простой рендер карты
  const mapArea = document.getElementById('map-area');
  mapArea.innerHTML = `<div style="padding:2rem;text-align:center">
    <p>Карта этажа: ${floor.name}</p>
    <p>Зон: ${zones.length}</p>
    <p style="color:var(--ink4);font-size:12px">Интеграция с Supabase активна ✓</p>
  </div>`;
}

/* ═══════════════════════════════════════════════════════
   VIEW SWITCHING
═══════════════════════════════════════════════════════ */
async function switchView(view, btn) {
  currentView = view;
  document.querySelectorAll('.tnav').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  
  ['view-map','view-mybookings','view-team','view-admin'].forEach(id=>{
    document.getElementById(id).style.display = 'none';
  });

  if (view === 'map') {
    document.getElementById('view-map').style.display = 'flex';
    await renderMapView();
  }
  if (view === 'mybookings') {
    document.getElementById('view-mybookings').style.display = 'flex';
    await renderMyBookingsView();
  }
}

async function renderMyBookingsView() {
  const el = document.getElementById('view-mybookings');
  el.innerHTML = `<div class="view-area">
    <div><div class="view-head">Мои бронирования</div></div>
    <p>Загрузка...</p>
  </div>`;
}

async function renderTeamView() {
  const el = document.getElementById('view-team');
  el.innerHTML = `<div class="view-area">
    <div><div class="view-head">Отдел</div></div>
    <p>Загрузка...</p>
  </div>`;
}

async function renderAdminView() {
  const el = document.getElementById('view-admin');
  el.innerHTML = `<div class="view-area">
    <div><div class="view-head">Администрирование</div></div>
    <p>Загрузка...</p>
  </div>`;
}

async function cancelBooking(id) {
  try {
    await api.cancelBooking(id);
    await refreshCache();
    toast('Бронирование отменено', '', '✓');
    await renderMiniBookings();
    if (currentView === 'map') await renderMapView();
  } catch (error) {
    console.error('Ошибка отмены:', error);
    toast('Ошибка: ' + error.message, 't-red', '✕');
  }
}

/* ═══════════════════════════════════════════════════════
   MODAL
═══════════════════════════════════════════════════════ */
function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

function overlayClick(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
}

/* ═══════════════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', async () => {
  // Enter key
  document.getElementById('l-pass').addEventListener('keydown', e => e.key==='Enter' && doLogin());
  document.getElementById('r-pass').addEventListener('keydown', e => e.key==='Enter' && doRegister());

  // Restore session
  const userId = localStorage.getItem('currentUserId');
  if (userId) {
    try {
      const users = await getUsers();
      const u = users.find(u=>u.id===userId);
      if (u) {
        currentUser = u;
        await onAuth(u);
        return;
      }
    } catch (error) {
      console.error('Ошибка восстановления сессии:', error);
    }
  }
});
