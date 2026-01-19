const STAGES = ['Novo lead', 'Qualificação', 'Simulação', 'Negociação', 'Fechado', 'Perdido'];
// Usuários (para o select de "dono" quando for admin)
const CONSULTORES = ['grazielle', 'pedro', 'poli', 'gustavo', 'victor', 'marcelo'];


let leads = JSON.parse(localStorage.getItem('sov_crm_data')) || [];
let currentView = 'kanban';
let filterText = '';
let salesChart = null;
let currentChartType = localStorage.getItem('sov_chart_type') || 'bar';

// --- Sessão / Permissões ---
let session = null;

function getSession() {
    try {
        return JSON.parse(localStorage.getItem('sov_session') || 'null');
    } catch {
        return null;
    }
}

function isAdmin() {
    return session && (session.role === 'admin' || session.user === 'admin');
}

function requireAuth() {
    session = getSession();
    if (!session || !session.user) {
        window.location.href = 'login.html';
        return false;
    }
    return true;
}

function logout() {
    localStorage.removeItem('sov_session');
    window.location.href = 'login.html';
}

function visibleLeads() {
    if (isAdmin()) return leads;
    const u = (session?.user || '').toLowerCase();
    return leads.filter(l => (l.owner || 'admin') === u);
}

function canEditLead(lead) {
    if (isAdmin()) return true;
    const u = (session?.user || '').toLowerCase();
    return (lead.owner || 'admin') === u;
}

// --- Tema (Claro/Escuro) ---
function initTheme() {
    const stored = localStorage.getItem('sov_theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = stored || (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeIcon(theme);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('sov_theme', next);
    updateThemeIcon(next);
    // Re-render para o Chart pegar as cores certas
    renderApp();
}

function updateThemeIcon(theme) {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.innerHTML = theme === 'dark' ? '<i class="ph ph-sun"></i>' : '<i class="ph ph-moon"></i>';
}

// Início
function init() {
    if (!requireAuth()) return;
    initTheme();

    // Top bar: usuário + role + botão sair
    const chip = document.getElementById('user-chip');
    const whoUser = document.getElementById('who-user');
    const whoRole = document.getElementById('who-role');
    const btnLogout = document.getElementById('logout-btn');
    if (chip && whoUser && whoRole) {
        chip.style.display = 'flex';
        whoUser.textContent = (session.user || '').toLowerCase();
        whoRole.textContent = isAdmin() ? 'admin' : 'consultor';
    }
    if (btnLogout) btnLogout.style.display = 'inline-flex';

    // Modal Novo Lead: admin pode escolher o dono
    const ownerWrap = document.getElementById('owner-wrap');
    const ownerSelect = document.getElementById('nl-owner');
    if (ownerWrap && ownerSelect) {
        if (isAdmin()) {
            ownerWrap.style.display = 'block';
            ownerSelect.innerHTML = '';
            ['admin', ...CONSULTORES].forEach(u => {
                const opt = document.createElement('option');
                opt.value = u;
                opt.textContent = u;
                ownerSelect.appendChild(opt);
            });
        } else {
            ownerWrap.style.display = 'none';
        }
    }

    renderApp();
}

function switchView(view) {
    currentView = view;
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
    document.getElementById(view === 'kanban' ? 'nav-kanban' : 'nav-dash').classList.add('active');
    renderApp();
}

function handleFilter() {
    filterText = document.getElementById('global-search').value.toLowerCase();
    renderApp();
}

function renderApp() {
    const container = document.getElementById('view-container');
    container.innerHTML = '';

    if (currentView === 'kanban') {
        renderKanban(container);
    } else {
        renderDashboard(container);
    }
}

function leadMatchesFilter(lead) {
  if (!filterText) return true;

  const hay = [
    lead.name,
    lead.origin,
    lead.stage,
    lead.nextStep,
    lead.obs,
    lead.lossReason,
    lead.owner // 🔥 CONSULTOR
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return hay.includes(filterText);
}


// --- KANBAN ---
function renderKanban(container) {
    const board = document.createElement('div');
    board.className = 'kanban-board';

    const viewLeads = visibleLeads();

    STAGES.forEach(stage => {
        const col = document.createElement('div');
        col.className = 'kanban-col';
        const filtered = viewLeads.filter(l => l.stage === stage && leadMatchesFilter(l));

        col.innerHTML = `<div class="col-header">${stage} <span>${filtered.length}</span></div>`;
        const list = document.createElement('div');
        list.className = 'card-list';

        filtered.forEach(lead => {
            const card = document.createElement('div');
            card.className = `lead-card ${stage === 'Fechado' ? 'won' : stage === 'Perdido' ? 'lost' : ''}`;
            card.onclick = () => openEditModal(lead.id);
            card.innerHTML = `
                <div class="tag">${lead.origin}</div>
                <div class="name">${lead.name}</div>
                <div class="val">R$ ${Number(lead.value).toLocaleString()}</div>
                <div class="next">👣 ${lead.nextStep || 'Sem passo definido'}</div>
                ${isAdmin() ? `<div class="next" style="margin-top:8px;opacity:.75">👤 ${lead.owner || 'admin'}</div>` : ''}
				
				<button class="btn-delete" onclick="deleteLead('${lead.id}')">
    🗑 Excluir lead
  </button>
            `;
            list.appendChild(card);
        });
        col.appendChild(list);
        board.appendChild(col);
    });
    container.appendChild(board);
}

// --- DASHBOARD (cards + tabelas + gráfico com tipo selecionável) ---
function renderDashboard(container) {
    const viewLeads = visibleLeads();
    const totalValue = viewLeads.reduce((acc, curr) => acc + Number(curr.value), 0);
    const wonLeads = viewLeads.filter(l => l.stage === 'Fechado');
    const lostLeads = viewLeads.filter(l => l.stage === 'Perdido');
    const totalWon = wonLeads.reduce((acc, curr) => acc + Number(curr.value), 0);
    const activeLeads = viewLeads.filter(l => l.stage !== 'Fechado' && l.stage !== 'Perdido');
    const conversion = viewLeads.length > 0 ? ((wonLeads.length / viewLeads.length) * 100).toFixed(1) : '0.0';

    container.innerHTML = `
        <div class="dash-grid">
            <div class="stat-card">
                <span class="label">Volume Total</span>
                <span class="value">R$ ${totalValue.toLocaleString()}</span>
                <i class="ph ph-currency-dollar"></i>
            </div>
            <div class="stat-card success">
                <span class="label">Vendas Ganhas</span>
                <span class="value">R$ ${totalWon.toLocaleString()}</span>
                <i class="ph ph-trend-up"></i>
            </div>
            <div class="stat-card info">
                <span class="label">Leads Ativos / Conversão</span>
                <span class="value">${activeLeads.length} • ${conversion}%</span>
                <i class="ph ph-chart-line-up"></i>
            </div>
        </div>

        <div class="dash-row">
            <div class="dash-table">
                <h4>Últimos Ganhos</h4>
                ${wonLeads.length === 0 ? '<p>Nenhuma venda fechada ainda.</p>' : wonLeads.slice(-5).reverse().map(l => `
                    <div class="table-item">
                        <span>${l.name}</span>
                        <strong>R$ ${Number(l.value).toLocaleString()}</strong>
                    </div>
                `).join('')}
            </div>
            <div class="dash-table">
                <h4>Motivos de Perda</h4>
                ${lostLeads.length === 0 ? '<p>Sem registos de perda.</p>' : lostLeads.slice(-5).reverse().map(l => `
                    <div class="table-item">
                        <span>${l.name}</span>
                        <span class="badge-loss">${l.lossReason || '—'}</span>
                    </div>
                `).join('')}
            </div>
        </div>

	        <div class="chart-section">
	            <div class="chart-controls">
	                <div>
	                    <h4>Distribuição Financeira por Etapa (R$)</h4>
	                    <div class="hint">Troque o tipo de gráfico para visualizar melhor os dados.</div>
	                </div>
	                <select id="chart-type" onchange="setChartType(this.value)">
	                    <option value="bar">Colunas</option>
	                    <option value="line">Linhas</option>
	                    <option value="pie">Pizza</option>
	                    <option value="doughnut">Rosca</option>
	                    <option value="polarArea">Polar</option>
	                    <option value="radar">Radar</option>
	                </select>
	            </div>
	            <div class="chart-canvas">
	                <canvas id="salesChart"></canvas>
	            </div>
	        </div>
    `;

    // Seleciona o valor guardado
    const sel = document.getElementById('chart-type');
    if (sel) sel.value = currentChartType;

    // Chamamos a função do gráfico após o HTML ser inserido
    initSalesChart(currentChartType);
}

function setChartType(type) {
    currentChartType = type;
    localStorage.setItem('sov_chart_type', type);
    initSalesChart(type);
}

// --- Inicializar / Atualizar o Gráfico Interativo ---
function initSalesChart(type = 'bar') {
    const ctx = document.getElementById('salesChart').getContext('2d');

    const base = visibleLeads();
    
    // Preparar dados: Soma de valores por etapa
    const dataByStage = STAGES.map(stage => {
        return base
            .filter(l => l.stage === stage)
            .reduce((acc, curr) => acc + Number(curr.value), 0);
    });

    // Recria (evita sobrepor canvas)
    if (salesChart) {
        salesChart.destroy();
        salesChart = null;
    }

    const css = getComputedStyle(document.documentElement);
    const textColor = css.getPropertyValue('--text').trim() || '#111827';
    const mutedColor = css.getPropertyValue('--muted').trim() || '#64748b';
    const gridColor = css.getPropertyValue('--border').trim() || '#e2e8f0';

    salesChart = new Chart(ctx, {
        type,
        data: {
            labels: STAGES,
            datasets: [{
                label: 'Valor Total (R$)',
                data: dataByStage,
                backgroundColor: [
                    'rgba(37, 99, 235, 0.6)',  // Novo lead
                    'rgba(59, 130, 246, 0.6)', // Qualificação
                    'rgba(96, 165, 250, 0.6)', // Simulação
                    'rgba(147, 197, 253, 0.6)',// Negociação
                    'rgba(16, 185, 129, 0.6)', // Fechado (Verde)
                    'rgba(239, 68, 68, 0.6)'   // Perdido (Vermelho)
                ],
                borderColor: 'rgba(37, 99, 235, 0.9)',
                borderWidth: 1,
                borderRadius: type === 'bar' ? 10 : 0,
                tension: 0.35,
                fill: type === 'line'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: type === 'pie' || type === 'doughnut' || type === 'polarArea' || type === 'radar',
                    labels: { color: mutedColor }
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ` R$ ${Number(ctx.raw || 0).toLocaleString()}`
                    }
                }
            },
            scales: (type === 'pie' || type === 'doughnut' || type === 'polarArea' || type === 'radar') ? {} : {
                y: {
                    beginAtZero: true,
                    ticks: { color: mutedColor },
                    grid: { color: gridColor }
                },
                x: {
                    ticks: { color: mutedColor },
                    grid: { display: false }
                }
            }
        }
    });
}

// --- FUNÇÕES DE LEAD ---
function toggleModal(id, show) {
    document.getElementById(id).style.display = show ? 'flex' : 'none';
}

function addNewLead() {
    const name = document.getElementById('nl-name').value;
    if (!name) return alert("Insira o nome do cliente.");

    const ownerSel = document.getElementById('nl-owner');
    const owner = isAdmin()
        ? (ownerSel ? (ownerSel.value || 'admin') : 'admin')
        : (session.user || 'admin').toLowerCase();

    const lead = {
        id: Date.now(),
        name,
        origin: document.getElementById('nl-origin').value || 'Geral',
        value: document.getElementById('nl-value').value || 0,
        nextStep: document.getElementById('nl-step').value || '',
        stage: 'Novo lead',
        tasks: [],
        lossReason: '',
        obs: '',
        owner
    };

    leads.push(lead);
    save();
    toggleModal('modal-new', false);
    renderApp();
}

function openEditModal(id) {
    const lead = leads.find(l => l.id === id);
    if (!lead) return;
    if (!canEditLead(lead)) {
        alert('Você não tem permissão para editar este lead.');
        return;
    }
    const modal = document.getElementById('modal-edit');
    modal.innerHTML = `
        <div class="modal-card edit-card">
            <div class="modal-header">
                <h3>Editar Lead</h3>
                <button onclick="toggleModal('modal-edit', false)">&times;</button>
            </div>
            <div class="edit-body">
                <div class="edit-main">
                    <label>Etapa Atual</label>
                    <select id="ed-stage" onchange="checkLoss(this.value)">
                        ${STAGES.map(s => `<option value="${s}" ${lead.stage === s ? 'selected' : ''}>${s}</option>`).join('')}
                    </select>

                    <div id="loss-area" style="display: ${lead.stage === 'Perdido' ? 'block' : 'none'}">
                        <label>Motivo da Perda</label>
                        <select id="ed-loss">
                            <option value="Preço" ${lead.lossReason === 'Preço' ? 'selected' : ''}>Preço</option>
                            <option value="Concorrência" ${lead.lossReason === 'Concorrência' ? 'selected' : ''}>Concorrência</option>
                            <option value="Desistência" ${lead.lossReason === 'Desistência' ? 'selected' : ''}>Desistência</option>
                        </select>
                    </div>

                    <label>Valor</label>
                    <input type="number" id="ed-value" value="${lead.value}">
                    <label>Próximo Passo</label>
                    <input type="text" id="ed-step" value="${lead.nextStep}">
                    <label>Observações</label>
                    <textarea id="ed-obs">${lead.obs || ''}</textarea>
                    
                    <button class="btn-confirm" onclick="saveEdit(${lead.id})">Salvar Alterações</button>
                </div>
                <div class="edit-tasks">
                    <h4><i class="ph ph-check-square"></i> Tarefas</h4>
                    <div class="task-add">
                        <input type="text" id="tk-new" placeholder="Nova tarefa...">
                        <button onclick="addTask(${lead.id})">+</button>
                    </div>
                    <div class="tk-list">
                        ${lead.tasks.map((t, i) => `
                            <div class="tk-item ${t.done ? 'done' : ''}">
                                <span onclick="toggleTask(${lead.id}, ${i})">${t.done ? '✅' : '⭕'} ${t.desc}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div>
    `;
    toggleModal('modal-edit', true);
}

function checkLoss(val) {
    document.getElementById('loss-area').style.display = val === 'Perdido' ? 'block' : 'none';
}

function saveEdit(id) {
    const lead = leads.find(l => l.id === id);
    lead.stage = document.getElementById('ed-stage').value;
    lead.value = document.getElementById('ed-value').value;
    lead.nextStep = document.getElementById('ed-step').value;
    lead.obs = document.getElementById('ed-obs').value;
    lead.lossReason = lead.stage === 'Perdido' ? document.getElementById('ed-loss').value : '';

    save();
    toggleModal('modal-edit', false);
    renderApp();
}

function addTask(id) {
    const desc = document.getElementById('tk-new').value;
    if(!desc) return;
    leads.find(l => l.id === id).tasks.push({ desc, done: false });
    save();
    openEditModal(id);
}

function toggleTask(id, idx) {
    const lead = leads.find(l => l.id === id);
    lead.tasks[idx].done = !lead.tasks[idx].done;
    save();
    openEditModal(id);
}

function save() {
    localStorage.setItem('sov_crm_data', JSON.stringify(leads));
}

init();

async function deleteLead(id) {
  const confirmDelete = confirm("Tem certeza que deseja excluir este lead?");
  if (!confirmDelete) return;

  const res = await fetch(`/api/leads/${id}`, {
    method: "DELETE"
  });

  if (!res.ok) {
    alert("Erro ao excluir o lead");
    return;
  }

  // Recarrega os leads após excluir
  loadLeads();
}

