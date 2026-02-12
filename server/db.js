const path = require('node:path');
const bcrypt = require('bcryptjs');
const { readJsonFile, writeJsonAtomic, ensureDir } = require('./storage');

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

function defaultDb() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    users: [],
    leads: [],
    audit: []
  };
}

function loadDb() {
  ensureDir(DATA_DIR);
  const db = readJsonFile(DB_PATH, defaultDb());
  if (!db || typeof db !== 'object') return defaultDb();
  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.leads)) db.leads = [];
  if (!Array.isArray(db.audit)) db.audit = [];
  if (!db.version) db.version = 1;
  return db;
}

function saveDb(db) {
  writeJsonAtomic(DB_PATH, db);
}

function seedUsersIfEmpty(db) {
  if (db.users.length > 0) return false;

  const seed = [
    { user: 'admin', pass: 'admin123', role: 'admin' },
    { user: 'grazielle', pass: 'grazielle123', role: 'consultor' },
    { user: 'pedro', pass: 'pedro123', role: 'consultor' },
    { user: 'poli', pass: 'poli123', role: 'consultor' },
    { user: 'gustavo', pass: 'gustavo123', role: 'consultor' },
    { user: 'victor', pass: 'victor123', role: 'consultor' },
    { user: 'marcelo', pass: 'marcelo123', role: 'consultor' }
  ];

  db.users = seed.map((u) => ({
    user: u.user,
    role: u.role,
    passHash: bcrypt.hashSync(u.pass, 10),
    createdAt: new Date().toISOString()
  }));
  return true;
}

module.exports = {
  loadDb,
  saveDb,
  seedUsersIfEmpty
};

