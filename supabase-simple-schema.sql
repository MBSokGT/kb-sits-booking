-- Упрощенная схема для совместимости с localStorage

-- 1. Таблица пользователей (упрощенная)
CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  department TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Таблица коворкингов
CREATE TABLE IF NOT EXISTS app_coworkings (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Таблица этажей
CREATE TABLE IF NOT EXISTS app_floors (
  id TEXT PRIMARY KEY,
  coworking_id TEXT REFERENCES app_coworkings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  image_url TEXT,
  image_type TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Таблица пространств (spaces/zones)
CREATE TABLE IF NOT EXISTS app_spaces (
  id TEXT PRIMARY KEY,
  floor_id TEXT REFERENCES app_floors(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  seats INTEGER NOT NULL DEFAULT 1,
  x NUMERIC NOT NULL,
  y NUMERIC NOT NULL,
  w NUMERIC NOT NULL,
  h NUMERIC NOT NULL,
  color TEXT NOT NULL DEFAULT '#059669',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Таблица бронирований
CREATE TABLE IF NOT EXISTS app_bookings (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES app_users(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL,
  space_id TEXT REFERENCES app_spaces(id) ON DELETE CASCADE,
  space_name TEXT NOT NULL,
  date TEXT NOT NULL,
  slot_from TEXT NOT NULL,
  slot_to TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_app_users_email ON app_users(email);
CREATE INDEX IF NOT EXISTS idx_app_floors_coworking ON app_floors(coworking_id);
CREATE INDEX IF NOT EXISTS idx_app_spaces_floor ON app_spaces(floor_id);
CREATE INDEX IF NOT EXISTS idx_app_bookings_user ON app_bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_app_bookings_space ON app_bookings(space_id);
CREATE INDEX IF NOT EXISTS idx_app_bookings_date ON app_bookings(date);

-- RLS политики (отключаем для упрощения)
ALTER TABLE app_users DISABLE ROW LEVEL SECURITY;
ALTER TABLE app_coworkings DISABLE ROW LEVEL SECURITY;
ALTER TABLE app_floors DISABLE ROW LEVEL SECURITY;
ALTER TABLE app_spaces DISABLE ROW LEVEL SECURITY;
ALTER TABLE app_bookings DISABLE ROW LEVEL SECURITY;

-- Демо данные
INSERT INTO app_users (id, email, password, name, department, role) VALUES
  ('u1', 'admin@demo.ru', 'admin123', 'Администратор', 'IT', 'admin'),
  ('u2', 'manager@demo.ru', 'pass123', 'Менеджер Иванова', 'HR / T&D', 'manager'),
  ('u3', 'user@demo.ru', 'pass123', 'Сотрудник Петров', 'Продажи', 'user')
ON CONFLICT (id) DO NOTHING;

INSERT INTO app_coworkings (id, name) VALUES
  ('c1', 'Главный коворкинг')
ON CONFLICT (id) DO NOTHING;

INSERT INTO app_floors (id, coworking_id, name, sort_order) VALUES
  ('f1', 'c1', 'Этаж 4', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO app_spaces (id, floor_id, label, seats, x, y, w, h, color) VALUES
  ('s1', 'f1', 'Кабинет 401', 3, 3, 3, 22, 18, '#3b82f6'),
  ('s2', 'f1', 'Кабинет 402', 4, 3, 25, 22, 18, '#3b82f6'),
  ('s3', 'f1', 'HR / T&D', 2, 3, 47, 22, 16, '#8b5cf6'),
  ('s4', 'f1', 'Переговорная', 8, 3, 67, 22, 22, '#f59e0b'),
  ('s5', 'f1', 'Опен-спейс A', 6, 30, 3, 22, 22, '#059669'),
  ('s6', 'f1', 'Опен-спейс B', 6, 30, 29, 22, 22, '#059669'),
  ('s7', 'f1', 'Опен-спейс C', 6, 30, 55, 22, 22, '#059669'),
  ('s8', 'f1', 'Тихая зона', 8, 58, 3, 39, 87, '#6366f1')
ON CONFLICT (id) DO NOTHING;
