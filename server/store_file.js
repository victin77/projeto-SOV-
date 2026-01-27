const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { loadDb, saveDb } = require('./db');

function addAuditToDb(db, entry) {
  db.audit.push({
    id: crypto.randomUUID(),
    at: Date.now(),
    ...entry
  });
  if (db.audit.length > 2000) db.audit.splice(0, db.audit.length - 2000);
}

function getSeedMode() {
  const allowDefaultSeed = process.env.SOV_ALLOW_DEFAULT_SEED === '1';
  const isProd = process.env.NODE_ENV === 'production';
  return { allowDefaultSeed, isProd };
}

function getDefaultSeedUsers() {
  return [
    { user: 'admin', pass: 'admin123', role: 'admin' },
    { user: 'grazielle', pass: 'grazielle123', role: 'consultor' },
    { user: 'pedro', pass: 'pedro123', role: 'consultor' },
    { user: 'poli', pass: 'poli123', role: 'consultor' },
    { user: 'gustavo', pass: 'gustavo123', role: 'consultor' },
    { user: 'victor', pass: 'victor123', role: 'consultor' },
    { user: 'marcelo', pass: 'marcelo123', role: 'consultor' }
  ];
}

function ensureUsersSeededFile(db) {
  if (db.users.length > 0) return;

  const { allowDefaultSeed, isProd } = getSeedMode();
  const bootstrapUser = (process.env.SOV_BOOTSTRAP_ADMIN_USER || 'admin').trim().toLowerCase();
  const bootstrapPass = process.env.SOV_BOOTSTRAP_ADMIN_PASS;

  if (bootstrapPass) {
    db.users.push({
      user: bootstrapUser,
      role: 'admin',
      passHash: bcrypt.hashSync(String(bootstrapPass), 10),
      createdAt: new Date().toISOString()
    });
    return;
  }

  if (allowDefaultSeed || !isProd) {
    const seed = getDefaultSeedUsers();
    db.users = seed.map((u) => ({
      user: u.user,
      role: u.role,
      passHash: bcrypt.hashSync(u.pass, 10),
      createdAt: new Date().toISOString()
    }));
    return;
  }

  const tempPass = crypto.randomBytes(12).toString('base64url');
  db.users.push({
    user: bootstrapUser,
    role: 'admin',
    passHash: bcrypt.hashSync(tempPass, 10),
    createdAt: new Date().toISOString()
  });
  // eslint-disable-next-line no-console
  console.log(`[BOOTSTRAP] Admin criado: ${bootstrapUser}`);
  // eslint-disable-next-line no-console
  console.log(`[BOOTSTRAP] Senha temporária: ${tempPass}`);
  // eslint-disable-next-line no-console
  console.log('[BOOTSTRAP] Defina SOV_BOOTSTRAP_ADMIN_PASS para fixar uma senha e crie usuários no app.');
}

function createFileStore() {
  return {
    kind: 'file',
    async init() {
      // no-op
    },
    async ensureUsersSeeded() {
      const db = loadDb();
      const before = db.users.length;
      ensureUsersSeededFile(db);
      if (db.users.length !== before) saveDb(db);
    },
    async getUser(username) {
      const db = loadDb();
      return db.users.find((u) => u.user === username) || null;
    },
    async listUsers() {
      const db = loadDb();
      return db.users.map((u) => ({ user: u.user, role: u.role, createdAt: u.createdAt }));
    },
    async createUser({ user, pass, role }) {
      const db = loadDb();
      const exists = db.users.some((u) => u.user === user);
      if (exists) return null;

      const next = {
        user,
        role,
        passHash: bcrypt.hashSync(String(pass), 10),
        createdAt: new Date().toISOString()
      };
      db.users.push(next);
      saveDb(db);
      return { user: next.user, role: next.role, createdAt: next.createdAt };
    },
    async addAudit(entry) {
      const db = loadDb();
      addAuditToDb(db, entry);
      saveDb(db);
    },
    async listLeads() {
      const db = loadDb();
      return db.leads.filter((l) => !l.deleted);
    },
    async getLead(id) {
      const db = loadDb();
      return db.leads.find((l) => l.id === id) || null;
    },
    async insertLead(storedLead, actor) {
      const db = loadDb();
      db.leads.push(storedLead);
      addAuditToDb(db, { actor, action: 'lead_create', entityType: 'lead', entityId: storedLead.id });
      saveDb(db);
      return storedLead;
    },
    async updateLead(id, storedLead, actor) {
      const db = loadDb();
      const idx = db.leads.findIndex((l) => l.id === id);
      if (idx === -1) return null;
      db.leads[idx] = storedLead;
      addAuditToDb(db, { actor, action: 'lead_update', entityType: 'lead', entityId: id });
      saveDb(db);
      return storedLead;
    },
    async softDeleteLead(id, actor) {
      const db = loadDb();
      const idx = db.leads.findIndex((l) => l.id === id);
      if (idx === -1) return false;
      db.leads[idx] = {
        ...db.leads[idx],
        deleted: true,
        updatedAt: Date.now(),
        lastModifiedBy: actor
      };
      addAuditToDb(db, { actor, action: 'lead_delete', entityType: 'lead', entityId: id });
      saveDb(db);
      return true;
    },
    async replaceLeads(nextLeads, actor) {
      const db = loadDb();
      db.leads = nextLeads;
      addAuditToDb(db, { actor, action: 'leads_replace', entityType: 'lead' });
      saveDb(db);
      return nextLeads.length;
    },
    async listAudit(limit) {
      const db = loadDb();
      const lim = Math.min(500, Math.max(1, Number(limit || 100)));
      return db.audit.slice(-lim).reverse();
    }
  };
}

module.exports = {
  createFileStore
};
