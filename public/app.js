// @ts-nocheck
// API Base URL
const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : '/api';

// Previne agressivamente que o navegador use cache (mesmo se já estava em cache antes da correção do servidor)
const originalFetch = window.fetch;
function isModoTV() {
  return new URLSearchParams(window.location.search).get('modo') === 'tv';
}
let isGateAuthenticated = false;
let _dadosAutenticadosIniciados = false;
let _modoTvIniciado = false;

window.fetch = function(resource, config) {
  let nextConfig = config;
  const isApiCall = typeof resource === 'string' && resource.startsWith(API_URL);
  if (isApiCall) {
    nextConfig = config ? { ...config } : {};
    if (!nextConfig.credentials) nextConfig.credentials = 'same-origin';
    let devId = '';
    try {
      devId = (typeof _dispositivoAtualId === 'string' && _dispositivoAtualId) || localStorage.getItem('usf_device_id') || '';
    } catch (e) {}
    if (devId) {
      if (nextConfig.headers instanceof Headers) {
        const cloned = new Headers(nextConfig.headers);
        if (!cloned.has('x-device-id')) cloned.set('x-device-id', devId);
        nextConfig.headers = cloned;
      } else {
        const hdrObj = (nextConfig.headers && typeof nextConfig.headers === 'object') ? { ...nextConfig.headers } : {};
        const hasKey = Object.keys(hdrObj).some(k => k.toLowerCase() === 'x-device-id');
        if (!hasKey) hdrObj['x-device-id'] = devId;
        nextConfig.headers = hdrObj;
      }
    }
    if (!nextConfig.method || nextConfig.method.toUpperCase() === 'GET') {
      if (!nextConfig.cache) nextConfig.cache = 'no-cache';
    }
  }
  const promise = originalFetch(resource, nextConfig);
  if (isApiCall) {
    return promise.then(res => {
      if (
        res.status === 401 &&
        isGateAuthenticated &&
        !isModoTV() &&
        !resource.includes('/auth/') &&
        !resource.includes('/verify-admin') &&
        !resource.includes('/config/pausa') &&
        !resource.includes('/config/mutirao-hoje') &&
        !resource.includes('/config/jingle') &&
        !resource.includes('/config/metas-dia')
      ) {
        handleSessaoExpirada();
      } else if (res.status === 423 && !isModoTV()) {
        res.clone().json().catch(() => ({})).then(body => {
          if (typeof window.mostrarAlertaDispositivoBloqueado === 'function') {
            window.mostrarAlertaDispositivoBloqueado(body || {});
          }
        });
      }
      return res;
    });
  }
  return promise;
};

// Socket removido para economia Vercel Pro
const socket = null;

/* === MELHORIA A: PORTÃO DE ENTRADA (Sessão Server-Side HttpOnly + Bloqueio Persistente) === */
const GATE_EXPIRY_MS = 10 * 60 * 60 * 1000; // 10 horas
const GATE_LOCK_STORAGE_KEY = 'usf_gate_lock_until';
let gateAttempts = 0;
let gateLocked = false;
let gateDeviceBlocked = false;
let gateLockTimer = null;

function limparBloqueioTemporarioPortal() {
  gateLocked = false;
  if (gateLockTimer) {
    clearInterval(gateLockTimer);
    gateLockTimer = null;
  }
  try { localStorage.removeItem(GATE_LOCK_STORAGE_KEY); } catch (e) {}
  const btn = document.getElementById('gate-btn');
  const inp = document.getElementById('gate-password');
  const lockEl = document.getElementById('gate-lockout');
  if (btn && !gateDeviceBlocked) btn.disabled = false;
  if (inp && !gateDeviceBlocked) inp.disabled = false;
  if (lockEl && !gateDeviceBlocked) lockEl.textContent = '';
}

function aplicarBloqueioTemporarioPortal(lockedUntilIso, msgCustom = '') {
  const untilMs = lockedUntilIso ? new Date(lockedUntilIso).getTime() : (Date.now() + 5 * 60 * 1000);
  if (!Number.isFinite(untilMs) || untilMs <= Date.now()) {
    limparBloqueioTemporarioPortal();
    return;
  }
  gateLocked = true;
  try { localStorage.setItem(GATE_LOCK_STORAGE_KEY, String(untilMs)); } catch (e) {}
  if (gateLockTimer) clearInterval(gateLockTimer);

  const btn = document.getElementById('gate-btn');
  const inp = document.getElementById('gate-password');
  const errEl = document.getElementById('gate-error');
  const lockEl = document.getElementById('gate-lockout');
  if (btn) btn.disabled = true;
  if (inp) { inp.value = ''; inp.disabled = true; }
  if (errEl && msgCustom) errEl.textContent = msgCustom;

  const tick = () => {
    const remSec = Math.max(0, Math.ceil((untilMs - Date.now()) / 1000));
    if (remSec <= 0) {
      limparBloqueioTemporarioPortal();
      const err = document.getElementById('gate-error');
      if (err) err.textContent = '⚠️ Prazo encerrado. Atenção: mais 1 erro bloqueará este aparelho definitivamente!';
      return;
    }
    const mins = Math.floor(remSec / 60);
    const secs = String(remSec % 60).padStart(2, '0');
    if (lockEl) lockEl.textContent = `⏳ Bloqueado temporariamente. Aguarde ${mins}:${secs} (não atualize a página)`;
  };
  tick();
  gateLockTimer = setInterval(tick, 1000);
}

// Bloqueia atalhos F5 / Ctrl+R quando o portal estiver em bloqueio ativo
document.addEventListener('keydown', (e) => {
  const gate = document.getElementById('gate-overlay');
  const gateVisivel = gate && !gate.classList.contains('hidden');
  if (gateVisivel && (gateLocked || gateDeviceBlocked)) {
    const k = String(e.key || '').toLowerCase();
    if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && k === 'r')) {
      e.preventDefault();
      e.stopPropagation();
      const errEl = document.getElementById('gate-error');
      if (errEl) errEl.textContent = '🔒 Não é possível atualizar durante o bloqueio de segurança do aparelho.';
    }
  }
});
window.addEventListener('beforeunload', (e) => {
  const gate = document.getElementById('gate-overlay');
  const gateVisivel = gate && !gate.classList.contains('hidden');
  if (gateVisivel && (gateLocked || gateDeviceBlocked)) {
    e.preventDefault();
    e.returnValue = '';
  }
});

function handleSessaoExpirada() {
  isGateAuthenticated = false;
  _dadosAutenticadosIniciados = false;
  try {
    sessionStorage.removeItem('usf_gate_auth');
    sessionStorage.removeItem('usf_gate_time');
  } catch (e) {}
  if (typeof limparEspelhoContingenciaLogout === 'function') limparEspelhoContingenciaLogout(true);
  if (typeof stopAllPolling === 'function') stopAllPolling();
  showGate();
  const errEl = document.getElementById('gate-error');
  if (errEl) errEl.textContent = '🔒 Sua sessão expirou. Digite a senha novamente.';
}

function iniciarCarregamentoModoTV() {
  if (!_modoTvIniciado) _modoTvIniciado = true;
  if (typeof loadCurrentCalling === 'function') loadCurrentCalling();
  if (typeof loadHistory === 'function') loadHistory();
  if (typeof loadPendingVoiceCalls === 'function') loadPendingVoiceCalls();
  if (typeof carregarJinglePreferido === 'function') carregarJinglePreferido();
  if (typeof startAdaptivePolling === 'function') startAdaptivePolling();
}

function iniciarCarregamentoAutenticado() {
  if (typeof loadQueues === 'function') loadQueues();
  if (typeof loadCurrentCalling === 'function') loadCurrentCalling();
  if (typeof loadHistory === 'function') loadHistory();
  if (typeof loadAttended === 'function') loadAttended();
  if (typeof loadAllChannels === 'function') loadAllChannels();
  if (typeof loadAcolhimentoFluxo === 'function') loadAcolhimentoFluxo();
  if (typeof carregarProfissionaisCache === 'function') carregarProfissionaisCache();
  if (typeof loadResponsaveisSetor === 'function') loadResponsaveisSetor();
  if (typeof loadChatPresenca === 'function') loadChatPresenca();
  if (typeof carregarJinglePreferido === 'function') carregarJinglePreferido();
  if (typeof loadMetasDiaConfig === 'function') loadMetasDiaConfig();
  if (!_dadosAutenticadosIniciados) {
    _dadosAutenticadosIniciados = true;
    setTimeout(() => {
      if (isGateAuthenticated && typeof loadChatPin === 'function' && typeof activeCanal !== 'undefined') {
        loadChatPin(activeCanal);
      }
    }, 1000);
  }
  if (typeof startAdaptivePolling === 'function') startAdaptivePolling();
  if (typeof intervalChat !== 'undefined' && !intervalChat && typeof registerPresenca === 'function') {
    intervalChat = setInterval(() => {
      if (!isGateAuthenticated) return;
      if (typeof chatPanelOpen !== 'undefined' && chatPanelOpen) registerPresenca();
      if (typeof loadChatPresenca === 'function') loadChatPresenca().then(() => renderCanalList());
    }, 30000);
  }
}

async function checkGateSession() {
  // Exceção: Painel TV
  if (isModoTV()) {
    hideGate();
    iniciarCarregamentoModoTV();
    setTimeout(() => { showScreen('painel'); }, 300);
    setTimeout(() => {
      const sm = document.getElementById('sound-modal');
      if (sm) sm.style.display = 'flex';
    }, 600);
    return;
  }

  // Restaurar imediatamente bloqueio temporário salvo localmente enquanto valida no servidor
  try {
    const savedUntil = parseInt(localStorage.getItem(GATE_LOCK_STORAGE_KEY) || '0', 10);
    if (savedUntil > Date.now()) {
      aplicarBloqueioTemporarioPortal(new Date(savedUntil).toISOString(), '⏳ Aparelho em bloqueio temporário de segurança.');
    }
  } catch (e) {}

  try {
    const r = await fetch(`${API_URL}/auth/session`, { credentials: 'same-origin' });
    if (r.ok) {
      const data = await r.json();
      if (data && data.deviceId) {
        try { localStorage.setItem('usf_device_id', data.deviceId); } catch (e) {}
      }
      if (data && data.deviceBlocked) {
        gateDeviceBlocked = true;
        limparBloqueioTemporarioPortal();
        showGate();
        if (typeof window.mostrarAlertaDispositivoBloqueado === 'function') {
          window.mostrarAlertaDispositivoBloqueado({
            id: data.deviceId,
            motivo: data.motivoBloqueio || 'excesso_tentativas',
            code: 'DEVICE_BLOCKED'
          });
        }
        return;
      }
      if (data && data.tempLockedUntil) {
        showGate();
        aplicarBloqueioTemporarioPortal(
          data.tempLockedUntil,
          '⏳ Muitas tentativas incorretas. Aguarde 5 minutos (não atualize a página).'
        );
        return;
      }
      if (data && data.authenticated) {
        isGateAuthenticated = true;
        gateDeviceBlocked = false;
        limparBloqueioTemporarioPortal();
        if (data.role === 'admin' || data.role === 'gerente') {
          userRole = data.role;
          isAdmin = data.role === 'admin';
          isGerente = data.role === 'gerente';
          if (typeof updateAdminUI === 'function') updateAdminUI();
        }
        try {
          sessionStorage.setItem('usf_gate_auth', 'true');
          sessionStorage.setItem('usf_gate_time', Date.now().toString());
        } catch (e) {}
        hideGate();
        iniciarCarregamentoAutenticado();
        setTimeout(() => {
          const sm = document.getElementById('sound-modal');
          if (sm) sm.style.display = 'flex';
        }, 600);
        return;
      }
    }
  } catch (e) {}

  isGateAuthenticated = false;
  try {
    sessionStorage.removeItem('usf_gate_auth');
    sessionStorage.removeItem('usf_gate_time');
  } catch (e) {}
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
  if (gateLocked || gateDeviceBlocked) return;
  const inp = document.getElementById('gate-password');
  const errEl = document.getElementById('gate-error');
  const btn = document.getElementById('gate-btn');
  const senha = inp.value.trim();
  if (!senha) { errEl.textContent = '❌ Digite a senha.'; return; }

  let res = null;
  let data = {};
  try {
    if (btn) btn.disabled = true;
    res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ senha })
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    errEl.textContent = '🔴 Erro de conexão com o servidor. Tente novamente.';
    if (btn && !gateLocked && !gateDeviceBlocked) btn.disabled = false;
    return;
  }

  if (data && data.id) {
    try { localStorage.setItem('usf_device_id', data.id); } catch (e) {}
  }

  if (res && res.ok && data.ok) {
    isGateAuthenticated = true;
    gateDeviceBlocked = false;
    limparBloqueioTemporarioPortal();
    if (data.role === 'admin' || data.role === 'gerente') {
      userRole = data.role;
      isAdmin = data.role === 'admin';
      isGerente = data.role === 'gerente';
      adminPassword = senha;
      try {
        sessionStorage.setItem('usf_admin_pwd', senha);
        sessionStorage.setItem('usf_user_role', data.role);
      } catch (e) {}
      if (typeof updateAdminUI === 'function') updateAdminUI();
    }
    try {
      sessionStorage.setItem('usf_gate_auth', 'true');
      sessionStorage.setItem('usf_gate_time', Date.now().toString());
    } catch (e) {}
    errEl.textContent = '';
    inp.value = '';
    gateAttempts = 0;
    hideGate();
    if (typeof unlockAudio === 'function') {
      unlockAudio(true);
    }
    if (typeof registrarAcessoDispositivo === 'function') {
      registrarAcessoDispositivo('gate_login');
    }
    iniciarCarregamentoAutenticado();
  } else if (res && res.status === 423) {
    gateDeviceBlocked = true;
    limparBloqueioTemporarioPortal();
    inp.value = '';
    inp.disabled = true;
    if (btn) btn.disabled = true;
    errEl.textContent = `🚫 ${data.error || 'Aparelho bloqueado. Apenas o Administrador pode desbloquear.'}`;
    if (typeof window.mostrarAlertaDispositivoBloqueado === 'function') {
      window.mostrarAlertaDispositivoBloqueado({
        id: data.id,
        motivo: data.motivo || 'excesso_tentativas',
        code: data.code || 'DEVICE_BLOCKED'
      });
    }
  } else if (res && res.status === 429) {
    aplicarBloqueioTemporarioPortal(
      data.lockedUntil,
      `⏳ ${data.error || 'Muitas tentativas incorretas. Aguarde 5 minutos.'}`
    );
  } else {
    if (btn && !gateLocked && !gateDeviceBlocked) btn.disabled = false;
    gateAttempts = Number(data.tentativas || (gateAttempts + 1));
    errEl.textContent = `❌ ${data.error || 'Senha incorreta. Tente novamente.'}`;
    inp.value = '';
    inp.focus();
  }
}

async function logoutGate() {
  try {
    await fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'same-origin' });
  } catch (e) {}
  isGateAuthenticated = false;
  if (typeof limparEspelhoContingenciaLogout === 'function') limparEspelhoContingenciaLogout(true);
  try {
    sessionStorage.removeItem('usf_gate_auth');
    sessionStorage.removeItem('usf_gate_time');
    sessionStorage.removeItem('usf_admin_pwd');
  } catch (e) {}
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
  atualizarBotaoMutirao();
  checkGateSession();
});
/* === FIM MELHORIA A: PORTÃO DE ENTRADA === */

/* === MELHORIA F: TRAVA DE EXPEDIENTE E PAUSA MANUAL === */

// --- Estado global de pausa e referências aos intervalos controlados ---
const EXPEDIENTE_EXTRA_HOJE_ATE_MS = Date.parse('2026-11-26T20:00:00-03:00');
let isPausado = false;
let _pausaIniciadaEmMs = 0;
let intervalPauseClock = null;
let intervalChat = null;   // referência ao setInterval do chat (~linha 2422)
let intervalAgend = null;  // referência ao setInterval de agendamentos (~linha 2447)
let intervalCheckPausa = null;
let _mutiraoLiberadoData = '';
let _expedienteExtraAteMs = Date.now() < EXPEDIENTE_EXTRA_HOJE_ATE_MS ? EXPEDIENTE_EXTRA_HOJE_ATE_MS : 0;

function getDataHojeRecife() {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Recife',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
  } catch (e) {
    return new Date().toISOString().split('T')[0];
  }
}

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
  if (_expedienteExtraAteMs && Date.now() < _expedienteExtraAteMs) return true;
  const now = new Date();
  const { day, hour } = getDayAndHourRecife(now);

  // === EXCEÇÃO TEMPORÁRIA: Mutirão Chico Mendes — Sábado ===
  const dateStrRecife = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Recife',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
  const DATAS_MUTIRAO = ['2026-09-26', '2026-11-07', '2026-04-11', '2026-11-14', '2026-04-18']; // Sábados liberados para mutirão
  if (DATAS_MUTIRAO.includes(dateStrRecife) || _mutiraoLiberadoData === dateStrRecife) {
    // No mutirão, só bloqueia fora do horário (06h–18h)
    if (hour < 6 || hour >= 18) return false;
    return true;
  }
  // === FIM EXCEÇÃO TEMPORÁRIA ===

  if (day === 0 || day === 6) return false; // Domingo (0) ou Sábado (6)
  if (hour < 6 || hour >= 18) return false; // Fora de 06h–18h
  return true;
}

function atualizarBotaoMutirao() {
  const btn = document.getElementById('btn-mutirao-hoje');
  if (!btn) return;
  const extraAtivo = Boolean(_expedienteExtraAteMs && Date.now() < _expedienteExtraAteMs);
  const ativo = _mutiraoLiberadoData === getDataHojeRecife();
  if (extraAtivo) {
    const horaFim = new Date(_expedienteExtraAteMs).toLocaleTimeString('pt-BR', {
      timeZone: 'America/Recife', hour: '2-digit', minute: '2-digit'
    });
    btn.textContent = `⏱️ Extra até ${horaFim}`;
    btn.style.background = 'rgba(74, 171, 60, 0.25)';
    btn.style.borderColor = 'rgba(74, 171, 60, 0.7)';
    return;
  }
  btn.textContent = ativo ? '✅ Mutirão Ativo' : '🗓️ Mutirão Hoje';
  btn.style.background = ativo ? 'rgba(74, 171, 60, 0.25)' : '';
  btn.style.borderColor = ativo ? 'rgba(74, 171, 60, 0.7)' : '';
}

async function carregarStatusMutiraoHoje() {
  try {
    const res = await fetch(`${API_URL}/config/mutirao-hoje`);
    if (!res.ok) return;
    const data = await res.json();
    _mutiraoLiberadoData = data.liberado ? (data.hoje || getDataHojeRecife()) : '';
    const parsedExtra = data.extra_ativo && data.extra_ate ? Date.parse(data.extra_ate) : 0;
    const pisoExtraHoje = Date.now() < EXPEDIENTE_EXTRA_HOJE_ATE_MS ? EXPEDIENTE_EXTRA_HOJE_ATE_MS : 0;
    _expedienteExtraAteMs = Math.max(Number.isFinite(parsedExtra) ? parsedExtra : 0, pisoExtraHoje);
    atualizarBotaoMutirao();
    checkExpediente();
    if (typeof aplicarProfissionaisDinamicosNoSistema === 'function') aplicarProfissionaisDinamicosNoSistema();
  } catch (_) {}
}

async function toggleMutiraoHoje(forceLiberar, senhaRetry = '') {
  const hoje = getDataHojeRecife();
  const jaAtivo = _mutiraoLiberadoData === hoje;
  const novoEstado = forceLiberar !== undefined ? Boolean(forceLiberar) : !jaAtivo;
  const acaoTexto = novoEstado ? 'LIBERAR expediente extra / mutirão hoje' : 'ENCERRAR liberação de mutirão hoje';
  let senha = senhaRetry || ((isAdmin && adminPassword) ? adminPassword : '');
  if (!senhaRetry) {
    if (isAdmin) {
      if (!confirm(`🗓️ Confirmar: ${acaoTexto}?`)) return;
    } else {
      const digitada = prompt(`🗓️ ${acaoTexto}\n\nDigite a senha de administrador:`);
      if (!digitada) return;
      senha = digitada.trim();
    }
  }
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (senha) headers['x-admin-password'] = senha;
    const res = await fetch(`${API_URL}/config/mutirao-hoje`, {
      method: 'POST',
      credentials: 'same-origin',
      headers,
      body: JSON.stringify({ senha: senha || undefined, liberado: novoEstado })
    });
    const data = await res.json().catch(() => ({}));
    if ((res.status === 401 || res.status === 403) && !senhaRetry && typeof pedirSenhaAdmin === 'function') {
      const digitada = prompt(`🔒 Confirme a senha de Administrador para ${acaoTexto}:`);
      if (!digitada) return;
      adminPassword = digitada.trim();
      try { sessionStorage.setItem('usf_admin_pwd', adminPassword); } catch (_) {}
      return toggleMutiraoHoje(forceLiberar, adminPassword);
    }
    if (!res.ok) {
      showToast(data.error || '❌ Senha incorreta!', true);
      return;
    }
    _mutiraoLiberadoData = data.liberado ? (data.hoje || hoje) : '';
    atualizarBotaoMutirao();
    checkExpediente();
    if (typeof aplicarProfissionaisDinamicosNoSistema === 'function') aplicarProfissionaisDinamicosNoSistema();
    showToast(data.liberado ? '✅ Mutirão liberado para hoje! Sistema ativo até 18h.' : '🔒 Liberação de mutirão encerrada.');
  } catch (err) {
    showToast('Erro ao atualizar modo mutirão.', true);
  }
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
  if (!isGateAuthenticated && !isModoTV()) return;
  startAdaptivePolling();
  if (isGateAuthenticated && !intervalChat) {
    intervalChat = setInterval(() => {
      if (!isGateAuthenticated) return;
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
    if (typeof carregarJinglePreferido === 'function') carregarJinglePreferido();
    if (!pollingTimer1) resumeAllPolling(); // só retoma se estava parado
  }
}
setInterval(checkExpediente, 60000); // verifica a cada minuto

// --- Aplicar / sincronizar estado global de pausa em todas as estações ---
const DEFAULT_PAUSE_MSG = 'Atendimento pausado temporariamente para realização de atividade interna / palestra na recepção.';

function atualizarRelogioPausa() {
  const clockEl = document.getElementById('pause-clock');
  const metaEl = document.getElementById('pause-meta-time');
  const agora = Date.now();
  if (clockEl) {
    clockEl.textContent = new Date(agora).toLocaleTimeString('pt-BR', {
      timeZone: 'America/Recife', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }
  if (metaEl) {
    if (_pausaIniciadaEmMs > 0) {
      const horaIni = new Date(_pausaIniciadaEmMs).toLocaleTimeString('pt-BR', {
        timeZone: 'America/Recife', hour: '2-digit', minute: '2-digit'
      });
      const mins = Math.max(0, Math.floor((agora - _pausaIniciadaEmMs) / 60000));
      metaEl.textContent = mins >= 1
        ? `Pausado às ${horaIni} · há ${mins} min`
        : `Pausado às ${horaIni} · agora`;
    } else {
      metaEl.textContent = 'Pausa ativa no sistema';
    }
  }
}

function aplicarEstadoPausa(pausado, motivo, pausadoEm = null) {
  const overlay = document.getElementById('pause-overlay');
  const subEl = document.getElementById('pause-sub-text');
  const btn = document.getElementById('btn-palestra');

  if (pausado) {
    const parsedEm = pausadoEm ? Date.parse(pausadoEm) : 0;
    if (Number.isFinite(parsedEm) && parsedEm > 0) {
      _pausaIniciadaEmMs = parsedEm;
    } else if (!_pausaIniciadaEmMs) {
      _pausaIniciadaEmMs = Date.now();
    }
    if (subEl) subEl.textContent = motivo || DEFAULT_PAUSE_MSG;
    atualizarRelogioPausa();
    if (!intervalPauseClock) {
      intervalPauseClock = setInterval(atualizarRelogioPausa, 1000);
    }
    if (isPausado) {
      if (overlay) overlay.classList.remove('hidden');
      return;
    }
    isPausado = true;
    document.querySelectorAll('.modal, .modal-overlay, [id$="-modal"]').forEach(el => {
      if (el.classList.contains('show') || el.style.display === 'flex' || el.style.display === 'block') {
        el.classList.remove('show');
        el.style.display = 'none';
      }
    });
    fecharModalConfigPausa();
    document.body.style.overflow = 'hidden';
    if (btn) {
      btn.innerHTML = '▶️ Retomar';
      btn.classList.add('btn-palestra-pausado');
    }
    if (overlay) overlay.classList.remove('hidden');
    stopAllPolling();
    if (!intervalCheckPausa) {
      intervalCheckPausa = setInterval(carregarStatusPausa, 5000);
    }
  } else {
    _pausaIniciadaEmMs = 0;
    if (intervalPauseClock) {
      clearInterval(intervalPauseClock);
      intervalPauseClock = null;
    }
    if (intervalCheckPausa) {
      clearInterval(intervalCheckPausa);
      intervalCheckPausa = null;
    }
    if (!isPausado) {
      if (overlay) overlay.classList.add('hidden');
      return;
    }
    isPausado = false;
    document.body.style.overflow = '';
    document.body.style.pointerEvents = '';
    if (btn) {
      btn.innerHTML = '🎙️ Pausar';
      btn.classList.remove('btn-palestra-pausado');
      btn.style.pointerEvents = '';
    }
    if (overlay) overlay.classList.add('hidden');
    if (subEl) subEl.textContent = DEFAULT_PAUSE_MSG;
    checkExpediente();
    if (isDentroDoHorario()) {
      if (isGateAuthenticated || isModoTV()) resumeAllPolling();
      if (isGateAuthenticated && typeof loadQueues === 'function') loadQueues();
      if ((isGateAuthenticated || isModoTV()) && typeof loadCurrentCalling === 'function') loadCurrentCalling();
      if ((isGateAuthenticated || isModoTV()) && typeof loadHistory === 'function') loadHistory();
    }
  }
}

async function carregarStatusPausa() {
  try {
    const r = await fetch(`${API_URL}/config/pausa`, { cache: 'no-store' });
    if (!r.ok) return;
    const d = await r.json();
    aplicarEstadoPausa(Boolean(d.pausado), d.motivo, d.pausado_em);
  } catch (_) {}
}

function selecionarMotivoPausaRapido(btnEl, texto) {
  const input = document.getElementById('input-motivo-pausa');
  if (input && texto) input.value = texto;
  document.querySelectorAll('#modal-config-pausa .pause-preset-chip').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  input?.focus();
}

function fecharModalConfigPausa() {
  const modal = document.getElementById('modal-config-pausa');
  if (modal) {
    modal.classList.remove('show');
    modal.style.display = '';
  }
}

function confirmarPausaPalestraModal() {
  const input = document.getElementById('input-motivo-pausa');
  const motivo = (input?.value || '').trim() || DEFAULT_PAUSE_MSG;
  fecharModalConfigPausa();
  return togglePausaPalestra('', motivo);
}

// --- Botão de Pausa Global para Palestras da Gestora ---
async function togglePausaPalestra(senhaRetry = '', motivoOverride = null) {
  const novoEstado = !isPausado;
  let senhaUsada = senhaRetry || ((isAdmin && adminPassword) ? adminPassword : '');

  if (novoEstado && motivoOverride === null && !senhaRetry) {
    const modal = document.getElementById('modal-config-pausa');
    if (modal) {
      const input = document.getElementById('input-motivo-pausa');
      if (input) input.value = DEFAULT_PAUSE_MSG;
      document.querySelectorAll('#modal-config-pausa .pause-preset-chip').forEach((b, idx) => {
        b.classList.toggle('active', idx === 0);
      });
      modal.classList.add('show');
      setTimeout(() => document.getElementById('input-motivo-pausa')?.focus(), 60);
      return;
    }
  }

  const motivoFinal = novoEstado
    ? (String(motivoOverride || DEFAULT_PAUSE_MSG).trim().slice(0, 200) || DEFAULT_PAUSE_MSG)
    : null;

  if (!senhaRetry) {
    if (!isAdmin) {
      const msgPrompt = novoEstado
        ? '🎙️ Pausar atendimento em TODOS os computadores e TVs\n\nDigite a senha de administrador:'
        : '🔓 Retomar atendimento em TODOS os computadores e TVs\n\nDigite a senha de administrador:';
      const digitada = prompt(msgPrompt);
      if (!digitada) return;
      senhaUsada = digitada.trim();
    } else if (!novoEstado) {
      if (!confirm('🔓 Retomar o atendimento agora em TODOS os computadores e TVs?')) return;
    }
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (senhaUsada) headers['x-admin-password'] = senhaUsada;
    const res = await fetch(`${API_URL}/config/pausa`, {
      method: 'POST',
      credentials: 'same-origin',
      headers,
      body: JSON.stringify({
        senha: senhaUsada || undefined,
        pausado: novoEstado,
        motivo: motivoFinal
      })
    });
    const data = await res.json().catch(() => ({}));
    if ((res.status === 401 || res.status === 403) && !senhaRetry) {
      const digitada = prompt('🔒 Confirme a senha de Administrador para alterar a pausa global:');
      if (!digitada) return;
      adminPassword = digitada.trim();
      try { sessionStorage.setItem('usf_admin_pwd', adminPassword); } catch (_) {}
      return togglePausaPalestra(adminPassword, motivoFinal);
    }
    if (!res.ok) {
      showToast(data.error || '❌ Senha incorreta!', true);
      return;
    }
    aplicarEstadoPausa(Boolean(data.pausado), data.motivo, data.pausado_em);
    showToast(data.pausado
      ? '🎙️ Atendimento pausado em TODOS os computadores!'
      : '✅ Atendimento retomado em TODOS os computadores!'
    );
  } catch (err) {
    showToast('Erro de conexão ao alterar pausa global.', true);
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
const SETORES_HORARIO_MARCADO = ['Médico', 'Odontologia', 'Enfermagem'];

const SECTOR_CONFIG = {
  'Acolhimento': { icon: '💜', color: 'var(--purple)', colorDark: 'var(--purple-dark)', btnClass: 'btn-purple', tagClass: 'tag-acolhimento', key: 'acolhimento' },
  'Farmácia': { icon: '💊', color: 'var(--green)', colorDark: 'var(--green-dark)', btnClass: 'btn-green', tagClass: 'tag-farmacia', key: 'farmacia' },
  'Regulação': { icon: '📋', color: 'var(--blue)', colorDark: 'var(--blue-dark)', btnClass: 'btn-primary', tagClass: 'tag-regulacao', key: 'regulacao' },
  'Médico': { icon: '🩺', color: 'var(--orange)', colorDark: 'var(--orange-dark)', btnClass: 'btn-orange', tagClass: 'tag-medico', key: 'medico',
    profissionais: ['Dr. Israel Christian', 'Dr. Joene Halan', 'Dra. Mirela Mota'], defaultConsultorios: ['1','2','3'] },
  'Enfermagem': { icon: '👩‍⚕️', color: 'var(--teal)', colorDark: 'var(--teal-dark)', btnClass: 'btn-teal', tagClass: 'tag-enfermagem', key: 'enfermagem',
    profissionais: ['Mariana Vaz', 'Jorge Marcio', 'Lucelia de Abreu', 'Renata Célia'], defaultConsultorios: ['4','5','6'] },
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
let _historySeq = 0;
let _pendingUserCallSpeakUntil = 0;
const _spokenCallIds = new Set();
let _loadingPendingVoiceCalls = false;
const _processedVoiceCallIds = new Set();
let _silencioBroadcastInit = false;
let isAdmin = false, isGerente = false, userRole = 'staff', adminPassword = null, alertedPatients = new Set();
function isManagerOrAdmin() {
  return Boolean(isAdmin || isGerente);
}
function isValidAdminPass(pwd) {
  return Boolean(pwd && String(pwd).trim().length > 0);
}
async function verifyAdminPasswordServer(pwd, opts = {}) {
  const s = String(pwd || '').trim();
  if (!s) return { ok: false, role: null, status: 400, data: {} };
  try {
    const r = await fetch(`${API_URL}/verify-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ senha: s, ...opts })
    });
    const data = await r.json().catch(() => ({}));
    return {
      ok: r.ok && Boolean(data.valid),
      role: data.role || null,
      status: r.status,
      data
    };
  } catch {
    return { ok: false, role: null, status: 500, data: {} };
  }
}
function handlePrivilegedAuthFailure(res, defaultMsg = '❌ Senha incorreta!') {
  const data = res?.data || {};
  if (res?.status === 423 || data.bloqueado_definitivo) {
    if (typeof window.mostrarAlertaDispositivoBloqueado === 'function') {
      window.mostrarAlertaDispositivoBloqueado({
        motivo: 'excesso_tentativas',
        code: 'DEVICE_BLOCKED'
      });
    } else {
      showToast(data.error || '⛔ Dispositivo bloqueado por excesso de tentativas.', true);
    }
    return;
  }
  if (res?.status === 429) {
    const mins = data.segundos_restantes ? Math.max(1, Math.ceil(data.segundos_restantes / 60)) : 5;
    showToast(data.error || `⏳ Dispositivo bloqueado por ${mins} min após tentativas incorretas.`, true);
    return;
  }
  showToast(data.error || defaultMsg, true);
}
try {
  const _savedAdmin = sessionStorage.getItem('usf_admin_pwd');
  const _savedRole = sessionStorage.getItem('usf_user_role');
  if (_savedAdmin) {
    verifyAdminPasswordServer(_savedAdmin).then(res => {
      if (res.ok && (res.role === 'admin' || res.role === 'gerente')) {
        userRole = res.role;
        isAdmin = res.role === 'admin';
        isGerente = res.role === 'gerente';
        adminPassword = _savedAdmin;
        try { sessionStorage.setItem('usf_user_role', res.role); } catch (e) {}
        if (typeof updateAdminUI === 'function') updateAdminUI();
      } else {
        try {
          sessionStorage.removeItem('usf_admin_pwd');
          if (_savedRole) sessionStorage.removeItem('usf_user_role');
        } catch (e) {}
      }
    });
  }
} catch (e) {}

try { document.body.classList.remove('dark-mode'); localStorage.removeItem('usf_dark_mode'); } catch (e) {}
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
        <div class="sector-filter-row">
          <span class="sector-deck-label">Filtrar Fila por Profissional</span>
          <div class="filter-bar" id="filter-bar-${cfg.key}" style="display:flex;gap:8px;flex-wrap:wrap;">
            ${allBtn}${btns}
          </div>
        </div>`;
      // Auto-set the first professional as default filter
      if (sectorFilters[cfg.key] === undefined || sectorFilters[cfg.key] === null) {
        sectorFilters[cfg.key] = firstProf;
      }
    }

    const callBtnsHTML = `
      <div class="sector-call-actions sector-call-actions--hero">
        <button class="btn ${cfg.btnClass} btn-3d btn-call-hero" onclick="callNext('${setor}', this)">📢 Chamar Próximo</button>
        ${(setor === 'Farmácia' || setor === 'Regulação') ? `<button class="btn ${cfg.btnClass} btn-3d btn-call-hero btn-call-hero--multi" onclick="callNextMulti('${setor}', this)">📢 Chamar 3 Próximos</button>` : ''}
        <button class="btn btn-repeat-sector" onclick="speakAgain('${setor}', this)" title="Repetir chamada atual no painel e na voz">🔊 Repetir</button>
      </div>`;

    let controlDeckHTML = '';
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
      controlDeckHTML = `
        <div class="sector-control-deck">
          ${filterHTML}
          <div class="sector-call-row">
            <div class="form-group"><label>Consultório / Sala</label><select id="consultorio-${cfg.key}">${consultOpts}</select></div>
            <div class="form-group"><label>Profissional em Atendimento</label><select id="profissional-${cfg.key}">${profOpts}</select></div>
          </div>
          ${callBtnsHTML}
        </div>`;
    } else {
      controlDeckHTML = `
        <div class="sector-control-deck">
          ${callBtnsHTML}
        </div>`;
    }

    const usaHorarioMarcadoSetor = SETORES_HORARIO_MARCADO.includes(setor);
    const odontoRegraBanner = `
      <details class="priority-rule-collapse">
        <summary>
          <span>⭐ Regra de Prioridade (Lei nº 10.048/2000 · 1º ao 10º) e ${usaHorarioMarcadoSetor ? 'Horário Marcado' : 'Demanda Espontânea'}</span>
          <span class="priority-rule-hint">Ver ordem legal ▾</span>
        </summary>
        <div class="priority-rule-body">
          <strong>1º Preferenciais na ordem legal (1 a 10):</strong> 1. Idoso 80+ → 2. PCD → 3. TEA → 4. Gestante → 5. Lactante → 6. Criança de colo (&lt;2a) → 7. Mobilidade reduzida → 8. Obesidade → 9. Idoso 60+ → 10. Doador de sangue.<br>
          ${usaHorarioMarcadoSetor
            ? '<strong>2º Ordem por Horário Marcado + Chegada:</strong> Pacientes de 09:00 atendem antes de 10:00 (salvo preferencial). No mesmo horário marcado, vale a ordem de chegada.'
            : '<strong>2º Demanda Espontânea (Ordem de Chegada):</strong> Setor sem horário marcado; após os preferenciais, o atendimento segue a ordem de chegada na recepção.'}
        </div>
      </details>`;

    screenEl.innerHTML = `
      <div class="sector-page-header">
        <div class="sector-icon-big" style="background:${cfg.color}22;">${cfg.icon}</div>
        <div><div class="sector-page-title">${setor}</div><div class="sector-page-sub">Chamada de pacientes para ${setor.toLowerCase()}</div></div>
      </div>
      ${SETORES_HORARIO_MARCADO.includes(setor) ? `<div id="resumo-prof-${cfg.key}" class="prof-summary-wrap"></div>` : ''}
      <div class="calling-banner" id="banner-${cfg.key}">
        <div class="cb-icon">🔔</div>
        <div class="cb-text"><div class="cb-label">Chamando agora</div><div class="cb-name" id="banner-name-${cfg.key}">—</div><div class="cb-sector">${cfg.icon} ${setor}</div></div>
        <button class="btn btn-ghost btn-sm" onclick="speakAgain('${setor}')">🔊 Repetir</button>
      </div>
      <div class="card-white">
        ${odontoRegraBanner}
        ${controlDeckHTML}
        ${typeof renderBarraFormulariosSetor === 'function' ? renderBarraFormulariosSetor(setor) : ''}
        ${setor === 'Regulação' ? '<div id="regulacao-copiloto-root"></div>' : ''}
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
  if (typeof initCopilotoRegulacao === 'function') {
    initCopilotoRegulacao();
  }
  if (typeof carregarDevolucoesSisreg === 'function') {
    carregarDevolucoesSisreg();
  }
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
  window._usfSectorFilters = sectorFilters;
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
  if (typeof renderResumoProfissionais === 'function') renderResumoProfissionais();
  if (typeof atualizarBadgesDevolucoesSetores === 'function') atualizarBadgesDevolucoesSetores();
}

// ====== CLOCK ======
function updateClock() {
  const now = new Date();
  document.getElementById('clockDisplay').textContent = now.toLocaleTimeString('pt-BR');
  const date = now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  document.getElementById('dateDisplay').textContent = date.charAt(0).toUpperCase() + date.slice(1);
}
setInterval(updateClock, 1000); updateClock();

// ====== ADMIN / GERENTE ======
function toggleAdmin() {
  if (isAdmin || isGerente) {
    isAdmin = false;
    isGerente = false;
    userRole = 'staff';
    adminPassword = null;
    try {
      sessionStorage.removeItem('usf_admin_pwd');
      sessionStorage.removeItem('usf_user_role');
    } catch (e) {}
    fetch(`${API_URL}/auth/downgrade-staff`, { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    updateAdminUI();
    showToast('🔒 Modo público ativado');
    return;
  }
  const senha = prompt('🔒 Digite a senha de Gerente ou Administrador:');
  if (!senha) return;
  const s = senha.trim();

  verifyAdminPasswordServer(s).then(res => {
    if (res.ok && (res.role === 'admin' || res.role === 'gerente')) {
      userRole = res.role;
      isAdmin = res.role === 'admin';
      isGerente = res.role === 'gerente';
      adminPassword = s;
      try {
        sessionStorage.setItem('usf_admin_pwd', s);
        sessionStorage.setItem('usf_user_role', res.role);
      } catch (e) {}
      showToast(isAdmin ? '🔓 Modo administrador ativado!' : '👔 Modo gerente ativado!');
      updateAdminUI();
    } else {
      handlePrivilegedAuthFailure(res, '❌ Senha incorreta!');
    }
  });
}

function updateAdminUI() {
  const btn = document.getElementById('btn-admin');
  if (btn) {
    if (isAdmin) {
      btn.textContent = '🔓 Admin';
      btn.classList.add('unlocked');
      btn.classList.remove('manager');
    } else if (isGerente) {
      btn.textContent = '👔 Gerente';
      btn.classList.add('unlocked', 'manager');
    } else {
      btn.textContent = '🔒 Modo Público';
      btn.classList.remove('unlocked', 'manager');
    }
  }
  document.body.classList.toggle('admin-active', isAdmin);
  document.body.classList.toggle('manager-active', isGerente);

  document.querySelectorAll('.admin-only-tab').forEach(t => {
    t.style.display = isAdmin ? 'inline-flex' : 'none';
  });
  document.querySelectorAll('.manager-or-admin-tab').forEach(t => {
    t.style.display = isManagerOrAdmin() ? 'inline-flex' : 'none';
  });
  const activeScreenId = document.querySelector('.screen.active')?.id || '';
  if (!isAdmin && activeScreenId === 'screen-dispositivos' && typeof showScreen === 'function') {
    showScreen('recepcao');
  } else if (!isManagerOrAdmin() && (activeScreenId === 'screen-atendidos' || activeScreenId === 'screen-admin_relatorios') && typeof showScreen === 'function') {
    showScreen('recepcao');
  }
  if (typeof updateAll === 'function') updateAll();
  if (typeof renderAcolhimentoFluxo === 'function') renderAcolhimentoFluxo();
  if (typeof renderAcsEscutaScreen === 'function') renderAcsEscutaScreen();
  if (typeof renderSegundaEscutaScreen === 'function') renderSegundaEscutaScreen();
}

// ====== MELHORIA G: MÓDULO DE REORDENAÇÃO RBAC ======

// --- Estado do contexto de menu e modais ---
let _ctxPatientId = null;
let _ctxPatientNome = null;
let _ctxPatientSetor = null;
let _sortableInstances = {}; // Guarda instâncias SortableJS por containerId

// --- Guards de permissão (Admin e Gerente) ---
const AdminGuard = {
  check() { return isAdmin; },
  require(action) {
    if (!isAdmin) { showToast('🔒 Ação restrita ao Administrador!', true); return; }
    action();
  }
};

const ManagerGuard = {
  check() { return isManagerOrAdmin(); },
  require(action) {
    if (!isManagerOrAdmin()) { showToast('🔒 Ação restrita à Gerência ou Administração!', true); return; }
    action();
  }
};

// Helper centralizado para ações exclusivas de Administrador
async function pedirSenhaAdmin(acaoNome, callback) {
  if (isAdmin && adminPassword) {
    return callback(adminPassword);
  }
  const senha = prompt(`🔒 Ação exclusiva do ADMINISTRADOR para ${acaoNome}:\n\nDigite a senha de Administrador:`);
  if (!senha) return;
  const s = senha.trim();
  const res = await verifyAdminPasswordServer(s, { apenas_admin: true });
  if (!res.ok || res.role !== 'admin') {
    handlePrivilegedAuthFailure(res, '❌ Senha de Administrador inválida! Ação cancelada.');
    return;
  }
  callback(s);
}

// Helper centralizado para ações liberadas para Gerente ou Administrador
async function pedirSenhaGerenteOuAdmin(acaoNome, callback) {
  if (isManagerOrAdmin() && adminPassword) {
    return callback(adminPassword);
  }
  const senha = prompt(`🔒 Confirmação requerida para ${acaoNome}:\n\nDigite a senha de Gerente ou Administrador:`);
  if (!senha) return;
  const s = senha.trim();
  const res = await verifyAdminPasswordServer(s);
  if (!res.ok || (res.role !== 'admin' && res.role !== 'gerente')) {
    handlePrivilegedAuthFailure(res, '❌ Senha incorreta! Ação cancelada.');
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
    if (typeof fecharModalEditarNomeFila === 'function') fecharModalEditarNomeFila();
    if (typeof fecharModalPrioridadeFila === 'function') fecharModalPrioridadeFila();
    if (typeof fecharModalTubosColeta === 'function') fecharModalTubosColeta();
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
  const senha = adminPassword || '';
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
  const temPermissaoMgr = isManagerOrAdmin();
  ['ctx-item-rename', 'ctx-item-priority', 'ctx-divider-mgr'].forEach(elId => {
    const el = document.getElementById(elId);
    if (el) el.style.display = temPermissaoMgr ? '' : 'none';
  });
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
function ctxRenamePatient() {
  closeContextMenu();
  if (!isManagerOrAdmin()) { showToast('🔒 Apenas Gerente ou Administrador pode editar o nome.', true); return; }
  abrirModalEditarNomeFila(_ctxPatientId, _ctxPatientNome);
}
function ctxEditPriority() {
  closeContextMenu();
  if (!isManagerOrAdmin()) { showToast('🔒 Apenas Gerente ou Administrador pode alterar a prioridade.', true); return; }
  const p = encontrarPacienteEmCachePorId(_ctxPatientId);
  if (p) abrirModalPrioridadeFila(p);
  else abrirModalPrioridadeFila({ id: _ctxPatientId, nome: _ctxPatientNome, setor: _ctxPatientSetor });
}

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
  _examesColetaTransfer = null;
  if (typeof atualizarVisibilidadeTubosTransfer === 'function') atualizarVisibilidadeTubosTransfer();

  document.getElementById('transfer-modal').classList.add('show');
}

function toggleTransferTipoAtendimento() {
  const setor = document.getElementById('transfer-setor-destino').value;
  const motivoGrupo = document.getElementById('transfer-motivo-agendamento-grupo');
  const tipoGrupo = document.getElementById('transfer-tipo-atendimento-grupo');
  const profGrupo = document.getElementById('transfer-profissional-grupo');
  const transferHmGrupo = document.getElementById('transfer-horario-marcado-grupo');
  if (transferHmGrupo) transferHmGrupo.style.display = SETORES_HORARIO_MARCADO.includes(setor) ? 'block' : 'none';

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
        <option value="Consulta Agendada (Conecta Recife)">📱 Consulta Agendada (Conecta Recife)</option>
        <option value="Remoção de Pontos">🪡 Remoção de Pontos</option>
        <option value="Acolhimento">💜 Acolhimento</option>
        <option value="Urgência">🚨 Urgência</option>
        <option value="Intercorrência">⚠️ Intercorrência</option>
        <option value="Retorno">🔄 Retorno</option>
      `;
    } else if (tipoGrupo.style.display === 'block') {
      selectTipo.innerHTML = `
        <option value="">— Opcional —</option>
        <option value="Consulta">🩺 Consulta</option>
        <option value="Consulta Agendada (Conecta Recife)">📱 Consulta Agendada (Conecta Recife)</option>
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
  if (typeof atualizarVisibilidadeTubosTransfer === 'function') atualizarVisibilidadeTubosTransfer();
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
  const horarioMarcadoTransfer = SETORES_HORARIO_MARCADO.includes(novoSetor) ? (document.getElementById('transfer-horario-marcado')?.value || null) : null;

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
        body: JSON.stringify({
          novoSetor,
          novoTipoAtendimento,
          novoProfissional,
          horario_marcado: horarioMarcadoTransfer,
          exames_coleta: (novoSetor === 'Téc. Enfermagem' && _examesColetaTransfer) ? _examesColetaTransfer : undefined,
          senha: senhaUsada
        })
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
    executeTransfer('');
  } else {
    ManagerGuard.require(async () => {
      executeTransfer(adminPassword);
    });
  }
}

// --- SortableJS: Drag & Drop com animação e ESC ---
function initSortable(containerId, setor) {
  if (!window.Sortable || !isManagerOrAdmin()) return;
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
      ManagerGuard.require(async () => {
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
  if ((name === 'atendidos' || name === 'admin_relatorios') && !isManagerOrAdmin()) {
    showToast('🔒 Aba restrita ao Gerente ou Administrador.', true);
    return;
  }
  if (name === 'dispositivos' && !isAdmin) {
    showToast('🔒 Aba restrita ao Administrador.', true);
    return;
  }
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
  if (typeof atualizarAlertaIntercorrenciaRecepcao === 'function') atualizarAlertaIntercorrenciaRecepcao();
  if (typeof atualizarBotaoPreviaReceitaRecepcao === 'function') atualizarBotaoPreviaReceitaRecepcao();
  if (typeof atualizarVisibilidadeTubosRecepcao === 'function') atualizarVisibilidadeTubosRecepcao();
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
  if (typeof atualizarAlertaIntercorrenciaRecepcao === 'function') atualizarAlertaIntercorrenciaRecepcao();
  if (typeof atualizarBotaoPreviaReceitaRecepcao === 'function') atualizarBotaoPreviaReceitaRecepcao();
  if (typeof atualizarVisibilidadeTubosRecepcao === 'function') atualizarVisibilidadeTubosRecepcao();
}

function atualizarOpcoesPrioridadePorSetor(setor) {
  const selectPrioTipo = document.getElementById('input-tipo-prioridade');
  if (!selectPrioTipo) return;
  const valorAtual = selectPrioTipo.value;
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
  if (valorAtual && [...selectPrioTipo.options].some(o => o.value === valorAtual)) {
    selectPrioTipo.value = valorAtual;
  }
}

function toggleTipoAtendimento() {
  const setor = document.getElementById('input-setor').value;
  document.getElementById('tipo-atendimento-grupo').style.display = ['Médico','Enfermagem','Odontologia','Téc. Enfermagem'].includes(setor) ? 'flex' : 'none';

  // Exibir Horário Marcado apenas para Médico, Odontologia e Enfermagem (demais setores são demanda espontânea)
  const usaHm = SETORES_HORARIO_MARCADO.includes(setor);
  const odontoHmGrupo = document.getElementById('odonto-horario-marcado-grupo');
  const odontoHmChips = document.getElementById('odonto-horario-chips');
  if (odontoHmGrupo) odontoHmGrupo.style.display = usaHm ? 'flex' : 'none';
  if (odontoHmChips) odontoHmChips.style.display = usaHm ? 'block' : 'none';
  if (!usaHm) {
    const inpHm = document.getElementById('input-horario-marcado');
    if (inpHm) inpHm.value = '';
  }
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
        <option value="Consulta Agendada (Conecta Recife)">📱 Consulta Agendada (Conecta Recife)</option>
        <option value="Remoção de Pontos">🪡 Remoção de Pontos</option>
        <option value="Acolhimento">💜 Acolhimento</option>
        <option value="Urgência">🚨 Urgência</option>
        <option value="Intercorrência">⚠️ Intercorrência</option>
        <option value="Intercorrência (Acolhimento)">🚨 Intercorrência (Acolhimento)</option>
        <option value="Retorno">🔄 Retorno</option>
      `;
    } else {
      selectTipo.innerHTML = `
        <option value="Consulta">🩺 Consulta</option>
        <option value="Consulta Agendada (Conecta Recife)">📱 Consulta Agendada (Conecta Recife)</option>
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
  if (typeof atualizarAlertaIntercorrenciaRecepcao === 'function') atualizarAlertaIntercorrenciaRecepcao();
  if (typeof atualizarBotaoPreviaReceitaRecepcao === 'function') atualizarBotaoPreviaReceitaRecepcao();
  if (typeof atualizarVisibilidadeTubosRecepcao === 'function') atualizarVisibilidadeTubosRecepcao();
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
  const horario_marcado = SETORES_HORARIO_MARCADO.includes(setor) && horarioMarcadoInput && horarioMarcadoInput.value ? horarioMarcadoInput.value.trim() : null;

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

  const patientPayload = {
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
    horario_marcado,
    exames_coleta: (nomeSetorOriginal === 'Téc. Enfermagem' && _examesColetaRecepcao) ? _examesColetaRecepcao : null,
    previa_receita: window._previaReceitaPendente || null,
    client_request_id: typeof gerarClientRequestId === 'function' ? gerarClientRequestId() : `req_${Date.now()}`
  };

  function limparFormularioRecepcaoPosEnvio() {
    document.getElementById('input-nome').value = '';
    if (idadeInput) idadeInput.value = '';
    if (horarioMarcadoInput) horarioMarcadoInput.value = '';
    document.getElementById('input-setor').value = '';
    document.getElementById('input-prioridade').value = 'geral';
    if (equipeInput) equipeInput.value = '';
    if (motivoInput) motivoInput.value = '';
    _examesColetaRecepcao = null;
    if (typeof atualizarResumoTubosBox === 'function') atualizarResumoTubosBox('recepcao');
    document.querySelectorAll('#recepcao-equipe-grid .equipe-pill-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#recepcao-setor-quick-grid .setor-quick-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#condicoes-especiais-recepcao input[type="checkbox"]').forEach(c => c.checked = false);
    togglePrioridadeDetalhes(); toggleTipoAtendimento();
  }

  if (btn) btn.disabled = true;
  try {
    if (navigator.onLine === false) {
      throw new Error('Failed to fetch (offline)');
    }
    const r = await fetch(`${API_URL}/patients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patientPayload)
    });
    if (!r.ok) {
      const errData = await r.json().catch(() => ({}));
      throw new Error(errData.error || 'Erro ao adicionar paciente!');
    }
    const newPatient = await r.json();
    limparFormularioRecepcaoPosEnvio();
    const isPrio = Number(newPatient.nivel_prioridade) <= 2 || newPatient.prioridade === 'prioritario';
    const prioLabel = isPrio ? ' ⭐ PRIORIDADE' : '';
    const profLabel = profissional ? ` (${profissional})` : '';
    const eqLabel = equipe_paciente ? ` · ${equipe_paciente}` : '';
    showToast(`${nome} adicionado à fila de ${nomeSetorOriginal}${profLabel}${eqLabel}!${prioLabel}`);

    // Exibir banner rápido na recepção para marcar Busca ativa (alumIA) se necessário
    mostrarBannerPosCadastroAlumia(newPatient);
    if (typeof limparPreviaReceitaPendente === 'function') limparPreviaReceitaPendente();

    await loadQueues();
    if (setor === 'Acolhimento') loadAcolhimentoFluxo();
    document.getElementById('input-nome')?.focus();
  } catch (e) {
    if ((navigator.onLine === false || (typeof isErroDeRede === 'function' && isErroDeRede(e))) && typeof enfileirarPacienteOffline === 'function') {
      enfileirarPacienteOffline(patientPayload, nomeSetorOriginal);
      limparFormularioRecepcaoPosEnvio();
      showToast(`🔴 Sem internet! ${nome} guardado na fila offline e será enviado automaticamente quando o sinal voltar.`, true);
      document.getElementById('input-nome')?.focus();
    } else {
      showToast(e.message || 'Erro ao adicionar paciente!', true);
    }
  }
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
  // Se clicou antes do 1º loadHistory terminar, libera apenas a chamada recém-criada (sem ler o dia inteiro)
  if (lastSpokenCallId === null) {
    _pendingUserCallSpeakUntil = Date.now() + 8000;
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
  if ((typeof isManagerOrAdmin === 'function' && isManagerOrAdmin()) || adminPassword) {
    fetch(`${API_URL}/config/jingle`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senha: adminPassword || undefined, voz: vozPreferida })
    }).catch(() => {});
  }
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

async function rechamarPacienteNaFila(id, nome, setor, medico) {
  unlockAudio(true);
  try {
    const res = await fetch(`${API_URL}/patients/${id}/rechamar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'Erro ao rechamar paciente.', true);
      return;
    }
    showToast(`🔊 Rechamando ${nome} (${setor}) em todos os painéis!`);
    await loadHistory();
    await loadCurrentCalling();
  } catch (e) {
    showToast('Erro de conexão ao rechamar paciente.', true);
  }
}

function updatePainelFullscreenBtn() {
  const btn = document.getElementById('btn-painel-fullscreen');
  if (!btn) return;
  const isFs = Boolean(document.fullscreenElement);
  btn.textContent = isFs ? '✕ Sair Tela Cheia' : '⛶ Tela Cheia';
}

function togglePainelFullscreen() {
  const target = document.getElementById('screen-painel') || document.documentElement;
  if (!document.fullscreenElement) {
    if (target.requestFullscreen) {
      target.requestFullscreen().catch(() => showToast('Não foi possível ativar tela cheia neste navegador.', true));
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  }
}

document.addEventListener('fullscreenchange', updatePainelFullscreenBtn);

function atualizarBotaoPainelAltoContraste(ativo) {
  const btn = document.getElementById('btn-painel-contraste');
  if (!btn) return;
  btn.textContent = ativo ? '👁️ Contraste Normal' : '👁️ Alto Contraste';
  btn.style.background = ativo ? '#fde047' : 'rgba(253,224,71,0.16)';
  btn.style.color = ativo ? '#09152f' : '#fef08a';
}

function togglePainelAltoContraste() {
  const painel = document.querySelector('#screen-painel .painel-screen');
  if (!painel) return;
  const ativo = painel.classList.toggle('painel-alto-contraste');
  try { localStorage.setItem('usf_tv_alto_contraste', ativo ? '1' : '0'); } catch (_) {}
  atualizarBotaoPainelAltoContraste(ativo);
  showToast(ativo ? '👁️ Painel em Alto Contraste (Baixa Visão) ativado.' : '📺 Contraste padrão do painel restaurado.');
}

function aplicarPainelAltoContrasteInicial() {
  const painel = document.querySelector('#screen-painel .painel-screen');
  if (!painel) return;
  let ativo = false;
  try { ativo = localStorage.getItem('usf_tv_alto_contraste') === '1'; } catch (_) {}
  painel.classList.toggle('painel-alto-contraste', ativo);
  atualizarBotaoPainelAltoContraste(ativo);
}
document.addEventListener('DOMContentLoaded', aplicarPainelAltoContrasteInicial);

let speechQueue = [];
let isSpeaking = false;

// ====== JINGLE E TRATAMENTO DE VOZ CONFIGURÁVEIS DE CHAMADA ======
let jinglePreferido = 'classic';
try {
  const savedJ = localStorage.getItem('usf_jingle_chamada');
  if (savedJ) jinglePreferido = savedJ;
} catch (e) {}

const TRATAMENTOS_VOZ_VALIDOS = ['por_setor', 'usuario', 'paciente', 'atencao', 'atencao_setor'];
let tratamentoVozPreferido = 'por_setor';
try {
  const savedT = localStorage.getItem('usf_tratamento_voz');
  if (savedT && TRATAMENTOS_VOZ_VALIDOS.includes(savedT)) tratamentoVozPreferido = savedT;
} catch (e) {}

function sincronizarSeletoresJingle() {
  ['select-jingle-sistema', 'select-jingle-painel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = jinglePreferido;
  });
}

function sincronizarSeletoresTratamentoVoz() {
  ['select-tratamento-voz', 'select-tratamento-voz-painel'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.value !== tratamentoVozPreferido) {
      el.value = tratamentoVozPreferido;
    }
  });
}

async function carregarJinglePreferido() {
  try {
    const r = await fetch(`${API_URL}/config/jingle`);
    if (!r.ok) return;
    const d = await r.json();
    if (d && d.jingle) {
      jinglePreferido = d.jingle;
      try { localStorage.setItem('usf_jingle_chamada', jinglePreferido); } catch (e) {}
      sincronizarSeletoresJingle();
    }
    if (d && d.tratamento_voz && TRATAMENTOS_VOZ_VALIDOS.includes(d.tratamento_voz)) {
      tratamentoVozPreferido = d.tratamento_voz;
      try { localStorage.setItem('usf_tratamento_voz', tratamentoVozPreferido); } catch (e) {}
      sincronizarSeletoresTratamentoVoz();
    }
    if (d && d.voz) {
      vozPreferida = d.voz;
      try { localStorage.setItem('usf_voz_preferida', vozPreferida); } catch (e) {}
      if (typeof sincronizarSeletoresVoz === 'function') sincronizarSeletoresVoz();
    }
  } catch (_) {}
}

async function alterarJinglePreferido(novoJingle, testar = true) {
  jinglePreferido = novoJingle || 'classic';
  try { localStorage.setItem('usf_jingle_chamada', jinglePreferido); } catch (e) {}
  sincronizarSeletoresJingle();
  if ((typeof isManagerOrAdmin === 'function' && isManagerOrAdmin()) || adminPassword) {
    fetch(`${API_URL}/config/jingle`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senha: adminPassword || undefined, jingle: jinglePreferido })
    }).catch(() => {});
  }
  if (testar) {
    await playChime();
    showToast('🎵 Jingle atualizado!');
  }
}

async function alterarTratamentoVoz(novoModo, testar = true) {
  tratamentoVozPreferido = TRATAMENTOS_VOZ_VALIDOS.includes(novoModo) ? novoModo : 'por_setor';
  try { localStorage.setItem('usf_tratamento_voz', tratamentoVozPreferido); } catch (e) {}
  sincronizarSeletoresTratamentoVoz();
  if ((typeof isManagerOrAdmin === 'function' && isManagerOrAdmin()) || adminPassword) {
    fetch(`${API_URL}/config/jingle`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senha: adminPassword || undefined, tratamento_voz: tratamentoVozPreferido })
    }).catch(() => {});
  }
  const labels = {
    por_setor: 'Por Setor (Paciente no consultório / Usuário nos demais)',
    usuario: 'Usuário em todos os setores',
    paciente: 'Paciente em todos os setores',
    atencao: 'Atenção direto pelo nome',
    atencao_setor: 'Atenção + Paciente/Usuário por setor'
  };
  showToast(`🗣️ Chamada: ${labels[tratamentoVozPreferido] || tratamentoVozPreferido}`);
  if (testar) {
    unlockAudio(true);
    speakViaSynthesis('Maria da Silva', 'Médico', 'Consultório 2 - Dra. Mirela Mota');
  }
}

async function testarJingleSistema() {
  unlockAudio(true);
  await playChime();
}

document.addEventListener('DOMContentLoaded', () => {
  sincronizarSeletoresJingle();
  sincronizarSeletoresTratamentoVoz();
  carregarJinglePreferido();
});

// Desbloquear áudio automaticamente no primeiro clique/tecla na página (ajuda som do chat e TV)
['pointerdown', 'keydown'].forEach(evt => {
  document.addEventListener(evt, () => {
    try { unlockAudio(false); } catch (e) {}
  }, { once: true, passive: true });
});

function tocarNotaWebAudio(ctx, freq, startOffset, duration, type = 'sine', vol = 0.24) {
  const t = ctx.currentTime + startOffset;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration);
}

function playChime() {
  return new Promise((resolve) => {
    if (isMuted || jinglePreferido === 'none') {
      return resolve();
    }
    try {
      const ctx = getSharedAudioContext();
      if (!ctx) return resolve();

      const startChime = () => {
        try {
          if (jinglePreferido === 'airport') {
            // 4 notas ascendentes estilo aeroporto (C5 - E5 - G5 - C6)
            tocarNotaWebAudio(ctx, 523.25, 0.00, 0.28, 'triangle', 0.22);
            tocarNotaWebAudio(ctx, 659.25, 0.16, 0.28, 'triangle', 0.23);
            tocarNotaWebAudio(ctx, 783.99, 0.32, 0.30, 'triangle', 0.24);
            tocarNotaWebAudio(ctx, 1046.50, 0.48, 0.55, 'sine', 0.26);
            setTimeout(resolve, 1050);
          } else if (jinglePreferido === 'natal') {
            // Natalino (Jingle Bells: E5 E5 E5 | E5 E5 E5 | E5 G5 C5 D5 E5)
            const notas = [
              [659.25, 0.00, 0.16], [659.25, 0.17, 0.16], [659.25, 0.34, 0.30],
              [659.25, 0.68, 0.16], [659.25, 0.85, 0.16], [659.25, 1.02, 0.30],
              [659.25, 1.36, 0.16], [783.99, 1.53, 0.16], [523.25, 1.70, 0.22],
              [587.33, 1.93, 0.14], [659.25, 2.08, 0.50]
            ];
            notas.forEach(([f, off, dur]) => tocarNotaWebAudio(ctx, f, off, dur, 'triangle', 0.22));
            setTimeout(resolve, 2600);
          } else if (jinglePreferido === 'soft') {
            // Campainha suave (E5 - G#5 - B5)
            tocarNotaWebAudio(ctx, 659.25, 0.00, 0.35, 'sine', 0.18);
            tocarNotaWebAudio(ctx, 830.61, 0.15, 0.38, 'sine', 0.20);
            tocarNotaWebAudio(ctx, 987.77, 0.30, 0.55, 'sine', 0.22);
            setTimeout(resolve, 880);
          } else {
            // Clássico Ding-Dong (D5 -> A5)
            tocarNotaWebAudio(ctx, 587.33, 0.00, 0.45, 'sine', 0.24);
            tocarNotaWebAudio(ctx, 880.00, 0.18, 0.57, 'sine', 0.27);
            setTimeout(resolve, 750);
          }
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
    if (Array.isArray(ttsData.audioSegments) && ttsData.audioSegments.length > 1) {
      for (const seg of ttsData.audioSegments) {
        if (isMuted) break;
        await playAudioBase64(seg, ttsData.provider, voz);
      }
    } else {
      await playAudioBase64(ttsData.audioBase64, ttsData.provider, voz);
    }
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
      if (item.customChime === 'silence' && typeof playSilenceAttentionChime === 'function') {
        await playSilenceAttentionChime();
      } else {
        await playChime();
      }
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

function formatarTextoVozClinica(texto) {
  return String(texto || '')
    .replace(/\bDra\.?\s+/gi, 'Doutora ')
    .replace(/\bDr\.?\s+/gi, 'Doutor ')
    .replace(/\bT[ée]c\.?\s*Enfermagem\b/gi, 'Técnico de Enfermagem')
    .replace(/\bEnf\.?\s+/gi, 'Enfermeira ')
    .replace(/\s+-\s+/g, ', com ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolverPrefixoTratamentoVoz(nomeFalado, setor, modoForcado) {
  const modo = modoForcado || (typeof tratamentoVozPreferido !== 'undefined' ? tratamentoVozPreferido : 'por_setor');
  const setorNorm = String(setor || '').trim();
  const isSetorClinico = ['Médico', 'Enfermagem', 'Odontologia', 'Téc. Enfermagem'].includes(setorNorm);
  const substantivoSetor = isSetorClinico ? 'paciente' : 'usuário';
  const substantivoCap = isSetorClinico ? 'Paciente' : 'Usuário';

  if (modo === 'usuario') {
    return { prefixo: `Usuário ${nomeFalado}`, usaPontoSaudacao: false };
  }
  if (modo === 'paciente') {
    return { prefixo: `Paciente ${nomeFalado}`, usaPontoSaudacao: false };
  }
  if (modo === 'atencao') {
    return { prefixo: `Atenção, ${nomeFalado}`, usaPontoSaudacao: true };
  }
  if (modo === 'atencao_setor') {
    return { prefixo: `Atenção, ${substantivoSetor} ${nomeFalado}`, usaPontoSaudacao: true };
  }
  // Padrão ('por_setor'): Paciente para consultórios/coleta, Usuário para demais atendimentos
  return { prefixo: `${substantivoCap} ${nomeFalado}`, usaPontoSaudacao: false };
}

function speakViaSynthesis(nome, setor, medico) {
  if (isMuted) return;

  let h = new Date().getHours();
  try { h = getDayAndHourRecife(new Date()).hour; } catch (_) {}
  const saudacao = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const nomeFalado = formatarTextoVozClinica(nome);
  const medicoLimpo = formatarTextoVozClinica(medico || '');
  const setorLimpo = formatarTextoVozClinica(setor || '');

  let destinoTexto = '';
  if (medico && medico.startsWith('1ª Escuta')) {
    const parts = String(medico).split('-');
    const profParte = parts.length > 1 ? formatarTextoVozClinica(parts.slice(1).join('-')) : '';
    destinoTexto = profParte ? `à primeira escuta, com ${profParte}` : 'à primeira escuta';
  } else if (medico && (medico.startsWith('2ª Escuta') || /se dirija.*2ª escuta|se dirija.*segunda escuta/i.test(medico))) {
    const parts = String(medico).split('-');
    const profRaw = parts.length > 1 ? parts.slice(1).join('-').trim() : '';
    const semDesignacao = !profRaw || /sem designa|se dirija|2ª escuta|segunda escuta/i.test(profRaw);
    destinoTexto = !semDesignacao
      ? `à segunda escuta, com ${formatarTextoVozClinica(profRaw)}`
      : 'à segunda escuta';
  } else if (setor === 'Odontologia') {
    const parts = medico ? String(medico).split('-') : [];
    const profOdonto = parts.length > 1 ? formatarTextoVozClinica(parts.slice(1).join('-')) : '';
    destinoTexto = profOdonto ? `ao Consultório Odontológico, com ${profOdonto}` : 'ao Consultório Odontológico';
  } else if (setor === 'Acolhimento' && !medico) {
    destinoTexto = 'ao Acolhimento';
  } else if (setor === 'Agendamento') {
    destinoTexto = 'à Sala de Agendamento';
  } else {
    destinoTexto = medicoLimpo ? `ao ${medicoLimpo}` : `à ${setorLimpo}`;
  }

  const { prefixo, usaPontoSaudacao } = resolverPrefixoTratamentoVoz(nomeFalado, setor);
  const texto = usaPontoSaudacao
    ? `${saudacao}. ${prefixo}, dirija-se ${destinoTexto}.`
    : `${saudacao}, ${prefixo}, dirija-se ${destinoTexto}.`;
  speechQueue.push({ texto });
  processSpeechQueue();
}

const AVISO_SILENCIO_TOKEN = '__AVISO_SILENCIO__';
const AVISO_DOCUMENTOS_TOKEN = '__AVISO_DOCUMENTOS__';
const AVISO_PAINEL_TOKEN = '__AVISO_AGUARDE_PAINEL__';
const AVISO_PRIORIDADE_TOKEN = '__AVISO_LEI_PRIORIDADE__';
const AVISOS_INSTITUCIONAIS_CONFIG = {
  [AVISO_SILENCIO_TOKEN]: {
    token: AVISO_SILENCIO_TOKEN,
    bannerTexto: '🤫 Atenção: pedimos silêncio na sala de espera para que todos possam ouvir as chamadas com clareza.',
    bannerClasse: '',
    chime: 'silence',
    vozTexto: 'Atenção, senhores usuários e pacientes. Pedimos a gentileza de manter o silêncio na sala de espera para que todos possam ouvir as chamadas com clareza. A equipe da U S F Chico Mendes agradece.',
    toastEnviado: '🤫 Pedido de silêncio enviado para a TV da sala de espera!'
  },
  [AVISO_DOCUMENTOS_TOKEN]: {
    token: AVISO_DOCUMENTOS_TOKEN,
    bannerTexto: '🪪 Atenção: deixe seu documento com foto, CPF ou Cartão do SUS em mãos para agilizar seu atendimento.',
    bannerClasse: 'tv-silencio-banner--documentos',
    chime: 'silence',
    vozTexto: 'Atenção, senhores usuários e pacientes. Pedimos que deixem o documento com foto, CPF ou Cartão do SUS em mãos para agilizar o atendimento na recepção e nos consultórios.',
    toastEnviado: '🪪 Aviso de documentos em mãos enviado para a TV!'
  },
  [AVISO_PAINEL_TOKEN]: {
    token: AVISO_PAINEL_TOKEN,
    bannerTexto: '⏳ Atenção: acompanhe seu nome no painel. O atendimento segue a ordem de prioridade legal e o horário marcado.',
    bannerClasse: 'tv-silencio-banner--painel',
    chime: 'silence',
    vozTexto: 'Atenção, senhores usuários e pacientes. Aguardem o chamamento acompanhando seu nome no painel. As chamadas seguem a ordem de prioridade prevista em lei e os horários marcados.',
    toastEnviado: '⏳ Aviso sobre fila e painel enviado para a TV!'
  },
  [AVISO_PRIORIDADE_TOKEN]: {
    token: AVISO_PRIORIDADE_TOKEN,
    bannerTexto: '⚖️ Lei de Prioridade (Lei nº 10.048/2000): 1º Idosos 80+, seguidos por PCD, TEA, Gestantes, Lactantes, Criança de Colo, Mobilidade Reduzida, Obesidade e Idosos 60+. Consultas agendadas seguem a ordem do horário marcado e prioridade legal.',
    bannerClasse: 'tv-silencio-banner--prioridade',
    chime: 'silence',
    vozTexto: 'Atenção, senhores usuários e pacientes. Informamos que o atendimento na U S F Chico Mendes segue a Lei de Prioridade número 10.048 de 2000. Têm prioridade especial os idosos com 80 anos ou mais, seguidos por pessoas com deficiência, pessoas com autismo, gestantes, lactantes, acompanhantes de criança de colo, pessoas com mobilidade reduzida, pessoas com obesidade e demais idosos a partir de 60 anos. Informamos também que os atendimentos agendados seguem a sequência do horário marcado, respeitando sempre a prioridade prevista em lei. Agradecemos a compreensão e colaboração de todos.',
    toastEnviado: '⚖️ Aviso sobre Lei de Prioridade e Horário Marcado enviado para a TV!'
  }
};
let _silencioBannerTimer = null;
let _ultimoAvisoSilencioTs = 0;
const _ultimoAvisoPorToken = {};

function resolverConfigAvisoInstitucional(token) {
  return AVISOS_INSTITUCIONAIS_CONFIG[token] || AVISOS_INSTITUCIONAIS_CONFIG[AVISO_SILENCIO_TOKEN];
}

function playSilenceAttentionChime() {
  return new Promise((resolve) => {
    if (isMuted) return resolve();
    try {
      const ctx = getSharedAudioContext();
      if (!ctx) return resolve();
      const disparar = () => {
        try {
          // Campainha dupla firme e respeitosa para chamar atenção antes do aviso institucional
          tocarNotaWebAudio(ctx, 659.25, 0.00, 0.30, 'triangle', 0.25);
          tocarNotaWebAudio(ctx, 880.00, 0.18, 0.35, 'triangle', 0.27);
          tocarNotaWebAudio(ctx, 659.25, 0.55, 0.30, 'triangle', 0.25);
          tocarNotaWebAudio(ctx, 987.77, 0.73, 0.55, 'sine', 0.28);
          setTimeout(resolve, 1300);
        } catch (_) {
          resolve();
        }
      };
      if (ctx.state === 'suspended') {
        ctx.resume().then(disparar).catch(() => disparar());
      } else {
        disparar();
      }
    } catch (_) {
      resolve();
    }
  });
}

function mostrarBannerSilencioTV(token = AVISO_SILENCIO_TOKEN) {
  const banner = document.getElementById('tv-silencio-banner');
  if (!banner) return;
  const cfg = resolverConfigAvisoInstitucional(token);
  banner.classList.remove('tv-silencio-banner--documentos', 'tv-silencio-banner--painel', 'tv-silencio-banner--prioridade');
  if (cfg.bannerClasse) banner.classList.add(cfg.bannerClasse);
  const span = banner.querySelector('span');
  if (span) span.textContent = cfg.bannerTexto;
  else banner.textContent = cfg.bannerTexto;
  banner.classList.add('visible');
  if (_silencioBannerTimer) clearTimeout(_silencioBannerTimer);
  _silencioBannerTimer = setTimeout(() => {
    banner.classList.remove('visible');
  }, cfg.token === AVISO_PRIORIDADE_TOKEN ? 22000 : 15000);
}

function executarAvisoInstitucionalLocal(token = AVISO_SILENCIO_TOKEN) {
  const cfg = resolverConfigAvisoInstitucional(token);
  mostrarBannerSilencioTV(cfg.token);
  if (isMuted) return;
  speechQueue.push({
    customChime: cfg.chime || 'silence',
    texto: cfg.vozTexto
  });
  processSpeechQueue();
}

function executarAvisoSilencioLocal() {
  return executarAvisoInstitucionalLocal(AVISO_SILENCIO_TOKEN);
}

function processarAvisoSilencioRemoto(silencioObj) {
  if (!silencioObj || !silencioObj.id) {
    _silencioBroadcastInit = true;
    return;
  }
  const sid = Number(silencioObj.id) || 0;
  const ts = Number(silencioObj.ts) || 0;
  const token = silencioObj.token || AVISO_SILENCIO_TOKEN;
  const ageMs = Number.isFinite(Number(silencioObj.ageMs))
    ? Number(silencioObj.ageMs)
    : (ts > 0 ? Math.max(0, Date.now() - ts) : 0);
  if (!_silencioBroadcastInit) {
    _silencioBroadcastInit = true;
    if (sid > 0 && ageMs > 20000) {
      _processedVoiceCallIds.add(sid);
      return;
    }
  }
  const ehTelaTv = isModoTV() || Boolean(document.getElementById('screen-painel')?.classList.contains('active'));
  if (!ehTelaTv) return;
  if (sid > 0 && _processedVoiceCallIds.has(sid)) return;
  if (sid > 0) {
    _processedVoiceCallIds.add(sid);
    if (_processedVoiceCallIds.size > 120) {
      const first = _processedVoiceCallIds.values().next().value;
      if (first !== undefined) _processedVoiceCallIds.delete(first);
    }
  }
  executarAvisoInstitucionalLocal(token);
}

async function solicitarSilencioSalaEspera(btnElement, tokenAviso = AVISO_SILENCIO_TOKEN, senhaRetry = '') {
  if (!isManagerOrAdmin()) {
    showToast('🔒 Apenas Gerente ou Administrador pode emitir avisos na TV.', true);
    return;
  }
  const cfg = resolverConfigAvisoInstitucional(tokenAviso);
  const agora = Date.now();
  const ultimoTokenTs = Number(_ultimoAvisoPorToken[cfg.token] || 0);
  if (!senhaRetry && agora - ultimoTokenTs < 3000) {
    showToast('⏳ Aviso acabou de ser enviado. Aguarde alguns segundos.', true);
    return;
  }
  unlockAudio(true);

  if (btnElement) {
    btnElement.disabled = true;
  }

  const painelAtivo = Boolean(document.getElementById('screen-painel')?.classList.contains('active'));
  const senhaEfetiva = senhaRetry || adminPassword || '';

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (senhaEfetiva) headers['x-admin-password'] = senhaEfetiva;
    const r = await fetch(`${API_URL}/voice-call`, {
      method: 'POST',
      credentials: 'same-origin',
      headers,
      body: JSON.stringify({
        nome: cfg.token,
        setor: 'Recepção',
        destino: 'Sala de Espera',
        senha: senhaEfetiva || undefined
      })
    });
    const dResp = await r.json().catch(() => ({}));
    if ((r.status === 401 || r.status === 403) && !senhaRetry && typeof pedirSenhaGerenteOuAdmin === 'function') {
      if (btnElement) btnElement.disabled = false;
      pedirSenhaGerenteOuAdmin('Emitir aviso sonoro na TV', (s) => {
        adminPassword = s;
        try { sessionStorage.setItem('usf_admin_pwd', s); } catch (_) {}
        solicitarSilencioSalaEspera(btnElement, cfg.token, s);
      });
      return;
    }
    if (!r.ok) {
      throw new Error(dResp.error || `HTTP ${r.status}`);
    }
    _ultimoAvisoSilencioTs = Date.now();
    _ultimoAvisoPorToken[cfg.token] = _ultimoAvisoSilencioTs;
    if (btnElement) {
      setTimeout(() => { btnElement.disabled = false; }, 3000);
    }

    const ehTelaTvLocal = isModoTV() || painelAtivo;
    if (ehTelaTvLocal) {
      if (isMuted) {
        isMuted = false;
        const bm = document.getElementById('btn-mute');
        if (bm) bm.innerHTML = '🔊';
      }
      const numId = Number(dResp?.id) || 0;
      const jaTocou = numId > 0 && _processedVoiceCallIds.has(numId);
      if (numId > 0) _processedVoiceCallIds.add(numId);
      if (!jaTocou) executarAvisoInstitucionalLocal(cfg.token);
    }
    showToast(cfg.toastEnviado);
  } catch (err) {
    if (btnElement) btnElement.disabled = false;
    console.warn('Falha ao enviar aviso institucional à TV:', err?.message || err);
    showToast(err?.message || '❌ Não foi possível enviar o aviso à TV. Verifique a conexão.', true);
  }
}

function getRealCallsFromHistory() {
  return (callHistory || []).filter(h => !(h.profissional || '').startsWith('➡️ Encaminhado'));
}

function solicitarAvisoDocumentosSalaEspera(btnElement) {
  return solicitarSilencioSalaEspera(btnElement, AVISO_DOCUMENTOS_TOKEN);
}

function solicitarAvisoPainelSalaEspera(btnElement) {
  return solicitarSilencioSalaEspera(btnElement, AVISO_PAINEL_TOKEN);
}

function solicitarAvisoPrioridadeSalaEspera(btnElement) {
  return solicitarSilencioSalaEspera(btnElement, AVISO_PRIORIDADE_TOKEN);
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
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    const tocar = () => {
      try {
        tocarNotaWebAudio(ctx, 880, 0.00, 0.25, 'sine', 0.24);
        tocarNotaWebAudio(ctx, 1174.66, 0.15, 0.35, 'sine', 0.26);
      } catch (e) {}
    };
    if (ctx.state === 'suspended') {
      ctx.resume().then(tocar).catch(() => {});
    } else {
      tocar();
    }
  } catch (e) { /* ignore audio errors */ }
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
    if (typeof mesclarOutboxLocalNasFilas === 'function') mesclarOutboxLocalNasFilas();
    if (typeof salvarEspelhoFilaContingencia === 'function') salvarEspelhoFilaContingencia();
    const overviewSearch = document.getElementById('overview-search-input');
    if (overviewSearch && overviewSearch.value.trim()) filtrarVisaoGeralPacientes();
  } catch (e) {
    registrarFalhaRede(e);
    if (typeof restaurarEspelhoFilaContingenciaSeVazio === 'function') restaurarEspelhoFilaContingenciaSeVazio();
    console.error(e);
  }
}
async function loadCurrentCalling() { try { const r = await fetch(`${API_URL}/current-calling`); if (!r.ok) throw new Error(`HTTP ${r.status}`); const d = await r.json(); registrarSucessoRede(); if (typeof d.sistemaPausado === 'boolean' && d.sistemaPausado !== isPausado) { aplicarEstadoPausa(d.sistemaPausado, d.pausaMotivo); } if (typeof processarAvisoSilencioRemoto === 'function') { processarAvisoSilencioRemoto(d.avisoSilencio); } currentCalling = d.current; totalAtendidos = d.totalAtendidos || 0; totalDesistencias = d.totalDesistencias || 0; updateBanners(); updatePainel(); updateStats(); } catch (e) { registrarFalhaRede(e); console.error(e); } }
async function loadHistory() {
  const reqSeq = ++_historySeq;
  try {
    const endpoint = (!isGateAuthenticated && isModoTV()) ? `${API_URL}/tv/history` : `${API_URL}/history`;
    const r = await fetch(endpoint);
    if (!r.ok) return;
    const data = await r.json();
    // Descarta resposta atrasada fora de ordem para impedir regressão de lastSpokenCallId
    if (reqSeq < _historySeq) return;

    callHistory = Array.isArray(data) ? data : [];
    // Ignorar registros de encaminhamento/transferência para controle de voz
    const callsOnly = (callHistory || []).filter(h => !(h.profissional || '').startsWith('➡️ Encaminhado'));
    if (callsOnly.length > 0) {
      const maxId = callsOnly.reduce((acc, item) => Math.max(acc, Number(item.id) || 0), 0);
      if (lastSpokenCallId === null) {
        // 1ª carga da aba: nunca dispara leitura de chamadas antigas; opcionalmente fala apenas 1 recente se acabou de chamar
        const pendingSpeak = _pendingUserCallSpeakUntil > Date.now();
        _pendingUserCallSpeakUntil = 0;
        const newest = callsOnly[0];
        const newestCreatedMs = newest?.created_at ? Date.parse(newest.created_at) : NaN;
        const ehRecente = !Number.isFinite(newestCreatedMs) || (Date.now() - newestCreatedMs <= 15000);
        callsOnly.forEach(item => {
          const cid = Number(item.id) || 0;
          if (cid > 0) _spokenCallIds.add(cid);
        });
        lastSpokenCallId = maxId;
        if (pendingSpeak && newest && ehRecente) {
          speakViaSynthesis(newest.nome, newest.setor, newest.medico);
        }
      } else {
        const prevMaxId = Number(lastSpokenCallId) || 0;
        const agoraMs = Date.now();
        const newCalls = [];
        for (const p of callsOnly) {
          const pid = Number(p.id) || 0;
          if (pid <= prevMaxId || _spokenCallIds.has(pid)) continue;
          const createdMs = p.created_at ? Date.parse(p.created_at) : NaN;
          if (Number.isFinite(createdMs) && (agoraMs - createdMs > 600000)) continue;
          newCalls.push(p);
        }
        // Registra IDs e avança ponteiro de forma monotônica ANTES de sintetizar voz
        callsOnly.forEach(item => {
          const cid = Number(item.id) || 0;
          if (cid > 0) _spokenCallIds.add(cid);
        });
        if (_spokenCallIds.size > 300) {
          const excess = _spokenCallIds.size - 200;
          let count = 0;
          for (const oldId of _spokenCallIds) {
            _spokenCallIds.delete(oldId);
            if (++count >= excess) break;
          }
        }
        lastSpokenCallId = Math.max(prevMaxId, maxId);
        // Ordem cronológica crescente para novas chamadas simultâneas
        newCalls.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
        for (const p of newCalls) {
          speakViaSynthesis(p.nome, p.setor, p.medico);
        }
      }
    } else if (lastSpokenCallId === null) {
      lastSpokenCallId = 0;
    }
    updatePainel();
    renderAllSectorAttended();
    if (typeof renderResumoProfissionais === 'function') renderResumoProfissionais();
  } catch (e) { console.error(e); }
}
async function loadAttended() {
  try {
    const r = await fetch(`${API_URL}/attended`);
    if (!r.ok) return;
    const data = await r.json();
    attendedPatients = Array.isArray(data) ? data : [];
    renderAttended();
  } catch (e) { console.error(e); }
}

// ====== UPDATE UI ======
function updateAll() { updateStats(); updateBadges(); updateQueues(); updateMiniQueues(); updateRecent(); renderAllSectorAttended(); if (typeof renderResumoProfissionais === 'function') renderResumoProfissionais(); }

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
  'Consulta Agendada (Conecta Recife)': { bg: 'rgba(14,165,233,0.16)', color: '#0369a1' },
  'Remoção de Pontos':             { bg: 'rgba(236,72,153,0.16)', color: '#be185d' },
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
  // Exibe a categoria exata da Lei nº 10.048/2000 (1º a 10º) em todos os setores
  const ordOdonto = Number(p.ordem_prioridade_odonto || 99);
  if (ordOdonto >= 1 && ordOdonto <= 10) {
    const labelOdonto = p.tipo_prioridade ? escapeText(p.tipo_prioridade) : `Prioridade (${ordOdonto}º)`;
    const bgOdonto = ordOdonto === 1
      ? 'background:linear-gradient(135deg,#be123c,#e11d48);'
      : 'background:linear-gradient(135deg,#6d28d9,#7c3aed);';
    return `<span class="badge-prioridade-idade" style="${bgOdonto}" title="Atendimento Prioritário Legal — Lei nº 10.048/2000">⭐ ${labelOdonto}</span>`;
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

const _lastQueueHtmlCache = {};
function setQueueHtmlPreservingScroll(el, html) {
  if (!el) return false;
  const key = el.id || '';
  if (key && _lastQueueHtmlCache[key] === html) {
    return false;
  }
  const prevWrap = el.querySelector('.fila-table-wrap');
  const prevElTop = el.scrollTop;
  const prevElLeft = el.scrollLeft;
  const prevWrapTop = prevWrap ? prevWrap.scrollTop : 0;
  const prevWrapLeft = prevWrap ? prevWrap.scrollLeft : 0;

  el.innerHTML = html;
  if (key) _lastQueueHtmlCache[key] = html;

  el.scrollTop = prevElTop;
  el.scrollLeft = prevElLeft;
  const nextWrap = el.querySelector('.fila-table-wrap');
  if (nextWrap) {
    nextWrap.scrollTop = prevWrapTop;
    nextWrap.scrollLeft = prevWrapLeft;
  }
  return true;
}

function renderQueueItems(containerId, setor, filterProfissional) {
  const el = document.getElementById(containerId); if (!el) return;
  let items = (queues[setor] || []).filter(p => p.status !== 'atendido' && p.status !== 'desistencia');
  if (filterProfissional) {
    // Inclui pacientes destinados ao profissional selecionado OU à fila geral do setor (sem profissional específico)
    items = items.filter(p => !p.profissional || p.profissional === filterProfissional);
  }
  if (!items.length) {
    setQueueHtmlPreservingScroll(el, '<div class="empty-state"><div class="es-icon">\u2705</div><p>Fila vazia</p></div>');
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
    let chamadoTempoBadge = '';
    if (p.status === 'chamado' && (p.updated_at || p.created_at)) {
      const minsChamado = Math.floor((Date.now() - new Date(p.updated_at || p.created_at).getTime()) / 60000);
      if (minsChamado >= 5) {
        chamadoTempoBadge = `<div style="margin-top:3px;"><span style="display:inline-block;padding:2px 6px;border-radius:6px;background:rgba(239,68,68,0.14);color:#b91c1c;border:1px solid rgba(239,68,68,0.35);font-size:10.5px;font-weight:900;" title="Paciente chamado sem comparecimento até o momento">⏱️ Chamado há ${minsChamado} min</span></div>`;
      }
    }
    const intercorrenciaBadge = renderIntercorrenciaAcolhimentoBadge(p);
    const equipeBadge = renderEquipePacienteBadge(p);
    const isInterc = Boolean(p.is_intercorrencia_acolhimento) || p.tipo_atendimento === 'Intercorrência (Acolhimento)';
    const tipoLabel = (isInterc && p.tipo_atendimento === 'Intercorrência (Acolhimento)') ? '' : getTipoAtendimentoBadge(p.tipo_atendimento);
    const profLabel = p.profissional
      ? `<div style="font-size:12px;font-weight:800;color:var(--blue-dark);margin-bottom:2px;">👨‍⚕️ ${escapeText(p.profissional)}</div>`
      : `<div style="font-size:11px;font-weight:700;color:var(--gray-600);margin-bottom:2px;">📋 Fila Geral (${escapeText(setor)})</div>`;
    const condBadges = renderCondicoesBadges(p.condicoes_especiais);
    const qrBtn = `<button type="button" class="btn-qr btn-icon-compact" onclick="event.stopPropagation();showQrModalById(${p.id})" title="Ver QR Code" aria-label="Ver QR Code de ${escapeText(p.nome)}">📱</button>`;
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

    const dragHandle = isManagerOrAdmin()
      ? `<span class="drag-handle" title="Arraste para reordenar" style="margin-right:4px;">☰</span>`
      : '';

    const originBadge = p.origem_transferencia
      ? `<div style="font-size:10.5px;color:#475569;margin-top:3px;font-weight:700;">🔙 de: ${escapeText(p.origem_transferencia)}</div>`
      : '';

    const statusBadge = `<span class="queue-status ${p.status==='chamado'?'status-calling':'status-waiting'}">${p.status==='chamado'?'📢 Chamando':'Aguardando'}</span>`;
    const ausenteBadge = (p.ausente_temporario && p.status === 'aguardando')
      ? `<span style="display:inline-block;padding:2px 7px;border-radius:999px;background:#fef3c7;color:#92400e;border:1px solid #fcd34d;font-size:10px;font-weight:900;" title="Não respondeu à chamada anterior — clique em Rechamar quando retornar">⏸️ Ausente 1ª chamada</span>`
      : '';
    const tubosBloco = (!document.body.classList.contains('modo-tv') && typeof renderBadgesTubosColeta === 'function')
      ? renderBadgesTubosColeta(p, setor)
      : '';
    const tubosBtn = (!document.body.classList.contains('modo-tv') && setor === 'Téc. Enfermagem')
      ? `<button type="button" class="btn-transfer-sector" style="background:rgba(15,118,110,0.12);border-color:rgba(15,118,110,0.35);color:#0f766e;" onclick="event.stopPropagation();abrirModalTubosPaciente(${p.id})" title="Definir / visualizar tubos de coleta">🧪 Tubos</button>`
      : '';
    const ehPrioAtivo = p.prioridade === 'prioritario' || Number(p.nivel_prioridade) <= 2;
    const renameBtn = isManagerOrAdmin()
      ? `<button type="button" class="btn-inline-mgr btn-inline-mgr--edit" onclick="event.stopPropagation();abrirModalEditarNomeFila(${p.id},'${safeNome}')" title="Editar nome do paciente na fila (Gerente/Admin)" aria-label="Editar nome de ${escapeText(p.nome)}">✏️</button>`
      : '';
    const prioEditBtn = (isManagerOrAdmin() && p.status !== 'atendido' && p.status !== 'desistencia')
      ? `<button type="button" class="btn-inline-mgr btn-inline-mgr--prio${ehPrioAtivo ? ' ativo' : ''}" onclick="event.stopPropagation();abrirModalPrioridadePorId(${p.id})" title="Alterar ou acrescentar prioridade na fila (Gerente/Admin)" aria-label="Alterar prioridade de ${escapeText(p.nome)}">${ehPrioAtivo ? '⭐ Prio' : '+ ⭐'}</button>`
      : '';

    const actionButtons = isManagerOrAdmin() ? `
      <span class="fila-reorder-pill">
        <button type="button" class="btn-reorder-arrow" title="Subir uma posição" aria-label="Subir ${escapeText(p.nome)} uma posição" onclick="event.stopPropagation();movePatientArrow(${p.id},'${setor}','up')">↑</button>
        <button type="button" class="btn-reorder-arrow" title="Descer uma posição" aria-label="Descer ${escapeText(p.nome)} uma posição" onclick="event.stopPropagation();movePatientArrow(${p.id},'${setor}','down')">↓</button>
        <button type="button" class="btn-reorder-pos btn-icon-compact" title="Ir para posição específica" aria-label="Mover ${escapeText(p.nome)} para posição específica" onclick="event.stopPropagation();openPositionModal(${p.id},'${safeNome}','${setor}')">🔢</button>
      </span>
      <button type="button" class="btn-transfer-sector" title="Encaminhar para outro setor" onclick="event.stopPropagation();openTransferModal(${p.id},'${safeNome}','${setor}')">↗️ Encaminhar</button>
      <button type="button" class="btn-context-menu" title="Mais ações gerenciais" aria-label="Mais ações para ${escapeText(p.nome)}" onclick="event.stopPropagation();openContextMenu(event,${p.id},'${safeNome}','${setor}')">⋮</button>
      <span class="fila-danger-group">
        <button type="button" class="btn-danger btn-icon-compact" onclick="event.stopPropagation();removePatient(${p.id},'${safeNome}')" title="Marcar como Desistência" aria-label="Marcar desistência para ${escapeText(p.nome)}">🚶</button>
        ${isAdmin ? `<button type="button" class="btn-danger btn-icon-compact" style="background:rgba(0,0,0,0.06);color:var(--gray-600);" onclick="event.stopPropagation();deletePatientPermanently(${p.id},'${safeNome}')" title="Excluir Permanentemente" aria-label="Excluir permanentemente ${escapeText(p.nome)}">🔥</button>` : ''}
      </span>
    ` : `
      <span class="fila-reorder-pill">
        <button type="button" class="btn-reorder-arrow" title="Subir uma posição na fila" aria-label="Subir ${escapeText(p.nome)} uma posição" onclick="event.stopPropagation();movePatientArrow(${p.id},'${setor}','up')">↑</button>
        <button type="button" class="btn-reorder-arrow" title="Descer uma posição na fila" aria-label="Descer ${escapeText(p.nome)} uma posição" onclick="event.stopPropagation();movePatientArrow(${p.id},'${setor}','down')">↓</button>
        <button type="button" class="btn-reorder-pos btn-icon-compact" onclick="event.stopPropagation();openPositionModal(${p.id},'${safeNome}','${setor}')" title="Mudar posição na fila" aria-label="Mudar posição de ${escapeText(p.nome)} na fila">🔢</button>
      </span>
      <button type="button" class="btn-transfer-sector" onclick="event.stopPropagation();abrirModalEncaminharPublico(${p.id}, '${p.nome.replace(/'/g,"\\'")}', '${setor}')" title="Encaminhar para outro setor">↗️ Encaminhar</button>
    `;

    const nivelCls = Number(p.nivel_prioridade) === 1
      ? 'row-prio-nivel1'
      : ((Number(p.nivel_prioridade) === 2 || p.prioridade === 'prioritario') ? 'row-prio-nivel2' : '');

    const rowCls = [
      'queue-item',
      p.status === 'chamado' ? 'calling' : '',
      isNextUp ? 'row-next-up' : '',
      isInterc ? 'row-intercorrencia' : '',
      nivelCls
    ].filter(Boolean).join(' ');

    return `<tr class="${rowCls}" data-id="${p.id}" data-draggable="${isManagerOrAdmin() && p.status === 'aguardando'}">
      <td class="fila-pos-cell">
        <div style="display:flex;align-items:center;gap:4px;">
          ${p.status === 'aguardando' ? dragHandle : ''}
          <span class="fila-pos-badge" style="background:${p.status==='chamado'?'#b8860b':getColor(setor)}">${posLabel}</span>
          <span style="font-size:12px;font-weight:800;color:#475569;" title="Horário de chegada na recepção">🕐 ${p.horario || '—'}</span>
        </div>
        ${nextUpBadge ? `<div style="margin-top:4px;">${nextUpBadge}</div>` : ''}
        ${(SETORES_HORARIO_MARCADO.includes(setor) && p.horario_marcado) ? `<div style="margin-top:3px;"><span style="display:inline-block;padding:2px 6px;border-radius:6px;background:rgba(139,92,246,0.14);color:#5b21b6;border:1px solid rgba(139,92,246,0.35);font-size:11px;font-weight:900;" title="Horário marcado">📅 Marcado: ${escapeText(p.horario_marcado)}</span></div>` : ''}
        ${waitBadge ? `<div style="margin-top:4px;">${waitBadge}</div>` : ''}
        ${chamadoTempoBadge}
      </td>
      <td>
        <div class="fila-paciente-nome">
          <span class="nome-texto">${escapeText(p.nome)}</span>
          ${renameBtn}
          ${prioBadge}
          ${prioEditBtn}
        </div>
        <div class="fila-paciente-sub">
          ${equipeBadge || '<span style="font-size:11px;color:#94a3b8;font-weight:700;">Sem equipe informada</span>'}
          ${condBadges}
        </div>
        ${tubosBloco}
        ${typeof renderPreviaReceitaBadgeLinha === 'function' ? renderPreviaReceitaBadgeLinha(p) : ''}
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
          ${ausenteBadge}
        </div>
        ${originBadge}
      </td>
      <td style="text-align:right;">
        <div class="fila-actions-cell">
          ${p.status === 'chamado' ? `<button class="btn-call-next" style="padding:5px 10px;font-size:11.5px;border-radius:8px;background:linear-gradient(135deg,#0284c7,#0369a1);color:#fff;border:none;font-weight:800;cursor:pointer;" title="Rechamar paciente no Painel e Voz" onclick="event.stopPropagation();rechamarPacienteNaFila(${p.id},'${safeNome}','${setor}','${escapeText(p.medico || '').replace(/'/g, "\\'")}')">🔊 Rechamar</button><button type="button" style="padding:5px 9px;font-size:11.5px;border-radius:8px;background:#fef3c7;color:#92400e;border:1px solid #fcd34d;font-weight:800;cursor:pointer;" title="Paciente não compareceu agora — liberar o próximo sem cancelar" onclick="event.stopPropagation();marcarAusenteTemporarioFila(${p.id},'${safeNome}')">⏸️ Ausente</button>` : ''}
          ${(p.ausente_temporario && p.status === 'aguardando') ? `<button class="btn-call-next" style="padding:5px 9px;font-size:11.5px;border-radius:8px;background:linear-gradient(135deg,#0284c7,#0369a1);color:#fff;border:none;font-weight:800;cursor:pointer;" title="Rechamar paciente que voltou" onclick="event.stopPropagation();rechamarPacienteNaFila(${p.id},'${safeNome}','${setor}','${escapeText(p.medico || '').replace(/'/g, "\\'")}')">🔊 Rechamar</button>` : ''}
          ${tubosBtn}
          ${typeof renderBotaoPreviaReceitaLinha === 'function' ? renderBotaoPreviaReceitaLinha(p, setor) : ''}
          ${typeof renderBotoesFormulariosLinha === 'function' ? renderBotoesFormulariosLinha(p, setor) : ''}
          ${radarBtn}
          ${ actionButtons }
          ${qrBtn}
        </div>
      </td>
    </tr>`;
  }).join('');

  const html = `<div class="fila-table-wrap">
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

  const changed = setQueueHtmlPreservingScroll(el, html);

  // Inicializa D&D se for fila de setor e gerente/admin ativo
  if (isSectorQueue && isManagerOrAdmin()) {
    if (changed || !_sortableInstances[containerId]) initSortable(containerId, setor);
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
    if (!items.length) { setQueueHtmlPreservingScroll(el, '<div class="empty-state" style="padding:18px;"><div class="es-icon">✅</div><p>Fila vazia</p></div>'); return; }

    let waitCounter = 0;
    const rowsHtml = items.map((p) => {
      const posLabel = p.status === 'chamado' ? '📢' : `#${++waitCounter}`;
      const isNextUp = p.status === 'aguardando' && waitCounter === 1;
      const nextUpBadge = isNextUp ? '<span class="badge-proximo-fila">👉 Próximo</span>' : '';
      const safeNome = p.nome.replace(/'/g, "\\'").replace(/"/g, '&quot;');
      const prioBadge = renderPrioridadeIdadeBadge(p);
      const waitBadge = renderEsperaNormalBadge(p);
    let chamadoTempoBadge = '';
    if (p.status === 'chamado' && (p.updated_at || p.created_at)) {
      const minsChamado = Math.floor((Date.now() - new Date(p.updated_at || p.created_at).getTime()) / 60000);
      if (minsChamado >= 5) {
        chamadoTempoBadge = `<div style="margin-top:3px;"><span style="display:inline-block;padding:2px 6px;border-radius:6px;background:rgba(239,68,68,0.14);color:#b91c1c;border:1px solid rgba(239,68,68,0.35);font-size:10.5px;font-weight:900;" title="Paciente chamado sem comparecimento até o momento">⏱️ Chamado há ${minsChamado} min</span></div>`;
      }
    }
      const intercorrenciaBadge = renderIntercorrenciaAcolhimentoBadge(p);
      const equipeBadge = renderEquipePacienteBadge(p);
      const isInterc = Boolean(p.is_intercorrencia_acolhimento) || p.tipo_atendimento === 'Intercorrência (Acolhimento)';
      const tipoLabel = (isInterc && p.tipo_atendimento === 'Intercorrência (Acolhimento)') ? '' : getTipoAtendimentoBadge(p.tipo_atendimento);
      const profLabel = p.profissional
        ? `<div style="font-size:12px;font-weight:800;color:var(--blue-dark);margin-bottom:2px;">👨‍⚕️ ${escapeText(p.profissional)}</div>`
        : `<div style="font-size:11px;font-weight:700;color:var(--gray-600);margin-bottom:2px;">${cfg.icon || '📋'} ${escapeText(s)}</div>`;
      const condBadges = renderCondicoesBadges(p.condicoes_especiais);
      const qrBtn = `<button type="button" class="btn-qr btn-icon-compact" onclick="event.stopPropagation();showQrModalById(${p.id})" title="Ver QR Code" aria-label="Ver QR Code de ${escapeText(p.nome)}">📱</button>`;
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

      const removeBtn = isManagerOrAdmin() ? `
        <span class="fila-danger-group">
          <button type="button" class="btn-danger btn-icon-compact" onclick="event.stopPropagation();removePatient(${p.id},'${p.nome.replace(/'/g,"\\'")}')" title="Marcar como Desistência" aria-label="Marcar desistência para ${escapeText(p.nome)}">🚶</button>
          ${isAdmin ? `<button type="button" class="btn-danger btn-icon-compact" style="background:rgba(0,0,0,0.06);color:var(--gray-600);" onclick="event.stopPropagation();deletePatientPermanently(${p.id},'${p.nome.replace(/'/g,"\\'")}')" title="Excluir Permanentemente" aria-label="Excluir permanentemente ${escapeText(p.nome)}">🔥</button>` : ''}
        </span>
      ` : '';

      let presencaHtml = '';
      let presencaBtn = '';
      if (['Médico','Enfermagem','Odontologia','Téc. Enfermagem'].includes(s)) {
        if (p.presenca_confirmada) {
          presencaHtml = '<span class="presenca-badge presenca-confirmada" title="Presença confirmada na recepção">🟢 PRESENTE</span>';
        } else if (p.status === 'aguardando') {
          presencaBtn = `<button type="button" class="btn-confirmar-presenca" onclick="event.stopPropagation();confirmarPresenca(${p.id},'${p.nome.replace(/'/g,"\\'")}')" title="Confirmar presença na recepção">✅ Presença</button>`;
        }
      }

      const transferBtn = `
        <span class="fila-reorder-pill">
          <button type="button" class="btn-reorder-arrow" title="Subir uma posição" aria-label="Subir ${escapeText(p.nome)} uma posição" onclick="event.stopPropagation();movePatientArrow(${p.id},'${s}','up')">↑</button>
          <button type="button" class="btn-reorder-arrow" title="Descer uma posição" aria-label="Descer ${escapeText(p.nome)} uma posição" onclick="event.stopPropagation();movePatientArrow(${p.id},'${s}','down')">↓</button>
          <button type="button" class="btn-reorder-pos btn-icon-compact" onclick="event.stopPropagation();openPositionModal(${p.id},'${safeNome}','${s}')" title="Ir para posição específica" aria-label="Mover ${escapeText(p.nome)} para posição específica">🔢</button>
        </span>
        <button type="button" class="btn-transfer-sector" onclick="event.stopPropagation();abrirModalEncaminharPublico(${p.id}, '${p.nome.replace(/'/g,"\\'")}', '${s}')" title="Encaminhar para outro setor">↗️ Encaminhar</button>
      `;

      const originBadge = p.origem_transferencia
        ? `<div style="font-size:10.5px;color:#475569;margin-top:3px;font-weight:700;">🔙 de: ${escapeText(p.origem_transferencia)}</div>`
        : '';

      const statusBadge = `<span class="queue-status ${p.status==='chamado'?'status-calling':'status-waiting'}">${p.status==='chamado'?'📢 Chamando':'Aguardando'}</span>`;
      const ausenteBadgeMini = (p.ausente_temporario && p.status === 'aguardando')
        ? `<span style="display:inline-block;padding:2px 6px;border-radius:999px;background:#fef3c7;color:#92400e;border:1px solid #fcd34d;font-size:10px;font-weight:900;">⏸️ Ausente</span>`
        : '';
      const tubosBlocoMini = (!document.body.classList.contains('modo-tv') && typeof renderBadgesTubosColeta === 'function')
        ? renderBadgesTubosColeta(p, s)
        : '';
      const tubosBtnMini = (!document.body.classList.contains('modo-tv') && s === 'Téc. Enfermagem')
        ? `<button type="button" class="btn-transfer-sector" style="background:rgba(15,118,110,0.12);border-color:rgba(15,118,110,0.35);color:#0f766e;" onclick="event.stopPropagation();abrirModalTubosPaciente(${p.id})" title="Definir tubos de coleta">🧪 Tubos</button>`
        : '';
      const ehPrioMini = p.prioridade === 'prioritario' || Number(p.nivel_prioridade) <= 2;
      const renameBtnMini = isManagerOrAdmin()
        ? `<button type="button" class="btn-inline-mgr btn-inline-mgr--edit" onclick="event.stopPropagation();abrirModalEditarNomeFila(${p.id},'${safeNome}')" title="Editar nome do paciente na fila (Gerente/Admin)" aria-label="Editar nome de ${escapeText(p.nome)}">✏️</button>`
        : '';
      const prioEditBtnMini = isManagerOrAdmin()
        ? `<button type="button" class="btn-inline-mgr btn-inline-mgr--prio${ehPrioMini ? ' ativo' : ''}" onclick="event.stopPropagation();abrirModalPrioridadePorId(${p.id})" title="Alterar ou acrescentar prioridade na fila (Gerente/Admin)" aria-label="Alterar prioridade de ${escapeText(p.nome)}">${ehPrioMini ? '⭐ Prio' : '+ ⭐'}</button>`
        : '';

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
          ${(SETORES_HORARIO_MARCADO.includes(s) && p.horario_marcado) ? `<div style="margin-top:3px;"><span style="display:inline-block;padding:2px 6px;border-radius:6px;background:rgba(139,92,246,0.14);color:#5b21b6;border:1px solid rgba(139,92,246,0.35);font-size:11px;font-weight:900;" title="Horário marcado">📅 Marcado: ${escapeText(p.horario_marcado)}</span></div>` : ''}
          ${waitBadge ? `<div style="margin-top:4px;">${waitBadge}</div>` : ''}
        ${chamadoTempoBadge}
        </td>
        <td>
          <div class="fila-paciente-nome">
            <span class="nome-texto">${escapeText(p.nome)}</span>
            ${renameBtnMini}
            ${prioBadge}
            ${prioEditBtnMini}
          </div>
          <div class="fila-paciente-sub">
            ${equipeBadge || '<span style="font-size:11px;color:#94a3b8;font-weight:700;">Sem equipe informada</span>'}
            ${condBadges}
          </div>
          ${tubosBlocoMini}
          ${typeof renderPreviaReceitaBadgeLinha === 'function' ? renderPreviaReceitaBadgeLinha(p) : ''}
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
            ${ausenteBadgeMini}
          </div>
          ${originBadge}
        </td>
        <td style="text-align:right;">
          <div class="fila-actions-cell">
            ${presencaBtn}
            ${tubosBtnMini}
            ${typeof renderBotaoPreviaReceitaLinha === 'function' ? renderBotaoPreviaReceitaLinha(p, s) : ''}
            ${radarBtn}
            ${transferBtn}
            ${qrBtn}
            ${removeBtn}
          </div>
        </td>
      </tr>`;
    }).join('');

    const html = `<div class="fila-table-wrap">
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
    setQueueHtmlPreservingScroll(el, html);
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
    const horaExibida = p.created_at
      ? safeDate(p.created_at).toLocaleTimeString('pt-BR', { timeZone: 'America/Recife', hour: '2-digit', minute: '2-digit' })
      : (p.horario_chamada || '--:--');
      const safePainelNomeJs = escapeText(String(p.nome || '')).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const safePainelSetorJs = escapeText(String(p.setor || '')).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const safePainelMedJs = escapeText(String(p.medico || '')).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const ocultarBotaoVozTv = !isGateAuthenticated && isModoTV();
      return `<div class="painel-fids-row ${i === 0 ? 'is-latest' : ''}">
      <div class="painel-fids-time">${escapeText(horaExibida)}</div>
      <div class="painel-fids-name">${escapeText(p.nome)}${prioBadge}</div>
      <div class="painel-fids-dest">${escapeText(destino)}${profText ? `<small>${escapeText(profText)}</small>` : ''}</div>
      <div style="text-align:center;">
        ${ocultarBotaoVozTv ? '' : `<button class="btn btn-ghost" onclick="speakViaSynthesis('${safePainelNomeJs}','${safePainelSetorJs}','${safePainelMedJs}')" style="padding:5px 8px;font-size:13px;border-radius:8px;" title="Chamar novamente">🔊</button>`}
      </div>
    </div>`;
  }).join('');
}

// ====== SECTOR ATTENDED HISTORY & METAS EDITÁVEIS DO DIA ======
let metasDiaConfig = {
  padrao: {
    manha: 8,
    tarde: 5,
    intercorrencias: 4,
    modo: 'turno',
    meta_fixa: 13,
    tipo_dia: 'Padrão (8 Manhã · 5 Tarde)'
  },
  por_profissional: {}
};

function obterTurnoAtualRecife() {
  try {
    const h = parseInt(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Recife',
      hour: '2-digit',
      hour12: false
    }).format(new Date()), 10);
    return Number.isFinite(h) && h >= 12 ? 'tarde' : 'manha';
  } catch {
    return new Date().getHours() >= 12 ? 'tarde' : 'manha';
  }
}

function obterMetaProfissionalDia(setor, profNome) {
  const pad = metasDiaConfig?.padrao || { manha: 8, tarde: 5, intercorrencias: 4, modo: 'turno', meta_fixa: 13, tipo_dia: 'Padrão (8 Manhã · 5 Tarde)' };
  const custom = (profNome && metasDiaConfig?.por_profissional && metasDiaConfig.por_profissional[profNome]) || null;
  const fonte = custom || pad;
  const turnoAtual = obterTurnoAtualRecife();
  const modo = fonte.modo === 'fixo' ? 'fixo' : 'turno';
  const manha = Math.max(1, parseInt(fonte.manha, 10) || 8);
  const tarde = Math.max(1, parseInt(fonte.tarde, 10) || 5);
  const metaFixa = Math.max(1, parseInt(fonte.meta_fixa, 10) || (manha + tarde));
  const intercorrencias = Math.max(0, Number.isFinite(parseInt(fonte.intercorrencias, 10)) ? parseInt(fonte.intercorrencias, 10) : 4);
  const metaAgendados = modo === 'fixo' ? metaFixa : (turnoAtual === 'tarde' ? tarde : manha);
  const tipoDia = fonte.tipo_dia || (modo === 'fixo' ? `Dia Especial (${metaFixa})` : `Padrão (${manha}M · ${tarde}T)`);
  const turnoLabel = turnoAtual === 'tarde' ? 'Tarde' : 'Manhã';
  const labelResumo = modo === 'fixo'
    ? `🎯 Meta ${tipoDia}: ${metaAgendados} Agend. | Limite: ${intercorrencias} Interc.`
    : `📊 Meta (${turnoLabel}): ${metaAgendados} Agend. (${manha}M / ${tarde}T) | Limite: ${intercorrencias} Interc.`;
  return {
    metaAgendados,
    limiteIntercorrencias: intercorrencias,
    manha,
    tarde,
    metaFixa,
    modo,
    tipoDia,
    turnoAtual,
    labelResumo,
    ehCustom: Boolean(custom)
  };
}

let _loadingMetasDia = false;
async function loadMetasDiaConfig() {
  if (_loadingMetasDia) return;
  _loadingMetasDia = true;
  try {
    const r = await fetch(`${API_URL}/config/metas-dia`);
    if (r.ok) {
      const data = await r.json();
      if (data && data.padrao) {
        metasDiaConfig = {
          padrao: data.padrao,
          por_profissional: data.por_profissional && typeof data.por_profissional === 'object' ? data.por_profissional : {}
        };
        if (typeof renderResumoProfissionais === 'function') renderResumoProfissionais();
      }
    }
  } catch (e) {
    /* fallback mantém padrão 8 Manhã / 5 Tarde */
  } finally {
    _loadingMetasDia = false;
  }
}

function isRegistroRechamadaOuEncaminhamento(rec) {
  const prof = String(rec?.profissional || '');
  return prof.startsWith('🔊 Rechamar') || prof.startsWith('➡️ Encaminhado');
}

function obterAtendimentosUnicosSetor(setor, profFiltro) {
  const seen = new Set();
  const out = [];
  for (const p of callHistory || []) {
    if (p.setor !== setor) continue;
    if (isRegistroRechamadaOuEncaminhamento(p)) continue;
    if (profFiltro) {
      const matchProf = p.profissional === profFiltro || (p.medico && p.medico.includes(profFiltro));
      if (!matchProf) continue;
    }
    const key = p.patient_id ? `id:${p.patient_id}` : `n:${String(p.nome || '').trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function isPacienteIntercorrenciaClinica(p) {
  if (!p) return false;
  if (p.is_intercorrencia_acolhimento === true) return true;
  if (p.etapa_fluxo === 'encaminhado_intercorrencia') return true;
  const tipo = String(p.tipo_atendimento || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (tipo.includes('intercorrencia')) return true;
  return false;
}

function calcularResumoProfissionalDia(setor, profFiltro) {
  const filaRaw = (queues[setor] || []).filter(p => p.status !== 'atendido' && p.status !== 'desistencia');
  const filaFiltrada = profFiltro
    ? filaRaw.filter(p => p.profissional === profFiltro || (!p.profissional && setor === 'Odontologia') || (p.medico && p.medico.includes(profFiltro)))
    : filaRaw;
  const aguardando = filaFiltrada.filter(p => p.status === 'aguardando');
  const chamando = filaFiltrada.filter(p => p.status === 'chamado');
  const atendidos = obterAtendimentosUnicosSetor(setor, profFiltro);

  const uniqueDay = new Map();
  atendidos.forEach(a => {
    const key = a.patient_id ? `id:${a.patient_id}` : `n:${String(a.nome || '').trim().toLowerCase()}`;
    uniqueDay.set(key, a);
  });
  filaFiltrada.forEach(p => {
    const key = p.id ? `id:${p.id}` : `n:${String(p.nome || '').trim().toLowerCase()}`;
    const prev = uniqueDay.get(key) || {};
    uniqueDay.set(key, { ...prev, ...p });
  });

  let agendados = 0;
  let intercorrencias = 0;
  let intercAcolhimento = 0;
  let intercFila = 0;
  uniqueDay.forEach(p => {
    if (isPacienteIntercorrenciaClinica(p)) {
      intercorrencias++;
      const orig = String(p.origem_transferencia || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (p.is_intercorrencia_acolhimento || p.etapa_fluxo === 'encaminhado_intercorrencia' || orig.includes('acolhimento')) {
        intercAcolhimento++;
      } else {
        intercFila++;
      }
    } else {
      agendados++;
    }
  });

  return {
    faltam: aguardando.length,
    chamando: chamando.length,
    atendidos: atendidos.length,
    agendados,
    intercorrencias,
    intercAcolhimento,
    intercFila,
    totalDia: uniqueDay.size
  };
}

function renderResumoProfissionais() {
  SETORES_HORARIO_MARCADO.forEach(setor => {
    const cfg = SECTOR_CONFIG[setor];
    if (!cfg) return;
    const container = document.getElementById('resumo-prof-' + cfg.key);
    if (!container) return;

    const profSelecionado = setor === 'Odontologia'
      ? (cfg.profissionais?.[0] || 'Dra. Juliana Cavalcante')
      : (sectorFilters[cfg.key] || null);
    const resumo = calcularResumoProfissionalDia(setor, profSelecionado);
    const meta = obterMetaProfissionalDia(setor, profSelecionado);
    const limiteAgend = meta.metaAgendados;
    const limiteInterc = meta.limiteIntercorrencias;
    const tituloProf = profSelecionado || `Todos de ${setor}`;

    const pctAgend = Math.min(100, Math.round((resumo.agendados / Math.max(1, limiteAgend)) * 100));
    const pctInterc = limiteInterc > 0 ? Math.min(100, Math.round((resumo.intercorrencias / limiteInterc) * 100)) : (resumo.intercorrencias > 0 ? 100 : 0);
    const corInterc = resumo.intercorrencias > limiteInterc
      ? '#dc2626'
      : resumo.intercorrencias >= Math.max(1, limiteInterc - 1)
        ? '#d97706'
        : '#16a34a';
    const bgInterc = resumo.intercorrencias > limiteInterc
      ? 'background:#fef2f2;border-color:#fca5a5;'
      : resumo.intercorrencias >= Math.max(1, limiteInterc - 1)
        ? 'background:#fffbeb;border-color:#fcd34d;'
        : 'background:#f0fdf4;border-color:#bbf7d0;';

    let alertHtml = '';
    let miniStripHtml = '';

    if (profSelecionado) {
      if (resumo.intercorrencias > limiteInterc) {
        alertHtml = `<div class="prof-alert-banner prof-alert-danger">🚨 <span>LIMITE EXCEDIDO: <strong>${escapeText(profSelecionado)}</strong> já possui <strong>${resumo.intercorrencias} intercorrências</strong> hoje (limite previsto: ${limiteInterc}).</span></div>`;
      } else if (limiteInterc > 0 && resumo.intercorrencias === limiteInterc) {
        alertHtml = `<div class="prof-alert-banner">⚠️ <span>ATENÇÃO: <strong>${escapeText(profSelecionado)}</strong> atingiu o limite de <strong>${limiteInterc} intercorrências</strong> hoje.</span></div>`;
      }
    } else if (cfg.profissionais && cfg.profissionais.length > 1) {
      const excedidos = [];
      miniStripHtml = `<div class="prof-mini-strip">` + cfg.profissionais.map(pNome => {
        const rp = calcularResumoProfissionalDia(setor, pNome);
        const mp = obterMetaProfissionalDia(setor, pNome);
        let cls = '';
        if (rp.intercorrencias > mp.limiteIntercorrencias) {
          cls = 'over-limit';
          excedidos.push(`${pNome} (${rp.intercorrencias})`);
        } else if (mp.limiteIntercorrencias > 0 && rp.intercorrencias === mp.limiteIntercorrencias) {
          cls = 'at-limit';
        }
        return `<button type="button" class="prof-mini-pill ${cls}" onclick="filterSector('${cfg.key}','${pNome.replace(/'/g, "\\'")}')" title="Filtrar ${escapeText(pNome)}">👤 ${escapeText(pNome)} · Agend: ${rp.agendados}/${mp.metaAgendados} · Interc: ${rp.intercorrencias}/${mp.limiteIntercorrencias}</button>`;
      }).join('') + `</div>`;
      if (excedidos.length > 0) {
        alertHtml = `<div class="prof-alert-banner prof-alert-danger">🚨 <span>Acima do limite de intercorrências hoje: <strong>${escapeText(excedidos.join(', '))}</strong></span></div>`;
      }
    }

    const alvoMetaBtn = (profSelecionado || '__PADRAO__').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const subAgendText = meta.modo === 'fixo'
      ? `${escapeText(meta.tipoDia)} · Meta editável`
      : `Manhã: ${meta.manha} · Tarde: ${meta.tarde} (turno ${meta.turnoAtual === 'tarde' ? 'tarde' : 'manhã'})`;

    container.innerHTML = `
      <div class="prof-summary-card">
        <div class="prof-summary-head">
          <div class="prof-summary-title">
            <span>📊 Resumo do Dia — ${escapeText(tituloProf)}</span>
          </div>
          <div class="prof-summary-head-right">
            <span class="prof-summary-meta-pill">${escapeText(meta.labelResumo)}</span>
            <button type="button" class="btn-editar-meta-dia" onclick="abrirModalConfigMetasDia('${alvoMetaBtn}')" title="Editar meta de agendados e limite de intercorrências (Gerente/Admin)">⚙️ Editar Meta</button>
          </div>
        </div>
        <div class="prof-kpi-grid">
          <div class="prof-kpi-box" style="background:#f8fafc;">
            <div class="prof-kpi-label">⏳ Faltam na Fila</div>
            <div class="prof-kpi-val" style="color:#1d4ed8;">${resumo.faltam}</div>
            <div class="prof-kpi-sub">${resumo.chamando > 0 ? `+${resumo.chamando} chamando agora` : 'Nenhum no consultório'}</div>
          </div>
          <div class="prof-kpi-box" style="background:#f0fdf4;border-color:#bbf7d0;">
            <div class="prof-kpi-label">✅ Atendidos Hoje</div>
            <div class="prof-kpi-val" style="color:#15803d;">${resumo.atendidos}</div>
            <div class="prof-kpi-sub">Pacientes únicos (sem rechamada)</div>
          </div>
          <div class="prof-kpi-box" style="background:#eff6ff;border-color:#bfdbfe;">
            <div class="prof-kpi-label">📅 Agendados</div>
            <div class="prof-kpi-val" style="color:#1e40af;">${resumo.agendados} <span style="font-size:13px;color:#64748b;font-weight:800;">/ ${limiteAgend}</span></div>
            <div class="prof-progress-track"><div class="prof-progress-fill" style="width:${pctAgend}%;background:#2563eb;"></div></div>
            <div class="prof-kpi-sub">${subAgendText}</div>
          </div>
          <div class="prof-kpi-box" style="${bgInterc}">
            <div class="prof-kpi-label">🚨 Intercorrências</div>
            <div class="prof-kpi-val" style="color:${corInterc};">${resumo.intercorrencias} <span style="font-size:13px;color:#64748b;font-weight:800;">/ ${limiteInterc}</span></div>
            <div class="prof-progress-track"><div class="prof-progress-fill" style="width:${pctInterc}%;background:${corInterc};"></div></div>
            <div class="prof-kpi-sub">Acolh.: ${resumo.intercAcolhimento} · Direto: ${resumo.intercFila}</div>
          </div>
          <div class="prof-kpi-box" style="background:#faf5ff;border-color:#ddd6fe;">
            <div class="prof-kpi-label">📋 Total do Dia</div>
            <div class="prof-kpi-val" style="color:#6d28d9;">${resumo.totalDia}</div>
            <div class="prof-kpi-sub">${resumo.agendados} agend. + ${resumo.intercorrencias} interc.</div>
          </div>
        </div>
        ${alertHtml}
        ${miniStripHtml}
      </div>
    `;
  });

  if (typeof atualizarAlertaIntercorrenciaRecepcao === 'function') {
    atualizarAlertaIntercorrenciaRecepcao();
  }
}

function atualizarAlertaIntercorrenciaRecepcao() {
  const box = document.getElementById('recepcao-interc-alerta');
  if (!box) return;
  const setor = document.getElementById('input-setor')?.value || '';
  if (!isManagerOrAdmin() || !SETORES_HORARIO_MARCADO.includes(setor)) {
    box.className = '';
    box.innerHTML = '';
    return;
  }
  const profSel = document.getElementById('input-profissional')?.value || '';
  const prof = setor === 'Odontologia' ? (SECTOR_CONFIG['Odontologia']?.profissionais?.[0] || 'Dra. Juliana Cavalcante') : profSel;
  if (!prof) {
    box.className = '';
    box.innerHTML = '';
    return;
  }
  const hm = document.getElementById('input-horario-marcado')?.value?.trim() || '';
  const tipo = document.getElementById('input-tipo-atendimento')?.value || '';
  const ehInterc = isPacienteIntercorrenciaClinica({ horario_marcado: hm, tipo_atendimento: tipo });
  if (!ehInterc) {
    box.className = '';
    box.innerHTML = '';
    return;
  }
  const resumo = calcularResumoProfissionalDia(setor, prof);
  const meta = obterMetaProfissionalDia(setor, prof);
  if (resumo.intercorrencias >= meta.limiteIntercorrencias) {
    box.className = 'show';
    box.innerHTML = `<span style="font-size:16px;">🚨</span><div><strong>Alerta Admin (${escapeText(prof)}):</strong> Já possui <strong>${resumo.intercorrencias} intercorrências</strong> hoje (limite previsto: ${meta.limiteIntercorrencias}). Este paciente de intercorrência elevará para <strong>${resumo.intercorrencias + 1}</strong>.</div>`;
  } else {
    box.className = '';
    box.innerHTML = '';
  }
}

function popularSelectAlvoMetaDia(alvoSelecionado) {
  const sel = document.getElementById('meta-dia-alvo');
  if (!sel) return;
  const opts = ['<option value="__PADRAO__">🌐 Padrão Geral da Unidade (Todos sem regra própria)</option>'];
  SETORES_HORARIO_MARCADO.forEach(setor => {
    const cfg = SECTOR_CONFIG[setor];
    if (!cfg || !Array.isArray(cfg.profissionais)) return;
    cfg.profissionais.forEach(pNome => {
      const temCustom = Boolean(metasDiaConfig?.por_profissional?.[pNome]);
      opts.push(`<option value="${escapeText(pNome)}">${escapeText(setor)} · ${escapeText(pNome)}${temCustom ? ' ★' : ''}</option>`);
    });
  });
  sel.innerHTML = opts.join('');
  if (alvoSelecionado && Array.from(sel.options).some(o => o.value === alvoSelecionado)) {
    sel.value = alvoSelecionado;
  } else {
    sel.value = '__PADRAO__';
  }
}

function atualizarVisibilidadeModoMetaDia() {
  const modo = document.getElementById('meta-dia-modo')?.value || 'turno';
  const elTurno = document.getElementById('meta-dia-turno-fields');
  const elFixo = document.getElementById('meta-dia-fixo-fields');
  if (elTurno) elTurno.style.display = modo === 'fixo' ? 'none' : 'grid';
  if (elFixo) elFixo.style.display = modo === 'fixo' ? 'grid' : 'none';
}

function ajustarInputMetaDia(inputId, delta) {
  const el = document.getElementById(inputId);
  if (!el) return;
  const min = parseInt(el.min || '0', 10);
  const max = parseInt(el.max || '80', 10);
  const atual = parseInt(el.value || '0', 10);
  const novo = Math.max(min, Math.min(max, (Number.isFinite(atual) ? atual : 0) + delta));
  el.value = String(novo);
}

function aplicarPresetMetaDia(preset, btn) {
  document.querySelectorAll('#modal-config-metas-dia .meta-preset-chip').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = String(v); };
  if (preset === 'padrao') {
    setVal('meta-dia-modo', 'turno');
    setVal('meta-dia-manha', 8);
    setVal('meta-dia-tarde', 5);
    setVal('meta-dia-fixa', 13);
    setVal('meta-dia-interc', 4);
    setVal('meta-dia-label', 'Padrão (8 Manhã · 5 Tarde)');
  } else if (preset === 'hiperdia12') {
    setVal('meta-dia-modo', 'fixo');
    setVal('meta-dia-fixa', 12);
    setVal('meta-dia-manha', 12);
    setVal('meta-dia-tarde', 12);
    setVal('meta-dia-interc', 4);
    setVal('meta-dia-label', 'Hiperdia (12 Agendados)');
  } else if (preset === 'hiperdia15') {
    setVal('meta-dia-modo', 'fixo');
    setVal('meta-dia-fixa', 15);
    setVal('meta-dia-manha', 15);
    setVal('meta-dia-tarde', 15);
    setVal('meta-dia-interc', 4);
    setVal('meta-dia-label', 'Hiperdia Intensivo (15)');
  } else if (preset === 'prenatal5') {
    setVal('meta-dia-modo', 'fixo');
    setVal('meta-dia-fixa', 5);
    setVal('meta-dia-manha', 5);
    setVal('meta-dia-tarde', 5);
    setVal('meta-dia-interc', 4);
    setVal('meta-dia-label', 'Pré-Natal / Gestante (5)');
  } else if (preset === 'puericultura6') {
    setVal('meta-dia-modo', 'fixo');
    setVal('meta-dia-fixa', 6);
    setVal('meta-dia-manha', 6);
    setVal('meta-dia-tarde', 6);
    setVal('meta-dia-interc', 4);
    setVal('meta-dia-label', 'Puericultura (6)');
  }
  atualizarVisibilidadeModoMetaDia();
}

function renderListaCustomMetasDia() {
  const box = document.getElementById('meta-dia-custom-list');
  if (!box) return;
  const entries = Object.entries(metasDiaConfig?.por_profissional || {});
  if (!entries.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `
    <div style="font-size:11px;font-weight:900;color:#475569;text-transform:uppercase;margin-bottom:6px;">Regras Específicas Ativas Hoje</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;">
      ${entries.map(([nome, cfg]) => {
        const desc = cfg.modo === 'fixo' ? `${cfg.meta_fixa} (${cfg.tipo_dia || 'Especial'})` : `${cfg.manha}M / ${cfg.tarde}T`;
        const safeNome = nome.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        return `<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:#eff6ff;border:1px solid #93c5fd;color:#1e3a8a;font-size:11.5px;font-weight:800;">
          👤 ${escapeText(nome)}: ${escapeText(desc)} · Interc: ${cfg.intercorrencias}
          <button type="button" onclick="removerMetaCustomProfissional('${safeNome}')" title="Remover regra específica" style="background:transparent;border:none;color:#dc2626;font-weight:900;cursor:pointer;">✕</button>
        </span>`;
      }).join('')}
    </div>`;
}

function carregarAlvoMetaDiaNoModal() {
  const alvo = document.getElementById('meta-dia-alvo')?.value || '__PADRAO__';
  const cfg = (alvo !== '__PADRAO__' && metasDiaConfig?.por_profissional?.[alvo])
    ? metasDiaConfig.por_profissional[alvo]
    : (metasDiaConfig?.padrao || { manha: 8, tarde: 5, meta_fixa: 13, intercorrencias: 4, modo: 'turno', tipo_dia: 'Padrão (8 Manhã · 5 Tarde)' });
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = String(v); };
  setVal('meta-dia-modo', cfg.modo === 'fixo' ? 'fixo' : 'turno');
  setVal('meta-dia-manha', cfg.manha ?? 8);
  setVal('meta-dia-tarde', cfg.tarde ?? 5);
  setVal('meta-dia-fixa', cfg.meta_fixa ?? 12);
  setVal('meta-dia-interc', cfg.intercorrencias ?? 4);
  setVal('meta-dia-label', cfg.tipo_dia || '');
  document.querySelectorAll('#modal-config-metas-dia .meta-preset-chip').forEach(b => b.classList.remove('active'));
  atualizarVisibilidadeModoMetaDia();
  renderListaCustomMetasDia();
}

function abrirModalConfigMetasDia(alvoInicial = '__PADRAO__') {
  if (!isManagerOrAdmin()) {
    pedirSenhaGerenteOuAdmin('Configurar Metas de Agendados do Dia', () => abrirModalConfigMetasDia(alvoInicial));
    return;
  }
  popularSelectAlvoMetaDia(alvoInicial || '__PADRAO__');
  carregarAlvoMetaDiaNoModal();
  const modal = document.getElementById('modal-config-metas-dia');
  if (modal) modal.classList.add('show');
}

function fecharModalConfigMetasDia() {
  const modal = document.getElementById('modal-config-metas-dia');
  if (modal) modal.classList.remove('show');
}

async function persistirMetasDiaNoServidor(novoConfig) {
  const headers = { 'Content-Type': 'application/json' };
  if (adminPassword) headers['x-admin-password'] = adminPassword;
  const r = await fetch(`${API_URL}/config/metas-dia`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ config: novoConfig, senha: adminPassword || undefined })
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 || r.status === 403) {
    pedirSenhaGerenteOuAdmin('Salvar Metas do Dia', () => persistirMetasDiaNoServidor(novoConfig));
    return false;
  }
  if (!r.ok) {
    showToast(data.error || 'Erro ao salvar metas do dia!', true);
    return false;
  }
  if (data.config) metasDiaConfig = data.config;
  renderResumoProfissionais();
  renderListaCustomMetasDia();
  return true;
}

async function salvarConfigMetasDia() {
  const alvo = document.getElementById('meta-dia-alvo')?.value || '__PADRAO__';
  const modo = document.getElementById('meta-dia-modo')?.value === 'fixo' ? 'fixo' : 'turno';
  const manha = Math.max(1, Math.min(60, parseInt(document.getElementById('meta-dia-manha')?.value || '8', 10) || 8));
  const tarde = Math.max(1, Math.min(60, parseInt(document.getElementById('meta-dia-tarde')?.value || '5', 10) || 5));
  const meta_fixa = Math.max(1, Math.min(80, parseInt(document.getElementById('meta-dia-fixa')?.value || '12', 10) || 12));
  const intercorrencias = Math.max(0, Math.min(30, parseInt(document.getElementById('meta-dia-interc')?.value ?? '4', 10)));
  const tipo_dia = (document.getElementById('meta-dia-label')?.value || '').trim() || (modo === 'fixo' ? `Especial (${meta_fixa})` : `Turno (${manha}M · ${tarde}T)`);

  const bloco = { manha, tarde, meta_fixa, intercorrencias, modo, tipo_dia };
  const nextConfig = {
    padrao: { ...(metasDiaConfig?.padrao || {}) },
    por_profissional: { ...(metasDiaConfig?.por_profissional || {}) }
  };
  if (alvo === '__PADRAO__') {
    nextConfig.padrao = bloco;
  } else {
    nextConfig.por_profissional[alvo] = bloco;
  }

  const ok = await persistirMetasDiaNoServidor(nextConfig);
  if (ok) {
    showToast(`✅ Meta salva para ${alvo === '__PADRAO__' ? 'toda a unidade' : alvo}!`);
    fecharModalConfigMetasDia();
  }
}

async function removerMetaCustomProfissional(profNome) {
  const nextConfig = {
    padrao: { ...(metasDiaConfig?.padrao || {}) },
    por_profissional: { ...(metasDiaConfig?.por_profissional || {}) }
  };
  delete nextConfig.por_profissional[profNome];
  const ok = await persistirMetasDiaNoServidor(nextConfig);
  if (ok) {
    popularSelectAlvoMetaDia('__PADRAO__');
    carregarAlvoMetaDiaNoModal();
    showToast(`ℹ️ Regra específica de ${profNome} removida (voltou ao padrão).`);
  }
}

function renderAllSectorAttended() {
  SETORES.forEach(setor => {
    const cfg = SECTOR_CONFIG[setor];
    const el = document.getElementById('attended-' + cfg.key);
    const cntEl = document.getElementById('cnt-attended-' + cfg.key);
    if (!el) return;

    const filter = sectorFilters[cfg.key] || null;
    const items = obterAtendimentosUnicosSetor(setor, filter);

    if (cntEl) cntEl.textContent = items.length;

    if (!items.length) {
      el.innerHTML = '<div class="empty-state" style="padding:16px;"><div class="es-icon">✅</div><p>Nenhum atendido ainda</p></div>';
      return;
    }

    el.innerHTML = items.map((p, i) => {
      const prioBadge = p.prioridade === 'prioritario' ? `<span class="priority-badge">⭐</span>` : '';
      const prof = p.profissional || '';
      const profLabel = prof ? `<span style="font-size:11px;color:var(--gray-600);"> · ${escapeText(prof)}</span>` : '';
      const qrBtn = `<button class="btn-qr" onclick="event.stopPropagation();showQrModalById(${Number(p.patient_id)})" title="Ver QR Code">📱</button>`;
      const safeNomeAttr = escapeText(String(p.nome || '')).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const delBtn = isAdmin ? `<button class="btn-danger-sm" onclick="event.stopPropagation();deleteHistoryItem(${Number(p.id)},'${safeNomeAttr}')" title="Excluir do Histórico">🗑️</button>` : '';
      
      return `<div class="queue-item" style="border-left:4px solid var(--green);">
        <div class="queue-position" style="background:var(--green);">${items.length - i}</div>
        <div class="queue-name">${escapeText(p.nome)}${prioBadge}${profLabel}</div>
        <div class="queue-time">${escapeText(p.horario_chamada || '')}</div>
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
let attendedQuickSector = '';

function extrairHoraRecifeAtendido(p) {
  if (p && p.created_at) {
    const d = safeDate(p.created_at);
    if (!Number.isNaN(d.getTime())) {
      const hhStr = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/Recife',
        hour: '2-digit',
        hour12: false
      }).format(d);
      const hh = parseInt(hhStr, 10);
      if (!Number.isNaN(hh)) return hh;
    }
  }
  const m = String((p && (p.horario_chamada || p.horario)) || '').match(/^(\d{1,2}):/);
  return m ? parseInt(m[1], 10) : null;
}

function obterAtendidosBaseBusca() {
  const busca = (document.getElementById('filter-busca-nome')?.value || '').trim().toLowerCase();
  const base = Array.isArray(attendedPatients) ? attendedPatients : [];
  if (!busca) return base;
  return base.filter(p => {
    const txt = `${p.nome || ''} ${p.cpf || ''} ${p.queixa || ''} ${p.profissional || ''} ${p.medico || ''} ${p.setor || ''}`.toLowerCase();
    return txt.includes(busca);
  });
}

function obterAtendidosVisiveis() {
  const base = obterAtendidosBaseBusca();
  if (!attendedQuickSector) return base;
  return base.filter(p => String(p.setor || '') === attendedQuickSector);
}

function selecionarSetorRapidoAtendidos(setor) {
  attendedQuickSector = setor || '';
  renderAttended();
}

async function renderAttended() {
  const el = document.getElementById('attended-list'); if (!el) return;
  const baseBusca = obterAtendidosBaseBusca();
  const visiveis = obterAtendidosVisiveis();

  let cntManha = 0, cntTarde = 0, cntPrio = 0;
  visiveis.forEach(p => {
    const hh = extrairHoraRecifeAtendido(p);
    if (hh !== null && hh < 12) cntManha++;
    else if (hh !== null && hh >= 12) cntTarde++;
    if (p.prioridade === 'prioritario' || p.tipo_prioridade) cntPrio++;
  });

  const ce = document.getElementById('attended-count'); if (ce) ce.textContent = visiveis.length;
  const cb = document.getElementById('attended-count-big'); if (cb) cb.textContent = visiveis.length;
  const cm = document.getElementById('attended-count-manha'); if (cm) cm.textContent = cntManha;
  const ct = document.getElementById('attended-count-tarde'); if (ct) ct.textContent = cntTarde;
  const cp = document.getElementById('attended-count-prio'); if (cp) cp.textContent = cntPrio;
  const lbl = document.getElementById('attended-total-label');
  if (lbl) {
    lbl.textContent = attendedQuickSector
      ? `Total em ${attendedQuickSector}`
      : ((document.getElementById('filter-data')?.value || document.getElementById('filter-data-fim')?.value) ? 'Total Filtrado' : 'Total Atendidos');
  }

  const pillsEl = document.getElementById('attended-sector-pills');
  if (pillsEl) {
    const contagemPorSetor = {};
    baseBusca.forEach(p => {
      const s = String(p.setor || 'Outro');
      contagemPorSetor[s] = (contagemPorSetor[s] || 0) + 1;
    });
    const ordemSetores = ['Médico', 'Enfermagem', 'Téc. Enfermagem', 'Odontologia', 'Acolhimento', 'Regulação', 'Farmácia', 'ACS'];
    const setoresPresentes = Object.keys(contagemPorSetor).sort((a, b) => {
      const ia = ordemSetores.indexOf(a);
      const ib = ordemSetores.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b, 'pt-BR');
    });
    const pillStyle = active => active
      ? 'background:#1a4fc4;color:#fff;border:1px solid #1a4fc4;padding:5px 12px;border-radius:999px;font-size:12px;font-weight:800;cursor:pointer;'
      : 'background:#f1f5f9;color:#334155;border:1px solid #cbd5e1;padding:5px 12px;border-radius:999px;font-size:12px;font-weight:700;cursor:pointer;';
    pillsEl.innerHTML = [
      `<button type="button" style="${pillStyle(!attendedQuickSector)}" onclick="selecionarSetorRapidoAtendidos('')">📋 Todos (${baseBusca.length})</button>`,
      ...setoresPresentes.map(s => {
        const cfg = SECTOR_CONFIG[s] || {};
        const sAttr = escapeText(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        return `<button type="button" style="${pillStyle(attendedQuickSector === s)}" onclick="selecionarSetorRapidoAtendidos('${sAttr}')">${cfg.icon || '🏥'} ${escapeText(s)} (${contagemPorSetor[s]})</button>`;
      })
    ].join('');
  }

  if (!visiveis.length) {
    el.innerHTML = '<div class="empty-state"><div class="es-icon">✅</div><p>Nenhum paciente atendido encontrado</p></div>';
    return;
  }

  const hojeRecife = typeof getDataHojeRecifeFront === 'function' ? getDataHojeRecifeFront() : '';
  const rowsHtml = visiveis.map((p, i) => {
    const cfg = SECTOR_CONFIG[p.setor] || {};
    const isPrio = p.prioridade === 'prioritario' || Boolean(p.tipo_prioridade);
    const prioBadge = isPrio ? `<span class="priority-badge" style="margin-left:6px;">⭐ ${escapeText(p.tipo_prioridade || 'Prioritário')}</span>` : '';
    const agendBadge = p.agendamento_realizado ? `<span style="display:inline-block;margin-left:6px;padding:1px 7px;border-radius:999px;font-size:10.5px;font-weight:800;background:#dbeafe;color:#1e40af;">📅 Agendado</span>` : '';
    const cpfSpan = p.cpf ? `<span style="font-size:11px;color:#64748b;margin-left:6px;">CPF: ${escapeText(p.cpf)}</span>` : '';
    const queixaLine = p.queixa ? `<div style="font-size:11.5px;color:#475569;margin-top:2px;">💬 ${escapeText(p.queixa)}</div>` : '';
    const prof = p.profissional || p.medico || '';
    const profLine = prof ? `<div style="font-size:11.5px;color:#475569;font-weight:700;margin-top:3px;">👤 ${escapeText(prof)}</div>` : '';

    let dataHoraHtml = escapeText(p.horario_chamada || p.horario || '—');
    if (p.created_at) {
      const dt = safeDate(p.created_at);
      if (!Number.isNaN(dt.getTime())) {
        const diaIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Recife', year: 'numeric', month: '2-digit', day: '2-digit' }).format(dt);
        const horaStr = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Recife', hour: '2-digit', minute: '2-digit' }).format(dt);
        const diaBr = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Recife', day: '2-digit', month: '2-digit' }).format(dt);
        dataHoraHtml = diaIso !== hojeRecife ? `${diaBr} · ${horaStr}` : horaStr;
      }
    }
    const hh = extrairHoraRecifeAtendido(p);
    const turnoBadge = hh !== null
      ? (hh < 12
        ? `<span style="font-size:10px;font-weight:800;padding:1px 6px;border-radius:999px;background:#dbeafe;color:#1e40af;margin-left:4px;">🌅 Manhã</span>`
        : `<span style="font-size:10px;font-weight:800;padding:1px 6px;border-radius:999px;background:#fef3c7;color:#92400e;margin-left:4px;">🌇 Tarde</span>`)
      : '';

    const hasPid = p.patient_id !== null && p.patient_id !== undefined && Number.isFinite(Number(p.patient_id)) && Number(p.patient_id) > 0;
    const qrBtn = hasPid ? `<button class="btn-qr" onclick="event.stopPropagation();showQrModalById(${Number(p.patient_id)})" title="Ver QR Code">📱</button>` : '';
    const safeNomeAttr = escapeText(String(p.nome || '')).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const delBtn = isAdmin ? `<button class="btn-danger-sm" onclick="event.stopPropagation();deleteHistoryItem(${Number(p.id)},'${safeNomeAttr}')" title="Excluir do Histórico">🗑️</button>` : '';

    return `<tr>
      <td><span class="queue-position" style="background:var(--green);display:inline-flex;min-width:30px;height:28px;justify-content:center;align-items:center;">${visiveis.length - i}</span></td>
      <td>
        <div style="font-weight:800;color:#0f172a;font-size:13.5px;">${escapeText(p.nome)}${prioBadge}${agendBadge}</div>
        ${cpfSpan}${queixaLine}
      </td>
      <td>
        <span class="sector-tag ${cfg.tagClass||''}">${cfg.icon||''} ${escapeText(p.setor)}</span>
        ${profLine}
      </td>
      <td style="font-weight:700;color:#334155;font-size:12.5px;">${dataHoraHtml}${turnoBadge}</td>
      <td class="fila-actions-cell" style="text-align:right;">
        <div style="display:inline-flex;gap:5px;align-items:center;justify-content:flex-end;">
          ${qrBtn}
          <span class="queue-status status-done">✅ Atendido</span>
          ${delBtn}
        </div>
      </td>
    </tr>`;
  }).join('');

  el.innerHTML = `<div class="table-responsive" style="border:1px solid #cbd5e1;border-radius:12px;overflow:hidden;">
    <table class="fila-clean-table" style="min-width:740px;">
      <thead>
        <tr>
          <th style="width:65px;">#</th>
          <th style="width:33%;">Paciente / Queixa</th>
          <th style="width:24%;">Setor / Profissional</th>
          <th style="width:18%;">Data / Hora</th>
          <th style="width:18%;text-align:right;">Status / Ações</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>`;
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
  const dataInicio = document.getElementById('filter-data')?.value || '';
  const dataFim = document.getElementById('filter-data-fim')?.value || '';
  const setor = document.getElementById('filter-setor')?.value || '';
  const prof = document.getElementById('filter-profissional')?.value || '';
  if (!dataInicio && !dataFim && !setor && !prof) {
    attendedQuickSector = '';
    loadAttended();
    return;
  }
  try {
    const params = new URLSearchParams();
    if (dataInicio) params.set('dataInicio', dataInicio);
    if (dataFim) params.set('dataFim', dataFim);
    if (dataInicio && !dataFim) params.set('dataFim', dataInicio);
    if (setor) params.set('setor', setor);
    if (prof) params.set('profissional', prof);
    const r = await fetch(`${API_URL}/history/filtered?${params}`);
    if (!r.ok) throw new Error();
    attendedPatients = await r.json();
    attendedQuickSector = '';
    renderAttended();
  } catch { showToast('Erro ao filtrar', true); }
}

function filtrarAtendidosHoje() {
  const hoje = typeof getDataHojeRecifeFront === 'function' ? getDataHojeRecifeFront() : '';
  const df1 = document.getElementById('filter-data');
  const df2 = document.getElementById('filter-data-fim');
  const fs = document.getElementById('filter-setor');
  const fp = document.getElementById('filter-profissional');
  const fb = document.getElementById('filter-busca-nome');
  if (df1) df1.value = hoje;
  if (df2) df2.value = hoje;
  if (fs) fs.value = '';
  if (fp) fp.value = '';
  if (fb) fb.value = '';
  attendedQuickSector = '';
  loadAttended();
}

function limparFiltrosAtendidos() {
  const df1 = document.getElementById('filter-data');
  const df2 = document.getElementById('filter-data-fim');
  const fs = document.getElementById('filter-setor');
  const fp = document.getElementById('filter-profissional');
  const fb = document.getElementById('filter-busca-nome');
  if (df1) df1.value = '';
  if (df2) df2.value = '';
  if (fs) fs.value = '';
  if (fp) fp.value = '';
  if (fb) fb.value = '';
  attendedQuickSector = '';
  loadAttended();
}

// ====== CHAT AVANÇADO COM CANAIS ======
const CANAIS = [
  { id:'geral', nome:'📢 Geral', desc:'Todos os setores e profissionais' },
  { id:'recepcao', nome:'🏢 Recepção', desc:'Comunicação da Recepção' },
  { id:'acolhimento', nome:'💜 Acolhimento', desc:'1ª e 2ª Escuta / Triagem' },
  { id:'acs', nome:'🧡 ACS', desc:'Agentes Comunitários de Saúde (Cadastro / Endereço / Devoluções)' },
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
let chatSearchQuery = '';
let _lastRenderedChatKey = '';
const ORIGINAL_DOC_TITLE = document.title;

function syncChatExpandedBodyClass() {
  const overlay = document.getElementById('chat-drawer-overlay');
  document.body.classList.toggle('chat-is-expanded', Boolean(chatPanelOpen && overlay && overlay.classList.contains('chat-expanded')));
}

function toggleChatExpand(forceState) {
  const overlay = document.getElementById('chat-drawer-overlay');
  const btn = document.getElementById('btn-chat-expand');
  if (!overlay) return;
  const expanded = forceState !== undefined ? Boolean(forceState) : !overlay.classList.contains('chat-expanded');
  overlay.classList.toggle('chat-expanded', expanded);
  if (btn) btn.textContent = expanded ? '⤡ Reduzir' : '⤢ Expandir';
  syncChatExpandedBodyClass();
  try { localStorage.setItem('usf_chat_expanded', expanded ? '1' : '0'); } catch (e) {}
}

function abrirDevolucaoDoChat(canalId) {
  const map = { medico: 'Médico', enfermagem: 'Enfermagem', odontologia: 'Odontologia', acs: 'ACS', acolhimento: 'ACS' };
  const setor = map[canalId] || 'Médico';
  if (chatPanelOpen && typeof toggleChatPanel === 'function') toggleChatPanel();
  if (typeof abrirModalDevolucoesProfissional === 'function') abrirModalDevolucoesProfissional(setor);
}

function abrirDevolucaoRegulacaoDoChat() {
  if (chatPanelOpen && typeof toggleChatPanel === 'function') toggleChatPanel();
  if (typeof abrirModalPreviaRegulacao === 'function') abrirModalPreviaRegulacao('devolucoes', 'respondida');
}

function toggleChatSidebarMobile() {
  document.getElementById('chat-sidebar')?.classList.toggle('open');
}

function onChatSearchInput() {
  chatSearchQuery = (document.getElementById('chat-search-input')?.value || '').trim().toLowerCase();
  _lastRenderedChatKey = '';
  renderChannelChat(false);
}

document.addEventListener('DOMContentLoaded', () => {
  try {
    if (localStorage.getItem('usf_chat_expanded') === '1') toggleChatExpand(true);
  } catch (e) {}
});

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
    if (!_chatLoadedCanais[activeCanal]) {
      loadChannelMessages(activeCanal, { silentNotify: true }).then(() => {
        renderChannelChat(true);
        renderCanalList();
      });
    } else {
      renderCanalList();
      renderChannelChat(true);
    }
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
  syncChatExpandedBodyClass();
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
let channelLatestPreview = {};
let _chatLoadedCanais = {};
let _chatLastSeenIdByCanal = {};
let _chatSummaryBootstrapped = false;
let chatUrgent = false;
let typingTimeout = null;
CANAIS.forEach(c => { channelMessages[c.id] = []; channelUnread[c.id] = 0; });

let _chatDeviceNomeOficial = '';
let _chatDeviceSetorOficial = '';

const CHAT_SETORES_OFICIAIS = ['Recepção', 'Acolhimento', 'ACS', 'Farmácia', 'Regulação', 'Médico', 'Enfermagem', 'Odontologia', 'Téc. Enfermagem', 'Gerência'];

function resolverSetorChatCompativel(setorDisp) {
  const s = String(setorDisp || '').trim();
  if (!s) return '';
  const norm = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const exato = CHAT_SETORES_OFICIAIS.find(item =>
    item.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === norm
  );
  if (exato) return exato;
  if (norm.includes('coorden') || norm.includes('gerenc') || norm.includes('admin')) return 'Gerência';
  if (norm === 'acs' || norm.includes('agente')) return 'ACS';
  if (norm.includes('acolh')) return 'Acolhimento';
  if (norm.includes('farm')) return 'Farmácia';
  if (norm.includes('regula')) return 'Regulação';
  if (norm.includes('med')) return 'Médico';
  if (norm.includes('tec')) return 'Téc. Enfermagem';
  if (norm.includes('enf')) return 'Enfermagem';
  if (norm.includes('odont')) return 'Odontologia';
  if (norm.includes('recep')) return 'Recepção';
  return s;
}

function obterIdentificacaoRemetenteChat() {
  const setor = _chatDeviceSetorOficial || 'Recepção';
  const nome = _chatDeviceNomeOficial || '';
  if (!nome) {
    return {
      setor,
      nome: '',
      autor: _chatDeviceSetorOficial || 'Dispositivo sem nome'
    };
  }
  if (!_chatDeviceSetorOficial) {
    return { setor, nome, autor: nome };
  }
  const nNorm = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const sNorm = _chatDeviceSetorOficial.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const autor = nNorm === sNorm ? nome : `${nome} (${_chatDeviceSetorOficial})`;
  return { setor, nome, autor };
}

window.sincronizarIdentidadeDispositivoNoChat = function(nomeDisp, setorDisp) {
  const limpo = String(nomeDisp || '').trim();
  const ehValido = Boolean(limpo) && limpo.toLowerCase() !== 'sem nome';
  const statusEl = document.getElementById('chat-device-id-status');
  const cardEl = document.getElementById('chat-device-id-card');
  const cardNomeEl = document.getElementById('chat-device-id-nome');
  const cardSetorEl = document.getElementById('chat-device-id-setor');
  const cardModoEl = document.getElementById('chat-device-id-modo');

  if (ehValido) {
    _chatDeviceNomeOficial = limpo;
    _chatDeviceSetorOficial = resolverSetorChatCompativel(setorDisp);
    if (_chatDeviceSetorOficial) {
      try { localStorage.setItem('chatSetor', _chatDeviceSetorOficial); } catch (e) {}
    }

    if (cardEl) {
      cardEl.style.background = _chatDeviceSetorOficial ? 'rgba(34,197,94,0.18)' : 'rgba(14,165,233,0.18)';
      cardEl.style.borderColor = _chatDeviceSetorOficial ? 'rgba(134,239,172,0.55)' : 'rgba(125,211,252,0.55)';
    }
    if (cardNomeEl) cardNomeEl.textContent = `💻 ${limpo}`;
    if (cardSetorEl) cardSetorEl.textContent = _chatDeviceSetorOficial || 'USF Chico Mendes';
    if (cardModoEl) cardModoEl.textContent = _chatDeviceSetorOficial ? 'Automático' : 'Identificado';
    if (statusEl) {
      statusEl.textContent = _chatDeviceSetorOficial
        ? ''
        : 'Defina o setor deste aparelho em Dispositivos para vincular o canal.';
    }
  } else {
    _chatDeviceNomeOficial = '';
    _chatDeviceSetorOficial = '';
    if (cardEl) {
      cardEl.style.background = 'rgba(245,158,11,0.16)';
      cardEl.style.borderColor = 'rgba(252,211,77,0.5)';
    }
    if (cardNomeEl) cardNomeEl.textContent = '⚠️ Dispositivo sem nome';
    if (cardSetorEl) cardSetorEl.textContent = 'Não identificado';
    if (cardModoEl) cardModoEl.textContent = 'Pendente';
    if (statusEl) statusEl.textContent = 'Cadastre nome e setor deste aparelho na aba Dispositivos.';
  }

  if (typeof renderCanalList === 'function') renderCanalList();
  if (typeof renderChannelChat === 'function') renderChannelChat();
};

setTimeout(() => {
  const dispNomeSalvo = localStorage.getItem('usf_device_nome');
  const dispSetorSalvo = localStorage.getItem('usf_device_setor');
  if (typeof window.sincronizarIdentidadeDispositivoNoChat === 'function') {
    window.sincronizarIdentidadeDispositivoNoChat(dispNomeSalvo || 'Sem nome', dispSetorSalvo || '');
  }
}, 120);

function onChatNomeChange() {}
function onChatSetorChange() {}

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
  const setor = obterIdentificacaoRemetenteChat().setor || 'Recepção';
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
  const setor = obterIdentificacaoRemetenteChat().setor || 'Recepção';
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
    const last = msgs.length ? msgs[msgs.length - 1] : (channelLatestPreview[c.id] || null);
    const previewTxt = last
      ? escapeText(`${last.autor}: ${(last.texto || (last.anexo_nome ? '📎 ' + last.anexo_nome : '')).replace(/\n/g, ' ')}`)
      : escapeText(c.desc);
    return `<button type="button" class="chat-canal-btn ${c.id===activeCanal?'active':''}${unreadCls}" onclick="switchCanal('${c.id}')" title="${escapeText(c.desc)}"><div class="chat-canal-row-top">${presenceDot}<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.nome}</span>${badge}</div><div class="chat-canal-preview">${previewTxt}</div></button>`;
  }).join('');
}

function switchCanal(canalId) {
  // Marcar canal anterior como lido antes de trocar
  if (activeCanal && activeCanal !== canalId) {
    markCanalAsRead(activeCanal);
  }

  activeCanal = canalId;
  chatSearchQuery = '';
  _lastRenderedChatKey = '';
  const searchEl = document.getElementById('chat-search-input');
  if (searchEl) searchEl.value = '';
  document.getElementById('chat-sidebar')?.classList.remove('open');

  // Atualizar ícone, título e subtítulo do canal
  const canalInfo = CANAIS.find(c => c.id === canalId);
  const iconEl = document.getElementById('chat-canal-icon');
  if (canalInfo) {
    if (iconEl) iconEl.textContent = canalInfo.nome.split(' ')[0] || '💬';
    document.getElementById('chat-canal-title').textContent = canalInfo.nome.replace(/^\S+\s/, '');
    document.getElementById('chat-canal-sub').textContent = canalInfo.desc;
  } else {
    if (iconEl) iconEl.textContent = '📢';
    document.getElementById('chat-canal-title').textContent = 'Chat da Unidade';
    document.getElementById('chat-canal-sub').textContent = 'Todos os setores e profissionais';
  }

  // Carregar mensagens do canal se ainda não estiverem em memória
  if (!_chatLoadedCanais[canalId] || !channelMessages[canalId] || channelMessages[canalId].length === 0) {
    loadChannelMessages(canalId, { silentNotify: true }).then(() => {
      renderChannelChat(true);
      markCanalAsRead(canalId);
      updateChatBadge();
      renderCanalList();
    });
  } else {
    renderChannelChat(true);
    markCanalAsRead(canalId);
    updateChatBadge();
    renderCanalList();
  }

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

function notificarNovaMensagemChat(canalId, newLast) {
  if (!newLast) return;
  const { setor: meuSetor, nome: meuNome, autor: meuIdentificador } = obterIdentificacaoRemetenteChat();
  if (newLast.autor === meuIdentificador || newLast.autor === meuSetor || (meuNome && newLast.autor === meuNome)) {
    return;
  }
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

async function loadChannelMessages(canalId, opts = {}) {
  const { silentNotify = false } = opts;
  try {
    const r = await fetch(`${API_URL}/chat/canais/${canalId}`);
    if (!r.ok) return;
    const newMsgs = await r.json();

    const oldMsgs = channelMessages[canalId];
    if (Array.isArray(newMsgs) && newMsgs.length > 0) {
      const oldLast = oldMsgs && oldMsgs.length > 0 ? oldMsgs[oldMsgs.length - 1] : null;
      const newLast = newMsgs[newMsgs.length - 1];
      _chatLastSeenIdByCanal[canalId] = Math.max(_chatLastSeenIdByCanal[canalId] || 0, Number(newLast.id) || 0);
      channelLatestPreview[canalId] = newLast;
      if (!silentNotify && _chatLoadedCanais[canalId] && (!oldLast || newLast.id > oldLast.id)) {
        notificarNovaMensagemChat(canalId, newLast);
      }
    }

    _chatLoadedCanais[canalId] = true;
    channelMessages[canalId] = Array.isArray(newMsgs) ? newMsgs : [];
  } catch (e) { console.error(e); }
}

async function loadAllChannels() {
  const setor = obterIdentificacaoRemetenteChat().setor || 'Recepção';
  try {
    const r = await fetch(`${API_URL}/chat/resumo/${encodeURIComponent(setor)}`);
    if (!r.ok) return;
    const data = await r.json();
    const unreadMap = (data && data.unread) || {};
    const latestMap = (data && data.latest) || {};

    Object.keys(unreadMap).forEach(k => { channelUnread[k] = unreadMap[k]; });
    channelLatestPreview = latestMap;

    const visibleIds = getVisibleCanais().map(c => c.id);
    const canalsToFetch = [];

    if (!_chatSummaryBootstrapped) {
      visibleIds.forEach(canalId => {
        const info = latestMap[canalId];
        _chatLastSeenIdByCanal[canalId] = info && info.id ? Number(info.id) : 0;
      });
      _chatSummaryBootstrapped = true;
      if (chatPanelOpen && activeCanal && !_chatLoadedCanais[activeCanal]) {
        canalsToFetch.push(activeCanal);
      }
    } else {
      for (const canalId of visibleIds) {
        const info = latestMap[canalId];
        const infoId = info && info.id ? Number(info.id) : 0;
        const prevId = _chatLastSeenIdByCanal[canalId] || 0;
        if (info && infoId > prevId) {
          _chatLastSeenIdByCanal[canalId] = infoId;
          notificarNovaMensagemChat(canalId, info);
          if ((chatPanelOpen && activeCanal === canalId) || _chatLoadedCanais[canalId]) {
            canalsToFetch.push(canalId);
          }
        }
      }
      if (chatPanelOpen && activeCanal && !_chatLoadedCanais[activeCanal] && !canalsToFetch.includes(activeCanal)) {
        canalsToFetch.push(activeCanal);
      }
    }

    if (canalsToFetch.length > 0) {
      await Promise.all(canalsToFetch.map(cid => loadChannelMessages(cid, { silentNotify: true })));
    }
  } catch (e) {
    console.error(e);
  }
  renderChannelChat();
  renderCanalList();
  updateChatBadge();
}

function formatarRotuloDataChatRecife(dateObj) {
  const fmtIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Recife', year: 'numeric', month: '2-digit', day: '2-digit' });
  const msgIso = fmtIso.format(dateObj);
  const hojeIso = fmtIso.format(new Date());
  const ontemIso = fmtIso.format(new Date(Date.now() - 86400000));
  if (msgIso === hojeIso) return 'Hoje';
  if (msgIso === ontemIso) return 'Ontem';
  return dateObj.toLocaleDateString('pt-BR', { timeZone: 'America/Recife', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function renderChannelChat(forceScroll = false) {
  const c = document.getElementById('chat-messages'); if (!c) return;
  const allMsgs = channelMessages[activeCanal] || [];
  const msgs = chatSearchQuery
    ? allMsgs.filter(m =>
        String(m.texto || '').toLowerCase().includes(chatSearchQuery) ||
        String(m.autor || '').toLowerCase().includes(chatSearchQuery) ||
        String(m.anexo_nome || '').toLowerCase().includes(chatSearchQuery)
      )
    : allMsgs;
  const { setor: meuSetor, nome: meuNome, autor: meuIdentificador } = obterIdentificacaoRemetenteChat();

  let html = '';
  if (!msgs.length) {
    html = chatSearchQuery
      ? `<div class="empty-state" style="margin:auto;"><div class="es-icon">🔍</div><p>Nenhuma mensagem encontrada para "${escapeText(chatSearchQuery)}"</p></div>`
      : '<div class="empty-state" style="margin:auto;"><div class="es-icon">💬</div><p>Nenhuma mensagem neste canal ainda</p></div>';
  } else {
    let ultimoDiaRotulo = '';
    html = msgs.map(m => {
      const dt = safeDate(m.created_at);
      const diaRotulo = formatarRotuloDataChatRecife(dt);
      const dateDivider = diaRotulo !== ultimoDiaRotulo
        ? `<div class="chat-date-divider">${diaRotulo}</div>`
        : '';
      ultimoDiaRotulo = diaRotulo;

      const t = dt.toLocaleTimeString('pt-BR', { timeZone: 'America/Recife', hour: '2-digit', minute: '2-digit' });
      const isMe = m.autor === meuIdentificador || m.autor === meuSetor || (Boolean(meuNome) && m.autor === meuNome);
      const urgClass = m.urgente ? ' bubble-urgent bubble-urgent-anim' : '';
      const urgTag = m.urgente ? '<span style="color:var(--red);font-weight:800;">🚨 URGENTE</span> ' : '';
      
      let anexoHtml = '';
      if (m.anexo_base64 && m.anexo_nome) {
        const isImg = /\.(jpeg|jpg|png|gif|webp|bmp)$/i.test(m.anexo_nome) || String(m.anexo_base64).startsWith('data:image/');
        const safeAnexoNome = escapeText(m.anexo_nome).replace(/'/g, "\\'");
        if (isImg) {
          anexoHtml = `<div style="margin-top:8px;"><img src="${m.anexo_base64}" alt="${escapeText(m.anexo_nome)}" style="max-width:100%; max-height:260px; border-radius:10px; cursor:pointer; border:1px solid rgba(0,0,0,0.1);" onclick="abrirImagemChatModal(this.src, '${safeAnexoNome}')"></div>`;
        } else {
          anexoHtml = `<div style="margin-top:8px; background:rgba(0,0,0,0.06); padding:8px; border-radius:6px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
            <span style="font-size:12px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:240px;">📎 ${escapeText(m.anexo_nome)}</span>
            <a href="${m.anexo_base64}" download="${escapeText(m.anexo_nome)}" class="btn btn-sm btn-primary" style="padding:4px 8px; font-size:11px; text-decoration:none;">⬇️ Baixar</a>
          </div>`;
        }
      }

      const safePinTxt = (m.texto || m.anexo_nome || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ');
      const safeAutorJs = (m.autor || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const pinBtn = `<button class="pin-btn" onclick="event.stopPropagation();pinChatMessage('${safePinTxt}','${safeAutorJs}')" title="Fixar mensagem">📌</button>`;
      const textoStr = String(m.texto || '');
      let devActionBtn = '';
      if (textoStr.includes('↩️ DEVOLUÇÃO SISREG')) {
        devActionBtn = `<button type="button" class="chat-ciente-btn" style="background:#fff7ed;color:#9a3412;border-color:#fdba74;" onclick="abrirDevolucaoDoChat('${activeCanal}')">💬 Responder Devolução</button>`;
      } else if (textoStr.includes('✅ SOLUÇÃO DEVOLUÇÃO SISREG')) {
        devActionBtn = `<button type="button" class="chat-ciente-btn" style="background:#dcfce7;color:#166534;border-color:#86efac;" onclick="abrirDevolucaoRegulacaoDoChat()">📋 Abrir na Regulação</button>`;
      }
      const cienteBtn = !isMe || devActionBtn
        ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">${!isMe ? `<button type="button" class="chat-ciente-btn" onclick="enviarRespostaRapidaChat('👍 Ciente (${safeAutorJs})')">👍 Ciente</button>` : ''}${devActionBtn}</div>`
        : '';
      
      const textHtml = m.texto ? `<div style="white-space:pre-wrap; word-break:break-word;">${escapeText(m.texto)}</div>` : '';

      return `${dateDivider}<div class="chat-bubble ${isMe?'bubble-sent':'bubble-received'}${urgClass}">${pinBtn}<div class="chat-meta"><span>${urgTag}${escapeText(m.autor)}</span></div>${textHtml}${anexoHtml}${cienteBtn}<div class="chat-time">${t}</div></div>`;
    }).join('');
  }

  const renderKey = `${activeCanal}|${chatSearchQuery}|${html}`;
  if (renderKey === _lastRenderedChatKey && !forceScroll) return;

  const wasNearBottom = (c.scrollHeight - c.scrollTop - c.clientHeight) < 80;
  const prevScrollTop = c.scrollTop;

  _lastRenderedChatKey = renderKey;
  c.innerHTML = html;
  c.scrollTop = (forceScroll || wasNearBottom) ? c.scrollHeight : prevScrollTop;
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
  const { setor, nome, autor } = obterIdentificacaoRemetenteChat();
  if (nome && !_chatDeviceNomeOficial) localStorage.setItem('chatNome', nome);
  
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
      _chatLoadedCanais[activeCanal] = true;
      _chatLastSeenIdByCanal[activeCanal] = Math.max(_chatLastSeenIdByCanal[activeCanal] || 0, Number(msg.id) || 0);
      channelLatestPreview[activeCanal] = msg;
      renderChannelChat(true);
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

let _prevTotalUnreadChat = 0;
function updateChatBadge() {
  const b = document.getElementById('badge-chat');
  const fab = document.getElementById('chat-fab');
  const hdrAlert = document.getElementById('header-chat-alert');
  const hdrTxt = document.getElementById('header-chat-alert-text');
  const total = Object.values(channelUnread).reduce((s,v) => s+(v||0), 0);
  if (total > _prevTotalUnreadChat) {
    playChatSound();
  }
  _prevTotalUnreadChat = total;
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
  'renata célia': 'Enfermeira – Estratégia Saúde da Família',
  'renata celia': 'Enfermeira – Estratégia Saúde da Família',
  'viviane': 'Técnica de Enfermagem',
  'vilma': 'Técnica de Enfermagem',
  'fernando': 'Técnico de Enfermagem'
};

let profissionaisCache = new Map(); // nome -> profissao
let _listaProfissionaisCadastro = [];
const _PROFISSIONAIS_FALLBACK = {
  'Médico': ['Dr. Israel Christian', 'Dr. Joene Halan', 'Dra. Mirela Mota'],
  'Enfermagem': ['Mariana Vaz', 'Jorge Marcio', 'Lucelia de Abreu', 'Renata Célia'],
  'Odontologia': ['Dra. Juliana Cavalcante'],
  'Téc. Enfermagem': ['Viviane', 'Vilma', 'Fernando']
};

function isContextoMutiraoAtivoFront() {
  try {
    if (localStorage.getItem('usf_preview_mutirao_profs') === '1') return true;
  } catch (_) {}
  if (_expedienteExtraAteMs && Date.now() < _expedienteExtraAteMs) return true;
  const hoje = getDataHojeRecife();
  if (_mutiraoLiberadoData === hoje) return true;
  const DATAS_MUTIRAO = ['2026-09-26', '2026-11-07', '2026-04-11', '2026-11-14', '2026-04-18'];
  if (DATAS_MUTIRAO.includes(hoje)) return true;
  try {
    const { day } = getDayAndHourRecife(new Date());
    if (day === 6) return true;
  } catch (_) {}
  return false;
}

function normalizarSetorProfissionalFront(p) {
  const setorRaw = String(p?.setor || '').trim();
  const nome = String(p?.nome || '').trim();
  const nomeNorm = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const profDict = typeof PROFISSOES_DEFAULT !== 'undefined' ? (PROFISSOES_DEFAULT[nome.toLowerCase()] || PROFISSOES_DEFAULT[nomeNorm] || '') : '';
  const profNorm = String(p?.profissao || profDict || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  if (!setorRaw || setorRaw === 'Médico') {
    if (/dentist|odonto/.test(profNorm) || nomeNorm === 'dra. juliana cavalcante' || nomeNorm === 'juliana cavalcante') {
      return 'Odontologia';
    }
    if ((/tecnic/.test(profNorm) && /enferm/.test(profNorm)) || ['viviane', 'vilma', 'fernando'].includes(nomeNorm)) {
      return 'Téc. Enfermagem';
    }
    if ((/enferm/.test(profNorm) && !/tecnic/.test(profNorm)) || ['mariana vaz', 'jorge marcio', 'lucelia de abreu', 'renata celia'].includes(nomeNorm)) {
      return 'Enfermagem';
    }
  }
  return ['Médico', 'Enfermagem', 'Odontologia', 'Téc. Enfermagem'].includes(setorRaw) ? setorRaw : 'Médico';
}

function filtrarListaProfissionaisAtivos(listaRaw, mutiraoAtivo = isContextoMutiraoAtivoFront()) {
  const porSetorAtendimento = { 'Médico': [], 'Enfermagem': [], 'Odontologia': [], 'Téc. Enfermagem': [] };
  const porSetorTodosAtivos = { 'Médico': [], 'Enfermagem': [], 'Odontologia': [], 'Téc. Enfermagem': [] };
  (Array.isArray(listaRaw) ? listaRaw : []).forEach(p => {
    if (!p || p.ativo === false) return;
    const setor = normalizarSetorProfissionalFront(p);
    const nome = String(p.nome || '').trim();
    if (!nome || !porSetorTodosAtivos[setor]) return;
    if (!porSetorTodosAtivos[setor].includes(nome)) porSetorTodosAtivos[setor].push(nome);
    const regime = String(p.regime || 'fixo').toLowerCase();
    if (regime !== 'mutirao' || mutiraoAtivo) {
      if (!porSetorAtendimento[setor].includes(nome)) porSetorAtendimento[setor].push(nome);
    }
  });
  Object.keys(_PROFISSIONAIS_FALLBACK).forEach(s => {
    if (porSetorAtendimento[s].length === 0) {
      porSetorAtendimento[s] = [..._PROFISSIONAIS_FALLBACK[s]];
    }
    if (porSetorTodosAtivos[s].length === 0) {
      porSetorTodosAtivos[s] = [..._PROFISSIONAIS_FALLBACK[s]];
    }
  });
  return { porSetorAtendimento, porSetorTodosAtivos };
}

function atualizarSelectPreservandoValor(selectEl, opcoesHtml) {
  if (!selectEl) return;
  const valorAnterior = selectEl.value;
  selectEl.innerHTML = opcoesHtml;
  if (valorAnterior && Array.from(selectEl.options).some(o => o.value === valorAnterior || o.text === valorAnterior)) {
    selectEl.value = valorAnterior;
  }
}

function aplicarProfissionaisDinamicosNoSistema() {
  const mutiraoAtivo = isContextoMutiraoAtivoFront();
  const { porSetorAtendimento, porSetorTodosAtivos } = filtrarListaProfissionaisAtivos(_listaProfissionaisCadastro, mutiraoAtivo);

  ['Médico', 'Enfermagem', 'Odontologia', 'Téc. Enfermagem'].forEach(setor => {
    if (!SECTOR_CONFIG[setor]) return;
    const novaLista = porSetorAtendimento[setor];
    const mudou = JSON.stringify(SECTOR_CONFIG[setor].profissionais) !== JSON.stringify(novaLista);
    SECTOR_CONFIG[setor].profissionais = novaLista;

    const cfg = SECTOR_CONFIG[setor];
    if (setor !== 'Odontologia' && sectorFilters[cfg.key] && !novaLista.includes(sectorFilters[cfg.key])) {
      sectorFilters[cfg.key] = novaLista[0] || '';
    }
    const profSelEl = document.getElementById('profissional-' + cfg.key);
    if (profSelEl) {
      atualizarSelectPreservandoValor(profSelEl, novaLista.map(p => `<option value="${escapeText(p)}">${escapeText(p)}</option>`).join(''));
    }
    const filterBarEl = document.getElementById('filter-bar-' + cfg.key);
    if (filterBarEl && setor !== 'Odontologia') {
      const filtroAtual = sectorFilters[cfg.key] || '';
      const allBtn = `<button class="btn-filter${filtroAtual === '' ? ' active' : ''}" data-prof="" onclick="filterSector('${cfg.key}','')">📋 Todos</button>`;
      const btns = novaLista.map(p =>
        `<button class="btn-filter${filtroAtual === p ? ' active' : ''}" data-prof="${escapeText(p)}" onclick="filterSector('${cfg.key}','${p.replace(/'/g, "\\'")}')">${escapeText(p)}</button>`
      ).join('');
      filterBarEl.innerHTML = allBtn + btns;
    } else if (mudou && typeof initSectorScreens === 'function') {
      const screenEl = document.getElementById('screen-' + cfg.key);
      if (screenEl && !screenEl.querySelector('#profissional-' + cfg.key)) {
        initSectorScreens();
      }
    }
  });

  // Atualizar select de profissional na Recepção quando setor clínico estiver selecionado
  const setorRecepcao = document.getElementById('input-setor')?.value;
  if (['Médico', 'Enfermagem', 'Téc. Enfermagem'].includes(setorRecepcao)) {
    const inpProf = document.getElementById('input-profissional');
    if (inpProf && SECTOR_CONFIG[setorRecepcao]) {
      atualizarSelectPreservandoValor(
        inpProf,
        `<option value="">— Selecione o profissional —</option>` +
          SECTOR_CONFIG[setorRecepcao].profissionais.map(p => `<option value="${escapeText(p)}">${escapeText(p)}</option>`).join('')
      );
    }
  }

  // Atualizar selects amplos (Agendamentos, Histórico, Atendidos e Minha Fila Acolhimento) com todos os ativos (inclusive Mutirão)
  const todosClinicos = [
    ...porSetorTodosAtivos['Médico'],
    ...porSetorTodosAtivos['Enfermagem'],
    ...porSetorTodosAtivos['Odontologia']
  ];
  const todosUnicos = [...new Set(todosClinicos)];
  const todosComTec = [...new Set([...todosUnicos, ...porSetorTodosAtivos['Téc. Enfermagem']])];

  atualizarSelectPreservandoValor(
    document.getElementById('agend-profissional'),
    `<option value="">— Opcional —</option>` + todosUnicos.map(p => `<option value="${escapeText(p)}">${escapeText(p)}</option>`).join('')
  );
  atualizarSelectPreservandoValor(
    document.getElementById('hist-filtro-prof'),
    `<option value="">Todos</option>` + todosUnicos.map(p => `<option value="${escapeText(p)}">${escapeText(p)}</option>`).join('')
  );
  const extrasApoio = ['Vivi', 'Leandra'];
  const atendidosOpts = [...new Set([...todosComTec, ...extrasApoio])];
  atualizarSelectPreservandoValor(
    document.getElementById('filter-profissional'),
    `<option value="">Todos</option>` + atendidosOpts.map(p => `<option value="${escapeText(p)}">${escapeText(p)}</option>`).join('')
  );
  atualizarSelectPreservandoValor(
    document.getElementById('acol-minha-fila-prof'),
    `<option value="">— Profissional —</option>` + todosUnicos.map(p => `<option value="${escapeText(p)}">${escapeText(p)}</option>`).join('')
  );

  if (typeof window.atualizarProfissionaisSisregDinamicos === 'function') {
    window.atualizarProfissionaisSisregDinamicos(porSetorTodosAtivos);
  }
  if (typeof updateAll === 'function') updateAll();
}

async function carregarProfissionaisCache(incluirInativos = false) {
  try {
    const qs = incluirInativos ? '?incluir_inativos=1' : '';
    const r = await fetch(`${API_URL}/profissionais${qs}`);
    if (!r.ok) return;
    const list = await r.json();
    if (!Array.isArray(list)) return;
    if (!incluirInativos) {
      _listaProfissionaisCadastro = list;
    }
    profissionaisCache.clear();
    list.forEach(p => {
      if (p.nome && p.profissao && p.ativo !== false) {
        profissionaisCache.set(p.nome.trim(), p.profissao.trim());
      }
    });
    if (!incluirInativos) {
      aplicarProfissionaisDinamicosNoSistema();
    }
    return list;
  } catch(e) { /* silencioso */ }
}

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
  const data = document.getElementById('agend-filter-data')?.value || getDataHojeRecife();
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
  const hoje = getDataHojeRecife();
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

    return `<div class="agend-d1-card" style="border-left-color:${corTipo.color};">
      <!-- Thumbnail da imagem -->
      <div style="flex-shrink:0;width:62px;height:42px;border-radius:8px;overflow:hidden;border:1px solid var(--gray-200);">
        <img src="${imgSrc}" style="width:100%;height:100%;object-fit:cover;" alt="${escapeText(tipoLabel)}" />
      </div>
      <!-- Info do paciente -->
      <div style="flex:1;min-width:190px;">
        <div style="font-family:'Nunito',sans-serif;font-weight:900;font-size:14.5px;color:var(--blue-dark);margin-bottom:3px;">${escapeText(a.nome)}</div>
        <div style="font-size:12px;color:var(--gray-600);font-weight:700;display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
          <span>⏰ ${escapeText(a.horario || '-')}</span>
          <span>👨‍⚕️ ${escapeText(profCompleto)}</span>
          <span style="background:${corTipo.bg};color:${corTipo.color};padding:2px 8px;border-radius:999px;font-size:10.5px;font-weight:800;">${escapeText(tipoLabel)}</span>
          ${statusHtml}
        </div>
      </div>
      <!-- Ações -->
      <div class="agend-actions">
        <button type="button" class="agend-action-btn agend-action-btn--wa" onclick="openWaPreview(${a.id}, 'lembrete_d1')" title="Enviar Lembrete D-1 via WhatsApp">📲 Lembrete</button>
        <button type="button" class="agend-action-btn agend-action-btn--cancelar" onclick="abrirModalEditarEnvio(${a.id}, 'cancelado')" title="Cancelar Consulta">❌ Cancelar</button>
        <button type="button" class="agend-action-btn agend-action-btn--reagendar" onclick="abrirModalEditarEnvio(${a.id}, 'reagendado')" title="Reagendar Consulta">🔄 Reagendar</button>
        <button type="button" class="agend-action-btn agend-action-btn--icon" onclick="_waCurrentImageSrc=getImagemTipoConsulta('${(a.tipo_atendimento||'').replace(/'/g, "\\'")}','${(a.profissional||'').replace(/'/g, "\\'")}');copyWaImageToClipboard()" title="Copiar imagem de confirmação" aria-label="Copiar imagem de confirmação">🖼️</button>
        <button type="button" class="agend-action-btn agend-action-btn--icon agend-action-btn--delete" onclick="excluirLembreteD1(${a.id}, '${(a.nome||'').replace(/'/g, "\\'")}')" title="Excluir lembrete" aria-label="Excluir lembrete">🗑️</button>
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
    const statusCls = String(a.status || '').replace(/\s+/g,'_');
    const statusLabels = {
      pendente: '⏳ Pendente',
      lembrete_enviado: '📨 Lembrete Enviado',
      confirmado: '✅ Confirmado',
      reagendado: '🔄 Reagendado',
      realizado: '🎉 Realizado',
      faltou: '⚠️ Faltou',
      cancelado: '❌ Cancelado'
    };
    const statusLabel = statusLabels[statusCls] || a.status;

    let extraBtns = '';
    if (['pendente', 'lembrete_enviado', 'confirmado', 'reagendado'].includes(a.status)) {
      const nomeSafeAg = String(a.nome || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
      extraBtns += `<button type="button" class="agend-action-btn agend-action-btn--fila" onclick="enviarAgendamentoParaFila(${a.id},'${nomeSafeAg}',this)" title="Paciente chegou — enviar direto para a fila do setor">🏥 Enviar p/ Fila</button>`;
    }
    if (a.tipo_atendimento === 'Coleta de Sangue' && ['pendente', 'lembrete_enviado', 'confirmado'].includes(a.status)) {
      extraBtns += `
        <button type="button" class="agend-action-btn agend-action-btn--compareceu" onclick="updateAgendStatus(${a.id},'realizado')" title="Compareceu (Realizado)">✅ Compareceu</button>
        <button type="button" class="agend-action-btn agend-action-btn--faltou" onclick="updateAgendStatus(${a.id},'faltou')" title="Faltou">❌ Faltou</button>
      `;
    }

    return `<tr>
      <td>
        <div style="font-weight:900;color:#0f172a;">${escapeText(a.nome)}</div>
        <div style="font-size:11.5px;color:#475569;font-weight:700;">${escapeText(a.telefone || '-')}</div>
        <span style="font-size:10.5px;background:#e2e8f0;color:#1e293b;padding:2px 8px;border-radius:999px;font-weight:800;display:inline-block;margin-top:4px;">${escapeText(a.tipo_atendimento || 'Consulta')}</span>
      </td>
      <td style="font-weight:800;color:#1e293b;white-space:nowrap;">${escapeText(dataFmt)}</td>
      <td style="font-weight:800;color:#1d4ed8;white-space:nowrap;">${escapeText(a.horario || '-')}</td>
      <td style="font-weight:700;color:#334155;">${escapeText(a.profissional || '—')}</td>
      <td><span class="agend-status ${statusCls}">${escapeText(statusLabel)}</span></td>
      <td><div class="agend-actions">
        ${extraBtns}
        <button type="button" class="agend-action-btn agend-action-btn--wa" onclick="openWaPreview(${a.id})" title="Enviar WhatsApp">📲 WhatsApp</button>
        <button type="button" class="agend-action-btn agend-action-btn--reagendar" onclick="abrirModalEditarEnvio(${a.id}, 'reagendado')" title="Reagendar Consulta">🔄 Reagendar</button>
        <button type="button" class="agend-action-btn agend-action-btn--cancelar" onclick="abrirModalEditarEnvio(${a.id}, 'cancelado')" title="Cancelar Consulta">❌ Cancelar</button>
        <button type="button" class="agend-action-btn agend-action-btn--lembrete agend-action-btn--icon" onclick="updateAgendStatus(${a.id},'lembrete_enviado')" title="Marcar Lembrete Enviado" aria-label="Marcar lembrete enviado">📨</button>
        <button type="button" class="agend-action-btn agend-action-btn--confirm agend-action-btn--icon" onclick="updateAgendStatus(${a.id},'confirmado')" title="Confirmar Presença" aria-label="Confirmar agendamento">✅</button>
        <button type="button" class="agend-action-btn agend-action-btn--icon" onclick="abrirEdicaoAgendamento(${a.id}, '${a.nome.replace(/'/g,"\\'").trim()}', '${a.telefone.replace(/'/g,"\\'").trim()}')" title="Editar Nome/Telefone" aria-label="Editar agendamento">✏️</button>
        <button type="button" class="agend-action-btn agend-action-btn--icon agend-action-btn--delete" onclick="deleteAgendamento(${a.id})" title="Apagar Registro do Banco" aria-label="Apagar agendamento">🗑️</button>
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

// ====== PDF & CSV ATENDIDOS ======
function generatePDF() {
  const listaExport = typeof obterAtendidosVisiveis === 'function' ? obterAtendidosVisiveis() : attendedPatients;
  if (!listaExport.length) { showToast('Não há pacientes para exportar.', true); return; }
  if (!window.jspdf || !window.jspdf.jsPDF) { showToast('Carregando biblioteca PDF...', true); return; }
  const { jsPDF } = window.jspdf; const doc = new jsPDF('l'); // Landscape
  doc.setFont('helvetica','bold'); doc.setFontSize(18); doc.text('Relatório de Atendimentos', 148, 15, { align: 'center' });
  doc.setFontSize(11); doc.setFont('helvetica','normal');
  const dataRef = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Recife' }).format(new Date());
  doc.text(`USF Chico Mendes | Emitido em: ${dataRef} | Registros: ${listaExport.length}`, 148, 22, { align: 'center' });
  const data = [...listaExport].sort((a,b) => new Date(a.created_at) - new Date(b.created_at)).map((p, i) => {
    let condLabel = '-';
    try { const arr = JSON.parse(p.condicoes_especiais||'[]'); condLabel = arr.map(c => c==='hipertenso'?'HAS':c==='diabetico'?'DM':c==='gestante'?'GEST':c).join(', ') || '-'; } catch {}
    const risco = p.gravidade_final || p.risco_clinico || '-';
    const agend = p.agendamento_realizado ? 'Sim' : 'Não';
    return [i + 1, p.nome, p.cpf || '-', p.setor, safeDate(p.created_at).toLocaleString('pt-BR',{timeZone:'America/Recife',day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}), p.queixa || '-', risco, p.profissional || p.medico || '-', agend, condLabel];
  });
  doc.autoTable({ startY: 30, head: [['Nº','Nome','CPF/SUS','Setor','Data/Hora','Queixa','Risco','Profissional','Agendado?','Condições']], body: data, theme: 'grid', headStyles: { fillColor: [26,79,196], fontSize: 8 }, bodyStyles: { fontSize: 8 }, alternateRowStyles: { fillColor: [240,244,255] }, columnStyles: { 0:{cellWidth:10}, 1:{cellWidth:35}, 4:{cellWidth:28}, 5:{cellWidth:40} } });
  const ds = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Recife' }).format(new Date()).replace(/\//g, '-');
  doc.save(`atendimentos_${ds}.pdf`); showToast('✅ PDF gerado com sucesso!');
}

function exportarAtendidosCSV() {
  const listaExport = typeof obterAtendidosVisiveis === 'function' ? obterAtendidosVisiveis() : attendedPatients;
  if (!listaExport.length) { showToast('Não há pacientes para exportar.', true); return; }
  const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  let csv = 'Nº,Nome,CPF/SUS,Setor,Data/Hora,Queixa,Risco,Profissional,Prioridade,Agendado?,Condições\n';
  const ordenado = [...listaExport].sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
  ordenado.forEach((p, i) => {
    let condLabel = '-';
    try { const arr = JSON.parse(p.condicoes_especiais||'[]'); condLabel = arr.map(c => c==='hipertenso'?'HAS':c==='diabetico'?'DM':c==='gestante'?'GEST':c).join(', ') || '-'; } catch {}
    const dtStr = p.created_at
      ? safeDate(p.created_at).toLocaleString('pt-BR',{timeZone:'America/Recife',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})
      : (p.horario_chamada || p.horario || '-');
    csv += [
      i + 1,
      esc(p.nome),
      esc(p.cpf || '-'),
      esc(p.setor),
      esc(dtStr),
      esc(p.queixa || '-'),
      esc(p.gravidade_final || p.risco_clinico || '-'),
      esc(p.profissional || p.medico || '-'),
      esc(p.prioridade === 'prioritario' ? (p.tipo_prioridade || 'Prioritário') : 'Geral'),
      esc(p.agendamento_realizado ? 'Sim' : 'Não'),
      esc(condLabel)
    ].join(',') + '\n';
  });
  const ds = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Recife' }).format(new Date()).replace(/\//g, '-');
  const blob = new Blob(["\ufeff", csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `atendimentos_${ds}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showToast('✅ Planilha CSV exportada com sucesso!');
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
    if (typeof salvarEspelhoFilaContingencia === 'function') salvarEspelhoFilaContingencia();
    
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

  const gridEl = document.querySelector('#screen-acolhimento .acol-stages-grid');
  if (gridEl) {
    const isSingle = ['recepcao', 'primeira_escuta', 'segunda_escuta'].includes(acolhimentoFilter);
    gridEl.classList.toggle('single-col', isSingle);
  }

  etapas.forEach(etapa => {
    let pacientes = (acolhimentoFluxo[etapa] || []).map((p, idx) => ({ ...p, _posOriginal: idx + 1 }));
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
    const posReal = p._posOriginal || (i + 1);
    const prioBadge = renderPrioridadeIdadeBadge(p);
    const waitBadge = renderEsperaNormalBadge(p);
    let chamadoTempoBadge = '';
    if (p.status === 'chamado' && (p.updated_at || p.created_at)) {
      const minsChamado = Math.floor((Date.now() - new Date(p.updated_at || p.created_at).getTime()) / 60000);
      if (minsChamado >= 5) {
        chamadoTempoBadge = `<div style="margin-top:3px;"><span style="display:inline-block;padding:2px 6px;border-radius:6px;background:rgba(239,68,68,0.14);color:#b91c1c;border:1px solid rgba(239,68,68,0.35);font-size:10.5px;font-weight:900;" title="Paciente chamado sem comparecimento até o momento">⏱️ Chamado há ${minsChamado} min</span></div>`;
      }
    }
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
    const nextBadge = (posReal === 1 && p.status !== 'chamado') ? '<span class="badge-proximo-fila">👉 Próximo</span>' : '';
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
      `;
    } else if (etapa === 'primeira_escuta') {
      actions = `
        <button class="acol-btn-action acol-btn-encaminhar" onclick="abrirModalEncaminhar(${p.id},'${nomeSafe}')">🔴 Encaminhar 2ª</button>
        <button class="acol-btn-action" style="background:var(--green);color:white;" onclick="finalizarAcsDireto(${p.id}, false, '${nomeSafe}')">✅ Finalizar</button>
        <button class="acol-btn-action" style="background:#1976d2;color:white;" onclick="abrirModalAgendamento(${p.id}, '${nomeSafe}', '${motivoTexto.replace(/'/g,"\\'")}')">🗂️ Agendar</button>
        <button class="btn-transfer-sector" onclick="event.stopPropagation();abrirModalEncaminharPublico(${p.id}, '${nomeSafe}', 'Acolhimento')">↗️ Setor</button>
      `;
    } else if (etapa === 'segunda_escuta') {
      actions = `
        <button class="acol-btn-action" style="background:linear-gradient(135deg,#c62828,#8e0000);color:white;font-weight:800;" onclick="abrirModalReencaminharEscuta2(${p.id},'${nomeSafe}')">🚨 Encaminhar (Intercorrência)</button>
        <button class="acol-btn-action acol-btn-finalizar" onclick="finalizarAtendimento(${p.id},'${nomeSafe}')">✅ Finalizar</button>
        <button class="btn-transfer-sector" onclick="event.stopPropagation();abrirModalEncaminharPublico(${p.id}, '${nomeSafe}', 'Acolhimento')">↗️ Outro Setor</button>
      `;
    }
    const adminBtns = isManagerOrAdmin() ? `
      <button class="btn-danger" style="font-size:11px;padding:4px 8px;" onclick="event.stopPropagation();removePatient(${p.id},'${nomeSafe}')" title="Desistência">🚶</button>
      ${isAdmin ? `<button class="btn-danger" style="font-size:11px;padding:4px 8px;background:rgba(0,0,0,0.1);color:var(--gray-600);" onclick="event.stopPropagation();deletePatientPermanently(${p.id},'${nomeSafe}')" title="Excluir">🔥</button>` : ''}
    ` : '';
    const originBadge = p.origem_transferencia ? `<span style="font-size:10px;color:#475569;background:#f1f5f9;padding:2px 6px;border-radius:4px;border:1px solid #cbd5e1;font-weight:700;">🔙 de: ${escapeText(p.origem_transferencia)}</span>` : '';
    const cardCls = ['acol-patient-card', posReal === 1 ? 'is-next' : '', p.status === 'chamado' ? 'is-calling' : ''].filter(Boolean).join(' ');
    const acolMgrBtns = isManagerOrAdmin()
      ? `<button type="button" class="btn-inline-mgr btn-inline-mgr--edit" onclick="event.stopPropagation();abrirModalEditarNomeFila(${p.id},'${nomeSafe}')" title="Editar nome (Gerente/Admin)">✏️</button> <button type="button" class="btn-inline-mgr btn-inline-mgr--prio${(p.prioridade==='prioritario'||Number(p.nivel_prioridade)<=2)?' ativo':''}" onclick="event.stopPropagation();abrirModalPrioridadePorId(${p.id})" title="Alterar prioridade (Gerente/Admin)">⭐</button>`
      : '';

    return `<div class="${cardCls}">
      <div class="acol-card-top">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span class="fila-pos-badge">${posReal}º</span>
          <span style="font-size:11.5px;color:#64748b;font-weight:700;">🕐 ${p.horario || ''}</span>
          ${tempoBadge}
          ${waitBadge}
        </div>
        <div style="display:flex;align-items:center;gap:4px;">
          ${nextBadge}${callingBadge}
        </div>
      </div>
      <div class="fila-paciente-nome" style="font-size:15px;">${escapeText(p.nome)} ${acolMgrBtns} ${prioBadge}</div>
      <div class="fila-paciente-sub" style="margin-top:4px;">
        ${equipeBadge}
        ${riscoBadge}
        ${condBadges}
        ${originBadge}
      </div>
      ${typeof renderPreviaReceitaBadgeLinha === 'function' ? renderPreviaReceitaBadgeLinha(p) : ''}
      ${(acsLabel || profLabel) ? `<div style="margin-top:5px;display:flex;flex-direction:column;gap:2px;">${acsLabel}${profLabel}</div>` : ''}
      ${intercorrenciaBadge ? `<div style="margin-top:4px;">${intercorrenciaBadge}</div>` : ''}
      ${queixaEl}${obs2El}${alumiaBloco}
      <div class="acol-card-actions">
        ${radarBtn}${typeof renderBotaoPreviaReceitaLinha === 'function' ? renderBotaoPreviaReceitaLinha(p, 'Acolhimento') : ''}${actions}${adminBtns}
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

// ====== EDITAR NOME DO PACIENTE (Modal limpo, disponível para equipe) ======
function editarNomeAcolhimento(id, nomeAtual) {
  abrirModalEditarNomeFila(id, nomeAtual);
}

// ====== DIRECIONAR PARA RECEPÇÃO FÍSICA (Indicador de Agendado) ======
async function direcionarParaRecepcaoFisica(id, nome) {
  if (!isManagerOrAdmin()) { showToast('🔒 Apenas gerentes ou administradores podem realizar esta ação!', true); return; }
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
    _pendingUserCallSpeakUntil = Date.now() + 8000;
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
  const observacao_segunda_escuta = (document.getElementById('acol-escuta2-obs-segunda')?.value || '').trim();
  const viewMotivo1Txt = (document.getElementById('acol-escuta2-view-motivo1')?.textContent || '').trim();
  const motivo_primeira_escuta = (viewMotivo1Txt && !viewMotivo1Txt.startsWith('Sem queixa')) ? viewMotivo1Txt : '';
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
        queixa,
        motivo_primeira_escuta: motivo_primeira_escuta || null,
        observacao_segunda_escuta: observacao_segunda_escuta || null,
        cpf,
        cartao_sus,
        condicoes_especiais
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

function formatarCondicoesAcolhimentoTexto(raw) {
  try {
    const arr = JSON.parse(raw || '[]');
    if (!Array.isArray(arr) || !arr.length) return '—';
    return arr.map(c => c === 'hipertenso' ? 'HAS' : c === 'diabetico' ? 'DM' : c === 'gestante' ? 'Gestante' : c === 'crianca_colo' ? 'Criança Colo' : c).join(', ');
  } catch {
    return '—';
  }
}

async function gerarRelatorioAcolhimento() {
  try {
    const r = await fetch(`${API_URL}/acolhimento/relatorio`);
    const data = await r.json();
    lastAcolhimentoReportData = data;
    
    const el = document.getElementById('acol-relatorio-content');
    const avgRec = data.tempoMedio?.avg_recepcao_min ? Math.round(data.tempoMedio.avg_recepcao_min) : '—';
    const avgEsc = data.tempoMedio?.avg_escuta_min ? Math.round(data.tempoMedio.avg_escuta_min) : '—';

    // Ativos por etapa
    let ativosHtml = '';
    if (data.ativos && data.ativos.length) {
      const etapas = {};
      data.ativos.forEach(a => {
        if (!etapas[a.etapa_fluxo]) etapas[a.etapa_fluxo] = 0;
        etapas[a.etapa_fluxo] += parseInt(a.total, 10);
      });
      const labels = { recepcao: '🟢 Recep.', primeira_escuta: '🟡 1ª Esc.', segunda_escuta: '🔴 2ª Esc.' };
      ativosHtml = Object.entries(etapas).map(([k, v]) => `${labels[k] || k}: <b>${v}</b>`).join(' · ');
    }

    let finalizadosHtml = '<div style="color:var(--gray-600);text-align:center;padding:14px;">Nenhum atendimento registrado hoje no Acolhimento.</div>';
    let countEscuta1 = 0;
    let countEscuta2 = 0;

    if (data.finalizados && data.finalizados.length) {
      data.finalizados.forEach(f => {
        if (f.gravidade_final || f.observacao_segunda_escuta || f.is_intercorrencia_acolhimento) countEscuta2++;
        else countEscuta1++;
      });

      finalizadosHtml = `
        <table style="width:100%;font-size:12px;border-collapse:collapse;text-align:left;">
          <thead>
            <tr style="border-bottom:2px solid var(--gray-200);background:#f1f5f9;">
              <th style="padding:8px;">Paciente</th>
              <th style="padding:8px;">💬 1ª Escuta (ACS)</th>
              <th style="padding:8px;">🩺 2ª Escuta (Profissional)</th>
              <th style="padding:8px;">Risco / Conduta</th>
              <th style="padding:8px;">ACS / Profissional</th>
              <th style="padding:8px;">Hora / Agend.</th>
            </tr>
          </thead>
          <tbody>
            ${data.finalizados.map(f => {
              const texto1 = (f.texto_primeira_escuta || f.motivo_primeira_escuta || f.queixa || '').trim() || '—';
              const texto2 = (f.texto_segunda_escuta || f.observacao_segunda_escuta || '').trim() || (f.is_intercorrencia_acolhimento ? 'Encaminhado como intercorrência' : '—');
              const riscoLabel = f.gravidade_final === 'vermelho' ? '🔴 Vermelho' : f.gravidade_final === 'amarelo' ? '🟡 Amarelo' : f.gravidade_final === 'verde' ? '🟢 Verde' : f.gravidade_final === 'azul' ? '🟦 Azul' : '🟡 1ª Escuta';
              const condLabel = formatarCondicoesAcolhimentoTexto(f.condicoes_especiais);
              const agendLabel = f.agendamento_realizado ? '✅ Agend.' : '—';
              const profTxt = f.profissional_exibicao || f.profissional || f.medico || '—';
              return `<tr style="border-bottom:1px solid #e2e8f0;vertical-align:top;">
                <td style="padding:8px;">
                  <b>${escapeText(f.nome)}</b>
                  ${f.equipe_paciente ? `<div style="font-size:10.5px;color:#1d4ed8;font-weight:700;">🏥 ${escapeText(f.equipe_paciente)}</div>` : ''}
                  <div style="font-size:10px;color:var(--gray-600);">CPF: ${escapeText(f.cpf || '-')} · Cond.: ${escapeText(condLabel)}</div>
                </td>
                <td style="padding:8px;max-width:220px;color:#0f172a;">${escapeText(texto1)}</td>
                <td style="padding:8px;max-width:220px;color:#9a3412;font-weight:600;">${escapeText(texto2)}</td>
                <td style="padding:8px;">${riscoLabel}</td>
                <td style="padding:8px;">
                  <div><b>ACS:</b> ${escapeText(f.acs_responsavel || '—')}</div>
                  <div style="font-size:11px;color:#334155;"><b>2ª:</b> ${escapeText(profTxt)}</div>
                </td>
                <td style="padding:8px;white-space:nowrap;">${escapeText(f.horario_chamada || '-')}<br><span style="font-size:11px;">${agendLabel}</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      `;
    }

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px;">
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;padding:14px;border-radius:12px;text-align:center;">
          <div style="font-size:28px;font-weight:900;color:var(--green);">${data.totalFinalizados}</div>
          <div style="font-size:11.5px;font-weight:800;color:#166534;text-transform:uppercase;">Atendimentos Hoje</div>
        </div>
        <div style="background:#eff6ff;border:1px solid #bfdbfe;padding:14px;border-radius:12px;text-align:center;">
          <div style="font-size:18px;font-weight:900;color:var(--blue-dark);">${countEscuta1} (1ª Esc.) · ${countEscuta2} (2ª Esc.)</div>
          <div style="font-size:11.5px;font-weight:800;color:#1e40af;text-transform:uppercase;">Fluxo 1ª &amp; 2ª Escuta</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px;">
        <div style="background:rgba(26,79,196,0.06);padding:11px 13px;border-radius:10px;font-size:13px;"><b>Ativos agora:</b> ${ativosHtml || '0'}</div>
        <div style="background:rgba(142,36,170,0.06);padding:11px 13px;border-radius:10px;font-size:13px;"><b>Tempos Médios:</b> ${avgRec}m recep. · ${avgEsc}m escuta</div>
      </div>
      <div style="border-top:2px solid var(--gray-200);padding-top:14px;">
        <h4 style="margin-bottom:10px;color:var(--blue-dark);display:flex;justify-content:space-between;align-items:center;">📋 Detalhamento Completo (1ª Escuta + 2ª Escuta)</h4>
        <div style="max-height:300px;overflow-y:auto;border:1px solid #cbd5e1;border-radius:10px;">${finalizadosHtml}</div>
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
  const doc = new jsPDF('landscape', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const dataHoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Recife' });
  const horaAgora = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Recife', hour: '2-digit', minute: '2-digit' });

  doc.setFillColor(109, 40, 217);
  doc.rect(0, 0, pageWidth, 24, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('Relatório Diário do Acolhimento — 1ª e 2ª Escuta', pageWidth / 2, 10.5, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(`USF Chico Mendes  |  Data: ${dataHoje}  |  Emitido às ${horaAgora}  |  Total de Atendimentos: ${d.totalFinalizados || 0}`, pageWidth / 2, 17.5, { align: 'center' });

  const lista = Array.isArray(d.finalizados) ? d.finalizados : [];
  let count1 = 0;
  let count2 = 0;
  lista.forEach(f => {
    if (f.gravidade_final || f.texto_segunda_escuta || f.observacao_segunda_escuta || f.is_intercorrencia_acolhimento) count2++;
    else count1++;
  });
  const avgRec = d.tempoMedio?.avg_recepcao_min ? Math.round(d.tempoMedio.avg_recepcao_min) : '-';
  const avgEsc = d.tempoMedio?.avg_escuta_min ? Math.round(d.tempoMedio.avg_escuta_min) : '-';

  doc.setTextColor(30, 41, 59);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(14, 28, pageWidth - 28, 12, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(
    `1ª Escuta Direta: ${count1}   |   Com 2ª Escuta / Conduta Clínica: ${count2}   |   Tempo Médio Recepção: ${avgRec} min   |   Tempo Médio Escuta: ${avgEsc} min`,
    pageWidth / 2,
    35.5,
    { align: 'center' }
  );

  const finalizadosData = lista.map((f, idx) => {
    const condLabel = formatarCondicoesAcolhimentoTexto(f.condicoes_especiais);
    const escuta1 = (f.texto_primeira_escuta || f.motivo_primeira_escuta || f.queixa || '').trim() || 'Não informado';
    const escuta2 = (f.texto_segunda_escuta || f.observacao_segunda_escuta || '').trim() ||
      (f.is_intercorrencia_acolhimento ? `Encaminhado p/ ${f.setor_destino_paciente || 'setor'} (Intercorrência)` : 'Sem registro na 2ª Escuta');
    const risco = f.gravidade_final
      ? `${String(f.gravidade_final).toUpperCase()}${f.is_intercorrencia_acolhimento ? ' (Interc.)' : ''}`
      : (f.is_intercorrencia_acolhimento ? 'INTERCORRÊNCIA' : '1ª ESCUTA');
    const profTxt = f.profissional_exibicao || f.profissional || f.medico || '-';
    const pacCol = `${f.nome || '-'}\n${f.equipe_paciente || 'Sem equipe'}${f.cpf ? ' · CPF: ' + f.cpf : ''}`;
    const equipeAtendCol = `ACS: ${f.acs_responsavel || '-'}\n2ª Esc.: ${profTxt}`;
    const statusCol = `${f.horario_chamada || '-'}\nAgend: ${f.agendamento_realizado ? 'Sim' : 'Não'}\nCond: ${condLabel}`;
    return [idx + 1, pacCol, escuta1, escuta2, risco, equipeAtendCol, statusCol];
  });

  if (finalizadosData.length === 0) {
    finalizadosData.push(['-', 'Nenhum atendimento finalizado hoje', '-', '-', '-', '-', '-']);
  }

  doc.autoTable({
    startY: 44,
    head: [['Nº', 'Paciente / Equipe', '1ª Escuta (ACS)', '2ª Escuta (Profissional)', 'Risco / Conduta', 'Profissionais', 'Hora / Status']],
    body: finalizadosData,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2.5, overflow: 'linebreak', valign: 'top' },
    headStyles: { fillColor: [109, 40, 217], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 245, 255] },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 44 },
      2: { cellWidth: 66 },
      3: { cellWidth: 66 },
      4: { cellWidth: 26, halign: 'center' },
      5: { cellWidth: 34 },
      6: { cellWidth: 24 }
    },
    margin: { left: 14, right: 14 }
  });

  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(100, 116, 139);
    doc.text(`USF Chico Mendes — Relatório do Acolhimento (1ª & 2ª Escuta) | Página ${i} de ${totalPages}`, pageWidth / 2, pageHeight - 6, { align: 'center' });
  }

  doc.save(`acolhimento_relatorio_${dataHoje.replace(/\//g, '-')}.pdf`);
  showToast('✅ PDF completo do Acolhimento gerado com sucesso!');
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
  const hoje = getDataHojeRecife();
  el.style.borderColor = el.value >= hoje ? 'var(--green)' : '#f4821e';
}



// ====== TELA ACS – 1ª ESCUTA ======
const ACS_LIST = [
  'Ana Paula',
  'Ana Lúcia',
  'Lenilda',
  'Conceição',
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
    <div class="pec-forms-bar" style="margin-bottom:14px;">
      <span class="pec-forms-title">🖨️ Formulário do ACS:</span>
      <button type="button" class="pec-form-btn" onclick="abrirDeclaracaoResidenciaAcs('', false)">🏠 Declaração de Residência</button>
      <button type="button" class="pec-form-btn branco" onclick="abrirDeclaracaoResidenciaAcs('', true)">📃 Em Branco</button>
      <span class="pec-forms-sep"></span>
      <button type="button" class="pec-form-btn devolucao" onclick="abrirModalDevolucoesProfissional('ACS')" title="Ver e responder devoluções do SISREG (endereço/cadastro)">↩️ Devoluções SISREG <span class="sisreg-dev-count sisreg-dev-badge-setor" data-setor="ACS" style="display:none;">0</span></button>
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
    let chamadoTempoBadge = '';
    if (p.status === 'chamado' && (p.updated_at || p.created_at)) {
      const minsChamado = Math.floor((Date.now() - new Date(p.updated_at || p.created_at).getTime()) / 60000);
      if (minsChamado >= 5) {
        chamadoTempoBadge = `<div style="margin-top:3px;"><span style="display:inline-block;padding:2px 6px;border-radius:6px;background:rgba(239,68,68,0.14);color:#b91c1c;border:1px solid rgba(239,68,68,0.35);font-size:10.5px;font-weight:900;" title="Paciente chamado sem comparecimento até o momento">⏱️ Chamado há ${minsChamado} min</span></div>`;
      }
    }
                const equipeBadge = renderEquipePacienteBadge(p);
                const riscoBadge = p.risco_clinico && p.risco_clinico !== 'verde'
                  ? `<span class="acol-risco-badge ${p.risco_clinico}">${p.risco_clinico === 'vermelho' ? '🔴' : p.risco_clinico === 'amarelo' ? '🟡' : '🟦'}</span>` : '';
                const tempoMin = p.inicio_etapa ? Math.round((Date.now() - new Date(p.inicio_etapa).getTime()) / 60000) : Math.round((Date.now() - new Date(p.created_at).getTime()) / 60000);
                const condBadges = renderCondicoesBadges(p.condicoes_especiais);
                const radarBtn = !p.busca_ativa ? renderBotaoBuscaAtivaCard(p, 'ACS - 1ª Escuta') : '';
                const alumiaBloco = renderBlocoBuscaAtivaEquipe(p, 'ACS - 1ª Escuta');
                const motivo1 = (p.motivo_primeira_escuta || p.queixa || '').trim();
                const adminBtns = isManagerOrAdmin() ? `
                  <button class="btn-danger" style="font-size:11px;padding:4px 8px;" onclick="event.stopPropagation();removePatient(${p.id},'${nomeSafe}')" title="Desistência">🚶</button>
                ` : '';

                return `<tr class="${p.status === 'chamado' ? 'row-calling' : ''}">
                  <td class="fila-pos-cell">
                    <div class="fila-pos-badge">${idx + 1}º</div>
                    <div style="font-size:11px;color:#64748b;font-weight:700;margin-top:4px;">🕐 ${p.horario || ''}</div>
                    <div style="margin-top:3px;"><span class="acol-tempo-badge">⏱ ${tempoMin}m</span> ${waitBadge}</div>
                  </td>
                  <td>
                    <div class="fila-paciente-nome">${escapeText(p.nome)} ${isManagerOrAdmin() ? `<button type="button" class="btn-inline-mgr btn-inline-mgr--edit" onclick="event.stopPropagation();abrirModalEditarNomeFila(${p.id},'${nomeSafe}')" title="Editar nome (Gerente/Admin)">✏️</button>` : ''} ${prioBadge} ${isManagerOrAdmin() ? `<button type="button" class="btn-inline-mgr btn-inline-mgr--prio${(p.prioridade==='prioritario'||Number(p.nivel_prioridade)<=2)?' ativo':''}" onclick="event.stopPropagation();abrirModalPrioridadePorId(${p.id})" title="Alterar prioridade (Gerente/Admin)">⭐</button>` : ''}</div>
                    <div class="fila-paciente-sub">${equipeBadge} ${riscoBadge} ${condBadges}</div>
                    ${typeof renderPreviaReceitaBadgeLinha === 'function' ? renderPreviaReceitaBadgeLinha(p) : ''}
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
                      ${typeof renderBotaoPreviaReceitaLinha === 'function' ? renderBotaoPreviaReceitaLinha(p, 'Acolhimento') : ''}
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
    let chamadoTempoBadge = '';
    if (p.status === 'chamado' && (p.updated_at || p.created_at)) {
      const minsChamado = Math.floor((Date.now() - new Date(p.updated_at || p.created_at).getTime()) / 60000);
      if (minsChamado >= 5) {
        chamadoTempoBadge = `<div style="margin-top:3px;"><span style="display:inline-block;padding:2px 6px;border-radius:6px;background:rgba(239,68,68,0.14);color:#b91c1c;border:1px solid rgba(239,68,68,0.35);font-size:10.5px;font-weight:900;" title="Paciente chamado sem comparecimento até o momento">⏱️ Chamado há ${minsChamado} min</span></div>`;
      }
    }
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
      const adminBtns = isManagerOrAdmin() ? `
        <button class="btn-danger" style="font-size:11px;padding:4px 8px;" onclick="event.stopPropagation();removePatient(${p.id},'${nomeSafe}')" title="Desistência">🚶</button>
      ` : '';

      return `<tr class="${p.status === 'chamado' ? 'row-calling' : ''}">
        <td class="fila-pos-cell">
          <div class="fila-pos-badge">${idx + 1}º</div>
          <div style="font-size:11px;color:#64748b;font-weight:700;margin-top:4px;">🕐 ${p.horario || ''}</div>
          <div style="margin-top:3px;"><span class="acol-tempo-badge">⏱ ${tempoMin}m</span> ${waitBadge}</div>
        </td>
        <td>
          <div class="fila-paciente-nome">${escapeText(p.nome)} ${isManagerOrAdmin() ? `<button type="button" class="btn-inline-mgr btn-inline-mgr--edit" onclick="event.stopPropagation();abrirModalEditarNomeFila(${p.id},'${nomeSafe}')" title="Editar nome (Gerente/Admin)">✏️</button>` : ''} ${prioBadge} ${isManagerOrAdmin() ? `<button type="button" class="btn-inline-mgr btn-inline-mgr--prio${(p.prioridade==='prioritario'||Number(p.nivel_prioridade)<=2)?' ativo':''}" onclick="event.stopPropagation();abrirModalPrioridadePorId(${p.id})" title="Alterar prioridade (Gerente/Admin)">⭐</button>` : ''}</div>
          <div class="fila-paciente-sub">${equipeBadge} ${riscoBadge} ${condBadges}</div>
          ${typeof renderPreviaReceitaBadgeLinha === 'function' ? renderPreviaReceitaBadgeLinha(p) : ''}
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
            ${typeof renderBotaoPreviaReceitaLinha === 'function' ? renderBotaoPreviaReceitaLinha(p, 'Acolhimento') : ''}
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
    _pendingUserCallSpeakUntil = Date.now() + 8000;
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
// Dados protegidos são carregados após validação de sessão em checkGateSession() / tentarEntrar() / iniciarCarregamentoModoTV()

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
function getDataHojeRecifeFront() {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Recife',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
  } catch (e) {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}

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

function voltarHojeCtrlAgendamentos() {
  const hoje = getDataHojeRecifeFront();
  ctrlAgendDateFilter = hoje;
  const input = document.getElementById('ctrl-agend-date-filter');
  if (input) input.value = hoje;
  loadCtrlAgendamentos();
}

function verTodosCtrlAgendamentos() {
  ctrlAgendDateFilter = 'todos';
  const input = document.getElementById('ctrl-agend-date-filter');
  if (input) input.value = '';
  loadCtrlAgendamentos();
}

// Inicializar o date input com a data de hoje (fuso Recife)
(function initCtrlAgendDateFilter() {
  const input = document.getElementById('ctrl-agend-date-filter');
  if (input && !input.value) {
    input.value = getDataHojeRecifeFront();
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

function obterCtrlAgendamentosFiltrados() {
  let lista = Array.isArray(ctrlAgendamentos) ? ctrlAgendamentos : [];
  if (ctrlAgendFiltro !== 'todos') {
    lista = lista.filter(a => a.status === ctrlAgendFiltro);
  }
  const busca = (document.getElementById('ctrl-agend-search')?.value || '').trim().toLowerCase();
  if (busca) {
    lista = lista.filter(a => {
      const txt = `${a.nome || ''} ${a.cpf6 || ''} ${a.queixa || ''} ${a.equipe || ''} ${a.motivo || ''}`.toLowerCase();
      return txt.includes(busca);
    });
  }
  const eqFilter = document.getElementById('ctrl-agend-equipe-filter')?.value || 'all';
  if (eqFilter === 'sem_equipe') {
    lista = lista.filter(a => !a.equipe || !String(a.equipe).trim());
  } else if (eqFilter && eqFilter !== 'all') {
    lista = lista.filter(a => String(a.equipe || '').trim() === eqFilter);
  }
  const motFilter = document.getElementById('ctrl-agend-motivo-filter')?.value || 'all';
  if (motFilter && motFilter !== 'all') {
    lista = lista.filter(a => String(a.motivo || '').trim() === motFilter);
  }
  return lista;
}

function copiarTextoRapidoCtrl(encodedVal, label = 'Dado') {
  const txt = decodeURIComponent(encodedVal || '');
  if (!txt) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(() => showToast(`📋 ${label} copiado: ${txt}`)).catch(() => showToast('Não foi possível copiar', true));
  } else {
    showToast(`${label}: ${txt}`);
  }
}

function formatarTempoEsperaCtrl(criadoEm) {
  if (!criadoEm) return '';
  const dt = new Date(criadoEm);
  if (Number.isNaN(dt.getTime())) return '';
  const diffMin = Math.max(0, Math.round((Date.now() - dt.getTime()) / 60000));
  if (diffMin < 60) return `${diffMin} min`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return `${h}h${m > 0 ? String(m).padStart(2, '0') : ''}`;
}

function abrirModalNovoCtrlAdmin() {
  if (!isAdmin) {
    showToast('🔒 Registro manual é exclusivo do Administrador. Todos os agendamentos devem passar pela 1ª Escuta.', true);
    return;
  }
  const agoraRecife = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Recife', hour: '2-digit', minute: '2-digit' });
  const elNome = document.getElementById('novo-ctrl-nome');
  const elHora = document.getElementById('novo-ctrl-horario');
  const elMotivo = document.getElementById('novo-ctrl-motivo');
  const elQueixa = document.getElementById('novo-ctrl-queixa');
  const elEquipe = document.getElementById('novo-ctrl-equipe');
  const elCpf = document.getElementById('novo-ctrl-cpf6');
  if (elNome) elNome.value = '';
  if (elHora) elHora.value = agoraRecife;
  if (elMotivo) elMotivo.value = '';
  if (elQueixa) elQueixa.value = '';
  if (elEquipe) elEquipe.value = '';
  if (elCpf) elCpf.value = '';
  document.getElementById('modal-novo-ctrl-admin')?.classList.add('show');
  setTimeout(() => elNome?.focus(), 60);
}

function fecharModalNovoCtrlAdmin() {
  document.getElementById('modal-novo-ctrl-admin')?.classList.remove('show');
}

async function salvarNovoCtrlAdmin() {
  if (!isAdmin) {
    showToast('🔒 Ação exclusiva do Administrador.', true);
    return;
  }
  const nome = (document.getElementById('novo-ctrl-nome')?.value || '').trim();
  const horario = (document.getElementById('novo-ctrl-horario')?.value || '').trim();
  const motivo = document.getElementById('novo-ctrl-motivo')?.value || null;
  const queixa = (document.getElementById('novo-ctrl-queixa')?.value || '').trim() || null;
  const equipe = document.getElementById('novo-ctrl-equipe')?.value || null;
  const cpf6 = (document.getElementById('novo-ctrl-cpf6')?.value || '').trim() || null;
  if (!nome || !horario) {
    showToast('Informe nome e horário.', true);
    return;
  }
  pedirSenhaAdmin('Confirmar Registro Manual na Sala de Agendamento', async (senhaUsada) => {
    try {
      const r = await fetch(`${API_URL}/ctrl-agendamentos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome,
          horario,
          motivo,
          queixa,
          equipe,
          cpf6,
          setor_origem: 'Admin (Manual)',
          origem_manual: true,
          senha: senhaUsada
        })
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || 'Erro ao salvar registro manual');
      }
      fecharModalNovoCtrlAdmin();
      showToast(`✅ ${nome} adicionado à Sala de Agendamento (Admin)`);
      await loadCtrlAgendamentos();
    } catch (e) {
      showToast(e.message || 'Erro ao salvar', true);
    }
  });
}

function renderCtrlAgendamentos() {
  const tbody = document.getElementById('ctrl-agend-tbody');
  if (!tbody) return;

  const lista = obterCtrlAgendamentosFiltrados();

  if (!lista.length) {
    const msg = ctrlAgendFiltro === 'pendente'
      ? '✅ Nenhum paciente pendente nos filtros atuais!'
      : ctrlAgendFiltro === 'agendado'
        ? '⏳ Nenhum agendamento realizado encontrado.'
        : '📂 Nenhum paciente encontrado na Sala de Agendamento.';
    tbody.innerHTML = `<tr><td colspan="5" style="padding:40px;text-align:center;color:var(--gray-600);font-size:14px;font-weight:600;">${msg}</td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map(a => {
    const isPendente = a.status === 'pendente';
    const badge = isPendente
      ? `<span class="ctrl-badge-pendente">⏳ Pendente</span>`
      : `<span class="ctrl-badge-agendado">✅ Agendado</span>`;
    const btnToggle = isPendente
      ? `<button class="ctrl-btn-toggle ctrl-btn-marcar" onclick="toggleCtrlAgendamento(${a.id}, this)">✅ Marcar Agendado</button>`
      : `<button class="ctrl-btn-toggle ctrl-btn-desfazer" onclick="toggleCtrlAgendamento(${a.id}, this)">↩ Desfazer</button>`;
    const dataStr = formatarDataHoraRecifeCtrl(a.criado_em);
    const esperaStr = isPendente ? formatarTempoEsperaCtrl(a.criado_em) : '';
    const esperaBadge = esperaStr
      ? `<div style="margin-top:3px;"><span style="font-size:10.5px;font-weight:800;padding:1px 7px;border-radius:999px;background:#fef3c7;color:#92400e;">⏱️ ${escapeText(esperaStr)}</span></div>`
      : '';
    const copyNomeBtn = `<button type="button" onclick="copiarTextoRapidoCtrl('${encodeURIComponent(a.nome || '')}','Nome')" title="Copiar nome p/ PEC" style="border:1px solid #cbd5e1;background:#f8fafc;color:#334155;border-radius:6px;padding:1px 6px;font-size:11px;cursor:pointer;margin-left:6px;font-weight:700;">📋 Nome</button>`;
    const copyCpfBtn = a.cpf6
      ? `<button type="button" onclick="copiarTextoRapidoCtrl('${encodeURIComponent(a.cpf6)}','CPF')" title="Copiar CPF p/ PEC" style="border:1px solid #cbd5e1;background:#f8fafc;color:#334155;border-radius:6px;padding:1px 6px;font-size:10.5px;cursor:pointer;margin-left:4px;font-weight:700;">📋 CPF: ${escapeText(a.cpf6)}</button>`
      : '';
    const equipePill = a.equipe
      ? `<span style="display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;font-weight:800;background:#e0e7ff;color:#1e40af;">🏥 ${escapeText(a.equipe)}</span>`
      : '';
    const motivoPill = a.motivo
      ? `<span style="display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:800;background:#ecfeff;color:#0e7490;margin-right:4px;">${escapeText(a.motivo)}</span>`
      : '';
    const origemPill = `<span style="display:inline-block;padding:1px 7px;border-radius:999px;font-size:10.5px;font-weight:700;background:#f1f5f9;color:#475569;">📍 ${escapeText(a.setor_origem || '1ª Escuta')}</span>`;
    const delBtn = `<button class="ctrl-btn-toggle" style="background:rgba(229,57,53,0.1);color:#e53935;border:1px solid rgba(229,57,53,0.3);padding:5px 9px;" onclick="removerCtrlAgendamento(${a.id}, this)" title="Desistência / Excluir">🗑️</button>`;
    const escAttr = v => escapeText(String(v || '')).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const safeNome = escAttr(a.nome);
    const safeEquipe = escAttr(a.equipe);
    const safeMotivo = escAttr(a.motivo || a.queixa || 'Consulta');
    return `
      <tr class="ctrl-agend-row status-${a.status}" style="border-bottom:1px solid #e2e8f0;${!isPendente ? 'opacity:0.78;background:#f8fafc;' : ''}">
        <td style="padding:12px 14px;font-weight:800;color:#0f172a;white-space:nowrap;vertical-align:middle;">
          <div style="font-size:13.5px;color:var(--blue-dark);">${escapeText(a.horario || '-')}</div>
          <div style="font-size:11px;color:#64748b;font-weight:700;">${escapeText(dataStr)}</div>
          ${esperaBadge}
        </td>
        <td style="padding:12px 14px;vertical-align:middle;">
          <div style="font-weight:800;color:#0f172a;font-size:14px;">${escapeText(a.nome)}${copyNomeBtn}</div>
          <div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;align-items:center;">${equipePill}${copyCpfBtn}</div>
        </td>
        <td style="padding:12px 14px;vertical-align:middle;">
          <div style="margin-bottom:4px;">${motivoPill}${origemPill}</div>
          <div style="font-size:12.5px;color:#334155;">${a.queixa ? escapeText(a.queixa) : '<span style="color:#94a3b8;font-style:italic;">Não informada</span>'}</div>
        </td>
        <td style="padding:12px 14px;text-align:center;vertical-align:middle;">${badge}</td>
        <td style="padding:12px 14px;text-align:center;vertical-align:middle;white-space:nowrap;">
          <div style="display:inline-flex;gap:4px;align-items:center;justify-content:center;flex-wrap:wrap;">
            ${btnToggle}
            <button class="ctrl-btn-toggle" style="background:rgba(230,126,34,0.12);color:#d35400;border:1px solid rgba(230,126,34,0.4);padding:5px 9px;" onclick="abrirEditarCtrlAgendamento(${a.id})" title="Editar registro">✏️ Editar</button>
            <button class="ctrl-btn-toggle" style="background:#25d366;color:#fff;border:none;padding:5px 9px;font-weight:700;" onclick="enviarWhatsAppCtrlAgendamento('${safeNome}', '${safeEquipe}', '${safeMotivo}')" title="Enviar WhatsApp de Confirmação em 1 Clique">📲 WhatsApp</button>
            <button class="ctrl-btn-toggle" style="background:rgba(26,79,196,0.1);color:#1a4fc4;border:1px solid rgba(26,79,196,0.3);padding:5px 9px;" onclick="chamarPacienteVoz('${safeNome}')" title="Chamar paciente via voz">📢 Chamar</button>
            ${delBtn}
          </div>
        </td>
      </tr>
    `;
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

  pedirSenhaGerenteOuAdmin('Editar Registro na Sala de Agendamento', async (senhaUsada) => {
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
      const r = await fetch(`${API_URL}/ctrl-agendamentos/${id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': senhaUsada
        },
        body: JSON.stringify({ senha: senhaUsada })
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || 'Erro ao excluir');
      }
      ctrlAgendamentos = ctrlAgendamentos.filter(a => a.id !== id);
      renderCtrlAgendamentos();
      updateCtrlAgendBadge();
      showToast('🗑️ Registro removido (Desistência)');
    } catch(e) {
      showToast(e.message || 'Erro ao excluir registro', true);
      if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
  });
}

function formatarDataHoraRecifeCtrl(criadoEm) {
  if (!criadoEm) return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Recife' }).format(new Date());
  const d = new Date(criadoEm);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Recife' }).format(d);
}

function exportarAgendamentosExcel() {
  pedirSenhaGerenteOuAdmin('Exportar Controle de Agendamentos (Excel/CSV)', () => {
    const lista = typeof obterCtrlAgendamentosFiltrados === 'function'
      ? obterCtrlAgendamentosFiltrados()
      : (ctrlAgendamentos || []);
    if (!lista || lista.length === 0) {
      showToast('Nenhum agendamento para exportar nos filtros atuais', true);
      return;
    }
    let csv = "Data,Hora,Paciente,Equipe,CPF,Motivo,Queixa,Origem,Status\n";
    const dataHoje = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Recife' }).format(new Date());
    lista.forEach(a => {
      const dataReg = formatarDataHoraRecifeCtrl(a.criado_em);
      const nome = `"${String(a.nome || '').replace(/"/g, '""')}"`;
      const equipe = `"${String(a.equipe || '').replace(/"/g, '""')}"`;
      const cpf = `"${String(a.cpf6 || '').replace(/"/g, '""')}"`;
      const motivo = `"${String(a.motivo || '').replace(/"/g, '""')}"`;
      const queixa = `"${String(a.queixa || '').replace(/"/g, '""')}"`;
      const origem = `"${String(a.setor_origem || '1ª Escuta').replace(/"/g, '""')}"`;
      const status = a.status === 'pendente' ? 'Pendente' : 'Agendado';
      csv += `${dataReg},${a.horario || '-'},${nome},${equipe},${cpf},${motivo},${queixa},${origem},${status}\n`;
    });

    const blob = new Blob(["\ufeff", csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Agendamentos_${dataHoje.replace(/\//g,'-')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('✅ Planilha CSV exportada com sucesso!');
  });
}

function exportarAgendamentosPDF() {
  pedirSenhaGerenteOuAdmin('Exportar Controle de Agendamentos (PDF)', () => {
    const lista = typeof obterCtrlAgendamentosFiltrados === 'function'
      ? obterCtrlAgendamentosFiltrados()
      : (ctrlAgendamentos || []);
    if (!lista || lista.length === 0) {
      showToast('Nenhum agendamento para exportar nos filtros atuais', true);
      return;
    }
    if (!window.jspdf || !window.jspdf.jsPDF) {
      showToast('Carregando biblioteca PDF...', true);
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('landscape', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const dataHoje = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Recife' }).format(new Date());
    const horaAgora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Recife', hour: '2-digit', minute: '2-digit' }).format(new Date());

    doc.setFillColor(15, 52, 145);
    doc.rect(0, 0, pageWidth, 24, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('Controle de Agendamentos (Acolhimento PEC Recife) — USF Chico Mendes', pageWidth / 2, 10.5, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(`Emitido em: ${dataHoje} às ${horaAgora}  |  Total de registros: ${lista.length}`, pageWidth / 2, 17.5, { align: 'center' });

    const bodyRows = lista.map((a, idx) => [
      idx + 1,
      formatarDataHoraRecifeCtrl(a.criado_em),
      a.horario || '-',
      a.nome || '-',
      a.equipe || '-',
      a.cpf6 || '-',
      [a.motivo, a.queixa].filter(Boolean).join(' — ') || '-',
      a.status === 'pendente' ? 'Pendente' : 'Agendado'
    ]);

    doc.autoTable({
      startY: 30,
      head: [['Nº', 'Data', 'Hora', 'Paciente', 'Equipe', 'CPF (6)', 'Motivo / Queixa (1ª & 2ª Escuta)', 'Status']],
      body: bodyRows,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2.5, overflow: 'linebreak' },
      headStyles: { fillColor: [26, 79, 196], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [240, 244, 255] },
      columnStyles: { 0: { cellWidth: 10, halign: 'center' }, 6: { cellWidth: 72 } },
      margin: { left: 14, right: 14 }
    });

    const equipeTotals = {};
    lista.forEach(a => {
      const eq = a.equipe || 'Sem Equipe';
      if (!equipeTotals[eq]) equipeTotals[eq] = { pendente: 0, agendado: 0, total: 0 };
      equipeTotals[eq].total++;
      if (a.status === 'pendente') equipeTotals[eq].pendente++;
      else equipeTotals[eq].agendado++;
    });

    const equipeKeys = Object.keys(equipeTotals).sort();
    if (equipeKeys.length > 0) {
      let nextY = (doc.lastAutoTable ? doc.lastAutoTable.finalY : 30) + 10;
      if (nextY > pageHeight - 40) { doc.addPage(); nextY = 20; }
      let grandPendente = 0, grandAgendado = 0, grandTotal = 0;
      const resumoRows = equipeKeys.map(eq => {
        const t = equipeTotals[eq];
        grandPendente += t.pendente;
        grandAgendado += t.agendado;
        grandTotal += t.total;
        return [eq, t.pendente, t.agendado, t.total];
      });
      resumoRows.push(['TOTAL GERAL', grandPendente, grandAgendado, grandTotal]);

      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11.5);
      doc.text('Resumo por Equipe', 14, nextY);
      doc.autoTable({
        startY: nextY + 4,
        head: [['Equipe', 'Pendentes', 'Agendados', 'Total']],
        body: resumoRows,
        theme: 'grid',
        headStyles: { fillColor: [15, 118, 110], textColor: 255, fontSize: 9 },
        bodyStyles: { fontSize: 8.5 },
        margin: { left: 14, right: 14 }
      });
    }

    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(100, 116, 139);
      doc.text(`USF Chico Mendes — Sala de Agendamento (PEC Recife) | Página ${i} de ${totalPages}`, pageWidth / 2, pageHeight - 6, { align: 'center' });
    }

    doc.save(`controle_agendamentos_${dataHoje.replace(/\//g, '-')}.pdf`);
    showToast('✅ PDF gerado com sucesso!');
  });
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
      showToast('🔴 Sem internet! Você ainda pode consultar ou imprimir a fila atual pelo botão Contingência.', true);
    } else if (estadoAnterior === 'offline' && estado === 'online') {
      showToast('🟢 Conexão restabelecida! Sincronizando cadastros offline e filas...');
      Promise.resolve()
        .then(() => typeof sincronizarFilaOfflinePendente === 'function' ? sincronizarFilaOfflinePendente(false) : null)
        .then(() => Promise.all([
          typeof loadQueues === 'function' ? loadQueues() : Promise.resolve(),
          typeof loadCurrentCalling === 'function' ? loadCurrentCalling() : Promise.resolve(),
          typeof loadHistory === 'function' ? loadHistory() : Promise.resolve(),
          typeof loadAcolhimentoFluxo === 'function' ? loadAcolhimentoFluxo() : Promise.resolve()
        ]))
        .catch(() => {});
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
  // ZERO polling sem autenticação (exceto TV), fora do expediente OU em pausa
  if ((!isGateAuthenticated && !isModoTV()) || isPausado || !isDentroDoHorario()) return;
  const emTelaTv = isModoTV() || Boolean(document.getElementById('screen-painel')?.classList.contains('active'));
  const interval1 = emTelaTv ? (document.hidden ? 6000 : 3500) : (document.hidden ? 30000 : 5000);
  pollingTimer1 = setTimeout(() => { loopData1(); }, interval1);
}

function startPolling2() {
  if (pollingTimer2) clearTimeout(pollingTimer2);
  // ZERO polling sem autenticação, fora do expediente OU em pausa
  if (!isGateAuthenticated || isPausado || !isDentroDoHorario()) return;
  const interval2 = document.hidden ? 60000 : 8000;
  pollingTimer2 = setTimeout(() => { loopData2(); }, interval2);
}

function startAdaptivePolling() {
  startPolling1();
  startPolling2();
}

async function loopData1() {
  if (!isGateAuthenticated && isModoTV()) {
    await Promise.all([
      loadCurrentCalling(), loadHistory(), loadPendingVoiceCalls()
    ].map(p => p.catch(() => {})));
    startPolling1();
    return;
  }
  if (!isGateAuthenticated) return;
  await Promise.all([
    loadQueues(), loadCurrentCalling(), loadHistory(), loadAttended(), loadAcolhimentoFluxo(), loadNotificacoes(), loadPendingVoiceCalls()
  ].map(p => p.catch(() => {})));
  startPolling1();
}

async function loopData2() {
  if (!isGateAuthenticated) return;
  await loadAllChannels().catch(() => {});
  startPolling2();
}

document.addEventListener('visibilitychange', startAdaptivePolling);

/* Eventos Socket.IO removidos para economia na Vercel */

function initAgendamentoDefaults() {
  const dataInput = document.getElementById('agend-data');
  if (dataInput && !dataInput.value) {
    dataInput.value = getDataHojeRecife();
  }
  const filterInput = document.getElementById('agend-filter-data');
  if (filterInput && !filterInput.value) {
    filterInput.value = getDataHojeRecife();
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
carregarStatusMutiraoHoje();
carregarStatusPausa();

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
  const painelAtivo = document.getElementById('screen-painel')?.classList.contains('active');
  if (!isTv && !painelAtivo) return; // Apenas executa a chamada na tela de TV
  if (_loadingPendingVoiceCalls) return;

  _loadingPendingVoiceCalls = true;
  try {
    const r = await fetch(`${API_URL}/voice-call/pending`);
    if (!r.ok) return;
    const calls = await r.json();
    for (const call of calls) {
      const cid = Number(call.id) || 0;
      if (call.nome === AVISO_SILENCIO_TOKEN || Boolean(AVISOS_INSTITUCIONAIS_CONFIG[call.nome])) {
        const callTs = call.created_at ? Date.parse(call.created_at) : Date.now();
        const ageMs = Number.isFinite(Number(call.age_ms)) ? Number(call.age_ms) : undefined;
        processarAvisoSilencioRemoto({
          id: cid,
          token: call.nome,
          ts: Number.isFinite(callTs) ? callTs : Date.now(),
          ageMs
        });
        continue;
      }
      if (cid > 0 && _processedVoiceCallIds.has(cid)) {
        await fetch(`${API_URL}/voice-call/${cid}/ack`, { method: 'POST' }).catch(() => {});
        continue;
      }
      if (cid > 0) {
        _processedVoiceCallIds.add(cid);
        if (_processedVoiceCallIds.size > 120) {
          const first = _processedVoiceCallIds.values().next().value;
          if (first !== undefined) _processedVoiceCallIds.delete(first);
        }
      }
      await fetch(`${API_URL}/voice-call/${cid}/ack`, { method: 'POST' }).catch(() => {});
      speakViaSynthesis(call.nome, call.setor, call.destino);
    }
  } catch (e) {
    console.error('Erro ao processar chamadas de voz pendentes:', e);
  } finally {
    _loadingPendingVoiceCalls = false;
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
    const vagasVal = Number(info.vagas || 0);
    const usadosVal = Number(info.usados || 0);
    const restantesVal = info.restantes !== undefined && info.restantes !== null
      ? Number(info.restantes)
      : (vagasVal - usadosVal);
    const pctOcupado = vagasVal > 0 ? Math.min(100, Math.round((usadosVal / vagasVal) * 100)) : 0;
    const barColor = pctOcupado >= 90 ? '#ef4444' : (pctOcupado >= 70 ? '#f59e0b' : '#22c55e');
    // Botão de excluir: só aparece se houver registro salvo (id existe)
    const deleteBtn = info.id
      ? `<button class="btn btn-sm" onclick="excluirVagaMedico(${info.id}, '${medico}')" style="background: rgba(229,57,53,0.15); color: var(--red); border: 1px solid rgba(229,57,53,0.3); font-size: 11px; padding: 6px; border-radius: 6px; font-weight: 700; cursor: pointer; width: 100%; margin-top: 4px;" title="Excluir registro de vagas (permite refazer)">🗑️ Excluir Vagas</button>`
      : '';

    return `
      <div class="card-white" style="padding: 16px; border: 1px solid rgba(255,255,255,0.12); display: flex; flex-direction: column; gap: 10px; background: rgba(255,255,255,0.05); border-radius: 12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <div style="font-weight: 800; font-size: 15px; color: var(--orange);">${medico}</div>
          <span style="font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,0.08);color:${barColor};">${vagasVal > 0 ? pctOcupado + '% ocupado' : 'Sem cota'}</span>
        </div>
        <div style="width:100%;height:7px;background:rgba(255,255,255,0.1);border-radius:999px;overflow:hidden;">
          <div style="width:${pctOcupado}%;height:100%;background:${barColor};border-radius:999px;transition:width .3s ease;"></div>
        </div>
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
  pedirSenhaGerenteOuAdmin(`Excluir Vagas de ${medico}`, async (senhaUsada) => {
    if (!confirm(`Deseja excluir o registro de vagas de ${medico}? Isso permite refazer o cadastro de vagas.`)) return;
    try {
      const r = await fetch(`${API_URL}/vagas-medicos/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': senhaUsada },
        body: JSON.stringify({ senha: senhaUsada })
      });
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

  pedirSenhaGerenteOuAdmin(`Salvar Vagas de ${medico}`, async (senhaUsada) => {
    try {
      const r = await fetch(`${API_URL}/vagas-medicos`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': senhaUsada },
        body: JSON.stringify({ medico, mes: parseInt(mes), ano: parseInt(ano), vagas, senha: senhaUsada })
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
  const doc = new jsPDF('landscape', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const dataFiltro = document.getElementById('agend-filter-data')?.value || '';
  const statusFiltro = document.getElementById('agend-filter-status')?.value || 'Todos';
  const dataRef = dataFiltro ? dataFiltro.split('-').reverse().join('/') : new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Recife' });
  const horaAgora = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Recife', hour: '2-digit', minute: '2-digit' });
  const statusTrad = { pendente: 'Pendente', lembrete_enviado: 'Lembrete Enviado', confirmado: 'Confirmado', reagendado: 'Reagendado', realizado: 'Realizado', faltou: 'Faltou', cancelado: 'Cancelado' };

  doc.setFillColor(15, 52, 145);
  doc.rect(0, 0, pageWidth, 24, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('Relatório de Agendamentos — USF Chico Mendes', pageWidth / 2, 10.5, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(`Data ref.: ${dataRef}  |  Status: ${statusTrad[statusFiltro] || statusFiltro || 'Todos'}  |  Total: ${_agendamentosAtuais.length}  |  Emitido às ${horaAgora}`, pageWidth / 2, 17.5, { align: 'center' });

  const rows = _agendamentosAtuais.map((a, i) => [
    i + 1,
    a.nome || '-',
    a.telefone || '-',
    a.data_agendamento ? String(a.data_agendamento).split('T')[0].split('-').reverse().join('/') : '-',
    a.horario || '-',
    a.profissional || '—',
    a.tipo_atendimento || 'Consulta',
    statusTrad[a.status] || a.status || '-'
  ]);

  doc.autoTable({
    startY: 30,
    head: [['Nº', 'Paciente', 'Telefone', 'Data', 'Hora', 'Profissional', 'Tipo', 'Status']],
    body: rows,
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 2.5, overflow: 'linebreak' },
    headStyles: { fillColor: [26, 79, 196], textColor: 255, fontSize: 9, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [240, 244, 255] },
    columnStyles: { 0: { cellWidth: 10, halign: 'center' }, 3: { cellWidth: 24, halign: 'center' }, 4: { cellWidth: 16, halign: 'center' } },
    margin: { left: 14, right: 14 }
  });

  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(100, 116, 139);
    doc.text(`USF Chico Mendes — Agenda de Consultas | Página ${i} de ${totalPages}`, pageWidth / 2, pageHeight - 6, { align: 'center' });
  }

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
  const doc = new jsPDF('portrait', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.setFillColor(15, 52, 145);
  doc.rect(0, 0, pageWidth, 24, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14.5);
  doc.text('Relatório de Mensagens Enviadas (WhatsApp)', pageWidth / 2, 10.5, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(`USF Chico Mendes  |  Data: ${dataFmt}  |  Total de Disparos: ${rel.total}`, pageWidth / 2, 17.5, { align: 'center' });

  const rows = (rel.porProfissional || []).map((p, i) => [i + 1, p.profissional, p.total]);
  rows.push(['', 'TOTAL GERAL', rel.total]);
  doc.autoTable({
    startY: 32,
    head: [['Nº', 'Profissional', 'Mensagens Enviadas']],
    body: rows,
    theme: 'grid',
    headStyles: { fillColor: [26, 79, 196], textColor: 255, fontSize: 10 },
    bodyStyles: { fontSize: 9.5 },
    columnStyles: { 0: { cellWidth: 14, halign: 'center' }, 2: { cellWidth: 44, halign: 'center', fontStyle: 'bold' } },
    margin: { left: 14, right: 14 }
  });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(100, 116, 139);
  doc.text('USF Chico Mendes — Controle de Disparos WhatsApp | Página 1 de 1', pageWidth / 2, pageHeight - 6, { align: 'center' });

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
  if (el) el.value = getDataHojeRecife();
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

// Carregamento inicial movido para iniciarCarregamentoAutenticado()

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
    const headers = adminPassword ? { 'x-admin-password': adminPassword } : {};
    const r = await fetch(`${API_URL}/admin/relatorio-prioridade-busca?${params.toString()}`, {
      headers,
      credentials: 'same-origin'
    });
    if (r.status === 401 || r.status === 403) {
      contA.textContent = '🔒 Ative o Modo Administrador para visualizar este relatório.';
      contB.textContent = '🔒 Ative o Modo Administrador para visualizar este relatório.';
      return;
    }
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

  pedirSenhaGerenteOuAdmin('Adicionar Motivo de Busca Ativa', async (senhaUsada) => {
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

  pedirSenhaGerenteOuAdmin('Editar Motivo de Busca Ativa', async (senhaUsada) => {
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
  pedirSenhaGerenteOuAdmin(`${novoAtivo ? 'Reativar' : 'Desativar'} Motivo de Busca Ativa`, async (senhaUsada) => {
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

// ============================================================================
// BLOCO 3 — EDITAR NOME, PRIORIDADE NA FILA, TUBOS COLETA, AUSENTE E CHECK-IN
// ============================================================================

let _examesColetaRecepcao = null;
let _examesColetaTransfer = null;
let _tubosModalState = {
  contexto: 'recepcao', // 'recepcao' | 'transfer' | 'patient'
  patientId: null,
  exames: [],
  tubosManuais: {}, // { grupoId: qtd }
  perfis: []
};

function encontrarPacienteEmCachePorId(id) {
  const numId = Number(id);
  for (const s of SETORES) {
    const found = (queues[s] || []).find(p => Number(p.id) === numId);
    if (found) return found;
  }
  if (typeof acolhimentoFluxo === 'object' && acolhimentoFluxo) {
    for (const et of ['recepcao', 'primeira_escuta', 'segunda_escuta']) {
      const found = (acolhimentoFluxo[et] || []).find(p => Number(p.id) === numId);
      if (found) return found;
    }
  }
  return null;
}

// --- 1) EDITAR NOME DO PACIENTE NA FILA (Exclusivo Gerente / Admin) ---
function abrirModalEditarNomeFila(id, nomeAtual) {
  if (!isManagerOrAdmin()) {
    showToast('🔒 Apenas Gerente ou Administrador pode editar o nome do paciente.', true);
    return;
  }
  const modal = document.getElementById('rename-patient-modal');
  if (!modal) return;
  const p = encontrarPacienteEmCachePorId(id);
  const nomeReal = p?.nome || nomeAtual || '';
  document.getElementById('rename-patient-id').value = id;
  document.getElementById('rename-patient-atual').textContent = nomeReal;
  const inp = document.getElementById('rename-patient-input');
  inp.value = nomeReal;
  const motInp = document.getElementById('rename-patient-motivo');
  if (motInp) motInp.value = '';
  modal.classList.add('show');
  setTimeout(() => { inp.focus(); inp.select(); }, 80);
}

function fecharModalEditarNomeFila() {
  document.getElementById('rename-patient-modal')?.classList.remove('show');
}

async function confirmarEditarNomeFila() {
  if (!isManagerOrAdmin()) {
    showToast('🔒 Apenas Gerente ou Administrador pode editar o nome do paciente.', true);
    fecharModalEditarNomeFila();
    return;
  }
  const id = document.getElementById('rename-patient-id')?.value;
  const novoNome = (document.getElementById('rename-patient-input')?.value || '').trim();
  const motivo = (document.getElementById('rename-patient-motivo')?.value || '').trim();
  const btn = document.getElementById('rename-patient-btn-save');

  if (!id || novoNome.length < 2) {
    showToast('Digite o nome completo corrigido (mínimo 2 letras).', true);
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Salvando...'; }
  try {
    const hdrRename = { 'Content-Type': 'application/json' };
    if (adminPassword) hdrRename['x-admin-password'] = adminPassword;
    const r = await fetch(`${API_URL}/patients/${encodeURIComponent(id)}/rename`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: hdrRename,
      body: JSON.stringify({ novoNome, motivo: motivo || null, senha: adminPassword || undefined })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(d.error || 'Erro ao atualizar nome!');
    }
    fecharModalEditarNomeFila();
    showToast(`✅ Nome corrigido para "${novoNome}"!`);
    await Promise.all([
      loadQueues(),
      typeof loadAcolhimentoFluxo === 'function' ? loadAcolhimentoFluxo() : Promise.resolve(),
      typeof loadHistory === 'function' ? loadHistory() : Promise.resolve()
    ]);
  } catch (err) {
    showToast(err.message || 'Erro ao editar nome!', true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💾 Salvar Nome'; }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const rInp = document.getElementById('rename-patient-input');
  if (rInp) rInp.addEventListener('keydown', e => { if (e.key === 'Enter') confirmarEditarNomeFila(); });
});

// --- 2) ALTERAR / ACRESCENTAR PRIORIDADE NA FILA ---
function calcularRankPrevioFront(prioridadeVal, categoriaVal, idadeVal, condsArr) {
  const id = idadeVal !== '' && idadeVal !== null && idadeVal !== undefined ? Number(idadeVal) : null;
  const condStr = (condsArr || []).join(',').toLowerCase();
  const catStr = String(categoriaVal || '').toLowerCase();
  if ((id !== null && !isNaN(id) && id >= 80) || catStr.includes('1.') || catStr.includes('80+')) return 1;
  if (catStr.includes('2.') || catStr.includes('pcd') || catStr.includes('defic')) return 2;
  if (catStr.includes('3.') || catStr.includes('tea')) return 3;
  if (catStr.includes('4.') || catStr.includes('gestant') || condStr.includes('gestante')) return 4;
  if (catStr.includes('5.') || catStr.includes('lactant')) return 5;
  if ((id !== null && !isNaN(id) && id === 0) || catStr.includes('6.') || catStr.includes('colo') || condStr.includes('crianca_colo')) return 6;
  if (catStr.includes('7.') || catStr.includes('mobilid')) return 7;
  if (catStr.includes('8.') || catStr.includes('obesid')) return 8;
  if ((id !== null && !isNaN(id) && id >= 60) || catStr.includes('9.') || catStr.includes('60+')) return 9;
  if (catStr.includes('10.') || catStr.includes('doador')) return 10;
  return prioridadeVal === 'prioritario' ? 9 : 99;
}

function abrirModalPrioridadePorId(id) {
  if (!isManagerOrAdmin()) {
    showToast('🔒 Apenas Gerente ou Administrador pode alterar a prioridade de atendimento.', true);
    return;
  }
  const p = encontrarPacienteEmCachePorId(id);
  if (!p) {
    showToast('Paciente não encontrado na lista atual.', true);
    return;
  }
  abrirModalPrioridadeFila(p);
}

function abrirModalPrioridadeFila(p) {
  if (!isManagerOrAdmin()) {
    showToast('🔒 Apenas Gerente ou Administrador pode alterar a prioridade de atendimento.', true);
    return;
  }
  const modal = document.getElementById('priority-patient-modal');
  if (!modal || !p) return;
  document.getElementById('prio-modal-patient-id').value = p.id;
  document.getElementById('prio-modal-patient-name').textContent = `${p.nome} (${p.setor || 'Fila'})`;

  const rankAntes = Number(
    p.ordem_prioridade_odonto ||
    (Number(p.nivel_prioridade) === 1 ? 1 : (p.prioridade === 'prioritario' || Number(p.nivel_prioridade) === 2 ? 9 : 99))
  );
  document.getElementById('prio-modal-rank-antes').value = String(rankAntes);

  const ehPrio = p.prioridade === 'prioritario' || Number(p.nivel_prioridade) <= 2;
  document.getElementById('prio-modal-tipo').value = ehPrio ? 'prioritario' : 'geral';
  document.getElementById('prio-modal-idade').value = (p.idade !== null && p.idade !== undefined) ? String(p.idade) : '';

  const selCat = document.getElementById('prio-modal-categoria');
  if (p.tipo_prioridade && [...selCat.options].some(o => o.value === p.tipo_prioridade)) {
    selCat.value = p.tipo_prioridade;
  } else {
    selCat.value = '9. Idoso 60+';
  }
  setCondicoesCheckboxes('prio-modal-condicoes', p.condicoes_especiais || null);
  document.getElementById('prio-modal-motivo').value = '';
  const senhaInp = document.getElementById('prio-modal-senha');
  if (senhaInp) senhaInp.value = '';

  onPrioModalTipoChange();
  modal.classList.add('show');
}

function fecharModalPrioridadeFila() {
  document.getElementById('priority-patient-modal')?.classList.remove('show');
}

function onPrioModalTipoChange() {
  const tipo = document.getElementById('prio-modal-tipo')?.value || 'geral';
  const wrapCat = document.getElementById('prio-modal-categoria-wrap');
  if (wrapCat) wrapCat.style.display = tipo === 'prioritario' ? 'block' : 'none';
  onPrioModalInputChange();
}

function onPrioModalInputChange() {
  const rankAntes = Number(document.getElementById('prio-modal-rank-antes')?.value || 99);
  const tipo = document.getElementById('prio-modal-tipo')?.value || 'geral';
  const cat = tipo === 'prioritario' ? document.getElementById('prio-modal-categoria')?.value : '';
  const idadeVal = document.getElementById('prio-modal-idade')?.value;
  const conds = [...document.querySelectorAll('#prio-modal-condicoes input[type="checkbox"]:checked')].map(c => c.value);
  const rankNovo = calcularRankPrevioFront(tipo, cat, idadeVal, conds);

  const senhaWrap = document.getElementById('prio-modal-senha-wrap');
  if (senhaWrap) {
    const vaiRebaixar = rankNovo > rankAntes;
    senhaWrap.style.display = (vaiRebaixar && !isManagerOrAdmin()) ? 'block' : 'none';
  }
}

async function confirmarAlterarPrioridadeFila() {
  if (!isManagerOrAdmin()) {
    showToast('🔒 Apenas Gerente ou Administrador pode alterar a prioridade de atendimento.', true);
    fecharModalPrioridadeFila();
    return;
  }
  const id = document.getElementById('prio-modal-patient-id')?.value;
  const prioridade = document.getElementById('prio-modal-tipo')?.value || 'geral';
  const tipo_prioridade = prioridade === 'prioritario' ? document.getElementById('prio-modal-categoria')?.value : null;
  const idadeRaw = (document.getElementById('prio-modal-idade')?.value || '').trim();
  const idade = idadeRaw === '' ? null : Number(idadeRaw);
  const condicoes_especiais = getCondicoesFromContainer('prio-modal-condicoes');
  const motivo = (document.getElementById('prio-modal-motivo')?.value || '').trim();
  const senhaDigitada = (document.getElementById('prio-modal-senha')?.value || '').trim();
  const senha = senhaDigitada || adminPassword || '';
  const btn = document.getElementById('prio-modal-btn-save');

  if (idade !== null && (!Number.isInteger(idade) || idade < 0 || idade > 120)) {
    showToast('Idade inválida (informe de 0 a 120 ou deixe em branco).', true);
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Atualizando...'; }
  try {
    const hdrPrio = { 'Content-Type': 'application/json' };
    if (senha) hdrPrio['x-admin-password'] = senha;
    const r = await fetch(`${API_URL}/patients/${encodeURIComponent(id)}/prioridade`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: hdrPrio,
      body: JSON.stringify({ prioridade, tipo_prioridade, idade, condicoes_especiais, motivo: motivo || null, senha: senha || undefined })
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 403 && d.requiresManagerPassword) {
      const wrap = document.getElementById('prio-modal-senha-wrap');
      if (wrap) wrap.style.display = 'block';
      document.getElementById('prio-modal-senha')?.focus();
      throw new Error(d.error || 'Senha de Gerente ou Administrador obrigatória para remover prioridade.');
    }
    if (!r.ok) throw new Error(d.error || 'Erro ao alterar prioridade!');

    fecharModalPrioridadeFila();
    showToast('⭐ Prioridade atualizada e fila reordenada!');
    await Promise.all([
      loadQueues(),
      typeof loadAcolhimentoFluxo === 'function' ? loadAcolhimentoFluxo() : Promise.resolve()
    ]);
  } catch (err) {
    showToast(err.message || 'Erro ao atualizar prioridade!', true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⭐ Salvar Prioridade'; }
  }
}

// --- 3) TUBOS DE COLETA NO TÉC. ENFERMAGEM (LGPD: NUNCA NA TV) ---
function gerarHtmlPillsTubos(examesColetaPayload, compacto = true) {
  if (!window.USFExamesTubos) return '';
  const res = window.USFExamesTubos.calcularResumoTubosColeta(examesColetaPayload);
  if (!res || (res.tubos.length === 0 && res.coletores.length === 0)) return '';

  const pillsTubos = res.tubos.map(t => {
    const title = `${t.nome} (${t.quantidade}x) — ${t.detalhe || t.nomeCurto}`;
    return `<span title="${escapeText(title)}" style="display:inline-flex;align-items:center;gap:4px;padding:${compacto ? '2px 7px' : '4px 9px'};border-radius:999px;background:${t.corHex};color:${t.corTexto};border:1px solid ${t.corBorda};font-size:${compacto ? '10.5px' : '11.5px'};font-weight:900;box-shadow:0 1px 2px rgba(0,0,0,0.12);white-space:nowrap;">🧪 ${t.quantidade}× ${escapeText(t.nomeCurto)}</span>`;
  }).join('');

  const pillsCol = res.coletores.map(c => {
    const title = `${c.nome} — ${c.detalhe || c.nomeCurto}`;
    return `<span title="${escapeText(title)}" style="display:inline-flex;align-items:center;gap:3px;padding:${compacto ? '2px 7px' : '4px 9px'};border-radius:999px;background:${c.corFundoSuave};color:${c.corTextoSuave};border:1px solid ${c.corBorda};font-size:${compacto ? '10px' : '11px'};font-weight:800;white-space:nowrap;">🫙 ${escapeText(c.nomeCurto)}</span>`;
  }).join('');

  const totalLabel = res.totalTubos > 0
    ? `<span style="font-size:10.5px;font-weight:900;color:#0f766e;margin-left:2px;">Total: ${res.totalTubos} ${res.totalTubos === 1 ? 'tubo' : 'tubos'}</span>`
    : '';

  return `<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">${pillsTubos}${pillsCol}${totalLabel}</div>`;
}

function renderBadgesTubosColeta(p, setor) {
  if (document.body.classList.contains('modo-tv')) return '';
  if (setor !== 'Téc. Enfermagem' && !p?.exames_coleta) return '';
  const inner = gerarHtmlPillsTubos(p?.exames_coleta, true);
  if (!inner) return '';
  return `<div style="margin-top:5px;padding:5px 7px;border-radius:8px;background:#f0fdfa;border:1px solid #99f6e4;" onclick="event.stopPropagation();">${inner}</div>`;
}

function atualizarVisibilidadeTubosRecepcao() {
  const setor = document.getElementById('input-setor')?.value || '';
  const tipo = document.getElementById('input-tipo-atendimento')?.value || '';
  const box = document.getElementById('recepcao-coleta-tubos-box');
  if (!box) return;
  const mostrar = setor === 'Téc. Enfermagem' && tipo === 'Coleta';
  box.style.display = mostrar ? 'block' : 'none';
  if (mostrar) atualizarResumoTubosBox('recepcao');
}

function atualizarVisibilidadeTubosTransfer() {
  const setor = document.getElementById('transfer-setor-destino')?.value || '';
  const tipo = document.getElementById('transfer-tipo-atendimento')?.value || '';
  const box = document.getElementById('transfer-coleta-tubos-box');
  if (!box) return;
  const mostrar = setor === 'Téc. Enfermagem' && tipo === 'Coleta';
  box.style.display = mostrar ? 'block' : 'none';
  if (mostrar) atualizarResumoTubosBox('transfer');
}

function atualizarResumoTubosBox(contexto) {
  const payload = contexto === 'transfer' ? _examesColetaTransfer : _examesColetaRecepcao;
  const el = document.getElementById(contexto === 'transfer' ? 'transfer-coleta-tubos-resumo' : 'recepcao-coleta-tubos-resumo');
  if (!el) return;
  const pills = gerarHtmlPillsTubos(payload, true);
  el.innerHTML = pills || 'Nenhum tubo selecionado (opcional — o técnico pode pré-etiquetar assim que informado).';
}

function aplicarPerfilColetaRapido(contexto, perfilId) {
  if (!window.USFExamesTubos) return;
  const perfil = window.USFExamesTubos.PERFIS_RAPIDOS_COLETA.find(pr => pr.id === perfilId);
  if (!perfil) return;
  const atual = contexto === 'transfer' ? _examesColetaTransfer : _examesColetaRecepcao;
  const exSet = new Set(atual?.exames || []);
  perfil.exames.forEach(e => exSet.add(e));
  const perfSet = new Set(atual?.perfis || []);
  perfSet.add(perfilId);
  const novo = window.USFExamesTubos.normalizarPayloadExamesColeta({
    perfis: Array.from(perfSet),
    exames: Array.from(exSet),
    tubos_manuais: atual?.tubos_manuais || []
  });
  if (contexto === 'transfer') _examesColetaTransfer = novo;
  else _examesColetaRecepcao = novo;
  atualizarResumoTubosBox(contexto);
  showToast(`🧪 Perfil "${perfil.nome}" aplicado!`);
}

function limparTubosColetaContexto(contexto) {
  if (contexto === 'transfer') _examesColetaTransfer = null;
  else _examesColetaRecepcao = null;
  atualizarResumoTubosBox(contexto);
}

function abrirModalTubosColetaContexto(contexto) {
  const src = contexto === 'transfer' ? _examesColetaTransfer : _examesColetaRecepcao;
  carregarEstadoNoModalTubos(contexto, null, src, contexto === 'transfer' ? 'Selecionar tubos para encaminhamento' : 'Selecionar tubos na entrada da Recepção');
}

function abrirModalTubosPaciente(patientId) {
  const p = encontrarPacienteEmCachePorId(patientId);
  if (!p) {
    showToast('Paciente não encontrado.', true);
    return;
  }
  carregarEstadoNoModalTubos('patient', p.id, p.exames_coleta || null, `Paciente: ${p.nome} (${p.setor})`);
}

function carregarEstadoNoModalTubos(contexto, patientId, payloadRaw, subtitle) {
  if (!window.USFExamesTubos) return;
  const norm = window.USFExamesTubos.normalizarPayloadExamesColeta(payloadRaw);
  const manuais = {};
  (norm?.tubos_manuais || []).forEach(tm => {
    manuais[tm.grupoId] = tm.quantidade;
  });
  _tubosModalState = {
    contexto,
    patientId,
    exames: norm?.exames ? norm.exames.slice() : [],
    tubosManuais: manuais,
    perfis: norm?.perfis ? norm.perfis.slice() : []
  };
  const subEl = document.getElementById('tubos-modal-subtitle');
  if (subEl) subEl.textContent = subtitle || '';
  const buscaEl = document.getElementById('tubos-modal-busca');
  if (buscaEl) buscaEl.value = '';
  renderModalTubosColeta();
  document.getElementById('tubos-coleta-modal')?.classList.add('show');
}

function fecharModalTubosColeta() {
  document.getElementById('tubos-coleta-modal')?.classList.remove('show');
}

function renderModalTubosColeta() {
  if (!window.USFExamesTubos) return;
  const perfisEl = document.getElementById('tubos-modal-perfis');
  if (perfisEl) {
    perfisEl.innerHTML = window.USFExamesTubos.PERFIS_RAPIDOS_COLETA.map(pr => `
      <button type="button" class="motivo-chip" style="background:#f0fdfa;border-color:#5eead4;color:#0f766e;" onclick="togglePerfilModalTubos('${pr.id}')">${pr.icon} ${escapeText(pr.nome)}</button>
    `).join('');
  }
  renderGridTubosModal();
  renderExamesChipsModalTubos();
  atualizarPreviewModalTubos();
}

function togglePerfilModalTubos(perfilId) {
  if (!window.USFExamesTubos) return;
  const perfil = window.USFExamesTubos.PERFIS_RAPIDOS_COLETA.find(pr => pr.id === perfilId);
  if (!perfil) return;
  const exSet = new Set(_tubosModalState.exames);
  perfil.exames.forEach(e => exSet.add(e));
  _tubosModalState.exames = Array.from(exSet);
  if (!_tubosModalState.perfis.includes(perfilId)) _tubosModalState.perfis.push(perfilId);
  renderGridTubosModal();
  renderExamesChipsModalTubos();
  atualizarPreviewModalTubos();
}

function ajustarTuboManualModal(grupoId, delta) {
  const atual = _tubosModalState.tubosManuais[grupoId] || 0;
  const prox = Math.max(0, Math.min(5, atual + delta));
  if (prox === 0) delete _tubosModalState.tubosManuais[grupoId];
  else _tubosModalState.tubosManuais[grupoId] = prox;
  renderGridTubosModal();
  atualizarPreviewModalTubos();
}

function renderGridTubosModal() {
  const gridEl = document.getElementById('tubos-modal-grid');
  if (!gridEl || !window.USFExamesTubos) return;
  const resumo = window.USFExamesTubos.calcularResumoTubosColeta({
    exames: _tubosModalState.exames,
    tubos_manuais: _tubosModalState.tubosManuais
  });
  const qtdsCalc = {};
  [...resumo.tubos, ...resumo.coletores].forEach(item => { qtdsCalc[item.grupoId] = item.quantidade; });

  gridEl.innerHTML = window.USFExamesTubos.GRUPOS_TUBOS_RECIFE.map(g => {
    const qtd = qtdsCalc[g.id] || 0;
    const manualQtd = _tubosModalState.tubosManuais[g.id] || 0;
    const ativo = qtd > 0;
    return `
      <div style="border:1.5px solid ${ativo ? g.corBorda : '#e2e8f0'};background:${ativo ? g.corFundoSuave : '#ffffff'};border-radius:10px;padding:8px 10px;display:flex;flex-direction:column;justify-content:space-between;gap:6px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
          <span style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:900;color:#0f172a;">
            <span style="width:12px;height:12px;border-radius:50%;background:${g.corHex};border:1px solid ${g.corBorda};flex-shrink:0;"></span>
            ${escapeText(g.nomeCurto)}
          </span>
          <div style="display:flex;align-items:center;gap:4px;">
            <button type="button" onclick="ajustarTuboManualModal('${g.id}',-1)" style="width:24px;height:24px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;font-weight:900;cursor:pointer;">-</button>
            <span style="min-width:18px;text-align:center;font-weight:900;font-size:12.5px;color:${ativo ? g.corTextoSuave : '#94a3b8'};">${qtd}</span>
            <button type="button" onclick="ajustarTuboManualModal('${g.id}',1)" style="width:24px;height:24px;border-radius:6px;border:1px solid ${g.corBorda};background:${g.corHex};color:${g.corTexto};font-weight:900;cursor:pointer;">+</button>
          </div>
        </div>
        <div style="font-size:10px;color:#475569;font-weight:600;line-height:1.25;">${escapeText(g.subtitulo)}${manualQtd > 0 ? ' (manual)' : ''}</div>
      </div>
    `;
  }).join('');
}

function toggleExameModalTubos(labelEncoded) {
  const label = decodeURIComponent(labelEncoded);
  const idx = _tubosModalState.exames.indexOf(label);
  if (idx >= 0) _tubosModalState.exames.splice(idx, 1);
  else _tubosModalState.exames.push(label);
  renderGridTubosModal();
  renderExamesChipsModalTubos();
  atualizarPreviewModalTubos();
}

function renderExamesChipsModalTubos() {
  const box = document.getElementById('tubos-modal-exames');
  if (!box || !window.USFExamesTubos) return;
  const q = window.USFExamesTubos.normExLab(document.getElementById('tubos-modal-busca')?.value || '');
  const gMap = Object.fromEntries(window.USFExamesTubos.GRUPOS_TUBOS_RECIFE.map(g => [g.id, g]));
  const vistos = new Set();
  const chips = [];

  for (const item of window.USFExamesTubos.MAPA_EXAMES_LAB) {
    if (vistos.has(item.label)) continue;
    vistos.add(item.label);
    const g = gMap[item.grupo];
    const searchable = window.USFExamesTubos.normExLab(`${item.label} ${g?.nomeCurto || ''}`);
    if (q && !searchable.includes(q)) continue;
    const sel = _tubosModalState.exames.includes(item.label);
    const bg = sel && g ? g.corHex : '#fff';
    const fg = sel && g ? g.corTexto : '#334155';
    const bd = sel && g ? g.corBorda : '#cbd5e1';
    chips.push(`<button type="button" onclick="toggleExameModalTubos('${encodeURIComponent(item.label)}')" style="padding:4px 8px;border-radius:999px;border:1.5px solid ${bd};background:${bg};color:${fg};font-size:11px;font-weight:800;cursor:pointer;">${sel ? '✓ ' : ''}${escapeText(item.label)}</button>`);
  }
  box.innerHTML = chips.join('') || '<span style="font-size:11.5px;color:#64748b;">Nenhum exame encontrado para este filtro.</span>';
}

function atualizarPreviewModalTubos() {
  const prevEl = document.getElementById('tubos-modal-preview');
  if (!prevEl || !window.USFExamesTubos) return;
  const payload = window.USFExamesTubos.normalizarPayloadExamesColeta({
    perfis: _tubosModalState.perfis,
    exames: _tubosModalState.exames,
    tubos_manuais: _tubosModalState.tubosManuais
  });
  const html = gerarHtmlPillsTubos(payload, false);
  prevEl.innerHTML = html || '<span style="font-size:12px;color:#64748b;font-weight:700;">Nenhum tubo selecionado ainda.</span>';
}

function limparTudoModalTubos() {
  _tubosModalState.exames = [];
  _tubosModalState.tubosManuais = {};
  _tubosModalState.perfis = [];
  renderGridTubosModal();
  renderExamesChipsModalTubos();
  atualizarPreviewModalTubos();
}

async function confirmarModalTubosColeta() {
  if (!window.USFExamesTubos) return;
  const payload = window.USFExamesTubos.normalizarPayloadExamesColeta({
    perfis: _tubosModalState.perfis,
    exames: _tubosModalState.exames,
    tubos_manuais: _tubosModalState.tubosManuais
  });
  if (_tubosModalState.contexto === 'recepcao') {
    _examesColetaRecepcao = payload;
    atualizarResumoTubosBox('recepcao');
    fecharModalTubosColeta();
    return;
  }
  if (_tubosModalState.contexto === 'transfer') {
    _examesColetaTransfer = payload;
    atualizarResumoTubosBox('transfer');
    fecharModalTubosColeta();
    return;
  }
  if (_tubosModalState.contexto === 'patient' && _tubosModalState.patientId) {
    const btn = document.getElementById('tubos-modal-btn-save');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Salvando...'; }
    try {
      const r = await fetch(`${API_URL}/patients/${encodeURIComponent(_tubosModalState.patientId)}/exames-coleta`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exames_coleta: payload })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Erro ao salvar tubos!');
      fecharModalTubosColeta();
      showToast(d.resumo?.resumoCurto ? `🧪 Tubos salvos: ${d.resumo.resumoCurto}` : '🧪 Tubos de coleta atualizados!');
      await loadQueues();
    } catch (err) {
      showToast(err.message || 'Erro ao salvar tubos!', true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '💾 Aplicar Tubos'; }
    }
  }
}

// --- 4) AUSENTE TEMPORÁRIO NA CHAMADA ---
async function marcarAusenteTemporarioFila(id, nome) {
  try {
    const r = await fetch(`${API_URL}/patients/${encodeURIComponent(id)}/ausente-temporario`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo: 'Não respondeu à chamada no consultório' })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Erro ao marcar ausente temporário!');
    showToast(`⏸️ ${nome} aguardando retorno na fila — chame o próximo paciente.`);
    await Promise.all([loadQueues(), loadCurrentCalling()]);
  } catch (err) {
    showToast(err.message || 'Erro ao marcar ausência temporária!', true);
  }
}

// --- 5) CHECK-IN EM 1 CLIQUE DOS AGENDAMENTOS ---
async function enviarAgendamentoParaFila(agendamentoId, nome, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Enviando...'; }
  try {
    const r = await fetch(`${API_URL}/agendamentos/${encodeURIComponent(agendamentoId)}/enviar-fila`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Erro ao enviar agendamento para a fila!');
    const tubosInfo = d.resumoTubos?.resumoCurto ? ` · 🧪 ${d.resumoTubos.resumoCurto}` : '';
    showToast(`✅ ${nome} enviado para a fila de ${d.patient?.setor || 'atendimento'}${tubosInfo}!`);
    await Promise.all([
      loadQueues(),
      typeof loadAgendamentos === 'function' ? loadAgendamentos() : Promise.resolve(),
      typeof loadColetasStats === 'function' ? loadColetasStats() : Promise.resolve()
    ]);
  } catch (err) {
    showToast(err.message || 'Erro ao fazer check-in!', true);
    if (btn) { btn.disabled = false; btn.textContent = '🏥 Enviar p/ Fila'; }
  }
}

// ============================================================================
// GESTÃO DINÂMICA DE EQUIPE / MUTIRÃO + CONTINGÊNCIA OFFLINE (BLOCO 1 & EXTRA)
// ============================================================================
let _abaSegundaTelaAdminAtual = 'contingencia';

async function alternarAbaSegundaTelaAdmin(aba = 'contingencia') {
  _abaSegundaTelaAdminAtual = aba === 'equipe' ? 'equipe' : 'contingencia';
  const paneCont = document.getElementById('seg-pane-contingencia');
  const paneEq = document.getElementById('seg-pane-equipe');
  const btnCont = document.getElementById('seg-tab-btn-contingencia');
  const btnEq = document.getElementById('seg-tab-btn-equipe');
  const btnImprimirTop = document.getElementById('btn-seg-tela-imprimir');

  if (paneCont) paneCont.style.display = _abaSegundaTelaAdminAtual === 'contingencia' ? 'flex' : 'none';
  if (paneEq) paneEq.style.display = _abaSegundaTelaAdminAtual === 'equipe' ? 'flex' : 'none';
  if (btnCont) btnCont.classList.toggle('active', _abaSegundaTelaAdminAtual === 'contingencia');
  if (btnEq) btnEq.classList.toggle('active', _abaSegundaTelaAdminAtual === 'equipe');
  if (btnImprimirTop) btnImprimirTop.style.display = _abaSegundaTelaAdminAtual === 'contingencia' ? 'inline-flex' : 'none';

  if (_abaSegundaTelaAdminAtual === 'equipe') {
    const chk = document.getElementById('chk-preview-mutirao-profs');
    try {
      if (chk) chk.checked = localStorage.getItem('usf_preview_mutirao_profs') === '1';
    } catch (_) {}
    const statusEl = document.getElementById('mutirao-contexto-status');
    if (statusEl) {
      statusEl.textContent = isContextoMutiraoAtivoFront()
        ? '🟢 Modo Mutirão ATIVO agora nas filas'
        : '⚪ Modo Semana (Seg–Sex): plantonistas de Mutirão ocultos';
    }
    const lista = await carregarProfissionaisCache(true);
    renderListaEquipeMutirao(lista || _listaProfissionaisCadastro);
  } else {
    renderModalContingenciaOffline();
    renderPreviewFolhaContingencia();
  }
}

async function abrirModalEquipeMutirao() {
  if (!isManagerOrAdmin()) {
    showToast('🔒 Ação restrita à Gerência ou Administração.', true);
    return;
  }
  await abrirModalContingenciaOffline('equipe');
}

function fecharModalEquipeMutirao() {
  fecharModalContingenciaOffline();
}

function sugerirCargoPorSetorEquipe(setor) {
  const inp = document.getElementById('eq-novo-profissao');
  if (!inp) return;
  const mapPlaceholder = {
    'Enfermagem': 'Enfermeira – Estratégia Saúde da Família',
    'Médico': 'Médico – Estratégia Saúde da Família',
    'Odontologia': 'Cirurgiã-Dentista – Estratégia Saúde da Família',
    'Téc. Enfermagem': 'Técnico(a) de Enfermagem'
  };
  inp.placeholder = mapPlaceholder[setor] || 'Cargo / Conselho (opc.)';
}

function togglePreviewMutiraoProfissionais(checked) {
  try {
    if (checked) localStorage.setItem('usf_preview_mutirao_profs', '1');
    else localStorage.removeItem('usf_preview_mutirao_profs');
  } catch (_) {}
  aplicarProfissionaisDinamicosNoSistema();
  const statusEl = document.getElementById('mutirao-contexto-status');
  if (statusEl) {
    statusEl.textContent = isContextoMutiraoAtivoFront()
      ? '🟢 Modo Mutirão ATIVO agora nas filas'
      : '⚪ Modo Semana (Seg–Sex): plantonistas de Mutirão ficam ocultos';
  }
}

function renderListaEquipeMutirao(lista) {
  const el = document.getElementById('equipe-mutirao-lista');
  if (!el) return;
  const rows = Array.isArray(lista) ? lista : [];
  if (rows.length === 0) {
    el.innerHTML = '<div style="padding:18px;text-align:center;color:var(--gray-500);background:#fff;border-radius:12px;">Nenhum profissional cadastrado.</div>';
    return;
  }
  const regimeBadge = {
    fixo: { bg: '#dbeafe', fg: '#1e40af', label: '🏥 Fixo (Seg–Sex)' },
    mutirao: { bg: '#fef3c7', fg: '#92400e', label: '🗓️ Só Mutirão (Sábado)' },
    substituto: { bg: '#f3e8ff', fg: '#6b21a8', label: '🔄 Substituto' }
  };
  const grupos = [
    { setor: 'Médico', titulo: '🩺 Médico' },
    { setor: 'Enfermagem', titulo: '👩‍⚕️ Enfermagem' },
    { setor: 'Odontologia', titulo: '🦷 Odontologia' },
    { setor: 'Téc. Enfermagem', titulo: '🩹 Téc. Enfermagem' }
  ];
  const extras = rows.filter(p => !grupos.some(g => g.setor === p.setor));
  if (extras.length > 0) grupos.push({ setor: '__OUTROS__', titulo: '👥 Outros' });

  el.innerHTML = grupos.map(g => {
    const itens = g.setor === '__OUTROS__'
      ? extras
      : rows.filter(p => (p.setor || 'Médico') === g.setor);
    if (itens.length === 0) return '';
    const cardsHtml = itens.map(p => {
      const rb = regimeBadge[p.regime] || regimeBadge.fixo;
      const opacity = p.ativo === false ? 'opacity:0.55;background:#f8fafc;' : 'background:#fff;';
      const nomeEsc = escapeText(p.nome || '');
      const nomeJs = String(p.nome || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `<div style="border:1.5px solid #e2e8f0;border-radius:10px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;${opacity}">
        <div style="min-width:210px;flex:1;">
          <div style="font-weight:800;font-size:13.5px;color:#0f172a;">
            ${nomeEsc}
            <span style="display:inline-block;margin-left:6px;padding:2px 8px;border-radius:999px;font-size:10.5px;background:${rb.bg};color:${rb.fg};">${rb.label}</span>
            ${p.ativo === false ? '<span style="margin-left:4px;font-size:10.5px;color:#b91c1c;font-weight:800;">(Inativo)</span>' : ''}
          </div>
          ${p.profissao ? `<div style="font-size:11.5px;color:#475569;margin-top:2px;">${escapeText(p.profissao)}</div>` : ''}
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <select onchange="alternarRegimeProfissionalMutirao(${Number(p.id)}, this.value)" style="padding:5px 8px;font-size:11.5px;border-radius:7px;border:1px solid #cbd5e1;" title="Regime de exibição nas filas">
            <option value="fixo"${p.regime === 'fixo' ? ' selected' : ''}>Fixo (Seg–Sex)</option>
            <option value="mutirao"${p.regime === 'mutirao' ? ' selected' : ''}>Só Mutirão (Sábado)</option>
            <option value="substituto"${p.regime === 'substituto' ? ' selected' : ''}>Substituto</option>
          </select>
          <button type="button" class="btn btn-outline btn-sm" style="padding:5px 9px;font-size:11.5px;min-height:30px;" onclick="alternarAtivoProfissionalMutirao(${Number(p.id)}, ${p.ativo === false ? 'true' : 'false'})">${p.ativo === false ? '✅ Reativar' : '⏸️ Desativar'}</button>
          <button type="button" class="btn btn-outline btn-sm" style="padding:5px 9px;font-size:11.5px;min-height:30px;color:#b91c1c;border-color:#fca5a5;" onclick="excluirProfissionalMutirao(${Number(p.id)}, '${nomeJs}')">🗑️</button>
        </div>
      </div>`;
    }).join('');
    return `<div style="background:#ffffff;border:1.5px solid #cbd5e1;border-radius:12px;padding:12px;">
      <div style="font-size:13px;font-weight:900;color:#0f172a;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
        <span>${g.titulo}</span>
        <span style="font-size:11px;background:#e2e8f0;color:#334155;padding:2px 8px;border-radius:999px;">${itens.length} profissional(is)</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">${cardsHtml}</div>
    </div>`;
  }).join('');
}

async function salvarNovoProfissionalMutirao() {
  const nome = document.getElementById('eq-novo-nome')?.value.trim() || '';
  const setor = document.getElementById('eq-novo-setor')?.value || 'Enfermagem';
  const regime = document.getElementById('eq-novo-regime')?.value || 'mutirao';
  const profissao = document.getElementById('eq-novo-profissao')?.value.trim() || '';
  if (nome.length < 2) {
    showToast('Informe o nome completo do profissional.', true);
    return;
  }
  try {
    const r = await fetch(`${API_URL}/profissionais`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, setor, regime, profissao: profissao || null, ativo: true })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Erro ao salvar profissional.');
    document.getElementById('eq-novo-nome').value = '';
    document.getElementById('eq-novo-profissao').value = '';
    showToast(`✅ ${d.nome} salvo (${d.setor} · ${d.regime === 'mutirao' ? 'Mutirão Sábado' : d.regime})!`);
    await carregarProfissionaisCache(false);
    const lista = await carregarProfissionaisCache(true);
    renderListaEquipeMutirao(lista || _listaProfissionaisCadastro);
  } catch (err) {
    showToast(err.message || 'Erro ao salvar profissional.', true);
  }
}

async function alternarRegimeProfissionalMutirao(id, novoRegime) {
  try {
    const r = await fetch(`${API_URL}/profissionais/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regime: novoRegime })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Erro ao atualizar regime.');
    showToast(`✅ ${d.nome} atualizado para ${novoRegime === 'mutirao' ? 'Só Mutirão (Sábado)' : novoRegime}.`);
    await carregarProfissionaisCache(false);
    const lista = await carregarProfissionaisCache(true);
    renderListaEquipeMutirao(lista || _listaProfissionaisCadastro);
  } catch (err) {
    showToast(err.message || 'Erro ao atualizar regime.', true);
  }
}

async function alternarAtivoProfissionalMutirao(id, ativo) {
  try {
    const r = await fetch(`${API_URL}/profissionais/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ativo: Boolean(ativo) })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Erro ao alterar status.');
    showToast(`${d.ativo ? '✅' : '⏸️'} ${d.nome} ${d.ativo ? 'ativado' : 'desativado'}.`);
    await carregarProfissionaisCache(false);
    const lista = await carregarProfissionaisCache(true);
    renderListaEquipeMutirao(lista || _listaProfissionaisCadastro);
  } catch (err) {
    showToast(err.message || 'Erro ao alterar status.', true);
  }
}

async function excluirProfissionalMutirao(id, nome) {
  if (!confirm(`Remover ${nome} da lista de profissionais?`)) return;
  try {
    const r = await fetch(`${API_URL}/profissionais/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Erro ao excluir profissional.');
    showToast(`🗑️ ${nome} removido da lista.`);
    await carregarProfissionaisCache(false);
    const lista = await carregarProfissionaisCache(true);
    renderListaEquipeMutirao(lista || _listaProfissionaisCadastro);
  } catch (err) {
    showToast(err.message || 'Erro ao remover profissional.', true);
  }
}

// --- Contingência Offline LGPD (Espelho Criptografado/Ofuscado na Sessão + Outbox + Folha Impressa) ---
const CONTINGENCIA_KEY_STORAGE = 'usf_contingencia_k1';
const CONTINGENCIA_ESPELHO_STORAGE = 'usf_contingencia_espelho_v1';
const CONTINGENCIA_OUTBOX_STORAGE = 'usf_contingencia_outbox_v1';
let _sincronizandoOutbox = false;

function gerarClientRequestId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `req_${crypto.randomUUID()}`.slice(0, 64);
    }
  } catch (_) {}
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`.slice(0, 64);
}

function obterChaveSessaoContingencia() {
  try {
    let k = sessionStorage.getItem(CONTINGENCIA_KEY_STORAGE);
    if (!k) {
      k = `k_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
      sessionStorage.setItem(CONTINGENCIA_KEY_STORAGE, k);
    }
    return k;
  } catch (_) {
    return 'usf-session-fallback-key';
  }
}

function ofuscarPayloadContingencia(obj, chaveStr) {
  const json = JSON.stringify(obj);
  const key = String(chaveStr || obterChaveSessaoContingencia());
  const bytes = new TextEncoder().encode(json);
  const keyBytes = new TextEncoder().encode(key);
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i] ^ keyBytes[i % keyBytes.length];
  }
  let bin = '';
  for (let i = 0; i < out.length; i++) bin += String.fromCharCode(out[i]);
  return btoa(bin);
}

function desofuscarPayloadContingencia(cipherText, chaveStr) {
  if (!cipherText || typeof cipherText !== 'string') return null;
  try {
    const key = String(chaveStr || obterChaveSessaoContingencia());
    const keyBytes = new TextEncoder().encode(key);
    const bin = atob(cipherText);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i) ^ keyBytes[i % keyBytes.length];
    }
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json);
  } catch (_) {
    return null;
  }
}

function sanitizarPacienteEspelhoContingencia(p) {
  if (!p || typeof p !== 'object') return null;
  return {
    id: p.id || null,
    nome: String(p.nome || '').trim(),
    setor: p.setor || null,
    profissional: p.profissional || p.profissional_destino || null,
    prioridade: p.prioridade || 'geral',
    tipo_prioridade: p.tipo_prioridade || null,
    nivel_prioridade: p.nivel_prioridade || 3,
    ordem_prioridade_odonto: p.ordem_prioridade_odonto || 99,
    horario: p.horario || '',
    horario_marcado: p.horario_marcado || null,
    status: p.status || 'aguardando',
    etapa_fluxo: p.etapa_fluxo || 'recepcao',
    equipe_paciente: p.equipe_paciente || null,
    ausente_temporario: Boolean(p.ausente_temporario),
    offline_pendente: Boolean(p.offline_pendente),
    client_request_id: p.client_request_id || null
  };
}

function salvarEspelhoFilaContingencia() {
  try {
    const queuesSanit = {};
    SETORES.forEach(s => {
      queuesSanit[s] = (queues[s] || [])
        .filter(p => !p.offline_pendente)
        .map(sanitizarPacienteEspelhoContingencia)
        .filter(Boolean);
    });
    const acolSanit = {
      recepcao: (acolhimentoFluxo?.recepcao || []).map(sanitizarPacienteEspelhoContingencia).filter(Boolean),
      primeira_escuta: (acolhimentoFluxo?.primeira_escuta || []).map(sanitizarPacienteEspelhoContingencia).filter(Boolean),
      segunda_escuta: (acolhimentoFluxo?.segunda_escuta || []).map(sanitizarPacienteEspelhoContingencia).filter(Boolean)
    };
    const callingSanit = {};
    SETORES.forEach(s => {
      callingSanit[s] = currentCalling?.[s] ? sanitizarPacienteEspelhoContingencia(currentCalling[s]) : null;
    });
    const payload = {
      dataRef: getDataHojeRecife(),
      savedAt: new Date().toISOString(),
      queues: queuesSanit,
      acolhimento: acolSanit,
      currentCalling: callingSanit
    };
    localStorage.setItem(CONTINGENCIA_ESPELHO_STORAGE, ofuscarPayloadContingencia(payload));
  } catch (_) {}
}

function lerEspelhoFilaContingencia() {
  try {
    const raw = localStorage.getItem(CONTINGENCIA_ESPELHO_STORAGE);
    if (!raw) return null;
    const parsed = desofuscarPayloadContingencia(raw);
    if (!parsed || parsed.dataRef !== getDataHojeRecife()) {
      localStorage.removeItem(CONTINGENCIA_ESPELHO_STORAGE);
      return null;
    }
    return parsed;
  } catch (_) {
    return null;
  }
}

function restaurarEspelhoFilaContingenciaSeVazio() {
  const temAlgum = SETORES.some(s => Array.isArray(queues[s]) && queues[s].length > 0);
  if (temAlgum) {
    mesclarOutboxLocalNasFilas();
    return false;
  }
  const esp = lerEspelhoFilaContingencia();
  if (!esp || !esp.queues) return false;
  SETORES.forEach(s => {
    queues[s] = Array.isArray(esp.queues[s]) ? esp.queues[s].slice() : [];
  });
  if (esp.acolhimento) acolhimentoFluxo = esp.acolhimento;
  if (esp.currentCalling) currentCalling = esp.currentCalling;
  mesclarOutboxLocalNasFilas();
  if (typeof updateAll === 'function') updateAll();
  if (typeof renderAcolhimentoFluxo === 'function') renderAcolhimentoFluxo();
  showToast('🛡️ Fila restaurada a partir do espelho local (modo contingência offline).');
  return true;
}

function lerOutboxOffline() {
  try {
    const raw = localStorage.getItem(CONTINGENCIA_OUTBOX_STORAGE);
    if (!raw) return [];
    const parsed = desofuscarPayloadContingencia(raw);
    if (!Array.isArray(parsed)) return [];
    const hoje = getDataHojeRecife();
    return parsed.filter(item => item && item.dataRef === hoje && item.payload);
  } catch (_) {
    return [];
  }
}

function salvarOutboxOffline(items) {
  try {
    if (!items || items.length === 0) {
      localStorage.removeItem(CONTINGENCIA_OUTBOX_STORAGE);
    } else {
      localStorage.setItem(CONTINGENCIA_OUTBOX_STORAGE, ofuscarPayloadContingencia(items));
    }
  } catch (_) {}
  atualizarBadgeContingenciaOffline();
}

function enfileirarPacienteOffline(payload, nomeSetorOriginal) {
  const items = lerOutboxOffline();
  if (payload.client_request_id && items.some(it => it.payload?.client_request_id === payload.client_request_id)) {
    return items;
  }
  const horario = new Date().toLocaleTimeString('pt-BR', {
    timeZone: 'America/Recife', hour: '2-digit', minute: '2-digit'
  });
  const entry = {
    dataRef: getDataHojeRecife(),
    queuedAt: new Date().toISOString(),
    horario,
    nomeSetorOriginal: nomeSetorOriginal || payload.setor,
    payload
  };
  items.push(entry);
  salvarOutboxOffline(items);
  mesclarOutboxLocalNasFilas();
  if (typeof updateAll === 'function') updateAll();
  return items;
}

function mesclarOutboxLocalNasFilas() {
  const items = lerOutboxOffline();
  SETORES.forEach(s => {
    queues[s] = (queues[s] || []).filter(p => !p.offline_pendente);
  });
  items.forEach((it, idx) => {
    const p = it.payload;
    if (!p || !queues[p.setor]) return;
    if (queues[p.setor].some(x => x.client_request_id && x.client_request_id === p.client_request_id)) return;
    queues[p.setor].push(sanitizarPacienteEspelhoContingencia({
      id: -(idx + 1),
      nome: p.nome,
      setor: p.setor,
      profissional: p.profissional,
      prioridade: p.prioridade || 'geral',
      tipo_prioridade: p.tipo_prioridade || null,
      nivel_prioridade: p.prioridade === 'prioritario' ? 2 : 3,
      horario: it.horario || '--:--',
      horario_marcado: p.horario_marcado || null,
      status: 'aguardando',
      etapa_fluxo: p.etapa_fluxo || 'recepcao',
      equipe_paciente: p.equipe_paciente || null,
      offline_pendente: true,
      client_request_id: p.client_request_id
    }));
  });
  atualizarBadgeContingenciaOffline();
}

function atualizarBadgeContingenciaOffline() {
  const count = lerOutboxOffline().length;
  const badge = document.getElementById('contingencia-offline-badge');
  if (badge) {
    badge.textContent = String(count);
    badge.style.display = count > 0 ? 'inline-block' : 'none';
  }
}

async function sincronizarFilaOfflinePendente(manual = false) {
  if (_sincronizandoOutbox) return;
  const pendentes = lerOutboxOffline();
  if (pendentes.length === 0) {
    if (manual) showToast('✅ Nenhum cadastro offline pendente para sincronizar.');
    atualizarBadgeContingenciaOffline();
    return { synced: 0, remaining: 0 };
  }
  if (navigator.onLine === false) {
    if (manual) showToast('🔴 Sem internet no momento para sincronizar a fila offline.', true);
    return { synced: 0, remaining: pendentes.length };
  }
  _sincronizandoOutbox = true;
  const restantes = [];
  let enviados = 0;
  try {
    for (const item of pendentes) {
      try {
        const r = await fetch(`${API_URL}/patients`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.payload)
        });
        if (r.ok || r.status === 400) {
          enviados++;
        } else {
          restantes.push(item);
        }
      } catch (_) {
        restantes.push(item);
      }
    }
    salvarOutboxOffline(restantes);
    if (enviados > 0) {
      showToast(`🔄 ${enviados} cadastro(s) offline sincronizado(s) com o servidor!`);
      await loadQueues();
    } else if (manual && restantes.length > 0) {
      showToast('⚠️ Ainda sem conexão estável para enviar os cadastros offline.', true);
    }
  } finally {
    _sincronizandoOutbox = false;
    if (document.getElementById('modal-contingencia-offline')?.classList.contains('show')) {
      renderModalContingenciaOffline();
    }
  }
  return { synced: enviados, remaining: restantes.length };
}

function limparEspelhoContingenciaLogout(preservarChave = false) {
  try {
    localStorage.removeItem(CONTINGENCIA_ESPELHO_STORAGE);
    localStorage.removeItem(CONTINGENCIA_OUTBOX_STORAGE);
    if (preservarChave) sessionStorage.removeItem(CONTINGENCIA_KEY_STORAGE);
  } catch (_) {}
  atualizarBadgeContingenciaOffline();
}

function limparEspelhoContingenciaManual() {
  if (!confirm('Limpar o espelho local e a lista offline desta estação?')) return;
  limparEspelhoContingenciaLogout(false);
  mesclarOutboxLocalNasFilas();
  if (typeof updateAll === 'function') updateAll();
  renderModalContingenciaOffline();
  showToast('🧹 Espelho local limpo nesta estação.');
}

function renderModalContingenciaOffline() {
  const resumoEl = document.getElementById('contingencia-resumo-box');
  const outboxEl = document.getElementById('contingencia-outbox-lista');
  const esp = lerEspelhoFilaContingencia();
  const totalNaFila = SETORES.reduce((acc, s) => acc + ((queues[s] || []).length), 0);
  const outbox = lerOutboxOffline();
  const salvoEm = esp?.savedAt
    ? new Date(esp.savedAt).toLocaleTimeString('pt-BR', { timeZone: 'America/Recife', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : 'Agora';
  if (resumoEl) {
    resumoEl.innerHTML = `
      <div><strong>📦 Pacientes no espelho atual:</strong> ${totalNaFila} pessoa(s) distribuída(s) nos setores</div>
      <div><strong>🕒 Última atualização salva:</strong> ${escapeText(salvoEm)} &nbsp;|&nbsp; <strong>📥 Pendentes offline:</strong> ${outbox.length}</div>
    `;
  }
  if (outboxEl) {
    if (outbox.length === 0) {
      outboxEl.innerHTML = '<div style="font-size:12.5px;color:var(--gray-500);text-align:center;padding:12px;">Nenhum cadastro offline pendente.</div>';
    } else {
      outboxEl.innerHTML = outbox.map((it, i) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-bottom:1px solid #f1f5f9;font-size:12.5px;">
          <div><strong>${i + 1}. ${escapeText(it.payload?.nome || '')}</strong> · ${escapeText(it.nomeSetorOriginal || it.payload?.setor || '')} ${it.payload?.profissional ? `(${escapeText(it.payload.profissional)})` : ''}</div>
          <span style="font-size:11px;font-weight:800;color:#b45309;">⏳ ${escapeText(it.horario || '')}</span>
        </div>
      `).join('');
    }
  }
}

async function abrirModalContingenciaOffline(abaInicial = 'contingencia') {
  const modal = document.getElementById('modal-contingencia-offline');
  if (!modal) return;
  modal.classList.add('show');
  await alternarAbaSegundaTelaAdmin(abaInicial || 'contingencia');
}

function fecharModalContingenciaOffline() {
  document.getElementById('modal-contingencia-offline')?.classList.remove('show');
}

function renderPreviewFolhaContingencia() {
  const previewEl = document.getElementById('contingencia-paper-preview');
  if (!previewEl) return;
  const filtro = document.getElementById('contingencia-filtro-setor')?.value || 'TODOS';
  const bodyHtml = gerarCorpoFolhaContingencia({ queues }, filtro);
  previewEl.innerHTML = bodyHtml;
}

function gerarCorpoFolhaContingencia(snapshot = {}, filtroSetor = 'TODOS') {
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Recife' });
  const queuesData = snapshot.queues || queues || {};
  const setoresFiltrados = (filtroSetor && filtroSetor !== 'TODOS' && SETORES.includes(filtroSetor))
    ? [filtroSetor]
    : SETORES;

  const setoresHtml = setoresFiltrados.map(setor => {
    const lista = Array.isArray(queuesData[setor]) ? queuesData[setor] : [];
    const linhas = lista.length === 0
      ? '<tr><td colspan="6" style="color:#64748b;font-style:italic;padding:6px;">Nenhum paciente aguardando neste setor.</td></tr>'
      : lista.map((p, idx) => {
          const prio = (p.prioridade === 'prioritario' || Number(p.nivel_prioridade) <= 2)
            ? `⭐ ${escapeText(p.tipo_prioridade || 'Prioritário')}`
            : 'Geral';
          const prof = escapeText(p.profissional || p.profissional_destino || (p.etapa_fluxo === 'primeira_escuta' ? '1ª Escuta' : p.etapa_fluxo === 'segunda_escuta' ? '2ª Escuta' : 'Geral'));
          const hora = escapeText(p.horario_marcado ? `Marc. ${p.horario_marcado} / Cheg. ${p.horario || ''}` : (p.horario || ''));
          const off = p.offline_pendente ? ' [OFFLINE]' : '';
          return `<tr>
            <td style="text-align:center;font-weight:700;">${idx + 1}</td>
            <td><strong>${escapeText(p.nome || '')}${off}</strong></td>
            <td>${prof}</td>
            <td>${prio}</td>
            <td>${hora}</td>
            <td style="white-space:nowrap;">☐ Chamado &nbsp; ☐ Atendido &nbsp; ☐ Ausente</td>
          </tr>`;
        }).join('');
    return `<section style="margin-bottom:14px;page-break-inside:avoid;">
      <h3 style="margin:0 0 6px;padding:4px 8px;background:#e2e8f0;font-size:13px;border-left:4px solid #0f172a;color:#0f172a;">${escapeText(setor)} (${lista.length})</h3>
      <table style="width:100%;border-collapse:collapse;font-size:11.5px;">
        <thead><tr style="background:#f8fafc;">
          <th style="width:28px;">#</th><th>Paciente</th><th>Profissional / Etapa</th><th>Prioridade</th><th>Horário</th><th>Controle Manual</th>
        </tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </section>`;
  }).join('');

  const linhasEmBranco = Array.from({ length: 10 }, (_, i) =>
    `<tr><td style="height:22px;text-align:center;">+${i + 1}</td><td></td><td></td><td>☐ Geral ☐ Prio</td><td></td><td>☐ Chamado ☐ Atendido</td></tr>`
  ).join('');

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <h1 style="font-size:16px;margin:0 0 4px;color:#0f172a;">🏥 USF Chico Mendes — Folha de Contingência de Filas</h1>
    </div>
    <div style="font-size:11.5px;color:#475569;margin-bottom:12px;border-bottom:2px solid #0f172a;padding-bottom:6px;">
      Gerado em: ${escapeText(agora)} · Filtro: <strong>${escapeText(filtroSetor === 'TODOS' ? 'Todos os Setores' : filtroSetor)}</strong> · Uso exclusivo da equipe (sem dados clínicos sensíveis).
    </div>
    ${setoresHtml}
    <section style="margin-top:14px;page-break-inside:avoid;">
      <h3 style="margin:0 0 6px;font-size:13px;color:#0f172a;">📝 Novos Pacientes Recebidos Durante Queda de Internet</h3>
      <table style="width:100%;border-collapse:collapse;font-size:11.5px;">
        <thead><tr style="background:#f8fafc;"><th style="width:28px;">#</th><th>Nome Completo</th><th>Setor / Profissional</th><th>Prioridade</th><th>Chegada</th><th>Situação</th></tr></thead>
        <tbody>${linhasEmBranco}</tbody>
      </table>
    </section>`;
}

function gerarHtmlFolhaContingencia(snapshot = {}, filtroSetor = 'TODOS') {
  const corpoHtml = gerarCorpoFolhaContingencia(snapshot, filtroSetor);
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
    <title>Folha de Contingência — USF Chico Mendes</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 14px; color: #0f172a; }
      table, th, td { border: 1px solid #94a3b8; }
      th, td { padding: 4px 6px; text-align: left; }
      @media print { .no-print { display: none; } }
    </style></head><body>${corpoHtml}</body></html>`;
}

function imprimirFolhaContingenciaFila() {
  const filtro = document.getElementById('contingencia-filtro-setor')?.value || 'TODOS';
  const html = gerarHtmlFolhaContingencia({ queues }, filtro);
  try {
    let frame = document.getElementById('usf-print-contingencia-frame');
    if (frame) frame.remove();
    frame = document.createElement('iframe');
    frame.id = 'usf-print-contingencia-frame';
    frame.style.position = 'fixed';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    frame.style.opacity = '0';
    frame.style.pointerEvents = 'none';
    document.body.appendChild(frame);
    const fDoc = frame.contentDocument || frame.contentWindow?.document;
    if (fDoc && frame.contentWindow) {
      fDoc.open();
      fDoc.write(html);
      fDoc.close();
      setTimeout(() => {
        try {
          frame.contentWindow.focus();
          frame.contentWindow.print();
        } catch (_) {}
      }, 220);
      return;
    }
  } catch (_) {}

  const win = window.open('', '_blank', 'width=960,height=740');
  if (!win) {
    showToast('⚠️ Permita pop-ups no navegador para imprimir a folha de contingência.', true);
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  setTimeout(() => { try { win.focus(); win.print(); } catch (_) {} }, 250);
}

window.addEventListener('online', () => {
  atualizarStatusConexao('online');
});
window.addEventListener('offline', () => {
  atualizarStatusConexao('offline', 'Navegador sem internet');
});
document.addEventListener('DOMContentLoaded', () => {
  atualizarBadgeContingenciaOffline();
  const screenRec = document.getElementById('screen-recepcao');
  if (screenRec) {
    screenRec.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        const btn = screenRec.querySelector('.direto-only-submit button, #recepcao-col-escuta1 button[onclick*="addPatient"]');
        addPatient(btn);
      }
    });
  }
  ['input-nome', 'input-idade'].forEach(inpId => {
    const inp = document.getElementById(inpId);
    if (inp) {
      inp.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const dd = document.getElementById('autocomplete-sugestoes');
        const ddVisivel = dd && dd.style.display !== 'none';
        if (ddVisivel && dd.querySelector('.autocomplete-item.active')) return;
        const setorAtual = document.getElementById('input-setor')?.value;
        if (setorAtual && typeof addPatient === 'function') {
          e.preventDefault();
          const btn = document.querySelector('#screen-recepcao .direto-only-submit button');
          addPatient(btn);
        }
      });
    }
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (isPausado || !isGateAuthenticated) return;

  if (document.getElementById('modal-contingencia-offline')?.classList.contains('show')) {
    fecharModalContingenciaOffline();
    return;
  }
  if (document.getElementById('modal-config-metas-dia')?.classList.contains('show')) {
    fecharModalConfigMetasDia();
    return;
  }
  if (document.getElementById('modal-config-pausa')?.classList.contains('show')) {
    fecharModalConfigPausa();
    return;
  }
  const openOverlay = document.querySelector(
    '.previa-modal-backdrop.show, .modal-overlay.show, .acol-modal-overlay.show, .wa-modal-overlay.show, .reorder-modal-overlay.show'
  );
  if (openOverlay) {
    openOverlay.classList.remove('show');
    if (openOverlay.style.display === 'flex' || openOverlay.style.display === 'block') {
      openOverlay.style.display = 'none';
    }
  }
});
