-- ═══════════════════════════════════════════════════════════════
-- КБ Ситс - Supabase Database Schema (CLEAN)
-- ═══════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS bookings CASCADE;
DROP TABLE IF EXISTS seats CASCADE;
DROP TABLE IF EXISTS zones CASCADE;
DROP TABLE IF EXISTS floors CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS departments CASCADE;

CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

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

CREATE TABLE floors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  floor_number INTEGER NOT NULL,
  image_url TEXT,
  image_data TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  seats_count INTEGER NOT NULL DEFAULT 1,
  coordinates JSONB NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id UUID NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  seat_number INTEGER NOT NULL,
  is_available BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seat_id UUID NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booked_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booking_date DATE NOT NULL,
  time_slot TEXT NOT NULL CHECK (time_slot IN ('morning', 'afternoon', 'evening', 'full_day', 'custom')),
  start_time TIME,
  end_time TIME,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(seat_id, booking_date, time_slot)
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_department ON users(department_id);
CREATE INDEX idx_zones_floor ON zones(floor_id);
CREATE INDEX idx_seats_zone ON seats(zone_id);
CREATE INDEX idx_bookings_seat ON bookings(seat_id);
CREATE INDEX idx_bookings_user ON bookings(user_id);
CREATE INDEX idx_bookings_date ON bookings(booking_date);
CREATE INDEX idx_bookings_status ON bookings(status);

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE floors ENABLE ROW LEVEL SECURITY;
ALTER TABLE zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE seats ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Все могут читать отделы" ON departments FOR SELECT USING (true);
CREATE POLICY "Админы создают отделы" ON departments FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Админы редактируют отделы" ON departments FOR UPDATE USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Админы удаляют отделы" ON departments FOR DELETE USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Пользователи видят себя и своих коллег" ON users FOR SELECT USING (id = auth.uid() OR role = 'admin' OR (role = 'manager' AND department_id = (SELECT department_id FROM users WHERE id = auth.uid())));
CREATE POLICY "Админы управляют пользователями" ON users FOR ALL USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Все видят этажи" ON floors FOR SELECT USING (true);
CREATE POLICY "Админы создают этажи" ON floors FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Админы редактируют этажи" ON floors FOR UPDATE USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Админы удаляют этажи" ON floors FOR DELETE USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Все видят зоны" ON zones FOR SELECT USING (true);
CREATE POLICY "Админы создают зоны" ON zones FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Админы редактируют зоны" ON zones FOR UPDATE USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Админы удаляют зоны" ON zones FOR DELETE USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Все видят места" ON seats FOR SELECT USING (true);
CREATE POLICY "Админы создают места" ON seats FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Админы редактируют места" ON seats FOR UPDATE USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Админы удаляют места" ON seats FOR DELETE USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Все видят бронирования" ON bookings FOR SELECT USING (true);
CREATE POLICY "Сотрудники бронируют для себя" ON bookings FOR INSERT WITH CHECK (user_id = auth.uid() AND booked_by = auth.uid());
CREATE POLICY "Руководители бронируют для своего отдела" ON bookings FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM users u1, users u2 WHERE u1.id = auth.uid() AND u1.role IN ('manager', 'admin') AND u2.id = bookings.user_id AND (u1.department_id = u2.department_id OR u1.role = 'admin')));
CREATE POLICY "Пользователи отменяют свои брони" ON bookings FOR UPDATE USING (user_id = auth.uid() OR booked_by = auth.uid());
CREATE POLICY "Админы удаляют брони" ON bookings FOR DELETE USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'bookings') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE bookings;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'zones') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE zones;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'floors') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE floors;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'seats') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE seats;
  END IF;
END $$;

INSERT INTO departments (name) VALUES ('IT'), ('HR'), ('Финансы'), ('Маркетинг') ON CONFLICT (name) DO NOTHING;
INSERT INTO users (email, password_hash, full_name, department_id, role) VALUES ('admin@demo.ru', 'admin123', 'Администратор', (SELECT id FROM departments WHERE name = 'IT'), 'admin'), ('manager@demo.ru', 'pass123', 'Менеджер', (SELECT id FROM departments WHERE name = 'IT'), 'manager'), ('user@demo.ru', 'pass123', 'Сотрудник', (SELECT id FROM departments WHERE name = 'IT'), 'employee') ON CONFLICT (email) DO NOTHING;
INSERT INTO floors (name, floor_number) SELECT 'Первый этаж', 1 WHERE NOT EXISTS (SELECT 1 FROM floors WHERE floor_number = 1);
INSERT INTO zones (floor_id, name, color, seats_count, coordinates) SELECT (SELECT id FROM floors WHERE floor_number = 1), 'Зона A', '#3b82f6', 5, '[{"x":100,"y":100},{"x":300,"y":100},{"x":300,"y":200},{"x":100,"y":200}]'::jsonb WHERE NOT EXISTS (SELECT 1 FROM zones WHERE name = 'Зона A');
INSERT INTO zones (floor_id, name, color, seats_count, coordinates) SELECT (SELECT id FROM floors WHERE floor_number = 1), 'Зона B', '#10b981', 3, '[{"x":350,"y":100},{"x":550,"y":100},{"x":550,"y":200},{"x":350,"y":200}]'::jsonb WHERE NOT EXISTS (SELECT 1 FROM zones WHERE name = 'Зона B');

DO $$
DECLARE zone_record RECORD; i INTEGER;
BEGIN
  FOR zone_record IN SELECT id, seats_count FROM zones WHERE NOT EXISTS (SELECT 1 FROM seats WHERE zone_id = zones.id) LOOP
    FOR i IN 1..zone_record.seats_count LOOP
      INSERT INTO seats (zone_id, seat_number) VALUES (zone_record.id, i);
    END LOOP;
  END LOOP;
END $$;
