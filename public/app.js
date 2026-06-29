// @ts-nocheck
// API Base URL
const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : '/api';

// Previne agressivamente que o navegador use cache (mesmo se já estava em cache antes da correção do servidor)
const originalFetch = window.fetch;
window.fetch = function(resource, config) {
  if (typeof resource === 'string' && resource.startsWith(API_URL) && (!config || !config.method || config.method.toUpperCase() === 'GET')) {
    const separator = resource.includes('?') ? '&' : '?';
    resource += `${separator}_t=${Date.now()}`;
  }
  return originalFetch(resource, config);
};

// Socket removido para economia Vercel Pro
const socket = null;

/* === MELHORIA A: PORTÃO DE ENTRADA === */
const GATE_HASH = 'af99a4ea5f59cb313edbcf21759afcbad8c77212870be1098363836e00e816c1';
const GATE_EXPIRY_MS = 10 * 60 * 60 * 1000; // 10 horas
let gateAttempts = 0;
let gateLocked = false;
let gateLockTimer = null;

async function hashSHA256(str) {
  const enc = new TextEncoder();
  const buffer = await crypto.subtle.digest('SHA-256', enc.encode(str));
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verificarSenhaEntrada(digitada) {
  const hash = await hashSHA256(digitada);
  return hash === GATE_HASH;
}

function checkGateSession() {
  // Exceção: Painel TV
  const params = new URLSearchParams(window.location.search);
  if (params.get('modo') === 'tv') {
    hideGate();
    // Auto-show painel TV
    setTimeout(() => { showScreen('painel'); }, 300);
    return;
  }
  const auth = sessionStorage.getItem('usf_gate_auth');
  const time = sessionStorage.getItem('usf_gate_time');
  if (auth === 'true' && time) {
    const elapsed = Date.now() - parseInt(time, 10);
    if (elapsed < GATE_EXPIRY_MS) {
      hideGate();
      return;
    }
    // Sessão expirada
    sessionStorage.removeItem('usf_gate_auth');
    sessionStorage.removeItem('usf_gate_time');
  }
  showGate();
}

function showGate() {
  const gate = document.getElementById('gate-overlay');
  const wrapper = document.getElementById('app-wrapper');
  if (gate) gate.classList.remove('hidden');
  if (wrapper) wrapper.style.display = 'none';
}

function hideGate() {
  const gate = document.getElementById('gate-overlay');
  const wrapper = document.getElementById('app-wrapper');
  if (gate) gate.classList.add('hidden');
  if (wrapper) wrapper.style.display = '';
}

async function tentarEntrar() {
  if (gateLocked) return;
  const inp = document.getElementById('gate-password');
  const errEl = document.getElementById('gate-error');
  const senha = inp.value.trim();
  if (!senha) { errEl.textContent = '❌ Digite a senha.'; return; }

  const ok = await verificarSenhaEntrada(senha);
  if (ok) {
    sessionStorage.setItem('usf_gate_auth', 'true');
    sessionStorage.setItem('usf_gate_time', Date.now().toString());
    errEl.textContent = '';
    inp.value = '';
    gateAttempts = 0;
    hideGate();
  } else {
    gateAttempts++;
    errEl.textContent = '❌ Senha incorreta. Tente novamente.';
    inp.value = '';
    inp.focus();
    if (gateAttempts >= 5) {
      gateLocked = true;
      const btn = document.getElementById('gate-btn');
      const lockEl = document.getElementById('gate-lockout');
      btn.disabled = true;
      inp.disabled = true;
      let remaining = 120;
      lockEl.textContent = `⏳ Bloqueado. Tente novamente em ${remaining}s`;
      gateLockTimer = setInterval(() => {
        remaining--;
        lockEl.textContent = `⏳ Bloqueado. Tente novamente em ${remaining}s`;
        if (remaining <= 0) {
          clearInterval(gateLockTimer);
          gateLocked = false;
          gateAttempts = 0;
          btn.disabled = false;
          inp.disabled = false;
          lockEl.textContent = '';
          errEl.textContent = '';
        }
      }, 1000);
    }
  }
}

function logoutGate() {
  sessionStorage.removeItem('usf_gate_auth');
  sessionStorage.removeItem('usf_gate_time');
  window.location.reload();
}

// Enter key listener for gate
document.addEventListener('DOMContentLoaded', () => {
  const gateInp = document.getElementById('gate-password');
  if (gateInp) {
    gateInp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') tentarEntrar();
    });
  }
  checkGateSession();
});
/* === FIM MELHORIA A: PORTÃO DE ENTRADA === */

/* === MELHORIA F: TRAVA DE EXPEDIENTE E PAUSA MANUAL === */

// --- Estado global de pausa e referências aos intervalos controlados ---
let isPausado = false;
let intervalChat = null;   // referência ao setInterval do chat (~linha 2422)
let intervalAgend = null;  // referência ao setInterval de agendamentos (~linha 2447)

// --- Helper: retorna { day: 0-6, hour: 0-23 } no fuso America/Recife ---
function getDayAndHourRecife(date) {
  // Formata a data como 'YYYY-MM-DD' no fuso de Recife
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Recife',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
  // Obtém hora (0–23) no fuso de Recife
  const hour = parseInt(new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Recife', hour: '2-digit', hour12: false
  }).format(date), 10);
  // Parseia como UTC midnight para obter getUTCDay() correto (sem distorção de fuso local)
  const midnight = new Date(dateStr + 'T00:00:00Z');
  return { day: midnight.getUTCDay(), hour }; // day: 0=Dom, 1=Seg, …, 6=Sab
}

// --- isDentroDoHorario: America/Recife | Segunda–Sexta | 06h–18h ---
// Substitui a versão antiga (America/Sao_Paulo, sem dia da semana) que fica nas linhas ~2362
function isDentroDoHorario() {
  const { day, hour } = getDayAndHourRecife(new Date());
  if (day === 0 || day === 6) return false; // Domingo (0) ou Sábado (6)
  if (hour < 6 || hour >= 18) return false; // Fora de 06h–18h
  return true;
}

// --- Parar TODOS os loops e timers de polling (garante ZERO tráfego ao banco) ---
function stopAllPolling() {
  if (pollingTimer1) { clearTimeout(pollingTimer1);  pollingTimer1 = null; }
  if (pollingTimer2) { clearTimeout(pollingTimer2);  pollingTimer2 = null; }
  if (intervalChat)  { clearInterval(intervalChat);  intervalChat  = null; }
  if (intervalAgend) { clearInterval(intervalAgend); intervalAgend = null; }
}

// --- Retomar todos os loops após pausa ou retorno ao expediente ---
function resumeAllPolling() {
  startAdaptivePolling();
  if (!intervalChat) {
    intervalChat = setInterval(() => {
      const at = document.querySelector('.nav-tab.active');
      if (at && at.id === 'tab-chat') registerPresenca();
      loadChatPresenca().then(() => renderCanalList());
    }, 30000);
  }
  if (!intervalAgend) {
    intervalAgend = setInterval(() => {
      if (document.getElementById('screen-agendamentos')?.classList.contains('active')) {
        initAgendamentoDefaults();
      }
    }, 5000);
  }
}

// --- Relógio na tela de fora de expediente (apenas exibe hora — SEM bater no banco) ---
function updateOffhoursDisplay() {
  const el = document.getElementById('offhours-clock');
  if (!el) return;
  el.textContent = new Date().toLocaleTimeString('pt-BR', {
    timeZone: 'America/Recife', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}
setInterval(updateOffhoursDisplay, 1000); // sempre ativo — só lê Date(), não toca no banco

// --- Verificar e aplicar estado de expediente (chamada periódica a cada 60s) ---
function checkExpediente() {
  const dentroHorario = isDentroDoHorario();
  const offEl = document.getElementById('offhours-overlay');

  if (!dentroHorario && !isPausado) {
    // Fora do expediente → mostrar overlay + parar TODO polling
    if (offEl) offEl.classList.remove('hidden');
    stopAllPolling();
  } else if (dentroHorario && !isPausado) {
    // Dentro do expediente → esconder overlay + garantir polling ativo
    if (offEl) offEl.classList.add('hidden');
    if (!pollingTimer1) resumeAllPolling(); // só retoma se estava parado
  }
}
setInterval(checkExpediente, 60000); // verifica a cada minuto

// --- Botão de Pausa Manual para Palestras da Gestora ---
function togglePausaPalestra() {
  if (!isPausado) {
    // Ativar pausa — requer senha simples
    const senha = prompt('🎙️ Pausar para Palestra\n\nDigite a senha para ativar o modo pausa:');
    if (!senha) return;
    if (senha !== 'chico123') { showToast('❌ Senha incorreta!', true); return; }
    isPausado = true;
    // Fechar qualquer modal aberto
    document.querySelectorAll('.modal, .modal-overlay, [id$="-modal"]').forEach(el => {
      if (el.classList.contains('show') || el.style.display === 'flex' || el.style.display === 'block') {
        el.classList.remove('show');
        el.style.display = 'none';
      }
    });
    // Bloquear scroll e interação do body
    document.body.style.overflow = 'hidden';
    document.body.style.pointerEvents = 'none';
    // Atualizar botão
    const btn = document.getElementById('btn-palestra');
    if (btn) {
      btn.innerHTML = '▶️ Retomar Atendimento';
      btn.classList.add('btn-palestra-pausado');
      btn.style.pointerEvents = 'all'; // Botão deve continuar clicavel
    }
    // Mostrar overlay (não é afetado pelo pointer-events do body por ser position:fixed)
    const overlay = document.getElementById('pause-overlay');
    if (overlay) overlay.classList.remove('hidden');
    stopAllPolling();
    showToast('🎙️ Sistema pausado para palestra');
  } else {
    // Retomar — sem senha
    isPausado = false;
    // Desbloquear scroll e interação
    document.body.style.overflow = '';
    document.body.style.pointerEvents = '';
    const btn = document.getElementById('btn-palestra');
    if (btn) {
      btn.innerHTML = '🎙️ Pausar para Palestra';
      btn.classList.remove('btn-palestra-pausado');
      btn.style.pointerEvents = '';
    }
    const overlay = document.getElementById('pause-overlay');
    if (overlay) overlay.classList.add('hidden');
    resumeAllPolling();
    loadQueues(); loadCurrentCalling(); loadHistory();
    showToast('✅ Atendimento retomado!');
  }
}
/* === FIM MELHORIA F === */

/* === MELHORIA D: NOTIFICAÇÕES POP-UP CENTRAL === */
let notifQueue = [];       // fila de notificações pendentes
let notifCurrent = null;   // notificação sendo exibida
let notifDismissedIds = new Set(); // IDs já fechados nesta sessão

// Determinar setor ativo do dispositivo pela aba selecionada
function getMeuSetorAtivo() {
  const activeTab = document.querySelector('.nav-tab.active');
  if (!activeTab) return null;
  const tabId = activeTab.id.replace('tab-', '');
  const setorMap = {
    medico: 'Médico', enfermagem: 'Enfermagem', odontologia: 'Odontologia',
    farmacia: 'Farmácia', regulacao: 'Regulação', acolhimento: 'Acolhimento'
  };
  return setorMap[tabId] || null;
}

// Carregar notificações pendentes do servidor
async function loadNotificacoes() {
  const setor = getMeuSetorAtivo();
  if (!setor) return;
  try {
    const r = await fetch(`${API_URL}/notificacoes/${encodeURIComponent(setor)}`);
    const data = await r.json();
    // Filtrar notificações já na fila, já exibida ou já fechadas
    const knownIds = new Set([
      ...notifQueue.map(n => n.id),
      ...(notifCurrent ? [notifCurrent.id] : []),
      ...notifDismissedIds
    ]);
    const newNotifs = data.filter(n => !knownIds.has(n.id));
    if (newNotifs.length > 0) {
      notifQueue.push(...newNotifs);
      if (!notifCurrent) showNextNotif();
    }
  } catch(e) {}
}

// Exibir próxima notificação da fila
function showNextNotif() {
  if (notifQueue.length === 0) {
    notifCurrent = null;
    const overlay = document.getElementById('notif-overlay');
    if (overlay) overlay.classList.add('hidden');
    return;
  }
  notifCurrent = notifQueue.shift();
  const iconMap = { presenca: '✅', urgente: '🚨', sistema: 'ℹ️' };
  document.getElementById('notif-icon').textContent = iconMap[notifCurrent.tipo] || '🔔';
  document.getElementById('notif-title').textContent = notifCurrent.titulo;
  document.getElementById('notif-body').textContent = notifCurrent.mensagem;
  const remaining = notifQueue.length;
  document.getElementById('notif-counter').textContent =
    remaining > 0 ? `+${remaining} notificação(ões) na fila` : '';
  document.getElementById('notif-overlay').classList.remove('hidden');
  // Som de alerta
  bipChat();
}

// Fechar notificação atual e sincronizar com servidor
async function dismissNotificacao() {
  if (!notifCurrent) return;
  const id = notifCurrent.id;
  notifDismissedIds.add(id);
  try {
    await fetch(`${API_URL}/notificacoes/${id}/dismiss`, { method: 'POST' });
  } catch(e) {}
  showNextNotif(); // Mostrar próxima ou fechar overlay
}
/* === FIM MELHORIA D === */

/* === MELHORIA E: CONFIRMAÇÃO DE PRESENÇA === */
async function confirmarPresenca(id, nome) {
  try {
    const r = await fetch(`${API_URL}/patients/${id}/confirmar-presenca`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }
    });
    if (!r.ok) throw new Error();
    showToast(`✅ Presença de ${nome} confirmada!`);
    loadQueues();
  } catch { showToast('Erro ao confirmar presença!', true); }
}
/* === FIM MELHORIA E === */

const SETORES = ['Acolhimento', 'Farmácia', 'Regulação', 'Médico', 'Enfermagem', 'Odontologia', 'Téc. Enfermagem'];

const SECTOR_CONFIG = {
  'Acolhimento': { icon: '💜', color: 'var(--purple)', colorDark: 'var(--purple-dark)', btnClass: 'btn-purple', tagClass: 'tag-acolhimento', key: 'acolhimento' },
  'Farmácia': { icon: '💊', color: 'var(--green)', colorDark: 'var(--green-dark)', btnClass: 'btn-green', tagClass: 'tag-farmacia', key: 'farmacia' },
  'Regulação': { icon: '📋', color: 'var(--blue)', colorDark: 'var(--blue-dark)', btnClass: 'btn-primary', tagClass: 'tag-regulacao', key: 'regulacao' },
  'Médico': { icon: '🩺', color: 'var(--orange)', colorDark: 'var(--orange-dark)', btnClass: 'btn-orange', tagClass: 'tag-medico', key: 'medico',
    profissionais: ['Dra. Anahy Duarte', 'Dr. Joene Halan', 'Dra. Mirela Mota'], defaultConsultorios: ['1','2','3'] },
  'Enfermagem': { icon: '👩‍⚕️', color: 'var(--teal)', colorDark: 'var(--teal-dark)', btnClass: 'btn-teal', tagClass: 'tag-enfermagem', key: 'enfermagem',
    profissionais: ['Mariana Vaz', 'Jorge Marcio', 'Lucelia de Abreu'], defaultConsultorios: ['4','5','6'] },
  'Odontologia': { icon: '🦷', color: 'var(--pink)', colorDark: 'var(--pink-dark)', btnClass: 'btn-pink', tagClass: 'tag-odontologia', key: 'odontologia',
    profissionais: ['Dra. Juliana Cavalcante'], defaultConsultorios: ['Odontológico'] },
  'Téc. Enfermagem': { icon: '🩹', color: '#0097a7', colorDark: '#006064', btnClass: 'btn-teal', tagClass: 'tag-enfermagem', key: 'tec_enfermagem',
    profissionais: ['Viviane', 'Vilma', 'Fernando'], defaultConsultorios: ['Sala de Procedimentos'] }
};

// ====== STATE ======
let queues = {}; SETORES.forEach(s => queues[s] = []);
let currentCalling = {}; SETORES.forEach(s => currentCalling[s] = null);
let callHistory = [], attendedPatients = [], totalAtendidos = 0, totalDesistencias = 0;
let lastSpokenCallId = null, chatMessages = [], unreadChatCount = 0;
let isAdmin = false, adminPassword = null, alertedPatients = new Set();
let sectorFilters = { medico: null, enfermagem: null };

function safeDate(d) {
  if (!d) return new Date();
  const date = new Date(d);
  return isNaN(date.getTime()) ? new Date() : date;
}

const CAPACITY_LIMITS = { 'Total': 30, 'Regulação': 10, 'Farmácia': 999, 'Médico': 999, 'Acolhimento': 999, 'Enfermagem': 999, 'Odontologia': 999, 'Téc. Enfermagem': 999 };

// ====== INIT: Generate sector screens ======
function initSectorScreens() {
  SETORES.forEach(setor => {
    if (setor === 'Acolhimento') return; // Acolhimento has its own custom workflow screen
    const cfg = SECTOR_CONFIG[setor];
    const screenEl = document.getElementById('screen-' + cfg.key);
    if (!screenEl) return;

    // Filter buttons for Médico and Enfermagem only (Odontologia already done)
    let filterHTML = '';
    if (cfg.profissionais && setor !== 'Odontologia') {
      const firstProf = cfg.profissionais[0];
      const btns = cfg.profissionais.map((p, idx) =>
        `<button class="btn-filter${idx === 0 ? ' active' : ''}" data-prof="${p}" onclick="filterSector('${cfg.key}','${p}')">${p}</button>`
      ).join('');
      filterHTML = `
        <div style="margin-bottom:20px;">
          <label style="font-size:13px;font-weight:700;color:var(--gray-600);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;display:block;">Selecione seu Profissional</label>
          <div class="filter-bar" id="filter-bar-${cfg.key}" style="display:flex;gap:8px;flex-wrap:wrap;">
            ${btns}
          </div>
        </div>`;
      // Auto-set the first professional as default filter
      if (!sectorFilters[cfg.key]) {
        sectorFilters[cfg.key] = firstProf;
      }
    }

    let profHTML = '';
    if (cfg.profissionais) {
      const consultOpts = ['1','2','3','4','5','6','Odontológico','Sala de Procedimentos'].map(c =>
        `<option value="${c}">${c === 'Odontológico' ? 'Consultório Odontológico' : c === 'Sala de Procedimentos' ? c : 'Consultório ' + c}</option>`
      ).join('');
      const profOpts = cfg.profissionais.map(p => `<option value="${p}">${p}</option>`).join('');
      profHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
          <div class="form-group"><label>Consultório</label><select id="consultorio-${cfg.key}" style="width:100%;padding:12px;border-radius:8px;border:2px solid var(--gray-200);font-family:'Nunito Sans',sans-serif;font-weight:700;">${consultOpts}</select></div>
          <div class="form-group"><label>Profissional</label><select id="profissional-${cfg.key}" style="width:100%;padding:12px;border-radius:8px;border:2px solid var(--gray-200);font-family:'Nunito Sans',sans-serif;font-weight:700;">${profOpts}</select></div>
        </div>`;
    }

    screenEl.innerHTML = `
      <div class="sector-page-header">
        <div class="sector-icon-big" style="background:${cfg.color}22;">${cfg.icon}</div>
        <div><div class="sector-page-title">${setor}</div><div class="sector-page-sub">Chamada de pacientes para ${setor.toLowerCase()}</div></div>
      </div>
      <div class="calling-banner" id="banner-${cfg.key}">
        <div class="cb-icon">🔔</div>
        <div class="cb-text"><div class="cb-label">Chamando agora</div><div class="cb-name" id="banner-name-${cfg.key}">—</div><div class="cb-sector">${cfg.icon} ${setor}</div></div>
        <button class="btn btn-ghost btn-sm" onclick="speakAgain('${setor}')">🔊 Repetir</button>
      </div>
      <div class="card-white">
        ${filterHTML}
        ${profHTML}
        <div class="btn-group" style="margin-bottom:20px;">
          <button class="btn ${cfg.btnClass} btn-3d" onclick="callNext('${setor}', this)" style="flex:1;">📢 Chamar Próximo</button>
          ${(setor === 'Farmácia' || setor === 'Regulação') ? `<button class="btn ${cfg.btnClass} btn-3d" onclick="callNextMulti('${setor}', this)" style="flex:1;">📢 Chamar 3 Próximos (Multi)</button>` : ''}
          <button class="btn btn-orange btn-3d" onclick="speakAgain('${setor}', this)" style="width:auto;padding:16px 20px;background:${cfg.color}33;color:${cfg.color};box-shadow:none;border:1px solid ${cfg.color}55;">🔊 Repetir</button>
        </div>
        <div class="sector-header">
          <div class="sector-name"><div class="sector-dot" style="background:${cfg.color}"></div>Aguardando</div>
          <span class="sector-count" style="background:${cfg.color};" id="cnt2-${cfg.key}">0</span>
        </div>
        <div class="queue-list" id="queue-${cfg.key}"></div>
        <div style="margin-top:24px;padding-top:20px;border-top:2px solid var(--gray-200);">
          <div class="sector-header">
            <div class="sector-name"><div class="sector-dot" style="background:var(--green);"></div>✅ Atendidos Hoje</div>
            <span class="sector-count" style="background:var(--green);" id="cnt-attended-${cfg.key}">0</span>
          </div>
          <div class="queue-list" id="attended-${cfg.key}"></div>
        </div>
      </div>`;
  });
}

function initOverview() {
  const container = document.getElementById('overview-container');
  if (!container) return;
  container.innerHTML = SETORES.map(setor => {
    const cfg = SECTOR_CONFIG[setor];
    return `<div class="card-white" id="overview-${cfg.key}">
      <div class="sector-header">
        <div class="sector-name"><div class="sector-dot" style="background:${cfg.color}"></div>${cfg.icon} ${setor}</div>
        <span class="sector-count" style="background:${cfg.color};" id="cnt-${cfg.key}">0 na fila</span>
      </div>
      <div class="queue-list" id="mini-queue-${cfg.key}"></div>
    </div>`;
  }).join('');
}

// ====== FILTER SECTOR ======
function filterSector(key, profissional) {
  if (!profissional) return; // Must select a specific professional
  sectorFilters[key] = profissional;
  const bar = document.getElementById('filter-bar-' + key);
  if (bar) {
    bar.querySelectorAll('.btn-filter').forEach(btn => {
      btn.classList.toggle('active', (btn.dataset.prof || '') === (profissional || ''));
    });
  }
  // Auto-set dropdown
  if (profissional) {
    const pEl = document.getElementById('profissional-' + key);
    if (pEl) pEl.value = profissional;
  }
  updateQueues();
  updateBadges();
  renderAllSectorAttended();
}

// ====== CLOCK ======
function updateClock() {
  const now = new Date();
  document.getElementById('clockDisplay').textContent = now.toLocaleTimeString('pt-BR');
  const date = now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  document.getElementById('dateDisplay').textContent = date.charAt(0).toUpperCase() + date.slice(1);
}
setInterval(updateClock, 1000); updateClock();

// ====== ADMIN ======
function toggleAdmin() {
  if (isAdmin) { isAdmin = false; adminPassword = null; updateAdminUI(); return; }
  const senha = prompt('🔒 Digite a senha administrativa:');
  if (!senha) return;
  fetch(`${API_URL}/verify-admin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha }) })
    .then(r => { if (r.ok) { isAdmin = true; adminPassword = senha; showToast('🔓 Modo administrador ativado!'); } else { showToast('❌ Senha incorreta!', true); } updateAdminUI(); })
    .catch(() => showToast('Erro de conexão', true));
}

function updateAdminUI() {
  const btn = document.getElementById('btn-admin');
  if (isAdmin) { btn.textContent = '🔓 Admin'; btn.classList.add('unlocked'); document.body.classList.add('admin-active'); }
  else { btn.textContent = '🔒 Modo Público'; btn.classList.remove('unlocked'); document.body.classList.remove('admin-active'); }
  // Re-render filas para mostrar/ocultar controles admin
  updateAll();
}

// ====== MELHORIA G: MÓDULO DE REORDENAÇÃO RBAC ======

// --- Estado do contexto de menu e modais ---
let _ctxPatientId = null;
let _ctxPatientNome = null;
let _ctxPatientSetor = null;
let _sortableInstances = {}; // Guarda instâncias SortableJS por containerId

// --- AdminGuard: helper de permissão ---
const AdminGuard = {
  check() { return isAdmin; },
  require(action) {
    if (!isAdmin) { showToast('🔒 Ação restrita ao Administrador!', true); return; }
    action();
  }
};

// --- ESC fecha context menu e modais ---
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeContextMenu();
    closeTransferModal();
    closePositionModal();
  }
});
document.addEventListener('click', (e) => {
  const menu = document.getElementById('ctx-menu');
  if (menu && !menu.contains(e.target) && !e.target.classList.contains('btn-context-menu')) {
    closeContextMenu();
  }
});

// --- API helper de reordenação ---
async function apiReorder(patientId, setor, newPosition) {
  const r = await fetch(`${API_URL}/patients/${patientId}/reorder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ setor, newPosition, senha: adminPassword })
  });
  if (r.status === 403) { showToast('❌ Senha administrativa inválida!', true); throw new Error('Unauthorized'); }
  if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erro ao reordenar'); }
  return r.json();
}

// --- Mover por setas ↑↓ ---
async function movePatientArrow(patientId, setor, direction) {
  AdminGuard.require(async () => {
    const list = (queues[setor] || []).filter(p => p.status === 'aguardando');
    const idx = list.findIndex(p => p.id === patientId);
    if (idx === -1) return;
    const newPos = direction === 'up' ? Math.max(1, idx) : Math.min(list.length, idx + 2);
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === list.length - 1) return;
    try {
      // Optimistic update imediato
      const item = list.splice(idx, 1)[0];
      list.splice(direction === 'up' ? idx - 1 : idx + 1, 0, item);
      list.forEach((p, i) => p._optimisticPos = i + 1);
      updateQueues();
      await apiReorder(patientId, setor, newPos);
      await loadQueues();
    } catch(e) { await loadQueues(); showToast(e.message || 'Erro ao mover paciente!', true); }
  });
}

// --- Mover para o topo ---
async function moveToTop(patientId, setor) {
  AdminGuard.require(async () => {
    try {
      await apiReorder(patientId, setor, 1);
      showToast('🔝 Paciente movido para o topo!');
      await loadQueues();
    } catch(e) { await loadQueues(); showToast(e.message || 'Erro!', true); }
  });
}

// --- Mover para o fim ---
async function moveToBottom(patientId, setor) {
  AdminGuard.require(async () => {
    try {
      const total = (queues[setor] || []).filter(p => p.status === 'aguardando').length;
      await apiReorder(patientId, setor, total);
      showToast('⬇️ Paciente movido para o fim!');
      await loadQueues();
    } catch(e) { await loadQueues(); showToast(e.message || 'Erro!', true); }
  });
}

// --- Context Menu ---
function openContextMenu(event, id, nome, setor) {
  event.stopPropagation();
  _ctxPatientId = id;
  _ctxPatientNome = nome;
  _ctxPatientSetor = setor;
  const menu = document.getElementById('ctx-menu');
  const label = document.getElementById('ctx-menu-patient-label');
  if (label) label.textContent = nome;
  if (!menu) return;
  // Posicionamento inteligente
  const vw = window.innerWidth, vh = window.innerHeight;
  let x = event.clientX, y = event.clientY;
  menu.style.display = 'block'; // temporário para medir
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  if (x + mw > vw - 8) x = vw - mw - 8;
  if (y + mh > vh - 8) y = vh - mh - 8;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.classList.add('visible');
}

function closeContextMenu() {
  const menu = document.getElementById('ctx-menu');
  if (menu) menu.classList.remove('visible');
}

function ctxMoveToTop() { closeContextMenu(); moveToTop(_ctxPatientId, _ctxPatientSetor); }
function ctxMoveToBottom() { closeContextMenu(); moveToBottom(_ctxPatientId, _ctxPatientSetor); }
function ctxOpenPositionModal() { closeContextMenu(); openPositionModal(_ctxPatientId, _ctxPatientNome, _ctxPatientSetor); }
function ctxTransfer() { closeContextMenu(); openTransferModal(_ctxPatientId, _ctxPatientNome, _ctxPatientSetor); }
function ctxRemove() { closeContextMenu(); removePatient(_ctxPatientId, _ctxPatientNome); }

// --- Modal de Posição Numérica ---
function openPositionModal(id, nome, setor) {
  document.getElementById('position-patient-id').value = id;
  document.getElementById('position-patient-setor').value = setor;
  document.getElementById('position-patient-name').textContent = nome;
  const total = (queues[setor] || []).filter(p => p.status === 'aguardando').length;
  const inp = document.getElementById('position-input');
  inp.max = total;
  inp.placeholder = `1 - ${total}`;
  inp.value = '';
  document.getElementById('position-modal').classList.add('show');
  setTimeout(() => inp.focus(), 100);
}

function closePositionModal() {
  document.getElementById('position-modal').classList.remove('show');
}

async function confirmPosition() {
  const id = parseInt(document.getElementById('position-patient-id').value);
  const setor = document.getElementById('position-patient-setor').value;
  const pos = parseInt(document.getElementById('position-input').value);
  if (!pos || pos < 1) { showToast('Digite uma posição válida!', true); return; }
  closePositionModal();
  AdminGuard.require(async () => {
    try {
      await apiReorder(id, setor, pos);
      showToast(`🔢 Paciente movido para a posição ${pos}!`);
      await loadQueues();
    } catch(e) { await loadQueues(); showToast(e.message || 'Erro ao reposicionar!', true); }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const posInp = document.getElementById('position-input');
  if (posInp) posInp.addEventListener('keydown', e => { if (e.key === 'Enter') confirmPosition(); });
});

// --- Modal de Transferência ---
function openTransferModal(id, nome, setor) {
  document.getElementById('transfer-patient-id').value = id;
  document.getElementById('transfer-patient-setor-atual').value = setor;
  document.getElementById('transfer-patient-name').textContent = nome;
  // Remover o setor atual das opções
  const sel = document.getElementById('transfer-setor-destino');
  if (sel) {
    Array.from(sel.options).forEach(opt => {
      opt.disabled = (opt.value === setor);
      if (opt.value === setor) opt.style.color = 'var(--gray-300)';
      else opt.style.color = '';
    });
    sel.value = '';
  }
  
  // Resetar campos dinâmicos
  document.getElementById('transfer-tipo-atendimento-grupo').style.display = 'none';
  document.getElementById('transfer-profissional-grupo').style.display = 'none';
  document.getElementById('transfer-tipo-atendimento').value = '';
  document.getElementById('transfer-profissional').value = '';

  document.getElementById('transfer-modal').classList.add('show');
}

function toggleTransferTipoAtendimento() {
  const setor = document.getElementById('transfer-setor-destino').value;
  const tipoGrupo = document.getElementById('transfer-tipo-atendimento-grupo');
  const profGrupo = document.getElementById('transfer-profissional-grupo');
  
  tipoGrupo.style.display = ['Médico','Enfermagem','Odontologia','Téc. Enfermagem'].includes(setor) ? 'block' : 'none';
  
  const selectTipo = document.getElementById('transfer-tipo-atendimento');
  if (selectTipo) {
    if (setor === 'Téc. Enfermagem') {
      selectTipo.innerHTML = `
        <option value="">— Opcional —</option>
        <option value="Coleta">🩸 Coleta</option>
        <option value="Vacina">💉 Vacina</option>
        <option value="Curativo">🩹 Curativo</option>
        <option value="Procedimento">🔬 Procedimento</option>
      `;
    } else if (tipoGrupo.style.display === 'block') {
      selectTipo.innerHTML = `
        <option value="">— Opcional —</option>
        <option value="Consulta">🩺 Consulta</option>
        <option value="Renovação de Receita">📄 Renovação de Receita</option>
        <option value="Hiperdia">❤️ Hiperdia</option>
        <option value="Puericultura">👶 Puericultura</option>
        <option value="Saúde da Mulher">🩷 Saúde da Mulher</option>
        <option value="Prevenção">🛡️ Prevenção</option>
        <option value="Pré-Natal">🤰 Pré-Natal</option>
        <option value="Retorno">🔄 Retorno</option>
        <option value="Exame Citopatológico">🔬 Exame Citopatológico</option>
      `;
    } else {
      selectTipo.innerHTML = '';
    }
  }

  const showProf = ['Médico','Enfermagem','Téc. Enfermagem', 'Odontologia'].includes(setor);
  // Odontologia tem profissional mas só no SECTOR_CONFIG, então vamos exibir
  const cfg = SECTOR_CONFIG[setor];
  if (showProf && cfg && cfg.profissionais) {
    profGrupo.style.display = 'block';
    const selectProf = document.getElementById('transfer-profissional');
    selectProf.innerHTML = '<option value="">— Opcional —</option>' +
      cfg.profissionais.map(p => `<option value="${p}">${p}</option>`).join('');
  } else {
    profGrupo.style.display = 'none';
  }
}

function closeTransferModal() {
  document.getElementById('transfer-modal').classList.remove('show');
}

async function confirmTransfer() {
  const id = parseInt(document.getElementById('transfer-patient-id').value);
  const setor = document.getElementById('transfer-patient-setor-atual').value;
  const novoSetor = document.getElementById('transfer-setor-destino').value;
  const novoTipoAtendimento = document.getElementById('transfer-tipo-atendimento').value;
  const novoProfissional = document.getElementById('transfer-profissional').value;

  if (!novoSetor) { showToast('Selecione o setor de destino!', true); return; }
  if (novoSetor === setor) { showToast('O setor de destino deve ser diferente do atual!', true); return; }
  AdminGuard.require(async () => {
    try {
      closeTransferModal();
      const r = await fetch(`${API_URL}/patients/${id}/transfer`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novoSetor, novoTipoAtendimento, novoProfissional, senha: adminPassword })
      });
      if (r.status === 403) { showToast('❌ Permissão negada!', true); return; }
      if (!r.ok) { const d = await r.json(); showToast(d.error || 'Erro ao transferir!', true); return; }
      showToast(`↗️ Paciente transferido para ${novoSetor}!`);
      await loadQueues();
    } catch(e) { showToast('Erro ao transferir paciente!', true); }
  });
}

// --- SortableJS: Drag & Drop com animação e ESC ---
function initSortable(containerId, setor) {
  if (!window.Sortable || !isAdmin) return;
  const el = document.getElementById(containerId);
  if (!el) return;
  // Destruir instância anterior se existir
  if (_sortableInstances[containerId]) {
    _sortableInstances[containerId].destroy();
    delete _sortableInstances[containerId];
  }
  let draggedOriginalIndex = -1;
  _sortableInstances[containerId] = Sortable.create(el, {
    animation: 100,
    ghostClass: 'sortable-ghost',
    dragClass: 'sortable-drag',
    chosenClass: 'sortable-chosen',
    handle: '.drag-handle',
    onStart(evt) {
      draggedOriginalIndex = evt.oldIndex;
      // Listener ESC para cancelar
      const escHandler = (e) => {
        if (e.key === 'Escape') {
          _sortableInstances[containerId].cancel ? _sortableInstances[containerId].cancel() : null;
          // SortableJS não tem cancel() nativo: reordenar de volta
          const items = el.querySelectorAll('.queue-item[data-id]');
          if (items.length > 0 && draggedOriginalIndex !== -1) {
            // Forcar re-render do estado armazenado
            updateQueues();
          }
          document.removeEventListener('keydown', escHandler);
          showToast('🛑 Arraste cancelado');
        }
      };
      document.addEventListener('keydown', escHandler, { once: true });
    },
    onEnd(evt) {
      if (evt.oldIndex === evt.newIndex) return;
      const newPos = evt.newIndex + 1;
      // Pegar o ID do elemento movido
      const movedEl = evt.item;
      const patientId = parseInt(movedEl.dataset.id);
      if (!patientId || !setor) { loadQueues(); return; }
      AdminGuard.require(async () => {
        try {
          await apiReorder(patientId, setor, newPos);
          showToast(`✅ Posição atualizada (${evt.newIndex + 1}º)`);
          await loadQueues();
        } catch(e) {
          await loadQueues();
          showToast(e.message || 'Erro ao salvar nova posição!', true);
        }
      });
    }
  });
}

// ====== FIM MELHORIA G ======

// ====== SCREEN NAV ======
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  const screenEl = document.getElementById('screen-' + name);
  const tabEl = document.getElementById('tab-' + name);
  if (screenEl) screenEl.classList.add('active');
  if (tabEl) tabEl.classList.add('active');
  if (name === 'chat') {
    unreadChatCount = 0;
    updateChatBadge();
    /* === MELHORIA C: Marcar canal como lido e registrar presença === */
    markCanalAsRead(activeCanal);
    registerPresenca();
    /* === FIM MELHORIA C === */
    setTimeout(() => { const c = document.getElementById('chat-messages'); if (c) c.scrollTop = c.scrollHeight; }, 50);
  }
  if (name === 'agendamentos') {
    loadAgendamentos();
  }
}

// ====== FORM HELPERS ======
function togglePrioridadeDetalhes() {
  document.getElementById('prioridade-detalhes').style.display = document.getElementById('input-prioridade').value === 'prioritario' ? 'flex' : 'none';
}

function toggleTipoAtendimento() {
  const setor = document.getElementById('input-setor').value;
  document.getElementById('tipo-atendimento-grupo').style.display = ['Médico','Enfermagem','Odontologia','Téc. Enfermagem'].includes(setor) ? 'flex' : 'none';

  const selectTipo = document.getElementById('input-tipo-atendimento');
  if (selectTipo) {
    if (setor === 'Téc. Enfermagem') {
      selectTipo.innerHTML = `
        <option value="Coleta">🩸 Coleta</option>
        <option value="Vacina">💉 Vacina</option>
        <option value="Curativo">🩹 Curativo</option>
        <option value="Procedimento">🔬 Procedimento</option>
      `;
    } else {
      selectTipo.innerHTML = `
        <option value="Consulta">🩺 Consulta</option>
        <option value="Renovação de Receita">📄 Renovação de Receita</option>
        <option value="Hiperdia">❤️ Hiperdia</option>
        <option value="Puericultura">👶 Puericultura</option>
        <option value="Saúde da Mulher">🩷 Saúde da Mulher</option>
        <option value="Prevenção">🛡️ Prevenção</option>
        <option value="Pré-Natal">🤰 Pré-Natal</option>
        <option value="Retorno">🔄 Retorno</option>
        <option value="Exame Citopatológico">🔬 Exame Citopatológico</option>
      `;
    }
  }

  const profGrupo = document.getElementById('profissional-grupo');
  if (profGrupo) {
    const showProf = ['Médico','Enfermagem','Téc. Enfermagem'].includes(setor);
    profGrupo.style.display = showProf ? 'flex' : 'none';
    if (showProf) {
      const cfg = SECTOR_CONFIG[setor];
      const select = document.getElementById('input-profissional');
      select.innerHTML = '<option value="">— Selecione o profissional —</option>' +
        (cfg.profissionais || []).map(p => `<option value="${p}">${p}</option>`).join('');
    }
  }
}

// ====== HELPER: Condições Especiais ======
function getCondicoesFromContainer(containerId) {
  const checks = document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`);
  const arr = [...checks].map(c => c.value);
  return arr.length ? JSON.stringify(arr) : null;
}
function renderCondicoesBadges(condicoesStr) {
  if (!condicoesStr) return '';
  try {
    const arr = JSON.parse(condicoesStr);
    return arr.map(c => {
      if (c === 'hipertenso') return '<span class="cond-badge cond-hipertenso">💙 HAS</span>';
      if (c === 'diabetico') return '<span class="cond-badge cond-diabetico">🧡 DM</span>';
      if (c === 'gestante') return '<span class="cond-badge cond-gestante">💜 GEST</span>';
      return '';
    }).join('');
  } catch { return ''; }
}
function setCondicoesCheckboxes(containerId, condicoesStr) {
  const checks = document.querySelectorAll(`#${containerId} input[type="checkbox"]`);
  checks.forEach(c => c.checked = false);
  if (!condicoesStr) return;
  try {
    const arr = JSON.parse(condicoesStr);
    checks.forEach(c => { if (arr.includes(c.value)) c.checked = true; });
  } catch {}
}

// ====== CHAT SIDEBAR TOGGLE (mobile) ======
function toggleChatSidebar() {
  const sb = document.getElementById('chat-sidebar');
  if (sb) sb.classList.toggle('open');
}

// ====== ADD PATIENT ======
async function addPatient(btn) {
  const nome = document.getElementById('input-nome').value.trim();
  const setor = document.getElementById('input-setor').value;
  const prioridade = document.getElementById('input-prioridade').value;
  const tipo_prioridade = prioridade === 'prioritario' ? document.getElementById('input-tipo-prioridade').value : null;
  const tipo_atendimento = ['Médico','Enfermagem','Odontologia','Téc. Enfermagem'].includes(setor) ? document.getElementById('input-tipo-atendimento').value : null;
  const profissionalEl = document.getElementById('input-profissional');
  const profissional = ['Médico','Enfermagem','Téc. Enfermagem'].includes(setor) && profissionalEl ? profissionalEl.value || null : null;
  const condicoes_especiais = getCondicoesFromContainer('condicoes-especiais-recepcao');

  if (!nome) { showToast('Digite o nome do paciente!', true); return; }
  if (!setor) { showToast('Selecione o setor!', true); return; }
  if (['Médico','Enfermagem','Téc. Enfermagem'].includes(setor) && !profissional) { showToast('Selecione o profissional responsável!', true); return; }

  if (btn) btn.disabled = true;
  try {
    const r = await fetch(`${API_URL}/patients`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome, setor, prioridade, tipo_prioridade, tipo_atendimento, profissional, condicoes_especiais }) });
    if (!r.ok) throw new Error();
    const newPatient = await r.json();
    document.getElementById('input-nome').value = '';
    document.getElementById('input-setor').value = '';
    document.getElementById('input-prioridade').value = 'geral';
    // Reset condições checkboxes
    document.querySelectorAll('#condicoes-especiais-recepcao input[type="checkbox"]').forEach(c => c.checked = false);
    togglePrioridadeDetalhes(); toggleTipoAtendimento();
    const prioLabel = prioridade === 'prioritario' ? ' ⭐ PRIORITÁRIO' : '';
    const profLabel = profissional ? ` (${profissional})` : '';
    showToast(`${nome} adicionado à fila de ${setor}${profLabel}!${prioLabel}`);
    await loadQueues();
    // showQrModal(newPatient); // 🚫 Desativado a pedido: Não mostrar modal de QR automático
  } catch { showToast('Erro ao adicionar paciente!', true); }
  if (btn) btn.disabled = false;
}

let qrCodeInstance = null;
function showQrModal(p) {
  document.getElementById('qr-patient-name').textContent = p.nome;
  document.getElementById('qr-patient-sector').textContent = p.setor + (p.profissional ? ` - ${p.profissional}` : '');
  
  const qrContainer = document.getElementById('qrcode-container');
  qrContainer.innerHTML = '';
  
  const virtualUrl = `${window.location.origin}/virtual.html?id=${p.id}`;
  
  if (window.QRCode) {
    qrCodeInstance = new QRCode(qrContainer, {
      text: virtualUrl,
      width: 160,
      height: 160,
      colorDark : "#0a1e5c",
      colorLight : "#ffffff",
      correctLevel : QRCode.CorrectLevel.H
    });
  } else {
    qrContainer.innerHTML = '<span style="font-size:12px;color:red;">Erro ao gerar QR Code</span>';
  }
  
  document.getElementById('qr-modal').style.display = 'flex';
}

// ====== CALL NEXT ======
async function callNext(setor, btnElement) {
  if (btnElement) {
    btnElement.disabled = true;
    const originalText = btnElement.innerHTML;
    btnElement.innerHTML = '⏳ Chamando...';
    setTimeout(() => {
      btnElement.disabled = false;
      btnElement.innerHTML = originalText;
    }, 2500);
  }

  try {
    const cfg = SECTOR_CONFIG[setor];
    let consultorio = null, profissional = null, medico = null;
    const filtro_profissional = sectorFilters[cfg.key] || null;

    if (cfg.profissionais) {
      const cEl = document.getElementById('consultorio-' + cfg.key);
      const pEl = document.getElementById('profissional-' + cfg.key);
      consultorio = cEl ? cEl.value : null;
      profissional = pEl ? pEl.value : null;
      const consLabel = consultorio === 'Odontológico' ? 'Consultório Odontológico' : 'Consultório ' + consultorio;
      medico = `${consLabel} - ${profissional}`;
    }
    const r = await fetch(`${API_URL}/call-next/${setor}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ medico, consultorio, profissional, filtro_profissional }) });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
    loadQueues(); loadCurrentCalling();
  } catch (e) { showToast(e.message || `Fila de ${setor} está vazia!`, true); }
}

async function callNextMulti(setor, btnElement, count = 3) {
  if (btnElement) {
    btnElement.disabled = true;
    const originalText = btnElement.innerHTML;
    btnElement.innerHTML = '⏳ Chamando Múltiplos...';
    setTimeout(() => {
      btnElement.disabled = false;
      btnElement.innerHTML = originalText;
    }, 3500);
  }

  try {
    for (let i = 0; i < count; i++) {
      // Pequeno atraso para dar tempo de enviar e o painel renderizar em ordem
      if (i > 0) await new Promise(r => setTimeout(r, 800));
      await callNext(setor, null);
    }
  } catch (e) {
    console.error('Erro na chamada múltipla:', e);
  }
}

// ====== REMOVE PATIENT ======
async function removePatient(id, nome) {
  const senha = prompt(`🗑️ Marcar "${nome}" como DESISTÊNCIA?\n\nDigite a senha administrativa:`);
  if (!senha) return;
  try {
    const r = await fetch(`${API_URL}/remove-patient`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, senha }) });
    if (r.status === 403) { showToast('❌ Senha incorreta!', true); return; }
    if (!r.ok) throw new Error();
    showToast(`🗑️ ${nome} marcado como desistência`);
    loadQueues();
  } catch { showToast('Erro ao remover paciente!', true); }
}

async function deletePatientPermanently(id, nome) {
  if (!confirm(`🚨 CUIDADO! Excluir "${nome}" PERMANENTEMENTE do banco de dados?\nEsta ação não pode ser desfeita.`)) return;
  const senha = prompt('Digite a senha administrativa para confirmar a EXCLUSÃO PERMANENTE:');
  if (!senha) return;
  try {
    const r = await fetch(`${API_URL}/patients/${id}/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha }) });
    if (r.status === 403) { showToast('❌ Senha incorreta!', true); return; }
    if (!r.ok) throw new Error();
    showToast(`🔥 ${nome} excluído permanentemente!`);
    loadQueues();
  } catch { showToast('Erro ao excluir!', true); }
}

// ====== SPEAK ======
let audioUnlocked = false;
let isMuted = false;

function toggleMute() {
  isMuted = !isMuted;
  const btn = document.getElementById('btn-mute');
  if (btn) {
    btn.innerHTML = isMuted ? '🔇' : '🔊';
  }
  showToast(isMuted ? 'Áudio silenciado' : 'Áudio ativado');
}
function unlockAudio() {
  if (!audioUnlocked && 'speechSynthesis' in window) { const d = new SpeechSynthesisUtterance(' '); d.volume = 0; window.speechSynthesis.speak(d); audioUnlocked = true; }
  const g = document.getElementById('global-audio'); if (g) g.play().catch(() => {});
  document.getElementById('sound-modal').style.display = 'none';
  showToast('🔊 Som ativado com sucesso!');
}

function speak(nome, setor, audioUrl, medico) { speakViaSynthesis(nome, setor, medico); }

function speakAgain(setor, btnElement) {
  if (btnElement) {
    btnElement.disabled = true;
    setTimeout(() => btnElement.disabled = false, 2500);
  }
  if (currentCalling[setor]) { const p = currentCalling[setor]; speakViaSynthesis(p.nome, setor, p.medico); } else showToast('Nenhum paciente sendo chamado!', true);
}

let speechQueue = [];
let isSpeaking = false;

function processSpeechQueue() {
  if (isSpeaking || speechQueue.length === 0) return;
  if (!('speechSynthesis' in window)) return;
  
  isSpeaking = true;
  const { texto } = speechQueue.shift();
  const utter = new SpeechSynthesisUtterance(texto);
  utter.lang = 'pt-BR'; utter.rate = 0.95; utter.pitch = 1;
  const voices = window.speechSynthesis.getVoices();
  const pv = voices.find(v => v.name.includes('Francisca') || v.name.includes('Antonio') || v.name.includes('Google português do Brasil') || v.name.includes('Luciana') || v.name.includes('Daniel'));
  const fv = voices.find(v => v.lang.startsWith('pt'));
  if (pv) utter.voice = pv; else if (fv) utter.voice = fv;

  // Safety timeout: bug do Chrome onde onend não dispara quando aba perde foco.
  // Estimativa: ~3 palavras/segundo + 3s de margem de segurança.
  const wordCount = texto.split(/\s+/).length;
  const estimatedDuration = Math.ceil(wordCount / 3) * 1000;
  const safetyTimeout = setTimeout(() => {
    console.warn('⚠️ Speech onend não disparou (aba minimizada?). Continuando fila...');
    isSpeaking = false;
    processSpeechQueue();
  }, estimatedDuration + 3000);

  utter.onend = () => {
    clearTimeout(safetyTimeout); // Cancelar timeout se onend disparou normalmente
    isSpeaking = false;
    setTimeout(processSpeechQueue, 500); // pequeno delay entre áudios
  };
  
  utter.onerror = (e) => {
    clearTimeout(safetyTimeout); // Cancelar timeout também em caso de erro
    console.error("SpeechSynthesis erro", e);
    isSpeaking = false;
    processSpeechQueue();
  };
  
  window.speechSynthesis.speak(utter);
}

function speakViaSynthesis(nome, setor, medico) {
  if (isMuted) return;
  if (!('speechSynthesis' in window)) return;
  
  const h = new Date().getHours();
  const saudacao = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const destino = medico ? `ao ${medico}` : `à ${setor}`;
  const texto = `${saudacao}. Usuário ${nome}, dirija-se ${destino}.`;
  
  speechQueue.push({ texto });
  processSpeechQueue();
}

function speakPatientName(btnElement) {
  if (btnElement) {
    btnElement.disabled = true;
    setTimeout(() => btnElement.disabled = false, 2500);
  }
  if (!callHistory || !callHistory.length) { showToast('Nenhuma chamada registrada!', true); return; }
  const l = callHistory[0]; speakViaSynthesis(l.nome, l.setor, l.medico); showToast(`🔊 Chamando: ${l.nome}`);
}

function repeatLastCall(btnElement) {
  if (btnElement) {
    btnElement.disabled = true;
    setTimeout(() => btnElement.disabled = false, 2500);
  }
  if (callHistory && callHistory.length) { const l = callHistory[0]; speakViaSynthesis(l.nome, l.setor, l.medico); showToast(`🔊 Repetindo: ${l.nome}`); }
  else showToast('Nenhuma chamada no histórico!', true);
}

// ====== CHAT SOUND ======
function playChatSound() {
  if (typeof isMuted !== 'undefined' && isMuted) return;
  if (typeof audioUnlocked !== 'undefined' && !audioUnlocked) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880; osc.type = 'sine'; gain.gain.value = 0.3;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.stop(ctx.currentTime + 0.4);
    setTimeout(() => {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2); gain2.connect(ctx.destination);
      osc2.frequency.value = 1100; osc2.type = 'sine'; gain2.gain.value = 0.3;
      osc2.start();
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc2.stop(ctx.currentTime + 0.4);
    }, 200);
  } catch(e) { /* ignore audio errors */ }
}

// ====== LOAD DATA ======
async function loadQueues() { try { const r = await fetch(`${API_URL}/queues`); queues = await r.json(); SETORES.forEach(s => { if (!queues[s]) queues[s] = []; }); updateAll(); } catch (e) { console.error(e); } }
async function loadCurrentCalling() { try { const r = await fetch(`${API_URL}/current-calling`); const d = await r.json(); currentCalling = d.current; totalAtendidos = d.totalAtendidos || 0; totalDesistencias = d.totalDesistencias || 0; updateBanners(); updatePainel(); updateStats(); } catch (e) { console.error(e); } }
async function loadHistory() {
  try {
    const r = await fetch(`${API_URL}/history`);
    callHistory = await r.json();
    if (callHistory && callHistory.length) {
      if (lastSpokenCallId !== null) {
        // Encontrar todas as novas chamadas cronologicamente
        const newCalls = [];
        for (const p of callHistory) {
          if (p.id === lastSpokenCallId) break;
          newCalls.unshift(p);
        }
        for (const p of newCalls) {
          speakViaSynthesis(p.nome, p.setor, p.medico);
        }
      }
      lastSpokenCallId = callHistory[0].id;
    }
    updatePainel();
    renderAllSectorAttended();
  } catch (e) { console.error(e); }
}
async function loadAttended() { try { const r = await fetch(`${API_URL}/attended`); attendedPatients = await r.json(); renderAttended(); } catch (e) { console.error(e); } }

// ====== UPDATE UI ======
function updateAll() { updateStats(); updateBadges(); updateQueues(); updateMiniQueues(); updateRecent(); renderAllSectorAttended(); }

function updateStats() {
  let total = 0;
  SETORES.forEach(s => { total += (queues[s] || []).filter(p => p.status === 'aguardando').length; });
  document.getElementById('stat-total').textContent = total;
  const ea = document.getElementById('stat-atendidos'); if (ea) ea.textContent = totalAtendidos;
  const ed = document.getElementById('stat-desist'); if (ed) ed.textContent = totalDesistencias;
  const tc = document.getElementById('stat-card-total');
  if (tc) { if (total >= CAPACITY_LIMITS['Total']) tc.classList.add('capacity-alert'); else tc.classList.remove('capacity-alert'); }
}

function updateBadges() {
  /* === MELHORIA B: BADGES DAS ABAS COM VISIBILIDADE DINÂMICA === */
  SETORES.forEach(setor => {
    const cfg = SECTOR_CONFIG[setor];
    const allItems = (queues[setor] || []).filter(p => p.status === 'aguardando');
    const count = allItems.length;
    // Tab badge always shows total + hide when 0
    const badge = document.getElementById('badge-' + cfg.key);
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'inline-block' : 'none';
      if (count > 0) badge.classList.add('badge-pulse');
      else badge.classList.remove('badge-pulse');
    }
    const cnt = document.getElementById('cnt-' + cfg.key); if (cnt) cnt.textContent = count + ' na fila';
    // Sector screen count shows filtered count
    const filter = sectorFilters[cfg.key] || null;
    const filteredCount = filter ? allItems.filter(p => p.profissional === filter).length : count;
    const cnt2 = document.getElementById('cnt2-' + cfg.key); if (cnt2) cnt2.textContent = filteredCount;
  });

  // Badge do Atendidos
  const attendedBadge = document.getElementById('attended-count');
  if (attendedBadge) {
    const val = parseInt(attendedBadge.textContent) || 0;
    attendedBadge.style.display = val > 0 ? 'inline-block' : 'none';
  }
  /* === FIM MELHORIA B === */
}

function getColor(setor) { return SECTOR_CONFIG[setor]?.color || 'var(--blue)'; }

function renderQueueItems(containerId, setor, filterProfissional) {
  const el = document.getElementById(containerId); if (!el) return;
  let items = (queues[setor] || []).filter(p => p.status !== 'atendido' && p.status !== 'desistencia');
  if (filterProfissional) {
    items = items.filter(p => p.profissional === filterProfissional);
  }
  if (!items.length) { el.innerHTML = '<div class="empty-state"><div class="es-icon">\u2705</div><p>Fila vazia</p></div>'; return; }
  const isSectorQueue = containerId.startsWith('queue-');
  el.innerHTML = items.map((p, i) => {
    const safeNome = p.nome.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const prioBadge = p.prioridade === 'prioritario' ? `<span class="priority-badge">\u2B50 ${p.tipo_prioridade || 'PRIORITÁRIO'}</span>` : '';
    const tipoLabel = p.tipo_atendimento ? `<span style="font-size:11px;color:var(--gray-600);margin-left:4px;">(${p.tipo_atendimento})</span>` : '';
    const profLabel = p.profissional ? `<span style="font-size:11px;color:var(--blue);margin-left:4px;">\uD83D\uDC68\u200D\u2695\uFE0F ${p.profissional}</span>` : '';
    const condBadges = renderCondicoesBadges(p.condicoes_especiais);
    const qrBtn = `<button class="btn-qr" onclick="event.stopPropagation();showQrModalById(${p.id})" title="Ver QR Code">\uD83D\uDCF1</button>`;

    /* === MELHORIA E: Badge de presen\u00e7a === */
    let presencaHtml = '';
    if (isSectorQueue && ['Médico','Enfermagem','Odontologia','Téc. Enfermagem'].includes(setor)) {
      presencaHtml = p.presenca_confirmada
        ? '<span class="presenca-badge presenca-confirmada">\uD83D\uDFE2 PRESENTE</span>'
        : '<span class="presenca-badge presenca-aguardando">\u26AA AGUARDANDO</span>';
    }

    /* === MELHORIA G: Controles Admin (RBAC) === */
    const dragHandle = isAdmin
      ? `<span class="drag-handle" title="Arraste para reordenar">\u2630</span>`
      : '';
    const adminControls = isAdmin ? `
      <div class="queue-item-admin-controls">
        <button class="btn-reorder-arrow" title="Subir uma posi\u00e7\u00e3o"
          onclick="event.stopPropagation();movePatientArrow(${p.id},'${setor}','up')">\u2191</button>
        <button class="btn-reorder-arrow" title="Descer uma posi\u00e7\u00e3o"
          onclick="event.stopPropagation();movePatientArrow(${p.id},'${setor}','down')">\u2193</button>
        <button class="btn-reorder-pos" title="Ir para posi\u00e7\u00e3o espec\u00edfica"
          onclick="event.stopPropagation();openPositionModal(${p.id},'${safeNome}','${setor}')">\uD83D\uDD22</button>
        <button class="btn-transfer-sector" title="Encaminhar para outro setor"
          onclick="event.stopPropagation();openTransferModal(${p.id},'${safeNome}','${setor}')">
          \u2197\uFE0F Enc.
        </button>
        <button class="btn-context-menu" title="Mais op\u00e7\u00f5es"
          onclick="event.stopPropagation();openContextMenu(event,${p.id},'${safeNome}','${setor}')">
          \u22EE
        </button>
      </div>` : '';

    const removeBtn = isAdmin ? `<div style="display:flex;gap:4px;">
      <button class="btn-danger" onclick="event.stopPropagation();removePatient(${p.id},'${safeNome}')" title="Marcar como Desist\u00eancia">\uD83D\uDEB6</button>
      <button class="btn-danger" style="background:rgba(0,0,0,0.1);color:var(--gray-600);" onclick="event.stopPropagation();deletePatientPermanently(${p.id},'${safeNome}')" title="Excluir Permanentemente">\uD83D\uDD25</button>
    </div>` : '';

    return `<div class="queue-item ${p.status==='chamado'?'calling':''}" data-id="${p.id}" data-draggable="${isAdmin}">
      ${dragHandle}
      <div class="queue-position" style="background:${p.status==='chamado'?'#b8860b':getColor(setor)}">${i+1}</div>
      <div class="queue-name">${p.nome}${prioBadge}${tipoLabel}${profLabel}${condBadges} ${presencaHtml}</div>
      <div class="queue-time">${p.horario}</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        ${qrBtn}
        <span class="queue-status ${p.status==='chamado'?'status-calling':'status-waiting'}">${p.status==='chamado'?'\uD83D\uDCE2 Chamando':'Aguardando'}</span>
        ${removeBtn}
      </div>
      ${adminControls}
    </div>`;
  }).join('');

  // Inicializa D&D se for fila de setor e admin ativo
  if (isSectorQueue && isAdmin) {
    initSortable(containerId, setor);
  } else if (_sortableInstances[containerId]) {
    _sortableInstances[containerId].destroy();
    delete _sortableInstances[containerId];
  }
}

function updateQueues() {
  SETORES.forEach(s => {
    const cfg = SECTOR_CONFIG[s];
    const filter = sectorFilters[cfg.key] || null;
    renderQueueItems('queue-' + cfg.key, s, filter);
  });
}

function updateMiniQueues() {
  /* === MELHORIA E: Mini-queues com botão de confirmar presença === */
  SETORES.forEach(s => {
    const cfg = SECTOR_CONFIG[s];
    const el = document.getElementById('mini-queue-' + cfg.key); if (!el) return;
    const items = (queues[s] || []).filter(p => p.status !== 'atendido' && p.status !== 'desistencia');
    if (!items.length) { el.innerHTML = '<div class="empty-state"><div class="es-icon">✅</div><p>Fila vazia</p></div>'; return; }
    el.innerHTML = items.map((p, i) => {
      const prioBadge = p.prioridade === 'prioritario' ? `<span class="priority-badge">⭐ ${p.tipo_prioridade || 'PRIORITÁRIO'}</span>` : '';
      const tipoLabel = p.tipo_atendimento ? `<span style="font-size:11px;color:var(--gray-600);margin-left:4px;">(${p.tipo_atendimento})</span>` : '';
      const profLabel = p.profissional ? `<span style="font-size:11px;color:var(--blue);margin-left:4px;">👨‍⚕️ ${p.profissional}</span>` : '';
      const condBadges = renderCondicoesBadges(p.condicoes_especiais);
      const qrBtn = `<button class="btn-qr" onclick="event.stopPropagation();showQrModalById(${p.id})" title="Ver QR Code">📱</button>`;
      const removeBtn = isAdmin ? `<div style="display:flex;gap:4px;">
        <button class="btn-danger" onclick="event.stopPropagation();removePatient(${p.id},'${p.nome.replace(/'/g,"\\\\'")}')" title="Marcar como Desistência">🚶</button>
        <button class="btn-danger" style="background:rgba(0,0,0,0.1);color:var(--gray-600);" onclick="event.stopPropagation();deletePatientPermanently(${p.id},'${p.nome.replace(/'/g,"\\\\'")}')" title="Excluir Permanentemente">🔥</button>
      </div>` : '';
      // Botão de confirmar presença (apenas na Recepção, setores com profissional)
      let presencaBtn = '';
      if (['Médico','Enfermagem','Odontologia','Téc. Enfermagem'].includes(s) && p.status === 'aguardando') {
        if (p.presenca_confirmada) {
          presencaBtn = '<span class="presenca-badge presenca-confirmada" style="margin-left:4px;">🟢 Presente</span>';
        } else {
          presencaBtn = `<button class="btn-confirmar-presenca" onclick="event.stopPropagation();confirmarPresenca(${p.id},'${p.nome.replace(/'/g,"\\\\'")}')" title="Confirmar presença na recepção">✅ Confirmar Presença</button>`;
        }
      }
      return `<div class="queue-item ${p.status==='chamado'?'calling':''}">
        <div class="queue-position" style="background:${p.status==='chamado'?'#b8860b':getColor(s)}">${i+1}</div>
        <div class="queue-name">${p.nome}${prioBadge}${tipoLabel}${profLabel}${condBadges}</div>
        <div class="queue-time">${p.horario}</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          ${presencaBtn}
          ${qrBtn}
          <span class="queue-status ${p.status==='chamado'?'status-calling':'status-waiting'}">${p.status==='chamado'?'📢 Chamando':'Aguardando'}</span>
          ${removeBtn}
        </div>
      </div>`;
    }).join('');
  });
  /* === FIM MELHORIA E === */
}

function updateRecent() {
  const el = document.getElementById('recent-list');
  const all = []; SETORES.forEach(s => all.push(...(queues[s] || [])));
  if (!all.length) { el.innerHTML = '<div class="empty-state" style="padding:16px;"><div class="es-icon">🗒️</div><p>Nenhum cadastro ainda</p></div>'; return; }
  const sorted = all.sort((a, b) => safeDate(b.created_at) - safeDate(a.created_at)).slice(0, 5);
  el.innerHTML = sorted.map(p => {
    const cfg = SECTOR_CONFIG[p.setor] || {}; const prioBadge = p.prioridade === 'prioritario' ? ' ⭐' : '';
    const profLabel = p.profissional ? ` · ${p.profissional}` : '';
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--gray-100);border-radius:8px;border:1px solid var(--gray-200);">
      <div style="font-size:18px;">${cfg.icon||'📋'}</div>
      <div style="flex:1;"><div style="font-weight:700;font-size:14px;color:var(--gray-700);">${p.nome}${prioBadge}</div><div style="font-size:12px;color:var(--gray-600);">${p.setor}${profLabel} · ${p.horario}</div></div>
    </div>`;
  }).join('');
}

function updateBanners() {
  SETORES.forEach(setor => {
    const cfg = SECTOR_CONFIG[setor];
    const banner = document.getElementById('banner-' + cfg.key);
    const nameEl = document.getElementById('banner-name-' + cfg.key);
    if (banner && nameEl) {
      if (currentCalling[setor]) { banner.classList.add('visible'); nameEl.textContent = currentCalling[setor].nome; }
      else banner.classList.remove('visible');
    }
  });
}

function updatePainel() {
  const main = document.getElementById('painel-main');
  if (callHistory && callHistory.length) {
    const l = callHistory[0]; const cfg = SECTOR_CONFIG[l.setor] || {};
    const prioBadge = l.prioridade === 'prioritario' ? `<div class="priority-badge-tv">⭐ ${l.tipo_prioridade || 'PRIORITÁRIO'}</div>` : '';
    let details = '';
    if (l.consultorio) details += `<div style="font-size:18px;opacity:0.9;margin-top:6px;font-weight:700;">🏠 ${l.consultorio === 'Odontológico' ? 'Consultório Odontológico' : 'Consultório ' + l.consultorio}</div>`;
    if (l.profissional) details += `<div style="font-size:16px;opacity:0.85;margin-top:4px;font-weight:600;">👨‍⚕️ ${l.profissional}</div>`;
    else if (l.medico) details += `<div style="font-size:16px;opacity:0.85;margin-top:4px;font-weight:600;">👨‍⚕️ ${l.medico}</div>`;
    main.innerHTML = `<div class="painel-call-label">🔔 Chamando agora</div><div class="painel-call-name">${l.nome}</div><div class="painel-call-sector">${cfg.icon||'📋'} ${l.setor}${details}</div>${prioBadge}`;
  } else { main.innerHTML = '<div class="painel-empty">⏳ Aguardando chamadas...</div>'; }

  const histEl = document.getElementById('painel-history');
  if (!callHistory || !callHistory.length) { histEl.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:rgba(255,255,255,0.3);padding:24px;">Nenhuma chamada registrada</div>'; return; }
  histEl.innerHTML = callHistory.map((p, i) => {
    const cfg = SECTOR_CONFIG[p.setor] || {};
    const prioBadge = p.prioridade === 'prioritario' ? ' <span style="color:#ff8f00;font-weight:800;">⭐</span>' : '';
    const profDisplay = p.profissional ? ` · <b>${p.profissional}</b>` : p.medico ? ` · <b>${p.medico}</b>` : '';
    const consDisplay = p.consultorio ? ` · Cons. ${p.consultorio}` : '';
    return `<div class="painel-history-item" style="justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:16px;">
        <div class="ph-number">${i+1}</div>
        <div class="ph-info"><div class="ph-name">${p.nome}${prioBadge}</div><div class="ph-sector">${cfg.icon||''} ${p.setor}${profDisplay}${consDisplay}</div></div>
      </div>
      <div style="display:flex;align-items:center;gap:12px;">
        <div class="ph-time">${p.horario_chamada}</div>
        <button class="btn btn-ghost" onclick="speakViaSynthesis('${p.nome.replace(/'/g,"\\\\'")}','${p.setor}','${(p.medico||'').replace(/'/g,"\\\\'")}')" style="padding:6px 12px;font-size:13px;">🔊</button>
      </div>
    </div>`;
  }).join('');
}

// ====== SECTOR ATTENDED HISTORY ======
function renderAllSectorAttended() {
  SETORES.forEach(setor => {
    const cfg = SECTOR_CONFIG[setor];
    const el = document.getElementById('attended-' + cfg.key);
    const cntEl = document.getElementById('cnt-attended-' + cfg.key);
    if (!el) return;

    const filter = sectorFilters[cfg.key] || null;
    let items = (callHistory || []).filter(p => p.setor === setor);
    if (filter) {
      items = items.filter(p => p.profissional === filter);
    }

    if (cntEl) cntEl.textContent = items.length;

    if (!items.length) {
      el.innerHTML = '<div class="empty-state" style="padding:16px;"><div class="es-icon">✅</div><p>Nenhum atendido ainda</p></div>';
      return;
    }

    el.innerHTML = items.map((p, i) => {
      const prioBadge = p.prioridade === 'prioritario' ? `<span class="priority-badge">⭐</span>` : '';
      const prof = p.profissional || '';
      const profLabel = prof ? `<span style="font-size:11px;color:var(--gray-600);"> · ${prof}</span>` : '';
      const qrBtn = `<button class="btn-qr" onclick="event.stopPropagation();showQrModalById(${p.patient_id})" title="Ver QR Code">📱</button>`;
      const delBtn = isAdmin ? `<button class="btn-danger-sm" onclick="event.stopPropagation();deleteHistoryItem(${p.id},'${p.nome.replace(/'/g,"\\\\'")}')" title="Excluir do Histórico">🗑️</button>` : '';
      
      return `<div class="queue-item" style="border-left:4px solid var(--green);">
        <div class="queue-position" style="background:var(--green);">${items.length - i}</div>
        <div class="queue-name">${p.nome}${prioBadge}${profLabel}</div>
        <div class="queue-time">${p.horario_chamada || ''}</div>
        <div style="display:flex;gap:4px;align-items:center;">
          ${qrBtn}
          <span class="queue-status status-done">✅ Atendido</span>
          ${delBtn}
        </div>
      </div>`;
    }).join('');
  });
}

// ====== ATTENDED ======
function renderAttended() {
  const el = document.getElementById('attended-list'); if (!el) return;
  const ce = document.getElementById('attended-count'); if (ce) ce.textContent = attendedPatients.length;
  const cb = document.getElementById('attended-count-big'); if (cb) cb.textContent = attendedPatients.length;
  if (!attendedPatients.length) { el.innerHTML = '<div class="empty-state"><div class="es-icon">✅</div><p>Nenhum paciente atendido ainda</p></div>'; return; }
  el.innerHTML = attendedPatients.map((p, i) => {
    const cfg = SECTOR_CONFIG[p.setor] || {};
    const prioBadge = p.prioridade === 'prioritario' ? `<span class="priority-badge">⭐</span>` : '';
    const prof = p.profissional || p.medico || '';
    const profLabel = prof ? `<span style="font-size:11px;color:var(--gray-600);"> · ${prof}</span>` : '';
    const qrBtn = `<button class="btn-qr" onclick="event.stopPropagation();showQrModalById(${p.patient_id})" title="Ver QR Code">📱</button>`;
    const delBtn = isAdmin ? `<button class="btn-danger-sm" onclick="event.stopPropagation();deleteHistoryItem(${p.id},'${p.nome.replace(/'/g,"\\\\'")}')" title="Excluir do Histórico">🗑️</button>` : '';

    return `<div class="queue-item" style="border-left:4px solid var(--green);">
      <div class="queue-position" style="background:var(--green);">${attendedPatients.length - i}</div>
      <div class="queue-name">${p.nome}${prioBadge}${profLabel}</div>
      <span class="sector-tag ${cfg.tagClass||''}">${cfg.icon||''} ${p.setor}</span>
      <div class="queue-time" style="margin-left:auto;">${p.horario_chamada || p.horario}</div>
      <div style="display:flex;gap:4px;align-items:center;">
          ${qrBtn}
          <span class="queue-status status-done">✅ Atendido</span>
          ${delBtn}
      </div>
    </div>`;
  }).join('');
}

async function showQrModalById(patientId) {
  try {
    const r = await fetch(`${API_URL}/patients/${patientId}/status`);
    if (!r.ok) throw new Error();
    const data = await r.json();
    showQrModal(data.patient);
  } catch { showToast('Erro ao carregar QR Code!', true); }
}

async function deleteHistoryItem(id, nome) {
  const senha = prompt(`🗑️ Excluir "${nome}" do histórico permanentemente?\n\nDigite a senha administrativa:`);
  if (!senha) return;
  try {
    const r = await fetch(`${API_URL}/history/${id}/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha }) });
    if (r.status === 403) { showToast('❌ Senha incorreta!', true); return; }
    if (!r.ok) throw new Error();
    showToast(`🗑️ Registro de ${nome} excluído`);
    loadHistory(); loadAttended();
  } catch { showToast('Erro ao excluir registro!', true); }
}

async function applyFilters() {
  const data = document.getElementById('filter-data').value;
  const setor = document.getElementById('filter-setor').value;
  const prof = document.getElementById('filter-profissional').value;
  if (!data && !setor && !prof) { loadAttended(); return; }
  try {
    const params = new URLSearchParams(); if (data) params.set('data', data); if (setor) params.set('setor', setor); if (prof) params.set('profissional', prof);
    const r = await fetch(`${API_URL}/history/filtered?${params}`);
    attendedPatients = await r.json(); renderAttended();
  } catch { showToast('Erro ao filtrar', true); }
}

// ====== CHAT AVANÇADO COM CANAIS ======
const CANAIS = [
  { id:'geral', nome:'📢 Geral', desc:'Todos os setores' },
  { id:'acolhimento', nome:'💜 Acolhimento', desc:'Canal do Acolhimento' },
  { id:'farmacia', nome:'💊 Farmácia', desc:'Canal da Farmácia' },
  { id:'regulacao', nome:'📋 Regulação', desc:'Canal da Regulação' },
  { id:'medico', nome:'🩺 Médico', desc:'Canal Médico' },
  { id:'enfermagem', nome:'👩‍⚕️ Enfermagem', desc:'Canal da Enfermagem' },
  { id:'odontologia', nome:'🦷 Odontologia', desc:'Canal da Odontologia' },
  { id:'gerencia', nome:'🏛️ Gerência', desc:'Canal da Gerência' }
];
let activeCanal = 'geral';
let channelMessages = {};
let channelUnread = {};
let chatUrgent = false;
let typingTimeout = null;
CANAIS.forEach(c => { channelMessages[c.id] = []; channelUnread[c.id] = 0; });

// Restore saved setor
const savedSetor = localStorage.getItem('chatSetor');
if (savedSetor) { setTimeout(() => { const sel = document.getElementById('chat-remetente'); if (sel) sel.value = savedSetor; }, 100); }

function onChatSetorChange() {
  const v = document.getElementById('chat-remetente').value;
  localStorage.setItem('chatSetor', v);
  // Auto-switch to general on sector change to ensure a valid canal is active
  switchCanal('geral');
}

function getVisibleCanais() {
  const setor = document.getElementById('chat-remetente')?.value || 'Recepção';
  if (setor === 'Gerência') return CANAIS;
  const setorKey = setor.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z]/g,'');
  return CANAIS.filter(c => c.id === 'geral' || c.id === 'gerencia' || c.id === setorKey);
}

/* === MELHORIA C: PRESENÇA E PREVIEW NO CHAT === */
let chatPresencaMap = {};
let chatPinsMap = {};

async function loadChatPresenca() {
  try {
    const r = await fetch(`${API_URL}/chat/presenca`);
    chatPresencaMap = await r.json();
  } catch(e) {}
}

function registerPresenca() {
  const setor = document.getElementById('chat-remetente')?.value || 'Recepção';
  fetch(`${API_URL}/chat/presenca`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({setor}) }).catch(()=>{});
}

function getPresenceDot(canalId) {
  // Map canal ID to setor name for presence lookup
  const canalToSetor = { geral:null, acolhimento:'Acolhimento', farmacia:'Farmácia', regulacao:'Regulação', medico:'Médico', enfermagem:'Enfermagem', odontologia:'Odontologia', gerencia:'Gerência' };
  const setorName = canalToSetor[canalId];
  if (!setorName) return ''; // 'geral' has no specific setor
  const lastSeen = chatPresencaMap[setorName];
  if (!lastSeen) return '<span class="chat-presence-dot offline"></span>';
  const ago = Date.now() - new Date(lastSeen).getTime();
  const isOnline = ago < 5 * 60 * 1000; // 5 minutos
  return `<span class="chat-presence-dot ${isOnline ? 'online' : 'offline'}"></span>`;
}

function getLastMessagePreview(canalId) {
  const msgs = channelMessages[canalId];
  if (!msgs || !msgs.length) return '<div class="chat-canal-preview">Nenhuma mensagem ainda</div>';
  const last = msgs[msgs.length - 1];
  const txt = last.texto.length > 32 ? last.texto.substring(0, 32) + '...' : last.texto;
  const time = safeDate(last.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
  return `<div class="chat-canal-preview">"${txt}"  ${time}</div>`;
}

function markCanalAsRead(canalId) {
  localStorage.setItem('chatLastRead_' + canalId, Date.now().toString());
  channelUnread[canalId] = 0;
  const setor = document.getElementById('chat-remetente')?.value || 'Recepção';
  fetch(`${API_URL}/chat/read`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({canal:canalId,setor}) }).catch(()=>{});
}

function bipChat() {
  if (!audioUnlocked) return; // Only bip if sound is unlocked
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch(e) {}
}
/* === FIM MELHORIA C: PRESENÇA E PREVIEW === */

function renderCanalList() {
  const el = document.getElementById('chat-canal-list'); if (!el) return;
  const visible = getVisibleCanais();
  el.innerHTML = visible.map(c => {
    const unread = channelUnread[c.id] || 0;
    const badge = unread > 0 ? `<span class="chat-canal-badge">${unread}</span>` : '';
    /* === MELHORIA C: Presença + Preview === */
    const presenceDot = getPresenceDot(c.id);
    const preview = getLastMessagePreview(c.id);
    /* === FIM MELHORIA C === */
    return `<button class="chat-canal-btn ${c.id===activeCanal?'active':''}" onclick="switchCanal('${c.id}')">${presenceDot}${c.nome}${badge}${preview}</button>`;
  }).join('');
}

function switchCanal(canalId) {
  // Marcar canal anterior como lido antes de trocar
  if (activeCanal && activeCanal !== canalId) {
    markCanalAsRead(activeCanal);
  }

  activeCanal = canalId;

  // Atualizar título e subtítulo do canal
  const canalInfo = CANAIS.find(c => c.id === canalId);
  if (canalInfo) {
    document.getElementById('chat-canal-title').textContent = canalInfo.nome.replace(/^\S+\s/, ''); // remove emoji
    document.getElementById('chat-canal-sub').textContent = canalInfo.desc;
  } else {
    document.getElementById('chat-canal-title').textContent = 'Chat da Unidade';
    document.getElementById('chat-canal-sub').textContent = 'Todos os setores e profissionais';
  }

  // Carregar mensagens do canal se ainda não estiverem em memória
  if (!channelMessages[canalId] || channelMessages[canalId].length === 0) {
    loadChannelMessages(canalId).then(() => {
      renderChannelChat();
      markCanalAsRead(canalId);
      updateChatBadge();
      renderCanalList();
    });
  } else {
    renderChannelChat();
    markCanalAsRead(canalId);
    updateChatBadge();
    renderCanalList();
  }

  // Scroll para o final das mensagens
  setTimeout(() => {
    const c = document.getElementById('chat-messages');
    if (c) c.scrollTop = c.scrollHeight;
  }, 50);

  // Carregar pin do novo canal
  loadChatPin(canalId);
}

async function loadChannelMessages(canalId) {
  try { 
    const r = await fetch(`${API_URL}/chat/canais/${canalId}`); 
    const newMsgs = await r.json();
    
    const oldMsgs = channelMessages[canalId];
    if (oldMsgs && newMsgs.length > 0) {
      const oldLast = oldMsgs.length > 0 ? oldMsgs[oldMsgs.length - 1] : null;
      const newLast = newMsgs[newMsgs.length - 1];
      
      // Se houver uma nova mensagem
      if (!oldLast || newLast.id > oldLast.id) {
        const meuSetor = document.getElementById('chat-remetente')?.value || '';
        const meuNome = document.getElementById('chat-remetente-nome')?.value.trim() || '';
        const meuIdentificador = meuNome ? `${meuNome} (${meuSetor})` : meuSetor;
        
        // Só toca o som se a mensagem não foi enviada por mim
        if (newLast.autor !== meuIdentificador && newLast.autor !== meuSetor) {
          playChatSound();
        }
      }
    }
    
    channelMessages[canalId] = newMsgs; 
  } catch(e) { console.error(e); }
}

async function loadAllChannels() {
  for (const c of getVisibleCanais()) { await loadChannelMessages(c.id); }
  renderChannelChat();
  // Load unread counts
  const setor = document.getElementById('chat-remetente')?.value || 'Recepção';
  try { const r = await fetch(`${API_URL}/chat/unread/${encodeURIComponent(setor)}`); const d = await r.json(); Object.keys(d).forEach(k => { channelUnread[k] = d[k]; }); } catch(e){}
  renderCanalList();
  updateChatBadge();
}

function renderChannelChat() {
  const c = document.getElementById('chat-messages'); if (!c) return;
  const msgs = channelMessages[activeCanal] || [];
  const meuSetor = document.getElementById('chat-remetente')?.value || '';
  const meuNome = document.getElementById('chat-remetente-nome')?.value.trim() || '';
  const meuIdentificador = meuNome ? `${meuNome} (${meuSetor})` : meuSetor;
  
  if (!msgs.length) { c.innerHTML = '<div class="empty-state" style="margin:auto;"><div class="es-icon">💬</div><p>Nenhuma mensagem</p></div>'; return; }
  c.innerHTML = msgs.map(m => {
    const t = safeDate(m.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    const isMe = m.autor === meuIdentificador || m.autor === meuSetor;
    const urgClass = m.urgente ? ' bubble-urgent bubble-urgent-anim' : '';
    const urgTag = m.urgente ? '<span style="color:var(--red);font-weight:800;">🚨 URGENTE</span> ' : '';
    
    let anexoHtml = '';
    if (m.anexo_base64 && m.anexo_nome) {
      const isImg = m.anexo_nome.match(/\.(jpeg|jpg|png|gif)$/i);
      if (isImg) {
        anexoHtml = `<div style="margin-top:8px;"><img src="${m.anexo_base64}" style="max-width:100%; max-height:200px; border-radius:8px; cursor:pointer;" onclick="window.open('${m.anexo_base64}', '_blank')"></div>`;
      } else {
        anexoHtml = `<div style="margin-top:8px; background:rgba(0,0,0,0.05); padding:8px; border-radius:6px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <span style="font-size:12px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:200px;">📎 ${m.anexo_nome}</span>
          <a href="${m.anexo_base64}" download="${m.anexo_nome}" class="btn btn-sm btn-primary" style="padding:4px 8px; font-size:11px;">Baixar</a>
        </div>`;
      }
    }

    const pinBtn = `<button class="pin-btn" onclick="event.stopPropagation();pinChatMessage('${m.texto.replace(/'/g,"\\\\'")}','${m.autor}')" title="Fixar mensagem">📌</button>`;
    
    // Se não tiver texto, não renderiza a div de texto vazia
    const textHtml = m.texto ? `<div>${m.texto}</div>` : '';

    return `<div class="chat-bubble ${isMe?'bubble-sent':'bubble-received'}${urgClass}">${pinBtn}<div class="chat-meta"><span>${urgTag}${m.autor}</span></div>${textHtml}${anexoHtml}<div class="chat-time">${t}</div></div>`;
  }).join('');
  c.scrollTop = c.scrollHeight;
}

let chatAttachment = null;

function removeChatAttachment() {
  chatAttachment = null;
  document.getElementById('chat-file-input').value = '';
  document.getElementById('chat-file-preview').style.display = 'none';
  document.getElementById('chat-file-name').textContent = '';
}

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('chat-file-input');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) { // 2MB limite
        showToast('O arquivo deve ter no máximo 2MB.', true);
        fileInput.value = '';
        return;
      }
      
      const reader = new FileReader();
      reader.onload = (ev) => {
        chatAttachment = {
          nome: file.name,
          base64: ev.target.result
        };
        document.getElementById('chat-file-name').textContent = '📎 ' + file.name;
        document.getElementById('chat-file-preview').style.display = 'flex';
      };
      reader.readAsDataURL(file);
    });
  }
});

async function sendChatChannelMessage() {
  const setor = document.getElementById('chat-remetente')?.value || 'Equipe';
  const nome = document.getElementById('chat-remetente-nome')?.value.trim() || '';
  const autor = nome ? `${nome} (${setor})` : setor;
  
  const inp = document.getElementById('chat-input');
  const texto = inp.value.trim();
  
  if (!texto && !chatAttachment) return;
  if (!activeCanal) { activeCanal = 'geral'; }
  
  try {
    inp.disabled = true;
    const payload = { 
      autor, 
      texto, 
      urgente: chatUrgent 
    };
    if (chatAttachment) {
      payload.anexo_nome = chatAttachment.nome;
      payload.anexo_base64 = chatAttachment.base64;
    }

    const r = await fetch(`${API_URL}/chat/canais/${activeCanal}`, { 
      method:'POST', 
      headers:{'Content-Type':'application/json'}, 
      body:JSON.stringify(payload) 
    });
    if (r.ok) { 
      const msg = await r.json();
      inp.value = ''; 
      chatUrgent = false; 
      document.getElementById('chat-urgent-btn').classList.remove('active');
      removeChatAttachment(); // Limpar anexo após envio
      
      // Injeta a mensagem localmente para feedback instantâneo (contorna limitações do Vercel Serverless)
      if (!channelMessages[activeCanal]) channelMessages[activeCanal] = [];
      if (!channelMessages[activeCanal].some(m => m.id === msg.id)) {
        channelMessages[activeCanal].push(msg);
      }
      renderChannelChat();
      setTimeout(() => { const c = document.getElementById('chat-messages'); if (c) c.scrollTop = c.scrollHeight; }, 50);
    }
    else {
      const err = await r.json();
      showToast(`Erro: ${err.error || 'Falha ao enviar'}`, true);
    }
  } catch (e) { 
    console.error('Chat send error:', e);
    showToast('Erro de conexão com o chat!', true); 
  }
  finally { inp.disabled = false; inp.focus(); }
}

function handleChatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatChannelMessage(); }
}

function handleChatTyping() {
  // Auto-resize textarea
  const ta = document.getElementById('chat-input');
  ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
}

function toggleUrgent() {
  chatUrgent = !chatUrgent;
  document.getElementById('chat-urgent-btn').classList.toggle('active', chatUrgent);
}

function toggleEmojiPicker() {
  const picker = document.getElementById('emoji-picker');
  picker.classList.toggle('show');
  if (picker.classList.contains('show') && !picker.innerHTML) {
    const emojis = ['😊','👍','👋','⚠️','✅','❌','🔴','📋','💊','🩺','❤️','🙏','👀','🎉','😂','🤔'];
    picker.innerHTML = emojis.map(e => `<button onclick="insertEmoji('${e}')">${e}</button>`).join('');
  }
}

function insertEmoji(emoji) {
  const inp = document.getElementById('chat-input');
  inp.value += emoji; inp.focus();
  document.getElementById('emoji-picker').classList.remove('show');
}

async function clearChatCanal() {
  const senha = prompt('Limpar canal? Digite a senha administrativa:');
  if (!senha) return;
  try {
    const r = await fetch(`${API_URL}/chat/canais/${activeCanal}/clear`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({senha}) });
    if (r.status === 403) { showToast('Senha incorreta!', true); return; }
    if (r.ok) { channelMessages[activeCanal] = []; renderChannelChat(); showToast('Canal limpo!'); }
  } catch { showToast('Erro!', true); }
}

function updateChatBadge() {
  const b = document.getElementById('badge-chat');
  const total = Object.values(channelUnread).reduce((s,v) => s+v, 0);
  if (b) {
    if (total > 0) { b.textContent = total; b.style.display = 'inline-block'; b.classList.add('badge-pulse'); }
    else { b.style.display = 'none'; b.classList.remove('badge-pulse'); }
  }
}

/* === MELHORIA C: PIN FUNCTIONS === */
async function loadChatPin(canalId) {
  try {
    const r = await fetch(`${API_URL}/chat/canais/${canalId}/pin`);
    const pin = await r.json();
    chatPinsMap[canalId] = pin;
    renderChatPin(pin);
  } catch(e) {}
}

function renderChatPin(pin) {
  const banner = document.getElementById('chat-pin-banner');
  const textEl = document.getElementById('chat-pin-text');
  if (!banner || !textEl) return;
  if (pin && pin.texto) {
    textEl.innerHTML = `<b>[Mensagem fixada]</b> — "${pin.texto}" · fixado por ${pin.autor}`;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

async function pinChatMessage(texto, autor) {
  try {
    await fetch(`${API_URL}/chat/canais/${activeCanal}/pin`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ texto, autor })
    });
    showToast('📌 Mensagem fixada!');
    loadChatPin(activeCanal);
  } catch(e) { showToast('Erro ao fixar mensagem', true); }
}

async function removeChatPin() {
  try {
    await fetch(`${API_URL}/chat/canais/${activeCanal}/pin`, { method: 'DELETE' });
    showToast('📌 Pin removido');
    loadChatPin(activeCanal);
  } catch(e) { showToast('Erro ao remover pin', true); }
}
/* === FIM MELHORIA C: PIN === */

// Desktop notifications
function requestNotifPermission() { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); }
function sendDesktopNotif(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') { new Notification(title, { body, icon:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><text y="32" font-size="32">🏥</text></svg>' }); }
}
requestNotifPermission();

// Legacy chat kept for inactivity alerts
async function loadChat() { /* noop – using channels now */ }
function renderChat() { renderChannelChat(); }
async function sendChatMessage() { await sendChatChannelMessage(); }

// ====== INACTIVITY CHECK ======
// 🤖 Mensagens automáticas desativadas a pedido do cliente

// ====== AGENDAMENTOS ======
const WA_TEMPLATES = {
  lembrete: `https://raw.githubusercontent.com/Fernandorpjr/fila-usf-chico-mendes/main/public/img/confirmacao.jpg\n\nLembrete de Consulta – USF Chico Mendes 🏥\n\n👤 Paciente: [NOME]\n📅 Data: [DATA]\n⏰ Horário: [HORARIO] – Atendimento por ordem de chegada\n👨‍⚕️ Profissional: [PROFISSIONAL]\n📍 Local: Unidade de Saúde da Família Chico Mendes\n\n📋 Orientações importantes:\n* Leve documentos pessoais e cartão do SUS\n\n💬 Em caso de dúvidas, fale com seu agente de saúde.\nEstamos aqui para cuidar de você. 💙`,
  confirmacao: `https://raw.githubusercontent.com/Fernandorpjr/fila-usf-chico-mendes/main/public/img/confirmacao.jpg\n\nConfirmação de Consulta – USF Chico Mendes 🏥\n\n👤 Paciente: [NOME]\n📅 Data: [DATA]\n⏰ Horário: [HORARIO] – Atendimento por ordem de chegada\n👨‍⚕️ Profissional: [PROFISSIONAL]\n📍 Local: Unidade de Saúde da Família Chico Mendes\n\n📋 Orientações importantes:\n* Leve documentos pessoais e cartão do SUS\n\n💬 Em caso de dúvidas, fale com seu agente de saúde.\nEstamos aqui para cuidar de você. 💙`,
  reagendamento: `Olá [NOME]! 🔄\n\nInformamos que sua consulta na *USF Chico Mendes* foi *REAGENDADA*:\n\n📅 Nova data: [DATA]\n⏰ Novo horário: [HORARIO]\n👨‍⚕️ [PROFISSIONAL]\n\n[OBS]\n\nPedimos desculpas pelo inconveniente.\n*USF Chico Mendes* 🏥`,
  preparo_exames: `Lembrete de Coleta – USF Chico Mendes\n\nOlá, [NOME]!\n📅 Data da coleta: [DATA]\n⏰ Horário: [HORARIO]\n👨‍⚕️ Responsável: [PROFISSIONAL]\n\n📋 Checklist dos seus exames:\n[EXAMES]\n\n📍 Local: Unidade de Saúde da Família Chico Mendes\n💬 Em caso de dúvidas, fale com seu agente de saúde. 💙`
};

const EXAMES_CHECKLIST = [
  '🩸 Sangue — Jejum de 8 horas obrigatório',
  '🧪 Urina — 1º jato da manhã, frasco estéril',
  '💩 Fezes — Frasco estéril,',
  '🔬 CUC'
];

function toggleChecklistExames() {
  const tpl = document.getElementById('agend-template').value;
  const grupo = document.getElementById('checklist-exames-grupo');
  const container = document.getElementById('checklist-exames');
  if (tpl === 'preparo_exames') {
    grupo.style.display = 'flex';
    if (!container.innerHTML) {
      container.innerHTML = EXAMES_CHECKLIST.map(e => `<label style="display:flex;align-items:center;gap:4px;padding:4px 10px;background:var(--gray-100);border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;"><input type="checkbox" value="${e}" style="cursor:pointer;"> ${e}</label>`).join('');
    }
  } else { grupo.style.display = 'none'; }
}

function buildWaMessage(agend) {
  const tpl = WA_TEMPLATES[agend.template] || WA_TEMPLATES.lembrete;
  const dataIsoDate = (agend.data_agendamento || '').split('T')[0];
  const dataFmt = dataIsoDate ? new Date(dataIsoDate + 'T12:00:00').toLocaleDateString('pt-BR') : '';
  let exames = '';
  if (agend.checklist_exames) {
    try { const arr = JSON.parse(agend.checklist_exames); exames = arr.map(e => `* ${e}`).join('\n'); } catch(e) { exames = agend.checklist_exames; }
  }
  return tpl.replace(/\[NOME\]/g, agend.nome).replace(/\[DATA\]/g, dataFmt).replace(/\[HORARIO\]/g, agend.horario)
    .replace(/\[PROFISSIONAL\]/g, agend.profissional||'A definir').replace(/\[TIPO\]/g, agend.tipo_atendimento||'Consulta')
    .replace(/\[OBS\]/g, agend.observacoes ? `📝 Obs: ${agend.observacoes}` : '').replace(/\[EXAMES\]/g, exames||'Consulte a unidade');
}

function handleAgendTipoChange() {
  const tipo = document.getElementById('agend-tipo').value;
  const data = document.getElementById('agend-data').value;
  const profSelect = document.getElementById('agend-profissional');
  
  if (tipo === 'Coleta de Sangue' && data) {
    const d = new Date(data + 'T12:00:00');
    const day = d.getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
    let targetProf = '';
    if (day === 3) targetProf = 'Viviane';
    else if (day === 4) targetProf = 'Vilma';
    else if (day === 5) targetProf = 'Fernando';
    
    if (targetProf) {
      // Garantir que a opção existe no select
      if (![...profSelect.options].some(o => o.value === targetProf)) {
        const opt = document.createElement('option');
        opt.value = targetProf;
        opt.text = targetProf;
        profSelect.add(opt);
      }
      profSelect.value = targetProf;
    }
  }
}

async function loadColetasStats() {
  const dashboardContent = document.getElementById('coleta-dashboard-content');
  if (!dashboardContent) return;
  const data = document.getElementById('agend-filter-data')?.value || new Date().toISOString().split('T')[0];
  try {
    const r = await fetch(`${API_URL}/agendamentos/coletas/stats?data=${data}`);
    const stats = await r.json();
    let pendente = 0, realizado = 0, faltou = 0;
    stats.forEach(s => {
      if (s.status === 'pendente' || s.status === 'lembrete_enviado' || s.status === 'confirmado') pendente += parseInt(s.count);
      else if (s.status === 'realizado') realizado += parseInt(s.count);
      else if (s.status === 'faltou') faltou += parseInt(s.count);
    });
    const totalAgendados = pendente + realizado + faltou;
    
    const d = new Date(data + 'T12:00:00');
    const day = d.getDay();
    let prof = 'Não há coleta hoje';
    if (day === 3) prof = 'Viviane (Quarta)';
    else if (day === 4) prof = 'Vilma (Quinta)';
    else if (day === 5) prof = 'Fernando (Sexta)';
    
    dashboardContent.innerHTML = `
      <div style="background:var(--gray-100);padding:12px;border-radius:8px;flex:1;min-width:180px;">
        <div style="font-size:11px;color:var(--gray-600);text-transform:uppercase;font-weight:800;">Téc. do Dia</div>
        <div style="font-size:16px;font-weight:800;color:var(--blue-dark);">${prof}</div>
      </div>
      <div style="background:rgba(26,79,196,0.05);padding:12px;border-radius:8px;flex:1;min-width:120px;">
        <div style="font-size:11px;color:var(--gray-600);text-transform:uppercase;font-weight:800;">Agendados</div>
        <div style="font-size:22px;font-weight:900;color:var(--blue);">${totalAgendados} <span style="font-size:12px;color:var(--gray-600);">/ 12</span></div>
      </div>
      <div style="background:rgba(74,171,60,0.1);padding:12px;border-radius:8px;flex:1;min-width:120px;">
        <div style="font-size:11px;color:var(--green);text-transform:uppercase;font-weight:800;">Realizados ✅</div>
        <div style="font-size:22px;font-weight:900;color:var(--green);">${realizado}</div>
      </div>
      <div style="background:rgba(244,67,54,0.1);padding:12px;border-radius:8px;flex:1;min-width:120px;">
        <div style="font-size:11px;color:var(--red);text-transform:uppercase;font-weight:800;">Faltas ❌</div>
        <div style="font-size:22px;font-weight:900;color:var(--red);">${faltou}</div>
      </div>
    `;
  } catch (e) {
    console.error('Erro ao carregar stats de coleta', e);
  }
}

async function criarAgendamento() {
  const nome = document.getElementById('agend-nome').value.trim();
  const telefone = document.getElementById('agend-telefone').value.trim().replace(/\D/g,'');
  const data_agendamento = document.getElementById('agend-data').value;
  const horario = document.getElementById('agend-horario').value.trim();
  const profissional = document.getElementById('agend-profissional').value;
  const tipo_atendimento = document.getElementById('agend-tipo').value;
  const template = document.getElementById('agend-template').value;
  const observacoes = document.getElementById('agend-obs').value.trim();
  let checklist_exames = null;
  if (template === 'preparo_exames') {
    const checked = [...document.querySelectorAll('#checklist-exames input:checked')].map(c => c.value);
    if (checked.length) checklist_exames = JSON.stringify(checked);
  }
  if (!nome) { showToast('⚠️ Preencha o nome do paciente!', true); return; }
  if (!telefone || telefone.length < 10) { showToast('⚠️ Telefone inválido! Use o formato +55 XX 99999-9999', true); return; }
  if (!data_agendamento) { showToast('⚠️ Selecione a data do agendamento!', true); return; }
  if (!horario || !/^\d{2}:\d{2}$/.test(horario)) { showToast('⚠️ Horário inválido! Use o formato HH:MM (ex: 08:30)', true); return; }
  
  // Validar se data não é no passado (exceto coletas que podem ser retroativas)
  const hoje = new Date().toISOString().split('T')[0];
  if (data_agendamento < hoje && tipo_atendimento !== 'Coleta de Sangue') {
    if (!confirm(`⚠️ A data selecionada (${new Date(data_agendamento + 'T12:00:00').toLocaleDateString('pt-BR')}) é anterior a hoje. Deseja continuar mesmo assim?`)) return;
  }
  
  if (tipo_atendimento === 'Coleta de Sangue') {
    try {
      const r = await fetch(`${API_URL}/agendamentos/coletas/stats?data=${data_agendamento}`);
      const stats = await r.json();
      let total = 0;
      stats.forEach(s => {
        if (s.status !== 'cancelado') total += parseInt(s.count);
      });
      if (total >= 12) {
        if (!confirm(`⚠️ Já existem ${total} coletas agendadas para este dia (limite recomendado: 12).\nDeseja realizar um encaixe extra?`)) {
          return;
        }
      }
    } catch(e) {}
  }

  try {
    const r = await fetch(`${API_URL}/agendamentos`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({nome,telefone,data_agendamento,horario,profissional,tipo_atendimento,template,observacoes,checklist_exames}) });
    if (!r.ok) throw new Error();
    showToast(`✅ Agendamento criado com sucesso para ${nome}!`);
    document.getElementById('agend-nome').value=''; document.getElementById('agend-telefone').value='+55 ';
    document.getElementById('agend-obs').value='';
    // Reset border styles
    ['agend-nome','agend-telefone','agend-data','agend-horario'].forEach(id => {
      const el = document.getElementById(id); if (el) el.style.borderColor = '';
    });
    loadAgendamentos();
  } catch { showToast('❌ Erro ao agendar! Verifique sua conexão.', true); }
}

async function loadAgendamentos() {
  const data = document.getElementById('agend-filter-data')?.value || '';
  const status = document.getElementById('agend-filter-status')?.value || '';
  const params = new URLSearchParams(); if (data) params.set('data',data); if (status) params.set('status',status);
  try {
    const r = await fetch(`${API_URL}/agendamentos?${params}`);
    const list = await r.json();
    renderAgendamentos(list);
    loadColetasStats();
  } catch { showToast('Erro ao carregar agendamentos', true); }
}

function renderAgendamentos(list) {
  const tbody = document.getElementById('agend-tbody'); if (!tbody) return;
  if (!list.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--gray-600);">Nenhum agendamento</td></tr>'; return; }
  tbody.innerHTML = list.map(a => {
    const dataIsoDate = (a.data_agendamento || '').split('T')[0];
    const dataFmt = dataIsoDate ? new Date(dataIsoDate + 'T12:00:00').toLocaleDateString('pt-BR') : '';
    const statusCls = a.status.replace(/\s+/g,'_');
    
    let extraBtns = '';
    if (a.tipo_atendimento === 'Coleta de Sangue' && ['pendente', 'lembrete_enviado', 'confirmado'].includes(a.status)) {
      extraBtns = `
        <button onclick="updateAgendStatus(${a.id},'realizado')" title="Compareceu (Realizado)" style="background:var(--green);color:white;padding:2px 6px;font-size:11px;">✅ Compareceu</button>
        <button onclick="updateAgendStatus(${a.id},'faltou')" title="Faltou" style="background:var(--red);color:white;padding:2px 6px;font-size:11px;">❌ Faltou</button>
      `;
    }

    return `<tr>
      <td>
        <b>${a.nome}</b><br>
        <span style="font-size:11px;color:var(--gray-600);">${a.telefone}</span><br>
        <span style="font-size:10px;background:var(--gray-200);padding:2px 6px;border-radius:4px;font-weight:700;display:inline-block;margin-top:4px;">${a.tipo_atendimento||'Consulta'}</span>
      </td>
      <td>${dataFmt}</td><td>${a.horario}</td><td>${a.profissional||'-'}</td>
      <td><span class="agend-status ${statusCls}">${a.status}</span></td>
      <td><div class="agend-actions" style="display:flex;gap:4px;flex-wrap:wrap;">
        ${extraBtns}
        <button onclick="openWaPreview(${a.id})" title="WhatsApp">📲</button>
        <button onclick="updateAgendStatus(${a.id},'lembrete_enviado')" title="Marcar lembrete">📨</button>
        <button onclick="updateAgendStatus(${a.id},'confirmado')" title="Confirmado">✅</button>
        <button onclick="abrirEdicaoAgendamento(${a.id}, '${a.nome.replace(/'/g,"\\'").trim()}', '${a.telefone.replace(/'/g,"\\'").trim()}')" title="Editar Contato">✏️</button>
        <button onclick="updateAgendStatus(${a.id},'cancelado')" title="Cancelar">❌</button>
        <button onclick="deleteAgendamento(${a.id})" title="Apagar Registro do Banco" style="color:var(--red);">🗑️</button>
      </div></td></tr>`;
  }).join('');
}

async function updateAgendStatus(id, status) {
  try {
    await fetch(`${API_URL}/agendamentos/${id}/status`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status}) });
    showToast('Status atualizado!'); loadAgendamentos();
  } catch { showToast('Erro!', true); }
}

async function deleteAgendamento(id) {
  const senha = prompt('🗑️ Excluir Agendamento Permanentemente?\n\nDigite a senha administrativa:');
  if (!senha) return;
  try {
    const r = await fetch(`${API_URL}/agendamentos/${id}/delete`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({senha}) });
    if (r.status === 403) { showToast('❌ Senha incorreta!', true); return; }
    if (!r.ok) { showToast('Erro ou agendamento não encontrado!', true); return; }
    showToast('Agendamento apagado com sucesso!');
    loadAgendamentos();
  } catch { showToast('Erro de conexão ao tentar apagar!', true); }
}

async function openWaPreview(id) {
  try {
    const r = await fetch(`${API_URL}/agendamentos`);
    const list = await r.json();
    const agend = list.find(a => a.id === id);
    if (!agend) return;
    const msg = buildWaMessage(agend);
    document.getElementById('wa-preview-text').textContent = msg;
    const phone = agend.telefone.replace(/\D/g,'');
    document.getElementById('wa-send-link').href = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
    document.getElementById('wa-modal').classList.add('show');
  } catch { showToast('Erro!', true); }
}

function closeWaModal() { document.getElementById('wa-modal').classList.remove('show'); }

// Edição de Contato do Agendamento
function abrirEdicaoAgendamento(id, nome, telefone) {
  document.getElementById('edit-agend-id').value = id;
  document.getElementById('edit-agend-nome').value = nome;
  document.getElementById('edit-agend-telefone').value = telefone;
  document.getElementById('agend-edit-modal').classList.add('show');
}

function closeAgendEditModal() {
  document.getElementById('agend-edit-modal').classList.remove('show');
}

async function salvarEdicaoAgendamento() {
  const id = document.getElementById('edit-agend-id').value;
  const nome = document.getElementById('edit-agend-nome').value.trim();
  const telefone = document.getElementById('edit-agend-telefone').value.trim();
  if (!nome || !telefone) { showToast('Preencha nome e telefone!', true); return; }
  
  try {
    const r = await fetch(`${API_URL}/agendamentos/${id}/edit`, { 
      method: 'PUT', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ nome, telefone }) 
    });
    if (!r.ok) throw new Error();
    showToast('✅ Contato atualizado com sucesso!');
    closeAgendEditModal();
    loadAgendamentos();
  } catch {
    showToast('Erro ao atualizar contato!', true);
  }
}

// ====== PDF ======
function generatePDF() {
  if (!attendedPatients.length) { showToast('Não há pacientes para exportar.', true); return; }
  if (!window.jspdf || !window.jspdf.jsPDF) { showToast('Carregando biblioteca PDF...', true); return; }
  const { jsPDF } = window.jspdf; const doc = new jsPDF('l'); // Landscape
  doc.setFont('helvetica','bold'); doc.setFontSize(18); doc.text('Relatório de Atendimentos', 148, 15, { align: 'center' });
  doc.setFontSize(11); doc.setFont('helvetica','normal'); doc.text(`USF Chico Mendes | Data: ${new Date().toLocaleDateString('pt-BR')}`, 148, 22, { align: 'center' });
  const data = attendedPatients.map((p, i) => {
    let condLabel = '-';
    try { const arr = JSON.parse(p.condicoes_especiais||'[]'); condLabel = arr.map(c => c==='hipertenso'?'HAS':c==='diabetico'?'DM':c==='gestante'?'GEST':c).join(', ') || '-'; } catch {}
    const risco = p.gravidade_final || p.risco_clinico || '-';
    const agend = p.agendamento_realizado ? 'Sim' : 'Não';
    return [attendedPatients.length - i, p.nome, p.cpf || '-', p.setor, safeDate(p.created_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}), p.queixa || '-', risco, p.profissional || p.medico || '-', agend, condLabel];
  });
  doc.autoTable({ startY: 30, head: [['Nº','Nome','CPF/SUS','Setor','Data/Hora','Queixa','Risco','Profissional','Agendado?','Condições']], body: data, theme: 'grid', headStyles: { fillColor: [26,79,196], fontSize: 8 }, bodyStyles: { fontSize: 8 }, alternateRowStyles: { fillColor: [240,244,255] }, columnStyles: { 0:{cellWidth:10}, 1:{cellWidth:35}, 4:{cellWidth:28}, 5:{cellWidth:40} } });
  const ds = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date()).replace(/\//g, '-');
  doc.save(`atendimentos_${ds}.pdf`); showToast('✅ PDF gerado com sucesso!');
}

// ====== RESET ======
async function resetData() {
  const senha = prompt('⚠️ RESETAR FILA DIÁRIA\n\nIsso limpará a fila ativa.\n\nDigite a senha administrativa:');
  if (!senha) return;
  try {
    const r = await fetch(`${API_URL}/reset`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({senha}) });
    if (r.status === 403) { showToast('❌ Senha incorreta!', true); return; }
    if (!r.ok) throw new Error();
    showToast('✅ Fila zerada com sucesso!');
    setTimeout(() => window.location.reload(), 1500);
  } catch { showToast('❌ Erro ao resetar!', true); }
}

// ====== TOAST ======
function showToast(msg, error = false, duration = 3000) {
  const t = document.getElementById('toast'); document.getElementById('toast-msg').textContent = msg;
  t.classList.toggle('error', error); t.classList.add('show'); setTimeout(() => t.classList.remove('show'), duration);
}

// ====== ACOLHIMENTO WORKFLOW ======
let acolhimentoFluxo = { recepcao: [], primeira_escuta: [], segunda_escuta: [] };
let acolhimentoFilter = 'todos';
let selectedRisco = 'verde';

async function loadAcolhimentoFluxo() {
  try {
    const [rFluxo, rStat] = await Promise.all([
      fetch(`${API_URL}/acolhimento/fluxo`),
      fetch(`${API_URL}/acolhimento/relatorio`)
    ]);
    acolhimentoFluxo = await rFluxo.json();
    renderAcolhimentoFluxo();
    
    if (rStat.ok) {
      const stats = await rStat.json();
      const elAtendidos = document.getElementById('acol-stat-atendidos');
      if (elAtendidos) {
        elAtendidos.textContent = (stats.totalResult && stats.totalResult.length) ? stats.totalResult[0].total_finalizados : 0;
      }
    }
  } catch (e) { console.error('Acolhimento fluxo error:', e); }
}

function renderAcolhimentoFluxo() {
  const etapas = ['recepcao', 'primeira_escuta', 'segunda_escuta'];
  etapas.forEach(etapa => {
    let pacientes = acolhimentoFluxo[etapa] || [];
    // Apply filter
    if (acolhimentoFilter !== 'todos' && acolhimentoFilter !== 'minha_fila') {
      if (acolhimentoFilter !== etapa) pacientes = [];
    }
    if (acolhimentoFilter === 'minha_fila') {
      const prof = document.getElementById('acol-minha-fila-prof')?.value;
      if (prof) pacientes = pacientes.filter(p => p.profissional_destino === prof);
      else pacientes = [];
    }
    const cntEl = document.getElementById('acol-cnt-' + etapa);
    if (cntEl) cntEl.textContent = (acolhimentoFluxo[etapa] || []).length;
    renderAcolhimentoEtapa(etapa, pacientes);
  });
  // Show/hide columns based on filter
  etapas.forEach(etapa => {
    const col = document.getElementById('acol-col-' + etapa);
    if (!col) return;
    if (acolhimentoFilter === 'todos' || acolhimentoFilter === 'minha_fila' || acolhimentoFilter === etapa) {
      col.style.display = '';
    } else {
      col.style.display = 'none';
    }
  });
  // Badge and Stats
  const totalAcol = (acolhimentoFluxo.recepcao?.length || 0) + (acolhimentoFluxo.primeira_escuta?.length || 0) + (acolhimentoFluxo.segunda_escuta?.length || 0);
  const badge = document.getElementById('badge-acolhimento');
  if (badge) badge.textContent = totalAcol;
  const statAtivos = document.getElementById('acol-stat-ativos');
  if (statAtivos) statAtivos.textContent = totalAcol;
}

function renderAcolhimentoEtapa(etapa, pacientes) {
  const el = document.getElementById('acol-list-' + etapa);
  if (!el) return;
  if (!pacientes.length) {
    el.innerHTML = '<div style="text-align:center;padding:24px;color:rgba(255,255,255,0.3);font-size:13px;font-weight:600;">Nenhum paciente</div>';
    return;
  }
  el.innerHTML = pacientes.map(p => {
    const prioBadge = p.prioridade === 'prioritario' ? `<span class="priority-badge">⭐ ${p.tipo_prioridade || 'PRIO'}</span>` : '';
    const riscoBadge = p.risco_clinico && p.risco_clinico !== 'verde' ? `<span class="acol-risco-badge ${p.risco_clinico}">${p.risco_clinico === 'vermelho' ? '🔴 ALTO' : p.risco_clinico === 'amarelo' ? '🟡 MODERADO' : p.risco_clinico === 'azul' ? '🟦 SEM RISCO' : ''}</span>` : '';
    const condBadges = renderCondicoesBadges(p.condicoes_especiais);
    const tempoMin = p.inicio_etapa ? Math.round((Date.now() - new Date(p.inicio_etapa).getTime()) / 60000) : Math.round((Date.now() - new Date(p.created_at).getTime()) / 60000);
    const tempoBadge = `<span class="acol-tempo-badge">⏱ ${tempoMin} min</span>`;
    const acsLabel = p.acs_responsavel ? `<span style="font-size:11px;">👤 ACS: ${p.acs_responsavel}</span>` : '';
    const profLabel = p.profissional_destino ? `<span style="font-size:11px;">👨‍⚕️ ${p.profissional_destino}</span>` : '';
    const queixaEl = p.queixa ? `<div class="acol-card-queixa">"${p.queixa}"</div>` : '';
    const nomeSafe = p.nome.replace(/'/g, "\\'");

    let actions = '';
    if (etapa === 'recepcao') {
      actions = `<button class="acol-btn-action acol-btn-iniciar" onclick="iniciarEscuta(${p.id},'${nomeSafe}')">🟡 Iniciar 1ª Escuta</button>`;
    } else if (etapa === 'primeira_escuta') {
      actions = `<button class="acol-btn-action acol-btn-encaminhar" onclick="abrirModalEncaminhar(${p.id},'${nomeSafe}')">🔴 Encaminhar</button>`;
    } else if (etapa === 'segunda_escuta') {
      actions = `<button class="acol-btn-action acol-btn-finalizar" onclick="finalizarAtendimento(${p.id},'${nomeSafe}')">✅ Finalizar</button>`;
    }
    // Admin: remove/delete buttons
    const adminBtns = isAdmin ? `
      <button class="btn-danger" style="font-size:11px;padding:4px 8px;" onclick="event.stopPropagation();removePatient(${p.id},'${nomeSafe}')" title="Desistência">🚶</button>
      <button class="btn-danger" style="font-size:11px;padding:4px 8px;background:rgba(0,0,0,0.1);color:var(--gray-600);" onclick="event.stopPropagation();deletePatientPermanently(${p.id},'${nomeSafe}')" title="Excluir">🔥</button>
    ` : '';

    return `<div class="acol-card etapa-${etapa}">
      <div class="acol-card-name">${p.nome}${prioBadge}${riscoBadge}${condBadges}</div>
      <div class="acol-card-meta">
        <span>🕐 ${p.horario}</span>
        ${tempoBadge}
        ${acsLabel}
        ${profLabel}
      </div>
      ${queixaEl}
      <div class="acol-card-actions">
        ${actions}
        ${adminBtns}
      </div>
    </div>`;
  }).join('');
}

function filtrarAcolhimento(filtro) {
  acolhimentoFilter = filtro;
  document.querySelectorAll('#acol-filter-bar .btn-filter').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.acolFilter === filtro);
  });
  const profSelect = document.getElementById('acol-minha-fila-prof');
  if (profSelect) profSelect.style.display = filtro === 'minha_fila' ? 'inline-block' : 'none';
  renderAcolhimentoFluxo();
}

function iniciarEscuta(id, nome) {
  document.getElementById('acol-acs-patient-id').value = id;
  document.getElementById('acol-acs-patient-info').textContent = `👤 ${nome}`;
  const acsSelect = document.getElementById('acol-acs-select');
  if (acsSelect) acsSelect.value = '';
  document.getElementById('acol-acs-modal').classList.add('show');
}

async function confirmarIniciarEscuta() {
  const id = document.getElementById('acol-acs-patient-id').value;
  const nome = document.getElementById('acol-acs-patient-info').textContent.replace('👤 ', '');
  const acs = document.getElementById('acol-acs-select').value;
  if (!acs) { showToast('Selecione o ACS responsável!', true); return; }
  
  try {
    const r = await fetch(`${API_URL}/acolhimento/${id}/iniciar-escuta`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acs_responsavel: acs })
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
    document.getElementById('acol-acs-modal').classList.remove('show');
    showToast(`🟡 1ª Escuta iniciada para ${nome} (ACS: ${acs})`);
    loadAcolhimentoFluxo();
  } catch (e) { showToast(e.message || 'Erro ao iniciar escuta', true); }
}

function abrirModalEncaminhar(id, nome) {
  document.getElementById('acol-modal-id').value = id;
  document.getElementById('acol-modal-patient-info').textContent = `👤 ${nome}`;
  document.getElementById('acol-modal-queixa').value = '';
  document.getElementById('acol-modal-cpf').value = '';
  document.getElementById('acol-modal-sus').value = '';
  selectRisco('verde');
  document.getElementById('acol-modal-tipo-prof').value = '';
  document.getElementById('acol-modal-tipo-prof').value = '';
  document.getElementById('acol-modal-prof-dest').innerHTML = '<option value="">— Opcional —</option>';
  // Pre-fill condições from patient data
  const patient = acolhimentoFluxo.primeira_escuta?.find(p => p.id == id);
  setCondicoesCheckboxes('condicoes-especiais-escuta1', patient?.condicoes_especiais);
  document.getElementById('acol-escuta-modal').classList.add('show');
}

async function chamarNoPainel(source) {
  const prefix = source === 'escuta1' ? 'acol-modal' : 'acol-escuta2';
  const inputId = document.getElementById(`${prefix}-id`);
  const infoEl = document.getElementById(`${prefix}-patient-info`);
  if (!inputId || !inputId.value) { 
    console.error('Campo ID não encontrado ou vazio:', `${prefix}-id`);
    showToast('Erro: Paciente não identificado', true); 
    return; 
  }
  
  const id = inputId.value;
  const nome = infoEl ? infoEl.textContent.replace('👤 ', '') : 'Paciente';
  
  // Determinar destino para a voz
  let destino = 'Acolhimento';
  if (source === 'escuta1') {
    destino = '1ª Escuta do Acolhimento';
  } else {
    // 2ª Escuta – tenta pegar profissional destino
    const profEl = document.getElementById('acol-escuta2-patient-info');
    const patient = acolhimentoFluxo.segunda_escuta?.find(p => p.id == id);
    destino = patient?.profissional_destino ? `${patient.profissional_destino}` : '2ª Escuta do Acolhimento';
  }
  
  try {
    const r = await fetch(`${API_URL}/acolhimento/${id}/chamar`, { method: 'POST' });
    if (!r.ok) throw new Error();
    showToast(`🔊 Chamando ${nome} no painel...`);
    // Chamar em voz alta diretamente no navegador
    speakViaSynthesis(nome, 'Acolhimento', destino);
  } catch (e) { showToast('Erro ao chamar no painel', true); }
}

function fecharEscutaModal() {
  document.getElementById('acol-escuta-modal').classList.remove('show');
}

function selectRisco(risco) {
  selectedRisco = risco;
  document.querySelectorAll('#acol-risco-chooser .acol-risco-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.risco === risco);
  });
}

function updateAcolProfDest() {
  const tipo = document.getElementById('acol-modal-tipo-prof').value;
  const sel = document.getElementById('acol-modal-prof-dest');
  sel.innerHTML = '<option value="">— Opcional —</option>';
  if (tipo && SECTOR_CONFIG) {
    const sectorKey = tipo === 'medico' ? 'Médico' : tipo === 'enfermagem' ? 'Enfermagem' : 'Odontologia';
    const cfg = SECTOR_CONFIG[sectorKey];
    if (cfg && cfg.profissionais) {
      cfg.profissionais.forEach(p => {
        sel.innerHTML += `<option value="${p}">${p}</option>`;
      });
    }
  }
}

async function confirmarEncaminhamento() {
  const id = document.getElementById('acol-modal-id').value;
  const queixa = document.getElementById('acol-modal-queixa').value.trim();
  const cpf = document.getElementById('acol-modal-cpf').value.trim();
  const cartao_sus = document.getElementById('acol-modal-sus').value.trim();
  const profissional_destino = document.getElementById('acol-modal-prof-dest').value || null;
  const tipo_profissional_destino = document.getElementById('acol-modal-tipo-prof').value || null;
  const condicoes_especiais = getCondicoesFromContainer('condicoes-especiais-escuta1');
  if (!queixa) { showToast('Preencha a queixa!', true); return; }
  try {
    const r = await fetch(`${API_URL}/acolhimento/${id}/encaminhar`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queixa, risco_clinico: selectedRisco, profissional_destino, tipo_profissional_destino, cpf, cartao_sus, condicoes_especiais })
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
    fecharEscutaModal();
    const riscoLabel = selectedRisco === 'vermelho' ? '🔴 RISCO ALTO' : selectedRisco === 'amarelo' ? '🟡 RISCO MODERADO' : selectedRisco === 'azul' ? '🟦 SEM RISCO' : '🟢 BAIXO';
    showToast(`📤 Paciente encaminhado para 2ª Escuta (${riscoLabel})`);
    loadAcolhimentoFluxo();
  } catch (e) { showToast(e.message || 'Erro ao encaminhar', true); }
}

async function finalizarEscuta1() {
  const id = document.getElementById('acol-modal-id').value;
  const queixa = document.getElementById('acol-modal-queixa').value.trim();
  const cpf = document.getElementById('acol-modal-cpf').value.trim();
  const cartao_sus = document.getElementById('acol-modal-sus').value.trim();
  const condicoes_especiais = getCondicoesFromContainer('condicoes-especiais-escuta1');
  
  try {
    const r = await fetch(`${API_URL}/acolhimento/${id}/finalizar-escuta1`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queixa, cpf, cartao_sus, condicoes_especiais })
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
    fecharEscutaModal();
    showToast(`✅ Atendimento finalizado na 1ª Escuta`);
    loadAcolhimentoFluxo();
    loadHistory(); loadAttended();
  } catch (e) { showToast(e.message || 'Erro ao finalizar', true); }
}

async function agendarEscuta1() {
  const id = document.getElementById('acol-modal-id').value;
  const queixa = document.getElementById('acol-modal-queixa').value.trim();
  const cpf = document.getElementById('acol-modal-cpf').value.trim();
  const cartao_sus = document.getElementById('acol-modal-sus').value.trim();
  const condicoes_especiais = getCondicoesFromContainer('condicoes-especiais-escuta1');
  const nome = document.getElementById('acol-modal-patient-info').textContent.replace('👤 ', '');

  try {
    const r = await fetch(`${API_URL}/acolhimento/${id}/finalizar-escuta1`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queixa, cpf, cartao_sus, agendamento_realizado: true, condicoes_especiais })
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
    fecharEscutaModal();
    showToast(`📅 Paciente finalizado para agendamento!`);
    loadAcolhimentoFluxo(); loadHistory(); loadAttended();
    
    showScreen('agendamentos');
    const nomeInput = document.getElementById('agend-nome');
    if(nomeInput) { nomeInput.value = nome; nomeInput.focus(); }
  } catch (e) { showToast(e.message || 'Erro ao agendar/finalizar', true); }
}

function finalizarAtendimento(id, nome) {
  const idNum = Number(id);
  const patient = acolhimentoFluxo.segunda_escuta?.find(p => p.id == idNum);
  document.getElementById('acol-escuta2-id').value = id;
  document.getElementById('acol-escuta2-patient-info').textContent = `👤 ${nome}`;
  
  // Pre-fill fields for editing
  document.getElementById('acol-escuta2-queixa').value = patient?.queixa || '';
  document.getElementById('acol-escuta2-cpf').value = patient?.cpf || '';
  document.getElementById('acol-escuta2-sus').value = patient?.cartao_sus || '';
  setCondicoesCheckboxes('condicoes-especiais-escuta2', patient?.condicoes_especiais);
  
  selectGravidade('verde');
  document.querySelector('input[name="acol-escuta2-agend"][value="false"]').checked = true;
  document.getElementById('acol-escuta2-modal').classList.add('show');
}



let selectedGravidade = 'verde';
function selectGravidade(gravidade) {
  selectedGravidade = gravidade;
  document.querySelectorAll('#acol-gravidade-chooser .acol-risco-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.gravidade === gravidade);
  });
}

async function confirmarFinalizacaoEscuta2() {
  const id = document.getElementById('acol-escuta2-id').value;
  const agendamento = document.querySelector('input[name="acol-escuta2-agend"]:checked').value === 'true';
  const queixa = document.getElementById('acol-escuta2-queixa').value.trim();
  const cpf = document.getElementById('acol-escuta2-cpf').value.trim();
  const cartao_sus = document.getElementById('acol-escuta2-sus').value.trim();
  const condicoes_especiais = getCondicoesFromContainer('condicoes-especiais-escuta2');
  const nome = document.getElementById('acol-escuta2-patient-info').textContent.replace('👤 ', '');
  
  try {
    const r = await fetch(`${API_URL}/acolhimento/${id}/finalizar`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        gravidade_final: selectedGravidade, 
        agendamento_realizado: agendamento,
        queixa, cpf, cartao_sus, condicoes_especiais
      })
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
    document.getElementById('acol-escuta2-modal').classList.remove('show');
    showToast(`✅ Atendimento de ${nome} finalizado!`);
    loadAcolhimentoFluxo();
    loadHistory(); loadAttended();
  } catch (e) { showToast(e.message || 'Erro ao finalizar', true); }
}

let lastAcolhimentoReportData = null;

async function gerarRelatorioAcolhimento() {
  try {
    const r = await fetch(`${API_URL}/acolhimento/relatorio`);
    const data = await r.json();
    lastAcolhimentoReportData = data;
    
    const el = document.getElementById('acol-relatorio-content');
    const avgRec = data.tempoMedio?.avg_recepcao_min ? Math.round(data.tempoMedio.avg_recepcao_min) : '—';
    const avgEsc = data.tempoMedio?.avg_escuta_min ? Math.round(data.tempoMedio.avg_escuta_min) : '—';
    let riscoHtml = '';
    if (data.riscoCor && data.riscoCor.length) {
      riscoHtml = data.riscoCor.map(r => {
        const emoji = r.risco_clinico === 'vermelho' ? '🔴' : r.risco_clinico === 'amarelo' ? '🟡' : r.risco_clinico === 'azul' ? '🟦' : '🟢';
        return `${emoji} ${r.risco_clinico}: <b>${r.total}</b>`;
      }).join(' · ');
    }
    let acsHtml = '<div style="color:var(--gray-600);">Nenhum ACS registrado</div>';
    if (data.porAcs && data.porAcs.length) {
      acsHtml = data.porAcs.map(a => `<div>👤 ${a.acs_responsavel}: <b>${a.total}</b> pacientes</div>`).join('');
    }
    let profHtml = '<div style="color:var(--gray-600);">Nenhum encaminhamento</div>';
    if (data.porProf && data.porProf.length) {
      profHtml = data.porProf.map(p => `<div>👨‍⚕️ ${p.profissional_destino} (${p.tipo_profissional_destino || '—'}): <b>${p.total}</b></div>`).join('');
    }

    // Ativos por etapa
    let ativosHtml = '';
    if (data.ativos && data.ativos.length) {
      const etapas = {};
      data.ativos.forEach(a => {
        if (!etapas[a.etapa_fluxo]) etapas[a.etapa_fluxo] = 0;
        etapas[a.etapa_fluxo] += parseInt(a.total);
      });
      const labels = { recepcao: '🟢 Recep.', primeira_escuta: '🟡 1ª Esc.', segunda_escuta: '🔴 2ª Esc.' };
      ativosHtml = Object.entries(etapas).map(([k, v]) => `${labels[k] || k}: <b>${v}</b>`).join(' · ');
    }

    // Tabela detalhada de finalizados
    let finalizadosHtml = '<div style="color:var(--gray-600);text-align:center;padding:12px;">Nenhum finalizado hoje</div>';
    let countEscuta1 = 0;
    let countEscuta2 = 0;

    if (data.finalizados && data.finalizados.length) {
      data.finalizados.forEach(f => {
        if (f.gravidade_final) countEscuta2++;
        else countEscuta1++;
      });

      finalizadosHtml = `
        <table style="width:100%;font-size:12px;border-collapse:collapse;text-align:left;">
          <thead><tr style="border-bottom:2px solid var(--gray-200);background:var(--gray-100);"><th style="padding:8px;">Paciente</th><th style="padding:8px;">Risco</th><th style="padding:8px;">ACS</th><th style="padding:8px;">Profissional (2ª)</th><th style="padding:8px;">Hora</th><th style="padding:8px;">Agend.</th><th style="padding:8px;">Condições</th></tr></thead>
          <tbody>
            ${data.finalizados.map(f => {
              const riscoLabel = f.gravidade_final === 'vermelho' ? '🔴 Vermelho' : f.gravidade_final === 'amarelo' ? '🟡 Amarelo' : f.gravidade_final === 'verde' ? '🟢 Verde' : f.gravidade_final === 'azul' ? '🟦 Azul' : '—';
              let condLabel = '';
              try { const arr = JSON.parse(f.condicoes_especiais||'[]'); condLabel = arr.map(c => c==='hipertenso'?'💙 HAS':c==='diabetico'?'🧡 DM':c==='gestante'?'💜 GEST':c).join(', '); } catch {}
              const agendLabel = f.agendamento_realizado ? '✅ Sim' : '—';
              return `<tr style="border-bottom:1px solid #efefef;">
                <td style="padding:8px;"><b>${f.nome}</b><br><span style="font-size:10px;color:var(--gray-600);">CPF: ${f.cpf||'-'}</span></td>
                <td style="padding:8px;">${riscoLabel}</td>
                <td style="padding:8px;">${f.acs_responsavel||'—'}</td>
                <td style="padding:8px;">${f.profissional||'—'}</td>
                <td style="padding:8px;">${f.horario_chamada || '-'}</td>
                <td style="padding:8px;">${agendLabel}</td>
                <td style="padding:8px;font-size:11px;">${condLabel||'—'}</td>
              </tr>`}).join('')}
          </tbody>
        </table>
      `;
    }

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
        <div style="background:var(--gray-100);padding:16px;border-radius:12px;text-align:center;">
          <div style="font-size:28px;font-weight:900;color:var(--green);">${data.totalFinalizados}</div>
          <div style="font-size:12px;font-weight:700;color:var(--gray-600);text-transform:uppercase;">Finalizados Hoje</div>
        </div>
        <div style="background:var(--gray-100);padding:16px;border-radius:12px;text-align:center;">
          <div style="font-size:18px;font-weight:900;color:var(--blue-dark);">${countEscuta1} 1ª Esc. / ${countEscuta2} 2ª Esc.</div>
          <div style="font-size:12px;font-weight:700;color:var(--gray-600);text-transform:uppercase;">Fluxo de Equipe</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
        <div style="background:rgba(26,79,196,0.05);padding:12px;border-radius:12px;font-size:13px;"><b>Ativos agora:</b> ${ativosHtml || '0'}</div>
        <div style="background:rgba(142,36,170,0.05);padding:12px;border-radius:12px;font-size:13px;"><b>Tempos Médios:</b> ${avgRec}m recip. / ${avgEsc}m esc.</div>
      </div>
      <div style="border-top:2px solid var(--gray-200);padding-top:16px;">
        <h4 style="margin-bottom:12px;color:var(--blue-dark);display:flex;justify-content:space-between;">📋 Detalhamento dos Atendimentos</h4>
        <div style="max-height:250px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:8px;">${finalizadosHtml}</div>
      </div>
    `;
    document.getElementById('acol-relatorio-modal').classList.add('show');
  } catch (e) { showToast('Erro ao gerar relatório', true); console.error(e); }
}

function exportarRelatorioAcolhimentoPDF() {
  if (!window.jspdf || !window.jspdf.jsPDF) { showToast('Carregando biblioteca PDF...', true); return; }
  if (!lastAcolhimentoReportData) { showToast('Carregue o relatório primeiro!', true); return; }
  
  const d = lastAcolhimentoReportData;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('l'); // Landscape
  
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Relatório de Acolhimento Diário', 148, 15, { align: 'center' });
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(`USF Chico Mendes | ${new Date().toLocaleDateString('pt-BR')}`, 148, 22, { align: 'center' });
  
  doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.text('Resumo Diário', 14, 32);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  doc.text(`Total Finalizados: ${d.totalFinalizados}`, 14, 39);
  
  const avgRec = d.tempoMedio?.avg_recepcao_min ? Math.round(d.tempoMedio.avg_recepcao_min) : '-';
  const avgEsc = d.tempoMedio?.avg_escuta_min ? Math.round(d.tempoMedio.avg_escuta_min) : '-';
  doc.text(`Tempo Médio (Recepção / Escuta): ${avgRec} / ${avgEsc} min`, 14, 45);
  
  const finalizadosData = (d.finalizados || []).map(f => {
    let condLabel = '-';
    try { const arr = JSON.parse(f.condicoes_especiais||'[]'); condLabel = arr.map(c => c==='hipertenso'?'HAS':c==='diabetico'?'DM':c==='gestante'?'GEST':c).join(', ') || '-'; } catch {}
    const risco = f.gravidade_final ? f.gravidade_final.toUpperCase() : '1ª ESCUTA';
    const agend = f.agendamento_realizado ? 'Sim' : 'Não';
    return [f.nome, f.cpf || '-', f.queixa || '-', risco, f.acs_responsavel || '-', f.profissional || '-', f.horario_chamada || '-', agend, condLabel];
  });

  doc.autoTable({
    startY: 52,
    head: [['Paciente', 'CPF/SUS', 'Queixa', 'Risco', 'ACS', 'Profissional', 'Horário', 'Agendado?', 'Condições']],
    body: finalizadosData,
    theme: 'grid',
    headStyles: { fillColor: [142,36,170], fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [248,240,255] },
    columnStyles: { 2:{cellWidth:45} }
  });

  doc.save(`acolhimento_relatorio_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.pdf`);
  showToast('✅ PDF do Acolhimento gerado com sucesso!');
}

// ====== AUXILIARES DE AGENDAMENTO (Melhorias) ======
function mascaraHorario(input) {
  let v = input.value.replace(/\D/g, '');
  if (v.length >= 3) v = v.slice(0, 2) + ':' + v.slice(2, 4);
  input.value = v;
  // Feedback visual de formato
  if (/^\d{2}:\d{2}$/.test(input.value)) {
    const [h, m] = input.value.split(':').map(Number);
    input.style.borderColor = (h >= 0 && h <= 23 && m >= 0 && m <= 59) ? 'var(--green)' : 'var(--red)';
  } else {
    input.style.borderColor = input.value.length > 4 ? 'var(--red)' : '';
  }
}

function validarCampoAgend(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.borderColor = el.value.trim().length > 1 ? 'var(--green)' : 'var(--red)';
}

function validarDataAgend() {
  const el = document.getElementById('agend-data');
  if (!el || !el.value) return;
  const hoje = new Date().toISOString().split('T')[0];
  el.style.borderColor = el.value >= hoje ? 'var(--green)' : '#f4821e';
}



// ====== INIT ======
initSectorScreens();
initOverview();
renderCanalList();
loadQueues(); loadCurrentCalling(); loadHistory(); loadAttended(); loadAllChannels();
loadAcolhimentoFluxo();

// Connection status indicator
let socketConnected = false;
(function addSocketIndicator() {
  const hr = document.querySelector('.header-right');
  if (hr) {
    const dot = document.createElement('div');
    dot.id = 'socket-status-dot';
    dot.title = 'Conectado via API Polling (Vercel)';
    dot.style.cssText = 'width:10px;height:10px;border-radius:50%;background:#4aab3c;flex-shrink:0;';
    hr.insertBefore(dot, hr.firstChild);
  }
})();

// ====== ADAPTATIVE POLLING (Page Visibility) ======
let pollingTimer1 = null;
let pollingTimer2 = null;

// isDentroDoHorario() definida no bloco MELHORIA F (topo do arquivo)
// com fuso America/Recife, Segunda–Sexta, 06h–18h

function startPolling1() {
  if (pollingTimer1) clearTimeout(pollingTimer1);
  // ZERO polling fora do expediente OU em pausa — inclui modo TV (?modo=tv)
  if (isPausado || !isDentroDoHorario()) return;
  const interval1 = document.hidden ? 30000 : 5000;
  pollingTimer1 = setTimeout(() => { loopData1(); }, interval1);
}

function startPolling2() {
  if (pollingTimer2) clearTimeout(pollingTimer2);
  // ZERO polling fora do expediente OU em pausa
  if (isPausado || !isDentroDoHorario()) return;
  const interval2 = document.hidden ? 60000 : 8000;
  pollingTimer2 = setTimeout(() => { loopData2(); }, interval2);
}

function startAdaptivePolling() {
  startPolling1();
  startPolling2();
}

async function loopData1() {
  await Promise.all([
    loadQueues(), loadCurrentCalling(), loadHistory(), loadAttended(), loadAcolhimentoFluxo(), loadNotificacoes()
  ].map(p => p.catch(() => {})));
  startPolling1();
}

async function loopData2() {
  await loadAllChannels().catch(() => {});
  startPolling2();
}

startAdaptivePolling();
document.addEventListener('visibilitychange', startAdaptivePolling);

/* Eventos Socket.IO removidos para economia na Vercel */

setTimeout(() => {
  // Only show sound modal if past the gate
  if (sessionStorage.getItem('usf_gate_auth') === 'true' || new URLSearchParams(window.location.search).get('modo') === 'tv') {
    document.getElementById('sound-modal').style.display = 'flex';
  }
}, 600);

/* === MELHORIA C: Presença periódica === */
intervalChat = setInterval(() => {
  const at = document.querySelector('.nav-tab.active');
  if (at && at.id === 'tab-chat') registerPresenca();
  loadChatPresenca().then(() => renderCanalList());
}, 30000); // A cada 30s
loadChatPresenca();
// Load initial pin for active canal
setTimeout(() => loadChatPin(activeCanal), 1000);
/* === FIM MELHORIA C === */

function initAgendamentoDefaults() {
  const dataInput = document.getElementById('agend-data');
  if (dataInput && !dataInput.value) {
    const today = new Date();
    dataInput.value = today.toISOString().split('T')[0];
  }
  const filterInput = document.getElementById('agend-filter-data');
  if (filterInput && !filterInput.value) {
    const today = new Date();
    filterInput.value = today.toISOString().split('T')[0];
  }
}

// Inicializar preenchimento de agendamento na primeira tela
initAgendamentoDefaults();
intervalAgend = setInterval(() => {
  if (document.getElementById('screen-agendamentos')?.classList.contains('active')) {
    initAgendamentoDefaults();
  }
}, 5000);

// --- MELHORIA F: verificação inicial de expediente (após todos os intervalos estarem criados) ---
checkExpediente();

async function copyWaImageToClipboard() {
  try {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = async function() {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(async (blob) => {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob })
          ]);
          showToast("🖼️ Imagem copiada! Cole (Ctrl+V) no WhatsApp.");
        } catch(e) { showToast("Erro ao copiar imagem: " + e.message, true); }
      }, "image/png");
    };
    img.src = "/img/confirmacao.jpg";
  } catch (err) {
    showToast("Erro: " + err.message, true);
  }
}
