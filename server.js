import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

import dotenv from 'dotenv';
import express from 'express';
import Database from 'better-sqlite3';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = __dirname;
const DB_FILE = path.resolve(PROJECT_ROOT, process.env.DB_FILE || './data/kb-sits.sqlite');
const PORT = Number(process.env.PORT || 3000);
const HOST = String(process.env.HOST || '0.0.0.0');
const BODY_LIMIT = process.env.BODY_LIMIT || '10mb';

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

const schemaPath = path.join(PROJECT_ROOT, 'schema.sql');
if (fs.existsSync(schemaPath)) {
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  sqlite.exec(schemaSql);
}

// Lightweight migration for new columns in users table.
const userCols = sqlite.prepare("PRAGMA table_info(users)").all();
if (!userCols.some(col => col.name === 'blocked')) {
  sqlite.exec('ALTER TABLE users ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0');
}
if (!userCols.some(col => col.name === 'last_login')) {
  sqlite.exec('ALTER TABLE users ADD COLUMN last_login TEXT');
}

function hashPasswordNode(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const iterations = 100000;
  const hash = crypto.pbkdf2Sync(
    String(password),
    Buffer.from(salt, 'hex'),
    iterations,
    32,
    'sha256'
  ).toString('hex');
  return `pbkdf2_sha256$${iterations}$${salt}$${hash}`;
}

function ensureBootstrapAdmin(db) {
  const email = String(process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || '');
  if (!email || !password) return;

  const name = String(process.env.BOOTSTRAP_ADMIN_NAME || 'Главный администратор').trim();
  const department = String(process.env.BOOTSTRAP_ADMIN_DEPARTMENT || 'Администрация').trim();
  const passwordHash = hashPasswordNode(password);
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);

  if (existing?.id) {
    db.prepare(
      'UPDATE users SET password = ?, role = ?, name = ?, department = ? WHERE id = ?'
    ).run(passwordHash, 'admin', name, department, existing.id);
    console.log(`[kb-sits] Bootstrap admin updated: ${email}`);
    return;
  }

  const id = `adm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  db.prepare(
    'INSERT INTO users (id, email, password, name, department, role) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, email, passwordHash, name, department, 'admin');
  console.log(`[kb-sits] Bootstrap admin created: ${email}`);
}

ensureBootstrapAdmin(sqlite);

class SqlStatementAdapter {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async first() {
    const row = this.db.prepare(this.sql).get(...this.args);
    return row || null;
  }

  async all() {
    const rows = this.db.prepare(this.sql).all(...this.args);
    return { results: rows };
  }

  async run() {
    const info = this.db.prepare(this.sql).run(...this.args);
    return {
      success: true,
      meta: {
        changes: Number(info.changes || 0),
        last_row_id: Number(info.lastInsertRowid || 0),
      },
    };
  }
}

class SqlDatabaseAdapter {
  constructor(db) {
    this.db = db;
  }

  prepare(sql) {
    return new SqlStatementAdapter(this.db, sql);
  }
}

const env = {
  ...process.env,
  DB: new SqlDatabaseAdapter(sqlite),
};

const apiModuleUrl = pathToFileURL(path.join(PROJECT_ROOT, 'api/handler.js')).href;
const { onRequest } = await import(apiModuleUrl);

function buildRequestFromExpress(req) {
  const origin = `${req.protocol}://${req.get('host')}`;
  const fullUrl = new URL(req.originalUrl || req.url || '/', origin).toString();
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'undefined') continue;
    if (Array.isArray(value)) {
      headers.set(key, value.join(', '));
    } else {
      headers.set(key, String(value));
    }
  }

  const method = String(req.method || 'GET').toUpperCase();
  const init = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') {
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(req.body ? String(req.body) : '');
    init.body = rawBody;
    init.duplex = 'half';
  }

  return new Request(fullUrl, init);
}

function applyResponseHeaders(expressRes, fetchResponse) {
  const setCookies = typeof fetchResponse.headers.getSetCookie === 'function'
    ? fetchResponse.headers.getSetCookie()
    : [];

  fetchResponse.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === 'set-cookie') {
      if (setCookies.length) {
        expressRes.setHeader('set-cookie', setCookies);
      } else {
        expressRes.setHeader('set-cookie', value);
      }
      return;
    }
    expressRes.setHeader(key, value);
  });
}

const app = express();
app.set('trust proxy', true);

app.use('/api', express.raw({ type: '*/*', limit: BODY_LIMIT }));

app.all('/api/*', async (req, res) => {
  try {
    const request = buildRequestFromExpress(req);
    const response = await onRequest({ request, env });
    applyResponseHeaders(res, response);
    res.status(response.status);
    const body = Buffer.from(await response.arrayBuffer());
    res.send(body);
  } catch (error) {
    console.error('[node-api]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.use(express.static(PROJECT_ROOT, { index: false }));

app.get('*', (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`[kb-sits] Node server started on ${HOST}:${PORT}`);
  console.log(`[kb-sits] SQLite DB: ${DB_FILE}`);
});
