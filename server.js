const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '32kb' }));
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  return next(err);
});

const PORT = process.env.PORT || 3000;
const DB_ENABLED = process.env.DB_ENABLED === 'true';
const REDIS_ENABLED = process.env.REDIS_ENABLED === 'true';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const HIT_DEDUP_WINDOW_MS = 5000;
const CACHE_TTL_SEC = 300;
const CODE_BYTES = 4;
const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 120;
const MAX_CUSTOM_CODE_LENGTH = 32;
const recentHits = new Map();

const RESERVED_CODES = new Set([
  'api',
  'health',
  'static',
  'assets',
  'favicon.ico',
  'robots.txt',
  'index.html',
  'css',
  'js',
  'img',
  'images',
  'public',
  'admin',
  'docs',
  'swagger',
]);

const CODE_RE = /^[a-zA-Z0-9_-]{3,32}$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getClientKey(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded || req.ip || 'unknown')
    .toString()
    .split(',')[0]
    .trim();
  const ua = req.get('user-agent') || 'unknown';
  return `${ip}:${ua}`;
}

function shouldCountHit(req, code) {
  const key = `${code}:${getClientKey(req)}`;
  const now = Date.now();

  for (const [entryKey, seenAt] of recentHits.entries()) {
    if (now - seenAt > HIT_DEDUP_WINDOW_MS) recentHits.delete(entryKey);
  }

  const seenAt = recentHits.get(key);
  if (seenAt && now - seenAt <= HIT_DEDUP_WINDOW_MS) return false;

  recentHits.set(key, now);
  return true;
}

function readSecret(envVar, fallback) {
  const filePath = process.env[`${envVar}_FILE`];
  if (filePath) return fs.readFileSync(filePath, 'utf8').trim();
  return process.env[envVar] || fallback;
}

function publicBase(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  return `${req.protocol}://${req.get('host')}`;
}

function shortUrlFor(req, code) {
  return `${publicBase(req)}/${code}`;
}

function generateCode() {
  return crypto.randomBytes(CODE_BYTES).toString('hex');
}

function normalizeUrl(raw) {
  if (typeof raw !== 'string') return null;
  let url = raw.trim();
  if (!url) return null;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) {
    url = `https://${url}`;
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  if (!parsed.hostname || parsed.hostname.includes(' ')) return null;
  if (url.length > MAX_URL_LENGTH) return null;
  return parsed.toString();
}

function parseExpiresIn(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(Date.now() + value * 1000);
  }
  if (typeof value === 'string') {
    const m = value.trim().match(/^(\d+)\s*(m|h|d|w)$/i);
    if (!m) return undefined; // invalid format
    const n = Number(m[1]);
    const unit = m[2].toLowerCase();
    const mult = { m: 60, h: 3600, d: 86400, w: 604800 }[unit];
    return new Date(Date.now() + n * mult * 1000);
  }
  return undefined;
}

function isExpired(entry) {
  if (!entry || !entry.expires_at) return false;
  return new Date(entry.expires_at).getTime() <= Date.now();
}

function sanitizeTitle(title) {
  if (title == null || title === '') return null;
  if (typeof title !== 'string') return null;
  const t = title.trim().slice(0, MAX_TITLE_LENGTH);
  return t || null;
}

function sanitizeCustomCode(code) {
  if (code == null || code === '') return null;
  if (typeof code !== 'string') return null;
  const c = code.trim();
  if (!CODE_RE.test(c)) return undefined;
  if (RESERVED_CODES.has(c.toLowerCase())) return undefined;
  return c;
}

function linkPayload(req, code, entry) {
  return {
    code,
    shortUrl: shortUrlFor(req, code),
    originalUrl: entry.url,
    title: entry.title || null,
    hits: Number(entry.hits) || 0,
    createdAt: entry.created_at || null,
    expiresAt: entry.expires_at || null,
    lastHitAt: entry.last_hit_at || null,
    expired: isExpired(entry),
  };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------
let store;

async function initStorage() {
  if (!DB_ENABLED) {
    console.log('[storage] using in-memory Map (Tier 1 mode)');
    const mem = new Map();
    store = {
      async save(code, { url, title, expires_at }) {
        if (mem.has(code)) {
          const err = new Error('code already exists');
          err.code = 'CONFLICT';
          throw err;
        }
        mem.set(code, {
          url,
          hits: 0,
          title: title || null,
          expires_at: expires_at || null,
          created_at: new Date().toISOString(),
          last_hit_at: null,
        });
      },
      async get(code) {
        return mem.get(code) || null;
      },
      async incrementHits(code) {
        const entry = mem.get(code);
        if (entry) {
          entry.hits += 1;
          entry.last_hit_at = new Date().toISOString();
        }
      },
      async delete(code) {
        return mem.delete(code);
      },
      async list(limit = 20) {
        return [...mem.entries()]
          .map(([code, e]) => ({ code, ...e }))
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .slice(0, limit);
      },
      async ready() {
        return true;
      },
    };
    return;
  }

  console.log('[storage] using Postgres (Tier 2/3 mode)');
  const { Pool } = require('pg');
  const pool = new Pool({
    host: process.env.PGHOST || 'db',
    port: process.env.PGPORT || 5432,
    user: process.env.PGUSER || 'postgres',
    password: readSecret('PGPASSWORD', 'postgres'),
    database: process.env.PGDATABASE || 'shortener',
  });

  let connected = false;
  for (let i = 0; i < 15 && !connected; i++) {
    try {
      await pool.query('SELECT 1');
      connected = true;
    } catch {
      console.log(`[storage] waiting for postgres... (${i + 1}/15)`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  if (!connected) throw new Error('Could not connect to Postgres');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS links (
      code TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      hits INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE links ADD COLUMN IF NOT EXISTS title TEXT`);
  await pool.query(`ALTER TABLE links ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE links ADD COLUMN IF NOT EXISTS last_hit_at TIMESTAMPTZ`);

  store = {
    async save(code, { url, title, expires_at }) {
      try {
        await pool.query(
          `INSERT INTO links (code, url, title, expires_at)
           VALUES ($1, $2, $3, $4)`,
          [code, url, title || null, expires_at || null]
        );
      } catch (err) {
        if (err && err.code === '23505') {
          const conflict = new Error('code already exists');
          conflict.code = 'CONFLICT';
          throw conflict;
        }
        throw err;
      }
    },
    async get(code) {
      const res = await pool.query(
        `SELECT url, hits, title, expires_at, created_at, last_hit_at
         FROM links WHERE code = $1`,
        [code]
      );
      return res.rows[0] || null;
    },
    async incrementHits(code) {
      await pool.query(
        `UPDATE links
         SET hits = hits + 1, last_hit_at = now()
         WHERE code = $1`,
        [code]
      );
    },
    async delete(code) {
      const res = await pool.query('DELETE FROM links WHERE code = $1', [code]);
      return res.rowCount > 0;
    },
    async list(limit = 20) {
      const res = await pool.query(
        `SELECT code, url, hits, title, expires_at, created_at, last_hit_at
         FROM links
         ORDER BY created_at DESC
         LIMIT $1`,
        [Math.min(Math.max(Number(limit) || 20, 1), 100)]
      );
      return res.rows;
    },
    async ready() {
      await pool.query('SELECT 1');
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------
let cache = {
  async get() {
    return null;
  },
  async set() {},
  async del() {},
  ready: async () => true,
};

async function initCache() {
  if (!REDIS_ENABLED) return;

  console.log('[cache] using Redis (Tier 3 mode)');
  const { createClient } = require('redis');
  const redisPassword = readSecret('REDIS_PASSWORD', process.env.REDIS_PASSWORD || '');
  const redisUrl = redisPassword
    ? `redis://:${encodeURIComponent(redisPassword)}@${process.env.REDIS_HOST || 'cache'}:${process.env.REDIS_PORT || 6379}`
    : `redis://${process.env.REDIS_HOST || 'cache'}:${process.env.REDIS_PORT || 6379}`;
  const client = createClient({
    url: redisUrl,
    socket: {
      connectTimeout: 5000,
      reconnectStrategy: false,
    },
  });
  client.on('error', (err) => console.warn('[redis] warning', err.message || err));

  let connected = false;
  for (let i = 0; i < 15 && !connected; i++) {
    try {
      await client.connect();
      connected = true;
    } catch {
      console.log(`[cache] waiting for redis... (${i + 1}/15)`);
      if (i < 14) await new Promise((r) => setTimeout(r, 2000));
    }
  }

  if (!connected) {
    console.warn('[cache] Redis unavailable, continuing without cache');
    return;
  }

  cache = {
    async get(code) {
      const val = await client.get(`link:${code}`);
      return val ? JSON.parse(val) : null;
    },
    async set(code, data) {
      await client.set(`link:${code}`, JSON.stringify(data), { EX: CACHE_TTL_SEC });
    },
    async del(code) {
      await client.del(`link:${code}`);
    },
    ready: async () => client.isReady,
  };
}

// ---------------------------------------------------------------------------
// Static frontend
// ---------------------------------------------------------------------------
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir, { index: false, maxAge: '1h' }));

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
app.get('/health', async (req, res) => {
  try {
    await store.ready();
    const redisOk = REDIS_ENABLED ? await cache.ready() : false;
    res.json({
      status: 'ok',
      db: DB_ENABLED,
      redis: REDIS_ENABLED,
      redisConnected: Boolean(redisOk),
    });
  } catch (err) {
    res.status(503).json({ status: 'error', message: err.message });
  }
});

app.post('/api/shorten', async (req, res) => {
  try {
    const url = normalizeUrl(req.body?.url);
    if (!url) {
      return res.status(400).json({
        error: 'A valid http(s) URL is required',
        field: 'url',
      });
    }

    const title = sanitizeTitle(req.body?.title);
    const custom = sanitizeCustomCode(req.body?.customCode ?? req.body?.alias);
    if (req.body?.customCode != null && req.body.customCode !== '' && custom === undefined) {
      return res.status(400).json({
        error: 'Custom code must be 3–32 chars: letters, numbers, _ or -',
        field: 'customCode',
      });
    }
    if (req.body?.alias != null && req.body.alias !== '' && custom === undefined) {
      return res.status(400).json({
        error: 'Custom code must be 3–32 chars: letters, numbers, _ or -',
        field: 'customCode',
      });
    }

    const expiresAt = parseExpiresIn(req.body?.expiresIn);
    if (expiresAt === undefined) {
      return res.status(400).json({
        error: 'expiresIn must be like "30m", "12h", "7d", "2w" or seconds',
        field: 'expiresIn',
      });
    }

    let code = custom;
    if (!code) {
      for (let i = 0; i < 5; i++) {
        const candidate = generateCode();
        const existing = await store.get(candidate);
        if (!existing) {
          code = candidate;
          break;
        }
      }
      if (!code) code = crypto.randomBytes(6).toString('hex');
    } else {
      const existing = await store.get(code);
      if (existing && !isExpired(existing)) {
        return res.status(409).json({ error: 'That short code is already taken', field: 'customCode' });
      }
      if (existing && isExpired(existing)) {
        await store.delete(code);
        await cache.del(code);
      }
    }

    await store.save(code, { url, title, expires_at: expiresAt });
    const entry = await store.get(code);
    await cache.set(code, entry);

    res.status(201).json(linkPayload(req, code, entry));
  } catch (err) {
    if (err && err.code === 'CONFLICT') {
      return res.status(409).json({ error: 'That short code is already taken', field: 'customCode' });
    }
    console.error('[api/shorten]', err);
    res.status(500).json({ error: 'Failed to create short link' });
  }
});

app.get('/api/stats/:code', async (req, res) => {
  try {
    const { code } = req.params;
    if (!CODE_RE.test(code)) return res.status(400).json({ error: 'invalid code' });

    const entry = await store.get(code);
    if (!entry) return res.status(404).json({ error: 'not found' });
    if (isExpired(entry)) {
      return res.status(410).json({ error: 'This short link has expired', ...linkPayload(req, code, entry) });
    }
    res.json(linkPayload(req, code, entry));
  } catch (err) {
    console.error('[api/stats]', err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

app.get('/api/links', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 20;
    const rows = await store.list(limit);
    res.json({
      links: rows.map((row) => linkPayload(req, row.code, row)),
    });
  } catch (err) {
    console.error('[api/links]', err);
    res.status(500).json({ error: 'Failed to list links' });
  }
});

app.delete('/api/links/:code', async (req, res) => {
  try {
    const { code } = req.params;
    if (!CODE_RE.test(code)) return res.status(400).json({ error: 'invalid code' });
    const deleted = await store.delete(code);
    await cache.del(code);
    if (!deleted) return res.status(404).json({ error: 'not found' });
    res.status(204).end();
  } catch (err) {
    console.error('[api/delete]', err);
    res.status(500).json({ error: 'Failed to delete link' });
  }
});

app.get('/api/preview', (req, res) => {
  const url = normalizeUrl(req.query.url);
  if (!url) return res.status(400).json({ error: 'valid url query required' });
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    host = '';
  }
  res.json({ url, host, favicon: host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64` : null });
});

// ---------------------------------------------------------------------------
// Frontend shell
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// ---------------------------------------------------------------------------
// Redirect short links
// ---------------------------------------------------------------------------
app.get('/:code', async (req, res) => {
  try {
    const { code } = req.params;
    if (!CODE_RE.test(code) || RESERVED_CODES.has(code.toLowerCase())) {
      return res.status(404).sendFile(path.join(publicDir, 'index.html'));
    }

    let entry = await cache.get(code);
    if (!entry) {
      entry = await store.get(code);
      if (entry) await cache.set(code, entry);
    }

    if (!entry) {
      const acceptsHtml = (req.get('accept') || '').includes('text/html');
      if (acceptsHtml) return res.status(404).sendFile(path.join(publicDir, 'index.html'));
      return res.status(404).json({ error: 'short URL not found' });
    }

    if (isExpired(entry)) {
      await store.delete(code);
      await cache.del(code);
      return res.status(410).json({ error: 'This short link has expired' });
    }

    if (shouldCountHit(req, code)) {
      await store.incrementHits(code);
      // Keep cache roughly in sync for subsequent hits
      entry.hits = (Number(entry.hits) || 0) + 1;
      entry.last_hit_at = new Date().toISOString();
      await cache.set(code, entry);
    }

    res.redirect(302, entry.url);
  } catch (err) {
    console.error('[redirect]', err);
    res.status(500).json({ error: 'redirect failed' });
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async () => {
  try {
    await initStorage();
    await initCache();
    app.listen(PORT, () => {
      console.log(`URL shortener listening on :${PORT}`);
      console.log(`Mode -> DB_ENABLED=${DB_ENABLED} REDIS_ENABLED=${REDIS_ENABLED}`);
    });
  } catch (err) {
    console.error('Failed to start:', err);
    process.exit(1);
  }
})();
