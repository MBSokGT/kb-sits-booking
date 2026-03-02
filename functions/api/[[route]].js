/**
 * КБ Ситс — Cloudflare Pages Function (catch-all)
 * Handles: /api/auth/*, /api/users, /api/kv/:key, /api/bookings*
 * Binding: env.DB → D1 database "kb-sits-db"
 */

const BASE_CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const SESSION_TTL_HOURS = 12;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const BOOKING_STATE_KEY = 'bookings_state';
const LEGACY_BOOKINGS_KEY = 'bookings';
const PASSWORD_HASH_PREFIX = 'pbkdf2_sha256';
const PASSWORD_HASH_ITERATIONS = 100000;
const PASSWORD_SALT_BYTES = 16;
const AUTH_COOKIE_NAME = 'ws_session';
const AUTH_COOKIE_MAX_AGE_SEC = SESSION_TTL_HOURS * 60 * 60;

const SAFE_KV_KEYS = new Set([
  'coworkings',
  'floors',
  'spaces',
  'workingSaturdays',
  'departments',
]);

const ADMIN_ONLY_KV_KEYS = new Set(['coworkings', 'floors', 'spaces', 'departments']);

function toJsonResponse(data, status = 200, corsHeaders = BASE_CORS, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, ...extraHeaders } });
}

function getBearerToken(request) {
  const auth = request.headers.get('Authorization') || request.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

function getCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  if (!cookie) return '';
  const parts = cookie.split(';');
  for (const part of parts) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) {
      try {
        return decodeURIComponent(rest.join('=') || '');
      } catch {
        return '';
      }
    }
  }
  return '';
}

function getSessionToken(request) {
  return getCookie(request, AUTH_COOKIE_NAME) || getBearerToken(request);
}

function sessionKey(token) {
  return `session:${token}`;
}

function buildSessionCookie(token, maxAgeSec = AUTH_COOKIE_MAX_AGE_SEC) {
  return `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

function clearSessionCookie() {
  return `${AUTH_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function makeSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const rand = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${Date.now().toString(36)}_${rand}`;
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

  // Moscow is UTC+3, no DST.
  return Date.UTC(y, mo - 1, d, h - 3, mi, 0, 0);
}

function bookingEndUtcMs(b) {
  if (!b || typeof b !== 'object') return NaN;
  if (typeof b.expiresAt === 'string' && b.expiresAt) {
    const m = b.expiresAt.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
    if (m) {
      const t = parseMskDateTimeToUtcMs(m[1], m[2]);
      if (Number.isFinite(t)) return t;
    }
  }
  if (typeof b.date === 'string' && typeof b.slotTo === 'string') {
    const t = parseMskDateTimeToUtcMs(b.date, b.slotTo);
    if (Number.isFinite(t)) return t;
  }
  return NaN;
}

function isTime(hhmm) {
  return /^\d{2}:\d{2}$/.test(String(hhmm));
}

function timeToMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

function timesOverlap(aFrom, aTo, bFrom, bTo) {
  return timeToMinutes(aFrom) < timeToMinutes(bTo) &&
         timeToMinutes(bFrom) < timeToMinutes(aTo);
}

function isBookingActive(b, nowMs = Date.now()) {
  if (!b || b.status === 'cancelled') return false;
  const endMs = bookingEndUtcMs(b);
  return Number.isFinite(endMs) && endMs > nowMs;
}

function normalizeBooking(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const id = String(raw.id || '').trim();
  const userId = String(raw.userId || '').trim();
  const userName = String(raw.userName || '').trim();
  const spaceId = String(raw.spaceId || '').trim();
  const spaceName = String(raw.spaceName || '').trim();
  const date = String(raw.date || '').trim();
  const slotFrom = String(raw.slotFrom || '').trim();
  const slotTo = String(raw.slotTo || '').trim();
  const expiresAt = String(raw.expiresAt || `${date} ${slotTo}`).trim();
  const createdAt = String(raw.createdAt || new Date().toISOString()).trim();
  const status = raw.status === 'cancelled' ? 'cancelled' : 'active';
  const createdBy = raw.createdBy ? String(raw.createdBy) : null;
  const cancelledAt = raw.cancelledAt ? String(raw.cancelledAt) : null;
  const cancelledBy = raw.cancelledBy ? String(raw.cancelledBy) : null;

  if (!id || !userId || !spaceId || !date || !slotFrom || !slotTo) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!isTime(slotFrom) || !isTime(slotTo)) return null;
  if (timeToMinutes(slotFrom) >= timeToMinutes(slotTo)) return null;

  return {
    id,
    userId,
    userName,
    spaceId,
    spaceName,
    date,
    slotFrom,
    slotTo,
    expiresAt,
    createdAt,
    status,
    createdBy,
    cancelledAt,
    cancelledBy,
  };
}

function trimBookingsRetention(value) {
  if (!Array.isArray(value)) return [];
  const now = Date.now();
  return value
    .map(normalizeBooking)
    .filter(Boolean)
    .filter(b => {
      const endMs = bookingEndUtcMs(b);
      return Number.isFinite(endMs) && (now - endMs) <= ONE_YEAR_MS;
    });
}

function parseJsonSafe(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  if (!/^[0-9a-fA-F]+$/.test(hex) || (hex.length % 2 !== 0)) return null;
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

function randomHex(byteLength) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(byteLength)));
}

function timingSafeEqual(a, b) {
  const sa = String(a ?? '');
  const sb = String(b ?? '');
  const len = Math.max(sa.length, sb.length);
  let diff = sa.length ^ sb.length;
  for (let i = 0; i < len; i++) {
    diff |= (sa.charCodeAt(i) || 0) ^ (sb.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function isHashedPassword(value) {
  return typeof value === 'string' && value.startsWith(`${PASSWORD_HASH_PREFIX}$`);
}

async function pbkdf2Hex(password, saltHex, iterations) {
  const saltBytes = hexToBytes(saltHex);
  if (!saltBytes) return '';
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(String(password)),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
      key,
      256
    );
    return bytesToHex(new Uint8Array(bits));
  } catch {
    return '';
  }
}

async function hashPassword(password) {
  const saltHex = randomHex(PASSWORD_SALT_BYTES);
  const hashHex = await pbkdf2Hex(password, saltHex, PASSWORD_HASH_ITERATIONS);
  return `${PASSWORD_HASH_PREFIX}$${PASSWORD_HASH_ITERATIONS}$${saltHex}$${hashHex}`;
}

async function verifyPassword(password, stored) {
  const saved = String(stored ?? '');
  if (!saved) return false;
  if (!isHashedPassword(saved)) {
    return timingSafeEqual(password, saved);
  }
  const parts = saved.split('$');
  if (parts.length !== 4) return false;
  const iterations = Number(parts[1]);
  const saltHex = parts[2];
  const expectedHex = parts[3];
  if (!Number.isInteger(iterations) || iterations < 50000 || iterations > 100000 || !saltHex || !expectedHex) return false;
  const actualHex = await pbkdf2Hex(password, saltHex, iterations);
  if (!actualHex) return false;
  return timingSafeEqual(actualHex, expectedHex);
}

function normalizeRole(role, fallback = 'user') {
  return ['user', 'manager', 'admin'].includes(role) ? role : fallback;
}

function roleLabelRu(role) {
  if (role === 'admin') return 'Администратор';
  if (role === 'manager') return 'Руководитель';
  return 'Сотрудник';
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email));
}

function parseAllowedOrigins(env) {
  const raw = String(env.CORS_ORIGINS || env.CORS_ORIGIN || '').trim();
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function resolveAllowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return '';
  const configured = parseAllowedOrigins(env);
  if (!configured.length) {
    const sameOrigin = new URL(request.url).origin;
    return origin === sameOrigin ? origin : '';
  }
  return configured.includes(origin) ? origin : '';
}

function buildCorsHeaders(request, env) {
  const headers = { ...BASE_CORS, Vary: 'Origin' };
  const allowedOrigin = resolveAllowedOrigin(request, env);
  if (allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

function getClientIp(request) {
  const cf = request.headers.get('CF-Connecting-IP');
  if (cf) return cf.trim();
  const xff = request.headers.get('X-Forwarded-For') || request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return 'unknown';
}

async function checkRateLimit(env, key, limit, windowSec) {
  const now = Date.now();
  const row = await env.DB.prepare('SELECT v FROM kv_store WHERE k = ?').bind(key).first();
  const state = row ? parseJsonSafe(row.v, null) : null;
  let count = Number(state?.count) || 0;
  let resetAt = Number(state?.resetAt) || 0;

  if (!resetAt || now >= resetAt) {
    count = 0;
    resetAt = now + windowSec * 1000;
  }

  if (count >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((resetAt - now) / 1000));
    return { ok: false, retryAfterSec };
  }

  count += 1;
  await env.DB.prepare(
    "INSERT OR REPLACE INTO kv_store (k, v, updated_at) VALUES (?, ?, datetime('now'))"
  ).bind(key, JSON.stringify({ count, resetAt })).run();

  return { ok: true, retryAfterSec: 0 };
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sendResendEmail(env, payload) {
  const apiKey = String(env.RESEND_API_KEY || '').trim();
  const from = String(env.EMAIL_FROM || '').trim();
  if (!apiKey || !from) {
    return { ok: false, skipped: true, reason: 'missing_email_config' };
  }

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [payload.to],
        subject: payload.subject,
        text: payload.text,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.error('[MAIL] resend failed', resp.status, body);
      return { ok: false, skipped: false, reason: `resend_${resp.status}` };
    }

    return { ok: true, skipped: false };
  } catch (err) {
    console.error('[MAIL] resend exception', err);
    return { ok: false, skipped: false, reason: 'resend_exception' };
  }
}

async function sendAccountCreatedEmail(env, requestUrl, payload) {
  const provider = String(env.EMAIL_PROVIDER || 'resend').trim().toLowerCase();
  if (provider !== 'resend') {
    return { ok: false, skipped: true, reason: 'provider_not_supported' };
  }

  const appUrl = String(env.APP_BASE_URL || new URL(requestUrl).origin);
  const includePassword = String(env.EMAIL_INCLUDE_PASSWORD || '0') === '1';
  const passwordLine = includePassword
    ? `Пароль: ${payload.password}`
    : 'Пароль выдаёт администратор по защищённому каналу.';

  const text = [
    `Здравствуйте, ${payload.name}!`,
    '',
    'Для вас создан аккаунт в системе бронирования КБ Ситс.',
    `Логин: ${payload.email}`,
    passwordLine,
    `Роль: ${roleLabelRu(payload.role)}`,
    `Отдел: ${payload.department}`,
    '',
    `Вход в систему: ${appUrl}`,
    '',
    `Аккаунт создан администратором: ${payload.createdBy}`,
  ].join('\n');

  return sendResendEmail(env, {
    to: payload.email,
    subject: 'Доступ к сервису КБ Ситс',
    text,
  });
}

async function sendPasswordResetCodeEmail(env, requestUrl, payload) {
  const provider = String(env.EMAIL_PROVIDER || 'resend').trim().toLowerCase();
  if (provider !== 'resend') {
    return { ok: false, skipped: true, reason: 'provider_not_supported' };
  }

  const appUrl = String(env.APP_BASE_URL || new URL(requestUrl).origin);
  const text = [
    `Здравствуйте, ${payload.name || 'пользователь'}!`,
    '',
    'Вы запросили сброс пароля в системе КБ Ситс.',
    `Код сброса: ${payload.token}`,
    `Код действует до: ${payload.expiresLabel}`,
    '',
    `Откройте сервис: ${appUrl}`,
    'Если это были не вы, просто проигнорируйте письмо.',
  ].join('\n');

  return sendResendEmail(env, {
    to: payload.email,
    subject: 'Код сброса пароля — КБ Ситс',
    text,
  });
}

async function sendPasswordChangedEmail(env, requestUrl, payload) {
  const provider = String(env.EMAIL_PROVIDER || 'resend').trim().toLowerCase();
  if (provider !== 'resend') {
    return { ok: false, skipped: true, reason: 'provider_not_supported' };
  }

  const appUrl = String(env.APP_BASE_URL || new URL(requestUrl).origin);
  let methodLabel = 'через смену в профиле';
  if (payload.method === 'forgot_reset') methodLabel = 'через сброс пароля';
  if (payload.method === 'admin_reset') methodLabel = 'изменён администратором';

  const includePassword = String(env.EMAIL_INCLUDE_PASSWORD || '0') === '1';
  const adminPasswordLine = payload.method === 'admin_reset'
    ? (includePassword && payload.newPassword
        ? `Новый пароль: ${payload.newPassword}`
        : 'Новый пароль задаётся администратором. Получите его по защищённому каналу.')
    : null;

  const text = [
    `Здравствуйте, ${payload.name || 'пользователь'}!`,
    '',
    'Пароль от вашей учётной записи в КБ Ситс изменён.',
    `Способ: ${methodLabel}`,
    ...(adminPasswordLine ? [adminPasswordLine] : []),
    `Время (UTC): ${new Date().toISOString()}`,
    '',
    `Вход в систему: ${appUrl}`,
    'Если это сделали не вы, срочно обратитесь к администратору.',
  ].join('\n');

  return sendResendEmail(env, {
    to: payload.email,
    subject: 'Пароль изменён — КБ Ситс',
    text,
  });
}

async function createSession(env, userId) {
  const token = makeSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    "INSERT OR REPLACE INTO kv_store (k, v, updated_at) VALUES (?, ?, datetime('now'))"
  ).bind(sessionKey(token), JSON.stringify({ userId, expiresAt })).run();
  return { token, expiresAt };
}

async function deleteSession(env, token) {
  if (!token) return;
  await env.DB.prepare('DELETE FROM kv_store WHERE k = ?').bind(sessionKey(token)).run();
}

async function getAuthSession(env, request) {
  const token = getSessionToken(request);
  if (!token) return null;

  const kvRow = await env.DB.prepare('SELECT v FROM kv_store WHERE k = ?').bind(sessionKey(token)).first();
  if (!kvRow) return null;

  const payload = parseJsonSafe(kvRow.v, null);
  if (!payload?.userId || !payload?.expiresAt || Date.now() > Date.parse(payload.expiresAt)) {
    await deleteSession(env, token);
    return null;
  }

  const user = await env.DB.prepare(
    'SELECT id, email, name, department, role FROM users WHERE id = ?'
  ).bind(payload.userId).first();

  if (!user) {
    await deleteSession(env, token);
    return null;
  }

  return { token, user };
}

async function getActiveSessionUserIds(env) {
  const now = Date.now();
  const activeUserIds = new Set();
  const rows = await env.DB.prepare("SELECT k, v FROM kv_store WHERE k LIKE 'session:%'").all();
  for (const row of (rows?.results || [])) {
    const payload = parseJsonSafe(row.v, null);
    const userId = String(payload?.userId || '').trim();
    const expiresAt = payload?.expiresAt ? Date.parse(payload.expiresAt) : NaN;
    if (!userId || !Number.isFinite(expiresAt) || expiresAt <= now) continue;
    activeUserIds.add(userId);
  }
  return activeUserIds;
}

async function revokeUserSessions(env, userId, keepToken = '') {
  const targetId = String(userId || '').trim();
  if (!targetId) return 0;
  const keepKey = keepToken ? sessionKey(keepToken) : '';
  const rows = await env.DB.prepare("SELECT k, v FROM kv_store WHERE k LIKE 'session:%'").all();
  let removed = 0;
  for (const row of (rows?.results || [])) {
    if (!row?.k || row.k === keepKey) continue;
    const payload = parseJsonSafe(row.v, null);
    if (String(payload?.userId || '').trim() !== targetId) continue;
    await env.DB.prepare('DELETE FROM kv_store WHERE k = ?').bind(row.k).run();
    removed++;
  }
  return removed;
}

async function getUsersMap(env, options = {}) {
  const { results } = await env.DB.prepare(
    'SELECT id, email, name, department, role FROM users ORDER BY role DESC, name'
  ).all();
  const withSessionActive = !!options.withSessionActive;
  const activeUserIds = withSessionActive ? await getActiveSessionUserIds(env) : null;
  const list = (results || []).map(u => ({
    ...u,
    ...(withSessionActive ? { sessionActive: activeUserIds.has(u.id) } : {}),
  }));
  const map = new Map();
  for (const u of list) map.set(u.id, u);
  return { list, map };
}

async function getTargetUser(env, userId) {
  return env.DB.prepare('SELECT id, email, name, department, role FROM users WHERE id = ?').bind(userId).first();
}

function canManageTarget(actor, target) {
  if (!actor || !target) return false;
  if (actor.role === 'admin') return true;
  if (actor.role === 'manager') {
    if (target.id === actor.id) return true;
    return target.role === 'user' && target.department === actor.department;
  }
  return target.id === actor.id;
}

function canCancelBooking(actor, booking, owner) {
  if (!actor || !booking) return false;
  if (booking.status === 'cancelled') return false;
  if (!isBookingActive(booking)) return false;
  if (actor.role === 'admin') return true;
  if (actor.role === 'user') return booking.userId === actor.id;
  if (actor.role === 'manager') {
    if (booking.userId === actor.id) return true;
    if (!owner) return false;
    return owner.role === 'user' && owner.department === actor.department;
  }
  return false;
}

async function getSpaceName(env, spaceId) {
  const row = await env.DB.prepare('SELECT v FROM kv_store WHERE k = ?').bind('spaces').first();
  const parsed = row ? parseJsonSafe(row.v, []) : [];
  if (!Array.isArray(parsed)) return spaceId;
  const sp = parsed.find(s => s && String(s.id) === String(spaceId));
  return sp?.label ? String(sp.label) : String(spaceId);
}

async function loadBookingState(env) {
  let row = await env.DB.prepare('SELECT v FROM kv_store WHERE k = ?').bind(BOOKING_STATE_KEY).first();

  if (!row) {
    const legacy = await env.DB.prepare('SELECT v FROM kv_store WHERE k = ?').bind(LEGACY_BOOKINGS_KEY).first();
    const legacyBookings = legacy ? trimBookingsRetention(parseJsonSafe(legacy.v, [])) : [];
    const initState = { rev: 1, bookings: legacyBookings };
    await env.DB.prepare(
      "INSERT OR IGNORE INTO kv_store (k, v, updated_at) VALUES (?, ?, datetime('now'))"
    ).bind(BOOKING_STATE_KEY, JSON.stringify(initState)).run();
    row = await env.DB.prepare('SELECT v FROM kv_store WHERE k = ?').bind(BOOKING_STATE_KEY).first();
  }

  if (!row) {
    const fallback = { rev: 1, bookings: [] };
    return { ...fallback, raw: JSON.stringify(fallback) };
  }

  const parsed = parseJsonSafe(row.v, {});
  const rev = Number.isInteger(parsed.rev) && parsed.rev > 0 ? parsed.rev : 1;
  const bookings = trimBookingsRetention(parsed.bookings);
  return { rev, bookings, raw: row.v };
}

async function saveBookingStateCAS(env, expectedRaw, nextState) {
  const nextRaw = JSON.stringify(nextState);
  const res = await env.DB.prepare(
    "UPDATE kv_store SET v = ?, updated_at = datetime('now') WHERE k = ? AND v = ?"
  ).bind(nextRaw, BOOKING_STATE_KEY, expectedRaw).run();

  return !!(res?.meta?.changes === 1);
}

async function mutateBookings(env, mutator) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await loadBookingState(env);
    const base = current.bookings;
    const outcome = await mutator(base);

    if (outcome?.error) return outcome;

    const nextBookings = trimBookingsRetention(outcome.bookings || base);
    const nextState = { rev: current.rev + 1, bookings: nextBookings };

    const ok = await saveBookingStateCAS(env, current.raw, nextState);
    if (ok) {
      return {
        ok: true,
        bookings: nextBookings,
        rev: nextState.rev,
        meta: outcome.meta || {},
      };
    }
  }

  return { error: 'Конфликт обновления. Повторите действие.', status: 409 };
}

function validateCreatePayload(body) {
  const spaceId = String(body?.spaceId || '').trim();
  const slotFrom = String(body?.slotFrom || '').trim();
  const slotTo = String(body?.slotTo || '').trim();
  const targetUserId = String(body?.targetUserId || '').trim();
  const dates = Array.isArray(body?.dates) ? body.dates.map(v => String(v)).filter(Boolean) : [];

  if (!spaceId) return { error: 'Не указано место' };
  if (!dates.length) return { error: 'Не выбраны даты' };
  if (dates.length > 120) return { error: 'Слишком много дат в одном запросе' };
  if (!isTime(slotFrom) || !isTime(slotTo) || timeToMinutes(slotFrom) >= timeToMinutes(slotTo)) {
    return { error: 'Некорректный временной слот' };
  }

  const uniqDates = Array.from(new Set(dates)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (!uniqDates.length) return { error: 'Некорректные даты' };

  return {
    spaceId,
    slotFrom,
    slotTo,
    targetUserId,
    dates: uniqDates,
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = buildCorsHeaders(request, env);
  const reply = (data, status = 200, extraHeaders = {}) =>
    toJsonResponse(data, status, corsHeaders, extraHeaders);

  if (request.method === 'OPTIONS') {
    const origin = request.headers.get('Origin');
    if (origin && !corsHeaders['Access-Control-Allow-Origin']) {
      return new Response(null, { status: 403, headers: { Vary: 'Origin' } });
    }
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '').replace(/\/$/, '') || '/';
  const method = request.method;

  try {
    /* ── GET /health (public) ─────────────────────────── */
    if (path === '/health') {
      const row = await env.DB.prepare("SELECT datetime('now') AS ts").first();
      return reply({ ok: true, ts: row?.ts });
    }

    /* ── POST /auth/login (public) ────────────────────── */
    if (path === '/auth/login' && method === 'POST') {
      const { email = '', password = '' } = await request.json();
      const emailClean = email.trim().toLowerCase();
      const ip = getClientIp(request);
      const loginLimit = await checkRateLimit(env, `rl:auth:login:${ip}`, 20, 15 * 60);
      if (!loginLimit.ok) {
        return reply(
          { error: 'Слишком много попыток входа. Повторите позже.' },
          429,
          { 'Retry-After': String(loginLimit.retryAfterSec) }
        );
      }
      const row = await env.DB.prepare(
        'SELECT id, email, name, department, role, password FROM users WHERE email = ?'
      ).bind(emailClean).first();

      if (!row) return reply({ error: 'Неверный email или пароль' }, 401);
      const ok = await verifyPassword(password, row.password);
      if (!ok) return reply({ error: 'Неверный email или пароль' }, 401);

      if (!isHashedPassword(row.password)) {
        const upgraded = await hashPassword(password);
        await env.DB.prepare('UPDATE users SET password = ? WHERE id = ?').bind(upgraded, row.id).run();
      }

      const { token } = await createSession(env, row.id);
      const { password: _password, ...safeUser } = row;
      return reply(
        { user: safeUser },
        200,
        { 'Set-Cookie': buildSessionCookie(token) }
      );
    }

    /* ── POST /auth/logout (public/auth) ──────────────── */
    if (path === '/auth/logout' && method === 'POST') {
      const token = getSessionToken(request);
      if (token) await deleteSession(env, token);
      return reply(
        { ok: true },
        200,
        { 'Set-Cookie': clearSessionCookie() }
      );
    }

    /* ── POST /auth/register (public) ─────────────────── */
    if (path === '/auth/register' && method === 'POST') {
      return reply({ error: 'Саморегистрация отключена. Обратитесь к администратору.' }, 403);
    }

    /* ── POST /auth/forgot-password (public) ──────────── */
    if (path === '/auth/forgot-password' && method === 'POST') {
      const { email = '' } = await request.json();
      const emailClean = email.trim().toLowerCase();
      const ip = getClientIp(request);
      const forgotLimit = await checkRateLimit(env, `rl:auth:forgot:${ip}`, 6, 60 * 60);
      if (!forgotLimit.ok) {
        return reply(
          { error: 'Слишком много запросов на сброс. Повторите позже.' },
          429,
          { 'Retry-After': String(forgotLimit.retryAfterSec) }
        );
      }
      const row = await env.DB.prepare('SELECT id, name, email FROM users WHERE email = ?').bind(emailClean).first();
      if (!row) return reply({ ok: true });

      const token = (Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 6)).toUpperCase();
      const tokenHash = await sha256Hex(`${token}|${emailClean}|${env.RESET_TOKEN_PEPPER || ''}`);
      const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      await env.DB.prepare(
        "INSERT OR REPLACE INTO kv_store (k, v, updated_at) VALUES (?, ?, datetime('now'))"
      ).bind('reset:' + emailClean, JSON.stringify({ tokenHash, expires })).run();

      const mail = await sendPasswordResetCodeEmail(env, request.url, {
        email: row.email || emailClean,
        name: row.name || '',
        token,
        expiresLabel: expires.replace('T', ' ').slice(0, 16) + ' UTC',
      });
      if (!mail.ok && !mail.skipped) {
        console.error('[MAIL] forgot-password email not sent', mail.reason || 'unknown');
      }

      // For production do NOT expose token in API response.
      if (env.RESET_DEBUG === '1') return reply({ ok: true, token });
      return reply({ ok: true });
    }

    /* ── POST /auth/reset-password (public) ───────────── */
    if (path === '/auth/reset-password' && method === 'POST') {
      const { email = '', token = '', newPassword = '' } = await request.json();
      const ip = getClientIp(request);
      const resetLimit = await checkRateLimit(env, `rl:auth:reset:${ip}`, 12, 60 * 60);
      if (!resetLimit.ok) {
        return reply(
          { error: 'Слишком много попыток сброса. Повторите позже.' },
          429,
          { 'Retry-After': String(resetLimit.retryAfterSec) }
        );
      }
      if (!newPassword || newPassword.length < 6) {
        return reply({ error: 'Пароль минимум 6 символов' }, 400);
      }

      const emailClean = email.trim().toLowerCase();
      const kvRow = await env.DB.prepare('SELECT v FROM kv_store WHERE k = ?').bind('reset:' + emailClean).first();
      if (!kvRow) return reply({ error: 'Код сброса не найден или уже использован' }, 400);

      const payload = parseJsonSafe(kvRow.v, null);
      if (!payload?.tokenHash || !payload?.expires) {
        return reply({ error: 'Код сброса повреждён' }, 400);
      }

      if (new Date() > new Date(payload.expires)) {
        return reply({ error: 'Код истёк — запросите новый' }, 400);
      }

      const tokenHash = await sha256Hex(`${String(token).trim().toUpperCase()}|${emailClean}|${env.RESET_TOKEN_PEPPER || ''}`);
      if (tokenHash !== payload.tokenHash) {
        return reply({ error: 'Неверный код сброса' }, 400);
      }

      const userRow = await env.DB.prepare('SELECT id, email, name FROM users WHERE email = ?').bind(emailClean).first();
      if (!userRow) return reply({ error: 'Пользователь не найден' }, 404);

      const passwordHash = await hashPassword(newPassword);
      await env.DB.prepare('UPDATE users SET password = ? WHERE id = ?').bind(passwordHash, userRow.id).run();
      await env.DB.prepare('DELETE FROM kv_store WHERE k = ?').bind('reset:' + emailClean).run();

      const mail = await sendPasswordChangedEmail(env, request.url, {
        email: userRow.email || emailClean,
        name: userRow.name || '',
        method: 'forgot_reset',
      });
      if (!mail.ok && !mail.skipped) {
        console.error('[MAIL] reset-password change notice not sent', mail.reason || 'unknown');
      }
      return reply({ ok: true });
    }

    /* ── POST /auth/change-password (auth) ────────────── */
    if (path === '/auth/change-password' && method === 'POST') {
      const auth = await getAuthSession(env, request);
      if (!auth) return reply({ error: 'Требуется вход в систему' }, 401);

      const { email = '', oldPassword = '', newPassword = '' } = await request.json();
      const emailClean = email.trim().toLowerCase();
      if (!newPassword || newPassword.length < 6) {
        return reply({ error: 'Новый пароль минимум 6 символов' }, 400);
      }
      if (auth.user.email !== emailClean && auth.user.role !== 'admin') {
        return reply({ error: 'Недостаточно прав' }, 403);
      }

      const row = await env.DB.prepare(
        'SELECT id, email, name, password FROM users WHERE email = ?'
      ).bind(emailClean).first();
      if (!row) return reply({ error: 'Пользователь не найден' }, 404);
      const ok = await verifyPassword(oldPassword, row.password);
      if (!ok) return reply({ error: 'Неверный текущий пароль' }, 401);

      const passwordHash = await hashPassword(newPassword);
      await env.DB.prepare('UPDATE users SET password = ? WHERE id = ?').bind(passwordHash, row.id).run();

      const mail = await sendPasswordChangedEmail(env, request.url, {
        email: row.email || emailClean,
        name: row.name || '',
        method: 'change_password',
      });
      if (!mail.ok && !mail.skipped) {
        console.error('[MAIL] change-password notice not sent', mail.reason || 'unknown');
      }
      return reply({ ok: true });
    }

    // Everything below requires valid session.
    const auth = await getAuthSession(env, request);
    if (!auth) return reply({ error: 'Требуется вход в систему' }, 401);

    /* ── GET /users (auth) ────────────────────────────── */
    if (path === '/users' && method === 'GET') {
      const { list } = await getUsersMap(env, { withSessionActive: auth.user.role === 'admin' });
      let users = [];
      if (auth.user.role === 'admin') {
        users = list;
      } else if (auth.user.role === 'manager') {
        users = list.filter(u => u.id === auth.user.id || u.department === auth.user.department);
      } else {
        users = list.filter(u => u.id === auth.user.id);
      }
      return reply({ users });
    }

    /* ── POST /users/create (admin) ───────────────────── */
    if (path === '/users/create' && method === 'POST') {
      if (auth.user.role !== 'admin') return reply({ error: 'Недостаточно прав' }, 403);
      const { name = '', email = '', password = '', department = '', role = 'user', sendInviteEmail = true } = await request.json();
      const nameClean = String(name).trim();
      const emailClean = String(email).trim().toLowerCase();
      const departmentClean = String(department).trim();
      const roleClean = normalizeRole(String(role).trim(), 'user');

      if (!nameClean || !emailClean || !password || !departmentClean) {
        return reply({ error: 'Заполните обязательные поля' }, 400);
      }
      if (!isValidEmail(emailClean)) return reply({ error: 'Некорректный email' }, 400);
      if (String(password).length < 6) return reply({ error: 'Пароль минимум 6 символов' }, 400);

      const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(emailClean).first();
      if (existing) return reply({ error: 'Email уже зарегистрирован' }, 409);

      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const passwordHash = await hashPassword(password);
      await env.DB.prepare(
        'INSERT INTO users (id, email, password, name, department, role) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(id, emailClean, passwordHash, nameClean, departmentClean, roleClean).run();

      let mail = { sent: false, skipped: true, reason: 'disabled_by_request' };
      if (sendInviteEmail !== false) {
        const sent = await sendAccountCreatedEmail(env, request.url, {
          name: nameClean,
          email: emailClean,
          password: String(password),
          department: departmentClean,
          role: roleClean,
          createdBy: auth.user.name || auth.user.email || 'admin',
        });
        mail = { sent: !!sent.ok, skipped: !!sent.skipped, reason: sent.reason || null };
      }

      const { list } = await getUsersMap(env);
      return reply({ ok: true, users: list, mail });
    }

    /* ── POST /users/role (admin) ─────────────────────── */
    if (path === '/users/role' && method === 'POST') {
      if (auth.user.role !== 'admin') return reply({ error: 'Недостаточно прав' }, 403);
      const { id = '', role = '' } = await request.json();
      const userId = String(id).trim();
      const roleClean = normalizeRole(String(role).trim(), '');
      if (!userId || !roleClean) return reply({ error: 'Некорректные данные' }, 400);
      if (userId === auth.user.id) return reply({ error: 'Нельзя менять роль текущего администратора' }, 400);

      const target = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first();
      if (!target) return reply({ error: 'Пользователь не найден' }, 404);
      await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(roleClean, userId).run();

      const { list } = await getUsersMap(env, { withSessionActive: true });
      return reply({ ok: true, users: list });
    }

    /* ── POST /users/department (admin) ───────────────── */
    if (path === '/users/department' && method === 'POST') {
      if (auth.user.role !== 'admin') return reply({ error: 'Недостаточно прав' }, 403);
      const { id = '', department = '' } = await request.json();
      const userId = String(id).trim();
      const departmentClean = String(department).trim();
      if (!userId || !departmentClean) return reply({ error: 'Укажите пользователя и отдел' }, 400);

      const target = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first();
      if (!target) return reply({ error: 'Пользователь не найден' }, 404);

      await env.DB.prepare('UPDATE users SET department = ? WHERE id = ?').bind(departmentClean, userId).run();
      const { list } = await getUsersMap(env, { withSessionActive: true });
      return reply({ ok: true, users: list });
    }

    /* ── POST /users/password (admin) ─────────────────── */
    if (path === '/users/password' && method === 'POST') {
      if (auth.user.role !== 'admin') return reply({ error: 'Недостаточно прав' }, 403);
      const { id = '', newPassword = '', sendNotifyEmail = true } = await request.json();
      const userId = String(id).trim();
      const pass = String(newPassword);
      if (!userId) return reply({ error: 'Не указан пользователь' }, 400);
      if (!pass || pass.length < 6) return reply({ error: 'Пароль минимум 6 символов' }, 400);

      const target = await env.DB.prepare('SELECT id, email, name FROM users WHERE id = ?').bind(userId).first();
      if (!target) return reply({ error: 'Пользователь не найден' }, 404);

      const passwordHash = await hashPassword(pass);
      await env.DB.prepare('UPDATE users SET password = ? WHERE id = ?').bind(passwordHash, userId).run();
      const keepToken = sameId(userId, auth.user.id) ? auth.token : '';
      const revokedSessions = await revokeUserSessions(env, userId, keepToken);

      let mail = { sent: false, skipped: true, reason: 'disabled_by_request' };
      if (sendNotifyEmail !== false) {
        const sent = await sendPasswordChangedEmail(env, request.url, {
          email: target.email || '',
          name: target.name || '',
          method: 'admin_reset',
          newPassword: pass,
        });
        mail = { sent: !!sent.ok, skipped: !!sent.skipped, reason: sent.reason || null };
      }

      const { list } = await getUsersMap(env, { withSessionActive: true });
      return reply({ ok: true, users: list, mail, revokedSessions });
    }

    /* ── POST /users/delete (admin) ───────────────────── */
    if (path === '/users/delete' && method === 'POST') {
      if (auth.user.role !== 'admin') return reply({ error: 'Недостаточно прав' }, 403);
      const { id = '' } = await request.json();
      const userId = String(id).trim();
      if (!userId) return reply({ error: 'Не указан пользователь' }, 400);
      if (userId === auth.user.id) return reply({ error: 'Нельзя удалить текущего администратора' }, 400);

      const target = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first();
      if (!target) return reply({ error: 'Пользователь не найден' }, 404);

      const bookingResult = await mutateBookings(env, (bookings) => {
        const now = Date.now();
        const next = bookings.map(b => {
          if (b.userId !== userId) return b;
          if (!isBookingActive(b, now)) return b;
          return {
            ...b,
            status: 'cancelled',
            cancelledAt: new Date().toISOString(),
            cancelledBy: auth.user.id,
          };
        });
        return { bookings: next };
      });
      if (!bookingResult.ok) {
        return reply({ error: bookingResult.error || 'Не удалось обновить бронирования' }, bookingResult.status || 400);
      }

      await revokeUserSessions(env, userId);
      await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
      const { list } = await getUsersMap(env, { withSessionActive: true });
      return reply({ ok: true, users: list, bookings: bookingResult.bookings });
    }

    /* ── GET /bookings (auth) ─────────────────────────── */
    if (path === '/bookings' && method === 'GET') {
      const state = await loadBookingState(env);
      return reply({ bookings: state.bookings, rev: state.rev });
    }

    /* ── POST /bookings/create (auth) ─────────────────── */
    if (path === '/bookings/create' && method === 'POST') {
      const body = await request.json();
      const valid = validateCreatePayload(body);
      if (valid.error) return reply({ error: valid.error }, 400);

      const targetUserId = valid.targetUserId || auth.user.id;
      const targetUser = await getTargetUser(env, targetUserId);
      if (!targetUser) return reply({ error: 'Сотрудник не найден' }, 404);
      if (!canManageTarget(auth.user, targetUser)) {
        return reply({ error: 'Недостаточно прав' }, 403);
      }

      const spaceName = await getSpaceName(env, valid.spaceId);

      const result = await mutateBookings(env, (bookings) => {
        const active = bookings.filter(b => isBookingActive(b));
        let created = 0;
        let skippedBusy = 0;
        let skippedUser = 0;
        let skippedDailyLimit = 0;
        let skippedPast = 0;
        const nowMs = Date.now();
        const createdDates = [];
        const skippedBusyDates = [];
        const skippedUserConflictDates = [];
        const skippedDailyLimitDates = [];
        const skippedPastDates = [];

        const next = [...bookings];

        for (const date of valid.dates) {
          const endMs = parseMskDateTimeToUtcMs(date, valid.slotTo);
          if (!Number.isFinite(endMs) || endMs <= nowMs) {
            skippedPast++;
            skippedPastDates.push(date);
            continue;
          }

          const busy = active.find(b => b.spaceId === valid.spaceId && b.date === date &&
            timesOverlap(valid.slotFrom, valid.slotTo, b.slotFrom, b.slotTo));
          if (busy) { skippedBusy++; skippedBusyDates.push(date); continue; }

          if (targetUser.role === 'user') {
            const daily = active.find(b => b.userId === targetUser.id && b.date === date);
            if (daily) { skippedDailyLimit++; skippedDailyLimitDates.push(date); continue; }
          }

          const userConflict = active.find(b => b.userId === targetUser.id && b.date === date &&
            timesOverlap(valid.slotFrom, valid.slotTo, b.slotFrom, b.slotTo));
          if (userConflict) { skippedUser++; skippedUserConflictDates.push(date); continue; }

          const booking = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            userId: targetUser.id,
            userName: targetUser.name,
            spaceId: valid.spaceId,
            spaceName,
            date,
            slotFrom: valid.slotFrom,
            slotTo: valid.slotTo,
            expiresAt: `${date} ${valid.slotTo}`,
            createdAt: new Date().toISOString(),
            status: 'active',
            createdBy: auth.user.id,
            cancelledAt: null,
            cancelledBy: null,
          };

          next.push(booking);
          active.push(booking);
          created++;
          createdDates.push(date);
        }

        return {
          bookings: next,
          meta: {
            created,
            createdDates,
            skippedBusy,
            skippedBusyDates,
            skippedUser,
            skippedUserConflictDates,
            skippedDailyLimit,
            skippedDailyLimitDates,
            skippedPast,
            skippedPastDates,
          },
        };
      });

      if (!result.ok) return reply({ error: result.error || 'Ошибка бронирования' }, result.status || 400);

      return reply({
        ok: true,
        bookings: result.bookings,
        rev: result.rev,
        ...result.meta,
      });
    }

    /* ── POST /bookings/cancel (auth) ─────────────────── */
    if (path === '/bookings/cancel' && method === 'POST') {
      const { id = '' } = await request.json();
      const bookingId = String(id).trim();
      if (!bookingId) return reply({ error: 'Не указан ID брони' }, 400);

      const { map: usersMap } = await getUsersMap(env);

      const result = await mutateBookings(env, (bookings) => {
        const idx = bookings.findIndex(b => b.id === bookingId);
        if (idx < 0) return { error: 'Бронирование не найдено', status: 404 };

        const current = bookings[idx];
        const owner = usersMap.get(current.userId) || null;
        if (!canCancelBooking(auth.user, current, owner)) {
          return { error: 'Недостаточно прав для отмены', status: 403 };
        }

        if (current.status === 'cancelled') {
          return { bookings, meta: { cancelled: false, alreadyCancelled: true } };
        }

        const next = [...bookings];
        next[idx] = {
          ...current,
          status: 'cancelled',
          cancelledAt: new Date().toISOString(),
          cancelledBy: auth.user.id,
        };

        return { bookings: next, meta: { cancelled: true } };
      });

      if (!result.ok) return reply({ error: result.error || 'Ошибка отмены' }, result.status || 400);
      return reply({ ok: true, bookings: result.bookings, rev: result.rev, ...result.meta });
    }

    /* ── POST /bookings/replace-admin (admin) ─────────── */
    if (path === '/bookings/replace-admin' && method === 'POST') {
      if (auth.user.role !== 'admin') return reply({ error: 'Недостаточно прав' }, 403);
      const { bookings } = await request.json();
      if (!Array.isArray(bookings)) return reply({ error: 'Некорректный формат бронирований' }, 400);

      const result = await mutateBookings(env, () => ({ bookings: trimBookingsRetention(bookings), meta: {} }));
      if (!result.ok) return reply({ error: result.error || 'Ошибка обновления' }, result.status || 400);
      return reply({ ok: true, bookings: result.bookings, rev: result.rev });
    }

    /* ── GET /kv/:key (auth) ──────────────────────────── */
    if (path.startsWith('/kv') && method === 'GET') {
      const key = decodeURIComponent(path.slice(4)) || url.searchParams.get('key') || '';
      if (!key) {
        return reply({ keys: Array.from(SAFE_KV_KEYS) });
      }
      if (!SAFE_KV_KEYS.has(key)) {
        return reply({ error: 'Недопустимый ключ' }, 403);
      }

      const row = await env.DB.prepare('SELECT v FROM kv_store WHERE k = ?').bind(key).first();
      const value = row ? parseJsonSafe(row.v, null) : null;
      return reply({ key, value });
    }

    /* ── PUT /kv/:key (auth) ──────────────────────────── */
    if (path.startsWith('/kv') && method === 'PUT') {
      const key = decodeURIComponent(path.slice(4)) || url.searchParams.get('key') || '';
      if (!key) return reply({ error: 'Missing key' }, 400);
      if (!SAFE_KV_KEYS.has(key)) return reply({ error: 'Недопустимый ключ' }, 403);
      if (ADMIN_ONLY_KV_KEYS.has(key) && auth.user.role !== 'admin') {
        return reply({ error: 'Недостаточно прав' }, 403);
      }

      const body = await request.json();
      const value = body.value !== undefined ? body.value : body;

      await env.DB.prepare(
        "INSERT OR REPLACE INTO kv_store (k, v, updated_at) VALUES (?, ?, datetime('now'))"
      ).bind(key, JSON.stringify(value)).run();

      return reply({ ok: true, key });
    }

    return reply({ error: 'Not found', path }, 404);

  } catch (err) {
    console.error('[API]', err);
    return reply({ error: 'Internal error' }, 500);
  }
}
