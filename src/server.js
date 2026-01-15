const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");
const { run } = require("./db");

const authRoutes = require("./routes.auth");
const leadRoutes = require("./routes.leads");
const managerRoutes = require("./routes.manager");
const adminRoutes = require("./routes.admin");
const seed = require("./seed");

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());

async function init() {
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

app.use("/api/auth", authRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/manager", managerRoutes);
app.use("/api/admin", adminRoutes);

const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));
app.get("/", (req, res) => res.sendFile(path.join(publicDir, "index.html")));

async function boot() {
  await init();
  // Garante que existam usuários padrão em ambientes onde o seed não é executado (ex: deploy novo no Railway)
  try {
    await seed({ exitProcess: false });
  } catch (e) {
    console.error("Falha ao aplicar seed automático:", e.message);
  }

  const PORT = process.env.PORT || 3333;
  app.listen(PORT, () => console.log("SOV rodando na porta", PORT));
}

boot().catch((e) => {
  console.error("Falha ao iniciar o servidor:", e);
  process.exit(1);
});
