-- ═══════════════════════════════════════════════════════
-- КБ Ситс — SQLite Schema
-- ═══════════════════════════════════════════════════════

-- Users table for server-side auth
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  email      TEXT UNIQUE NOT NULL,
  password   TEXT NOT NULL,
  name       TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT '',
  role       TEXT NOT NULL DEFAULT 'user',
  blocked    INTEGER NOT NULL DEFAULT 0,
  last_login TEXT,
  prefs      TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Generic key-value store for all other app data
-- (sessions, rate limits, service flags)
CREATE TABLE IF NOT EXISTS kv_store (
  k          TEXT PRIMARY KEY,
  v          TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Coworkings
CREATE TABLE IF NOT EXISTS coworkings (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Floors / maps
CREATE TABLE IF NOT EXISTS floors (
  id          TEXT PRIMARY KEY,
  coworking_id TEXT NOT NULL,
  name        TEXT NOT NULL,
  image_url   TEXT,
  image_type  TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (coworking_id) REFERENCES coworkings(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_floors_coworking ON floors(coworking_id);

-- Spaces on floor plans
CREATE TABLE IF NOT EXISTS spaces (
  id         TEXT PRIMARY KEY,
  floor_id   TEXT NOT NULL,
  label      TEXT NOT NULL,
  seats      INTEGER NOT NULL DEFAULT 1,
  x          REAL NOT NULL DEFAULT 0,
  y          REAL NOT NULL DEFAULT 0,
  w          REAL NOT NULL DEFAULT 10,
  h          REAL NOT NULL DEFAULT 10,
  color      TEXT NOT NULL DEFAULT '#059669',
  archived_at TEXT,
  archived_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (floor_id) REFERENCES floors(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_spaces_floor ON spaces(floor_id);
CREATE INDEX IF NOT EXISTS idx_spaces_archived ON spaces(archived_at, floor_id);

-- Departments
CREATE TABLE IF NOT EXISTS departments (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  head_user_id TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS department_members (
  department_id TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  PRIMARY KEY (department_id, user_id),
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_department_members_user ON department_members(user_id);

-- Optional manually enabled Saturdays
CREATE TABLE IF NOT EXISTS working_saturdays (
  date TEXT PRIMARY KEY
);

-- Booking history (retention handled in API)
CREATE TABLE IF NOT EXISTS bookings (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  user_name    TEXT NOT NULL,
  space_id     TEXT NOT NULL,
  space_name   TEXT NOT NULL,
  date         TEXT NOT NULL,
  slot_from    TEXT NOT NULL,
  slot_to      TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  end_utc_ms   INTEGER NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  status       TEXT NOT NULL DEFAULT 'active',
  created_by   TEXT,
  cancelled_at TEXT,
  cancelled_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_bookings_status_end ON bookings(status, end_utc_ms);
CREATE INDEX IF NOT EXISTS idx_bookings_space_date ON bookings(space_id, date);
CREATE INDEX IF NOT EXISTS idx_bookings_user_date ON bookings(user_id, date);

CREATE TABLE IF NOT EXISTS booking_cancellation_audit (
  id               TEXT PRIMARY KEY,
  booking_id       TEXT,
  actor_user_id    TEXT,
  actor_name       TEXT NOT NULL,
  actor_role       TEXT NOT NULL,
  target_user_id   TEXT,
  target_user_name TEXT NOT NULL,
  space_id         TEXT,
  space_name       TEXT NOT NULL,
  booking_date     TEXT NOT NULL,
  slot_from        TEXT NOT NULL,
  slot_to          TEXT NOT NULL,
  reason           TEXT NOT NULL,
  details_json     TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_booking_cancel_audit_created ON booking_cancellation_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_cancel_audit_actor_role ON booking_cancellation_audit(actor_role, created_at DESC);

CREATE TABLE IF NOT EXISTS layout_audit (
  id             TEXT PRIMARY KEY,
  actor_user_id  TEXT,
  actor_name     TEXT NOT NULL,
  actor_role     TEXT NOT NULL,
  entity_type    TEXT NOT NULL,
  entity_id      TEXT NOT NULL,
  entity_name    TEXT NOT NULL,
  coworking_id   TEXT,
  coworking_name TEXT,
  floor_id       TEXT,
  floor_name     TEXT,
  space_id       TEXT,
  action         TEXT NOT NULL,
  before_json    TEXT,
  after_json     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_layout_audit_created ON layout_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_layout_audit_entity ON layout_audit(entity_type, entity_id, created_at DESC);

-- No default accounts here. Use BOOTSTRAP_ADMIN_* env vars or admin UI.
