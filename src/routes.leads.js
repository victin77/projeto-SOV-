const express = require("express");
const { all, get, run } = require("./db");
const { requireAuth } = require("./auth");

const router = express.Router();

const STAGES = [
  "Novo lead",
  "Primeiro contato",
  "Qualificação",
  "Simulação enviada",
  "Proposta enviada",
  "Negociação",
  "Fechado (ganho)",
  "Perdido"
];

function canSeeLead(user, lead) {
  if (!lead) return false;
  if (user.role === "consultor") return lead.owner_user_id === user.id;
  return true;
}

router.get("/stages", requireAuth(), (req, res) => res.json({ stages: STAGES }));

router.get("/", requireAuth(), async (req, res) => {
  const user = req.user;

  // filtro opcional por owner (gestor/admin)
  const owner = req.query.owner ? Number(req.query.owner) : null;

  let rows;
  if (user.role === "consultor") {
    rows = await all("SELECT * FROM leads WHERE owner_user_id = ? ORDER BY updated_at DESC", [user.id]);
  } else if (owner) {
    rows = await all("SELECT * FROM leads WHERE owner_user_id = ? ORDER BY updated_at DESC", [owner]);
  } else {
    rows = await all("SELECT * FROM leads ORDER BY updated_at DESC");
  }

  res.json({ leads: rows });
});

router.post("/", requireAuth(), async (req, res) => {
  const user = req.user;
  const b = req.body || {};

  const owner = (user.role === "consultor") ? user.id : (b.owner_user_id || user.id);
  const stage = b.stage || "Novo lead";
  const now = new Date().toISOString();

  const r = await run(
    `INSERT INTO leads
      (name, phone, origin, type, value_estimated, stage, status, owner_user_id, next_followup_at, next_step, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      b.name || "Sem nome",
      b.phone || "",
      b.origin || "",
      b.type || "auto",
      Number(b.value_estimated || 0),
      stage,
      "ativo",
      owner,
      b.next_followup_at || null,
      b.next_step || "",
      now,
      now
    ]
  );

  const lead = await get("SELECT * FROM leads WHERE id = ?", [r.lastID]);
  res.json({ lead });
});

router.get("/:id", requireAuth(), async (req, res) => {
  const lead = await get("SELECT * FROM leads WHERE id = ?", [req.params.id]);
  if (!canSeeLead(req.user, lead)) return res.status(404).json({ error: "Não encontrado" });

  const interactions = await all("SELECT * FROM interactions WHERE lead_id = ? ORDER BY created_at DESC", [lead.id]);
  const tasks = await all("SELECT * FROM tasks WHERE lead_id = ? ORDER BY due_at ASC", [lead.id]);
  const loss = await get("SELECT * FROM loss_reasons WHERE lead_id = ?", [lead.id]);

  res.json({ lead, interactions, tasks, loss });
});

router.patch("/:id", requireAuth(), async (req, res) => {
  const user = req.user;
  const lead = await get("SELECT * FROM leads WHERE id = ?", [req.params.id]);
  if (!canSeeLead(user, lead)) return res.status(404).json({ error: "Não encontrado" });

  const b = req.body || {};
  const now = new Date().toISOString();

  let status = lead.status;
  if (b.stage === "Fechado (ganho)") status = "ganho";
  if (b.stage === "Perdido") status = "perdido";

  const owner = (user.role === "consultor") ? lead.owner_user_id : (b.owner_user_id ?? lead.owner_user_id);

  await run(
    `UPDATE leads SET
      name = COALESCE(?, name),
      phone = COALESCE(?, phone),
      origin = COALESCE(?, origin),
      type = COALESCE(?, type),
      value_estimated = COALESCE(?, value_estimated),
      stage = COALESCE(?, stage),
      status = ?,
      owner_user_id = ?,
      next_followup_at = COALESCE(?, next_followup_at),
      next_step = COALESCE(?, next_step),
      updated_at = ?
    WHERE id = ?`,
    [
      b.name ?? null,
      b.phone ?? null,
      b.origin ?? null,
      b.type ?? null,
      (b.value_estimated !== undefined ? Number(b.value_estimated) : null),
      b.stage ?? null,
      status,
      owner,
      b.next_followup_at ?? null,
      b.next_step ?? null,
      now,
      lead.id
    ]
  );

  const updated = await get("SELECT * FROM leads WHERE id = ?", [lead.id]);
  res.json({ lead: updated });
});

router.post("/:id/interactions", requireAuth(), async (req, res) => {
  const lead = await get("SELECT * FROM leads WHERE id = ?", [req.params.id]);
  if (!canSeeLead(req.user, lead)) return res.status(404).json({ error: "Não encontrado" });

  const b = req.body || {};
  const now = new Date().toISOString();
  const r = await run(
    "INSERT INTO interactions (lead_id, user_id, type, note, created_at) VALUES (?, ?, ?, ?, ?)",
    [lead.id, req.user.id, b.type || "whatsapp", b.note || "", now]
  );
  const row = await get("SELECT * FROM interactions WHERE id = ?", [r.lastID]);
  res.json({ interaction: row });
});

router.post("/:id/tasks", requireAuth(), async (req, res) => {
  const lead = await get("SELECT * FROM leads WHERE id = ?", [req.params.id]);
  if (!canSeeLead(req.user, lead)) return res.status(404).json({ error: "Não encontrado" });

  const b = req.body || {};
  const r = await run(
    "INSERT INTO tasks (lead_id, user_id, title, due_at, status, done_at) VALUES (?, ?, ?, ?, ?, ?)",
    [lead.id, req.user.id, b.title || "Follow-up", b.due_at || null, "pendente", null]
  );
  const row = await get("SELECT * FROM tasks WHERE id = ?", [r.lastID]);
  res.json({ task: row });
});

router.patch("/tasks/:taskId", requireAuth(), async (req, res) => {
  const b = req.body || {};
  const task = await get("SELECT * FROM tasks WHERE id = ?", [req.params.taskId]);
  if (!task) return res.status(404).json({ error: "Task não encontrada" });

  const lead = await get("SELECT * FROM leads WHERE id = ?", [task.lead_id]);
  if (!canSeeLead(req.user, lead)) return res.status(404).json({ error: "Não encontrado" });

  const done_at = (b.status === "feito") ? new Date().toISOString() : null;
  await run("UPDATE tasks SET status = COALESCE(?, status), done_at = ? WHERE id = ?", [b.status ?? null, done_at, task.id]);
  const updated = await get("SELECT * FROM tasks WHERE id = ?", [task.id]);
  res.json({ task: updated });
});

router.post("/:id/loss", requireAuth(), async (req, res) => {
  const lead = await get("SELECT * FROM leads WHERE id = ?", [req.params.id]);
  if (!canSeeLead(req.user, lead)) return res.status(404).json({ error: "Não encontrado" });

  const b = req.body || {};
  if (!b.reason) return res.status(400).json({ error: "Motivo obrigatório" });

  const now = new Date().toISOString();
  await run("DELETE FROM loss_reasons WHERE lead_id = ?", [lead.id]);
  await run(
    "INSERT INTO loss_reasons (lead_id, reason, competitor, note, created_at) VALUES (?, ?, ?, ?, ?)",
    [lead.id, b.reason, b.competitor || "", b.note || "", now]
  );

  await run("UPDATE leads SET stage = ?, status = ?, updated_at = ? WHERE id = ?", ["Perdido", "perdido", now, lead.id]);

  const loss = await get("SELECT * FROM loss_reasons WHERE lead_id = ?", [lead.id]);
  const updatedLead = await get("SELECT * FROM leads WHERE id = ?", [lead.id]);
  res.json({ loss, lead: updatedLead });
});

module.exports = router;
