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
  ('kp1', 'k.prohorova@kbmik.ru', 'pbkdf2_sha256$120000$f8b7d264e7b365b8d380211b92ad289f$5e6a3122796fbba36b2bd35930b4860a2a00b9fba3e6fa4bd6d05cb55cf0622b', 'Прохорова Кристина', 'КБ МИК', 'admin'),
  ('ms2', 'm.b.sokolova@kbmik.ru', 'pbkdf2_sha256$120000$620f52957a2c14c5682d2dd2ff95fa2f$4d7d70154ab0580167fd636fc328183f5d8a4ebe202eca3f36db5689595d9f93', 'Соколова Мария',     'КБ МИК', 'admin');
