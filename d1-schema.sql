-- ═══════════════════════════════════════════════════════
-- КБ Ситс — D1 (SQLite) Schema
-- ═══════════════════════════════════════════════════════

-- Users table for server-side auth
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  email      TEXT UNIQUE NOT NULL,
  password   TEXT NOT NULL,
  name       TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT '',
  role       TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Generic key-value store for all other app data
-- (coworkings, floors, spaces, bookings, departments, settings)
CREATE TABLE IF NOT EXISTS kv_store (
  k          TEXT PRIMARY KEY,
  v          TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Production users ──────────────────────────────────
-- Passwords are random; distribute credentials separately.
INSERT OR IGNORE INTO users (id, email, password, name, department, role) VALUES
  ('kp1', 'k.prohorova@kbmik.ru', '6Xnlms7nToqo0u', 'Прохорова Кристина', 'КБ МИК', 'admin'),
  ('ms2', 'm.b.sokolova@kbmik.ru', 'iDsrXjFWiW5eOz', 'Соколова Мария',     'КБ МИК', 'admin');
