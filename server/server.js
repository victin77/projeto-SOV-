const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { signToken, authMiddleware } = require('./auth');
const { createStore } = require('./store');

const PORT = Number(process.env.PORT || 3000);
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

const store = createStore();

function wrapAsync(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

app.get('/api/ping', (req, res) => {
  res.json({ ok: true, time: Date.now() });
});

app.post('/api/auth/login', wrapAsync(async (req, res) => {
  const user = (req.body && req.body.user ? String(req.body.user) : '').trim().toLowerCase();
  const pass = req.body && typeof req.body.pass === 'string' ? req.body.pass : '';
  if (!user || !pass) return res.status(400).json({ error: 'missing_credentials' });

  await store.ensureUsersSeeded();

  const found = await store.getUser(user);
  if (!found) return res.status(401).json({ error: 'user_not_found' });
  const ok = bcrypt.compareSync(pass, found.passHash);
  if (!ok) return res.status(401).json({ error: 'wrong_password' });

  const { token, expMs } = signToken({ user, role: found.role, ttlMs: SESSION_TTL_MS });
  await store.addAudit({ actor: user, action: 'login', entityType: 'auth' });

  res.json({ user, role: found.role, token, exp: expMs });
}));

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: req.auth.user, role: req.auth.role, exp: req.auth.exp });
});

app.post('/api/auth/logout', authMiddleware, wrapAsync(async (req, res) => {
  await store.addAudit({ actor: req.auth.user, action: 'logout', entityType: 'auth' });
  res.json({ ok: true });
}));

function sanitizeLead(raw) {
  const safeStr = (v, max = 500) => {
    const s = (v ?? '').toString().trim();
    return s.length > max ? s.slice(0, max) : s;
  };

  const tagsRaw = Array.isArray(raw.tags) ? raw.tags : [];
  const tags = Array.from(
    new Set(tagsRaw.map((t) => safeStr(t, 40).toLowerCase()).filter(Boolean))
  ).slice(0, 20);

  const tasksRaw = Array.isArray(raw.tasks) ? raw.tasks : [];
  const tasks = tasksRaw
    .filter((t) => t && typeof t === 'object')
    .slice(0, 200)
    .map((t) => ({ desc: safeStr(t.desc, 160), done: !!t.done }))
    .filter((t) => t.desc);

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    name: safeStr(raw.name, 120),
    phone: safeStr(raw.phone, 30),
    origin: safeStr(raw.origin, 60) || 'Geral',
    value: Number(raw.value) || 0,
    nextStep: safeStr(raw.nextStep, 160),
    stage: safeStr(raw.stage, 40) || 'Novo lead',
    tasks,
    lossReason: safeStr(raw.lossReason, 60),
    obs: safeStr(raw.obs, 2000),
    owner: safeStr(raw.owner, 60),
    tags
  };
}

app.get('/api/leads', authMiddleware, wrapAsync(async (req, res) => {
  const leads = await store.listLeads();
  res.json({ leads });
}));

app.post('/api/leads', authMiddleware, wrapAsync(async (req, res) => {
  const lead = sanitizeLead(req.body || {});
  if (!lead.name) return res.status(400).json({ error: 'missing_name' });

  const now = Date.now();
  const stored = {
    ...lead,
    createdAt: now,
    updatedAt: now,
    deleted: false,
    lastModifiedBy: req.auth.user
  };

  const saved = await store.insertLead(stored, req.auth.user);
  res.json({ lead: saved });
}));

app.put('/api/leads/:id', authMiddleware, wrapAsync(async (req, res) => {
  const id = req.params.id;
  const existing = await store.getLead(id);
  if (!existing || existing.deleted) return res.status(404).json({ error: 'not_found' });

  const next = sanitizeLead({ ...existing, ...(req.body || {}), id });
  if (!next.name) return res.status(400).json({ error: 'missing_name' });

  const now = Date.now();
  const updated = {
    ...existing,
    ...next,
    updatedAt: now,
    lastModifiedBy: req.auth.user
  };
  const saved = await store.updateLead(id, updated, req.auth.user);
  if (!saved) return res.status(404).json({ error: 'not_found' });
  res.json({ lead: saved });
}));

app.delete('/api/leads/:id', authMiddleware, wrapAsync(async (req, res) => {
  const id = req.params.id;
  const existing = await store.getLead(id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const ok = await store.softDeleteLead(id, req.auth.user);
  if (!ok) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
}));

app.post('/api/leads/replace', authMiddleware, wrapAsync(async (req, res) => {
  const incoming = req.body && Array.isArray(req.body.leads) ? req.body.leads : null;
  if (!incoming) return res.status(400).json({ error: 'missing_leads' });

  const sanitized = [];
  const ids = new Set();
  for (let i = 0; i < incoming.length; i++) {
    const lead = sanitizeLead(incoming[i] || {});
    if (!lead.name) continue;
    let id = lead.id;
    while (ids.has(id)) id = crypto.randomUUID();
    ids.add(id);
    const now = Date.now();
    sanitized.push({
      ...lead,
      id,
      createdAt: typeof incoming[i].createdAt === 'number' ? incoming[i].createdAt : now,
      updatedAt: now,
      deleted: false,
      lastModifiedBy: req.auth.user
    });
  }

  const count = await store.replaceLeads(sanitized, req.auth.user);
  res.json({ ok: true, count });
}));

app.get('/api/audit', authMiddleware, wrapAsync(async (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
  const items = await store.listAudit(limit);
  res.json({ audit: items });
}));

// Serve front-end
const ROOT = process.cwd();

// Do not expose private folders/files via static hosting
const STATIC_BLOCK_PREFIXES = ['/data', '/server', '/node_modules'];
const STATIC_BLOCK_PATHS = new Set(['/package.json', '/package-lock.json', '/.gitignore']);
app.use((req, res, next) => {
  const p = req.path || '';
  if (STATIC_BLOCK_PATHS.has(p) || STATIC_BLOCK_PREFIXES.some((pref) => p === pref || p.startsWith(`${pref}/`))) {
    return res.status(404).end();
  }
  next();
});

app.use(express.static(ROOT));
app.get('/', (req, res) => {
  res.sendFile(path.join(ROOT, 'login.html'));
});

app.use((err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'internal_error' });
});

async function start() {
  await store.init();
  // eslint-disable-next-line no-console
  console.log(`SOV CRM store: ${store.kind}`);

  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`SOV CRM running on http://localhost:${PORT}`);
  });
}

start().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server:', e);
  process.exit(1);
});
