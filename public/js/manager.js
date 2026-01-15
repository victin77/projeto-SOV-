import { api } from "./api.js";
import { me, logout } from "./auth.js";

const who = document.querySelector("#who");
const usersEl = document.querySelector("#users");
const statsEl = document.querySelector("#stats");
const leadsEl = document.querySelector("#leads");
const userFilter = document.querySelector("#userFilter");
const toKanban = document.querySelector("#toKanban");
const exportDb = document.querySelector("#exportDb");
const csvFile = document.querySelector("#csvFile");
const importResult = document.querySelector("#importResult");

let USERS = [];
let LEADS = [];
let USER = null;

document.querySelector("#logoutBtn").addEventListener("click", async () => {
  await logout();
  location.href = "/";
});

function fillFilter() {
  userFilter.innerHTML = `
    <option value="">Todos</option>
    ${USERS.filter(u => u.role === "consultor").map(u => `<option value="${u.id}">${u.name}</option>`).join("")}
  `;
}

function applyFilter() {
  const val = userFilter.value;
  if (val) {
    toKanban.href = `/app.html?owner=${encodeURIComponent(val)}`;
    const filtered = LEADS.filter(l => String(l.owner_user_id) === String(val));
    renderStats(filtered);
    renderLeads(filtered);
  } else {
    toKanban.href = "/app.html";
    renderStats(LEADS);
    renderLeads(LEADS);
  }
}

function renderUsers() {
  usersEl.innerHTML = USERS.filter(u => u.role === "consultor").map(u => `
    <div class="item">
      <strong>${u.name}</strong>
      <div class="muted small">${u.email} — ${u.role}</div>
    </div>
  `).join("");
}

function renderStats(list) {
  const total = list.length;
  const ativos = list.filter(l => l.status === "ativo").length;
  const ganhos = list.filter(l => l.status === "ganho").length;
  const perdidos = list.filter(l => l.status === "perdido").length;

  statsEl.innerHTML = `
    <div class="stat"><div class="muted small">Total</div><div class="big">${total}</div></div>
    <div class="stat"><div class="muted small">Ativos</div><div class="big">${ativos}</div></div>
    <div class="stat"><div class="muted small">Ganhos</div><div class="big">${ganhos}</div></div>
    <div class="stat"><div class="muted small">Perdidos</div><div class="big">${perdidos}</div></div>
  `;
}

function renderLeads(list) {
  leadsEl.innerHTML = list.slice(0, 80).map(l => `
    <div class="item row" style="justify-content:space-between;gap:10px;align-items:flex-start">
      <div>
        <strong>${escapeHtml(l.name || "Sem nome")}</strong>
        <div class="muted small">${escapeHtml(l.phone || "")} • ${escapeHtml(l.origin || "—")} • ${escapeHtml(l.stage || "")}</div>
        <div class="muted small">Próx: ${l.next_followup_at ? new Date(l.next_followup_at).toLocaleString() : "SEM follow-up"}</div>
      </div>
      <div class="row">
        <a class="ghost" href="/lead.html?id=${l.id}">Abrir</a>
      </div>
    </div>
  `).join("") || `<div class="muted small">Sem leads.</div>`;
}

function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

exportDb.addEventListener("click", () => {
  // baixa direto
  window.location.href = "/api/admin/export-db";
});

csvFile.addEventListener("change", async () => {
  importResult.textContent = "";
  const file = csvFile.files?.[0];
  if (!file) return;

  const text = await file.text();
  try {
    const ownerId = userFilter.value ? Number(userFilter.value) : null;
    const r = await api("/api/admin/import-csv", { method:"POST", body:{ csvText: text, defaultOwnerId: ownerId } });
    importResult.textContent = `Importado com sucesso: ${r.inserted} leads.`;
    await loadLeads();
    applyFilter();
  } catch (e) {
    importResult.textContent = `Erro ao importar: ${e.message}`;
  } finally {
    csvFile.value = "";
  }
});

async function loadLeads() {
  const leads = await api("/api/leads");
  LEADS = leads.leads;
}

(async function boot(){
  try{
    const r = await me();
    USER = r.user;
    who.textContent = `— ${USER.name} (${USER.role})`;

    const users = await api("/api/manager/users");
    USERS = users.users;

    fillFilter();
    renderUsers();

    await loadLeads();
    renderStats(LEADS);
    renderLeads(LEADS);

    userFilter.addEventListener("change", applyFilter);
  } catch {
    location.href = "/";
  }
})();
