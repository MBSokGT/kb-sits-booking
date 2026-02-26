/* ═══════════════════════════════════════════════════════
   DATA LAYER  (localStorage — swap to fetch() later)
═══════════════════════════════════════════════════════ */
const DB = {
  get(k, def){ try{ return JSON.parse(localStorage.getItem('ws_'+k)) ?? def }catch{return def} },
  set(k,v){ localStorage.setItem('ws_'+k, JSON.stringify(v)) },
  uid(){ return Date.now() + Math.random().toString(36).slice(2,7) }
};

/* ── Initial seed ─────────────────────────────────────────────────────────── */
if (!DB.get('users', null)) {
  DB.set('users', [
    { id:'u1', email:'admin@demo.ru',   password:'admin123',  name:'Администратор',    department:'IT',      role:'admin'   },
    { id:'u2', email:'manager@demo.ru', password:'pass123',   name:'Менеджер Иванова', department:'HR / T&D',role:'manager' },
    { id:'u3', email:'user@demo.ru',    password:'pass123',   name:'Сотрудник Петров', department:'Продажи', role:'user'    },
  ]);
}
if (!DB.get('floors', null)) {
  const fid = 'f1';
  DB.set('floors', [{ id: fid, name: 'Этаж 4', imageUrl: null, sortOrder: 1 }]);
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

/* ── CRUD helpers ─────────────────────────────────────────────────────────── */
const getUsers    = ()  => DB.get('users', []);
const getFloors   = ()  => DB.get('floors', []);
const getSpaces   = ()  => DB.get('spaces', []);
const getBookings = ()  => DB.get('bookings', []);
const saveUsers    = v  => DB.set('users', v);
const saveFloors   = v  => DB.set('floors', v);
const saveSpaces   = v  => DB.set('spaces', v);
const saveBookings = v  => DB.set('bookings', v);

function purgeExpired() {
  const now = new Date();
  const ts  = fmtDate(now) + ' ' + p2(now.getHours()) + ':' + p2(now.getMinutes());
  saveBookings(getBookings().filter(b => b.expiresAt > ts));
}

/* ═══════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════ */
let currentUser   = null;
let selFloorId    = null;
let selDates      = [];        // array of 'YYYY-MM-DD'
let rangeAnchor   = null;      // first click for range
let calViewYear   = 0;
let calViewMonth  = 0;
let slotId        = 'full';
let customFrom    = '09:00';
let customTo      = '18:00';
let displayMode   = 'map';     // 'map' | 'list'
let currentView   = 'map';

// Editor state
let editorFloorId   = null;
let editorSpaces    = [];
let editorDrawing   = false;
let editorDrawStart = null;
let editorNewZone   = { label:'', seats:1, color:'#3b82f6' };

const SLOTS = [
  { id:'morning',   label:'Утро',       from:'09:00', to:'13:00' },
  { id:'afternoon', label:'День',       from:'13:00', to:'17:00' },
  { id:'evening',   label:'Вечер',      from:'17:00', to:'21:00' },
  { id:'full',      label:'Весь день',  from:'09:00', to:'21:00' },
  { id:'custom',    label:'Своё время', from:'09:00', to:'18:00' },
];
const COLORS = ['#3b82f6','#059669','#8b5cf6','#f59e0b','#ef4444','#ec4899','#06b6d4','#64748b'];
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

function doLogin() {
  const email = document.getElementById('l-email').value.trim().toLowerCase();
  const pass  = document.getElementById('l-pass').value;
  const user  = getUsers().find(u => u.email === email && u.password === pass);
  if (!user) return authErr('Неверный email или пароль');
  onAuth(user);
}

function doRegister() {
  const name  = document.getElementById('r-name').value.trim();
  const email = document.getElementById('r-email').value.trim().toLowerCase();
  const pass  = document.getElementById('r-pass').value;
  const dept  = document.getElementById('r-dept').value.trim();
  if (!name || !email || !pass) return authErr('Заполните обязательные поля');
  if (pass.length < 6) return authErr('Пароль минимум 6 символов');
  const users = getUsers();
  if (users.find(u => u.email === email)) return authErr('Email уже зарегистрирован');
  const user = { id: DB.uid(), email, password: pass, name, department: dept, role: 'user' };
  users.push(user);
  saveUsers(users);
  onAuth(user);
}

function onAuth(user) {
  currentUser = user;
  DB.set('session', user.id);
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  applyUserUI();
  initApp();
}

function doLogout() {
  currentUser = null;
  DB.set('session', null);
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
}

function applyUserUI() {
  const u = currentUser;
  document.getElementById('user-avatar').textContent    = userInitials(u.name);
  document.getElementById('user-name-lbl').textContent  = u.name.split(' ')[0];
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
function initApp() {
  purgeExpired();
  const today = new Date();
  calViewYear  = today.getFullYear();
  calViewMonth = today.getMonth();
  selDates     = [fmtDate(today)];
  rangeAnchor  = null;

  const floors = getFloors();
  if (!selFloorId && floors.length) selFloorId = floors[0].id;

  renderCalendar();
  renderSlots();
  renderFloors();
  renderStats();
  renderMiniBookings();
  renderMapView();
}

/* ═══════════════════════════════════════════════════════
   CALENDAR
═══════════════════════════════════════════════════════ */
function calMove(d) {
  calViewMonth += d;
  if (calViewMonth < 0)  { calViewMonth = 11; calViewYear--; }
  if (calViewMonth > 11) { calViewMonth = 0;  calViewYear++; }
  renderCalendar();
}

function calDayClick(ds) {
  const d = new Date(ds + 'T12:00:00');
  if (d < new Date(fmtDate(new Date()) + 'T00:00:00')) return; // past

  if (!rangeAnchor) {
    // First click: start range
    rangeAnchor = ds;
    selDates = [ds];
  } else {
    // Second click: build range of weekdays
    const start = rangeAnchor < ds ? rangeAnchor : ds;
    const end   = rangeAnchor < ds ? ds : rangeAnchor;
    selDates = buildDateRange(start, end);
    rangeAnchor = null;
  }
  renderCalendar();
  renderStats();
  renderMiniBookings();
  if (currentView === 'map') renderMapView();
  updateRangeHint();
}

function buildDateRange(start, end) {
  const dates = [];
  const cur = new Date(start + 'T12:00:00');
  const fin = new Date(end   + 'T12:00:00');
  while (cur <= fin) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) dates.push(fmtDate(cur)); // weekdays only
    cur.setDate(cur.getDate() + 1);
  }
  return dates.length ? dates : [start];
}

function updateRangeHint() {
  const el = document.getElementById('cal-range-hint');
  if (rangeAnchor) {
    el.textContent = 'Выберите конец диапазона…';
    el.style.color = 'var(--amber)';
  } else if (selDates.length > 1) {
    el.textContent = `${selDates.length} дней выбрано`;
    el.style.color = 'var(--blue)';
  } else {
    el.textContent = selDates.length ? fmtHuman(selDates[0]) : '';
    el.style.color = 'var(--ink3)';
  }
}

function renderCalendar() {
  const grid    = document.getElementById('cal-grid');
  const todayDs = fmtDate(new Date());
  const bookings = getBookings().filter(b => b.userId === currentUser.id);

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
  const rangeMin = rangeAnchor ? (selDates[0] < rangeAnchor ? selDates[0] : rangeAnchor) : null;
  const rangeMax = rangeAnchor ? (selDates[0] < rangeAnchor ? rangeAnchor : selDates[0]) : null;

  for (let d = 1; d <= daysInMonth; d++) {
    const ds   = `${calViewYear}-${p2(calViewMonth+1)}-${p2(d)}`;
    const date = new Date(ds + 'T12:00:00');
    const dow  = date.getDay();
    const isPast    = ds < todayDs;
    const isToday   = ds === todayDs;
    const isWeekend = dow === 0 || dow === 6;
    const isSelected = selDates.includes(ds);
    const isAnchor  = ds === rangeAnchor;
    const isInRange = rangeAnchor && ds > rangeMin && ds < rangeMax;
    const hasMine   = bookings.some(b => b.date === ds);

    let cls = 'cal-day';
    if (isPast)      cls += ' cal-past';
    if (isWeekend && !isPast) cls += ' cal-other';
    if (isToday)     cls += ' cal-today';
    if (isSelected)  cls += ' cal-selected';
    if (isAnchor)    cls += ' cal-selected';
    if (isInRange)   cls += ' cal-range';
    if (hasMine)     cls += ' cal-has-booking';

    const clickable = !isPast && !isWeekend;
    html += `<div class="${cls}" ${clickable?`onclick="calDayClick('${ds}')"`:''}>
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
  if (f >= t) return toast('Время «До» должно быть позже', 't-red', '✕');
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
   FLOORS
═══════════════════════════════════════════════════════ */
function renderFloors() {
  const el = document.getElementById('floor-list');
  el.innerHTML = getFloors().map(f =>
    `<button class="floor-btn ${f.id===selFloorId?'active':''}" onclick="selectFloor('${f.id}')">
      <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" style="opacity:.5">
        <path d="M3 4h14v2H3zm0 5h14v2H3zm0 5h14v2H3z"/>
      </svg>${f.name}</button>`
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
  const spaces   = getSpaces().filter(s => s.floorId === selFloorId);
  const bookings = getBookings();
  let free=0, mine=0, busy=0;
  // Use first selected date for stats
  const date = selDates[0] || fmtDate(new Date());
  const from = slotFrom(), to = slotTo();

  spaces.forEach(sp => {
    const bk = bookings.find(b => b.spaceId===sp.id && b.date===date && b.slotFrom===from);
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
      <div class="mb-label">${sp?.label||'?'}</div>
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
  const spaces = getSpaces().filter(s=>s.floorId===selFloorId);
  const date   = selDates[0] || fmtDate(new Date());
  const from   = slotFrom(), to = slotTo();

  document.getElementById('map-title').textContent = floor?.name || 'Этаж';
  document.getElementById('map-sub').textContent   = `${selDates.length>1?selDates.length+' дней · ':fmtHuman(date)+' · '}${spaces.length} пространств`;
  updateSlotBadge();

  if (displayMode === 'list') { renderListView(spaces, date, from); return; }

  const bookings = getBookings();
  const mapArea  = document.getElementById('map-area');

  // Build SVG map
  const W=760, H=520;
  let zones = '';
  spaces.forEach(sp => {
    const bk    = bookings.find(b=>b.spaceId===sp.id && b.date===date && b.slotFrom===from);
    const isMine = bk?.userId === currentUser.id;
    const isBusy = bk && !isMine;
    const fill   = isMine ? '#1d4ed8' : isBusy ? '#ef4444' : sp.color || '#3b82f6';
    const opacity = 0.82;
    // coords are % → scale to SVG px
    const x = sp.x/100*W, y = sp.y/100*H, w = sp.w/100*W, h = sp.h/100*H;
    const lines = sp.label.split(' ');
    const cy    = y + h/2;

    let textHtml = '';
    if (lines.length <= 2) {
      textHtml = lines.map((l,i) => `<text x="${x+w/2}" y="${cy + (i-(lines.length-1)/2)*14}"
        text-anchor="middle" dominant-baseline="middle" fill="white"
        font-family="DM Sans,sans-serif" font-size="11.5" font-weight="700">${l}</text>`).join('');
    } else {
      textHtml = `<text x="${x+w/2}" y="${cy}" text-anchor="middle" dominant-baseline="middle"
        fill="white" font-family="DM Sans,sans-serif" font-size="11" font-weight="700">${sp.label}</text>`;
    }
    // seats badge
    const seatsHtml = `<rect x="${x+w-22}" y="${y+4}" width="18" height="13" rx="6" fill="rgba(0,0,0,.25)"/>
      <text x="${x+w-13}" y="${y+14}" text-anchor="middle" fill="rgba(255,255,255,.9)"
        font-family="DM Mono,monospace" font-size="8" font-weight="500">${sp.seats}</text>`;
    // name badge if booked
    const whoHtml = isMine ? `<text x="${x+w/2}" y="${y+h-7}" text-anchor="middle" fill="rgba(255,255,255,.75)"
        font-family="DM Sans,sans-serif" font-size="9">Моё</text>` :
      isBusy ? `<text x="${x+w/2}" y="${y+h-7}" text-anchor="middle" fill="rgba(255,255,255,.75)"
        font-family="DM Sans,sans-serif" font-size="9">${bk.userName}</text>` : '';

    zones += `<g class="zone-svg" style="cursor:pointer" onclick="spaceClick('${sp.id}')">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5"
        fill="${fill}" fill-opacity="${opacity}" stroke="rgba(255,255,255,.4)" stroke-width="1.5"/>
      ${seatsHtml}${textHtml}${whoHtml}
    </g>`;
  });

  // Floor image or grid pattern
  const bgPattern = floor?.imageUrl
    ? `<image href="${floor.imageUrl}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid meet"/>`
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

function renderListView(spaces, date, from) {
  const bookings = getBookings();
  const la = document.getElementById('list-area');
  const types = { 'Кабинет':'🚪', 'Переговорная':'👥', 'Опен-спейс':'💻', 'Тихая зона':'🤫', 'зона':'📍' };

  la.innerHTML = `<table class="spaces-table">
    <thead><tr>
      <th>Пространство</th><th>Мест</th><th>Статус</th><th>Кто занял</th><th></th>
    </tr></thead>
    <tbody>${spaces.map(sp => {
      const bk    = bookings.find(b=>b.spaceId===sp.id && b.date===date && b.slotFrom===from);
      const isMine = bk?.userId === currentUser.id;
      const isBusy = bk && !isMine;
      const icon = Object.entries(types).find(([k]) => sp.label.includes(k))?.[1] || '📍';
      return `<tr>
        <td><strong>${icon} ${sp.label}</strong></td>
        <td>${sp.seats}</td>
        <td>${!bk
          ? `<span class="status-dot"><span class="dot dot-free"></span>Свободно</span>`
          : isMine
          ? `<span class="status-dot"><span class="dot dot-mine"></span>Моё</span>`
          : `<span class="status-dot"><span class="dot dot-busy"></span>Занято</span>`}</td>
        <td>${bk ? bk.userName : '—'}</td>
        <td>${!bk
          ? `<button class="btn btn-primary btn-sm" onclick="spaceClick('${sp.id}')">Забронировать</button>`
          : isMine
          ? `<button class="btn btn-danger btn-sm" onclick="cancelBooking('${bk.id}')">Отменить</button>`
          : ''}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

/* ═══════════════════════════════════════════════════════
   SPACE CLICK → MODAL
═══════════════════════════════════════════════════════ */
function spaceClick(spaceId) {
  const sp      = getSpaces().find(s=>s.id===spaceId);
  const floor   = getFloors().find(f=>f.id===sp.floorId);
  const date    = selDates[0] || fmtDate(new Date());
  const from    = slotFrom(), to = slotTo();
  const bookings = getBookings();
  const bk      = bookings.find(b=>b.spaceId===spaceId && b.date===date && b.slotFrom===from);
  const isMine  = bk?.userId === currentUser.id;
  const isBusy  = bk && !isMine;

  const titleEl = document.getElementById('modal-title');
  const bodyEl  = document.getElementById('modal-body');
  const footEl  = document.getElementById('modal-foot');

  titleEl.textContent = isMine ? 'Отменить бронирование' : isBusy ? 'Место занято' : 'Забронировать место';

  // Date pills
  const datePills = selDates.length > 1
    ? `<div style="margin-bottom:1rem">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--ink4);margin-bottom:6px">Даты (${selDates.length})</div>
        <div class="date-pills">${selDates.map(d=>`<span class="date-pill">${fmtHuman(d)}</span>`).join('')}</div>
       </div>`
    : '';

  bodyEl.innerHTML = `
    ${datePills}
    <div class="modal-info-grid">
      <div class="mig-item"><div class="mig-l">Место</div><div class="mig-v">${sp.label}</div></div>
      <div class="mig-item"><div class="mig-l">Мест</div><div class="mig-v">${sp.seats}</div></div>
      <div class="mig-item"><div class="mig-l">Этаж</div><div class="mig-v">${floor.name}</div></div>
      <div class="mig-item"><div class="mig-l">Время</div><div class="mig-v">${from}–${to}</div></div>
    </div>
    ${isBusy ? `<div style="padding:.75rem;background:var(--amber-l);border:1px solid rgba(217,119,6,.25);
      border-radius:var(--radius);font-size:13px;color:var(--amber)">
      Занято: <strong>${bk.userName}</strong>
    </div>` : ''}`;

  if (isBusy) {
    footEl.innerHTML = `<button class="btn btn-ghost" onclick="closeModal()">Закрыть</button>`;
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
  const from = slotFrom(), to = slotTo();
  const bookings = getBookings();
  let created = 0, skipped = 0;

  // Сотрудник — не более одной активной брони одновременно
  if (currentUser.role === 'user') {
    const myActive = bookings.filter(b => b.userId === currentUser.id);
    if (myActive.length > 0) {
      closeModal();
      toast('У вас уже есть активная бронь. Сначала отмените её.', 't-red', '✕');
      return;
    }
  }

  selDates.forEach(date => {
    const exists = bookings.find(b=>b.spaceId===spaceId && b.date===date && b.slotFrom===from);
    if (exists) { skipped++; return; }
    bookings.push({
      id:       DB.uid(),
      userId:   currentUser.id,
      userName: currentUser.name,
      spaceId,
      spaceName: sp.label,
      date, slotFrom: from, slotTo: to,
      expiresAt: `${date} ${to}`,
      createdAt: new Date().toISOString()
    });
    created++;
  });
  saveBookings(bookings);
  closeModal();

  const msg = skipped
    ? `Забронировано: ${created} дн.${skipped ? `, пропущено (занято): ${skipped}` : ''}`
    : `Забронировано: ${created} ${created===1?'день':'дней'}`;
  toast(msg, 't-green', '✓');

  renderCalendar(); renderStats(); renderMiniBookings();
  if (currentView === 'map') renderMapView();
}

function cancelBooking(id) {
  const bookings = getBookings();
  const bk = bookings.find(b=>b.id===id);
  if (!bk) return;
  if (currentUser.role === 'user' && bk.userId !== currentUser.id)
    return toast('Нельзя отменить чужую бронь', 't-red', '✕');
  saveBookings(bookings.filter(b=>b.id!==id));
  toast('Бронирование отменено', '', '✓');
  renderCalendar(); renderStats(); renderMiniBookings();
  if (currentView === 'map') renderMapView();
}

/* ═══════════════════════════════════════════════════════
   VIEW SWITCHING
═══════════════════════════════════════════════════════ */
function switchView(view, btn) {
  currentView = view;
  document.querySelectorAll('.tnav').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  ['view-map','view-mybookings','view-team','view-admin'].forEach(id=>{
    const el = document.getElementById(id);
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
          <td><strong>${sp?.label||'?'}</strong></td>
          <td>${fl?.name||'?'}</td>
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
   TEAM VIEW (manager)
═══════════════════════════════════════════════════════ */
function renderTeamView() {
  purgeExpired();
  const el   = document.getElementById('view-team');
  const me   = currentUser;
  const team = getUsers().filter(u=>u.department===me.department && u.id!==me.id);
  const bks  = getBookings().filter(b => team.some(u=>u.id===b.userId))
                             .sort((a,b)=>a.date.localeCompare(b.date));
  const spaces = getSpaces(); const floors = getFloors();

  el.innerHTML = `<div class="view-area">
    <div>
      <div class="view-head">Отдел: ${me.department}</div>
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
            <td><strong>${b.userName}</strong></td>
            <td>${sp?.label||'?'}</td>
            <td>${fmtHuman(b.date)}</td>
            <td style="font-family:'DM Mono',monospace;font-size:12px">${b.slotFrom}–${b.slotTo}</td>
            <td><button class="btn btn-danger btn-sm" onclick="cancelBooking('${b.id}');renderTeamView()">Отменить</button></td>
          </tr>`;
        }).join('')}
      </tbody></table></div></div>
  </div>`;
}

/* ═══════════════════════════════════════════════════════
   ADMIN VIEW
═══════════════════════════════════════════════════════ */
function renderAdminView() {
  const el = document.getElementById('view-admin');
  el.innerHTML = `<div class="view-area">
    <div><div class="view-head">Администрирование</div></div>
    <div class="floor-tabs" id="admin-tabs">
      <button class="floor-tab-btn active" onclick="adminTab('users',this)">Пользователи</button>
      <button class="floor-tab-btn" onclick="adminTab('floors',this)">Планировка этажей</button>
      <button class="floor-tab-btn" onclick="adminTab('bookings',this)">Все брони</button>
    </div>
    <div id="admin-tab-content"></div>
  </div>`;
  adminTab('users', document.querySelector('#admin-tabs .floor-tab-btn'));
}

function adminTab(tab, btn) {
  document.querySelectorAll('#admin-tabs .floor-tab-btn').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const el = document.getElementById('admin-tab-content');
  if (tab === 'users')    renderAdminUsers(el);
  if (tab === 'floors')   renderAdminFloors(el);
  if (tab === 'bookings') renderAdminBookings(el);
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
        <td><strong>${u.name}</strong></td>
        <td style="color:var(--ink3)">${u.email}</td>
        <td>${u.department||'—'}</td>
        <td><span class="badge badge-blue">${cnt}</span></td>
        <td>${isSelf
          ? `<span class="badge badge-amber">Вы</span>`
          : `<select class="role-sel" onchange="setUserRole('${u.id}',this.value)">
              ${['user','manager','admin'].map(r=>`<option value="${r}" ${u.role===r?'selected':''}>${roles[r]}</option>`).join('')}
             </select>`}</td>
        <td>${isSelf ? '' : `<button class="btn btn-danger btn-xs" onclick="deleteUser('${u.id}','${u.name}')">Удалить</button>`}</td>
      </tr>`;
    }).join('')}
    </tbody></table></div></div>`;
}

function setUserRole(uid, role) {
  const users = getUsers();
  const u = users.find(u=>u.id===uid);
  if (!u) return;
  u.role = role;
  saveUsers(users);
  toast(`Роль обновлена: ${u.name}`, 't-green', '✓');
}

function deleteUser(uid, name) {
  if (!confirm(`Удалить ${name}? Все брони будут удалены.`)) return;
  saveUsers(getUsers().filter(u=>u.id!==uid));
  saveBookings(getBookings().filter(b=>b.userId!==uid));
  toast(`${name} удалён`, '', '✓');
  renderAdminView();
}

/* ── Admin: All bookings ──────────────────────────────────────────────────── */
function renderAdminBookings(el) {
  purgeExpired();
  const bks    = getBookings().sort((a,b)=>a.date.localeCompare(b.date));
  const spaces = getSpaces(); const floors = getFloors();

  el.innerHTML = `<div class="card">
    <div class="card-head">Все активные бронирования (${bks.length})
      <button class="btn btn-ghost btn-sm" onclick="exportCSV()">⬇ CSV</button>
    </div>
    <div style="padding:0"><table class="data-table">
      <thead><tr><th>Место</th><th>Сотрудник</th><th>Отдел</th><th>Дата</th><th>Время</th><th>Истекает</th><th></th></tr></thead>
      <tbody>${!bks.length ? `<tr><td colspan="7" style="text-align:center;color:var(--ink4);padding:2rem">Нет бронирований</td></tr>` :
        bks.map(b=>{
          const sp=spaces.find(s=>s.id===b.spaceId); const fl=floors.find(f=>f.id===sp?.floorId);
          return `<tr>
            <td><strong>${sp?.label||'?'}</strong><br><span style="font-size:11px;color:var(--ink3)">${fl?.name||'?'}</span></td>
            <td>${b.userName}</td>
            <td style="font-size:12px;color:var(--ink3)">${b.userId===currentUser.id?'<span class="badge badge-blue">Вы</span>':getUsers().find(u=>u.id===b.userId)?.department||'—'}</td>
            <td>${fmtHuman(b.date)}</td>
            <td style="font-family:'DM Mono',monospace;font-size:12px">${b.slotFrom}–${b.slotTo}</td>
            <td style="font-size:11px;color:var(--ink3)">${b.expiresAt}</td>
            <td><button class="btn btn-danger btn-xs" onclick="adminCancelBk('${b.id}')">Отменить</button></td>
          </tr>`;
        }).join('')}
      </tbody></table></div></div>`;
}

function adminCancelBk(id) {
  saveBookings(getBookings().filter(b=>b.id!==id));
  toast('Бронирование отменено', '', '✓');
  renderStats(); renderMiniBookings(); renderAdminView();
}

function exportCSV() {
  const bks = getBookings(); const spaces = getSpaces(); const floors = getFloors();
  const rows = [['Место','Этаж','Сотрудник','Дата','Слот от','Слот до','Истекает']];
  bks.forEach(b => {
    const sp=spaces.find(s=>s.id===b.spaceId); const fl=floors.find(f=>f.id===sp?.floorId);
    rows.push([sp?.label||'?', fl?.name||'?', b.userName, b.date, b.slotFrom, b.slotTo, b.expiresAt]);
  });
  const csv = rows.map(r=>r.map(v=>`"${v}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csv);
  a.download = 'bookings.csv'; a.click();
}

/* ═══════════════════════════════════════════════════════
   ADMIN: FLOOR EDITOR
═══════════════════════════════════════════════════════ */
function renderAdminFloors(el) {
  const floors = getFloors();
  if (!editorFloorId && floors.length) editorFloorId = floors[0].id;

  el.innerHTML = `
    <div style="margin-bottom:.875rem;display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
      <div class="floor-tabs" id="editor-floor-tabs" style="margin-bottom:0">
        ${floors.map(f=>`<button class="floor-tab-btn ${f.id===editorFloorId?'active':''}"
          onclick="selectEditorFloor('${f.id}',this)">${f.name}</button>`).join('')}
      </div>
      <button class="btn btn-primary btn-sm" onclick="addFloor()">+ Этаж</button>
    </div>
    <div class="editor-wrap" style="padding:0">
      <div class="editor-layout" id="editor-layout"></div>
    </div>`;

  renderEditorForFloor();
}

function selectEditorFloor(id, btn) {
  editorFloorId = id;
  document.querySelectorAll('#editor-floor-tabs .floor-tab-btn').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderEditorForFloor();
}

function addFloor() {
  const name = prompt('Название этажа:');
  if (!name) return;
  const floors = getFloors();
  const newF = { id: DB.uid(), name: name.trim(), imageUrl: null, sortOrder: floors.length + 1 };
  floors.push(newF);
  saveFloors(floors);
  editorFloorId = newF.id;
  renderAdminFloors(document.getElementById('admin-tab-content'));
}

function renderEditorForFloor() {
  const floor  = getFloors().find(f=>f.id===editorFloorId);
  if (!floor) return;
  editorSpaces = getSpaces().filter(s=>s.floorId===editorFloorId).map(s=>({...s}));
  const layout = document.getElementById('editor-layout');
  if (!layout) return;

  layout.innerHTML = `
    <!-- CANVAS CARD -->
    <div class="editor-canvas-card">
      <div class="editor-toolbar">
        <span style="font-size:12px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.7px">
          ${floor.name}
        </span>
        <div style="margin-left:auto;display:flex;gap:.5rem;align-items:center">
          <label class="btn btn-ghost btn-sm" style="cursor:pointer">
            📎 Загрузить план
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
        <div class="panel-field">
          <label>Цвет</label>
          <div class="color-swatches">
            ${COLORS.map(c=>`<div class="swatch ${c===editorNewZone.color?'active':''}" style="background:${c}"
              onclick="pickColor('${c}')"></div>`).join('')}
          </div>
        </div>
        <div class="hint">Нарисуй прямоугольник мышью на плане чтобы создать зону</div>
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
              <div style="width:10px;height:10px;border-radius:2px;background:${sp.color};flex-shrink:0"></div>
              <span style="flex:1;font-weight:600">${sp.label}</span>
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
    </div>`;

  renderEditorZones();
}

function renderEditorZones() {
  const canvas  = document.getElementById('editor-canvas');
  const zonesEl = document.getElementById('editor-zones');
  if (!zonesEl || !canvas) return;
  const CW = canvas.offsetWidth || 800;
  const CH = document.getElementById('floor-img')?.offsetHeight || 480;

  zonesEl.innerHTML = editorSpaces.map(sp => {
    const x = sp.x/100*CW, y = sp.y/100*CH, w = sp.w/100*CW, h = sp.h/100*CH;
    return `<div class="zone-rect" data-id="${sp.id}"
      style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:${sp.color}">
      <div class="zone-label">${sp.label}<br><span style="font-size:9px;opacity:.8">${sp.seats} мест</span></div>
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

  if (pw < 20 || ph < 20) return; // too small

  const label = editorNewZone.label || prompt('Название зоны:') || 'Зона';
  document.getElementById('ez-label').value = label;
  editorNewZone.label = label;

  const newSp = {
    id:      DB.uid(),
    floorId: editorFloorId,
    label,
    seats:   editorNewZone.seats || 1,
    x:       Math.round(px/CW*100*100)/100,
    y:       Math.round(py/CH*100*100)/100,
    w:       Math.round(pw/CW*100*100)/100,
    h:       Math.round(ph/CH*100*100)/100,
    color:   editorNewZone.color || '#3b82f6'
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
      <div style="width:10px;height:10px;border-radius:2px;background:${sp.color};flex-shrink:0"></div>
      <span style="flex:1;font-weight:600">${sp.label}</span>
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
  // For now: read as base64 and store in localStorage
  // (When server is ready: POST /api/floors/:id/image)
  const reader = new FileReader();
  reader.onload = evt => {
    const floors = getFloors();
    const fl = floors.find(f=>f.id===floorId);
    if (fl) {
      fl.imageUrl = evt.target.result; // base64
      saveFloors(floors);
      renderAdminFloors(document.getElementById('admin-tab-content'));
      toast('План загружен ✓', 't-green', '✓');
    }
  };
  reader.readAsDataURL(file);
}

function removeFloorImage(floorId) {
  const floors = getFloors();
  const fl = floors.find(f=>f.id===floorId);
  if (fl) { fl.imageUrl = null; saveFloors(floors); }
  renderAdminFloors(document.getElementById('admin-tab-content'));
}

function renameFloor(id, name) {
  if (!name.trim()) return;
  const floors = getFloors();
  const fl = floors.find(f=>f.id===id);
  if (fl) { fl.name = name.trim(); saveFloors(floors); }
  renderFloors();
}

function deleteFloor(id) {
  if (!confirm('Удалить этаж и все его зоны?')) return;
  saveFloors(getFloors().filter(f=>f.id!==id));
  saveSpaces(getSpaces().filter(s=>s.floorId!==id));
  saveBookings(getBookings().filter(b => !getSpaces().filter(s=>s.floorId===id).some(s=>s.id===b.spaceId)));
  const floors = getFloors();
  editorFloorId = floors[0]?.id || null;
  if (!floors.find(f=>f.id===selFloorId)) selFloorId = floors[0]?.id;
  renderFloors();
  renderAdminFloors(document.getElementById('admin-tab-content'));
}

/* ═══════════════════════════════════════════════════════
   MODAL HELPERS
═══════════════════════════════════════════════════════ */
function closeModal() { document.getElementById('modal-overlay').classList.remove('open'); }
function overlayClick(e) { if (e.target === document.getElementById('modal-overlay')) closeModal(); }

/* ═══════════════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', () => {
  // Enter key
  document.getElementById('l-pass').addEventListener('keydown', e => e.key==='Enter' && doLogin());
  document.getElementById('r-pass').addEventListener('keydown', e => e.key==='Enter' && doRegister());

  // Restore session
  const sid = DB.get('session', null);
  if (sid) {
    const u = getUsers().find(u=>u.id===sid);
    if (u) { onAuth(u); return; }
  }
});