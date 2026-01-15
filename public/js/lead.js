import { api } from "./api.js";
import { me, logout } from "./auth.js";

const who = document.querySelector("#who");
const title = document.querySelector("#title");
const meta = document.querySelector("#meta");
const err = document.querySelector("#err");

const lossModal = document.querySelector("#lossModal");
const lErr = document.querySelector("#l_err");

const url = new URL(location.href);
const id = Number(url.searchParams.get("id"));

let USER = null;
let LEAD = null;
let STAGES = [];
let USERS = [];

function isoFromLocalInput(v) {
  if (!v) return null;
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

function openLossModal() {
  lErr.textContent = "";
  document.querySelector("#l_reason").value = "";
  document.querySelector("#l_comp").value = "";
  document.querySelector("#l_note").value = "";
  lossModal.classList.remove("hidden");
}
function closeLossModal() {
  lossModal.classList.add("hidden");
}

async function loadStages() {
  const s = await api("/api/leads/stages");
  STAGES = s.stages;
  const sel = document.querySelector("#f_stage");
  sel.innerHTML = STAGES.map(st => `<option value="${st}">${st}</option>`).join("");
}

async function loadUsersIfManager() {
  if (USER.role === "consultor") return;
  const r = await api("/api/manager/users");
  USERS = r.users.filter(u => u.role === "consultor" || u.role === "gestor" || u.role === "admin");
  const ownerWrap = document.querySelector("#ownerWrap");
  ownerWrap.style.display = "block";
  const sel = document.querySelector("#f_owner");
  sel.innerHTML = USERS.map(u => `<option value="${u.id}">${u.name} — ${u.role}</option>`).join("");
}

function renderLead(data) {
  LEAD = data.lead;
  title.textContent = LEAD.name || "Sem nome";
  meta.textContent = `ID #${LEAD.id} • ${LEAD.status} • atualizado em ${new Date(LEAD.updated_at).toLocaleString()}`;

  document.querySelector("#f_name").value = LEAD.name || "";
  document.querySelector("#f_phone").value = LEAD.phone || "";
  document.querySelector("#f_origin").value = LEAD.origin || "";
  document.querySelector("#f_type").value = LEAD.type || "auto";
  document.querySelector("#f_value").value = Number(LEAD.value_estimated || 0);
  document.querySelector("#f_stage").value = LEAD.stage || "Novo lead";
  document.querySelector("#f_next").value = localInputFromISO(LEAD.next_followup_at);
  document.querySelector("#f_step").value = LEAD.next_step || "";

  if (USER.role !== "consultor") {
    const sel = document.querySelector("#f_owner");
    sel.value = LEAD.owner_user_id || sel.value;
  }

  const interactions = data.interactions || [];
  document.querySelector("#interactions").innerHTML = interactions.map(i => `
    <div class="item">
      <strong>${i.type}</strong>
      <div class="muted small">${new Date(i.created_at).toLocaleString()}</div>
      <div>${escapeHtml(i.note || "")}</div>
    </div>
  `).join("") || `<div class="muted small">Sem interações.</div>`;

  const tasks = data.tasks || [];
  document.querySelector("#tasks").innerHTML = tasks.map(t => `
    <div class="item row" style="justify-content:space-between;gap:10px;align-items:flex-start">
      <div>
        <strong>${escapeHtml(t.title || "Task")}</strong>
        <div class="muted small">Vence: ${t.due_at ? new Date(t.due_at).toLocaleString() : "—"}</div>
        <div class="muted small">Status: ${t.status}</div>
      </div>
      <div class="row">
        ${t.status !== "feito" ? `<button class="ghost" data-done="${t.id}">Concluir</button>` : ""}
      </div>
    </div>
  `).join("") || `<div class="muted small">Sem tarefas.</div>`;

  // bind concluir
  document.querySelectorAll("[data-done]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const tid = Number(btn.getAttribute("data-done"));
      await api(`/api/leads/tasks/${tid}`, { method:"PATCH", body:{ status:"feito" } });
      await load();
    });
  });

  const loss = data.loss;
  const lossBox = document.querySelector("#lossBox");
  if (loss) {
    lossBox.className = "item";
    lossBox.innerHTML = `
      <strong>${escapeHtml(loss.reason)}</strong>
      <div class="muted small">Concorrente: ${escapeHtml(loss.competitor || "—")}</div>
      <div class="muted small">${new Date(loss.created_at).toLocaleString()}</div>
      <div>${escapeHtml(loss.note || "")}</div>
    `;
  } else {
    lossBox.className = "muted";
    lossBox.textContent = "Ainda não marcado como perdido.";
  }
}

function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

async function load() {
  const data = await api(`/api/leads/${id}`);
  renderLead(data);
}

document.querySelector("#logoutBtn").addEventListener("click", async () => {
  await logout();
  location.href = "/";
});

document.querySelector("#saveLead").addEventListener("click", async () => {
  err.textContent = "";
  try {
    const body = {
      name: document.querySelector("#f_name").value.trim(),
      phone: document.querySelector("#f_phone").value.trim(),
      origin: document.querySelector("#f_origin").value.trim(),
      type: document.querySelector("#f_type").value,
      value_estimated: Number(document.querySelector("#f_value").value || 0),
      stage: document.querySelector("#f_stage").value,
      next_followup_at: isoFromLocalInput(document.querySelector("#f_next").value),
      next_step: document.querySelector("#f_step").value.trim()
    };

    if (USER.role !== "consultor") {
      body.owner_user_id = Number(document.querySelector("#f_owner").value);
    }

    await api(`/api/leads/${id}`, { method:"PATCH", body });

    // regra ouro: sempre ter follow-up em leads ativos
    if (body.stage !== "Fechado (ganho)" && body.stage !== "Perdido") {
      if (!body.next_followup_at) {
        err.textContent = "Dica: defina o próximo contato para não perder o lead.";
      }
    }

    await load();
  } catch (e) {
    err.textContent = e.message;
  }
});

document.querySelector("#addInteraction").addEventListener("click", async () => {
  const type = document.querySelector("#i_type").value;
  const note = document.querySelector("#i_note").value.trim();
  if (!note) return;
  await api(`/api/leads/${id}/interactions`, { method:"POST", body:{ type, note } });
  document.querySelector("#i_note").value = "";
  await load();
});

document.querySelector("#addTask").addEventListener("click", async () => {
  const title = document.querySelector("#t_title").value.trim() || "Follow-up";
  const due = document.querySelector("#t_due").value ? new Date(document.querySelector("#t_due").value).toISOString() : null;
  await api(`/api/leads/${id}/tasks`, { method:"POST", body:{ title, due_at: due } });
  document.querySelector("#t_title").value = "";
  document.querySelector("#t_due").value = "";
  await load();
});

document.querySelector("#markWon").addEventListener("click", async () => {
  await api(`/api/leads/${id}`, { method:"PATCH", body:{ stage:"Fechado (ganho)" } });
  await load();
});

document.querySelector("#markLost").addEventListener("click", openLossModal);
document.querySelector("#lossCancel").addEventListener("click", closeLossModal);
document.querySelector("#lossSave").addEventListener("click", async () => {
  lErr.textContent = "";
  try {
    const reason = document.querySelector("#l_reason").value.trim();
    const competitor = document.querySelector("#l_comp").value.trim();
    const note = document.querySelector("#l_note").value.trim();
    if (!reason) throw new Error("Motivo é obrigatório.");
    await api(`/api/leads/${id}/loss`, { method:"POST", body:{ reason, competitor, note } });
    closeLossModal();
    await load();
  } catch (e) {
    lErr.textContent = e.message;
  }
});

(async function boot() {
  try {
    if (!id) return location.href = "/app.html";
    const r = await me();
    USER = r.user;
    who.textContent = `— ${USER.name} (${USER.role})`;
    await loadStages();
    await loadUsersIfManager();
    await load();
  } catch {
    location.href = "/";
  }
})();
