const bcrypt = require("bcryptjs");
const { run, get } = require("./db");

// O `postinstall` pode rodar antes do servidor (e antes do init()),
// então garantimos que as tabelas existam aqui também.
async function ensureSchema() {
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  )`);

  await run(`CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    phone TEXT,
    origin TEXT,
    type TEXT,
    value_estimated REAL,
    stage TEXT,
    status TEXT,
    owner_user_id INTEGER,
    next_followup_at TEXT,
    next_step TEXT,
    created_at TEXT,
    updated_at TEXT
  )`);

  await run(`CREATE TABLE IF NOT EXISTS interactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER,
    user_id INTEGER,
    type TEXT,
    note TEXT,
    created_at TEXT
  )`);

  await run(`CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER,
    user_id INTEGER,
    title TEXT,
    due_at TEXT,
    status TEXT,
    done_at TEXT
  )`);

  await run(`CREATE TABLE IF NOT EXISTS loss_reasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER UNIQUE,
    reason TEXT,
    competitor TEXT,
    note TEXT,
    created_at TEXT
  )`);
}

async function seed({ exitProcess = true } = {}) {
  await ensureSchema();
  const existing = await get("SELECT id FROM users WHERE email = ?", ["admin@sov.local"]);
  if (existing) {
    console.log("Seed já aplicado.");
    if (exitProcess) process.exit(0);
    return { alreadySeeded: true };
  }

  const adminHash = await bcrypt.hash(process.env.ADMIN_PASS || "admin123", 10);
  const gestorHash = await bcrypt.hash(process.env.GESTOR_PASS || "gestor123", 10);
  const consHash = await bcrypt.hash(process.env.CONSULTOR_PASS || "consultor123", 10);

  await run("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)", ["Admin", "admin@sov.local", adminHash, "admin"]);
  await run("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)", ["Gestor", "gestor@sov.local", gestorHash, "gestor"]);
  await run("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)", ["Consultor 1", "c1@sov.local", consHash, "consultor"]);
  await run("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)", ["Consultor 2", "c2@sov.local", consHash, "consultor"]);

  console.log("Seed criado:");
  console.log("admin@sov.local / admin123");
  console.log("gestor@sov.local / gestor123");
  console.log("c1@sov.local / consultor123");
  console.log("c2@sov.local / consultor123");
  if (exitProcess) process.exit(0);
  return { alreadySeeded: false };
}

if (require.main === module) {
  seed({ exitProcess: true });
} else {
  module.exports = seed;
}
