-- ═══════════════════════════════════════════════════════════════
-- КБ Ситс - Supabase Database Schema
-- ═══════════════════════════════════════════════════════════════

-- Удаляем существующие таблицы (если есть)
DROP TABLE IF EXISTS bookings CASCADE;
DROP TABLE IF EXISTS seats CASCADE;
DROP TABLE IF EXISTS zones CASCADE;
DROP TABLE IF EXISTS floors CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS departments CASCADE;

-- 1. Таблица отделов
CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Таблица пользователей
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('employee', 'manager', 'admin')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Таблица этажей
CREATE TABLE floors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  floor_number INTEGER NOT NULL,
  image_url TEXT,
  image_data TEXT, -- base64 для хранения изображения
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- 4. Таблица зон на этажах
CREATE TABLE zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  seats_count INTEGER NOT NULL DEFAULT 1,
  coordinates JSONB NOT NULL, -- [{x, y}, {x, y}, ...]
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Таблица мест в зонах
CREATE TABLE seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id UUID NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  seat_number INTEGER NOT NULL,
  is_available BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Таблица бронирований
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seat_id UUID NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booked_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- кто забронировал (для руководителей)
  booking_date DATE NOT NULL,
  time_slot TEXT NOT NULL CHECK (time_slot IN ('morning', 'afternoon', 'evening', 'full_day', 'custom')),
  start_time TIME,
  end_time TIME,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(seat_id, booking_date, time_slot)
);

-- ═══════════════════════════════════════════════════════════════
-- ИНДЕКСЫ для оптимизации запросов
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_department ON users(department_id);
CREATE INDEX idx_zones_floor ON zones(floor_id);
CREATE INDEX idx_seats_zone ON seats(zone_id);
CREATE INDEX idx_bookings_seat ON bookings(seat_id);
CREATE INDEX idx_bookings_user ON bookings(user_id);
CREATE INDEX idx_bookings_date ON bookings(booking_date);
CREATE INDEX idx_bookings_status ON bookings(status);

-- ═══════════════════════════════════════════════════════════════
-- ФУНКЦИИ для автоматического обновления updated_at
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_floors_updated_at BEFORE UPDATE ON floors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_zones_updated_at BEFORE UPDATE ON zones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bookings_updated_at BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════
-- ФУНКЦИЯ для автоматического истечения бронирований
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION expire_old_bookings()
RETURNS void AS $$
BEGIN
  UPDATE bookings
  SET status = 'expired'
  WHERE status = 'active'
    AND (
      (booking_date < CURRENT_DATE)
      OR (booking_date = CURRENT_DATE AND time_slot = 'morning' AND CURRENT_TIME > '12:00:00')
      OR (booking_date = CURRENT_DATE AND time_slot = 'afternoon' AND CURRENT_TIME > '18:00:00')
      OR (booking_date = CURRENT_DATE AND time_slot = 'evening' AND CURRENT_TIME > '23:59:59')
      OR (booking_date = CURRENT_DATE AND time_slot = 'custom' AND end_time < CURRENT_TIME)
    );
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS) - Политики доступа
-- ═══════════════════════════════════════════════════════════════

-- Включаем RLS для всех таблиц
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE floors ENABLE ROW LEVEL SECURITY;
ALTER TABLE zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE seats ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- Политики для departments (все могут читать)
CREATE POLICY "Все могут читать отделы" ON departments FOR SELECT USING (true);
CREATE POLICY "Только админы могут создавать отделы" ON departments FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
);

-- Политики для users
CREATE POLICY "Пользователи видят себя и своих коллег" ON users FOR SELECT USING (
  id = auth.uid() 
  OR role = 'admin'
  OR (role = 'manager' AND department_id = (SELECT department_id FROM users WHERE id = auth.uid()))
);

CREATE POLICY "Админы управляют пользователями" ON users FOR ALL USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
);

-- Политики для floors (все читают, админы управляют)
CREATE POLICY "Все видят этажи" ON floors FOR SELECT USING (true);
CREATE POLICY "Админы управляют этажами" ON floors FOR ALL USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
);

-- Политики для zones (все читают, админы управляют)
CREATE POLICY "Все видят зоны" ON zones FOR SELECT USING (true);
CREATE POLICY "Админы управляют зонами" ON zones FOR ALL USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
);

-- Политики для seats (все читают, админы управляют)
CREATE POLICY "Все видят места" ON seats FOR SELECT USING (true);
CREATE POLICY "Админы управляют местами" ON seats FOR ALL USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
);

-- Политики для bookings
CREATE POLICY "Все видят бронирования" ON bookings FOR SELECT USING (true);

CREATE POLICY "Сотрудники бронируют для себя" ON bookings FOR INSERT WITH CHECK (
  user_id = auth.uid() AND booked_by = auth.uid()
);

CREATE POLICY "Руководители бронируют для своего отдела" ON bookings FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM users u1, users u2
    WHERE u1.id = auth.uid() 
      AND u1.role IN ('manager', 'admin')
      AND u2.id = bookings.user_id
      AND (u1.department_id = u2.department_id OR u1.role = 'admin')
  )
);

CREATE POLICY "Пользователи отменяют свои брони" ON bookings FOR UPDATE USING (
  user_id = auth.uid() OR booked_by = auth.uid()
);

CREATE POLICY "Админы управляют всеми бронями" ON bookings FOR ALL USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
);

-- ═══════════════════════════════════════════════════════════════
-- ДЕМО ДАННЫЕ
-- ═══════════════════════════════════════════════════════════════

-- Отделы
INSERT INTO departments (name) VALUES 
  ('IT'),
  ('HR'),
  ('Финансы'),
  ('Маркетинг');

-- Пользователи (пароль: admin123 и pass123 - нужно хешировать!)
-- Примечание: В реальности используйте bcrypt для хеширования
INSERT INTO users (email, password_hash, full_name, department_id, role) VALUES
  ('admin@demo.ru', '$2a$10$example_hash_admin', 'Администратор Системы', (SELECT id FROM departments WHERE name = 'IT'), 'admin'),
  ('manager@demo.ru', '$2a$10$example_hash_manager', 'Руководитель Отдела', (SELECT id FROM departments WHERE name = 'IT'), 'manager'),
  ('user@demo.ru', '$2a$10$example_hash_user', 'Сотрудник Иванов', (SELECT id FROM departments WHERE name = 'IT'), 'employee');

-- Этаж
INSERT INTO floors (name, floor_number) VALUES
  ('Первый этаж', 1);

-- Зоны (примеры координат)
INSERT INTO zones (floor_id, name, color, seats_count, coordinates) VALUES
  ((SELECT id FROM floors WHERE floor_number = 1), 'Зона A', '#3b82f6', 5, '[{"x":100,"y":100},{"x":300,"y":100},{"x":300,"y":200},{"x":100,"y":200}]'),
  ((SELECT id FROM floors WHERE floor_number = 1), 'Зона B', '#10b981', 3, '[{"x":350,"y":100},{"x":550,"y":100},{"x":550,"y":200},{"x":350,"y":200}]');

-- Места в зонах
DO $$
DECLARE
  zone_record RECORD;
  i INTEGER;
BEGIN
  FOR zone_record IN SELECT id, seats_count FROM zones LOOP
    FOR i IN 1..zone_record.seats_count LOOP
      INSERT INTO seats (zone_id, seat_number) VALUES (zone_record.id, i);
    END LOOP;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- ПОЛЕЗНЫЕ ПРЕДСТАВЛЕНИЯ (VIEWS)
-- ═══════════════════════════════════════════════════════════════

-- Представление: Доступные места на дату
CREATE OR REPLACE VIEW available_seats_view AS
SELECT 
  s.id as seat_id,
  s.seat_number,
  z.id as zone_id,
  z.name as zone_name,
  z.color as zone_color,
  f.id as floor_id,
  f.name as floor_name,
  f.floor_number
FROM seats s
JOIN zones z ON s.zone_id = z.id
JOIN floors f ON z.floor_id = f.id
WHERE s.is_available = true AND z.is_active = true;

-- Представление: Статистика бронирований
CREATE OR REPLACE VIEW booking_statistics AS
SELECT 
  u.full_name,
  u.email,
  d.name as department,
  COUNT(b.id) as total_bookings,
  COUNT(CASE WHEN b.status = 'active' THEN 1 END) as active_bookings,
  COUNT(CASE WHEN b.status = 'expired' THEN 1 END) as expired_bookings
FROM users u
LEFT JOIN departments d ON u.department_id = d.id
LEFT JOIN bookings b ON u.id = b.user_id
GROUP BY u.id, u.full_name, u.email, d.name;
