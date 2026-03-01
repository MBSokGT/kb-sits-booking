-- ═══════════════════════════════════════════════════════
-- КБ Ситс — D1 (SQLite) Schema
-- ═══════════════════════════════════════════════════════

-- Users table for proper server-side auth
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
-- (coworkings, floors, spaces, bookings, settings)
CREATE TABLE IF NOT EXISTS kv_store (
  k          TEXT PRIMARY KEY,
  v          TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Demo / seed data ──────────────────────────────────
INSERT OR IGNORE INTO users (id, email, password, name, department, role) VALUES
  ('u1', 'admin@demo.ru',   'admin123', 'Администратор',    'IT',          'admin'),
  ('u2', 'manager@demo.ru', 'pass123',  'Менеджер Иванова', 'HR / T&D',    'manager'),
  ('u3', 'user@demo.ru',    'pass123',  'Сотрудник Петров', 'Продажи',     'user');
