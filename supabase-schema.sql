-- ═══════════════════════════════════════════════════════════════
-- КБ — Supabase (PostgreSQL) Schema
-- Соответствует D1-схеме (Cloudflare).
-- ═══════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS kv_store CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Пользователи и авторизация
CREATE TABLE users (
  id         TEXT PRIMARY KEY,
  email      TEXT UNIQUE NOT NULL,
  password   TEXT NOT NULL,
  name       TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT '',
  role       TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Универсальное хранилище данных приложения
-- (коворкинги, этажи, зоны, бронирования, отделы, настройки)
CREATE TABLE kv_store (
  k          TEXT PRIMARY KEY,
  v          TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Индексы
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role  ON users(role);

-- ── Первоначальные пользователи ────────────────────────────────
-- Пароли хешированы (pbkdf2_sha256); выдавать credentials отдельно.
INSERT INTO users (id, email, password, name, department, role) VALUES
  ('kp1', 'k.prohorova@kbmik.ru', 'pbkdf2_sha256$100000$f8b7d264e7b365b8d380211b92ad289f$ac135cb91560209c6a651e13f7bc6347866ea2fccdee121a6bdb5dc14e2d3d98', 'Прохорова Кристина', 'КБ МИК', 'admin'),
  ('ms2', 'm.b.sokolova@kbmik.ru', 'pbkdf2_sha256$100000$620f52957a2c14c5682d2dd2ff95fa2f$075735c4e12021b3c77720f29da90916d782e79b0c8fe9fad3b5b8ed09d2b374', 'Соколова Мария',     'КБ МИК', 'admin')
ON CONFLICT (id) DO NOTHING;
