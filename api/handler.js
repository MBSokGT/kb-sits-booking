import { Client as LdapClient } from 'ldapts';

/**
 * КБ Ситс — API handler (catch-all)
 * Handles: /api/auth/*, /api/users, /api/kv/:key, /api/bookings*
 * Expects: env.DB adapter with prepare().bind().first()/all()/run()
 */

const BASE_CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const SESSION_TTL_HOURS = 12;
const MAX_BOOKING_DATES_DEFAULT = 120;
const MAX_BOOKING_DATES_ADMIN = 730; // two years, aligns with retention window
const BOOKING_RETENTION_MS = 2 * 365 * 24 * 60 * 60 * 1000;
const BOOKING_STATE_KEY = 'bookings_state';
const LEGACY_BOOKINGS_KEY = 'bookings';
const BOOKINGS_REV_KEY = 'bookings_rev';
const DOMAIN_MIGRATION_KEY = 'domain_migration_v2';
const DOMAIN_SCHEMA_MIGRATION_KEY = 'domain_schema_migration_v1';
const DOMAIN_REV_PREFIX = 'rev:domain:';
const PASSWORD_HASH_PREFIX = 'pbkdf2_sha256';
const PASSWORD_HASH_ITERATIONS = 100000;
const PASSWORD_SALT_BYTES = 16;
const AUTH_COOKIE_NAME = 'ws_session';
const AUTH_COOKIE_MAX_AGE_SEC = SESSION_TTL_HOURS * 60 * 60;
const LDAP_EXTERNAL_PASSWORD_PREFIX = 'ldap_external$';
let domainInitPromise = null;

const SAFE_KV_KEYS = new Set([
  'coworkings',
  'floors',
  'spaces',
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

function parseEnvBool(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function shouldUseSecureCookie(request, env) {
  const forced = parseEnvBool(env.AUTH_COOKIE_SECURE);
  if (forced !== null) return forced;

  const xfp = String(request.headers.get('x-forwarded-proto') || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (xfp) return xfp === 'https';

  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return true;
  }
}

function buildSessionCookie(token, maxAgeSec = AUTH_COOKIE_MAX_AGE_SEC, secure = true) {
  const secureAttr = secure ? '; Secure' : '';
  return `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly${secureAttr}; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

function clearSessionCookie(secure = true) {
  const secureAttr = secure ? '; Secure' : '';
  return `${AUTH_COOKIE_NAME}=; Path=/; HttpOnly${secureAttr}; SameSite=Lax; Max-Age=0`;
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
      return Number.isFinite(endMs) && (now - endMs) <= BOOKING_RETENTION_MS;
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
  if (isLdapExternalPassword(saved)) return false;
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

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email));
}

function isLdapExternalPassword(value) {
  return typeof value === 'string' && value.startsWith(LDAP_EXTERNAL_PASSWORD_PREFIX);
}

function isLdapEnabled(env) {
  return String(env.LDAP_ENABLED || '0').trim() === '1';
}

function parseBool(value, defaultValue = false) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function normalizeLdapLogin(login) {
  const raw = String(login || '').trim();
  if (!raw) return '';
  if (raw.includes('\\')) return raw.split('\\').pop().trim();
  return raw;
}

function escapeLdapFilterValue(value) {
  return String(value)
    .replace(/\\/g, '\\5c')
    .replace(/\*/g, '\\2a')
    .replace(/\(/g, '\\28')
    .replace(/\)/g, '\\29')
    .replace(/\u0000/g, '\\00');
}

function ldapAttrFirstString(entry, key) {
  const value = entry?.[key];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string' && item.trim()) return item.trim();
      if (item && typeof item === 'object' && typeof item.toString === 'function') {
        const text = item.toString();
        if (text && text !== '[object Object]') return text.trim();
      }
    }
    return '';
  }
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && typeof value.toString === 'function') {
    const text = value.toString();
    if (text && text !== '[object Object]') return text.trim();
  }
  return '';
}

function ldapAttrStringArray(entry, key) {
  const value = entry?.[key];
  if (Array.isArray(value)) {
    return value
      .map(v => (typeof v === 'string' ? v.trim() : String(v || '').trim()))
      .filter(Boolean);
  }
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  return [];
}

function normalizeDn(value) {
  return String(value || '').trim().toLowerCase();
}

function mapRoleFromLdapGroups(groups, env) {
  const adminGroupDn = normalizeDn(env.LDAP_ROLE_ADMIN_GROUP_DN || '');
  const managerGroupDn = normalizeDn(env.LDAP_ROLE_MANAGER_GROUP_DN || '');
  const normalizedGroups = new Set((groups || []).map(normalizeDn).filter(Boolean));

  if (adminGroupDn && normalizedGroups.has(adminGroupDn)) return 'admin';
  if (managerGroupDn && normalizedGroups.has(managerGroupDn)) return 'manager';
  return 'user';
}

function buildFallbackLdapEmail(login, env) {
  const candidate = normalizeLdapLogin(login).toLowerCase();
  if (!candidate) return '';
  if (candidate.includes('@')) return candidate;
  const domain = String(env.LDAP_FALLBACK_EMAIL_DOMAIN || 'ldap.local').trim().toLowerCase() || 'ldap.local';
  return `${candidate}@${domain}`;
}

function buildLdapUserFilter(env, login) {
  const escaped = escapeLdapFilterValue(login);
  const rawTemplate = String(
    env.LDAP_USER_FILTER ||
    '(|(sAMAccountName={{login}})(userPrincipalName={{login}})(mail={{login}}))'
  ).trim();
  return rawTemplate.includes('{{login}}')
    ? rawTemplate.replaceAll('{{login}}', escaped)
    : rawTemplate;
}

function createLdapClient(env) {
  const url = String(env.LDAP_URL || '').trim();
  const rejectUnauthorized = parseBool(env.LDAP_TLS_REJECT_UNAUTHORIZED, true);
  return new LdapClient({
    url,
    timeout: Number(env.LDAP_TIMEOUT_MS || 5000),
    connectTimeout: Number(env.LDAP_CONNECT_TIMEOUT_MS || 5000),
    tlsOptions: { rejectUnauthorized },
  });
}

async function upsertLdapUser(env, profile) {
  const existing = await env.DB.prepare(
    'SELECT id, password, role FROM users WHERE email = ?'
  ).bind(profile.email).first();

  const ldapMarkerPassword = `${LDAP_EXTERNAL_PASSWORD_PREFIX}${profile.externalId}`;
  let userId = '';

  if (existing?.id) {
    userId = existing.id;
    // Preserve existing role — it may have been manually set by an admin.
    const nextRole = existing.role || 'user';
    const nextPassword = isLdapExternalPassword(existing.password) ? ldapMarkerPassword : existing.password;

    await env.DB.prepare(
      'UPDATE users SET name = ?, department = ?, role = ?, password = ? WHERE id = ?'
    ).bind(profile.name, profile.department, nextRole, nextPassword, userId).run();
  } else {
    userId = `ldap_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    // New users always start as 'user'. Admins assign manager/admin roles manually.
    await env.DB.prepare(
      'INSERT INTO users (id, email, password, name, department, role) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(userId, profile.email, ldapMarkerPassword, profile.name, profile.department, 'user').run();
  }

  await ensureUserDepartmentMembership(env, userId, profile.department);

  return env.DB.prepare(
    'SELECT id, email, name, department, role, blocked, last_login FROM users WHERE id = ?'
  ).bind(userId).first();
}

async function tryLdapLogin(env, loginInput, password) {
  if (!isLdapEnabled(env)) return null;
  const ldapUrl = String(env.LDAP_URL || '').trim();
  const ldapBaseDn = String(env.LDAP_BASE_DN || '').trim();
  if (!ldapUrl || !ldapBaseDn) return null;

  const login = normalizeLdapLogin(loginInput);
  if (!login || !password) return { ok: false };

  const serviceBindDn = String(env.LDAP_BIND_DN || '').trim();
  const serviceBindPassword = String(env.LDAP_BIND_PASSWORD || '');
  const searchFilter = buildLdapUserFilter(env, login);

  const serviceClient = createLdapClient(env);
  let entry = null;
  try {
    if (serviceBindDn) {
      await serviceClient.bind(serviceBindDn, serviceBindPassword);
    }
    const { searchEntries } = await serviceClient.search(ldapBaseDn, {
      scope: 'sub',
      filter: searchFilter,
      attributes: ['dn', 'distinguishedName', 'displayName', 'cn', 'mail', 'department', 'memberOf', 'userPrincipalName'],
      sizeLimit: 2,
    });
    if (!Array.isArray(searchEntries) || searchEntries.length < 1) {
      return { ok: false };
    }
    entry = searchEntries[0];
  } catch (error) {
    console.error('[LDAP] search failed', error);
    return { ok: false };
  } finally {
    try { await serviceClient.unbind(); } catch {}
  }

  const userDn = ldapAttrFirstString(entry, 'dn') || ldapAttrFirstString(entry, 'distinguishedName');
  if (!userDn) return { ok: false };

  const userClient = createLdapClient(env);
  try {
    await userClient.bind(userDn, String(password));
  } catch {
    return { ok: false };
  } finally {
    try { await userClient.unbind(); } catch {}
  }

  const groups = ldapAttrStringArray(entry, 'memberOf');
  const role = mapRoleFromLdapGroups(groups, env);
  const email =
    ldapAttrFirstString(entry, 'mail').toLowerCase() ||
    ldapAttrFirstString(entry, 'userPrincipalName').toLowerCase() ||
    buildFallbackLdapEmail(login, env);
  if (!email) return { ok: false };

  const name =
    ldapAttrFirstString(entry, 'displayName') ||
    ldapAttrFirstString(entry, 'cn') ||
    login;
  const department =
    ldapAttrFirstString(entry, 'department') ||
    String(env.LDAP_DEFAULT_DEPARTMENT || 'Домен');
  const externalId = userDn.toLowerCase();

  const user = await upsertLdapUser(env, {
    email,
    name,
    department,
    role,
    externalId,
  });
  if (!user) return { ok: false };

  return { ok: true, user };
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
    'SELECT id, email, name, department, role, blocked FROM users WHERE id = ?'
  ).bind(payload.userId).first();

  if (!user) {
    await deleteSession(env, token);
    return null;
  }
  if (Number(user.blocked || 0) === 1) {
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
    'SELECT id, email, name, department, role, password, blocked, last_login FROM users ORDER BY role DESC, name'
  ).all();
  const withSessionActive = !!options.withSessionActive;
  const activeUserIds = withSessionActive ? await getActiveSessionUserIds(env) : null;
  const list = (results || []).map(({ password, blocked, last_login, ...u }) => ({
    ...u,
    blocked: Number(blocked || 0) === 1,
    lastLogin: last_login || null,
    isLdap: isLdapExternalPassword(password),
    ...(withSessionActive ? { sessionActive: activeUserIds.has(u.id) } : {}),
  }));
  const map = new Map();
  for (const u of list) map.set(u.id, u);
  return { list, map };
}

function normalizeDepartmentName(name) {
  return String(name || '').trim();
}

async function ensureUserDepartmentMembership(env, userId, departmentName) {
  const cleanName = normalizeDepartmentName(departmentName);
  if (!cleanName || !userId) return;

  let row = await firstSql(
    env,
    'SELECT id FROM departments WHERE LOWER(name) = LOWER(?)',
    [cleanName]
  );
  let departmentId = row?.id ? String(row.id) : '';
  let changed = false;

  if (!departmentId) {
    departmentId = `dep_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    await runSql(
      env,
      "INSERT INTO departments (id, name, head_user_id, updated_at) VALUES (?, ?, NULL, datetime('now'))",
      [departmentId, cleanName]
    );
    changed = true;
  }

  const existing = await firstSql(
    env,
    'SELECT 1 FROM department_members WHERE user_id = ? AND department_id = ?',
    [userId, departmentId]
  );
  if (!existing) {
    await runSql(env, 'DELETE FROM department_members WHERE user_id = ?', [userId]);
    await runSql(
      env,
      'INSERT OR IGNORE INTO department_members (department_id, user_id) VALUES (?, ?)',
      [departmentId, userId]
    );
    changed = true;
  }

  if (changed) await bumpDomainRev(env, 'departments');
}

async function getTargetUser(env, userId) {
  return env.DB.prepare('SELECT id, email, name, department, role, blocked FROM users WHERE id = ?').bind(userId).first();
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
  const row = await env.DB.prepare('SELECT label FROM spaces WHERE id = ?').bind(String(spaceId)).first();
  return row?.label ? String(row.label) : String(spaceId);
}

function sqlPlaceholders(count) {
  return Array.from({ length: count }, () => '?').join(', ');
}

async function runSql(env, sql, params = []) {
  return env.DB.prepare(sql).bind(...params).run();
}

async function firstSql(env, sql, params = []) {
  return env.DB.prepare(sql).bind(...params).first();
}

async function allSql(env, sql, params = []) {
  return env.DB.prepare(sql).bind(...params).all();
}

async function getBookingsRev(env) {
  const row = await firstSql(env, 'SELECT v FROM kv_store WHERE k = ?', [BOOKINGS_REV_KEY]);
  const rev = Number(row?.v);
  return Number.isInteger(rev) && rev > 0 ? rev : 1;
}

async function setBookingsRev(env, rev) {
  const clean = Number.isInteger(rev) && rev > 0 ? rev : 1;
  await runSql(
    env,
    "INSERT OR REPLACE INTO kv_store (k, v, updated_at) VALUES (?, ?, datetime('now'))",
    [BOOKINGS_REV_KEY, String(clean)]
  );
  return clean;
}

async function bumpBookingsRev(env) {
  const next = (await getBookingsRev(env)) + 1;
  return setBookingsRev(env, next);
}

function domainRevKey(key) {
  return `${DOMAIN_REV_PREFIX}${key}`;
}

async function getDomainRev(env, key) {
  const row = await firstSql(env, 'SELECT v FROM kv_store WHERE k = ?', [domainRevKey(key)]);
  const rev = Number(row?.v);
  return Number.isInteger(rev) && rev > 0 ? rev : 1;
}

async function setDomainRev(env, key, rev) {
  const clean = Number.isInteger(rev) && rev > 0 ? rev : 1;
  await runSql(
    env,
    "INSERT OR REPLACE INTO kv_store (k, v, updated_at) VALUES (?, ?, datetime('now'))",
    [domainRevKey(key), String(clean)]
  );
  return clean;
}

async function bumpDomainRev(env, key) {
  const next = (await getDomainRev(env, key)) + 1;
  return setDomainRev(env, key, next);
}

async function runInTransaction(env, action) {
  await runSql(env, 'BEGIN IMMEDIATE');
  try {
    const result = await action();
    await runSql(env, 'COMMIT');
    return result;
  } catch (error) {
    try {
      await runSql(env, 'ROLLBACK');
    } catch {}
    throw error;
  }
}

function normalizeHexColor(value, fallback = '#059669') {
  const color = String(value || '').trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : fallback;
}

function normalizeCoworking(raw) {
  const id = String(raw?.id || '').trim();
  const name = String(raw?.name || '').trim();
  if (!id || !name) return null;
  return { id, name };
}

function normalizeFloor(raw) {
  const id = String(raw?.id || '').trim();
  const coworkingId = String(raw?.coworkingId || '').trim();
  const name = String(raw?.name || '').trim();
  if (!id || !coworkingId || !name) return null;
  const sortOrderNum = Number(raw?.sortOrder);
  const sortOrder = Number.isFinite(sortOrderNum) ? Math.round(sortOrderNum) : 0;
  const imageUrl = raw?.imageUrl === undefined || raw?.imageUrl === null || raw?.imageUrl === '' ? null : String(raw.imageUrl);
  const imageType = raw?.imageType === undefined || raw?.imageType === null || raw?.imageType === '' ? null : String(raw.imageType);
  return { id, coworkingId, name, imageUrl, imageType, sortOrder };
}

function normalizeSpace(raw) {
  const id = String(raw?.id || '').trim();
  const floorId = String(raw?.floorId || '').trim();
  const label = String(raw?.label || '').trim();
  if (!id || !floorId || !label) return null;

  const seatsNum = Number(raw?.seats);
  const seats = Number.isFinite(seatsNum) && seatsNum > 0 ? Math.round(seatsNum) : 1;
  const x = Number.isFinite(Number(raw?.x)) ? Number(raw.x) : 0;
  const y = Number.isFinite(Number(raw?.y)) ? Number(raw.y) : 0;
  const w = Number.isFinite(Number(raw?.w)) ? Number(raw.w) : 10;
  const h = Number.isFinite(Number(raw?.h)) ? Number(raw.h) : 10;
  const color = normalizeHexColor(raw?.color, '#059669');

  return { id, floorId, label, seats, x, y, w, h, color };
}

function normalizeDepartment(raw) {
  const id = String(raw?.id || '').trim();
  const name = String(raw?.name || '').trim();
  if (!id || !name) return null;
  const headUserId = raw?.headUserId ? String(raw.headUserId).trim() : null;
  const memberIds = Array.isArray(raw?.memberIds)
    ? Array.from(new Set(raw.memberIds.map(v => String(v || '').trim()).filter(Boolean)))
    : [];
  return { id, name, headUserId: headUserId || null, memberIds };
}

function normalizeWorkingSaturday(raw) {
  const date = String(raw || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

async function replaceCoworkingsTable(env, value) {
  if (!Array.isArray(value)) return { ok: false, status: 400, error: 'Некорректный формат данных' };
  const rows = value.map(normalizeCoworking).filter(Boolean);
  const { results: existingRows } = await allSql(env, 'SELECT id FROM coworkings');
  const nextIds = new Set(rows.map(row => row.id));
  const removedIds = (existingRows || []).map(row => String(row.id)).filter(id => !nextIds.has(id));
  if (removedIds.length) {
    const placeholders = sqlPlaceholders(removedIds.length);
    const cutoffMs = Date.now() - BOOKING_RETENTION_MS;
    const row = await firstSql(
      env,
      `SELECT COUNT(*) AS cnt
       FROM bookings b
       JOIN spaces s ON s.id = b.space_id
       JOIN floors f ON f.id = s.floor_id
       WHERE f.coworking_id IN (${placeholders}) AND b.end_utc_ms >= ?`,
      [...removedIds, cutoffMs]
    );
    const cnt = Number(row?.cnt || 0);
    if (cnt > 0) {
      return { ok: false, status: 400, error: 'Нельзя удалить коворкинг, пока есть брони за последние 2 года.' };
    }
  }
  await runInTransaction(env, async () => {
    await runSql(env, 'DELETE FROM coworkings');
    for (const row of rows) {
      await runSql(
        env,
        "INSERT INTO coworkings (id, name, updated_at) VALUES (?, ?, datetime('now'))",
        [row.id, row.name]
      );
    }
  });
  return { ok: true };
}

async function replaceFloorsTable(env, value) {
  if (!Array.isArray(value)) return { ok: false, status: 400, error: 'Некорректный формат данных' };
  const rows = value.map(normalizeFloor).filter(Boolean);
  const { results } = await allSql(env, 'SELECT id FROM coworkings');
  const coworkingIds = new Set((results || []).map(row => String(row.id)));
  const invalid = rows.find(row => !coworkingIds.has(row.coworkingId));
  if (invalid) {
    return { ok: false, status: 400, error: `Не найден коворкинг для этажа: ${invalid.name}` };
  }

  const { results: existingRows } = await allSql(env, 'SELECT id FROM floors');
  const nextIds = new Set(rows.map(row => row.id));
  const removedIds = (existingRows || []).map(row => String(row.id)).filter(id => !nextIds.has(id));
  if (removedIds.length) {
    const placeholders = sqlPlaceholders(removedIds.length);
    const cutoffMs = Date.now() - BOOKING_RETENTION_MS;
    const row = await firstSql(
      env,
      `SELECT COUNT(*) AS cnt
       FROM bookings b
       JOIN spaces s ON s.id = b.space_id
       WHERE s.floor_id IN (${placeholders}) AND b.end_utc_ms >= ?`,
      [...removedIds, cutoffMs]
    );
    const cnt = Number(row?.cnt || 0);
    if (cnt > 0) {
      return { ok: false, status: 400, error: 'Нельзя удалить этаж, пока есть брони за последние 2 года.' };
    }
  }

  await runInTransaction(env, async () => {
    await runSql(env, 'DELETE FROM floors');
    for (const row of rows) {
      await runSql(
        env,
        "INSERT INTO floors (id, coworking_id, name, image_url, image_type, sort_order, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
        [row.id, row.coworkingId, row.name, row.imageUrl, row.imageType, row.sortOrder]
      );
    }
  });
  return { ok: true };
}

async function replaceSpacesTable(env, value) {
  if (!Array.isArray(value)) return { ok: false, status: 400, error: 'Некорректный формат данных' };
  const rows = value.map(normalizeSpace).filter(Boolean);
  const { results } = await allSql(env, 'SELECT id FROM floors');
  const floorIds = new Set((results || []).map(row => String(row.id)));
  const invalid = rows.find(row => !floorIds.has(row.floorId));
  if (invalid) {
    return { ok: false, status: 400, error: `Не найден этаж для зоны: ${invalid.label}` };
  }

  const { results: existingRows } = await allSql(env, 'SELECT id FROM spaces');
  const nextIds = new Set(rows.map(row => row.id));
  const removedIds = (existingRows || []).map(row => String(row.id)).filter(id => !nextIds.has(id));
  if (removedIds.length) {
    const placeholders = sqlPlaceholders(removedIds.length);
    const cutoffMs = Date.now() - BOOKING_RETENTION_MS;
    const row = await firstSql(
      env,
      `SELECT COUNT(*) AS cnt
       FROM bookings
       WHERE space_id IN (${placeholders}) AND end_utc_ms >= ?`,
      [...removedIds, cutoffMs]
    );
    const cnt = Number(row?.cnt || 0);
    if (cnt > 0) {
      return { ok: false, status: 400, error: 'Нельзя удалить рабочее место, пока есть брони за последние 2 года.' };
    }
  }

  await runInTransaction(env, async () => {
    await runSql(env, 'DELETE FROM spaces');
    for (const row of rows) {
      await runSql(
        env,
        "INSERT INTO spaces (id, floor_id, label, seats, x, y, w, h, color, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        [row.id, row.floorId, row.label, row.seats, row.x, row.y, row.w, row.h, row.color]
      );
    }
  });
  return { ok: true };
}

async function replaceDepartmentsTable(env, value) {
  if (!Array.isArray(value)) return { ok: false, status: 400, error: 'Некорректный формат данных' };
  const rows = value.map(normalizeDepartment).filter(Boolean);
  await runInTransaction(env, async () => {
    await runSql(env, 'DELETE FROM department_members');
    await runSql(env, 'DELETE FROM departments');

    for (const row of rows) {
      await runSql(
        env,
        "INSERT INTO departments (id, name, head_user_id, updated_at) VALUES (?, ?, ?, datetime('now'))",
        [row.id, row.name, row.headUserId]
      );
      for (const userId of row.memberIds) {
        await runSql(
          env,
          "INSERT OR IGNORE INTO department_members (department_id, user_id) VALUES (?, ?)",
          [row.id, userId]
        );
      }
    }
  });
  return { ok: true };
}

async function replaceWorkingSaturdaysTable(env, value) {
  if (!Array.isArray(value)) return { ok: false, status: 400, error: 'Некорректный формат данных' };
  const dates = Array.from(new Set(value.map(normalizeWorkingSaturday).filter(Boolean))).sort();
  await runInTransaction(env, async () => {
    await runSql(env, 'DELETE FROM working_saturdays');
    for (const date of dates) {
      await runSql(env, 'INSERT OR IGNORE INTO working_saturdays (date) VALUES (?)', [date]);
    }
  });
  return { ok: true };
}

async function readCoworkingsTable(env) {
  const { results } = await allSql(env, 'SELECT id, name FROM coworkings ORDER BY created_at, name');
  const rows = results || [];
  if (!rows.length) return null;
  return rows.map(row => ({ id: row.id, name: row.name }));
}

async function readFloorsTable(env) {
  const { results } = await allSql(
    env,
    'SELECT id, coworking_id, name, image_url, image_type, sort_order FROM floors ORDER BY sort_order, name'
  );
  const rows = results || [];
  if (!rows.length) return null;
  return rows.map(row => ({
    id: row.id,
    coworkingId: row.coworking_id,
    name: row.name,
    imageUrl: row.image_url ?? null,
    imageType: row.image_type ?? null,
    sortOrder: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 0,
  }));
}

async function readSpacesTable(env) {
  const { results } = await allSql(
    env,
    'SELECT id, floor_id, label, seats, x, y, w, h, color FROM spaces ORDER BY floor_id, label'
  );
  const rows = results || [];
  if (!rows.length) return null;
  return rows.map(row => ({
    id: row.id,
    floorId: row.floor_id,
    label: row.label,
    seats: Number.isFinite(Number(row.seats)) ? Number(row.seats) : 1,
    x: Number.isFinite(Number(row.x)) ? Number(row.x) : 0,
    y: Number.isFinite(Number(row.y)) ? Number(row.y) : 0,
    w: Number.isFinite(Number(row.w)) ? Number(row.w) : 10,
    h: Number.isFinite(Number(row.h)) ? Number(row.h) : 10,
    color: normalizeHexColor(row.color, '#059669'),
  }));
}

async function readDepartmentsTable(env) {
  const { results } = await allSql(env, 'SELECT id, name, head_user_id FROM departments ORDER BY name');
  const departments = results || [];
  if (!departments.length) return null;
  const { results: membersRows } = await allSql(
    env,
    'SELECT department_id, user_id FROM department_members ORDER BY department_id, user_id'
  );

  const membersByDepartment = new Map();
  for (const row of (membersRows || [])) {
    if (!membersByDepartment.has(row.department_id)) membersByDepartment.set(row.department_id, []);
    membersByDepartment.get(row.department_id).push(String(row.user_id));
  }

  return departments.map(row => ({
    id: row.id,
    name: row.name,
    headUserId: row.head_user_id || null,
    memberIds: membersByDepartment.get(row.id) || [],
  }));
}

async function readWorkingSaturdaysTable(env) {
  const { results } = await allSql(env, 'SELECT date FROM working_saturdays ORDER BY date');
  const rows = results || [];
  if (!rows.length) return null;
  return rows.map(row => row.date);
}

async function readDomainValue(env, key) {
  if (key === 'coworkings') return readCoworkingsTable(env);
  if (key === 'floors') return readFloorsTable(env);
  if (key === 'spaces') return readSpacesTable(env);
  if (key === 'departments') return readDepartmentsTable(env);
  return null;
}

async function writeDomainValue(env, key, value) {
  if (key === 'coworkings') return replaceCoworkingsTable(env, value);
  if (key === 'floors') return replaceFloorsTable(env, value);
  if (key === 'spaces') return replaceSpacesTable(env, value);
  if (key === 'departments') return replaceDepartmentsTable(env, value);
  return { ok: false, status: 400, error: 'Недопустимый ключ' };
}

async function insertBookingRecord(env, booking) {
  const normalized = normalizeBooking(booking);
  if (!normalized) return false;
  const endUtcMs = parseMskDateTimeToUtcMs(normalized.date, normalized.slotTo);
  if (!Number.isFinite(endUtcMs)) return false;

  await runSql(
    env,
    `INSERT OR REPLACE INTO bookings
      (id, user_id, user_name, space_id, space_name, date, slot_from, slot_to, expires_at, end_utc_ms, created_at, status, created_by, cancelled_at, cancelled_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      normalized.id,
      normalized.userId,
      normalized.userName,
      normalized.spaceId,
      normalized.spaceName,
      normalized.date,
      normalized.slotFrom,
      normalized.slotTo,
      normalized.expiresAt,
      endUtcMs,
      normalized.createdAt,
      normalized.status,
      normalized.createdBy,
      normalized.cancelledAt,
      normalized.cancelledBy,
    ]
  );
  return true;
}

async function purgeOldBookings(env) {
  const cutoffMs = Date.now() - BOOKING_RETENTION_MS;
  await runSql(env, 'DELETE FROM bookings WHERE end_utc_ms < ?', [cutoffMs]);
}

async function loadBookings(env) {
  await purgeOldBookings(env);
  const cutoffMs = Date.now() - BOOKING_RETENTION_MS;
  const { results } = await allSql(
    env,
    `SELECT
      id,
      user_id AS userId,
      user_name AS userName,
      space_id AS spaceId,
      space_name AS spaceName,
      date,
      slot_from AS slotFrom,
      slot_to AS slotTo,
      expires_at AS expiresAt,
      created_at AS createdAt,
      status,
      created_by AS createdBy,
      cancelled_at AS cancelledAt,
      cancelled_by AS cancelledBy
     FROM bookings
     WHERE end_utc_ms >= ?
     ORDER BY date ASC, slot_from ASC, created_at ASC`,
    [cutoffMs]
  );
  return (results || []).map(normalizeBooking).filter(Boolean);
}

async function loadActiveBookingsByDates(env, dates, nowMs = Date.now()) {
  if (!Array.isArray(dates) || !dates.length) return [];
  const placeholders = sqlPlaceholders(dates.length);
  const { results } = await allSql(
    env,
    `SELECT
      id,
      user_id AS userId,
      user_name AS userName,
      space_id AS spaceId,
      space_name AS spaceName,
      date,
      slot_from AS slotFrom,
      slot_to AS slotTo,
      expires_at AS expiresAt,
      created_at AS createdAt,
      status,
      created_by AS createdBy,
      cancelled_at AS cancelledAt,
      cancelled_by AS cancelledBy
     FROM bookings
     WHERE status = 'active' AND end_utc_ms > ? AND date IN (${placeholders})
     ORDER BY date ASC, slot_from ASC, created_at ASC`,
    [nowMs, ...dates]
  );
  return (results || []).map(normalizeBooking).filter(Boolean);
}

async function createDomainTables(env) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS coworkings (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS floors (
      id TEXT PRIMARY KEY,
      coworking_id TEXT NOT NULL,
      name TEXT NOT NULL,
      image_url TEXT,
      image_type TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (coworking_id) REFERENCES coworkings(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS spaces (
      id TEXT PRIMARY KEY,
      floor_id TEXT NOT NULL,
      label TEXT NOT NULL,
      seats INTEGER NOT NULL DEFAULT 1,
      x REAL NOT NULL DEFAULT 0,
      y REAL NOT NULL DEFAULT 0,
      w REAL NOT NULL DEFAULT 10,
      h REAL NOT NULL DEFAULT 10,
      color TEXT NOT NULL DEFAULT '#059669',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (floor_id) REFERENCES floors(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      head_user_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS department_members (
      department_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (department_id, user_id),
      FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS working_saturdays (
      date TEXT PRIMARY KEY
    )`,
    `CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      space_id TEXT NOT NULL,
      space_name TEXT NOT NULL,
      date TEXT NOT NULL,
      slot_from TEXT NOT NULL,
      slot_to TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      end_utc_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'active',
      created_by TEXT,
      cancelled_at TEXT,
      cancelled_by TEXT
    )`,
    'CREATE INDEX IF NOT EXISTS idx_floors_coworking ON floors(coworking_id)',
    'CREATE INDEX IF NOT EXISTS idx_spaces_floor ON spaces(floor_id)',
    'CREATE INDEX IF NOT EXISTS idx_dept_members_dept ON department_members(department_id)',
    'CREATE INDEX IF NOT EXISTS idx_dept_members_user ON department_members(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_bookings_status_end ON bookings(status, end_utc_ms)',
    'CREATE INDEX IF NOT EXISTS idx_bookings_space_date ON bookings(space_id, date)',
    'CREATE INDEX IF NOT EXISTS idx_bookings_user_date ON bookings(user_id, date)',
  ];

  for (const sql of statements) {
    await runSql(env, sql);
  }
}

async function migrateDomainSchemaToRelational(env) {
  const marker = await firstSql(env, 'SELECT v FROM kv_store WHERE k = ?', [DOMAIN_SCHEMA_MIGRATION_KEY]);
  if (marker?.v === '1') return;

  await runSql(env, 'PRAGMA foreign_keys = OFF');
  try {
    await runInTransaction(env, async () => {
      await runSql(env, 'DROP TABLE IF EXISTS floors_old');
      await runSql(env, 'DROP TABLE IF EXISTS spaces_old');
      await runSql(env, 'DROP TABLE IF EXISTS department_members_old');

      await runSql(env, 'ALTER TABLE floors RENAME TO floors_old');
      await runSql(
        env,
        `CREATE TABLE floors (
          id TEXT PRIMARY KEY,
          coworking_id TEXT NOT NULL,
          name TEXT NOT NULL,
          image_url TEXT,
          image_type TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (coworking_id) REFERENCES coworkings(id) ON DELETE CASCADE
        )`
      );
      await runSql(
        env,
        `INSERT INTO floors (id, coworking_id, name, image_url, image_type, sort_order, created_at, updated_at)
         SELECT f.id, f.coworking_id, f.name, f.image_url, f.image_type, f.sort_order, f.created_at, f.updated_at
         FROM floors_old f
         JOIN coworkings c ON c.id = f.coworking_id`
      );
      await runSql(env, 'DROP TABLE floors_old');

      await runSql(env, 'ALTER TABLE spaces RENAME TO spaces_old');
      await runSql(
        env,
        `CREATE TABLE spaces (
          id TEXT PRIMARY KEY,
          floor_id TEXT NOT NULL,
          label TEXT NOT NULL,
          seats INTEGER NOT NULL DEFAULT 1,
          x REAL NOT NULL DEFAULT 0,
          y REAL NOT NULL DEFAULT 0,
          w REAL NOT NULL DEFAULT 10,
          h REAL NOT NULL DEFAULT 10,
          color TEXT NOT NULL DEFAULT '#059669',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (floor_id) REFERENCES floors(id) ON DELETE CASCADE
        )`
      );
      await runSql(
        env,
        `INSERT INTO spaces (id, floor_id, label, seats, x, y, w, h, color, created_at, updated_at)
         SELECT s.id, s.floor_id, s.label, s.seats, s.x, s.y, s.w, s.h, s.color, s.created_at, s.updated_at
         FROM spaces_old s
         JOIN floors f ON f.id = s.floor_id`
      );
      await runSql(env, 'DROP TABLE spaces_old');

      await runSql(env, 'ALTER TABLE department_members RENAME TO department_members_old');
      await runSql(
        env,
        `CREATE TABLE department_members (
          department_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          PRIMARY KEY (department_id, user_id),
          FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`
      );
      await runSql(
        env,
        `INSERT INTO department_members (department_id, user_id)
         SELECT dm.department_id, dm.user_id
         FROM department_members_old dm
         JOIN departments d ON d.id = dm.department_id
         JOIN users u ON u.id = dm.user_id`
      );
      await runSql(env, 'DROP TABLE department_members_old');
    });
  } finally {
    await runSql(env, 'PRAGMA foreign_keys = ON');
  }

  await runSql(env, 'CREATE INDEX IF NOT EXISTS idx_floors_coworking ON floors(coworking_id)');
  await runSql(env, 'CREATE INDEX IF NOT EXISTS idx_spaces_floor ON spaces(floor_id)');
  await runSql(env, 'CREATE INDEX IF NOT EXISTS idx_dept_members_dept ON department_members(department_id)');
  await runSql(env, 'CREATE INDEX IF NOT EXISTS idx_dept_members_user ON department_members(user_id)');
  await runSql(
    env,
    "INSERT OR REPLACE INTO kv_store (k, v, updated_at) VALUES (?, ?, datetime('now'))",
    [DOMAIN_SCHEMA_MIGRATION_KEY, '1']
  );
}

async function ensureDomainRevisions(env) {
  for (const key of SAFE_KV_KEYS) {
    const row = await firstSql(env, 'SELECT v FROM kv_store WHERE k = ?', [domainRevKey(key)]);
    if (!row?.v) {
      await setDomainRev(env, key, 1);
      continue;
    }
    const rev = Number(row.v);
    if (!Number.isInteger(rev) || rev < 1) {
      await setDomainRev(env, key, 1);
    }
  }
}

async function tableRowCount(env, tableName) {
  const row = await firstSql(env, `SELECT COUNT(*) AS cnt FROM ${tableName}`);
  return Number(row?.cnt || 0);
}

async function migrateLegacyDomainData(env) {
  const marker = await firstSql(env, 'SELECT v FROM kv_store WHERE k = ?', [DOMAIN_MIGRATION_KEY]);
  if (marker?.v === '1') {
    const rev = await getBookingsRev(env);
    if (!Number.isInteger(rev) || rev < 1) await setBookingsRev(env, 1);
    return;
  }

  if (await tableRowCount(env, 'coworkings') === 0) {
    const row = await firstSql(env, 'SELECT v FROM kv_store WHERE k = ?', ['coworkings']);
    const parsed = row ? parseJsonSafe(row.v, null) : null;
    if (Array.isArray(parsed) && parsed.length) await replaceCoworkingsTable(env, parsed);
  }

  if (await tableRowCount(env, 'floors') === 0) {
    const row = await firstSql(env, 'SELECT v FROM kv_store WHERE k = ?', ['floors']);
    const parsed = row ? parseJsonSafe(row.v, null) : null;
    if (Array.isArray(parsed) && parsed.length) await replaceFloorsTable(env, parsed);
  }

  if (await tableRowCount(env, 'spaces') === 0) {
    const row = await firstSql(env, 'SELECT v FROM kv_store WHERE k = ?', ['spaces']);
    const parsed = row ? parseJsonSafe(row.v, null) : null;
    if (Array.isArray(parsed) && parsed.length) await replaceSpacesTable(env, parsed);
  }

  if (await tableRowCount(env, 'departments') === 0) {
    const row = await firstSql(env, 'SELECT v FROM kv_store WHERE k = ?', ['departments']);
    const parsed = row ? parseJsonSafe(row.v, null) : null;
    if (Array.isArray(parsed) && parsed.length) {
      await replaceDepartmentsTable(env, parsed);
      // Remove old KV entry so this migration doesn't re-run if all depts are later deleted
      await runSql(env, 'DELETE FROM kv_store WHERE k = ?', ['departments']);
    }
  }

  if (await tableRowCount(env, 'working_saturdays') === 0) {
    const row = await firstSql(env, 'SELECT v FROM kv_store WHERE k = ?', ['workingSaturdays']);
    const parsed = row ? parseJsonSafe(row.v, null) : null;
    if (Array.isArray(parsed) && parsed.length) await replaceWorkingSaturdaysTable(env, parsed);
  }

  if (await tableRowCount(env, 'bookings') === 0) {
    let rev = 1;
    let legacyBookings = [];

    const stateRow = await firstSql(env, 'SELECT v FROM kv_store WHERE k = ?', [BOOKING_STATE_KEY]);
    if (stateRow?.v) {
      const parsed = parseJsonSafe(stateRow.v, {});
      if (Number.isInteger(parsed?.rev) && parsed.rev > 0) rev = parsed.rev;
      legacyBookings = trimBookingsRetention(parsed?.bookings);
    }

    if (!legacyBookings.length) {
      const legacyRow = await firstSql(env, 'SELECT v FROM kv_store WHERE k = ?', [LEGACY_BOOKINGS_KEY]);
      if (legacyRow?.v) legacyBookings = trimBookingsRetention(parseJsonSafe(legacyRow.v, []));
    }

    for (const booking of legacyBookings) {
      await insertBookingRecord(env, booking);
    }
    await setBookingsRev(env, rev);
  } else {
    const rev = await getBookingsRev(env);
    if (!Number.isInteger(rev) || rev < 1) await setBookingsRev(env, 1);
  }

  await runSql(
    env,
    "INSERT OR REPLACE INTO kv_store (k, v, updated_at) VALUES (?, ?, datetime('now'))",
    [DOMAIN_MIGRATION_KEY, '1']
  );
}

async function ensureDomainTablesReady(env) {
  if (!domainInitPromise) {
    domainInitPromise = (async () => {
      await createDomainTables(env);
      await migrateDomainSchemaToRelational(env);
      await migrateLegacyDomainData(env);
      await ensureDomainRevisions(env);
    })().catch(error => {
      domainInitPromise = null;
      throw error;
    });
  }
  await domainInitPromise;
}

function validateCreatePayload(body) {
  const spaceId = String(body?.spaceId || '').trim();
  const slotFrom = String(body?.slotFrom || '').trim();
  const slotTo = String(body?.slotTo || '').trim();
  const targetUserId = String(body?.targetUserId || '').trim();
  const dates = Array.isArray(body?.dates) ? body.dates.map(v => String(v)).filter(Boolean) : [];

  if (!spaceId) return { error: 'Не указано место' };
  if (!dates.length) return { error: 'Не выбраны даты' };
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

    await ensureDomainTablesReady(env);

    /* ── POST /auth/login (public) ────────────────────── */
    if (path === '/auth/login' && method === 'POST') {
      const { email = '', login = '', password = '' } = await request.json();
      const loginRaw = String(login || email || '').trim();
      const loginLocalEmail = loginRaw.toLowerCase();
      const ip = getClientIp(request);
      const loginLimit = await checkRateLimit(env, `rl:auth:login:${ip}`, 20, 15 * 60);
      if (!loginLimit.ok) {
        return reply(
          { error: 'Слишком много попыток входа. Повторите позже.' },
          429,
          { 'Retry-After': String(loginLimit.retryAfterSec) }
        );
      }

      const ldapResult = await tryLdapLogin(env, loginRaw, password);
      if (ldapResult?.ok && ldapResult.user) {
        if (Number(ldapResult.user.blocked || 0) === 1) {
          return reply({ error: 'Аккаунт заблокирован. Обратитесь к администратору.' }, 403);
        }
        await ensureUserDepartmentMembership(env, ldapResult.user.id, ldapResult.user.department);
        await env.DB.prepare('UPDATE users SET last_login = datetime(\'now\') WHERE id = ?')
          .bind(ldapResult.user.id)
          .run();
        const { token } = await createSession(env, ldapResult.user.id);
        const secureCookie = shouldUseSecureCookie(request, env);
        return reply(
          { user: ldapResult.user },
          200,
          { 'Set-Cookie': buildSessionCookie(token, AUTH_COOKIE_MAX_AGE_SEC, secureCookie) }
        );
      }

      const row = await env.DB.prepare(
        'SELECT id, email, name, department, role, password, blocked FROM users WHERE email = ?'
      ).bind(loginLocalEmail).first();

      if (!row) return reply({ error: 'Неверный логин или пароль' }, 401);
      if (Number(row.blocked || 0) === 1) {
        return reply({ error: 'Аккаунт заблокирован. Обратитесь к администратору.' }, 403);
      }
      const ok = await verifyPassword(password, row.password);
      if (!ok) return reply({ error: 'Неверный логин или пароль' }, 401);

      if (!isHashedPassword(row.password) && !isLdapExternalPassword(row.password)) {
        const upgraded = await hashPassword(password);
        await env.DB.prepare('UPDATE users SET password = ? WHERE id = ?').bind(upgraded, row.id).run();
      }

      await env.DB.prepare('UPDATE users SET last_login = datetime(\'now\') WHERE id = ?')
        .bind(row.id)
        .run();

      await ensureUserDepartmentMembership(env, row.id, row.department);
      const { token } = await createSession(env, row.id);
      const secureCookie = shouldUseSecureCookie(request, env);
      const { password: _password, ...safeUser } = row;
      return reply(
        { user: safeUser },
        200,
        { 'Set-Cookie': buildSessionCookie(token, AUTH_COOKIE_MAX_AGE_SEC, secureCookie) }
      );
    }

    /* ── POST /auth/logout (public/auth) ──────────────── */
    if (path === '/auth/logout' && method === 'POST') {
      const token = getSessionToken(request);
      if (token) await deleteSession(env, token);
      const secureCookie = shouldUseSecureCookie(request, env);
      return reply(
        { ok: true },
        200,
        { 'Set-Cookie': clearSessionCookie(secureCookie) }
      );
    }

    /* ── POST /auth/register (public) ─────────────────── */
    if (path === '/auth/register' && method === 'POST') {
      return reply({ error: 'Саморегистрация отключена. Обратитесь к администратору.' }, 403);
    }

    /* ── POST /auth/forgot-password (public) ──────────── */
    if (path === '/auth/forgot-password' && method === 'POST') {
      return reply(
        { error: 'Восстановление пароля по email отключено. Обратитесь к администратору.' },
        403
      );
    }

    /* ── POST /auth/reset-password (public) ───────────── */
    if (path === '/auth/reset-password' && method === 'POST') {
      return reply(
        { error: 'Сброс пароля через email отключён. Обратитесь к администратору.' },
        403
      );
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
      if (isLdapExternalPassword(row.password)) {
        return reply({ error: 'Для доменного аккаунта пароль меняется в Active Directory.' }, 400);
      }
      const ok = await verifyPassword(oldPassword, row.password);
      if (!ok) return reply({ error: 'Неверный текущий пароль' }, 401);

      const passwordHash = await hashPassword(newPassword);
      await env.DB.prepare('UPDATE users SET password = ? WHERE id = ?').bind(passwordHash, row.id).run();
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
      const { name = '', email = '', password = '', department = '', role = 'user' } = await request.json();
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

      await ensureUserDepartmentMembership(env, id, departmentClean);

      const { list } = await getUsersMap(env);
      return reply({ ok: true, users: list });
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

    /* ── POST /users/block (admin) ────────────────────── */
    if (path === '/users/block' && method === 'POST') {
      if (auth.user.role !== 'admin') return reply({ error: 'Недостаточно прав' }, 403);
      const { id = '', blocked = false } = await request.json();
      const userId = String(id).trim();
      if (!userId) return reply({ error: 'Некорректные данные' }, 400);
      if (userId === auth.user.id) return reply({ error: 'Нельзя заблокировать себя' }, 400);

      const target = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first();
      if (!target) return reply({ error: 'Пользователь не найден' }, 404);

      const blockedValue = Number(blocked) === 1 || blocked === true ? 1 : 0;
      await env.DB.prepare('UPDATE users SET blocked = ? WHERE id = ?').bind(blockedValue, userId).run();
      if (blockedValue === 1) {
        await revokeUserSessions(env, userId);
      }
      const { list } = await getUsersMap(env, { withSessionActive: true });
      return reply({ ok: true, users: list });
    }

    /* ── POST /users/update (admin) ───────────────────── */
    if (path === '/users/update' && method === 'POST') {
      if (auth.user.role !== 'admin') return reply({ error: 'Недостаточно прав' }, 403);
      const { id = '', name = '', email = '', department = '' } = await request.json();
      const userId = String(id).trim();
      const nameClean = String(name).trim();
      const emailClean = String(email).trim().toLowerCase();
      const departmentClean = String(department).trim();
      if (!userId || !nameClean || !emailClean || !departmentClean) {
        return reply({ error: 'Заполните обязательные поля' }, 400);
      }
      if (!isValidEmail(emailClean)) return reply({ error: 'Некорректный email' }, 400);

      const target = await env.DB.prepare(
        'SELECT id, password FROM users WHERE id = ?'
      ).bind(userId).first();
      if (!target) return reply({ error: 'Пользователь не найден' }, 404);
      if (isLdapExternalPassword(target.password)) {
        return reply({ error: 'Это доменный аккаунт. Данные профиля обновляются в Active Directory.' }, 400);
      }

      const existing = await env.DB.prepare(
        'SELECT id FROM users WHERE email = ? AND id <> ?'
      ).bind(emailClean, userId).first();
      if (existing) return reply({ error: 'Email уже зарегистрирован' }, 409);

      await env.DB.prepare(
        'UPDATE users SET name = ?, email = ?, department = ? WHERE id = ?'
      ).bind(nameClean, emailClean, departmentClean, userId).run();

      await ensureUserDepartmentMembership(env, userId, departmentClean);

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
      await ensureUserDepartmentMembership(env, userId, departmentClean);
      const { list } = await getUsersMap(env, { withSessionActive: true });
      return reply({ ok: true, users: list });
    }

    /* ── POST /users/password (admin) ─────────────────── */
    if (path === '/users/password' && method === 'POST') {
      if (auth.user.role !== 'admin') return reply({ error: 'Недостаточно прав' }, 403);
      const { id = '', newPassword = '' } = await request.json();
      const userId = String(id).trim();
      const pass = String(newPassword);
      if (!userId) return reply({ error: 'Не указан пользователь' }, 400);
      if (!pass || pass.length < 6) return reply({ error: 'Пароль минимум 6 символов' }, 400);

      const target = await env.DB.prepare(
        'SELECT id, password FROM users WHERE id = ?'
      ).bind(userId).first();
      if (!target) return reply({ error: 'Пользователь не найден' }, 404);
      if (isLdapExternalPassword(target.password)) {
        return reply({ error: 'Для доменного аккаунта пароль меняется в Active Directory.' }, 400);
      }

      const passwordHash = await hashPassword(pass);
      await env.DB.prepare('UPDATE users SET password = ? WHERE id = ?').bind(passwordHash, userId).run();
      const keepToken = String(userId) === String(auth.user.id) ? auth.token : '';
      const revokedSessions = await revokeUserSessions(env, userId, keepToken);

      const { list } = await getUsersMap(env, { withSessionActive: true });
      return reply({ ok: true, users: list, revokedSessions });
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

      const nowIso = new Date().toISOString();
      const cancelResult = await runSql(
        env,
        `UPDATE bookings
         SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?
         WHERE user_id = ? AND status = 'active' AND end_utc_ms > ?`,
        [nowIso, auth.user.id, userId, Date.now()]
      );
      const cancelledBookings = Number(cancelResult?.meta?.changes || 0);
      let rev = await getBookingsRev(env);
      if (cancelledBookings > 0) rev = await bumpBookingsRev(env);

      await revokeUserSessions(env, userId);
      await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
      const bookings = await loadBookings(env);
      const { list } = await getUsersMap(env, { withSessionActive: true });
      return reply({ ok: true, users: list, bookings, rev, cancelledBookings });
    }

    /* ── GET /bookings (auth) ─────────────────────────── */
    if (path === '/bookings' && method === 'GET') {
      const bookings = await loadBookings(env);
      const rev = await getBookingsRev(env);
      return reply({ bookings, rev });
    }

    /* ── POST /bookings/create (auth) ─────────────────── */
    if (path === '/bookings/create' && method === 'POST') {
      const body = await request.json();
      const valid = validateCreatePayload(body);
      if (valid.error) return reply({ error: valid.error }, 400);
      const maxDates = auth.user.role === 'admin' ? MAX_BOOKING_DATES_ADMIN : MAX_BOOKING_DATES_DEFAULT;
      if (valid.dates.length > maxDates) {
        return reply({ error: `Слишком много дат в одном запросе (макс. ${maxDates})` }, 400);
      }

      const targetUserId = valid.targetUserId || auth.user.id;
      const targetUser = await getTargetUser(env, targetUserId);
      if (!targetUser) return reply({ error: 'Сотрудник не найден' }, 404);
      if (Number(targetUser.blocked || 0) === 1) {
        return reply({ error: 'Сотрудник заблокирован' }, 403);
      }
      if (!canManageTarget(auth.user, targetUser)) {
        return reply({ error: 'Недостаточно прав' }, 403);
      }

      const spaceRow = await firstSql(
        env,
        'SELECT id, label FROM spaces WHERE id = ?',
        [valid.spaceId]
      );
      if (!spaceRow?.id) {
        return reply({ error: 'Рабочее место не найдено или удалено. Обновите карту и выберите существующее место.' }, 400);
      }
      const spaceName = String(spaceRow.label || valid.spaceId);
      const nowMs = Date.now();
      const active = await loadActiveBookingsByDates(env, valid.dates, nowMs);

      let created = 0;
      let skippedBusy = 0;
      let skippedUser = 0;
      let skippedDailyLimit = 0;
      let skippedPast = 0;
      const createdDates = [];
      const skippedBusyDates = [];
      const skippedUserConflictDates = [];
      const skippedDailyLimitDates = [];
      const skippedPastDates = [];

      for (const date of valid.dates) {
        const endMs = parseMskDateTimeToUtcMs(date, valid.slotTo);
        if (!Number.isFinite(endMs) || endMs <= nowMs) {
          skippedPast++;
          skippedPastDates.push(date);
          continue;
        }

        const busy = active.find(b =>
          b.spaceId === valid.spaceId &&
          b.date === date &&
          timesOverlap(valid.slotFrom, valid.slotTo, b.slotFrom, b.slotTo)
        );
        if (busy) {
          skippedBusy++;
          skippedBusyDates.push(date);
          continue;
        }

        if (targetUser.role === 'user') {
          const daily = active.find(b => b.userId === targetUser.id && b.date === date);
          if (daily) {
            skippedDailyLimit++;
            skippedDailyLimitDates.push(date);
            continue;
          }
        }

        const userConflict = active.find(b =>
          b.userId === targetUser.id &&
          b.date === date &&
          timesOverlap(valid.slotFrom, valid.slotTo, b.slotFrom, b.slotTo)
        );
        if (userConflict) {
          skippedUser++;
          skippedUserConflictDates.push(date);
          continue;
        }

        const booking = {
          id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
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

        const inserted = await insertBookingRecord(env, booking);
        if (!inserted) {
          skippedPast++;
          skippedPastDates.push(date);
          continue;
        }

        active.push(booking);
        created++;
        createdDates.push(date);
      }

      let rev = await getBookingsRev(env);
      if (created > 0) rev = await bumpBookingsRev(env);
      const bookings = await loadBookings(env);
      return reply({
        ok: true,
        bookings,
        rev,
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
      });
    }

    /* ── POST /bookings/cancel (auth) ─────────────────── */
    if (path === '/bookings/cancel' && method === 'POST') {
      const { id = '' } = await request.json();
      const bookingId = String(id).trim();
      if (!bookingId) return reply({ error: 'Не указан ID брони' }, 400);

      const { map: usersMap } = await getUsersMap(env);
      const row = await firstSql(
        env,
        `SELECT
          id,
          user_id AS userId,
          user_name AS userName,
          space_id AS spaceId,
          space_name AS spaceName,
          date,
          slot_from AS slotFrom,
          slot_to AS slotTo,
          expires_at AS expiresAt,
          created_at AS createdAt,
          status,
          created_by AS createdBy,
          cancelled_at AS cancelledAt,
          cancelled_by AS cancelledBy
         FROM bookings
         WHERE id = ?`,
        [bookingId]
      );
      const current = normalizeBooking(row);
      if (!current) return reply({ error: 'Бронирование не найдено' }, 404);

      const owner = usersMap.get(current.userId) || null;
      if (current.status === 'cancelled') {
        const canSeeCancelled = auth.user.role === 'admin' ||
          current.userId === auth.user.id ||
          (auth.user.role === 'manager' && owner && owner.role === 'user' && owner.department === auth.user.department);
        if (!canSeeCancelled) return reply({ error: 'Недостаточно прав для отмены' }, 403);
        const bookings = await loadBookings(env);
        const rev = await getBookingsRev(env);
        return reply({ ok: true, bookings, rev, cancelled: false, alreadyCancelled: true });
      }

      if (!canCancelBooking(auth.user, current, owner)) {
        return reply({ error: 'Недостаточно прав для отмены' }, 403);
      }

      const cancelledAt = new Date().toISOString();
      const updateResult = await runSql(
        env,
        "UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancelled_by = ? WHERE id = ? AND status = 'active'",
        [cancelledAt, auth.user.id, bookingId]
      );
      const changed = Number(updateResult?.meta?.changes || 0);
      let rev = await getBookingsRev(env);
      if (changed > 0) rev = await bumpBookingsRev(env);
      const bookings = await loadBookings(env);
      return reply({ ok: true, bookings, rev, cancelled: changed > 0, alreadyCancelled: changed === 0 });
    }

    /* ── POST /bookings/replace-admin (admin) ─────────── */
    if (path === '/bookings/replace-admin' && method === 'POST') {
      if (auth.user.role !== 'admin') return reply({ error: 'Недостаточно прав' }, 403);
      const { bookings } = await request.json();
      if (!Array.isArray(bookings)) return reply({ error: 'Некорректный формат бронирований' }, 400);

      const nextBookings = trimBookingsRetention(bookings);
      await runSql(env, 'DELETE FROM bookings');
      for (const booking of nextBookings) {
        await insertBookingRecord(env, booking);
      }
      const rev = await bumpBookingsRev(env);
      const freshBookings = await loadBookings(env);
      return reply({ ok: true, bookings: freshBookings, rev });
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

      const value = await readDomainValue(env, key);
      const rev = await getDomainRev(env, key);
      return reply({ key, value, rev });
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
      const expectedRev = Number(body?.rev);
      const hasExpectedRev = Number.isInteger(expectedRev) && expectedRev > 0;
      const currentRev = await getDomainRev(env, key);
      if (hasExpectedRev && expectedRev !== currentRev) {
        const currentValue = await readDomainValue(env, key);
        return reply(
          { error: 'Конфликт обновления. Данные уже изменены другим пользователем.', key, rev: currentRev, value: currentValue },
          409
        );
      }
      let result;
      try {
        result = await writeDomainValue(env, key, value);
      } catch (error) {
        const msg = String(error?.message || '');
        if (msg.includes('FOREIGN KEY') || msg.includes('constraint')) {
          return reply({ error: 'Некорректная структура данных: проверьте связи между коворкингами, этажами и зонами.' }, 400);
        }
        throw error;
      }
      if (!result.ok) return reply({ error: result.error || 'Ошибка обновления' }, result.status || 400);
      const rev = await bumpDomainRev(env, key);
      return reply({ ok: true, key, rev });
    }

    return reply({ error: 'Not found', path }, 404);

  } catch (err) {
    console.error('[API]', err);
    return reply({ error: 'Internal error' }, 500);
  }
}
