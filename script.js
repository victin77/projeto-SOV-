const STAGES = ['Leads do site', 'Novo lead', 'Qualificação', 'Simulação', 'Negociação', 'Fechado', 'Perdido'];
let leads = JSON.parse(localStorage.getItem('sov_crm_data')) || [];
let currentView = 'kanban';
let filterText = '';
let salesChart = null;
let currentChartType = localStorage.getItem('sov_chart_type') || 'bar';
let dashboardOwnerFilter = localStorage.getItem('sov_dash_owner') || 'all';
const KANBAN_GENERAL_TAB = '__geral__';
const KANBAN_INITIAL_VISIBLE = 4;
const KANBAN_VISIBLE_STEP = 4;
const KANBAN_STAGE_TABS = ['Leads do site', 'Novo lead', 'Qualificação', 'Simulação', 'Negociação', 'Fechado', 'Perdido'].filter((s) => STAGES.includes(s));
let kanbanActiveTab = KANBAN_GENERAL_TAB;
let kanbanVisibleByStage = {};

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

        const stage = mapImportedStage(raw.stage) || 'Novo lead';

        const tasksRaw = Array.isArray(raw.tasks) ? raw.tasks : [];
        const tasks = tasksRaw
            .filter(t => t && typeof t === 'object')
            .slice(0, 200)
            .map(t => ({ desc: sanitizeString(t.desc, 160), done: !!t.done, createdAt: parseDateValue(t.createdAt) }))
            .filter(t => t.desc);

        const tagsRaw = Array.isArray(raw.tags)
            ? raw.tags
            : (typeof raw.tags === 'string' ? raw.tags.split(/[;,]/) : []);
        const tags = Array.from(new Set(
            tagsRaw.map(t => sanitizeString(t, 40).toLowerCase()).filter(Boolean)
        )).slice(0, 20);

        const now = Date.now();
        const createdAt = parseDateValue(raw.createdAt) ?? now;
        const updatedAt = parseDateValue(raw.updatedAt) ?? createdAt;

        const normalizedLead = {
            id,
            name,
            phone: sanitizePhone(raw.phone, 30),
            origin: sanitizeString(raw.origin, 60) || 'Geral',
            value: parseCurrencyValue(raw.value),
            nextStep: sanitizeString(raw.nextStep, 160),
            stage,
            tasks,
            lossReason: sanitizeString(raw.lossReason, 60),
            obs: sanitizeString(raw.obs, 2000),
            owner: sanitizeString(raw.owner, 60),
            tags,
            createdAt,
            updatedAt
        };

        if (raw.__importMeta && typeof raw.__importMeta === 'object') {
            normalizedLead.__importMeta = raw.__importMeta;
        }

        normalized.push(normalizedLead);
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

function ensureXlsxLoaded() {
    // Provided by /vendor/xlsx.full.min.js
    if (typeof window === 'undefined' || !window.XLSX) {
        alert('Excel indisponível: a biblioteca não carregou. Recarregue a página e tente novamente.');
        return false;
    }
    return true;
}

function toIsoOrEmpty(value) {
    const ms = coerceEpochMs(value);
    return ms ? new Date(ms).toISOString() : '';
}

function normalizeComparableText(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function normalizeHeaderKey(key) {
    return normalizeComparableText(key);
}

function pickRowValue(row, keys) {
    if (!row || typeof row !== 'object') return '';
    const direct = (k) => (row && Object.prototype.hasOwnProperty.call(row, k) ? row[k] : undefined);
    for (const k of keys) {
        const v = direct(k);
        if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    const normalized = {};
    for (const [k, v] of Object.entries(row)) normalized[normalizeHeaderKey(k)] = v;
    for (const k of keys) {
        const v = normalized[normalizeHeaderKey(k)];
        if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return '';
}

function parseCurrencyValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const raw = String(value ?? '').trim();
    if (!raw) return 0;

    let cleaned = raw
        .replace(/\s+/g, '')
        .replace(/r\$/ig, '')
        .replace(/[^\d,.\-]/g, '');
    if (!cleaned) return 0;

    const commaCount = (cleaned.match(/,/g) || []).length;
    const dotCount = (cleaned.match(/\./g) || []).length;
    if (commaCount > 0 && dotCount > 0) {
        cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else if (commaCount > 0) {
        cleaned = cleaned.replace(',', '.');
    }

    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
}

function excelSerialToEpochMs(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    if (value > 100000000000) return value;
    if (value > 1000000000 && value < 9999999999) return value * 1000;
    if (value >= 20000 && value <= 90000) {
        const msPerDay = 24 * 60 * 60 * 1000;
        const excelEpoch = Date.UTC(1899, 11, 30);
        return Math.round(excelEpoch + (value * msPerDay));
    }
    return null;
}

function parseDateValue(value) {
    if (value === null || value === undefined || value === '') return null;

    if (typeof value === 'number' && Number.isFinite(value)) {
        const fromExcel = excelSerialToEpochMs(value);
        if (fromExcel) return fromExcel;
        return coerceEpochMs(value);
    }

    const str = String(value).trim();
    if (!str) return null;

    const asNum = Number(str);
    if (Number.isFinite(asNum)) {
        const fromExcel = excelSerialToEpochMs(asNum);
        if (fromExcel) return fromExcel;
    }

    const ptBr = str.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (ptBr) {
        const day = Number(ptBr[1]);
        const month = Number(ptBr[2]);
        const rawYear = Number(ptBr[3]);
        const year = rawYear < 100 ? (2000 + rawYear) : rawYear;
        const hour = Number(ptBr[4] || 0);
        const minute = Number(ptBr[5] || 0);
        const second = Number(ptBr[6] || 0);
        const dt = new Date(year, month - 1, day, hour, minute, second);
        const ms = dt.getTime();
        if (Number.isFinite(ms)) return ms;
    }

    return coerceEpochMs(str);
}

function formatDateForField(value) {
    const ms = parseDateValue(value);
    if (!ms) return sanitizeString(value, 160);
    return new Date(ms).toLocaleString('pt-BR');
}

function statusIndicatesLost(value) {
    const s = normalizeComparableText(value);
    if (!s) return false;
    return (
        s.includes('nao quer') ||
        s.includes('sem interesse') ||
        s.includes('desinteressado') ||
        s.includes('desinteressada') ||
        s.includes('desinteresse')
    );
}

function mapImportedStage(value) {
    const raw = sanitizeString(value, 80);
    if (!raw) return '';
    if (STAGES.includes(raw)) return raw;

    const s = normalizeComparableText(raw);
    if (!s) return '';
    if (statusIndicatesLost(s) || s.includes('perdido')) return 'Perdido';
    if (s.includes('fechado') || s.includes('ganho') || s.includes('venda')) return 'Fechado';
    if (s.includes('negoci')) return 'Negociação';
    if (s.includes('simula')) return 'Simulação';
    if (s.includes('qualifica')) return 'Qualificação';
    if (s.includes('site')) return 'Leads do site';
    if (s.includes('novo')) return 'Novo lead';
    return '';
}

function parseBoolish(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const s = String(value ?? '').trim().toLowerCase();
    if (!s) return false;
    return ['1', 'true', 't', 'yes', 'y', 'sim', 's', 'x', 'ok'].includes(s);
}

function exportDataXlsx() {
    if (!ensureXlsxLoaded()) return;

    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `sov-crm-export-${stamp}.xlsx`;

    const leadsRows = (Array.isArray(leads) ? leads : []).map((l) => ({
        id: l.id ?? '',
        name: l.name ?? '',
        phone: l.phone ?? '',
        origin: l.origin ?? '',
        stage: l.stage ?? '',
        value: Number(l.value) || 0,
        nextStep: l.nextStep ?? '',
        tags: Array.isArray(l.tags) ? l.tags.join(', ') : (l.tags ?? ''),
        obs: l.obs ?? '',
        lossReason: l.lossReason ?? '',
        owner: l.owner ?? '',
        createdAt: toIsoOrEmpty(l.createdAt),
        updatedAt: toIsoOrEmpty(l.updatedAt)
    }));

    const tasksRows = [];
    for (const l of (Array.isArray(leads) ? leads : [])) {
        const arr = Array.isArray(l.tasks) ? l.tasks : [];
        for (const t of arr) {
            tasksRows.push({
                leadId: l.id ?? '',
                leadName: l.name ?? '',
                desc: t && t.desc ? t.desc : '',
                done: !!(t && t.done),
                createdAt: toIsoOrEmpty(t && t.createdAt)
            });
        }
    }

    const wb = window.XLSX.utils.book_new();
    const wsLeads = window.XLSX.utils.json_to_sheet(leadsRows);
    window.XLSX.utils.book_append_sheet(wb, wsLeads, 'Leads');

    const wsTasks = window.XLSX.utils.json_to_sheet(tasksRows);
    window.XLSX.utils.book_append_sheet(wb, wsTasks, 'Tarefas');

    window.XLSX.writeFile(wb, filename);
}

async function importDataXlsx(file) {
    if (!canWrite()) return;
    if (!ensureXlsxLoaded()) return;
    if (!file) {
        alert('Selecione um arquivo Excel (.xlsx).');
        return;
    }

    const buf = await file.arrayBuffer();
    let wb;
    try {
        wb = window.XLSX.read(buf, { type: 'array' });
    } catch {
        alert('Arquivo invalido: nao foi possivel ler o Excel.');
        return;
    }

    const sheetNames = Array.isArray(wb.SheetNames) ? wb.SheetNames : [];
    const leadsSheet =
        wb.Sheets?.Leads ||
        wb.Sheets?.LEADS ||
        wb.Sheets?.leads ||
        wb.Sheets?.Lead ||
        (sheetNames[0] ? wb.Sheets[sheetNames[0]] : null);

    const tasksSheet =
        wb.Sheets?.Tarefas ||
        wb.Sheets?.tarefas ||
        wb.Sheets?.Tasks ||
        wb.Sheets?.tasks ||
        null;

    if (!leadsSheet) {
        alert('Planilha sem aba de Leads.');
        return;
    }

    const leadsRows = window.XLSX.utils.sheet_to_json(leadsSheet, { defval: '' });
    const tasksRows = tasksSheet ? window.XLSX.utils.sheet_to_json(tasksSheet, { defval: '' }) : [];

    const tasksByLeadId = new Map();
    for (const row of (Array.isArray(tasksRows) ? tasksRows : [])) {
        const leadId = pickRowValue(row, ['leadId', 'lead_id', 'id', 'lead']);
        const desc = pickRowValue(row, ['desc', 'descricao', 'descricao', 'tarefa', 'task']);
        const done = parseBoolish(pickRowValue(row, ['done', 'feito', 'concluida', 'concluida', 'ok']));
        if (!leadId || !desc) continue;
        const key = String(leadId).trim();
        if (!tasksByLeadId.has(key)) tasksByLeadId.set(key, []);
        const createdAt = pickRowValue(row, ['createdAt', 'created_at', 'data', 'date', 'criadoem', 'criado em']);
        tasksByLeadId.get(key).push({ desc: String(desc), done, createdAt });
    }

    const rawLeads = [];
    for (const row of (Array.isArray(leadsRows) ? leadsRows : [])) {
        const id = pickRowValue(row, ['id', 'leadId', 'lead_id']);
        const name = pickRowValue(row, ['name', 'nome', 'nome do cliente', 'cliente']);
        const phone = pickRowValue(row, ['phone', 'telefone', 'celular', 'numero', 'numero de contato', 'contato', 'whatsapp', 'zap']);
        const owner = pickRowValue(row, ['owner', 'responsavel', 'consultor', 'nome do consultor']);
        const origin = pickRowValue(row, ['origin', 'origem', 'lead', 'leads']);
        const stageRaw = pickRowValue(row, ['stage', 'etapa']);
        const statusRaw = pickRowValue(row, ['status', 'status do cliente', 'status cliente']);
        const valueRaw = pickRowValue(row, ['value', 'valor', 'valor do consorcio']);
        const nextStepRaw = pickRowValue(row, ['nextStep', 'next_step', 'proximo passo', 'passo seguinte']);
        const returnDateRaw = pickRowValue(row, ['data de retorno', 'retorno', 'data retorno']);
        const scheduleRaw = pickRowValue(row, ['agendamento']);
        const tags = pickRowValue(row, ['tags', 'tag', 'consorcio de interesse', 'consorcio de interrese', 'interesse']);
        const obs = pickRowValue(row, ['obs', 'observacoes', 'nota', 'notas']);
        const email = pickRowValue(row, ['email', 'e-mail', 'gmail']);
        const lossReason = pickRowValue(row, ['lossReason', 'loss_reason', 'motivo perda', 'motivo de perda']);
        const createdAt = pickRowValue(row, ['createdAt', 'created_at', 'criadoem', 'criado em', 'carimbo de data/hora', 'carimbo de data hora', 'data do atendimento', 'data atendimento']);
        const updatedAt = pickRowValue(row, ['updatedAt', 'updated_at', 'atualizadoem', 'atualizado em']);

        const nextStepDate = returnDateRaw || scheduleRaw;
        const nextStep = sanitizeString(nextStepRaw || (nextStepDate ? formatDateForField(nextStepDate) : ''), 160);

        let stage = mapImportedStage(stageRaw) || mapImportedStage(statusRaw);
        if (!stage && statusIndicatesLost(statusRaw)) stage = 'Perdido';

        const obsParts = [];
        if (obs) obsParts.push(String(obs));
        if (email) obsParts.push(`Email: ${email}`);
        if (returnDateRaw) obsParts.push(`Data de Retorno: ${formatDateForField(returnDateRaw)}`);
        if (scheduleRaw) obsParts.push(`Agendamento: ${formatDateForField(scheduleRaw)}`);
        const obsWithExtras = obsParts.join('\n').trim();

        const provided = {};
        if (id !== '' && id !== null && id !== undefined) provided.id = true;
        if (name !== '' && name !== null && name !== undefined) provided.name = true;
        if (phone !== '' && phone !== null && phone !== undefined) provided.phone = true;
        if (owner !== '' && owner !== null && owner !== undefined) provided.owner = true;
        if (origin !== '' && origin !== null && origin !== undefined) provided.origin = true;
        if (stageRaw || statusRaw) provided.stage = true;
        if (valueRaw !== '' && valueRaw !== null && valueRaw !== undefined) provided.value = true;
        if (nextStepRaw || nextStepDate) provided.nextStep = true;
        if (tags !== '' && tags !== null && tags !== undefined) provided.tags = true;
        if (obsWithExtras) provided.obs = true;
        if (lossReason !== '' && lossReason !== null && lossReason !== undefined) provided.lossReason = true;
        if (createdAt !== '' && createdAt !== null && createdAt !== undefined) provided.createdAt = true;
        if (updatedAt !== '' && updatedAt !== null && updatedAt !== undefined) provided.updatedAt = true;

        const raw = {
            id: id !== '' ? id : undefined,
            name,
            phone,
            origin,
            stage,
            value: valueRaw,
            nextStep,
            tags,
            obs: obsWithExtras,
            lossReason,
            owner,
            createdAt,
            updatedAt,
            tasks: [],
            __importMeta: { provided }
        };

        const key = raw.id !== undefined && raw.id !== null ? String(raw.id).trim() : '';
        if (key && tasksByLeadId.has(key)) {
            raw.tasks = tasksByLeadId.get(key);
            raw.__importMeta.provided.tasks = true;
        }
        rawLeads.push(raw);
    }

    const res = normalizeImportedLeads(rawLeads);
    if (!res.ok) {
        alert(res.error);
        return;
    }
    if (!isAdmin() && currentSession && currentSession.user) {
        const me = sanitizeString(currentSession.user, 60).toLowerCase();
        res.leads.forEach((l) => { l.owner = me; });
    }

    const mergeMode = document.getElementById('import-xlsx-merge-toggle')?.checked ?? true;

    let existing = leads;
    if (backendOnline) {
        try {
            existing = await apiGetLeads();
        } catch {
            existing = leads;
        }
    }

    let nextLeads = res.leads;
    let prompt = `Importar ${res.leads.length} lead(s) do Excel?`;

    if (mergeMode) {
        const preview = mergeLeadsAdditive(existing, res.leads);
        nextLeads = preview.merged;
        prompt += `\n\nModo: MESCLAR (não apaga).`;
        prompt += `\nNovos: ${preview.added} | Atualizados: ${preview.updated} | Total após: ${nextLeads.length}`;
    } else {
        prompt += `\n\nModo: SUBSTITUIR (apaga os atuais).`;
        prompt += `\nLeads atuais: ${Array.isArray(existing) ? existing.length : 0} | Total após: ${nextLeads.length}`;
    }

    const ok = confirm(prompt);
    if (!ok) return;

    maybeCreateBackupFromPersisted({ force: true });
    leads = stripImportMetaFromLeads(nextLeads);

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
function stripImportMetaFromLead(lead) {
    if (!lead || typeof lead !== 'object') return lead;
    const { __importMeta, ...rest } = lead;
    return rest;
}

function stripImportMetaFromLeads(list) {
    return (Array.isArray(list) ? list : [])
        .filter((l) => l && typeof l === 'object')
        .map((l) => stripImportMetaFromLead(l));
}

function normalizePhoneDigits(value) {
    return String(value ?? '').replace(/\D/g, '');
}

function phonesAreSimilar(a, b) {
    const pa = normalizePhoneDigits(a);
    const pb = normalizePhoneDigits(b);
    if (!pa || !pb) return false;
    if (pa === pb) return true;
    if (Math.min(pa.length, pb.length) < 8) return false;
    return pa.endsWith(pb) || pb.endsWith(pa);
}

function hasProvidedImportField(lead, field) {
    const provided = lead && lead.__importMeta && typeof lead.__importMeta.provided === 'object'
        ? lead.__importMeta.provided
        : null;
    return !!(provided && provided[field]);
}

function hasImportMetadata(lead) {
    return !!(lead && lead.__importMeta && typeof lead.__importMeta.provided === 'object');
}

function normalizedName(value) {
    return normalizeComparableText(value).replace(/\s+/g, ' ').trim();
}

function normalizedOwnerOrOrigin(value) {
    return normalizeComparableText(value).replace(/\s+/g, ' ').trim();
}

function matchSupportScore(baseLead, incomingLead) {
    const baseOwner = normalizedOwnerOrOrigin(baseLead && baseLead.owner ? baseLead.owner : '');
    const incomingOwner = normalizedOwnerOrOrigin(incomingLead && incomingLead.owner ? incomingLead.owner : '');
    const baseOrigin = normalizedOwnerOrOrigin(baseLead && baseLead.origin ? baseLead.origin : '');
    const incomingOrigin = normalizedOwnerOrOrigin(incomingLead && incomingLead.origin ? incomingLead.origin : '');

    let score = 0;
    if (baseOwner && incomingOwner && baseOwner === incomingOwner) score += 2;
    if (baseOrigin && incomingOrigin && baseOrigin === incomingOrigin) score += 1;
    return score;
}

function findBestPhoneMatchIndex(list, incomingLead) {
    const incomingPhone = normalizePhoneDigits(incomingLead && incomingLead.phone ? incomingLead.phone : '');
    if (!incomingPhone) return -1;

    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < list.length; i++) {
        const current = list[i];
        if (!phonesAreSimilar(current && current.phone ? current.phone : '', incomingPhone)) continue;

        const currentPhone = normalizePhoneDigits(current && current.phone ? current.phone : '');
        const exactPhone = currentPhone && incomingPhone && currentPhone === incomingPhone ? 1 : 0;
        const sameName = normalizedName(current && current.name ? current.name : '') === normalizedName(incomingLead && incomingLead.name ? incomingLead.name : '') ? 1 : 0;
        const support = matchSupportScore(current, incomingLead);
        const score = (exactPhone * 100) + (sameName * 10) + support;

        if (score > bestScore) {
            bestScore = score;
            bestIdx = i;
        }
    }
    return bestIdx;
}

function findBestNameMatchIndex(list, incomingLead) {
    const incomingName = normalizedName(incomingLead && incomingLead.name ? incomingLead.name : '');
    if (!incomingName) return -1;

    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < list.length; i++) {
        const current = list[i];
        const currentName = normalizedName(current && current.name ? current.name : '');
        if (!currentName || currentName !== incomingName) continue;

        const support = matchSupportScore(current, incomingLead);
        if (support > bestScore) {
            bestScore = support;
            bestIdx = i;
        }
    }
    return bestIdx;
}

function pickIncomingOrExisting(field, existingLead, incomingLead) {
    if (!hasImportMetadata(incomingLead)) return incomingLead[field];
    return hasProvidedImportField(incomingLead, field) ? incomingLead[field] : existingLead[field];
}

function mergeMatchedLead(existingLead, incomingLead) {
    const current = existingLead && typeof existingLead === 'object' ? existingLead : {};
    const incoming = incomingLead && typeof incomingLead === 'object' ? incomingLead : {};

    const merged = {
        ...current,
        name: pickIncomingOrExisting('name', current, incoming),
        phone: pickIncomingOrExisting('phone', current, incoming),
        origin: pickIncomingOrExisting('origin', current, incoming),
        value: pickIncomingOrExisting('value', current, incoming),
        nextStep: pickIncomingOrExisting('nextStep', current, incoming),
        stage: pickIncomingOrExisting('stage', current, incoming),
        lossReason: pickIncomingOrExisting('lossReason', current, incoming),
        obs: pickIncomingOrExisting('obs', current, incoming),
        owner: pickIncomingOrExisting('owner', current, incoming),
        tags: pickIncomingOrExisting('tags', current, incoming),
        tasks: pickIncomingOrExisting('tasks', current, incoming),
        createdAt: pickIncomingOrExisting('createdAt', current, incoming),
        updatedAt: Date.now()
    };

    merged.id = current.id;
    if (!STAGES.includes(merged.stage)) merged.stage = current.stage || 'Novo lead';
    if (merged.stage !== 'Perdido') merged.lossReason = '';

    const normalized = normalizeImportedLeads([stripImportMetaFromLead(merged)]);
    if (normalized.ok && Array.isArray(normalized.leads) && normalized.leads[0]) {
        normalized.leads[0].id = current.id;
        normalized.leads[0].updatedAt = Date.now();
        return normalized.leads[0];
    }
    return stripImportMetaFromLead(merged);
}

function mergeLeadsAdditive(existingLeads, importedLeads) {
    const base = stripImportMetaFromLeads(existingLeads);
    const incoming = Array.isArray(importedLeads) ? importedLeads : [];
    const merged = Array.isArray(base) ? [...base] : [];

    let added = 0;
    let updated = 0;

    for (const lead of incoming) {
        if (!lead || typeof lead !== 'object') continue;

        const incomingId = sanitizeString(lead.id, 200);
        let matchIdx = -1;

        if (incomingId) {
            matchIdx = merged.findIndex((l) => sanitizeString(l && l.id ? l.id : '', 200) === incomingId);
        }
        if (matchIdx < 0) {
            matchIdx = findBestPhoneMatchIndex(merged, lead);
        }
        if (matchIdx < 0) {
            matchIdx = findBestNameMatchIndex(merged, lead);
        }

        if (matchIdx >= 0) {
            merged[matchIdx] = mergeMatchedLead(merged[matchIdx], lead);
            updated++;
            continue;
        }

        merged.push(stripImportMetaFromLead(lead));
        added++;
    }

    return { merged: stripImportMetaFromLeads(merged), added, updated };
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
    if (!isAdmin() && currentSession && currentSession.user) {
        const me = sanitizeString(currentSession.user, 60).toLowerCase();
        res.leads.forEach((l) => { l.owner = me; });
    }

    const mergeMode = document.getElementById('import-merge-toggle')?.checked ?? true;

    let existing = leads;
    if (backendOnline) {
        try {
            existing = await apiGetLeads();
        } catch {
            existing = leads;
        }
    }

    let nextLeads = res.leads;
    let prompt = `Importar ${res.leads.length} lead(s)?`;

    if (mergeMode) {
        const preview = mergeLeadsAdditive(existing, res.leads);
        nextLeads = preview.merged;
        prompt += `\n\nModo: MESCLAR (não apaga).`;
        prompt += `\nNovos: ${preview.added} | Atualizados: ${preview.updated} | Total após: ${nextLeads.length}`;
    } else {
        prompt += `\n\nModo: SUBSTITUIR (apaga os atuais).`;
        prompt += `\nLeads atuais: ${Array.isArray(existing) ? existing.length : 0} | Total após: ${nextLeads.length}`;
    }

    const ok = confirm(prompt);
    if (!ok) return;

    maybeCreateBackupFromPersisted({ force: true });
    leads = stripImportMetaFromLeads(nextLeads);

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
    const xlsxFileInput = document.getElementById('import-xlsx-file');
    const btnImport = document.getElementById('btn-import-json');
    const btnExport = document.getElementById('btn-export-json');
    const btnImportXlsx = document.getElementById('btn-import-xlsx');
    const btnExportXlsx = document.getElementById('btn-export-xlsx');
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
    if (btnExportXlsx) btnExportXlsx.onclick = exportDataXlsx;
    if (btnImportXlsx) btnImportXlsx.onclick = () => importDataXlsx(xlsxFileInput && xlsxFileInput.files ? xlsxFileInput.files[0] : null);
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
    if (xlsxFileInput) xlsxFileInput.disabled = !writable;
    if (btnImportXlsx) btnImportXlsx.disabled = !writable;
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

function getVisibleLeads() {
    const base = Array.isArray(leads) ? leads : [];
    if (!currentSession || currentSession.role === 'admin' || currentSession.role === 'leitura') return base;
    const me = sanitizeString(currentSession.user || '', 60).toLowerCase();
    if (!me) return [];
    return base.filter((l) => sanitizeString(l && l.owner ? l.owner : '', 60).toLowerCase() === me);
}

function getDashboardLeads() {
    const base = getVisibleLeads();
    return base.filter((l) => {
        if (!leadMatchesFilter(l)) return false;
        if (dashboardOwnerFilter === 'all') return true;
        if (dashboardOwnerFilter === '__none__') return !sanitizeString(l.owner, 200);
        return sanitizeString(l.owner, 200) === dashboardOwnerFilter;
    });
}

function getDashboardOwnerOptions() {
    const owners = new Set();
    let hasNone = false;

    for (const l of getVisibleLeads()) {
        const owner = sanitizeString(l && l.owner ? l.owner : '', 60);
        if (owner) owners.add(owner);
        else hasNone = true;
    }

    const sorted = Array.from(owners).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));

    const opts = [{ value: 'all', label: 'Todos' }];
    if (hasNone) opts.push({ value: '__none__', label: 'Sem consultor' });
    for (const o of sorted) opts.push({ value: o, label: o });

    if (!opts.some((o) => o.value === dashboardOwnerFilter)) dashboardOwnerFilter = 'all';
    return opts;
}

function setDashboardOwnerFilter(value) {
    dashboardOwnerFilter = String(value || 'all');
    localStorage.setItem('sov_dash_owner', dashboardOwnerFilter);
    renderApp();
}

// --- KANBAN ---
function ensureKanbanState() {
    if (kanbanActiveTab !== KANBAN_GENERAL_TAB && !KANBAN_STAGE_TABS.includes(kanbanActiveTab)) {
        kanbanActiveTab = KANBAN_GENERAL_TAB;
    }
    if (!kanbanVisibleByStage || typeof kanbanVisibleByStage !== 'object') {
        kanbanVisibleByStage = {};
    }
    for (const stage of STAGES) {
        const current = Number(kanbanVisibleByStage[stage]);
        if (!Number.isFinite(current) || current <= 0) {
            kanbanVisibleByStage[stage] = KANBAN_INITIAL_VISIBLE;
        }
    }
}

function getKanbanVisibleCount(stage) {
    ensureKanbanState();
    return Number(kanbanVisibleByStage[stage]) || KANBAN_INITIAL_VISIBLE;
}

function setKanbanVisibleCount(stage, nextCount) {
    ensureKanbanState();
    const safe = Math.max(KANBAN_INITIAL_VISIBLE, Number(nextCount) || KANBAN_INITIAL_VISIBLE);
    kanbanVisibleByStage[stage] = safe;
}

function createLeadCard(lead, stage) {
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
            ? `<div class="chips">${lead.tags.slice(0, 6).map((t) => `<span class="chip">${t}</span>`).join('')}</div>`
            : ''
        }
        ${lead.owner ? `<div class="consultor-badge">${lead.owner}</div>` : ''}
    `;
    return card;
}

function appendKanbanShowButtons(parent, stage, total, shown) {
    if (total <= shown) return;
    const controls = document.createElement('div');
    controls.className = 'kanban-show-controls';

    const btnMore = document.createElement('button');
    btnMore.type = 'button';
    btnMore.className = 'btn-secondary btn-small';
    btnMore.textContent = 'Mostrar mais';
    btnMore.onclick = () => {
        setKanbanVisibleCount(stage, shown + KANBAN_VISIBLE_STEP);
        renderApp();
    };

    const btnAll = document.createElement('button');
    btnAll.type = 'button';
    btnAll.className = 'btn-secondary btn-small';
    btnAll.textContent = 'Mostrar tudo';
    btnAll.onclick = () => {
        setKanbanVisibleCount(stage, total);
        renderApp();
    };

    controls.appendChild(btnMore);
    controls.appendChild(btnAll);
    parent.appendChild(controls);
}

function appendKanbanGeneralShowButtons(parent, stageMeta) {
    const rows = Array.isArray(stageMeta) ? stageMeta : [];
    if (!rows.some((r) => Number(r.total) > Number(r.shown))) return;

    const controls = document.createElement('div');
    controls.className = 'kanban-show-controls';

    const btnMore = document.createElement('button');
    btnMore.type = 'button';
    btnMore.className = 'btn-secondary btn-small';
    btnMore.textContent = 'Mostrar mais';
    btnMore.onclick = () => {
        for (const row of rows) {
            if (!row || !row.stage) continue;
            if (Number(row.total) <= Number(row.shown)) continue;
            const next = Math.min(Number(row.total), Number(row.shown) + KANBAN_VISIBLE_STEP);
            setKanbanVisibleCount(row.stage, next);
        }
        renderApp();
    };

    const btnAll = document.createElement('button');
    btnAll.type = 'button';
    btnAll.className = 'btn-secondary btn-small';
    btnAll.textContent = 'Mostrar tudo';
    btnAll.onclick = () => {
        for (const row of rows) {
            if (!row || !row.stage) continue;
            setKanbanVisibleCount(row.stage, Number(row.total));
        }
        renderApp();
    };

    controls.appendChild(btnMore);
    controls.appendChild(btnAll);
    parent.appendChild(controls);
}

function renderKanban(container) {
    ensureKanbanState();
    const root = document.createElement('div');
    root.className = 'kanban-root';

    const visible = getVisibleLeads().filter((l) => leadMatchesFilter(l));
    const counts = {};
    for (const stage of STAGES) counts[stage] = visible.filter((l) => l.stage === stage).length;

    const tabs = document.createElement('div');
    tabs.className = 'kanban-tabs';
    const tabItems = [{ key: KANBAN_GENERAL_TAB, label: 'Geral', count: visible.length }].concat(
        KANBAN_STAGE_TABS.map((stage) => ({ key: stage, label: stage, count: counts[stage] || 0 }))
    );
    for (const tab of tabItems) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `kanban-tab-btn ${kanbanActiveTab === tab.key ? 'active' : ''}`;
        btn.textContent = `${tab.label} (${tab.count})`;
        btn.onclick = () => {
            kanbanActiveTab = tab.key;
            renderApp();
        };
        tabs.appendChild(btn);
    }
    root.appendChild(tabs);

    if (kanbanActiveTab === KANBAN_GENERAL_TAB) {
        const board = document.createElement('div');
        board.className = 'kanban-board';
        const stageMeta = [];

        for (const stage of STAGES) {
            const stageLeads = visible.filter((l) => l.stage === stage);
            const visibleCount = getKanbanVisibleCount(stage);
            const shown = stageLeads.slice(0, visibleCount);

            const col = document.createElement('div');
            col.className = 'kanban-col';
            col.innerHTML = `<div class="col-header">${stage} <span>${counts[stage]}</span></div>`;

            const list = document.createElement('div');
            list.className = 'card-list';
            for (const lead of shown) list.appendChild(createLeadCard(lead, stage));
            col.appendChild(list);
            board.appendChild(col);
            stageMeta.push({ stage, total: stageLeads.length, shown: shown.length });
        }
        root.appendChild(board);
        appendKanbanGeneralShowButtons(root, stageMeta);
        container.appendChild(root);
        return;
    }

    const stage = kanbanActiveTab;
    const stageLeads = visible.filter((l) => l.stage === stage);
    const visibleCount = getKanbanVisibleCount(stage);
    const shown = stageLeads.slice(0, visibleCount);

    const stageView = document.createElement('div');
    stageView.className = 'kanban-stage-view';
    stageView.innerHTML = `<div class="col-header">${stage} <span>${stageLeads.length}</span></div>`;

    const grid = document.createElement('div');
    grid.className = 'kanban-stage-grid';
    for (const lead of shown) grid.appendChild(createLeadCard(lead, stage));
    stageView.appendChild(grid);

    if (shown.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'kanban-empty';
        empty.textContent = 'Nenhum lead encontrado para esta etapa.';
        stageView.appendChild(empty);
    }

    appendKanbanShowButtons(stageView, stage, stageLeads.length, shown.length);
    root.appendChild(stageView);
    container.appendChild(root);
}

// --- DASHBOARD (cards + tabelas + gráfico com tipo selecionável) ---
function renderDashboard(container) {
    const viewLeads = getDashboardLeads();
    const ownerOptions = getDashboardOwnerOptions();

    const totalValue = viewLeads.reduce((acc, curr) => acc + Number(curr.value), 0);
    const wonLeads = viewLeads.filter(l => l.stage === 'Fechado');
    const lostLeads = viewLeads.filter(l => l.stage === 'Perdido');
    const totalWon = wonLeads.reduce((acc, curr) => acc + Number(curr.value), 0);
    const activeLeads = viewLeads.filter(l => l.stage !== 'Fechado' && l.stage !== 'Perdido');
    const conversion = viewLeads.length > 0 ? ((wonLeads.length / viewLeads.length) * 100).toFixed(1) : '0.0';

    container.innerHTML = `
        <div class="chart-controls dash-controls">
            <div>
                <h4>Relatorio</h4>
                <div class="hint">Filtre por consultor para ver o relatorio de cada um.</div>
            </div>
            <div class="dash-filters">
                <label>Consultor</label>
                <select id="dash-owner" onchange="setDashboardOwnerFilter(this.value)">
                    ${ownerOptions.map(o => `<option value="${o.value}" ${o.value === dashboardOwnerFilter ? 'selected' : ''}>${o.label}</option>`).join('')}
                </select>
            </div>
        </div>

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
    initSalesChart(currentChartType, viewLeads);
}

function setChartType(type) {
    currentChartType = type;
    localStorage.setItem('sov_chart_type', type);
    initSalesChart(type, getDashboardLeads());
}

// --- Inicializar / Atualizar o Gráfico Interativo ---
function initSalesChart(type = 'bar', inputLeads = leads) {
    const ctx = document.getElementById('salesChart').getContext('2d');
    
    // Preparar dados: Soma de valores por etapa
    const dataByStage = STAGES.map(stage => {
        return (Array.isArray(inputLeads) ? inputLeads : [])
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
                    'rgba(6, 182, 212, 0.6)',  // Leads do site
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

function buildOwnerOptionsHtml(selectedOwner, usernames) {
    const selected = sanitizeString(selectedOwner || '', 60).toLowerCase();
    const list = (Array.isArray(usernames) ? usernames : [])
        .map((u) => sanitizeString(u, 60).toLowerCase())
        .filter(Boolean);

    const fromLeads = getVisibleLeads()
        .map((l) => sanitizeString(l && l.owner ? l.owner : '', 60).toLowerCase())
        .filter(Boolean);

    const merged = list.length ? list.concat(fromLeads) : fromLeads;
    if (currentSession && currentSession.user) merged.push(sanitizeString(currentSession.user, 60).toLowerCase());

    const unique = Array.from(new Set(merged))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));

    const finalList = selected && !unique.includes(selected) ? [selected, ...unique] : unique;

    return [
        `<option value="" ${selected ? '' : 'selected'}>&mdash;</option>`,
        ...finalList.map((u) => `<option value="${u}" ${u === selected ? 'selected' : ''}>${u}</option>`)
    ].join('');
}

function buildOwnerOptionsHtmlV2(selectedOwner, usernames) {
    const selected = sanitizeString(selectedOwner || '', 60).toLowerCase();
    const list = (Array.isArray(usernames) ? usernames : [])
        .map((u) => sanitizeString(u, 60).toLowerCase())
        .filter(Boolean);

    const fromLeads = getVisibleLeads()
        .map((l) => sanitizeString(l && l.owner ? l.owner : '', 60).toLowerCase())
        .filter(Boolean);

    const merged = list.length ? list.concat(fromLeads) : fromLeads;
    if (currentSession && currentSession.user) merged.push(sanitizeString(currentSession.user, 60).toLowerCase());

    const unique = Array.from(new Set(merged))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));

    const finalList = selected && !unique.includes(selected) ? [selected, ...unique] : unique;

    return [
        `<option value="" ${selected ? '' : 'selected'}>&mdash;</option>`,
        ...finalList.map((u) => `<option value="${u}" ${u === selected ? 'selected' : ''}>${u}</option>`)
    ].join('');
}

async function populateOwnerSelect(selectedOwner) {
    const select = document.getElementById('ed-owner');
    if (!select) return;
    select.innerHTML = buildOwnerOptionsHtmlV2(selectedOwner);
    if (!backendOnline || !isAdmin()) return;

    try {
        const users = await apiListUsers();
        const usernames = (Array.isArray(users) ? users : [])
            .map((u) => (u && u.user ? String(u.user) : ''))
            .filter(Boolean);
        select.innerHTML = buildOwnerOptionsHtmlV2(selectedOwner, usernames);
    } catch { }
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
                            <div class="tk-item ${t.done ? 'done' : ''}" onclick='toggleTask(${leadId}, ${i})'>
                                <div class="tk-item-row">
                                    <span>${t.done ? '✅' : '⭕'} Tarefa ${i + 1} • ${coerceEpochMs(t && t.createdAt) ? formatDateOnly(t.createdAt) : 'sem data'} — ${t.desc}</span>
                                    <button type="button" class="tk-del" title="Excluir tarefa" onclick='event.stopPropagation(); deleteTask(${leadId}, ${i})'>
                                        <i class="ph ph-trash"></i>
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div>
    `;
    toggleModal('modal-edit', true);
    if (isAdmin()) {
        const firstField = modal.querySelector('.edit-main .field');
        if (firstField) {
            firstField.innerHTML = `<label>Consultor</label><select id="ed-owner">${buildOwnerOptionsHtmlV2(lead.owner)}</select>`;
            populateOwnerSelect(lead.owner);
        }
    }
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
    if (isAdmin()) {
        const ownerEl = document.getElementById('ed-owner');
        if (ownerEl) lead.owner = sanitizeString(ownerEl.value, 60).toLowerCase();
    }
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
    const now = Date.now();
    lead.tasks.push({ desc, done: false, createdAt: now });
    lead.updatedAt = now;
    const input = document.getElementById('tk-new');
    if (input) input.value = '';

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

async function deleteTask(id, idx) {
    if (!canWrite()) return;
    const lead = leads.find(l => l.id === id);
    if (!lead || !Array.isArray(lead.tasks) || !lead.tasks[idx]) return;

    const ok = confirm('Excluir esta tarefa?');
    if (!ok) return;

    // Destrutivo: cria backup do estado atual mesmo com backup automático desligado
    maybeCreateBackupFromPersisted({ force: true });

    lead.tasks.splice(idx, 1);
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

