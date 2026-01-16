// --- DADOS INICIAIS AMPLIADOS ---
const STAGES = ['Novo lead', 'Primeiro contato', 'Qualificação', 'Simulação enviada', 'Negociação', 'Fechado', 'Perdido'];

let leads = [
    { 
        id: 1, 
        name: 'Carlos Oliveira', 
        origin: 'Instagram', 
        value: 250000, 
        stage: 'Novo lead', 
        nextStep: 'Enviar tabela de preços',
        tasks: [
            { id: 101, desc: 'Ligar primeiro contato', completed: false, date: '2023-10-20' }
        ],
        lossReason: '', 
        isCompetitor: false, 
        observation: ''
    }
];

const $ = (selector) => document.querySelector(selector);

// --- RENDERIZADORES ---
function renderApp() {
    const container = $('#view-container');
    container.innerHTML = '';
    if(currentView === 'dashboard') renderDashboard(container);
    else renderKanban(container);
}

// Kanban com Origem e Valor visíveis
function renderKanban(container) {
    const board = document.createElement('div');
    board.className = 'kanban-board';
    
    STAGES.forEach(stage => {
        const column = document.createElement('div');
        column.className = 'kanban-column';
        const stageLeads = leads.filter(l => l.stage === stage);
        
        column.innerHTML = `<div class="kanban-header">${stage} <span class="count-badge">${stageLeads.length}</span></div>`;
        
        const cardsContainer = document.createElement('div');
        cardsContainer.className = 'kanban-cards';
        cardsContainer.ondragover = e => e.preventDefault();
        cardsContainer.ondrop = e => dropLead(e, stage);

        stageLeads.forEach(lead => {
            const card = document.createElement('div');
            card.className = 'kanban-card';
            card.draggable = true;
            card.ondragstart = e => e.dataTransfer.setData('text/plain', lead.id);
            card.onclick = () => openLeadModal(lead.id);
            card.innerHTML = `
                <div class="card-origin">📍 ${lead.origin}</div>
                <div class="card-title">${lead.name}</div>
                <div class="card-info"><b>R$ ${lead.value.toLocaleString()}</b></div>
                <div class="card-next-step">🚀 ${lead.nextStep || 'Sem próximo passo'}</div>
            `;
            cardsContainer.appendChild(card);
        });
        column.appendChild(cardsContainer);
        board.appendChild(column);
    });
    container.appendChild(board);
}

// --- LOGICA DO MODAL DE DETALHES ---
function openLeadModal(id) {
    const lead = leads.find(l => l.id === id);
    const modal = $('#lead-modal');
    
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>${lead.name}</h2>
                <button onclick="closeModal('lead-modal')"><i class="ph ph-x"></i></button>
            </div>
            <div class="modal-body">
                <div class="modal-sidebar">
                    <div class="form-group">
                        <label>Etapa Atual</label>
                        <select class="form-control" onchange="updateLeadStage(${lead.id}, this.value)">
                            ${STAGES.map(s => `<option value="${s}" ${lead.stage === s ? 'selected' : ''}>${s}</option>`).join('')}
                        </select>
                    </div>

                    <div id="loss-fields" style="display: ${lead.stage === 'Perdido' ? 'block' : 'none'}">
                        <div class="form-group">
                            <label>Motivo da Perda</label>
                            <select class="form-control" onchange="updateLossField(${lead.id}, 'lossReason', this.value)">
                                <option value="">Selecione...</option>
                                <option value="Preço" ${lead.lossReason === 'Preço' ? 'selected' : ''}>Preço</option>
                                <option value="Concorrência" ${lead.lossReason === 'Concorrência' ? 'selected' : ''}>Concorrência</option>
                                <option value="Desistiu" ${lead.lossReason === 'Desistiu' ? 'selected' : ''}>Desistiu</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label><input type="checkbox" ${lead.isCompetitor ? 'checked' : ''} onchange="updateLossField(${lead.id}, 'isCompetitor', this.checked)"> Perda por Concorrência?</label>
                        </div>
                        <div class="form-group">
                            <label>Observação</label>
                            <textarea class="form-control" onchange="updateLossField(${lead.id}, 'observation', this.value)">${lead.observation}</textarea>
                        </div>
                    </div>

                    <div class="form-group">
                        <label>Origem</label>
                        <input class="form-control" value="${lead.origin}" onchange="updateLeadField(${lead.id}, 'origin', this.value)">
                    </div>
                    <div class="form-group">
                        <label>Valor Estimado (R$)</label>
                        <input type="number" class="form-control" value="${lead.value}" onchange="updateLeadField(${lead.id}, 'value', this.value)">
                    </div>
                    <div class="form-group">
                        <label>Próximo Passo (Resumo)</label>
                        <input class="form-control" value="${lead.nextStep}" onchange="updateLeadField(${lead.id}, 'nextStep', this.value)">
                    </div>
                </div>

                <div class="modal-main">
                    <h3>✅ Tarefas e Follow-up</h3>
                    <div class="task-input-group">
                        <input type="text" id="new-task-desc" placeholder="Nova tarefa...">
                        <input type="date" id="new-task-date">
                        <button onclick="addNewTask(${lead.id})">Adicionar</button>
                    </div>
                    <div class="task-list">
                        ${lead.tasks.map(t => `
                            <div class="task-item ${t.completed ? 'completed' : ''}">
                                <div class="task-info">
                                    <span>${t.desc}</span>
                                    <small>${t.date}</small>
                                </div>
                                ${!t.completed ? `<button onclick="completeTask(${lead.id}, ${t.id})">Concluir</button>` : '<span>✔️</span>'}
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div>
    `;
    modal.classList.add('open');
}

// --- FUNÇÕES DE ATUALIZAÇÃO ---
function updateLeadField(id, field, value) {
    leads = leads.map(l => l.id === id ? {...l, [field]: value} : l);
    renderApp();
}

function updateLeadStage(id, newStage) {
    leads = leads.map(l => l.id === id ? {...l, stage: newStage} : l);
    openLeadModal(id); // Recarrega modal para mostrar campos de perda se necessário
    renderApp();
}

function updateLossField(id, field, value) {
    leads = leads.map(l => l.id === id ? {...l, [field]: value} : l);
}

function addNewTask(leadId) {
    const desc = $('#new-task-desc').value;
    const date = $('#new-task-date').value;
    if(!desc || !date) return alert("Preencha descrição e data!");

    leads = leads.map(l => {
        if(l.id === leadId) {
            return { ...l, tasks: [...l.tasks, { id: Date.now(), desc, date, completed: false }] };
        }
        return l;
    });
    openLeadModal(leadId);
}

function completeTask(leadId, taskId) {
    leads = leads.map(l => {
        if(l.id === leadId) {
            const updatedTasks = l.tasks.map(t => t.id === taskId ? {...t, completed: true} : t);
            return { ...l, tasks: updatedTasks };
        }
        return l;
    });
    openLeadModal(leadId);
}

// Iniciar
let currentView = 'kanban';
renderApp();