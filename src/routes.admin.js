const express = require("express");
const fs = require("fs");
const path = require("path");
const { requireAuth } = require("./auth");
const { dbPath, run, get } = require("./db");
const { parseCSV, toISOFromAny } = require("./csv");

const router = express.Router();

// Download do SQLite (backup)
router.get("/export-db", requireAuth(["admin", "gestor"]), async (req, res) => {
  const fileName = `sov-backup-${new Date().toISOString().slice(0,10)}.sqlite`;
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  fs.createReadStream(dbPath).pipe(res);
});

// Import CSV (envie { csvText: "...", defaultOwnerId?: number })
router.post("/import-csv", requireAuth(["admin", "gestor"]), async (req, res) => {
  const { csvText, defaultOwnerId } = req.body || {};
  if (!csvText) return res.status(400).json({ error: "csvText é obrigatório" });

  const rows = parseCSV(String(csvText));
  if (!rows.length) return res.status(400).json({ error: "CSV vazio" });

  const header = rows[0].map(h => String(h || "").trim().toLowerCase());
  const idx = (name) => header.indexOf(name);

  // colunas esperadas (todas opcionais)
  const col = {
    name: idx("name"),
    phone: idx("phone"),
    origin: idx("origin"),
    type: idx("type"),
    value: idx("value_estimated"),
    stage: idx("stage"),
    next_at: idx("next_followup_at"),
    next_step: idx("next_step"),
    owner_email: idx("owner_email"),
    owner_id: idx("owner_user_id")
  };

  function val(row, i) {
    if (i === -1) return "";
    return (row[i] ?? "").toString().trim();
  }

  let inserted = 0;
  const now = new Date().toISOString();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = val(row, col.name) || "Sem nome";
    const phone = val(row, col.phone);
    const origin = val(row, col.origin);
    const type = val(row, col.type) || "auto";
    const value_estimated = Number(val(row, col.value).replace(",", ".")) || 0;
    const stage = val(row, col.stage) || "Novo lead";
    const next_followup_at = toISOFromAny(val(row, col.next_at));
    const next_step = val(row, col.next_step);

    let owner_user_id = defaultOwnerId ? Number(defaultOwnerId) : req.user.id;

    const ownerIdCsv = val(row, col.owner_id);
    if (ownerIdCsv) owner_user_id = Number(ownerIdCsv) || owner_user_id;

    const ownerEmail = val(row, col.owner_email);
    if (ownerEmail) {
      const u = await get("SELECT id FROM users WHERE email = ? AND active = 1", [ownerEmail]);
      if (u?.id) owner_user_id = u.id;
    }

    await run(
      `INSERT INTO leads
        (name, phone, origin, type, value_estimated, stage, status, owner_user_id, next_followup_at, next_step, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name, phone, origin, type, value_estimated,
        stage,
        (stage === "Fechado (ganho)") ? "ganho" : (stage === "Perdido") ? "perdido" : "ativo",
        owner_user_id,
        next_followup_at,
        next_step,
        now, now
      ]
    );
    inserted++;
  }

  res.json({ ok: true, inserted });
});

module.exports = router;
