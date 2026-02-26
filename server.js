'use strict';
const express = require('express');
const { Pool }  = require('pg');
const cors      = require('cors');
const path      = require('path');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── PostgreSQL ─────────────────────────────────────────────────── */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS resources (
      key        TEXT PRIMARY KEY,
      data       JSONB        NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
    );
  `);
}

/* ── SSE broadcast ──────────────────────────────────────────────── */
const sseClients = new Set();

function broadcast(key) {
  const msg = `data: ${JSON.stringify({ key, ts: Date.now() })}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch (_) { sseClients.delete(res); }
  }
}

/* ── Middleware ─────────────────────────────────────────────────── */
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname)));   // serve index.html + app.js + style.css

/* ── REST API ───────────────────────────────────────────────────── */

// GET /api/data/:key  →  returns stored JSON value (array or object)
app.get('/api/data/:key', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT data FROM resources WHERE key = $1',
      [req.params.key]
    );
    res.json(rows.length ? rows[0].data : null);
  } catch (err) {
    console.error('GET /api/data/:key', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/data/:key  →  upsert JSON value, broadcast to SSE subscribers
app.put('/api/data/:key', async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO resources (key, data, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key)
       DO UPDATE SET data = $2::jsonb, updated_at = now()`,
      [req.params.key, JSON.stringify(req.body)]
    );
    broadcast(req.params.key);
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/data/:key', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/all  →  dump all rows for initial sync
app.get('/api/all', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT key, data FROM resources');
    const result = {};
    rows.forEach(r => { result[r.key] = r.data; });
    res.json(result);
  } catch (err) {
    console.error('GET /api/all', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events  →  SSE stream
app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'X-Accel-Buffering': 'no',       // nginx compatibility
  });
  res.flushHeaders();
  res.write(': connected\n\n');      // comment to confirm stream opened

  const keepAlive = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) {}
  }, 25000);

  sseClients.add(res);

  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

/* ── Start ──────────────────────────────────────────────────────── */
initDB()
  .then(() => {
    app.listen(PORT, () =>
      console.log(`[server] listening on http://localhost:${PORT}`)
    );
  })
  .catch(err => {
    console.error('[server] DB init failed:', err.message);
    process.exit(1);
  });
