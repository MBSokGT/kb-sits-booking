/**
 * КБ Ситс — Cloudflare Pages Function (catch-all)
 * Handles: /api/auth/login, /api/auth/register,
 *          /api/users, /api/kv/:key
 * Binding: env.DB  →  D1 database "kb-sits-db"
 */

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

export async function onRequest(context) {
  const { request, env } = context;

  // Pre-flight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url  = new URL(request.url);
  // Strip "/api" prefix → "/auth/login", "/kv/users", etc.
  const path = url.pathname.replace(/^\/api/, '').replace(/\/$/, '') || '/';
  const method = request.method;

  try {
    /* ── POST /auth/login ─────────────────────────────── */
    if (path === '/auth/login' && method === 'POST') {
      const { email = '', password = '' } = await request.json();
      const row = await env.DB.prepare(
        'SELECT id, email, name, department, role FROM users WHERE email = ? AND password = ?'
      ).bind(email.trim().toLowerCase(), password).first();

      if (!row) return json({ error: 'Неверный email или пароль' }, 401);
      return json({ user: row });
    }

    /* ── POST /auth/register ──────────────────────────── */
    if (path === '/auth/register' && method === 'POST') {
      const { name = '', email = '', password = '', department = '' } = await request.json();
      const emailClean = email.trim().toLowerCase();

      if (!name || !emailClean || !password) {
        return json({ error: 'Заполните обязательные поля' }, 400);
      }
      if (password.length < 6) {
        return json({ error: 'Пароль минимум 6 символов' }, 400);
      }

      const existing = await env.DB.prepare(
        'SELECT id FROM users WHERE email = ?'
      ).bind(emailClean).first();
      if (existing) return json({ error: 'Email уже зарегистрирован' }, 409);

      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      await env.DB.prepare(
        'INSERT INTO users (id, email, password, name, department, role) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(id, emailClean, password, name.trim(), department.trim(), 'user').run();

      return json({ user: { id, email: emailClean, name: name.trim(), department: department.trim(), role: 'user' } });
    }

    /* ── GET /users ───────────────────────────────────── */
    if (path === '/users' && method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT id, email, name, department, role FROM users ORDER BY role DESC, name'
      ).all();
      return json({ users: results });
    }

    /* ── GET /kv/:key ─────────────────────────────────── */
    if (path.startsWith('/kv') && method === 'GET') {
      const key = decodeURIComponent(path.slice(4)) || url.searchParams.get('key') || '';
      if (!key) {
        const { results } = await env.DB.prepare('SELECT k FROM kv_store').all();
        return json({ keys: results.map(r => r.k) });
      }
      const row = await env.DB.prepare('SELECT v FROM kv_store WHERE k = ?').bind(key).first();
      return json({ key, value: row ? JSON.parse(row.v) : null });
    }

    /* ── PUT /kv/:key ─────────────────────────────────── */
    if (path.startsWith('/kv') && method === 'PUT') {
      const key = decodeURIComponent(path.slice(4)) || url.searchParams.get('key') || '';
      if (!key) return json({ error: 'Missing key' }, 400);
      const body = await request.json();
      const value = body.value !== undefined ? body.value : body;
      await env.DB.prepare(
        "INSERT OR REPLACE INTO kv_store (k, v, updated_at) VALUES (?, ?, datetime('now'))"
      ).bind(key, JSON.stringify(value)).run();
      return json({ ok: true, key });
    }

    /* ── GET /health ──────────────────────────────────── */
    if (path === '/health') {
      const row = await env.DB.prepare("SELECT datetime('now') AS ts").first();
      return json({ ok: true, ts: row?.ts });
    }

    return json({ error: 'Not found', path }, 404);

  } catch (err) {
    console.error('[API]', err);
    return json({ error: 'Internal error', detail: err.message }, 500);
  }
}
