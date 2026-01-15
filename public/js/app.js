import { api } from "./api.js";
import { me, logout } from "./auth.js";

const board = document.querySelector("#board");
const who = document.querySelector("#who");
const filterInfo = document.querySelector("#filterInfo");
const toManager = document.querySelector("#toManager");

const modal = document.querySelector("#modal");
const mErr = document.querySelector("#m_err");

const lossModal = document.querySelector("#lossModal");
const lErr = document.querySelector("#l_err");
let lossLeadId = null;

const FOLLOWUP_LIMIT_DAYS = 3;

function isoFromLocalInput(v) {
  if (!v) return null;
  // datetime-local -> local time; convert to ISO
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function localInputFromISO(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function daysSince(iso) {
  if (!iso) return 999;
  const t = new Date(iso).getTime();
  const now = Date.now();
  return Math.floor((now - t) / (1000*60*60*24));
}
function isOverdue(nextFollowupAt, updatedAt) {
  if (!nextFollowupAt) return true;
  const overdue = new Date(nextFollowupAt).getTime() < Date.now();
  const stale = daysSince(updatedAt) >= FOLLOWUP_LIMIT_DAYS;
  return overdue || stale;
}

let STAGES = [];
let LEADS = [];
let USER = null;
let OWNER_FILTER = null;

function openModal() { modal.classList.remove("hidden"); }
function closeModal() { modal.classList.add("hidden"); mErr.textContent = ""; }

function openLossModal(leadId) {
  lossLeadId = leadId;
  lErr.textContent = "";
  document.querySelector("#l_reason").value = "";
  document.querySelector("#l_comp").value = "";
  document.querySelector("#l_note").value = "";
  lossModal.classList.remove("hidden");
}
function closeLossModal() {
  lossModal.classList.add("hidden");
  lossLeadId = null;
}

async function ensureAuth() {
  const r = await me();
  USER = r.user;
  who.textContent = `— ${USER.name} (${USER.role})`;

  if (USER.role !== "consultor") {
    toManager.style.display = "inline-block";
  }

  const url = new URL(location.href);
  const owner = url.searchParams.get("owner");
  if (USER.role === "consultor") {
    OWNER_FILTER = null;
    filterInfo.textContent = "";
  } else if (owner) {
    OWNER_FILTER = Number(owner);
    filterInfo.textContent = owner ? ` • filtro: consultor #${owner}` : "";
  }
}

function leadCard(lead) {
  const overdue = isOverdue(lead.next_followup_at, lead.updated_at);
  const el = document.createElement("div");
  el.className = `card ${overdue ? "overdue" : ""}`;
  el.draggable = true;
  el.dataset.id = lead.id;

  el.innerHTML = `
    <div class="cardTitle">${lead.name || "Sem nome"}</div>
    <div class="muted small">${lead.phone || ""}</div>
    <div class="pillRow">
      <span class="pill">${lead.type || "auto"}</span>
      <span class="pill">${lead.origin || "origem?"}</span>
    </div>
    <div class="muted small">
      Próx: ${lead.next_followup_at ? new Date(lead.next_followup_at).toLocaleString() : "SEM follow-up"}
    </div>
    <div class="muted small">Passo: ${lead.next_step || "—"}</div>
    <div class="muted small">R$ ${Number(lead.value_estimated||0).toLocaleString("pt-BR")}</div>
  `;

  el.addEventListener("click", () => {
    location.href = `/lead.html?id=${lead.id}`;
  });

  el.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", String(lead.id));
  });

  return el;
}

function stageColumn(name) {
  const col = document.createElement("div");
  col.className = "col";
  col.dataset.stage = name;

  col.innerHTML = `
    <div class="colHead">
      <strong>${name}</strong>
      <span class="muted small" data-count></span>
    </div>
    <div class="dropzone" data-drop></div>
  `;

  const dz = col.querySelector("[data-drop]");
  dz.addEventListener("dragover", (e) => e.preventDefault());
  dz.addEventListener("drop", async (e) => {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData("text/plain"));
    const lead = LEADS.find(l => l.id === id);
    if (!lead) return;

    if (name === "Perdido") {
      openLossModal(id);
      return;
    }

    await api(`/api/leads/${id}`, { method: "PATCH", body: { stage: name } });
    await load();
  });

  return col;
}

function render() {
  board.innerHTML = "";
  const byStage = {};
  for (const s of STAGES) byStage[s] = [];
  for (const l of LEADS) byStage[l.stage]?.push(l);

  for (const s of STAGES) {
    const col = stageColumn(s);
    const dz = col.querySelector("[data-drop]");
    const count = col.querySelector("[data-count]");
    const arr = byStage[s] || [];
    count.textContent = `(${arr.length})`;

    arr.forEach(lead => dz.appendChild(leadCard(lead)));
    board.appendChild(col);
  }
}

async function load() {
  const s = await api("/api/leads/stages");
  STAGES = s.stages;

  const q = OWNER_FILTER ? `?owner=${encodeURIComponent(OWNER_FILTER)}` : "";
  const r = await api(`/api/leads${q}`);
  LEADS = r.leads;

  render();
}

document.querySelector("#logoutBtn").addEventListener("click", async () => {
  await logout();
  location.href = "/";
});

document.querySelector("#newLeadBtn").addEventListener("click", openModal);
document.querySelector("#closeModal").addEventListener("click", closeModal);

document.querySelector("#saveLead").addEventListener("click", async () => {
  mErr.textContent = "";
  try {
    const body = {
      name: document.querySelector("#m_name").value.trim(),
      phone: document.querySelector("#m_phone").value.trim(),
      origin: document.querySelector("#m_origin").value.trim(),
      type: document.querySelector("#m_type").value,
      value_estimated: Number(document.querySelector("#m_value").value || 0),
      next_followup_at: isoFromLocalInput(document.querySelector("#m_next").value),
      next_step: document.querySelector("#m_step").value.trim()
    };

    if (!body.next_followup_at) throw new Error("Defina o próximo contato (follow-up).");

    await api("/api/leads", { method: "POST", body });
    closeModal();
    await load();
  } catch (e) {
    mErr.textContent = e.message;
  }
});

document.querySelector("#lossCancel").addEventListener("click", closeLossModal);
document.querySelector("#lossSave").addEventListener("click", async () => {
  lErr.textContent = "";
  try {
    const reason = document.querySelector("#l_reason").value.trim();
    const competitor = document.querySelector("#l_comp").value.trim();
    const note = document.querySelector("#l_note").value.trim();
    if (!reason) throw new Error("Motivo é obrigatório.");

    await api(`/api/leads/${lossLeadId}/loss`, { method: "POST", body: { reason, competitor, note } });
    closeLossModal();
    await load();
  } catch (e) {
    lErr.textContent = e.message;
  }
});

(async function boot() {
  try {
    await ensureAuth();
    await load();
  } catch {
    location.href = "/";
  }
})();
