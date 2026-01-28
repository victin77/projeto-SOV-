const STAGES = ['Novo lead', 'Qualificação', 'Simulação', 'Negociação', 'Fechado', 'Perdido'];
let leads = JSON.parse(localStorage.getItem('sov_crm_data')) || [];
let currentView = 'kanban';
let filterText = '';
let salesChart = null;
let currentChartType = localStorage.getItem('sov_chart_type') || 'bar';

// --- Sessão (front-end) ---
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 horas
let currentSession = null;

// --- Dados (JSON / backup local) ---
const CRM_DATA_KEY = 'sov_crm_data';
const CRM_BACKUPS_KEY = 'sov_crm_backups';
const AUTO_BACKUP_KEY = 'sov_auto_backup';
const MAX_BACKUPS = 10;
let dataModalInitialized = false;

// --- Backend (sincronização) ---
const API_BASE = '';
let backendOnline = false;

function coerceEpochMs(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const d = new Date(value);
        const ms = d.getTime();
        if (Number.isFinite(ms)) return ms;
    }
    return null;
}

function formatDateOnly(value) {
    const ms = coerceEpochMs(value);
    if (!ms) return '—';
    return new Date(ms).toLocaleDateString();
}

async function detectBackend() {
    try {
        const res = await fetch(`${API_BASE}/api/ping`, { cache: 'no-store' });
        backendOnline = !!(res && res.ok);
    } catch {
        backendOnline = false;
    }
    return backendOnline;
}

async function apiRequest(path, opts = {}) {
    if (!currentSession || !currentSession.token) throw new Error('missing_token');
    const method = opts.method || 'GET';
    const headers = { ...(opts.headers || {}) };
    headers.Authorization = `Bearer ${currentSession.token}`;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    });

    if (res.status === 401) throw new Error('unauthorized');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error('api_error');
        err.code = data && data.error ? data.error : 'api_error';
        throw err;
    }
    return data;
}

async function apiMe() {
    return apiRequest('/api/auth/me');
}

async function apiLogout() {
    return apiRequest('/api/auth/logout', { method: 'POST' });
}

async function apiGetLeads() {
    const data = await apiRequest('/api/leads');
    return Array.isArray(data.leads) ? data.leads : [];
}

async function apiCreateLead(lead) {
    const data = await apiRequest('/api/leads', { method: 'POST', body: lead });
    return data.lead;
}

async function apiUpdateLead(id, lead) {
    const data = await apiRequest(`/api/leads/${encodeURIComponent(String(id))}`, { method: 'PUT', body: lead });
    return data.lead;
}

async function apiDeleteLead(id) {
    await apiRequest(`/api/leads/${encodeURIComponent(String(id))}`, { method: 'DELETE' });
}

async function apiReplaceLeads(nextLeads) {
    await apiRequest('/api/leads/replace', { method: 'POST', body: { leads: nextLeads } });
}

async function apiCreateUser(user, pass, role) {
    const data = await apiRequest('/api/admin/users', { method: 'POST', body: { user, pass, role } });
    return data.user;
}

async function apiListUsers() {
    const data = await apiRequest('/api/admin/users');
    return Array.isArray(data.users) ? data.users : [];
}

async function apiDeleteUser(user) {
    await apiRequest(`/api/admin/users/${encodeURIComponent(String(user))}`, { method: 'DELETE' });
}

function getSession() {
    const raw = localStorage.getItem('sov_session');
    if (!raw) return null;
    try {
        const s = JSON.parse(raw);
        if (!s || !s.user || !s.role) return null;
        const exp = typeof s.exp === 'number'
            ? s.exp
            : (typeof s.at === 'number' ? s.at + SESSION_TTL_MS : 0);
        return { ...s, exp };
    } catch {
        return null;
    }
}

function isSessionExpired(session) {
    return !session || typeof session.exp !== 'number' || Date.now() > session.exp;
}

function clearSession() {
    localStorage.removeItem('sov_session');
}

function requireSession() {
    const s = getSession();
    if (!s) {
        window.location.replace('login.html');
        return null;
    }
    if (isSessionExpired(s)) {
        clearSession();
        window.location.replace('login.html?reason=expired');
        return null;
    }
    return s;
}

function canWrite() {
    return currentSession && currentSession.role !== 'leitura';
}

function isAutoBackupEnabled() {
    return localStorage.getItem(AUTO_BACKUP_KEY) === '1';
}

function setAutoBackupEnabled(enabled) {
    localStorage.setItem(AUTO_BACKUP_KEY, enabled ? '1' : '0');
}

function getBackups() {
    const raw = localStorage.getItem(CRM_BACKUPS_KEY);
    if (!raw) return [];
    try {
        const list = JSON.parse(raw);
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

function setBackups(list) {
    localStorage.setItem(CRM_BACKUPS_KEY, JSON.stringify(list));
}

function maybeCreateBackupFromPersisted(opts = {}) {
    const force = !!opts.force;
    if (!canWrite()) return;
    if (!force && !isAutoBackupEnabled()) return;

    const prev = localStorage.getItem(CRM_DATA_KEY);
    if (!prev) return;

    const backups = getBackups();
    const last = backups[backups.length - 1];
    if (last && last.data === prev) return;

    backups.push({ at: Date.now(), data: prev });
    while (backups.length > MAX_BACKUPS) backups.shift();
    setBackups(backups);
}

function sanitizeString(value, maxLen = 500) {
    const s = (value ?? '').toString().trim();
    return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function sanitizePhone(value, maxLen = 30) {
    const s = sanitizeString(value, maxLen);
    return s.replace(/[^\d+()\-\s]/g, '');
}

function parseTags(input) {
    const parts = sanitizeString(input, 2000)
        .split(/[;,]/)
        .map(t => t.trim().toLowerCase())
        .filter(Boolean);
    return Array.from(new Set(parts)).slice(0, 20);
}

function normalizeImportedLeads(payload) {
    const inputLeads = Array.isArray(payload)
        ? payload
        : (payload && Array.isArray(payload.leads) ? payload.leads : null);
    if (!inputLeads) return { ok: false, error: 'JSON inválido: esperado um array de leads ou um objeto { leads: [...] }.' };

    const ids = new Set();
    const normalized = [];
    for (let i = 0; i < inputLeads.length; i++) {
        const raw = inputLeads[i];
        if (!raw || typeof raw !== 'object') continue;

        let id =
            (typeof raw.id === 'string' && raw.id) ? raw.id :
                (typeof raw.id === 'number' ? raw.id : (Date.now() + i));
        while (ids.has(id)) {
            id = typeof id === 'number' ? (id + 1) : `${id}-${Math.random().toString(16).slice(2, 6)}`;
        }
        ids.add(id);

        const name = sanitizeString(raw.name, 120);
        if (!name) continue;

        const stage = STAGES.includes(raw.stage) ? raw.stage : 'Novo lead';

        const tasksRaw = Array.isArray(raw.tasks) ? raw.tasks : [];
        const tasks = tasksRaw
            .filter(t => t && typeof t === 'object')
            .slice(0, 200)
            .map(t => ({ desc: sanitizeString(t.desc, 160), done: !!t.done }))
            .filter(t => t.desc);

        const tagsRaw = Array.isArray(raw.tags)
            ? raw.tags
            : (typeof raw.tags === 'string' ? raw.tags.split(/[;,]/) : []);
        const tags = Array.from(new Set(
            tagsRaw.map(t => sanitizeString(t, 40).toLowerCase()).filter(Boolean)
        )).slice(0, 20);

        const now = Date.now();
        const createdAt = coerceEpochMs(raw.createdAt) ?? now;
        const updatedAt = coerceEpochMs(raw.updatedAt) ?? createdAt;

        normalized.push({
            id,
            name,
            phone: sanitizePhone(raw.phone, 30),
            origin: sanitizeString(raw.origin, 60) || 'Geral',
            value: Number(raw.value) || 0,
            nextStep: sanitizeString(raw.nextStep, 160),
            stage,
            tasks,
            lossReason: sanitizeString(raw.lossReason, 60),
            obs: sanitizeString(raw.obs, 2000),
            owner: sanitizeString(raw.owner, 60),
            tags,
            createdAt,
            updatedAt
        });
    }

    return { ok: true, leads: normalized };
}

function downloadJson(filename, data) {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
}

function exportDataJson() {
    const payload = {
        schema: 'sov-crm',
        version: 1,
        exportedAt: new Date().toISOString(),
        leads
    };
    const stamp = new Date().toISOString().slice(0, 10);
    downloadJson(`sov-crm-export-${stamp}.json`, payload);
}

async function importDataJson(file) {
    if (!canWrite()) return;
    if (!file) {
        alert('Selecione um arquivo JSON.');
        return;
    }
    const text = await file.text();
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        alert('Arquivo inválido: não foi possível ler o JSON.');
        return;
    }

    const res = normalizeImportedLeads(parsed);
    if (!res.ok) {
        alert(res.error);
        return;
    }

    const ok = confirm(`Importar ${res.leads.length} lead(s)?\n\nIsso vai SUBSTITUIR os leads atuais (${leads.length}).`);
    if (!ok) return;

    maybeCreateBackupFromPersisted({ force: true });
    leads = res.leads;

    if (backendOnline) {
        try {
            await apiReplaceLeads(leads);
            leads = await apiGetLeads();
        } catch (e) {
            alert('Importado localmente, mas falhou ao enviar para o servidor.');
        }
    }

    cacheLeads(leads);
    renderApp();
    alert('Importação concluída.');
}

function updateBackupMetaUI() {
    const meta = document.getElementById('backup-meta');
    const btnRestore = document.getElementById('btn-restore-backup');
    const btnClear = document.getElementById('btn-clear-backups');
    if (!meta || !btnRestore || !btnClear) return;

    const backups = getBackups();
    const last = backups[backups.length - 1];
    const lastText = last ? new Date(last.at).toLocaleString() : '—';
    meta.textContent = `Backups: ${backups.length} • Último: ${lastText}`;

    const hasBackup = backups.length > 0;
    btnRestore.disabled = !canWrite() || !hasBackup;
    btnClear.disabled = !canWrite() || !hasBackup;
}

function initDataModal() {
    if (dataModalInitialized) return;
    dataModalInitialized = true;

    const fileInput = document.getElementById('import-file');
    const btnImport = document.getElementById('btn-import-json');
    const btnExport = document.getElementById('btn-export-json');
    const toggle = document.getElementById('auto-backup-toggle');
    const btnRestore = document.getElementById('btn-restore-backup');
    const btnClearBackups = document.getElementById('btn-clear-backups');
    const btnClearData = document.getElementById('btn-clear-data');
    const usersCard = document.getElementById('users-card');
    const usersCreateBtn = document.getElementById('btn-create-user');
    const usersRefreshBtn = document.getElementById('btn-refresh-users');
    const usersName = document.getElementById('usr-name');
    const usersPass = document.getElementById('usr-pass');
    const usersRole = document.getElementById('usr-role');

    if (btnExport) btnExport.onclick = exportDataJson;
    if (btnImport) btnImport.onclick = () => importDataJson(fileInput && fileInput.files ? fileInput.files[0] : null);
    if (toggle) {
        toggle.checked = isAutoBackupEnabled();
        toggle.onchange = () => {
            if (!canWrite()) {
                toggle.checked = isAutoBackupEnabled();
                return;
            }
            setAutoBackupEnabled(!!toggle.checked);
            updateBackupMetaUI();
        };
    }

    if (btnRestore) {
        btnRestore.onclick = async () => {
            if (!canWrite()) return;
            const backups = getBackups();
            const last = backups[backups.length - 1];
            if (!last || !last.data) return;
            const ok = confirm('Restaurar o último backup? Isso vai substituir os leads atuais.');
            if (!ok) return;

            let parsed;
            try {
                parsed = JSON.parse(last.data);
            } catch {
                alert('Backup corrompido.');
                return;
            }
            const res = normalizeImportedLeads(parsed);
            if (!res.ok) {
                alert('Backup inválido.');
                return;
            }
            maybeCreateBackupFromPersisted({ force: true });
            leads = res.leads;

            if (backendOnline) {
                try {
                    await apiReplaceLeads(leads);
                    leads = await apiGetLeads();
                } catch (e) {
                    alert('Restaurado localmente, mas falhou ao enviar para o servidor.');
                }
            }

            cacheLeads(leads);
            renderApp();
        };
    }

    if (btnClearBackups) {
        btnClearBackups.onclick = () => {
            if (!canWrite()) return;
            const ok = confirm('Apagar todos os backups?');
            if (!ok) return;
            localStorage.removeItem(CRM_BACKUPS_KEY);
            updateBackupMetaUI();
        };
    }

    if (btnClearData) {
        btnClearData.onclick = async () => {
            if (!canWrite()) return;
            const ok = confirm('Limpar todos os leads deste navegador?');
            if (!ok) return;
            maybeCreateBackupFromPersisted({ force: true });
            leads = [];

            if (backendOnline) {
                try {
                    await apiReplaceLeads([]);
                    leads = await apiGetLeads();
                } catch (e) {
                    alert('Limpou localmente, mas falhou ao limpar no servidor.');
                }
            }

            cacheLeads(leads);
            renderApp();
        };
    }

    setUsersAdminUiState();
    if (usersRefreshBtn) usersRefreshBtn.onclick = () => refreshUsersList();

    if (usersCreateBtn) {
        usersCreateBtn.onclick = async () => {
            if (!backendOnline) return alert('Servidor offline.');
            if (!isAdmin()) return alert('Apenas admin pode criar usuários.');
            const u = sanitizeString(usersName ? usersName.value : '', 60).toLowerCase();
            const p = (usersPass && typeof usersPass.value === 'string') ? usersPass.value : '';
            const r = usersRole ? String(usersRole.value || 'consultor') : 'consultor';
            if (!u || !p) return alert('Preencha usuário e senha.');
            if (p.length < 6) return alert('Senha muito curta (mínimo 6).');

            try {
                await apiCreateUser(u, p, r);
                if (usersPass) usersPass.value = '';
                alert(`Usuário criado: ${u} (${r})`);
                await refreshUsersList();
            } catch (e) {
                if (e && e.code === 'user_exists') return alert('Esse usuário já existe.');
                if (handleApiFailure(e, 'Não foi possível criar o usuário.')) return;
            }
        };
    }

    const writable = canWrite();
    if (fileInput) fileInput.disabled = !writable;
    if (btnImport) btnImport.disabled = !writable;
    if (toggle) toggle.disabled = !writable;
    if (btnClearData) btnClearData.disabled = !writable;

    updateBackupMetaUI();
}

function updateUserInfo() {
    const wrap = document.getElementById('user-info');
    const label = document.getElementById('user-label');
    const logoutBtn = document.getElementById('logout-btn');
    if (!wrap || !label || !logoutBtn || !currentSession) return;

    const roleLabel = currentSession.role === 'admin'
        ? 'Admin'
        : currentSession.role === 'leitura'
            ? 'Leitura'
            : 'Consultor';
    const statusLabel = backendOnline ? 'Online' : 'Offline';
    label.textContent = `${currentSession.user} • ${roleLabel} • ${statusLabel}`;
    wrap.style.display = 'flex';

    logoutBtn.onclick = async () => {
        try {
            if (backendOnline && currentSession && currentSession.token) await apiLogout();
        } catch { }
        clearSession();
        window.location.replace('login.html');
    };

    const btnNew = document.getElementById('btn-new-lead');
    if (btnNew) btnNew.disabled = !canWrite();

    setUsersAdminUiState();

    if (dataModalInitialized) updateBackupMetaUI();
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

function cacheLeads(nextLeads) {
    localStorage.setItem(CRM_DATA_KEY, JSON.stringify(nextLeads));
    updateBackupMetaUI();
}

// Início
async function init() {
    currentSession = requireSession();
    if (!currentSession) return;
    initTheme();

    await detectBackend();
    if (backendOnline) {
        if (!currentSession.token) {
            clearSession();
            window.location.replace('login.html?reason=invalid');
            return;
        }
        try {
            const me = await apiMe();
            currentSession = { ...currentSession, user: me.user, role: me.role, exp: me.exp };
            localStorage.setItem('sov_session', JSON.stringify(currentSession));
            leads = await apiGetLeads();
            cacheLeads(leads);
        } catch (e) {
            clearSession();
            window.location.replace('login.html?reason=invalid');
            return;
        }
    }

    updateUserInfo();
    initDataModal();
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
        lead.phone,
        lead.origin,
        lead.owner,
        Array.isArray(lead.tags) ? lead.tags.join(' ') : lead.tags,
        lead.stage,
        lead.nextStep,
        lead.obs,
        lead.lossReason
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(filterText);
}

// --- KANBAN ---
function renderKanban(container) {
    const board = document.createElement('div');
    board.className = 'kanban-board';

    STAGES.forEach(stage => {
        const col = document.createElement('div');
        col.className = 'kanban-col';
        const filtered = leads.filter(l => l.stage === stage && leadMatchesFilter(l));

        col.innerHTML = `<div class="col-header">${stage} <span>${filtered.length}</span></div>`;
        const list = document.createElement('div');
        list.className = 'card-list';

        filtered.forEach(lead => {
            const card = document.createElement('div');
            card.className = `lead-card ${stage === 'Fechado' ? 'won' : stage === 'Perdido' ? 'lost' : ''} ${canWrite() ? '' : 'readonly'}`;
            if (canWrite()) card.onclick = () => openEditModal(lead.id);
            card.innerHTML = `
                <div class="tag">${lead.origin}</div>
                <div class="name">${lead.name}</div>
                <div class="created">📅 ${formatDateOnly(lead.createdAt ?? lead.id)}</div>
                ${lead.phone ? `<div class="phone">📱 ${lead.phone}</div>` : ''}
                <div class="val">R$ ${Number(lead.value).toLocaleString()}</div>
                <div class="next">👣 ${lead.nextStep || 'Sem passo definido'}</div>
                ${(Array.isArray(lead.tags) && lead.tags.length)
                    ? `<div class="chips">${lead.tags.slice(0, 6).map(t => `<span class="chip">${t}</span>`).join('')}</div>`
                    : ''
                }
                ${lead.owner ? `<div class="consultor-badge">${lead.owner}</div>` : ''}
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
    const totalValue = leads.reduce((acc, curr) => acc + Number(curr.value), 0);
    const wonLeads = leads.filter(l => l.stage === 'Fechado');
    const lostLeads = leads.filter(l => l.stage === 'Perdido');
    const totalWon = wonLeads.reduce((acc, curr) => acc + Number(curr.value), 0);
    const activeLeads = leads.filter(l => l.stage !== 'Fechado' && l.stage !== 'Perdido');
    const conversion = leads.length > 0 ? ((wonLeads.length / leads.length) * 100).toFixed(1) : '0.0';

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
    
    // Preparar dados: Soma de valores por etapa
    const dataByStage = STAGES.map(stage => {
        return leads
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
function handleApiFailure(err, msg) {
    if (err && err.message === 'unauthorized') {
        clearSession();
        window.location.replace('login.html?reason=invalid');
        return true;
    }
    alert(msg || 'Erro ao comunicar com o servidor.');
    return false;
}

function isAdmin() {
    return !!(currentSession && currentSession.role === 'admin');
}

function setUsersAdminUiState() {
    const usersCard = document.getElementById('users-card');
    if (!usersCard) return;

    usersCard.style.display = isAdmin() ? 'block' : 'none';

    const hint = document.getElementById('usr-hint');
    if (hint) {
        hint.textContent = backendOnline
            ? 'Online'
            : 'Servidor offline (precisa estar online para criar/remover usuários).';
    }

    const enabled = isAdmin() && backendOnline && canWrite();
    const usersCreateBtn = document.getElementById('btn-create-user');
    const usersRefreshBtn = document.getElementById('btn-refresh-users');
    const usersName = document.getElementById('usr-name');
    const usersPass = document.getElementById('usr-pass');
    const usersRole = document.getElementById('usr-role');

    if (usersCreateBtn) usersCreateBtn.disabled = !enabled;
    if (usersRefreshBtn) usersRefreshBtn.disabled = !enabled;
    if (usersName) usersName.disabled = !enabled;
    if (usersPass) usersPass.disabled = !enabled;
    if (usersRole) usersRole.disabled = !enabled;
}

function renderUsersList(users) {
    const list = document.getElementById('usr-list');
    if (!list) return;
    list.replaceChildren();

    if (!isAdmin()) return;
    if (!backendOnline) {
        const meta = document.createElement('div');
        meta.className = 'data-meta';
        meta.textContent = 'Servidor offline.';
        list.appendChild(meta);
        return;
    }

    if (!Array.isArray(users) || users.length === 0) {
        const meta = document.createElement('div');
        meta.className = 'data-meta';
        meta.textContent = 'Nenhum usuário cadastrado.';
        list.appendChild(meta);
        return;
    }

    users.forEach((u) => {
        const row = document.createElement('div');
        row.className = 'usr-row';

        const left = document.createElement('div');
        const title = document.createElement('div');
        title.textContent = u.user || '—';
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = (u.role || '—') + (u.user === currentSession.user ? ' • você' : '');
        left.appendChild(title);
        left.appendChild(meta);

        const btn = document.createElement('button');
        btn.className = 'btn-danger btn-small';
        btn.textContent = 'Remover';
        btn.disabled = !canWrite() || u.user === currentSession.user;
        btn.onclick = async () => {
            const who = u.user || '';
            if (!who) return;
            const ok = confirm(`Remover o usuário "${who}"?\n\nEssa ação desativa o login desse usuário.`);
            if (!ok) return;
            try {
                await apiDeleteUser(who);
                await refreshUsersList();
            } catch (e) {
                if (e && e.code === 'last_admin') return alert('Não é possível remover o último admin.');
                if (handleApiFailure(e, 'Não foi possível remover o usuário.')) return;
            }
        };

        row.appendChild(left);
        row.appendChild(btn);
        list.appendChild(row);
    });
}

async function refreshUsersList() {
    if (!isAdmin()) return;
    setUsersAdminUiState();
    const list = document.getElementById('usr-list');
    if (!list) return;

    try {
        const users = await apiListUsers();
        renderUsersList(users);
    } catch (e) {
        if (handleApiFailure(e, 'Não foi possível carregar usuários.')) return;
    }
}

function toggleModal(id, show) {
    if (!canWrite() && (id === 'modal-new' || id === 'modal-edit')) return;
    document.getElementById(id).style.display = show ? 'flex' : 'none';
    if (id === 'modal-data' && show) refreshUsersList();
}

async function addNewLead() {
    if (!canWrite()) return;
    const name = sanitizeString(document.getElementById('nl-name').value, 120);
    if (!name) return alert("Insira o nome do cliente.");

    const now = Date.now();
    const lead = {
        id: (backendOnline && window.crypto && typeof window.crypto.randomUUID === 'function') ? window.crypto.randomUUID() : Date.now(),
        name,
        phone: sanitizePhone(document.getElementById('nl-phone') ? document.getElementById('nl-phone').value : '', 30),
        origin: sanitizeString(document.getElementById('nl-origin').value, 60) || 'Geral',
        value: Number(document.getElementById('nl-value').value) || 0,
        nextStep: sanitizeString(document.getElementById('nl-step').value, 160),
        stage: 'Novo lead',
        tasks: [],
        lossReason: '',
        obs: '',
        owner: currentSession ? currentSession.user : '',
        tags: parseTags(document.getElementById('nl-tags') ? document.getElementById('nl-tags').value : ''),
        createdAt: now,
        updatedAt: now
    };

    if (backendOnline) {
        try {
            const saved = await apiCreateLead(lead);
            leads.push(saved);
        } catch (e) {
            if (handleApiFailure(e, 'Não foi possível criar o lead no servidor.')) return;
            leads.push(lead);
        }
    } else {
        leads.push(lead);
    }

    save();
    toggleModal('modal-new', false);
    renderApp();
}

function openEditModal(id) {
    if (!canWrite()) return;
    const lead = leads.find(l => l.id === id);
    if (!lead) return;
    const leadId = JSON.stringify(lead.id);
    const tasks = Array.isArray(lead.tasks) ? lead.tasks : [];
    const modal = document.getElementById('modal-edit');
    modal.innerHTML = `
        <div class="modal-card edit-card">
            <div class="modal-header">
                <h3>Editar Lead</h3>
                <button onclick="toggleModal('modal-edit', false)">&times;</button>
            </div>
            <div class="edit-body">
                <div class="edit-main">
                    <div class="field" style="margin-bottom: 12px;">
                        <label>Responsável</label>
                        <div style="font-weight: 600;">${lead.owner || '—'}</div>
                    </div>
                    <div class="field" style="margin-bottom: 12px;">
                        <label>Criado em</label>
                        <div style="font-weight: 600;">${formatDateOnly(lead.createdAt ?? lead.id)}</div>
                    </div>
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
                    <label>Celular</label>
                    <input type="tel" id="ed-phone" value="${lead.phone || ''}" placeholder="Ex: (11) 91234-5678">
                    <label>Próximo Passo</label>
                    <input type="text" id="ed-step" value="${lead.nextStep}">
                    <label>Tags</label>
                    <input type="text" id="ed-tags" value="${Array.isArray(lead.tags) ? lead.tags.join(', ') : ''}" placeholder="Ex: quente, whatsapp, indicação">
                    <label>Observações</label>
                    <textarea id="ed-obs">${lead.obs || ''}</textarea>
                    
                    <button class="btn-confirm" onclick='saveEdit(${leadId})'>Salvar Alterações</button>
                    <button class="btn-danger" style="margin-top:10px" onclick='deleteLead(${leadId})'>Apagar Lead</button>
                </div>
                <div class="edit-tasks">
                    <h4><i class="ph ph-check-square"></i> Tarefas</h4>
                    <div class="task-add">
                        <input type="text" id="tk-new" placeholder="Nova tarefa...">
                        <button onclick='addTask(${leadId})'>+</button>
                    </div>
                    <div class="tk-list">
                        ${tasks.map((t, i) => `
                            <div class="tk-item ${t.done ? 'done' : ''}">
                                <span onclick='toggleTask(${leadId}, ${i})'>${t.done ? '✅' : '⭕'} ${t.desc}</span>
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

async function saveEdit(id) {
    if (!canWrite()) return;
    const lead = leads.find(l => l.id === id);
    if (!lead) return;

    const now = Date.now();
    if (!coerceEpochMs(lead.createdAt)) lead.createdAt = coerceEpochMs(lead.id) ?? now;
    lead.updatedAt = now;
    lead.stage = document.getElementById('ed-stage').value;
    lead.value = Number(document.getElementById('ed-value').value) || 0;
    lead.phone = sanitizePhone(document.getElementById('ed-phone') ? document.getElementById('ed-phone').value : '', 30);
    lead.nextStep = sanitizeString(document.getElementById('ed-step').value, 160);
    lead.tags = parseTags(document.getElementById('ed-tags') ? document.getElementById('ed-tags').value : '');
    lead.obs = sanitizeString(document.getElementById('ed-obs').value, 2000);
    lead.lossReason = lead.stage === 'Perdido' ? document.getElementById('ed-loss').value : '';

    if (backendOnline) {
        try {
            const saved = await apiUpdateLead(lead.id, lead);
            const idx = leads.findIndex(l => l.id === id);
            if (idx >= 0) leads[idx] = saved;
        } catch (e) {
            if (handleApiFailure(e, 'Não foi possível salvar no servidor. Salvando só localmente.')) return;
        }
    }

    save();
    toggleModal('modal-edit', false);
    renderApp();
}

async function deleteLead(id) {
    if (!canWrite()) return;
    const lead = leads.find(l => l.id === id);
    if (!lead) return;

    const ok = confirm(`Apagar o lead "${lead.name}"?\n\nEssa ação não pode ser desfeita.`);
    if (!ok) return;

    // Destrutivo: cria backup do estado atual mesmo com backup automático desligado
    maybeCreateBackupFromPersisted({ force: true });

    if (backendOnline) {
        try {
            await apiDeleteLead(id);
        } catch (e) {
            handleApiFailure(e, 'Não foi possível apagar no servidor.');
            return;
        }
    }

    leads = leads.filter(l => l.id !== id);
    save();
    toggleModal('modal-edit', false);
    renderApp();
}

async function addTask(id) {
    if (!canWrite()) return;
    const desc = sanitizeString(document.getElementById('tk-new').value, 160);
    if(!desc) return;
    const lead = leads.find(l => l.id === id);
    if (!lead) return;
    if (!Array.isArray(lead.tasks)) lead.tasks = [];
    lead.tasks.push({ desc, done: false });
    lead.updatedAt = Date.now();

    if (backendOnline) {
        try {
            const saved = await apiUpdateLead(lead.id, lead);
            const idx = leads.findIndex(l => l.id === id);
            if (idx >= 0) leads[idx] = saved;
        } catch (e) {
            if (handleApiFailure(e, 'Não foi possível salvar tarefas no servidor.')) return;
        }
    }

    save();
    openEditModal(id);
}

async function toggleTask(id, idx) {
    if (!canWrite()) return;
    const lead = leads.find(l => l.id === id);
    if (!lead || !Array.isArray(lead.tasks) || !lead.tasks[idx]) return;
    lead.tasks[idx].done = !lead.tasks[idx].done;
    lead.updatedAt = Date.now();

    if (backendOnline) {
        try {
            const saved = await apiUpdateLead(lead.id, lead);
            const leadIdx = leads.findIndex(l => l.id === id);
            if (leadIdx >= 0) leads[leadIdx] = saved;
        } catch (e) {
            if (handleApiFailure(e, 'Não foi possível salvar tarefas no servidor.')) return;
        }
    }

    save();
    openEditModal(id);
}

function save() {
    maybeCreateBackupFromPersisted();
    localStorage.setItem(CRM_DATA_KEY, JSON.stringify(leads));
    updateBackupMetaUI();
}

init();
