const bcrypt = require("bcryptjs");
const { run, get } = require("./db");

async function seed() {
  const existing = await get("SELECT id FROM users WHERE email = ?", ["admin@sov.local"]);
  if (existing) {
    console.log("Seed já aplicado.");
    process.exit(0);
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
  process.exit(0);
}

seed();
