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
    // O clique em "Entrar" já é um gesto do usuário: desbloqueia o áudio imediatamente!
    if (typeof unlockAudio === 'function') {
      unlockAudio(true);
    }
    if (typeof registrarAcessoDispositivo === 'function') {
      registrarAcessoDispositivo('gate_login');
    }
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
  const now = new Date();
  const { day, hour } = getDayAndHourRecife(now);

  // === EXCEÇÃO TEMPORÁRIA: Mutirão Chico Mendes — Sábado ===
  const dateStrRecife = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Recife',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
  const DATAS_MUTIRAO = ['2026-09-26', '2026-11-07', '2026-04-11', '2026-11-14', '2026-04-18']; // Sábados liberados para mutirão
  if (DATAS_MUTIRAO.includes(dateStrRecife)) {
    // No mutirão, só bloqueia fora do horário (06h–18h)
    if (hour < 6 || hour >= 18) return false;
    return true;
  }
  // === FIM EXCEÇÃO TEMPORÁRIA ===

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
      if (chatPanelOpen) registerPresenca();
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
    if (typeof ensureAudioContextResumed === 'function') ensureAudioContextResumed();
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
    if (!isValidAdminPass(senha)) { showToast('❌ Senha incorreta!', true); return; }
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
    profissionais: ['Dr. Israel Christian', 'Dr. Joene Halan', 'Dra. Mirela Mota'], defaultConsultorios: ['1','2','3'] },
  'Enfermagem': { icon: '👩‍⚕️', color: 'var(--teal)', colorDark: 'var(--teal-dark)', btnClass: 'btn-teal', tagClass: 'tag-enfermagem', key: 'enfermagem',
    profissionais: ['Mariana Vaz', 'Jorge Marcio', 'Lucelia de Abreu'], defaultConsultorios: ['4','5','6'] },
  'Odontologia': { icon: '🦷', color: 'var(--pink)', colorDark: 'var(--pink-dark)', btnClass: 'btn-pink', tagClass: 'tag-odontologia', key: 'odontologia',
    profissionais: ['Dra. Juliana Cavalcante'], defaultConsultorios: ['Odontológico'] },
  'Téc. Enfermagem': { icon: '🩹', color: '#0097a7', colorDark: '#006064', btnClass: 'btn-teal', tagClass: 'tag-enfermagem', key: 'tec_enfermagem',
    profissionais: ['Viviane', 'Vilma', 'Fernando'], defaultConsultorios: ['Sala de Procedimentos'] }
};

// Structure of forwarding permissions per user sector profile
const PERMISSOES_ENCAMINHAMENTO = {
  'Médico': null, // null = can forward to all sectors
  'Enfermagem': null,
  'Segunda Escuta': null,
  'Acolhimento': null,
  'Recepção': null,
  'Odontologia': null,
  'Téc. Enfermagem': null,
  'Regulação': ['Farmácia', 'Sala de Agendamento'],
  'Farmácia': ['Regulação', 'Sala de Agendamento']
};

// ====== STATE ======
let queues = {}; SETORES.forEach(s => queues[s] = []);
let currentCalling = {}; SETORES.forEach(s => currentCalling[s] = null);
let callHistory = [], attendedPatients = [], totalAtendidos = 0, totalDesistencias = 0;
let lastSpokenCallId = null, chatMessages = [], unreadChatCount = 0;
let isAdmin = false, adminPassword = null, alertedPatients = new Set();
const VALID_ADMIN_PASSWORDS = ['chico123', '0177', 'usf2026'];
function isValidAdminPass(pwd) {
  return VALID_ADMIN_PASSWORDS.includes(String(pwd || '').trim());
}
try {
  const _savedAdmin = sessionStorage.getItem('usf_admin_pwd');
  if (_savedAdmin && isValidAdminPass(_savedAdmin)) {
    isAdmin = true;
    adminPassword = _savedAdmin;
  }
} catch (e) {}
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

    // Filter buttons for Médico, Enfermagem and Téc. Enfermagem (with "Todos" option + individual professionals)
    let filterHTML = '';
    if (cfg.profissionais && setor !== 'Odontologia') {
      const firstProf = cfg.profissionais[0];
      const allBtn = `<button class="btn-filter" data-prof="" onclick="filterSector('${cfg.key}','')">📋 Todos</button>`;
      const btns = cfg.profissionais.map((p, idx) =>
        `<button class="btn-filter${idx === 0 ? ' active' : ''}" data-prof="${p}" onclick="filterSector('${cfg.key}','${p}')">${p}</button>`
      ).join('');
      filterHTML = `
        <div style="margin-bottom:20px;">
          <label style="font-size:13px;font-weight:700;color:var(--gray-600);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;display:block;">Selecione seu Profissional</label>
          <div class="filter-bar" id="filter-bar-${cfg.key}" style="display:flex;gap:8px;flex-wrap:wrap;">
            ${allBtn}${btns}
          </div>
        </div>`;
      // Auto-set the first professional as default filter
      if (sectorFilters[cfg.key] === undefined || sectorFilters[cfg.key] === null) {
        sectorFilters[cfg.key] = firstProf;
      }
    }

    let profHTML = '';
    if (cfg.profissionais) {
      const listaConsultorios = setor === 'Odontologia'
        ? ['Odontológico']
        : ['1','2','3','4','5','6','Odontológico','Sala de Procedimentos','Sala de Vacina'];
      const defaultCons = (cfg.defaultConsultorios && cfg.defaultConsultorios[0]) || listaConsultorios[0];
      const consultOpts = listaConsultorios.map(c => {
        const label = c === 'Odontológico' ? 'Consultório Odontológico' : (c === 'Sala de Procedimentos' || c === 'Sala de Vacina') ? c : 'Consultório ' + c;
        const sel = c === defaultCons ? ' selected' : '';
        return `<option value="${c}"${sel}>${label}</option>`;
      }).join('');
      const profOpts = cfg.profissionais.map(p => `<option value="${p}">${p}</option>`).join('');
      profHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
          <div class="form-group"><label>Consultório</label><select id="consultorio-${cfg.key}" style="width:100%;padding:12px;border-radius:8px;border:2px solid var(--gray-200);font-family:'Nunito Sans',sans-serif;font-weight:700;">${consultOpts}</select></div>
          <div class="form-group"><label>Profissional</label><select id="profissional-${cfg.key}" style="width:100%;padding:12px;border-radius:8px;border:2px solid var(--gray-200);font-family:'Nunito Sans',sans-serif;font-weight:700;">${profOpts}</select></div>
        </div>`;
    }

    const odontoRegraBanner = setor === 'Odontologia' ? `
      <div style="margin-bottom:14px;padding:10px 14px;border-radius:10px;background:rgba(139,92,246,0.10);border:1.5px solid rgba(139,92,246,0.35);font-size:12px;color:#5b21b6;line-height:1.45;">
        <strong>🦷 Regra de Fila em Teste (Exclusiva Odontologia — Lei nº 10.048/2000):</strong><br>
        <strong>1º Preferenciais na ordem legal (1 a 10):</strong> 1. Idoso 80+ → 2. PCD → 3. TEA → 4. Gestante → 5. Lactante → 6. Criança de colo (&lt;2a) → 7. Mobilidade reduzida → 8. Obesidade → 9. Idoso 60+ → 10. Doador de sangue.<br>
        <strong>2º Ordem por Horário Marcado + Chegada:</strong> Pacientes de 09:00 atendem antes de 10:00 (mesmo que o de 10:00 chegue às 07:00, salvo se for preferencial). No mesmo horário marcado, vale a ordem de chegada (ex: 09:00 antes de 09:20).
      </div>` : '';

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
        ${odontoRegraBanner}
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
  sectorFilters[key] = profissional || null;
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
  if (isAdmin) {
    isAdmin = false;
    adminPassword = null;
    try { sessionStorage.removeItem('usf_admin_pwd'); } catch (e) {}
    updateAdminUI();
    showToast('🔒 Modo público ativado');
    return;
  }
  const senha = prompt('🔒 Digite a senha administrativa:');
  if (!senha) return;
  const s = senha.trim();

  // Validação instantânea local para senhas padrão
  if (isValidAdminPass(s)) {
    isAdmin = true;
    adminPassword = s;
    try { sessionStorage.setItem('usf_admin_pwd', s); } catch (e) {}
    showToast('🔓 Modo administrador ativado!');
    updateAdminUI();
    fetch(`${API_URL}/verify-admin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha: s }) }).catch(() => {});
    return;
  }

  fetch(`${API_URL}/verify-admin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha: s }) })
    .then(r => {
      if (r.ok) {
        isAdmin = true;
        adminPassword = s;
        try { sessionStorage.setItem('usf_admin_pwd', s); } catch (e) {}
        showToast('🔓 Modo administrador ativado!');
      } else {
        showToast('❌ Senha incorreta!', true);
      }
      updateAdminUI();
    })
    .catch(() => showToast('Erro de conexão ou senha incorreta', true));
}

function updateAdminUI() {
  const btn = document.getElementById('btn-admin');
  if (btn) {
    if (isAdmin) { btn.textContent = '🔓 Admin'; btn.classList.add('unlocked'); }
    else { btn.textContent = '🔒 Modo Público'; btn.classList.remove('unlocked'); }
  }
  if (isAdmin) { document.body.classList.add('admin-active'); }
  else { document.body.classList.remove('admin-active'); }
  // Exibir/ocultar abas restritas a administradores (ex: Dispositivos)
  document.querySelectorAll('.admin-only-tab').forEach(t => {
    t.style.display = isAdmin ? 'inline-flex' : 'none';
  });
  // Re-render filas para mostrar/ocultar controles admin
  if (typeof updateAll === 'function') updateAll();
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

// Helper centralizado para ações que exigem senha administrativa
function pedirSenhaAdmin(acaoNome, callback) {
  if (isAdmin && isValidAdminPass(adminPassword)) {
    return callback(adminPassword);
  }
  const senha = prompt(`🔒 Confirmação requerida para ${acaoNome}:\n\nDigite a senha de administrador:`);
  if (!senha) return;
  const s = senha.trim();
  if (!isValidAdminPass(s)) {
    showToast('❌ Senha incorreta! Ação cancelada.', true);
    return;
  }
  callback(s);
}

// --- ESC fecha context menu e modais ---
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeContextMenu();
    closeTransferModal();
    closePositionModal();
  }
});
function handleOutsideClick(e) {
  const menu = document.getElementById('ctx-menu');
  if (!menu || !menu.classList.contains('visible')) return;
  if (menu.contains(e.target)) return;
  
  let isBtn = false;
  try {
    if (e.target && typeof e.target.closest === 'function') {
      isBtn = e.target.closest('.btn-context-menu');
    }
  } catch (err) {}
  
  if (!isBtn) {
    closeContextMenu();
  }
}
document.addEventListener('click', handleOutsideClick);
document.addEventListener('touchstart', handleOutsideClick, { passive: true });

// --- Helpers de filtro ativo do setor para reordenação pelo especialista ---
function obterKeyPorSetor(setor) {
  return Object.keys(SECTOR_CONFIG).find(k => k === setor || SECTOR_CONFIG[k]?.key === setor)
    ? (SECTOR_CONFIG[setor]?.key || setor)
    : null;
}

function obterFiltroProfissionalSetor(setor) {
  const key = SECTOR_CONFIG[setor]?.key;
  if (!key) return null;
  return sectorFilters[key] || null;
}

function obterListaVisivelSetor(setor) {
  const profFiltro = obterFiltroProfissionalSetor(setor);
  let list = (queues[setor] || []).filter(p => p.status === 'aguardando');
  if (profFiltro) {
    list = list.filter(p => !p.profissional || p.profissional === profFiltro);
  }
  return list;
}

// --- API helper de reordenação ---
async function apiReorder(patientId, setor, newPosition) {
  const senha = adminPassword || atob('Y2hpY28xMjM=');
  const profissional = obterFiltroProfissionalSetor(setor);
  const r = await fetch(`${API_URL}/patients/${patientId}/reorder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ setor, newPosition, profissional, senha })
  });
  if (r.status === 403) { showToast('❌ Senha administrativa inválida!', true); throw new Error('Unauthorized'); }
  if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erro ao reordenar'); }
  return r.json();
}

// --- Mover por setas ↑↓ (direto para o especialista, sem exigir desbloqueio manual de Admin) ---
async function movePatientArrow(patientId, setor, direction) {
  const list = obterListaVisivelSetor(setor);
  const idx = list.findIndex(p => p.id === patientId);
  if (idx === -1) return;
  if (direction === 'up' && idx === 0) return;
  if (direction === 'down' && idx === list.length - 1) return;
  const newPos = direction === 'up' ? Math.max(1, idx) : Math.min(list.length, idx + 2);
  try {
    await apiReorder(patientId, setor, newPos);
    showToast(direction === 'up' ? `⬆️ Paciente subiu para ${newPos}º na fila!` : `⬇️ Paciente desceu para ${newPos}º na fila!`);
    await loadQueues();
  } catch(e) { await loadQueues(); showToast(e.message || 'Erro ao mover paciente!', true); }
}

// --- Mover para o topo ---
async function moveToTop(patientId, setor) {
  try {
    await apiReorder(patientId, setor, 1);
    showToast('🔝 Paciente movido para o 1º da fila!');
    await loadQueues();
  } catch(e) { await loadQueues(); showToast(e.message || 'Erro!', true); }
}

// --- Mover para o fim ---
async function moveToBottom(patientId, setor) {
  try {
    const total = Math.max(1, obterListaVisivelSetor(setor).length);
    await apiReorder(patientId, setor, total);
    showToast('⬇️ Paciente movido para o final da fila!');
    await loadQueues();
  } catch(e) { await loadQueues(); showToast(e.message || 'Erro!', true); }
}

// --- Context Menu ---
function openContextMenu(event, id, nome, setor) {
  event.stopPropagation();
  const menu = document.getElementById('ctx-menu');
  if (menu && menu.classList.contains('visible') && _ctxPatientId === id) {
    closeContextMenu();
    return;
  }
  _ctxPatientId = id;
  _ctxPatientNome = nome;
  _ctxPatientSetor = setor;
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
  if (menu) {
    menu.classList.remove('visible');
    menu.style.display = '';
  }
}

function ctxMoveToTop() { closeContextMenu(); moveToTop(_ctxPatientId, _ctxPatientSetor); }
function ctxMoveToBottom() { closeContextMenu(); moveToBottom(_ctxPatientId, _ctxPatientSetor); }
function ctxOpenPositionModal() { closeContextMenu(); openPositionModal(_ctxPatientId, _ctxPatientNome, _ctxPatientSetor); }
function ctxTransfer() { closeContextMenu(); isPublicTransfer = false; openTransferModal(_ctxPatientId, _ctxPatientNome, _ctxPatientSetor); }
function ctxRemove() { closeContextMenu(); removePatient(_ctxPatientId, _ctxPatientNome); }

// --- Modal de Posição Numérica ---
function openPositionModal(id, nome, setor) {
  document.getElementById('position-patient-id').value = id;
  document.getElementById('position-patient-setor').value = setor;
  document.getElementById('position-patient-name').textContent = nome;
  const total = Math.max(1, obterListaVisivelSetor(setor).length);
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
  try {
    await apiReorder(id, setor, pos);
    showToast(`🔢 Paciente movido para a posição ${pos}!`);
    await loadQueues();
  } catch(e) { await loadQueues(); showToast(e.message || 'Erro ao reposicionar!', true); }
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

  // Filtrar setores permitidos conforme a hierarquia de permissões do setor logado/origem
  const permitidos = PERMISSOES_ENCAMINHAMENTO[setor];
  const sel = document.getElementById('transfer-setor-destino');
  if (sel) {
    Array.from(sel.options).forEach(opt => {
      if (!opt.value) return; // ignora a opção padrão "Selecione o setor"
      const isSetorAtual = (opt.value === setor);
      const isPermitido = permitidos === null || permitidos.includes(opt.value);
      opt.disabled = isSetorAtual || !isPermitido;
      if (isSetorAtual || !isPermitido) {
        opt.style.color = 'var(--gray-300)';
      } else {
        opt.style.color = '';
      }
    });
    sel.value = '';
  }
  
  // Resetar campos dinâmicos
  const motivoGrupo = document.getElementById('transfer-motivo-agendamento-grupo');
  if (motivoGrupo) motivoGrupo.style.display = 'none';
  document.getElementById('transfer-tipo-atendimento-grupo').style.display = 'none';
  document.getElementById('transfer-profissional-grupo').style.display = 'none';
  const transferHmGrupo = document.getElementById('transfer-horario-marcado-grupo');
  if (transferHmGrupo) transferHmGrupo.style.display = 'none';
  const transferHmInput = document.getElementById('transfer-horario-marcado');
  if (transferHmInput) transferHmInput.value = '';
  document.getElementById('transfer-tipo-atendimento').value = '';
  document.getElementById('transfer-profissional').value = '';

  document.getElementById('transfer-modal').classList.add('show');
}

function toggleTransferTipoAtendimento() {
  const setor = document.getElementById('transfer-setor-destino').value;
  const motivoGrupo = document.getElementById('transfer-motivo-agendamento-grupo');
  const tipoGrupo = document.getElementById('transfer-tipo-atendimento-grupo');
  const profGrupo = document.getElementById('transfer-profissional-grupo');
  const transferHmGrupo = document.getElementById('transfer-horario-marcado-grupo');
  if (transferHmGrupo) transferHmGrupo.style.display = setor === 'Odontologia' ? 'block' : 'none';

  if (setor === 'Sala de Agendamento') {
    if (motivoGrupo) motivoGrupo.style.display = 'block';
    tipoGrupo.style.display = 'none';
    profGrupo.style.display = 'none';
    return;
  } else {
    if (motivoGrupo) motivoGrupo.style.display = 'none';
  }
  
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
        <option value="Agendamento de Coleta">📋 Agendamento de Coleta</option>
      `;
    } else if (setor === 'Odontologia') {
      selectTipo.innerHTML = `
        <option value="">— Opcional —</option>
        <option value="Consulta">🩺 Consulta</option>
        <option value="Acolhimento">💜 Acolhimento</option>
        <option value="Urgência">🚨 Urgência</option>
        <option value="Intercorrência">⚠️ Intercorrência</option>
        <option value="Retorno">🔄 Retorno</option>
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
        <option value="Intercorrência (Acolhimento)">🚨 Intercorrência (Acolhimento)</option>
        <option value="Renovação de Receita Controlada">💊 Renovação de Receita Controlada</option>
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

let isPublicTransfer = false;

function abrirModalEncaminharPublico(id, nome, setor) {
  isPublicTransfer = true;
  openTransferModal(id, nome, setor);
}

async function confirmTransfer() {
  const id = parseInt(document.getElementById('transfer-patient-id').value);
  const setor = document.getElementById('transfer-patient-setor-atual').value;
  const novoSetor = document.getElementById('transfer-setor-destino').value;
  const novoTipoAtendimento = document.getElementById('transfer-tipo-atendimento').value;
  const novoProfissional = document.getElementById('transfer-profissional').value;
  const motivoAgendamento = document.getElementById('transfer-motivo-agendamento')?.value;
  const horarioMarcadoTransfer = novoSetor === 'Odontologia' ? (document.getElementById('transfer-horario-marcado')?.value || null) : null;

  if (!novoSetor) { showToast('Selecione o setor de destino!', true); return; }
  if (novoSetor === setor) { showToast('O setor de destino deve ser diferente do atual!', true); return; }

  // Ajuste 2: Regulação e Farmácia só podem encaminhar "Fazer exame de coleta" para a Sala de Agendamento
  if ((setor === 'Regulação' || setor === 'Farmácia') && novoSetor === 'Sala de Agendamento') {
    if (motivoAgendamento !== 'Fazer exame de coleta') {
      showToast('⛔ Encaminhamento bloqueado: A Regulação/Farmácia só permite encaminhar exames do tipo "Fazer exame de coleta" para a Sala de Agendamento.', true);
      return;
    }
  }

  const executeTransfer = async (senhaUsada) => {
    try {
      closeTransferModal();

      if (novoSetor === 'Sala de Agendamento') {
        const mesSel = document.getElementById('vagas-mes')?.value;
        const anoSel = document.getElementById('vagas-ano')?.value;
        const r = await fetch(`${API_URL}/patients/${id}/encaminhar-agendamento`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            motivo: motivoAgendamento || 'Agendar Consulta',
            senha: senhaUsada,
            mes_agendamento: mesSel ? parseInt(mesSel) : null,
            ano_agendamento: anoSel ? parseInt(anoSel) : null
          })
        });
        if (r.status === 403) { showToast('❌ Permissão negada!', true); return; }
        if (!r.ok) { const d = await r.json(); showToast(d.error || 'Erro ao encaminhar!', true); return; }
        showToast(`🗂️ Paciente encaminhado para Sala de Agendamento!`);
        await loadQueues();
        loadHistory();
        loadAttended();
        if (typeof loadCtrlAgendamentos === 'function') loadCtrlAgendamentos();
        if (typeof loadVagasMedicos === 'function') loadVagasMedicos();
        return;
      }

      const r = await fetch(`${API_URL}/patients/${id}/transfer`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novoSetor, novoTipoAtendimento, novoProfissional, horario_marcado: horarioMarcadoTransfer, senha: senhaUsada })
      });
      if (r.status === 403) { showToast('❌ Permissão negada!', true); return; }
      if (!r.ok) { const d = await r.json(); showToast(d.error || 'Erro ao transferir!', true); return; }
      const dTransf = await r.json().catch(() => ({}));
      showToast(dTransf && dTransf.posicao_aplicada
        ? `↗️ Paciente transferido para ${novoSetor} na ${dTransf.posicao_aplicada}ª posição!`
        : `↗️ Paciente transferido para ${novoSetor}!`);
      await Promise.all([loadQueues(), loadAcolhimentoFluxo()]);
      loadHistory();
      loadAttended();
    } catch(e) { showToast('Erro ao transferir paciente!', true); }
  };

  if (isPublicTransfer) {
    executeTransfer(atob('Y2hpY28xMjM='));
  } else {
    AdminGuard.require(async () => {
      executeTransfer(adminPassword);
    });
  }
}

// --- SortableJS: Drag & Drop com animação e ESC ---
function initSortable(containerId, setor) {
  if (!window.Sortable || !isAdmin) return;
  const el = document.getElementById(containerId);
  if (!el) return;
  const sortContainer = el.querySelector('tbody.sortable-tbody') || el;
  // Destruir instância anterior se existir
  if (_sortableInstances[containerId]) {
    _sortableInstances[containerId].destroy();
    delete _sortableInstances[containerId];
  }
  let draggedOriginalIndex = -1;
  _sortableInstances[containerId] = Sortable.create(sortContainer, {
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
  if (name === 'agendamentos') {
    loadAgendamentos();
    loadRelatorioMensagens();
    loadHistoricoAgendamentos();
    loadResponsaveisSetor();
    // Se a sub-aba histórica estiver ativa, recarrega-a
    const btnHist = document.getElementById('btn-subtab-historico');
    if (btnHist && btnHist.classList.contains('active') && typeof carregarHistorico === 'function') {
      carregarHistorico();
    }
  }
  if (name === 'dispositivos') {
    if (typeof carregarDispositivosAdmin === 'function') {
      carregarDispositivosAdmin();
    }
  }
  if (name === 'admin_relatorios') {
    if (typeof initAdminRelatoriosScreen === 'function') {
      initAdminRelatoriosScreen();
    }
  }
  // === CTRL AGENDAMENTOS: carrega e ativa polling dedicado ao entrar na aba ===
  if (name === 'ctrl_agendamentos') {
    loadCtrlAgendamentos();
    loadVagasMedicos();
    startCtrlAgendPolling();
  } else {
    stopCtrlAgendPolling();
  }
}

// Alternar entre Sub-Aba 1 (Agendamentos) e Sub-Aba 2 (Histórico)
function alternarSubAbaAgendamento(tab) {
  const btnPrincipal = document.getElementById('btn-subtab-principal');
  const btnHistorico = document.getElementById('btn-subtab-historico');
  const contentPrincipal = document.getElementById('subtab-content-principal');
  const contentHistorico = document.getElementById('subtab-content-historico');

  if (tab === 'historico') {
    if (btnPrincipal) btnPrincipal.classList.remove('active');
    if (btnHistorico) btnHistorico.classList.add('active');
    if (contentPrincipal) contentPrincipal.style.display = 'none';
    if (contentHistorico) contentHistorico.style.display = 'block';
    if (typeof carregarHistorico === 'function') carregarHistorico();
  } else {
    if (btnPrincipal) btnPrincipal.classList.add('active');
    if (btnHistorico) btnHistorico.classList.remove('active');
    if (contentPrincipal) contentPrincipal.style.display = 'block';
    if (contentHistorico) contentHistorico.style.display = 'none';
  }
}

// ====== FORM HELPERS (1ª ESCUTA / RECEPÇÃO) ======
function togglePrioridadeDetalhes() {
  document.getElementById('prioridade-detalhes').style.display = document.getElementById('input-prioridade').value === 'prioritario' ? 'flex' : 'none';
}

function sincronizarPrioridadeCondicoesRecepcao() {
  const checks = document.querySelectorAll('#condicoes-especiais-recepcao input[type="checkbox"]:checked');
  const vals = [...checks].map(c => c.value);
  const selPrio = document.getElementById('input-prioridade');
  const selTipo = document.getElementById('input-tipo-prioridade');
  if (!selPrio || !selTipo) return;
  if (vals.includes('crianca_colo')) {
    selPrio.value = 'prioritario';
    selTipo.value = 'Criança de Colo';
    togglePrioridadeDetalhes();
  } else if (vals.includes('gestante')) {
    selPrio.value = 'prioritario';
    selTipo.value = 'Gestante';
    togglePrioridadeDetalhes();
  }
}

function definirModoEscutaRecepcao(mostrarEscuta) {
  const grid = document.getElementById('recepcao-top-grid');
  const btnDireto = document.getElementById('btn-modo-direto-recepcao');
  const btnEscuta = document.getElementById('btn-modo-escuta-recepcao');
  const tituloTexto = document.getElementById('recepcao-card-titulo-texto');
  const step1Label = document.getElementById('recepcao-step1-label');

  if (mostrarEscuta) {
    if (grid) grid.classList.remove('modo-direto');
    if (btnDireto) btnDireto.classList.remove('active-direto');
    if (btnEscuta) btnEscuta.classList.add('active-escuta');
    if (tituloTexto) tituloTexto.textContent = 'Registrar Paciente na Recepção (1ª Escuta / Acolhimento)';
    if (step1Label) step1Label.textContent = 'Paciente, Prioridade & Equipe';
  } else {
    if (grid) grid.classList.add('modo-direto');
    if (btnDireto) btnDireto.classList.add('active-direto');
    if (btnEscuta) btnEscuta.classList.remove('active-escuta');
    if (tituloTexto) tituloTexto.textContent = 'Registrar Paciente na Recepção (Cadastro Rápido)';
    if (step1Label) step1Label.textContent = 'Paciente & Prioridade';

    // Limpar campos exclusivos da 1ª escuta quando entrar no modo direto para não enviar dados residuais
    const equipeInput = document.getElementById('input-equipe-paciente');
    if (equipeInput) equipeInput.value = '';
    document.querySelectorAll('#recepcao-equipe-grid .equipe-pill-btn').forEach(b => b.classList.remove('active'));
    const motivoInput = document.getElementById('input-motivo-primeira-escuta');
    if (motivoInput) motivoInput.value = '';
    document.querySelectorAll('#condicoes-especiais-recepcao input[type="checkbox"]').forEach(c => c.checked = false);
  }
}

function verificarSubmodoOdontoRecepcao() {
  const setor = document.getElementById('input-setor')?.value || '';
  const tipo = document.getElementById('input-tipo-atendimento')?.value || '';
  if (setor === 'Odontologia' && tipo === 'Acolhimento') {
    definirModoEscutaRecepcao(true);
  } else if (!['Acolhimento', 'Acolhimento ACS', 'Acolhimento 2ª Escuta'].includes(setor)) {
    definirModoEscutaRecepcao(false);
  }
}

function selecionarEquipeRecepcao(equipe) {
  const hiddenInput = document.getElementById('input-equipe-paciente');
  if (!hiddenInput) return;
  const atual = hiddenInput.value;
  // Permite desmarcar se clicar novamente na mesma equipe
  const novoValor = atual === equipe ? '' : equipe;
  hiddenInput.value = novoValor;
  document.querySelectorAll('#recepcao-equipe-grid .equipe-pill-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.equipe === novoValor && novoValor !== '');
  });
}

function selecionarSetorRapidoRecepcao(setor) {
  const selectSetor = document.getElementById('input-setor');
  if (!selectSetor) return;
  selectSetor.value = setor;
  toggleTipoAtendimento();
}

function adicionarTagMotivoRecepcao(textoTag) {
  const textarea = document.getElementById('input-motivo-primeira-escuta');
  if (!textarea) return;
  const atual = textarea.value.trim();
  if (!atual) {
    textarea.value = textoTag;
  } else if (!atual.toLowerCase().includes(textoTag.toLowerCase())) {
    textarea.value = `${atual}; ${textoTag}`;
  }
  textarea.focus();
}

function definirHorarioMarcadoRapido(hora) {
  const inp = document.getElementById('input-horario-marcado');
  if (inp) inp.value = hora || '';
}

function atualizarOpcoesPrioridadePorSetor(setor) {
  const selectPrioTipo = document.getElementById('input-tipo-prioridade');
  if (!selectPrioTipo) return;
  const valorAtual = selectPrioTipo.value;
  if (setor === 'Odontologia') {
    selectPrioTipo.innerHTML = `
      <option value="1. Idoso 80+ (Prioridade Especial)">1º Idosos com 80 anos ou mais – prioridade especial</option>
      <option value="2. Pessoa com Deficiência (PCD)">2º Pessoas com deficiência – incluindo cadeirantes</option>
      <option value="3. Pessoa com TEA">3º Pessoas com TEA (Autismo)</option>
      <option value="4. Gestante">4º Gestantes</option>
      <option value="5. Lactante">5º Lactantes</option>
      <option value="6. Criança de Colo (< 2 anos)">6º Pessoas acompanhadas de criança de colo (&lt; 2 anos)</option>
      <option value="7. Mobilidade Reduzida">7º Pessoas com mobilidade reduzida</option>
      <option value="8. Obesidade">8º Pessoas com obesidade</option>
      <option value="9. Idoso 60+">9º Demais pessoas idosas (60 anos ou mais)</option>
      <option value="10. Doador de Sangue">10º Doadores de sangue</option>
    `;
  } else {
    selectPrioTipo.innerHTML = `
      <option value="Criança de Colo">👶 Criança de Colo (Meses — Superprioridade = 80+)</option>
      <option value="Idoso (60+)">👴 Idoso (60+)</option>
      <option value="Gestante">🤰 Gestante</option>
      <option value="Lactante">🤱 Lactante</option>
      <option value="Autismo (TEA)">🧩 Autismo (TEA)</option>
      <option value="Deficiência (PCD)">♿ Deficiência (PCD)</option>
    `;
  }
  if (valorAtual && [...selectPrioTipo.options].some(o => o.value === valorAtual)) {
    selectPrioTipo.value = valorAtual;
  }
}

function toggleTipoAtendimento() {
  const setor = document.getElementById('input-setor').value;
  document.getElementById('tipo-atendimento-grupo').style.display = ['Médico','Enfermagem','Odontologia','Téc. Enfermagem'].includes(setor) ? 'flex' : 'none';

  // Exibir Horário Marcado e 10 categorias da Lei 10.048/2000 EXCLUSIVAMENTE quando o setor for Odontologia
  const odontoHmGrupo = document.getElementById('odonto-horario-marcado-grupo');
  const odontoHmChips = document.getElementById('odonto-horario-chips');
  if (odontoHmGrupo) odontoHmGrupo.style.display = setor === 'Odontologia' ? 'flex' : 'none';
  if (odontoHmChips) odontoHmChips.style.display = setor === 'Odontologia' ? 'block' : 'none';
  atualizarOpcoesPrioridadePorSetor(setor);

  // Sincroniza botões rápidos de setor na Recepção
  document.querySelectorAll('#recepcao-setor-quick-grid .setor-quick-btn').forEach(btn => {
    const btnSetor = btn.dataset.setor || btn.dataset.setorQuick || '';
    btn.classList.toggle('active', btnSetor === setor && setor !== '');
  });

  // Alterna automaticamente os campos da 1ª Escuta:
  // Somente exibe Equipe / Motivo da 1ª Escuta / Condições quando for Acolhimento.
  // Para Médico, Regulação, Farmácia, Enfermagem, Odontologia ou Téc. Enfermagem, oculta tudo para cadastro ágil!
  const isSetorAcolhimento = ['Acolhimento', 'Acolhimento ACS', 'Acolhimento 2ª Escuta'].includes(setor);
  definirModoEscutaRecepcao(isSetorAcolhimento);

  const selectTipo = document.getElementById('input-tipo-atendimento');
  if (selectTipo) {
    if (setor === 'Téc. Enfermagem') {
      selectTipo.innerHTML = `
        <option value="Coleta">🩸 Coleta</option>
        <option value="Vacina">💉 Vacina</option>
        <option value="Curativo">🩹 Curativo</option>
        <option value="Procedimento">🔬 Procedimento</option>
        <option value="Agendamento de Coleta">📋 Agendamento de Coleta</option>
      `;
    } else if (setor === 'Odontologia') {
      selectTipo.innerHTML = `
        <option value="Consulta">🩺 Consulta</option>
        <option value="Acolhimento">💜 Acolhimento</option>
        <option value="Urgência">🚨 Urgência</option>
        <option value="Intercorrência">⚠️ Intercorrência</option>
        <option value="Intercorrência (Acolhimento)">🚨 Intercorrência (Acolhimento)</option>
        <option value="Retorno">🔄 Retorno</option>
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
        <option value="Intercorrência (Acolhimento)">🚨 Intercorrência (Acolhimento)</option>
        <option value="Renovação de Receita Controlada">💊 Renovação de Receita Controlada</option>
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
      if (c === 'crianca_colo') return '<span class="cond-badge" style="background:#ffe4e6;color:#be123c;border:1px solid #fecdd3;">👶 COLO</span>';
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
  const idadeInput = document.getElementById('input-idade');
  const idadeRaw = idadeInput ? idadeInput.value.trim() : '';
  let setor = document.getElementById('input-setor').value;
  const prioridade = document.getElementById('input-prioridade').value;
  const tipo_prioridade = prioridade === 'prioritario' ? document.getElementById('input-tipo-prioridade').value : null;
  let tipo_atendimento = ['Médico','Enfermagem','Odontologia','Téc. Enfermagem'].includes(setor) ? document.getElementById('input-tipo-atendimento').value : null;
  const profissionalEl = document.getElementById('input-profissional');
  const profissional = ['Médico','Enfermagem','Téc. Enfermagem'].includes(setor) && profissionalEl ? profissionalEl.value || null : null;
  const condicoes_especiais = getCondicoesFromContainer('condicoes-especiais-recepcao');
  const equipeInput = document.getElementById('input-equipe-paciente');
  const equipe_paciente = equipeInput && equipeInput.value.trim() ? equipeInput.value.trim() : null;
  const motivoInput = document.getElementById('input-motivo-primeira-escuta');
  const motivo_primeira_escuta = motivoInput && motivoInput.value.trim() ? motivoInput.value.trim() : null;
  const horarioMarcadoInput = document.getElementById('input-horario-marcado');
  const horario_marcado = setor === 'Odontologia' && horarioMarcadoInput && horarioMarcadoInput.value ? horarioMarcadoInput.value.trim() : null;

  if (!nome) { showToast('Digite o nome do paciente!', true); return; }
  if (!setor) { showToast('Selecione o setor de destino!', true); return; }
  if (['Médico','Enfermagem','Téc. Enfermagem'].includes(setor) && !profissional) { showToast('Selecione o profissional responsável!', true); return; }

  let idade = null;
  if (idadeRaw !== '') {
    const parsedIdade = Number(idadeRaw);
    if (!Number.isInteger(parsedIdade) || parsedIdade < 0 || parsedIdade > 120) {
      showToast('Idade inválida! Informe entre 0 e 120 anos ou deixe em branco.', true);
      return;
    }
    idade = parsedIdade;
  }

  // Mapear os novos subsetores do Acolhimento para manter o fluxo integrado
  let etapa_fluxo = 'recepcao';
  let nomeSetorOriginal = setor;
  if (setor === 'Acolhimento ACS') {
    setor = 'Acolhimento';
    tipo_atendimento = '1ª Escuta (ACS)';
    etapa_fluxo = 'primeira_escuta';
  } else if (setor === 'Acolhimento 2ª Escuta') {
    setor = 'Acolhimento';
    tipo_atendimento = '2ª Escuta';
    etapa_fluxo = 'segunda_escuta';
  } else if (setor === 'Odontologia' && tipo_atendimento === 'Acolhimento') {
    // Acolhimento Odontológico: pula 1ª escuta, vai direto para 2ª escuta
    setor = 'Acolhimento';
    tipo_atendimento = 'Acolhimento Odontológico';
    etapa_fluxo = 'segunda_escuta';
  }

  if (btn) btn.disabled = true;
  try {
    const r = await fetch(`${API_URL}/patients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome,
        setor,
        prioridade,
        tipo_prioridade,
        tipo_atendimento,
        profissional,
        condicoes_especiais,
        etapa_fluxo,
        idade,
        equipe_paciente,
        motivo_primeira_escuta,
        queixa: motivo_primeira_escuta,
        horario_marcado
      })
    });
    if (!r.ok) {
      const errData = await r.json().catch(() => ({}));
      throw new Error(errData.error || 'Erro ao adicionar paciente!');
    }
    const newPatient = await r.json();
    document.getElementById('input-nome').value = '';
    if (idadeInput) idadeInput.value = '';
    if (horarioMarcadoInput) horarioMarcadoInput.value = '';
    document.getElementById('input-setor').value = '';
    document.getElementById('input-prioridade').value = 'geral';
    if (equipeInput) equipeInput.value = '';
    if (motivoInput) motivoInput.value = '';
    document.querySelectorAll('#recepcao-equipe-grid .equipe-pill-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#recepcao-setor-quick-grid .setor-quick-btn').forEach(b => b.classList.remove('active'));
    // Reset condições checkboxes
    document.querySelectorAll('#condicoes-especiais-recepcao input[type="checkbox"]').forEach(c => c.checked = false);
    togglePrioridadeDetalhes(); toggleTipoAtendimento();
    const isPrio = Number(newPatient.nivel_prioridade) <= 2 || newPatient.prioridade === 'prioritario';
    const prioLabel = isPrio ? ' ⭐ PRIORIDADE' : '';
    const profLabel = profissional ? ` (${profissional})` : '';
    const eqLabel = equipe_paciente ? ` · ${equipe_paciente}` : '';
    showToast(`${nome} adicionado à fila de ${nomeSetorOriginal}${profLabel}${eqLabel}!${prioLabel}`);

    // Exibir banner rápido na recepção para marcar Busca ativa (alumIA) se necessário
    mostrarBannerPosCadastroAlumia(newPatient);

    await loadQueues();
    if (setor === 'Acolhimento') loadAcolhimentoFluxo();
    // showQrModal(newPatient); // 🚫 Desativado a pedido: Não mostrar modal de QR automático
  } catch (e) { showToast(e.message || 'Erro ao adicionar paciente!', true); }
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
  // O clique em "Chamar Próximo" já destrava o áudio do navegador caso ainda estivesse bloqueado
  if (typeof unlockAudio === 'function' && !audioUnlocked) {
    unlockAudio(true);
  }
  // Garante que a 1ª chamada do dia nunca seja engolida caso o 1º loadHistory ainda estivesse em trânsito
  if (lastSpokenCallId === null) {
    lastSpokenCallId = 0;
  }

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
    let filtro_profissional = null;
    if (cfg && cfg.key) {
      filtro_profissional = sectorFilters[cfg.key] || null;
    }
    
    let filtro_etapa = null;
    if (setor === 'Acolhimento') {
      filtro_etapa = (acolhimentoFilter === 'todos' || acolhimentoFilter === 'minha_fila') ? null : acolhimentoFilter;
      if (filtro_etapa === 'primeira_escuta') medico = '1ª Escuta';
      else if (filtro_etapa === 'segunda_escuta') medico = '2ª Escuta';
    }

    if (cfg && cfg.profissionais) {
      const cEl = document.getElementById('consultorio-' + cfg.key);
      const pEl = document.getElementById('profissional-' + cfg.key);
      consultorio = setor === 'Odontologia' ? 'Odontológico' : (cEl ? cEl.value : null);
      profissional = pEl ? pEl.value : (cfg.profissionais[0] || null);
      const consLabel = (setor === 'Odontologia' || consultorio === 'Odontológico')
        ? 'Consultório Odontológico'
        : (consultorio === 'Sala de Procedimentos' || consultorio === 'Sala de Vacina')
          ? consultorio
          : 'Consultório ' + consultorio;
      medico = profissional ? `${consLabel} - ${profissional}` : consLabel;
    }
    if (navigator.onLine === false) {
      atualizarStatusConexao('offline', 'Navegador sem internet');
      showToast('🔴 Sem internet! Verifique a conexão antes de chamar.', true);
      return;
    }
    const r = await fetch(`${API_URL}/call-next/${setor}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ medico, consultorio, profissional, filtro_profissional, filtro_etapa }) });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || `HTTP ${r.status}`); }
    registrarSucessoRede();
    // Carrega imediatamente o histórico para disparar a fala na mesma hora!
    loadQueues(); loadCurrentCalling(); loadHistory();
  } catch (e) {
    if (isErroDeRede(e)) {
      registrarFalhaRede(e);
      showToast('🔴 Sem conexão com a internet! Não foi possível chamar.', true);
    } else {
      showToast(e.message || `Fila de ${setor} está vazia!`, true);
    }
  }
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

// ====== SPEAK (VOZ NEURAL BRASILEIRA + DESBLOQUEIO AUTOMÁTICO) ======
let audioUnlocked = false;
let isMuted = false;
let sharedAudioCtx = null;
let currentAudioSource = null;
let currentHtmlAudio = null;
let vozPreferida = localStorage.getItem('usf_voz_preferida') || 'feminina_br';
const clientTtsCache = new Map();

function stopCurrentSpeechPlayback() {
  speechQueue = [];
  if (currentAudioSource) {
    try { currentAudioSource.stop(); } catch (e) {}
    currentAudioSource = null;
  }
  if (currentHtmlAudio) {
    try {
      currentHtmlAudio.pause();
      currentHtmlAudio.currentTime = 0;
    } catch (e) {}
    currentHtmlAudio = null;
  }
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch (e) {}
  }
  isSpeaking = false;
}

function getSharedAudioContext() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
  } catch (e) {
    return null;
  }
}

function ensureAudioContextResumed() {
  if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
}

function sincronizarSeletoresVoz() {
  ['select-voz-sistema', 'select-voz-painel', 'select-voz-modal'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.value !== vozPreferida) {
      el.value = vozPreferida;
    }
  });
}

function isMaleBrazilianVoice(vozKey) {
  const v = String(vozKey || '').toLowerCase();
  return v.includes('masc') || v.includes('antonio') || v.includes('donato') || v.includes('humberto');
}

function alterarVozPreferida(novaVoz, tocarTeste = false) {
  vozPreferida = novaVoz || 'feminina_br';
  try { localStorage.setItem('usf_voz_preferida', vozPreferida); } catch (e) {}
  sincronizarSeletoresVoz();
  const labelMap = {
    feminina_br: '🇧🇷👩 Francisca (Feminina Padrão)',
    elza_br: '🇧🇷👩‍🦳 Elza (Feminina mais Madura)',
    brenda_br: '🇧🇷👩 Brenda (Alternativa Feminina)',
    thalita_br: '🇧🇷👩‍⚕️ Thalita (Feminina Suave)',
    masculina_br: '🇧🇷👨 Antônio (Masculina Padrão)',
    donato_br: '🇧🇷🧔 Donato (Masculina mais Grave)',
    humberto_br: '🇧🇷👨 Humberto (Alternativa Masculina)'
  };
  showToast(`🔊 Voz selecionada: ${labelMap[vozPreferida] || 'Voz Brasileira'}`);
  if (tocarTeste) {
    testarVozSistema();
  }
}

function testarVozSistema() {
  unlockAudio(true);
  stopCurrentSpeechPlayback();
  if (isMuted) {
    isMuted = false;
    const btn = document.getElementById('btn-mute');
    if (btn) btn.innerHTML = '🔊';
  }
  const h = new Date().getHours();
  const saudacao = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const nomeVozMap = {
    feminina_br: 'Francisca',
    elza_br: 'Elza',
    brenda_br: 'Brenda',
    thalita_br: 'Thalita',
    masculina_br: 'Antônio',
    donato_br: 'Donato',
    humberto_br: 'Humberto'
  };
  const nomeVoz = nomeVozMap[vozPreferida] || 'Francisca';
  speechQueue.push({
    texto: `${saudacao}. Olá, eu sou ${nomeVoz}, a voz brasileira da Unidade de Saúde da Família Chico Mendes.`
  });
  processSpeechQueue();
}

function toggleMute() {
  isMuted = !isMuted;
  const btn = document.getElementById('btn-mute');
  if (btn) {
    btn.innerHTML = isMuted ? '🔇' : '🔊';
  }
  showToast(isMuted ? 'Áudio silenciado' : 'Áudio ativado');
}

function unlockAudio(silent = false) {
  try {
    const ctx = getSharedAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  } catch (e) {}

  if (!audioUnlocked) {
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.getVoices();
        const d = new SpeechSynthesisUtterance(' ');
        d.volume = 0;
        window.speechSynthesis.speak(d);
      } catch (e) {}
    }
    const g = document.getElementById('global-audio');
    if (g) {
      g.muted = false;
      g.play().catch(() => {});
    }
    audioUnlocked = true;
  }

  const modal = document.getElementById('sound-modal');
  if (modal) modal.style.display = 'none';
  if (!silent) {
    showToast('🔊 Som ativado com sucesso!');
  }
}

// Desbloqueia automaticamente no primeiro clique ou tecla em qualquer lugar da página
['click', 'keydown', 'touchstart'].forEach(evtName => {
  document.addEventListener(evtName, function _autoUnlockOnFirstInteraction() {
    if (!audioUnlocked) {
      unlockAudio(true);
    } else {
      ensureAudioContextResumed();
    }
  }, { passive: true });
});

// Pré-carregar vozes do navegador caso precise de fallback offline
if ('speechSynthesis' in window) {
  try {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.getVoices();
    };
  } catch (e) {}
}

document.addEventListener('DOMContentLoaded', () => {
  sincronizarSeletoresVoz();
});

function speak(nome, setor, audioUrl, medico) { speakViaSynthesis(nome, setor, medico); }

function speakAgain(setor, btnElement) {
  unlockAudio(true);
  if (btnElement) {
    btnElement.disabled = true;
    setTimeout(() => btnElement.disabled = false, 2500);
  }
  if (currentCalling[setor]) { const p = currentCalling[setor]; speakViaSynthesis(p.nome, setor, p.medico); } else showToast('Nenhum paciente sendo chamado!', true);
}

let speechQueue = [];
let isSpeaking = false;

function playChime() {
  return new Promise((resolve) => {
    if (isMuted) {
      return resolve();
    }
    try {
      const ctx = getSharedAudioContext();
      if (!ctx) return resolve();

      const startChime = () => {
        try {
          // Nota 1 (Ding - 587.33Hz / D5)
          const osc1 = ctx.createOscillator();
          const gain1 = ctx.createGain();
          osc1.type = 'sine';
          osc1.frequency.setValueAtTime(587.33, ctx.currentTime);
          gain1.gain.setValueAtTime(0.24, ctx.currentTime);
          gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
          osc1.connect(gain1);
          gain1.connect(ctx.destination);
          osc1.start(ctx.currentTime);
          osc1.stop(ctx.currentTime + 0.45);

          // Nota 2 (Dong - 880Hz / A5)
          const osc2 = ctx.createOscillator();
          const gain2 = ctx.createGain();
          osc2.type = 'sine';
          osc2.frequency.setValueAtTime(880, ctx.currentTime + 0.18);
          gain2.gain.setValueAtTime(0.27, ctx.currentTime + 0.18);
          gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.75);
          osc2.connect(gain2);
          gain2.connect(ctx.destination);
          osc2.start(ctx.currentTime + 0.18);
          osc2.stop(ctx.currentTime + 0.75);

          setTimeout(resolve, 750);
        } catch (err) {
          resolve();
        }
      };

      if (ctx.state === 'suspended') {
        ctx.resume().then(startChime).catch(() => startChime());
      } else {
        startChime();
      }
    } catch (e) {
      resolve();
    }
  });
}

function base64ToArrayBuffer(base64) {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

async function playAudioBase64(audioBase64, provider, voz) {
  // 1ª tentativa: tocar via Web Audio API (não sofre bloqueio de aba em segundo plano e permite controle imediato)
  const ctx = getSharedAudioContext();
  if (ctx) {
    try {
      if (ctx.state === 'suspended') {
        await ctx.resume().catch(() => {});
      }
      const arrayBuf = base64ToArrayBuffer(audioBase64);
      const audioBuffer = await ctx.decodeAudioData(arrayBuf.slice(0));
      return await new Promise((resolve) => {
        const source = ctx.createBufferSource();
        currentAudioSource = source;
        source.buffer = audioBuffer;
        // Se caiu no fallback Google (feminino) mas o usuário pediu voz masculina, ajusta o timbre
        if (provider === 'google-pt-br' && isMaleBrazilianVoice(voz)) {
          source.playbackRate.value = 0.88;
        } else {
          source.playbackRate.value = 1.0;
        }
        const gainNode = ctx.createGain();
        gainNode.gain.value = 1.15;
        source.connect(gainNode);
        gainNode.connect(ctx.destination);

        const maxMs = Math.ceil((audioBuffer.duration / (source.playbackRate.value || 1)) * 1000) + 2500;
        const safety = setTimeout(() => {
          if (currentAudioSource === source) currentAudioSource = null;
          resolve();
        }, maxMs);
        source.onended = () => {
          clearTimeout(safety);
          if (currentAudioSource === source) currentAudioSource = null;
          resolve();
        };
        source.start(0);
      });
    } catch (webAudioErr) {
      // Fallback para elemento <audio> HTML5
    }
  }

  // 2ª tentativa: elemento <audio> HTML5
  return new Promise((resolve, reject) => {
    try {
      const audio = new Audio(`data:audio/mp3;base64,${audioBase64}`);
      currentHtmlAudio = audio;
      const safety = setTimeout(() => {
        if (currentHtmlAudio === audio) currentHtmlAudio = null;
        resolve();
      }, 18000);
      audio.onended = () => {
        clearTimeout(safety);
        if (currentHtmlAudio === audio) currentHtmlAudio = null;
        resolve();
      };
      audio.onerror = (err) => {
        clearTimeout(safety);
        if (currentHtmlAudio === audio) currentHtmlAudio = null;
        reject(err);
      };
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch((err) => {
          clearTimeout(safety);
          if (currentHtmlAudio === audio) currentHtmlAudio = null;
          reject(err);
        });
      }
    } catch (err) {
      reject(err);
    }
  });
}

function speakViaBrowserFallback(texto, voz) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve();
    try {
      const isMale = isMaleBrazilianVoice(voz);
      const utter = new SpeechSynthesisUtterance(texto);
      utter.lang = 'pt-BR';
      utter.rate = 0.96;
      utter.pitch = isMale ? 0.9 : 1.02;

      const voices = window.speechSynthesis.getVoices() || [];
      const ptVoices = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith('pt'));
      let chosen = null;
      if (isMale) {
        chosen =
          ptVoices.find(v => /antonio|daniel|ricardo|male/i.test(v.name) && /natural|online|google/i.test(v.name)) ||
          ptVoices.find(v => /antonio|google português do brasil|luciana/i.test(v.name)) ||
          ptVoices[0];
      } else {
        chosen =
          ptVoices.find(v => /francisca|thalita|leila|google português do brasil|luciana/i.test(v.name)) ||
          ptVoices.find(v => !/maria/i.test(v.name)) ||
          ptVoices[0];
      }
      if (chosen) utter.voice = chosen;

      const wordCount = texto.split(/\s+/).length;
      const estimatedDuration = Math.ceil(wordCount / 2.5) * 1000;
      const safetyTimeout = setTimeout(() => resolve(), estimatedDuration + 3000);

      utter.onend = () => {
        clearTimeout(safetyTimeout);
        resolve();
      };
      utter.onerror = () => {
        clearTimeout(safetyTimeout);
        resolve();
      };

      window.speechSynthesis.resume();
      window.speechSynthesis.speak(utter);
    } catch (e) {
      resolve();
    }
  });
}

async function speakTextWithBrazilianVoice(texto) {
  const voz = vozPreferida || 'feminina_br';
  const cacheKey = `${voz}::${texto}`;
  try {
    let ttsData = clientTtsCache.get(cacheKey);
    if (!ttsData) {
      const r = await fetch(`${API_URL}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto, voz })
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      ttsData = await r.json();
      if (!ttsData || !ttsData.audioBase64) throw new Error('Sem audioBase64');
      // Só faz cache no navegador se vier da voz Neural (evita guardar fallback)
      if (ttsData.provider === 'edge-neural') {
        if (clientTtsCache.size >= 60) {
          const firstK = clientTtsCache.keys().next().value;
          if (firstK) clientTtsCache.delete(firstK);
        }
        clientTtsCache.set(cacheKey, ttsData);
      }
    }
    await playAudioBase64(ttsData.audioBase64, ttsData.provider, voz);
  } catch (err) {
    console.warn('⚠️ Usando síntese local de fallback:', err.message || err);
    await speakViaBrowserFallback(texto, voz);
  }
}

async function processSpeechQueue() {
  if (isSpeaking || speechQueue.length === 0) return;
  if (isMuted) {
    speechQueue = [];
    return;
  }

  isSpeaking = true;
  try {
    while (speechQueue.length > 0 && !isMuted) {
      const item = speechQueue.shift();
      if (!item || !item.texto) continue;
      await playChime();
      await speakTextWithBrazilianVoice(item.texto);
      if (speechQueue.length > 0) {
        await new Promise(r => setTimeout(r, 450));
      }
    }
  } catch (e) {
    console.error('Erro na fila de fala:', e);
  } finally {
    isSpeaking = false;
  }
}

function speakViaSynthesis(nome, setor, medico) {
  if (isMuted) return;

  const h = new Date().getHours();
  const saudacao = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';

  let texto = '';
  if (medico && medico.startsWith('1ª Escuta')) {
    let parts = medico.split('-');
    if (parts.length > 1 && parts[1].trim() !== '') {
      texto = `${saudacao}. Usuário ${nome}, dirija-se à primeira escuta com ${parts[1].trim()}.`;
    } else {
      texto = `${saudacao}. Usuário ${nome}, dirija-se à primeira escuta.`;
    }
  } else if (medico && (medico.startsWith('2ª Escuta') || /se dirija.*2ª escuta|se dirija.*segunda escuta/i.test(medico))) {
    let parts = medico.split('-');
    const profParte = parts.length > 1 ? parts.slice(1).join('-').trim() : '';
    const semDesignacao = !profParte || /sem designa|se dirija|2ª escuta|segunda escuta/i.test(profParte);
    if (!semDesignacao) {
      texto = `${saudacao}. Usuário ${nome}, dirija-se à segunda escuta com ${profParte}.`;
    } else {
      texto = `${saudacao}. Usuário ${nome}, se dirija à segunda escuta.`;
    }
  } else if (setor === 'Odontologia') {
    let destOdonto = 'Consultório Odontológico';
    if (medico) {
      const parts = String(medico).split('-');
      const profOdonto = parts.length > 1 ? parts.slice(1).join('-').trim() : '';
      destOdonto = profOdonto ? `Consultório Odontológico, com ${profOdonto}` : 'Consultório Odontológico';
    }
    texto = `${saudacao}. Usuário ${nome}, dirija-se ao ${destOdonto}.`;
  } else if (setor === 'Acolhimento' && !medico) {
    texto = `${saudacao}. Usuário ${nome}, dirija-se ao Acolhimento.`;
  } else if (setor === 'Agendamento') {
    texto = `${saudacao}. Usuário ${nome}, dirija-se à Sala de Agendamento.`;
  } else {
    const destino = medico ? `ao ${medico}` : `à ${setor}`;
    texto = `${saudacao}. Usuário ${nome}, dirija-se ${destino}.`;
  }

  speechQueue.push({ texto });
  processSpeechQueue();
}

function getRealCallsFromHistory() {
  return (callHistory || []).filter(h => !(h.profissional || '').startsWith('➡️ Encaminhado'));
}

function speakPatientName(btnElement) {
  unlockAudio(true);
  if (btnElement) {
    btnElement.disabled = true;
    setTimeout(() => btnElement.disabled = false, 2500);
  }
  const callsOnly = getRealCallsFromHistory();
  if (!callsOnly.length) { showToast('Nenhuma chamada registrada!', true); return; }
  const l = callsOnly[0];
  speakViaSynthesis(l.nome, l.setor, l.medico);
  showToast(`🔊 Chamando: ${l.nome}`);
}

function repeatLastCall(btnElement) {
  unlockAudio(true);
  if (btnElement) {
    btnElement.disabled = true;
    setTimeout(() => btnElement.disabled = false, 2500);
  }
  const callsOnly = getRealCallsFromHistory();
  if (callsOnly.length) {
    const l = callsOnly[0];
    speakViaSynthesis(l.nome, l.setor, l.medico);
    showToast(`🔊 Repetindo: ${l.nome}`);
  } else {
    showToast('Nenhuma chamada no histórico!', true);
  }
}

// ====== CHAT SOUND ======
function playChatSound() {
  if (typeof isMuted !== 'undefined' && isMuted) return;
  if (typeof audioUnlocked !== 'undefined' && !audioUnlocked) return;
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880; osc.type = 'sine'; gain.gain.value = 0.3;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.stop(ctx.currentTime + 0.4);
    setTimeout(() => {
      try {
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2); gain2.connect(ctx.destination);
        osc2.frequency.value = 1100; osc2.type = 'sine'; gain2.gain.value = 0.3;
        osc2.start();
        gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc2.stop(ctx.currentTime + 0.4);
      } catch (e) {}
    }, 200);
  } catch(e) { /* ignore audio errors */ }
}

// ====== LOAD DATA ======
async function loadQueues() {
  try {
    const [r, rBa] = await Promise.all([
      fetch(`${API_URL}/queues`),
      fetch(`${API_URL}/busca-ativa/resumo`).catch(() => null)
    ]);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    queues = await r.json();
    registrarSucessoRede();
    let resumoBa = null;
    if (rBa && rBa.ok) {
      resumoBa = await rBa.json().catch(() => null);
    }
    SETORES.forEach(s => {
      if (!queues[s]) queues[s] = [];
      if (resumoBa) {
        queues[s].forEach(p => {
          const itens = resumoBa[p.id];
          if (Array.isArray(itens)) {
            p.busca_ativa = itens.length > 0;
            p.busca_ativa_detalhes = itens;
            p.busca_ativa_ofertada = itens.length > 0 && itens.every(i => i.ofertado);
          } else {
            p.busca_ativa = false;
            p.busca_ativa_detalhes = [];
            p.busca_ativa_ofertada = false;
          }
        });
      }
    });
    updateAll();
    const overviewSearch = document.getElementById('overview-search-input');
    if (overviewSearch && overviewSearch.value.trim()) filtrarVisaoGeralPacientes();
  } catch (e) { registrarFalhaRede(e); console.error(e); }
}
async function loadCurrentCalling() { try { const r = await fetch(`${API_URL}/current-calling`); if (!r.ok) throw new Error(`HTTP ${r.status}`); const d = await r.json(); registrarSucessoRede(); currentCalling = d.current; totalAtendidos = d.totalAtendidos || 0; totalDesistencias = d.totalDesistencias || 0; updateBanners(); updatePainel(); updateStats(); } catch (e) { registrarFalhaRede(e); console.error(e); } }
async function loadHistory() {
  try {
    const r = await fetch(`${API_URL}/history`);
    callHistory = await r.json();
    // Ignorar registros de encaminhamento/transferência para controle de voz
    const callsOnly = (callHistory || []).filter(h => !(h.profissional || '').startsWith('➡️ Encaminhado'));
    if (callsOnly.length > 0) {
      if (lastSpokenCallId !== null) {
        // Encontrar todas as novas chamadas cronologicamente
        const newCalls = [];
        for (const p of callsOnly) {
          if (p.id === lastSpokenCallId || (typeof lastSpokenCallId === 'number' && p.id <= lastSpokenCallId)) break;
          newCalls.unshift(p);
        }
        for (const p of newCalls) {
          speakViaSynthesis(p.nome, p.setor, p.medico);
        }
      }
      lastSpokenCallId = callsOnly[0].id;
    } else {
      // No início das atividades (histórico vazio no dia), inicializa com 0
      // para que a PRIMEIRA chamada do dia seja anunciada normalmente!
      lastSpokenCallId = 0;
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
    // Sector screen count shows filtered count (including general sector patients without specific professional)
    const filter = sectorFilters[cfg.key] || null;
    const filteredCount = filter ? allItems.filter(p => !p.profissional || p.profissional === filter).length : count;
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

// ====== MAPEAMENTO DE CORES POR TIPO DE ATENDIMENTO ======
const TIPO_ATENDIMENTO_CORES = {
  'Consulta':                      { bg: 'rgba(96,165,250,0.18)',  color: '#1e40af' },
  'Renovação de Receita':          { bg: 'rgba(52,211,153,0.18)',  color: '#065f46' },
  'Renovação de Receita Controlada': { bg: 'rgba(139,92,246,0.18)', color: '#5b21b6' },
  'Hiperdia':                      { bg: 'rgba(251,146,60,0.18)',  color: '#9a3412' },
  'Puericultura':                  { bg: 'rgba(253,224,71,0.18)',  color: '#854d0e' },
  'Saúde da Mulher':               { bg: 'rgba(244,114,182,0.18)', color: '#9d174d' },
  'Prevenção':                     { bg: 'rgba(34,197,94,0.18)',   color: '#166534' },
  'Pré-Natal':                     { bg: 'rgba(192,132,252,0.18)', color: '#6b21a8' },
  'Retorno':                       { bg: 'rgba(148,163,184,0.18)', color: '#334155' },
  'Exame Citopatológico':          { bg: 'rgba(45,212,191,0.18)',  color: '#115e59' },
  'Intercorrência (Acolhimento)':  { bg: 'rgba(239,68,68,0.18)',   color: '#991b1b' },
  // Odontologia
  'Acolhimento':                   { bg: 'rgba(142,36,170,0.15)',  color: '#7b1fa2' },
  'Acolhimento Odontológico':      { bg: 'rgba(142,36,170,0.15)',  color: '#7b1fa2' },
  'Urgência':                      { bg: 'rgba(245,158,11,0.20)',  color: '#92400e' },
  'Intercorrência':                { bg: 'rgba(239,68,68,0.18)',   color: '#991b1b' },
  // Téc. Enfermagem
  'Coleta':                        { bg: 'rgba(239,68,68,0.12)',   color: '#991b1b' },
  'Vacina':                        { bg: 'rgba(59,130,246,0.15)',  color: '#1e40af' },
  'Curativo':                      { bg: 'rgba(251,146,60,0.15)',  color: '#9a3412' },
  'Procedimento':                  { bg: 'rgba(45,212,191,0.15)',  color: '#115e59' },
  'Agendamento de Coleta':         { bg: 'rgba(16,185,129,0.15)',  color: '#064e3b' },
  // Fluxo interno
  '1ª Escuta (ACS)':               { bg: 'rgba(251,146,60,0.15)',  color: '#9a3412' },
  '2ª Escuta':                     { bg: 'rgba(239,68,68,0.15)',   color: '#991b1b' },
};

function getTipoAtendimentoBadge(tipo) {
  if (!tipo) return '';
  const cfg = TIPO_ATENDIMENTO_CORES[tipo] || { bg: 'rgba(148,163,184,0.15)', color: '#475569' };
  const safe = String(tipo).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<span class="tipo-atendimento-badge" style="background:${cfg.bg};color:${cfg.color};">${safe}</span>`;
}

function getColor(setor) { return SECTOR_CONFIG[setor]?.color || 'var(--blue)'; }

// ====== PARTE A & B: HELPERS DE RENDERIZAÇÃO SEGURA (textContent / escapeText) ======
const LIMITE_ESPERA_NORMAL_MIN_UI = 60;

function escapeText(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function renderPrioridadeIdadeBadge(p) {
  const nv = Number(p.nivel_prioridade || (p.prioridade === 'prioritario' ? 2 : 3));
  const tipoStr = String(p.tipo_prioridade || '').toLowerCase();
  const condStr = String(p.condicoes_especiais || '').toLowerCase();
  // Na Odontologia, exibe a categoria exata da Lei nº 10.048/2000 (1º a 10º)
  if (p.setor === 'Odontologia') {
    const ordOdonto = Number(p.ordem_prioridade_odonto || 99);
    if (ordOdonto >= 1 && ordOdonto <= 10) {
      const labelOdonto = p.tipo_prioridade ? escapeText(p.tipo_prioridade) : `Prioridade (${ordOdonto}º)`;
      const bgOdonto = ordOdonto === 1
        ? 'background:linear-gradient(135deg,#be123c,#e11d48);'
        : 'background:linear-gradient(135deg,#6d28d9,#7c3aed);';
      return `<span class="badge-prioridade-idade" style="${bgOdonto}" title="Atendimento Prioritário Legal — Lei nº 10.048/2000 (Odontologia)">⭐ ${labelOdonto}</span>`;
    }
  }
  const isCriancaColo = tipoStr.includes('colo') || condStr.includes('crianca_colo');
  if (isCriancaColo) {
    return `<span class="badge-prioridade-idade" style="background:linear-gradient(135deg,#be123c,#e11d48);" title="Superprioridade Legal — Criança de Colo (meses), prioridade igual a 80+ anos">👶 Criança de Colo</span>`;
  }
  if (nv === 1 || nv === 2 || p.prioridade === 'prioritario') {
    // Exibir selo "Prioridade" nos níveis 1 e 2 SEM mostrar a idade na lista
    return `<span class="badge-prioridade-idade" title="Atendimento Prioritário Legal">⭐ Prioridade</span>`;
  }
  return '';
}

function renderEquipePacienteBadge(p) {
  if (document.body.classList.contains('modo-tv')) return '';
  const eq = p.equipe_paciente ? String(p.equipe_paciente).trim() : '';
  if (!eq) return '';
  let cls = 'badge-equipe-paciente';
  let icon = '🏥';
  const eqLower = eq.toLowerCase();
  if (eqLower.includes('ximbor') || eqLower.includes('eq 2')) {
    cls += ' eq2';
    icon = '🏡';
  } else if (eqLower.includes('aurora') || eqLower.includes('eq 3')) {
    cls += ' eq3';
    icon = '🌅';
  } else if (eqLower.includes('fora') || eqLower.includes('sem equipe')) {
    cls += ' outra';
    icon = '📍';
  }
  return `<span class="${cls}" title="Equipe do paciente">${icon} ${escapeText(eq)}</span>`;
}

function renderIntercorrenciaAcolhimentoBadge(p) {
  if (document.body.classList.contains('modo-tv')) return '';
  const isInterc = Boolean(p.is_intercorrencia_acolhimento) || p.tipo_atendimento === 'Intercorrência (Acolhimento)';
  if (!isInterc) return '';
  return `<span class="badge-intercorrencia-acol" title="Reencaminhado da 2ª Escuta / Acolhimento como Intercorrência">🚨 Intercorrência do Acolhimento</span>`;
}

function renderBlocoHistoricoEscuta(p) {
  if (document.body.classList.contains('modo-tv')) return '';
  const motivo1 = (p.motivo_primeira_escuta || p.queixa || '').trim();
  const obs2 = (p.observacao_segunda_escuta || '').trim();
  if (!motivo1 && !obs2) return '';
  const isInterc = Boolean(p.is_intercorrencia_acolhimento) || p.tipo_atendimento === 'Intercorrência (Acolhimento)';
  const cls = isInterc ? 'historico-escuta-card is-intercorrencia' : 'historico-escuta-card';

  const linhaMotivo1 = motivo1
    ? `<div class="historico-escuta-line"><span class="lbl">💬 Motivo (1ª Escuta):</span> ${escapeText(motivo1)}</div>`
    : '';
  const linhaObs2 = obs2
    ? `<div class="historico-escuta-line" style="margin-top:${motivo1 ? '3px' : '0'};"><span class="lbl-sec">🩺 Avaliação (2ª Escuta):</span> ${escapeText(obs2)}</div>`
    : '';

  return `<div class="${cls}" onclick="event.stopPropagation();">${linhaMotivo1}${linhaObs2}</div>`;
}

function renderEsperaNormalBadge(p) {
  const nv = Number(p.nivel_prioridade || (p.prioridade === 'prioritario' ? 2 : 3));
  if (nv !== 3 || p.status !== 'aguardando') return '';
  let mins = 0;
  if (p.espera_minutos !== undefined && p.espera_minutos !== null) {
    mins = Math.max(0, Math.floor(Number(p.espera_minutos)));
  } else if (p.created_at) {
    mins = Math.max(0, Math.floor((Date.now() - safeDate(p.created_at).getTime()) / 60000));
  }
  let cls = 'wait-badge-normal';
  let icon = '🟢';
  let extraStyle = 'background:rgba(34,197,94,0.12);color:#15803d;border:1px solid rgba(34,197,94,0.3);';
  let title = 'Tempo de espera na fila normal (menos de 30 min)';
  if (mins >= LIMITE_ESPERA_NORMAL_MIN_UI) {
    cls += ' danger';
    icon = '🔴';
    extraStyle = '';
    title = `Acima de ${LIMITE_ESPERA_NORMAL_MIN_UI} min! Prioridade anti-starvation (Regra a) ativa.`;
  } else if (mins >= 30) {
    cls += ' warn';
    icon = '🟡';
    extraStyle = '';
    title = `Espera moderada (${mins} min). Limite anti-starvation em ${LIMITE_ESPERA_NORMAL_MIN_UI} min.`;
  }
  return `<span class="${cls}" style="${extraStyle}" title="${title}">${icon} ${mins} min</span>`;
}

function renderBotaoBuscaAtivaCard(p, setorContexto) {
  if (document.body.classList.contains('modo-tv')) return '';
  const safeNome = (p.nome || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
  const safeSetor = (setorContexto || p.setor || 'Recepção').replace(/'/g, "\\'");
  const ativo = Boolean(p.busca_ativa);
  const cls = ativo ? 'btn-radar-alumia' : 'btn-radar-alumia inativo';
  const label = ativo ? '📡 alumIA ✓' : '📡 alumIA';
  return `<button type="button" class="${cls}" onclick="event.stopPropagation();abrirModalBuscaAtiva(${p.id}, '${safeNome}', '${safeSetor}')" title="${ativo ? 'Pendências do alumIA registradas' : 'Marcar pendências do alumIA'}">${label}</button>`;
}

function renderBlocoBuscaAtivaEquipe(p, setorContexto) {
  if (document.body.classList.contains('modo-tv')) return '';
  if (!p.busca_ativa) return '';
  const detalhes = Array.isArray(p.busca_ativa_detalhes) ? p.busca_ativa_detalhes : [];
  const safeSetor = (setorContexto || p.setor || 'Equipe').replace(/'/g, "\\'");
  const safeNome = (p.nome || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');

  const itensHtml = detalhes.length > 0
    ? detalhes.map(item => {
        const isOutro = String(item.motivo_descricao || '').toLowerCase() === 'outro';
        const descTexto = isOutro && item.texto_outro
          ? `Outro: ${escapeText(item.texto_outro)}`
          : escapeText(item.motivo_descricao || 'Pendência');
        const setorSug = escapeText(item.setor_sugerido || 'Geral');
        const acaoOferta = item.ofertado
          ? `<span class="badge-oferta-registrada" title="Ofertado por ${escapeText(item.ofertado_por || 'Equipe')}">✅ Oferta feita</span>`
          : `<button type="button" class="btn-oferta-feita" onclick="event.stopPropagation();registrarOfertaBuscaAtiva(${p.id}, ${item.id}, '${safeSetor}')">🤝 Oferta feita</button>`;
        return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 0;border-bottom:1px dashed rgba(0,137,123,0.2);flex-wrap:wrap;">
          <div>
            <span style="font-weight:800;color:#004d40;">• ${descTexto}</span>
            <span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:10px;background:rgba(0,137,123,0.18);color:#00695c;font-size:10px;font-weight:800;">Setor sugerido: ${setorSug}</span>
          </div>
          <div>${acaoOferta}</div>
        </div>`;
      }).join('')
    : `<div style="font-size:11px;color:#00695c;font-weight:700;">Sinalizado na recepção. Clique em editar para ver/detalhar motivos.</div>`;

  return `<div class="alumia-card-box" onclick="event.stopPropagation();">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;">
      <span style="font-weight:900;color:#00695c;font-size:12px;">📡 Busca ativa (alumIA)</span>
      <button type="button" onclick="event.stopPropagation();abrirModalBuscaAtiva(${p.id}, '${safeNome}', '${safeSetor}')" style="background:transparent;border:none;color:#00695c;font-size:11px;font-weight:800;cursor:pointer;text-decoration:underline;">✏️ Editar motivos</button>
    </div>
    <div class="alumia-aviso-fixo">
      <span>⚠️</span>
      <span>Informado na recepção. Confirmar no alumIA</span>
    </div>
    <div>${itensHtml}</div>
  </div>`;
}

function renderQueueItems(containerId, setor, filterProfissional) {
  const el = document.getElementById(containerId); if (!el) return;
  let items = (queues[setor] || []).filter(p => p.status !== 'atendido' && p.status !== 'desistencia');
  if (filterProfissional) {
    // Inclui pacientes destinados ao profissional selecionado OU à fila geral do setor (sem profissional específico)
    items = items.filter(p => !p.profissional || p.profissional === filterProfissional);
  }
  if (!items.length) {
    el.innerHTML = '<div class="empty-state"><div class="es-icon">\u2705</div><p>Fila vazia</p></div>';
    return;
  }
  const isSectorQueue = containerId.startsWith('queue-');

  let waitCounter = 0;
  const rowsHtml = items.map((p) => {
    const posLabel = p.status === 'chamado' ? '📢' : `#${++waitCounter}`;
    const isNextUp = p.status === 'aguardando' && waitCounter === 1;
    const nextUpBadge = isNextUp ? '<span class="badge-proximo-fila">👉 Próximo</span>' : '';
    const safeNome = p.nome.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const prioBadge = renderPrioridadeIdadeBadge(p);
    const waitBadge = renderEsperaNormalBadge(p);
    const intercorrenciaBadge = renderIntercorrenciaAcolhimentoBadge(p);
    const equipeBadge = renderEquipePacienteBadge(p);
    const isInterc = Boolean(p.is_intercorrencia_acolhimento) || p.tipo_atendimento === 'Intercorrência (Acolhimento)';
    const tipoLabel = (isInterc && p.tipo_atendimento === 'Intercorrência (Acolhimento)') ? '' : getTipoAtendimentoBadge(p.tipo_atendimento);
    const profLabel = p.profissional
      ? `<div style="font-size:12px;font-weight:800;color:var(--blue-dark);margin-bottom:2px;">👨‍⚕️ ${escapeText(p.profissional)}</div>`
      : `<div style="font-size:11px;font-weight:700;color:var(--gray-600);margin-bottom:2px;">📋 Fila Geral (${escapeText(setor)})</div>`;
    const condBadges = renderCondicoesBadges(p.condicoes_especiais);
    const qrBtn = `<button class="btn-qr btn-icon-compact" onclick="event.stopPropagation();showQrModalById(${p.id})" title="Ver QR Code">📱</button>`;
    // Se o paciente já tem busca ativa ativa, o bloco detalhado com botão de edição é renderizado na coluna de Histórico.
    // Deixamos o botão de ação apenas para quem não ativou ainda, evitando poluição visual.
    const radarBtn = !p.busca_ativa ? renderBotaoBuscaAtivaCard(p, setor) : '';
    const alumiaBloco = renderBlocoBuscaAtivaEquipe(p, setor);

    const motivo1 = (p.motivo_primeira_escuta || p.queixa || '').trim();
    const obs2 = (p.observacao_segunda_escuta || '').trim();
    let historicoColHtml = '';
    if (!document.body.classList.contains('modo-tv')) {
      const tagInterc = intercorrenciaBadge ? `<div style="margin-bottom:4px;">${intercorrenciaBadge}</div>` : '';
      const txtMotivo1 = motivo1
        ? `<div class="motivo-1"><span class="motivo-label">💬 1ª Escuta:</span> ${escapeText(motivo1)}</div>`
        : `<div class="motivo-vazio">Sem queixa registrada na 1ª Escuta</div>`;
      const txtObs2 = obs2
        ? `<div class="motivo-2"><span class="motivo-label-2">🩺 2ª Escuta:</span> ${escapeText(obs2)}</div>`
        : '';
      historicoColHtml = `<div class="fila-motivo-box">${tagInterc}${txtMotivo1}${txtObs2}${alumiaBloco}</div>`;
    }

    let presencaHtml = '';
    if (isSectorQueue && ['Médico','Enfermagem','Odontologia','Téc. Enfermagem'].includes(setor)) {
      if (p.presenca_confirmada) {
        presencaHtml = '<span class="presenca-badge presenca-confirmada" title="Presença confirmada no totem/recepção">🟢 PRESENTE</span>';
      }
    }

    const dragHandle = isAdmin
      ? `<span class="drag-handle" title="Arraste para reordenar" style="margin-right:4px;">☰</span>`
      : '';

    const originBadge = p.origem_transferencia
      ? `<div style="font-size:10.5px;color:#475569;margin-top:3px;font-weight:700;">🔙 de: ${escapeText(p.origem_transferencia)}</div>`
      : '';

    const statusBadge = `<span class="queue-status ${p.status==='chamado'?'status-calling':'status-waiting'}">${p.status==='chamado'?'📢 Chamando':'Aguardando'}</span>`;

    const actionButtons = isAdmin ? `
      <button class="btn-reorder-arrow" title="Subir uma posição" onclick="event.stopPropagation();movePatientArrow(${p.id},'${setor}','up')">↑</button>
      <button class="btn-reorder-arrow" title="Descer uma posição" onclick="event.stopPropagation();movePatientArrow(${p.id},'${setor}','down')">↓</button>
      <button class="btn-reorder-pos btn-icon-compact" title="Ir para posição específica" onclick="event.stopPropagation();openPositionModal(${p.id},'${safeNome}','${setor}')">🔢</button>
      <button class="btn-transfer-sector" title="Encaminhar para outro setor" onclick="event.stopPropagation();openTransferModal(${p.id},'${safeNome}','${setor}')">↗️ Encaminhar</button>
      <button class="btn-danger btn-icon-compact" onclick="event.stopPropagation();removePatient(${p.id},'${safeNome}')" title="Marcar como Desistência">🚶</button>
      <button class="btn-danger btn-icon-compact" style="background:rgba(0,0,0,0.06);color:var(--gray-600);" onclick="event.stopPropagation();deletePatientPermanently(${p.id},'${safeNome}')" title="Excluir Permanentemente">🔥</button>
    ` : `
      <button class="btn-reorder-arrow" title="Subir uma posição na fila" onclick="event.stopPropagation();movePatientArrow(${p.id},'${setor}','up')">↑</button>
      <button class="btn-reorder-arrow" title="Descer uma posição na fila" onclick="event.stopPropagation();movePatientArrow(${p.id},'${setor}','down')">↓</button>
      <button class="btn-reorder-pos btn-icon-compact" onclick="event.stopPropagation();openPositionModal(${p.id},'${safeNome}','${setor}')" title="Mudar posição na fila">🔢</button>
      <button class="btn-transfer-sector" onclick="event.stopPropagation();abrirModalEncaminharPublico(${p.id}, '${p.nome.replace(/'/g,"\\'")}', '${setor}')" title="Encaminhar para outro setor">↗️ Encaminhar</button>
    `;

    const rowCls = [
      'queue-item',
      p.status === 'chamado' ? 'calling' : '',
      isNextUp ? 'row-next-up' : '',
      isInterc ? 'row-intercorrencia' : ''
    ].filter(Boolean).join(' ');

    return `<tr class="${rowCls}" data-id="${p.id}" data-draggable="${isAdmin && p.status === 'aguardando'}">
      <td class="fila-pos-cell">
        <div style="display:flex;align-items:center;gap:4px;">
          ${p.status === 'aguardando' ? dragHandle : ''}
          <span class="fila-pos-badge" style="background:${p.status==='chamado'?'#b8860b':getColor(setor)}">${posLabel}</span>
          <span style="font-size:12px;font-weight:800;color:#475569;" title="Horário de chegada na recepção">🕐 ${p.horario || '—'}</span>
        </div>
        ${nextUpBadge ? `<div style="margin-top:4px;">${nextUpBadge}</div>` : ''}
        ${(setor === 'Odontologia' && p.horario_marcado) ? `<div style="margin-top:3px;"><span style="display:inline-block;padding:2px 6px;border-radius:6px;background:rgba(139,92,246,0.14);color:#5b21b6;border:1px solid rgba(139,92,246,0.35);font-size:11px;font-weight:900;" title="Horário marcado na Odontologia">📅 Marcado: ${escapeText(p.horario_marcado)}</span></div>` : ''}
        ${waitBadge ? `<div style="margin-top:4px;">${waitBadge}</div>` : ''}
      </td>
      <td>
        <div class="fila-paciente-nome">
          <span class="nome-texto">${escapeText(p.nome)}</span>
          ${prioBadge}
        </div>
        <div class="fila-paciente-sub">
          ${equipeBadge || '<span style="font-size:11px;color:#94a3b8;font-weight:700;">Sem equipe informada</span>'}
          ${condBadges}
        </div>
      </td>
      <td>
        ${historicoColHtml}
      </td>
      <td>
        ${profLabel}
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          ${tipoLabel}
          ${presencaHtml}
          ${statusBadge}
        </div>
        ${originBadge}
      </td>
      <td style="text-align:right;">
        <div class="fila-actions-cell">
          ${radarBtn}
          ${ actionButtons }
          ${qrBtn}
        </div>
      </td>
    </tr>`;
  }).join('');

  el.innerHTML = `<div class="fila-table-wrap">
    <table class="fila-clean-table">
      <thead>
        <tr>
          <th class="col-pos"># / Horário</th>
          <th class="col-paciente">Paciente &amp; Equipe</th>
          <th class="col-historico">Histórico / Motivo (1ª e 2ª Escuta)</th>
          <th class="col-status">Setor / Status Atual</th>
          <th class="col-acoes">Ações</th>
        </tr>
      </thead>
      <tbody class="sortable-tbody">
        ${rowsHtml}
      </tbody>
    </table>
  </div>`;

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
  /* === Mini-queues na Recepção em formato de TABELA limpa e alinhada === */
  SETORES.forEach(s => {
    const cfg = SECTOR_CONFIG[s];
    const el = document.getElementById('mini-queue-' + cfg.key); if (!el) return;
    const items = (queues[s] || []).filter(p => p.status !== 'atendido' && p.status !== 'desistencia');
    if (!items.length) { el.innerHTML = '<div class="empty-state" style="padding:18px;"><div class="es-icon">✅</div><p>Fila vazia</p></div>'; return; }

    let waitCounter = 0;
    const rowsHtml = items.map((p) => {
      const posLabel = p.status === 'chamado' ? '📢' : `#${++waitCounter}`;
      const isNextUp = p.status === 'aguardando' && waitCounter === 1;
      const nextUpBadge = isNextUp ? '<span class="badge-proximo-fila">👉 Próximo</span>' : '';
      const safeNome = p.nome.replace(/'/g, "\\'").replace(/"/g, '&quot;');
      const prioBadge = renderPrioridadeIdadeBadge(p);
      const waitBadge = renderEsperaNormalBadge(p);
      const intercorrenciaBadge = renderIntercorrenciaAcolhimentoBadge(p);
      const equipeBadge = renderEquipePacienteBadge(p);
      const isInterc = Boolean(p.is_intercorrencia_acolhimento) || p.tipo_atendimento === 'Intercorrência (Acolhimento)';
      const tipoLabel = (isInterc && p.tipo_atendimento === 'Intercorrência (Acolhimento)') ? '' : getTipoAtendimentoBadge(p.tipo_atendimento);
      const profLabel = p.profissional
        ? `<div style="font-size:12px;font-weight:800;color:var(--blue-dark);margin-bottom:2px;">👨‍⚕️ ${escapeText(p.profissional)}</div>`
        : `<div style="font-size:11px;font-weight:700;color:var(--gray-600);margin-bottom:2px;">${cfg.icon || '📋'} ${escapeText(s)}</div>`;
      const condBadges = renderCondicoesBadges(p.condicoes_especiais);
      const qrBtn = `<button class="btn-qr btn-icon-compact" onclick="event.stopPropagation();showQrModalById(${p.id})" title="Ver QR Code">📱</button>`;
      const radarBtn = !p.busca_ativa ? renderBotaoBuscaAtivaCard(p, 'Recepção') : '';
      const alumiaBloco = renderBlocoBuscaAtivaEquipe(p, 'Recepção');

      const motivo1 = (p.motivo_primeira_escuta || p.queixa || '').trim();
      const obs2 = (p.observacao_segunda_escuta || '').trim();
      const tagInterc = intercorrenciaBadge ? `<div style="margin-bottom:4px;">${intercorrenciaBadge}</div>` : '';
      const txtMotivo1 = motivo1
        ? `<div class="motivo-1"><span class="motivo-label">💬 1ª Escuta:</span> ${escapeText(motivo1)}</div>`
        : `<div class="motivo-vazio">Sem queixa registrada</div>`;
      const txtObs2 = obs2
        ? `<div class="motivo-2"><span class="motivo-label-2">🩺 2ª Escuta:</span> ${escapeText(obs2)}</div>`
        : '';
      const historicoColHtml = !document.body.classList.contains('modo-tv')
        ? `<div class="fila-motivo-box">${tagInterc}${txtMotivo1}${txtObs2}${alumiaBloco}</div>`
        : '';

      const removeBtn = isAdmin ? `
        <button class="btn-danger btn-icon-compact" onclick="event.stopPropagation();removePatient(${p.id},'${p.nome.replace(/'/g,"\\'")}')" title="Marcar como Desistência">🚶</button>
        <button class="btn-danger btn-icon-compact" style="background:rgba(0,0,0,0.06);color:var(--gray-600);" onclick="event.stopPropagation();deletePatientPermanently(${p.id},'${p.nome.replace(/'/g,"\\'")}')" title="Excluir Permanentemente">🔥</button>
      ` : '';

      let presencaHtml = '';
      let presencaBtn = '';
      if (['Médico','Enfermagem','Odontologia','Téc. Enfermagem'].includes(s)) {
        if (p.presenca_confirmada) {
          presencaHtml = '<span class="presenca-badge presenca-confirmada" title="Presença confirmada na recepção">🟢 PRESENTE</span>';
        } else if (p.status === 'aguardando') {
          presencaBtn = `<button class="btn-confirmar-presenca" onclick="event.stopPropagation();confirmarPresenca(${p.id},'${p.nome.replace(/'/g,"\\'")}')" title="Confirmar presença na recepção">✅ Presença</button>`;
        }
      }

      const transferBtn = `
        <button class="btn-reorder-arrow" title="Subir uma posição" onclick="event.stopPropagation();movePatientArrow(${p.id},'${s}','up')">↑</button>
        <button class="btn-reorder-arrow" title="Descer uma posição" onclick="event.stopPropagation();movePatientArrow(${p.id},'${s}','down')">↓</button>
        <button class="btn-reorder-pos btn-icon-compact" onclick="event.stopPropagation();openPositionModal(${p.id},'${safeNome}','${s}')" title="Ir para posição específica">🔢</button>
        <button class="btn-transfer-sector" onclick="event.stopPropagation();abrirModalEncaminharPublico(${p.id}, '${p.nome.replace(/'/g,"\\'")}', '${s}')" title="Encaminhar para outro setor">↗️ Encaminhar</button>
      `;

      const originBadge = p.origem_transferencia
        ? `<div style="font-size:10.5px;color:#475569;margin-top:3px;font-weight:700;">🔙 de: ${escapeText(p.origem_transferencia)}</div>`
        : '';

      const statusBadge = `<span class="queue-status ${p.status==='chamado'?'status-calling':'status-waiting'}">${p.status==='chamado'?'📢 Chamando':'Aguardando'}</span>`;

      const rowCls = [
        p.status === 'chamado' ? 'calling' : '',
        isNextUp ? 'row-next-up' : '',
        isInterc ? 'row-intercorrencia' : ''
      ].filter(Boolean).join(' ');

      return `<tr class="${rowCls}">
        <td class="fila-pos-cell">
          <div style="display:flex;align-items:center;gap:4px;">
            <span class="fila-pos-badge" style="background:${p.status==='chamado'?'#b8860b':getColor(s)}">${posLabel}</span>
            <span style="font-size:12px;font-weight:800;color:#475569;" title="Horário de chegada na recepção">🕐 ${p.horario || '—'}</span>
          </div>
          ${nextUpBadge ? `<div style="margin-top:4px;">${nextUpBadge}</div>` : ''}
          ${(s === 'Odontologia' && p.horario_marcado) ? `<div style="margin-top:3px;"><span style="display:inline-block;padding:2px 6px;border-radius:6px;background:rgba(139,92,246,0.14);color:#5b21b6;border:1px solid rgba(139,92,246,0.35);font-size:11px;font-weight:900;" title="Horário marcado na Odontologia">📅 Marcado: ${escapeText(p.horario_marcado)}</span></div>` : ''}
          ${waitBadge ? `<div style="margin-top:4px;">${waitBadge}</div>` : ''}
        </td>
        <td>
          <div class="fila-paciente-nome">
            <span class="nome-texto">${escapeText(p.nome)}</span>
            ${prioBadge}
          </div>
          <div class="fila-paciente-sub">
            ${equipeBadge || '<span style="font-size:11px;color:#94a3b8;font-weight:700;">Sem equipe informada</span>'}
            ${condBadges}
          </div>
        </td>
        <td>
          ${historicoColHtml}
        </td>
        <td>
          ${profLabel}
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:2px;">
            ${tipoLabel}
            ${presencaHtml}
            ${statusBadge}
          </div>
          ${originBadge}
        </td>
        <td style="text-align:right;">
          <div class="fila-actions-cell">
            ${presencaBtn}
            ${radarBtn}
            ${transferBtn}
            ${qrBtn}
            ${removeBtn}
          </div>
        </td>
      </tr>`;
    }).join('');

    el.innerHTML = `<div class="fila-table-wrap">
      <table class="fila-clean-table">
        <thead>
          <tr>
            <th class="col-pos"># / Horário</th>
            <th class="col-paciente">Paciente &amp; Equipe</th>
            <th class="col-historico">Histórico / Motivo (1ª e 2ª Escuta)</th>
            <th class="col-status">Setor / Status</th>
            <th class="col-acoes">Ações</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>`;
  });
}

function updateRecent() {
  const el = document.getElementById('recent-list');
  if (!el) return;
  const all = []; SETORES.forEach(s => all.push(...(queues[s] || [])));
  if (!all.length) { el.innerHTML = '<div class="empty-state" style="padding:16px;"><div class="es-icon">🗒️</div><p>Nenhum cadastro ainda</p></div>'; return; }
  const sorted = all.sort((a, b) => safeDate(b.created_at) - safeDate(a.created_at)).slice(0, 6);
  const rowsHtml = sorted.map((p, idx) => {
    const cfg = SECTOR_CONFIG[p.setor] || {};
    const prioBadge = renderPrioridadeIdadeBadge(p);
    const intercorrenciaBadge = renderIntercorrenciaAcolhimentoBadge(p);
    const equipeBadge = renderEquipePacienteBadge(p);
    const profLabel = p.profissional ? ` · ${escapeText(p.profissional)}` : '';
    const radarBtn = renderBotaoBuscaAtivaCard(p, 'Recepção');
    const motivo1 = (p.motivo_primeira_escuta || p.queixa || '').trim();
    const motivoHtml = motivo1 && !document.body.classList.contains('modo-tv')
      ? `<span style="color:#1e293b;font-weight:600;">💬 ${escapeText(motivo1)}</span>`
      : '<span style="color:#94a3b8;font-style:italic;font-size:12px;">—</span>';
    return `<tr>
      <td style="white-space:nowrap;font-weight:800;color:#475569;">🕐 ${p.horario || '—'}</td>
      <td>
        <div class="fila-paciente-nome">
          <span>${escapeText(p.nome)}</span> ${prioBadge} ${intercorrenciaBadge}
        </div>
        <div class="fila-paciente-sub">${equipeBadge || '<span style="font-size:11px;color:#94a3b8;">Sem equipe</span>'}</div>
      </td>
      <td>${motivoHtml}</td>
      <td><span style="font-weight:800;color:var(--blue-dark);">${cfg.icon || '📋'} ${escapeText(p.setor)}${profLabel}</span></td>
      <td style="text-align:right;"><div class="fila-actions-cell">${radarBtn}</div></td>
    </tr>`;
  }).join('');

  el.innerHTML = `<div class="fila-table-wrap">
    <table class="fila-clean-table">
      <thead>
        <tr>
          <th style="width:100px;">Horário</th>
          <th style="width:28%;">Paciente &amp; Equipe</th>
          <th>Motivo da 1ª Escuta</th>
          <th style="width:22%;">Destino Inicial</th>
          <th style="text-align:right;width:160px;">Busca Ativa</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>`;
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

let _lastPainelCallKey = null;

function updatePainelClock() {
  const timeEl = document.getElementById('painel-clock-time');
  const dateEl = document.getElementById('painel-clock-date');
  if (!timeEl && !dateEl) return;
  const now = new Date();
  if (timeEl) {
    timeEl.textContent = now.toLocaleTimeString('pt-BR', {
      timeZone: 'America/Recife', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }
  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString('pt-BR', {
      timeZone: 'America/Recife', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric'
    });
  }
}
updatePainelClock();
setInterval(updatePainelClock, 1000);

function formatarDestinoPainel(p) {
  const consEfetivo = p.setor === 'Odontologia' ? 'Odontológico' : p.consultorio;
  if (consEfetivo === 'Odontológico') return '🦷 Consultório Odontológico';
  if (consEfetivo === 'Sala de Procedimentos' || consEfetivo === 'Sala de Vacina') return `🏥 ${consEfetivo}`;
  if (consEfetivo) return `🏠 Consultório ${consEfetivo}`;
  const medLimpo = String(p.medico || '').replace(/\s*\(sem designa[çc][aã]o\)/gi, '').trim();
  if (medLimpo === '2ª Escuta' || /se dirija.*2ª escuta/i.test(medLimpo)) return '📍 Se dirija à 2ª Escuta';
  return `${(SECTOR_CONFIG[p.setor] || {}).icon || '📋'} ${p.setor}`;
}

function updatePainel() {
  const main = document.getElementById('painel-main');
  const countEl = document.getElementById('painel-history-count');
  
  // Ignorar transferências no painel (para não tocar som nem mostrar como "chamada")
  const callsOnly = (callHistory || []).filter(h => !(h.profissional || '').startsWith('➡️ Encaminhado'));
  if (countEl) countEl.textContent = `${callsOnly.length} ${callsOnly.length === 1 ? 'chamada' : 'chamadas'}`;

  if (callsOnly.length) {
    const l = callsOnly[0];
    const cfg = SECTOR_CONFIG[l.setor] || {};
    const prioBadge = l.prioridade === 'prioritario' ? `<div class="priority-badge-tv">⭐ ${escapeText(l.tipo_prioridade || 'PRIORITÁRIO')}</div>` : '';
    const destinoPrincipal = formatarDestinoPainel(l);
    let profLine = '';
    if (l.profissional) {
      profLine = `<div class="painel-prof-line">👨‍⚕️ ${escapeText(l.profissional)}</div>`;
    } else if (l.medico) {
      const medLimpo = String(l.medico).replace(/\s*\(sem designa[çc][aã]o\)/gi, '').trim();
      if (medLimpo && medLimpo !== '2ª Escuta' && !/se dirija.*2ª escuta/i.test(medLimpo)) {
        profLine = `<div class="painel-prof-line">👨‍⚕️ ${escapeText(medLimpo)}</div>`;
      }
    }

    const callKey = `${l.id || ''}_${l.nome}_${l.horario_chamada || ''}`;
    if (_lastPainelCallKey && _lastPainelCallKey !== callKey && main) {
      main.classList.remove('painel-flash');
      void main.offsetWidth;
      main.classList.add('painel-flash');
    }
    _lastPainelCallKey = callKey;

    main.innerHTML = `
      <div class="painel-call-pill"><span class="painel-call-dot"></span> CHAMANDO AGORA</div>
      <div class="painel-call-name">${escapeText(l.nome)}</div>
      <div class="painel-gate-box">
        <span class="painel-gate-label">DIRIJA-SE AO DESTINO (${escapeText(l.setor)})</span>
        <span class="painel-gate-value">${escapeText(destinoPrincipal)}</span>
      </div>
      ${profLine}
      ${prioBadge}
    `;
  } else {
    main.innerHTML = '<div class="painel-empty">⏳ Aguardando chamadas...</div>';
  }

  const histEl = document.getElementById('painel-history');
  if (!callsOnly.length) {
    histEl.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.35);padding:32px;font-size:14px;font-weight:600;">Nenhuma chamada registrada</div>';
    return;
  }
  histEl.innerHTML = callsOnly.map((p, i) => {
    const prioBadge = p.prioridade === 'prioritario' ? ' <span style="color:#fbbf24;font-weight:800;">⭐</span>' : '';
    const destino = formatarDestinoPainel(p);
    const profText = p.profissional ? p.profissional : (p.medico ? String(p.medico).replace(/\s*\(sem designa[çc][aã]o\)/gi, '').trim() : '');
    return `<div class="painel-fids-row ${i === 0 ? 'is-latest' : ''}">
      <div class="painel-fids-time">${escapeText(p.horario_chamada || '--:--')}</div>
      <div class="painel-fids-name">${escapeText(p.nome)}${prioBadge}</div>
      <div class="painel-fids-dest">${escapeText(destino)}${profText ? `<small>${escapeText(profText)}</small>` : ''}</div>
      <div style="text-align:center;">
        <button class="btn btn-ghost" onclick="speakViaSynthesis('${p.nome.replace(/'/g,"\\\\'")}','${p.setor}','${(p.medico||'').replace(/'/g,"\\\\'")}')" style="padding:5px 8px;font-size:13px;border-radius:8px;" title="Chamar novamente">🔊</button>
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
  { id:'geral', nome:'📢 Geral', desc:'Todos os setores e profissionais' },
  { id:'recepcao', nome:'🏢 Recepção', desc:'Comunicação da Recepção' },
  { id:'acolhimento', nome:'💜 Acolhimento', desc:'1ª e 2ª Escuta / Triagem' },
  { id:'medico', nome:'🩺 Médico', desc:'Comunicação da equipe médica' },
  { id:'enfermagem', nome:'👩‍⚕️ Enfermagem', desc:'Comunicação da equipe de enfermagem' },
  { id:'odontologia', nome:'🦷 Odontologia', desc:'Comunicação da equipe de odontologia' },
  { id:'farmacia', nome:'💊 Farmácia', desc:'Comunicação da Farmácia' },
  { id:'regulacao', nome:'📋 Regulação', desc:'Comunicação da Regulação' },
  { id:'gerencia', nome:'🏛️ Gerência', desc:'Comunicação da Gerência / Coordenação' }
];
let chatPanelOpen = false;
let chatNotifCanalDestino = 'geral';
let chatNotifTimer = null;
const ORIGINAL_DOC_TITLE = document.title;

function toggleChatPanel() {
  const overlay = document.getElementById('chat-drawer-overlay');
  if (!overlay) return;
  chatPanelOpen = !chatPanelOpen;
  if (chatPanelOpen) {
    overlay.classList.remove('chat-drawer-hidden');
    fecharNotificacaoChatPopup();
    const fab = document.getElementById('chat-fab');
    if (fab) fab.classList.remove('chat-fab-urgent', 'chat-fab-unread');
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
    markCanalAsRead(activeCanal);
    registerPresenca();
    renderCanalList();
    updateChatBadge();
    loadChatPin(activeCanal);
    setTimeout(() => {
      const c = document.getElementById('chat-messages');
      if (c) c.scrollTop = c.scrollHeight;
      const inp = document.getElementById('chat-input');
      if (inp) inp.focus();
    }, 50);
  } else {
    overlay.classList.add('chat-drawer-hidden');
  }
}

function updateChatBadge() {
  const totalUnread = Object.values(channelUnread).reduce((sum, val) => sum + (val || 0), 0);
  const badge = document.getElementById('badge-chat');
  if (badge) {
    badge.textContent = totalUnread;
    badge.style.display = totalUnread > 0 ? 'inline-block' : 'none';
  }
}

let activeCanal = 'geral';
let channelMessages = {};
let channelUnread = {};
let chatUrgent = false;
let typingTimeout = null;
CANAIS.forEach(c => { channelMessages[c.id] = []; channelUnread[c.id] = 0; });

// Restore saved setor e nome
const savedSetor = localStorage.getItem('chatSetor');
if (savedSetor) { setTimeout(() => { const sel = document.getElementById('chat-remetente'); if (sel) sel.value = savedSetor; }, 100); }
const savedChatNome = localStorage.getItem('chatNome');
if (savedChatNome) { setTimeout(() => { const inpNome = document.getElementById('chat-remetente-nome'); if (inpNome) inpNome.value = savedChatNome; }, 100); }

function onChatNomeChange() {
  const inpNome = document.getElementById('chat-remetente-nome');
  if (inpNome) localStorage.setItem('chatNome', inpNome.value.trim());
}

function onChatSetorChange() {
  const v = document.getElementById('chat-remetente').value;
  localStorage.setItem('chatSetor', v);
  renderCanalList();
}

function getVisibleCanais() {
  // Todos os 4 canais são visíveis para todos os setores
  return CANAIS;
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
  const canalToSetor = { geral:null, recepcao:'Recepção', acolhimento:'Acolhimento', farmacia:'Farmácia', regulacao:'Regulação', medico:'Médico', enfermagem:'Enfermagem', odontologia:'Odontologia', gerencia:'Gerência' };
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
    const unreadCls = unread > 0 ? ' has-unread' : '';
    const presenceDot = getPresenceDot(c.id);
    const msgs = channelMessages[c.id] || [];
    const last = msgs.length ? msgs[msgs.length - 1] : null;
    const titleTip = last ? `${last.autor}: ${(last.texto || last.anexo_nome || '').slice(0, 60)}` : c.desc;
    return `<button type="button" class="chat-canal-pill ${c.id===activeCanal?'active':''}${unreadCls}" onclick="switchCanal('${c.id}')" title="${escapeText(titleTip)}">${presenceDot}${c.nome}${badge}</button>`;
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

function mostrarNotificacaoChatPopup(canalId, msg) {
  const popup = document.getElementById('chat-notif-popup');
  if (!popup) return;
  const canalInfo = CANAIS.find(c => c.id === canalId) || { nome: '📢 Geral' };
  chatNotifCanalDestino = canalId;

  const canalEl = document.getElementById('chat-notif-canal');
  const autorEl = document.getElementById('chat-notif-autor');
  const textoEl = document.getElementById('chat-notif-texto');
  if (canalEl) canalEl.textContent = msg.urgente ? `🚨 URGENTE • ${canalInfo.nome}` : canalInfo.nome;
  if (autorEl) autorEl.textContent = msg.autor || 'Equipe';
  if (textoEl) textoEl.textContent = msg.texto || (msg.anexo_nome ? `📎 Anexo: ${msg.anexo_nome}` : 'Nova mensagem');

  popup.classList.toggle('urgent', Boolean(msg.urgente));
  popup.classList.add('show');

  if (chatNotifTimer) clearTimeout(chatNotifTimer);
  if (!msg.urgente) {
    chatNotifTimer = setTimeout(() => { fecharNotificacaoChatPopup(); }, 18000);
  }
}

function fecharNotificacaoChatPopup() {
  const popup = document.getElementById('chat-notif-popup');
  if (popup) popup.classList.remove('show');
  if (chatNotifTimer) { clearTimeout(chatNotifTimer); chatNotifTimer = null; }
}

function abrirChatNotificacao() {
  const targetCanal = chatNotifCanalDestino || 'geral';
  fecharNotificacaoChatPopup();
  if (!chatPanelOpen) toggleChatPanel();
  switchCanal(targetCanal);
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
        
        // Só toca o som e alerta se a mensagem não foi enviada por mim
        if (newLast.autor !== meuIdentificador && newLast.autor !== meuSetor) {
          playChatSound();
          if (newLast.urgente) {
            const fab = document.getElementById('chat-fab');
            if (fab && !chatPanelOpen) fab.classList.add('chat-fab-urgent');
          }
          if (!chatPanelOpen || activeCanal !== canalId) {
            mostrarNotificacaoChatPopup(canalId, newLast);
            if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
              const canalNome = (CANAIS.find(c => c.id === canalId)?.nome || canalId);
              const corpo = newLast.texto || (newLast.anexo_nome ? `📎 ${newLast.anexo_nome}` : 'Nova mensagem');
              const n = new Notification(`${newLast.urgente ? '🚨 URGENTE - ' : ''}${newLast.autor} (${canalNome})`, { body: corpo });
              n.onclick = () => { window.focus(); abrirChatNotificacao(); n.close(); };
            }
          }
        }
      }
    }
    
    channelMessages[canalId] = newMsgs; 
  } catch(e) { console.error(e); }
}

async function loadAllChannels() {
  await Promise.all(getVisibleCanais().map(c => loadChannelMessages(c.id)));
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
      const isImg = /\.(jpeg|jpg|png|gif|webp|bmp)$/i.test(m.anexo_nome) || String(m.anexo_base64).startsWith('data:image/');
      const safeAnexoNome = escapeText(m.anexo_nome).replace(/'/g, "\\'");
      if (isImg) {
        anexoHtml = `<div style="margin-top:8px;"><img src="${m.anexo_base64}" alt="${escapeText(m.anexo_nome)}" style="max-width:100%; max-height:200px; border-radius:8px; cursor:pointer; border:1px solid rgba(0,0,0,0.1);" onclick="abrirImagemChatModal(this.src, '${safeAnexoNome}')"></div>`;
      } else {
        anexoHtml = `<div style="margin-top:8px; background:rgba(0,0,0,0.06); padding:8px; border-radius:6px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <span style="font-size:12px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:200px;">📎 ${escapeText(m.anexo_nome)}</span>
          <a href="${m.anexo_base64}" download="${escapeText(m.anexo_nome)}" class="btn btn-sm btn-primary" style="padding:4px 8px; font-size:11px; text-decoration:none;">⬇️ Baixar</a>
        </div>`;
      }
    }

    const safePinTxt = (m.texto || m.anexo_nome || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ');
    const safeAutorJs = (m.autor || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const pinBtn = `<button class="pin-btn" onclick="event.stopPropagation();pinChatMessage('${safePinTxt}','${safeAutorJs}')" title="Fixar mensagem">📌</button>`;
    const cienteBtn = !isMe
      ? `<div><button type="button" class="chat-ciente-btn" onclick="enviarRespostaRapidaChat('👍 Ciente (${safeAutorJs})')">👍 Ciente</button></div>`
      : '';
    
    // Se não tiver texto, não renderiza a div de texto vazia
    const textHtml = m.texto ? `<div style="white-space:pre-wrap; word-break:break-word;">${escapeText(m.texto)}</div>` : '';

    return `<div class="chat-bubble ${isMe?'bubble-sent':'bubble-received'}${urgClass}">${pinBtn}<div class="chat-meta"><span>${urgTag}${escapeText(m.autor)}</span></div>${textHtml}${anexoHtml}${cienteBtn}<div class="chat-time">${t}</div></div>`;
  }).join('');
  c.scrollTop = c.scrollHeight;
}

let chatAttachment = null;

function abrirImagemChatModal(src, nome) {
  const modal = document.getElementById('chat-image-modal');
  const img = document.getElementById('chat-image-modal-img');
  const dl = document.getElementById('chat-image-modal-download');
  if (!modal || !img) return;
  img.src = src;
  if (dl) {
    dl.href = src;
    dl.download = nome || 'imagem-chat.jpg';
  }
  modal.classList.add('show');
}

function fecharImagemChatModal() {
  const modal = document.getElementById('chat-image-modal');
  if (modal) modal.classList.remove('show');
}

function removeChatAttachment() {
  chatAttachment = null;
  const inp = document.getElementById('chat-file-input');
  if (inp) inp.value = '';
  const prev = document.getElementById('chat-file-preview');
  if (prev) prev.style.display = 'none';
  const thumb = document.getElementById('chat-file-thumb');
  if (thumb) { thumb.src = ''; thumb.style.display = 'none'; }
  const nameEl = document.getElementById('chat-file-name');
  if (nameEl) nameEl.textContent = '';
}

function compressChatImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler imagem'));
    reader.onload = (ev) => {
      const img = new Image();
      img.onerror = () => resolve({ nome: file.name, base64: ev.target.result, isImage: true });
      img.onload = () => {
        const MAX_DIM = 1400;
        let w = img.width;
        let h = img.height;
        if (w > MAX_DIM || h > MAX_DIM) {
          if (w > h) { h = Math.round(h * (MAX_DIM / w)); w = MAX_DIM; }
          else { w = Math.round(w * (MAX_DIM / h)); h = MAX_DIM; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const compressed = canvas.toDataURL('image/jpeg', 0.82);
        const baseName = (file.name || 'imagem').replace(/\.[^.]+$/, '') + '.jpg';
        resolve({ nome: baseName, base64: compressed, isImage: true });
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function processarArquivoChat(file) {
  if (!file) return;
  const isImage = (file.type && file.type.startsWith('image/')) || /\.(jpeg|jpg|png|gif|webp|bmp)$/i.test(file.name || '');

  try {
    if (isImage) {
      const result = await compressChatImage(file);
      if (result.base64.length > 3500000) {
        showToast('Imagem muito grande mesmo após compressão.', true);
        return;
      }
      chatAttachment = { nome: result.nome, base64: result.base64 };
      const thumb = document.getElementById('chat-file-thumb');
      if (thumb) { thumb.src = result.base64; thumb.style.display = 'block'; }
      document.getElementById('chat-file-name').textContent = '🖼️ ' + result.nome;
      document.getElementById('chat-file-preview').style.display = 'flex';
    } else {
      if (file.size > 2.5 * 1024 * 1024) {
        showToast('Arquivo deve ter no máximo 2,5 MB.', true);
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        chatAttachment = { nome: file.name, base64: ev.target.result };
        const thumb = document.getElementById('chat-file-thumb');
        if (thumb) { thumb.src = ''; thumb.style.display = 'none'; }
        document.getElementById('chat-file-name').textContent = '📎 ' + file.name;
        document.getElementById('chat-file-preview').style.display = 'flex';
      };
      reader.readAsDataURL(file);
    }
  } catch (err) {
    showToast('Não foi possível processar o anexo.', true);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('chat-file-input');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) processarArquivoChat(file);
    });
  }

  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.addEventListener('paste', (e) => {
      const items = (e.clipboardData || window.clipboardData)?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            processarArquivoChat(new File([file], `print-${Date.now()}.png`, { type: file.type }));
            break;
          }
        }
      }
    });
  }

  const drawer = document.getElementById('chat-drawer-overlay');
  if (drawer) {
    drawer.addEventListener('dragover', (e) => {
      e.preventDefault();
      drawer.classList.add('chat-drop-active');
    });
    drawer.addEventListener('dragleave', () => {
      drawer.classList.remove('chat-drop-active');
    });
    drawer.addEventListener('drop', (e) => {
      e.preventDefault();
      drawer.classList.remove('chat-drop-active');
      const file = e.dataTransfer?.files?.[0];
      if (file) processarArquivoChat(file);
    });
  }
});

function usarAtalhoChat(texto) {
  const inp = document.getElementById('chat-input');
  if (!inp) return;
  inp.value = texto;
  inp.focus();
  handleChatTyping();
}

async function enviarRespostaRapidaChat(texto) {
  const inp = document.getElementById('chat-input');
  if (!inp) return;
  inp.value = texto;
  await sendChatChannelMessage();
}

async function sendChatChannelMessage() {
  if (navigator.onLine === false) {
    if (typeof atualizarStatusConexao === 'function') atualizarStatusConexao('offline', 'Navegador sem internet');
    showToast('🔴 Sem internet! Não foi possível enviar a mensagem.', true);
    return;
  }
  const setor = document.getElementById('chat-remetente')?.value || 'Equipe';
  const nome = document.getElementById('chat-remetente-nome')?.value.trim() || '';
  if (nome) localStorage.setItem('chatNome', nome);
  const autor = nome ? `${nome} (${setor})` : setor;
  
  const inp = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send-btn');
  const texto = inp.value.trim();
  
  if (!texto && !chatAttachment) return;
  if (!activeCanal) { activeCanal = 'geral'; }
  
  try {
    inp.disabled = true;
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '⏳'; }
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
      if (typeof registrarSucessoRede === 'function') registrarSucessoRede();
      const msg = await r.json();
      inp.value = ''; 
      inp.style.height = 'auto';
      chatUrgent = false; 
      document.getElementById('chat-urgent-btn').classList.remove('active');
      removeChatAttachment(); // Limpar anexo após envio
      
      // Injeta a mensagem localmente para feedback instantâneo (contorna limitações do Vercel Serverless)
      if (!channelMessages[activeCanal]) channelMessages[activeCanal] = [];
      if (!channelMessages[activeCanal].some(m => m.id === msg.id)) {
        channelMessages[activeCanal].push(msg);
      }
      renderChannelChat();
      renderCanalList();
      setTimeout(() => { const c = document.getElementById('chat-messages'); if (c) c.scrollTop = c.scrollHeight; }, 50);
    }
    else {
      const err = await r.json().catch(() => ({}));
      showToast(`Erro: ${err.error || 'Falha ao enviar'}`, true);
    }
  } catch (e) { 
    console.error('Chat send error:', e);
    if (typeof isErroDeRede === 'function' && isErroDeRede(e)) {
      if (typeof registrarFalhaRede === 'function') registrarFalhaRede(e);
      showToast('🔴 Sem conexão com a internet ao enviar no chat!', true);
    } else {
      showToast('Erro de conexão com o chat!', true); 
    }
  }
  finally {
    inp.disabled = false;
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '🚀'; }
    inp.focus();
  }
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
  pedirSenhaAdmin('Limpar Canal de Chat', async (senhaUsada) => {
    try {
      const r = await fetch(`${API_URL}/chat/canais/${activeCanal}/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senha: senhaUsada })
      });
      if (r.status === 403) { showToast('❌ Senha incorreta!', true); return; }
      if (r.ok) {
        channelMessages[activeCanal] = [];
        renderChannelChat();
        showToast('🗑️ Canal limpo com sucesso!');
      }
    } catch { showToast('Erro ao limpar canal!', true); }
  });
}

function updateChatBadge() {
  const b = document.getElementById('badge-chat');
  const fab = document.getElementById('chat-fab');
  const hdrAlert = document.getElementById('header-chat-alert');
  const hdrTxt = document.getElementById('header-chat-alert-text');
  const total = Object.values(channelUnread).reduce((s,v) => s+(v||0), 0);
  if (b) {
    if (total > 0) { b.textContent = total; b.style.display = 'inline-block'; b.classList.add('badge-pulse'); }
    else { b.style.display = 'none'; b.classList.remove('badge-pulse'); }
  }
  if (fab) {
    fab.classList.toggle('chat-fab-unread', total > 0 && !chatPanelOpen);
  }
  if (hdrAlert && hdrTxt) {
    hdrAlert.classList.toggle('show', total > 0 && !chatPanelOpen);
    hdrTxt.textContent = total === 1 ? '1 nova msg' : `${total} novas msgs`;
  }
  document.title = (total > 0 && !chatPanelOpen)
    ? `(${total}) 💬 Nova mensagem! - ${ORIGINAL_DOC_TITLE}`
    : ORIGINAL_DOC_TITLE;
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

// ====== DICIONÁRIO E CACHE DE PROFISSIONAIS (com profissão garantida) ======
const PROFISSOES_DEFAULT = {
  'dra. juliana cavalcante': 'Cirurgiã-Dentista – Estratégia Saúde da Família',
  'juliana cavalcante': 'Cirurgiã-Dentista – Estratégia Saúde da Família',
  'dra. mirela mota': 'Clínica Geral – Médica da Estratégia Saúde da Família',
  'mirela mota': 'Clínica Geral – Médica da Estratégia Saúde da Família',
  'dr. israel christian': 'Médico – Estratégia Saúde da Família',
  'israel christian': 'Médico – Estratégia Saúde da Família',
  'dr. joene halan': 'Médico – Estratégia Saúde da Família',
  'joene halan': 'Médico – Estratégia Saúde da Família',
  'jorge marcio': 'Enfermeiro – Estratégia Saúde da Família',
  'mariana vaz': 'Enfermeira – Estratégia Saúde da Família',
  'lucelia de abreu': 'Enfermeira – Estratégia Saúde da Família',
  'viviane': 'Técnica de Enfermagem',
  'vilma': 'Técnica de Enfermagem',
  'fernando': 'Técnico de Enfermagem'
};

let profissionaisCache = new Map(); // nome -> profissao
async function carregarProfissionaisCache() {
  try {
    const r = await fetch(`${API_URL}/profissionais`);
    if (!r.ok) return;
    const list = await r.json();
    profissionaisCache.clear();
    list.forEach(p => {
      if (p.nome && p.profissao) {
        profissionaisCache.set(p.nome.trim(), p.profissao.trim());
      }
    });
  } catch(e) { /* silencioso */ }
}
carregarProfissionaisCache();

function getProfissaoProfissional(nome) {
  if (!nome) return '';
  const raw = String(nome).trim();
  if (!raw || raw.toLowerCase() === 'a definir') return '';
  
  // Se o próprio nome já tiver a profissão (ex: "Nome – Cargo"), não duplica
  if (raw.includes('–') || raw.includes(' - ')) {
    return '';
  }

  // 1. Busca no cache dinâmico da API
  if (profissionaisCache.has(raw) && profissionaisCache.get(raw)) {
    return profissionaisCache.get(raw);
  }

  // 2. Busca no dicionário garantido (case-insensitive e sem prefixos)
  const norm = raw.toLowerCase();
  if (PROFISSOES_DEFAULT[norm]) {
    return PROFISSOES_DEFAULT[norm];
  }

  const semPrefixo = norm.replace(/^(dr\.|dra\.|enf\.|tec\.|dr|dra)\s*/i, '').trim();
  for (const [k, v] of Object.entries(PROFISSOES_DEFAULT)) {
    const kSem = k.replace(/^(dr\.|dra\.|enf\.|tec\.|dr|dra)\s*/i, '').trim();
    if (kSem === semPrefixo || (semPrefixo.length >= 4 && (kSem.includes(semPrefixo) || semPrefixo.includes(kSem)))) {
      return v;
    }
  }

  // 3. Busca parcial no cache dinâmico
  for (const [k, v] of profissionaisCache.entries()) {
    const kNorm = k.toLowerCase().replace(/^(dr\.|dra\.|enf\.|tec\.|dr|dra)\s*/i, '').trim();
    if (kNorm === semPrefixo || (semPrefixo.length >= 4 && (kNorm.includes(semPrefixo) || semPrefixo.includes(kNorm)))) {
      return v;
    }
  }

  return '';
}

// ====== PERÍODO DO DIA ======
function getPeriodoDia(horario) {
  const h = parseInt((horario || '').split(':')[0], 10);
  if (isNaN(h)) return '';
  if (h >= 5 && h < 12) return 'de manhã ☀️';
  if (h >= 12 && h < 18) return 'à tarde 🌤️';
  return 'à noite 🌙';
}

// ====== ORIENTAÇÃO POR TIPO DE ATENDIMENTO ======
const ORIENTACOES_TIPO = {
  'Odontologia': '* Faça a higiene bucal antes da consulta.',
  'Cirurgiã-Dentista': '* Faça a higiene bucal antes da consulta.',
  '_default': '* Leve exames recentes, se houver, e a lista de medicamentos em uso.'
};

function getOrientacaoTipo(tipoAtendimento, profissionalNome) {
  // Primeiro tenta pelo tipo de atendimento
  if (tipoAtendimento && ORIENTACOES_TIPO[tipoAtendimento]) {
    return ORIENTACOES_TIPO[tipoAtendimento];
  }
  // Depois verifica pela profissão do profissional (se é dentista)
  const profissao = getProfissaoProfissional(profissionalNome) || '';
  const nomeLower = (profissionalNome || '').toLowerCase();
  if (profissao.toLowerCase().includes('dentista') || nomeLower.includes('juliana')) {
    return ORIENTACOES_TIPO['Cirurgiã-Dentista'];
  }
  return ORIENTACOES_TIPO['_default'];
}

const MAPS_LINK_USF = 'https://maps.google.com/?q=USF+Chico+Mendes+Recife';

// ====== MAPA DE IMAGENS POR TIPO DE CONSULTA ======
const IMAGENS_TIPO_CONSULTA = {
  'Pré-Natal':      '/img/confirmacao-prenatal.jpeg',
  'Clínico Geral':  '/img/confirmacao-clinico.jpeg',
  'Puericultura':   '/img/confirmacao-puericultura.jpeg',
  'Odontologia':    '/img/confirmacao-odontologia.jpeg',
  '_default':       '/img/confirmacao.jpg'
};

// Variável que armazena o path da imagem atual do modal WA
let _waCurrentImageSrc = '/img/confirmacao.jpg';

// Retorna o path da imagem de confirmação com base no tipo de atendimento ou profissional
function getImagemTipoConsulta(tipoAtendimento, profissionalNome) {
  // 1. Busca direta pelo tipo de atendimento
  if (tipoAtendimento && IMAGENS_TIPO_CONSULTA[tipoAtendimento]) {
    return IMAGENS_TIPO_CONSULTA[tipoAtendimento];
  }
  // 2. Para tipos genéricos: "Consulta" sem especificação → Clínico Geral
  if (tipoAtendimento === 'Consulta' || tipoAtendimento === 'Retorno' || tipoAtendimento === 'Hiperdia') {
    // Verifica se o profissional é dentista → usa imagem de Odontologia
    const profissao = getProfissaoProfissional(profissionalNome) || '';
    const nomeLower = (profissionalNome || '').toLowerCase();
    if (profissao.toLowerCase().includes('dentista') || nomeLower.includes('juliana')) {
      return IMAGENS_TIPO_CONSULTA['Odontologia'];
    }
    return IMAGENS_TIPO_CONSULTA['Clínico Geral'];
  }
  // 3. Sem tipo definido: tenta inferir pelo profissional
  if (!tipoAtendimento || tipoAtendimento === '') {
    const profissao = getProfissaoProfissional(profissionalNome) || '';
    const nomeLower = (profissionalNome || '').toLowerCase();
    if (profissao.toLowerCase().includes('dentista') || nomeLower.includes('juliana')) {
      return IMAGENS_TIPO_CONSULTA['Odontologia'];
    }
  }
  // 4. Fallback: imagem genérica
  return IMAGENS_TIPO_CONSULTA['_default'];
}

// Atualiza o preview de imagem no modal WA
function updateWaImagePreview(tipoAtendimento, profissionalNome) {
  const imgSrc = getImagemTipoConsulta(tipoAtendimento, profissionalNome);
  _waCurrentImageSrc = imgSrc;
  const container = document.getElementById('wa-img-preview-container');
  const imgEl = document.getElementById('wa-img-preview');
  const label = document.getElementById('wa-img-preview-label');
  if (container && imgEl) {
    imgEl.src = imgSrc;
    container.style.display = 'block';
    // Label descritivo
    const tipoLabel = tipoAtendimento || 'Consulta';
    if (label) label.textContent = `📎 Confirmação de Consulta – ${tipoLabel}`;
  }
}
// ====== FIM MAPA DE IMAGENS ======

const WA_TEMPLATES = {
  lembrete: `Lembrete de Consulta – USF Chico Mendes 🏥\n\n👤 Paciente: [NOME]\n📅 Data: [DATA]\n⏰ Horário: [HORARIO]\n👨‍⚕️ Profissional: [PROFISSIONAL]\n📍 Local: Unidade de Saúde da Família Chico Mendes\n\n📋 Orientações importantes:\n* Leve documentos pessoais e cartão do SUS\n[ORIENTACAO_TIPO]\n[OBS]\n\n💬 Em caso de dúvidas, fale com seu agente de saúde.\nEstamos aqui para cuidar de você. 💙`,
  confirmacao: `Confirmação de Consulta – USF Chico Mendes 🏥\n\n👤 Paciente: [NOME]\n📅 Data: [DATA]\n⏰ Horário: [HORARIO]\n👨‍⚕️ Profissional: [PROFISSIONAL]\n📍 Local: Unidade de Saúde da Família Chico Mendes\n\n📋 Orientações importantes:\n* Leve documentos pessoais e cartão do SUS\n[ORIENTACAO_TIPO]\n[OBS]\n\n💬 Em caso de dúvidas, fale com seu agente de saúde.\nEstamos aqui para cuidar de você. 💙`,
  reagendamento: `Olá [NOME]! 🔄\n\nInformamos que sua consulta na *USF Chico Mendes* foi *REAGENDADA*:\n\n📅 Nova data: [DATA]\n⏰ Novo horário: [HORARIO]\n👨‍⚕️ [PROFISSIONAL]\n\n[OBS]\n\nPedimos desculpas pelo inconveniente.\n*USF Chico Mendes* 🏥`,
  preparo_exames: `Lembrete de Coleta – USF Chico Mendes\n\nOlá, [NOME]!\n📅 Data da coleta: [DATA]\n⏰ Horário: [HORARIO]\n👨‍⚕️ Responsável: [PROFISSIONAL]\n\n📋 Checklist dos seus exames:\n[EXAMES]\n\n📍 Local: Unidade de Saúde da Família Chico Mendes\n💬 Em caso de dúvidas, fale com seu agente de saúde. 💙`,
  // === MELHORIA 7: Template de cancelamento de consulta ===
  cancelamento: `Olá, [NOME]! 🏥\n\nInformamos que sua consulta na *USF Chico Mendes* agendada para o dia *[DATA]* às *[HORARIO]* foi *cancelada*.\n\nEm breve entraremos em contato para confirmar o *reagendamento para uma nova data*.\n\nPedimos desculpas pelo transtorno e agradecemos a compreensão. 💙\n\n— *USF Chico Mendes*`,
  // === LEMBRETE D-1: Template de lembrete para o dia anterior à consulta ===
  lembrete_d1: `Olá, [NOME]! 🏥\n\nLembrando que sua consulta na *USF Chico Mendes* está marcada para *amanhã*:\n\n📅 Data: [DATA]\n⏰ Horário: [HORARIO]\n👨‍⚕️ Profissional: [PROFISSIONAL]\n📍 Local: Unidade de Saúde da Família Chico Mendes\n\n📋 Orientações importantes:\n* Leve documentos pessoais e cartão do SUS\n[ORIENTACAO_TIPO]\n\n💬 Em caso de dúvidas, fale com seu agente de saúde.\nContamos com a sua presença! 💙\n\n— *USF Chico Mendes*`
};

// === MELHORIA 7: Constante de texto para reutilização ===
const TEXTO_CANCELAMENTO = 'Olá! Informamos que sua consulta foi cancelada e será reagendada para uma nova data. Em breve entraremos em contato para confirmar o novo horário. Pedimos desculpas pelo transtorno e agradecemos a compreensão.\n— USF Chico Mendes';

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
  // Profissional com profissão
  const profNome = (agend.profissional || '').trim() || 'A definir';
  let profCompleto = profNome;
  if (profNome !== 'A definir') {
    const profissao = getProfissaoProfissional(profNome);
    if (profissao && !profNome.includes(profissao)) {
      profCompleto = `${profNome} – ${profissao}`;
    }
  }
  // Horário com período do dia
  const periodo = getPeriodoDia(agend.horario);
  const horarioCompleto = periodo ? `${agend.horario} – ${periodo}` : agend.horario;
  // Orientação por tipo
  const orientacao = getOrientacaoTipo(agend.tipo_atendimento, agend.profissional);
  // Observação
  const obsTexto = agend.observacoes ? `📝 Obs: ${agend.observacoes}` : '';
  return tpl.replace(/\[NOME\]/g, agend.nome).replace(/\[DATA\]/g, dataFmt).replace(/\[HORARIO\]/g, horarioCompleto)
    .replace(/\[PROFISSIONAL\]/g, profCompleto).replace(/\[TIPO\]/g, agend.tipo_atendimento||'Consulta')
    .replace(/\[OBS\]/g, obsTexto).replace(/\[EXAMES\]/g, exames||'Consulte a unidade')
    .replace(/\[MAPS_LINK\]/g, MAPS_LINK_USF)
    .replace(/\[ORIENTACAO_TIPO\]/g, orientacao);
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
  const equipe = document.getElementById('agend-equipe')?.value || null;
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
    const r = await fetch(`${API_URL}/agendamentos`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({nome,telefone,data_agendamento,horario,profissional,tipo_atendimento,template,observacoes,checklist_exames,equipe})
    });
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

let _agendamentosAtuais = [];

async function loadAgendamentos() {
  const data = document.getElementById('agend-filter-data')?.value || '';
  const status = document.getElementById('agend-filter-status')?.value || '';
  const params = new URLSearchParams(); if (data) params.set('data',data); if (status) params.set('status',status);
  try {
    const r = await fetch(`${API_URL}/agendamentos?${params}`);
    const list = await r.json();
    _agendamentosAtuais = Array.isArray(list) ? list : [];
    renderAgendamentos(_agendamentosAtuais);
    loadColetasStats();
    loadRelatorioMensagens();
    loadHistoricoAgendamentos();
    loadLembretesD1(); // Carregar painel de lembretes D-1
  } catch { showToast('Erro ao carregar agendamentos', true); }
}

// ====== LEMBRETES D-1 (Painel de lembretes para consultas de amanhã) ======

// Calcula a data de amanhã no fuso de São Paulo
function getAmanhaSP() {
  const now = new Date();
  // Usar Intl para obter a data no fuso de SP
  const spDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const [y, m, d] = spDateStr.split('-').map(Number);
  const amanha = new Date(y, m - 1, d + 1);
  return amanha.toISOString().split('T')[0]; // YYYY-MM-DD
}

async function loadLembretesD1() {
  const container = document.getElementById('lembretes-d1-list');
  const badge = document.getElementById('lembretes-d1-count');
  if (!container) return;
  
  try {
    const amanha = getAmanhaSP();
    const r = await fetch(`${API_URL}/agendamentos?data=${amanha}`);
    const list = await r.json();
    // Filtra apenas agendamentos ativos (não cancelados)
    const ativos = list.filter(a => a.status !== 'cancelado');
    renderLembretesD1(ativos, amanha);
    
    // Atualizar badge
    if (badge) {
      if (ativos.length > 0) {
        badge.textContent = ativos.length;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    }
  } catch (e) {
    console.error('Erro ao carregar lembretes D-1:', e);
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray-500);font-size:13px;">Erro ao carregar lembretes</div>';
  }
}

function renderLembretesD1(list, dataAmanha) {
  const container = document.getElementById('lembretes-d1-list');
  if (!container) return;

  if (!list.length) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray-500);font-size:13px;">✅ Nenhuma consulta agendada para amanhã.</div>';
    return;
  }

  const dataFmt = new Date(dataAmanha + 'T12:00:00').toLocaleDateString('pt-BR');
  
  container.innerHTML = list.map(a => {
    const tipoLabel = a.tipo_atendimento || 'Consulta';
    const profNome = (a.profissional || '').trim() || 'A definir';
    let profCompleto = profNome;
    if (profNome !== 'A definir') {
      const profissao = getProfissaoProfissional(profNome);
      if (profissao && !profNome.includes(profissao)) {
        profCompleto = `${profNome} – ${profissao}`;
      }
    }
    
    // Cor do badge do tipo
    const tipoCores = {
      'Pré-Natal': { bg: 'rgba(233,30,99,0.12)', color: '#c2185b' },
      'Puericultura': { bg: 'rgba(156,39,176,0.12)', color: '#7b1fa2' },
      'Odontologia': { bg: 'rgba(0,150,136,0.12)', color: '#00796b' },
      'Clínico Geral': { bg: 'rgba(26,79,196,0.12)', color: '#1a4fc4' },
      'Coleta de Sangue': { bg: 'rgba(229,57,53,0.12)', color: '#c62828' },
    };
    const corTipo = tipoCores[tipoLabel] || { bg: 'rgba(26,79,196,0.08)', color: 'var(--blue)' };
    
    // Status visual
    const jaEnviado = a.status === 'lembrete_enviado' || a.status === 'confirmado';
    const statusHtml = jaEnviado 
      ? `<span style="font-size:10px;font-weight:800;padding:2px 8px;border-radius:12px;background:rgba(74,171,60,0.15);color:#2d7a22;text-transform:uppercase;">✅ ${a.status === 'confirmado' ? 'Confirmado' : 'Lembrete Enviado'}</span>`
      : `<span style="font-size:10px;font-weight:800;padding:2px 8px;border-radius:12px;background:rgba(249,200,35,0.2);color:#b8860b;text-transform:uppercase;">⏳ Pendente</span>`;

    // Imagem do tipo (para preview rápido)
    const imgSrc = getImagemTipoConsulta(a.tipo_atendimento, a.profissional);

    return `<div style="display:flex;align-items:center;gap:14px;padding:14px 16px;background:white;border-radius:12px;border-left:5px solid ${corTipo.color};box-shadow:0 2px 8px rgba(0,0,0,0.06);margin-bottom:8px;transition:all 0.2s;" onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 4px 14px rgba(0,0,0,0.1)'" onmouseout="this.style.transform='';this.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'">
      <!-- Thumbnail da imagem -->
      <div style="flex-shrink:0;width:60px;height:40px;border-radius:6px;overflow:hidden;border:1px solid var(--gray-200);">
        <img src="${imgSrc}" style="width:100%;height:100%;object-fit:cover;" alt="${tipoLabel}" />
      </div>
      <!-- Info do paciente -->
      <div style="flex:1;min-width:0;">
        <div style="font-family:'Nunito',sans-serif;font-weight:800;font-size:14px;color:var(--blue-dark);margin-bottom:2px;">${a.nome}</div>
        <div style="font-size:12px;color:var(--gray-600);font-weight:600;display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
          <span>⏰ ${a.horario}</span>
          <span>👨‍⚕️ ${profCompleto}</span>
          <span style="background:${corTipo.bg};color:${corTipo.color};padding:1px 8px;border-radius:10px;font-size:10px;font-weight:800;">${tipoLabel}</span>
          ${statusHtml}
        </div>
      </div>
      <!-- Ações -->
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button onclick="openWaPreview(${a.id}, 'lembrete_d1')" title="Enviar Lembrete D-1 via WhatsApp" style="background:#25D366;color:white;border:none;border-radius:8px;padding:8px 12px;font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:4px;box-shadow:0 2px 8px rgba(37,211,102,0.3);transition:all 0.15s;" onmouseover="this.style.background='#1fb855'" onmouseout="this.style.background='#25D366'">
          📲 Lembrete
        </button>
        <button onclick="abrirModalEditarEnvio(${a.id}, 'cancelado')" title="Cancelar Consulta" style="background:var(--red);color:white;border:none;border-radius:8px;padding:8px 10px;font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:4px;box-shadow:0 2px 8px rgba(229,57,53,0.3);transition:all 0.15s;">
          ❌ Cancelar
        </button>
        <button onclick="abrirModalEditarEnvio(${a.id}, 'reagendado')" title="Reagendar Consulta" style="background:#e67e22;color:white;border:none;border-radius:8px;padding:8px 10px;font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:4px;box-shadow:0 2px 8px rgba(230,126,34,0.3);transition:all 0.15s;">
          🔄 Reagendar
        </button>
        <button onclick="_waCurrentImageSrc=getImagemTipoConsulta('${(a.tipo_atendimento||'').replace(/'/g, "\\'")}','${(a.profissional||'').replace(/'/g, "\\'")}');copyWaImageToClipboard()" title="Copiar imagem de confirmação" style="background:var(--gray-100);border:1px solid var(--gray-200);border-radius:8px;padding:8px 10px;font-size:13px;cursor:pointer;transition:all 0.15s;" onmouseover="this.style.background='var(--gray-200)'" onmouseout="this.style.background='var(--gray-100)'">
          🖼️
        </button>
        <button onclick="excluirLembreteD1(${a.id}, '${(a.nome||'').replace(/'/g, "\\'")}')" title="Excluir lembrete" style="background:rgba(229,57,53,0.1);border:1px solid rgba(229,57,53,0.25);border-radius:8px;padding:8px 10px;font-size:14px;cursor:pointer;transition:all 0.15s;color:var(--red);" onmouseover="this.style.background='rgba(229,57,53,0.2)'" onmouseout="this.style.background='rgba(229,57,53,0.1)'">
          🗑️
        </button>
      </div>
    </div>`;
  }).join('');
}

// ====== FIM LEMBRETES D-1 ======

async function excluirLembreteD1(id, nomePaciente) {
  if (!confirm(`Excluir o lembrete de ${nomePaciente}? Esta ação é permanente e removerá o agendamento.`)) return;
  try {
    const r = await fetch(`${API_URL}/agendamentos/${id}`, { method: 'DELETE' });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      showToast(`Erro ao excluir: ${err.error || r.status}`, true);
      return;
    }
    showToast(`✅ Lembrete de ${nomePaciente} excluído!`);
    loadLembretesD1(); // Recarrega o painel
  } catch (e) {
    console.error('Erro ao excluir lembrete D-1:', e);
    showToast('Erro ao excluir lembrete!', true);
  }
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
        <button class="btn-editar-envio" onclick="abrirModalEditarEnvio(${a.id}, 'cancelado')" title="Cancelar Consulta" style="background:var(--red);color:#fff;padding:4px 8px;font-size:11px;font-weight:700;border:none;border-radius:6px;cursor:pointer;">❌ Cancelar</button>
        <button class="btn-editar-envio" onclick="abrirModalEditarEnvio(${a.id}, 'reagendado')" title="Reagendar Consulta" style="background:#e67e22;color:#fff;padding:4px 8px;font-size:11px;font-weight:700;border:none;border-radius:6px;cursor:pointer;">🔄 Reagendar</button>
        <button onclick="openWaPreview(${a.id})" title="WhatsApp">📲</button>
        <button onclick="updateAgendStatus(${a.id},'lembrete_enviado')" title="Marcar lembrete">📨</button>
        <button onclick="updateAgendStatus(${a.id},'confirmado')" title="Confirmado">✅</button>
        <button onclick="abrirEdicaoAgendamento(${a.id}, '${a.nome.replace(/'/g,"\\'").trim()}', '${a.telefone.replace(/'/g,"\\'").trim()}')" title="Editar Contato">✏️</button>
        <button onclick="deleteAgendamento(${a.id})" title="Apagar Registro do Banco" style="color:var(--red);">🗑️</button>
      </div></td></tr>`;
  }).join('');
}

async function updateAgendStatus(id, status) {
  try {
    await fetch(`${API_URL}/agendamentos/${id}/status`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status}) });
    showToast('Status atualizado!'); 
    loadAgendamentos();

    if (status === 'lembrete_enviado') {
      try {
        const r2 = await fetch(`${API_URL}/agendamentos`);
        const list = await r2.json();
        const agend = list.find(a => a.id === id);
        if (agend) {
          await registrarMensagemEnviada(agend);
          loadRelatorioMensagens();
        }
      } catch(e) {}
    }

    // === MELHORIA 7: Abrir preview de cancelamento via WhatsApp automaticamente ===
    if (status === 'cancelado') {
      try {
        const r2 = await fetch(`${API_URL}/agendamentos`);
        const list = await r2.json();
        const agend = list.find(a => a.id === id);
        if (agend && agend.telefone) {
          const cancelMsg = buildWaMessage({ ...agend, template: 'cancelamento' });
          document.getElementById('wa-preview-text').textContent = cancelMsg;
          const phone = agend.telefone.replace(/\D/g, '');
          // === MELHORIA 6: Usar web.whatsapp.com/send ===
          _waCurrentUrl = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(cancelMsg)}`;
          _waModalAgendAtual = { ...agend, template: 'cancelamento' };
          // Atualizar preview de imagem por tipo de consulta
          updateWaImagePreview(agend.tipo_atendimento, agend.profissional);
          document.getElementById('wa-modal').classList.add('show');
        }
      } catch(e) { /* silencioso se falhar */ }
    }
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

// Variável para rastrear agendamento atual no modal WA (para registro de envio)
let _waModalAgendAtual = null;
let _waCurrentUrl = '';

async function openWaPreview(id, overrideTemplate) {
  try {
    const r = await fetch(`${API_URL}/agendamentos`);
    const list = await r.json();
    const agend = list.find(a => a.id === id);
    if (!agend) return;
    // Permite override do template (ex: lembrete_d1)
    const agendComTemplate = overrideTemplate ? { ...agend, template: overrideTemplate } : agend;
    _waModalAgendAtual = agendComTemplate;
    const msg = buildWaMessage(agendComTemplate);
    document.getElementById('wa-preview-text').textContent = msg;
    const phone = agend.telefone.replace(/\D/g,'');
    _waCurrentUrl = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(msg)}`;
    // Atualizar preview de imagem por tipo de consulta
    updateWaImagePreview(agend.tipo_atendimento, agend.profissional);
    document.getElementById('wa-modal').classList.add('show');
  } catch { showToast('Erro!', true); }
}

async function abrirWhatsAppEEnviar() {
  if (!_waCurrentUrl) return;
  if (_waModalAgendAtual) {
    await registrarMensagemEnviada(_waModalAgendAtual);
    loadRelatorioMensagens();
  }
  window.open(_waCurrentUrl, '_blank');
}

// Registra o envio de mensagem no backend
async function registrarMensagemEnviada(agend) {
  if (!agend) return;
  try {
    await fetch(`${API_URL}/mensagens-enviadas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agendamento_id: agend.id || null,
        profissional: agend.profissional || null,
        paciente: agend.nome || 'Paciente',
        template: agend.template || 'lembrete'
      })
    });
  } catch (e) {
    console.error('Erro ao registrar envio de mensagem:', e);
  }
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

// ====== EDITAR ENVIO (CANCELAR / REAGENDAR) ======

let _editarEnvioAgendAtual = null;
let _filaDisparoLote = [];
let _filaDisparoEnviados = 0;

function formatarProfissionalComProfissao(profNome) {
  const raw = (profNome || '').trim() || 'A definir';
  if (raw === 'A definir') return raw;
  const profissao = getProfissaoProfissional(raw);
  if (profissao && !raw.includes(profissao) && !raw.includes('–') && !raw.includes(' - ')) {
    return `${raw} – ${profissao}`;
  }
  return raw;
}

function gerarMensagemEditarEnvio(agend, novoStatus, motivo, novaData, novoHorario) {
  const nome = agend.nome || 'Paciente';
  const profCompleto = formatarProfissionalComProfissao(agend.profissional);
  const tipo = agend.tipo_atendimento || 'Consulta';

  // Data e horário originais
  const dataOrigRaw = (agend.data_original || agend.data_agendamento || '').split('T')[0];
  const dataOrigFmt = dataOrigRaw ? new Date(dataOrigRaw + 'T12:00:00').toLocaleDateString('pt-BR') : '';
  const horaOrig = agend.horario_original || agend.horario || '';
  const periodoOrig = getPeriodoDia(horaOrig);
  const horaOrigFmt = periodoOrig ? `${horaOrig} (${periodoOrig})` : horaOrig;

  if (novoStatus === 'cancelado') {
    let motivoTexto = '';
    if (motivo && motivo.trim()) {
      motivoTexto = `\n⚠️ *Motivo:* ${motivo.trim()}\n`;
    }
    return `Olá, ${nome}! 🏥\n\nInformamos que sua consulta de *${tipo}* com *${profCompleto}*, agendada para o dia *${dataOrigFmt}* às *${horaOrigFmt}*, precisou ser *CANCELADA*.${motivoTexto}\nEm breve entraremos em contato para orientar sobre o novo agendamento.\n\nPedimos sinceras desculpas pelo transtorno e agradecemos imensamente a sua compreensão. 💙\n\n— *USF Chico Mendes*`;
  } else if (novoStatus === 'reagendado') {
    const dataNovaRaw = (novaData || '').split('T')[0];
    const dataNovaFmt = dataNovaRaw ? new Date(dataNovaRaw + 'T12:00:00').toLocaleDateString('pt-BR') : 'A definir';
    const periodoNovo = getPeriodoDia(novoHorario);
    const horaNovaFmt = periodoNovo ? `${novoHorario} (${periodoNovo})` : (novoHorario || 'A definir');

    let motivoTexto = '';
    if (motivo && motivo.trim()) {
      motivoTexto = `\n📝 *Motivo:* ${motivo.trim()}`;
    }

    const orientacao = getOrientacaoTipo(agend.tipo_atendimento, agend.profissional);
    const orientacaoTexto = orientacao ? `\n\n📋 *Orientações:*\n${orientacao}` : '';

    return `Olá, ${nome}! 🔄\n\nInformamos que sua consulta de *${tipo}* com *${profCompleto}*, originalmente agendada para *${dataOrigFmt}* às *${horaOrigFmt}*, foi *REAGENDADA* e já está confirmada para uma nova data:\n\n📅 *Nova Data:* ${dataNovaFmt}\n⏰ *Novo Horário:* ${horaNovaFmt}\n👨‍⚕️ *Profissional:* ${profCompleto}\n📍 *Local:* Unidade de Saúde da Família Chico Mendes${motivoTexto}${orientacaoTexto}\n\nPedimos desculpas pelo transtorno e contamos com a sua presença! 💙\n\n— *USF Chico Mendes*`;
  }
  return '';
}

async function abrirModalEditarEnvio(id, acaoPadrao = 'cancelado') {
  try {
    const r = await fetch(`${API_URL}/agendamentos`);
    const list = await r.json();
    const agend = list.find(a => a.id === id);
    if (!agend) {
      showToast('Agendamento não encontrado!', true);
      return;
    }
    _editarEnvioAgendAtual = agend;

    const dataIso = (agend.data_agendamento || '').split('T')[0];
    const dataFmt = dataIso ? new Date(dataIso + 'T12:00:00').toLocaleDateString('pt-BR') : '';
    const profCompleto = formatarProfissionalComProfissao(agend.profissional);
    const tipo = agend.tipo_atendimento || 'Consulta';

    document.getElementById('ee-agend-id').value = agend.id;
    document.getElementById('ee-agend-tipo').value = tipo;
    document.getElementById('ee-agend-data-original').value = dataIso;
    document.getElementById('ee-agend-horario-original').value = agend.horario;
    document.getElementById('ee-agend-prof').value = profCompleto;
    document.getElementById('ee-agend-nome').value = agend.nome;
    document.getElementById('ee-agend-telefone').value = agend.telefone;

    // Resumo da consulta
    const resumoEl = document.getElementById('ee-resumo-consulta');
    resumoEl.innerHTML = `
      <div style="font-weight:800;font-size:14px;color:var(--blue-dark);margin-bottom:4px;">👤 ${agend.nome} <span style="font-size:12px;font-weight:600;color:var(--gray-600);">${agend.telefone}</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;font-size:12px;color:var(--gray-700);">
        <span>📅 <b>Data:</b> ${dataFmt} às ${agend.horario}</span>
        <span>🩺 <b>Tipo:</b> ${tipo}</span>
        <span>👨‍⚕️ <b>Profissional:</b> ${profCompleto}</span>
      </div>
      <div style="margin-top:4px;font-size:11px;color:var(--gray-500);">Status atual: <b>${agend.status}</b></div>
    `;

    // Seleção de status inicial (cancelado ou reagendado)
    const isReag = acaoPadrao === 'reagendado';
    document.getElementById('ee-status-cancelado').checked = !isReag;
    document.getElementById('ee-status-reagendado').checked = isReag;

    // Reset selects e inputs de motivo
    const selCanc = document.getElementById('ee-motivo-cancelamento-select');
    if (selCanc) selCanc.value = '';
    const outroCanc = document.getElementById('ee-motivo-cancelamento-outro');
    if (outroCanc) { outroCanc.value = ''; outroCanc.style.display = 'none'; }

    const selReag = document.getElementById('ee-motivo-reagendamento-select');
    if (selReag) selReag.value = '';
    const outroReag = document.getElementById('ee-motivo-reagendamento-outro');
    if (outroReag) { outroReag.value = ''; outroReag.style.display = 'none'; }

    // Min data para reagendamento (deve ser estritamente posterior à data original)
    const novaDataEl = document.getElementById('ee-nova-data');
    if (novaDataEl && dataIso) {
      const origDateObj = new Date(dataIso + 'T12:00:00');
      origDateObj.setDate(origDateObj.getDate() + 1);
      const minIso = origDateObj.toISOString().split('T')[0];
      novaDataEl.min = minIso;
      novaDataEl.value = minIso;
    }
    const avisoData = document.getElementById('ee-aviso-data-invalida');
    if (avisoData) avisoData.style.display = 'none';

    document.getElementById('ee-novo-horario').value = agend.horario || '08:00';
    document.getElementById('ee-aplicar-lote').checked = false;

    // Contagem de consultas da categoria e data para o lote
    const mesmoTipoEDia = list.filter(x => 
      (x.tipo_atendimento || 'Consulta') === tipo && 
      (x.data_agendamento || '').split('T')[0] === dataIso && 
      x.status !== 'cancelado'
    );
    const loteInfoEl = document.getElementById('ee-lote-info');
    if (loteInfoEl) {
      loteInfoEl.textContent = `Aplicará para todas as ${mesmoTipoEDia.length} consulta(s) de "${tipo}" em ${dataFmt}.`;
    }

    onEditarEnvioStatusChange();
    document.getElementById('modal-editar-envio').classList.add('show');
  } catch (e) {
    console.error('Erro ao abrir edição de envio:', e);
    showToast('Erro ao carregar dados da consulta!', true);
  }
}

function fecharModalEditarEnvio() {
  document.getElementById('modal-editar-envio').classList.remove('show');
}

function onEditarEnvioMotivoSelectChange(tipo) {
  const sel = document.getElementById(`ee-motivo-${tipo}-select`);
  const outro = document.getElementById(`ee-motivo-${tipo}-outro`);
  if (!sel || !outro) return;
  if (sel.value === 'Outro') {
    outro.style.display = 'block';
    outro.focus();
  } else {
    outro.style.display = 'none';
    outro.value = '';
  }
  onEditarEnvioInputChange();
}

function validarDataReagendamento() {
  const origData = document.getElementById('ee-agend-data-original')?.value || '';
  const novaData = document.getElementById('ee-nova-data')?.value || '';
  const aviso = document.getElementById('ee-aviso-data-invalida');
  if (!novaData || !origData) {
    if (aviso) aviso.style.display = 'none';
    return true;
  }
  if (novaData <= origData) {
    if (aviso) aviso.style.display = 'block';
    return false;
  }
  if (aviso) aviso.style.display = 'none';
  return true;
}

function onEditarEnvioStatusChange() {
  const canceladoRadio = document.getElementById('ee-status-cancelado');
  const reagendadoRadio = document.getElementById('ee-status-reagendado');
  const camposCanc = document.getElementById('ee-campos-cancelamento');
  const camposReag = document.getElementById('ee-campos-reagendamento');
  const labelCanc = document.getElementById('label-status-cancelado');
  const labelReag = document.getElementById('label-status-reagendado');

  if (canceladoRadio && canceladoRadio.checked) {
    camposCanc.style.display = 'block';
    camposReag.style.display = 'none';
    labelCanc.style.borderColor = 'var(--red)';
    labelCanc.style.background = 'rgba(229,57,53,0.08)';
    labelReag.style.borderColor = 'var(--gray-300)';
    labelReag.style.background = 'transparent';
  } else if (reagendadoRadio && reagendadoRadio.checked) {
    camposCanc.style.display = 'none';
    camposReag.style.display = 'block';
    labelReag.style.borderColor = '#e67e22';
    labelReag.style.background = 'rgba(230,126,34,0.08)';
    labelCanc.style.borderColor = 'var(--gray-300)';
    labelCanc.style.background = 'transparent';
  }
  onEditarEnvioInputChange();
}

function onEditarEnvioInputChange() {
  if (!_editarEnvioAgendAtual) return;
  const statusRadio = document.querySelector('input[name="ee-status"]:checked');
  const status = statusRadio ? statusRadio.value : '';
  
  let motivo = '';
  if (status === 'cancelado') {
    const sel = document.getElementById('ee-motivo-cancelamento-select');
    const outro = document.getElementById('ee-motivo-cancelamento-outro');
    motivo = (sel && sel.value === 'Outro') ? (outro?.value || 'Outro') : (sel?.value || '');
  } else if (status === 'reagendado') {
    const sel = document.getElementById('ee-motivo-reagendamento-select');
    const outro = document.getElementById('ee-motivo-reagendamento-outro');
    motivo = (sel && sel.value === 'Outro') ? (outro?.value || 'Outro') : (sel?.value || '');
    validarDataReagendamento();
  }
  const novaData = document.getElementById('ee-nova-data')?.value || '';
  const novoHorario = document.getElementById('ee-novo-horario')?.value || '';

  const previewEl = document.getElementById('ee-preview-msg');
  if (!previewEl) return;

  if (!status) {
    previewEl.textContent = 'Selecione o novo status da consulta acima.';
    return;
  }

  const msg = gerarMensagemEditarEnvio(_editarEnvioAgendAtual, status, motivo, novaData, novoHorario);
  previewEl.textContent = msg;
}

async function salvarEditarEnvio() {
  const id = document.getElementById('ee-agend-id').value;
  const statusRadio = document.querySelector('input[name="ee-status"]:checked');
  if (!statusRadio) {
    showToast('⚠️ Selecione o novo status (Cancelado ou Reagendado)', true);
    return;
  }
  const novoStatus = statusRadio.value;
  const aplicarLote = document.getElementById('ee-aplicar-lote').checked;
  const setor = localStorage.getItem('chatSetor') || '';

  let motivo = '';
  let novaData = '';
  let novoHorario = '';

  if (novoStatus === 'cancelado') {
    const sel = document.getElementById('ee-motivo-cancelamento-select');
    const outro = document.getElementById('ee-motivo-cancelamento-outro');
    if (!sel || !sel.value) {
      showToast('⚠️ Selecione o motivo do cancelamento!', true);
      return;
    }
    motivo = (sel.value === 'Outro') ? (outro?.value.trim() || 'Outro') : sel.value;
  } else if (novoStatus === 'reagendado') {
    const sel = document.getElementById('ee-motivo-reagendamento-select');
    const outro = document.getElementById('ee-motivo-reagendamento-outro');
    if (!sel || !sel.value) {
      showToast('⚠️ Selecione o motivo do reagendamento!', true);
      return;
    }
    motivo = (sel.value === 'Outro') ? (outro?.value.trim() || 'Outro') : sel.value;

    novaData = document.getElementById('ee-nova-data').value;
    novoHorario = document.getElementById('ee-novo-horario').value.trim();

    if (!novaData || !novoHorario) {
      showToast('⚠️ Preencha a nova data e o novo horário!', true);
      return;
    }

    const dataOrig = document.getElementById('ee-agend-data-original').value;
    if (dataOrig && novaData <= dataOrig) {
      showToast('⚠️ A nova data deve ser estritamente posterior à data original da consulta!', true);
      const aviso = document.getElementById('ee-aviso-data-invalida');
      if (aviso) aviso.style.display = 'block';
      return;
    }
  }

  const agend = _editarEnvioAgendAtual;
  if (!agend) {
    showToast('Agendamento não encontrado!', true);
    return;
  }

  const tipo = agend.tipo_atendimento || 'Consulta';
  const dataIso = (agend.data_agendamento || '').split('T')[0];
  const dataFmt = dataIso ? new Date(dataIso + 'T12:00:00').toLocaleDateString('pt-BR') : '';

  if (aplicarLote) {
    const confirmMsg = `⚠️ CONFIRMAÇÃO DE AÇÃO EM LOTE\n\nTem certeza de que deseja alterar o status para "${novoStatus.toUpperCase()}" de TODAS as consultas de "${tipo}" no dia ${dataFmt}?\n\nEsta ação atualizará os registros no sistema e preparará os disparos no WhatsApp.`;
    if (!confirm(confirmMsg)) return;

    try {
      const r = await fetch(`${API_URL}/agendamentos/batch-editar-envio`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo_atendimento: tipo,
          data: dataIso,
          status: novoStatus,
          motivo,
          nova_data: novaData,
          novo_horario: novoHorario,
          setor
        })
      });

      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        showToast(`Erro na edição em lote: ${err.error || r.status}`, true);
        return;
      }

      const resJson = await r.json();
      _ultimoLoteReversao = {
        snapshot_anterior: resJson.snapshot_anterior || [],
        historico_ids: resJson.historico_ids || [],
        agendOriginalId: agend.id,
        acao: novoStatus,
        tipo,
        dataFmt,
        total: resJson.total || (resJson.agendamentos ? resJson.agendamentos.length : 0)
      };
      atualizarBannerDesfazerLote();

      showToast(`✅ ${resJson.total} consulta(s) de ${tipo} atualizada(s)!`);
      fecharModalEditarEnvio();
      loadAgendamentos();
      if (typeof loadHistoricoAgendamentos === 'function') loadHistoricoAgendamentos();
      if (typeof carregarHistorico === 'function') carregarHistorico();

      // Iniciar fila de disparo
      if (resJson.agendamentos && resJson.agendamentos.length > 0) {
        iniciarFilaDisparoLote(resJson.agendamentos, novoStatus, motivo, novaData, novoHorario);
      }
    } catch (e) {
      console.error('Erro ao editar em lote:', e);
      showToast('Erro de conexão ao editar em lote!', true);
    }
  } else {
    // Individual
    try {
      const r = await fetch(`${API_URL}/agendamentos/${id}/editar-envio`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: novoStatus,
          motivo,
          nova_data: novaData,
          novo_horario: novoHorario,
          setor
        })
      });

      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        showToast(`Erro ao editar: ${err.error || r.status}`, true);
        return;
      }

      const atualizado = await r.json();
      if (atualizado.snapshot_anterior && atualizado.snapshot_anterior.length) {
        _ultimoLoteReversao = {
          snapshot_anterior: atualizado.snapshot_anterior,
          historico_ids: atualizado.historico_ids || [],
          agendOriginalId: agend.id,
          acao: novoStatus,
          tipo,
          dataFmt,
          total: 1
        };
        atualizarBannerDesfazerLote();
      }
      showToast('✅ Consulta atualizada com sucesso!');
      fecharModalEditarEnvio();
      loadAgendamentos();
      if (typeof loadHistoricoAgendamentos === 'function') loadHistoricoAgendamentos();
      if (typeof carregarHistorico === 'function') carregarHistorico();

      // Gerar mensagem e abrir WhatsApp
      const msg = gerarMensagemEditarEnvio(agend, novoStatus, motivo, novaData, novoHorario);
      const phone = (agend.telefone || '').replace(/\D/g, '');
      const waUrl = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(msg)}`;

      await registrarMensagemEnviada({
        id: agend.id,
        profissional: agend.profissional,
        paciente: agend.nome,
        template: novoStatus
      });
      loadRelatorioMensagens();

      window.open(waUrl, '_blank');
    } catch (e) {
      console.error('Erro ao salvar edição:', e);
      showToast('Erro de conexão ao salvar!', true);
    }
  }
}

// ====== FILA DE DISPARO EM LOTE + DESFAZER / EDITAR MENSAGEM ======
let _ultimoLoteReversao = null;
let _templatePadraoLote = '';

function atualizarBannerDesfazerLote() {
  const banner = document.getElementById('banner-desfazer-lote');
  const txt = document.getElementById('banner-desfazer-lote-texto');
  const btnTopo = document.getElementById('btn-topo-desfazer-lote');
  if (_ultimoLoteReversao && _ultimoLoteReversao.snapshot_anterior && _ultimoLoteReversao.snapshot_anterior.length > 0) {
    const u = _ultimoLoteReversao;
    const statusLabel = u.acao === 'cancelado' ? 'CANCELADA(S)' : 'REAGENDADA(S)';
    if (txt) {
      txt.innerHTML = `⚡ Última alteração: <b>${u.total} consulta(s)</b> de <b>${escapeText(u.tipo || 'Consulta')}</b> (${escapeText(u.dataFmt || '')}) marcada(s) como <b>${statusLabel}</b>.`;
    }
    if (banner) banner.style.display = 'flex';
    if (btnTopo) btnTopo.style.display = 'inline-flex';
  } else {
    if (banner) banner.style.display = 'none';
    if (btnTopo) btnTopo.style.display = 'none';
  }
}

function reabrirModalFilaDisparoLote() {
  if (_filaDisparoLote && _filaDisparoLote.length > 0) {
    renderFilaDisparoLote();
    document.getElementById('modal-fila-disparo-lote')?.classList.add('show');
  } else {
    showToast('Não há fila de disparo ativa no momento.', true);
  }
}

async function desfazerUltimoLoteAgendamento(reabrirEdicao = false) {
  if (!_ultimoLoteReversao || !Array.isArray(_ultimoLoteReversao.snapshot_anterior) || !_ultimoLoteReversao.snapshot_anterior.length) {
    showToast('Não há alteração recente em lote para desfazer.', true);
    return;
  }
  const u = _ultimoLoteReversao;
  const msgConf = `↩️ DESFAZER ALTERAÇÃO E VOLTAR ATRÁS\n\nDeseja reverter a alteração das ${u.total} consulta(s) de "${u.tipo}" (${u.dataFmt})?\n\nTodas voltarão exatamente para a data, horário e status originais, e o registro no histórico será removido.`;
  if (!confirm(msgConf)) return;

  try {
    const r = await fetch(`${API_URL}/agendamentos/reverter-lote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        snapshot_anterior: u.snapshot_anterior,
        historico_ids: u.historico_ids || []
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      showToast(data.error || 'Erro ao desfazer alteração em lote!', true);
      return;
    }

    const idParaReabrir = u.agendOriginalId;
    const acaoParaReabrir = u.acao || 'cancelado';
    _ultimoLoteReversao = null;
    _filaDisparoLote = [];
    _filaDisparoEnviados = 0;
    atualizarBannerDesfazerLote();
    fecharFilaDisparoLote();

    showToast(`↩️ ${data.message || 'Alteração desfeita com sucesso! As consultas voltaram ao estado original.'}`);
    await loadAgendamentos();
    if (typeof loadHistoricoAgendamentos === 'function') loadHistoricoAgendamentos();
    if (typeof carregarHistorico === 'function') carregarHistorico();

    if (reabrirEdicao && idParaReabrir) {
      setTimeout(() => {
        abrirModalEditarEnvio(idParaReabrir, acaoParaReabrir);
      }, 250);
    }
  } catch (e) {
    console.error('Erro ao desfazer lote:', e);
    showToast('Erro de conexão ao tentar desfazer o lote!', true);
  }
}

function construirTemplateLotePadrao(itemExemplo) {
  if (!itemExemplo || !itemExemplo.msg) return '';
  let tpl = itemExemplo.msg;
  if (itemExemplo.nome) {
    tpl = tpl.replace(itemExemplo.nome, '{nome}');
  }
  if (itemExemplo.horario) {
    tpl = tpl.replace(itemExemplo.horario, '{horario}');
  }
  return tpl;
}

function toggleEditorMensagemLote() {
  const box = document.getElementById('box-editor-msg-lote');
  const txt = document.getElementById('fila-disparo-msg-template');
  if (!box || !txt) return;
  if (box.style.display === 'none' || !box.style.display) {
    if (!txt.value.trim() && _filaDisparoLote.length > 0) {
      txt.value = _templatePadraoLote || construirTemplateLotePadrao(_filaDisparoLote[0]);
    }
    box.style.display = 'block';
    txt.focus();
  } else {
    box.style.display = 'none';
  }
}

function restaurarMensagemPadraoLote() {
  const txt = document.getElementById('fila-disparo-msg-template');
  if (!txt) return;
  txt.value = _templatePadraoLote;
  aplicarMensagemEditadaLote();
}

function aplicarMensagemEditadaLote() {
  const txt = document.getElementById('fila-disparo-msg-template');
  if (!txt || !txt.value.trim()) {
    showToast('Digite o texto da mensagem antes de aplicar!', true);
    return;
  }
  const tpl = txt.value;
  _filaDisparoLote.forEach(item => {
    item.msg = tpl
      .replace(/\{nome\}/gi, item.nome || 'Paciente')
      .replace(/\{horario\}/gi, item.horario || '');
  });
  const box = document.getElementById('box-editor-msg-lote');
  if (box) box.style.display = 'none';
  renderFilaDisparoLote();
  showToast('✏️ Mensagem atualizada para todos os pacientes do lote!');
}

function editarMensagemIndividualLote(index) {
  const item = _filaDisparoLote[index];
  if (!item) return;
  const box = document.getElementById(`edit-item-lote-${index}`);
  if (!box) return;
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

function salvarMensagemIndividualLote(index) {
  const item = _filaDisparoLote[index];
  const ta = document.getElementById(`textarea-item-lote-${index}`);
  if (!item || !ta) return;
  item.msg = ta.value;
  renderFilaDisparoLote();
  showToast(`✏️ Mensagem de ${item.nome} atualizada!`);
}

let _loteCurrentImgSrc = '/img/confirmacao.jpg';

function atualizarImagemBoxLote(imgSrc, tipoAtendimento) {
  _loteCurrentImgSrc = imgSrc || '/img/confirmacao.jpg';
  const box = document.getElementById('fila-disparo-img-box');
  const preview = document.getElementById('fila-disparo-img-preview');
  const label = document.getElementById('fila-disparo-img-label');
  if (box && preview) {
    preview.src = _loteCurrentImgSrc;
    box.style.display = 'flex';
    if (label) {
      label.textContent = `📎 Imagem: ${tipoAtendimento || 'Consulta'} (pronta para Ctrl+V)`;
    }
  }
}

async function copiarImagemLote() {
  await copiarImagemParaClipboard(_loteCurrentImgSrc, false);
}

async function copiarImagemItemLote(index) {
  const item = _filaDisparoLote[index];
  if (!item) return;
  atualizarImagemBoxLote(item.imgSrc, item.tipo_atendimento);
  await copiarImagemParaClipboard(item.imgSrc, false);
}

function iniciarFilaDisparoLote(agendamentos, novoStatus, motivo, novaData, novoHorario) {
  _filaDisparoLote = agendamentos.map(a => {
    const msg = gerarMensagemEditarEnvio(a, novoStatus, motivo, novaData, novoHorario);
    const phone = (a.telefone || '').replace(/\D/g, '');
    const tipoAtend = a.tipo_atendimento || 'Consulta';
    const imgSrc = typeof getImagemTipoConsulta === 'function'
      ? getImagemTipoConsulta(tipoAtend, a.profissional)
      : '/img/confirmacao.jpg';
    return {
      id: a.id,
      nome: a.nome,
      telefone: a.telefone,
      phone,
      horario: a.horario_original || a.horario,
      msg,
      msgOriginal: msg,
      profissional: a.profissional,
      tipo_atendimento: tipoAtend,
      imgSrc,
      novoStatus,
      enviado: false
    };
  });
  _filaDisparoEnviados = 0;
  _templatePadraoLote = _filaDisparoLote.length > 0 ? construirTemplateLotePadrao(_filaDisparoLote[0]) : '';
  const txtTpl = document.getElementById('fila-disparo-msg-template');
  if (txtTpl) txtTpl.value = _templatePadraoLote;
  const boxEditor = document.getElementById('box-editor-msg-lote');
  if (boxEditor) boxEditor.style.display = 'none';

  if (_filaDisparoLote.length > 0) {
    atualizarImagemBoxLote(_filaDisparoLote[0].imgSrc, _filaDisparoLote[0].tipo_atendimento);
  }

  renderFilaDisparoLote();
  document.getElementById('modal-fila-disparo-lote').classList.add('show');
}

function renderFilaDisparoLote() {
  const container = document.getElementById('fila-disparo-lista');
  const progresso = document.getElementById('fila-disparo-progresso');
  if (!container) return;

  const total = _filaDisparoLote.length;
  progresso.innerHTML = `📊 Progresso: <b>${_filaDisparoEnviados}</b> de <b>${total}</b> paciente(s) notificado(s)`;

  container.innerHTML = _filaDisparoLote.map((item, index) => {
    const btnHtml = item.enviado
      ? `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
           <span style="background:rgba(74,171,60,0.15);color:#2d7a22;font-size:11px;font-weight:800;padding:5px 10px;border-radius:6px;">✅ Enviado</span>
           <button type="button" onclick="copiarImagemItemLote(${index})" title="Copiar imagem deste paciente para colar no WhatsApp" style="background:#dcfce7;color:#166534;border:1px solid #86efac;border-radius:6px;padding:5px 8px;font-size:11px;font-weight:700;cursor:pointer;">🖼️ Img</button>
           <button type="button" onclick="editarMensagemIndividualLote(${index})" title="Ver ou editar mensagem deste paciente" style="background:#f1f5f9;color:#334155;border:1px solid #cbd5e1;border-radius:6px;padding:5px 8px;font-size:11px;font-weight:700;cursor:pointer;">✏️ Msg</button>
           <button type="button" onclick="dispararItemFila(${index})" title="Reenviar WhatsApp com texto corrigido" style="background:#25D366;color:white;border:none;border-radius:6px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer;">🔄 Reenviar</button>
         </div>`
      : `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
           <button type="button" onclick="copiarImagemItemLote(${index})" title="Copiar imagem deste paciente para colar no WhatsApp" style="background:#dcfce7;color:#166534;border:1px solid #86efac;border-radius:6px;padding:6px 9px;font-size:11.5px;font-weight:700;cursor:pointer;">🖼️ Img</button>
           <button type="button" onclick="editarMensagemIndividualLote(${index})" title="Ver ou editar mensagem deste paciente" style="background:#f1f5f9;color:#334155;border:1px solid #cbd5e1;border-radius:6px;padding:6px 9px;font-size:11.5px;font-weight:700;cursor:pointer;">✏️ Msg</button>
           <button type="button" onclick="dispararItemFila(${index})" style="background:#25D366;color:white;border:none;border-radius:6px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:4px;box-shadow:0 2px 6px rgba(37,211,102,0.3);transition:all 0.15s;" onmouseover="this.style.background='#1fb855'" onmouseout="this.style.background='#25D366'">
             📲 Disparar WhatsApp
           </button>
         </div>`;

    return `<div style="background:white;padding:10px 14px;border-radius:8px;border:1px solid var(--gray-200);border-left:4px solid ${item.enviado ? 'var(--green)' : 'var(--blue)'};">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
        <div>
          <div style="font-weight:800;font-size:13px;color:var(--blue-dark);">${escapeText(item.nome)}</div>
          <div style="font-size:11px;color:var(--gray-600);">${escapeText(item.telefone)} • Horário: ${escapeText(item.horario)} • ${escapeText(item.tipo_atendimento || 'Consulta')}</div>
        </div>
        <div>${btnHtml}</div>
      </div>
      <div id="edit-item-lote-${index}" style="display:none;margin-top:8px;padding-top:8px;border-top:1px dashed #cbd5e1;text-align:left;">
        <textarea id="textarea-item-lote-${index}" rows="4" style="width:100%;padding:8px;border-radius:6px;border:1px solid #94a3b8;font-size:12px;font-family:'Nunito',sans-serif;margin-bottom:6px;">${escapeText(item.msg)}</textarea>
        <div style="display:flex;justify-content:flex-end;gap:6px;">
          <button type="button" onclick="salvarMensagemIndividualLote(${index})" style="background:var(--blue);color:white;border:none;border-radius:6px;padding:5px 12px;font-size:11.5px;font-weight:800;cursor:pointer;">💾 Salvar Texto</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function dispararItemFila(index) {
  const item = _filaDisparoLote[index];
  if (!item) return;

  atualizarImagemBoxLote(item.imgSrc, item.tipo_atendimento);
  await copiarImagemParaClipboard(item.imgSrc, true);

  const url = `https://web.whatsapp.com/send?phone=${item.phone}&text=${encodeURIComponent(item.msg)}`;
  window.open(url, '_blank');

  if (!item.enviado) {
    item.enviado = true;
    _filaDisparoEnviados++;
  }

  await registrarMensagemEnviada({
    id: item.id,
    profissional: item.profissional,
    paciente: item.nome,
    template: 'lote_' + (item.novoStatus || 'edicao')
  });

  renderFilaDisparoLote();
  loadRelatorioMensagens();
}

function fecharFilaDisparoLote() {
  document.getElementById('modal-fila-disparo-lote').classList.remove('show');
}

// ====== HISTÓRICO DE CANCELAMENTOS E REAGENDAMENTOS ======

async function loadHistoricoAgendamentos() {
  const container = document.getElementById('agend-historico-content');
  if (!container) return;
  try {
    const r = await fetch(`${API_URL}/agendamentos/historico?limit=50`);
    if (!r.ok) throw new Error();
    const list = await r.json();
    renderHistoricoAgendamentos(list, container);
  } catch (e) {
    console.error('Erro ao carregar histórico:', e);
    container.innerHTML = '<div style="text-align:center;padding:16px;color:var(--red);">Erro ao carregar histórico</div>';
  }
}

function renderHistoricoAgendamentos(list, container) {
  if (!list || !list.length) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray-500);font-size:13px;">✅ Nenhum cancelamento ou reagendamento registrado até o momento.</div>';
    return;
  }

  const rows = list.map(item => {
    const dataAlteracao = safeDate(item.criado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    const dataAntRaw = (item.data_anterior || '').split('T')[0];
    const dataAntFmt = dataAntRaw ? new Date(dataAntRaw + 'T12:00:00').toLocaleDateString('pt-BR') : '-';
    const horaAnt = item.horario_anterior || '-';

    const statusBadge = item.novo_status === 'cancelado'
      ? `<span class="agend-status cancelado">❌ Cancelado</span>`
      : `<span class="agend-status reagendado">🔄 Reagendado</span>`;

    let infoDestino = '';
    if (item.novo_status === 'reagendado') {
      const dataNovaRaw = (item.nova_data || '').split('T')[0];
      const dataNovaFmt = dataNovaRaw ? new Date(dataNovaRaw + 'T12:00:00').toLocaleDateString('pt-BR') : '-';
      infoDestino = `<b>Nova data:</b> ${dataNovaFmt} às ${item.novo_horario || '-'}`;
    }
    const motivoHtml = item.motivo ? `<div style="font-size:11px;color:var(--gray-600);margin-top:2px;"><i>Motivo:</i> ${item.motivo}</div>` : '<div style="font-size:11px;color:var(--gray-500);margin-top:2px;"><i>Sem motivo informado</i></div>';

    const loteBadge = item.em_lote ? `<span style="font-size:9px;background:rgba(230,126,34,0.15);color:#d35400;padding:1px 5px;border-radius:4px;font-weight:800;margin-left:4px;">EM LOTE</span>` : '';

    return `<tr style="border-bottom:1px solid var(--gray-200);">
      <td style="padding:10px 8px;font-size:12px;color:var(--gray-600);white-space:nowrap;">${dataAlteracao}${loteBadge}</td>
      <td style="padding:10px 8px;">
        <div style="font-weight:700;color:var(--blue-dark);">${item.paciente}</div>
        <div style="font-size:11px;color:var(--gray-600);">${item.telefone || '-'}</div>
      </td>
      <td style="padding:10px 8px;">
        <div style="font-weight:600;">${item.tipo_atendimento || 'Consulta'}</div>
        <div style="font-size:11px;color:var(--gray-600);">${item.profissional || '-'}</div>
      </td>
      <td style="padding:10px 8px;text-align:center;">${statusBadge}</td>
      <td style="padding:10px 8px;font-size:12px;">${dataAntFmt} às ${horaAnt}</td>
      <td style="padding:10px 8px;font-size:12px;">
        ${infoDestino}
        ${motivoHtml}
      </td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;margin-top:4px;">
        <thead>
          <tr style="border-bottom:2px solid var(--gray-200);background:var(--gray-100);">
            <th style="text-align:left;padding:10px 8px;color:var(--gray-600);font-size:11px;text-transform:uppercase;">Data/Hora</th>
            <th style="text-align:left;padding:10px 8px;color:var(--gray-600);font-size:11px;text-transform:uppercase;">Paciente</th>
            <th style="text-align:left;padding:10px 8px;color:var(--gray-600);font-size:11px;text-transform:uppercase;">Categoria / Profissional</th>
            <th style="text-align:center;padding:10px 8px;color:var(--gray-600);font-size:11px;text-transform:uppercase;">Novo Status</th>
            <th style="text-align:left;padding:10px 8px;color:var(--gray-600);font-size:11px;text-transform:uppercase;">Original</th>
            <th style="text-align:left;padding:10px 8px;color:var(--gray-600);font-size:11px;text-transform:uppercase;">Detalhes / Motivo</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ====== PDF ======
function generatePDF() {
  if (!attendedPatients.length) { showToast('Não há pacientes para exportar.', true); return; }
  if (!window.jspdf || !window.jspdf.jsPDF) { showToast('Carregando biblioteca PDF...', true); return; }
  const { jsPDF } = window.jspdf; const doc = new jsPDF('l'); // Landscape
  doc.setFont('helvetica','bold'); doc.setFontSize(18); doc.text('Relatório de Atendimentos', 148, 15, { align: 'center' });
  doc.setFontSize(11); doc.setFont('helvetica','normal'); doc.text(`USF Chico Mendes | Data: ${new Date().toLocaleDateString('pt-BR')}`, 148, 22, { align: 'center' });
  const data = [...attendedPatients].sort((a,b) => new Date(a.created_at) - new Date(b.created_at)).map((p, i) => {
    let condLabel = '-';
    try { const arr = JSON.parse(p.condicoes_especiais||'[]'); condLabel = arr.map(c => c==='hipertenso'?'HAS':c==='diabetico'?'DM':c==='gestante'?'GEST':c).join(', ') || '-'; } catch {}
    const risco = p.gravidade_final || p.risco_clinico || '-';
    const agend = p.agendamento_realizado ? 'Sim' : 'Não';
    return [i + 1, p.nome, p.cpf || '-', p.setor, safeDate(p.created_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}), p.queixa || '-', risco, p.profissional || p.medico || '-', agend, condLabel];
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
    const [rFluxo, rStat, rBa] = await Promise.all([
      fetch(`${API_URL}/acolhimento/fluxo`),
      fetch(`${API_URL}/acolhimento/relatorio`),
      fetch(`${API_URL}/busca-ativa/resumo`).catch(() => null)
    ]);
    acolhimentoFluxo = await rFluxo.json();
    let resumoBa = null;
    if (rBa && rBa.ok) {
      resumoBa = await rBa.json().catch(() => null);
    }
    if (resumoBa && acolhimentoFluxo) {
      ['recepcao', 'primeira_escuta', 'segunda_escuta'].forEach(et => {
        (acolhimentoFluxo[et] || []).forEach(p => {
          const itens = resumoBa[p.id];
          if (Array.isArray(itens)) {
            p.busca_ativa = itens.length > 0;
            p.busca_ativa_detalhes = itens;
            p.busca_ativa_ofertada = itens.length > 0 && itens.every(i => i.ofertado);
          } else {
            p.busca_ativa = false;
            p.busca_ativa_detalhes = [];
            p.busca_ativa_ofertada = false;
          }
        });
      });
    }
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
  const searchInp = document.getElementById('acol-search-input');
  const searchClear = document.getElementById('acol-search-clear');
  const busca = (searchInp?.value || '').trim().toLowerCase();
  if (searchClear) searchClear.style.display = busca ? 'inline-flex' : 'none';

  const cntRec = (acolhimentoFluxo.recepcao || []).length;
  const cnt1 = (acolhimentoFluxo.primeira_escuta || []).length;
  const cnt2 = (acolhimentoFluxo.segunda_escuta || []).length;
  const totalAcol = cntRec + cnt1 + cnt2;

  const elTodos = document.getElementById('acol-filter-cnt-todos'); if (elTodos) elTodos.textContent = `(${totalAcol})`;
  const elRec = document.getElementById('acol-filter-cnt-recepcao'); if (elRec) elRec.textContent = `(${cntRec})`;
  const el1 = document.getElementById('acol-filter-cnt-primeira'); if (el1) el1.textContent = `(${cnt1})`;
  const el2 = document.getElementById('acol-filter-cnt-segunda'); if (el2) el2.textContent = `(${cnt2})`;

  etapas.forEach(etapa => {
    let pacientes = acolhimentoFluxo[etapa] || [];
    if (busca) {
      pacientes = pacientes.filter(p => (p.nome || '').toLowerCase().includes(busca));
    }
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
  const badge = document.getElementById('badge-acolhimento');
  if (badge) badge.textContent = totalAcol;
  const statAtivos = document.getElementById('acol-stat-ativos');
  if (statAtivos) statAtivos.textContent = totalAcol;

  // Renderizar as novas telas dedicadas
  renderAcsEscutaScreen();
  renderSegundaEscutaScreen();
}

function renderAcolhimentoEtapa(etapa, pacientes) {
  const el = document.getElementById('acol-list-' + etapa);
  if (!el) return;
  if (!pacientes.length) {
    el.innerHTML = '<div style="text-align:center;padding:24px;color:rgba(255,255,255,0.6);font-size:13px;font-weight:700;">Nenhum paciente nesta etapa</div>';
    return;
  }
  const cardsHtml = pacientes.map((p, i) => {
    const prioBadge = renderPrioridadeIdadeBadge(p);
    const waitBadge = renderEsperaNormalBadge(p);
    const equipeBadge = renderEquipePacienteBadge(p);
    const intercorrenciaBadge = renderIntercorrenciaAcolhimentoBadge(p);
    const riscoBadge = p.risco_clinico && p.risco_clinico !== 'verde' ? `<span class="acol-risco-badge ${p.risco_clinico}">${p.risco_clinico === 'vermelho' ? '🔴 ALTO' : p.risco_clinico === 'amarelo' ? '🟡 MODERADO' : p.risco_clinico === 'azul' ? '🟦 SEM RISCO' : ''}</span>` : '';
    const condBadges = renderCondicoesBadges(p.condicoes_especiais);
    const tempoMin = Math.max(0, p.inicio_etapa ? Math.round((Date.now() - new Date(p.inicio_etapa).getTime()) / 60000) : Math.round((Date.now() - new Date(p.created_at).getTime()) / 60000));
    const tempoStyle = tempoMin >= 40
      ? 'background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;'
      : tempoMin >= 20
        ? 'background:#fef3c7;color:#b45309;border:1px solid #fcd34d;'
        : 'background:#dcfce7;color:#15803d;border:1px solid #86efac;';
    const tempoBadge = `<span class="acol-tempo-badge" style="${tempoStyle}" title="Tempo nesta etapa">⏱ ${tempoMin} min</span>`;
    const nextBadge = (i === 0 && p.status !== 'chamado') ? '<span class="badge-proximo-fila">👉 Próximo</span>' : '';
    const callingBadge = p.status === 'chamado' ? '<span class="queue-status status-calling">📢 Chamando</span>' : '';
    const acsLabel = p.acs_responsavel ? `<div style="font-size:11.5px;color:#475569;font-weight:700;">👤 ACS: ${escapeText(p.acs_responsavel)}</div>` : '';
    const profLabel = p.profissional_destino
      ? `<div style="font-size:11.5px;color:#0f172a;font-weight:800;">👨‍⚕️ ${escapeText(p.profissional_destino)}</div>`
      : (etapa === 'segunda_escuta' ? `<div style="font-size:11.5px;color:#b91c1c;font-weight:800;">📍 Se dirija à 2ª Escuta</div>` : '');
    const motivoTexto = (p.motivo_primeira_escuta || p.queixa || '').trim();
    const queixaEl = motivoTexto
      ? `<div class="motivo-1" style="margin-top:6px;">💬 <strong>1ª Escuta:</strong> "${escapeText(motivoTexto)}"</div>`
      : '';
    const obs2Texto = (p.observacao_segunda_escuta || '').trim();
    const obs2El = obs2Texto ? `<div class="motivo-2" style="margin-top:4px;">🩺 <strong>2ª Escuta:</strong> "${escapeText(obs2Texto)}"</div>` : '';
    const nomeSafe = p.nome.replace(/'/g, "\\'");
    const radarBtn = !p.busca_ativa ? renderBotaoBuscaAtivaCard(p, 'Acolhimento') : '';
    const alumiaBloco = renderBlocoBuscaAtivaEquipe(p, 'Acolhimento');

    let actions = '';
    if (etapa === 'recepcao') {
      actions = `
        <button class="acol-btn-action acol-btn-iniciar" onclick="iniciarEscuta(${p.id},'${nomeSafe}')">🟡 Iniciar 1ª Escuta</button>
        <button class="btn-transfer-sector" onclick="event.stopPropagation();abrirModalEncaminharPublico(${p.id}, '${nomeSafe}', 'Acolhimento')">↗️ Encaminhar</button>
        <button class="acol-btn-action" style="background:linear-gradient(135deg,#2e7d32,#1b5e20);color:white;" onclick="direcionarParaRecepcaoFisica(${p.id},'${nomeSafe}')">📋 Agendado</button>
        <button class="acol-btn-action" style="background:linear-gradient(135deg,#1565c0,#0d47a1);color:white;" onclick="editarNomeAcolhimento(${p.id},'${nomeSafe}')">✏️</button>
      `;
    } else if (etapa === 'primeira_escuta') {
      actions = `
        <button class="acol-btn-action acol-btn-encaminhar" onclick="abrirModalEncaminhar(${p.id},'${nomeSafe}')">🔴 Encaminhar 2ª</button>
        <button class="acol-btn-action" style="background:var(--green);color:white;" onclick="finalizarAcsDireto(${p.id}, false, '${nomeSafe}')">✅ Finalizar</button>
        <button class="acol-btn-action" style="background:#1976d2;color:white;" onclick="abrirModalAgendamento(${p.id}, '${nomeSafe}', '${motivoTexto.replace(/'/g,"\\'")}')">🗂️ Agendar</button>
        <button class="btn-transfer-sector" onclick="event.stopPropagation();abrirModalEncaminharPublico(${p.id}, '${nomeSafe}', 'Acolhimento')">↗️ Setor</button>
        <button class="acol-btn-action" style="background:linear-gradient(135deg,#1565c0,#0d47a1);color:white;" onclick="editarNomeAcolhimento(${p.id},'${nomeSafe}')">✏️</button>
      `;
    } else if (etapa === 'segunda_escuta') {
      actions = `
        <button class="acol-btn-action" style="background:linear-gradient(135deg,#c62828,#8e0000);color:white;font-weight:800;" onclick="abrirModalReencaminharEscuta2(${p.id},'${nomeSafe}')">🚨 Encaminhar (Intercorrência)</button>
        <button class="acol-btn-action acol-btn-finalizar" onclick="finalizarAtendimento(${p.id},'${nomeSafe}')">✅ Finalizar</button>
        <button class="btn-transfer-sector" onclick="event.stopPropagation();abrirModalEncaminharPublico(${p.id}, '${nomeSafe}', 'Acolhimento')">↗️ Outro Setor</button>
      `;
    }
    const adminBtns = isAdmin ? `
      <button class="btn-danger" style="font-size:11px;padding:4px 8px;" onclick="event.stopPropagation();removePatient(${p.id},'${nomeSafe}')" title="Desistência">🚶</button>
      <button class="btn-danger" style="font-size:11px;padding:4px 8px;background:rgba(0,0,0,0.1);color:var(--gray-600);" onclick="event.stopPropagation();deletePatientPermanently(${p.id},'${nomeSafe}')" title="Excluir">🔥</button>
    ` : '';
    const originBadge = p.origem_transferencia ? `<span style="font-size:10px;color:#475569;background:#f1f5f9;padding:2px 6px;border-radius:4px;border:1px solid #cbd5e1;font-weight:700;">🔙 de: ${escapeText(p.origem_transferencia)}</span>` : '';
    const cardCls = ['acol-patient-card', i === 0 ? 'is-next' : '', p.status === 'chamado' ? 'is-calling' : ''].filter(Boolean).join(' ');

    return `<div class="${cardCls}">
      <div class="acol-card-top">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span class="fila-pos-badge">${i + 1}º</span>
          <span style="font-size:11.5px;color:#64748b;font-weight:700;">🕐 ${p.horario || ''}</span>
          ${tempoBadge}
          ${waitBadge}
        </div>
        <div style="display:flex;align-items:center;gap:4px;">
          ${nextBadge}${callingBadge}
        </div>
      </div>
      <div class="fila-paciente-nome" style="font-size:15px;">${escapeText(p.nome)} ${prioBadge}</div>
      <div class="fila-paciente-sub" style="margin-top:4px;">
        ${equipeBadge}
        ${riscoBadge}
        ${condBadges}
        ${originBadge}
      </div>
      ${(acsLabel || profLabel) ? `<div style="margin-top:5px;display:flex;flex-direction:column;gap:2px;">${acsLabel}${profLabel}</div>` : ''}
      ${intercorrenciaBadge ? `<div style="margin-top:4px;">${intercorrenciaBadge}</div>` : ''}
      ${queixaEl}${obs2El}${alumiaBloco}
      <div class="acol-card-actions">
        ${radarBtn}${actions}${adminBtns}
      </div>
    </div>`;
  }).join('');

  el.innerHTML = cardsHtml;
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

// ====== EDITAR NOME DO PACIENTE (Acolhimento) ======
async function editarNomeAcolhimento(id, nomeAtual) {
  if (!isAdmin) { showToast('🔒 Apenas administradores podem editar nomes!', true); return; }
  const novoNome = prompt(`✏️ Editar Nome do Paciente\n\nNome atual: "${nomeAtual}"\n\nDigite o novo nome:`, nomeAtual);
  if (!novoNome || novoNome.trim() === nomeAtual) return;
  try {
    const r = await fetch(`${API_URL}/patients/${id}/rename`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ novoNome: novoNome.trim(), senha: adminPassword })
    });
    if (r.status === 403) { showToast('❌ Senha administrativa inválida!', true); return; }
    if (!r.ok) { const d = await r.json(); showToast(d.error || 'Erro ao editar nome!', true); return; }
    showToast(`✅ Nome alterado para "${novoNome.trim()}"!`);
    loadAcolhimentoFluxo(); loadQueues();
  } catch { showToast('Erro ao editar nome!', true); }
}

// ====== DIRECIONAR PARA RECEPÇÃO FÍSICA (Indicador de Agendado) ======
async function direcionarParaRecepcaoFisica(id, nome) {
  if (!isAdmin) { showToast('🔒 Apenas administradores podem realizar esta ação!', true); return; }
  if (!confirm(`📋 Marcar "${nome}" como AGENDADO (Recepção)?\n\nO paciente será direcionado para a recepção para agendamento manual.`)) return;
  try {
    // Atualiza o tipo_atendimento para indicar que está aguardando agendamento na recepção
    const r = await fetch(`${API_URL}/patients/${id}/transfer`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novoSetor: 'Acolhimento',
        novoTipoAtendimento: '📋 Agendado – Recepção',
        novoProfissional: null,
        senha: adminPassword
      })
    });
    if (r.status === 403) { showToast('❌ Permissão negada!', true); return; }
    if (!r.ok) { const d = await r.json(); showToast(d.error || 'Erro!', true); return; }
    showToast(`📋 ${nome} marcado como Agendado – aguardando na Recepção!`);
    loadAcolhimentoFluxo(); loadQueues();
  } catch { showToast('Erro ao direcionar!', true); }
}


function abrirModalEncaminhar(id, nome) {
  document.getElementById('acol-modal-id').value = id;
  document.getElementById('acol-modal-patient-info').textContent = `👤 ${nome}`;
  const patient = acolhimentoFluxo.primeira_escuta?.find(p => p.id == id);
  const motivoExistente = (patient?.motivo_primeira_escuta || patient?.queixa || '').trim();
  document.getElementById('acol-modal-queixa').value = motivoExistente;
  document.getElementById('acol-modal-cpf').value = patient?.cpf || '';
  document.getElementById('acol-modal-sus').value = patient?.cartao_sus || '';
  const eqSelect = document.getElementById('acol-modal-equipe');
  if (eqSelect) eqSelect.value = patient?.equipe_paciente || '';
  selectRisco(patient?.risco_clinico || 'verde');
  document.getElementById('acol-modal-tipo-prof').value = '';
  document.getElementById('acol-modal-prof-dest').innerHTML = '<option value="">— Opcional —</option>';
  // Pre-fill condições from patient data
  setCondicoesCheckboxes('condicoes-especiais-escuta1', patient?.condicoes_especiais);
  document.getElementById('acol-escuta-modal').classList.add('show');
}

async function chamarNoPainel(source, btn) {
  if (typeof unlockAudio === 'function' && !audioUnlocked) {
    unlockAudio(true);
  }
  if (lastSpokenCallId === null) {
    lastSpokenCallId = 0;
  }

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
  
  // Determinar destino para a voz e para o painel
  let destino = 'Acolhimento';
  if (source === 'escuta1') {
    const patient = acolhimentoFluxo.primeira_escuta?.find(p => p.id == id);
    const profName = patient?.profissional || patient?.acs_responsavel || document.getElementById('filter-profissional')?.value || '';
    destino = (profName && profName !== 'Todos') ? `1ª Escuta - ${profName}` : '1ª Escuta';
  } else {
    // 2ª Escuta – tenta pegar profissional destino
    const patient = acolhimentoFluxo.segunda_escuta?.find(p => p.id == id);
    const profName = patient?.profissional_destino ? patient.profissional_destino : '';
    destino = profName ? `2ª Escuta - ${profName}` : '2ª Escuta';
  }
  
  // Atualiza visualmente o botão (três pontinhos)
  let originalHtml = '';
  if (btn) {
    originalHtml = btn.innerHTML;
    btn.innerHTML = '⏳ Chamando...';
    btn.disabled = true;
  }
  
  if (navigator.onLine === false) {
    atualizarStatusConexao('offline', 'Navegador sem internet');
    showToast('🔴 Sem internet! Verifique a conexão antes de chamar.', true);
    return;
  }
  try {
    const r = await fetch(`${API_URL}/acolhimento/${id}/chamar`, { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destino })
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    registrarSucessoRede();
    showToast(`🔊 Chamando ${nome} no painel...`);
    loadHistory();
  } catch (e) { 
    if (isErroDeRede(e)) {
      registrarFalhaRede(e);
      showToast('🔴 Sem conexão com a internet! Não foi possível chamar.', true);
    } else {
      showToast('Erro ao chamar no painel', true); 
    }
  } finally {
    if (btn) {
      setTimeout(() => {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
      }, 3000);
    }
  }
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
  const eqSelect = document.getElementById('acol-modal-equipe');
  const equipe_paciente = eqSelect && eqSelect.value ? eqSelect.value : null;
  const profissional_destino = document.getElementById('acol-modal-prof-dest').value || null;
  const tipo_profissional_destino = document.getElementById('acol-modal-tipo-prof').value || null;
  const condicoes_especiais = getCondicoesFromContainer('condicoes-especiais-escuta1');
  if (!queixa) { showToast('Preencha a queixa / motivo da 1ª escuta!', true); return; }
  try {
    const r = await fetch(`${API_URL}/acolhimento/${id}/encaminhar`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queixa,
        motivo_primeira_escuta: queixa,
        equipe_paciente,
        risco_clinico: selectedRisco,
        profissional_destino,
        tipo_profissional_destino,
        cpf,
        cartao_sus,
        condicoes_especiais
      })
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

async function finalizarAcsDireto(id, agendar, nome, agendamentoData) {
  if (!confirm(`Deseja finalizar o atendimento de ${nome}?`)) return;
  try {
    const r = await fetch(`${API_URL}/acolhimento/${id}/finalizar-escuta1`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agendamento_realizado: agendar })
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error); }

    // === GATILHO: Encaminhar para checklist interno do Carlos ===
    if (agendar) {
      const horarioAtual = new Date().toLocaleTimeString('pt-BR', {
        timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'
      });
      const dados = agendamentoData || {};
      try {
        await fetch(`${API_URL}/ctrl-agendamentos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            patient_id: id, 
            nome, 
            horario: horarioAtual, 
            queixa: dados.queixa || null,
            equipe: dados.equipe || null,
            cpf6: dados.cpf6 || null
          })
        });
      } catch (e) {
        // Falha silenciosa: não bloqueia o fluxo principal
        console.warn('[ctrl-agendamentos] Erro ao registrar:', e.message);
      }
    }
    // === FIM GATILHO ===

    showToast(agendar ? `🗂️ ${nome} encaminhado para Agendamento!` : `✅ Atendimento de ${nome} finalizado`);
    loadAcolhimentoFluxo(); loadHistory(); loadAttended();
    // A pedido do usuário: Não muda de aba automaticamente. O ACS deve continuar na aba atual.
  } catch (e) { showToast(e.message || 'Erro ao finalizar', true); }
}

// ==== NOVO FLUXO: MODAL SALA DE AGENDAMENTO ====
function abrirModalAgendamento(id, nome, queixaPrevia) {
  document.getElementById('agend-patient-id').value = id;
  document.getElementById('agend-patient-name').textContent = nome;
  document.getElementById('agend-modal-queixa').value = queixaPrevia || '';
  document.getElementById('agend-modal-equipe').value = '';
  document.getElementById('agend-modal-cpf').value = '';
  document.getElementById('modal-agendamento').classList.add('show');
}

function fecharModalAgendamento() {
  document.getElementById('modal-agendamento').classList.remove('show');
}

function confirmarModalAgendamento() {
  const id = document.getElementById('agend-patient-id').value;
  const nome = document.getElementById('agend-patient-name').textContent;
  const queixa = document.getElementById('agend-modal-queixa').value.trim();
  const equipe = document.getElementById('agend-modal-equipe').value;
  const cpf6 = document.getElementById('agend-modal-cpf').value.trim();

  fecharModalAgendamento();
  finalizarAcsDireto(id, true, nome, { queixa, equipe, cpf6 });
}
// ===============================================

function buscarPacienteAcolhimentoPorId(id) {
  const idNum = Number(id);
  return (
    acolhimentoFluxo.segunda_escuta?.find(p => p.id == idNum) ||
    acolhimentoFluxo.primeira_escuta?.find(p => p.id == idNum) ||
    acolhimentoFluxo.recepcao?.find(p => p.id == idNum) ||
    (queues['Acolhimento'] || []).find(p => p.id == idNum) ||
    null
  );
}

function finalizarAtendimento(id, nome) {
  const patient = buscarPacienteAcolhimentoPorId(id);
  document.getElementById('acol-escuta2-id').value = id;
  document.getElementById('acol-escuta2-patient-info').textContent = `👤 ${nome || patient?.nome || ''}`;

  // Preencher Banner de Contexto da 1ª Escuta (somente leitura)
  const viewEquipeEl = document.getElementById('acol-escuta2-view-equipe');
  if (viewEquipeEl) {
    viewEquipeEl.textContent = patient?.equipe_paciente ? `🏥 ${patient.equipe_paciente}` : '🏥 Equipe não informada na recepção';
  }
  const viewMotivo1El = document.getElementById('acol-escuta2-view-motivo1');
  if (viewMotivo1El) {
    const motivoOriginal = (patient?.motivo_primeira_escuta || patient?.queixa || '').trim();
    viewMotivo1El.textContent = motivoOriginal || 'Sem queixa/motivo registrado na 1ª Escuta';
  }

  // Pre-fill fields for editing / 2ª escuta
  document.getElementById('acol-escuta2-queixa').value = patient?.queixa || patient?.motivo_primeira_escuta || '';
  document.getElementById('acol-escuta2-cpf').value = patient?.cpf || '';
  document.getElementById('acol-escuta2-sus').value = patient?.cartao_sus || '';
  setCondicoesCheckboxes('condicoes-especiais-escuta2', patient?.condicoes_especiais);

  // Resetar controles do bloco de Reencaminhamento como Intercorrência
  const selSetorDest = document.getElementById('acol-escuta2-setor-destino');
  if (selSetorDest) selSetorDest.value = '';
  const selProfDest = document.getElementById('acol-escuta2-prof-destino');
  if (selProfDest) selProfDest.innerHTML = '<option value="">— Automático por Equipe / Fila Geral —</option>';
  const obsSecEl = document.getElementById('acol-escuta2-obs-segunda');
  if (obsSecEl) obsSecEl.value = patient?.observacao_segunda_escuta || '';

  selectGravidade('verde');
  const radioFalse = document.querySelector('input[name="acol-escuta2-agend"][value="false"]');
  if (radioFalse) radioFalse.checked = true;
  document.getElementById('acol-escuta2-modal').classList.add('show');
}

function abrirModalReencaminharEscuta2(id, nome) {
  finalizarAtendimento(id, nome);
  setTimeout(() => {
    const selSetor = document.getElementById('acol-escuta2-setor-destino');
    if (selSetor) {
      selSetor.scrollIntoView({ behavior: 'smooth', block: 'center' });
      selSetor.focus();
    }
  }, 120);
}

function atualizarProfissionaisDestinoEscuta2() {
  const selSetor = document.getElementById('acol-escuta2-setor-destino');
  const selProf = document.getElementById('acol-escuta2-prof-destino');
  if (!selSetor || !selProf) return;
  const setorRaw = selSetor.value;
  const id = document.getElementById('acol-escuta2-id')?.value;
  const patient = buscarPacienteAcolhimentoPorId(id);
  const eq = String(patient?.equipe_paciente || '').toLowerCase();

  selProf.innerHTML = '<option value="">— Automático por Equipe / Fila Geral —</option><option value="__TODOS__">📋 Todos do Setor (Fila Geral)</option>';
  const setorCfgKey = (setorRaw === 'Vacina' || setorRaw === 'Téc. Enfermagem')
    ? 'Téc. Enfermagem'
    : (setorRaw === 'Enfermeiro' ? 'Enfermagem' : (setorRaw === 'Dentista' ? 'Odontologia' : setorRaw));
  const cfg = SECTOR_CONFIG[setorCfgKey];
  let autoProf = '';
  if (setorCfgKey === 'Médico') {
    if (eq.includes('eq 1') || eq.includes('chico mendes')) autoProf = 'Dr. Israel Christian';
    else if (eq.includes('eq 2') || eq.includes('ximbor')) autoProf = 'Dr. Joene Halan';
    else if (eq.includes('eq 3') || eq.includes('aurora')) autoProf = 'Dra. Mirela Mota';
  } else if (setorCfgKey === 'Enfermagem') {
    if (eq.includes('eq 1') || eq.includes('chico mendes')) autoProf = 'Mariana Vaz';
    else if (eq.includes('eq 2') || eq.includes('ximbor')) autoProf = 'Jorge Marcio';
    else if (eq.includes('eq 3') || eq.includes('aurora')) autoProf = 'Lucelia de Abreu';
  } else if (setorCfgKey === 'Odontologia') {
    autoProf = 'Dra. Juliana Cavalcante';
  }

  if (cfg && Array.isArray(cfg.profissionais)) {
    cfg.profissionais.forEach(prof => {
      const opt = document.createElement('option');
      opt.value = prof;
      opt.textContent = prof;
      if (autoProf && prof === autoProf) opt.selected = true;
      selProf.appendChild(opt);
    });
  }
}

async function confirmarEncaminhamentoIntercorrenciaEscuta2(btn) {
  const id = document.getElementById('acol-escuta2-id')?.value;
  if (!id) {
    showToast('Erro: ID do paciente não identificado para o reencaminhamento!', true);
    return;
  }
  const nome = (document.getElementById('acol-escuta2-patient-info')?.textContent || '').replace('👤 ', '').trim();
  const setor_destino = (document.getElementById('acol-escuta2-setor-destino')?.value || '').trim();
  const profRaw = (document.getElementById('acol-escuta2-prof-destino')?.value || '').trim();
  const profissional_destino = profRaw || null;
  const observacao_segunda_escuta = (document.getElementById('acol-escuta2-obs-segunda')?.value || '').trim();
  const queixa = (document.getElementById('acol-escuta2-queixa')?.value || '').trim();
  const cpf = document.getElementById('acol-escuta2-cpf')?.value.trim() || null;
  const cartao_sus = document.getElementById('acol-escuta2-sus')?.value.trim() || null;
  const condicoes_especiais = getCondicoesFromContainer('condicoes-especiais-escuta2');

  if (!setor_destino) {
    showToast('Selecione o setor/departamento de destino (Médico, Enfermagem, Odontologia, etc.) para reencaminhar!', true);
    const selSetor = document.getElementById('acol-escuta2-setor-destino');
    if (selSetor) selSetor.focus();
    return;
  }

  let originalText = '';
  if (btn) {
    originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⏳ Reencaminhando...';
  }
  try {
    const r = await fetch(`${API_URL}/fila/${encodeURIComponent(id)}/encaminhar-acolhimento`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        setor_destino,
        profissional_destino,
        observacao_segunda_escuta: observacao_segunda_escuta || null,
        queixa: queixa || null,
        cpf,
        cartao_sus,
        condicoes_especiais
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(data.error || 'Erro ao encaminhar paciente como intercorrência!');
    }
    document.getElementById('acol-escuta2-modal').classList.remove('show');
    const profResolvido = data.patient?.profissional || (profissional_destino && profissional_destino !== '__TODOS__' ? profissional_destino : '');
    const profLabel = profResolvido ? ` (${profResolvido})` : ' (Fila Geral)';
    showToast(`🚨 ${nome} encaminhado para ${data.setor_destino || setor_destino}${profLabel} como Intercorrência do Acolhimento!`);
    await Promise.all([loadQueues(), loadAcolhimentoFluxo()]);
  } catch (e) {
    showToast(e.message || 'Erro ao reencaminhar paciente!', true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText || '🚨 Encaminhar como Intercorrência';
    }
  }
}

let selectedGravidade = 'verde';
function selectGravidade(gravidade) {
  selectedGravidade = gravidade;
  document.querySelectorAll('#acol-gravidade-chooser .acol-risco-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.gravidade === gravidade);
  });
}

async function confirmarFinalizacaoEscuta2() {
  // Se o profissional selecionou um Setor de Destino no bloco de Intercorrência e clicou no botão inferior por engano,
  // redireciona automaticamente para o encaminhamento para que o paciente NÃO seja dado como finalizado!
  const setorDestinoSelecionado = (document.getElementById('acol-escuta2-setor-destino')?.value || '').trim();
  if (setorDestinoSelecionado) {
    const btnInterc = document.getElementById('btn-encaminhar-intercorrencia-escuta2');
    return confirmarEncaminhamentoIntercorrenciaEscuta2(btnInterc);
  }

  const id = document.getElementById('acol-escuta2-id').value;
  const agendamento = document.querySelector('input[name="acol-escuta2-agend"]:checked')?.value === 'true';
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
    await Promise.all([loadAcolhimentoFluxo(), loadQueues()]);
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



// ====== TELA ACS – 1ª ESCUTA ======
const ACS_LIST = [
  'Ana Paula',
  'Ana Lúcia',
  'Lenilda',
  'Ceça Conceição',
  'Joselita',
  'Alda',
  'Simone',
  'Patrícia',
  'Telma',
  'Jeane',
  'Josélia',
  'Arlinda',
  'Nena',
  'Rosilene',
  'Fátima'
];

function initAcsEscutaScreen() {
  const el = document.getElementById('screen-acs_escuta');
  if (!el) return;
  el.innerHTML = `
    <div class="acs-screen-header">
      <div class="sector-icon-big" style="background:rgba(244,130,30,0.2);">🧡</div>
      <div>
        <div class="sector-page-title">Acolhimento ACS – 1ª Escuta</div>
        <div class="sector-page-sub">Fila exclusiva dos Agentes Comunitários de Saúde</div>
      </div>
    </div>
    <div class="acs-stat-bar">
      <div class="acs-stat">
        <div class="acs-stat-val" id="acs-stat-aguardando">0</div>
        <div class="acs-stat-lbl">Aguardando<br>1ª Escuta</div>
      </div>
      <div class="acs-stat" style="background:rgba(74,171,60,0.12);border-color:rgba(74,171,60,0.3);">
        <div class="acs-stat-val" id="acs-stat-em-atendimento" style="color:#4aab3c;">0</div>
        <div class="acs-stat-lbl" style="color:rgba(255,255,255,0.7);">Em<br>Atendimento</div>
      </div>
    </div>
    <div class="acs-grid" id="acs-grid-container"></div>
  `;
}

function renderAcsEscutaScreen() {
  const container = document.getElementById('acs-grid-container');
  if (!container) return;

  const recepcao = acolhimentoFluxo.recepcao || [];
  const primeiraEscuta = acolhimentoFluxo.primeira_escuta || [];

  // Update stats
  const statAg = document.getElementById('acs-stat-aguardando');
  const statEm = document.getElementById('acs-stat-em-atendimento');
  if (statAg) statAg.textContent = recepcao.length;
  if (statEm) statEm.textContent = primeiraEscuta.length;

  // Update badge on tab
  const totalAcs = recepcao.length + primeiraEscuta.length;
  const badge = document.getElementById('badge-acs_escuta');
  if (badge) {
    badge.textContent = totalAcs;
    badge.style.display = totalAcs > 0 ? 'inline-block' : 'none';
    if (totalAcs > 0) badge.classList.add('badge-pulse');
    else badge.classList.remove('badge-pulse');
  }

  container.innerHTML = ACS_LIST.map(acs => {
    const emAtendimento = primeiraEscuta.filter(p => p.acs_responsavel && p.acs_responsavel.startsWith(acs));
    const emAtendCount = emAtendimento.length;

    const patientsHtml = emAtendimento.length === 0
      ? '<div style="text-align:center;padding:18px;color:rgba(255,255,255,0.45);font-size:13px;font-weight:700;">Nenhum paciente em atendimento com este ACS</div>'
      : `<div class="fila-table-wrap">
          <table class="fila-clean-table">
            <thead>
              <tr>
                <th class="col-pos"># / Horário</th>
                <th class="col-paciente">Paciente &amp; Equipe</th>
                <th class="col-historico">Motivo da 1ª Escuta</th>
                <th class="col-status">Status</th>
                <th class="col-acoes">Ações</th>
              </tr>
            </thead>
            <tbody>
              ${emAtendimento.map((p, idx) => {
                const nomeSafe = p.nome.replace(/'/g, "\\'");
                const prioBadge = renderPrioridadeIdadeBadge(p);
                const waitBadge = renderEsperaNormalBadge(p);
                const equipeBadge = renderEquipePacienteBadge(p);
                const riscoBadge = p.risco_clinico && p.risco_clinico !== 'verde'
                  ? `<span class="acol-risco-badge ${p.risco_clinico}">${p.risco_clinico === 'vermelho' ? '🔴' : p.risco_clinico === 'amarelo' ? '🟡' : '🟦'}</span>` : '';
                const tempoMin = p.inicio_etapa ? Math.round((Date.now() - new Date(p.inicio_etapa).getTime()) / 60000) : Math.round((Date.now() - new Date(p.created_at).getTime()) / 60000);
                const condBadges = renderCondicoesBadges(p.condicoes_especiais);
                const radarBtn = !p.busca_ativa ? renderBotaoBuscaAtivaCard(p, 'ACS - 1ª Escuta') : '';
                const alumiaBloco = renderBlocoBuscaAtivaEquipe(p, 'ACS - 1ª Escuta');
                const motivo1 = (p.motivo_primeira_escuta || p.queixa || '').trim();
                const adminBtns = isAdmin ? `
                  <button class="btn-danger" style="font-size:11px;padding:4px 8px;" onclick="event.stopPropagation();removePatient(${p.id},'${nomeSafe}')" title="Desistência">🚶</button>
                ` : '';

                return `<tr class="${p.status === 'chamado' ? 'row-calling' : ''}">
                  <td class="fila-pos-cell">
                    <div class="fila-pos-badge">${idx + 1}º</div>
                    <div style="font-size:11px;color:#64748b;font-weight:700;margin-top:4px;">🕐 ${p.horario || ''}</div>
                    <div style="margin-top:3px;"><span class="acol-tempo-badge">⏱ ${tempoMin}m</span> ${waitBadge}</div>
                  </td>
                  <td>
                    <div class="fila-paciente-nome">${escapeText(p.nome)} ${prioBadge}</div>
                    <div class="fila-paciente-sub">${equipeBadge} ${riscoBadge} ${condBadges}</div>
                  </td>
                  <td>
                    <div class="fila-motivo-box">
                      ${motivo1 ? `<div class="motivo-1">💬 <strong>1ª Escuta:</strong> "${escapeText(motivo1)}"</div>` : '<span style="font-size:11.5px;color:#94a3b8;font-style:italic;">Sem queixa informada</span>'}
                      ${alumiaBloco}
                    </div>
                  </td>
                  <td>
                    <span class="item-status ${p.status === 'chamado' ? 'status-calling' : 'status-waiting'}">${p.status === 'chamado' ? '📢 Chamando' : '🟡 Em 1ª Escuta'}</span>
                  </td>
                  <td>
                    <div class="fila-actions-cell">
                      ${radarBtn}
                      <button class="acs-btn-chamar" onclick="chamarAcsPaciente(${p.id},'${nomeSafe}','${acs}',this)">🔊 Chamar</button>
                      <button class="acs-btn-enc" onclick="abrirModalEncaminharAcs(${p.id},'${nomeSafe}')">📤 Encaminhar 2ª</button>
                      <button class="acs-btn-enc" style="background:linear-gradient(135deg,#4aab3c,#3a8a2e);" onclick="finalizarAcsDireto(${p.id}, false, '${nomeSafe}')">✅ Finalizar</button>
                      <button class="acs-btn-enc" style="background:linear-gradient(135deg,#1976d2,#0d47a1);" onclick="abrirModalAgendamento(${p.id}, '${nomeSafe}', '${motivo1.replace(/'/g,"\\'")}')">🗂️ Agendar</button>
                      ${adminBtns}
                    </div>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`;

    return `<div class="acs-col">
      <div class="acs-col-header">
        <div class="acs-col-name">👤 ${acs} <span class="acs-col-badge">${emAtendCount} em atend.</span></div>
        <button class="acs-call-btn" onclick="chamarProximoParaAcs('${acs}',this)" title="Chamar próximo da recepção">📢 Chamar Próximo</button>
      </div>
      <div class="acs-patient-list">${patientsHtml}</div>
    </div>`;
  }).join('');
}

async function chamarProximoParaAcs(acs, btn) {
  const recepcao = acolhimentoFluxo.recepcao || [];
  if (!recepcao.length) { showToast('Nenhum paciente aguardando na recepção!', true); return; }
  const proximo = recepcao[0];
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Chamando...'; }
  try {
    const r = await fetch(`${API_URL}/acolhimento/${proximo.id}/iniciar-escuta`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acs_responsavel: acs })
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
    showToast(`✅ ${proximo.nome} chamado para ${acs}`);
    // Chamar no painel de voz
    await fetch(`${API_URL}/acolhimento/${proximo.id}/chamar`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destino: `1ª Escuta - ${acs}` })
    });
    loadAcolhimentoFluxo();
  } catch(e) { showToast(e.message || 'Erro ao chamar paciente!', true); }
  finally {
    if (btn) { setTimeout(() => { btn.disabled = false; btn.innerHTML = '📢 Chamar Próximo'; }, 3000); }
  }
}

async function chamarAcsPaciente(id, nome, acs, btn) {
  if (navigator.onLine === false) {
    atualizarStatusConexao('offline', 'Navegador sem internet');
    showToast('🔴 Sem internet! Verifique a conexão antes de chamar.', true);
    return;
  }
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳...'; }
  try {
    const r = await fetch(`${API_URL}/acolhimento/${id}/chamar`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destino: `1ª Escuta - ${acs}` })
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    registrarSucessoRede();
    showToast(`🔊 Chamando ${nome}...`);
    loadAcolhimentoFluxo();
  } catch(e) {
    if (isErroDeRede(e)) {
      registrarFalhaRede(e);
      showToast('🔴 Sem conexão com a internet! Não foi possível chamar.', true);
    } else {
      showToast('Erro ao chamar no painel', true);
    }
  }
  finally { if (btn) setTimeout(() => { btn.disabled = false; btn.innerHTML = '🔊 Chamar'; }, 2500); }
}

function abrirModalEncaminharAcs(id, nome) {
  // Reutiliza modal existente do Acolhimento
  abrirModalEncaminhar(id, nome);
}

// ====== TELA 2ª ESCUTA ======
let segundaEscutaFilter = 'todos';

const SEGUNDA_ESCUTA_PROFS = [
  { tipo: 'medico', label: '🩺 Médico', profs: SECTOR_CONFIG['Médico']?.profissionais || [] },
  { tipo: 'enfermagem', label: '👩‍⚕️ Enfermagem', profs: SECTOR_CONFIG['Enfermagem']?.profissionais || [] },
  { tipo: 'odontologia', label: '🦷 Odontologia', profs: SECTOR_CONFIG['Odontologia']?.profissionais || [] },
];

function initSegundaEscutaScreen() {
  const el = document.getElementById('screen-segunda_escuta');
  if (!el) return;
  const filterBtns = [
    { key: 'todos', label: '📋 Todos' },
    { key: 'medico', label: '🩺 Médico' },
    { key: 'enfermagem', label: '👩‍⚕️ Enfermagem' },
    { key: 'odontologia', label: '🦷 Odontologia' },
  ].map(f => `<button class="seg-filter-btn${segundaEscutaFilter === f.key ? ' active' : ''}" data-seg-filter="${f.key}" onclick="filtrarSegundaEscuta('${f.key}')">${f.label}</button>`).join('');

  el.innerHTML = `
    <div class="seg-screen-header">
      <div class="sector-icon-big" style="background:rgba(229,57,53,0.2);">🔴</div>
      <div>
        <div class="sector-page-title">Acolhimento – 2ª Escuta</div>
        <div class="sector-page-sub">Médicos, Enfermeiros e Dentistas – Atendimento Final</div>
      </div>
    </div>
    <div class="seg-stat-bar">
      <div class="seg-stat">
        <div class="seg-stat-val" id="seg-stat-aguardando">0</div>
        <div class="seg-stat-lbl">Aguardando<br>2ª Escuta</div>
      </div>
    </div>
    <div class="seg-filter-bar">
      <label>Filtrar:</label>
      ${filterBtns}
    </div>
    <div class="seg-grid" id="seg-grid-container"></div>
  `;
}

function filtrarSegundaEscuta(filtro) {
  segundaEscutaFilter = filtro;
  document.querySelectorAll('.seg-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.segFilter === filtro);
  });
  renderSegundaEscutaScreen();
}

function renderSegundaEscutaScreen() {
  const container = document.getElementById('seg-grid-container');
  if (!container) return;

  let pacientes = acolhimentoFluxo.segunda_escuta || [];

  // Update stat
  const statEl = document.getElementById('seg-stat-aguardando');
  if (statEl) statEl.textContent = pacientes.length;

  // Update badge
  const badge = document.getElementById('badge-segunda_escuta');
  if (badge) {
    badge.textContent = pacientes.length;
    badge.style.display = pacientes.length > 0 ? 'inline-block' : 'none';
    if (pacientes.length > 0) badge.classList.add('badge-pulse');
    else badge.classList.remove('badge-pulse');
  }

  // Apply filter
  if (segundaEscutaFilter !== 'todos') {
    pacientes = pacientes.filter(p => {
      const tipo = (p.tipo_profissional_destino || '').toLowerCase();
      return tipo === segundaEscutaFilter;
    });
  }

  if (!pacientes.length) {
    container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:rgba(255,255,255,0.45);font-size:14px;font-weight:700;">Nenhum paciente aguardando 2ª escuta</div>';
    return;
  }

  // Group by profissional_destino (quando não houver profissional designado na 1ª escuta, exibe "Se dirija à 2ª Escuta")
  const groups = {};
  pacientes.forEach(p => {
    const profDest = (p.profissional_destino || '').trim();
    const key = profDest || 'Se dirija à 2ª Escuta';
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  });

  container.innerHTML = Object.entries(groups).map(([prof, list]) => {
    const tipo = list[0]?.tipo_profissional_destino || '';
    const tipoIcon = prof === 'Se dirija à 2ª Escuta' ? '📍' : (tipo === 'medico' ? '🩺' : tipo === 'enfermagem' ? '👩‍⚕️' : tipo === 'odontologia' ? '🦷' : '👨‍⚕️');

    const rowsHtml = list.map((p, idx) => {
      const nomeSafe = p.nome.replace(/'/g, "\\'");
      const prioBadge = renderPrioridadeIdadeBadge(p);
      const waitBadge = renderEsperaNormalBadge(p);
      const equipeBadge = renderEquipePacienteBadge(p);
      const intercorrenciaBadge = renderIntercorrenciaAcolhimentoBadge(p);
      const riscoBadge = p.risco_clinico
        ? `<span class="acol-risco-badge ${p.risco_clinico}">${p.risco_clinico === 'vermelho' ? '🔴 ALTO' : p.risco_clinico === 'amarelo' ? '🟡 MOD.' : p.risco_clinico === 'azul' ? '🟦 SEM' : '🟢'}</span>` : '';
      const condBadges = renderCondicoesBadges(p.condicoes_especiais);
      const tempoMin = p.inicio_etapa ? Math.round((Date.now() - new Date(p.inicio_etapa).getTime()) / 60000) : Math.round((Date.now() - new Date(p.created_at).getTime()) / 60000);
      const acsLabel = p.acs_responsavel ? `<div style="font-size:11.5px;color:#475569;font-weight:700;">👤 ACS: ${escapeText(p.acs_responsavel)}</div>` : '';
      const radarBtn = !p.busca_ativa ? renderBotaoBuscaAtivaCard(p, `2ª Escuta - ${prof}`) : '';
      const alumiaBloco = renderBlocoBuscaAtivaEquipe(p, `2ª Escuta - ${prof}`);
      const motivo1 = (p.motivo_primeira_escuta || p.queixa || '').trim();
      const obs2 = (p.observacao_segunda_escuta || '').trim();
      const adminBtns = isAdmin ? `
        <button class="btn-danger" style="font-size:11px;padding:4px 8px;" onclick="event.stopPropagation();removePatient(${p.id},'${nomeSafe}')" title="Desistência">🚶</button>
      ` : '';

      return `<tr class="${p.status === 'chamado' ? 'row-calling' : ''}">
        <td class="fila-pos-cell">
          <div class="fila-pos-badge">${idx + 1}º</div>
          <div style="font-size:11px;color:#64748b;font-weight:700;margin-top:4px;">🕐 ${p.horario || ''}</div>
          <div style="margin-top:3px;"><span class="acol-tempo-badge">⏱ ${tempoMin}m</span> ${waitBadge}</div>
        </td>
        <td>
          <div class="fila-paciente-nome">${escapeText(p.nome)} ${prioBadge}</div>
          <div class="fila-paciente-sub">${equipeBadge} ${riscoBadge} ${condBadges}</div>
        </td>
        <td>
          <div class="fila-motivo-box">
            ${intercorrenciaBadge ? `<div style="margin-bottom:4px;">${intercorrenciaBadge}</div>` : ''}
            ${motivo1 ? `<div class="motivo-1">💬 <strong>1ª Escuta:</strong> "${escapeText(motivo1)}"</div>` : '<span style="font-size:11.5px;color:#94a3b8;font-style:italic;">Sem queixa registrada na 1ª escuta</span>'}
            ${obs2 ? `<div class="motivo-2">🩺 <strong>2ª Escuta:</strong> "${escapeText(obs2)}"</div>` : ''}
            ${alumiaBloco}
          </div>
        </td>
        <td>
          <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start;">
            <span class="item-status ${p.status === 'chamado' ? 'status-calling' : 'status-waiting'}">${p.status === 'chamado' ? '📢 Chamando' : '🔴 Aguardando 2ª Escuta'}</span>
            ${acsLabel}
          </div>
        </td>
        <td>
          <div class="fila-actions-cell">
            ${radarBtn}
            <button class="seg-btn-chamar" onclick="chamarSegundaEscutaPaciente(${p.id},'${nomeSafe}','${(p.profissional_destino || '').replace(/'/g,"\\'")}',this)">🔊 Chamar</button>
            <button class="seg-btn-finalizar" style="background:linear-gradient(135deg,#c62828,#8e0000);" onclick="abrirModalReencaminharEscuta2(${p.id},'${nomeSafe}')">🚨 Encaminhar (Intercorrência)</button>
            <button class="btn-transfer-sector" onclick="event.stopPropagation();abrirModalEncaminharPublico(${p.id}, '${nomeSafe}', 'Acolhimento')">↗️ Outro Setor</button>
            <button class="seg-btn-finalizar" onclick="finalizarAtendimento(${p.id},'${nomeSafe}')">✅ Finalizar</button>
            ${adminBtns}
          </div>
        </td>
      </tr>`;
    }).join('');

    return `<div class="seg-col">
      <div class="seg-col-header">
        <div class="seg-col-name">${tipoIcon} ${prof} <span class="seg-col-badge">${list.length}</span></div>
      </div>
      <div class="seg-patient-list">
        <div class="fila-table-wrap">
          <table class="fila-clean-table">
            <thead>
              <tr>
                <th class="col-pos"># / Horário</th>
                <th class="col-paciente">Paciente &amp; Equipe</th>
                <th class="col-historico">Histórico / Motivo (1ª e 2ª Escuta)</th>
                <th class="col-status">Status / ACS</th>
                <th class="col-acoes">Ações</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function chamarSegundaEscutaPaciente(id, nome, prof, btn) {
  if (navigator.onLine === false) {
    atualizarStatusConexao('offline', 'Navegador sem internet');
    showToast('🔴 Sem internet! Verifique a conexão antes de chamar.', true);
    return;
  }
  if (typeof unlockAudio === 'function' && !audioUnlocked) {
    unlockAudio(true);
  }
  if (lastSpokenCallId === null) {
    lastSpokenCallId = 0;
  }
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳...'; }
  try {
    const profLimpo = (prof || '').trim();
    const temProfDesignado = profLimpo && !/sem designa|se dirija|2ª escuta|segunda escuta/i.test(profLimpo);
    const destino = temProfDesignado ? `2ª Escuta - ${profLimpo}` : '2ª Escuta';
    const r = await fetch(`${API_URL}/acolhimento/${id}/chamar`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destino })
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    registrarSucessoRede();
    showToast(`🔊 Chamando ${nome}...`);
    loadAcolhimentoFluxo();
    loadHistory();
  } catch(e) {
    if (isErroDeRede(e)) {
      registrarFalhaRede(e);
      showToast('🔴 Sem conexão com a internet! Não foi possível chamar.', true);
    } else {
      showToast('Erro ao chamar no painel', true);
    }
  }
  finally { if (btn) setTimeout(() => { btn.disabled = false; btn.innerHTML = '🔊 Chamar'; }, 2500); }
}

// ====== INIT ======
initSectorScreens();
initOverview();
initAcsEscutaScreen();
initSegundaEscutaScreen();
renderCanalList();
loadQueues(); loadCurrentCalling(); loadHistory(); loadAttended(); loadAllChannels();
loadAcolhimentoFluxo();

// === CTRL AGENDAMENTOS — Ocultar aba em modo TV ===
(function initCtrlAgendTab() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('modo') === 'tv') {
    document.body.classList.add('modo-tv');
    const tab = document.getElementById('tab-ctrl_agendamentos');
    if (tab) tab.style.display = 'none';
  }
})();

// ====== CTRL AGENDAMENTOS — Estado e funções ======
let ctrlAgendamentos = [];
let ctrlAgendFiltro = 'todos';
let ctrlAgendPollingTimer = null;

// === MELHORIA 1: Estado do filtro de data ===
let ctrlAgendDateFilter = null; // null = hoje (default), 'todos' = sem filtro, 'YYYY-MM-DD' = data específica

async function loadCtrlAgendamentos() {
  try {
    let url = `${API_URL}/ctrl-agendamentos`;
    if (ctrlAgendDateFilter) {
      url += `?data=${ctrlAgendDateFilter}`;
    }
    const r = await fetch(url);
    if (!r.ok) return;
    ctrlAgendamentos = await r.json();
    renderCtrlAgendamentos();
    updateCtrlAgendBadge();
  } catch(e) {}
}

function onCtrlAgendDateChange() {
  const input = document.getElementById('ctrl-agend-date-filter');
  if (input && input.value) {
    ctrlAgendDateFilter = input.value;
  } else {
    ctrlAgendDateFilter = null;
  }
  loadCtrlAgendamentos();
}

function verTodosCtrlAgendamentos() {
  ctrlAgendDateFilter = 'todos';
  const input = document.getElementById('ctrl-agend-date-filter');
  if (input) input.value = '';
  loadCtrlAgendamentos();
}

// Inicializar o date input com a data de hoje
(function initCtrlAgendDateFilter() {
  const input = document.getElementById('ctrl-agend-date-filter');
  if (input && !input.value) {
    const today = new Date();
    input.value = today.toISOString().split('T')[0];
  }
})();
// === FIM MELHORIA 1 ===

function updateCtrlAgendBadge() {
  const pendentes = ctrlAgendamentos.filter(a => a.status === 'pendente').length;
  const badge = document.getElementById('badge-ctrl_agendamentos');
  const countPendente = document.getElementById('ctrl-agend-count-pendente');
  const countAgendado = document.getElementById('ctrl-agend-count-agendado');
  const countTotal = document.getElementById('ctrl-agend-count-total');
  const statCard = document.getElementById('ctrl-agend-stat-pendente');

  if (badge) {
    badge.textContent = pendentes;
    badge.style.display = pendentes > 0 ? 'inline-block' : 'none';
    if (pendentes > 0) badge.classList.add('badge-pulse');
    else badge.classList.remove('badge-pulse');
  }
  const agendados = ctrlAgendamentos.filter(a => a.status === 'agendado').length;
  if (countPendente) countPendente.textContent = pendentes;
  if (countAgendado) countAgendado.textContent = agendados;
  if (countTotal) countTotal.textContent = ctrlAgendamentos.length;
  // Pulsar card de pendentes se houver
  if (statCard) {
    if (pendentes > 0) statCard.style.animation = 'pulseCard 2s infinite';
    else statCard.style.animation = '';
  }
}

function filtrarCtrlAgendamentos(filtro) {
  ctrlAgendFiltro = filtro;
  document.querySelectorAll('.ctrl-agend-filter').forEach(btn => {
    btn.classList.toggle('active', btn.id === 'ctrl-filter-' + filtro);
  });
  renderCtrlAgendamentos();
}

function renderCtrlAgendamentos() {
  const tbody = document.getElementById('ctrl-agend-tbody');
  if (!tbody) return;

  let lista = ctrlAgendamentos;
  if (ctrlAgendFiltro !== 'todos') {
    lista = lista.filter(a => a.status === ctrlAgendFiltro);
  }

  if (!lista.length) {
    const msg = ctrlAgendFiltro === 'pendente'
      ? '✅ Nenhum paciente pendente! Tudo agendado.'
      : ctrlAgendFiltro === 'agendado'
        ? '⏳ Nenhum agendamento realizado ainda.'
        : '📂 Nenhum paciente encaminhado para agendamento hoje.';
    tbody.innerHTML = `<tr><td colspan="5" style="padding:40px;text-align:center;color:var(--gray-600);font-size:14px;font-weight:600;">${msg}</td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map(a => {
    const isPendente = a.status === 'pendente';
    const badge = isPendente
      ? `<span class="ctrl-badge-pendente">⏳ Pendente</span>`
      : `<span class="ctrl-badge-agendado">✅ Agendado</span>`;
    const editBtn = `<button class="ctrl-btn-toggle" style="background:rgba(230,126,34,0.12);color:#d35400;border:1px solid rgba(230,126,34,0.4);margin-left:4px;padding:6px 10px;" onclick="abrirEditarCtrlAgendamento(${a.id})" title="Editar registro">✏️ Editar</button>`;
    const safeNome = (a.nome || '').replace(/'/g, "\\'");
    const safeEquipe = (a.equipe || '').replace(/'/g, "\\'");
    const safeMotivo = (a.motivo || a.queixa || 'Consulta').replace(/'/g, "\\'");
    const waBtn = `<button class="ctrl-btn-toggle" style="background:#25d366;color:#fff;border:none;margin-left:4px;padding:6px 10px;font-weight:700;" onclick="enviarWhatsAppCtrlAgendamento('${safeNome}', '${safeEquipe}', '${safeMotivo}')" title="Enviar WhatsApp de Confirmação em 1 Clique">📲 WhatsApp</button>`;

    const btn = isPendente
      ? `<button class="ctrl-btn-toggle ctrl-btn-marcar" onclick="toggleCtrlAgendamento(${a.id}, this)">✅ Marcar Agendado</button>
         ${editBtn}
         ${waBtn}
         <button class="ctrl-btn-toggle" style="background:rgba(26,79,196,0.1);color:#1a4fc4;border:1px solid rgba(26,79,196,0.3);margin-left:4px;padding:6px 10px;" onclick="chamarPacienteVoz('${safeNome}')" title="Chamar paciente via voz">📢 Chamar</button>
         <button class="ctrl-btn-toggle" style="background:rgba(229,57,53,0.1);color:#e53935;border:1px solid rgba(229,57,53,0.3);margin-left:4px;padding:6px 10px;" onclick="removerCtrlAgendamento(${a.id}, this)" title="Desistência / Excluir">🗑️</button>`
      : `<button class="ctrl-btn-toggle ctrl-btn-desfazer" onclick="toggleCtrlAgendamento(${a.id}, this)">↩ Desfazer</button>
         ${editBtn}
         ${waBtn}
         <button class="ctrl-btn-toggle" style="background:rgba(26,79,196,0.1);color:#1a4fc4;border:1px solid rgba(26,79,196,0.3);margin-left:4px;padding:6px 10px;" onclick="chamarPacienteVoz('${safeNome}')" title="Chamar paciente via voz">📢 Chamar</button>
         <button class="ctrl-btn-toggle" style="background:rgba(229,57,53,0.1);color:#e53935;border:1px solid rgba(229,57,53,0.3);margin-left:4px;padding:6px 10px;" onclick="removerCtrlAgendamento(${a.id}, this)" title="Desistência / Excluir">🗑️</button>`;
    const queixaCell = a.queixa
      ? `<span style="font-size:13px;color:var(--gray-700);">${a.queixa}</span>`
      : `<span style="font-size:12px;color:var(--gray-600);font-style:italic;">Não informada</span>`;
    
    // Novo layout da coluna "Paciente / Equipe / CPF"
    const equipeTag = a.equipe ? `<span style="display:inline-block;background:#e3f2fd;color:#1565c0;font-size:11px;padding:2px 6px;border-radius:4px;margin-top:4px;margin-right:4px;font-weight:700;">🏥 ${a.equipe}</span>` : '';
    const cpfTag = a.cpf6 ? `<span style="display:inline-block;background:#f5f5f5;color:#616161;font-size:11px;padding:2px 6px;border-radius:4px;margin-top:4px;border:1px solid #e0e0e0;font-weight:700;">🆔 ${a.cpf6}.***.***-**</span>` : '';
    const origemTag = a.setor_origem ? `<span style="display:inline-block;background:#f3e5f5;color:#7b1fa2;font-size:11px;padding:2px 6px;border-radius:4px;margin-top:4px;margin-right:4px;font-weight:700;">📋 de: ${a.setor_origem}</span>` : '';
    const motivoTag = a.motivo ? `<span style="display:inline-block;background:#e8f5e9;color:#2e7d32;font-size:11px;padding:2px 6px;border-radius:4px;margin-top:4px;margin-right:4px;font-weight:700;">📌 ${a.motivo}</span>` : '';
    
    return `<tr class="ctrl-agend-row status-${a.status}">
      <td style="font-family:'Nunito',sans-serif;font-weight:700;color:var(--blue-dark);">${a.horario}</td>
      <td>
        <div style="font-weight:700;">${a.nome}</div>
        ${origemTag}${motivoTag}${equipeTag}${cpfTag}
      </td>
      <td>${queixaCell}</td>
      <td style="text-align:center;">${badge}</td>
      <td style="text-align:center;">${btn}</td>
    </tr>`;
  }).join('');
}

function enviarWhatsAppCtrlAgendamento(nome, equipe, motivo) {
  const fone = prompt(`📲 Enviar confirmação no WhatsApp para "${nome}"\n\nDigite o número de telefone do paciente (com DDD):`, '55');
  if (!fone) return;
  const numLimpo = fone.replace(/\D/g, '');
  const dataHoje = new Date().toLocaleDateString('pt-BR');
  const msg = `Olá, *${nome}*! 🏥\n\nConfirmamos seu agendamento/encaminhamento na *USF Chico Mendes*:\n📅 Data do registro: *${dataHoje}*\n🏥 Equipe/Setor: *${equipe || 'USF Chico Mendes'}*\n📌 Motivo: *${motivo || 'Consulta'}*\n\nPor favor, compareça com documento com foto e Cartão do SUS.\n— *USF Chico Mendes* 💙`;
  window.open(`https://web.whatsapp.com/send?phone=${numLimpo}&text=${encodeURIComponent(msg)}`, '_blank');
}

function abrirEditarCtrlAgendamento(id) {
  const item = ctrlAgendamentos.find(a => a.id === id);
  if (!item) return;
  document.getElementById('edit-ctrl-id').value = item.id;
  document.getElementById('edit-ctrl-nome').value = item.nome || '';
  document.getElementById('edit-ctrl-horario').value = item.horario || '';
  document.getElementById('edit-ctrl-motivo').value = item.motivo || '';
  document.getElementById('edit-ctrl-queixa').value = item.queixa || '';
  document.getElementById('edit-ctrl-equipe').value = item.equipe || '';
  document.getElementById('edit-ctrl-cpf6').value = item.cpf6 || '';
  document.getElementById('edit-ctrl-status').value = item.status || 'pendente';
  document.getElementById('edit-ctrl-modal').classList.add('show');
}

function fecharModalEditarCtrlAgendamento() {
  document.getElementById('edit-ctrl-modal').classList.remove('show');
}

function salvarEditarCtrlAgendamento() {
  const id = parseInt(document.getElementById('edit-ctrl-id').value);
  const nome = document.getElementById('edit-ctrl-nome').value.trim();
  const horario = document.getElementById('edit-ctrl-horario').value.trim();
  const motivo = document.getElementById('edit-ctrl-motivo').value;
  const queixa = document.getElementById('edit-ctrl-queixa').value.trim();
  const equipe = document.getElementById('edit-ctrl-equipe').value;
  const cpf6 = document.getElementById('edit-ctrl-cpf6').value.trim();
  const status = document.getElementById('edit-ctrl-status').value;
  const mesSel = document.getElementById('vagas-mes')?.value;
  const anoSel = document.getElementById('vagas-ano')?.value;

  if (!nome || !horario) {
    showToast('Nome e horário são obrigatórios!', true);
    return;
  }

  pedirSenhaAdmin('Editar Registro na Sala de Agendamento', async (senhaUsada) => {
    try {
      const r = await fetch(`${API_URL}/ctrl-agendamentos/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome, horario, motivo, queixa, equipe, cpf6, status, senha: senhaUsada,
          mes_agendamento: mesSel ? parseInt(mesSel) : null,
          ano_agendamento: anoSel ? parseInt(anoSel) : null
        })
      });
      if (!r.ok) {
        const d = await r.json();
        showToast(d.error || 'Erro ao editar registro', true);
        return;
      }
      const updated = await r.json();
      const idx = ctrlAgendamentos.findIndex(a => a.id === id);
      if (idx !== -1) ctrlAgendamentos[idx] = updated;

      fecharModalEditarCtrlAgendamento();
      renderCtrlAgendamentos();
      updateCtrlAgendBadge();
      if (typeof loadVagasMedicos === 'function') loadVagasMedicos();
      showToast('✏️ Registro atualizado com sucesso!');
    } catch(e) {
      showToast('Erro ao atualizar registro', true);
    }
  });
}

async function toggleCtrlAgendamento(id, btn) {
  if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
  const mesSel = document.getElementById('vagas-mes')?.value;
  const anoSel = document.getElementById('vagas-ano')?.value;
  try {
    const r = await fetch(`${API_URL}/ctrl-agendamentos/${id}/toggle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mes_agendamento: mesSel ? parseInt(mesSel) : null,
        ano_agendamento: anoSel ? parseInt(anoSel) : null
      })
    });
    if (!r.ok) throw new Error('Erro ao atualizar');
    const updated = await r.json();
    // Atualiza estado local imediatamente (optimistic-style)
    const idx = ctrlAgendamentos.findIndex(a => a.id === id);
    if (idx !== -1) ctrlAgendamentos[idx] = updated;
    // Reordena: pendentes no topo
    ctrlAgendamentos.sort((a, b) => {
      if (a.status === b.status) return new Date(a.criado_em) - new Date(b.criado_em);
      return a.status === 'pendente' ? -1 : 1;
    });
    renderCtrlAgendamentos();
    updateCtrlAgendBadge();
    if (typeof loadVagasMedicos === 'function') loadVagasMedicos();
    showToast(updated.status === 'agendado' ? `✅ ${updated.nome} marcado como agendado!` : `↩ ${updated.nome} marcado como pendente`);
  } catch(e) {
    showToast('Erro ao atualizar status', true);
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  }
}

async function removerCtrlAgendamento(id, btn) {
  pedirSenhaAdmin('Excluir Registro da Sala de Agendamento', async (senhaUsada) => {
    if (!confirm('Deseja realmente marcar desistência/excluir este encaminhamento?')) return;
    if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
    try {
      const r = await fetch(`${API_URL}/ctrl-agendamentos/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('Erro ao excluir');
      ctrlAgendamentos = ctrlAgendamentos.filter(a => a.id !== id);
      renderCtrlAgendamentos();
      updateCtrlAgendBadge();
      showToast('🗑️ Registro removido (Desistência)');
    } catch(e) {
      showToast('Erro ao excluir registro', true);
      if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
  });
}

function exportarAgendamentosExcel() {
  // === MELHORIA 2: Senha antes de exportar ===
  const senha = prompt('🔒 Digite a senha para exportar:');
  if (!senha) return;
  if (btoa(senha) !== 'Y2hpY28xMjM=') { showToast('❌ Senha incorreta!', true); return; }
  // === FIM MELHORIA 2 ===
  if (!ctrlAgendamentos || ctrlAgendamentos.length === 0) {
    showToast('Nenhum agendamento para exportar', true);
    return;
  }
  let csv = "Data,Hora,Paciente,Equipe,CPF,Motivo,Status\n";
  const dataHoje = new Date().toLocaleDateString('pt-BR');
  ctrlAgendamentos.forEach(a => {
    const nome = `"${(a.nome || '').replace(/"/g, '""')}"`;
    const equipe = `"${(a.equipe || '').replace(/"/g, '""')}"`;
    const cpf = `"${a.cpf6 || ''}"`;
    const queixa = `"${(a.queixa || '').replace(/"/g, '""')}"`;
    const status = a.status === 'pendente' ? 'Pendente' : 'Agendado';
    csv += `${dataHoje},${a.horario},${nome},${equipe},${cpf},${queixa},${status}\n`;
  });
  
  const blob = new Blob(["\ufeff", csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `Agendamentos_${dataHoje.replace(/\//g,'-')}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function exportarAgendamentosPDF() {
  // === MELHORIA 2: Senha antes de exportar ===
  const senha = prompt('🔒 Digite a senha para exportar:');
  if (!senha) return;
  if (btoa(senha) !== 'Y2hpY28xMjM=') { showToast('❌ Senha incorreta!', true); return; }
  // === FIM MELHORIA 2 ===
  if (!ctrlAgendamentos || ctrlAgendamentos.length === 0) {
    showToast('Nenhum agendamento para exportar', true);
    return;
  }
  if (!window.jspdf || !window.jspdf.jsPDF) {
    showToast('Carregando biblioteca PDF...', true);
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('l');
  const dataHoje = new Date().toLocaleDateString('pt-BR');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Controle de Agendamentos (Acolhimento PEC Recife) — USF Chico Mendes', 148, 14, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Emitido em: ${dataHoje} | Total de registros: ${ctrlAgendamentos.length}`, 148, 21, { align: 'center' });

  const bodyRows = ctrlAgendamentos.map((a, idx) => [
    idx + 1,
    a.horario || '-',
    a.nome || '-',
    a.equipe || '-',
    a.cpf6 || '-',
    a.queixa || '-',
    a.status === 'pendente' ? 'Pendente' : 'Agendado'
  ]);

  doc.autoTable({
    startY: 27,
    head: [['Nº', 'Hora', 'Paciente', 'Equipe', 'CPF (6)', 'Motivo', 'Status']],
    body: bodyRows,
    theme: 'grid',
    headStyles: { fillColor: [26, 79, 196], fontSize: 9 },
    bodyStyles: { fontSize: 8.5 },
    alternateRowStyles: { fillColor: [240, 244, 255] }
  });

  const equipeTotals = {};
  ctrlAgendamentos.forEach(a => {
    const eq = a.equipe || 'Sem Equipe';
    if (!equipeTotals[eq]) equipeTotals[eq] = { pendente: 0, agendado: 0, total: 0 };
    equipeTotals[eq].total++;
    if (a.status === 'pendente') equipeTotals[eq].pendente++;
    else equipeTotals[eq].agendado++;
  });

  const equipeKeys = Object.keys(equipeTotals).sort();
  if (equipeKeys.length > 0) {
    const nextY = (doc.lastAutoTable ? doc.lastAutoTable.finalY : 30) + 10;
    let grandPendente = 0, grandAgendado = 0, grandTotal = 0;
    const resumoRows = equipeKeys.map(eq => {
      const t = equipeTotals[eq];
      grandPendente += t.pendente;
      grandAgendado += t.agendado;
      grandTotal += t.total;
      return [eq, t.pendente, t.agendado, t.total];
    });
    resumoRows.push(['TOTAL GERAL', grandPendente, grandAgendado, grandTotal]);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Resumo por Equipe', 14, nextY);
    doc.autoTable({
      startY: nextY + 4,
      head: [['Equipe', 'Pendentes', 'Agendados', 'Total']],
      body: resumoRows,
      theme: 'grid',
      headStyles: { fillColor: [15, 118, 110], fontSize: 9 },
      bodyStyles: { fontSize: 8.5 }
    });
  }

  doc.save(`controle_agendamentos_${dataHoje.replace(/\//g, '-')}.pdf`);
  showToast('✅ PDF gerado com sucesso!');
}

// Polling dedicado para a aba de agendamento (8s foreground / 60s background)
function startCtrlAgendPolling() {
  stopCtrlAgendPolling();
  if (isPausado || !isDentroDoHorario()) return;
  const interval = document.hidden ? 60000 : 8000;
  ctrlAgendPollingTimer = setTimeout(async () => {
    const tela = document.getElementById('screen-ctrl_agendamentos');
    if (tela && tela.classList.contains('active')) {
      await loadCtrlAgendamentos().catch(() => {});
      startCtrlAgendPolling(); // reagenda apenas se ainda ativo
    }
  }, interval);
}

function stopCtrlAgendPolling() {
  if (ctrlAgendPollingTimer) {
    clearTimeout(ctrlAgendPollingTimer);
    ctrlAgendPollingTimer = null;
  }
}

// Parar polling ao trocar de aba (visibility change já chama startAdaptivePolling)
document.addEventListener('visibilitychange', () => {
  const tela = document.getElementById('screen-ctrl_agendamentos');
  if (tela && tela.classList.contains('active')) startCtrlAgendPolling();
});
// ====== FIM CTRL AGENDAMENTOS ======

// === MONITOR DE CONEXÃO (SEMÁFORO DE INTERNET) + BUSCA RÁPIDA NA VISÃO GERAL ===
let socketConnected = navigator.onLine !== false;
let netEstadoAtual = navigator.onLine === false ? 'offline' : 'online';
let netFalhasConsecutivas = 0;
let netHealthTimer = null;

function isErroDeRede(err) {
  if (navigator.onLine === false) return true;
  if (!err) return false;
  const msg = String(err.message || err || '').toLowerCase();
  return (
    err.name === 'TypeError' ||
    err.name === 'AbortError' ||
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||
    msg.includes('err_internet_disconnected') ||
    msg.includes('err_network') ||
    msg.includes('timeout')
  );
}

function atualizarStatusConexao(estado, motivo) {
  const estadoAnterior = netEstadoAtual;
  netEstadoAtual = estado;
  socketConnected = estado !== 'offline';

  const pill = document.getElementById('net-status-pill');
  const textEl = document.getElementById('net-status-text');
  const banner = document.getElementById('offline-banner');
  const painelPill = document.getElementById('painel-net-status');
  const painelText = document.getElementById('painel-net-status-text');

  const cfg = {
    online: { label: 'Online', painelLabel: 'Conectado', title: 'Internet e servidor funcionando normalmente. Clique para testar.' },
    unstable: { label: 'Instável', painelLabel: 'Conexão Instável', title: motivo || 'Conexão lenta ou falhando. Clique para testar.' },
    offline: { label: 'Sem Internet', painelLabel: 'Sem Internet', title: motivo || 'Sem conexão com a internet ou servidor. Clique para tentar reconectar.' }
  }[estado] || { label: 'Online', painelLabel: 'Conectado', title: '' };

  if (pill) {
    pill.classList.remove('unstable', 'offline');
    if (estado !== 'online') pill.classList.add(estado);
    pill.title = cfg.title;
  }
  if (textEl) textEl.textContent = cfg.label;

  if (painelPill) {
    painelPill.classList.remove('unstable', 'offline');
    if (estado !== 'online') painelPill.classList.add(estado);
  }
  if (painelText) painelText.textContent = cfg.painelLabel;

  if (banner) {
    banner.classList.toggle('show', estado === 'offline');
  }

  if (estadoAnterior !== estado) {
    if (estado === 'offline') {
      showToast('🔴 Sem internet! Verifique a conexão antes de chamar pacientes.', true);
    } else if (estadoAnterior === 'offline' && estado === 'online') {
      showToast('🟢 Conexão restabelecida! Atualizando filas...');
      Promise.all([
        typeof loadQueues === 'function' ? loadQueues() : Promise.resolve(),
        typeof loadCurrentCalling === 'function' ? loadCurrentCalling() : Promise.resolve(),
        typeof loadHistory === 'function' ? loadHistory() : Promise.resolve(),
        typeof loadAcolhimentoFluxo === 'function' ? loadAcolhimentoFluxo() : Promise.resolve()
      ]).catch(() => {});
    }
  }
}

function registrarSucessoRede() {
  netFalhasConsecutivas = 0;
  if (navigator.onLine === false) {
    atualizarStatusConexao('offline', 'Navegador sem rede');
    return;
  }
  if (netEstadoAtual !== 'online') {
    atualizarStatusConexao('online');
  }
}

function registrarFalhaRede(err) {
  if (navigator.onLine === false) {
    netFalhasConsecutivas = 3;
    atualizarStatusConexao('offline', 'Navegador offline');
    return;
  }
  if (isErroDeRede(err)) {
    netFalhasConsecutivas++;
    if (netFalhasConsecutivas >= 2) {
      atualizarStatusConexao('offline', err && err.message ? err.message : 'Falha de conexão');
    } else {
      atualizarStatusConexao('unstable', 'Oscilação de rede detectada');
    }
  }
}

async function verificarConexaoAgora(manual) {
  if (navigator.onLine === false) {
    atualizarStatusConexao('offline', 'Navegador sem internet');
    if (manual) showToast('🔴 Sem internet no dispositivo.', true);
    return false;
  }
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 5000) : null;
  try {
    const r = await fetch(`${API_URL}/health?_t=${Date.now()}`, {
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined
    });
    if (timer) clearTimeout(timer);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    registrarSucessoRede();
    if (manual) showToast('🟢 Conexão com a internet e servidor OK!');
    return true;
  } catch (e) {
    if (timer) clearTimeout(timer);
    registrarFalhaRede(e);
    if (manual) showToast('🔴 Sem resposta do servidor ou sem internet.', true);
    return false;
  }
}

window.addEventListener('online', () => {
  atualizarStatusConexao('unstable', 'Rede retornou, verificando servidor...');
  verificarConexaoAgora(false);
});
window.addEventListener('offline', () => {
  netFalhasConsecutivas = 3;
  atualizarStatusConexao('offline', 'Navegador perdeu conexão');
});

(function initNetworkMonitor() {
  atualizarStatusConexao(navigator.onLine === false ? 'offline' : 'online');
  if (netHealthTimer) clearInterval(netHealthTimer);
  netHealthTimer = setInterval(() => {
    if (netEstadoAtual !== 'online' || navigator.onLine === false) {
      verificarConexaoAgora(false);
    }
  }, 15000);
})();

function filtrarVisaoGeralPacientes() {
  const input = document.getElementById('overview-search-input');
  const clearBtn = document.getElementById('overview-search-clear');
  const resultEl = document.getElementById('overview-search-result');
  if (!input || !resultEl) return;

  const q = (input.value || '').trim().toLowerCase();
  if (clearBtn) clearBtn.style.display = q ? 'inline-flex' : 'none';

  if (!q) {
    resultEl.classList.remove('show');
    resultEl.innerHTML = '';
    return;
  }

  const matches = [];
  (SETORES || []).forEach(setor => {
    const lista = (queues && queues[setor.id]) || [];
    let pos = 0;
    lista.forEach(p => {
      if (p.status === 'aguardando') pos++;
      if ((p.nome || '').toLowerCase().includes(q)) {
        matches.push({
          nome: p.nome,
          setorNome: setor.nome,
          setorId: setor.id,
          status: p.status,
          pos: p.status === 'aguardando' ? pos : null
        });
      }
    });
  });

  if (matches.length === 0) {
    resultEl.innerHTML = `Nenhum paciente encontrado para "<strong>${escapeText(input.value.trim())}</strong>" nas filas ativas.`;
  } else {
    resultEl.innerHTML = matches.slice(0, 6).map(m => {
      const posTxt = m.status === 'chamando'
        ? '<span style="color:#b45309;font-weight:700;">🔊 Chamando agora</span>'
        : `<span style="color:#0369a1;font-weight:700;">#${m.pos} na fila</span>`;
      return `<div style="padding:3px 0;">• <strong>${escapeText(m.nome)}</strong> — ${escapeText(m.setorNome)} (${posTxt})</div>`;
    }).join('') + (matches.length > 6 ? `<div style="margin-top:4px;color:#64748b;">+ ${matches.length - 6} outros resultados</div>` : '');
  }
  resultEl.classList.add('show');
}

function limparBuscaVisaoGeral() {
  const input = document.getElementById('overview-search-input');
  if (input) {
    input.value = '';
    filtrarVisaoGeralPacientes();
    input.focus();
  }
}

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
    loadQueues(), loadCurrentCalling(), loadHistory(), loadAttended(), loadAcolhimentoFluxo(), loadNotificacoes(), loadPendingVoiceCalls()
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
  if (chatPanelOpen) registerPresenca();
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

function copiarImagemParaClipboard(imgSrc, silencioso) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.onerror = () => {
        if (!silencioso) showToast('Não foi possível carregar a imagem.', true);
        resolve(false);
      };
      img.onload = function() {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(async (blob) => {
          if (!blob) { resolve(false); return; }
          try {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            showToast('🖼️ Imagem copiada! Cole (Ctrl+V) no WhatsApp.');
            resolve(true);
          } catch (e) {
            if (!silencioso) showToast('Erro ao copiar imagem: ' + e.message, true);
            resolve(false);
          }
        }, 'image/png');
      };
      img.src = imgSrc || '/img/confirmacao.jpg';
    } catch (err) {
      if (!silencioso) showToast('Erro: ' + err.message, true);
      resolve(false);
    }
  });
}

async function copyWaImageToClipboard() {
  await copiarImagemParaClipboard(_waCurrentImageSrc || '/img/confirmacao.jpg', false);
}

// === MELHORIA 4: CHAMADAS DE VOZ LOCAIS ===
function chamarPacienteVoz(nome) {
  unlockAudio(true);
  // Garantir que o áudio não esteja silenciado
  if (isMuted) {
    isMuted = false;
    const btn = document.getElementById('btn-mute');
    if (btn) btn.innerHTML = '🔊';
  }
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch (e) {}
  }
  isSpeaking = false;

  speakViaSynthesis(nome, 'Agendamento', 'Sala de Agendamento');
  showToast(`📢 Chamando paciente: ${nome}`);
}

async function loadPendingVoiceCalls() {
  const params = new URLSearchParams(window.location.search);
  const isTv = params.get('modo') === 'tv';
  if (!isTv) return; // Apenas executa a chamada na tela de TV
  
  try {
    const r = await fetch(`${API_URL}/voice-call/pending`);
    if (!r.ok) return;
    const calls = await r.json();
    for (const call of calls) {
      speakViaSynthesis(call.nome, call.setor, call.destino);
      await fetch(`${API_URL}/voice-call/${call.id}/ack`, { method: 'POST' });
    }
  } catch (e) {
    console.error('Erro ao processar chamadas de voz pendentes:', e);
  }
}
// === FIM MELHORIA 4 ===

// === MELHORIA 3: VAGAS MENSAIS POR MÉDICO ===
const MEDICOS_VAGAS = [
  "Dr. Israel Christian",
  "Dr. Joene Halan",
  "Dra. Mirela Mota",
  "Dra. Juliana Cavalcante"
];

let vagasInitialized = false;

async function loadVagasMedicos() {
  const mesSelect = document.getElementById('vagas-mes');
  const anoSelect = document.getElementById('vagas-ano');
  if (!mesSelect || !anoSelect) return;

  // Se o mês atual estiver sem vagas na primeira carga, auto-detectar o próximo mês com vagas disponíveis
  if (!vagasInitialized) {
    vagasInitialized = true;
    try {
      const rPr = await fetch(`${API_URL}/vagas-medicos/primeiro-disponivel`);
      if (rPr.ok) {
        const pr = await rPr.json();
        if (pr.encontrado && (pr.mes !== parseInt(mesSelect.value) || pr.ano !== parseInt(anoSelect.value))) {
          mesSelect.value = pr.mes;
          anoSelect.value = pr.ano;
          const nomesMeses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
          const mesNome = nomesMeses[pr.mes - 1] || pr.mes;
          showToast(`💡 Mês corrente sem vagas restantes. Exibindo ${mesNome}/${pr.ano}`);
        }
      }
    } catch(e) {}
  }

  const mes = mesSelect.value;
  const ano = anoSelect.value;
  if (!mes || !ano) return;

  try {
    const r = await fetch(`${API_URL}/vagas-medicos?mes=${mes}&ano=${ano}`);
    if (!r.ok) return;
    const data = await r.json();
    renderVagasMedicos(data);
  } catch (e) {
    console.error('Erro ao buscar vagas de médicos:', e);
  }
}

function renderVagasMedicos(data) {
  const container = document.getElementById('vagas-medicos-container');
  if (!container) return;

  const vagasMap = {};
  data.vagas.forEach(v => { vagasMap[v.medico] = v; });

  container.innerHTML = MEDICOS_VAGAS.map(medico => {
    const info = vagasMap[medico] || { vagas: 0, usados: 0, restantes: 0, id: null };
    const vagasVal = info.vagas || 0;
    const usadosVal = info.usados || 0;
    const restantesVal = info.restantes || (vagasVal - usadosVal);
    // Botão de excluir: só aparece se houver registro salvo (id existe)
    const deleteBtn = info.id
      ? `<button class="btn btn-sm" onclick="excluirVagaMedico(${info.id}, '${medico}')" style="background: rgba(229,57,53,0.15); color: var(--red); border: 1px solid rgba(229,57,53,0.3); font-size: 11px; padding: 6px; border-radius: 6px; font-weight: 700; cursor: pointer; width: 100%; margin-top: 4px;" title="Excluir registro de vagas (permite refazer)">🗑️ Excluir Vagas</button>`
      : '';

    return `
      <div class="card-white" style="padding: 16px; border: 1px solid rgba(255,255,255,0.12); display: flex; flex-direction: column; gap: 10px; background: rgba(255,255,255,0.05); border-radius: 12px;">
        <div style="font-weight: 800; font-size: 15px; color: var(--orange);">${medico}</div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 12px; color: var(--gray-300);">Vagas no Mês:</span>
          <input type="number" id="vagas-input-${medico.replace(/\s+/g, '_')}" value="${vagasVal}" min="0" style="width: 70px; padding: 4px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.15); background: rgba(0,0,0,0.2); color: white; text-align: center; font-weight: 700;">
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 12px;">
          <span style="color: var(--gray-300);">Agendados no Mês:</span>
          <span style="font-weight: 700; color: var(--blue);">${usadosVal}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 12px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 8px;">
          <span style="color: var(--gray-300);">Vagas Restantes:</span>
          <span style="font-weight: 800; color: ${restantesVal <= 0 ? 'var(--red)' : 'var(--green)'};">${restantesVal}</span>
        </div>
        <button class="btn btn-sm" onclick="salvarVagasMedico('${medico}')" style="background: var(--blue); color: white; border: none; font-size: 11px; padding: 6px; border-radius: 6px; font-weight: 700; cursor: pointer; width: 100%; margin-top: 4px;">💾 Salvar Vagas</button>
        ${deleteBtn}
      </div>
    `;
  }).join('');
}

async function excluirVagaMedico(id, medico) {
  pedirSenhaAdmin(`Excluir Vagas de ${medico}`, async (senhaUsada) => {
    if (!confirm(`Deseja excluir o registro de vagas de ${medico}? Isso permite refazer o cadastro de vagas.`)) return;
    try {
      const r = await fetch(`${API_URL}/vagas-medicos/${id}`, { method: 'DELETE' });
      if (r.ok) {
        showToast(`🗑️ Vagas de ${medico} excluídas!`);
        loadVagasMedicos();
      } else {
        const d = await r.json();
        showToast(d.error || 'Erro ao excluir vagas', true);
      }
    } catch (e) {
      showToast('Erro de conexão', true);
    }
  });
}

async function salvarVagasMedico(medico) {
  const input = document.getElementById(`vagas-input-${medico.replace(/\s+/g, '_')}`);
  if (!input) return;
  const vagas = parseInt(input.value) || 0;
  const mes = document.getElementById('vagas-mes').value;
  const ano = document.getElementById('vagas-ano').value;

  // Validação frontend: não permitir mês retroativo
  const now = new Date();
  const mesAtual = now.getMonth() + 1;
  const anoAtual = now.getFullYear();
  if (parseInt(ano) < anoAtual || (parseInt(ano) === anoAtual && parseInt(mes) < mesAtual)) {
    showToast('❌ Não é permitido cadastrar vagas para meses anteriores ao atual.', true);
    return;
  }

  pedirSenhaAdmin(`Salvar Vagas de ${medico}`, async (senhaUsada) => {
    try {
      const r = await fetch(`${API_URL}/vagas-medicos`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ medico, mes: parseInt(mes), ano: parseInt(ano), vagas })
      });
      if (r.ok) {
        showToast(`Vagas de ${medico} atualizadas!`);
        loadVagasMedicos();
      } else {
        const d = await r.json();
        showToast(d.error || 'Erro ao salvar vagas', true);
      }
    } catch (e) {
      showToast('Erro de conexão', true);
    }
  });
}

(function initVagasDateOptions() {
  const mesSelect = document.getElementById('vagas-mes');
  const anoSelect = document.getElementById('vagas-ano');
  if (mesSelect && anoSelect) {
    const now = new Date();
    mesSelect.value = now.getMonth() + 1;
    
    const year = now.getFullYear();
    anoSelect.innerHTML = `<option value="${year}">${year}</option><option value="${year + 1}">${year + 1}</option><option value="${year + 2}">${year + 2}</option>`;
    anoSelect.value = year;
  }
})();
// === FIM MELHORIA 3 ===

// ====== RELATÓRIO DE MENSAGENS ENVIADAS ======
let _ultimoRelatorioMensagens = null;

async function loadRelatorioMensagens() {
  const dataInput = document.getElementById('rel-msg-data');
  const content = document.getElementById('rel-msg-content');
  if (!dataInput || !content) return;
  const data = dataInput.value;
  if (!data) { showToast('⚠️ Selecione uma data para consultar!', true); return; }
  try {
    const r = await fetch(`${API_URL}/mensagens-enviadas/relatorio?data=${data}`);
    if (!r.ok) throw new Error();
    const rel = await r.json();
    _ultimoRelatorioMensagens = rel;
    renderRelatorioMensagens(rel, content);
  } catch { showToast('Erro ao carregar relatório!', true); }
}

function exportarListaAgendamentosPDF() {
  if (!_agendamentosAtuais || _agendamentosAtuais.length === 0) {
    showToast('Nenhum agendamento carregado para gerar PDF.', true);
    return;
  }
  if (!window.jspdf || !window.jspdf.jsPDF) {
    showToast('Carregando biblioteca PDF...', true);
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('l');
  const dataFiltro = document.getElementById('agend-filter-data')?.value || '';
  const statusFiltro = document.getElementById('agend-filter-status')?.value || 'Todos';
  const dataRef = dataFiltro ? dataFiltro.split('-').reverse().join('/') : new Date().toLocaleDateString('pt-BR');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Relatório de Agendamentos — USF Chico Mendes', 148, 14, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Data: ${dataRef} | Status: ${statusFiltro || 'Todos'} | Total: ${_agendamentosAtuais.length}`, 148, 21, { align: 'center' });

  const rows = _agendamentosAtuais.map((a, i) => [
    i + 1,
    a.nome || '-',
    a.telefone || '-',
    a.data_agendamento ? String(a.data_agendamento).split('T')[0].split('-').reverse().join('/') : '-',
    a.horario || '-',
    a.profissional || '-',
    a.tipo_atendimento || '-',
    a.status || '-'
  ]);

  doc.autoTable({
    startY: 27,
    head: [['Nº', 'Paciente', 'Telefone', 'Data', 'Hora', 'Profissional', 'Tipo', 'Status']],
    body: rows,
    theme: 'grid',
    headStyles: { fillColor: [26, 79, 196], fontSize: 9 },
    bodyStyles: { fontSize: 8.5 },
    alternateRowStyles: { fillColor: [240, 244, 255] }
  });

  doc.save(`agendamentos_${dataRef.replace(/\//g, '-')}.pdf`);
  showToast('✅ PDF de agendamentos gerado com sucesso!');
}

async function exportarRelatorioMensagensPDF() {
  if (!_ultimoRelatorioMensagens) {
    await loadRelatorioMensagens();
  }
  if (!_ultimoRelatorioMensagens || !_ultimoRelatorioMensagens.total) {
    showToast('Nenhuma mensagem registrada para esta data.', true);
    return;
  }
  if (!window.jspdf || !window.jspdf.jsPDF) {
    showToast('Carregando biblioteca PDF...', true);
    return;
  }
  const rel = _ultimoRelatorioMensagens;
  const dataFmt = new Date(rel.data + 'T12:00:00').toLocaleDateString('pt-BR');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('Relatório de Mensagens Enviadas (WhatsApp)', 105, 16, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`USF Chico Mendes | Data: ${dataFmt} | Total de Disparos: ${rel.total}`, 105, 23, { align: 'center' });

  const rows = (rel.porProfissional || []).map((p, i) => [i + 1, p.profissional, p.total]);
  doc.autoTable({
    startY: 30,
    head: [['Nº', 'Profissional', 'Mensagens Enviadas']],
    body: rows,
    theme: 'grid',
    headStyles: { fillColor: [26, 79, 196], fontSize: 10 },
    bodyStyles: { fontSize: 9.5 }
  });

  doc.save(`relatorio_mensagens_${dataFmt.replace(/\//g, '-')}.pdf`);
  showToast('✅ PDF do relatório de mensagens gerado!');
}

function renderRelatorioMensagens(rel, container) {
  const dataFmt = new Date(rel.data + 'T12:00:00').toLocaleDateString('pt-BR');
  if (rel.total === 0) {
    container.innerHTML = `<div style="text-align:center;padding:24px;color:var(--gray-600);">Nenhuma mensagem registrada em ${dataFmt}</div>`;
    return;
  }
  let rows = rel.porProfissional.map(p => {
    return `<tr style="border-bottom:1px solid var(--gray-200);"><td style="padding:10px 8px;font-weight:700;">👨‍⚕️ ${p.profissional}</td><td style="padding:10px 8px;text-align:center;font-weight:800;font-size:16px;color:var(--blue);">${p.total}</td></tr>`;
  }).join('');
  container.innerHTML = `
    <div style="background:var(--gray-100);padding:14px 18px;border-radius:10px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;border:1px solid var(--gray-200);">
      <div>
        <div style="font-size:11px;color:var(--gray-600);text-transform:uppercase;font-weight:800;letter-spacing:0.5px;">Disparos em ${dataFmt}</div>
        <div style="font-size:15px;font-weight:800;color:var(--blue-dark);margin-top:2px;">Total de Mensagens Enviadas</div>
      </div>
      <div style="font-size:26px;font-weight:900;color:var(--blue);">${rel.total}</div>
    </div>
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;margin-bottom:12px;">
        <thead><tr style="border-bottom:2px solid var(--gray-200);background:var(--gray-100);"><th style="text-align:left;padding:10px 8px;color:var(--gray-600);font-size:12px;text-transform:uppercase;">Profissional</th><th style="text-align:center;padding:10px 8px;color:var(--gray-600);font-size:12px;text-transform:uppercase;">Mensagens</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="padding:10px 14px;background:rgba(255,193,7,0.12);border:1px solid rgba(255,193,7,0.3);border-radius:8px;font-size:11px;color:var(--gray-600);display:flex;align-items:center;gap:6px;">
      <span>ℹ️</span> <span>A contagem reflete as mensagens geradas/disparadas pelo sistema, não a confirmação de leitura do paciente no WhatsApp.</span>
    </div>
  `;
}

// Inicializar data do relatório com hoje
(function initRelatorioData() {
  const el = document.getElementById('rel-msg-data');
  if (el) el.value = new Date().toISOString().split('T')[0];
})();

// ====== RESPONSÁVEIS DE SETORES DE APOIO ======
async function loadResponsaveisSetor() {
  const container = document.getElementById('resp-setor-list');
  if (!container) return;
  try {
    const r = await fetch(`${API_URL}/responsaveis-setor`);
    if (!r.ok) throw new Error();
    const list = await r.json();
    if (!list.length) {
      container.innerHTML = '<div style="text-align:center;padding:16px;color:var(--gray-600);">Nenhum responsável cadastrado</div>';
      return;
    }
    container.innerHTML = list.map(r => {
      const nomeDisplay = document.createTextNode(r.nome).textContent;
      const setorDisplay = document.createTextNode(r.setor).textContent;
      const cargoDisplay = document.createTextNode(r.cargo || '').textContent;
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--gray-100);border-radius:8px;margin-bottom:8px;">
        <div>
          <div style="font-weight:700;font-size:14px;">${nomeDisplay}</div>
          <div style="font-size:12px;color:var(--gray-600);">${setorDisplay}${cargoDisplay ? ' – ' + cargoDisplay : ''}</div>
        </div>
        <button onclick="excluirResponsavelSetor(${r.id}, '${nomeDisplay}')" title="Remover" style="background:transparent;border:none;font-size:16px;cursor:pointer;color:var(--red);">🗑️</button>
      </div>`;
    }).join('');
  } catch { container.innerHTML = '<div style="color:var(--red);padding:12px;">Erro ao carregar</div>'; }
}

async function criarResponsavelSetor() {
  const nome = document.getElementById('resp-setor-nome')?.value.trim();
  const setor = document.getElementById('resp-setor-setor')?.value.trim();
  const cargo = document.getElementById('resp-setor-cargo')?.value.trim();
  if (!nome || !setor) { showToast('⚠️ Preencha nome e setor!', true); return; }
  try {
    const r = await fetch(`${API_URL}/responsaveis-setor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, setor, cargo })
    });
    if (r.status === 409) { showToast('⚠️ Responsável já cadastrado nesse setor!', true); return; }
    if (!r.ok) throw new Error();
    showToast(`✅ ${nome} cadastrado como responsável!`);
    document.getElementById('resp-setor-nome').value = '';
    document.getElementById('resp-setor-cargo').value = '';
    loadResponsaveisSetor();
  } catch { showToast('Erro ao cadastrar!', true); }
}

async function excluirResponsavelSetor(id, nome) {
  if (!confirm(`Remover ${nome} dos responsáveis de setor?`)) return;
  try {
    const r = await fetch(`${API_URL}/responsaveis-setor/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error();
    showToast(`✅ ${nome} removido!`);
    loadResponsaveisSetor();
  } catch { showToast('Erro ao remover!', true); }
}

// Carregar responsáveis ao iniciar
loadResponsaveisSetor();

// ====== AUTOCOMPLETE DA RECEPÇÃO ======
function setupAutocompleteRecepcao() {
  const inputNome = document.getElementById('input-nome');
  const dropdown = document.getElementById('autocomplete-sugestoes');
  if (!inputNome || !dropdown) return;

  let debounceTimer = null;
  inputNome.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    clearTimeout(debounceTimer);
    if (val.length < 2) {
      dropdown.style.display = 'none';
      dropdown.innerHTML = '';
      return;
    }
    debounceTimer = setTimeout(async () => {
      try {
        const r = await fetch(`${API_URL}/patients/autocomplete?q=${encodeURIComponent(val)}`);
        if (!r.ok) return;
        const list = await r.json();
        if (!list || list.length === 0) {
          dropdown.style.display = 'none';
          dropdown.innerHTML = '';
          return;
        }
        dropdown.innerHTML = list.map(item => {
          const docInfo = item.cpf ? `CPF: ${item.cpf}` : item.cartao_sus ? `SUS: ${item.cartao_sus}` : '';
          const safeItemNome = (item.nome || '').replace(/'/g, "\\'");
          const condSafe = item.condicoes_especiais ? String(item.condicoes_especiais).replace(/'/g, "\\'") : '';
          return `<div class="autocomplete-item" onclick="selecionarPacienteAutocomplete('${safeItemNome}', '${condSafe}')">
            <div>
              <div class="autocomplete-item-name">👤 ${item.nome}</div>
              <div class="autocomplete-item-meta">${docInfo || 'Histórico recente da unidade'}</div>
            </div>
            <span style="font-size:12px;color:var(--blue);font-weight:700;">Preencher ➔</span>
          </div>`;
        }).join('');
        dropdown.style.display = 'block';
      } catch (err) {}
    }, 250);
  });

  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && e.target !== inputNome) {
      dropdown.style.display = 'none';
    }
  });
}

function selecionarPacienteAutocomplete(nome, condicoesStr) {
  const inputNome = document.getElementById('input-nome');
  const dropdown = document.getElementById('autocomplete-sugestoes');
  if (inputNome) inputNome.value = nome;
  if (dropdown) dropdown.style.display = 'none';
  if (condicoesStr) {
    setCondicoesCheckboxes('condicoes-especiais-recepcao', condicoesStr);
  }
  showToast(`✅ Paciente "${nome}" selecionado do histórico!`);
}

// Inicializa autocomplete
setupAutocompleteRecepcao();

// ====== PARTE B & ADMIN: BUSCA ATIVA (alumIA) + RELATÓRIOS GERENCIAIS ======

let _motivosBuscaAtivaCache = [];

function mostrarBannerPosCadastroAlumia(patient) {
  const box = document.getElementById('post-cadastro-alumia');
  const nomeEl = document.getElementById('post-cadastro-alumia-nome');
  const btnEl = document.getElementById('post-cadastro-alumia-btn');
  if (!box || !nomeEl || !btnEl || !patient) return;
  nomeEl.textContent = `${patient.nome} (${patient.setor})`;
  btnEl.onclick = () => abrirModalBuscaAtiva(patient.id, patient.nome, 'Recepção');
  box.style.display = 'block';
}

async function carregarMotivosBuscaAtiva(incluirInativos = false) {
  try {
    const url = incluirInativos ? `${API_URL}/motivos-busca-ativa?all=1` : `${API_URL}/motivos-busca-ativa`;
    const r = await fetch(url);
    if (!r.ok) return [];
    const lista = await r.json();
    if (!incluirInativos) _motivosBuscaAtivaCache = lista;
    return lista;
  } catch (e) {
    return [];
  }
}

async function abrirModalBuscaAtiva(patientId, patientNome, setorOperador = 'Recepção') {
  const modal = document.getElementById('modal-busca-ativa');
  if (!modal) return;

  document.getElementById('modal-ba-patient-id').value = patientId;
  document.getElementById('modal-ba-setor-operador').value = setorOperador || 'Recepção';
  document.getElementById('modal-ba-paciente-nome').textContent = patientNome || 'Paciente';
  document.getElementById('modal-ba-paciente-setor').textContent = `Setor atual: ${setorOperador || 'Fila'}`;

  const listContainer = document.getElementById('modal-ba-motivos-list');
  const outroWrapper = document.getElementById('modal-ba-outro-wrapper');
  const outroInput = document.getElementById('modal-ba-texto-outro');
  const btnRemover = document.getElementById('modal-ba-btn-remover');

  listContainer.textContent = 'Carregando motivos...';
  outroWrapper.style.display = 'none';
  outroInput.value = '';
  if (btnRemover) btnRemover.style.display = 'none';

  modal.classList.add('show');

  try {
    const [motivosAtivos, estadoRes] = await Promise.all([
      carregarMotivosBuscaAtiva(false),
      fetch(`${API_URL}/patients/${patientId}/busca-ativa`).then(r => r.ok ? r.json() : { itens: [] }).catch(() => ({ itens: [] }))
    ]);

    const itensMarcados = Array.isArray(estadoRes.itens) ? estadoRes.itens : [];
    const marcadosMap = {};
    itensMarcados.forEach(it => {
      marcadosMap[Number(it.motivo_id)] = it;
    });

    if (estadoRes.patient && estadoRes.patient.setor) {
      document.getElementById('modal-ba-paciente-setor').textContent = `Setor na fila: ${estadoRes.patient.setor}`;
    }

    if (btnRemover) {
      btnRemover.style.display = itensMarcados.length > 0 ? 'inline-block' : 'none';
    }

    // Incluir também motivos que já estavam marcados no paciente mesmo se tiverem sido desativados depois pelo Admin
    const motivosParaExibir = [...motivosAtivos];
    itensMarcados.forEach(it => {
      if (!motivosParaExibir.some(m => Number(m.id) === Number(it.motivo_id))) {
        motivosParaExibir.push({
          id: it.motivo_id,
          descricao: it.motivo_descricao || 'Motivo',
          setor_sugerido: it.setor_sugerido || 'Geral',
          ativo: true
        });
      }
    });

    listContainer.innerHTML = '';
    let outroSelecionado = false;
    let textoOutroSalvo = '';

    motivosParaExibir.forEach(m => {
      const isOutro = String(m.descricao || '').toLowerCase() === 'outro';
      const itemExistente = marcadosMap[Number(m.id)];
      const checked = Boolean(itemExistente);
      if (isOutro && checked) {
        outroSelecionado = true;
        textoOutroSalvo = itemExistente.texto_outro || '';
      }

      const labelEl = document.createElement('label');
      labelEl.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 12px;border:1.5px solid var(--gray-200);border-radius:10px;cursor:pointer;background:#fff;transition:all 0.15s;';

      const leftDiv = document.createElement('div');
      leftDiv.style.cssText = 'display:flex;align-items:center;gap:10px;flex:1;';

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.className = 'ba-motivo-checkbox';
      chk.value = String(m.id);
      chk.dataset.isOutro = isOutro ? '1' : '0';
      chk.checked = checked;
      chk.style.cssText = 'transform:scale(1.25);cursor:pointer;';
      chk.addEventListener('change', atualizarVisibilidadeOutroBuscaAtiva);

      const descSpan = document.createElement('span');
      descSpan.style.cssText = 'font-size:13px;font-weight:700;color:var(--gray-800);';
      descSpan.textContent = m.descricao; // Seguro via textContent

      leftDiv.appendChild(chk);
      leftDiv.appendChild(descSpan);

      const rightDiv = document.createElement('div');
      rightDiv.style.cssText = 'display:flex;align-items:center;gap:6px;flex-shrink:0;';

      const setorBadge = document.createElement('span');
      setorBadge.style.cssText = 'font-size:10px;font-weight:800;padding:2px 8px;border-radius:12px;background:rgba(0,137,123,0.12);color:#00695c;';
      setorBadge.textContent = m.setor_sugerido; // Seguro via textContent
      rightDiv.appendChild(setorBadge);

      if (itemExistente && itemExistente.ofertado) {
        const ofBadge = document.createElement('span');
        ofBadge.className = 'badge-oferta-registrada';
        ofBadge.textContent = '✅ Oferta feita';
        rightDiv.appendChild(ofBadge);
      } else if (itemExistente) {
        const btnOf = document.createElement('button');
        btnOf.type = 'button';
        btnOf.className = 'btn-oferta-feita';
        btnOf.textContent = '🤝 Oferta feita';
        btnOf.onclick = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          registrarOfertaBuscaAtiva(patientId, itemExistente.id, setorOperador, true);
        };
        rightDiv.appendChild(btnOf);
      }

      labelEl.appendChild(leftDiv);
      labelEl.appendChild(rightDiv);
      listContainer.appendChild(labelEl);
    });

    if (outroSelecionado) {
      outroWrapper.style.display = 'block';
      outroInput.value = textoOutroSalvo;
    }
  } catch (e) {
    listContainer.textContent = 'Erro ao carregar motivos de busca ativa.';
  }
}

function atualizarVisibilidadeOutroBuscaAtiva() {
  const checks = document.querySelectorAll('#modal-ba-motivos-list .ba-motivo-checkbox');
  let algumOutroMarcado = false;
  checks.forEach(c => {
    if (c.dataset.isOutro === '1' && c.checked) algumOutroMarcado = true;
  });
  const outroWrapper = document.getElementById('modal-ba-outro-wrapper');
  if (outroWrapper) {
    outroWrapper.style.display = algumOutroMarcado ? 'block' : 'none';
    if (algumOutroMarcado) {
      document.getElementById('modal-ba-texto-outro')?.focus();
    }
  }
}

function fecharModalBuscaAtiva() {
  const modal = document.getElementById('modal-busca-ativa');
  if (modal) modal.classList.remove('show');
}

async function salvarBuscaAtivaModal() {
  const patientId = document.getElementById('modal-ba-patient-id').value;
  const setorOperador = document.getElementById('modal-ba-setor-operador').value || 'Recepção';
  const textoOutro = (document.getElementById('modal-ba-texto-outro')?.value || '').trim().slice(0, 120);

  const checks = document.querySelectorAll('#modal-ba-motivos-list .ba-motivo-checkbox:checked');
  const itens = [];
  for (const c of checks) {
    const isOutro = c.dataset.isOutro === '1';
    if (isOutro && !textoOutro) {
      showToast('⚠️ Para o motivo "Outro", descreva a pendência (máx. 120 caracteres).', true);
      document.getElementById('modal-ba-texto-outro')?.focus();
      return;
    }
    itens.push({
      motivo_id: parseInt(c.value, 10),
      texto_outro: isOutro ? textoOutro : null
    });
  }

  try {
    const r = await fetch(`${API_URL}/patients/${patientId}/busca-ativa`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itens, setor_operador: setorOperador })
    });
    const data = await r.json();
    if (!r.ok) {
      showToast(data.error || 'Erro ao salvar busca ativa!', true);
      return;
    }
    fecharModalBuscaAtiva();
    showToast(itens.length > 0 ? '📡 Busca ativa (alumIA) registrada!' : '🗑️ Marcações de busca ativa removidas.');
    await loadQueues();
    loadAcolhimentoFluxo();
  } catch (e) {
    showToast('Erro de conexão ao salvar busca ativa!', true);
  }
}

async function removerBuscaAtivaModal() {
  const patientId = document.getElementById('modal-ba-patient-id').value;
  const setorOperador = document.getElementById('modal-ba-setor-operador').value || 'Recepção';
  if (!confirm('Deseja remover todas as marcações de Busca ativa (alumIA) deste paciente?')) return;
  try {
    const r = await fetch(`${API_URL}/patients/${patientId}/busca-ativa`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itens: [], setor_operador: setorOperador })
    });
    if (!r.ok) throw new Error();
    fecharModalBuscaAtiva();
    showToast('🗑️ Marcações de busca ativa removidas!');
    await loadQueues();
    loadAcolhimentoFluxo();
  } catch (e) {
    showToast('Erro ao remover marcações!', true);
  }
}

async function registrarOfertaBuscaAtiva(patientId, itemId, setorOperador = 'Equipe', recarregarModal = false) {
  try {
    const r = await fetch(`${API_URL}/patients/${patientId}/busca-ativa/ofertar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, setor_operador: setorOperador })
    });
    const data = await r.json();
    if (!r.ok) {
      showToast(data.error || 'Erro ao registrar oferta!', true);
      return;
    }
    showToast('🤝 Oferta feita registrada com sucesso!');
    await loadQueues();
    loadAcolhimentoFluxo();
    if (recarregarModal) {
      const nome = document.getElementById('modal-ba-paciente-nome')?.textContent || 'Paciente';
      abrirModalBuscaAtiva(patientId, nome, setorOperador);
    }
  } catch (e) {
    showToast('Erro ao registrar oferta!', true);
  }
}

// ====== TELA ADMIN: RELATÓRIOS PARTE A & PARTE B + CRUD DE MOTIVOS ======

function obterDataHojeRecifeISO() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Recife' }).format(new Date());
  } catch (e) {
    return new Date().toISOString().split('T')[0];
  }
}

function initAdminRelatoriosScreen() {
  const iniEl = document.getElementById('rel-pb-data-inicio');
  const fimEl = document.getElementById('rel-pb-data-fim');
  const hoje = obterDataHojeRecifeISO();
  if (iniEl && !iniEl.value) iniEl.value = hoje;
  if (fimEl && !fimEl.value) fimEl.value = hoje;
  carregarRelatorioPrioridadeBusca();
  carregarMotivosBuscaAtivaAdmin();
}

async function carregarRelatorioPrioridadeBusca() {
  const ini = document.getElementById('rel-pb-data-inicio')?.value || obterDataHojeRecifeISO();
  const fim = document.getElementById('rel-pb-data-fim')?.value || ini;
  const periodo = document.getElementById('rel-pb-periodo')?.value || 'integral';

  const contA = document.getElementById('rel-parte-a-container');
  const contB = document.getElementById('rel-parte-b-container');
  if (!contA || !contB) return;

  try {
    const params = new URLSearchParams({ data_inicio: ini, data_fim: fim, periodo });
    const r = await fetch(`${API_URL}/admin/relatorio-prioridade-busca?${params.toString()}`);
    if (!r.ok) throw new Error();
    const rel = await r.json();
    renderRelatorioParteA(rel, contA);
    renderRelatorioParteB(rel, contB);
  } catch (e) {
    contA.textContent = 'Erro ao carregar relatório da Parte A.';
    contB.textContent = 'Erro ao carregar relatório da Parte B.';
  }
}

function renderRelatorioParteA(rel, container) {
  const parteA = rel.parteA || {};
  const niveis = Array.isArray(parteA.por_nivel) ? parteA.por_nivel : [];
  const regraA = Number(parteA.regra_a_acionada || 0);
  const limiteMin = rel.config_prioridade?.LIMITE_ESPERA_NORMAL_MIN || 60;

  const rowsHtml = niveis.map(n => {
    const corNivel = n.nivel === 1 ? '#b71c1c' : n.nivel === 2 ? '#e65100' : '#1565c0';
    return `<tr style="border-bottom:1px solid var(--gray-200);">
      <td style="padding:10px 8px;font-weight:800;color:${corNivel};">${escapeText(n.descricao)}</td>
      <td style="padding:10px 8px;text-align:center;font-weight:800;">${Number(n.total_chamados || 0)}</td>
      <td style="padding:10px 8px;text-align:center;font-weight:700;">${Number(n.media_espera_min || 0).toFixed(1)} min</td>
      <td style="padding:10px 8px;text-align:center;font-weight:800;color:${Number(n.max_espera_min) >= limiteMin ? 'var(--red)' : 'var(--gray-800)'};">${Number(n.max_espera_min || 0).toFixed(1)} min</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div style="background:rgba(211,47,47,0.08);border:1.5px solid rgba(211,47,47,0.28);border-radius:10px;padding:12px 14px;">
        <div style="font-size:11px;font-weight:800;color:#b71c1c;text-transform:uppercase;">Acionamentos da Regra (a)</div>
        <div style="font-size:26px;font-weight:900;color:#b71c1c;margin-top:2px;">${regraA}</div>
        <div style="font-size:11px;color:var(--gray-600);font-weight:600;">Normais chamados por espera &ge; ${limiteMin} min (anti-starvation)</div>
      </div>
      <div style="background:var(--gray-100);border:1px solid var(--gray-200);border-radius:10px;padding:12px 14px;">
        <div style="font-size:11px;font-weight:800;color:var(--gray-600);text-transform:uppercase;">Chamadas por Regra</div>
        <div style="font-size:12px;font-weight:700;color:var(--gray-800);margin-top:6px;line-height:1.6;">
          • Regra (a) Anti-starvation: <b>${parteA.por_regra?.a || 0}</b><br>
          • Regra (b) Alternância: <b>${parteA.por_regra?.b || 0}</b><br>
          • Regra (c) Prioritário (1/2): <b>${parteA.por_regra?.c || 0}</b><br>
          • Regra (d) Normal padrão: <b>${parteA.por_regra?.d || 0}</b>
        </div>
      </div>
    </div>
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:var(--gray-100);border-bottom:2px solid var(--gray-200);">
            <th style="text-align:left;padding:10px 8px;font-size:11px;color:var(--gray-600);text-transform:uppercase;">Nível de Prioridade</th>
            <th style="text-align:center;padding:10px 8px;font-size:11px;color:var(--gray-600);text-transform:uppercase;">Chamados</th>
            <th style="text-align:center;padding:10px 8px;font-size:11px;color:var(--gray-600);text-transform:uppercase;">Espera Média</th>
            <th style="text-align:center;padding:10px 8px;font-size:11px;color:var(--gray-600);text-transform:uppercase;">Espera Máxima</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;
}

function renderRelatorioParteB(rel, container) {
  const parteB = rel.parteB || {};
  const motivos = Array.isArray(parteB.por_motivo) ? parteB.por_motivo : [];
  const totPac = Number(parteB.total_pacientes_busca_ativa || 0);
  const totOfe = Number(parteB.total_pacientes_com_oferta || 0);
  const pctGeral = Number(parteB.percentual_geral_oferta || 0).toFixed(1);

  container.innerHTML = '';

  const summaryGrid = document.createElement('div');
  summaryGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;';
  summaryGrid.innerHTML = `
    <div style="background:rgba(0,137,123,0.1);border:1.5px solid rgba(0,137,123,0.3);border-radius:10px;padding:12px 14px;">
      <div style="font-size:11px;font-weight:800;color:#00695c;text-transform:uppercase;">Pacientes de Busca Ativa</div>
      <div style="font-size:26px;font-weight:900;color:#00695c;margin-top:2px;">${totPac}</div>
      <div style="font-size:11px;color:var(--gray-600);font-weight:600;">Com oferta registrada: <b>${totOfe}</b></div>
    </div>
    <div style="background:rgba(74,171,60,0.1);border:1.5px solid rgba(74,171,60,0.3);border-radius:10px;padding:12px 14px;">
      <div style="font-size:11px;font-weight:800;color:#2e7d32;text-transform:uppercase;">Taxa de Oferta Feita</div>
      <div style="font-size:26px;font-weight:900;color:#2e7d32;margin-top:2px;">${pctGeral}%</div>
      <div style="font-size:11px;color:var(--gray-600);font-weight:600;">Aproveitamento de presença na USF</div>
    </div>
  `;
  container.appendChild(summaryGrid);

  const tableWrap = document.createElement('div');
  tableWrap.style.overflowX = 'auto';

  const table = document.createElement('table');
  table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px;';
  table.innerHTML = `
    <thead>
      <tr style="background:var(--gray-100);border-bottom:2px solid var(--gray-200);">
        <th style="text-align:left;padding:9px 8px;font-size:11px;color:var(--gray-600);text-transform:uppercase;">Motivo (alumIA)</th>
        <th style="text-align:left;padding:9px 8px;font-size:11px;color:var(--gray-600);text-transform:uppercase;">Setor Sugerido</th>
        <th style="text-align:center;padding:9px 8px;font-size:11px;color:var(--gray-600);text-transform:uppercase;">Compareceram</th>
        <th style="text-align:center;padding:9px 8px;font-size:11px;color:var(--gray-600);text-transform:uppercase;">% Oferta Feita</th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement('tbody');
  motivos.forEach(m => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--gray-200)';

    const tdDesc = document.createElement('td');
    tdDesc.style.cssText = 'padding:8px;font-weight:700;color:var(--gray-800);';
    tdDesc.textContent = m.descricao; // Seguro com textContent

    const tdSetor = document.createElement('td');
    tdSetor.style.cssText = 'padding:8px;color:var(--gray-600);font-weight:600;';
    tdSetor.textContent = m.setor_sugerido; // Seguro com textContent

    const tdTot = document.createElement('td');
    tdTot.style.cssText = 'padding:8px;text-align:center;font-weight:800;color:var(--blue-dark);';
    tdTot.textContent = String(m.total_pacientes || 0);

    const tdPct = document.createElement('td');
    tdPct.style.cssText = 'padding:8px;text-align:center;font-weight:800;color:#00695c;';
    tdPct.textContent = `${Number(m.percentual_ofertado || 0).toFixed(1)}% (${m.total_ofertados || 0})`;

    tr.appendChild(tdDesc);
    tr.appendChild(tdSetor);
    tr.appendChild(tdTot);
    tr.appendChild(tdPct);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  tableWrap.appendChild(table);
  container.appendChild(tableWrap);
}

async function carregarMotivosBuscaAtivaAdmin() {
  const container = document.getElementById('admin-motivos-busca-lista');
  if (!container) return;
  const lista = await carregarMotivosBuscaAtiva(true);
  container.innerHTML = '';

  if (!lista.length) {
    container.textContent = 'Nenhum motivo cadastrado.';
    return;
  }

  lista.forEach(m => {
    const row = document.createElement('div');
    row.style.cssText = `display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;border-radius:10px;margin-bottom:8px;border:1px solid var(--gray-200);background:${m.ativo ? '#fff' : 'var(--gray-100)'};opacity:${m.ativo ? '1' : '0.65'};flex-wrap:wrap;`;

    const infoDiv = document.createElement('div');
    infoDiv.style.cssText = 'flex:1;min-width:200px;';

    const titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-weight:800;font-size:14px;color:var(--blue-dark);';
    titleEl.textContent = m.descricao; // textContent seguro

    const metaEl = document.createElement('div');
    metaEl.style.cssText = 'font-size:12px;color:var(--gray-600);font-weight:600;margin-top:2px;';
    metaEl.textContent = `Setor sugerido: ${m.setor_sugerido} • Status: ${m.ativo ? '🟢 Ativo' : '⚪ Inativo (Desativado)'}`;

    infoDiv.appendChild(titleEl);
    infoDiv.appendChild(metaEl);

    const btnsDiv = document.createElement('div');
    btnsDiv.style.cssText = 'display:flex;gap:8px;align-items:center;';

    const btnRename = document.createElement('button');
    btnRename.type = 'button';
    btnRename.className = 'btn btn-sm';
    btnRename.style.cssText = 'background:var(--gray-200);color:var(--gray-800);padding:6px 12px;font-size:12px;font-weight:700;';
    btnRename.textContent = '✏️ Renomear / Setor';
    btnRename.onclick = () => renomearMotivoBuscaAtivaAdmin(m);

    const btnToggle = document.createElement('button');
    btnToggle.type = 'button';
    btnToggle.className = 'btn btn-sm';
    btnToggle.style.cssText = m.ativo
      ? 'background:rgba(229,57,53,0.12);color:var(--red);border:1px solid rgba(229,57,53,0.3);padding:6px 12px;font-size:12px;font-weight:700;'
      : 'background:rgba(74,171,60,0.15);color:#2e7d32;border:1px solid rgba(74,171,60,0.35);padding:6px 12px;font-size:12px;font-weight:700;';
    btnToggle.textContent = m.ativo ? '🚫 Desativar' : '✅ Reativar';
    btnToggle.onclick = () => alternarAtivoMotivoBuscaAtivaAdmin(m);

    btnsDiv.appendChild(btnRename);
    btnsDiv.appendChild(btnToggle);

    row.appendChild(infoDiv);
    row.appendChild(btnsDiv);
    container.appendChild(row);
  });
}

function adicionarMotivoBuscaAtivaAdmin() {
  const descInput = document.getElementById('novo-motivo-descricao');
  const setorInput = document.getElementById('novo-motivo-setor');
  const descricao = (descInput?.value || '').trim().slice(0, 120);
  const setor_sugerido = (setorInput?.value || '').trim().slice(0, 60);

  if (!descricao || !setor_sugerido) {
    showToast('⚠️ Preencha a descrição e o setor sugerido!', true);
    return;
  }

  pedirSenhaAdmin('Adicionar Motivo de Busca Ativa', async (senhaUsada) => {
    try {
      const r = await fetch(`${API_URL}/admin/motivos-busca-ativa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descricao, setor_sugerido, senha: senhaUsada })
      });
      const data = await r.json();
      if (!r.ok) {
        showToast(data.error || 'Erro ao adicionar motivo!', true);
        return;
      }
      if (descInput) descInput.value = '';
      if (setorInput) setorInput.value = '';
      showToast('✅ Novo motivo de busca ativa cadastrado!');
      carregarMotivosBuscaAtivaAdmin();
      carregarRelatorioPrioridadeBusca();
    } catch (e) {
      showToast('Erro de conexão ao cadastrar motivo!', true);
    }
  });
}

function renomearMotivoBuscaAtivaAdmin(motivo) {
  const novaDesc = prompt('Editar descrição do motivo (máx. 120 caracteres):', motivo.descricao);
  if (novaDesc === null) return;
  const descLimpa = novaDesc.trim().slice(0, 120);
  if (!descLimpa) {
    showToast('A descrição não pode ficar vazia!', true);
    return;
  }
  const novoSetor = prompt('Editar setor sugerido (máx. 60 caracteres):', motivo.setor_sugerido);
  if (novoSetor === null) return;
  const setorLimpo = novoSetor.trim().slice(0, 60);
  if (!setorLimpo) {
    showToast('O setor sugerido não pode ficar vazio!', true);
    return;
  }

  pedirSenhaAdmin('Editar Motivo de Busca Ativa', async (senhaUsada) => {
    try {
      const r = await fetch(`${API_URL}/admin/motivos-busca-ativa/${motivo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descricao: descLimpa, setor_sugerido: setorLimpo, ativo: motivo.ativo, senha: senhaUsada })
      });
      const data = await r.json();
      if (!r.ok) {
        showToast(data.error || 'Erro ao atualizar motivo!', true);
        return;
      }
      showToast('✅ Motivo atualizado com sucesso!');
      carregarMotivosBuscaAtivaAdmin();
      carregarRelatorioPrioridadeBusca();
    } catch (e) {
      showToast('Erro de conexão!', true);
    }
  });
}

function alternarAtivoMotivoBuscaAtivaAdmin(motivo) {
  const novoAtivo = !motivo.ativo;
  pedirSenhaAdmin(`${novoAtivo ? 'Reativar' : 'Desativar'} Motivo de Busca Ativa`, async (senhaUsada) => {
    try {
      // Soft delete / toggle ativo (nunca DELETE físico para preservar FK de busca_ativa_itens)
      const r = await fetch(`${API_URL}/admin/motivos-busca-ativa/${motivo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descricao: motivo.descricao, setor_sugerido: motivo.setor_sugerido, ativo: novoAtivo, senha: senhaUsada })
      });
      const data = await r.json();
      if (!r.ok) {
        showToast(data.error || 'Erro ao alterar status do motivo!', true);
        return;
      }
      showToast(novoAtivo ? '✅ Motivo reativado!' : '🚫 Motivo desativado!');
      carregarMotivosBuscaAtivaAdmin();
      carregarRelatorioPrioridadeBusca();
    } catch (e) {
      showToast('Erro de conexão!', true);
    }
  });
}
